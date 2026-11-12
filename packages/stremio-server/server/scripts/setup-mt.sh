#!/usr/bin/env bash
# Instala a tradução local do LingoBlend (uma vez por modelo): exporta modelos oficiais OPUS-MT
# (Helsinki-NLP, CC-BY-4.0) para ONNX int8. O servidor carrega todo modelo que achar na pasta.
#
#   server/scripts/setup-mt.sh                  → itc-itc (românicas entre si)
#   server/scripts/setup-mt.sh en-it en-pt      → legenda em inglês: estudo em italiano, nativa PT
#   server/scripts/setup-mt.sh itc-itc en-it en-pt
#   LINGOBLEND_MT_DIR=/outro/lugar ...          → outra pasta raiz (o servidor lê a mesma variável)
#   MT_PYTHON=python3.12 ...                    → outro Python para o venv (padrão: python3)
#   MT_KEEP_FP32=1 ...                          → mantém os ONNX fp32 em <modelo>/fp32
#
# Modelos (cada um em <raiz>/opus-mt-tc-big-<nome>):
#   itc-itc  Helsinki-NLP/opus-mt-tc-big-itc-itc  ast ca es fr gl it lad oc pms pt ro → as mesmas (token >>xxx<<)
#   en-it    Helsinki-NLP/opus-mt-tc-big-en-it    en → it (modelo de par, sem token)
#   en-pt    Helsinki-NLP/opus-mt-tc-big-en-pt    en → pt (>>pob<< PT-BR, >>por<< PT-PT)
#
# Cria um venv em <raiz>/.venv, compartilhado (torch CPU, transformers, onnx, onnxruntime,
# sentencepiece; ≈1,5 GB), baixa os pesos (≈900 MB por modelo, cache do Hugging Face em $HF_HOME),
# exporta encoder e decoders com torch.onnx.export, quantiza para int8 e confere as saídas contra
# o PyTorch. Cada modelo ocupa ≈450 MB no fim. Depois pode apagar <raiz>/.venv e o cache do HF.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${LINGOBLEND_MT_DIR:-$HERE/../.models}"
PY="${MT_PYTHON:-python3}"

# nome → "id do HF|origens|destinos (só modelo sem token)|falas de verificação"
declare -A MODELS=(
  [itc-itc]="Helsinki-NLP/opus-mt-tc-big-itc-itc|ast,ca,es,fr,gl,it,lad,oc,pms,pt,ro||mt-lines.json"
  [en-it]="Helsinki-NLP/opus-mt-tc-big-en-it|en|it|mt-lines.en.json"
  [en-pt]="Helsinki-NLP/opus-mt-tc-big-en-pt|en||mt-lines.en.json"
)
NAMES=("$@")
[[ ${#NAMES[@]} -eq 0 ]] && NAMES=(itc-itc)
for name in "${NAMES[@]}"; do
  if [[ -z "${MODELS[$name]:-}" ]]; then
    echo "modelo desconhecido: $name (use: ${!MODELS[*]})" >&2
    exit 2
  fi
done

mkdir -p "$ROOT"
ROOT="$(cd "$ROOT" && pwd)"

# Versões que exportam sem erro (o optimum não serve aqui: ver o cabeçalho do export-mt.py).
PINS=(
  "transformers==4.57.6"
  "huggingface_hub>=0.34,<1"
  "sentencepiece==0.2.3"
  "protobuf"
  "onnx==1.23.2"
  "onnxruntime==1.31.1"
  "numpy"
  "safetensors"
)
TORCH="${MT_TORCH:-torch==2.15.0}"

if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
  echo "[setup-mt] criando venv em $ROOT/.venv ($("$PY" --version))"
  "$PY" -m venv "$ROOT/.venv"
fi
VPY="$ROOT/.venv/bin/python"
"$VPY" -m pip install --quiet --upgrade pip
"$VPY" -m pip install --quiet "$TORCH" --index-url https://download.pytorch.org/whl/cpu
"$VPY" -m pip install --quiet "${PINS[@]}"

for name in "${NAMES[@]}"; do
  IFS='|' read -r ID SOURCES TARGETS LINES <<<"${MODELS[$name]}"
  DIR="$ROOT/opus-mt-tc-big-$name"
  echo "[setup-mt] $ID → $DIR"
  ARGS=("$DIR" --model "$ID" --sources "$SOURCES" --lines "$HERE/$LINES")
  [[ -n "$TARGETS" ]] && ARGS+=(--targets "$TARGETS")
  [[ "${MT_KEEP_FP32:-}" == 1 ]] && ARGS+=(--keep-fp32)
  "$VPY" -I "$HERE/export-mt.py" "${ARGS[@]}"
done

echo "[setup-mt] pronto. Reinicie o servidor: a tradução local liga sozinha ($ROOT)."
