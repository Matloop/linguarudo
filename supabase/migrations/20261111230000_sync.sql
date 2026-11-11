-- Sync com o e-reader (docs/sync/CONTRACT.md, protocolo 1; o que a seção 13 pede).
--   1. Pareamento por código (device_pairings) e tokens de aparelho em api_tokens.
--   2. Obra de livro pelo hash parcial do KOSync (refs.ko_hash, ref_key kosync:<hash>).
--   3. Encontro com posição de livro (chapter, spine, percent) e revisão com duration_ms.
--   4. sync_ops: cada clientId vale uma vez por usuário (save, review e seen) e guarda
--      o resultado para o "duplicate".
--   5. Funções api_sync_* (token) para o push e o snapshot, sync_pair_* para o pareamento.
--
-- O FSRS continua no app (ADR 0001): a revisão chega em duas etapas, api_sync_review_target
-- (lê o cartão e o log) e api_sync_review (grava o que o app calculou, com a checagem de reps).

-- ---------- Tokens de aparelho ----------

alter table public.api_tokens
  add column kind text not null default 'integracao' check (kind in ('integracao', 'aparelho')),
  add column device_model text not null default '' check (char_length(device_model) <= 40),
  -- Limite de pedidos de sync por token (janela fixa de 1 minuto).
  add column rate_window_at timestamptz,
  add column rate_count integer not null default 0;

comment on column public.api_tokens.kind is 'integracao: gerado em Integrações (Stremio); aparelho: nasce no pareamento.';

-- O navegador vê o tipo e o modelo; o insert pela sessão continua só com as colunas antigas
-- (nasce 'integracao'). Token de aparelho só nasce em sync_pair_poll.
grant select (kind, device_model) on public.api_tokens to authenticated;

-- ---------- Pareamento ----------

create table public.device_pairings (
  id uuid primary key default gen_random_uuid(),
  -- sha256 (hex) do deviceCode. O código em si só existe no aparelho.
  device_code_hash text not null unique check (device_code_hash ~ '^[0-9a-f]{64}$'),
  -- Código mostrado na tela, sem hífen ("K7Q4MP").
  user_code text not null check (user_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'),
  device_name text not null check (char_length(device_name) between 1 and 60),
  device_model text not null default '' check (char_length(device_model) <= 40),
  firmware text not null default '' check (char_length(firmware) <= 60),
  -- sha256 do IP de quem pediu (limites por IP), nunca o IP.
  client_ip_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'consumed', 'expired')),
  user_id uuid references auth.users (id) on delete cascade,
  token_id uuid references public.api_tokens (id) on delete set null,
  poll_interval integer not null default 5 check (poll_interval between 1 and 60),
  expires_at timestamptz not null,
  last_poll_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (status in ('pending', 'denied', 'expired') or user_id is not null)
);

-- O userCode é único entre os pendentes.
create unique index device_pairings_pending_code on public.device_pairings (user_code) where status = 'pending';
create index device_pairings_ip_idx on public.device_pairings (client_ip_hash, created_at);
create index device_pairings_created_idx on public.device_pairings (created_at);

-- Só funções tocam aqui (o aparelho é anônimo; a página /parear usa as funções da sessão).
alter table public.device_pairings enable row level security;
revoke all on public.device_pairings from anon, authenticated;

-- Começa um pareamento. O app gera o deviceCode e o userCode; aqui ficam os limites
-- (10 por hora e 5 pendentes por IP) e a faxina dos vencidos.
-- status: ok | rate_limited (com retry_after em segundos) | code_taken (o app sorteia outro).
create function public.sync_pair_start(
  p_device_code_hash text,
  p_user_code text,
  p_device_name text,
  p_device_model text,
  p_firmware text,
  p_ip_hash text,
  p_enforce_limits boolean default true
) returns table (status text, retry_after integer)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_oldest timestamptz;
  v_count integer;
