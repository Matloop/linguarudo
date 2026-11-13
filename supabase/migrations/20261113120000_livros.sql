-- Livros com blend (docs/sync/CONTRACT.md, seção 13).
--
--   1. A pessoa envia um EPUB em /livros. O original fica no bucket privado "books", em
--      <user_id>/<book_id>/original.epub, guardado para gerar de novo.
--   2. book_chapters: um por capítulo do spine, com as candidatas que a IA propôs (o
--      navegador conduz, um pedaço por vez; fechar a aba e voltar retoma do que falta).
--   3. book_versions: cada geração é um arquivo v<N>.epub com o koHash (seção 9) desta
--      versão. Todas as versões apontam para a mesma obra (books.work_id); work_for procura
--      o koHash nas versões antes do ramo kosync:.
--   4. book_progress: a posição mais nova do livro (aparelho ou leitor web). Quem leu por
--      último vence, também em escrita direta na tabela (gatilho).
--   5. GET /api/v1/sync/books e a operação progress do push (funções api_sync_*).
--   6. Encontro salvo pelo leitor web: origin 'leitor'.

-- ---------- Tabelas ----------

create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200 and title = btrim(title)),
  author text not null default '' check (char_length(author) <= 200),
  -- Língua do texto e das traduções nos links (dc:language do OPF, editável).
  book_language public.language_code not null,
  -- Idioma de estudo que os links #lb: ensinam.
  language public.language_code not null,
  -- Parte das palavras trocadas (0–50%).
  coverage real not null default 0.1 check (coverage between 0 and 0.5),
  -- Intervalo do blend em índices do spine (inclusive).
  range_from integer not null default 0 check (range_from >= 0),
  range_to integer not null default 0 check (range_to >= range_from),
  on_device boolean not null default true,
  work_id uuid,
  original_path text not null,
  original_size integer not null check (original_size between 1 and 52428800),
  current_version integer check (current_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (original_path = user_id::text || '/' || id::text || '/original.epub'),
  foreign key (work_id, user_id) references public.works (id, user_id) on delete set null (work_id)
);

create index books_user_idx on public.books (user_id, updated_at desc);

create trigger books_touch before update on public.books
  for each row execute function public.touch_updated_at();

create table public.book_chapters (
  book_id uuid not null references public.books (id) on delete cascade,
  spine integer not null check (spine >= 0),
  title text not null default '' check (char_length(title) <= 200),
  words integer not null default 0 check (words >= 0),
  status text not null default 'pendente' check (status in ('pendente', 'feito', 'erro')),
  -- { parts, coverage, byPart: { "<i>": [ { para, form, target, lemma, translation, note } ] } }
  candidates jsonb check (candidates is null or jsonb_typeof(candidates) = 'object'),
  error text check (char_length(error) <= 500),
  updated_at timestamptz not null default now(),
  primary key (book_id, spine)
);

create trigger book_chapters_touch before update on public.book_chapters
  for each row execute function public.touch_updated_at();

create table public.book_versions (
  book_id uuid not null,
  user_id uuid not null,
  version integer not null check (version >= 1),
  path text not null,
  ko_hash text not null check (ko_hash ~ '^[0-9a-f]{32}$'),
  size integer not null check (size >= 0),
  created_at timestamptz not null default now(),
  primary key (book_id, version),
  check (path = user_id::text || '/' || book_id::text || '/v' || version::text || '.epub'),
  foreign key (book_id, user_id) references public.books (id, user_id) on delete cascade
);

create index book_versions_hash_idx on public.book_versions (user_id, ko_hash);

create table public.book_progress (
  book_id uuid primary key,
  user_id uuid not null,
  spine integer not null check (spine >= 0),
  chapter_percent real not null default 0 check (chapter_percent between 0 and 100),
  percent real not null default 0 check (percent between 0 and 100),
  at timestamptz not null,
  source text not null check (source in ('device', 'web')),
  foreign key (book_id, user_id) references public.books (id, user_id) on delete cascade
);

