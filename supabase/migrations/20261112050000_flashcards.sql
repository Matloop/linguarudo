-- Flashcards, fichas e tags (ADR 0003).
--
--   1. Cartão vira Flashcard: cards → flashcards, review_logs.card_id → flashcard_id,
--      user_settings.new_cards_per_day → new_flashcards_per_day, erros card_* → flashcard_*.
--      Os nomes JSON da API v1 mudam junto (flashcardId, flashcard, flashcards).
--   2. Ficha: conteúdo livre de frente e verso que não é item. Gera o flashcard 'frente',
--      mais o 'inverso' se marcado; ficha com lacunas (cloze_count > 0) gera um 'lacuna'
--      por lacuna (ord 1..n) e nenhum frente/inverso.
--   3. Tags: text[] no item e na ficha. Decks do Anki chegam como "Deck::Sub".
--
-- Funções que citam a tabela são recriadas aqui com o nome novo (o corpo plpgsql não
-- acompanha o rename).

-- ---------- Rename ----------

alter table public.cards rename to flashcards;
alter table public.flashcards rename constraint cards_pkey to flashcards_pkey;
alter table public.flashcards rename constraint cards_id_user_id_key to flashcards_id_user_id_key;
alter table public.flashcards rename constraint cards_item_id_kind_key to flashcards_item_id_kind_key;
alter table public.flashcards rename constraint cards_item_id_user_id_fkey to flashcards_item_id_user_id_fkey;
alter table public.flashcards rename constraint cards_state_check to flashcards_state_check;
alter table public.flashcards rename constraint cards_user_id_fkey to flashcards_user_id_fkey;
alter index public.cards_user_due_idx rename to flashcards_user_due_idx;
alter index public.cards_user_new_idx rename to flashcards_user_new_idx;
alter policy "dono lê os próprios cartões" on public.flashcards rename to "dono lê os próprios flashcards";

alter table public.review_logs rename column card_id to flashcard_id;
alter table public.review_logs rename constraint review_logs_card_id_user_id_fkey to review_logs_flashcard_id_user_id_fkey;
alter index public.review_logs_card_time_idx rename to review_logs_flashcard_time_idx;

alter table public.user_settings rename column new_cards_per_day to new_flashcards_per_day;
alter table public.user_settings rename constraint user_settings_new_cards_per_day_check to user_settings_new_flashcards_per_day_check;

drop trigger items_create_card on public.items;
drop function public.create_recognize_card();

-- ---------- Tags ----------

-- Até 50 tags de até 100 caracteres, sem espaço nas pontas e sem vazias.
create function public.valid_tags(p_tags text[]) returns boolean
  language sql immutable set search_path = '' as $$
  select cardinality(p_tags) <= 50 and not exists (
    select 1 from unnest(p_tags) t
    where t is null or t = '' or t <> btrim(t) or char_length(t) > 100
  );
$$;

alter table public.items add column tags text[] not null default '{}' check (public.valid_tags(tags));
create index items_tags_idx on public.items using gin (tags) where deleted_at is null;
grant update (tags) on public.items to authenticated;

-- ---------- Fichas ----------

create table public.fichas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  language public.language_code not null,
  -- HTML sanitizado no app (b, i, br, e o que o import do Anki deixar passar).
  front text not null check (char_length(front) between 1 and 8000),
  back text not null default '' check (char_length(back) <= 8000),
  -- Gera também o flashcard verso → frente.
  reverse boolean not null default false,
  -- Ficha de lacunas do Anki: um flashcard por lacuna, ord 1..cloze_count.
  cloze_count smallint not null default 0 check (cloze_count between 0 and 50),
  tags text[] not null default '{}' check (public.valid_tags(tags)),
  status text not null default 'ativo' check (status in ('ativo', 'conhecido')),
  -- GUID da nota no Anki: reimportar o mesmo pacote atualiza em vez de duplicar.
  anki_guid text check (char_length(anki_guid) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  check (cloze_count = 0 or not reverse)
);

