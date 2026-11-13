# Sync: contrato entre o app e o e-reader

Duas partes, implementadas em paralelo a partir deste documento:

| Parte | Onde | Papel |
|---|---|---|
| Servidor | `apps/web` (SvelteKit + Supabase) | Rotas `/api/v1/sync/*`, página `/parear`, replay do FSRS, snapshot |
| Aparelho | Fork do CrossPoint/CrossNext (`crossnext-blend`, C++, ESP32-S3) no Xteink X4 Pro | Lê o blend, salva itens, revisa flashcards (Reconhecer e fichas) offline seguindo a fila do servidor, guarda `bank.jsonl` e `outbox.jsonl` no SD |

O vocabulário é o do glossário (`CONTEXT.md`): **item**, **lema**, **encontro**, **forma**, **sentido**, **obra**, **flashcard** (Reconhecer/Produzir), **revisão**, **visto**, **conhecido**. A regra do FSRS é a do ADR 0001 (`docs/adr/0001-servidor-decide-o-fsrs-pelo-log.md`): o aparelho manda revisões, o servidor reaplica o log e o estado dele vale.

As palavras **deve**, **não deve** e **pode** são normativas. Exemplos de cada pedido e resposta estão em `docs/sync/fixtures/` (seção 12).

## 1. Visão geral

- O aparelho é offline-first. Ele guarda no SD o **banco** de um idioma de estudo (`bank.jsonl`, cópia do servidor) e as **operações** feitas offline (`outbox.jsonl`).
- **Sync** = enviar o outbox (`push`) e depois baixar o snapshot (`snapshot`). Dispara pelo botão "Sincronizar" ou ao abrir Flashcards com Wi-Fi.
- O banco inteiro do idioma vai para o aparelho: todos os itens e, em versão só texto, as fichas. O aparelho revisa o **Reconhecer** de cada item e um flashcard por ficha (a frente, ou a primeira lacuna).
- **A fila do dia é do servidor** (ADR 0005). O snapshot traz o orçamento de novas (`today.newAllowance`), a ordem das novas (`queueRank`) e quais flashcards estão em espera de teimosa (`leechWaiting`). O aparelho só executa. Decks (`header.decks`) servem para agrupar e mostrar; a ordem já vem pronta.
- O aparelho produz seis tipos de operação: `save` (salvar do blend), `review` (revisão), `seen` (visto), `extraNew` ("+N novas hoje"), `deckImport` (CSV do SD vira deck) e `progress` (posição de leitura de um livro, seção 13).
- Livros com blend gerados no app descem para a pasta `/Linguetta/` do SD no sync (seção 13).
- Toda operação tem um `clientId` (UUID v4 gerado no aparelho). Reenviar é seguro.
- Exclusão vence: item apagado no servidor some do aparelho, e operações que apontam para ele são aceitas e descartadas.

## 2. Convenções

- Base: a URL do app (produção `https://linguetta-app.vercel.app`; self-host e dev trocam no aparelho). Só HTTPS em produção.
- JSON em UTF-8, camelCase. Strings em NFC. O snapshot é JSONL (seção 7).
- Datas: ISO 8601 em UTC com `Z` (`2026-11-11T21:30:00.000Z`). O servidor sempre devolve com milissegundos. O aparelho pode mandar sem milissegundos.
- `language`: qualquer tag BCP 47 na forma canônica de `Intl.getCanonicalLocales` (`it`, `pt-BR`, `zh-Hant`, `tet`), ADR 0004. O servidor canoniza o que recebe (`pt-br` vira `pt-BR`) e recusa o que não é tag (`xx!!`). Não há lista fechada de idiomas.
- Identidade de item: `(language, lemmaKey)`. `lemma` fica como a pessoa escreveu (só NFC: `Haus` continua `Haus`); `lemmaKey` é a chave de comparação que **só o servidor** calcula (`lemmaKey` de `@linguarudo/language`: NFC, caixa e regras do idioma). O aparelho recebe `lemmaKey` no snapshot e nunca o envia.
- Tamanhos de texto contam **code points** (não bytes). O aparelho corta no limite sem partir um caractere.
- Campo opcional ausente, `null` e `""` significam a mesma coisa, salvo onde dito.
- Cabeçalhos do aparelho: `User-Agent: Linguetta-X4/<versão do firmware>`, `Accept-Encoding: identity` (o servidor não comprime a resposta nesse caso).

### Versão do protocolo

Este documento é o **protocolo 1**. Todo POST leva `"protocol": 1` no corpo; todo GET leva `?protocol=1`. Toda resposta JSON (e o cabeçalho do snapshot) traz `"protocol": 1`. Versão desconhecida ou ausente: `426` com `code: "protocol_unsupported"` e `supported: [1]`. Mudança incompatível vira protocolo 2 na mesma rota; campos novos opcionais não mudam a versão, e os dois lados **devem** ignorar campos que não conhecem.

### Autenticação

Rotas marcadas "Bearer" pedem `Authorization: Bearer lr_...`, o token do aparelho recebido no pareamento (seção 3). É o mesmo tipo de token das integrações (`api_tokens`: só o sha256 fica no banco, revogar = apagar a linha). Sem CORS: o cliente não é navegador.

### Erros

Erro de pedido inteiro vem como `{ "message": "texto em PT", "code": "..." }`:

| Status | `code` | Quando | O aparelho |
|---|---|---|---|
| 400 | `bad_request` | Corpo não é JSON, falta campo do envelope, mais de 200 ops, `language` inválido | Não repete igual. Registra o erro |
| 401 | `invalid_token` | Token ausente, inválido ou revogado | Apaga o token do `state.json`, mantém banco e outbox, mostra "Pareie de novo" |
| 410 | `page_expired` | Token de página do snapshot vencido ou de outro pedido | Recomeça o snapshot do zero |
| 413 | `payload_too_large` | Corpo do push > 512 KB | Manda lotes menores |
| 426 | `protocol_unsupported` | Versão do protocolo | Mostra "Atualize o firmware" |
| 429 | `rate_limited` | Limite da seção 10. Traz `retryAfter` (s) e o cabeçalho `Retry-After` | Espera |
| 500, 502, 503, 504 | `server_error` | Falha do servidor ou do banco | Tenta de novo no próximo sync (backoff de 30 s, 2 min, 10 min) |

Problema numa operação só não derruba o pedido: vira um resultado `rejected` ou `dropped` dentro da resposta do push (seção 5).

## 3. Pareamento

Fluxo no formato do device authorization grant (RFC 8628), com JSON e status 200 no polling:

1. O aparelho chama `POST /api/v1/sync/pair/start`.
2. Mostra o código (`K7Q-4MP`) e um QR com `verificationUriComplete`.
3. A pessoa abre `/parear?code=K7Q4MP` (ou `/parear` e digita o código) logada no app e aprova.
4. O aparelho chama `POST /api/v1/sync/pair/poll` a cada `interval` segundos até receber o token, ou até `expiresIn` passar.

### `POST /api/v1/sync/pair/start` (sem auth)

```json
{ "protocol": 1, "deviceName": "X4 Pro", "deviceModel": "xteink-x4-pro", "firmware": "crossnext-linguetta/1.5.0" }
```

- `deviceName`: 1 a 60 code points. Vira o rótulo do token em Integrações.
- `deviceModel` (até 40) e `firmware` (até 60): opcionais, só exibição.

Resposta `200`:

```json
{
  "protocol": 1,
  "deviceCode": "Zk3pQ8vX1mN7cR2tY6wL0aB4dF9hJ5sE_uK8oP3iG7q",
  "userCode": "K7Q-4MP",
  "verificationUri": "https://linguetta-app.vercel.app/parear",
  "verificationUriComplete": "https://linguetta-app.vercel.app/parear?code=K7Q4MP",
  "expiresIn": 600,
  "interval": 5
}
```

