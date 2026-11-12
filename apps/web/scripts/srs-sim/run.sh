#!/usr/bin/env bash
# Simulação Anki × Linguetta: o mesmo aluno virtual estuda o mesmo baralho por N dias
# no Anki de verdade (SM-2 e FSRS) e no agendador do Linguetta, com várias sementes.
#
#   scripts/srs-sim/run.sh [--seeds 10] [--days 30] [--notes 600] [--new 20] [--retention 0.9]
#
# Primeira vez: cria um venv com o pacote oficial do Anki e compila o libfaketime
# (relógio falso para o Anki) em ~/.cache/linguetta-srs-sim. Saída em scripts/srs-sim/out.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="$(cd "$HERE/../.." && pwd)"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/linguetta-srs-sim"
OUT="$HERE/out"
SEEDS=10; DAYS=30; NOTES=600; NEW=20; RETENTION=0.9
while [[ $# -gt 0 ]]; do
  case "$1" in
    --seeds) SEEDS="$2"; shift 2 ;;
    --days) DAYS="$2"; shift 2 ;;
    --notes) NOTES="$2"; shift 2 ;;
    --new) NEW="$2"; shift 2 ;;
    --retention) RETENTION="$2"; shift 2 ;;
    *) echo "opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$CACHE"
if [[ ! -x "$CACHE/venv/bin/python" ]]; then
  echo "→ instalando o pacote do Anki em $CACHE/venv"
  python3 -m venv "$CACHE/venv"
  "$CACHE/venv/bin/pip" install -q anki
fi
FAKETIME_LIB="$CACHE/libfaketime/src/libfaketime.so.1"
if [[ ! -f "$FAKETIME_LIB" ]]; then
  echo "→ compilando libfaketime"
  rm -rf "$CACHE/libfaketime"
  git clone -q --depth 1 https://github.com/wolfcw/libfaketime.git "$CACHE/libfaketime"
  make -s -C "$CACHE/libfaketime" >/dev/null
fi

rm -rf "$OUT"; mkdir -p "$OUT"
CLOCK="$OUT/.clock"; echo "2026-01-01 08:00:00" > "$CLOCK"
for seed in $(seq 1 "$SEEDS"); do
  dir="$OUT/seed-$seed"
  for mode in sm2 fsrs; do
    PYTHONDONTWRITEBYTECODE=1 TZ=UTC LD_PRELOAD="$FAKETIME_LIB" \
      FAKETIME_TIMESTAMP_FILE="$CLOCK" FAKETIME_NO_CACHE=1 \
      "$CACHE/venv/bin/python" "$HERE/anki_sim.py" --mode "$mode" --seed "$seed" \
      --days "$DAYS" --notes "$NOTES" --new "$NEW" --retention "$RETENTION" --out "$dir" | sed "s/^/[semente $seed] /"
    (cd "$WEB" && bun scripts/srs-sim/linguetta-sim.ts "$dir/anki-$mode.json" "$dir/linguetta-vs-$mode.json") \
      | sed "s/^/[semente $seed] /"
  done
done
rm -f "$CLOCK"
(cd "$WEB" && bun scripts/srs-sim/report.ts "$OUT")
