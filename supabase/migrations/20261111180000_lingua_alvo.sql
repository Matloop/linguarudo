-- Modo "só língua-alvo" do LingoBlend: a legenda já está na língua estudada.
--   1. O encontro guarda a tradução da frase na língua nativa (a fala do filme em PT).
--   2. api_items devolve as grafias já vistas de cada item, para o fork reconhecer
--      "ricordo" como o item "ricordarsi" sem lematizar no cliente.

alter table public.encounters
  add column translation text not null default '' check (char_length(translation) <= 1000);

comment on column public.encounters.translation is 'Tradução da frase (sentence) na língua nativa.';

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
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'bad_request';
  end if;

  for v_in in select value from jsonb_array_elements(p_items) loop
    v_lang := (v_in ->> 'language')::public.language_code;
    v_lemma := v_in ->> 'lemma';
    v_enc := v_in -> 'encounter';
    v_encounter := null;

    insert into public.items (user_id, language, lemma, sense, note, ipa, part_of_speech)
    values (
      p_user, v_lang, v_lemma,
      coalesce(nullif(v_in ->> 'sense', ''), v_enc ->> 'sense', ''),
      coalesce(v_in ->> 'note', ''), coalesce(v_in ->> 'ipa', ''), coalesce(v_in ->> 'part_of_speech', '')
    )
    on conflict (user_id, language, lower(lemma)) where deleted_at is null do nothing
    returning id into v_item;
    v_created := v_item is not null;

    if not v_created then
      select i.id into v_item from public.items i
        where i.user_id = p_user and i.language = v_lang and lower(i.lemma) = lower(v_lemma)
          and i.deleted_at is null;
      -- O que o item ainda não tem vem da entrada; o que o usuário já escreveu fica.
      update public.items i set
        sense = case when i.sense = '' then coalesce(nullif(v_in ->> 'sense', ''), v_enc ->> 'sense', '') else i.sense end,
        note = case when i.note = '' then coalesce(v_in ->> 'note', '') else i.note end,
        ipa = case when i.ipa = '' then coalesce(v_in ->> 'ipa', '') else i.ipa end,
        part_of_speech = case when i.part_of_speech = '' then coalesce(v_in ->> 'part_of_speech', '') else i.part_of_speech end
      where i.id = v_item
        and ((i.sense = '' and coalesce(nullif(v_in ->> 'sense', ''), v_enc ->> 'sense', '') <> '')
          or (i.note = '' and coalesce(v_in ->> 'note', '') <> '')
          or (i.ipa = '' and coalesce(v_in ->> 'ipa', '') <> '')
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

drop function public.api_items(text, text);

-- Itens não apagados de um idioma, com os cartões (selo "No seu banco" e preferWords)
-- e as grafias vistas nos encontros (destaque na legenda).
create function public.api_items(p_token text, p_language text)
  returns table (id uuid, lemma text, sense text, status text, cards jsonb, forms text[])
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query
    select i.id, i.lemma, i.sense, i.status,
      coalesce((select jsonb_agg(jsonb_build_object(
          'kind', c.kind, 'state', c.state, 'due_at', c.due_at, 'stability', c.stability
        ) order by c.kind desc)
        from public.cards c where c.item_id = i.id), '[]'),
      coalesce((select array_agg(f.form order by f.form) from (
          select distinct lower(e.form) as form from public.encounters e
          where e.item_id = i.id and e.deleted_at is null and e.form <> '' and lower(e.form) <> lower(i.lemma)
          limit 20
        ) f), '{}')
    from public.items i
    where i.user_id = v_user and i.language = p_language::public.language_code and i.deleted_at is null
    order by i.created_at desc
    limit 5000;
end;
$$;

revoke all on function public.api_items(text, text) from public;
grant execute on function public.api_items(text, text) to anon, authenticated;
