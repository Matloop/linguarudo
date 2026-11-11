-- Decks e fila do dia (docs/agents/decks.md, ADR 0005).
--
--   1. Deck: cada item e cada ficha pertence a exatamente um deck do seu idioma. Um nível
--      só (Pai › Filho). Cada usuário+idioma tem um deck padrão ("Minhas palavras"), criado
--      sozinho; captura cai nele. O padrão não se apaga, mas pode trocar.
--   2. Orçamento de novas por idioma e dia de estudo: new_flashcards_per_day + extra_new do
--      dia − novas começadas hoje (review_logs). Revisão nunca é recusada por limite.
--   3. Teimosa: user_settings.leech_lapses (8) e leech_action (wait|tag|suspend). Em wait o
--      item/ficha fica em espera (leech_hold) até um encontro novo com frase ou "Voltar
--      para a fila"; em suspend só volta à mão.
--   4. queue_state_for entrega ao app o que a fila precisa (decks, orçamento, candidatas a
--      nova com encontros e obras); a ordem sai de lib/server/queue.ts. O snapshot do sync
--      leva o mesmo estado, mais as fichas em texto.
--   5. Ops novas do sync: extraNew e deckImport.

-- ---------- Decks ----------

create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  language public.language_code not null,
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  parent_id uuid,
  is_default boolean not null default false,
  paused boolean not null default false,
  -- Ordem das novas dentro do deck. Decks importados (Anki, CSV) usam a ordem do deck.
  new_order text not null default 'importance' check (new_order in ('importance', 'deck', 'random')),
  -- Teto de novas por dia do próprio deck, dentro do orçamento do idioma.
  new_cap integer check (new_cap between 0 and 1000),
  on_reader boolean not null default true,
  position integer not null default 0,
  -- Hash do conteúdo importado pelo leitor (op deckImport): reenviar não duplica.
  import_hash text check (char_length(import_hash) between 1 and 128),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (parent_id, user_id) references public.decks (id, user_id) on delete cascade,
  check (not (is_default and parent_id is not null))
);

create unique index decks_default_key on public.decks (user_id, language) where is_default;
create unique index decks_name_key on public.decks
  (user_id, language, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create unique index decks_import_hash_key on public.decks (user_id, import_hash) where import_hash is not null;
create index decks_parent_idx on public.decks (parent_id) where parent_id is not null;

alter table public.decks enable row level security;
revoke all on public.decks from anon, authenticated;
grant select on public.decks to authenticated;
grant insert (user_id, language, name, parent_id, new_order, new_cap, on_reader, position) on public.decks to authenticated;
grant update (name, parent_id, paused, new_order, new_cap, on_reader, position) on public.decks to authenticated;

create policy "dono lê os próprios decks" on public.decks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria decks" on public.decks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono edita os próprios decks" on public.decks
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- O deck padrão do idioma; cria se faltar.
create function public.ensure_default_deck(p_user uuid, p_language public.language_code) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select d.id into v_id from public.decks d
    where d.user_id = p_user and d.language = p_language and d.is_default;
  if v_id is not null then return v_id; end if;
  insert into public.decks (user_id, language, name, is_default)
  values (p_user, p_language, 'Minhas palavras', true)
  on conflict (user_id, language) where is_default do nothing
  returning id into v_id;
  if v_id is null then
    select d.id into v_id from public.decks d
      where d.user_id = p_user and d.language = p_language and d.is_default;
  end if;
  return v_id;
end;
$$;
revoke all on function public.ensure_default_deck(uuid, public.language_code) from public, anon, authenticated;

-- Pai do mesmo usuário e idioma, sem pai ele mesmo; deck com filhos não vira filho.
create function public.check_deck() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.decks;
begin
  if tg_op = 'UPDATE' and new.language <> old.language then raise exception 'deck_language'; end if;
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'deck_parent'; end if;
    select * into v_parent from public.decks d where d.id = new.parent_id and d.user_id = new.user_id;
    if v_parent.id is null or v_parent.language <> new.language or v_parent.parent_id is not null then
      raise exception 'deck_parent';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.decks c where c.parent_id = new.id) then
      raise exception 'deck_parent';
    end if;
  end if;
  if tg_op = 'INSERT' and not new.is_default then
    perform public.ensure_default_deck(new.user_id, new.language);
  end if;
  return new;
end;
$$;
revoke all on function public.check_deck() from public, anon, authenticated;

create trigger decks_check before insert or update on public.decks
  for each row execute function public.check_deck();

-- ---------- Deck do item e da ficha ----------

alter table public.items add column deck_id uuid;
alter table public.fichas add column deck_id uuid;

select public.ensure_default_deck(s.user_id, s.language) from (
  select distinct user_id, language from public.items
  union select distinct user_id, language from public.fichas
  union select user_id, unnest(study_languages) from public.user_settings
) s;

update public.items i set deck_id = d.id from public.decks d
  where d.user_id = i.user_id and d.language = i.language and d.is_default;
update public.fichas h set deck_id = d.id from public.decks d
  where d.user_id = h.user_id and d.language = h.language and d.is_default;

alter table public.items alter column deck_id set not null;
alter table public.fichas alter column deck_id set not null;
-- Sem cascade: apagar um deck passa por delete_deck, que move ou apaga o conteúdo antes.
alter table public.items add constraint items_deck_id_user_id_fkey
  foreign key (deck_id, user_id) references public.decks (id, user_id);
alter table public.fichas add constraint fichas_deck_id_user_id_fkey
  foreign key (deck_id, user_id) references public.decks (id, user_id);
create index items_deck_idx on public.items (deck_id);
create index fichas_deck_idx on public.fichas (deck_id);

