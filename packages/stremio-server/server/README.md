# LingoBlend: servidor de anotações

Servidor HTTP local (só `127.0.0.1`) que recebe cues de legenda e devolve ~10% das palavras traduzidas no contexto. Contrato em [`../docs/CONTRACT.md`](../docs/CONTRACT.md), seção 4.

Requer Node >= 22 ou bun.

```sh
cd server
bun install
bun run start    # ou: bun run dev (reinicia ao salvar)
bun run test
```

## Com o Claude Code (assinatura Claude, padrão)

Se o comando `claude` estiver instalado e logado, o servidor usa o provider `claude-code`: roda `claude -p --model haiku` em modo headless (sem ferramentas, sem MCP, sem salvar sessão) e conta no uso da sua assinatura Pro/Max, sem chave de API. Cada lote de ~80 falas leva uns 15–40 s; as respostas ficam no cache.

Se der erro de login, rode `claude` uma vez e faça login.

## Sem Claude (mock)

Com `LINGOBLEND_PROVIDER=mock` (ou sem `claude` instalado e sem chave), o servidor usa o provider `mock`: um dicionário PT→IT embutido (~270 palavras e expressões), sem rede e determinístico. Só funciona para português → italiano; outros pares voltam sem anotações. Serve para desenvolver a UI.

## Com chave de API (Claude)

```sh
export ANTHROPIC_API_KEY=sk-ant-...
bun run start
```

O provider `claude` escolhe as palavras e traduz com o modelo configurado. As respostas ficam em `server/.cache/` (a mesma legenda não é paga duas vezes).

## Tradução local das falas (OPUS-MT)

Segurar **T** no player traduz a fala com um modelo local, sem Claude: [Helsinki-NLP/opus-mt-tc-big-itc-itc](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-itc-itc) (línguas românicas entre si: ast, ca, es, fr, gl, it, lad, oc, pms, pt, ro), em ONNX int8 com `onnxruntime-node`. Contrato em `../docs/CONTRACT.md`, seção 6 (`engine: "local"`/`"ai"`).

Instalar o modelo (uma vez; precisa de Python 3 e ~3 GB livres durante o setup):

```sh
server/scripts/setup-mt.sh
```

O script cria um venv em `server/.models/opus-mt-tc-big-itc-itc/.venv` (torch CPU, transformers, onnx, onnxruntime, sentencepiece), baixa os pesos oficiais, exporta encoder e decoders com `torch.onnx.export`, quantiza para int8 e confere as traduções contra o PyTorch. No fim o modelo ocupa ~450 MB; o `.venv` (~1,3 GB) e o cache do Hugging Face (`$HF_HOME`) podem ser apagados. A pasta `.models/` fica fora do git.

Sem o modelo o servidor sobe igual, com uma linha no log dizendo como instalar, e `/translate` com `engine: "local"` responde 422 `local_unavailable` (o player oferece "✦ Traduzir com IA"). O modelo carrega no primeiro uso (~1–2 s); depois, ~50–100 ms por fala, uma por vez.

Variáveis do script: `MT_PYTHON` (Python do venv, padrão `python3`), `MT_TORCH` (padrão `torch==2.15.0`), `MT_KEEP_FP32=1` (mantém os ONNX fp32 em `<pasta>/fp32`), `HF_HOME`.

