-- Banco do Linguarudo no modelo de domínio (CONTEXT.md): itens, obras, encontros,
-- cartões e revisões, mais configurações e tokens de integração.
--
-- Regras gerais:
-- - Toda tabela tem dono (user_id) e RLS. As chaves estrangeiras compostas (id, user_id)
--   impedem que um encontro, cartão ou revisão aponte para algo de outro usuário.
-- - Escritas que precisam ser atômicas passam por funções. O app (sessão) chama as sem
--   prefixo; as integrações (token) chamam as api_*. As duas usam o mesmo núcleo.
-- - O FSRS roda no app (ts-fsrs, apps/web/src/lib/server/scheduler.ts). O banco guarda o
--   log de revisões e o cronograma que o servidor calculou a partir dele (ADR 0001).
-- - Apagar é marcar deleted_at: a etapa de sync precisa mandar as exclusões aos aparelhos.

-- ---------- Idiomas ----------

-- ISO 639-1. Lista curada; para abrir um idioma novo, mude aqui e em apps/web/src/lib/languages.ts.
create domain public.language_code as text
  check (value in ('en', 'it', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'zh', 'nl', 'ru'));

-- updated_at de toda tabela que o usuário edita.
create function public.touch_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

-- ---------- Configurações ----------

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  native_language public.language_code not null default 'pt',
  study_languages public.language_code[] not null default '{en,it}'
    check (cardinality(study_languages) between 1 and 11),
  new_cards_per_day integer not null default 10 check (new_cards_per_day between 0 and 1000),
  updated_at timestamptz not null default now()
);

create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

alter table public.user_settings enable row level security;
revoke all on public.user_settings from anon, authenticated;
grant select on public.user_settings to authenticated;
grant update (native_language, study_languages, new_cards_per_day) on public.user_settings to authenticated;

create policy "dono lê as próprias configurações" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono edita as próprias configurações" on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Todo usuário tem uma linha, criada no cadastro. Assim ninguém repete os padrões no código.
create function public.create_user_settings() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_user_settings() from public, anon, authenticated;

create trigger auth_users_create_settings after insert on auth.users
  for each row execute function public.create_user_settings();

insert into public.user_settings (user_id) select id from auth.users on conflict (user_id) do nothing;

-- ---------- Itens ----------

-- Palavra ou expressão, identificada pelo lema. "Visto" é um contador aqui, não um encontro:
-- o Stremio só sabe que o lema apareceu numa legenda, sem frase nem intenção do usuário.
create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  language public.language_code not null,
  lemma text not null check (char_length(lemma) between 1 and 80 and lemma = btrim(lemma)),
  -- Sentido principal, na língua nativa. Cada encontro pode ter o seu.
  sense text not null default '' check (char_length(sense) <= 200),
  note text not null default '' check (char_length(note) <= 2000),
  ipa text not null default '' check (char_length(ipa) <= 100),
  part_of_speech text not null default '' check (char_length(part_of_speech) <= 80),
  -- 'conhecido': o usuário declarou que já sabe; sai da revisão e das atividades.
  status text not null default 'ativo' check (status in ('ativo', 'conhecido')),
  seen_count integer not null default 0 check (seen_count >= 0),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id)
);

-- O mesmo lema não entra duas vezes no mesmo idioma (ignora maiúsculas). Apagado não conta.
create unique index items_lemma_key on public.items (user_id, language, lower(lemma)) where deleted_at is null;
create index items_user_created_idx on public.items (user_id, created_at desc) where deleted_at is null;

create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

alter table public.items enable row level security;
revoke all on public.items from anon, authenticated;
-- Criar passa por save_items (item, encontro e obra juntos). Editar, marcar conhecido e
-- apagar (deleted_at) são updates diretos.
grant select on public.items to authenticated;
grant update (lemma, sense, note, ipa, part_of_speech, status, deleted_at) on public.items to authenticated;

create policy "dono lê os próprios itens" on public.items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono edita os próprios itens" on public.items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- Obras ----------

