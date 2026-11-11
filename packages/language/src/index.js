// Idiomas como tags BCP 47 canônicas (ADR 0004): canonização, perfil do idioma,
// nomes, chave de lema e segmentação de palavras. JS puro com JSDoc, sem build,
// para que a web (TS) e o stremio-server (Node) importem o mesmo código.
//
// Sobre os motores: V8 (Node, Chrome) e JavaScriptCore (Bun, Safari) não concordam
// em tudo. O JSC não canoniza códigos ISO 639-2/B (ger, fre, chi) nem cmn/sh, erra a
// direção de `dv` em getTextInfo(), maximiza `grc` para a escrita cipriota e põe
// maiúscula em DisplayNames ('Italiano' contra 'italiano' do V8). Por isso
// os apelidos, as escritas RTL e as exceções de escrita ficam em tabelas aqui.

/**
 * @typedef {{
 *   tag: string,
 *   base: string,
 *   script: string,
 *   dir: 'ltr' | 'rtl',
 *   spaces: boolean,
 *   cased: boolean,
 *   elision: boolean,
 *   wordlist: boolean,
 * }} LanguageProfile
 * @typedef {{ segment: string, index: number, isWord: boolean }} WordSegment
 * @typedef {{ tag: string, name: string, endonym: string }} LanguageOption
 */

// ---------------------------------------------------------------- formato

/**
 * Regex permissiva de boa formação BCP 47, com teto de 35 caracteres. Mais estrita que a
 * RFC 5646 só em não aceitar subtag de idioma com 5 a 8 letras (reservada, e assim
 * "italian" não passa por código), tags grandfathered nem tag só de uso privado. Fonte compatível com JS e com o `~` do Postgres.
 */
export const LANGUAGE_TAG_RE =
  '^(?=.{2,35}$)[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}' +
  '(?:-[A-Za-z]{4})?' +
  '(?:-(?:[A-Za-z]{2}|[0-9]{3}))?' +
  '(?:-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*' +
  '(?:-[0-9A-WYZa-wyz](?:-[A-Za-z0-9]{2,8})+)*' +
  '(?:-[Xx](?:-[A-Za-z0-9]{1,8})+)?$';

const TAG_RE = new RegExp(LANGUAGE_TAG_RE);

/**
 * Confere só o formato (não canoniza nem verifica se o idioma existe).
 * @param {unknown} s
 * @returns {s is string}
 */
export function isLanguageTag(s) {
  return typeof s === 'string' && TAG_RE.test(s);
}

// ---------------------------------------------------------------- canonização

// Entrada inteira → tag. Códigos do OpenSubtitles e apelidos que levam escrita/região.
/** @type {Record<string, string>} */
const TAG_ALIASES = {
  pob: 'pt-BR', // português do Brasil (OpenSubtitles)
  pb: 'pt-BR',
  zht: 'zh-Hant', // chinês tradicional (OpenSubtitles)
  zhe: 'zh', // chinês bilíngue (OpenSubtitles): sem escrita definida
  sh: 'sr-Latn', // servo-croata (o V8 já faz isso; o JSC não)
  tl: 'fil', // tagalo: o V8 canoniza para fil, o JSC não
};

