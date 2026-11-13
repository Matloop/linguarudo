-- Limites diários por baralho, como os "Limites diários" do Anki (ADR 0005, atualizado).
--
--   1. Dois limites: novas por dia e revisões máximas por dia. Cada um vale em três níveis,
--      o de cima ganha: "Só hoje" (deck.new_today / reviews_today, só no dia de estudo
--      limits_day) > "Este baralho" (deck.new_per_day / reviews_per_day) > "Geral"
--      (user_settings.new_flashcards_per_day / reviews_per_day). Padrões: 20 e 200.
--   2. new_cap vira new_per_day (o mesmo teto, agora com nome de limite do baralho).
--   3. Subdeck conta contra o pai, como no Anki. "Estudar tudo" usa o Geral do idioma como
--      teto total (o orçamento de novas do ADR 0005). O "+N hoje" (extra_new) soma em todos
--      os limites de novas do dia.
--   4. Revisão nunca é recusada; o limite só corta quantas revisões a fila serve hoje.
--      Revisões feitas hoje = flashcards em revisão (state_before = 2) respondidos no dia.
--   5. Todo idioma de estudo e todo idioma com itens/fichas tem o deck padrão.

-- ---------- Geral ----------

alter table public.user_settings alter column new_flashcards_per_day set default 20;
alter table public.user_settings
  add column reviews_per_day integer not null default 200 check (reviews_per_day between 0 and 9999);
grant update (reviews_per_day) on public.user_settings to authenticated;

-- ---------- Este baralho e Só hoje ----------

alter table public.decks rename column new_cap to new_per_day;
alter table public.decks rename constraint decks_new_cap_check to decks_new_per_day_check;
alter table public.decks
  add column reviews_per_day integer check (reviews_per_day between 0 and 9999),
  -- "Só hoje": valem só no dia de estudo limits_day (data local, review_day_key).
  add column new_today integer check (new_today between 0 and 1000),
  add column reviews_today integer check (reviews_today between 0 and 9999),
  add column limits_day date;

-- Os limites mudam só por set_deck_limits (o Geral e o Só hoje precisam do dia e da conta).
revoke update (new_per_day) on public.decks from authenticated;
revoke insert (new_per_day) on public.decks from authenticated;

-- Grava os limites de um deck. Modo por limite: 'geral' (valor vai para user_settings e o
-- deck volta a seguir o Geral), 'deck' (valor do baralho; tira o Só hoje) ou 'hoje' (só no
-- dia de estudo de p_day_start). Valor nulo deixa aquele limite como está.
create function public.set_deck_limits(p_deck uuid, p_new_mode text, p_new integer,
  p_reviews_mode text, p_reviews integer, p_day_start timestamptz) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_day date;
  d public.decks;
  v_new_deck integer;
  v_rev_deck integer;
  v_new_today integer;
  v_rev_today integer;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if (p_new is not null and (p_new < 0 or p_new > 1000 or p_new_mode not in ('geral', 'deck', 'hoje')))
    or (p_reviews is not null and (p_reviews < 0 or p_reviews > 9999
      or p_reviews_mode not in ('geral', 'deck', 'hoje'))) then
    raise exception 'bad_request';
  end if;
  select * into d from public.decks where id = p_deck and user_id = v_user for update;
  if d.id is null then raise exception 'deck_not_found'; end if;
  v_day := public.review_day_key(v_user, p_day_start);

  v_new_deck := d.new_per_day;
  v_rev_deck := d.reviews_per_day;
  -- Só hoje de outro dia já não vale.
  v_new_today := case when d.limits_day = v_day then d.new_today end;
  v_rev_today := case when d.limits_day = v_day then d.reviews_today end;

  if p_new is not null then
    if p_new_mode = 'geral' then
      update public.user_settings set new_flashcards_per_day = p_new where user_id = v_user;
      v_new_deck := null;
      v_new_today := null;
    elsif p_new_mode = 'deck' then
      v_new_deck := p_new;
      v_new_today := null;
    else
      v_new_today := p_new;
    end if;
  end if;
  if p_reviews is not null then
    if p_reviews_mode = 'geral' then
      update public.user_settings set reviews_per_day = p_reviews where user_id = v_user;
      v_rev_deck := null;
      v_rev_today := null;
    elsif p_reviews_mode = 'deck' then
      v_rev_deck := p_reviews;
      v_rev_today := null;
    else
      v_rev_today := p_reviews;
    end if;
  end if;

  update public.decks set
    new_per_day = v_new_deck,
    reviews_per_day = v_rev_deck,
    new_today = v_new_today,
    reviews_today = v_rev_today,
    limits_day = case when v_new_today is null and v_rev_today is null then null else v_day end
  where id = d.id;