-- Sem deck, cai no padrão do idioma. Trocar de idioma leva ao padrão do idioma novo.
create function public.assign_deck() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_language public.language_code;
begin
  if tg_op = 'INSERT' then
    if new.deck_id is null then
      new.deck_id := public.ensure_default_deck(new.user_id, new.language);
    end if;
  elsif new.language is distinct from old.language and new.deck_id is not distinct from old.deck_id then
    new.deck_id := public.ensure_default_deck(new.user_id, new.language);
  end if;
  select d.language into v_language from public.decks d
    where d.id = new.deck_id and d.user_id = new.user_id;
  if v_language is distinct from new.language then raise exception 'deck_language'; end if;
  return new;
end;
$$;
revoke all on function public.assign_deck() from public, anon, authenticated;

create trigger items_deck before insert or update of language, deck_id on public.items
  for each row execute function public.assign_deck();
create trigger fichas_deck before insert or update of language, deck_id on public.fichas
  for each row execute function public.assign_deck();

grant update (deck_id) on public.items to authenticated;
grant insert (deck_id), update (deck_id) on public.fichas to authenticated;

-- Idioma de estudo novo já tem deck padrão (a tela de decks não fica vazia).
create function public.ensure_study_decks() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  perform public.ensure_default_deck(new.user_id, l) from unnest(new.study_languages) l;
  return new;
end;
$$;
revoke all on function public.ensure_study_decks() from public, anon, authenticated;

create trigger user_settings_study_decks after insert or update of study_languages on public.user_settings
  for each row execute function public.ensure_study_decks();

-- Deck padrão do idioma do usuário logado (cria "Minhas palavras" se faltar).
create function public.default_deck(p_language text) returns uuid
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return public.ensure_default_deck(auth.uid(), p_language::public.language_code);
end;
$$;
revoke all on function public.default_deck(text) from public, anon;
grant execute on function public.default_deck(text) to authenticated;

