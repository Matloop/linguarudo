import { findWord } from '@linguetta/language';
import { cleanLemma } from './lang.js';

// Candidatas por fala antes da escolha (src/blend/select.js), que deixa até metade das palavras da
// fala com 50% de cobertura: uma fala longa (14 palavras) pode levar 7, e a IA oferece 1,5 × isso.
export const MAX_CANDIDATES = 12;
const OPTIONAL = ['reading', 'ipa', 'pos', 'meaning', 'translatedLine'];

function str(v, max = 300) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Limpa as anotações de uma cue: exige `source`/`target` não vazios, `source` presente como
 * palavra(s) inteira(s) no texto pelas fronteiras do segmentador do idioma da cue (findWord;
 * em ja/zh/th cai para substring), substituído pelo trecho exato do texto, sem duplicatas,
 * sem sobreposição e no máximo `max` por cue (MAX_CANDIDATES: a escolha final vem depois).
 * `translatedLine` é a fala inteira na língua-alvo: igual em todas as trocas da cue (vale a primeira).
 * langs: { sourceLang (idioma da cue), targetLang (idioma do target/lemma), max }
 */
export function validateCueAnnotations(text, raw, { sourceLang, targetLang, max = MAX_CANDIDATES } = {}) {
  if (!Array.isArray(raw) || typeof text !== 'string') return [];
  const out = [];
  const taken = [];
  for (const a of raw) {
    if (out.length >= max) break;
    if (!a || typeof a !== 'object') continue;
    const target = str(a.target, 200);
    const hit = findWord(text, str(a.source, 200), sourceLang);
    if (!target || !hit) continue;
    const start = hit.index;
    const end = hit.index + hit.length;
    if (taken.some(([s, e]) => start < e && s < end)) continue;
    taken.push([start, end]);
    // lema = forma de dicionário do target ("feste" → "festa", "Häuser" → "Haus"), com a caixa
    // do dicionário; é o que o banco guarda (a unicidade usa lemmaKey).
    const lemma = cleanLemma(str(a.lemma, 80) || target, targetLang);
    const ann = { source: text.slice(start, end), target, lemma };
    for (const k of OPTIONAL) {
      const v = str(a[k]);
      if (v) ann[k] = v;
    }
    out.push(ann);
  }
  const line = out.find((a) => a.translatedLine)?.translatedLine;
  if (line) for (const a of out) a.translatedLine = line;
  return out;
}

/** texts: string[]; perIndex: Array<raw[]> com o mesmo comprimento (entradas faltando = []). */
export function validateBatch(texts, perIndex, langs) {
  return texts.map((t, i) => validateCueAnnotations(t, perIndex?.[i], langs));
}
