# LingoBlend: contrato entre as partes

Três partes, cada uma numa pasta deste projeto:

| Parte | Pasta | Papel |
|---|---|---|
| Fork do player | `stremio-video/` (Matloop/stremio-video, branch `lingoblend`) | Pede as anotações ao provider, troca as palavras na legenda renderizada por spans clicáveis e emite um evento DOM no clique |
| Fork da UI | `stremio-web/` (Matloop/stremio-web, branch `lingoblend`) | Registra o provider (que chama o servidor), mostra o cartão no clique, menu de configurações, palavras salvas |
| Servidor | `server/` | `POST /annotate`: escolhe ~10% das palavras e traduz no contexto (Claude ou mock) |
| App Linguetta | `apps/web` (monorepo) | Banco de palavras. Rotas `/api/v1` com token (seção 5) |

Escopo: só legendas renderizadas por `withHTMLSubtitles` (legendas de addons/OpenSubtitles e arquivos externos). Legendas embutidas desenhadas nativamente pelo `<video>` e o renderizador ASS em canvas ficam fora.

## 1. Tipo `Annotation`

```js
{
  source: "festas",          // palavra/expressão exatamente como aparece no texto da cue (sem tags)
  target: "feste",           // tradução na língua alvo, no contexto da frase, mesma flexão
  lemma: "festa",            // forma de dicionário do target, com a caixa do dicionário (é o que vai para o banco)
  reading: "",               // opcional: leitura do target (furigana em kana no ja, pinyin com tons no zh, romanização em escritas não latinas)
  ipa: "/ˈfɛs.te/",          // opcional
  pos: "subst. fem. plural", // opcional, classe gramatical escrita na língua nativa (nativeLanguage)
  meaning: "festas, celebrações", // opcional, significado curto na língua nativa
  example: "Andiamo alle feste di Roma." // opcional, frase curta na língua alvo
}
```

`source` sempre corresponde a palavras inteiras do texto da cue (não pedaço de palavra), pelas fronteiras de palavra do idioma da cue (`segmentWords`/`findWord` de `@linguetta/language`, sobre `Intl.Segmenter`). Pode ter mais de uma palavra ("de novo"). Em idiomas sem espaço (ja, zh, th...) vale a palavra do segmentador e, se ela não coincidir, a primeira ocorrência como trecho ("食べ" em "私は毎朝パンを食べます").

**Caixa do lema.** O lema fica como o dicionário do idioma escreve: minúsculo, salvo quando a ortografia pede maiúscula (substantivo alemão "Haus", nome próprio "Roma"). Lema todo em maiúsculas (legenda gritada) desce para minúsculas, só em escritas com caixa. Para comparar lemas (preferWords, `forms`, "No seu banco", cache) use sempre a semântica de `lemmaKey(lemma, idioma)`: NFC + minúsculas do idioma, com acentos distinguindo. Nunca compare com `toLowerCase()` cru.

`lemma` sempre vem na resposta do servidor. Se o provider não mandar, o servidor usa o `target` (caixa mantida). `reading` só aparece quando não está vazio, como os outros opcionais.

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
{ "sourceLang": "pt-BR", "targetLang": "it", "nativeLanguage": "pt-BR", "density": 0.1,
  "preferWords": ["festa", "giorno"],
  "cues": [{ "id": "c12", "text": "Eu não quero só ir às festas." }] }