create unique index fichas_anki_guid_key on public.fichas (user_id, anki_guid)
  where anki_guid is not null and deleted_at is null;
create index fichas_user_created_idx on public.fichas (user_id, created_at desc) where deleted_at is null;
create index fichas_tags_idx on public.fichas using gin (tags) where deleted_at is null;

create trigger fichas_touch before update on public.fichas
  for each row execute function public.touch_updated_at();

alter table public.fichas enable row level security;
revoke all on public.fichas from anon, authenticated;
grant select on public.fichas to authenticated;
grant insert (user_id, language, front, back, reverse, tags) on public.fichas to authenticated;
grant update (language, front, back, reverse, tags, status, deleted_at) on public.fichas to authenticated;

create policy "dono lê as próprias fichas" on public.fichas
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria fichas" on public.fichas
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono edita as próprias fichas" on public.fichas
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- Flashcards de item ou de ficha ----------

alter table public.flashcards alter column item_id drop not null;
alter table public.flashcards add column ficha_id uuid;
alter table public.flashcards add column ord smallint not null default 0 check (ord between 0 and 50);
alter table public.flashcards drop constraint cards_kind_check;
alter table public.flashcards add constraint flashcards_kind_check check (
  (item_id is not null and ficha_id is null and kind in ('reconhecer', 'produzir') and ord = 0)
  or (ficha_id is not null and item_id is null and (
    (kind in ('frente', 'inverso') and ord = 0) or (kind = 'lacuna' and ord >= 1)
  ))
);
alter table public.flashcards add constraint flashcards_ficha_id_user_id_fkey
  foreign key (ficha_id, user_id) references public.fichas (id, user_id) on delete cascade;
-- (item_id, kind) continua único; com item_id nulo não conflita.
alter table public.flashcards add constraint flashcards_ficha_kind_ord_key unique (ficha_id, kind, ord);

-- O Reconhecer nasce com o item, venha de onde vier. O Produzir nasce em record_review.
create function public.create_recognize_flashcard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.flashcards (item_id, user_id, kind, due_at, created_at)
  values (new.id, new.user_id, 'reconhecer', new.created_at, new.created_at)
  on conflict (item_id, kind) do nothing;
  return new;
end;
$$;
revoke all on function public.create_recognize_flashcard() from public, anon, authenticated;

create trigger items_create_flashcard after insert on public.items
  for each row execute function public.create_recognize_flashcard();

-- Mantém os flashcards da ficha de acordo com reverse e cloze_count. Flashcard que sai
-- leva o log junto (o usuário desligou o inverso de propósito).
create function public.sync_ficha_flashcards() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.cloze_count > 0 then
    insert into public.flashcards (ficha_id, user_id, kind, ord, due_at, created_at)
    select new.id, new.user_id, 'lacuna', n, new.created_at, new.created_at
    from generate_series(1, new.cloze_count) n
    on conflict (ficha_id, kind, ord) do nothing;
    delete from public.flashcards f
      where f.ficha_id = new.id and (f.kind <> 'lacuna' or f.ord > new.cloze_count);
  else
    insert into public.flashcards (ficha_id, user_id, kind, due_at, created_at)
    values (new.id, new.user_id, 'frente', new.created_at, new.created_at)
    on conflict (ficha_id, kind, ord) do nothing;
    if new.reverse then
      insert into public.flashcards (ficha_id, user_id, kind)
      values (new.id, new.user_id, 'inverso')
      on conflict (ficha_id, kind, ord) do nothing;
    end if;
    delete from public.flashcards f
      where f.ficha_id = new.id and (f.kind = 'lacuna' or (f.kind = 'inverso' and not new.reverse));
  end if;
  return new;
end;
$$;
revoke all on function public.sync_ficha_flashcards() from public, anon, authenticated;

create trigger fichas_sync_flashcards after insert or update of reverse, cloze_count on public.fichas
  for each row execute function public.sync_ficha_flashcards();

-- ---------- Revisão ----------

