-- Import do Anki (ADR 0003). O navegador lê o .apkg, sobe a mídia e manda lotes de
-- notas; o servidor confere o lote e chama estas funções.
--
--   import_anki_notes: cria ou atualiza itens (via save_items_for, com um encontro
--     de origem 'anki' cujo client_id sai do GUID) e fichas (upsert por anki_guid).
--     Devolve os flashcards de cada nota e se ainda estão sem revisão.
--   import_anki_reviews: grava o histórico do Anki e o cronograma que o app calculou
--     reaplicando esse histórico (ADR 0001), só em flashcard que nunca foi revisado
--     aqui. Reimportar o mesmo pacote não duplica nada.

-- União de tags na ordem em que aparecem, até 50 (o limite de valid_tags).
create function public.merge_tags(p_a text[], p_b text[]) returns text[]
  language sql immutable set search_path = '' as $$
  select coalesce(array_agg(t order by n), '{}') from (
    select t, min(n) n from unnest(p_a || p_b) with ordinality u(t, n)
    group by t order by min(n) limit 50
  ) x;
$$;

create function public.import_anki_notes(p_language text, p_notes jsonb)
  returns table (guid text, flashcard_id uuid, kind text, ord smallint, created_at timestamptz, fresh boolean)
  language plpgsql volatile security definer set search_path = '' as $$
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
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_notes) is distinct from 'array' or jsonb_array_length(p_notes) > 100 then
    raise exception 'bad_request';
  end if;

  for v_note in select value from jsonb_array_elements(p_notes) loop
    v_tags := array(select jsonb_array_elements_text(coalesce(v_note -> 'tags', '[]')));
    v_suspended := coalesce((v_note ->> 'suspended')::boolean, false);

    if v_note ->> 'type' = 'item' then
      if (v_note -> 'entry' ->> 'language') is distinct from v_lang::text then
        raise exception 'bad_request';
      end if;
      select * into v_saved from public.save_items_for(v_user, jsonb_build_array(v_note -> 'entry'));
      v_owner := v_saved.item_id;
      -- O que o item já tem fica; o Anki completa o que falta.
      update public.items i set
        tags = public.merge_tags(i.tags, v_tags),
        image = coalesce(i.image, v_note ->> 'image'),
        audio = coalesce(i.audio, v_note ->> 'audio'),
        status = case when v_saved.created and v_suspended then 'conhecido' else i.status end
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
        user_id, language, front, back, reverse, cloze_count, tags, anki_guid,
        front_image, front_audio, back_image, back_audio
      ) values (
        v_user, v_lang, v_note ->> 'front', coalesce(v_note ->> 'back', ''),
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

create function public.import_anki_reviews(p_flashcards jsonb) returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_in jsonb;
  v_card public.flashcards;
  v_next public.flashcards;
  v_done integer := 0;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_flashcards) is distinct from 'array' or jsonb_array_length(p_flashcards) > 500 then
    raise exception 'bad_request';
  end if;

  for v_in in select value from jsonb_array_elements(p_flashcards) loop
    select * into v_card from public.flashcards f
      where f.id = (v_in ->> 'flashcard_id')::uuid and f.user_id = v_user
      for update;
    -- Já revisado aqui: o histórico daqui vence o do Anki.
    continue when not found or v_card.reps <> 0
      or exists (select 1 from public.review_logs l where l.flashcard_id = v_card.id);

    insert into public.review_logs (flashcard_id, user_id, rating, reviewed_at)
    select v_card.id, v_user, (l ->> 'rating')::smallint, least((l ->> 'reviewed_at')::timestamptz, now())
    from jsonb_array_elements(v_in -> 'logs') l;

    v_next := jsonb_populate_record(v_card, v_in -> 'next');
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
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.merge_tags(text[], text[]) from public, anon;
revoke all on function public.import_anki_notes(text, jsonb) from public, anon;
revoke all on function public.import_anki_reviews(jsonb) from public, anon;
grant execute on function public.merge_tags(text[], text[]) to authenticated;
grant execute on function public.import_anki_notes(text, jsonb) to authenticated;
grant execute on function public.import_anki_reviews(jsonb) to authenticated;
