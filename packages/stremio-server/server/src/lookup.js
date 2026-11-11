// Modo "só língua-alvo": a legenda já está na língua que o usuário estuda.
//   POST /lookup    { lang, nativeLanguage, text, sentence, engine? }
//     → { lemma, reading, ipa, pos, meaning, translation, engine, found, senses, grammar, source }
//     engine "local" (padrão): dicionário local (Wiktionary, src/dict) para lema/IPA/classe/acepções
//     em inglês + OPUS-MT para o significado (tradução do lema) e a fala. Nunca chama a IA.
//     engine "ai": o provider, como antes (found: true, sem senses).
//   POST /translate { sourceLang, nativeLanguage, text, engine? } → { translation, engine }
//     engine "local" (padrão): OPUS-MT no próprio servidor (src/mt); sem rota local para o par
//     ou sem modelo instalado → 422 local_unavailable, e o cliente oferece a IA.
//     engine "ai": o provider (Claude / Claude Code / mock).
// Os dois ficam no cache em disco: a mesma fala/seleção não custa de novo.
import { lemmaKey } from '@linguetta/language';
import { HttpError } from './errors.js';
import { lookupKey } from './cache.js';
import { baseOf, cleanLemma, requireLanguage, sameLanguage } from './lang.js';

export const MAX_SELECTION = 80;
export const MAX_SENTENCE = 500;
export const ENGINES = ['local', 'ai'];

const clean = (v) => (typeof v === 'string' ? v.normalize('NFC').trim() : '');
const oneLine = (v) => clean(v).replace(/\s+/g, ' ');

function body(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'invalid_body', 'corpo deve ser um objeto JSON');
  return b;
}

function requireText(v, max, oneLineOnly) {
  const text = oneLineOnly ? oneLine(v) : clean(v);
  if (!text) throw new HttpError(400, 'empty_text', 'text vazio');
  if (text.length > max) throw new HttpError(400, 'text_too_long', `text com mais de ${max} caracteres`);
  return text;
}

function parseEngine(v) {
  const engine = v === undefined || v === null ? 'local' : v;
  if (!ENGINES.includes(engine)) throw new HttpError(400, 'invalid_engine', `engine deve ser ${ENGINES.map((e) => `"${e}"`).join(' ou ')}`);
  return engine;
}

export function parseLookupRequest(raw) {
  const b = body(raw);
  const lang = requireLanguage(b.lang, 'lang');
  const nativeLanguage = requireLanguage(b.nativeLanguage, 'nativeLanguage');
  const text = requireText(b.text, MAX_SELECTION, true);
  const sentence = clean(b.sentence).slice(0, MAX_SENTENCE);
  return { lang, nativeLanguage, text, sentence: sentence || text, engine: parseEngine(b.engine) };
}

export function parseTranslateRequest(raw) {
  const b = body(raw);
  const sourceLang = requireLanguage(b.sourceLang, 'sourceLang');
  const nativeLanguage = requireLanguage(b.nativeLanguage, 'nativeLanguage');
  const text = requireText(b.text, MAX_SENTENCE, false);
  return { sourceLang, nativeLanguage, text, engine: parseEngine(b.engine) };
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Limpa a resposta do provider. O lema mantém a caixa do dicionário ("Haus", "casa"); sem
 * lema, vale a seleção. Lema todo em maiúsculas desce para minúsculas só em escritas com caixa.
 */
export function validateLookup(text, raw, lang) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    lemma: cleanLemma(str(r.lemma, MAX_SELECTION) || text, lang, MAX_SELECTION),
    reading: str(r.reading, 120),
    ipa: str(r.ipa, 120),
    pos: str(r.pos, 60),
    meaning: str(r.meaning, 200),
    translation: str(r.translation, MAX_SENTENCE),
  };
}

function needs(provider, method) {
  if (typeof provider[method] !== 'function') throw new HttpError(501, 'not_supported', `provider ${provider.name} não suporta ${method}`);
}

async function cached(cache, key, compute) {
  const hit = cache ? await cache.get(key) : null;
  if (hit && typeof hit === 'object' && !Array.isArray(hit)) return { value: hit, cached: true };
  const value = await compute();
  if (cache) await cache.set(key, value).catch((e) => console.warn('[cache] falha ao gravar:', e.message));
  return { value, cached: false };
}