// Primeira subtag → idioma base. ISO 639-2/B e /T e códigos antigos. O V8 canoniza
// boa parte deles sozinho, o JSC não; a tabela deixa os dois motores iguais.
/** @type {Record<string, string>} */
const LANGUAGE_ALIASES = {
  por: 'pt', ita: 'it', eng: 'en',
  spa: 'es', spl: 'es', spn: 'es',
  fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', nld: 'nl', dut: 'nl',
  cat: 'ca', glg: 'gl', eus: 'eu', baq: 'eu',
  ron: 'ro', rum: 'ro', pol: 'pl', ces: 'cs', cze: 'cs', slk: 'sk', slo: 'sk',
  hun: 'hu', fin: 'fi', swe: 'sv', nor: 'no', nob: 'nb', nno: 'nn', dan: 'da', isl: 'is', ice: 'is',
  ell: 'el', gre: 'el', tur: 'tr', rus: 'ru', ukr: 'uk', bul: 'bg', srp: 'sr', hrv: 'hr', scc: 'sr', scr: 'hr',
  slv: 'sl', bos: 'bs', mkd: 'mk', mac: 'mk', sqi: 'sq', alb: 'sq', lit: 'lt', lav: 'lv', est: 'et',
  ara: 'ar', heb: 'he', fas: 'fa', per: 'fa', hin: 'hi', ben: 'bn', urd: 'ur',
  zho: 'zh', chi: 'zh', cmn: 'zh', jpn: 'ja', kor: 'ko', tha: 'th', vie: 'vi',
  ind: 'id', msa: 'ms', may: 'ms', tgl: 'fil',
  lat: 'la', epo: 'eo', cym: 'cy', wel: 'cy', gle: 'ga', hye: 'hy', arm: 'hy', kat: 'ka', geo: 'ka',
  iw: 'he', in: 'id', ji: 'yi', jw: 'jv', mo: 'ro',
};

/**
 * Normaliza um código de idioma para a tag BCP 47 canônica, ou null se inválido.
 * Aceita códigos ISO 639-1/2/3, tags BCP 47 em qualquer caixa, `_` no lugar de `-` e
 * os códigos do OpenSubtitles (pob, zht, zhe). Não aceita nomes ("português").
 * Escrita e região são preservadas: 'zh-Hant' continua 'zh-Hant'.
 * @param {unknown} input
 * @returns {string | null}
 */
export function canonicalLanguage(input) {
  if (typeof input !== 'string') return null;
  let raw = input.trim().replace(/_/g, '-');
  if (!raw || raw.length > 35) return null;
  const lower = raw.toLowerCase();
  if (TAG_ALIASES[lower]) {
    raw = TAG_ALIASES[lower];
  } else {
    const dash = raw.indexOf('-');
    const primary = (dash < 0 ? raw : raw.slice(0, dash)).toLowerCase();
    const alias = LANGUAGE_ALIASES[primary];
    if (alias) raw = alias + (dash < 0 ? '' : raw.slice(dash));
  }
  let tag;
  try {
    [tag] = Intl.getCanonicalLocales(raw);
  } catch {
    return null;
  }
  if (!tag || !TAG_RE.test(tag)) return null;
  const base = tag.split('-')[0];
  if (base === 'und') return null;
  return tag;
}

// ---------------------------------------------------------------- perfil

const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Thaa', 'Syrc', 'Nkoo', 'Adlm', 'Rohg', 'Mand', 'Samr']);
// Escritas cujas palavras não são separadas por espaço (o coreano usa espaço).
const NO_SPACE_SCRIPTS = new Set(['Hani', 'Hans', 'Hant', 'Jpan', 'Hira', 'Kana', 'Thai', 'Laoo', 'Khmr', 'Mymr', 'Tibt']);
// Escritas com maiúsculas e minúsculas. O georgiano (mtavruli) fica de fora.
const CASED_SCRIPTS = new Set(['Latn', 'Cyrl', 'Grek', 'Armn', 'Cher', 'Adlm', 'Copt', 'Glag', 'Dsrt', 'Osge']);
// Exceções ao maximize(): o JSC devolve Cprt para grc.
/** @type {Record<string, string>} */
const SCRIPT_OVERRIDES = { grc: 'Grek' };
// Clíticos elididos com apóstrofo. `true` = todo apóstrofo interno é elisão.
/** @type {Record<string, true | Set<string>>} */
const ELISION = {
  it: true,
  fr: new Set(['l', 'd', 'j', 'm', 'n', 's', 't', 'c', 'qu', 'jusqu', 'lorsqu', 'puisqu', 'quoiqu', 'quelqu']),
  ca: new Set(['l', 'd', 's', 'm', 't', 'n']),
  oc: new Set(['l', 'd', 's', 'm', 't', 'n', 'qu']),
};
// Idiomas com wordlist de frequência para o jogo de música.
const WORDLISTS = new Set(['en', 'it']);