begin
  update public.device_pairings p set status = 'expired'
    where p.status = 'pending' and p.expires_at <= now();
  delete from public.device_pairings p where p.created_at < now() - interval '1 day';

  -- Teto global, para quem chama a função direto sem passar pelo app.
  if (select count(*) from public.device_pairings p where p.status = 'pending') >= 10000 then
    return query select 'rate_limited'::text, 60;
    return;
  end if;

  if p_enforce_limits and p_ip_hash is not null then
    select count(*), min(p.created_at) into v_count, v_oldest from public.device_pairings p
      where p.client_ip_hash = p_ip_hash and p.created_at > now() - interval '1 hour';
    if v_count >= 10 then
      return query select 'rate_limited'::text,
        greatest(1, ceil(extract(epoch from v_oldest + interval '1 hour' - now()))::integer);
      return;
    end if;
    select count(*), min(p.expires_at) into v_count, v_oldest from public.device_pairings p
      where p.client_ip_hash = p_ip_hash and p.status = 'pending';
    if v_count >= 5 then
      return query select 'rate_limited'::text,
        greatest(1, ceil(extract(epoch from v_oldest - now()))::integer);
      return;
    end if;
  end if;

  if exists (select 1 from public.device_pairings p where p.user_code = p_user_code and p.status = 'pending') then
    return query select 'code_taken'::text, null::integer;
    return;
  end if;

  insert into public.device_pairings (device_code_hash, user_code, device_name, device_model, firmware, client_ip_hash, expires_at)
  values (p_device_code_hash, p_user_code, p_device_name, coalesce(p_device_model, ''), coalesce(p_firmware, ''),
    p_ip_hash, now() + interval '10 minutes');
  return query select 'ok'::text, null::integer;
exception when unique_violation then
  return query select 'code_taken'::text, null::integer;
end;
$$;

-- Poll do aparelho. Aprovado: grava o token (o app gerou; só o hash chega aqui) com o nome
-- do aparelho e marca o pareamento como usado. status: pending | slow_down | denied |
-- expired | approved. account vem só no approved.
create function public.sync_pair_poll(p_device_code_hash text, p_token_hash text, p_token_hint text)
  returns table (status text, poll_interval integer, device_name text, account jsonb)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v public.device_pairings;
  v_token uuid;
begin
  select * into v from public.device_pairings p where p.device_code_hash = p_device_code_hash for update;
  if not found or v.status in ('consumed', 'expired') then
    return query select 'expired'::text, null::integer, null::text, null::jsonb;
    return;
  end if;
  if v.expires_at <= now() then
    update public.device_pairings p set status = 'expired' where p.id = v.id and p.status = 'pending';
    return query select 'expired'::text, null::integer, null::text, null::jsonb;
    return;
  end if;

  if v.status = 'pending' then
    -- 1 s de folga para a latência da rede.
    if v.last_poll_at is not null and now() < v.last_poll_at + make_interval(secs => v.poll_interval - 1) then
      update public.device_pairings p set poll_interval = least(p.poll_interval + 5, 60), last_poll_at = now()
        where p.id = v.id returning p.poll_interval into v.poll_interval;
      return query select 'slow_down'::text, v.poll_interval, null::text, null::jsonb;
      return;
    end if;
    update public.device_pairings p set last_poll_at = now() where p.id = v.id;
    return query select 'pending'::text, v.poll_interval, null::text, null::jsonb;
    return;
  end if;

  if v.status = 'denied' then
    return query select 'denied'::text, null::integer, null::text, null::jsonb;
    return;
  end if;

  -- approved: o token nasce agora, uma vez só.
  insert into public.api_tokens (user_id, label, token_hash, token_hint, kind, device_model)
  values (v.user_id, v.device_name, p_token_hash, p_token_hint, 'aparelho', v.device_model)
  returning id into v_token;
  update public.device_pairings p set status = 'consumed', token_id = v_token where p.id = v.id;

  return query
    select 'approved'::text, null::integer, v.device_name,
      jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'nativeLanguage', coalesce(s.native_language::text, 'pt'),
        'studyLanguages', coalesce(to_jsonb(s.study_languages::text[]), '["en","it"]')
      )
    from auth.users u left join public.user_settings s on s.user_id = u.id
    where u.id = v.user_id;
