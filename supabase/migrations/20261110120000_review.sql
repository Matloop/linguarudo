-- Revisão com FSRS: cada palavra vira um cartão; cada nota vira um log.
-- O cálculo do FSRS fica no app (ts-fsrs, apps/web/src/lib/server/scheduler.ts).
-- Aqui ficam o estado, os limites e as operações que precisam ser atômicas.

-- Configurações por usuário. Sem linha = padrões (a tela de configurações vem depois).
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  new_cards_per_day integer not null default 10 check (new_cards_per_day between 0 and 1000),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
revoke all on public.user_settings from anon, authenticated;
grant select on public.user_settings to authenticated;
create policy "dono lê as próprias configurações" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);

-- Um cartão por palavra. Colunas seguem o Card do ts-fsrs 6 (FSRS-7), em snake_case.
-- O ts-fsrs 6 não usa mais elapsed_days: o tempo decorrido sai de last_review_at.
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  word_id uuid not null unique references public.words (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  due_at timestamptz not null default now(),
  stability double precision not null default 0,
  stability_fast double precision not null default 0,
  difficulty double precision not null default 0,
  state smallint not null default 0 check (state between 0 and 3),
  schedule_status text not null default 'new',
  last_review_at timestamptz,
  reps integer not null default 0,
  lapses integer not null default 0,
  scheduled_days double precision not null default 0,
  learning_step integer not null default 0,
  paused boolean not null default false,
  created_at timestamptz not null default now()
);

create index cards_user_due_idx on public.cards (user_id, due_at) where not paused and state > 0;
create index cards_user_new_idx on public.cards (user_id, created_at) where not paused and state = 0;

alter table public.cards enable row level security;

-- Cartão nasce pelo trigger, não pelo app: authenticated não insere nem apaga
-- (apagar a palavra apaga o cartão). Update só nas colunas de estado e pausa.
revoke all on public.cards from anon, authenticated;
grant select on public.cards to authenticated;
grant update (
  due_at, stability, stability_fast, difficulty, state, schedule_status,
  last_review_at, reps, lapses, scheduled_days, learning_step, paused
) on public.cards to authenticated;

create policy "dono lê os próprios cartões" on public.cards
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono edita os próprios cartões" on public.cards
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Toda palavra nova vira cartão, venha de onde vier (app, Stremio, SQL).
create function public.create_card_for_word() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cards (word_id, user_id, created_at)
  values (new.id, new.user_id, new.created_at)
  on conflict (word_id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_card_for_word() from public, anon, authenticated;

create trigger words_create_card after insert on public.words
  for each row execute function public.create_card_for_word();

-- Backfill: palavras que já existiam.
insert into public.cards (word_id, user_id, created_at)
select id, user_id, created_at from public.words
on conflict (word_id) do nothing;

-- Log de revisões. `previous` é a linha do cartão antes da nota (para desfazer);
-- `revlog` é o ReviewLog do ts-fsrs, guardado como veio (serve para otimizar pesos depois).
create table public.review_logs (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 4),
  reviewed_at timestamptz not null default now(),
  was_new boolean not null,
  previous jsonb not null,
  revlog jsonb not null
);

create index review_logs_user_time_idx on public.review_logs (user_id, reviewed_at desc);
create index review_logs_card_time_idx on public.review_logs (card_id, reviewed_at desc);

alter table public.review_logs enable row level security;
revoke all on public.review_logs from anon, authenticated;
grant select, insert, delete on public.review_logs to authenticated;

create policy "dono lê os próprios logs" on public.review_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono registra logs dos próprios cartões" on public.review_logs
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.cards c where c.id = card_id and c.user_id = (select auth.uid()))
  );
create policy "dono apaga os próprios logs" on public.review_logs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Limite de novos por dia. p_day_start vem do app (o fuso fica num ponto só, em review.ts).
create function public.new_cards_limit() returns integer
  language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select s.new_cards_per_day from public.user_settings s where s.user_id = (select auth.uid())),
    10
  );
$$;

