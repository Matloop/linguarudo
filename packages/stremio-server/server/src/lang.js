// Normaliza códigos de idioma (ISO 639-1, 639-2/B, 639-2/T, tags BCP 47, códigos do OpenSubtitles)
// para ISO 639-1 em minúsculas. Retorna null se a entrada não parecer um idioma.

const ALIASES = {
  // português (pob = português do Brasil no OpenSubtitles, pb/pt-br idem)
  por: 'pt', pob: 'pt', pb: 'pt', portuguese: 'pt', 'português': 'pt', portugues: 'pt',
  ita: 'it', italian: 'it', italiano: 'it',
  eng: 'en', english: 'en', 'inglês': 'en',
  spa: 'es', spanish: 'es', 'español': 'es', espanol: 'es', 'espanhol': 'es', spl: 'es', spn: 'es',
  fra: 'fr', fre: 'fr', french: 'fr', 'français': 'fr', 'francês': 'fr',
  deu: 'de', ger: 'de', german: 'de', deutsch: 'de', 'alemão': 'de',
  nld: 'nl', dut: 'nl', dutch: 'nl',
  cat: 'ca', glg: 'gl', eus: 'eu', baq: 'eu',
  ron: 'ro', rum: 'ro', pol: 'pl', ces: 'cs', cze: 'cs', slk: 'sk', slo: 'sk',
  hun: 'hu', fin: 'fi', swe: 'sv', nor: 'no', nob: 'nb', nno: 'nn', dan: 'da', isl: 'is', ice: 'is',
  ell: 'el', gre: 'el', tur: 'tr', rus: 'ru', ukr: 'uk', bul: 'bg', srp: 'sr', hrv: 'hr', scc: 'sr', scr: 'hr',
  slv: 'sl', bos: 'bs', mkd: 'mk', mac: 'mk', sqi: 'sq', alb: 'sq', lit: 'lt', lav: 'lv', est: 'et',
  ara: 'ar', heb: 'he', fas: 'fa', per: 'fa', hin: 'hi', ben: 'bn', urd: 'ur',
  zho: 'zh', chi: 'zh', zht: 'zh', zhe: 'zh', jpn: 'ja', kor: 'ko', tha: 'th', vie: 'vi',
  ind: 'id', msa: 'ms', may: 'ms', tgl: 'tl', fil: 'tl',
  lat: 'la', epo: 'eo',
  // códigos antigos de 2 letras
  iw: 'he', in: 'id', ji: 'yi',
};

export function normalizeLang(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (ALIASES[raw]) return ALIASES[raw];
  // "pt-BR", "pt_br", "por-BR", "it-IT" → primeira subtag
  const primary = raw.split(/[-_]/)[0];
  if (ALIASES[primary]) return ALIASES[primary];
  if (/^[a-z]{2}$/.test(primary)) return primary;
  if (/^[a-z]{3}$/.test(primary)) return primary; // 639-2/3 desconhecido: repassa como está
  return null;
}

const NAMES = {
  pt: 'Portuguese (Brazilian)', it: 'Italian', en: 'English', es: 'Spanish', fr: 'French',
  de: 'German', nl: 'Dutch', ro: 'Romanian', pl: 'Polish', ru: 'Russian', ja: 'Japanese',
  zh: 'Chinese', ko: 'Korean', tr: 'Turkish', el: 'Greek', ca: 'Catalan', sv: 'Swedish',
};

export function langName(code) {
  return NAMES[code] ?? code;
}
