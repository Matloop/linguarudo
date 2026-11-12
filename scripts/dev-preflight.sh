#!/usr/bin/env bash
# Roda antes do `bun run dev`. Garante Supabase local saudável e sem duplicatas.
# Falha de porta 54321 (podman rootless) = login Google "conexão recusada".
set -u
cd "$(dirname "$0")/.."

URL="${PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}"
# Stack a manter: o que publica a 54321 (dono dos dados); senão o project_id do config.
PROJECT="$(podman ps -a --format '{{.Names}} {{.Ports}}' 2>/dev/null | sed -n 's/^supabase_kong_\([^ ]*\) .*:54321->.*/\1/p' | head -1)"
[ -n "$PROJECT" ] || PROJECT="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
health() { curl -fsS -m 3 -o /dev/null "$URL/auth/v1/health" 2>/dev/null; }

# 1. Para stacks Supabase de outros projetos (worktrees) que disputam a rede do podman.
if command -v podman >/dev/null; then
  others=$(podman ps --format '{{.Names}}' | sed -n 's/^supabase_kong_//p' | grep -v "^${PROJECT}$" || true)
  for id in $others; do
    echo "[preflight] parando stack Supabase duplicado: $id"
    supabase stop --project-id "$id" >/dev/null 2>&1 || true
  done
fi

# Podman rootless: conmon e rootlessport (que publica a 54321) nascem no cgroup de quem
# chamou. Se for o scope de um terminal/agente (t3code-claude-*.scope), o systemd mata
# tudo quando a sessão fecha e a API cai. Rodar num scope próprio desacopla da sessão.
detached() {
  if command -v systemd-run >/dev/null; then
    systemd-run --user --scope --quiet --slice=app.slice --unit="supabase-${PROJECT}-$$-$RANDOM" "$@"
  else "$@"; fi
}

# 2. Garante que a API local responde; tenta curar sem derrubar o banco.
if ! health; then
  echo "[preflight] Supabase local sem resposta em $URL, tentando recuperar..."
  if podman ps -a --format '{{.Names}}' | grep -q "^supabase_kong_${PROJECT}$"; then
    # Reinicia a stack inteira: com o conmon morto, só subir kong/auth deixa o resto órfão.
    stack=$(podman ps -a --format '{{.Names}}' | grep "_${PROJECT}$" | grep -v edge_runtime)
    detached podman restart $stack >/dev/null 2>&1 || true
    sleep 6
  fi
  health || { detached supabase start >/dev/null 2>&1; sleep 4; }
  if health; then echo "[preflight] Supabase OK."; else
    echo "[preflight] ERRO: Supabase não subiu. Rode 'supabase stop && supabase start'." >&2; exit 1; fi
fi

# 3. Evita vite dev duplicado (várias instâncias = lentidão).
web="$(pwd)/apps/web"
for pid in $(pgrep -f 'node_modules/.bin/vite dev' || true); do
  [ "$(readlink /proc/$pid/cwd 2>/dev/null)" = "$web" ] && { echo "[preflight] encerrando vite dev antigo ($pid)"; kill "$pid" 2>/dev/null; }
done
exit 0
