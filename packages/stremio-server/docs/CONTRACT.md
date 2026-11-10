# LingoBlend: contrato entre as partes

Três partes, cada uma numa pasta deste projeto:

| Parte | Pasta | Papel |
|---|---|---|
| Fork do player | `stremio-video/` (Matloop/stremio-video, branch `lingoblend`) | Pede as anotações ao provider, troca as palavras na legenda renderizada por spans clicáveis e emite um evento DOM no clique |
| Fork da UI | `stremio-web/` (Matloop/stremio-web, branch `lingoblend`) | Registra o provider (que chama o servidor), mostra o cartão no clique, menu de configurações, palavras salvas |
| Servidor | `server/` | `POST /annotate`: escolhe ~10% das palavras e traduz no contexto (Claude ou mock) |

Escopo: só legendas renderizadas por `withHTMLSubtitles` (legendas de addons/OpenSubtitles e arquivos externos). Legendas embutidas desenhadas nativamente pelo `<video>` e o renderizador ASS em canvas ficam fora.

## 1. Tipo `Annotation`

```js
{
  source: "festas",          // palavra/expressão exatamente como aparece no texto da cue (sem tags)
  target: "feste",           // tradução na língua alvo, no contexto da frase, mesma flexão
  ipa: "/ˈfɛs.te/",          // opcional
  pos: "subst. fem. plural", // opcional, classe gramatical em português
  meaning: "festas, celebrações", // opcional, significado curto em português
  example: "Andiamo alle feste di Roma." // opcional, frase curta na língua alvo
}
```

`source` sempre corresponde a palavras inteiras do texto da cue (não pedaço de palavra). Pode ter mais de uma palavra ("de novo").

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
```

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
  detail: { annotation, cueText, rect: span.getBoundingClientRect() }
}));
```

O `stremio-web` escuta `lingoblend:word` no container do vídeo.

## 4. Servidor: `POST http://localhost:7979/annotate`

Requisição:

```json
{ "sourceLang": "pt", "targetLang": "it", "density": 0.1,
  "cues": [{ "id": "c12", "text": "Eu não quero só ir às festas." }] }
```

`sourceLang`/`targetLang` aceitam ISO 639-1 ou 639-2 (`por`, `ita`). Resposta:

```json
{ "provider": "claude", "annotations": { "c12": [ { "source": "festas", "target": "feste", "ipa": "...", "pos": "...", "meaning": "...", "example": "..." } ] } }
```

Cues sem anotação podem ficar fora do mapa. `density` é a fração aproximada de palavras do lote trocadas. O cliente manda lotes de até ~80 cues.

Erros: `{ "error": "mensagem" }` com status 400 (requisição inválida), 413 (corpo > 2 MB) ou 502 (falha no provider/Claude).

`GET /health` → `{ ok: true, provider: "claude"|"claude-code"|"mock", model }`. CORS liberado para qualquer origem local.
