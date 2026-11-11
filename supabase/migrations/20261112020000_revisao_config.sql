-- Configurações da revisão que vieram do Anki, mais o que as estatísticas precisam.
--
-- - Relógio do dia: fuso do usuário (time_zone, nulo = America/Sao_Paulo) e a hora em que o
--   dia vira (day_start_hour, 4 h como no Anki). Define o limite de novos, o "vence hoje" e
--   os dias das estatísticas. review_day_start é a mesma conta de dayStart em review.ts.
-- - Retenção desejada do FSRS (desired_retention). Vale a partir da próxima revisão.
-- - Ocultar irmãos: o Reconhecer e o Produzir do mesmo item não caem no mesmo dia. Um cartão
--   em revisão (ou novo) cujo irmão foi revisado hoje fica para amanhã; aprendendo e
--   reaprendendo não esperam. review_counts conta um cartão em revisão por item.
-- - review_logs guarda o estado antes, os intervalos e a duração, como o revlog do Anki.
--   Logs antigos ficam nulos; as estatísticas reaplicam o cartão para esses.

-- ---------- Configurações ----------

alter table public.user_settings
  add column time_zone text,
  add column day_start_hour smallint not null default 4 check (day_start_hour between 0 and 23),
  add column desired_retention real not null default 0.9
    check (desired_retention between 0.7 and 0.97);

grant update (time_zone, day_start_hour, desired_retention) on public.user_settings to authenticated;

-- Fuso inválido quebraria toda conta de dia: recusa na escrita.
create function public.check_time_zone() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.time_zone is not null then
    perform now() at time zone new.time_zone;
  end if;
  return new;
exception when others then
  raise exception 'invalid_time_zone' using errcode = '22023';
end;
$$;
revoke all on function public.check_time_zone() from public, anon, authenticated;

create trigger user_settings_time_zone before insert or update of time_zone on public.user_settings
  for each row execute function public.check_time_zone();

-- Último instante <= p_now em que o relógio do fuso marcou p_hour:00.
create function public.review_day_start(p_time_zone text, p_hour integer, p_now timestamptz default now())
  returns timestamptz
  language sql stable set search_path = '' as $$
  with z as (select coalesce(p_time_zone, 'America/Sao_Paulo') as tz),
  d as (
    select tz, date_trunc('day', p_now at time zone tz) + make_interval(hours => p_hour) as wall from z
  )
  select case
    when (wall at time zone tz) <= p_now then wall at time zone tz
    else (wall - interval '1 day') at time zone tz
  end from d;
$$;
revoke all on function public.review_day_start(text, integer, timestamptz) from public, anon;
grant execute on function public.review_day_start(text, integer, timestamptz) to authenticated;

-- ---------- Log de revisões ----------

alter table public.review_logs
  -- state do cartão antes da revisão (0 novo, 1 aprendendo, 2 revisão, 3 reaprendendo).
  add column state_before smallint check (state_before between 0 and 3),
  -- scheduled_days antes e depois (o lastIvl e o ivl do Anki), em dias.
  add column last_interval_days integer,
  add column interval_days integer;


-- ---------- Contagens com irmãos ocultos ----------

drop function public.review_counts(timestamptz);

-- p_day_start vem do app, que já leu o relógio do usuário. p_language filtra vencidos e
-- novos disponíveis; novos feitos hoje e o limite são da conta toda.
create function public.review_counts(p_day_start timestamptz, p_language text default null)
  returns table (due_now integer, new_available integer, new_done_today integer, new_limit integer, next_due_at timestamptz)
  language sql stable security invoker set search_path = '' as $$
  with active as (
    select c.*,
      c.state in (0, 2) and exists (
        select 1 from public.cards s
        where s.item_id = c.item_id and s.id <> c.id and s.last_review_at >= p_day_start
      ) as buried
    from public.cards c
    join public.items i on i.id = c.item_id
    where c.user_id = (select auth.uid()) and i.status = 'ativo' and i.deleted_at is null
      and (p_language is null or i.language = p_language)
  )
  select
    (select count(*)::integer from active where state in (1, 3) and due_at <= now())
      + (select count(distinct item_id)::integer from active
          where state = 2 and due_at <= now() and not buried),
    (select count(*)::integer from active where state = 0 and not buried),
    (select count(distinct l.card_id)::integer from public.review_logs l
      where l.user_id = (select auth.uid()) and l.reviewed_at >= p_day_start
        and not exists (
          select 1 from public.review_logs p where p.card_id = l.card_id and p.reviewed_at < p_day_start
        )),
    (select s.new_cards_per_day from public.user_settings s where s.user_id = (select auth.uid())),
    (select min(due_at) from active where state > 0 and due_at > now());
