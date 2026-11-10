import { findWholeWord } from './words.js';

export const MAX_PER_CUE = 2;
const OPTIONAL = ['ipa', 'pos', 'meaning', 'example'];

function str(v, max = 300) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Limpa as anotações de uma cue: exige `source`/`target` não vazios, `source` presente como
 * palavra(s) inteira(s) no texto (substituído pelo trecho exato do texto), sem duplicatas,
 * sem sobreposição e no máximo MAX_PER_CUE por cue.
 */
export function validateCueAnnotations(text, raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const taken = [];
  for (const a of raw) {
    if (out.length >= MAX_PER_CUE) break;
    if (!a || typeof a !== 'object') continue;
    const target = str(a.target, 200);
    const hit = findWholeWord(text, str(a.source, 200));
    if (!target || !hit) continue;
    if (taken.some(([s, e]) => hit.start < e && s < hit.end)) continue;
    taken.push([hit.start, hit.end]);
    const ann = { source: hit.match, target };
    for (const k of OPTIONAL) {
      const v = str(a[k]);
      if (v) ann[k] = v;
    }
    out.push(ann);
  }
  return out;
}

/** texts: string[]; perIndex: Array<raw[]> com o mesmo comprimento (entradas faltando = []). */
export function validateBatch(texts, perIndex) {
  return texts.map((t, i) => validateCueAnnotations(t, perIndex?.[i]));
}
