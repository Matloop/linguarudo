-- Músicas que o usuário já jogou, para listar "Tocadas recentemente".
-- Guarda só metadados (id do vídeo, título, artista, língua). Letra nunca vai para o banco:
-- ela é buscada na hora, no LRCLIB, a cada partida.

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  youtube_id text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  artist text not null check (char_length(btrim(artist)) between 1 and 200),
  lang public.word_lang not null,
  created_at timestamptz not null default now(),
  -- Última vez que o usuário abriu a música; ordena a lista de recentes.
  played_at timestamptz not null default now()
);

-- A mesma música não entra duas vezes na lista do mesmo usuário.
create unique index songs_user_youtube_key on public.songs (user_id, youtube_id);
create index songs_user_played_idx on public.songs (user_id, played_at desc);

alter table public.songs enable row level security;

revoke all on public.songs from anon, authenticated;
grant select, insert, update, delete on public.songs to authenticated;

create policy "dono lê as próprias músicas" on public.songs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono adiciona músicas" on public.songs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono edita as próprias músicas" on public.songs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga as próprias músicas" on public.songs
  for delete to authenticated using ((select auth.uid()) = user_id);