- `deviceCode`: segredo do aparelho, 32 bytes aleatórios em base64url (43 caracteres). Não aparece na tela. O servidor guarda só o sha256.
- `userCode`: 6 caracteres do alfabeto `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (sem 0, 1, I, O), mostrado como `XXX-XXX`. Na digitação, o servidor ignora caixa, espaços e hífens. É único entre os pareamentos pendentes.
- `expiresIn`: segundos até o código vencer (600). `interval`: segundos mínimos entre polls (5).

### `POST /api/v1/sync/pair/poll` (sem auth)

```json
{ "protocol": 1, "deviceCode": "Zk3pQ8vX..." }
```

Sempre `200` (salvo `400` para corpo malformado e `429`), com `status`:

| `status` | Significado | O aparelho |
|---|---|---|
| `pending` | Ainda não aprovado | Espera `interval` e tenta de novo |
| `slow_down` | Poll antes do `interval`. Traz o `interval` novo | Passa a usar o novo intervalo |
| `denied` | A pessoa recusou | Para e mostra "Recusado" |
| `expired` | Código vencido, já usado ou desconhecido | Para; oferece recomeçar |
| `approved` | Aprovado. Traz o token | Grava `state.json` e para |

`approved`:

```json
{
  "protocol": 1,
  "status": "approved",
  "token": "lr_pY2vQ9xN4cM8bR1tK6wZ3aL7dF0hJ5sE2uG8oP4iT1k",
  "tokenHint": "iT1k",
  "deviceName": "X4 Pro",
  "account": { "id": "uuid", "email": "matheus@example.com", "uiLanguage": "pt", "nativeLanguage": "pt", "studyLanguages": ["it", "en"] }
}
```

- O token sai **uma vez só**: o servidor o gera no poll que encontra o pareamento aprovado, grava o hash em `api_tokens` (rótulo = `deviceName`) e marca o pareamento como usado. Um poll seguinte com o mesmo `deviceCode` dá `expired`. O token nunca é guardado em claro no servidor.
- Formato do token: igual ao de `generateToken()` (`lr_` + 32 bytes em base64url).
- `account.id` serve para o aparelho notar que foi pareado com **outra** conta: aí ele **deve** perguntar antes de descartar banco, outbox e cursor.
- O aparelho escolhe o idioma de estudo entre `studyLanguages` (o primeiro, se a pessoa não escolher). Trocar de idioma depois pede um snapshot completo (seção 7).
- `uiLanguage` (`pt` | `en`), `nativeLanguage` e `studyLanguages` vêm como estão na conta, **sem padrão**: `uiLanguage`/`nativeLanguage` podem ser `null` e `studyLanguages` pode ser `[]` (de 0 a 20 tags). Com lista vazia, o aparelho pede para escolher um idioma no app antes de sincronizar.

### Página `/parear`

- `GET /parear` e `GET /parear?code=K7Q4MP`. Sem sessão, redireciona para `/entrar` e volta para a mesma URL depois do login.
- Com código válido e pendente: mostra "Conectar **X4 Pro** à sua conta?", o modelo, o código e há quanto tempo foi pedido, com **Aprovar** e **Recusar**. Sem `code`: campo para digitar.
- Código vencido, usado ou inexistente: "Código inválido ou vencido. Gere outro no aparelho."
- Aprovar liga o pareamento à conta logada (`approved`); recusar marca `denied`. As duas só valem para pareamento `pending` e não vencido.

### Revogar

- Em **Integrações**, o token do aparelho aparece com o nome do aparelho (`X4 Pro`), o final do token e o último uso. Revogar apaga a linha de `api_tokens`, como os outros tokens. O próximo pedido do aparelho dá `401 invalid_token`.
- O aparelho pode se desparear: `POST /api/v1/sync/unpair` (Bearer, corpo `{ "protocol": 1 }`) apaga o próprio token e responde `204` sem corpo. Depois disso o aparelho apaga o token do `state.json`.

## 4. Operações

Toda operação tem este envelope:

```js
{
  clientId: "uuid v4",   // gerado na hora da ação; identifica a operação para sempre
  type: "save" | "review" | "seen" | "extraNew" | "deckImport" | "progress",
  at: "2026-11-11T08:15:30.000Z", // quando a pessoa fez a ação, relógio do aparelho
  language: "it",        // idioma de estudo do item (em `progress`, o idioma de estudo do livro)
  // ...campos do tipo
}
```

### `save`: salvar do blend

A pessoa tocou num link do blend (`#lb:LEMA|TRADUÇÃO|NOTA`, ver `crossnext-blend/docs/blend-format.md`) e apertou Salvar.

```js
{
  clientId, type: "save", at, language: "it",
  lemma: "sorridere",          // obrigatório, 1–80. LEMA do link
  sense: "sorrir",             // até 200. TRADUÇÃO do link: vira o sentido do item se ele não tiver
  note: "verbo",               // até 2000. NOTA do link (opcional)
  ipa: "",                     // até 100 (opcional)
  reading: "",                 // até 100 (opcional). Leitura do lema: furigana, pinyin
  pos: "",                     // classe gramatical, até 80 (opcional)
  encounter: {                 // obrigatório
    form: "sorridere",         // até 80. Texto do link como aparece na página
    sentence: "Ela ficou olhando para il mare e começou a sorridere.", // até 500. Frase real da página; "" se o aparelho não conseguir extrair
    sense: "sorrir",           // até 200. Sentido nesse encontro (a TRADUÇÃO do link)
    position: {                // tudo opcional
      chapter: "Primeiro dia", // título do capítulo, até 200
      spine: 4,                // índice do capítulo no spine do EPUB, inteiro >= 0
      percent: 12.5            // progresso no livro, 0–100, uma casa decimal
    }
  },
  work: {                      // obrigatório
    kind: "livro",
    koHash: "a3f1c9e2b7d4068f15e2c3b4a5d6e7f8", // hash parcial do arquivo (seção 9), 32 hex minúsculos
    title: "O nome da rosa",   // 1–200. dc:title do OPF; sem título, o nome do arquivo sem extensão
    author: "Umberto Eco",     // até 200. dc:creator do OPF
    language: "pt"             // dc:language do OPF, se for tag BCP 47 válida (opcional)
  }
}
```

No servidor:

- O servidor calcula `lemmaKey` do `lemma` recebido. O item é achado por `(language, lemmaKey)` entre os não apagados, ou criado com o `lemma` como veio. Se já existe, ganha o encontro, e os campos vazios dele (`sense`, `note`, `ipa`, `reading`, `part_of_speech`) são preenchidos com o que veio. O que a pessoa já escreveu fica. É o mesmo núcleo de `save_items_for`.
- **Exclusão vence:** se não há item vivo com esse lema, mas há um apagado com `deleted_at > at`, a operação é descartada (`dropped`, `item_deleted`). Salvar depois de apagar recria o item.
- O encontro grava `form`, `sentence`, `highlight = form`, `sense`, `position`, `origin = "ereader"`, `seen_at = min(at, agora)` e `client_id = clientId`.
- A obra é achada por `kind = "livro"` + `koHash` (ref_key `kosync:<hash>`), ou criada. Título e autor (`subtitle`) mais novos vencem, como no resto do app.
- O app mostra a origem como "O nome da rosa · Primeiro dia · 12%".
- Item criado pelo `save` cai no deck padrão do idioma ("Minhas palavras"). Item que já existe fica no deck dele. Um encontro novo com frase tira o item da espera de teimosa (`leechWaiting` volta a `false` no próximo snapshot).
- Textos acima do limite são cortados no servidor; `lemma` vazio ou com mais de 80 code points recusa a operação (`rejected`, `invalid`). O aparelho já **deve** cortar antes de gravar no outbox.

### `review`: revisão de um flashcard