-- Contagens para o "N para revisar" e o estado vazio, numa ida ao banco.
create function public.review_counts(p_day_start timestamptz)
  returns table (due_now integer, new_available integer, new_done_today integer, new_limit integer, next_due_at timestamptz)
  language sql stable security invoker set search_path = '' as $$
  select
    (select count(*)::integer from public.cards c
      where c.user_id = (select auth.uid()) and not c.paused and c.state > 0 and c.due_at <= now()),
    (select count(*)::integer from public.cards c
      where c.user_id = (select auth.uid()) and not c.paused and c.state = 0),
    (select count(*)::integer from public.review_logs l
      where l.user_id = (select auth.uid()) and l.was_new and l.reviewed_at >= p_day_start),
    public.new_cards_limit(),
    (select min(c.due_at) from public.cards c
      where c.user_id = (select auth.uid()) and not c.paused and c.state > 0 and c.due_at > now());
$$;

-- Grava a nota: confere o estado esperado (duas abas não avaliam o mesmo cartão
-- duas vezes), aplica o limite de novos, atualiza o cartão e registra o log, tudo
-- numa transação. Erros saem com mensagens fixas que o app traduz.
create function public.review_card(
  p_card_id uuid,
  p_expected_reps integer,
  p_rating smallint,
  p_day_start timestamptz,
  p_next jsonb,
  p_revlog jsonb
) returns uuid
  language plpgsql security invoker set search_path = '' as $$
declare
  v_card public.cards;
  v_next public.cards;
  v_log_id uuid;
begin
  select * into v_card from public.cards
    where id = p_card_id and user_id = (select auth.uid())
    for update;
  if not found then raise exception 'card_not_found'; end if;
  if v_card.paused then raise exception 'card_paused'; end if;
  if v_card.reps <> p_expected_reps then raise exception 'card_stale'; end if;

  if v_card.state = 0 and (
    select count(*) from public.review_logs l
    where l.user_id = v_card.user_id and l.was_new and l.reviewed_at >= p_day_start
  ) >= public.new_cards_limit() then
    raise exception 'new_limit';
  end if;

  v_next := jsonb_populate_record(v_card, p_next);
  update public.cards set
    due_at = v_next.due_at,
    stability = v_next.stability,
    stability_fast = v_next.stability_fast,
    difficulty = v_next.difficulty,
    state = v_next.state,
    schedule_status = v_next.schedule_status,
    last_review_at = v_next.last_review_at,
    reps = v_next.reps,
    lapses = v_next.lapses,
    scheduled_days = v_next.scheduled_days,
    learning_step = v_next.learning_step
  where id = v_card.id;

  insert into public.review_logs (card_id, user_id, rating, reviewed_at, was_new, previous, revlog)
  values (v_card.id, v_card.user_id, p_rating, now(), v_card.state = 0, to_jsonb(v_card), p_revlog)
  returning id into v_log_id;

  return v_log_id;
end;
$$;

-- Desfaz uma nota: só a mais recente do cartão. Restaura o snapshot e apaga o log.
create function public.undo_review(p_log_id uuid) returns uuid
  language plpgsql security invoker set search_path = '' as $$
declare
  v_log public.review_logs;
  v_prev public.cards;
begin
  select * into v_log from public.review_logs
    where id = p_log_id and user_id = (select auth.uid());
  if not found then raise exception 'log_not_found'; end if;

  perform 1 from public.cards where id = v_log.card_id for update;
  if exists (
    select 1 from public.review_logs l
    where l.card_id = v_log.card_id and l.reviewed_at > v_log.reviewed_at
  ) then
    raise exception 'log_not_latest';
  end if;

  v_prev := jsonb_populate_record(null::public.cards, v_log.previous);
  update public.cards set
    due_at = v_prev.due_at,
    stability = v_prev.stability,
    stability_fast = v_prev.stability_fast,
    difficulty = v_prev.difficulty,
    state = v_prev.state,
    schedule_status = v_prev.schedule_status,
    last_review_at = v_prev.last_review_at,
    reps = v_prev.reps,
    lapses = v_prev.lapses,
    scheduled_days = v_prev.scheduled_days,
    learning_step = v_prev.learning_step
  where id = v_log.card_id;

  delete from public.review_logs where id = v_log.id;
  return v_log.card_id;
end;
$$;

revoke all on function public.new_cards_limit() from public, anon;
revoke all on function public.review_counts(timestamptz) from public, anon;
revoke all on function public.review_card(uuid, integer, smallint, timestamptz, jsonb, jsonb) from public, anon;
revoke all on function public.undo_review(uuid) from public, anon;
grant execute on function public.new_cards_limit() to authenticated;
grant execute on function public.review_counts(timestamptz) to authenticated;
grant execute on function public.review_card(uuid, integer, smallint, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.undo_review(uuid) to authenticated;