create table public.works (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('livro', 'episodio', 'filme', 'musica', 'video')),
  title text not null check (char_length(title) between 1 and 200 and title = btrim(title)),
  -- "T2E4", o artista, o autor.
  subtitle text not null default '' check (char_length(subtitle) <= 200),
  -- Referências externas: youtube_id, imdb_id (+ season, episode), path (e-reader).
  refs jsonb not null default '{}' check (
    jsonb_typeof(refs) = 'object'
    and pg_column_size(refs) <= 2000
    and (not refs ? 'youtube_id' or refs ->> 'youtube_id' ~ '^[A-Za-z0-9_-]{11}$')
    and (not refs ? 'imdb_id' or refs ->> 'imdb_id' ~ '^tt[0-9]{1,10}$')
  ),
  language public.language_code,
  -- Identidade estável a partir das refs, para não criar a mesma obra duas vezes.
  ref_key text generated always as (
    case
      when refs ? 'youtube_id' then 'youtube:' || (refs ->> 'youtube_id')
      when refs ? 'imdb_id' then 'imdb:' || (refs ->> 'imdb_id')
        || coalesce(':' || (refs ->> 'season') || ':' || (refs ->> 'episode'), '')
      when refs ? 'path' then 'path:' || (refs ->> 'path')
    end
  ) stored,
  -- Última vez que o usuário abriu a obra numa atividade (ordena "Tocadas recentemente").
  played_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  -- A música precisa do vídeo e do idioma da letra.
  check (kind <> 'musica' or (language is not null and refs ? 'youtube_id'))
);

create unique index works_ref_key on public.works (user_id, kind, ref_key)
  where ref_key is not null and deleted_at is null;
create index works_user_played_idx on public.works (user_id, kind, played_at desc) where deleted_at is null;

create trigger works_touch before update on public.works
  for each row execute function public.touch_updated_at();

alter table public.works enable row level security;
revoke all on public.works from anon, authenticated;
grant select on public.works to authenticated;
grant update (played_at) on public.works to authenticated;

create policy "dono lê as próprias obras" on public.works
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono edita as próprias obras" on public.works
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- Encontros ----------

create table public.encounters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null,
  work_id uuid,
  -- Grafia vista ("feste"), a frase como o usuário leu e o trecho dela a destacar.
  form text not null default '' check (char_length(form) <= 80),
  sentence text not null default '' check (char_length(sentence) <= 500),
  highlight text not null default '' check (char_length(highlight) <= 80),
  -- Sentido daquele uso, na língua nativa.
  sense text not null default '' check (char_length(sense) <= 200),
  -- Onde na obra: { seconds }, { page, chapter }...
  position jsonb not null default '{}' check (jsonb_typeof(position) = 'object' and pg_column_size(position) <= 500),
  origin text not null check (origin in ('manual', 'stremio', 'musica', 'ereader', 'anki', 'blend')),
  -- Gerado pelo cliente: reenviar o mesmo salvamento não duplica o encontro.
  client_id uuid,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, client_id),
  foreign key (item_id, user_id) references public.items (id, user_id) on delete cascade,
  foreign key (work_id, user_id) references public.works (id, user_id) on delete set null (work_id)
);

create index encounters_item_idx on public.encounters (item_id, seen_at desc) where deleted_at is null;
create index encounters_work_idx on public.encounters (work_id) where work_id is not null;

alter table public.encounters enable row level security;
revoke all on public.encounters from anon, authenticated;
grant select on public.encounters to authenticated;

create policy "dono lê os próprios encontros" on public.encounters
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------- Cartões ----------

-- Um cartão por direção de prática. Colunas de cronograma seguem o Card do ts-fsrs 6
-- (FSRS-7), em snake_case. Só funções escrevem aqui: o cronograma vem do log.
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('reconhecer', 'produzir')),
  due_at timestamptz not null default now(),
  stability double precision not null default 0,
  stability_fast double precision not null default 0,
  difficulty double precision not null default 0,
  state smallint not null default 0 check (state between 0 and 3),
  schedule_status text not null default 'new',
  last_review_at timestamptz,
  reps integer not null default 0,
  lapses integer not null default 0,
  scheduled_days double precision not null default 0,
  learning_step integer not null default 0,
  created_at timestamptz not null default now(),
  unique (item_id, kind),
  unique (id, user_id),
  foreign key (item_id, user_id) references public.items (id, user_id) on delete cascade
);

