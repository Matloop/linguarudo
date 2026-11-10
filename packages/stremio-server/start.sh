#!/usr/bin/env bash
# Sobe o LingoBlend e abre o app Stremio (flatpak) usando a UI do fork.
#   ./start.sh            → servidor + addon de teste + UI em :8080 + abre o Stremio
#   Traduções: usa o Claude Code logado (assinatura, Haiku) se o `claude` estiver instalado;
#   com ANTHROPIC_API_KEY usa a API; LINGOBLEND_PROVIDER=mock força o dicionário offline.
#   LINGOBLEND_BUILD=1 ./start.sh             → recompila o stremio-web antes
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
UI_PORT="${UI_PORT:-8080}"
pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if [[ "${LINGOBLEND_BUILD:-}" == 1 || ! -f "$ROOT/stremio-web/build/index.html" ]]; then
  (cd "$ROOT/stremio-web" && pnpm build)
fi

(cd "$ROOT/server" && node src/index.js) & pids+=($!)
node "$ROOT/devaddon/index.js" & pids+=($!)
python3 -m http.server "$UI_PORT" --bind 127.0.0.1 --directory "$ROOT/stremio-web/build" >/dev/null 2>&1 & pids+=($!)
sleep 1

# O servidor de streaming do Stremio (:11470) só libera CORS para origens de uma lista fixa
# (*.stremio.com, ..., e qualquer origem contendo "peario.xyz"). Sem CORS a UI não acha o
# servidor e torrents dão "Stream is not supported". *.localhost resolve para esta máquina.
UI_URL="http://lingoblend.peario.xyz.localhost:$UI_PORT/"
echo "UI: $UI_URL   addon de teste: http://127.0.0.1:7000/manifest.json"
flatpak run com.stremio.Stremio --url "$UI_URL"
