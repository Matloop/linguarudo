-- Teimosa na legenda (docs/agents/decks.md, Fatia 4): o Stremio destaca a palavra em
-- espera e, ao salvar um encontro com frase, conta que ela voltou para a fila.
--
--   api_items: devolve leech_hold de cada item (GET /api/v1/items → leechWaiting).
--   save_items_for: devolve released = o encontro desta entrada tirou a espera (quem
--     tira é o gatilho encounters_release_leech; aqui só se lê o antes e o depois).

drop function public.api_save_items(text, jsonb);
drop function public.save_items(jsonb);
drop function public.save_items_for(uuid, jsonb);
drop function public.api_items(text, text);

CREATE FUNCTION public.save_items_for(p_user uuid, p_items jsonb)
 RETURNS TABLE(item_id uuid, language text, lemma text, created boolean, encounter_id uuid, flashcard_state smallint, flashcard_due_at timestamp with time zone, released boolean)
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
  v_waiting boolean;
  v_released boolean;
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
    v_released := false;

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
      select i.leech_hold = 'wait' into v_waiting from public.items i where i.id = v_item;
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
      -- O gatilho encounters_release_leech tira a espera; aqui só se conta que tirou.
      if v_waiting then
        select i.leech_hold is null into v_released from public.items i where i.id = v_item;
      end if;
    end if;

    return query
      select v_item, v_lang::text, i.lemma, v_created, v_encounter, c.state, c.due_at, v_released
      from public.items i
      join public.flashcards c on c.item_id = i.id and c.kind = 'reconhecer'
      where i.id = v_item;
  end loop;
end;
$function$;

create function public.save_items(p_items jsonb)
  returns table (item_id uuid, language text, lemma text, created boolean, encounter_id uuid, flashcard_state smallint, flashcard_due_at timestamptz, released boolean)
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query select * from public.save_items_for(auth.uid(), p_items);
end;
$$;

create function public.api_save_items(p_token text, p_items jsonb)
  returns table (item_id uuid, language text, lemma text, created boolean, encounter_id uuid, flashcard_state smallint, flashcard_due_at timestamptz, released boolean)
  language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query select * from public.save_items_for(v_user, p_items);
end;
$$;

create function public.api_items(p_token text, p_language text)
  returns table (id uuid, lemma text, lemma_key text, reading text, sense text, status text, flashcards jsonb, forms text[], leech_hold text)
  language plpgsql security definer set search_path = '' as $$
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
        ) f), '{}'),
      i.leech_hold
    from public.items i
    where i.user_id = v_user and i.language = p_language::public.language_code and i.deleted_at is null
    order by i.created_at desc
    limit 5000;
end;
$$;

revoke all on function public.save_items_for(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.save_items(jsonb) from public, anon;
revoke all on function public.api_save_items(text, jsonb) from public;
revoke all on function public.api_items(text, text) from public;
grant execute on function public.save_items(jsonb) to authenticated;
grant execute on function public.api_save_items(text, jsonb) to anon, authenticated;
grant execute on function public.api_items(text, text) to anon, authenticated;