create index cards_user_due_idx on public.cards (user_id, due_at) where state > 0;
create index cards_user_new_idx on public.cards (user_id, created_at) where state = 0;

alter table public.cards enable row level security;
revoke all on public.cards from anon, authenticated;
grant select on public.cards to authenticated;

create policy "dono lê os próprios cartões" on public.cards
  for select to authenticated using ((select auth.uid()) = user_id);

-- O Reconhecer nasce com o item, venha de onde vier. O Produzir nasce em record_review.
create function public.create_recognize_card() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cards (item_id, user_id, kind, due_at, created_at)
  values (new.id, new.user_id, 'reconhecer', new.created_at, new.created_at)
  on conflict (item_id, kind) do nothing;
  return new;
end;
$$;
revoke all on function public.create_recognize_card() from public, anon, authenticated;

create trigger items_create_card after insert on public.items
  for each row execute function public.create_recognize_card();

-- ---------- Revisões ----------

create table public.review_logs (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 4),
  -- Momento da revisão no aparelho. O cronograma reaplica o log nessa ordem.
  reviewed_at timestamptz not null,
  -- Quando o servidor recebeu.
  received_at timestamptz not null default now(),
  -- Gerado pelo aparelho: a mesma revisão reenviada conta uma vez só.
  client_id uuid,
  unique (user_id, client_id),
  foreign key (card_id, user_id) references public.cards (id, user_id) on delete cascade
);

create index review_logs_card_time_idx on public.review_logs (card_id, reviewed_at);
create index review_logs_user_time_idx on public.review_logs (user_id, reviewed_at desc);

alter table public.review_logs enable row level security;
revoke all on public.review_logs from anon, authenticated;
grant select on public.review_logs to authenticated;

create policy "dono lê as próprias revisões" on public.review_logs
  for select to authenticated using ((select auth.uid()) = user_id);

-- Contagens para o "N para revisar" e o estado vazio. Só itens ativos e não apagados.
-- Novo feito hoje = cartão cuja primeira revisão é de hoje. p_day_start vem do app (o fuso
-- fica num ponto só, em review.ts).
create function public.review_counts(p_day_start timestamptz)
  returns table (due_now integer, new_available integer, new_done_today integer, new_limit integer, next_due_at timestamptz)
  language sql stable security invoker set search_path = '' as $$
  with active as (
    select c.* from public.cards c
    join public.items i on i.id = c.item_id
    where c.user_id = (select auth.uid()) and i.status = 'ativo' and i.deleted_at is null
  )
  select
    (select count(*)::integer from active where state > 0 and due_at <= now()),
    (select count(*)::integer from active where state = 0),
    (select count(distinct l.card_id)::integer from public.review_logs l
      where l.user_id = (select auth.uid()) and l.reviewed_at >= p_day_start
        and not exists (
          select 1 from public.review_logs p where p.card_id = l.card_id and p.reviewed_at < p_day_start
        )),
    (select s.new_cards_per_day from public.user_settings s where s.user_id = (select auth.uid())),
    (select min(due_at) from active where state > 0 and due_at > now());
$$;