-- Quem leu por último vence: uma posição mais velha não sobrescreve a guardada, nem por
-- escrita direta (o leitor web pode fazer upsert). `at` no futuro vale como agora.
create function public.book_progress_newer() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.at := least(new.at, now());
  if tg_op = 'UPDATE' and new.at <= old.at then return old; end if;
  return new;
end;
$$;
revoke all on function public.book_progress_newer() from public, anon, authenticated;

create trigger book_progress_newer before insert or update on public.book_progress
  for each row execute function public.book_progress_newer();

-- ---------- RLS ----------

alter table public.books enable row level security;
alter table public.book_chapters enable row level security;
alter table public.book_versions enable row level security;
alter table public.book_progress enable row level security;
revoke all on public.books, public.book_chapters, public.book_versions, public.book_progress
  from anon, authenticated;

grant select, delete on public.books to authenticated;
grant update (title, author, book_language, language, coverage, range_from, range_to, on_device, current_version)
  on public.books to authenticated;
create policy "dono lê os próprios livros" on public.books
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono edita os próprios livros" on public.books
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga os próprios livros" on public.books
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select on public.book_chapters to authenticated;
grant update (status, candidates, error) on public.book_chapters to authenticated;
create policy "dono lê os capítulos" on public.book_chapters
  for select to authenticated
  using (exists (select 1 from public.books b where b.id = book_id and b.user_id = (select auth.uid())));
create policy "dono edita os capítulos" on public.book_chapters
  for update to authenticated
  using (exists (select 1 from public.books b where b.id = book_id and b.user_id = (select auth.uid())))
  with check (exists (select 1 from public.books b where b.id = book_id and b.user_id = (select auth.uid())));

grant select, insert on public.book_versions to authenticated;
create policy "dono lê as versões" on public.book_versions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria versões" on public.book_versions
  for insert to authenticated with check ((select auth.uid()) = user_id);

grant select, insert, update on public.book_progress to authenticated;
create policy "dono lê a posição" on public.book_progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono grava a posição" on public.book_progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono atualiza a posição" on public.book_progress
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- Criar ----------

-- Cria o livro (com a obra) e os capítulos depois que o navegador subiu o original.
-- p_chapters: [ { spine, title, words } ] na ordem do spine.
create function public.create_book(
  p_id uuid, p_title text, p_author text, p_book_language text, p_language text,
  p_original_size integer, p_chapters jsonb
) returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_work uuid;
  v_last integer;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_chapters) <> 'array' or jsonb_array_length(p_chapters) = 0 then
    raise exception 'bad_request';
  end if;
  v_work := public.work_for(v_user, jsonb_build_object(
    'kind', 'livro', 'title', p_title, 'subtitle', coalesce(p_author, ''), 'language', p_book_language));
  select max((c ->> 'spine')::integer) into v_last from jsonb_array_elements(p_chapters) c;

  insert into public.books (id, user_id, title, author, book_language, language, range_from, range_to,
    work_id, original_path, original_size)
  values (p_id, v_user, p_title, coalesce(p_author, ''), p_book_language::public.language_code,
    p_language::public.language_code, 0, v_last, v_work,
    v_user::text || '/' || p_id::text || '/original.epub', p_original_size);

  insert into public.book_chapters (book_id, spine, title, words)
  select p_id, (c ->> 'spine')::integer, left(coalesce(c ->> 'title', ''), 200), (c ->> 'words')::integer
  from jsonb_array_elements(p_chapters) c;
  return p_id;
end;
$$;
revoke all on function public.create_book(uuid, text, text, text, text, integer, jsonb) from public, anon;
grant execute on function public.create_book(uuid, text, text, text, text, integer, jsonb) to authenticated;

-- Posição do leitor web: mesma regra do aparelho. current = esta posição virou a do livro.
create function public.save_book_progress(
  p_book uuid, p_spine integer, p_chapter_percent real, p_percent real, p_at timestamptz
) returns boolean
  language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_at timestamptz;