/**
 * Consulta da seleção. engine "local" (padrão): dicionário + tradutor locais; "ai": o provider.
 * dictionaries: openDictionaries() (src/dict/wiktionary.js) ou null; translator: OPUS-MT ou null.
 */
export async function lookup({ provider, translator = null, dictionaries = null, cache }, req) {
  const engine = req.engine ?? 'local';
  if (engine === 'local') return lookupLocal({ provider, translator, dictionaries, cache }, req);
  needs(provider, 'lookup');
  // A seleção entra pela lemmaKey: "Facevo" no começo da fala e "facevo" no meio dão o mesmo lema.
  // Chave "lookup" de antes: o cache da IA já gravado continua valendo.
  const key = lookupKey('lookup', provider.name, provider.model, [req.lang, req.nativeLanguage, lemmaKey(req.text, req.lang), req.sentence]);
  const out = await cached(cache, key, async () => validateLookup(req.text, await provider.lookup(req), req.lang));
  return { result: { ...out.value, engine: 'ai', found: true, senses: [], grammar: [], source: null }, cached: out.cached };
}

// Classe gramatical do Wiktionary (inglês) → rótulo curto. Português na nativa pt; senão o inglês.
// Por extenso: o cartão mostra só a classe, sem abreviação para decifrar.
const POS_PT = {
  noun: 'substantivo', verb: 'verbo', adj: 'adjetivo', adv: 'advérbio', pron: 'pronome', prep: 'preposição', conj: 'conjunção', intj: 'interjeição',
  article: 'artigo', det: 'determinante', num: 'numeral', name: 'nome próprio', contraction: 'contração', particle: 'partícula',
  phrase: 'expressão', proverb: 'provérbio', prep_phrase: 'locução prepositiva',
};
const POS_PT_MULTI = { verb: 'locução verbal', adv: 'locução adverbial', adj: 'locução adjetiva', noun: 'locução substantiva', prep: 'locução prepositiva', conj: 'locução conjuntiva' };
const GENDER_PT = { masculine: 'masculino', feminine: 'feminino', neuter: 'neutro' };
const GENDER_EN = { masculine: 'm.', feminine: 'f.', neuter: 'n.' };

export function posLabel({ pos, gender, lemma }, nativeLanguage) {
  if (!pos) return '';
  const multi = /\s/.test(lemma);
  if (baseOf(nativeLanguage) === 'pt') {
    const label = (multi ? POS_PT_MULTI[pos] : null) ?? POS_PT[pos] ?? pos;
    return pos === 'noun' && !multi && GENDER_PT[gender] ? `${label} ${GENDER_PT[gender]}` : label;
  }
  const label = pos.replace(/_/g, ' ');
  return pos === 'noun' && GENDER_EN[gender] ? `${label} ${GENDER_EN[gender]}` : label;
}

/**
 * Tradução de palavra solta pelo OPUS-MT: tira o ponto final que o modelo põe ("Limpeza.") e
 * a maiúscula inicial quando a palavra original é minúscula ("Fazer" → "fazer").
 */
export function tidyWordTranslation(source, out) {
  let t = String(out ?? '').trim();
  // o modelo às vezes abre com travessão ou marcador de lista ("- Boca a boca")
  if (!/^[-–—•]/.test(source)) t = t.replace(/^[-–—•]+\s*/u, '');
  if (!/[.!?…]$/.test(source)) t = t.replace(/[.!?…]+$/u, '').trim();
  const first = [...source][0] ?? '';
  if (first && first === first.toLowerCase() && first !== first.toUpperCase()) {
    const [c, ...rest] = [...t];
    if (c && rest.length && rest.join('') !== rest.join('').toUpperCase()) t = c.toLowerCase() + rest.join('');
  }
  return t.slice(0, 200);
}

// O MT não traduz pronome átono solto ("mi" → "mi"): o eco vira "sem significado" e o cartão
// fica com a classe, a fala traduzida e as acepções. Preposição/conjunção ecoam certo ("a", "e").
function echoedPronoun(entry, source, out) {
  const fold = (x) => String(x ?? '').toLocaleLowerCase().replace(/[\p{P}\s]+/gu, '');
  return entry.found && entry.pos === 'pron' && fold(source) === fold(out);
}

