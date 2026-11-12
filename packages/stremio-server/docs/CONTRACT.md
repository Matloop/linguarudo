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
  translatedLine: "Non voglio andare di nuovo alle feste." // opcional, a fala inteira na língua alvo
}
```

`translatedLine` é a cue inteira traduzida para a língua alvo (não uma frase de exemplo inventada), numa linha só, sem as quebras " / ", e contendo o `target`. É a mesma em todas as trocas da cue: o servidor repete a da primeira troca que a tiver. O cartão da palavra mostra como citação; o mock não traduz e não manda.

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

O fork web liga `setAutoStart(false)`: cada legenda só é traduzida depois de `lingoBlend.start()` (botão do menu). Uma legenda já iniciada fica lembrada (id da faixa + texto das falas) e, ao voltar para ela, o provider é chamado sem novo clique. O provider guarda por legenda e configurações (servidor, idiomas, cobertura, motor, banco) o que cada motor já respondeu: a volta mostra as trocas na hora, sem `/annotate`, e uma tradução interrompida pela troca só pede os lotes que faltam.

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
{ "sourceLang": "pt-BR", "targetLang": "it", "nativeLanguage": "pt-BR", "engine": "local",
  "wordCoverage": 0.1, "cueOffset": 80,
  "preferWords": ["festa", "giorno"],
  "cues": [{ "id": "c12", "text": "Eu não quero só ir às festas." }] }
```

