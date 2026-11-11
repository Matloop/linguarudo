-- Sincronia da letra no jogo de música.
--
-- Clipes e versões ao vivo começam a música mais tarde (ou mais cedo) que a faixa
-- do LRCLIB. O deslocamento que o usuário acerta fica na obra dele, em
-- refs.lyrics_offset (segundos, positivo = a letra entra mais tarde no vídeo).
-- refs.offset_hint_dismissed guarda que ele ignorou o palpite pela duração.
--
-- O usuário só pode dar UPDATE em played_at; refs carrega a identidade da obra
-- (youtube_id → ref_key), então a escrita passa por esta função, que só mexe nas
-- duas chaves da sincronia.

create function public.set_lyrics_sync(
  p_work uuid, p_offset numeric default null, p_hint_dismissed boolean default null
)
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_patch jsonb := '{}';
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_offset is not null then
    if p_offset < -300 or p_offset > 300 then raise exception 'offset_out_of_range'; end if;
    v_patch := v_patch || jsonb_build_object('lyrics_offset', round(p_offset, 1));
  end if;
  if p_hint_dismissed is not null then
    v_patch := v_patch || jsonb_build_object('offset_hint_dismissed', p_hint_dismissed);
  end if;

  update public.works set refs = refs || v_patch
  where id = p_work and user_id = auth.uid() and kind = 'musica' and deleted_at is null;
  if not found then raise exception 'work_not_found'; end if;
end;
$$;

revoke all on function public.set_lyrics_sync(uuid, numeric, boolean) from public, anon;
grant execute on function public.set_lyrics_sync(uuid, numeric, boolean) to authenticated;
