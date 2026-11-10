-- Integração com o fork LingoBlend do Stremio.
-- O fork fala com /api do app usando um token (Authorization: Bearer). O app não tem
-- service key: as rotas chamam funções security definer que validam o token pelo hash
-- e só tocam nas palavras do dono do token.

-- ---------- Palavras: dados que vêm da legenda ----------

-- O termo é o lema ("festa"); a forma vista ("feste") fica no contexto, e
-- context_highlight guarda o trecho exato do contexto para o Revisar destacar.
alter table public.words
  add column context_highlight text not null default '' check (char_length(context_highlight) <= 80),
  add column ipa text not null default '' check (char_length(ipa) <= 100),
  add column pos text not null default '' check (char_length(pos) <= 80),
  add column meaning text not null default '' check (char_length(meaning) <= 200),
  add column example text not null default '' check (char_length(example) <= 300),
  -- Origem: título do vídeo e segundo da cena ("Kaguya, 42:10").
  add column source_title text not null default '' check (char_length(source_title) <= 200),
  add column source_time_s integer check (source_time_s between 0 and 1000000),
  -- "Visto": a palavra apareceu numa legenda. Não mexe no agendamento do FSRS.
  add column seen_count integer not null default 0 check (seen_count >= 0),
  add column last_seen_at timestamptz;

-- ---------- Tokens de integração ----------

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null default 'Stremio' check (char_length(label) between 1 and 60),
  -- sha256 (hex) do token. O token em si só aparece uma vez, na hora de gerar.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Final do token, para o usuário reconhecer qual é qual.
  token_hint text not null check (char_length(token_hint) between 1 and 8),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index api_tokens_user_idx on public.api_tokens (user_id, created_at desc);

alter table public.api_tokens enable row level security;
revoke all on public.api_tokens from anon, authenticated;
-- O hash não volta para o navegador; revogar = apagar a linha.
grant select (id, user_id, label, token_hint, created_at, last_used_at) on public.api_tokens to authenticated;
grant insert (user_id, label, token_hash, token_hint) on public.api_tokens to authenticated;
grant delete on public.api_tokens to authenticated;

create policy "dono lê os próprios tokens" on public.api_tokens
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria tokens" on public.api_tokens
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono revoga os próprios tokens" on public.api_tokens
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Dono do token, ou null. Recebe o token cru e calcula o hash aqui: quem lê o hash
-- do banco não consegue usá-lo como credencial. Interno (sem grant).
create function public.api_token_owner(p_token text) returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_user uuid;
  v_last timestamptz;
begin
  if p_token is null or char_length(p_token) not between 20 and 200 then return null; end if;
  select t.id, t.user_id, t.last_used_at into v_id, v_user, v_last
    from public.api_tokens t
    where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then return null; end if;
  -- Uma escrita por minuto basta para "último uso".
  if v_last is null or v_last < now() - interval '1 minute' then
    update public.api_tokens set last_used_at = now() where id = v_id;
  end if;
  return v_user;
end;
$$;
revoke all on function public.api_token_owner(text) from public, anon, authenticated;

-- ---------- API do fork ----------

-- Quem é o dono do token (para o menu mostrar "Conectado como ...").
create function public.api_me(p_token text) returns table (email text)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query select u.email::text from auth.users u where u.id = v_user;
end;
$$;

-- Palavras do banco numa língua, com o estado do cartão (badge e preferências da legenda).
create function public.api_list_words(p_token text, p_lang public.word_lang)
  returns table (term text, translation text, state smallint, due_at timestamptz, paused boolean)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query
    select w.term, w.translation, c.state, c.due_at, c.paused
    from public.words w
    join public.cards c on c.word_id = w.id
    where w.user_id = v_user and w.lang = p_lang
    order by w.created_at desc
    limit 5000;
end;
$$;

-- Salva um lote (até 200). Duplicatas (user_id, lang, lower(term)) são puladas.
-- Devolve uma linha por item de entrada, com created = false para as que já existiam.
-- O app valida os campos antes; aqui os checks da tabela são a segunda trava.
create function public.api_save_words(p_token text, p_words jsonb)
  returns table (term text, lang public.word_lang, created boolean, state smallint, due_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_user uuid := public.api_token_owner(p_token);
  v_created uuid[];
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  if jsonb_typeof(p_words) is distinct from 'array' or jsonb_array_length(p_words) > 200 then
    raise exception 'bad_request';
  end if;

  with input as (
    select * from jsonb_to_recordset(p_words) as x(
      term text, lang public.word_lang, translation text, context text, context_highlight text,
      ipa text, pos text, meaning text, example text, source_title text, source_time_s integer,
      saved_at timestamptz
    )
  ), ins as (
    insert into public.words (
      user_id, lang, term, translation, context, context_highlight, source,
      ipa, pos, meaning, example, source_title, source_time_s, created_at
    )
    select
      v_user, i.lang, i.term, coalesce(i.translation, ''), coalesce(i.context, ''),
      coalesce(i.context_highlight, ''), 'stremio', coalesce(i.ipa, ''), coalesce(i.pos, ''),
      coalesce(i.meaning, ''), coalesce(i.example, ''), coalesce(i.source_title, ''),
      i.source_time_s, least(coalesce(i.saved_at, now()), now())
    from input i
    on conflict (user_id, lang, lower(term)) do nothing
    returning id
  )
  select coalesce(array_agg(ins.id), '{}') into v_created from ins;

  -- Outra instrução: enxerga as linhas inseridas acima e os cartões criados pelo trigger.
  return query
    select i.term, i.lang, w.id = any (v_created), c.state, c.due_at
    from rows from (jsonb_to_recordset(p_words) as (term text, lang public.word_lang))
      with ordinality as i(term, lang, n)
    join public.words w on w.user_id = v_user and w.lang = i.lang and lower(w.term) = lower(i.term)
    join public.cards c on c.word_id = w.id
    order by i.n;
end;
$$;

-- "Visto": soma uma aparição e marca a hora. Não toca em cards.
create function public.api_mark_seen(p_token text, p_lang public.word_lang, p_terms text[])
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_count integer;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  if coalesce(array_length(p_terms, 1), 0) > 500 then raise exception 'bad_request'; end if;
  update public.words w set seen_count = w.seen_count + 1, last_seen_at = now()
    where w.user_id = v_user and w.lang = p_lang
      and lower(w.term) in (select lower(t) from unnest(p_terms) t);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- As rotas /api usam a chave publicável sem sessão (papel anon). Sem token válido,
-- as funções não fazem nada além de levantar invalid_token.
revoke all on function public.api_me(text) from public;
revoke all on function public.api_list_words(text, public.word_lang) from public;
revoke all on function public.api_save_words(text, jsonb) from public;
revoke all on function public.api_mark_seen(text, public.word_lang, text[]) from public;
grant execute on function public.api_me(text) to anon, authenticated;
grant execute on function public.api_list_words(text, public.word_lang) to anon, authenticated;
grant execute on function public.api_save_words(text, jsonb) to anon, authenticated;
grant execute on function public.api_mark_seen(text, public.word_lang, text[]) to anon, authenticated;