- `sourceLang`: idioma da legenda. `targetLang`: idioma que a pessoa estuda (o das trocas). `nativeLanguage` (**obrigatório**, sem padrão): língua nativa da pessoa; `meaning` e `pos` vêm escritos nela. Em geral é igual a `sourceLang`, mas não precisa ser. O `stremio-web` tira o valor de `GET /api/v1/me` (seção 5); sem token, pede no menu.
- **Códigos de idioma** (aqui, em `/lookup` e em `/translate`): qualquer tag BCP 47. O servidor canoniza com `canonicalLanguage` de `@linguetta/language` (`Intl.getCanonicalLocales` + apelidos): `PT_br` → `pt-BR`, `iw` → `he`, `ita` → `it`, e os códigos do OpenSubtitles `pob` → `pt-BR`, `zht` → `zh-Hant`. Escrita e região são preservadas (`zh-Hant` continua `zh-Hant`). Nomes de idioma ("português") não valem. Mesmo idioma = mesma subtag base e mesma escrita (`pt-BR` = `pt-PT`, `zh-Hans` ≠ `zh-Hant`): aí não há troca.
- `preferWords` (opcional, até 1000): lemas do banco do usuário (em `targetLang`) para trocar primeiro. São as palavras aprendendo, reaprendendo ou com revisão vencida. Na escolha, uma palavra do banco vence qualquer outra da mesma janela (volta depois de 20 falas, como qualquer lema: regra 6 da escolha). O servidor mantém a caixa ("Haus"), tira duplicatas pela `lemmaKey` (fica a primeira), ordena pela chave e a lista entra na chave do cache.
- `engine` (**obrigatório**): `"ai"` (o provider) ou `"local"`: sem IA, com o OPUS-MT e os dicionários locais (`server/src/blend/local.js`). O local traduz a fala inteira, acha no resultado a palavra que a original vira sozinha (pelo lema); quando ela não está na frase, alinha pelas glosas em inglês dos dois dicionários: o único token da frase com uma leitura da mesma classe e uma glosa em comum nas duas primeiras acepções dos dois lados ("primo" → "cugino", *male cousin*; token que é lema da classe não casa por remissão dela, "tavolino" não vale por "tavolo"). Depois confere nos dicionários das duas línguas a classe, o número, o gênero do adjetivo, a forma verbal e a primeira pessoa. Na dúvida não troca. Cobre as línguas românicas do modelo (ast, ca, es, fr, gl, it, lad, oc, pms, pt, ro), em qualquer combinação, e legenda em inglês com estudo em italiano e nativa portuguesa (modelos `en-it` e `en-pt`, seção 6). Em inglês o lema não marca gênero e número do adjetivo nem a forma do verbo ("married" casa com "sposate"; "spend" é infinitivo e presente), e o `meaning` de verbo sai no infinitivo (tradução de "to talk" sem a do "to": "falar"). Precisa de rota local `sourceLang`→`targetLang` e dos dicionários das duas línguas. O `meaning` é o lema original (o mais frequente entre as leituras da classe); com a legenda fora da língua nativa, é a tradução local dele para `nativeLanguage` (precisa da rota `sourceLang`→`nativeLanguage`). Não viram troca, sem lista por idioma: palavra com leitura de classe fechada no dicionário da legenda (pronome, determinante, preposição, conjunção, artigo, partícula, contração) e, entre as 150 mais frequentes da língua da legenda, a que não tem leitura de substantivo, tem uma de advérbio ou é verbo de acepção principal auxiliar ("should", "can"). Faltando algo: 422 `local_unavailable`, com a mensagem dizendo o par sem rota e as línguas cobertas. O cache separa os motores (`provider: "local"`, com os modelos das rotas usadas e as versões dos dicionários na chave).
- O `stremio-web` tem dois modos ("Quem escolhe" no menu): **Híbrido** (padrão: passa o local na legenda toda e depois a IA refaz lote por lote, substituindo as trocas do local; com 422 vira só IA, com a prévia; IA fora deixa o local) e **Só local**. Não há modo só IA no menu: o híbrido termina com o resultado da IA.
- `wordCoverage` (0–0.5, padrão 0.1; o menu manda 0–50 %): parte das **palavras** da legenda trocadas pela língua de estudo; fora disso, 400 `invalid_word_coverage`. Embaixo do slider o menu mostra a estimativa ("≈ 1 em cada 10 palavras") e, depois de traduzir, a medida das trocas na tela ("1 em cada 9 palavras (412 trocas)", palavras pelo `countWords`; uma troca de várias palavras conta todas). `cueOffset` (inteiro ≥ 0, padrão 0): posição da primeira cue do lote na legenda, para o espaçamento continuar entre os lotes.
- **Escolha das trocas** (`server/src/blend/select.js`, a mesma para os dois motores). O motor entrega candidatas por fala (até 12, já validadas) e o servidor escolhe:
  1. Cota do lote: `round(wordCoverage × palavras do lote)` (`countWords`), contando todas as palavras de cada troca ("de novo" vale 2).
  2. Curva: enquanto a cota cabe em uma troca por fala (cota ≤ falas do lote; ≈ 16 % com 6,3 palavras por fala), mais falas ganham uma troca: a legenda vira janelas de `falas/cota` falas pela posição global (`cueOffset` + índice), no máximo uma troca por janela, e a janela pertence ao lote em que começa. Acima disso toda fala ganha uma e o teto de cada fala é `round(wordCoverage × palavras da fala)`, no mínimo 1 e no máximo metade das palavras. Mais ou menos: 5 % → 1 em cada 3 falas, 10 % → 2 em cada 3, 15 % → todas com uma, 25 % → 1–2 por fala, 33 % → ~2, 50 % → metade das palavras.
  3. O teto é limite, não obrigação: uma troca extra na mesma fala só entra se o lema estiver na lista de frequência (não rara; o desempate pela ordem do motor não conta). Trocas vizinhas na mesma fala valem ("coppie sposate").
  4. Na janela vence a fala com a melhor candidata. Nota: banco (`preferWords`) acima de tudo, depois a frequência do lema na língua de estudo (`<idioma>.freq.txt`, legendas do OpenSubtitles): posições 300–5000 valem mais, as 300 mais comuns menos, as que estão além menos ainda, as que estão fora da lista por último. Empate: a ordem do motor.
  5. Compensação: o que não coube (janela ou fala sem candidata, lote começando no meio de uma janela) vai, enquanto faltar cota e houver candidata, para a fala sem troca mais longe das já escolhidas; sem fala livre, para a fala com menos palavras trocadas em proporção ao tamanho (as abaixo do teto antes), até metade das palavras dela.
  6. O mesmo lema (do banco ou não) só volta a 20 falas de distância da última vez.
  - Limite conhecido: o motor local acha candidatas em ~60 % das falas; numa legenda típica chega a ~13 % das palavras (Breaking Bad pt→it), e acima disso o menu mostra o que foi alcançado.
- **Cache**: o mesmo lote pedido de novo enquanto o primeiro ainda roda (abortar o fetch não para o motor) espera por ele, sem chamar a IA de novo. Guarda as candidatas, não a escolha. No local a chave não tem cobertura nem banco, então mudar o slider não roda o motor de novo. Na IA `wordCoverage` entra na chave, porque o prompt pede o mesmo alvo com folga de 1,5 × (abaixo de uma troca por fala: uma palavra em 1,5 × cota falas; acima: 1,5 × `wordCoverage` das palavras de cada fala), para sobrar escolha.

Resposta:

