-- Qualquer idioma por design (docs/adr/0004-qualquer-idioma.md).
--   1. language_code passa a ser qualquer tag BCP 47 bem formada (o app canoniza antes).
--   2. O lema fica como foi escrito ("Haus"). A unicidade usa lemma_key, que só o servidor
--      calcula (lemmaKey() de @linguetta/language: NFC + minúsculas do idioma) e manda
--      nas funções. Nada aqui baixa a caixa do lema.
--   3. items.reading: furigana, pinyin ou romanização, separado do ipa.
--   4. user_settings: ui_language (pt | en), nativa sem padrão, estudo começa vazio
--      (até 20). As funções param de completar com 'pt' e {en,it}.

-- ---------- Idiomas ----------

-- Mesmo texto de LANGUAGE_TAG_RE (packages/language/src/index.js); um teste do app confere.
-- not valid: o Postgres não revalida domínio usado em array (study_languages). Os valores
-- que já existem são da lista antiga e passam na regex; os novos são conferidos.
alter domain public.language_code drop constraint language_code_check;
alter domain public.language_code add constraint language_code_check check (
  value ~ '^(?=.{2,35}$)[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?(?:-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*(?:-[0-9A-WYZa-wyz](?:-[A-Za-z0-9]{2,8})+)*(?:-[Xx](?:-[A-Za-z0-9]{1,8})+)?$'
) not valid;

-- ---------- Configurações ----------

alter table public.user_settings
  add column ui_language text not null default 'pt' check (ui_language in ('pt', 'en'));

comment on column public.user_settings.ui_language is
  'Idioma da interface. O app preenche pelo Accept-Language no primeiro acesso; o padrão é só a trava do banco.';
comment on column public.user_settings.native_language is
  'Língua nativa (sentidos e traduções). Nula até o app preencher pelo Accept-Language no primeiro acesso.';

alter table public.user_settings
  alter column native_language drop default,
  alter column native_language drop not null,
  alter column study_languages set default '{}';

alter table public.user_settings drop constraint user_settings_study_languages_check;
alter table public.user_settings add constraint user_settings_study_languages_check
  check (cardinality(study_languages) between 0 and 20);

grant update (ui_language) on public.user_settings to authenticated;

-- ---------- Itens ----------

alter table public.items
  add column lemma_key text,
  add column reading text not null default '' check (char_length(reading) <= 100);

-- Linhas antigas: aproximação única pelo lower() do banco. Daqui em diante só o servidor grava.
update public.items set lemma_key = lower(normalize(lemma, NFC));

alter table public.items
  alter column lemma_key set not null,
  add constraint items_lemma_key_check check (char_length(lemma_key) between 1 and 160);

comment on column public.items.lemma_key is
  'Chave de unicidade do lema: lemmaKey(lemma, language) calculada pelo servidor (ADR 0004).';
comment on column public.items.reading is 'Leitura (furigana, pinyin, romanização). Aparece acima do lema.';

drop index public.items_lemma_key;
create unique index items_language_lemma_key on public.items (user_id, language, lemma_key)
  where deleted_at is null;

-- Editar o lema pela sessão passa pelo servidor do app, que manda a chave nova junto.
grant update (lemma_key, reading) on public.items to authenticated;

-- ---------- Salvar ----------