-- Flashcards revisáveis: o dono (item ou ficha) está ativo e não foi apagado.
drop function public.review_counts(timestamptz);
create function public.review_counts(p_day_start timestamptz)
  returns table (due_now integer, new_available integer, new_done_today integer, new_limit integer, next_due_at timestamptz)
  language sql stable security invoker set search_path = '' as $$
  with active as (
    select f.* from public.flashcards f
    left join public.items i on i.id = f.item_id
    left join public.fichas h on h.id = f.ficha_id
    where f.user_id = (select auth.uid())
      and coalesce(i.status, h.status) = 'ativo'
      and coalesce(i.deleted_at, h.deleted_at) is null
  )
  select
    (select count(*)::integer from active where state > 0 and due_at <= now()),
    (select count(*)::integer from active where state = 0),
    (select count(distinct l.flashcard_id)::integer from public.review_logs l
      where l.user_id = (select auth.uid()) and l.reviewed_at >= p_day_start
        and not exists (
          select 1 from public.review_logs p where p.flashcard_id = l.flashcard_id and p.reviewed_at < p_day_start
        )),
    (select s.new_flashcards_per_day from public.user_settings s where s.user_id = (select auth.uid())),
    (select min(due_at) from active where state > 0 and due_at > now());
$$;

-- Grava uma revisão e o cronograma que o app calculou reaplicando o log.
-- p_expected_reps é o reps que o app leu: se outra revisão entrou no meio, o cálculo ficou
-- velho (flashcard_stale) e o app refaz. Revisão de item ou ficha apagada é descartada
-- (a exclusão vence). Mesmo client_id: devolve a revisão que já existe, sem gravar de novo.
drop function public.record_review(uuid, integer, smallint, timestamptz, jsonb, boolean, uuid);
create function public.record_review(
  p_flashcard_id uuid,
  p_expected_reps integer,
  p_rating smallint,
  p_reviewed_at timestamptz,
  p_next jsonb,
  p_unlock_produce boolean,
  p_client_id uuid default null
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

  insert into public.review_logs (flashcard_id, user_id, rating, reviewed_at, client_id)
  values (v_card.id, v_user, p_rating, least(p_reviewed_at, now()), p_client_id)
  returning id into v_log;

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

  if p_unlock_produce and v_card.kind = 'reconhecer' then
    insert into public.flashcards (item_id, user_id, kind)
    values (v_card.item_id, v_user, 'produzir')
    on conflict (item_id, kind) do nothing;
  end if;

  return v_log;
end;
$$;

-- Desfaz uma revisão: apaga o log e grava o cronograma reaplicado sem ela. Se o Produzir
-- deixou de valer e ainda não foi revisado, ele sai também.
drop function public.undo_review(uuid, integer, jsonb, boolean);
create function public.undo_review(
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

revoke all on function public.review_counts(timestamptz) from public, anon;
revoke all on function public.record_review(uuid, integer, smallint, timestamptz, jsonb, boolean, uuid) from public, anon;
revoke all on function public.undo_review(uuid, integer, jsonb, boolean) from public, anon;
grant execute on function public.review_counts(timestamptz) to authenticated;
grant execute on function public.record_review(uuid, integer, smallint, timestamptz, jsonb, boolean, uuid) to authenticated;
grant execute on function public.undo_review(uuid, integer, jsonb, boolean) to authenticated;

-- ---------- API v1 e sync: nomes novos ----------
-- Parâmetro renomeado e tipo de retorno novo pedem drop + create.

drop function public.api_sync_save(text, uuid, timestamptz, jsonb);
drop function public.save_items(jsonb);
drop function public.api_save_items(text, jsonb);
drop function public.save_items_for(uuid, jsonb);
drop function public.api_sync_review_target(text, uuid, uuid, uuid);
drop function public.api_sync_review(text, uuid, uuid, integer, smallint, timestamptz, integer, jsonb, boolean, jsonb);
drop function public.api_sync_snapshot(text, text, uuid, integer, timestamptz);
drop function public.api_items(text, text);

CREATE FUNCTION public.save_items_for(p_user uuid, p_items jsonb)
 RETURNS TABLE(item_id uuid, language text, lemma text, created boolean, encounter_id uuid, flashcard_state smallint, flashcard_due_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_in jsonb;
  v_enc jsonb;
  v_item uuid;
  v_created boolean;
  v_work uuid;
  v_encounter uuid;
  v_lang public.language_code;
  v_lemma text;
  v_key text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'bad_request';
  end if;

  for v_in in select value from jsonb_array_elements(p_items) loop
    v_lang := (v_in ->> 'language')::public.language_code;
    v_lemma := v_in ->> 'lemma';
    v_key := v_in ->> 'lemma_key';
    if coalesce(v_key, '') = '' then raise exception 'bad_request'; end if;
    v_enc := v_in -> 'encounter';
    v_encounter := null;

    insert into public.items (user_id, language, lemma, lemma_key, reading, sense, note, ipa, part_of_speech)
    values (
      p_user, v_lang, v_lemma, v_key, coalesce(v_in ->> 'reading', ''),
      coalesce(nullif(v_in ->> 'sense', ''), v_enc ->> 'sense', ''),
      coalesce(v_in ->> 'note', ''), coalesce(v_in ->> 'ipa', ''), coalesce(v_in ->> 'part_of_speech', '')
    )
    on conflict (user_id, language, lemma_key) where deleted_at is null do nothing
    returning id into v_item;
    v_created := v_item is not null;

    if not v_created then
      select i.id into v_item from public.items i
        where i.user_id = p_user and i.language = v_lang and i.lemma_key = v_key
          and i.deleted_at is null;
      -- O que o item ainda não tem vem da entrada; o que o usuário já escreveu fica.
      update public.items i set
        sense = case when i.sense = '' then coalesce(nullif(v_in ->> 'sense', ''), v_enc ->> 'sense', '') else i.sense end,
        note = case when i.note = '' then coalesce(v_in ->> 'note', '') else i.note end,
        ipa = case when i.ipa = '' then coalesce(v_in ->> 'ipa', '') else i.ipa end,
        reading = case when i.reading = '' then coalesce(v_in ->> 'reading', '') else i.reading end,
        part_of_speech = case when i.part_of_speech = '' then coalesce(v_in ->> 'part_of_speech', '') else i.part_of_speech end
      where i.id = v_item
        and ((i.sense = '' and coalesce(nullif(v_in ->> 'sense', ''), v_enc ->> 'sense', '') <> '')
          or (i.note = '' and coalesce(v_in ->> 'note', '') <> '')
          or (i.ipa = '' and coalesce(v_in ->> 'ipa', '') <> '')
          or (i.reading = '' and coalesce(v_in ->> 'reading', '') <> '')
          or (i.part_of_speech = '' and coalesce(v_in ->> 'part_of_speech', '') <> ''));
    end if;

    if v_enc is not null then
      v_work := case when v_in ? 'work' then public.work_for(p_user, v_in -> 'work') end;
      insert into public.encounters (
        user_id, item_id, work_id, form, sentence, highlight, sense, translation, position, origin, client_id, seen_at
      ) values (
        p_user, v_item, v_work,
        coalesce(v_enc ->> 'form', ''), coalesce(v_enc ->> 'sentence', ''),
        coalesce(v_enc ->> 'highlight', ''), coalesce(v_enc ->> 'sense', ''),
        coalesce(v_enc ->> 'translation', ''),
        coalesce(v_enc -> 'position', '{}'), v_enc ->> 'origin', (v_enc ->> 'client_id')::uuid,
        least(coalesce((v_enc ->> 'seen_at')::timestamptz, now()), now())
      )
      on conflict (user_id, client_id) do nothing
      returning id into v_encounter;
      if v_encounter is null then
        select e.id into v_encounter from public.encounters e
          where e.user_id = p_user and e.client_id = (v_enc ->> 'client_id')::uuid;
      end if;
    end if;

    return query
      select v_item, v_lang::text, i.lemma, v_created, v_encounter, c.state, c.due_at
      from public.items i
      join public.flashcards c on c.item_id = i.id and c.kind = 'reconhecer'
      where i.id = v_item;
  end loop;
end;
$function$;

create function public.save_items(p_items jsonb)
  returns table (item_id uuid, language text, lemma text, created boolean, encounter_id uuid, flashcard_state smallint, flashcard_due_at timestamptz)
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query select * from public.save_items_for(auth.uid(), p_items);
end;
$$;

create function public.api_save_items(p_token text, p_items jsonb)
  returns table (item_id uuid, language text, lemma text, created boolean, encounter_id uuid, flashcard_state smallint, flashcard_due_at timestamptz)
  language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query select * from public.save_items_for(v_user, p_items);
end;
$$;

CREATE FUNCTION public.api_sync_save(p_token text, p_client_id uuid, p_at timestamp with time zone, p_entry jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_prior jsonb;
  v_at timestamptz := least(p_at, now());
  v_lang public.language_code := (p_entry ->> 'language')::public.language_code;
  v_key text := p_entry ->> 'lemma_key';
  v_saved record;
  v_card uuid;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  if coalesce(v_key, '') = '' then raise exception 'bad_request'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, 'save');
  if v_prior is not null then return public.sync_prior(v_prior); end if;

  if not exists (
    select 1 from public.items i
    where i.user_id = v_user and i.language = v_lang and i.lemma_key = v_key and i.deleted_at is null
  ) and exists (
    select 1 from public.items i
    where i.user_id = v_user and i.language = v_lang and i.lemma_key = v_key and i.deleted_at > v_at
  ) then
    return public.sync_finish(v_user, p_client_id,
      jsonb_build_object('status', 'dropped', 'reason', 'item_deleted'));
  end if;

  select * into v_saved from public.save_items_for(v_user, jsonb_build_array(p_entry));
  select c.id into v_card from public.flashcards c where c.item_id = v_saved.item_id and c.kind = 'reconhecer';
  return public.sync_finish(v_user, p_client_id, jsonb_build_object(
    'status', 'applied',
    'itemId', v_saved.item_id,
    'flashcardId', v_card,
    'created', v_saved.created,
    'encounterId', v_saved.encounter_id
  ));
end;
$function$;

CREATE FUNCTION public.api_sync_review_target(p_token text, p_client_id uuid, p_flashcard_id uuid, p_save_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    select i.deleted_at, i.sense into v_deleted, v_sense from public.items i where i.id = v_card.item_id;
    if v_deleted is not null then
      v_outcome := jsonb_build_object('status', 'dropped', 'reason', 'item_deleted');
    elsif v_card.kind <> 'reconhecer' then
      v_outcome := jsonb_build_object('status', 'rejected', 'reason', 'invalid',
        'errors', jsonb_build_object('flashcardId', 'o aparelho só revisa o Reconhecer'));
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
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('rating', l.rating, 'reviewed_at', l.reviewed_at)
        order by l.reviewed_at, l.received_at)
      from public.review_logs l where l.flashcard_id = v_card.id), '[]')
  );
