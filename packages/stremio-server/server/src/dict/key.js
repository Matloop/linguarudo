import { lemmaKey } from '@linguetta/language';

/**
 * Chave de busca no dicionário local: a lemmaKey do idioma (NFC + minúsculas pela regra do
 * idioma; acentos continuam distinguindo), espaços colapsados e apóstrofo tipográfico (’ ʼ ′)
 * trocado pelo reto, que é como o Wiktionary escreve ("dell'", "l'").
 */
export function dictKey(text, lang) {
  return lemmaKey(String(text).normalize('NFC').replace(/[’ʼ′]/g, "'").trim().replace(/\s+/g, ' '), lang);
}