```js
{
  clientId, type: "review", at, language: "it", // at = momento da resposta (reviewed_at)
  flashcardId: "uuid",              // flashcard do snapshot...
  saveClientId: "uuid",        // ...ou, para item salvo offline e ainda sem id, o clientId do save
  rating: 3,                   // 1 Errei, 2 Difícil, 3 Bom, 4 Fácil
  durationMs: 6400             // opcional: tempo até responder, 0–3600000
}
```

- Exatamente um entre `flashcardId` e `saveClientId`. Com `saveClientId`, o servidor acha o encontro com esse `client_id`, o item dele e o Reconhecer do item. O `save` vem antes no outbox, então já foi processado (no mesmo lote ou num anterior).
- O aparelho manda revisão do Reconhecer de um item ou do flashcard de uma ficha (`frente` ou `lacuna`, o `flashcard.id` da linha `ficha`). `flashcardId` de um Produzir ou de um `inverso` é recusado (`rejected`, `invalid`).
- **O orçamento nunca recusa revisão.** Uma nova revisada além de `today.newAllowance` (outro aparelho já gastou o dia, relógio adiantado) vale como as outras e conta no `newDoneToday` seguinte.
- Se a revisão leva o flashcard a `lapses >= settings.leech.lapses`, o servidor aplica `settings.leech.action` ao item ou ficha (seção 11). O aparelho só fica sabendo no próximo snapshot.
- O servidor grava o log (`review_logs`: `rating`, `reviewed_at = min(at, agora)`, `client_id`, `duration_ms`) e recalcula o flashcard como o app faz (`scheduleReview`/`replay` em `apps/web/src/lib/server/scheduler.ts`): revisão em ordem só aplica a nota; revisão atrasada (anterior à última do flashcard) reaplica o log inteiro em ordem de `reviewed_at`. Os efeitos são os mesmos da revisão no app, inclusive liberar o Produzir.
- Item `conhecido` ainda aceita a revisão: o log é a verdade.
- Item apagado: `dropped`, `item_deleted`. `flashcardId` que não existe, ou `saveClientId` cujo save foi recusado ou descartado: `dropped`, `unknown_target`.

### `seen`: visto

A pessoa tocou numa palavra do blend que já está no banco. Soma uma aparição; não cria encontro e não mexe no FSRS.

```js
{ clientId, type: "seen", at, language: "it", lemma: "bello" }
```

- O servidor calcula `lemmaKey` do `lemma` e soma 1 em `seen_count` do item vivo com `(language, lemmaKey)` e faz `last_seen_at = max(last_seen_at, min(at, agora))`.
- Sem item vivo: `dropped`, `not_found`.
- Uma operação por toque. O aparelho não agrega toques em contagem.

### `extraNew`: "+N novas hoje"

A pessoa acabou as novas do dia e pediu mais.

```js
{ clientId, type: "extraNew", at, language: "it", n: 5 } // n inteiro, 1–1000
```

- O servidor soma `n` ao extra do dia de estudo de `at` (no relógio do usuário, `at` limitado a agora) no idioma. Resultado: `extraNew`, o extra total do dia depois da soma.
- Vale para todos os aparelhos e para a web: `today.newAllowance` sobe `n` no próximo snapshot. Offline, o aparelho soma `n` à visão local na hora.
- O extra de um dia não passa para o outro.

### `deckImport`: CSV vira deck

```js
{
  clientId, type: "deckImport", at, language: "it",
  name: "Verbi irregolari",          // 1–80 (nome do arquivo sem extensão), sem "::"
  hash: "sha256:9f2c4e1a7b3d",       // 1–128, [A-Za-z0-9_:.-]; identifica o arquivo
  rows: [ { front: "andare", back: "ir" } ] // 1–500 linhas; front obrigatório
}
```

- Cria um deck de topo com ordem `deck` (as novas saem na ordem do arquivo) e uma ficha frente/verso por linha. Nome ocupado no mesmo nível ganha " (2)", " (3)"…
- **Idempotente por hash:** se a conta já tem um deck com esse `hash`, nada é criado e o resultado traz o deck existente com `created: false`. Arquivo maior que 500 linhas vai em vários arquivos (hashes diferentes).
- `front` e `back` são texto: o servidor corta em 2000 code points, escapa e troca quebra de linha por `<br>`. Linha sem `front` recusa a operação (`rejected`, `invalid`, `errors: { "rows.3.front": "frente vazia" }`).
- O deck e as fichas chegam ao aparelho no próximo snapshot.

### Idempotência

- O servidor **deve** fazer cada `clientId` valer no máximo uma vez por usuário. Reenviar um `clientId` já processado devolve `status: "duplicate"` com os mesmos campos do resultado original, sem efeito novo. Vale para todas as operações (registro `sync_ops`).
- O registro de `clientId` dura pelo menos 180 dias. Resultados `dropped` e `rejected` também valem para reenvios: o mesmo `clientId` dá o mesmo resultado.
- Mesmo `clientId` com `type` diferente do original: `rejected`, `client_id_conflict`.
- O aparelho nunca reaproveita um `clientId` e nunca muda uma operação depois de gravá-la no outbox.

### Relógio

- `at` vem do relógio do aparelho em UTC. O aparelho **deve** acertar o relógio por NTP sempre que conecta ao Wi-Fi, antes do push, e manter a hora no sono (RTC).
- O aparelho **não deve** gravar operações enquanto o relógio não for confiável (nunca acertado desde que a bateria acabou; ano < 2026). Nesse estado, mostra "Conecte ao Wi-Fi para acertar a hora" ao salvar ou revisar.
- O servidor limita `at` ao momento em que recebe (data no futuro vira agora). Datas passadas valem como vieram.
- O push leva `deviceNow`. As respostas trazem `serverNow` (e o cabeçalho `Date`), que o aparelho pode usar para acertar o relógio quando o NTP falha.

## 5. Push: `POST /api/v1/sync/push` (Bearer)

```json
{
  "protocol": 1,
  "deviceNow": "2026-11-11T21:30:00.000Z",
  "ops": [ { "clientId": "...", "type": "save", "...": "..." } ]
}
```

- 1 a 200 operações, corpo até 512 KB. Lista vazia é `400`.
- O servidor processa **na ordem do array**, uma por uma. Uma operação pode depender de uma anterior do mesmo lote (`review` com `saveClientId`).
- Cada operação é atômica sozinha. Se o servidor cair no meio do lote, as já feitas ficam, e o reenvio delas dá `duplicate`.

Resposta `200`, com um resultado por operação, **na mesma ordem**:

```json
{
  "protocol": 1,
  "serverNow": "2026-11-11T21:30:01.208Z",
  "results": [
    { "clientId": "...", "status": "applied", "itemId": "uuid", "flashcardId": "uuid", "created": true, "encounterId": "uuid" },
    { "clientId": "...", "status": "applied", "flashcardId": "uuid", "flashcard": { "...": "FlashcardState" } },
    { "clientId": "...", "status": "applied", "itemId": "uuid" },
    { "clientId": "...", "status": "duplicate", "...": "mesmos campos do applied" },
    { "clientId": "...", "status": "dropped", "reason": "item_deleted" },
    { "clientId": "...", "status": "rejected", "reason": "invalid", "errors": { "lemma": "lema vazio" } }
  ]
}
```

| `status` | Significado |
|---|---|
| `applied` | Teve efeito agora |
| `duplicate` | Esse `clientId` já tinha sido processado; nada mudou |
| `dropped` | Aceita e descartada pela regra (`reason`: `item_deleted`, `not_found`, `unknown_target`, `unknown_book`) |
| `rejected` | Inválida, nunca vai valer (`reason`: `invalid` com `errors` por campo, `unknown_type`, `client_id_conflict`) |

Campos extras do `applied`/`duplicate`:

