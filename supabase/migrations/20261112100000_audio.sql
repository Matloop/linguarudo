-- ADR 0005: áudio da palavra gerado no servidor (GET /audio).
--
-- Bucket público "audio", em <base do idioma>/<sha256 do texto>.<mp3|wav>: o mesmo
-- texto é um arquivo só para todos. O servidor envia com o cliente do usuário logado
-- (não há service key), então quem está logado pode inserir, só no formato da chave. Não há update nem delete:
-- o arquivo é imutável. A leitura pública vem de public = true.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', true, 2097152, array['audio/wav', 'audio/mpeg', 'audio/ogg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "logado envia áudio de palavra" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and name ~ '^[a-z]{2,3}/[0-9a-f]{64}\.(mp3|wav)$');
