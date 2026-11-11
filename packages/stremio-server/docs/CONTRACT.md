# LingoBlend: contrato entre as partes

Três partes, cada uma numa pasta deste projeto:

| Parte | Pasta | Papel |
|---|---|---|
| Fork do player | `stremio-video/` (Matloop/stremio-video, branch `lingoblend`) | Pede as anotações ao provider, troca as palavras na legenda renderizada por spans clicáveis e emite um evento DOM no clique |
| Fork da UI | `stremio-web/` (Matloop/stremio-web, branch `lingoblend`) | Registra o provider (que chama o servidor), mostra o cartão no clique, menu de configurações, palavras salvas |
| Servidor | `server/` | `POST /annotate`: escolhe ~10% das palavras e traduz no contexto (Claude ou mock) |
| App Linguarudo | `apps/web` (monorepo) | Banco de palavras. Rotas `/api/v1` com token (seção 5) |

Escopo: só legendas renderizadas por `withHTMLSubtitles` (legendas de addons/OpenSubtitles e arquivos externos). Legendas embutidas desenhadas nativamente pelo `<video>` e o renderizador ASS em canvas ficam fora.

## 1. Tipo `Annotation`

```js
{
  source: "festas",          // palavra/expressão exatamente como aparece no texto da cue (sem tags)
  target: "feste",           // tradução na língua alvo, no contexto da frase, mesma flexão
  lemma: "festa",            // forma de dicionário do target, minúscula (é o que vai para o banco)
  ipa: "/ˈfɛs.te/",          // opcional
  pos: "subst. fem. plural", // opcional, classe gramatical em português
  meaning: "festas, celebrações", // opcional, significado curto em português
  example: "Andiamo alle feste di Roma." // opcional, frase curta na língua alvo
}
```

`source` sempre corresponde a palavras inteiras do texto da cue (não pedaço de palavra). Pode ter mais de uma palavra ("de novo").

`lemma` sempre vem na resposta do servidor. Se o provider não mandar, o servidor usa o `target` em minúsculas.

## 2. API exportada por `stremio-video`

```js
const { lingoBlend } = require('@stremio/stremio-video');

// provider: chamado quando uma legenda (track extra) termina de carregar e em refresh()
lingoBlend.setProvider(async function provider(request, update) {
  // request = { requestId, trackId, lang, cues: [{ id: string, text: string }] }
  //   text = texto da cue sem tags VTT/HTML, com quebras de linha como "\n"
  //   ids são estáveis para a mesma legenda carregada
  // update(partial) pode ser chamado várias vezes com { [cueId]: Annotation[] } (resultados parciais)
  // o retorno (opcional) é outro mapa parcial/final no mesmo formato
});
lingoBlend.setProvider(null);   // desliga
lingoBlend.setEnabled(boolean); // liga/desliga sem perder o cache; força re-render
lingoBlend.refresh();           // descarta as anotações atuais e chama o provider de novo
lingoBlend.on('status', fn);    // fn({ state: 'idle'|'loading'|'ready'|'error', annotated, total, error? })
lingoBlend.off('status', fn);
lingoBlend.on('shown', fn);     // fn({ requestId, cueId, annotations }) a cada render de uma cue anotada
lingoBlend.off('shown', fn);
```

`shown` sai toda vez que a cue é desenhada (pode repetir). Quem escuta deduplica por `(requestId, cueId, lemma)`. O `stremio-web` usa isso para o "visto" (seção 5).

Respostas de requisições antigas (troca de track, refresh) são ignoradas pelo `requestId`.

## 3. DOM e evento de clique

Cada palavra anotada vira:

```html
<span class="lingoblend-word" data-lingoblend-source="festas">feste</span>
```

Estilo inline: sublinhado ciano `#22d3ee` (2px, offset 4px), cor `#a5f3fc`, `cursor: pointer`, `pointer-events: auto`, leve fundo `rgba(34,211,238,.22)` no hover.

No clique, o span chama `stopPropagation()` (também em `mousedown`, `pointerdown`, `dblclick`, `touchstart`) para o player não alternar pausa/tela cheia, e dispara:

```js
span.dispatchEvent(new CustomEvent('lingoblend:word', {
  bubbles: true,
  detail: { annotation, cueText, displayText, lang, rect: span.getBoundingClientRect() }
}));
```

