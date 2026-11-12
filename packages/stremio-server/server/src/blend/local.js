// Blend sem IA: escolhe as palavras da legenda a trocar pela língua de estudo usando só o tradutor
// local (OPUS-MT) e os dicionários locais (Wiktionary). Cobre os pares que os modelos traduzem
// (românicas entre si; inglês → italiano/português: src/mt/opus-mt.js) com o dicionário das duas
// línguas instalado. Mesmo formato do provider (annotate → Array<raw[]>), então passa pelo mesmo
// validateBatch e pelo mesmo cache.
//
// Por fala:
//   1. traduz a fala inteira (legenda → estudo), p.ex. "Estou falando para minha família agora." →
//      "Ora parlo alla mia famiglia.";
//   2. candidatas: palavras de conteúdo da fala (≥ 4 letras, sem leitura de classe fechada no
//      dicionário, muito comum só se for substantivo, sem nome próprio, sem clítico com hífen);
//   3. cada candidata traduzida sozinha ("família" → "famiglia") vira um conjunto de lemas; o
//      token da frase traduzida que tem um desses lemas é a troca — na forma da frase. Sem esse
//      token ("primo" sozinho → "primo", a frase diz "cugino"), as glosas em inglês dos dois
//      dicionários decidem: o único token da frase com uma leitura da mesma classe e uma glosa em
//      comum com a original, nas duas primeiras acepções dos dois lados ("male cousin");
//   4. conferência pelos dois dicionários: classe compatível (substantivo ↔ substantivo), número e
//      gênero (adjetivo) iguais, mesma forma verbal (infinitivo, particípio, gerúndio, flexionada).
//      Na dúvida, não troca: uma palavra a menos é melhor que uma palavra errada na legenda. O
//      significado é a palavra original (legenda na língua nativa) ou a tradução dela para a nativa;
//   5. devolve as candidatas de cada fala, na ordem de preferência (substantivo, verbo e adjetivo
//      antes de advérbio; palavra mais longa antes). Quais falas e quais palavras vão para a tela é
//      decisão de src/blend/select.js, a mesma para a IA.
import { languageProfile, segmentWords } from '@linguetta/language';
import { joinLines } from '../mt/opus-mt.js';
import { posLabel, tidyWordTranslation } from '../lookup.js';
import { sameLanguage } from '../lang.js';

// Sobe quando a escolha muda: entra na chave do cache.
export const LOCAL_BLEND_VERSION = 5;

const CONTENT = new Set(['noun', 'verb', 'adj', 'adv']);
const MIN_LENGTH = 4;
const MAX_WORDS_ALONE = 3;
const WORD_CACHE_MAX = 20_000;
// Alinhamento pelas glosas: só as primeiras acepções (a palavra no sentido principal, dos dois
// lados); com mais, "jogada" (play) casa com "sono" (suonare: to play an instrument).
const GLOSS_SENSES = 2;
const GLOSS_CACHE_MAX = 50_000;

// Palavras que não viram troca, sem lista por idioma: qualquer leitura de classe fechada no
// dicionário da legenda ("minha", "como", "certo", mesmo com homógrafo de conteúdo) e, entre as
// COMMON_SKIP mais frequentes da língua da legenda, o que não tem leitura de substantivo ou tem uma
// de advérbio (verbos de apoio e muletas: "está", "acho", "dizer", "aqui", "nunca"; "casa" e
// "coisas" ficam). Verbo cuja acepção principal é auxiliar também sai ("should", "can", "will":
// o Wiktionary dá substantivo para eles). A ordem das leituras não decide: o dicionário põe
// "coisar" antes de "coisa". Numeral fica: "três" → "tre" ensina.
const CLOSED = new Set(['pron', 'det', 'prep', 'conj', 'article', 'particle', 'contraction']);
const COMMON_SKIP = 150;
const auxiliary = (r) => r.entry.pos === 'verb' && Boolean(r.entry.s[0]?.[1]?.includes('auxiliary'));

// Línguas em que a forma de dicionário não marca quase nada: adjetivo sem gênero nem número
// ("married" casa com "sposate") e verbo cuja forma básica é infinitivo e presente ao mesmo tempo
// ("spend": to spend / they spend). O lema delas só diz o número do substantivo. `infinitive`: a
// partícula do infinitivo, para o significado do verbo sair no infinitivo ("talk" sozinho vira
// "Fale"; "to talk" vira "Para falar" → "falar").
const BARE_LEMMA = new Map([['en', { infinitive: 'to' }]]);
const bareLemma = (lang) => BARE_LEMMA.has(languageProfile(lang).base);

