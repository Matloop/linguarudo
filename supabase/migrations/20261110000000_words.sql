-- Banco de palavras: o núcleo do Linguarudo.
-- Cada palavra pertence a um usuário. A RLS garante que ninguém vê a palavra de outro.

create type public.word_lang as enum ('en', 'it');
create type public.word_source as enum ('manual', 'stremio', 'lesson', 'music');

create table public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lang public.word_lang not null,
  term text not null check (char_length(term) between 1 and 80 and term = btrim(term)),
  translation text not null default '' check (char_length(translation) <= 200),
  context text not null default '' check (char_length(context) <= 500),
  source public.word_source not null default 'manual',
  created_at timestamptz not null default now()
);

-- A mesma palavra não entra duas vezes no banco do mesmo usuário (ignora maiúsculas).
create unique index words_user_lang_term_key on public.words (user_id, lang, lower(term));
create index words_user_created_idx on public.words (user_id, created_at desc);

alter table public.words enable row level security;

-- Só usuário logado fala com a tabela; anon não tem nem privilégio (a RLS é a segunda trava).
revoke all on public.words from anon, authenticated;
grant select, insert, update, delete on public.words to authenticated;

create policy "dono lê as próprias palavras" on public.words
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono adiciona palavras" on public.words
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono edita as próprias palavras" on public.words
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga as próprias palavras" on public.words
  for delete to authenticated using ((select auth.uid()) = user_id);