/** @type {Map<string, LanguageProfile>} */
const profiles = new Map();

/**
 * Perfil do idioma: escrita, direção, uso de espaços, caixa, elisão e wordlist.
 * Tags inválidas recebem um perfil neutro (ltr, com espaços, escrita 'Zzzz').
 * @param {string} tag
 * @returns {LanguageProfile}
 */
export function languageProfile(tag) {
  const cached = profiles.get(tag);
  if (cached) return cached;
  const canonical = canonicalLanguage(tag);
  /** @type {Intl.Locale | null} */
  let locale = null;
  try {
    if (canonical) locale = new Intl.Locale(canonical);
  } catch {
    locale = null;
  }
  const base = locale?.language ?? (canonical ?? String(tag)).split('-')[0].toLowerCase();
  let script = locale?.script ?? SCRIPT_OVERRIDES[base];
  if (!script && locale) {
    try {
      script = locale.maximize().script;
    } catch {
      script = undefined;
    }
  }
  script ??= 'Zzzz';
  const profile = Object.freeze({
    tag: canonical ?? String(tag),
    base,
    script,
    dir: RTL_SCRIPTS.has(script) || (script === 'Zzzz' && textDirection(locale) === 'rtl') ? 'rtl' : 'ltr',
    spaces: !NO_SPACE_SCRIPTS.has(script),
    cased: CASED_SCRIPTS.has(script),
    elision: base in ELISION,
    wordlist: WORDLISTS.has(base),
  });
  profiles.set(tag, /** @type {LanguageProfile} */ (profile));
  return /** @type {LanguageProfile} */ (profile);
}