- `save`: `itemId`, `flashcardId` (o Reconhecer), `created` (false = o item já existia), `encounterId`.
- `review`: `flashcardId` e `flashcard` (o `FlashcardState` oficial depois do replay, seção 7).
- `seen`: `itemId`.
- `extraNew`: `extraNew` (extra do dia depois da soma).
- `deckImport`: `deckId`, `created` (false = o hash já existia) e `fichas` (fichas criadas).
- `progress`: `bookId` e `current` (`true` = esta posição virou a do livro; `false` = já havia uma mais nova).

Os quatro status são definitivos: o aparelho trata a operação como resolvida (seção 8). Se o número de resultados não bate com o de operações, o aparelho trata a resposta como erro e não resolve nada.

## 6. Snapshot: `GET /api/v1/sync/snapshot` (Bearer)

```
GET /api/v1/sync/snapshot?protocol=1&language=it[&since=<cursor>][&limit=500][&page=<token>]
```

| Parâmetro | |
|---|---|
| `language` | Obrigatório. Idioma do banco |
| `since` | Opcional. Cursor do último snapshot completo. Pede só o que mudou |
| `limit` | Linhas `item` ou `ficha` por página, 100–1000, padrão 500 |
| `page` | Token de página (`end.next` da página anterior). As demais páginas repetem `language`, `since` e `limit` da primeira |

Resposta `200`, `Content-Type: application/x-ndjson; charset=utf-8`: uma página em JSONL (seção 7). O aparelho pede páginas até `end.next` ser `null`.

- Snapshot completo **sempre** funciona. O delta é otimização: com `since`, o servidor responde `mode: "delta"` ou, se o cursor for desconhecido, velho demais ou o servidor não fizer delta, `mode: "full"`. Cursor ruim nunca é erro. O aparelho trata os dois modos.
- O cursor sai no cabeçalho de cada página (o mesmo em todas). Ele marca o instante em que a **primeira** página foi gerada. O que mudar enquanto o aparelho baixa as páginas vem no próximo delta.
- Token de página vale 15 minutos. Vencido: `410 page_expired`.
- Completo: todos os itens não apagados do idioma, inclusive `conhecido`, em ordem de `id`, e depois todas as fichas não apagadas, em ordem de `id`. Todas as páginas de itens vêm antes das de fichas; uma página nunca mistura os dois. Delta: todo item com qualquer mudança depois do cursor (no item, no Reconhecer ou nos encontros) como linha `item` completa, e uma linha `del` para cada item apagado depois do cursor.
- O servidor ainda não faz delta: responde sempre `mode: "full"` (permitido acima).
- Sem limite de 5000 itens (o de `api_items` não se aplica): a paginação cobre bancos grandes e o limite de resposta das funções da Vercel.

## 7. Formato JSONL do snapshot

Cada linha é um objeto JSON terminado em `\n`, UTF-8 sem BOM, **no máximo 16384 bytes**. O campo `t` diz o tipo. Uma página é:

```
header
item | ficha | del   (0 ou mais; uma página tem só itens ou só fichas)
end
```

### `header`

```json
{
  "t": "header", "protocol": 1, "language": "it", "mode": "full",
  "cursor": "v1.MjAyNi0xMS0xMVQyMTozMDowMi40MTdaOjg4MjEz",
  "serverNow": "2026-11-11T21:30:02.417Z",
  "deckName": "Linguetta · Italiano",
  "total": 5, "fichasTotal": 1,
  "settings": { "uiLanguage": "pt", "nativeLanguage": "pt", "studyLanguages": ["it", "en"], "newFlashcardsPerDay": 10, "reviewsPerDay": 200, "timeZone": "America/Sao_Paulo", "utcOffsetMinutes": -180, "dayStartHour": 4,
                "newOrder": "importance", "desiredRetention": 0.9, "buryRelated": true, "leech": { "lapses": 8, "action": "wait" } },
  "today": { "dayStart": "2026-11-11T07:00:00.000Z", "nextDayStart": "2026-11-12T07:00:00.000Z", "newDoneToday": 1, "extraNew": 0, "newAllowance": 9, "reviewAllowance": 200 },
  "decks": [
    { "id": "5d0c1a2b-3e4f-4a5b-8c6d-7e8f9a0b1c10", "name": "Minhas palavras", "default": true, "parentId": null, "newOrder": "importance", "newPerDay": 10, "reviewsPerDay": 200 },
    { "id": "9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c20", "name": "Gramática", "default": false, "parentId": null, "newOrder": "deck", "newPerDay": 5, "reviewsPerDay": 200 }
  ],
  "fsrs": { "tsFsrs": "6.0.0", "version": "FSRS-7", "desiredRetention": 0.9, "enableFuzz": true,
            "learningSteps": ["1m", "10m"], "relearningSteps": ["10m"], "allowModelOverride": false,
            "maximumInterval": 36500 }
}
```

- `cursor`: opaco, até 200 caracteres. O aparelho só guarda e devolve.
- `deckName`: "Linguetta · " + nome do idioma na língua da interface (`uiLanguage`); sem `uiLanguage`, o nome do idioma nele mesmo ("Linguetta · Deutsch").
- `settings.uiLanguage`, `settings.nativeLanguage`, `settings.studyLanguages`: como no `account` do pareamento, sem padrão (`null`, `null`, `[]` numa conta sem preferências).
- `total`: linhas `item` + `del` somadas em todas as páginas; `fichasTotal`: linhas `ficha` (para a barra de progresso; podem diferir um pouco do recebido).
- `settings.newFlashcardsPerDay` e `settings.reviewsPerDay`: limites Geral de novas e de revisões por dia (`user_settings`), os de "Estudar tudo". `timeZone`/`utcOffsetMinutes`: o fuso do usuário (`user_settings.time_zone`, nulo = `America/Sao_Paulo`). `dayStartHour`: a hora local (0–23, padrão 4, como no Anki) em que o dia de estudo vira. O dia de estudo vai de `dayStartHour`:00 a `dayStartHour`:00 do dia seguinte, no fuso.
- `settings.newOrder`: como a fila intercala os decks (`importance`, `deck` ou `random`); só informativo, a ordem já vem em `queueRank`. `settings.desiredRetention`: a mesma de `fsrs`. `settings.buryRelated`: irmãos ocultos (§11), sempre `true` por enquanto. `settings.leech`: a partir de quantos lapsos um flashcard vira teimosa (`lapses`, 1–99, padrão 8) e o que acontece (`action`: `wait` espera um encontro novo, `tag` só marca, `suspend` suspende).
- `today`: o dia de estudo corrente (começa às `dayStartHour`:00 no fuso), quantos flashcards novos já tiveram a primeira revisão nele (`newDoneToday`, em qualquer aparelho e deck), o extra pedido no dia (`extraNew`) e o **orçamento**: `newAllowance = max(0, newFlashcardsPerDay + extraNew − newDoneToday)`, quantas novas ainda entram hoje; `reviewAllowance = max(0, reviewsPerDay − revisões feitas hoje)`, só informativo (revisão nunca é recusada). Depois de `nextDayStart`, o aparelho zera `newDoneToday` e `extraNew`, usa `newAllowance = newFlashcardsPerDay` e passa a usar dias de 24 h a partir dele até o próximo sync.
- `decks`: os decks do idioma marcados "no leitor" e não pausados (nem filhos de pausado), na ordem da árvore (pai, depois os filhos). `parentId` aponta para outro deck da lista (um nível só). `newPerDay`/`reviewsPerDay`: limites do deck que valem hoje (Só hoje > Este baralho > Geral; o subdeck também conta no pai), já aplicados em `queueRank`. Item ou ficha com `deckId` fora da lista está num deck que não vai para o leitor: o aparelho mostra no banco, mas não revisa.
- `fsrs`: os parâmetros do agendador do servidor. `desiredRetention` é da conta (`user_settings.desired_retention`, 0,70–0,97, padrão 0,9) e vale a partir da próxima revisão; o aparelho agenda com ela. Se diferirem dos que o firmware implementa, o aparelho continua funcionando (o servidor decide), mas mostra um aviso discreto de "agendamento aproximado".

