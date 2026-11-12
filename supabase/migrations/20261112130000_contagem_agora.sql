-- O hub contava como "para hoje" o que vence até o fim do dia de estudo, mas a sessão só
-- pega o que já venceu (due_at <= agora). Resultado: "5 para hoje" e fila vazia. A contagem
-- passa a usar o mesmo corte da fila.
drop function public.deck_summaries(timestamptz, timestamptz, text);

create function public.deck_summaries(p_day_start timestamptz, p_now timestamptz, p_language text)
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
      where c.deck = d.id and c.state = 2 and c.due_at <= p_now and not c.buried),
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
