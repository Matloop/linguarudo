import { findWord } from '@linguetta/language';
import { cleanLemma } from './lang.js';

export const MAX_PER_CUE = 2;
const OPTIONAL = ['reading', 'ipa', 'pos', 'meaning', 'example'];

function str(v, max = 300) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Limpa as anotações de uma cue: exige `source`/`target` não vazios, `source` presente como
 * palavra(s) inteira(s) no texto pelas fronteiras do segmentador do idioma da cue (findWord;
 * em ja/zh/th cai para substring), substituído pelo trecho exato do texto, sem duplicatas,
 * sem sobreposição e no máximo MAX_PER_CUE por cue.
 * langs: { sourceLang (idioma da cue), targetLang (idioma do target/lemma) }
 */
export function validateCueAnnotations(text, raw, { sourceLang, targetLang } = {}) {
  if (!Array.isArray(raw) || typeof text !== 'string') return [];
  const out = [];
  const taken = [];
  for (const a of raw) {
    if (out.length >= MAX_PER_CUE) break;
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
  return out;
}

/** texts: string[]; perIndex: Array<raw[]> com o mesmo comprimento (entradas faltando = []). */
export function validateBatch(texts, perIndex, langs) {
  return texts.map((t, i) => validateCueAnnotations(t, perIndex?.[i], langs));
}
