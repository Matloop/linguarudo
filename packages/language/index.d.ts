// Tipos de @linguetta/language (implementação em src/index.js). Ver ADR 0004.

export interface LanguageProfile {
  /** Tag BCP 47 canônica (ou a entrada, se inválida). */
  tag: string;
  /** Subtag de idioma ('pt' em 'pt-BR'). */
  base: string;
  /** Escrita ISO 15924 ('Latn', 'Jpan', 'Arab'); 'Zzzz' se desconhecida. */
  script: string;
  dir: 'ltr' | 'rtl';
  /** Palavras separadas por espaço (false em ja, zh, th, lo, km, my, bo). */
  spaces: boolean;
  /** A escrita tem maiúsculas e minúsculas. */
  cased: boolean;
  /** Clíticos elididos com apóstrofo viram palavras próprias (it, fr, ca, oc). */
  elision: boolean;
  /** Há wordlists de frequência para o jogo de música (en, it). */
  wordlist: boolean;
}

export interface WordSegment {
  segment: string;
  /** Posição do segmento no texto, em unidades UTF-16. */
  index: number;
  isWord: boolean;
}

export interface LanguageOption {
  tag: string;
  /** Nome no idioma da interface. */
  name: string;
  /** Nome no próprio idioma. */
  endonym: string;
}

/** Regex de boa formação BCP 47 (até 35 caracteres), válida em JS e no `~` do Postgres. */
export const LANGUAGE_TAG_RE: string;

export function isLanguageTag(s: unknown): s is string;

/** 'PT-br' → 'pt-BR', 'iw' → 'he', 'pob' → 'pt-BR', 'zht' → 'zh-Hant', 'português' → null. */
export function canonicalLanguage(input: unknown): string | null;

export function languageProfile(tag: string): LanguageProfile;

export function languageName(tag: string, displayLocale: string): string;

export function languageEndonym(tag: string): string;

export function listLanguages(displayLocale: string): LanguageOption[];

/** NFC + minúsculas do idioma. Só o servidor grava esta chave (ADR 0004). */
export function lemmaKey(lemma: string, tag: string): string;

export function segmentWords(text: string, tag: string): WordSegment[];

export function countWords(text: string, tag: string): number;

export function findWord(text: string, word: string, tag: string): { index: number; length: number } | null;
