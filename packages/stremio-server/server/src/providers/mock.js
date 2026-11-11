import { createHash } from 'node:crypto';
import { PT_IT } from '../dictionary.js';
import { countWords, tokenize } from '../words.js';
import { MAX_PER_CUE } from '../validate.js';

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
          ipa: entry.ipa,
          pos: entry.pos,
          meaning: entry.meaning,
          example: entry.example,
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
    // Sem LLM: acha a seleção no dicionário embutido (só IT); o resto volta vazio.
    async lookup({ lang, text }) {
      const key = text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
      const e = lang === 'it' ? itIndex().get(key) : null;
      if (!e) return { lemma: key, ipa: '', pos: '', meaning: '', translation: '' };
      return { lemma: e.lemma, ipa: e.ipa, pos: e.pos, meaning: e.meaning, translation: '' };
    },
    async translate() {
      return '';
    },
    async annotate({ sourceLang, targetLang, density, texts, preferWords = [] }) {
      const result = texts.map(() => []);
      if (sourceLang !== 'pt' || targetLang !== 'it' || !(density > 0)) return result;

      const totalWords = texts.reduce((n, t) => n + countWords(t), 0);
      let quota = Math.max(1, Math.round(density * totalWords));
      const prefer = new Set(preferWords);
      // por cue: candidatos ordenados pelo hash (determinístico, mas "aleatório")
      const perCue = texts.map((t) => findHits(t).sort((a, b) => a.score - b.score));

      // 1º as palavras do banco do usuário, depois as novas completam a cota.
      // Em cada fase, rodadas: 1ª escolhe o melhor de cada cue, 2ª o segundo melhor... para espalhar.
      for (const preferred of [true, false]) {
        const pools = perCue.map((hits) => hits.filter((h) => prefer.has(h.annotation.lemma) === preferred));
        for (let round = 0; round < MAX_PER_CUE && quota > 0; round++) {
          const picks = [];
          pools.forEach((hits, idx) => {
            const hit = hits[round];
            if (hit && result[idx].length < MAX_PER_CUE) picks.push({ idx, hit });
          });
          picks.sort((a, b) => a.hit.score - b.hit.score);
          for (const { idx, hit } of picks.slice(0, quota)) result[idx].push(hit);
          quota -= Math.min(quota, picks.length);
        }
      }
      // ordem de leitura dentro da cue
      return result.map((hits) => hits.sort((a, b) => a.start - b.start).map((h) => h.annotation));
    },
  };
}