-- Troca o padrão do idioma (só deck de topo).
create function public.set_default_deck(p_deck uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  v_deck public.decks;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_deck from public.decks d where d.id = p_deck and d.user_id = auth.uid();
  if v_deck.id is null then raise exception 'deck_not_found'; end if;
  if v_deck.parent_id is not null then raise exception 'deck_parent'; end if;
  if v_deck.is_default then return; end if;
  update public.decks set is_default = false
    where user_id = v_deck.user_id and language = v_deck.language and is_default;
  update public.decks set is_default = true where id = v_deck.id;
end;
$$;
revoke all on function public.set_default_deck(uuid) from public, anon;
grant execute on function public.set_default_deck(uuid) to authenticated;

-- Apaga um deck não padrão e seus filhos. p_mode 'move' leva itens e fichas ao padrão;
-- 'delete' apaga (soft delete) junto. Devolve quantos itens + fichas foram afetados.
create function public.delete_deck(p_deck uuid, p_mode text) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  v_deck public.decks;
  v_ids uuid[];
  v_default uuid;
  v_items integer;
  v_fichas integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_mode not in ('move', 'delete') then raise exception 'bad_request'; end if;
  select * into v_deck from public.decks d where d.id = p_deck and d.user_id = auth.uid();
  if v_deck.id is null then raise exception 'deck_not_found'; end if;
  if v_deck.is_default then raise exception 'deck_default'; end if;
  v_ids := array(select d.id from public.decks d where d.id = p_deck or d.parent_id = p_deck);
  v_default := public.ensure_default_deck(v_deck.user_id, v_deck.language);

  if p_mode = 'delete' then
    update public.items set deleted_at = now()
      where user_id = v_deck.user_id and deck_id = any (v_ids) and deleted_at is null;
    get diagnostics v_items = row_count;
    update public.fichas set deleted_at = now()
      where user_id = v_deck.user_id and deck_id = any (v_ids) and deleted_at is null;
    get diagnostics v_fichas = row_count;
    -- Os apagados ficam no padrão só para a chave estrangeira.
    update public.items set deck_id = v_default where user_id = v_deck.user_id and deck_id = any (v_ids);
    update public.fichas set deck_id = v_default where user_id = v_deck.user_id and deck_id = any (v_ids);
  else
    update public.items set deck_id = v_default where user_id = v_deck.user_id and deck_id = any (v_ids);
    get diagnostics v_items = row_count;
    update public.fichas set deck_id = v_default where user_id = v_deck.user_id and deck_id = any (v_ids);
    get diagnostics v_fichas = row_count;
  end if;

  delete from public.decks where id = any (v_ids) and parent_id is not null;
  delete from public.decks where id = p_deck;
  return v_items + v_fichas;
end;
$$;
revoke all on function public.delete_deck(uuid, text) from public, anon;
grant execute on function public.delete_deck(uuid, text) to authenticated;

-- ---------- Configurações da fila ----------

alter table public.user_settings
  -- Como "Estudar tudo" intercala os decks.
  add column new_order text not null default 'importance' check (new_order in ('importance', 'deck', 'random')),
  add column leech_lapses smallint not null default 8 check (leech_lapses between 1 and 99),
  add column leech_action text not null default 'wait' check (leech_action in ('wait', 'tag', 'suspend'));

grant update (new_order, leech_lapses, leech_action) on public.user_settings to authenticated;

-- Data local do dia de estudo que começa em p_day_start.
create function public.review_day_key(p_user uuid, p_day_start timestamptz) returns date
  language sql stable security definer set search_path = '' as $$
  select (p_day_start at time zone coalesce(
    (select s.time_zone from public.user_settings s where s.user_id = p_user), 'America/Sao_Paulo'))::date;
$$;
revoke all on function public.review_day_key(uuid, timestamptz) from public, anon, authenticated;

-- ---------- Extras do dia ----------

create table public.extra_new (
  user_id uuid not null references auth.users (id) on delete cascade,
  language public.language_code not null,
  day date not null,
  n integer not null check (n between 0 and 1000),
  primary key (user_id, language, day)
);

alter table public.extra_new enable row level security;
revoke all on public.extra_new from anon, authenticated;
grant select on public.extra_new to authenticated;
create policy "dono lê os próprios extras" on public.extra_new
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.add_extra_new_for(p_user uuid, p_language public.language_code, p_day date, p_n integer)
  returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if p_n is null or p_n < 1 or p_n > 1000 then raise exception 'bad_request'; end if;
  insert into public.extra_new as x (user_id, language, day, n) values (p_user, p_language, p_day, p_n)
  on conflict (user_id, language, day) do update set n = least(x.n + excluded.n, 1000)
  returning x.n into v_n;
  return v_n;
end;
$$;
revoke all on function public.add_extra_new_for(uuid, public.language_code, date, integer) from public, anon, authenticated;

-- "+5 hoje" e "Desta obra". p_day_start vem do app (relógio do usuário).
create function public.add_extra_new(p_language text, p_n integer, p_day_start timestamptz) returns integer
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return public.add_extra_new_for(auth.uid(), p_language::public.language_code,
    public.review_day_key(auth.uid(), p_day_start), p_n);
end;
$$;
revoke all on function public.add_extra_new(text, integer, timestamptz) from public, anon;
grant execute on function public.add_extra_new(text, integer, timestamptz) to authenticated;

-- ---------- Novas começadas hoje ----------

-- Flashcards cuja primeira revisão é do dia de estudo, por deck do dono.
create function public.new_done_by_deck(p_user uuid, p_day_start timestamptz)
  returns table (deck_id uuid, language public.language_code, n integer)
  language sql stable security definer set search_path = '' as $$
  select coalesce(i.deck_id, h.deck_id), coalesce(i.language, h.language), count(distinct l.flashcard_id)::integer
  from public.review_logs l
  join public.flashcards f on f.id = l.flashcard_id
  left join public.items i on i.id = f.item_id
  left join public.fichas h on h.id = f.ficha_id
  where l.user_id = p_user and l.reviewed_at >= p_day_start
    and not exists (
      select 1 from public.review_logs p where p.flashcard_id = l.flashcard_id and p.reviewed_at < p_day_start
    )
  group by 1, 2;
$$;
revoke all on function public.new_done_by_deck(uuid, timestamptz) from public, anon, authenticated;

-- ---------- Teimosas ----------

alter table public.items
  add column leech_hold text check (leech_hold in ('wait', 'suspend')),
  add column leech_hold_at timestamptz,
  add constraint items_leech_hold_at_check check ((leech_hold is null) = (leech_hold_at is null));
alter table public.fichas
  add column leech_hold text check (leech_hold in ('wait', 'suspend')),
  add column leech_hold_at timestamptz,
  add constraint fichas_leech_hold_at_check check ((leech_hold is null) = (leech_hold_at is null));

-- Mesma regra de leechAlert (review.ts): no limite e a cada metade dele depois.
create function public.apply_leech(p_user uuid, p_card public.flashcards, p_lapses integer) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.user_settings;
begin
  if p_lapses <= p_card.lapses then return; end if;
  select * into v_settings from public.user_settings s where s.user_id = p_user;
  if p_lapses < v_settings.leech_lapses
    or (p_lapses - v_settings.leech_lapses) % greatest(1, v_settings.leech_lapses / 2) <> 0
    or v_settings.leech_action = 'tag' then
    return;
  end if;
  update public.items set leech_hold = v_settings.leech_action, leech_hold_at = now()
    where id = p_card.item_id and leech_hold is null;
  update public.fichas set leech_hold = v_settings.leech_action, leech_hold_at = now()
    where id = p_card.ficha_id and leech_hold is null;
end;
$$;
revoke all on function public.apply_leech(uuid, public.flashcards, integer) from public, anon, authenticated;

-- Encontro novo com frase devolve a teimosa em espera à fila.
create function public.release_waiting_leech() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.sentence <> '' then
    update public.items set leech_hold = null, leech_hold_at = null
      where id = new.item_id and leech_hold = 'wait';
  end if;
  return new;
end;
$$;
revoke all on function public.release_waiting_leech() from public, anon, authenticated;

create trigger encounters_release_leech after insert on public.encounters
  for each row execute function public.release_waiting_leech();

-- "Voltar para a fila" (espera ou suspensa).
create function public.release_leeches(p_item_ids uuid[], p_ficha_ids uuid[]) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  v_items integer;
  v_fichas integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.items set leech_hold = null, leech_hold_at = null
    where user_id = auth.uid() and id = any (coalesce(p_item_ids, '{}')) and leech_hold is not null;
  get diagnostics v_items = row_count;
  update public.fichas set leech_hold = null, leech_hold_at = null
    where user_id = auth.uid() and id = any (coalesce(p_ficha_ids, '{}')) and leech_hold is not null;
  get diagnostics v_fichas = row_count;
  return v_items + v_fichas;
end;
$$;
revoke all on function public.release_leeches(uuid[], uuid[]) from public, anon;
grant execute on function public.release_leeches(uuid[], uuid[]) to authenticated;

-- ---------- Revisão: teimosa ----------

create or replace function public.record_review(
  p_flashcard_id uuid,
  p_expected_reps integer,
  p_rating smallint,
  p_reviewed_at timestamptz,
  p_next jsonb,
  p_unlock_produce boolean,
  p_client_id uuid default null,
  p_duration_ms integer default null
) returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_card public.flashcards;
  v_next public.flashcards;
  v_log uuid;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_client_id is not null then
    select l.id into v_log from public.review_logs l where l.user_id = v_user and l.client_id = p_client_id;
    if found then return v_log; end if;
  end if;

  select f.* into v_card from public.flashcards f
    left join public.items i on i.id = f.item_id
    left join public.fichas h on h.id = f.ficha_id
    where f.id = p_flashcard_id and f.user_id = v_user
      and coalesce(i.deleted_at, h.deleted_at) is null
    for update of f;
  if not found then raise exception 'flashcard_not_found'; end if;
  if v_card.reps <> p_expected_reps then raise exception 'flashcard_stale'; end if;

  v_next := jsonb_populate_record(v_card, p_next);

  insert into public.review_logs (flashcard_id, user_id, rating, reviewed_at, client_id, duration_ms,
    state_before, last_interval_days, interval_days)
  values (v_card.id, v_user, p_rating, least(p_reviewed_at, now()), p_client_id,
    least(greatest(p_duration_ms, 0), 600000),
    v_card.state, v_card.scheduled_days, v_next.scheduled_days)
  returning id into v_log;

  update public.flashcards set
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

  if p_unlock_produce and v_card.kind = 'reconhecer' then
    insert into public.flashcards (item_id, user_id, kind)
    values (v_card.item_id, v_user, 'produzir')
    on conflict (item_id, kind) do nothing;
  end if;

  perform public.apply_leech(v_user, v_card, v_next.lapses);
  return v_log;
end;
$$;

-- ---------- Contagens ----------

-- security definer só para chamar os auxiliares internos; tudo filtra por auth.uid().
-- Fora da fila: dono apagado, conhecido, em espera/suspenso, ou em deck pausado.
-- p_language filtra tudo, inclusive as novas feitas hoje e os extras.
drop function public.review_counts(timestamptz, text);
create function public.review_counts(p_day_start timestamptz, p_language text default null)
  returns table (due_now integer, new_available integer, new_done_today integer, new_limit integer,
    extra_new integer, next_due_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  with active as (
    select f.*,
      f.item_id is not null and f.state in (0, 2) and exists (
        select 1 from public.flashcards s
        where s.item_id = f.item_id and s.id <> f.id and s.last_review_at >= p_day_start
      ) as buried
    from public.flashcards f
    left join public.items i on i.id = f.item_id
    left join public.fichas h on h.id = f.ficha_id
    join public.decks d on d.id = coalesce(i.deck_id, h.deck_id)
    where f.user_id = (select auth.uid())
      and coalesce(i.status, h.status) = 'ativo'
      and coalesce(i.deleted_at, h.deleted_at) is null
      and coalesce(i.leech_hold, h.leech_hold) is null
      and not d.paused
      and (p_language is null or d.language::text = p_language)
  )
  select
    (select count(*)::integer from active where state in (1, 3) and due_at <= now())
      + (select count(distinct coalesce(item_id, id))::integer from active
          where state = 2 and due_at <= now() and not buried),
    (select count(distinct coalesce(item_id, id))::integer from active where state = 0 and not buried),
    (select coalesce(sum(n), 0)::integer from public.new_done_by_deck((select auth.uid()), p_day_start) x
      where p_language is null or x.language::text = p_language),
    (select s.new_flashcards_per_day from public.user_settings s where s.user_id = (select auth.uid())),
    (select coalesce(sum(x.n), 0)::integer from public.extra_new x
      where x.user_id = (select auth.uid())
        and x.day = public.review_day_key((select auth.uid()), p_day_start)
        and (p_language is null or x.language::text = p_language)),
    (select min(due_at) from active where state > 0 and due_at > now());
$$;
revoke all on function public.review_counts(timestamptz, text) from public, anon;
grant execute on function public.review_counts(timestamptz, text) to authenticated;

-- Contagens por deck do idioma para a tela de decks. Novas sem orçamento nem teto (o app
-- aplica); "para revisar" vence até o fim do dia de estudo.
create function public.deck_summaries(p_day_start timestamptz, p_next_day_start timestamptz, p_language text)
  returns table (deck_id uuid, new_available integer, learning_due integer, review_due integer,
    new_done_today integer, items integer, fichas integer, leeches integer)
  language sql stable security definer set search_path = '' as $$
  with cards as (
    select f.*, coalesce(i.deck_id, h.deck_id) as deck,
      f.item_id is not null and f.state in (0, 2) and exists (
        select 1 from public.flashcards s
        where s.item_id = f.item_id and s.id <> f.id and s.last_review_at >= p_day_start
      ) as buried
    from public.flashcards f
    left join public.items i on i.id = f.item_id
    left join public.fichas h on h.id = f.ficha_id
    where f.user_id = (select auth.uid())
      and coalesce(i.language, h.language)::text = p_language
      and coalesce(i.status, h.status) = 'ativo'
      and coalesce(i.deleted_at, h.deleted_at) is null
      and coalesce(i.leech_hold, h.leech_hold) is null
  ),
  done as (select * from public.new_done_by_deck((select auth.uid()), p_day_start))
  select d.id,
    (select count(distinct coalesce(c.item_id, c.id))::integer from cards c
      where c.deck = d.id and c.state = 0 and not c.buried),
    (select count(*)::integer from cards c where c.deck = d.id and c.state in (1, 3) and c.due_at < p_next_day_start),
    (select count(distinct coalesce(c.item_id, c.id))::integer from cards c
      where c.deck = d.id and c.state = 2 and c.due_at < p_next_day_start and not c.buried),
    coalesce((select x.n from done x where x.deck_id = d.id), 0),
    (select count(*)::integer from public.items i where i.deck_id = d.id and i.deleted_at is null),
    (select count(*)::integer from public.fichas h where h.deck_id = d.id and h.deleted_at is null),
    (select count(*)::integer from public.items i where i.deck_id = d.id and i.deleted_at is null and i.leech_hold is not null)
      + (select count(*)::integer from public.fichas h where h.deck_id = d.id and h.deleted_at is null and h.leech_hold is not null)
  from public.decks d
  where d.user_id = (select auth.uid()) and d.language::text = p_language;
$$;
revoke all on function public.deck_summaries(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.deck_summaries(timestamptz, timestamptz, text) to authenticated;

-- ---------- Estado da fila ----------

-- Tudo o que lib/server/queue.ts precisa para ordenar as novas do idioma. Candidatas: novas
-- de itens e fichas ativos, sem espera, de qualquer deck (o app filtra pausados e escopo).
create function public.queue_state_for(p_user uuid, p_language public.language_code, p_day_start timestamptz)
  returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object(
        'perDay', s.new_flashcards_per_day,
        'newOrder', s.new_order,
        'leechLapses', s.leech_lapses,
        'leechAction', s.leech_action
      ) from public.user_settings s where s.user_id = p_user),
    'dayKey', public.review_day_key(p_user, p_day_start),
    'extraNew', coalesce((select x.n from public.extra_new x
      where x.user_id = p_user and x.language = p_language
        and x.day = public.review_day_key(p_user, p_day_start)), 0),
    'newDoneByDeck', coalesce((select jsonb_object_agg(x.deck_id, x.n)
      from public.new_done_by_deck(p_user, p_day_start) x where x.language = p_language), '{}'),
    -- Obra ativa: a do último encontro do usuário no idioma nas últimas 48 h.
    'activeWorkId', (select e.work_id from public.encounters e
      join public.items i on i.id = e.item_id
      where e.user_id = p_user and i.language = p_language and e.work_id is not null
        and e.deleted_at is null and e.seen_at > now() - interval '48 hours'
      order by e.seen_at desc limit 1),
    'decks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'parentId', d.parent_id, 'default', d.is_default,
        'paused', d.paused, 'newOrder', d.new_order, 'newCap', d.new_cap,
        'onReader', d.on_reader, 'position', d.position, 'createdAt', d.created_at
      ) order by d.position, d.created_at, d.id)
      from public.decks d where d.user_id = p_user and d.language = p_language), '[]'),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'itemId', f.item_id, 'fichaId', f.ficha_id, 'kind', f.kind, 'ord', f.ord,
        'deckId', coalesce(i.deck_id, h.deck_id), 'createdAt', f.created_at,
        'encounters', coalesce(e.n, 0), 'works', coalesce(e.works, 0), 'lastWorkId', e.last_work,
        'buried', f.item_id is not null and exists (
          select 1 from public.flashcards s
          where s.item_id = f.item_id and s.id <> f.id and s.last_review_at >= p_day_start)
      ))
      from public.flashcards f
      left join public.items i on i.id = f.item_id
      left join public.fichas h on h.id = f.ficha_id
      left join lateral (
        select count(*) as n, count(distinct x.work_id) as works,
          (array_agg(x.work_id order by x.seen_at desc))[1] as last_work
        from public.encounters x where x.item_id = f.item_id and x.deleted_at is null
      ) e on f.item_id is not null
      where f.user_id = p_user and f.state = 0
        and coalesce(i.language, h.language) = p_language
        and coalesce(i.status, h.status) = 'ativo'
        and coalesce(i.deleted_at, h.deleted_at) is null
        and coalesce(i.leech_hold, h.leech_hold) is null), '[]')
  );