-- Entrada como antes, mais lemma_key (obrigatória, calculada pelo servidor) e reading:
-- [{ language, lemma, lemma_key, reading?, sense?, note?, ipa?, part_of_speech?, encounter?, work? }]
create or replace function public.save_items_for(p_user uuid, p_items jsonb)
  returns table (item_id uuid, language text, lemma text, created boolean, encounter_id uuid, card_state smallint, card_due_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
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
      join public.cards c on c.item_id = i.id and c.kind = 'reconhecer'
      where i.id = v_item;
  end loop;
end;
$$;
revoke all on function public.save_items_for(uuid, jsonb) from public, anon, authenticated;

-- ---------- API v1 (integrações com token) ----------

drop function public.api_me(text);

-- Quem é o dono do token e os três eixos de idioma (sem padrões: nulo é nulo).
create function public.api_me(p_token text)
  returns table (email text, ui_language text, native_language text, study_languages text[])
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query
    select u.email::text, s.ui_language, s.native_language::text, s.study_languages::text[]
    from auth.users u left join public.user_settings s on s.user_id = u.id
    where u.id = v_user;
end;
$$;

drop function public.api_items(text, text);

-- Itens não apagados de um idioma, com os cartões e as grafias vistas como foram escritas
-- (sem o lema). A comparação sem caixa, se o cliente quiser, fica com ele.
create function public.api_items(p_token text, p_language text)
  returns table (id uuid, lemma text, lemma_key text, reading text, sense text, status text, cards jsonb, forms text[])
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query
    select i.id, i.lemma, i.lemma_key, i.reading, i.sense, i.status,
      coalesce((select jsonb_agg(jsonb_build_object(
          'kind', c.kind, 'state', c.state, 'due_at', c.due_at, 'stability', c.stability
        ) order by c.kind desc)
        from public.cards c where c.item_id = i.id), '[]'),
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
$$;

drop function public.api_mark_seen(text, text, text[]);

-- "Visto": soma uma aparição aos itens das chaves (lemma_key calculada pelo servidor).
create function public.api_mark_seen(p_token text, p_language text, p_lemma_keys text[])
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_count integer;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  if coalesce(array_length(p_lemma_keys, 1), 0) > 500 then raise exception 'bad_request'; end if;
  update public.items i set seen_count = i.seen_count + 1, last_seen_at = now()
    where i.user_id = v_user and i.language = p_language::public.language_code and i.deleted_at is null
      and i.lemma_key = any (p_lemma_keys);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.api_me(text) from public;
revoke all on function public.api_items(text, text) from public;
revoke all on function public.api_mark_seen(text, text, text[]) from public;
grant execute on function public.api_me(text) to anon, authenticated;
grant execute on function public.api_items(text, text) to anon, authenticated;
grant execute on function public.api_mark_seen(text, text, text[]) to anon, authenticated;

-- ---------- Sync ----------

-- Poll do pareamento: a conta sai com os idiomas como estão, sem completar.
create or replace function public.sync_pair_poll(p_device_code_hash text, p_token_hash text, p_token_hint text)
  returns table (status text, poll_interval integer, device_name text, account jsonb)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v public.device_pairings;
  v_token uuid;
begin
  select * into v from public.device_pairings p where p.device_code_hash = p_device_code_hash for update;
  if not found or v.status in ('consumed', 'expired') then
    return query select 'expired'::text, null::integer, null::text, null::jsonb;
    return;
  end if;
  if v.expires_at <= now() then
    update public.device_pairings p set status = 'expired' where p.id = v.id and p.status = 'pending';
    return query select 'expired'::text, null::integer, null::text, null::jsonb;
    return;
  end if;

  if v.status = 'pending' then
    -- 1 s de folga para a latência da rede.
    if v.last_poll_at is not null and now() < v.last_poll_at + make_interval(secs => v.poll_interval - 1) then
      update public.device_pairings p set poll_interval = least(p.poll_interval + 5, 60), last_poll_at = now()
        where p.id = v.id returning p.poll_interval into v.poll_interval;
      return query select 'slow_down'::text, v.poll_interval, null::text, null::jsonb;
      return;
    end if;
    update public.device_pairings p set last_poll_at = now() where p.id = v.id;
    return query select 'pending'::text, v.poll_interval, null::text, null::jsonb;
    return;
  end if;

  if v.status = 'denied' then
    return query select 'denied'::text, null::integer, null::text, null::jsonb;
    return;
  end if;

  -- approved: o token nasce agora, uma vez só.
  insert into public.api_tokens (user_id, label, token_hash, token_hint, kind, device_model)
  values (v.user_id, v.device_name, p_token_hash, p_token_hint, 'aparelho', v.device_model)
  returning id into v_token;
  update public.device_pairings p set status = 'consumed', token_id = v_token where p.id = v.id;

  return query
    select 'approved'::text, null::integer, v.device_name,
      jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'uiLanguage', s.ui_language,
        'nativeLanguage', s.native_language::text,
        'studyLanguages', coalesce(to_jsonb(s.study_languages::text[]), '[]')
      )
    from auth.users u left join public.user_settings s on s.user_id = u.id
    where u.id = v.user_id;