end;
$function$;

CREATE FUNCTION public.api_sync_review(p_token text, p_client_id uuid, p_flashcard_id uuid, p_expected_reps integer, p_rating smallint, p_reviewed_at timestamp with time zone, p_duration_ms integer, p_next jsonb, p_unlock_produce boolean, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select i.deleted_at into v_deleted from public.items i where i.id = v_card.item_id;
  if v_deleted is not null then
    return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'dropped', 'reason', 'item_deleted'));
  end if;
  if v_card.reps <> p_expected_reps then raise exception 'flashcard_stale'; end if;

  insert into public.review_logs (flashcard_id, user_id, rating, reviewed_at, client_id, duration_ms)
  values (v_card.id, v_user, p_rating, least(p_reviewed_at, now()), p_client_id, p_duration_ms);

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

  if p_unlock_produce and v_card.kind = 'reconhecer' then
    insert into public.flashcards (item_id, user_id, kind)
    values (v_card.item_id, v_user, 'produzir')
    on conflict (item_id, kind) do nothing;
  end if;

  return public.sync_finish(v_user, p_client_id, p_result);
end;
$function$;

CREATE FUNCTION public.api_sync_snapshot(p_token text, p_language text, p_after uuid, p_limit integer, p_day_start timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  v_lang public.language_code := p_language::public.language_code;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_items jsonb;
  v_count integer;
begin
  select * into v from public.sync_token_begin(p_token);
  if v.user_id is null then raise exception 'invalid_token'; end if;
  if v.retry_after is not null then return jsonb_build_object('rateLimited', v.retry_after); end if;

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
          (select max(l.received_at) from public.review_logs l where l.flashcard_id = c.id)
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
        'flashcard', to_jsonb(c)
      ) as line
    from page p
    join public.flashcards c on c.item_id = p.id and c.kind = 'reconhecer'
  ) rows;

  return jsonb_build_object(
    'account', (
      select jsonb_build_object(
        'ui_language', s.ui_language,
        'native_language', s.native_language,
        'study_languages', to_jsonb(s.study_languages::text[]),
        'new_flashcards_per_day', s.new_flashcards_per_day
      )
      from public.user_settings s where s.user_id = v.user_id
    ),
    'total', (
      select count(*) from public.items i
      where i.user_id = v.user_id and i.language = v_lang and i.deleted_at is null
    ),
    -- Mesma conta de review_counts: flashcards cuja primeira revisão é de hoje (em qualquer idioma).
    'newDoneToday', (
      select count(distinct l.flashcard_id) from public.review_logs l
      where l.user_id = v.user_id and l.reviewed_at >= p_day_start
        and not exists (
          select 1 from public.review_logs pl where pl.flashcard_id = l.flashcard_id and pl.reviewed_at < p_day_start
        )
    ),
    'items', v_items,
    'more', v_count > v_limit
  );