$$;
revoke all on function public.queue_state_for(uuid, public.language_code, timestamptz) from public, anon, authenticated;

create function public.queue_state(p_language text, p_day_start timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return public.queue_state_for(auth.uid(), p_language::public.language_code, p_day_start);
end;
$$;
revoke all on function public.queue_state(text, timestamptz) from public, anon;
grant execute on function public.queue_state(text, timestamptz) to authenticated;

-- ---------- Import do Anki: deck vira deck ----------

-- "Pai::Filho::Neto" → deck Pai, subdeck "Filho::Neto" (um nível só). "Default"/"Padrão"
-- e o nome do padrão caem no padrão. Decks criados aqui usam a ordem do deck.
create function public.deck_for_path(p_user uuid, p_language public.language_code, p_path text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  v_parts text[];
  v_default public.decks;
  v_parent uuid;
  v_child uuid;
  v_name text;
begin
  v_parts := array(select left(btrim(x), 80) from unnest(string_to_array(coalesce(p_path, ''), '::')) x
    where btrim(x) <> '');
  select * into v_default from public.decks d
    where d.id = public.ensure_default_deck(p_user, p_language);
  if cardinality(v_parts) = 0 then return v_default.id; end if;

  if lower(v_parts[1]) in ('default', 'padrão', lower(v_default.name)) then
    v_parent := v_default.id;
  else
    select d.id into v_parent from public.decks d
      where d.user_id = p_user and d.language = p_language and d.parent_id is null
        and lower(d.name) = lower(v_parts[1]);
    if v_parent is null then
      insert into public.decks (user_id, language, name, new_order, position)
      values (p_user, p_language, v_parts[1], 'deck',
        coalesce((select max(d.position) + 1 from public.decks d where d.user_id = p_user and d.language = p_language), 0))
      returning id into v_parent;
    end if;
  end if;
  if cardinality(v_parts) = 1 then return v_parent; end if;

  v_name := left(array_to_string(v_parts[2:], '::'), 80);
  select d.id into v_child from public.decks d
    where d.user_id = p_user and d.parent_id = v_parent and lower(d.name) = lower(v_name);
  if v_child is null then
    insert into public.decks (user_id, language, name, parent_id, new_order, position)
    values (p_user, p_language, v_name, v_parent, 'deck',
      coalesce((select max(d.position) + 1 from public.decks d where d.parent_id = v_parent), 0))
    returning id into v_child;
  end if;
  return v_child;
end;
$$;
revoke all on function public.deck_for_path(uuid, public.language_code, text) from public, anon, authenticated;

create or replace function public.import_anki_notes(p_language text, p_notes jsonb)
  returns table (guid text, flashcard_id uuid, kind text, ord smallint, created_at timestamptz, fresh boolean)
  language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_lang public.language_code := p_language::public.language_code;
  v_note jsonb;
  v_saved record;
  v_owner uuid;
  v_created boolean;
  v_tags text[];
  v_suspended boolean;
  v_deck uuid;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_notes) is distinct from 'array' or jsonb_array_length(p_notes) > 100 then
    raise exception 'bad_request';
  end if;

  for v_note in select value from jsonb_array_elements(p_notes) loop
    v_tags := array(select jsonb_array_elements_text(coalesce(v_note -> 'tags', '[]')));
    v_suspended := coalesce((v_note ->> 'suspended')::boolean, false);
    v_deck := public.deck_for_path(v_user, v_lang, v_note ->> 'deck');

    if v_note ->> 'type' = 'item' then
      if (v_note -> 'entry' ->> 'language') is distinct from v_lang::text then
        raise exception 'bad_request';
      end if;
      select * into v_saved from public.save_items_for(v_user, jsonb_build_array(v_note -> 'entry'));
      v_owner := v_saved.item_id;
      -- O que o item já tem fica (inclusive o deck); o Anki completa o que falta.
      update public.items i set
        tags = public.merge_tags(i.tags, v_tags),
        image = coalesce(i.image, v_note ->> 'image'),
        audio = coalesce(i.audio, v_note ->> 'audio'),
        status = case when v_saved.created and v_suspended then 'conhecido' else i.status end,
        deck_id = case when v_saved.created then v_deck else i.deck_id end
      where i.id = v_owner;
      if coalesce((v_note ->> 'produce')::boolean, false) then
        insert into public.flashcards (item_id, user_id, kind)
        values (v_owner, v_user, 'produzir')
        on conflict (item_id, kind) do nothing;
      end if;
      return query
        select v_note ->> 'guid', f.id, f.kind, f.ord, f.created_at,
          f.reps = 0 and not exists (select 1 from public.review_logs l where l.flashcard_id = f.id)
        from public.flashcards f where f.item_id = v_owner;

    elsif v_note ->> 'type' = 'ficha' then
      -- Reimportar atualiza o conteúdo (o Anki é a fonte); mídia nova não apaga a antiga.
      insert into public.fichas as h (
        user_id, language, deck_id, front, back, reverse, cloze_count, tags, anki_guid,
        front_image, front_audio, back_image, back_audio
      ) values (
        v_user, v_lang, v_deck, v_note ->> 'front', coalesce(v_note ->> 'back', ''),
        coalesce((v_note ->> 'reverse')::boolean, false),
        coalesce((v_note ->> 'cloze_count')::smallint, 0),
        v_tags, v_note ->> 'guid',
        v_note ->> 'front_image', v_note ->> 'front_audio',
        v_note ->> 'back_image', v_note ->> 'back_audio'
      )
      on conflict (user_id, anki_guid) where anki_guid is not null and deleted_at is null
      do update set
        front = excluded.front,
        back = excluded.back,
        reverse = excluded.reverse,
        cloze_count = excluded.cloze_count,
        tags = public.merge_tags(h.tags, excluded.tags),
        front_image = coalesce(excluded.front_image, h.front_image),
        front_audio = coalesce(excluded.front_audio, h.front_audio),
        back_image = coalesce(excluded.back_image, h.back_image),
        back_audio = coalesce(excluded.back_audio, h.back_audio)
      returning h.id, (xmax = 0) into v_owner, v_created;
      if v_created and v_suspended then
        update public.fichas set status = 'conhecido' where id = v_owner;
      end if;
      return query
        select v_note ->> 'guid', f.id, f.kind, f.ord, f.created_at,
          f.reps = 0 and not exists (select 1 from public.review_logs l where l.flashcard_id = f.id)
        from public.flashcards f where f.ficha_id = v_owner;

    else
      raise exception 'bad_request';
    end if;
  end loop;
end;
$$;

-- ---------- Sync: revisão de ficha, teimosa, ops novas ----------

alter table public.sync_ops drop constraint sync_ops_type_check;
alter table public.sync_ops add constraint sync_ops_type_check
  check (type in ('save', 'review', 'seen', 'extraNew', 'deckImport'));

-- O aparelho revisa o Reconhecer e os flashcards de ficha que o snapshot leva.
create or replace function public.api_sync_review_target(p_token text, p_client_id uuid, p_flashcard_id uuid, p_save_client_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_type text;
  v_result jsonb;
  v_item uuid;
  v_card public.flashcards;
  v_deleted timestamptz;
  v_sense text;
  v_outcome jsonb;
begin
  if v_user is null then raise exception 'invalid_token'; end if;

  select o.type, o.result into v_type, v_result from public.sync_ops o
    where o.user_id = v_user and o.client_id = p_client_id;
  if found then
    if v_type <> 'review' then
      return public.sync_prior(jsonb_build_object('status', 'rejected', 'reason', 'client_id_conflict'));
    end if;
    return public.sync_prior(v_result);
  end if;

  if p_flashcard_id is not null then
    select c.* into v_card from public.flashcards c where c.id = p_flashcard_id and c.user_id = v_user;
  else
    select e.item_id into v_item from public.encounters e
      where e.user_id = v_user and e.client_id = p_save_client_id;
    if v_item is not null then
      select c.* into v_card from public.flashcards c where c.item_id = v_item and c.kind = 'reconhecer';
    end if;
  end if;

  if v_card.id is null then
    v_outcome := jsonb_build_object('status', 'dropped', 'reason', 'unknown_target');
  else
    if v_card.item_id is not null then
      select i.deleted_at, i.sense into v_deleted, v_sense from public.items i where i.id = v_card.item_id;
    else
      select h.deleted_at into v_deleted from public.fichas h where h.id = v_card.ficha_id;
    end if;
    if v_deleted is not null then
      v_outcome := jsonb_build_object('status', 'dropped', 'reason', 'item_deleted');
    elsif v_card.kind = 'produzir' then
      v_outcome := jsonb_build_object('status', 'rejected', 'reason', 'invalid',
        'errors', jsonb_build_object('flashcardId', 'o aparelho não revisa o Produzir'));
    end if;
  end if;

  if v_outcome is not null then
    v_result := public.sync_claim(v_user, p_client_id, 'review');
    if v_result is not null then return public.sync_prior(v_result); end if;
    return public.sync_finish(v_user, p_client_id, v_outcome);
  end if;

  return jsonb_build_object(
    'flashcard', to_jsonb(v_card),
    'sense', v_sense,
    'desired_retention', (select s.desired_retention from public.user_settings s where s.user_id = v_user),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('rating', l.rating, 'reviewed_at', l.reviewed_at)
        order by l.reviewed_at, l.received_at)
      from public.review_logs l where l.flashcard_id = v_card.id), '[]')
  );