Modelo: Helsinki-NLP / OPUS-MT ([Tiedemann & Thottingal, 2020](https://aclanthology.org/2020.eamt-1.61/); [Tiedemann et al., 2023](https://doi.org/10.1007/s10579-023-09704-w)), licença [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). O arquivo `MODEL_CARD.md` na pasta do modelo é o card original.

## Dicionário local do cartão de palavra (Wiktionary)

No modo "Só <língua>", clicar numa palavra abre o cartão sem IA: lema, IPA, classe e notas de gramática vêm de um dicionário local, e o significado e a fala vêm da tradução local acima. O botão "✦ Explicar com IA" pede a versão do Claude (`/lookup` com `engine: "ai"`). Contrato em `../docs/CONTRACT.md`, seção 6.

Instalar o dicionário de um idioma (uma vez; precisa de Node ≥ 22.13 e curl):

```sh
server/scripts/setup-dict.sh it
```

O script baixa a extração do Wiktionary em inglês para o idioma (`kaikki.org-dictionary-Italian.jsonl.gz`, ~75 MB) e gera `server/.dict/it.sqlite` (`node:sqlite`, ~115 MB; ~45 s com o download). O download é apagado no fim (`DICT_KEEP_DOWNLOAD=1` o guarda). A pasta `.dict/` fica fora do git. O kaikki marcou os arquivos por idioma como "deprecated"; se sumirem, `DICT_URL=https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz` usa o dump completo (~3 GB), filtrado pelo idioma. Com um arquivo já baixado: `node scripts/build-dict.js it arquivo.jsonl.gz .dict`.

Qualquer idioma que o Wiktionary em inglês cobre funciona do mesmo jeito (`setup-dict.sh fr`, `setup-dict.sh de`…); o servidor carrega todo `<pasta>/<base>.sqlite` ao subir (reinicie depois de instalar) e escolhe pelo idioma da legenda. Sem dicionário do idioma, o cartão local sai com "sem verbete no dicionário" e só as traduções.

Dados: [Wiktionary](https://en.wiktionary.org/) (colaboradores do Wiktionary), licença [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) e GFDL, extraídos pelo [Wiktextract](https://github.com/tatuylonen/wiktextract) ([Ylonen, 2022](https://aclanthology.org/2022.lrec-1.140/)) e distribuídos pelo [kaikki.org](https://kaikki.org/). O cartão mostra "Wiktionary" com o link do verbete. O banco gerado é obra derivada e segue a mesma licença.

## Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `7979` | Porta HTTP |
| `ANTHROPIC_API_KEY` | (vazio) | Se definida, usa o provider `claude` (API) |
| `LINGOBLEND_PROVIDER` | automático | `claude`, `claude-code` ou `mock` (força a escolha). Automático: chave → `claude`; `claude` instalado → `claude-code`; senão `mock` |
| `LINGOBLEND_MODEL` | `claude-haiku-5-5` (API) / `haiku` (Claude Code) | Modelo (ex.: `sonnet` / `claude-sonnet-5-5` para traduções melhores, mais lento) |
| `LINGOBLEND_CLAUDE_BIN` | `claude` | Caminho do executável do Claude Code |
| `LINGOBLEND_EFFORT` | (vazio) | Esforço do modelo (`low`…`max`), só para modelos que aceitam, como Opus/Sonnet |
| `LINGOBLEND_CACHE_DIR` | `server/.cache` | Pasta do cache em disco |
| `LINGOBLEND_MT_DIR` | `server/.models/opus-mt-tc-big-itc-itc` | Pasta do modelo da tradução local (o `setup-mt.sh` usa a mesma) |
| `LINGOBLEND_DICT_DIR` | `server/.dict` | Pasta dos dicionários locais `<idioma>.sqlite` (o `setup-dict.sh` usa a mesma) |
| `LINGOBLEND_MT_THREADS` | `4` | Threads do onnxruntime por fala (inteiro ≥ 1; usar todos os núcleos foi mais lento) |

## Teste rápido

```sh
curl -s localhost:7979/health
curl -s -X POST localhost:7979/annotate -H 'Content-Type: application/json' \
  -d '{"sourceLang":"pt","targetLang":"it","nativeLanguage":"pt-BR","density":0.1,"cues":[{"id":"c1","text":"Eu não quero só ir às festas."}]}'
curl -s -X POST localhost:7979/translate -H 'Content-Type: application/json' \
  -d '{"sourceLang":"it","nativeLanguage":"pt-BR","text":"Ciao, come stai?","engine":"local"}'
curl -s -X POST localhost:7979/lookup -H 'Content-Type: application/json' \
  -d '{"lang":"it","nativeLanguage":"pt-BR","text":"Pulitissima","sentence":"Pulitissima, come la mia coscienza."}'
```

Erros voltam como `{ "error": "...", "code": "..." }`: 400 (requisição inválida), 413 (corpo > 2 MB), 422 (sem tradução local), 502 (falha no provider).
