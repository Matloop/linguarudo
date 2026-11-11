-- Fatia 2 do ADR 0003: imagem e áudio em itens e fichas.
--
-- Os arquivos ficam no bucket privado "midia", em <user_id>/<sha256>.<ext>: o nome pelo
-- conteúdo deduplica de graça (o mesmo áudio em mil notas do Anki é um arquivo só) e
-- torna o reimport idempotente. O navegador comprime e manda direto para o Storage;
-- o banco guarda só o caminho. Cota de 200 MB por usuário, conferida no insert.

-- ---------- Bucket ----------

-- 1 MB por arquivo. Imagem chega sempre como WebP (o navegador converte); áudio nos
-- formatos que os decks do Anki costumam ter.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'midia', 'midia', false, 1048576,
  array['image/webp', 'audio/mpeg', 'audio/ogg', 'audio/opus', 'audio/mp4', 'audio/aac',
        'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/flac']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Caminho válido para o dono: imagem .webp ou áudio, nomeado pelo sha256 do conteúdo.
create function public.valid_media_path(p_user uuid, p_path text, p_kind text) returns boolean
  language sql immutable set search_path = '' as $$
  select p_path is null or p_path ~ (
    '^' || p_user::text || '/[0-9a-f]{64}\.'
    || case p_kind when 'image' then '(webp)' else '(mp3|ogg|oga|opus|m4a|aac|wav|webm|flac)' end
    || '$'
  );
$$;

-- Bytes que o usuário logado ocupa no bucket (a política de insert usa).
create function public.media_usage() returns bigint
  language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'midia' and o.name like (select auth.uid())::text || '/%';
$$;
revoke all on function public.media_usage() from public, anon;
grant execute on function public.media_usage() to authenticated;

-- Cota por usuário (bytes). Um arquivo pode passar do teto em até 1 MB: o insert confere
-- o que já está guardado, não o tamanho do que está chegando.
create function public.media_quota_bytes() returns bigint
  language sql immutable set search_path = '' as $$ select 200::bigint * 1024 * 1024 $$;

-- Para a interface: quanto o usuário logado usa e o teto.
create function public.media_quota(out used bigint, out quota bigint)
  language sql stable security definer set search_path = '' as $$
  select public.media_usage(), public.media_quota_bytes();
$$;
revoke all on function public.media_quota() from public, anon;
grant execute on function public.media_quota() to authenticated;

-- ---------- Políticas do bucket ----------

create policy "dono lê a própria mídia" on storage.objects
  for select to authenticated
  using (bucket_id = 'midia' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "dono envia mídia dentro da cota" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'midia'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.valid_media_path((select auth.uid()), name, case when name like '%.webp' then 'image' else 'audio' end)
    and public.media_usage() < public.media_quota_bytes()
  );

create policy "dono apaga a própria mídia" on storage.objects
  for delete to authenticated
  using (bucket_id = 'midia' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- Colunas ----------

-- O item tem no máximo uma imagem e um áudio de pronúncia.
alter table public.items
  add column image text check (public.valid_media_path(user_id, image, 'image')),
  add column audio text check (public.valid_media_path(user_id, audio, 'audio'));
grant update (image, audio) on public.items to authenticated;

-- A ficha tem imagem e áudio em cada lado.
alter table public.fichas
  add column front_image text check (public.valid_media_path(user_id, front_image, 'image')),
  add column front_audio text check (public.valid_media_path(user_id, front_audio, 'audio')),
  add column back_image text check (public.valid_media_path(user_id, back_image, 'image')),
  add column back_audio text check (public.valid_media_path(user_id, back_audio, 'audio'));
grant insert (front_image, front_audio, back_image, back_audio) on public.fichas to authenticated;
grant update (front_image, front_audio, back_image, back_audio) on public.fichas to authenticated;

-- Um arquivo ainda é usado por algum item ou ficha do dono? (antes de apagar do bucket)
create function public.media_in_use(p_paths text[]) returns text[]
  language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(distinct p), '{}') from (
    select unnest(array[i.image, i.audio]) p from public.items i
      where i.user_id = (select auth.uid()) and i.deleted_at is null
        and (i.image = any (p_paths) or i.audio = any (p_paths))
    union all
    select unnest(array[f.front_image, f.front_audio, f.back_image, f.back_audio]) p from public.fichas f
      where f.user_id = (select auth.uid()) and f.deleted_at is null
        and (f.front_image = any (p_paths) or f.front_audio = any (p_paths)
          or f.back_image = any (p_paths) or f.back_audio = any (p_paths))
  ) used where p = any (p_paths);
$$;
revoke all on function public.media_in_use(text[]) from public, anon;
grant execute on function public.media_in_use(text[]) to authenticated;

-- ---------- Preferência ----------

-- O áudio só toca sozinho na revisão se a pessoa ligar.
alter table public.user_settings add column autoplay_audio boolean not null default false;
grant update (autoplay_audio) on public.user_settings to authenticated;