end;
$function$;

CREATE FUNCTION public.api_items(p_token text, p_language text)
 RETURNS TABLE(id uuid, lemma text, lemma_key text, reading text, sense text, status text, flashcards jsonb, forms text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query
    select i.id, i.lemma, i.lemma_key, i.reading, i.sense, i.status,
      coalesce((select jsonb_agg(jsonb_build_object(
          'kind', c.kind, 'state', c.state, 'due_at', c.due_at, 'stability', c.stability
        ) order by c.kind desc)
        from public.flashcards c where c.item_id = i.id), '[]'),
      coalesce((select array_agg(f.form order by f.form) from (
          select distinct e.form from public.encounters e
          where e.item_id = i.id and e.deleted_at is null and e.form <> '' and e.form <> i.lemma
          order by 1 limit 20
        ) f), '{}')
    from public.items i
    where i.user_id = v_user and i.language = p_language::public.language_code and i.deleted_at is null
    order by i.created_at desc
    limit 5000;
end;
$function$;


revoke all on function public.save_items_for(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.save_items(jsonb) from public, anon;
revoke all on function public.api_save_items(text, jsonb) from public;
grant execute on function public.save_items(jsonb) to authenticated;
grant execute on function public.api_save_items(text, jsonb) to anon, authenticated;
revoke all on function public.api_items(text, text) from public;
revoke all on function public.api_sync_save(text, uuid, timestamptz, jsonb) from public;
revoke all on function public.api_sync_review_target(text, uuid, uuid, uuid) from public;
revoke all on function public.api_sync_review(text, uuid, uuid, integer, smallint, timestamptz, integer, jsonb, boolean, jsonb) from public;
revoke all on function public.api_sync_snapshot(text, text, uuid, integer, timestamptz) from public;
grant execute on function public.api_items(text, text) to anon, authenticated;
grant execute on function public.api_sync_save(text, uuid, timestamptz, jsonb) to anon, authenticated;
grant execute on function public.api_sync_review_target(text, uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.api_sync_review(text, uuid, uuid, integer, smallint, timestamptz, integer, jsonb, boolean, jsonb) to anon, authenticated;
grant execute on function public.api_sync_snapshot(text, text, uuid, integer, timestamptz) to anon, authenticated;
