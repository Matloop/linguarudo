# Sync: contrato entre o app e o e-reader

Duas partes, implementadas em paralelo a partir deste documento:

| Parte | Onde | Papel |
|---|---|---|
| Servidor | `apps/web` (SvelteKit + Supabase) | Rotas `/api/v1/sync/*`, página `/parear`, replay do FSRS, snapshot |
| Aparelho | Fork do CrossPoint/CrossNext (`crossnext-blend`, C++, ESP32-S3) no Xteink X4 Pro | Lê o blend, salva itens, revisa flashcards Reconhecer offline, guarda `bank.jsonl` e `outbox.jsonl` no SD |

O vocabulário é o do glossário (`CONTEXT.md`): **item**, **lema**, **encontro**, **forma**, **sentido**, **obra**, **flashcard** (Reconhecer/Produzir), **revisão**, **visto**, **conhecido**. A regra do FSRS é a do ADR 0001 (`docs/adr/0001-servidor-decide-o-fsrs-pelo-log.md`): o aparelho manda revisões, o servidor reaplica o log e o estado dele vale.

As palavras **deve**, **não deve** e **pode** são normativas. Exemplos de cada pedido e resposta estão em `docs/sync/fixtures/` (seção 12).

## 1. Visão geral

- O aparelho é offline-first. Ele guarda no SD o **banco** de um idioma de estudo (`bank.jsonl`, cópia do servidor) e as **operações** feitas offline (`outbox.jsonl`).
- **Sync** = enviar o outbox (`push`) e depois baixar o snapshot (`snapshot`). Dispara pelo botão "Sincronizar" ou ao abrir Flashcards com Wi-Fi.
- O banco inteiro do idioma vai para o aparelho. O aparelho mostra um baralho só, "Linguetta · <Idioma>", e revisa só os flashcards **Reconhecer**. Outros baralhos importados no aparelho ficam locais e nunca sincronizam.
- O aparelho produz três tipos de operação: `save` (salvar do blend), `review` (revisão de Reconhecer) e `seen` (visto).
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
  type: "save" | "review" | "seen",
  at: "2026-11-11T08:15:30.000Z", // quando a pessoa fez a ação, relógio do aparelho
  language: "it",        // idioma de estudo do item
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
- Textos acima do limite são cortados no servidor; `lemma` vazio ou com mais de 80 code points recusa a operação (`rejected`, `invalid`). O aparelho já **deve** cortar antes de gravar no outbox.

### `review`: revisão de um flashcard Reconhecer

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
- O aparelho só manda revisão de Reconhecer. `flashcardId` de um Produzir é recusado (`rejected`, `invalid`).
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

### Idempotência

- O servidor **deve** fazer cada `clientId` valer no máximo uma vez por usuário. Reenviar um `clientId` já processado devolve `status: "duplicate"` com os mesmos campos do resultado original, sem efeito novo. Vale para `save` e `review` (já há `client_id` único em `encounters` e `review_logs`) e para `seen` (pede um registro próprio, seção 13).
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
| `dropped` | Aceita e descartada pela regra (`reason`: `item_deleted`, `not_found`, `unknown_target`) |
| `rejected` | Inválida, nunca vai valer (`reason`: `invalid` com `errors` por campo, `unknown_type`, `client_id_conflict`) |

Campos extras do `applied`/`duplicate`:

- `save`: `itemId`, `flashcardId` (o Reconhecer), `created` (false = o item já existia), `encounterId`.
- `review`: `flashcardId` e `flashcard` (o `FlashcardState` oficial depois do replay, seção 7).
- `seen`: `itemId`.

Os quatro status são definitivos: o aparelho trata a operação como resolvida (seção 8). Se o número de resultados não bate com o de operações, o aparelho trata a resposta como erro e não resolve nada.

## 6. Snapshot: `GET /api/v1/sync/snapshot` (Bearer)

```
GET /api/v1/sync/snapshot?protocol=1&language=it[&since=<cursor>][&limit=500][&page=<token>]
```