end;
$$;

-- save: a exclusão vence, agora pela lemma_key que o servidor pôs em p_entry.
create or replace function public.api_sync_save(p_token text, p_client_id uuid, p_at timestamptz, p_entry jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
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
  select c.id into v_card from public.cards c where c.item_id = v_saved.item_id and c.kind = 'reconhecer';
  return public.sync_finish(v_user, p_client_id, jsonb_build_object(
    'status', 'applied',
    'itemId', v_saved.item_id,
    'cardId', v_card,
    'created', v_saved.created,
    'encounterId', v_saved.encounter_id
  ));
end;
$$;

drop function public.api_sync_seen(text, uuid, text, text, timestamptz);

-- seen: soma uma aparição ao item vivo da chave. Não cria encontro nem mexe no FSRS.
create function public.api_sync_seen(p_token text, p_client_id uuid, p_language text, p_lemma_key text, p_at timestamptz)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_prior jsonb;
  v_item uuid;
  v_at timestamptz := least(p_at, now());
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, 'seen');
  if v_prior is not null then return public.sync_prior(v_prior); end if;

  update public.items i set
    seen_count = i.seen_count + 1,
    last_seen_at = greatest(i.last_seen_at, v_at)
  where i.user_id = v_user and i.language = p_language::public.language_code
    and i.lemma_key = p_lemma_key and i.deleted_at is null
  returning i.id into v_item;

  if v_item is null then
    return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'dropped', 'reason', 'not_found'));
  end if;
  return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'applied', 'itemId', v_item));
end;
$$;

revoke all on function public.api_sync_seen(text, uuid, text, text, timestamptz) from public;
grant execute on function public.api_sync_seen(text, uuid, text, text, timestamptz) to anon, authenticated;

-- Snapshot: o item leva lemma_key e reading; as formas saem como foram escritas; a conta
-- traz os três eixos de idioma sem padrões.
create or replace function public.api_sync_snapshot(
  p_token text,
  p_language text,
  p_after uuid,
  p_limit integer,
  p_day_start timestamptz
) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
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
          (select max(l.received_at) from public.review_logs l where l.card_id = c.id)
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
        'card', to_jsonb(c)
      ) as line
    from page p
    join public.cards c on c.item_id = p.id and c.kind = 'reconhecer'
  ) rows;

  return jsonb_build_object(
    'account', (
      select jsonb_build_object(
        'ui_language', s.ui_language,
        'native_language', s.native_language,
        'study_languages', to_jsonb(s.study_languages::text[]),
        'new_cards_per_day', s.new_cards_per_day
      )
      from public.user_settings s where s.user_id = v.user_id
    ),
    'total', (
      select count(*) from public.items i
      where i.user_id = v.user_id and i.language = v_lang and i.deleted_at is null
    ),
    -- Mesma conta de review_counts: cartões cuja primeira revisão é de hoje (em qualquer idioma).
    'newDoneToday', (
      select count(distinct l.card_id) from public.review_logs l
      where l.user_id = v.user_id and l.reviewed_at >= p_day_start
        and not exists (
          select 1 from public.review_logs pl where pl.card_id = l.card_id and pl.reviewed_at < p_day_start
        )
    ),
    'items', v_items,
    'more', v_count > v_limit
  );
end;
$$;