end;
$$;

-- Pareamento pendente pelo código, para a página /parear (sessão).
create function public.sync_pair_lookup(p_user_code text)
  returns table (device_name text, device_model text, firmware text, created_at timestamptz, expires_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select p.device_name, p.device_model, p.firmware, p.created_at, p.expires_at
    from public.device_pairings p
    where p.user_code = p_user_code and p.status = 'pending' and p.expires_at > now();
end;
$$;

-- Aprovar liga o pareamento à conta logada; recusar marca denied. Só pendente e não vencido.
-- Devolve approved | denied | invalid.
create function public.sync_pair_decide(p_user_code text, p_approve boolean) returns text
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.device_pairings p set
    status = case when p_approve then 'approved' else 'denied' end,
    user_id = case when p_approve then auth.uid() else null end,
    decided_at = now()
  where p.user_code = p_user_code and p.status = 'pending' and p.expires_at > now()
  returning p.id into v_id;
  if v_id is null then return 'invalid'; end if;
  return case when p_approve then 'approved' else 'denied' end;
end;
$$;

revoke all on function public.sync_pair_start(text, text, text, text, text, text, boolean) from public;
revoke all on function public.sync_pair_poll(text, text, text) from public;
revoke all on function public.sync_pair_lookup(text) from public, anon;
revoke all on function public.sync_pair_decide(text, boolean) from public, anon;
grant execute on function public.sync_pair_start(text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.sync_pair_poll(text, text, text) to anon, authenticated;
grant execute on function public.sync_pair_lookup(text) to authenticated;
grant execute on function public.sync_pair_decide(text, boolean) to authenticated;

-- ---------- Obras de livro (KOSync) ----------

alter table public.works drop constraint works_refs_check;
alter table public.works add constraint works_refs_check check (
  jsonb_typeof(refs) = 'object'
  and pg_column_size(refs) <= 2000
  and (not refs ? 'youtube_id' or refs ->> 'youtube_id' ~ '^[A-Za-z0-9_-]{11}$')
  and (not refs ? 'imdb_id' or refs ->> 'imdb_id' ~ '^tt[0-9]{1,10}$')
  and (not refs ? 'ko_hash' or refs ->> 'ko_hash' ~ '^[0-9a-f]{32}$')
);

-- A coluna gerada não muda no lugar: sai e volta com o ramo kosync.
drop index public.works_ref_key;
alter table public.works drop column ref_key;
alter table public.works add column ref_key text generated always as (
  case
    when refs ? 'youtube_id' then 'youtube:' || (refs ->> 'youtube_id')
    when refs ? 'imdb_id' then 'imdb:' || (refs ->> 'imdb_id')
      || coalesce(':' || (refs ->> 'season') || ':' || (refs ->> 'episode'), '')
    when refs ? 'ko_hash' then 'kosync:' || (refs ->> 'ko_hash')
    when refs ? 'path' then 'path:' || (refs ->> 'path')
  end
) stored;
create unique index works_ref_key on public.works (user_id, kind, ref_key)
  where ref_key is not null and deleted_at is null;

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

-- ---------- Encontros e revisões ----------

-- Posição de livro: { chapter (até 200 caracteres), spine, percent }. 200 code points
-- passam de 500 bytes, então o teto sobe.
alter table public.encounters drop constraint encounters_position_check;
alter table public.encounters add constraint encounters_position_check
  check (jsonb_typeof(position) = 'object' and pg_column_size(position) <= 1500);

alter table public.review_logs
  add column duration_ms integer check (duration_ms between 0 and 3600000);

comment on column public.review_logs.duration_ms is 'Tempo até responder, quando o aparelho mede (e-reader).';

-- ---------- Idempotência das operações ----------

create table public.sync_ops (
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null,
  type text not null check (type in ('save', 'review', 'seen')),
  -- O resultado como saiu da primeira vez ({ status, ... }, sem o clientId).
  result jsonb not null default '{}',
  received_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

alter table public.sync_ops enable row level security;
revoke all on public.sync_ops from anon, authenticated;

-- Reserva o clientId para esta operação. null: é nova (a linha fica reservada até o fim
-- da transação; um pedido concorrente espera). Senão, o resultado guardado, ou o
-- client_id_conflict se o tipo for outro. Interno.
create function public.sync_claim(p_user uuid, p_client_id uuid, p_type text) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_type text;
  v_result jsonb;
begin
  insert into public.sync_ops (user_id, client_id, type) values (p_user, p_client_id, p_type)
    on conflict (user_id, client_id) do nothing;
  if found then return null; end if;
  select o.type, o.result into v_type, v_result from public.sync_ops o
    where o.user_id = p_user and o.client_id = p_client_id;
  if v_type <> p_type then
    return jsonb_build_object('status', 'rejected', 'reason', 'client_id_conflict');
  end if;
  return v_result;
end;
$$;

create function public.sync_finish(p_user uuid, p_client_id uuid, p_result jsonb) returns jsonb
  language sql volatile security definer set search_path = '' as $$
  update public.sync_ops set result = p_result where user_id = p_user and client_id = p_client_id;
  select jsonb_build_object('prior', false, 'result', p_result);
$$;

create function public.sync_prior(p_result jsonb) returns jsonb
  language sql immutable set search_path = '' as $$
  select jsonb_build_object('prior', true, 'result', p_result);
$$;

revoke all on function public.sync_claim(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.sync_finish(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sync_prior(jsonb) from public, anon, authenticated;

-- ---------- API de sync (token) ----------

-- Dono do token com o limite de 60 pedidos por minuto (push + snapshot). Devolve o dono e,
-- se passou do limite, os segundos até a janela abrir. Não levanta exceção no limite: o
-- contador precisa ficar gravado. Interno.
create function public.sync_token_begin(p_token text, out user_id uuid, out retry_after integer)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_window timestamptz;
  v_count integer;
begin
  if p_token is null or char_length(p_token) not between 20 and 200 then return; end if;
  update public.api_tokens t set
    rate_window_at = case when t.rate_window_at is null or t.rate_window_at <= now() - interval '1 minute'
      then now() else t.rate_window_at end,
    rate_count = case when t.rate_window_at is null or t.rate_window_at <= now() - interval '1 minute'
      then 1 else t.rate_count + 1 end,
    last_used_at = now()
  where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  returning t.id, t.user_id, t.rate_window_at, t.rate_count into v_id, user_id, v_window, v_count;
  if v_id is null then return; end if;
  if v_count > 60 then
    retry_after := greatest(1, ceil(extract(epoch from v_window + interval '1 minute' - now()))::integer);
  end if;
end;
$$;
revoke all on function public.sync_token_begin(text) from public, anon, authenticated;

-- Começo do push: confere o token e o limite.
create function public.api_sync_begin(p_token text) returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
begin
  select * into v from public.sync_token_begin(p_token);
  if v.user_id is null then raise exception 'invalid_token'; end if;
  return coalesce(v.retry_after, 0);
end;
$$;

-- O aparelho se despareia: apaga o próprio token.
create function public.api_sync_unpair(p_token text) returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_token is null or char_length(p_token) not between 20 and 200 then raise exception 'invalid_token'; end if;
  delete from public.api_tokens t where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    returning t.id into v_id;
  if v_id is null then raise exception 'invalid_token'; end if;
end;
$$;

-- Operação recusada pela validação do app: guarda o resultado para o reenvio dar o mesmo.
create function public.api_sync_reject(p_token text, p_client_id uuid, p_type text, p_result jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_prior jsonb;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, p_type);
  if v_prior is not null then return public.sync_prior(v_prior); end if;
  return public.sync_finish(v_user, p_client_id, p_result);
end;
$$;

-- save: o núcleo de save_items_for, mais a exclusão vence (item apagado depois de `at`).
-- p_entry está no formato de save_items_for (o encontro já leva client_id = p_client_id).
create function public.api_sync_save(p_token text, p_client_id uuid, p_at timestamptz, p_entry jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_prior jsonb;
  v_at timestamptz := least(p_at, now());
  v_lang public.language_code := (p_entry ->> 'language')::public.language_code;
  v_lemma text := p_entry ->> 'lemma';
  v_saved record;
  v_card uuid;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, 'save');
  if v_prior is not null then return public.sync_prior(v_prior); end if;

  if not exists (
    select 1 from public.items i
    where i.user_id = v_user and i.language = v_lang and lower(i.lemma) = lower(v_lemma) and i.deleted_at is null
  ) and exists (
    select 1 from public.items i
    where i.user_id = v_user and i.language = v_lang and lower(i.lemma) = lower(v_lemma) and i.deleted_at > v_at
  ) then
    return public.sync_finish(v_user, p_client_id,
      jsonb_build_object('status', 'dropped', 'reason', 'item_deleted'));
  end if;

  select * into v_saved from public.save_items_for(v_user, jsonb_build_array(p_entry));
  select c.id into v_card from public.cards c where c.item_id = v_saved.item_id and c.kind = 'reconhecer';
  return public.sync_finish(v_user, p_client_id, jsonb_build_object(
    'status', 'applied',
    'itemId', v_saved.item_id,
    'cardId', v_card,
    'created', v_saved.created,
    'encounterId', v_saved.encounter_id
  ));
end;
$$;

-- review, etapa 1: acha o cartão (cardId, ou o Reconhecer do item do save saveClientId) e
-- devolve o cartão, o sentido do item e o log para o app calcular. Se a operação já foi
-- processada, ou se ela cai numa regra (apagado, alvo desconhecido, Produzir), resolve aqui.
-- Saída: { prior, result } quando resolvida; { card, sense, logs } para calcular.
create function public.api_sync_review_target(p_token text, p_client_id uuid, p_card_id uuid, p_save_client_id uuid)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_type text;
  v_result jsonb;
  v_item uuid;
  v_card public.cards;
  v_deleted timestamptz;
  v_sense text;
  v_outcome jsonb;
begin
  if v_user is null then raise exception 'invalid_token'; end if;

  select o.type, o.result into v_type, v_result from public.sync_ops o
    where o.user_id = v_user and o.client_id = p_client_id;
  if found then
    if v_type <> 'review' then
      return public.sync_prior(jsonb_build_object('status', 'rejected', 'reason', 'client_id_conflict'));
    end if;
    return public.sync_prior(v_result);
  end if;

  if p_card_id is not null then
    select c.* into v_card from public.cards c where c.id = p_card_id and c.user_id = v_user;
  else
    select e.item_id into v_item from public.encounters e
      where e.user_id = v_user and e.client_id = p_save_client_id;
    if v_item is not null then
      select c.* into v_card from public.cards c where c.item_id = v_item and c.kind = 'reconhecer';
    end if;
  end if;

  if v_card.id is null then
    v_outcome := jsonb_build_object('status', 'dropped', 'reason', 'unknown_target');
  else
    select i.deleted_at, i.sense into v_deleted, v_sense from public.items i where i.id = v_card.item_id;
    if v_deleted is not null then
      v_outcome := jsonb_build_object('status', 'dropped', 'reason', 'item_deleted');
    elsif v_card.kind <> 'reconhecer' then
      v_outcome := jsonb_build_object('status', 'rejected', 'reason', 'invalid',
        'errors', jsonb_build_object('cardId', 'o aparelho só revisa o Reconhecer'));
    end if;
  end if;

  if v_outcome is not null then
    v_result := public.sync_claim(v_user, p_client_id, 'review');
    if v_result is not null then return public.sync_prior(v_result); end if;
    return public.sync_finish(v_user, p_client_id, v_outcome);
  end if;

  return jsonb_build_object(
    'card', to_jsonb(v_card),
    'sense', v_sense,
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('rating', l.rating, 'reviewed_at', l.reviewed_at)
        order by l.reviewed_at, l.received_at)
      from public.review_logs l where l.card_id = v_card.id), '[]')
  );
end;
$$;

-- review, etapa 2: grava o log e o cronograma que o app calculou pelo log. Se outra revisão
-- entrou no meio (reps mudou), card_stale: o app refaz a etapa 1. p_result é o resultado
-- (com o CardState) que fica guardado para o duplicate.
create function public.api_sync_review(
  p_token text,
  p_client_id uuid,
  p_card_id uuid,
  p_expected_reps integer,
  p_rating smallint,
  p_reviewed_at timestamptz,
  p_duration_ms integer,
  p_next jsonb,
  p_unlock_produce boolean,
  p_result jsonb
) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_prior jsonb;
  v_card public.cards;
  v_next public.cards;
  v_deleted timestamptz;
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, 'review');
  if v_prior is not null then return public.sync_prior(v_prior); end if;

  select c.* into v_card from public.cards c where c.id = p_card_id and c.user_id = v_user for update;
  if not found then
    return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'dropped', 'reason', 'unknown_target'));
  end if;
  select i.deleted_at into v_deleted from public.items i where i.id = v_card.item_id;
  if v_deleted is not null then
    return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'dropped', 'reason', 'item_deleted'));
  end if;
  if v_card.reps <> p_expected_reps then raise exception 'card_stale'; end if;

  insert into public.review_logs (card_id, user_id, rating, reviewed_at, client_id, duration_ms)
  values (v_card.id, v_user, p_rating, least(p_reviewed_at, now()), p_client_id, p_duration_ms);

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

  return public.sync_finish(v_user, p_client_id, p_result);
