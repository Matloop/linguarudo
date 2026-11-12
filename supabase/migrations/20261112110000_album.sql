-- Álbum: uma playlist do YouTube jogada faixa a faixa.
--
-- A obra 'album' guarda em refs a playlist (playlist_id), os ids das obras 'musica'
-- de cada faixa, na ordem (tracks), e a faixa aberta por último (position). Cada
-- faixa é uma obra 'musica' comum: letra, sincronia e encontros ficam nela.
-- O usuário só dá UPDATE em played_at, então criar e avançar passam por funções.

alter table public.works drop constraint works_kind_check;
alter table public.works add constraint works_kind_check
  check (kind in ('livro', 'episodio', 'filme', 'musica', 'video', 'album'));

-- 50 uuids passam dos 2000 bytes do teto geral de refs.
alter table public.works drop constraint works_refs_check;
alter table public.works add constraint works_refs_check check (
  jsonb_typeof(refs) = 'object'
  and pg_column_size(refs) <= case when kind = 'album' then 4000 else 2000 end
  and (not refs ? 'youtube_id' or refs ->> 'youtube_id' ~ '^[A-Za-z0-9_-]{11}$')
  and (not refs ? 'imdb_id' or refs ->> 'imdb_id' ~ '^tt[0-9]{1,10}$')
);
alter table public.works add constraint works_album_check check (
  kind <> 'album' or (
    refs ->> 'playlist_id' ~ '^[A-Za-z0-9_-]{10,64}$'
    and jsonb_typeof(refs -> 'tracks') = 'array'
    and jsonb_array_length(refs -> 'tracks') between 1 and 50
  )
);

-- p_album: { title, subtitle, language, playlist_id,
--            tracks: [{ youtube_id, title, subtitle, language }] }.
-- A mesma playlist reaproveita o álbum (faixas novas substituem as antigas).
create or replace function public.open_album(p_album jsonb)
  returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_list text := p_album ->> 'playlist_id';
  v_tracks jsonb := '[]';
  v_track jsonb;
  v_id uuid;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_album -> 'tracks') is distinct from 'array'
    or jsonb_array_length(p_album -> 'tracks') not between 1 and 50
  then
    raise exception 'bad_request';
  end if;

  for v_track in select * from jsonb_array_elements(p_album -> 'tracks') loop
    v_tracks := v_tracks || to_jsonb(public.work_for(v_user, jsonb_build_object(
      'kind', 'musica',
      'title', v_track ->> 'title',
      'subtitle', v_track ->> 'subtitle',
      'refs', jsonb_build_object('youtube_id', v_track ->> 'youtube_id'),
      'language', v_track ->> 'language'
    )));
  end loop;

  select w.id into v_id from public.works w
    where w.user_id = v_user and w.kind = 'album' and w.deleted_at is null
      and w.refs ->> 'playlist_id' = v_list;
  if found then
    update public.works
      set title = p_album ->> 'title', subtitle = coalesce(p_album ->> 'subtitle', ''),
        language = (p_album ->> 'language')::public.language_code,
        refs = jsonb_build_object('playlist_id', v_list, 'tracks', v_tracks, 'position', 0,
          'cover', p_album -> 'tracks' -> 0 ->> 'youtube_id'),
        played_at = now()
      where id = v_id;
    return v_id;
  end if;

  insert into public.works (user_id, kind, title, subtitle, refs, language, played_at)
  values (v_user, 'album', p_album ->> 'title', coalesce(p_album ->> 'subtitle', ''),
    jsonb_build_object('playlist_id', v_list, 'tracks', v_tracks, 'position', 0,
          'cover', p_album -> 'tracks' -> 0 ->> 'youtube_id'),
    (p_album ->> 'language')::public.language_code, now())
  returning id into v_id;
  return v_id;
end;
$$;

-- Abre a faixa p_position (0 = primeira) do álbum: guarda a posição e devolve a obra da faixa.
create or replace function public.open_album_track(p_album uuid, p_position int)
  returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_track uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.works
    set refs = jsonb_set(refs, '{position}', to_jsonb(p_position)), played_at = now()
    where id = p_album and user_id = auth.uid() and kind = 'album' and deleted_at is null
      and p_position between 0 and jsonb_array_length(refs -> 'tracks') - 1
    returning (refs -> 'tracks' ->> p_position)::uuid into v_track;
  if v_track is null then raise exception 'work_not_found'; end if;
  return v_track;
end;
$$;

revoke all on function public.open_album(jsonb) from public, anon;
revoke all on function public.open_album_track(uuid, int) from public, anon;
grant execute on function public.open_album(jsonb) to authenticated;
grant execute on function public.open_album_track(uuid, int) to authenticated;