### `item`

```json
{
  "t": "item",
  "id": "7a1e4c90-5b2d-4f3a-9e8c-1d2f3a4b5c01",
  "lemma": "bello", "lemmaKey": "bello", "language": "it",
  "sense": "bonito", "note": "adjetivo", "ipa": "", "pos": "",
  "status": "ativo",
  "deckId": "5d0c1a2b-3e4f-4a5b-8c6d-7e8f9a0b1c10", "queueRank": null, "leechWaiting": false,
  "seenCount": 6, "lastSeenAt": "2026-11-11T08:20:00.000Z",
  "createdAt": "2026-11-01T12:00:00.000Z",
  "updatedAt": "2026-11-11T21:30:01.180Z",
  "forms": ["bella"],
  "encounters": [
    { "form": "bella", "sentence": "Era uma bella manhã do fim de novembro.", "sense": "bonita", "work": "O nome da rosa", "at": "2026-11-09T20:12:00.000Z" }
  ],
  "flashcard": { "...": "FlashcardState" }
}
```

| Campo | |
|---|---|
| `id` | Id do item |
| `lemma`, `language` | Como no banco: lema como escrito, tag canônica |
| `lemmaKey` | Chave do item no idioma (calculada pelo servidor). Use para comparar lemas e formas; nunca mande de volta |
| `reading` | Leitura do lema (furigana, pinyin), até 100. Ausente se vazia |
| `sense` | Sentido principal (até 200). É o verso do flashcard |
| `note` | Nota do item, **cortada em 200 code points** no snapshot |
| `ipa`, `pos` | Pronúncia e classe (`part_of_speech`) |
| `status` | `ativo` ou `conhecido`. Conhecido fica no banco (conta como "no seu banco" e recebe visto) mas não entra no baralho |
| `deckId` | Deck do item (sempre presente) |
| `queueRank` | Posição do Reconhecer entre as novas de hoje: 1 = a primeira. Numeração única entre itens e fichas, com buracos possíveis. `null` = não é nova, ou não entra hoje (teto do deck, irmão revisado hoje, deck fora do leitor). Sempre presente |
| `leechWaiting` | `true` = teimosa em espera (ou suspensa): fora da fila até um encontro novo ou "Voltar para a fila" na web. Sempre presente |
| `seenCount`, `lastSeenAt` | Contador de visto |
| `createdAt` | Criação do item |
| `updatedAt` | Última mudança do item, do Reconhecer ou dos encontros. Aumenta a cada mudança |
| `forms` | Formas vistas nos encontros, como escritas, uma por chave e sem a do lema, até 10 |
| `encounters` | Os 2 encontros mais recentes (por `seen_at`), cada um com `form`, `sentence`, `sense`, `work` (título da obra ou ausente) e `at` |
| `flashcard` | O Reconhecer (`FlashcardState`). Sempre presente |
| `siblingReviewedAt` | Última revisão do Produzir do mesmo item (`lastReviewAt` dele), feita em qualquer aparelho. Ausente se nunca revisado. Serve para ocultar irmãos (§11) |

O servidor pode omitir campos de texto vazios, `null` e listas vazias (exceto em `flashcard`, `deckId`, `queueRank` e `leechWaiting`). O Produzir não vem: o aparelho não o revisa.

### `ficha`

Uma ficha (cartão livre, frente/verso ou lacuna) em versão só texto, sem mídia. Uma linha por ficha, com um flashcard: o `frente`, ou a lacuna de menor `ord`.

```json
{
  "t": "ficha",
  "id": "c3b2a1f0-9e8d-4c7b-a6f5-e4d3c2b1a030",
  "deckId": "9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c20",
  "language": "it",
  "kind": "lacuna",
  "front": "Ieri [andare] al mare. Passato prossimo",
  "back": "Ieri sono andato al mare. Passato prossimo — Verbo de movimento: auxiliar essere.",
  "status": "ativo",
  "queueRank": 2, "leechWaiting": false,
  "createdAt": "2026-11-05T10:00:00.000Z", "updatedAt": "2026-11-05T10:00:00.000Z",
  "flashcard": { "...": "FlashcardState" }
}
```

| Campo | |
|---|---|
| `kind` | `frente` (frente/verso) ou `lacuna` |
| `front`, `back` | Texto puro, até 2000 code points cada. HTML vira texto (quebras viram espaço), mídia some. Na lacuna, `front` mostra a lacuna como `[dica]` ou `[…]` e `back` é a frase completa, seguida de " — " e o verso, se houver |
| `status` | `ativo` ou `conhecido`. Conhecida não entra na fila |
| `queueRank`, `leechWaiting`, `deckId` | Como no item |
| `flashcard` | `FlashcardState` do flashcard da linha; a revisão usa o `flashcard.id` dele |

O aparelho não cria, edita nem apaga fichas (a não ser pelo `deckImport`).

### `FlashcardState`

Os campos do `Card` do ts-fsrs 6, em camelCase (as colunas de `flashcards`). **Todos sempre presentes**:

```json
{
  "id": "0b9f3c2e-6a51-4d7e-9c1a-3f2b8d4e5a01",
  "createdAt": "2026-11-01T12:00:00.000Z",
  "dueAt": "2026-11-28T13:00:00.000Z",
  "stability": 9.8771004,
  "stabilityFast": 163.75129401,
  "difficulty": 3.49771674,
  "state": 2,
  "scheduleStatus": "review",
  "lastReviewAt": "2026-11-04T13:00:00.000Z",
  "reps": 2,
  "lapses": 0,
  "scheduledDays": 24,
  "learningStep": 0
}
```

- `state`: 0 novo, 1 aprendendo, 2 revisão, 3 reaprendendo. `scheduleStatus`: `new`, `learning` ou `review` (reaprendendo também é `learning`).
- `stability`, `stabilityFast`, `difficulty`, `scheduledDays`: double (`scheduledDays` pode ser fracionário: 1 min = 0.000694…). `lastReviewAt`: `null` no flashcard novo.

### `del` (só no delta)

```json
{ "t": "del", "id": "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e006", "at": "2026-11-10T12:44:00.000Z" }
```

### `end`

```json
{ "t": "end", "count": 3, "next": "p1.eyJsIjoiaXQi..." }
```

- `count`: linhas `item` + `ficha` + `del` desta página. O aparelho confere; se não bate, ou se a página terminou sem `end` (conexão caiu), descarta o snapshot em andamento.
- `next`: token da próxima página, ou `null` na última. Ele também diz se a próxima página é de itens ou de fichas; o aparelho não precisa saber.

## 8. Arquivos no SD

Pasta `/.linguetta/` na raiz do cartão SD. Toda reescrita é atômica: grava `<nome>.tmp`, faz `flush`/`fsync` e renomeia por cima.

### `bank.jsonl`

- O snapshot do servidor, sem páginas: o `header` da primeira página, depois todas as linhas `item` e `ficha`. Sem `end` e sem `del`. Exemplo em `fixtures/bank.jsonl`.
- **Só muda no sync.** O aparelho não edita o banco ao salvar ou revisar offline; essas mudanças vivem no outbox (veja "Visão local" abaixo).
- Snapshot `full`: o aparelho grava `bank.jsonl.tmp` página a página e só renomeia depois da última página válida. `delta`: o aparelho reescreve o arquivo trocando as linhas `item` pelo `id`, acrescentando os itens novos, removendo os `del` e trocando o `header` pelo novo.
- O aparelho não carrega o arquivo inteiro na RAM: lê linha a linha (buffer de 16 KB) e mantém índices próprios (lema/forma → offset) em `/.linguetta/cache/`, reconstruídos quando `bank.jsonl` muda.

### `outbox.jsonl`