end;
$$;

-- seen: soma uma aparição ao item vivo do lema. Não cria encontro nem mexe no FSRS.
create function public.api_sync_seen(p_token text, p_client_id uuid, p_language text, p_lemma text, p_at timestamptz)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := public.api_token_owner(p_token);
  v_prior jsonb;
  v_item uuid;
  v_at timestamptz := least(p_at, now());
begin
  if v_user is null then raise exception 'invalid_token'; end if;
  v_prior := public.sync_claim(v_user, p_client_id, 'seen');
  if v_prior is not null then return public.sync_prior(v_prior); end if;

  update public.items i set
    seen_count = i.seen_count + 1,
    last_seen_at = greatest(i.last_seen_at, v_at)
  where i.user_id = v_user and i.language = p_language::public.language_code
    and lower(i.lemma) = lower(p_lemma) and i.deleted_at is null
  returning i.id into v_item;

  if v_item is null then
    return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'dropped', 'reason', 'not_found'));
  end if;
  return public.sync_finish(v_user, p_client_id, jsonb_build_object('status', 'applied', 'itemId', v_item));
end;
$$;

-- Uma página do snapshot completo: itens não apagados do idioma em ordem de id, depois de
-- p_after. Também conta o limite de pedidos e traz o que o cabeçalho pede (conta, total,
-- novos de hoje). Saída: { rateLimited } ou { account, total, newDoneToday, items, more }.
create function public.api_sync_snapshot(
  p_token text,
  p_language text,
  p_after uuid,
  p_limit integer,
  p_day_start timestamptz
) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  v_lang public.language_code := p_language::public.language_code;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_items jsonb;
  v_count integer;