// Só consultado quando a escrita é desconhecida: getTextInfo() varia entre motores.
/** @param {Intl.Locale | null} locale */
function textDirection(locale) {
  if (!locale) return undefined;
  /** @type {any} */
  const l = locale;
  try {
    return (typeof l.getTextInfo === 'function' ? l.getTextInfo() : l.textInfo)?.direction;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- nomes

/** @type {Map<string, Intl.DisplayNames | null>} */
const displayNames = new Map();

/** @param {string} locale */
function namesFor(locale) {
  if (!displayNames.has(locale)) {
    let dn = null;
    // Locale de exibição inválido cai no inglês.
    for (const locales of [[locale, 'en'], ['en']]) {
      try {
        dn = new Intl.DisplayNames(locales, { type: 'language', fallback: 'none' });
        break;
      } catch {
        dn = null;
      }
    }
    displayNames.set(locale, dn);
  }
  return displayNames.get(locale) ?? null;
}

/** @param {string} tag @param {string} displayLocale */
function nameOrNull(tag, displayLocale) {
  try {
    return namesFor(displayLocale)?.of(tag) ?? null;
  } catch {
    return null;
  }
}

/**
 * Nome do idioma no idioma da interface ('it', 'pt' → 'italiano'); cai na própria tag.
 * A caixa da inicial depende do motor (o JSC devolve 'Italiano').
 * @param {string} tag
 * @param {string} displayLocale
 * @returns {string}
 */
export function languageName(tag, displayLocale) {
  return nameOrNull(tag, displayLocale) ?? tag;
}

/**
 * Nome do idioma nele mesmo ('de' → 'Deutsch'); cai na própria tag.
 * @param {string} tag
 * @returns {string}
 */
export function languageEndonym(tag) {
  return nameOrNull(tag, tag) ?? tag;
}

// ISO 639-1 vigentes, mais alguns ISO 639-3 comuns entre estudantes.
const KNOWN_LANGUAGES = (
  'aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy ' +
  'da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu ' +
  'hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb ' +
  'lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om ' +
  'or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ' +
  'ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu ' +
  'ast ceb ckb fil fur grc gsw haw hmn lad lij nap nds scn sco tet vec yue'
).split(' ');

// Itens de menu começam com maiúscula, igual nos dois motores.
/** @param {string} s @param {string} locale */
function capitalize(s, locale) {
  const first = String.fromCodePoint(/** @type {number} */ (s.codePointAt(0)));
  let upper;
  try {
    upper = first.toLocaleUpperCase(locale);
  } catch {
    upper = first.toUpperCase();
  }
  return upper + s.slice(first.length);
}

/** @type {Map<string, LanguageOption[]>} */
const lists = new Map();

/**
 * Idiomas base conhecidos para o seletor, com nome no idioma da interface e endônimo
 * (ambos com inicial maiúscula), em ordem alfabética do nome. Só entram os que o Intl sabe nomear.
 * @param {string} displayLocale
 * @returns {LanguageOption[]}
 */
export function listLanguages(displayLocale) {
  const cached = lists.get(displayLocale);
  if (cached) return cached.map((o) => ({ ...o }));
  /** @type {Map<string, LanguageOption>} */
  const byTag = new Map();
  for (const code of KNOWN_LANGUAGES) {
    const tag = canonicalLanguage(code);
    if (!tag || byTag.has(tag)) continue;
    const name = nameOrNull(tag, displayLocale);
    if (!name || name === tag) continue;
    byTag.set(tag, { tag, name: capitalize(name, displayLocale), endonym: capitalize(languageEndonym(tag), tag) });
  }
  let collator;
  try {
    collator = new Intl.Collator(displayLocale);
  } catch {
    collator = new Intl.Collator();
  }
  const list = [...byTag.values()].sort((a, b) => collator.compare(a.name, b.name));
  lists.set(displayLocale, list);
  return list.map((o) => ({ ...o }));
}

// ---------------------------------------------------------------- lema

/** @param {string} s @param {string} tag */
function lowerFor(s, tag) {
  const { base } = languageProfile(tag);
  try {
    return s.toLocaleLowerCase(base);
  } catch {
    return s.toLowerCase();
  }
}

/**
 * Chave de unicidade do lema: NFC e minúsculas conforme o idioma ('İstanbul', 'tr' →
 * 'istanbul'). Acentos continuam distinguindo. Pelo ADR 0004 só o servidor calcula a
 * `lemma_key` que vai para o banco; os clientes recebem o valor pronto no pull.
 * @param {string} lemma
 * @param {string} tag
 * @returns {string}
 */
export function lemmaKey(lemma, tag) {
  return lowerFor(String(lemma).normalize('NFC'), tag);
}

// ---------------------------------------------------------------- segmentação

/** @type {Map<string, Intl.Segmenter>} */
const segmenters = new Map();

/** @param {string} tag */
function segmenterFor(tag) {
  let s = segmenters.get(tag);
  if (!s) {
    try {
      s = new Intl.Segmenter(tag, { granularity: 'word' });
    } catch {
      s = new Intl.Segmenter(undefined, { granularity: 'word' });
    }
    segmenters.set(tag, s);
  }
  return s;
}

const HYPHENS = new Set(['-', '‐', '‑']);
const ELIDED_RE = /^([\p{L}\p{M}]+)(['’])(?=[\p{L}\p{M}\p{N}])/u;

/**
 * Divide o texto em segmentos (palavras e separadores) sem perder caracteres: juntar
 * todos os `segment` devolve o texto. Usa Intl.Segmenter, com dois ajustes:
 * - em idiomas com espaço, palavras ligadas por hífen ficam juntas ("guarda-chuva");
 * - em idiomas com elisão (it, fr, ca, oc), o clítico vira palavra própria com o
 *   apóstrofo: "l'amico" → "l'" + "amico". "aujourd'hui" continua inteiro.
 * @param {string} text
 * @param {string} tag
 * @returns {WordSegment[]}
 */
export function segmentWords(text, tag) {
  const str = String(text);
  const profile = languageProfile(tag);
  /** @type {WordSegment[]} */
  const raw = [];
  for (const s of segmenterFor(profile.tag).segment(str)) {
    raw.push({ segment: s.segment, index: s.index, isWord: Boolean(s.isWordLike) });
  }

  /** @type {WordSegment[]} */
  let out = raw;
  if (profile.spaces) {
    out = [];
    for (let i = 0; i < raw.length; i++) {
      const cur = raw[i];
      const prev = out[out.length - 1];
      const next = raw[i + 1];
      if (!cur.isWord && HYPHENS.has(cur.segment) && prev?.isWord && next?.isWord) {
        prev.segment += cur.segment + next.segment;
        i++;
        continue;
      }
      out.push({ ...cur });
    }
  }

  const rule = ELISION[profile.base];
  if (!rule) return out;
  /** @type {WordSegment[]} */
  const split = [];
  for (const seg of out) {
    if (!seg.isWord) {
      split.push(seg);
      continue;
    }
    let { segment, index } = seg;
    for (let m = ELIDED_RE.exec(segment); m; m = ELIDED_RE.exec(segment)) {
      if (rule !== true && !rule.has(lowerFor(m[1], profile.tag))) break;
      const head = m[1] + m[2];
      split.push({ segment: head, index, isWord: true });
      segment = segment.slice(head.length);
      index += head.length;
    }
    split.push({ segment, index, isWord: true });
  }
  return split;
}

/**
 * Número de palavras (segmentos de palavra) do texto.
 * @param {string} text
 * @param {string} tag
 * @returns {number}
 */
export function countWords(text, tag) {
  let n = 0;
  for (const s of segmentWords(text, tag)) if (s.isWord) n++;
  return n;
}

/** @param {string} s */
function squash(s) {
  return s.normalize('NFC').replace(/\s+/gu, ' ');
}

/**
 * Procura `word` (palavra ou expressão) como trecho inteiro de `text`: o trecho começa
 * no início de uma palavra e termina no fim de uma palavra, pelas fronteiras de
 * segmentWords. Espaços em qualquer quantidade casam entre si, e NFC/NFD são
 * equivalentes. Tenta antes a caixa exata e depois, em escritas com caixa, sem
 * diferenciar maiúsculas (pela regra do idioma). Acentos sempre distinguem: "para"
 * não casa com "pará". Em idiomas sem espaço (ja, zh, th), se nenhuma fronteira
 * casar, cai para a primeira ocorrência como substring.
 * @param {string} text
 * @param {string} word
 * @param {string} tag
 * @returns {{ index: number, length: number } | null}
 */
export function findWord(text, word, tag) {
  if (typeof text !== 'string' || typeof word !== 'string') return null;
  const needle = squash(word.trim());
  if (!needle) return null;
  const profile = languageProfile(tag);
  const segs = segmentWords(text, profile.tag);
  /** @type {number[]} */
  const ends = [];
  for (const s of segs) if (s.isWord) ends.push(s.index + s.segment.length);
  // Folga para NFD (marcas combinantes) e espaços repetidos no texto.
  const maxLen = needle.length * 3 + 8;

  /** @param {(s: string) => string} fold */
  const scan = (fold) => {
    const target = fold(needle);
    for (const s of segs) {
      if (!s.isWord) continue;
      for (const end of ends) {
        if (end <= s.index) continue;
        if (end - s.index > maxLen) break;
        if (fold(squash(text.slice(s.index, end))) === target) {
          return { index: s.index, length: end - s.index };
        }
      }
    }
    return null;
  };

  /** @param {string} s */
  const caseless = (s) => lowerFor(s, profile.tag).replace(/’/g, "'");
  const found = scan((s) => s) ?? (profile.cased ? scan(caseless) : null);
  if (found || profile.spaces) return found;

  // Sem espaços: a segmentação do ICU pode não coincidir com a palavra procurada.
  const nfc = text.normalize('NFC');
  if (nfc.length !== text.length) return null; // índices não mapeariam de volta
  const at = nfc.indexOf(needle);
  return at < 0 ? null : { index: at, length: needle.length };
}