```

- `sourceLang`: idioma da legenda. `targetLang`: idioma que a pessoa estuda (o das trocas). `nativeLanguage` (**obrigatório**, sem padrão): língua nativa da pessoa; `meaning` e `pos` vêm escritos nela. Em geral é igual a `sourceLang`, mas não precisa ser. O `stremio-web` tira o valor de `GET /api/v1/me` (seção 5); sem token, pede no menu.
- **Códigos de idioma** (aqui, em `/lookup` e em `/translate`): qualquer tag BCP 47. O servidor canoniza com `canonicalLanguage` de `@linguetta/language` (`Intl.getCanonicalLocales` + apelidos): `PT_br` → `pt-BR`, `iw` → `he`, `ita` → `it`, e os códigos do OpenSubtitles `pob` → `pt-BR`, `zht` → `zh-Hant`. Escrita e região são preservadas (`zh-Hant` continua `zh-Hant`). Nomes de idioma ("português") não valem. Mesmo idioma = mesma subtag base e mesma escrita (`pt-BR` = `pt-PT`, `zh-Hans` ≠ `zh-Hant`): aí não há troca.
- `preferWords` (opcional, até 1000): lemas do banco do usuário (em `targetLang`) para trocar primeiro. São as palavras aprendendo, reaprendendo ou com revisão vencida. Elas entram quando aparecem no texto e contam na densidade. O resto da densidade sai de palavras novas. O servidor mantém a caixa ("Haus"), tira duplicatas pela `lemmaKey` (fica a primeira), ordena pela chave e a lista entra na chave do cache.
- `density` é a fração aproximada de palavras do lote trocadas. As palavras são contadas pelo segmentador do idioma da legenda (`countWords(texto, sourceLang)`), então funciona em idiomas sem espaço.

Resposta:

```json
{ "provider": "claude", "annotations": { "c12": [ { "source": "festas", "target": "feste", "lemma": "festa", "ipa": "...", "pos": "...", "meaning": "...", "example": "..." } ] } }
```

Cues sem anotação podem ficar fora do mapa. O cliente manda lotes de até ~80 cues. A chave do cache inclui os três idiomas.

**Erros** (todas as rotas do servidor): `{ "error": "mensagem para log", "code": "codigo_estavel" }`. A UI traduz pelo `code`.

| Status | `code` |
|---|---|
| 400 | `invalid_json`, `invalid_body`, `missing_source_lang`, `invalid_source_lang`, `missing_target_lang`, `invalid_target_lang`, `missing_native_language`, `invalid_native_language`, `missing_lang`, `invalid_lang` (`/lookup`), `empty_text`, `text_too_long`, `invalid_density`, `invalid_cues`, `too_many_cues`, `invalid_prefer_words`, `too_many_prefer_words`, `invalid_engine` (`/translate`) |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 413 | `body_too_large` (corpo > 2 MB; 64 KB em `/lookup` e `/translate`) |
| 422 | `local_unavailable` (`/translate` com `engine: "local"` sem rota local ou sem o modelo) |
| 501 | `not_supported` (provider sem `lookup`/`translate`) |
| 502 | `provider_error` (falha no provider/Claude) |
| 500 | `internal`, `local_error` (falha da tradução local) |

`missing_*` = campo ausente ou vazio; `invalid_*` = não é uma tag BCP 47 válida.

`GET /health` → `{ ok: true, provider: "claude"|"claude-code"|"mock", model, mt: { available, model, reason? } }` (`mt` = tradução local da seção 6; `reason` diz como instalar o modelo). CORS liberado para qualquer origem local.

## 5. Linguetta: `/api/v1` com token

O usuário gera um token em **Integrações** no app (aparece uma vez; o banco guarda só o sha256) e cola no menu IT do player, junto com a URL do Linguetta. O padrão é produção (`DEFAULT_LINGUARUDO_URL` em `stremio-web/src/routes/Player/LingoBlend/linguarudo.js`). Para self-host ou dev, troque no menu (ex.: `http://localhost:5173`).

Todas as rotas pedem `Authorization: Bearer lr_...` e só tocam no banco do dono do token. CORS só para origens locais: `localhost`, `127.0.0.1` e `*.localhost` (o build web serve em `http://lingoblend.peario.xyz.localhost:8080`), qualquer porta. Erros vêm como `{ "message": "..." }`, com status 400 (requisição inválida) ou 401 (token ausente, inválido ou revogado). JSON em camelCase.