// Traços de uma leitura do dicionário, das notas do Wiktionary em inglês ("feminine plural of
// vegetariano", "past participle of parlare", "third-person singular preterite...", "simple past
// and past participle of hear", "participle present of work"). Lema sem nota: substantivo e
// adjetivo no singular (adjetivo no masculino, a convenção dos dicionários), verbo no infinitivo;
// em língua de lema "nu" (BARE_LEMMA) só o substantivo no singular.
function traits(reading, bare = false) {
  const t = { num: new Set(), gen: new Set(), vform: new Set(), person: new Set() };
  const notes = reading.notes.join(' ').toLowerCase();
  const pos = reading.entry.pos;
  if (!reading.notes.length) {
    if (pos === 'noun' || (pos === 'adj' && !bare)) t.num.add('sg');
    if (bare) return t;
    if (pos === 'adj') t.gen.add('m');
    if (pos === 'verb') t.vform.add('inf');
    return t;
  }
  if (/\bplural\b/.test(notes)) t.num.add('pl');
  if (/\bsingular\b/.test(notes) && pos !== 'verb') t.num.add('sg');
  if (/\bmasculine\b/.test(notes)) t.gen.add('m');
  if (/\bfeminine\b/.test(notes)) t.gen.add('f');
  if (pos === 'verb') {
    // Particípio presente (inglês "working") faz o papel do gerúndio: "lavorando".
    if (/present participle|participle present/.test(notes)) t.vform.add('ger');
    else if (/past participle|participle past|\bparticiple\b/.test(notes)) t.vform.add('part');
    else if (/\bgerund\b/.test(notes)) t.vform.add('ger');
    else if (/\binfinitive\b/.test(notes) && !/-person/.test(notes)) t.vform.add('inf');
    else if (/-person|\bimperative\b/.test(notes)) t.vform.add('fin');
    // Passado simples do inglês: forma flexionada (às vezes igual ao particípio: "heard"). "participle
    // past of sobrar" é só particípio.
    if (/simple past|(?<!participle )\bpast of\b/.test(notes)) t.vform.add('fin');
    // Primeira pessoa de um lado só: "atrasou" (ele) ≠ "ritardo" (eu). Segunda e terceira andam
    // juntas: "você trabalha" vira "lavori".
    if (/first-person/.test(notes)) t.person.add('1');
    if (/(second|third)-person/.test(notes)) t.person.add('23');
  }
  return t;
}

const union = (readings, key, bare) => new Set(readings.flatMap((r) => [...traits(r, bare)[key]]));
const clash = (a, b) => a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x));
// Particípio é verbo e adjetivo ao mesmo tempo ("pintado" / "dipinto").
const posSet = (readings) => {
  const s = new Set(readings.map((r) => r.entry.pos));
  if (readings.some((r) => r.entry.pos === 'verb' && traits(r).vform.has('part'))) s.add('adj');
  return s;
};
// Substantivo/adjetivo na original e só particípio no destino ("suspeitos" → "sospettati", lema
// sospettare) não entra: o lema mostrado seria o verbo.
const posFits = (sourcePos, targetPos) => sourcePos.has(targetPos);
// Ordem de preferência da leitura no destino: a classe da leitura mais forte da original primeiro
// ("suspeitos": substantivo/adjetivo antes do particípio de "sospettare").
const posRank = (sourceReadings, targetPos) => {
  const i = sourceReadings.findIndex((r) => r.entry.pos === targetPos);
  return i < 0 ? sourceReadings.length : i;
};

// Glosas de um verbete para comparar entre dicionários: as primeiras GLOSS_SENSES acepções, em
// minúsculas, sem parênteses, quebradas em ";" e ",", sem "to " de verbo nem artigo; só glosa
// curta (1–2 palavras, ≥ 3 letras): "to say, tell, utter" → say, tell, utter; "a male cousin (son
// of one’s uncle or aunt)" → male cousin.
function glossSet(entry) {
  const out = new Set();
  for (const [gloss] of entry.s.slice(0, GLOSS_SENSES)) {
    let g = String(gloss ?? '').toLowerCase();
    while (/\([^()]*\)/.test(g)) g = g.replace(/\([^()]*\)/g, ' ');
    for (const part of g.split(/[;,]/)) {
      const x = part.trim().replace(/\s+/g, ' ').replace(/^to /, '').replace(/^(a|an|the) /, '').replace(/[.!?:]+$/, '');
      if (x.length >= 3 && x.split(' ').length <= 2) out.add(x);
    }
  }
  return out;
}

