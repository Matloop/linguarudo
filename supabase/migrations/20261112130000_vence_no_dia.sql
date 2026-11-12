-- Quando um flashcard conta como "para hoje", igual no hub e na sessão (review.ts, isDue):
-- aprendendo/reaprendendo (passos em minutos) vence no instante, due_at <= agora;
-- revisão (em dias) vence no dia de estudo, due_at < início do próximo dia, como no Anki.
-- Vencer no instante atrasava 1 em 5 revisões em um dia inteiro (scripts/srs-sim).
drop function public.deck_summaries(timestamptz, timestamptz, text);
drop function public.review_counts(timestamptz, text);

create function public.deck_summaries(p_day_start timestamptz, p_now timestamptz, p_next_day_start timestamptz,
  p_language text)
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
    (select count(*)::integer from cards c where c.deck = d.id and c.state in (1, 3) and c.due_at <= p_now),
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
revoke all on function public.deck_summaries(timestamptz, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.deck_summaries(timestamptz, timestamptz, timestamptz, text) to authenticated;

create function public.review_counts(p_day_start timestamptz, p_now timestamptz, p_next_day_start timestamptz,
  p_language text default null)
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
    (select min(due_at) from active
      where (state in (1, 3) and due_at > p_now) or (state = 2 and due_at >= p_next_day_start));
$$;
revoke all on function public.review_counts(timestamptz, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.review_counts(timestamptz, timestamptz, timestamptz, text) to authenticated;