- Uma operação por linha, exatamente como vai no push (seção 4). Só acrescenta no fim; cada linha termina em `\n` e é seguida de `fsync`.
- Ao ler, uma última linha incompleta (sem `\n` ou JSON inválido) é descartada: foi um desligamento no meio da escrita.
- A ordem do arquivo é a ordem de envio.
- Exemplo em `fixtures/outbox.jsonl`.

### `state.json`

```json
{
  "v": 1,
  "protocol": 1,
  "server": "https://linguetta-app.vercel.app",
  "token": "lr_...",
  "tokenHint": "iT1k",
  "deviceName": "X4 Pro",
  "account": { "id": "uuid", "email": "matheus@example.com", "uiLanguage": "pt", "nativeLanguage": "pt", "studyLanguages": ["it", "en"] },
  "language": "it",
  "cursor": "v1....",
  "lastSyncAt": "2026-11-11T21:30:03.020Z",
  "lastSyncStatus": "ok",
  "lastError": null
}
```

- `token` fica em claro no SD (o aparelho não tem cofre). Quem pega o cartão SD pega o token; a defesa é revogar em Integrações.
- `cursor`: só é gravado depois de um snapshot completo terminar. `null` = o próximo snapshot é completo.
- `lastSyncStatus`: `ok` ou `error`; `lastError`: o `code` ou uma mensagem curta.
- Trocar de idioma: `cursor = null` e o próximo sync baixa o banco completo do idioma novo. O outbox fica (cada operação leva seu `language`).

### Visão local

O que o aparelho mostra entre um sync e outro é `bank.jsonl` + o outbox:

- **Itens:** os do banco, mais um item local para cada `save` do outbox cujo lema não está no banco. O aparelho não calcula `lemmaKey`: compara o lema do `save` com o `lemmaKey` dos itens do banco por uma aproximação local (minúsculas Unicode simples); no próximo sync vale a resposta do servidor. Um `save` de lema que já está no banco acrescenta o encontro só na visão local.
- **Flashcards:** o estado do banco, com as `review` do outbox daquele flashcard aplicadas pelo FSRS local em ordem de `at`. O flashcard de um item local nasce novo (`state` 0, `dueAt = at` do save) e usa o `saveClientId` no lugar do `flashcardId` (também como semente do fuzz).
- **Visto:** `seenCount` do banco + `seen` do outbox.
- **Novos de hoje:** `today.newDoneToday` + as `review` do outbox, com `at >= today.dayStart`, de flashcards que estavam novos na visão local.
- **Orçamento:** `today.newAllowance` + os `n` dos `extraNew` do outbox do dia − as novas revisadas offline no dia (o mesmo conjunto de "Novos de hoje", sem o `newDoneToday`, que já está descontado).

### Ordem do sync

1. Acerta o relógio (NTP).
2. **Push:** envia o outbox em lotes de até 200, na ordem do arquivo, até mandar tudo. Guarda na memória o `clientId` de cada operação resolvida. Erro de pedido (sem resposta, 5xx, 429): para o sync e mantém o outbox inteiro.
3. **Snapshot:** com `since = cursor` (ou sem, se `null`), baixa todas as páginas e atualiza `bank.jsonl`.
3b. **Livros:** `GET /api/v1/sync/books` e espelha `/Linguetta/` (seção 13). Falha aqui não desfaz os passos anteriores: o sync conta como `ok` e o livro tenta de novo no próximo.
4. Só então reescreve o outbox sem as operações resolvidas no passo 2 e grava o `cursor` novo em `state.json`. Operações feitas durante o sync (se a interface permitir) ficam.
5. Se o snapshot falhar, o outbox não muda: no próximo sync as operações voltam e dão `duplicate`. Assim a visão local nunca perde uma revisão que o banco ainda não mostra.

- Resultados `rejected` podem ir para `/.linguetta/rejected.jsonl` (a operação + o resultado, até 100 linhas) para diagnóstico.
- `401` em qualquer passo: para, apaga o token, mantém banco e outbox.

## 9. Obra do livro: hash parcial do KOSync

A obra de um livro é identificada pelo mesmo hash que o KOReader usa no KOSync (`util.partialMD5`), sobre os bytes do arquivo EPUB. O firmware já tem essa conta em `crossnext-blend/lib/KOReaderSync/KOReaderDocumentId.cpp` (`KOReaderDocumentId::calculate`); use essa.

```
md5 = MD5()
para i de -1 até 10:
    offset = (i == -1) ? 0 : 1024 << (2*i)
    se offset >= tamanho do arquivo: pare
    md5.update(até 1024 bytes a partir de offset; menos se o arquivo acabar antes)
hash = md5 em hex minúsculo (32 caracteres)
```

- Offsets: 0, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864, 268435456, 1073741824.
- O primeiro offset é **0**, não 256. No Lua do KOReader é `bit.lshift(1024, -2)`, e o LuaJIT usa só os 5 bits baixos da contagem (−2 → 30), o que dá 0 em 32 bits. Em C++, `1024 << -2` é comportamento indefinido: trate `i = -1` à parte.
- Arquivo vazio: MD5 de nada, `d41d8cd98f00b204e9800998ecf8427e`.
- Vetores de teste em `fixtures/kosync-hash-vectors.json`.
- No servidor: `works.refs = { "ko_hash": "<hash>" }`, ref_key `kosync:<hash>`. `title` = título do OPF e `subtitle` = autor. Editar o livro muda o hash e cria outra obra; tudo bem.
- O aparelho calcula o hash uma vez por arquivo e guarda em cache (`/.linguetta/cache/`, por caminho + tamanho + mtime).

## 10. Limites

| O quê | Limite |
|---|---|
| Operações por push | 200 |
| Corpo do push | 512 KB |
| Itens por página do snapshot | `limit` 100–1000, padrão 500 |
| Linha do JSONL | 16384 bytes |
| Encontros por item no snapshot | 2 |
| `forms` por item no snapshot | 10 |
| `note` no snapshot | 200 code points |
| Validade do token de página | 15 min |
| `pair/start` | 10 por hora por IP (`429`) |
| `pair/poll` | 1 a cada `interval` s por `deviceCode` (`slow_down`) |
| Validade do `userCode` | 10 min |
| Pareamentos pendentes por IP | 5 |
| push + snapshot + books | 60 pedidos por minuto por token, somados (`429`) |
| Registro de `clientId` | ≥ 180 dias |
| `extraNew.n` | 1–1000 |
| Linhas por `deckImport` | 1–500 |
| `front`/`back` da ficha (snapshot e `deckImport`) | 2000 code points |
| `hash` do `deckImport` | 128 caracteres |
| EPUB original enviado no app | 50 MB |
| Livros na lista do aparelho | 200 |
| Validade do `downloadUrl` | 15 min |

Campos de texto (code points): `lemma` 1–80, `sense` 200, `note` 2000, `ipa` 100, `reading` 100, `pos` 80, `form` 80, `sentence` 500, `title` 200, `author` 200, `chapter` 200, `deviceName` 60, nome de deck 80. São os `LIMITS` de `apps/web/src/lib/items.ts`.

## 11. Paridade do FSRS

