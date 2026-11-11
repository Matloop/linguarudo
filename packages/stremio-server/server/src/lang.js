// Idiomas como tags BCP 47 canônicas (ADR 0004). Tudo vem de @linguetta/language;
// aqui ficam só os atalhos que o servidor usa em vários lugares.
import { canonicalLanguage, languageName, languageProfile, lemmaKey } from '@linguetta/language';
import { HttpError } from './errors.js';

/**
 * Tag BCP 47 canônica ou null. Aceita ISO 639-1/2/3, qualquer caixa, `_` e os códigos do
 * OpenSubtitles ('pob' → 'pt-BR', 'zht' → 'zh-Hant'). Escrita e região são preservadas.
 */
export function normalizeLang(input) {
  return canonicalLanguage(input);
}

/** Nome do idioma em inglês para os prompts ('ja' → 'Japanese'); cai na própria tag. */
export function langName(tag) {
  return languageName(tag, 'en');
}

/** Mesmo idioma para fins de tradução: mesma subtag base e mesma escrita ('pt-BR' = 'pt-PT', 'zh-Hans' ≠ 'zh-Hant'). */
export function sameLanguage(a, b) {
  if (a === b) return true;
  const pa = languageProfile(a);
  const pb = languageProfile(b);
  return pa.base === pb.base && pa.script === pb.script;
}

/** Subtag base ('pt' em 'pt-BR'). */
export function baseOf(tag) {
  return languageProfile(tag).base;
}

/**
 * Lema limpo: NFC, espaços colapsados, até `max` caracteres. A caixa fica como o dicionário
 * escreve ("Haus", "Roma", "casa"); só um lema todo em maiúsculas (legenda gritada) desce
 * para minúsculas, e só em escritas com caixa.
 */
export function cleanLemma(raw, lang, max = 80) {
  const lemma = String(raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, max);
  const cased = languageProfile(lang).cased;
  if (cased && [...lemma].length > 1 && lemma === lemma.toUpperCase() && lemma !== lemma.toLowerCase()) {
    return lemmaKey(lemma, lang);
  }
  return lemma;
}

const snake = (field) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Campo de idioma obrigatório de um pedido HTTP → tag canônica. Ausente: 400
 * `missing_<campo>`; inválido: 400 `invalid_<campo>` (ex.: missing_native_language).
 */
export function requireLanguage(value, field) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    throw new HttpError(400, `missing_${snake(field)}`, `${field} ausente`);
  }
  const tag = canonicalLanguage(value);
  if (!tag) throw new HttpError(400, `invalid_${snake(field)}`, `${field} inválido (use uma tag BCP 47)`);
  return tag;
}