begin
  select * into v from public.sync_token_begin(p_token);
  if v.user_id is null then raise exception 'invalid_token'; end if;
  if v.retry_after is not null then return jsonb_build_object('rateLimited', v.retry_after); end if;

  with page as (
    select i.* from public.items i
    where i.user_id = v.user_id and i.language = v_lang and i.deleted_at is null
      and (p_after is null or i.id > p_after)
    order by i.id
    limit v_limit + 1
  )
  select count(*)::integer, coalesce(jsonb_agg(line order by row_id) filter (where rn <= v_limit), '[]')
  into v_count, v_items
  from (
    select p.id as row_id, row_number() over (order by p.id) as rn,
      jsonb_build_object(
        'id', p.id,
        'lemma', p.lemma,
        'language', p.language,
        'sense', p.sense,
        'note', left(p.note, 200),
        'ipa', p.ipa,
        'pos', p.part_of_speech,
        'status', p.status,
        'seen_count', p.seen_count,
        'last_seen_at', p.last_seen_at,
        'created_at', p.created_at,
        'updated_at', greatest(
          p.updated_at,
          (select max(e.created_at) from public.encounters e where e.item_id = p.id),
          (select max(l.received_at) from public.review_logs l where l.card_id = c.id)
        ),
        'forms', coalesce((select jsonb_agg(f.form order by f.form) from (
            select distinct lower(e.form) as form from public.encounters e
            where e.item_id = p.id and e.deleted_at is null and e.form <> '' and lower(e.form) <> lower(p.lemma)
            order by 1 limit 10
          ) f), '[]'),
        'encounters', coalesce((select jsonb_agg(jsonb_build_object(
            'form', e.form, 'sentence', e.sentence, 'sense', e.sense, 'work', w.title, 'at', e.seen_at
          ) order by e.seen_at desc) from (
            select * from public.encounters e2
            where e2.item_id = p.id and e2.deleted_at is null
            order by e2.seen_at desc limit 2
          ) e left join public.works w on w.id = e.work_id and w.deleted_at is null), '[]'),
        'card', to_jsonb(c)
      ) as line
    from page p
    join public.cards c on c.item_id = p.id and c.kind = 'reconhecer'
  ) rows;

  return jsonb_build_object(
    'account', (
      select jsonb_build_object('native_language', s.native_language, 'new_cards_per_day', s.new_cards_per_day)
      from public.user_settings s where s.user_id = v.user_id
    ),
    'total', (
      select count(*) from public.items i
      where i.user_id = v.user_id and i.language = v_lang and i.deleted_at is null
    ),
    -- Mesma conta de review_counts: cartões cuja primeira revisão é de hoje (em qualquer idioma).
    'newDoneToday', (
      select count(distinct l.card_id) from public.review_logs l
      where l.user_id = v.user_id and l.reviewed_at >= p_day_start
        and not exists (
          select 1 from public.review_logs pl where pl.card_id = l.card_id and pl.reviewed_at < p_day_start
        )
    ),
    'items', v_items,
    'more', v_count > v_limit
  );
