-- Sincronia da letra por trechos.
--
-- O deslocamento único (refs.lyrics_offset) não dá conta de clipes com pausa ou corte
-- no meio da música. Agora a obra guarda em refs.lyrics_sync uma linha do tempo:
-- âncoras (começo da linha na letra → tempo no vídeo, com hash do texto da linha),
-- a velocidade, se o palpite pela duração foi ignorado e qual registro do LRCLIB.
-- A forma completa é validada no servidor (timeline.ts, parseStoredSync); aqui só
-- os limites que protegem a tabela.
--
-- O usuário só pode dar UPDATE em played_at; refs carrega a identidade da obra
-- (youtube_id → ref_key), então a escrita passa por esta função, que só mexe em
-- refs.lyrics_sync.

drop function public.set_lyrics_sync(uuid, numeric, boolean);

update public.works
set refs = refs - 'lyrics_offset' - 'offset_hint_dismissed'
where kind = 'musica' and (refs ? 'lyrics_offset' or refs ? 'offset_hint_dismissed');

create function public.set_lyrics_sync(p_work uuid, p_sync jsonb)
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_sync) is distinct from 'object'
    or p_sync->>'v' is distinct from '1'
    or jsonb_typeof(p_sync->'anchors') is distinct from 'array'
    or jsonb_array_length(p_sync->'anchors') > 64
    or jsonb_typeof(p_sync->'rate') is distinct from 'number'
    or (p_sync->>'rate')::numeric not between 0.9 and 1.1
    or pg_column_size(p_sync) > 16384
  then
    raise exception 'invalid_sync';
  end if;

  update public.works set refs = refs || jsonb_build_object('lyrics_sync', p_sync)
  where id = p_work and user_id = auth.uid() and kind = 'musica' and deleted_at is null;
  if not found then raise exception 'work_not_found'; end if;
end;
$$;

revoke all on function public.set_lyrics_sync(uuid, jsonb) from public, anon;
grant execute on function public.set_lyrics_sync(uuid, jsonb) to authenticated;