$$;

revoke all on function public.review_counts(timestamptz, text) from public, anon;
grant execute on function public.review_counts(timestamptz, text) to authenticated;

-- ---------- Gravar revisão com o estado antes e a duração ----------

drop function public.record_review(uuid, integer, smallint, timestamptz, jsonb, boolean, uuid);

create function public.record_review(
  p_card_id uuid,
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
  v_card public.cards;
  v_next public.cards;
  v_log uuid;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_client_id is not null then
    select l.id into v_log from public.review_logs l where l.user_id = v_user and l.client_id = p_client_id;
    if found then return v_log; end if;
  end if;

  select c.* into v_card from public.cards c
    join public.items i on i.id = c.item_id
    where c.id = p_card_id and c.user_id = v_user and i.deleted_at is null
    for update of c;
  if not found then raise exception 'card_not_found'; end if;
  if v_card.reps <> p_expected_reps then raise exception 'card_stale'; end if;

  v_next := jsonb_populate_record(v_card, p_next);

  insert into public.review_logs (card_id, user_id, rating, reviewed_at, client_id, duration_ms,
    state_before, last_interval_days, interval_days)
  values (v_card.id, v_user, p_rating, least(p_reviewed_at, now()), p_client_id,
    least(greatest(p_duration_ms, 0), 600000),
    v_card.state, v_card.scheduled_days, v_next.scheduled_days)
  returning id into v_log;

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

  if p_unlock_produce and v_card.kind = 'reconhecer' then
    insert into public.cards (item_id, user_id, kind)
    values (v_card.item_id, v_user, 'produzir')
    on conflict (item_id, kind) do nothing;
  end if;

  return v_log;
end;
$$;

revoke all on function public.record_review(uuid, integer, smallint, timestamptz, jsonb, boolean, uuid, integer) from public, anon;
grant execute on function public.record_review(uuid, integer, smallint, timestamptz, jsonb, boolean, uuid, integer) to authenticated;

-- ---------- Sync: retenção do usuário e log completo ----------

create or replace function public.api_sync_review_target(p_token text, p_client_id uuid, p_card_id uuid, p_save_client_id uuid)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_type text;
  v_result jsonb;
  v_item uuid;
  v_card public.cards;
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

  if p_card_id is not null then
    select c.* into v_card from public.cards c where c.id = p_card_id and c.user_id = v_user;
  else
    select e.item_id into v_item from public.encounters e
      where e.user_id = v_user and e.client_id = p_save_client_id;
    if v_item is not null then
      select c.* into v_card from public.cards c where c.item_id = v_item and c.kind = 'reconhecer';
    end if;
  end if;

  if v_card.id is null then
    v_outcome := jsonb_build_object('status', 'dropped', 'reason', 'unknown_target');
  else
    select i.deleted_at, i.sense into v_deleted, v_sense from public.items i where i.id = v_card.item_id;
    if v_deleted is not null then
      v_outcome := jsonb_build_object('status', 'dropped', 'reason', 'item_deleted');
    elsif v_card.kind <> 'reconhecer' then
      v_outcome := jsonb_build_object('status', 'rejected', 'reason', 'invalid',
        'errors', jsonb_build_object('cardId', 'o aparelho só revisa o Reconhecer'));
    end if;
  end if;

  if v_outcome is not null then
    v_result := public.sync_claim(v_user, p_client_id, 'review');
    if v_result is not null then return public.sync_prior(v_result); end if;
    return public.sync_finish(v_user, p_client_id, v_outcome);
  end if;

  return jsonb_build_object(
    'card', to_jsonb(v_card),
    'sense', v_sense,
    'desired_retention', (select s.desired_retention from public.user_settings s where s.user_id = v_user),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('rating', l.rating, 'reviewed_at', l.reviewed_at)
        order by l.reviewed_at, l.received_at)
      from public.review_logs l where l.card_id = v_card.id), '[]')
  );
end;
$$;