- O servidor usa **ts-fsrs 6.0.0** (`bun.lock`) por `DefaultScheduler({ desiredRetention, enableFuzz: true, allowModelOverride: false })`, com a `desiredRetention` da conta (`header.fsrs`; os vetores usam 0,9), em `apps/web/src/lib/server/scheduler.ts`. Isso dá:
  - modelo **FSRS-7**, pesos padrão (`FSRS7_DEFAULT_WEIGHTS`), dias fracionários (`fractionalDays: true`);
  - `enableShortTerm: true`, passos de aprendizado `["1m", "10m"]`, reaprendizado `["10m"]`, `maximumInterval` 36500;
  - `allowModelOverride: false` (o FSRS-7 liga por padrão): com passo definido para a nota, o intervalo é o do passo, sem `max(passo, modelo)`. Novo e reaprendendo passam por 1 min / 10 min como no Anki; sem isso, Difícil num novo dava ~14 h e Bom ~6 d. `graduatingInterval` 1;
  - middlewares na ordem: retenção desejada, fuzz, estatísticas, scheduled days, passos de aprendizado, intervalo máximo, intervalo monotônico;
  - fuzz determinístico: semente = `flashcardId` + `String(reps)` (o `reps` **depois** da revisão), hash FNV-1a de 32 bits sobre as unidades UTF-16 da string, PRNG mulberry32, primeiro valor; só para intervalo ≥ 2,5 dias, faixas `FUZZ_RANGES` (2,5–7 d: 15%; 7–20 d: 10%; > 20 d: 5%).
- A fonte de referência para o port é o pacote instalado: `apps/web/node_modules/ts-fsrs/dist/models/fsrs-7.mjs` (modelo), `dist/middlewares-*.mjs` (fuzz, passos, intervalos) e `dist/index.mjs` (`DefaultScheduler`), mais `@open-spaced-repetition/srs-kit` 1.0.0.
- O FSRS do aparelho **deve** passar `fixtures/fsrs-vectors.json`: para cada caso, partindo de um flashcard novo (`dueAt = createdAt`, tudo zero, `scheduleStatus: "new"`) com o `flashcardId` dado, aplica cada revisão (`rating`, `reviewedAt`) e compara com `expected`. Tolerância: `float` (1e-6, relativa ou absoluta, a maior) em `stability`, `stability_fast`, `difficulty` e `scheduled_days`; `dueAtMs` (1000 ms) em `due_at`; igualdade exata em `state`, `schedule_status`, `reps`, `lapses`, `learning_step` e `last_review_at`. Os `steps` estão sempre em ordem de `reviewedAt`, e o `expected` do passo N é o flashcard depois das N primeiras. O caso `fora-de-ordem` testa também o replay: entregue as revisões na ordem `arrivalOrder` (índices em `steps`); depois de todas, o flashcard tem de ser o `expected` do último passo, porque o replay ordena por `reviewedAt` (empate: ordem de chegada).
- O servidor **deve** continuar passando os mesmos vetores (um teste em `apps/web` que lê o arquivo). Trocar a versão do ts-fsrs ou os parâmetros pede vetores novos: `bun docs/sync/fixtures/generate-fsrs-vectors.ts > docs/sync/fixtures/fsrs-vectors.json`, e o aviso do `header.fsrs` cobre os aparelhos ainda não atualizados.
- Mesmo com paridade, o estado local vale só até o próximo sync: o snapshot traz o estado oficial e o aparelho o adota sem comparar.

### Fila do baralho no aparelho

A mesma regra do app (`buildQueue` em `apps/web/src/lib/review.ts` + `planNew` em `apps/web/src/lib/server/queue.ts`), sobre a visão local, só itens `ativo` e fichas `ativo` de decks em `header.decks`, e nunca com `leechWaiting: true`:

1. Vencidos (`isDue`), mais atrasado primeiro: aprendendo e reaprendendo (`state` 1 e 3) quando `dueAt <= agora`; em revisão (`state = 2`) quando `dueAt < nextDayStart`, ou seja, a revisão vale para o dia de estudo inteiro em que vence, como no Anki. Depois de `today.nextDayStart` sem novo sync, os dias seguintes contam de 24 em 24 h.
2. Novos (`state = 0`) com `queueRank` não nulo, em ordem de `queueRank`, até o orçamento local (§8 "Visão local"). Novo com `queueRank: null` não entra hoje. Item salvo offline (sem rank) entra depois dos que têm rank. O aparelho não reordena nem aplica tetos: já vêm aplicados.

Estudar um deck só: as mesmas regras restritas ao deck e aos filhos dele (`parentId`); o orçamento é o mesmo do idioma.

Irmãos ocultos, como no Anki: o Reconhecer e o Produzir do mesmo item não caem no mesmo dia de estudo. Um flashcard em revisão (`state = 2`) ou novo sai da fila de hoje se `siblingReviewedAt >= today.dayStart` (o aparelho não revisa o Produzir, então só o servidor muda esse campo). Aprendendo e reaprendendo (`state` 1 e 3) não esperam: os passos são em minutos. O servidor também conta só um flashcard em revisão por item no "N para revisar".

3. Flashcard errado que vence em até 20 minutos volta para o fim da fila da mesma sessão.

Frente do flashcard: o lema (com `reading` acima, se houver, e `ipa`). Verso: `sense`, `note` e a frase do encontro mais recente com a forma destacada.

## 12. Fixtures

Em `docs/sync/fixtures/`. Todas descrevem o mesmo momento: o X4 Pro sincroniza às 21:30 de 11/11/2026 com nove operações offline.

| Arquivo | O quê |
|---|---|
| `pair-start.request.json`, `pair-start.response.json` | Início do pareamento |
| `pair-poll.request.json`, `pair-poll.responses.json` | Poll e as cinco respostas possíveis |
| `push.request.json`, `push.response.json` | Push com `duplicate`, `applied` (save, review, review por `saveClientId`, seen, extraNew, deckImport), `dropped` e `rejected` |
| `snapshot-full.page1.jsonl`, `snapshot-full.page2.jsonl`, `snapshot-full.page3.jsonl` | Snapshot completo com `limit=3`: duas páginas de itens e uma de fichas |
| `snapshot-delta.jsonl` | O mesmo momento como delta, com uma linha `del` e uma `ficha` |
| `errors.json` | Corpo de cada erro |
| `bank.jsonl`, `outbox.jsonl`, `state.json` | Arquivos do SD (o outbox é o de antes do push; o banco e o estado, os de depois) |
| `fsrs-vectors.json` | Vetores do FSRS gerados com o ts-fsrs real por `generate-fsrs-vectors.ts` |
| `kosync-hash-vectors.json` | Vetores do hash parcial gerados por `generate-kosync-vectors.ts` |
| `books.response.json`, `library.json`, `progress.op.json` | Lista de livros (seção 13), o manifesto no SD depois do espelho e uma operação `progress` |

Os estados de flashcard nos fixtures também saíram do `replay()` do servidor.

## 13. Livros com blend

A pessoa envia um EPUB em `/livros` no app, escolhe a língua do blend, os capítulos e o "% das palavras", e o app gera o livro com links `#lb:` (formato do `blend-format.md`). Cada geração (inclusive "continuar o blend" em mais capítulos) cria uma **versão** nova do arquivo. Livros com a chave **No aparelho** ligada e pelo menos uma versão pronta descem no sync.

### `GET /api/v1/sync/books?protocol=1` (Bearer)

```json
{
  "protocol": 1,
  "serverNow": "2026-11-11T21:30:04.000Z",
  "books": [
    {
      "id": "b7e1c2d3-4f5a-4b6c-8d7e-9f0a1b2c3d40",
      "title": "O alienista",
      "author": "Machado de Assis",
      "bookLanguage": "pt",
      "language": "it",
      "file": "O alienista.PT-IT.epub",
      "version": 3,
      "size": 412233,
      "koHash": "5e0f1a2b3c4d5e6f708192a3b4c5d6e7",
      "downloadUrl": "https://<projeto>.supabase.co/storage/v1/object/sign/books/...?token=...",
      "updatedAt": "2026-11-11T20:02:11.000Z",
      "progress": { "spine": 4, "chapterPercent": 37.5, "percent": 21.3, "at": "2026-11-11T20:40:00.000Z", "source": "web" }
    }
  ]
}
```