- `cueText`: a linha original ("Eu não quero só ir às festas.").
- `displayText`: a linha como aparece na tela, com as trocas ("Eu não quero só ir às feste."). Vira a frase do encontro no banco.
- `lang`: idioma da legenda (`track.lang`).
- O texto do span (`event.target.textContent`) é a forma vista, com a caixa da legenda. Vira `form` e `highlight` do encontro.

O `stremio-web` escuta `lingoblend:word` no container do vídeo.

## 4. Servidor: `POST http://localhost:7979/annotate`

Requisição:

```json
{ "sourceLang": "pt", "targetLang": "it", "density": 0.1,
  "preferWords": ["festa", "giorno"],
  "cues": [{ "id": "c12", "text": "Eu não quero só ir às festas." }] }
```

`preferWords` (opcional, até 1000): lemas do banco do usuário para trocar primeiro. São as palavras aprendendo, reaprendendo ou com revisão vencida. Elas entram quando aparecem no texto e contam na densidade. O resto da densidade sai de palavras novas. O servidor normaliza (minúsculas, sem duplicatas) e a lista entra na chave do cache.

`sourceLang`/`targetLang` aceitam ISO 639-1 ou 639-2 (`por`, `ita`). Resposta:

```json
{ "provider": "claude", "annotations": { "c12": [ { "source": "festas", "target": "feste", "lemma": "festa", "ipa": "...", "pos": "...", "meaning": "...", "example": "..." } ] } }
```

Cues sem anotação podem ficar fora do mapa. `density` é a fração aproximada de palavras do lote trocadas. O cliente manda lotes de até ~80 cues.

Erros: `{ "error": "mensagem" }` com status 400 (requisição inválida), 413 (corpo > 2 MB) ou 502 (falha no provider/Claude).

`GET /health` → `{ ok: true, provider: "claude"|"claude-code"|"mock", model }`. CORS liberado para qualquer origem local.

## 5. Linguarudo: `/api/v1` com token

O usuário gera um token em **Integrações** no app (aparece uma vez; o banco guarda só o sha256) e cola no menu IT do player, junto com a URL do Linguarudo. O padrão é produção (`DEFAULT_LINGUARUDO_URL` em `stremio-web/src/routes/Player/LingoBlend/linguarudo.js`). Para self-host ou dev, troque no menu (ex.: `http://localhost:5173`).

Todas as rotas pedem `Authorization: Bearer lr_...` e só tocam no banco do dono do token. CORS só para origens locais: `localhost`, `127.0.0.1` e `*.localhost` (o build web serve em `http://lingoblend.peario.xyz.localhost:8080`), qualquer porta. Erros vêm como `{ "message": "..." }`, com status 400 (requisição inválida) ou 401 (token ausente, inválido ou revogado). JSON em camelCase.