async function lookupLocal({ provider, translator, dictionaries, cache }, req) {
  const dict = dictionaries?.get(req.lang) ?? null;
  const mt = translator?.available && translator.route(req.lang, req.nativeLanguage) ? translator : null;
  const same = sameLanguage(req.lang, req.nativeLanguage);
  const mtModel = mt ? (mt.revision ? `${mt.model}@${mt.revision}` : mt.model) : same ? 'same' : 'none';
  const key = lookupKey('lookup-local', dict ? dict.version : 'none', mtModel, [req.lang, req.nativeLanguage, req.text, req.sentence]);
  const hit = cache ? await cache.get(key) : null;
  if (hit && typeof hit === 'object' && !Array.isArray(hit)) return { result: hit, cached: true };

  const entry = dict ? dict.lookup(req.text, req.sentence) : { found: false };
  const lemma = cleanLemma(entry.found ? entry.lemma : req.text, req.lang, MAX_SELECTION);
  // Significado = tradução do lema (forma de dicionário): "pulito" → "limpo", enquanto a forma
  // flexionada solta sai torta ("pulitissima" → "Limpeza."). Expressão achada: o verbete
  // ("fare finta"). Sem verbete: a própria seleção.
  const meaningSource = entry.found ? entry.headword : req.text;
  let failed = false;
  const mtText = async (text) => {
    if (same) return text;
    if (!mt) return '';
    try {
      return (await translate({ provider, translator: mt, cache }, { sourceLang: req.lang, nativeLanguage: req.nativeLanguage, text, engine: 'local' })).translation;
    } catch (e) {
      failed = true;
      console.warn(`[lookup] tradução local falhou: ${e.message}`);
      return '';
    }
  };
  const [meaning, translation] = await Promise.all([mtText(meaningSource), mtText(req.sentence)]);
  const result = {
    lemma,
    reading: '',
    ipa: str(entry.ipa, 120),
    pos: entry.found ? posLabel({ pos: entry.pos, gender: entry.gender, lemma }, req.nativeLanguage).slice(0, 60) : '',
    meaning: same ? '' : echoedPronoun(entry, meaningSource, meaning) ? '' : tidyWordTranslation(meaningSource, meaning),
    translation: str(translation, MAX_SENTENCE * 2),
    engine: 'local',
    found: Boolean(entry.found),
    senses: entry.found ? entry.senses.map((x) => str(x, 300)) : [],
    grammar: entry.found ? entry.grammar.map((x) => str(x, 200)) : [],
    source: entry.found ? { ...dict.source, url: entry.url } : null,
  };
  // Falha passageira do tradutor não fica gravada.
  if (cache && !failed) await cache.set(key, result).catch((e) => console.warn('[cache] falha ao gravar:', e.message));
  return { result, cached: false };
}

/**
 * Tradução da fala inteira para a língua nativa.
 * translator: tradutor local (src/mt/opus-mt.js) ou null; { name, model, revision?, available, route, translate }.
 */
export async function translate({ provider, translator = null, cache }, req) {
  const engine = req.engine ?? 'local';
  if (sameLanguage(req.sourceLang, req.nativeLanguage)) return { translation: req.text, engine, cached: false };
  const parts = [req.sourceLang, req.nativeLanguage, req.text];
  let key;
  let compute;
  if (engine === 'local') {
    if (!translator?.available || !translator.route(req.sourceLang, req.nativeLanguage)) {
      throw new HttpError(422, 'local_unavailable', `sem tradução local ${req.sourceLang}->${req.nativeLanguage}`);
    }
    const model = translator.revision ? `${translator.model}@${translator.revision}` : translator.model;
    key = lookupKey('translate-local', translator.name, model, parts);
    compute = async () => {
      try {
        return { translation: str(await translator.translate(req), MAX_SENTENCE * 2) };
      } catch (e) {
        throw new HttpError(500, 'local_error', `tradução local falhou: ${e.message}`);
      }
    };
  } else {
    needs(provider, 'translate');
    key = lookupKey('translate-ai', provider.name, provider.model, parts);
    compute = async () => ({ translation: str(await provider.translate(req), MAX_SENTENCE * 2) });
  }
  const out = await cached(cache, key, compute);
  return { translation: out.value.translation, engine, cached: out.cached };
}