| Parâmetro | |
|---|---|
| `language` | Obrigatório. Idioma do banco |
| `since` | Opcional. Cursor do último snapshot completo. Pede só o que mudou |
| `limit` | Itens por página, 100–1000, padrão 500 |
| `page` | Token de página (`end.next` da página anterior). As demais páginas repetem `language`, `since` e `limit` da primeira |

Resposta `200`, `Content-Type: application/x-ndjson; charset=utf-8`: uma página em JSONL (seção 7). O aparelho pede páginas até `end.next` ser `null`.

- Snapshot completo **sempre** funciona. O delta é otimização: com `since`, o servidor responde `mode: "delta"` ou, se o cursor for desconhecido, velho demais ou o servidor não fizer delta, `mode: "full"`. Cursor ruim nunca é erro. O aparelho trata os dois modos.
- O cursor sai no cabeçalho de cada página (o mesmo em todas). Ele marca o instante em que a **primeira** página foi gerada. O que mudar enquanto o aparelho baixa as páginas vem no próximo delta.
- Token de página vale 15 minutos. Vencido: `410 page_expired`.
- Completo: todos os itens não apagados do idioma, inclusive `conhecido`, em ordem de `id`. Delta: todo item com qualquer mudança depois do cursor (no item, no Reconhecer ou nos encontros) como linha `item` completa, e uma linha `del` para cada item apagado depois do cursor.
- Sem limite de 5000 itens (o de `api_items` não se aplica): a paginação cobre bancos grandes e o limite de resposta das funções da Vercel.

## 7. Formato JSONL do snapshot

Cada linha é um objeto JSON terminado em `\n`, UTF-8 sem BOM, **no máximo 16384 bytes**. O campo `t` diz o tipo. Uma página é:

```
header
item | del   (0 ou mais)
end
```

### `header`

```json
{
  "t": "header", "protocol": 1, "language": "it", "mode": "full",
  "cursor": "v1.MjAyNi0xMS0xMVQyMTozMDowMi40MTdaOjg4MjEz",
  "serverNow": "2026-11-11T21:30:02.417Z",
  "deckName": "Linguetta · Italiano",
  "total": 5,
  "settings": { "uiLanguage": "pt", "nativeLanguage": "pt", "studyLanguages": ["it", "en"], "newFlashcardsPerDay": 10, "timeZone": "America/Sao_Paulo", "utcOffsetMinutes": -180 },
  "today": { "dayStart": "2026-11-11T03:00:00.000Z", "nextDayStart": "2026-11-12T03:00:00.000Z", "newDoneToday": 1 },
  "fsrs": { "tsFsrs": "6.0.0", "version": "FSRS-7", "desiredRetention": 0.9, "enableFuzz": true,
            "learningSteps": ["1m", "10m"], "relearningSteps": ["10m"], "maximumInterval": 36500 }
}
```

- `cursor`: opaco, até 200 caracteres. O aparelho só guarda e devolve.
- `deckName`: "Linguetta · " + nome do idioma na língua da interface (`uiLanguage`); sem `uiLanguage`, o nome do idioma nele mesmo ("Linguetta · Deutsch").
- `settings.uiLanguage`, `settings.nativeLanguage`, `settings.studyLanguages`: como no `account` do pareamento, sem padrão (`null`, `null`, `[]` numa conta sem preferências).
- `total`: linhas `item` + `del` somadas em todas as páginas (para a barra de progresso; pode diferir um pouco do recebido).
- `settings.newFlashcardsPerDay`: limite de flashcards novos por dia (`user_settings`). `timeZone`/`utcOffsetMinutes`: o fuso que define o "dia" (`REVIEW_TIME_ZONE`).
- `today`: o dia corrente no fuso e quantos flashcards novos já tiveram a primeira revisão nele (em qualquer aparelho). Depois de `nextDayStart`, o aparelho zera a contagem e passa a usar dias de 24 h a partir dele até o próximo sync.
- `fsrs`: os parâmetros do agendador do servidor. Se diferirem dos que o firmware implementa, o aparelho continua funcionando (o servidor decide), mas mostra um aviso discreto de "agendamento aproximado".