O vocabulário é o do glossário do app (`CONTEXT.md`): **item** (palavra ou expressão num idioma, com um sentido), **encontro** (onde a pessoa viu o item: frase, forma, momento), **obra** (o episódio, filme, música ou livro do encontro), **cartão** (Reconhecer ou Produzir, cada um com seu FSRS).

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/v1/me` | | `{ email, nativeLanguage, studyLanguages }` |
| `GET /api/v1/items?language=it` | | `{ language, items: [ApiItem], preferWords: [lema] }` |
| `POST /api/v1/items` | `{ items: [SaveItem] }` (até 200) | `{ results: [SaveResult] }`, um por item e na mesma ordem |
| `POST /api/v1/items/seen` | `{ language, lemmas: [lema] }` (até 500) | `{ updated }` |

`language` é um código ISO 639-1 da lista do app (`en`, `it`, `es`, `fr`, `de`, `pt`, `ja`, `ko`, `zh`, `nl`, `ru`).

### `ApiItem`

```js
{
  id: "uuid",
  lemma: "festa",
  sense: "festa, celebração",  // pode vir vazio
  status: "ativo",             // "ativo" | "conhecido" (conhecido não entra na revisão)
  mastered: false,             // dominado: todo cartão em revisão com estabilidade >= 90 dias
  prefer: true,                // entra primeiro na legenda
  cards: [{ kind: "reconhecer", state: 2, dueAt: "2026-11-10T12:00:00.000Z", stability: 12.5 }]
}
```

- `kind`: `reconhecer` (ver o lema, lembrar o sentido) ou `produzir` (ver o sentido, lembrar o lema). Todo item nasce com o Reconhecer. O Produzir nasce quando uma revisão do Reconhecer dá intervalo de 7 dias ou mais e o item tem sentido.
- `state` é o estado FSRS do cartão: 0 novo, 1 aprendendo, 2 revisão, 3 reaprendendo.
- `prefer` vale para item ativo com algum cartão em 1 ou 3, ou em 2 com `dueAt` vencido. `preferWords` é a lista desses lemas, pronta para o `/annotate`.
- Itens apagados não aparecem.

### `SaveItem`

Só `language` e `lemma` são obrigatórios. Textos longos demais são cortados; lema vazio ou com mais de 80 caracteres recusa o item.

```js
{
  language: "it",
  lemma: "festa",
  sense: "festa, celebração",     // Annotation.meaning || Annotation.source
  note: "",
  ipa: "/ˈfɛs.ta/",
  partOfSpeech: "subst. fem.",
  encounter: {                     // opcional: onde a palavra foi vista
    form: "feste",                 // como apareceu
    sentence: "Eu não quero só ir às feste.", // displayText
    highlight: "feste",            // o que o Revisar destaca na frase
    sense: "festas",               // sentido naquele contexto
    position: { seconds: 2530 },   // ou { page } num livro
    seenAt: "2026-11-10T12:00:00.000Z",
    clientId: "uuid v4",           // idempotência: o mesmo clientId não cria outro encontro
    origin: "stremio"              // padrão "stremio"; também manual, musica, ereader, anki, blend
  },
  work: {                          // opcional, só junto de encounter
    kind: "episodio",              // livro | episodio | filme | musica | video
    title: "Kaguya",
    subtitle: "T1E2",              // episódio, artista...
    refs: { imdbId: "tt1234567", season: 1, episode: 2 }, // ou { youtubeId } ou { path }
    language: "ja"                 // idioma da obra (opcional)
  }
  // ou work: { id: "uuid" } para uma obra que já existe
}
```

- O item é achado por `(language, lemma)` sem diferenciar maiúsculas. Se já existe, ganha só o encontro, e os campos vazios dele (sentido, IPA, classe) são preenchidos com o que veio.
- A obra é achada pelas `refs` (`imdbId` + temporada + episódio, `youtubeId` ou `path`); sem refs, por tipo + título + subtítulo. Se não existe, é criada.
- O app mostra a origem do encontro como "Kaguya · T1E2, 42:10".

### `SaveResult`

```js
{ ok: true, item: { id, language, lemma, created, encounterId, card: { state, dueAt } } }
{ ok: false, error: "lemma vazio" }
```

- `created: false`: o item já estava no banco (ou repetido no lote). O encontro entra nele mesmo assim.
- `encounterId` é `null` quando o item veio sem `encounter`. Reenviar o mesmo `clientId` devolve o mesmo `encounterId`.
- `card` é o Reconhecer do item.

### Visto

`POST /api/v1/items/seen` soma 1 em `seen_count` e atualiza `last_seen_at` dos itens com esses lemas (sem diferenciar maiúsculas). É um contador no item, não um encontro, e não mexe no FSRS. `updated` é quantos itens foram achados.

### Próxima versão

`/api/v1/sync` (etapa 2) vai trocar mudanças nos dois sentidos para clientes offline (o e-reader). As rotas acima continuam valendo.

No `stremio-web`:

- **Salvar.** O cartão põe o item numa fila (`lingoblend.linguarudoQueue` no localStorage), com um `clientId` gerado na hora do clique, e envia. Se a rede ou o servidor falhar, o item fica na fila. A fila é reenviada a cada minuto, quando a rede volta e ao conectar. O `clientId` evita encontro duplicado num reenvio.
- **Obra.** O episódio ou filme vem do `metaItem` do player: título, `imdbId`, temporada e episódio.
- **Primeira conexão** com um token: as palavras antigas de `lingoblend.savedWords` vão para a fila. Elas não têm lema, então o lema é a forma vista.
- **No seu banco.** Se a palavra clicada já está no banco, o cartão mostra o selo "No seu banco" e a próxima revisão no lugar de Salvar. Item conhecido mostra "Você já conhece".
- **Visto.** Os itens do banco que aparecem na legenda (evento `shown`) são enviados em lote a cada 15 s e ao fechar o player.