end;
$$;

revoke all on function public.api_sync_begin(text) from public;
revoke all on function public.api_sync_unpair(text) from public;
revoke all on function public.api_sync_reject(text, uuid, text, jsonb) from public;
revoke all on function public.api_sync_save(text, uuid, timestamptz, jsonb) from public;
revoke all on function public.api_sync_review_target(text, uuid, uuid, uuid) from public;
revoke all on function public.api_sync_review(text, uuid, uuid, integer, smallint, timestamptz, integer, jsonb, boolean, jsonb) from public;
revoke all on function public.api_sync_seen(text, uuid, text, text, timestamptz) from public;
revoke all on function public.api_sync_snapshot(text, text, uuid, integer, timestamptz) from public;
grant execute on function public.api_sync_begin(text) to anon, authenticated;
grant execute on function public.api_sync_unpair(text) to anon, authenticated;
grant execute on function public.api_sync_reject(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.api_sync_save(text, uuid, timestamptz, jsonb) to anon, authenticated;
grant execute on function public.api_sync_review_target(text, uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.api_sync_review(text, uuid, uuid, integer, smallint, timestamptz, integer, jsonb, boolean, jsonb) to anon, authenticated;
grant execute on function public.api_sync_seen(text, uuid, text, text, timestamptz) to anon, authenticated;
grant execute on function public.api_sync_snapshot(text, text, uuid, integer, timestamptz) to anon, authenticated;