end;
$$;

create or replace function public.api_sync_review(
  p_token text, p_client_id uuid, p_flashcard_id uuid, p_expected_reps integer, p_rating smallint,
  p_reviewed_at timestamptz, p_duration_ms integer, p_next jsonb, p_unlock_produce boolean, p_result jsonb
) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_prior jsonb;
  v_card public.flashcards;
  v_next public.flashcards;
  v_deleted timestamptz;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, 'review');
  if v_prior is not null then return public.sync_prior(v_prior); end if;

  select c.* into v_card from public.flashcards c where c.id = p_flashcard_id and c.user_id = v_user for update;
  if not found then
    return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'dropped', 'reason', 'unknown_target'));
  end if;
  select coalesce(i.deleted_at, h.deleted_at) into v_deleted
    from public.flashcards f
    left join public.items i on i.id = f.item_id
    left join public.fichas h on h.id = f.ficha_id
    where f.id = v_card.id;
  if v_deleted is not null then
    return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'dropped', 'reason', 'item_deleted'));
  end if;
  if v_card.reps <> p_expected_reps then raise exception 'flashcard_stale'; end if;

  v_next := jsonb_populate_record(v_card, p_next);

  insert into public.review_logs (flashcard_id, user_id, rating, reviewed_at, client_id, duration_ms,
    state_before, last_interval_days, interval_days)
  values (v_card.id, v_user, p_rating, least(p_reviewed_at, now()), p_client_id, p_duration_ms,
    v_card.state, v_card.scheduled_days, v_next.scheduled_days);

  update public.flashcards set
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

  if p_unlock_produce and v_card.kind = 'reconhecer' then
    insert into public.flashcards (item_id, user_id, kind)
    values (v_card.item_id, v_user, 'produzir')
    on conflict (item_id, kind) do nothing;
  end if;

  perform public.apply_leech(v_user, v_card, v_next.lapses);
  return public.sync_finish(v_user, p_client_id, p_result);
