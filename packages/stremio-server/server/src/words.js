// Palavras e correspondência de palavras inteiras, Unicode (acentos, ç, etc.).
// Uma "palavra" é uma sequência de letras/marcas/dígitos, podendo conter hífen ou apóstrofo
// interno ("guarda-chuva", "d'água"). Um trecho de palavra hifenizada não conta como palavra inteira.

const W = '[\\p{L}\\p{M}\\p{N}]';
const JOIN = "[-'’]";

export const WORD_RE = new RegExp(`${W}+(?:${JOIN}${W}+)*`, 'gu');

export function tokenize(text) {
  const out = [];
  for (const m of String(text).matchAll(WORD_RE)) {
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function countWords(text) {
  let n = 0;
  for (const _ of String(text).matchAll(WORD_RE)) n++;
  return n;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRe(source, flags) {
  const parts = source.trim().split(/\s+/).map(escapeRe);
  const body = parts.join('\\s+');
  return new RegExp(`(?<!${W}|${W}${JOIN})${body}(?!${W}|${JOIN}${W})`, flags);
}

/**
 * Procura `source` como palavra(s) inteira(s) em `text`.
 * Tenta primeiro com caixa exata, depois sem diferenciar maiúsculas; tenta as formas NFC e NFD
 * de `source` para tolerar diferenças de normalização.
 * Retorna { start, end, match } (match = trecho exato do texto) ou null.
 */
export function findWholeWord(text, source, fromIndex = 0) {
  if (typeof text !== 'string' || typeof source !== 'string') return null;
  const src = source.trim();
  if (!src || !new RegExp(`^${W}`, 'u').test(src) || !new RegExp(`${W}$`, 'u').test(src)) return null;
  const variants = [...new Set([src, src.normalize('NFC'), src.normalize('NFD')])];
  for (const flags of ['gu', 'giu']) {
    for (const v of variants) {
      const re = buildRe(v, flags);
      re.lastIndex = fromIndex;
      const m = re.exec(text);
      if (m) return { start: m.index, end: m.index + m[0].length, match: m[0] };
    }
  }
  return null;
}