begin
  insert into public.book_progress (book_id, user_id, spine, chapter_percent, percent, at, source)
  values (p_book, (select auth.uid()), p_spine, p_chapter_percent, p_percent, p_at, 'web')
  on conflict (book_id) do update set
    spine = excluded.spine, chapter_percent = excluded.chapter_percent,
    percent = excluded.percent, at = excluded.at, source = excluded.source
  returning at into v_at;
  return v_at = least(p_at, now());
end;
$$;
revoke all on function public.save_book_progress(uuid, integer, real, real, timestamptz) from public, anon;
grant execute on function public.save_book_progress(uuid, integer, real, real, timestamptz) to authenticated;

-- ---------- Bucket ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('books', 'books', false, 52428800, array['application/epub+zip'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.valid_book_path(p_user uuid, p_path text) returns boolean
  language sql immutable set search_path = '' as $$
  select p_path ~ ('^' || p_user::text || '/[0-9a-f-]{36}/(original|v[0-9]+)\.epub$');
$$;

create policy "dono lê os próprios livros" on storage.objects
  for select to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "dono envia livros" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'books' and public.valid_book_path((select auth.uid()), name));

create policy "dono troca os próprios livros" on storage.objects
  for update to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'books' and public.valid_book_path((select auth.uid()), name));

create policy "dono apaga os próprios livros" on storage.objects
  for delete to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- O aparelho baixa por URL assinada (contrato, seção 13), mas as rotas /api/v1 não têm
-- sessão nem service key: assinar exige poder ler o objeto. api_sync_books libera por
-- 2 minutos só os caminhos que vai devolver, e a rota assina como anon nessa janela.
create table public.book_signing (
  path text primary key,
  until timestamptz not null
);
alter table public.book_signing enable row level security;
revoke all on public.book_signing from anon, authenticated;

create function public.book_signable(p_path text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.book_signing s where s.path = p_path and s.until > now());
$$;
revoke all on function public.book_signable(text) from public;
grant execute on function public.book_signable(text) to anon;

create policy "aparelho assina o livro liberado" on storage.objects
  for select to anon
  using (bucket_id = 'books' and public.book_signable(name));

-- ---------- Obra ----------

-- Igual à anterior, mais: um ko_hash de uma versão de livro da conta devolve a obra do livro.
create or replace function public.work_for(p_user uuid, p_work jsonb) returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_kind text := p_work ->> 'kind';
  v_title text := p_work ->> 'title';
  v_subtitle text := coalesce(p_work ->> 'subtitle', '');
  v_refs jsonb := coalesce(p_work -> 'refs', '{}');
  v_key text;
begin
  if p_work ? 'id' then
    select w.id into v_id from public.works w
      where w.id = (p_work ->> 'id')::uuid and w.user_id = p_user and w.deleted_at is null;
    if not found then raise exception 'bad_request'; end if;
    return v_id;
  end if;

  if v_kind = 'livro' and v_refs ? 'ko_hash' then
    select b.work_id into v_id
      from public.book_versions v
      join public.books b on b.id = v.book_id
      join public.works w on w.id = b.work_id and w.deleted_at is null
      where v.user_id = p_user and v.ko_hash = v_refs ->> 'ko_hash'
      order by v.created_at desc
      limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  -- Mesma conta da coluna gerada ref_key.
  v_key := case
    when v_refs ? 'youtube_id' then 'youtube:' || (v_refs ->> 'youtube_id')
    when v_refs ? 'imdb_id' then 'imdb:' || (v_refs ->> 'imdb_id')
      || coalesce(':' || (v_refs ->> 'season') || ':' || (v_refs ->> 'episode'), '')
    when v_refs ? 'ko_hash' then 'kosync:' || (v_refs ->> 'ko_hash')
    when v_refs ? 'path' then 'path:' || (v_refs ->> 'path')
  end;

  select w.id into v_id from public.works w
    where w.user_id = p_user and w.kind = v_kind and w.deleted_at is null
      and (case when v_key is null
        then w.ref_key is null and w.title = v_title and w.subtitle = v_subtitle
        else w.ref_key = v_key end);
  if found then
    -- Título e subtítulo mais novos vencem (o YouTube corrige, o Stremio dá o nome do episódio).
    update public.works set title = v_title, subtitle = v_subtitle
      where id = v_id and (title, subtitle) is distinct from (v_title, v_subtitle);
    return v_id;
  end if;

  insert into public.works (user_id, kind, title, subtitle, refs, language)
  values (p_user, v_kind, v_title, v_subtitle, v_refs, (p_work ->> 'language')::public.language_code)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.work_for(uuid, jsonb) from public, anon, authenticated;