```json
{ "provider": "claude", "annotations": { "c12": [ { "source": "festas", "target": "feste", "lemma": "festa", "ipa": "...", "pos": "...", "meaning": "...", "translatedLine": "..." } ] } }
```

Cues sem anotação podem ficar fora do mapa. O cliente manda lotes de até ~80 cues. A chave do cache inclui os três idiomas.

**Erros** (todas as rotas do servidor): `{ "error": "mensagem para log", "code": "codigo_estavel" }`. A UI traduz pelo `code`.

| Status | `code` |
|---|---|
| 400 | `invalid_json`, `invalid_body`, `missing_source_lang`, `invalid_source_lang`, `missing_target_lang`, `invalid_target_lang`, `missing_native_language`, `invalid_native_language`, `missing_lang`, `invalid_lang` (`/lookup`), `empty_text`, `text_too_long`, `invalid_cue_coverage`, `invalid_cue_offset`, `invalid_cues`, `too_many_cues`, `invalid_prefer_words`, `too_many_prefer_words`, `invalid_engine` (`/translate`, `/lookup`, `/annotate`) |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 413 | `body_too_large` (corpo > 2 MB; 64 KB em `/lookup` e `/translate`) |
| 422 | `local_unavailable` (`/translate` ou `/annotate` com `engine: "local"` sem rota local, sem o modelo ou sem o dicionário) |
| 501 | `not_supported` (provider sem `lookup`/`translate`) |
| 502 | `provider_error` (falha no provider/Claude) |
| 500 | `internal`, `local_error` (falha da tradução local ou do Blend local) |

`missing_*` = campo ausente ou vazio; `invalid_*` = não é uma tag BCP 47 válida.

`GET /health` → `{ ok: true, provider: "claude"|"claude-code"|"mock", model, mt: { available, models, languages?, reason? } }` (`mt` = tradução local da seção 6; `models` = `[{ model, revision, sourceLanguages, targetLanguages? }]`, um por modelo instalado; `languages` = línguas de origem de todos; `reason` diz como instalar os modelos). CORS liberado para qualquer origem local.

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
  mastered: false,             // dominado: todo flashcard em revisão com estabilidade >= 90 dias
  prefer: true,                // entra primeiro na legenda
  flashcards: [{ kind: "reconhecer", state: 2, dueAt: "2026-11-10T12:00:00.000Z", stability: 12.5 }],
  forms: ["feste"]             // formas vistas nos encontros, com a caixa como foram vistas, sem o lema (até 20)
}
```

- `kind`: `reconhecer` (ver o lema, lembrar o sentido) ou `produzir` (ver o sentido, lembrar o lema). Todo item nasce com o Reconhecer. O Produzir nasce quando uma revisão do Reconhecer dá intervalo de 7 dias ou mais e o item tem sentido.
- `state` é o estado FSRS do flashcard: 0 novo, 1 aprendendo, 2 revisão, 3 reaprendendo.
- `prefer` vale para item ativo com algum flashcard em 1 ou 3, ou em 2 com `dueAt` vencido. `preferWords` é a lista desses lemas, pronta para o `/annotate`.
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
{ ok: true, item: { id, language, lemma, created, encounterId, flashcard: { state, dueAt } } }
{ ok: false, error: "lemma vazio" }
```

- `created: false`: o item já estava no banco (ou repetido no lote). O encontro entra nele mesmo assim.
- `encounterId` é `null` quando o item veio sem `encounter`. Reenviar o mesmo `clientId` devolve o mesmo `encounterId`.
- `flashcard` é o Reconhecer do item.

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
// pedido (engine é opcional; padrão "local")
{ lang: "it", nativeLanguage: "pt-BR", text: "Pulitissima", sentence: "Pulitissima, come la mia coscienza.", engine: "local" }
// resposta local: dicionário (Wiktionary) + tradução local (OPUS-MT)
{
  lemma: "pulito", reading: "", ipa: "/puˈli.to/", pos: "adj.",
  meaning: "limpo",                                    // tradução local do lema
  translation: "Limpíssima, como a minha consciência.", // tradução local da fala
  engine: "local", found: true,
  senses: ["clean", "(figuratively) pure, honest", …],   // acepções do Wiktionary em inglês, até 5
  grammar: ["feminine singular of pulitissimo", "superlative degree of pulito"], // caminho da forma até o lema
  source: { name: "Wiktionary", license: "CC BY-SA 4.0", via: "kaikki.org (Wiktextract)", url: "https://en.wiktionary.org/wiki/pulito#Italian" }
}
// engine: "ai" — a resposta de sempre, gerada pelo provider (Claude), com os campos novos fixos
{ lemma: "fare finta di", reading: "", ipa: "/ˈfa.re ˈfin.ta di/", pos: "expr.", meaning: "fingir", translation: "Eu fingia dormir, mas te ouvi.",
  engine: "ai", found: true, senses: [], grammar: [], source: null }
