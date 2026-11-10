# LingoBlend: contrato entre as partes

Três partes, cada uma numa pasta deste projeto:

| Parte | Pasta | Papel |
|---|---|---|
| Fork do player | `stremio-video/` (Matloop/stremio-video, branch `lingoblend`) | Pede as anotações ao provider, troca as palavras na legenda renderizada por spans clicáveis e emite um evento DOM no clique |
| Fork da UI | `stremio-web/` (Matloop/stremio-web, branch `lingoblend`) | Registra o provider (que chama o servidor), mostra o cartão no clique, menu de configurações, palavras salvas |
| Servidor | `server/` | `POST /annotate`: escolhe ~10% das palavras e traduz no contexto (Claude ou mock) |
| App Linguarudo | `apps/web` (monorepo) | Banco de palavras. Rotas `/api` com token (seção 5) |

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
- `displayText`: a linha como aparece na tela, com as trocas ("Eu não quero só ir às feste."). Vira o contexto da palavra no banco.
- `lang`: idioma da legenda (`track.lang`).
- O texto do span (`event.target.textContent`) é a forma vista, com a caixa da legenda. Vira o `contextHighlight`.

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

## 5. Linguarudo: `/api` com token

O usuário gera um token em **Integrações** no app (aparece uma vez; o banco guarda só o sha256) e cola no menu IT do player, junto com a URL do Linguarudo. O padrão é produção (`DEFAULT_LINGUARUDO_URL` em `stremio-web/src/routes/Player/LingoBlend/linguarudo.js`). Para self-host ou dev, troque no menu (ex.: `http://localhost:5173`).

Todas as rotas pedem `Authorization: Bearer lr_...` e só tocam nas palavras do dono do token. CORS só para origens locais: `localhost`, `127.0.0.1` e `*.localhost` (o build web serve em `http://lingoblend.peario.xyz.localhost:8080`), qualquer porta. Erros vêm como `{ "message": "..." }`, com status 400 (requisição inválida) ou 401 (token ausente, inválido ou revogado).

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/me` | | `{ email }` |
| `GET /api/words?lang=it` | | `{ lang, words: [{ term, translation, state, dueAt, paused, prefer }] }` |
| `POST /api/words` | `{ words: [Word] }` (até 200) | `{ results: [{ term, lang, status, state, dueAt }] }`, um por item e na mesma ordem |
| `POST /api/words/seen` | `{ lang, terms: [lema] }` (até 500) | `{ updated }` |

- `state` é o estado FSRS do cartão: 0 nova, 1 aprendendo, 2 revisão, 3 reaprendendo.
- `prefer` vale para 1 e 3 e para 2 com `dueAt` vencido; pausadas ficam fora. Essas palavras vão no `preferWords` do `/annotate`.
- `status` é `created`, `duplicate` (já estava no banco, sem diferenciar maiúsculas, ou repetida no lote) ou `invalid` (com `error`).

`Word` (só `term` e `lang` são obrigatórios; textos longos demais são cortados):

```js
{
  term: "festa",              // o lema
  lang: "it",                 // "en" | "it"
  translation: "festas, celebrações", // meaning || source
  context: "Eu não quero só ir às feste.", // displayText
  contextHighlight: "feste",  // forma vista, para o Revisar destacar
  ipa, pos, meaning, example, // da Annotation
  sourceTitle: "Kaguya",      // título do vídeo
  sourceTimeS: 2530,          // segundo da cena (o app mostra "Kaguya, 42:10")
  savedAt: "2026-11-10T12:00:00.000Z"
}
```

No `stremio-web`:

- **Salvar.** O cartão põe a palavra numa fila (`lingoblend.linguarudoQueue` no localStorage) e envia. Se a rede ou o servidor falhar, a palavra fica na fila. A fila é reenviada a cada minuto, quando a rede volta e ao conectar.
- **Primeira conexão** com um token: as palavras antigas de `lingoblend.savedWords` (só EN/IT) vão para a fila. O servidor pula as duplicatas. Elas não têm lema, então o termo é a forma vista.
- **No seu banco.** Se a palavra clicada já está no banco, o cartão mostra o selo "No seu banco" e a próxima revisão no lugar de Salvar.
- **Visto.** As palavras do banco que aparecem na legenda (evento `shown`) são enviadas em lote a cada 15 s e ao fechar o player. Isso só soma `seen_count`/`last_seen_at`. Não mexe no FSRS.