end;
$$;
revoke all on function public.set_deck_limits(uuid, text, integer, text, integer, timestamptz) from public, anon;
grant execute on function public.set_deck_limits(uuid, text, integer, text, integer, timestamptz) to authenticated;

-- ---------- Revisões feitas hoje ----------

-- Flashcards em revisão (state_before = 2) respondidos no dia de estudo, por deck do dono.
create function public.review_done_by_deck(p_user uuid, p_day_start timestamptz)
  returns table (deck_id uuid, language public.language_code, n integer)
  language sql stable security definer set search_path = '' as $$
  select coalesce(i.deck_id, h.deck_id), coalesce(i.language, h.language), count(distinct l.flashcard_id)::integer
  from public.review_logs l
  join public.flashcards f on f.id = l.flashcard_id
  left join public.items i on i.id = f.item_id
  left join public.fichas h on h.id = f.ficha_id
  where l.user_id = p_user and l.reviewed_at >= p_day_start and l.state_before = 2
  group by 1, 2;
$$;
revoke all on function public.review_done_by_deck(uuid, timestamptz) from public, anon, authenticated;

-- ---------- Contagens ----------

-- Por deck do idioma: + flashcards (total do deck) e revisões feitas hoje. Limites e tetos
-- ficam no app (lib/decks.ts summarizeDecks).
drop function public.deck_summaries(timestamptz, timestamptz, timestamptz, text);
create function public.deck_summaries(p_day_start timestamptz, p_now timestamptz, p_next_day_start timestamptz,
  p_language text)
  returns table (deck_id uuid, new_available integer, learning_due integer, review_due integer,
    new_done_today integer, review_done_today integer, items integer, fichas integer, flashcards integer,
    leeches integer)
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
  every_card as (
    select coalesce(i.deck_id, h.deck_id) as deck, count(*)::integer as n
    from public.flashcards f
    left join public.items i on i.id = f.item_id
    left join public.fichas h on h.id = f.ficha_id
    where f.user_id = (select auth.uid())
      and coalesce(i.language, h.language)::text = p_language
      and coalesce(i.deleted_at, h.deleted_at) is null
    group by 1
  ),
  done as (select * from public.new_done_by_deck((select auth.uid()), p_day_start)),
  reviewed as (select * from public.review_done_by_deck((select auth.uid()), p_day_start))
  select d.id,
    (select count(distinct coalesce(c.item_id, c.id))::integer from cards c
      where c.deck = d.id and c.state = 0 and not c.buried),
    (select count(*)::integer from cards c where c.deck = d.id and c.state in (1, 3) and c.due_at <= p_now),
    (select count(distinct coalesce(c.item_id, c.id))::integer from cards c
      where c.deck = d.id and c.state = 2 and c.due_at < p_next_day_start and not c.buried),
    coalesce((select x.n from done x where x.deck_id = d.id), 0),
    coalesce((select x.n from reviewed x where x.deck_id = d.id), 0),
    (select count(*)::integer from public.items i where i.deck_id = d.id and i.deleted_at is null),
    (select count(*)::integer from public.fichas h where h.deck_id = d.id and h.deleted_at is null),
    coalesce((select e.n from every_card e where e.deck = d.id), 0),
    (select count(*)::integer from public.items i where i.deck_id = d.id and i.deleted_at is null and i.leech_hold is not null)
      + (select count(*)::integer from public.fichas h where h.deck_id = d.id and h.deleted_at is null and h.leech_hold is not null)
  from public.decks d
  where d.user_id = (select auth.uid()) and d.language::text = p_language;