end;
$$;

-- "+N hoje" vindo do leitor; o dia é o de p_at no relógio do usuário.
create function public.api_sync_extra_new(p_token text, p_client_id uuid, p_language text, p_n integer, p_at timestamptz)
  returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_prior jsonb;
  v_settings public.user_settings;
  v_day_start timestamptz;
  v_n integer;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, 'extraNew');
  if v_prior is not null then return public.sync_prior(v_prior); end if;
  select * into v_settings from public.user_settings s where s.user_id = v_user;
  v_day_start := public.review_day_start(v_settings.time_zone, v_settings.day_start_hour, least(p_at, now()));
  v_n := public.add_extra_new_for(v_user, p_language::public.language_code,
    public.review_day_key(v_user, v_day_start), p_n);
  return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'applied', 'extraNew', v_n));
end;
$$;

-- CSV do leitor vira deck (ordem do deck). p_rows: [{front, back}] já em HTML seguro.
-- Mesmo hash do mesmo usuário devolve o deck que já existe.
create function public.api_sync_deck_import(
  p_token text, p_client_id uuid, p_language text, p_name text, p_hash text, p_rows jsonb
) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_lang public.language_code := p_language::public.language_code;
  v_prior jsonb;
  v_deck uuid;
  v_name text := left(btrim(p_name), 80);
  v_try text;
  v_i integer := 1;
  v_count integer;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, 'deckImport');
  if v_prior is not null then return public.sync_prior(v_prior); end if;

  select d.id into v_deck from public.decks d where d.user_id = v_user and d.import_hash = p_hash;
  if v_deck is not null then
    return public.sync_finish(v_user, p_client_id,
      jsonb_build_object('status', 'applied', 'deckId', v_deck, 'created', false, 'fichas', 0));
  end if;

  -- Nome ocupado ganha " (2)", " (3)"...
  v_try := v_name;
  while exists (select 1 from public.decks d where d.user_id = v_user and d.language = v_lang
      and d.parent_id is null and lower(d.name) = lower(v_try)) loop
    v_i := v_i + 1;
    v_try := left(v_name, 80 - char_length(' (' || v_i || ')')) || ' (' || v_i || ')';
  end loop;

  insert into public.decks (user_id, language, name, new_order, import_hash, position)
  values (v_user, v_lang, v_try, 'deck', p_hash,
    coalesce((select max(d.position) + 1 from public.decks d where d.user_id = v_user and d.language = v_lang), 0))
  returning id into v_deck;

  -- created_at crescente guarda a ordem do arquivo.
  insert into public.fichas (user_id, language, deck_id, front, back, created_at)
  select v_user, v_lang, v_deck, r.value ->> 'front', coalesce(r.value ->> 'back', ''),
    now() + (r.ordinality * interval '1 millisecond')
  from jsonb_array_elements(p_rows) with ordinality r;
  get diagnostics v_count = row_count;

  return public.sync_finish(v_user, p_client_id,
    jsonb_build_object('status', 'applied', 'deckId', v_deck, 'created', true, 'fichas', v_count));