-- Grava uma revisão e o cronograma que o app calculou reaplicando o log.
-- p_expected_reps é o reps do cartão que o app leu: se outra revisão entrou no meio, o
-- cálculo ficou velho (card_stale) e o app refaz. Revisão de item apagado é descartada
-- (a exclusão vence). Mesmo client_id: devolve a revisão que já existe, sem gravar de novo.
create function public.record_review(
  p_card_id uuid,
  p_expected_reps integer,
  p_rating smallint,
  p_reviewed_at timestamptz,
  p_next jsonb,
  p_unlock_produce boolean,
  p_client_id uuid default null
) returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_card public.cards;
  v_next public.cards;
  v_log uuid;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_client_id is not null then
    select l.id into v_log from public.review_logs l where l.user_id = v_user and l.client_id = p_client_id;
    if found then return v_log; end if;
  end if;

  select c.* into v_card from public.cards c
    join public.items i on i.id = c.item_id
    where c.id = p_card_id and c.user_id = v_user and i.deleted_at is null
    for update of c;
  if not found then raise exception 'card_not_found'; end if;
  if v_card.reps <> p_expected_reps then raise exception 'card_stale'; end if;

  insert into public.review_logs (card_id, user_id, rating, reviewed_at, client_id)
  values (v_card.id, v_user, p_rating, least(p_reviewed_at, now()), p_client_id)
  returning id into v_log;

  v_next := jsonb_populate_record(v_card, p_next);
  update public.cards set
    due_at = v_next.due_at,
    stability = v_next.stability,
    stability_fast = v_next.stability_fast,
    difficulty = v_next.difficulty,
    state = v_next.state,
    schedule_status = v_next.schedule_status,
    last_review_at = v_next.last_review_at,
    reps = v_next.reps,
    lapses = v_next.lapses,
    scheduled_days = v_next.scheduled_days,
    learning_step = v_next.learning_step
  where id = v_card.id;

  if p_unlock_produce and v_card.kind = 'reconhecer' then
    insert into public.cards (item_id, user_id, kind)
    values (v_card.item_id, v_user, 'produzir')
    on conflict (item_id, kind) do nothing;
  end if;

  return v_log;
end;
$$;

-- Desfaz uma revisão: apaga o log e grava o cronograma reaplicado sem ela. Se o Produzir
-- deixou de valer e ainda não foi revisado, ele sai também.
create function public.undo_review(
  p_log_id uuid,
  p_expected_reps integer,
  p_next jsonb,
  p_drop_produce boolean
) returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_log public.review_logs;
  v_card public.cards;
  v_next public.cards;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_log from public.review_logs where id = p_log_id and user_id = v_user;
  if not found then raise exception 'log_not_found'; end if;

  select * into v_card from public.cards where id = v_log.card_id for update;
  if v_card.reps <> p_expected_reps then raise exception 'card_stale'; end if;

  delete from public.review_logs where id = v_log.id;

  v_next := jsonb_populate_record(v_card, p_next);
  update public.cards set
    due_at = v_next.due_at,
    stability = v_next.stability,
    stability_fast = v_next.stability_fast,
    difficulty = v_next.difficulty,
    state = v_next.state,
    schedule_status = v_next.schedule_status,
    last_review_at = v_next.last_review_at,
    reps = v_next.reps,
    lapses = v_next.lapses,
    scheduled_days = v_next.scheduled_days,
    learning_step = v_next.learning_step
  where id = v_card.id;

  if p_drop_produce and v_card.kind = 'reconhecer' then
    delete from public.cards c
      where c.item_id = v_card.item_id and c.kind = 'produzir'
        and not exists (select 1 from public.review_logs l where l.card_id = c.id);
  end if;

  return v_card.id;
end;
$$;

revoke all on function public.review_counts(timestamptz) from public, anon;
revoke all on function public.record_review(uuid, integer, smallint, timestamptz, jsonb, boolean, uuid) from public, anon;
revoke all on function public.undo_review(uuid, integer, jsonb, boolean) from public, anon;
grant execute on function public.review_counts(timestamptz) to authenticated;
grant execute on function public.record_review(uuid, integer, smallint, timestamptz, jsonb, boolean, uuid) to authenticated;
grant execute on function public.undo_review(uuid, integer, jsonb, boolean) to authenticated;

-- ---------- Salvar: item, encontro e obra (núcleo comum) ----------