-- ---------- Encontro do leitor web ----------

alter table public.encounters drop constraint encounters_origin_check;
alter table public.encounters add constraint encounters_origin_check
  check (origin in ('manual', 'stremio', 'musica', 'ereader', 'anki', 'blend', 'leitor'));

-- ---------- Sync ----------

alter table public.sync_ops drop constraint sync_ops_type_check;
alter table public.sync_ops add constraint sync_ops_type_check
  check (type in ('save', 'review', 'seen', 'extraNew', 'deckImport', 'progress'));

-- Lista do aparelho: livros com "No aparelho" e uma versão pronta, por updated_at, até 200.
-- Conta no limite de pedidos por minuto. Libera a assinatura dos arquivos (book_signing).
create function public.api_sync_books(p_token text) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  v_books jsonb;
begin
  select * into v from public.sync_token_begin(p_token);
  if v.user_id is null then raise exception 'invalid_token'; end if;
  if v.retry_after is not null then return jsonb_build_object('rateLimited', v.retry_after); end if;

  select coalesce(jsonb_agg(row_to_json(r) order by r.updated_at desc), '[]') into v_books from (
    select b.id, b.title, b.author, b.book_language, b.language, b.updated_at,
      bv.version, bv.size, bv.ko_hash, bv.path,
      (select jsonb_build_object('spine', p.spine, 'chapterPercent', p.chapter_percent,
          'percent', p.percent, 'at', p.at, 'source', p.source)
        from public.book_progress p where p.book_id = b.id) as progress
    from public.books b
    join public.book_versions bv on bv.book_id = b.id and bv.version = b.current_version
    where b.user_id = v.user_id and b.on_device
    order by b.updated_at desc
    limit 200
  ) r;

  delete from public.book_signing where until <= now();
  insert into public.book_signing (path, until)
  select x ->> 'path', now() + interval '2 minutes' from jsonb_array_elements(v_books) x
  on conflict (path) do update set until = excluded.until;

  return jsonb_build_object('books', v_books);
end;
$$;

-- progress: acha o livro pelo koHash de qualquer versão; a mais nova (at) vence.
create function public.api_sync_progress(
  p_token text, p_client_id uuid, p_at timestamptz, p_ko_hash text,
  p_spine integer, p_chapter_percent real, p_percent real
) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_prior jsonb;
  v_book uuid;
  v_at timestamptz := least(p_at, now());
  v_stored timestamptz;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, 'progress');
  if v_prior is not null then return public.sync_prior(v_prior); end if;

  select v.book_id into v_book from public.book_versions v
    where v.user_id = v_user and v.ko_hash = p_ko_hash
    order by v.created_at desc limit 1;
  if v_book is null then
    return public.sync_finish(v_user, p_client_id,
      jsonb_build_object('status', 'dropped', 'reason', 'unknown_book'));
  end if;

  insert into public.book_progress (book_id, user_id, spine, chapter_percent, percent, at, source)
  values (v_book, v_user, p_spine, p_chapter_percent, p_percent, v_at, 'device')
  on conflict (book_id) do update set
    spine = excluded.spine, chapter_percent = excluded.chapter_percent,
    percent = excluded.percent, at = excluded.at, source = excluded.source
  returning at into v_stored;

  return public.sync_finish(v_user, p_client_id, jsonb_build_object(
    'status', 'applied', 'bookId', v_book, 'current', v_stored = v_at));
end;
$$;

revoke all on function public.api_sync_books(text) from public;
revoke all on function public.api_sync_progress(text, uuid, timestamptz, text, integer, real, real) from public;
grant execute on function public.api_sync_books(text) to anon, authenticated;
grant execute on function public.api_sync_progress(text, uuid, timestamptz, text, integer, real, real) to anon, authenticated;