O vocabulário é o do glossário do app (`CONTEXT.md`): **item** (palavra ou expressão num idioma, com um sentido), **encontro** (onde a pessoa viu o item: frase, forma, momento), **obra** (o episódio, filme, música ou livro do encontro), **cartão** (Reconhecer ou Produzir, cada um com seu FSRS).

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/v1/me` | | `{ email, nativeLanguage, studyLanguages }` |
| `GET /api/v1/items?language=it` | | `{ language, items: [ApiItem], preferWords: [lema] }` |
| `POST /api/v1/items` | `{ items: [SaveItem] }` (até 200) | `{ results: [SaveResult] }`, um por item e na mesma ordem |
| `POST /api/v1/items/seen` | `{ language, lemmas: [lema] }` (até 500) | `{ updated }` |

`language` é qualquer tag BCP 47; o app canoniza com `canonicalLanguage` de `@linguetta/language` (ADR 0004). `nativeLanguage` e `studyLanguages` vêm canônicos e podem vir vazios (usuário novo sem idioma de estudo).

### `ApiItem`

```js
{
  id: "uuid",
  lemma: "festa",
  sense: "festa, celebração",  // pode vir vazio
  status: "ativo",             // "ativo" | "conhecido" (conhecido não entra na revisão)
  mastered: false,             // dominado: todo cartão em revisão com estabilidade >= 90 dias
  prefer: true,                // entra primeiro na legenda
  cards: [{ kind: "reconhecer", state: 2, dueAt: "2026-11-10T12:00:00.000Z", stability: 12.5 }],
  forms: ["feste"]             // formas vistas nos encontros, com a caixa como foram vistas, sem o lema (até 20)
}
```

- `kind`: `reconhecer` (ver o lema, lembrar o sentido) ou `produzir` (ver o sentido, lembrar o lema). Todo item nasce com o Reconhecer. O Produzir nasce quando uma revisão do Reconhecer dá intervalo de 7 dias ou mais e o item tem sentido.
- `state` é o estado FSRS do cartão: 0 novo, 1 aprendendo, 2 revisão, 3 reaprendendo.
- `prefer` vale para item ativo com algum cartão em 1 ou 3, ou em 2 com `dueAt` vencido. `preferWords` é a lista desses lemas, pronta para o `/annotate`.
- Itens apagados não aparecem.
- `forms` serve ao modo só língua-alvo (seção 6): uma palavra da legenda conta como do banco se a `lemmaKey` dela for a do lema ou a de uma dessas formas.
- `lemma` vem com a caixa do dicionário ("Haus"); `preferWords` idem. Compare sempre pela `lemmaKey`.

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
    translation: "",               // a frase na língua do usuário (modo só língua-alvo), até 1000
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

- O item é achado por `(language, lemmaKey(lemma, language))`: sem diferenciar maiúsculas pela regra do idioma, com acentos distinguindo. Só o servidor calcula a `lemmaKey`. Se já existe, ganha só o encontro, e os campos vazios dele (sentido, IPA, classe) são preenchidos com o que veio.
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

`POST /api/v1/items/seen` soma 1 em `seen_count` e atualiza `last_seen_at` dos itens com esses lemas (comparados pela `lemmaKey`). É um contador no item, não um encontro, e não mexe no FSRS. `updated` é quantos itens foram achados.

### Próxima versão

`/api/v1/sync` (etapa 2) vai trocar mudanças nos dois sentidos para clientes offline (o e-reader). As rotas acima continuam valendo.

No `stremio-web`:

- **Salvar.** O cartão põe o item numa fila (`lingoblend.linguarudoQueue` no localStorage), com um `clientId` gerado na hora do clique, e envia. Se a rede ou o servidor falhar, o item fica na fila. A fila é reenviada a cada minuto, quando a rede volta e ao conectar. O `clientId` evita encontro duplicado num reenvio.
- **Obra.** O episódio ou filme vem do `metaItem` do player: título, `imdbId`, temporada e episódio.
- **Primeira conexão** com um token: as palavras antigas de `lingoblend.savedWords` vão para a fila. Elas não têm lema, então o lema é a forma vista.
- **No seu banco.** Se a palavra clicada já está no banco, o cartão mostra o selo "No seu banco" e a próxima revisão no lugar de Salvar. Item conhecido mostra "Você já conhece".
- **Visto.** Os itens do banco que aparecem na legenda (evento `shown`) são enviados em lote a cada 15 s e ao fechar o player.

## 6. Modo só língua-alvo ("Só italiano")

O menu tem três modos: **Blend** (a legenda na língua nativa com palavras trocadas, seções 1 a 4), **Só <língua>** e **Desligado**. No modo só língua-alvo a legenda é uma faixa real na língua-alvo (addon ou `.srt`; faixas embutidas no MKV ficam fora da v1). Nenhuma fala é anotada antes: cada clique custa uma consulta.

### `stremio-video`

```js
lingoBlend.setTargetMode({
  matchLang: (lang) => boolean,     // a faixa conta como da língua-alvo?
  elision: true,                    // corta no apóstrofo: "dell'anno" → "dell'" + "anno"; vem de languageProfile(lang).elision (it, fr, ca, oc)
  lemmaOf: (word) => lemma | null,  // lema do banco para sublinhar a palavra
});
lingoBlend.setTargetMode(null);     // volta ao Blend
lingoBlend.clearSelection();        // o cartão fechou
lingoBlend.getVisibleCues();        // [{ id, text }] das falas na tela
```

- O provider não é chamado. O status fica `target` (faixa na língua-alvo), `mismatch` (outra língua) ou `idle`.
- Toda palavra vira `<span class="lingoblend-token" data-lingoblend-i>`. Palavra do banco ganha `data-lingoblend-known` e sublinhado discreto, e entra no evento `shown` como `{ lemma }` (conta como visto, sem mexer no FSRS).
- `mousedown` numa palavra dispara `lingoblend:select` (`detail.phase: "start"`); o player pausa. Arrastar até outra palavra da mesma fala seleciona a expressão. No `mouseup` sai `lingoblend:word` com:

```js
{ mode: "target", text: "Facevo finta di", words: 3, cueText, displayText, lang, rect }
```

- A elisão é regra do perfil do idioma (`languageProfile(tag).elision`, hoje it, fr, ca, oc; em fr/ca/oc só os clíticos da lista, "aujourd'hui" fica inteiro), não uma lista no cliente. A segmentação usa `segmentWords(texto, lang)`.
- `words` é o número de palavras da seleção contadas pelo segmentador do idioma (`countWords(text, lang)`), não por espaços. Em ja/zh/th uma seleção sem espaço pode ter várias palavras ("毎朝パン" → 2 ou mais). Um clítico elidido conta como palavra própria.

### Servidor: `POST /lookup`

```js
// pedido
{ lang: "it", nativeLanguage: "pt-BR", text: "facevo finta di", sentence: "Facevo finta di dormire, ma ti ho sentito." }
// resposta
{ lemma: "fare finta di", reading: "", ipa: "/ˈfa.re ˈfin.ta di/", pos: "expr.", meaning: "fingir", translation: "Eu fingia dormir, mas te ouvi." }
// japonês, nativa inglês
{ lang: "ja", nativeLanguage: "en", text: "食べ", sentence: "私は毎朝パンを食べます" }
→ { lemma: "食べる", reading: "たべる", ipa: "/ta.be.ɾɯ/", pos: "verb (ichidan)", meaning: "to eat", translation: "I eat bread every morning." }
```

- `lang` (idioma da legenda/estudo) e `nativeLanguage` são **obrigatórios** (400 `missing_lang`/`invalid_lang`, `missing_native_language`/`invalid_native_language`).
- `lemma` é a forma de dicionário (infinitivo onde o idioma tem, singular, masculino singular nos adjetivos com gênero, forma de dicionário dos verbos japoneses; idioma sem flexão devolve a palavra como está; expressão na forma canônica), com a caixa do dicionário ("Haus"). Sem lema, vale a seleção. Seleção toda em maiúsculas desce para minúsculas, só em escritas com caixa.
- `reading`: sempre presente (string). Furigana em kana no japonês, pinyin com tons no chinês, romanização usual em outras escritas não latinas; vazio em escrita latina. Fica separado de `ipa`.
- `pos`, `meaning` e `translation` vêm na língua nativa.
- `text` até 80 caracteres, `sentence` até 500. Cache em disco por idioma, língua nativa, `lemmaKey` da seleção e fala.

### Servidor: `POST /translate`

```js
{ sourceLang: "it", nativeLanguage: "pt-BR", text: "Ciao!", engine: "local" }
→ { translation: "Oi!", engine: "local" }
```

`nativeLanguage` (**obrigatório**, sem padrão) é o idioma de destino; o antigo `targetLang` saiu (o cliente ainda o manda, o servidor ignora). Se for o mesmo idioma de `sourceLang`, a fala volta como está. Usado ao segurar **T**: a fala na tela na língua nativa, sem pausar.

`engine` escolhe quem traduz:

- `"local"` (padrão): OPUS-MT `Helsinki-NLP/opus-mt-tc-big-itc-itc` em ONNX int8, dentro do servidor (onnxruntime-node, sem rede, ~50–100 ms por fala). Só entre línguas românicas: origem no conjunto do modelo (ast, ca, es, fr, gl, it, lad, oc, pms, pt, ro) e destino com token `>>xxx<<` no vocabulário (`pt` e `pt-BR` → `>>pob<<`, outras regiões de `pt` → `>>por<<`). Sem rota ou sem o modelo instalado → **422 `local_unavailable`**; falha do modelo → 500 `local_error`. `" / "` (quebra de linha da legenda) vira espaço antes de traduzir.
- `"ai"`: o provider (Claude), como antes.

Outro valor → 400 `invalid_engine`. Cache em disco por motor e modelo (local: modelo + revisão; IA: provider + modelo), idioma de origem, língua nativa e texto; no cliente, por motor.

### No `stremio-web`

- Ligar o modo escolhe a primeira faixa extra na língua-alvo, uma vez por vídeo; sem nenhuma, o menu mostra "Nenhuma legenda em <língua>".
- O cartão abre com esqueleto, chama `/lookup` e mostra a leitura (acima do lema, quando houver), lema, IPA, classe, "Nesta fala: <seleção>" e a fala traduzida. Salvar manda `SaveItem` com o lema canônico, `encounter.form` = seleção, `sentence` = a fala e `translation` = a fala traduzida.
- Se o `/lookup` falhar, dá para salvar com a seleção como lema.
- Segurar **T** mostra a fala traduzida pela tradução local (o rótulo diz "· tradução local" ou "· IA"). **Shift+T** vai direto para a IA. Sem rota local (422) aparece "Sem tradução local para este idioma"; em outro erro, a mensagem do erro. Nos dois casos, e junto da tradução local, há o botão "✦ Traduzir com IA" (aceita clique e não deixa o clique chegar ao player).
- Depois que a IA traduziu uma fala, segurar **T** de novo nela mostra a versão da IA (cache do cliente por motor).