- Lista **completa** (sem delta, sem páginas), no máximo 200 livros, por `updatedAt` decrescente. Livro fora da lista (apagado, chave desligada ou sem versão pronta) deve sair do SD.
- `language`: o idioma de estudo do blend (o que os `#lb:` ensinam). `bookLanguage`: língua do texto e das traduções.
- `file`: nome do arquivo em `/Linguetta/`, único na lista. Forma: título limpo (sem `/\:*?"<>|` e controles, até 80 code points) + `.` + par em maiúsculas (`PT-IT`, primeiro subtag de cada) + `.epub`; colisão ganha ` (2)` antes do par. O par no nome é o que o aparelho já usa para escolher o banco do save (`pickBlendLanguage`).
- `version`: inteiro que sobe a cada geração. `koHash`: hash da seção 9 sobre os bytes **desta** versão (o servidor calcula ao gerar). `size`: bytes.
- `downloadUrl`: URL assinada do Supabase Storage, válida 15 minutos, **sem** `Authorization` (o aparelho não manda o token para outro host). Aceita `Range`. Vencida: pedir a lista de novo.
- `progress`: a posição mais nova do livro em qualquer lugar (aparelho ou leitor web), ou `null`. `spine`: índice no spine; `chapterPercent`: 0–100 dentro do capítulo; `percent`: 0–100 no livro; `source`: `device` ou `web`.

### Espelho em `/Linguetta/`

- O aparelho guarda o que baixou em `/.linguetta/library.json` (exemplo em `fixtures/library.json`): `{ "v": 1, "books": { "<id>": { "file", "version", "koHash", "size" } } }`.
- Para cada livro da lista: se não está no manifesto, ou a `version` difere, ou o arquivo sumiu do SD, baixa para `/Linguetta/<file>.part`, confere `size` e o `koHash` (seção 9) e renomeia por cima de `<file>`. Se o `file` mudou (título editado), apaga o antigo depois. Só então atualiza o manifesto (escrita atômica, seção 8). Um download falho apaga o `.part` e tenta no próximo sync.
- Livro no manifesto e fora da lista: apaga o arquivo e a entrada. O aparelho **nunca** apaga em `/Linguetta/` um arquivo que não está no manifesto (é da pessoa).
- Ao trocar a versão de um livro aberto, o aparelho fecha o livro antes de substituir.
- Grava `/.linguetta/books.json` (a escolha de idioma por livro) com `language` do livro, pelo caminho novo.
- Cache de seção do CrossPoint é por caminho + tamanho; arquivo novo invalida sozinho.

### Obra do livro

Todas as versões apontam para a **mesma obra** (`works`, `kind = "livro"`). No `save`, o servidor procura primeiro o `koHash` entre as versões dos livros da conta; achou, usa a obra do livro (título e autor do livro). Senão, cai na regra da seção 9.

### `progress`: posição de leitura

```js
{
  clientId, type: "progress", at, language: "it",
  koHash: "5e0f1a2b3c4d5e6f708192a3b4c5d6e7", // do arquivo aberto
  spine: 4, chapterPercent: 37.5, percent: 21.3
}
```

- O aparelho grava uma operação ao fechar o livro ou ao sair para a tela inicial, se a posição mudou desde a última gravada (no máximo uma a cada 5 minutos de leitura contínua). O outbox pode ter várias do mesmo livro; o servidor fica com a de maior `at`.
- O servidor acha o livro pelo `koHash` de qualquer versão. Sem livro: `dropped`, `unknown_book`. `language` não precisa bater.
- Quem leu por último vence: a posição vale se `at` (limitado a agora) for maior que a guardada; senão `current: false`.
- Ao abrir um livro da lista, o aparelho usa `progress` do último `books` se ele for mais novo que a posição local (cache do CrossPoint) e ainda não estiver no outbox uma posição local mais nova. Versão nova do arquivo: o aparelho volta ao `spine` + `chapterPercent` (a paginação mudou).
- O leitor web grava a mesma posição direto no banco (`source: "web"`), com a mesma regra.

## 14. Notas para o servidor (não normativas)

O que o banco atual (`supabase/migrations/`) ainda não tem e o contrato pede. O desenho é livre; o comportamento é o das seções acima.

- **Pareamentos:** uma tabela tipo `device_pairings` (`device_code_hash`, `user_code`, `device_name`, `device_model`, `firmware`, `status` pending/approved/denied/consumed, `user_id`, `expires_at`, `last_poll_at`, `created_at`), com funções security definer para start/poll (anônimas) e approve/deny (sessão). O token nasce no poll (`generateToken()` + insert em `api_tokens`).
- **Tokens:** `api_tokens` pode ganhar `kind` (`integracao` | `aparelho`) e o modelo do aparelho, para Integrações mostrar o X4 Pro à parte. `api_token_owner` continua valendo.
- **Obras:** `ko_hash` nas `refs` (check `^[0-9a-f]{32}$`) e o ramo `kosync:` em `ref_key` e em `work_for`.
- **Encontros:** `position` aceita `chapter`, `spine` e `percent`; `formatWorkSource` mostra "título · capítulo · N%". `origin = "ereader"` já existe.
- **Revisões:** `review_logs.duration_ms` (nulo). Uma função `api_*` com token que faça o que `record_review` faz, ou o servidor calcula com `scheduleReview` e grava com a checagem de `reps`.
- **Idempotência do visto:** um registro `sync_ops (user_id, client_id, type, result jsonb, received_at)` com chave `(user_id, client_id)` resolve as três operações de uma vez e guarda o resultado para o `duplicate`.
- **Exclusão vence no save:** procurar item apagado com o mesmo `(language, lemmaKey)` e `deleted_at > at`.
- **Delta:** `updatedAt` precisa subir também quando o Reconhecer ou um encontro muda (hoje `items.updated_at` só sobe em update do item). Um contador monotônico (sequence) por mudança dá um cursor seguro contra transações concorrentes; enquanto não houver, responder sempre `mode: "full"` cumpre o contrato.
- **`today.newDoneToday`:** a mesma conta de `review_counts` com `dayStart` de `review.ts`.
- **Livros:** bucket privado `books` (`<user_id>/<book_id>/original.epub` e `<user_id>/<book_id>/v<N>.epub`); tabelas `books` (título, autor, `book_language`, `language`, `coverage`, `on_device`, `work_id`, versão atual), `book_chapters` (por `spine`: título, palavras, estado, candidatas da IA em jsonb), `book_versions` (`version`, caminho, `ko_hash`, `size`) e `book_progress` (uma linha por livro: `spine`, `chapter_percent`, `percent`, `at`, `source`). `work_for` consulta `book_versions.ko_hash` antes do ramo `kosync:`.
- **Livros, como está feito** (`supabase/migrations/20261113120000_livros.sql`, `apps/web/src/lib/server/books.ts`): o navegador sobe o original direto no Storage e o servidor abre, conta os capítulos e chama `create_book`. O blend corre por pedaço de capítulo (umas 40 candidatas por chamada da IA, `POST /livros/[id]/blend`); `book_chapters.candidates` guarda `{ parts, done, coverage, byPart: { "<i>": Candidate[] } }` e mudar língua ou `%` zera. `POST /livros/[id]/gerar` monta a versão com os capítulos prontos do intervalo, sobe `v<N>.epub`, grava a linha em `book_versions` e apaga os arquivos das versões antigas (as linhas ficam, para o `koHash` de um arquivo velho no SD ainda achar o livro). Sem chave de serviço no servidor, a assinatura do `downloadUrl` passa por `book_signing`: `api_sync_books` libera os caminhos da lista por 2 minutos e uma política anônima de `storage.objects` (`book_signable`) deixa a rota assinar só esses. Encontros salvos no leitor web usam `origin = "leitor"`.
- **Fila:** `api_sync_snapshot` devolve o estado da fila (`queue_state_for`) em toda página; a rota calcula `queueRank` com `readerRanks` e o cabeçalho com `readerDecks` (`apps/web/src/lib/server/queue.ts`). Decks: `supabase/migrations/20261112080000_decks.sql`.