/**
 * translator: OPUS-MT (src/mt/opus-mt.js); dictionaries: openDictionaries() (src/dict/wiktionary.js).
 * Precisa dos dicionários da língua de estudo e da legenda (classe, concordância e palavras que não
 * viram troca). Legenda fora da língua nativa: o significado passa pelo tradutor (legenda → nativa).
 */
export function createLocalAnnotator({ translator, dictionaries }) {
  const words = new Map(); // tradução de palavra solta, por par: muitas se repetem entre falas
  const glossCache = new WeakMap(); // dicionário → (verbete → glosas)

  /** null quando dá para anotar localmente; senão o motivo. */
  function unavailable({ sourceLang, targetLang, nativeLanguage }) {
    if (!translator?.available) return 'tradutor local não instalado';
    // Legenda fora da língua nativa: o significado é a palavra original traduzida para a nativa.
    const routes = [[sourceLang, targetLang], ...(sameLanguage(sourceLang, nativeLanguage) ? [] : [[sourceLang, nativeLanguage]])];
    const missing = routes.find(([from, to]) => !translator.route(from, to));
    if (missing) return `sem tradução local ${missing.join('->')}: o motor local cobre ${translator.languages.join(', ')}`;
    for (const lang of [targetLang, sourceLang]) if (!dictionaries?.get(lang)) return `sem dicionário local de ${lang}`;
    return null;
  }

  // Chave do cache: os modelos das rotas usadas (legenda → estudo e, se for o caso, → nativa).
  function model({ sourceLang, targetLang, nativeLanguage }) {
    const via = (to) => translator?.route?.(sourceLang, to)?.model ?? 'none';
    const mt = sameLanguage(sourceLang, nativeLanguage) ? via(targetLang) : `${via(targetLang)}+${via(nativeLanguage)}`;
    const dict = (lang) => dictionaries?.get(lang)?.version ?? 'none';
    return `${mt}|${dict(targetLang)}|${dict(sourceLang)}|v${LOCAL_BLEND_VERSION}`;
  }

  const mt = (sourceLang, targetLang, text) => translator.translate({ sourceLang, nativeLanguage: targetLang, text });

  async function alone(sourceLang, targetLang, word) {
    const key = `${sourceLang}>${targetLang}:${word}`;
    if (words.has(key)) return words.get(key);
    const out = tidyWordTranslation(word, await mt(sourceLang, targetLang, word));
    if (words.size >= WORD_CACHE_MAX) words.clear();
    words.set(key, out);
    return out;
  }

  // Significado do lema na língua nativa. Verbo de língua de lema "nu": traduz com a partícula do
  // infinitivo e tira a tradução dela do começo ("to talk" → "Para falar" → "falar").
  async function meaningOf(sourceLang, nativeLanguage, lemma, pos) {
    const particle = pos === 'verb' ? BARE_LEMMA.get(languageProfile(sourceLang).base)?.infinitive : null;
    if (!particle) return alone(sourceLang, nativeLanguage, lemma);
    const [full, marker] = await Promise.all([alone(sourceLang, nativeLanguage, `${particle} ${lemma}`), alone(sourceLang, nativeLanguage, particle)]);
    const words = full.split(/\s+/);
    if (words.length > 1 && words[0].toLocaleLowerCase(nativeLanguage) === marker.toLocaleLowerCase(nativeLanguage)) return words.slice(1).join(' ');
    return full || alone(sourceLang, nativeLanguage, lemma);
  }

  // Lema mais frequente entre as leituras (empate ou sem lista: a primeira).
  const mostFrequent = (dict, readings) => {
    const rank = (r) => dict.frequency?.rank(r.entry.word) ?? Infinity;
    return readings.reduce((best, r) => (rank(r) < rank(best) ? r : best)).entry.word;
  };

  // Leituras de um token com sentido (acepções próprias), mais perto da forma primeiro.
  const readingsOf = (dict, surface, initial) =>
    dict
      .resolve(surface, { initial })
      .filter((r) => r.entry.s.length)
      .sort((a, b) => a.notes.length - b.notes.length || b.score - a.score);

  function glosses(dict, entry) {
    if (!glossCache.has(dict)) glossCache.set(dict, new Map());
    const cache = glossCache.get(dict);
    const key = entry.id ?? `${entry.word}\u0000${entry.pos}`;
    if (!cache.has(key)) {
      if (cache.size >= GLOSS_CACHE_MAX) cache.clear();
      cache.set(key, glossSet(entry));
    }
    return cache.get(key);
  }

  // Token da frase traduzida pelas glosas (quando a palavra solta não aparece nela): o único livre,
  // sem leitura de classe fechada, com uma leitura de conteúdo da mesma classe de uma leitura da
  // original e uma glosa em comum. Token que é lema da classe não casa por uma remissão dela
  // ("tavolino" não é "tavolo", board). Devolve o índice e as leituras do token que casaram.
  function glossAlign(source, target, sourceReadings, tokens, used) {
    const from = sourceReadings.filter((r) => CONTENT.has(r.entry.pos)).map((r) => ({ pos: r.entry.pos, g: glosses(source, r.entry) }));
    const hits = [];
    tokens.forEach((t, k) => {
      if (used.has(k) || t.readings.some((r) => CLOSED.has(r.entry.pos))) return;
      const own = new Set(t.readings.filter((r) => !r.notes.length).map((r) => r.entry.pos));
      const readings = t.readings.filter((r) => {
        if (!CONTENT.has(r.entry.pos) || (r.notes.length && own.has(r.entry.pos))) return false;
        const g = glosses(target, r.entry);
        return from.some((s) => s.pos === r.entry.pos && [...s.g].some((x) => g.has(x)));
      });
      if (readings.length) hits.push({ j: k, readings: new Set(readings) });
    });
    return hits.length === 1 ? hits[0] : null;
  }

  async function cue({ sourceLang, targetLang, nativeLanguage, text }) {
    const target = dictionaries.get(targetLang);
    const source = dictionaries.get(sourceLang);
    const sentence = joinLines(text);
    const translated = tidyWordTranslation(sentence, await mt(sourceLang, targetLang, sentence));
    if (!translated) return [];
    const tokens = segmentWords(translated, targetLang)
      .filter((s) => s.isWord)
      .map((s) => {
        const readings = readingsOf(target, s.segment, true);
        return { text: s.segment, readings, lemmas: [...new Set(readings.map((r) => r.entry.word))] };
      });
    const used = new Set();
    const picks = [];
    for (const [i, tok] of segmentWords(text, sourceLang).filter((s) => s.isWord).entries()) {
      const w = tok.segment;
      const lower = w.toLocaleLowerCase(sourceLang);
      if ([...w].length < MIN_LENGTH || /[\d-]/.test(w)) continue;
      const startsSentence = i === 0 || /[.!?…:\-–—]\s*$/.test(text.slice(0, tok.index));
      if (!startsSentence && w !== lower) continue; // nome próprio no meio da frase

      // Leituras da palavra original: classe de conteúdo, nenhuma classe fechada; muito comum só se
      // for substantivo.
      const sourceReadings = readingsOf(source, w, startsSentence);
      if (!sourceReadings.some((r) => CONTENT.has(r.entry.pos))) continue;
      if (sourceReadings.some((r) => CLOSED.has(r.entry.pos))) continue;
      const common = source.frequency?.rank(lower);
      if (common && common <= COMMON_SKIP && (!sourceReadings.some((r) => r.entry.pos === 'noun') || sourceReadings.some((r) => r.entry.pos === 'adv' || auxiliary(r)))) continue;
      const sourcePos = posSet(sourceReadings);

      const single = await alone(sourceLang, targetLang, lower);
      if (!single || single.split(/\s+/).length > MAX_WORDS_ALONE) continue;
      const want = new Set([single.toLocaleLowerCase(targetLang), ...readingsOf(target, single, false).map((r) => r.entry.word)]);
      let j = tokens.findIndex((t, k) => !used.has(k) && (want.has(t.text.toLocaleLowerCase(targetLang)) || t.lemmas.some((l) => want.has(l))));
      const gloss = j < 0 ? glossAlign(source, target, sourceReadings, tokens, used) : null;
      if (gloss) j = gloss.j;
      if (j < 0) continue;
      const tokenText = tokens[j].text;
      if (tokenText.toLocaleLowerCase(targetLang) === lower) continue; // igual nas duas línguas: não ensina

      // Leitura do token na frase: lema em comum com a palavra solta, classe que bate com a original;
      // pelas glosas, só a leitura que casou.
      // Interjeição dos dois lados ("Obrigado" / "Grazie"): é fórmula, não palavra para estudar.
      if (sourceReadings.some((r) => r.entry.pos === 'intj') && tokens[j].readings.some((r) => r.entry.pos === 'intj')) continue;
      const fitting = tokens[j].readings
        .filter((r) => CONTENT.has(r.entry.pos) && posFits(sourcePos, r.entry.pos))
        .map((r, k) => ({ r, k, rank: posRank(sourceReadings, r.entry.pos) }))
        .sort((a, b) => a.rank - b.rank || a.k - b.k)
        .map((x) => x.r);
      const shared = fitting.filter((r) => (gloss ? gloss.readings.has(r) : want.has(r.entry.word)));
      const reading = (shared.length || gloss ? shared : fitting)[0];
      if (!reading) continue;
      const lemma = reading.entry.word;
      const pos = reading.entry.pos;
      const targetReadings = tokens[j].readings.filter((r) => r.entry.word === lemma && r.entry.pos === pos);

      // Concordância: número (substantivo, adjetivo), gênero (adjetivo), forma verbal.
      const [sb, tb] = [bareLemma(sourceLang), bareLemma(targetLang)];
      const same = sourceReadings.filter((r) => r.entry.pos === pos || (pos === 'adj' && r.entry.pos === 'verb') || (pos === 'verb' && r.entry.pos === 'adj'));
      const from = same.length ? same : sourceReadings.filter((r) => CONTENT.has(r.entry.pos));
      if (pos === 'noun' || pos === 'adj') {
        if (clash(union(from, 'num', sb), union(targetReadings, 'num', tb))) continue;
      }
      if (pos === 'adj' && clash(union(from, 'gen', sb), union(targetReadings, 'gen', tb))) continue;
      if (pos === 'verb' && clash(union(from, 'vform', sb), union(targetReadings, 'vform', tb))) continue;
      if (pos === 'verb' && clash(union(from, 'person', sb), union(targetReadings, 'person', tb))) continue;

      // Lema da original: da mesma classe da troca, o mais frequente ("vive" → vivir, não vivar).
      const sameClass = sourceReadings.filter((r) => r.entry.pos === pos);
      const sourceLemma = mostFrequent(source, sameClass.length ? sameClass : sourceReadings.filter((r) => CONTENT.has(r.entry.pos)));
      // Significado na língua nativa: a palavra original, ou a tradução dela se a legenda é de outra língua.
      const meaning = sameLanguage(sourceLang, nativeLanguage) ? sourceLemma : await meaningOf(sourceLang, nativeLanguage, sourceLemma, pos);
      if (!meaning) continue;
      const rank = (pos === 'adv' ? 0 : 1) + Math.min([...w].length, 10) / 10;
      used.add(j);
      picks.push({
        source: w,
        target: w !== lower ? tokenText[0].toLocaleUpperCase(targetLang) + tokenText.slice(1) : tokenText.toLocaleLowerCase(targetLang),
        lemma,
        ipa: reading.entry.ipa ?? '',
        pos: posLabel({ pos, gender: reading.entry.g ?? '', lemma }, nativeLanguage),
        meaning,
        translatedLine: translated,
        rank,
      });
    }
    return picks.sort((a, b) => b.rank - a.rank).map(({ rank, ...p }) => p);
  }

  /** Mesmo contrato do provider: { sourceLang, targetLang, nativeLanguage, texts } → candidatas por fala. */
  async function annotate({ sourceLang, targetLang, nativeLanguage, texts }) {
    const why = unavailable({ sourceLang, targetLang, nativeLanguage });
    if (why) throw new Error(why);
    const perCue = [];
    for (const text of texts) perCue.push(text.trim() ? await cue({ sourceLang, targetLang, nativeLanguage, text }) : []);
    return perCue;
  }

  return { name: 'local', unavailable, model, annotate };
}