-- Acha a obra do usuário pelas refs (ou por tipo + título + subtítulo, sem refs), ou cria.
-- { "id": ... } usa uma obra que já existe. Interno: sem grant.
create function public.work_for(p_user uuid, p_work jsonb) returns uuid
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

  -- Mesma conta da coluna gerada ref_key.
  v_key := case
    when v_refs ? 'youtube_id' then 'youtube:' || (v_refs ->> 'youtube_id')
    when v_refs ? 'imdb_id' then 'imdb:' || (v_refs ->> 'imdb_id')
      || coalesce(':' || (v_refs ->> 'season') || ':' || (v_refs ->> 'episode'), '')
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

-- Salva um lote (até 200): acha o item pelo lema ou cria, preenche os campos vazios do item,
-- e grava o encontro (com a obra) se veio um. O app valida os campos antes; os checks das
-- tabelas são a segunda trava. Uma linha por item de entrada, na mesma ordem.
--
-- Entrada: [{ language, lemma, sense?, note?, ipa?, part_of_speech?,
--            encounter?: { form?, sentence?, highlight?, sense?, position?, origin, seen_at?, client_id? },
--            work?: { id } | { kind, title, subtitle?, refs?, language? } }]
-- Interno: sem grant.
create function public.save_items_for(p_user uuid, p_items jsonb)
  returns table (item_id uuid, language text, lemma text, created boolean, encounter_id uuid, card_state smallint, card_due_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_in jsonb;
  v_enc jsonb;
  v_item uuid;
  v_created boolean;
  v_work uuid;
  v_encounter uuid;
  v_lang public.language_code;
  v_lemma text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'bad_request';
  end if;

  for v_in in select value from jsonb_array_elements(p_items) loop
    v_lang := (v_in ->> 'language')::public.language_code;
    v_lemma := v_in ->> 'lemma';
    v_enc := v_in -> 'encounter';
    v_encounter := null;

    insert into public.items (user_id, language, lemma, sense, note, ipa, part_of_speech)
    values (
      p_user, v_lang, v_lemma,
      coalesce(nullif(v_in ->> 'sense', ''), v_enc ->> 'sense', ''),
      coalesce(v_in ->> 'note', ''), coalesce(v_in ->> 'ipa', ''), coalesce(v_in ->> 'part_of_speech', '')
    )
    on conflict (user_id, language, lower(lemma)) where deleted_at is null do nothing
    returning id into v_item;
    v_created := v_item is not null;

    if not v_created then
      select i.id into v_item from public.items i
        where i.user_id = p_user and i.language = v_lang and lower(i.lemma) = lower(v_lemma)
          and i.deleted_at is null;
      -- O que o item ainda não tem vem da entrada; o que o usuário já escreveu fica.
      update public.items i set
        sense = case when i.sense = '' then coalesce(nullif(v_in ->> 'sense', ''), v_enc ->> 'sense', '') else i.sense end,
        note = case when i.note = '' then coalesce(v_in ->> 'note', '') else i.note end,
        ipa = case when i.ipa = '' then coalesce(v_in ->> 'ipa', '') else i.ipa end,
        part_of_speech = case when i.part_of_speech = '' then coalesce(v_in ->> 'part_of_speech', '') else i.part_of_speech end
      where i.id = v_item
        and ((i.sense = '' and coalesce(nullif(v_in ->> 'sense', ''), v_enc ->> 'sense', '') <> '')
          or (i.note = '' and coalesce(v_in ->> 'note', '') <> '')
          or (i.ipa = '' and coalesce(v_in ->> 'ipa', '') <> '')
          or (i.part_of_speech = '' and coalesce(v_in ->> 'part_of_speech', '') <> ''));
    end if;

    if v_enc is not null then
      v_work := case when v_in ? 'work' then public.work_for(p_user, v_in -> 'work') end;
      insert into public.encounters (
        user_id, item_id, work_id, form, sentence, highlight, sense, position, origin, client_id, seen_at
      ) values (
        p_user, v_item, v_work,
        coalesce(v_enc ->> 'form', ''), coalesce(v_enc ->> 'sentence', ''),
        coalesce(v_enc ->> 'highlight', ''), coalesce(v_enc ->> 'sense', ''),
        coalesce(v_enc -> 'position', '{}'), v_enc ->> 'origin', (v_enc ->> 'client_id')::uuid,
        least(coalesce((v_enc ->> 'seen_at')::timestamptz, now()), now())
      )
      on conflict (user_id, client_id) do nothing
      returning id into v_encounter;
      if v_encounter is null then
        select e.id into v_encounter from public.encounters e
          where e.user_id = p_user and e.client_id = (v_enc ->> 'client_id')::uuid;
      end if;
    end if;

    return query
      select v_item, v_lang::text, i.lemma, v_created, v_encounter, c.state, c.due_at
      from public.items i
      join public.cards c on c.item_id = i.id and c.kind = 'reconhecer'
      where i.id = v_item;
  end loop;
end;
$$;
revoke all on function public.save_items_for(uuid, jsonb) from public, anon, authenticated;

-- Versões do app (sessão): o dono é auth.uid().
create function public.save_items(p_items jsonb)
  returns table (item_id uuid, language text, lemma text, created boolean, encounter_id uuid, card_state smallint, card_due_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query select * from public.save_items_for(auth.uid(), p_items);
end;
$$;

-- Abre uma obra numa atividade (a música): acha ou cria e marca played_at.
create function public.open_work(p_work jsonb) returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_id := public.work_for(auth.uid(), p_work);
  update public.works set played_at = now() where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.save_items(jsonb) from public, anon;
revoke all on function public.open_work(jsonb) from public, anon;
grant execute on function public.save_items(jsonb) to authenticated;
grant execute on function public.open_work(jsonb) to authenticated;

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

-- ---------- API v1 (integrações com token) ----------

-- Quem é o dono do token e o que ele estuda.
create function public.api_me(p_token text)
  returns table (email text, native_language text, study_languages text[])
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query
    select u.email::text, s.native_language::text, s.study_languages::text[]
    from auth.users u join public.user_settings s on s.user_id = u.id
    where u.id = v_user;
end;
$$;

-- Itens não apagados de um idioma, com os cartões (para o selo "No seu banco" e o preferWords).
create function public.api_items(p_token text, p_language text)
  returns table (id uuid, lemma text, sense text, status text, cards jsonb)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query
    select i.id, i.lemma, i.sense, i.status,
      coalesce((select jsonb_agg(jsonb_build_object(
          'kind', c.kind, 'state', c.state, 'due_at', c.due_at, 'stability', c.stability
        ) order by c.kind desc)
        from public.cards c where c.item_id = i.id), '[]')
    from public.items i
    where i.user_id = v_user and i.language = p_language::public.language_code and i.deleted_at is null
    order by i.created_at desc
    limit 5000;
end;
$$;

create function public.api_save_items(p_token text, p_items jsonb)
  returns table (item_id uuid, language text, lemma text, created boolean, encounter_id uuid, card_state smallint, card_due_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  return query select * from public.save_items_for(v_user, p_items);
end;
$$;

-- "Visto": soma uma aparição e marca a hora. Não toca nos cartões.
create function public.api_mark_seen(p_token text, p_language text, p_lemmas text[])
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_count integer;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  if coalesce(array_length(p_lemmas, 1), 0) > 500 then raise exception 'bad_request'; end if;
  update public.items i set seen_count = i.seen_count + 1, last_seen_at = now()
    where i.user_id = v_user and i.language = p_language::public.language_code and i.deleted_at is null
      and lower(i.lemma) in (select lower(t) from unnest(p_lemmas) t);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- As rotas /api/v1 usam a chave publicável sem sessão (papel anon). Sem token válido,
-- as funções não fazem nada além de levantar invalid_token.
revoke all on function public.api_me(text) from public;
revoke all on function public.api_items(text, text) from public;
revoke all on function public.api_save_items(text, jsonb) from public;
revoke all on function public.api_mark_seen(text, text, text[]) from public;
grant execute on function public.api_me(text) to anon, authenticated;
grant execute on function public.api_items(text, text) to anon, authenticated;
grant execute on function public.api_save_items(text, jsonb) to anon, authenticated;
grant execute on function public.api_mark_seen(text, text, text[]) to anon, authenticated;
