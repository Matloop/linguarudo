-- Visto pela sessão: no leitor web, tocar numa palavra do blend que já está no banco soma
-- uma aparição, como a operação `seen` do sync (CONTRACT §4). Não cria encontro e não
-- mexe no FSRS. Devolve o item achado; nenhuma linha quando não há item vivo.
create function public.mark_seen(p_language text, p_lemma_key text)
  returns table (item_id uuid, seen_count integer)
  language sql volatile security definer set search_path = '' as $$
  update public.items i
    set seen_count = i.seen_count + 1,
        last_seen_at = greatest(i.last_seen_at, now())
    where i.user_id = auth.uid()
      and i.language = p_language::public.language_code
      and i.lemma_key = p_lemma_key
      and i.deleted_at is null
  returning i.id, i.seen_count;
$$;

revoke all on function public.mark_seen(text, text) from public, anon;
grant execute on function public.mark_seen(text, text) to authenticated;