$$;
revoke all on function public.deck_summaries(timestamptz, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.deck_summaries(timestamptz, timestamptz, timestamptz, text) to authenticated;

-- + o Geral de revisões, revisões feitas hoje e a data do dia de estudo (para o Só hoje).
drop function public.review_counts(timestamptz, timestamptz, timestamptz, text);
create function public.review_counts(p_day_start timestamptz, p_now timestamptz, p_next_day_start timestamptz,
  p_language text default null)
  returns table (due_now integer, new_available integer, new_done_today integer, new_limit integer,
    extra_new integer, reviews_limit integer, review_done_today integer, day_key date, next_due_at timestamptz)
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
    (select count(*)::integer from active where state in (1, 3) and due_at <= p_now)
      + (select count(distinct coalesce(item_id, id))::integer from active
          where state = 2 and due_at < p_next_day_start and not buried),
    (select count(distinct coalesce(item_id, id))::integer from active where state = 0 and not buried),
    (select coalesce(sum(n), 0)::integer from public.new_done_by_deck((select auth.uid()), p_day_start) x
      where p_language is null or x.language::text = p_language),
    (select s.new_flashcards_per_day from public.user_settings s where s.user_id = (select auth.uid())),
    (select coalesce(sum(x.n), 0)::integer from public.extra_new x
      where x.user_id = (select auth.uid())
        and x.day = public.review_day_key((select auth.uid()), p_day_start)
        and (p_language is null or x.language::text = p_language)),
    (select s.reviews_per_day from public.user_settings s where s.user_id = (select auth.uid())),
    (select coalesce(sum(n), 0)::integer from public.review_done_by_deck((select auth.uid()), p_day_start) x
      where p_language is null or x.language::text = p_language),
    public.review_day_key((select auth.uid()), p_day_start),
    (select min(due_at) from active
      where (state in (1, 3) and due_at > p_now) or (state = 2 and due_at >= p_next_day_start));
$$;
revoke all on function public.review_counts(timestamptz, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.review_counts(timestamptz, timestamptz, timestamptz, text) to authenticated;

-- ---------- Estado da fila ----------

-- Igual ao anterior, mais: Geral de revisões, revisões feitas hoje por deck e os limites de
-- cada deck (o Só hoje só sai no dia dele).
create or replace function public.queue_state_for(p_user uuid, p_language public.language_code, p_day_start timestamptz)
  returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object(
        'perDay', s.new_flashcards_per_day,
        'reviewsPerDay', s.reviews_per_day,
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
    'reviewDoneByDeck', coalesce((select jsonb_object_agg(x.deck_id, x.n)
      from public.review_done_by_deck(p_user, p_day_start) x where x.language = p_language), '{}'),
    -- Obra ativa: a do último encontro do usuário no idioma nas últimas 48 h.
    'activeWorkId', (select e.work_id from public.encounters e
      join public.items i on i.id = e.item_id
      where e.user_id = p_user and i.language = p_language and e.work_id is not null
        and e.deleted_at is null and e.seen_at > now() - interval '48 hours'
      order by e.seen_at desc limit 1),
    'decks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'parentId', d.parent_id, 'default', d.is_default,
        'paused', d.paused, 'newOrder', d.new_order,
        'newPerDay', d.new_per_day, 'reviewsPerDay', d.reviews_per_day,
        'newPerDayToday', case when d.limits_day = public.review_day_key(p_user, p_day_start) then d.new_today end,
        'reviewsPerDayToday', case when d.limits_day = public.review_day_key(p_user, p_day_start) then d.reviews_today end,
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

-- ---------- Deck padrão para todo mundo ----------

-- ensure_study_decks (trigger em user_settings) já cria o padrão de cada idioma de estudo, e
-- assign_deck põe item/ficha sem deck no padrão. Aqui só se garante o que veio antes disso.
do $$
begin
  perform public.ensure_default_deck(s.user_id, l)
  from public.user_settings s, unnest(s.study_languages) l;
  perform public.ensure_default_deck(x.user_id, x.language)
  from (select user_id, language from public.items union select user_id, language from public.fichas) x;
end;
$$;
