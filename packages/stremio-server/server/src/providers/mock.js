import { createHash } from 'node:crypto';
import { PT_IT } from '../dictionary.js';
import { lemmaKey, segmentWords } from '@linguetta/language';
import { baseOf, cleanLemma } from '../lang.js';
import { MAX_CANDIDATES } from '../validate.js';

// O dicionário embutido é só PT → IT, com sentidos em português: o mock só atende
// legenda em português trocada por italiano (blend) ou consulta em italiano, para quem tem
// português como nativa. Qualquer outro par devolve o formato válido, vazio.
const isPt = (tag) => typeof tag === 'string' && baseOf(tag) === 'pt';
const isIt = (tag) => typeof tag === 'string' && baseOf(tag) === 'it';

function tokenize(text) {
  return segmentWords(text, 'pt')
    .filter((s) => s.isWord)
    .map((s) => ({ word: s.segment, start: s.index, end: s.index + s.segment.length }));
}

const MAX_PHRASE = Math.max(...[...PT_IT.keys()].map((k) => k.split(' ').length));

function score(text, start) {
  return createHash('sha1').update(`${text}\0${start}`).digest().readUInt32BE(0);
}

function matchCase(source, target) {
  const first = source[0];
  if (first !== first.toLowerCase() && first === first.toUpperCase()) {
    return target[0].toUpperCase() + target.slice(1);
  }
  return target;
}

/** Acha todas as entradas do dicionário no texto, preferindo a expressão mais longa. */
export function findHits(text) {
  const toks = tokenize(text);
  const hits = [];
  for (let i = 0; i < toks.length; ) {
    let found = null;
    for (let n = Math.min(MAX_PHRASE, toks.length - i); n >= 1 && !found; n--) {
      const span = toks.slice(i, i + n);
      // só palavras separadas por espaço (não atravessa pontuação)
      if (span.some((t, k) => k > 0 && !/^\s+$/.test(text.slice(span[k - 1].end, t.start)))) continue;
      const key = span.map((t) => t.word.toLowerCase()).join(' ');
      const entry = PT_IT.get(key);
      if (entry) found = { entry, start: span[0].start, end: span[n - 1].end, n };
    }
    if (found) {
      const source = text.slice(found.start, found.end);
      const { entry } = found;
      hits.push({
        start: found.start,
        score: score(text, found.start),
        annotation: {
          source,
          target: matchCase(source, entry.target),
          lemma: entry.lemma,
          reading: '',
          ipa: entry.ipa,
          pos: entry.pos,
          meaning: entry.meaning,
          // sem tradutor: o mock não traduz a fala inteira
          translatedLine: '',
        },
      });
      i += found.n;
    } else {
      i++;
    }
  }
  return hits;
}

// IT → entrada do dicionário (pela forma flexionada ou pelo lema), para a consulta do modo só-italiano.
let IT_PT = null;
function itIndex() {
  if (IT_PT) return IT_PT;
  IT_PT = new Map();
  for (const [pt, e] of PT_IT) {
    for (const k of [e.target.toLowerCase(), e.lemma]) if (!IT_PT.has(k)) IT_PT.set(k, { ...e, pt });
  }
  return IT_PT;
}

export function createMockProvider() {
  return {
    name: 'mock',
    model: 'mock-dict-v1',
    // Sem LLM: acha a seleção no dicionário embutido (só IT, nativa PT); o resto volta vazio,
    // com a seleção como lema.
    async lookup({ lang, nativeLanguage, text }) {
      const sel = cleanLemma(text, lang);
      const e = isIt(lang) && isPt(nativeLanguage) ? itIndex().get(lemmaKey(sel, lang)) : null;
      if (!e) return { lemma: sel, reading: '', ipa: '', pos: '', meaning: '', translation: '' };
      return { lemma: e.lemma, reading: '', ipa: e.ipa, pos: e.pos, meaning: e.meaning, translation: '' };
    },
    async translate() {
      return '';
    },
    // Candidatas por fala (até MAX_CANDIDATES), na ordem de preferência: palavras do banco primeiro,
    // depois pelo hash. A escolha é do servidor.
    async annotate({ sourceLang, targetLang, nativeLanguage, wordCoverage, texts, preferWords = [] }) {
      if (!isPt(sourceLang) || !isIt(targetLang) || !isPt(nativeLanguage) || !(wordCoverage > 0)) return texts.map(() => []);
      const prefer = new Set(preferWords.map((w) => lemmaKey(w, targetLang)));
      const bank = (h) => (prefer.has(lemmaKey(h.annotation.lemma, targetLang)) ? 0 : 1);
      // por cue: candidatos ordenados pelo hash (determinístico, mas "aleatório")
      return texts.map((t) =>
        findHits(t)
          .sort((a, b) => bank(a) - bank(b) || a.score - b.score)
          .slice(0, MAX_CANDIDATES)
          .map((h) => h.annotation),
      );
    },
  };
}
