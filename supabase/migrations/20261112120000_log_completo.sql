-- O log de revisões vira matéria-prima para trocar o algoritmo:
-- - Cada revisão guarda o estado de memória do cartão antes dela, a retenção desejada e a
--   versão do agendador. Sem isso, só o replay com os mesmos parâmetros reproduz o passado.
-- - Desfazer não perde mais o dado: a linha vai para review_logs_undone.

-- ---------- Estado de memória antes da revisão ----------

alter table public.review_logs
  add column stability_before real,
  add column stability_fast_before real,
  add column difficulty_before real,
  -- Retenção desejada da conta na hora da revisão.
  add column desired_retention real,
  -- Qual agendador calculou o intervalo (ver review_algo_version).
  add column algo_version text;

-- Muda junto com o agendador em apps/web/src/lib/server/scheduler.ts (versão do ts-fsrs,
-- família do FSRS e parâmetros).
create function public.review_algo_version() returns text
  language sql immutable set search_path = '' as $$
  select 'ts-fsrs@6.0.0 fsrs7 default fuzz'
$$;

-- Roda antes de record_review e api_sync_review atualizarem o cartão, então lê o estado
-- anterior. Só preenche o que o chamador não mandou.
create function public.review_logs_snapshot() returns trigger
  language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.flashcards;
begin
  select * into c from public.flashcards where id = new.flashcard_id and user_id = new.user_id;
  new.stability_before := coalesce(new.stability_before, c.stability);
  new.stability_fast_before := coalesce(new.stability_fast_before, c.stability_fast);
  new.difficulty_before := coalesce(new.difficulty_before, c.difficulty);
  new.desired_retention := coalesce(new.desired_retention,
    (select s.desired_retention from public.user_settings s where s.user_id = new.user_id));
  new.algo_version := coalesce(new.algo_version, public.review_algo_version());
  return new;
end;
$$;

revoke all on function public.review_logs_snapshot() from public, anon, authenticated;

create trigger review_logs_snapshot before insert on public.review_logs
  for each row execute function public.review_logs_snapshot();

-- ---------- Desfazer guarda a revisão ----------

create table public.review_logs_undone (
  like public.review_logs including defaults,
  undone_at timestamptz not null default now()
);

alter table public.review_logs_undone
  add primary key (id),
  add foreign key (flashcard_id, user_id) references public.flashcards (id, user_id) on delete cascade;

create index review_logs_undone_flashcard_idx on public.review_logs_undone (flashcard_id, reviewed_at);

alter table public.review_logs_undone enable row level security;
revoke all on public.review_logs_undone from anon, authenticated;
grant select on public.review_logs_undone to authenticated;

create policy "dono lê as revisões desfeitas" on public.review_logs_undone
  for select to authenticated using ((select auth.uid()) = user_id);


-- Igual ao undo_review anterior, mas arquiva o log em vez de só apagar.
create or replace function public.undo_review(
  p_log_id uuid,
  p_expected_reps integer,
  p_next jsonb,
  p_drop_produce boolean
) returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_log public.review_logs;
  v_card public.flashcards;
  v_next public.flashcards;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_log from public.review_logs where id = p_log_id and user_id = v_user;
  if not found then raise exception 'log_not_found'; end if;

  select * into v_card from public.flashcards where id = v_log.flashcard_id for update;
  if v_card.reps <> p_expected_reps then raise exception 'flashcard_stale'; end if;

  insert into public.review_logs_undone select v_log.*, now();
  delete from public.review_logs where id = v_log.id;

  v_next := jsonb_populate_record(v_card, p_next);
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

  if p_drop_produce and v_card.kind = 'reconhecer' then
    delete from public.flashcards f
      where f.item_id = v_card.item_id and f.kind = 'produzir'
        and not exists (select 1 from public.review_logs l where l.flashcard_id = f.id);
  end if;

  return v_card.id;
end;
$$;