// japonês, nativa inglês, engine "ai"
{ lang: "ja", nativeLanguage: "en", text: "食べ", sentence: "私は毎朝パンを食べます", engine: "ai" }
→ { lemma: "食べる", reading: "たべる", ipa: "/ta.be.ɾɯ/", pos: "verb (ichidan)", meaning: "to eat", translation: "I eat bread every morning.", engine: "ai", … }
```

- `lang` (idioma da legenda/estudo) e `nativeLanguage` são **obrigatórios** (400 `missing_lang`/`invalid_lang`, `missing_native_language`/`invalid_native_language`).
- `engine`: `"local"` (padrão) ou `"ai"`; outro valor → 400 `invalid_engine`. A IA só é chamada com `"ai"`, que o cliente só manda num clique.
- `lemma` é a forma de dicionário (infinitivo onde o idioma tem, singular, masculino singular nos adjetivos com gênero, forma de dicionário dos verbos japoneses; idioma sem flexão devolve a palavra como está; expressão na forma canônica), com a caixa do dicionário ("Haus", "Roma"). Sem lema, vale a seleção. Seleção toda em maiúsculas desce para minúsculas, só em escritas com caixa.
- `reading`: sempre presente (string). Furigana em kana no japonês, pinyin com tons no chinês, romanização usual em outras escritas não latinas; vazio em escrita latina e no motor local. Fica separado de `ipa`.
- `pos`, `meaning` e `translation` vêm na língua nativa (no motor local, `pos` sai em português quando a nativa é `pt` e em inglês nos outros casos).
- `text` até 80 caracteres, `sentence` até 500.

**Motor local.** Um dicionário por idioma em `server/.dict/<base>.sqlite` (ou `LINGOBLEND_DICT_DIR`), gerado por `server/scripts/setup-dict.sh <idioma>` a partir do Wiktionary em inglês extraído pelo Wiktextract (kaikki.org). Escolhido pela subtag base (`it-CH` usa `it`). Instale as línguas que vai usar (para o Blend local, a de estudo e a da legenda).

- Lema: o verbete da seleção; se ele é forma flexionada ("form of", "alt of"), segue a remissão até o lema (no máximo 5 saltos, sem ciclos), e cada salto vira uma nota em `grammar`. Também procura na tabela de formas dos lemas. Maiúscula de começo de fala vale como minúscula ("Facevo" → fare); no meio da fala, casa a caixa ("Roma" → Roma, nome). Quando a mesma forma tem verbetes de classes diferentes, a palavra anterior desempata (artigo → substantivo: "la porta" → porta; pronome → verbo: "lui porta" → portare).
- Expressão: primeiro o verbete exato ("in bocca al lupo"); senão os lemas de cada palavra juntos, se formarem um verbete ("facevo finta" → fare finta); senão um verbete dentro da seleção com as pontas que já são lema ("facevo finta di" → "fare finta di", acepções de "fare finta"). Senão, `found: false`.
- `found: false` (sem verbete): `lemma` = seleção, `ipa`/`pos` vazios, `senses`/`grammar` vazios, `source: null`; `meaning` e `translation` continuam vindo da tradução local.
- `meaning` é a tradução local da palavra de cabeça do verbete (o lema, ou a expressão achada), não da forma flexionada (o OPUS-MT traduz melhor o lema: "pulito" → "limpo"; "pulitissima" sozinha vira "Limpeza."). Sem verbete, traduz a seleção. Ponto final e maiúscula inicial que o modelo acrescenta saem.
- Sem rota local (ex.: ja→pt) ou sem o modelo: `meaning` e `translation` vazios; os campos do dicionário vêm normalmente se houver dicionário do idioma. Mesmo idioma: `meaning` vazio e `translation` = a fala.
- `ipa` só aparece quando o lema é a própria palavra de cabeça do verbete.
- `senses`: acepções em inglês (`"(tags) glosa"`), no máximo 5; quando o lema é remissão sem acepção própria, as notas da remissão.
- Atribuição: com `found: true`, `source` traz nome, licença (CC BY-SA 4.0; o Wiktionary também é GFDL) e o link do verbete; o cliente mostra "Wiktionary" no cartão.

**Cache em disco.** Local: chave `lookup-local` com a versão do dicionário (esquema + data de geração), o modelo local, idioma, língua nativa, seleção e fala; as traduções reaproveitam o cache do `/translate`. Uma tradução local que falhou não vai para o cache. IA: a mesma chave de antes (provider + modelo, idioma, língua nativa, `lemmaKey` da seleção e fala), então o cache antigo continua valendo. `/health` informa os dicionários instalados em `dict.languages` (`{ it: { entries, builtAt } }`), ou `dict.reason` com a dica de instalação.

### Servidor: `POST /translate`

```js
{ sourceLang: "it", nativeLanguage: "pt-BR", text: "Ciao!", engine: "local" }
→ { translation: "Oi!", engine: "local" }
```

`nativeLanguage` (**obrigatório**, sem padrão) é o idioma de destino; o antigo `targetLang` saiu (o cliente ainda o manda, o servidor ignora). Se for o mesmo idioma de `sourceLang`, a fala volta como está. Usado ao segurar **T**: a fala na tela na língua nativa, sem pausar.

`engine` escolhe quem traduz:

- `"local"` (padrão): modelos OPUS-MT em ONNX int8, dentro do servidor (onnxruntime-node, sem rede, ~50–100 ms por fala), cada um numa subpasta de `server/.models` (`setup-mt.sh`): `Helsinki-NLP/opus-mt-tc-big-itc-itc` entre línguas românicas (origem ast, ca, es, fr, gl, it, lad, oc, pms, pt, ro; destino com token `>>xxx<<` no vocabulário: `pt` e `pt-BR` → `>>pob<<`, outras regiões de `pt` → `>>por<<`), `opus-mt-tc-big-en-it` (inglês → italiano, sem token) e `opus-mt-tc-big-en-pt` (inglês → português, `>>pob<<`/`>>por<<`). A rota de um par é o primeiro modelo instalado (ordem das pastas) que cobre a origem e o destino. Sem rota ou sem o modelo instalado → **422 `local_unavailable`**; falha do modelo → 500 `local_error`. `" / "` (quebra de linha da legenda) vira espaço antes de traduzir.
- `"ai"`: o provider (Claude), como antes.

Outro valor → 400 `invalid_engine`. Cache em disco por motor e modelo (local: modelo + revisão da rota; IA: provider + modelo), idioma de origem, língua nativa e texto; no cliente, por motor.

### No `stremio-web`

- Ligar o modo escolhe a primeira faixa extra na língua-alvo, uma vez por vídeo; sem nenhuma, o menu mostra "Nenhuma legenda em <língua>".
- O cartão abre com esqueleto, chama `/lookup` com `engine: "local"` e mostra a leitura (acima do lema, quando houver), lema, IPA, classe, as notas de gramática, "Nesta fala: <seleção>", o significado, as acepções em inglês ("Em inglês · Wiktionary", até 3) e a fala traduzida. O rótulo do topo diz de onde veio ("Wiktionary · tradução local" ou "✦ IA").
- Sem verbete aparece "sem verbete no dicionário"; sem tradução local, a linha da fala diz "Sem tradução local para este idioma".
- O botão "✦ Explicar com IA" (sempre presente no cartão local) pede `/lookup` com `engine: "ai"` e troca lema, classe, significado e tradução pela resposta da IA, marcada "✦ IA". As acepções do Wiktionary ficam só se o lema da IA for o mesmo. Cache do cliente por motor: reabrir a palavra depois de pedir a IA mostra a versão da IA.
- Salvar manda `SaveItem` com o lema, `encounter.form` = seleção, `sentence` = a fala e `translation` = a fala traduzida. Lema: o do dicionário quando `found`, o da IA depois do botão, senão a seleção. Enquanto a IA responde, Salvar fica desabilitado.
- Se o `/lookup` falhar, dá para salvar com a seleção como lema.
- Segurar **T** mostra a fala traduzida pela tradução local (o rótulo diz "· tradução local" ou "· IA"). **Shift+T** vai direto para a IA. Sem rota local (422) aparece "Sem tradução local para este idioma"; em outro erro, a mensagem do erro. Nos dois casos, e junto da tradução local, há o botão "✦ Traduzir com IA" (aceita clique e não deixa o clique chegar ao player).
- Depois que a IA traduziu uma fala, segurar **T** de novo nela mostra a versão da IA (cache do cliente por motor).