create or replace function public.api_sync_review(
  p_token text,
  p_client_id uuid,
  p_card_id uuid,
  p_expected_reps integer,
  p_rating smallint,
  p_reviewed_at timestamptz,
  p_duration_ms integer,
  p_next jsonb,
  p_unlock_produce boolean,
  p_result jsonb
) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_prior jsonb;
  v_card public.cards;
  v_next public.cards;
  v_deleted timestamptz;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, 'review');
  if v_prior is not null then return public.sync_prior(v_prior); end if;

  select c.* into v_card from public.cards c where c.id = p_card_id and c.user_id = v_user for update;
  if not found then
    return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'dropped', 'reason', 'unknown_target'));
  end if;
  select i.deleted_at into v_deleted from public.items i where i.id = v_card.item_id;
  if v_deleted is not null then
    return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'dropped', 'reason', 'item_deleted'));
  end if;
  if v_card.reps <> p_expected_reps then raise exception 'card_stale'; end if;

  v_next := jsonb_populate_record(v_card, p_next);

  insert into public.review_logs (card_id, user_id, rating, reviewed_at, client_id, duration_ms,
    state_before, last_interval_days, interval_days)
  values (v_card.id, v_user, p_rating, least(p_reviewed_at, now()), p_client_id, p_duration_ms,
    v_card.state, v_card.scheduled_days, v_next.scheduled_days);

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

  if p_unlock_produce and v_card.kind = 'reconhecer' then
    insert into public.cards (item_id, user_id, kind)
    values (v_card.item_id, v_user, 'produzir')
    on conflict (item_id, kind) do nothing;
  end if;

  return public.sync_finish(v_user, p_client_id, p_result);
end;
$$;

-- ---------- Snapshot: relógio do usuário ----------

-- p_day_start nulo: o servidor usa o relógio do usuário. A conta leva o relógio e a retenção;
-- dayStart é o início do dia que valeu para newDoneToday. Cada item leva sibling_reviewed_at
-- (última revisão do Produzir), para o aparelho ocultar o Reconhecer no mesmo dia.
drop function public.api_sync_snapshot(text, text, uuid, integer, timestamptz);

create function public.api_sync_snapshot(
  p_token text,
  p_language text,
  p_after uuid,
  p_limit integer,
  p_day_start timestamptz default null
) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  v_lang public.language_code := p_language::public.language_code;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_items jsonb;
  v_count integer;
  v_settings public.user_settings;
  v_day_start timestamptz;
begin
  select * into v from public.sync_token_begin(p_token);
  if v.user_id is null then raise exception 'invalid_token'; end if;
  if v.retry_after is not null then return jsonb_build_object('rateLimited', v.retry_after); end if;

  select * into v_settings from public.user_settings s where s.user_id = v.user_id;
  v_day_start := coalesce(p_day_start,
    public.review_day_start(v_settings.time_zone, coalesce(v_settings.day_start_hour, 4)));

  with page as (
    select i.* from public.items i
    where i.user_id = v.user_id and i.language = v_lang and i.deleted_at is null
      and (p_after is null or i.id > p_after)
    order by i.id
    limit v_limit + 1
  )
  select count(*)::integer, coalesce(jsonb_agg(line order by row_id) filter (where rn <= v_limit), '[]')
  into v_count, v_items
  from (
    select p.id as row_id, row_number() over (order by p.id) as rn,
      jsonb_build_object(
        'id', p.id,
        'lemma', p.lemma,
        'lemma_key', p.lemma_key,
        'language', p.language,
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
          (select max(l.received_at) from public.review_logs l where l.card_id = c.id),
          (select max(l.received_at) from public.review_logs l
            join public.cards s on s.id = l.card_id where s.item_id = p.id and s.id <> c.id)
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
        'card', to_jsonb(c),
        'sibling_reviewed_at', (
          select max(s.last_review_at) from public.cards s where s.item_id = p.id and s.id <> c.id
        )
      ) as line
    from page p
    join public.cards c on c.item_id = p.id and c.kind = 'reconhecer'
  ) rows;

  return jsonb_build_object(
    'account', jsonb_build_object(
      'ui_language', v_settings.ui_language,
      'native_language', v_settings.native_language,
      'study_languages', to_jsonb(v_settings.study_languages::text[]),
      'new_cards_per_day', v_settings.new_cards_per_day,
      'time_zone', v_settings.time_zone,
      'day_start_hour', v_settings.day_start_hour,
      'desired_retention', v_settings.desired_retention
    ),
    'dayStart', v_day_start,
    'total', (
      select count(*) from public.items i
      where i.user_id = v.user_id and i.language = v_lang and i.deleted_at is null
    ),
    -- Mesma conta de review_counts: cartões cuja primeira revisão é de hoje (em qualquer idioma).
    'newDoneToday', (
      select count(distinct l.card_id) from public.review_logs l
      where l.user_id = v.user_id and l.reviewed_at >= v_day_start
        and not exists (
          select 1 from public.review_logs pl where pl.card_id = l.card_id and pl.reviewed_at < v_day_start
        )
    ),
    'items', v_items,
    'more', v_count > v_limit
  );
end;
$$;

revoke all on function public.api_sync_snapshot(text, text, uuid, integer, timestamptz) from public;
grant execute on function public.api_sync_snapshot(text, text, uuid, integer, timestamptz) to anon, authenticated;
