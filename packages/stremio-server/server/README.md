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

## Teste rápido

```sh
curl -s localhost:7979/health
curl -s -X POST localhost:7979/annotate -H 'Content-Type: application/json' \
  -d '{"sourceLang":"pt","targetLang":"it","density":0.1,"cues":[{"id":"c1","text":"Eu não quero só ir às festas."}]}'
```

Erros voltam como `{ "error": "..." }`: 400 (requisição inválida), 413 (corpo > 2 MB), 502 (falha no provider).