### `item`

```json
{
  "t": "item",
  "id": "7a1e4c90-5b2d-4f3a-9e8c-1d2f3a4b5c01",
  "lemma": "bello", "lemmaKey": "bello", "language": "it",
  "sense": "bonito", "note": "adjetivo", "ipa": "", "pos": "",
  "status": "ativo",
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
| `seenCount`, `lastSeenAt` | Contador de visto |
| `createdAt` | Criação do item |
| `updatedAt` | Última mudança do item, do Reconhecer ou dos encontros. Aumenta a cada mudança |
| `forms` | Formas vistas nos encontros, como escritas, uma por chave e sem a do lema, até 10 |
| `encounters` | Os 2 encontros mais recentes (por `seen_at`), cada um com `form`, `sentence`, `sense`, `work` (título da obra ou ausente) e `at` |
| `flashcard` | O Reconhecer (`FlashcardState`). Sempre presente |

O servidor pode omitir campos de texto vazios, `null` e listas vazias (exceto em `flashcard`). O Produzir não vem: o aparelho não o revisa.

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

- `count`: linhas `item` + `del` desta página. O aparelho confere; se não bate, ou se a página terminou sem `end` (conexão caiu), descarta o snapshot em andamento.
- `next`: token da próxima página, ou `null` na última.

## 8. Arquivos no SD

Pasta `/.linguetta/` na raiz do cartão SD. Toda reescrita é atômica: grava `<nome>.tmp`, faz `flush`/`fsync` e renomeia por cima.

### `bank.jsonl`

- O snapshot do servidor, sem páginas: o `header` da primeira página, depois todas as linhas `item`. Sem `end` e sem `del`. Exemplo em `fixtures/bank.jsonl`.
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

### Ordem do sync

1. Acerta o relógio (NTP).
2. **Push:** envia o outbox em lotes de até 200, na ordem do arquivo, até mandar tudo. Guarda na memória o `clientId` de cada operação resolvida. Erro de pedido (sem resposta, 5xx, 429): para o sync e mantém o outbox inteiro.
3. **Snapshot:** com `since = cursor` (ou sem, se `null`), baixa todas as páginas e atualiza `bank.jsonl`.
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
| push + snapshot | 60 pedidos por minuto por token (`429`) |
| Registro de `clientId` | ≥ 180 dias |

Campos de texto (code points): `lemma` 1–80, `sense` 200, `note` 2000, `ipa` 100, `reading` 100, `pos` 80, `form` 80, `sentence` 500, `title` 200, `author` 200, `chapter` 200, `deviceName` 60. São os `LIMITS` de `apps/web/src/lib/items.ts`.

## 11. Paridade do FSRS

- O servidor usa **ts-fsrs 6.0.0** (`bun.lock`) por `DefaultScheduler({ desiredRetention: 0.9, enableFuzz: true })` em `apps/web/src/lib/server/scheduler.ts`. Isso dá:
  - modelo **FSRS-7**, pesos padrão (`FSRS7_DEFAULT_WEIGHTS`), dias fracionários (`fractionalDays: true`);
  - `enableShortTerm: true`, passos de aprendizado `["1m", "10m"]`, reaprendizado `["10m"]`, `maximumInterval` 36500;
  - middlewares na ordem: retenção desejada, fuzz, estatísticas, scheduled days, passos de aprendizado, intervalo máximo, intervalo monotônico;
  - fuzz determinístico: semente = `flashcardId` + `String(reps)` (o `reps` **depois** da revisão), hash FNV-1a de 32 bits sobre as unidades UTF-16 da string, PRNG mulberry32, primeiro valor; só para intervalo ≥ 2,5 dias, faixas `FUZZ_RANGES` (2,5–7 d: 15%; 7–20 d: 10%; > 20 d: 5%).
- A fonte de referência para o port é o pacote instalado: `apps/web/node_modules/ts-fsrs/dist/models/fsrs-7.mjs` (modelo), `dist/middlewares-*.mjs` (fuzz, passos, intervalos) e `dist/index.mjs` (`DefaultScheduler`), mais `@open-spaced-repetition/srs-kit` 1.0.0.
- O FSRS do aparelho **deve** passar `fixtures/fsrs-vectors.json`: para cada caso, partindo de um flashcard novo (`dueAt = createdAt`, tudo zero, `scheduleStatus: "new"`) com o `flashcardId` dado, aplica cada revisão (`rating`, `reviewedAt`) e compara com `expected`. Tolerância: `float` (1e-6, relativa ou absoluta, a maior) em `stability`, `stability_fast`, `difficulty` e `scheduled_days`; `dueAtMs` (1000 ms) em `due_at`; igualdade exata em `state`, `schedule_status`, `reps`, `lapses`, `learning_step` e `last_review_at`. Os `steps` estão sempre em ordem de `reviewedAt`, e o `expected` do passo N é o flashcard depois das N primeiras. O caso `fora-de-ordem` testa também o replay: entregue as revisões na ordem `arrivalOrder` (índices em `steps`); depois de todas, o flashcard tem de ser o `expected` do último passo, porque o replay ordena por `reviewedAt` (empate: ordem de chegada).
- O servidor **deve** continuar passando os mesmos vetores (um teste em `apps/web` que lê o arquivo). Trocar a versão do ts-fsrs ou os parâmetros pede vetores novos: `bun docs/sync/fixtures/generate-fsrs-vectors.ts > docs/sync/fixtures/fsrs-vectors.json`, e o aviso do `header.fsrs` cobre os aparelhos ainda não atualizados.
- Mesmo com paridade, o estado local vale só até o próximo sync: o snapshot traz o estado oficial e o aparelho o adota sem comparar.

### Fila do baralho no aparelho

A mesma regra do app (`buildQueue` em `apps/web/src/lib/review.ts`), sobre a visão local, só itens `ativo`:

1. Vencidos (`state > 0` e `dueAt <= agora`), mais atrasado primeiro.
2. Novos (`state = 0`) em ordem de `flashcard.createdAt`, até `newFlashcardsPerDay − novos de hoje`.
3. Flashcard errado que vence em até 20 minutos volta para o fim da fila da mesma sessão.

Frente do flashcard: o lema (com `reading` acima, se houver, e `ipa`). Verso: `sense`, `note` e a frase do encontro mais recente com a forma destacada.

## 12. Fixtures

Em `docs/sync/fixtures/`. Todas descrevem o mesmo momento: o X4 Pro sincroniza às 21:30 de 11/11/2026 com sete operações offline.

| Arquivo | O quê |
|---|---|
| `pair-start.request.json`, `pair-start.response.json` | Início do pareamento |
| `pair-poll.request.json`, `pair-poll.responses.json` | Poll e as cinco respostas possíveis |
| `push.request.json`, `push.response.json` | Push com `duplicate`, `applied` (save, review, review por `saveClientId`, seen), `dropped` e `rejected` |
| `snapshot-full.page1.jsonl`, `snapshot-full.page2.jsonl` | Snapshot completo com `limit=3`, em duas páginas |
| `snapshot-delta.jsonl` | O mesmo momento como delta, com uma linha `del` |
| `errors.json` | Corpo de cada erro |
| `bank.jsonl`, `outbox.jsonl`, `state.json` | Arquivos do SD (o outbox é o de antes do push; o banco e o estado, os de depois) |
| `fsrs-vectors.json` | Vetores do FSRS gerados com o ts-fsrs real por `generate-fsrs-vectors.ts` |
| `kosync-hash-vectors.json` | Vetores do hash parcial gerados por `generate-kosync-vectors.ts` |

Os estados de flashcard nos fixtures também saíram do `replay()` do servidor.

## 13. Notas para o servidor (não normativas)

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
