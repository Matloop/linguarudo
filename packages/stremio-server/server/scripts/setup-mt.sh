#!/usr/bin/env bash
# Instala a tradução local do LingoBlend (uma vez só): exporta o modelo oficial
# Helsinki-NLP/opus-mt-tc-big-itc-itc (CC-BY-4.0, Helsinki-NLP / OPUS-MT) para ONNX int8.
#
#   server/scripts/setup-mt.sh            → modelo em server/.models/opus-mt-tc-big-itc-itc
#   LINGOBLEND_MT_DIR=/outro/lugar ...    → outra pasta (o servidor lê a mesma variável)
#   MT_PYTHON=python3.12 ...              → outro Python para o venv (padrão: python3)
#   MT_KEEP_FP32=1 ...                    → mantém os ONNX fp32 em <pasta>/fp32
#
# Cria um venv em <pasta>/.venv (torch CPU, transformers, onnx, onnxruntime, sentencepiece;
# ≈1,5 GB), baixa os pesos (≈900 MB, cache do Hugging Face em $HF_HOME), exporta encoder e
# decoders com torch.onnx.export, quantiza para int8 e confere as saídas contra o PyTorch.
# Ocupa ≈450 MB no fim. Depois pode apagar <pasta>/.venv e o cache do HF.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${LINGOBLEND_MT_DIR:-$HERE/../.models/opus-mt-tc-big-itc-itc}"
PY="${MT_PYTHON:-python3}"
mkdir -p "$DIR"
DIR="$(cd "$DIR" && pwd)"

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

if [[ ! -x "$DIR/.venv/bin/python" ]]; then
  echo "[setup-mt] criando venv em $DIR/.venv ($("$PY" --version))"
  "$PY" -m venv "$DIR/.venv"
fi
VPY="$DIR/.venv/bin/python"
"$VPY" -m pip install --quiet --upgrade pip
"$VPY" -m pip install --quiet "$TORCH" --index-url https://download.pytorch.org/whl/cpu
"$VPY" -m pip install --quiet "${PINS[@]}"

ARGS=("$DIR" --lines "$HERE/mt-lines.json")
[[ "${MT_KEEP_FP32:-}" == 1 ]] && ARGS+=(--keep-fp32)
"$VPY" -I "$HERE/export-mt.py" "${ARGS[@]}"

echo "[setup-mt] pronto. Reinicie o servidor: a tradução local liga sozinha ($DIR)."
