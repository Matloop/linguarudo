#!/usr/bin/env bash
# Instala o dicionário local do cartão de palavra (uma vez por idioma): baixa a extração do
# Wiktionary em inglês feita pelo Wiktextract (kaikki.org) e gera <pasta>/<idioma>.sqlite.
#
#   server/scripts/setup-dict.sh it              → server/.dict/it.sqlite (italiano)
#   LINGOBLEND_DICT_DIR=/outro/lugar ...         → outra pasta (o servidor lê a mesma variável)
#   DICT_URL=https://... ...                     → outra fonte JSONL(.gz) do Wiktextract
#   DICT_KEEP_DOWNLOAD=1 ...                     → guarda o .jsonl.gz em <pasta>/.download
#   FREQ_URL=https://... ...                     → outra lista de frequência ("palavra contagem" por linha)
#
# Fonte padrão: https://kaikki.org/dictionary/<Language>/kaikki.org-dictionary-<Language>.jsonl.gz
# (≈75 MB para o italiano). O kaikki marcou esses arquivos por idioma como "deprecated"; se
# sumirem, use o dump completo (≈3 GB, filtrado pelo lang_code na hora):
#   DICT_URL=https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz server/scripts/setup-dict.sh it
#
# Também baixa <pasta>/<idioma>.freq.txt, a ordem de frequência que o Blend usa para escolher as
# trocas (src/dict/frequency.js): FrequencyWords, legendas do OpenSubtitles 2018, 50 mil palavras.
#
# Dados: Wiktionary (CC BY-SA 4.0 e GFDL), extraídos pelo Wiktextract / kaikki.org.
# Frequência: github.com/hermitdave/FrequencyWords (CC BY-SA 4.0), dados do OpenSubtitles.
# Precisa de Node ≥ 22.13 (node:sqlite) e curl. O banco do italiano ocupa ≈100 MB.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LANG_TAG="${1:-}"
if [[ -z "$LANG_TAG" ]]; then
  echo "uso: $0 <idioma>   (ex.: $0 it)" >&2
  exit 2
fi
DIR="${LINGOBLEND_DICT_DIR:-$HERE/../.dict}"
mkdir -p "$DIR/.download"
DIR="$(cd "$DIR" && pwd)"

# Nome do idioma em inglês, sem espaços, como o kaikki usa na URL ("it" → "Italian").
NAME="$(cd "$HERE/.." && node --input-type=module -e '
  import { languageName, canonicalLanguage } from "@linguetta/language";
  const tag = canonicalLanguage(process.argv[1]);
  if (!tag) { console.error("idioma inválido: " + process.argv[1]); process.exit(2); }
  process.stdout.write(languageName(tag, "en").replace(/\s+/g, ""));
' "$LANG_TAG")"
URL="${DICT_URL:-https://kaikki.org/dictionary/$NAME/kaikki.org-dictionary-$NAME.jsonl.gz}"
FILE="$DIR/.download/$(basename "$URL")"

T0=$SECONDS
BASE="${LANG_TAG%%[-_]*}"
FREQ="${FREQ_URL:-https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/$BASE/${BASE}_50k.txt}"
echo "[setup-dict] baixando a lista de frequência $FREQ"
if curl -fsL -o "$DIR/$BASE.freq.txt.part" "$FREQ"; then
  mv "$DIR/$BASE.freq.txt.part" "$DIR/$BASE.freq.txt"
else
  rm -f "$DIR/$BASE.freq.txt.part"
  echo "[setup-dict] sem lista de frequência para $BASE: o Blend escolhe as trocas sem ela" >&2
fi
echo "[setup-dict] baixando $URL"
curl -fL --progress-bar -o "$FILE.part" "$URL"
mv "$FILE.part" "$FILE"
echo "[setup-dict] gerando o banco ($(( SECONDS - T0 )) s até aqui)"
(cd "$HERE/.." && node scripts/build-dict.js "$LANG_TAG" "$FILE" "$DIR" "$URL")
[[ "${DICT_KEEP_DOWNLOAD:-}" == 1 ]] || rm -f "$FILE"
echo "[setup-dict] pronto em $(( SECONDS - T0 )) s. Reinicie o servidor: o dicionário liga sozinho ($DIR)."