end;
$$;

revoke all on function public.api_sync_extra_new(text, uuid, text, integer, timestamptz) from public;
revoke all on function public.api_sync_deck_import(text, uuid, text, text, text, jsonb) from public;
grant execute on function public.api_sync_extra_new(text, uuid, text, integer, timestamptz) to anon, authenticated;
grant execute on function public.api_sync_deck_import(text, uuid, text, text, text, jsonb) to anon, authenticated;

-- ---------- Sync: snapshot com decks, fila e fichas ----------

-- p_kind 'item' pagina os itens; 'ficha' as fichas (HTML; o app passa para texto). Todo
-- pedido leva o estado da fila (queue) para o app numerar as novas.
drop function public.api_sync_snapshot(text, text, uuid, integer, timestamptz);
create function public.api_sync_snapshot(
  p_token text, p_language text, p_kind text, p_after uuid, p_limit integer, p_day_start timestamptz default null
) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v record;
  v_lang public.language_code := p_language::public.language_code;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_rows jsonb;
  v_count integer;
  v_settings public.user_settings;
  v_day_start timestamptz;
begin
  if p_kind not in ('item', 'ficha') then raise exception 'bad_request'; end if;
  select * into v from public.sync_token_begin(p_token);
  if v.user_id is null then raise exception 'invalid_token'; end if;
  if v.retry_after is not null then return jsonb_build_object('rateLimited', v.retry_after); end if;

  -- p_day_start nulo: o servidor usa o relógio do usuário.
  select * into v_settings from public.user_settings s where s.user_id = v.user_id;
  v_day_start := coalesce(p_day_start,
    public.review_day_start(v_settings.time_zone, coalesce(v_settings.day_start_hour, 4)));

  if p_kind = 'item' then
    with page as (
      select i.* from public.items i
      where i.user_id = v.user_id and i.language = v_lang and i.deleted_at is null
        and (p_after is null or i.id > p_after)
      order by i.id
      limit v_limit + 1
    )
    select count(*)::integer, coalesce(jsonb_agg(line order by row_id) filter (where rn <= v_limit), '[]')
    into v_count, v_rows
    from (
      select p.id as row_id, row_number() over (order by p.id) as rn,
        jsonb_build_object(
          'id', p.id,
          'lemma', p.lemma,
          'lemma_key', p.lemma_key,
          'language', p.language,
          'deck_id', p.deck_id,
          'leech_hold', p.leech_hold,
          'reading', p.reading,
          'sense', p.sense,
          'note', left(p.note, 200),
          'ipa', p.ipa,
          'pos', p.part_of_speech,
          'status', p.status,
          'seen_count', p.seen_count,
          'last_seen_at', p.last_seen_at,
          'created_at', p.created_at,
          'updated_at', greatest(
            p.updated_at,
            (select max(e.created_at) from public.encounters e where e.item_id = p.id),
            (select max(l.received_at) from public.review_logs l where l.flashcard_id = c.id),
            (select max(l.received_at) from public.review_logs l
              join public.flashcards s on s.id = l.flashcard_id where s.item_id = p.id and s.id <> c.id)
          ),
          'forms', coalesce((select jsonb_agg(f.form order by f.form) from (
              select distinct e.form from public.encounters e
              where e.item_id = p.id and e.deleted_at is null and e.form <> '' and e.form <> p.lemma
              order by 1 limit 20
            ) f), '[]'),
          'encounters', coalesce((select jsonb_agg(jsonb_build_object(
              'form', e.form, 'sentence', e.sentence, 'sense', e.sense, 'work', w.title, 'at', e.seen_at
            ) order by e.seen_at desc) from (
              select * from public.encounters e2
              where e2.item_id = p.id and e2.deleted_at is null
              order by e2.seen_at desc limit 2
            ) e left join public.works w on w.id = e.work_id and w.deleted_at is null), '[]'),
          'flashcard', to_jsonb(c),
          -- Última revisão do Produzir: o aparelho oculta o Reconhecer no mesmo dia.
          'sibling_reviewed_at', (
            select max(s.last_review_at) from public.flashcards s where s.item_id = p.id and s.id <> c.id
          )
        ) as line
      from page p
      join public.flashcards c on c.item_id = p.id and c.kind = 'reconhecer'
    ) rows;
  else
    with page as (
      select h.* from public.fichas h
      where h.user_id = v.user_id and h.language = v_lang and h.deleted_at is null
        and (p_after is null or h.id > p_after)
      order by h.id
      limit v_limit + 1
    )
    select count(*)::integer, coalesce(jsonb_agg(line order by row_id) filter (where rn <= v_limit), '[]')
    into v_count, v_rows
    from (
      select p.id as row_id, row_number() over (order by p.id) as rn,
        jsonb_build_object(
          'id', p.id,
          'language', p.language,
          'deck_id', p.deck_id,
          'leech_hold', p.leech_hold,
          'front', p.front,
          'back', p.back,
          'status', p.status,
          'created_at', p.created_at,
          'updated_at', greatest(
            p.updated_at,
            (select max(l.received_at) from public.review_logs l
              join public.flashcards s on s.id = l.flashcard_id where s.ficha_id = p.id)
          ),
          'flashcard', to_jsonb(c)
        ) as line
      from page p
      -- Um flashcard por ficha no aparelho: frente, ou a primeira lacuna.
      join lateral (
        select f.* from public.flashcards f
        where f.ficha_id = p.id and f.kind in ('frente', 'lacuna')
        order by f.ord limit 1
      ) c on true
    ) rows;
  end if;

  return jsonb_build_object(
    'account', jsonb_build_object(
      'ui_language', v_settings.ui_language,
      'native_language', v_settings.native_language,
      'study_languages', to_jsonb(v_settings.study_languages::text[]),
      'new_flashcards_per_day', v_settings.new_flashcards_per_day,
      'new_order', v_settings.new_order,
      'leech_lapses', v_settings.leech_lapses,
      'leech_action', v_settings.leech_action,
      'time_zone', v_settings.time_zone,
      'day_start_hour', v_settings.day_start_hour,
      'desired_retention', v_settings.desired_retention
    ),
    'dayStart', v_day_start,
    'total', (
      select count(*) from public.items i
      where i.user_id = v.user_id and i.language = v_lang and i.deleted_at is null
    ),
    'fichasTotal', (
      select count(*) from public.fichas h
      where h.user_id = v.user_id and h.language = v_lang and h.deleted_at is null
    ),
    'queue', public.queue_state_for(v.user_id, v_lang, v_day_start),
    'rows', v_rows,
    'more', v_count > v_limit
  );
end;
$$;
revoke all on function public.api_sync_snapshot(text, text, text, uuid, integer, timestamptz) from public;
grant execute on function public.api_sync_snapshot(text, text, text, uuid, integer, timestamptz) to anon, authenticated;
