// Dicionário local do cartão de palavra: Wiktionary em inglês (Wiktextract / kaikki.org),
// um SQLite por idioma em <pasta>/<subtag base>.sqlite (scripts/setup-dict.sh). Idioma sem
// arquivo simplesmente não tem dicionário: o /lookup local devolve found: false.
//
// Resolução do lema de uma palavra:
//   1. verbetes com a mesma chave (dictKey) e linhas das tabelas de formas dos lemas;
//   2. caixa: no começo da frase "Pulitissima" vale como "pulitissima"; no meio, "Roma" prefere
//      o verbete com a mesma caixa;
//   3. verbete só de remissões (form_of/alt_of) segue a cadeia até um lema com acepções
//      ("pulitissima" → pulitissimo → pulito), guardando as notas; até MAX_DEPTH passos, sem ciclos;
//   4. entre os candidatos que sobram, vence a palavra que já é lema; depois o lema mais "rico"
//      (acepções + tamanho da tabela de formas), um indicador barato de frequência.
// Expressões: verbete exato; senão as combinações dos lemas de cada palavra ("facevo finta di"
// → "fare finta di"); senão um verbete de várias palavras dentro da seleção, com as palavras
// das pontas que já são lemas ("fare finta" + "di"); senão nada.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findWord, languageName, languageProfile, segmentWords } from '@linguetta/language';
import { DICT_SCHEMA } from './build.js';

// Versão da escolha de verbete (pontuação, acepções); entra na chave de cache do /lookup.
const RESOLVER_VERSION = 4;
import { dictKey } from './key.js';

export const MAX_DEPTH = 5;
const MAX_SENSES_OUT = 5;
const MAX_TOKENS = 6;
const MAX_LEMMAS_PER_TOKEN = 4;
const MAX_COMBOS = 64;
const LICENSE = 'CC BY-SA 4.0';

export function setupHint(dir) {
  return `dicionário local indisponível: nenhum <idioma>.sqlite em ${dir} (rode server/scripts/setup-dict.sh it)`;
}

/**
 * Abre os dicionários instalados em `dir` (um <base>.sqlite por idioma).
 *   get(lang) → dicionário ou null;  status() → { [base]: { entries, builtAt } }
 */
export function openDictionaries({ dir, log = console } = {}) {
  const byBase = new Map();
  const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => /^[a-z]{2,3}\.sqlite$/.test(f)) : [];
  for (const f of files) {
    try {
      const d = openDictionary(join(dir, f));
      byBase.set(d.lang, d);
    } catch (e) {
      log.warn?.(`[dict] ${f} ignorado: ${e.message}`);
    }
  }
  return {
    dir,
    get: (lang) => byBase.get(languageProfile(lang).base) ?? null,
    status: () => Object.fromEntries([...byBase].map(([base, d]) => [base, { entries: d.entries, builtAt: d.builtAt }])),
    reason: byBase.size ? null : setupHint(dir),
    close: () => byBase.forEach((d) => d.close()),
  };
}

/** Um dicionário (arquivo gerado por src/dict/build.js). */
export function openDictionary(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const meta = Object.fromEntries(db.prepare('SELECT k, v FROM meta').all().map((r) => [r.k, r.v]));
  if (Number(meta.schema) !== DICT_SCHEMA) {
    db.close();
    throw new Error(`schema ${meta.schema}, esperado ${DICT_SCHEMA} (rode o setup-dict.sh de novo)`);
  }
  const lang = meta.lang;
  const byKey = db.prepare('SELECT id, word, pos, ipa, data FROM entry WHERE key = ? ORDER BY id');
  const byForm = db.prepare('SELECT e.id, e.word, e.pos, e.ipa, e.data, f.tags FROM form f JOIN entry e ON e.id = f.entry WHERE f.key = ? ORDER BY e.id');
  const parse = (row, via) => ({ id: row.id, word: row.word, pos: row.pos, ipa: row.ipa, ...JSON.parse(row.data), via, formTags: row.tags ?? '' });

  // Verbetes com a chave: os do próprio título primeiro, depois as tabelas de formas.
  const entriesFor = (key) => {
    const head = byKey.all(key).map((r) => parse(r, 'head'));
    const seen = new Set(head.map((e) => e.id));
    const forms = byForm.all(key).filter((r) => !seen.has(r.id)).map((r) => parse(r, 'form'));
    return [...head, ...forms];
  };
  const isLemma = (e) => e.s.length > 0;
  const weight = (e) => Math.min(e.s.length, 10) + Math.min((e.n ?? 0) / 20, 5);
  // Classes fechadas (pronome, artigo, preposição...) são muito mais frequentes na fala que o
  // homógrafo raro: "mi" é "me", não a nota musical; "ci" é "nos/lá", não a família de línguas.
  const CLOSED_POS = new Set(['pron', 'article', 'det', 'prep', 'conj', 'particle', 'contraction', 'prep_phrase']);

  // Alvo da remissão; o Wiktextract às vezes junta lixo ("avere and", "il/lo"): cai na primeira palavra.
  function targetEntries(target) {
    const rows = byKey.all(dictKey(target, lang));
    if (rows.length) return rows.map((r) => parse(r, 'head'));
    const first = target.split(/\s+(?:and|or)\b|[/,;]/)[0].trim();
    const head = first && first !== target ? byKey.all(dictKey(first, lang)) : [];
    return head.map((r) => parse(r, 'head'));
  }

  // Segue form_of/alt_of até um verbete com acepções. Sem saída: fica no próprio verbete.
  function chain(entry, notes = [], seen = new Set()) {
    seen.add(entry.id);
    if (isLemma(entry) || notes.length >= MAX_DEPTH) return { entry, notes };
    for (const [, target, note] of entry.f) {
      const cands = targetEntries(target).filter((e) => !seen.has(e.id));
      if (!cands.length) continue;
      // mesma caixa do alvo e mesma classe primeiro
      cands.sort((a, b) => (b.word === target) - (a.word === target) || (b.pos === entry.pos) - (a.pos === entry.pos) || weight(b) - weight(a));
      for (const next of cands) {
        const r = chain(next, [...notes, note], seen);
        if (isLemma(r.entry)) return r;
      }
    }
    return { entry, notes };
  }

  const viaNote = (e) => (e.via === 'form' ? [`${e.formTags || 'form'} of ${e.word}`.trim()] : []);

  /**
   * Candidatos resolvidos de uma palavra ou expressão exata, do melhor para o pior.
   * initial: a seleção abre a frase (a maiúscula pode ser só de começo de frase).
   */
  function resolve(surface, { initial = false, context = null } = {}) {
    const cands = entriesFor(dictKey(surface, lang));
    if (!cands.length) return [];
    const lower = dictKey(surface, lang);
    const resolved = cands.map((e) => {
      const r = e.via === 'form' ? { entry: e, notes: viaNote(e) } : chain(e);
      const exactCase = e.word === surface;
      const lowerCase = e.word === lower;
      let score = 0;
      // No começo da frase a maiúscula não decide: "Pulitissima" = "pulitissima", "Roma" segue Roma.
      if (exactCase || (initial && lowerCase)) score += 100;
      else if (lowerCase) score += 50;
      if (e.pos === 'name' && !exactCase) score -= 60;
      if (e.via === 'head') score += 10;
      if (CLOSED_POS.has(e.pos)) score += 15;
      if (isLemma(e)) score += 5; // a palavra já é lema ("finta" substantivo), mas o verbo rico ainda pode vencer
      if (!isLemma(r.entry)) score -= 30; // remissão sem saída
      // Contexto: depois de artigo/determinante, nome ou adjetivo ("la porta"); depois de verbo, particípio ("ha detto").
      if (context === 'nominal' && ['noun', 'adj', 'name'].includes(e.pos)) score += 25;
      if (context === 'verbal' && r.notes.some((n) => /participle/i.test(n))) score += 25;
      score += weight(r.entry);
      return { ...r, from: e, score };
    });
    return resolved.sort((a, b) => b.score - a.score);
  }

  /** Lemas possíveis de uma palavra (texto), melhor primeiro, incluindo a própria palavra quando ela é lema. */
  function lemmasOf(surface, initial) {
    const out = [];
    for (const r of resolve(surface, { initial })) if (isLemma(r.entry) && !out.includes(r.entry.word)) out.push(r.entry.word);
    return out.slice(0, MAX_LEMMAS_PER_TOKEN);
  }

  // Combinações dos lemas de cada palavra (produto em ordem de preferência, limitado).
  function* combos(lists, i = 0, acc = []) {
    if (i === lists.length) {
      yield acc;
      return;
    }
    for (const x of lists[i]) yield* combos(lists, i + 1, [...acc, x]);
  }
  const joinTokens = (tokens, words) => tokens.map((t, i) => words[i] + t.sep).join('').trim();

  function firstEntry(tokens, lists) {
    let n = 0;
    for (const words of combos(lists)) {
      if (++n > MAX_COMBOS) break;
      const text = joinTokens(tokens, words);
      const hit = resolve(text).find((r) => isLemma(r.entry));
      if (hit) return { hit, words };
    }
    return null;
  }

  function lookupExpression(text, tokens, initial) {
    const exact = resolve(text, { initial }).find((r) => isLemma(r.entry));
    if (exact) return result(exact);
    if (tokens.length > MAX_TOKENS) return null;
    const lists = tokens.map((t, i) => {
      const own = lemmasOf(t.text, initial && i === 0);
      const surface = initial && i === 0 ? dictKey(t.text, lang) : t.text;
      return own.length ? own : [surface];
    });
    const whole = firstEntry(tokens, lists);
    if (whole) return result(whole.hit, { notes: [] });
    // Verbete de várias palavras dentro da seleção; as pontas que sobram precisam ser lemas.
    for (let len = tokens.length - 1; len >= 2; len--) {
      for (let start = 0; start + len <= tokens.length; start++) {
        const rest = [...tokens.slice(0, start), ...tokens.slice(start + len)];
        const restOk = rest.every((t) => resolve(t.text).some((r) => r.from.via === 'head' && isLemma(r.from)));
        if (!restOk) continue;
        const span = tokens.slice(start, start + len);
        const inner = firstEntry(span.map((t, i) => (i === len - 1 ? { ...t, sep: '' } : t)), lists.slice(start, start + len));
        if (!inner) continue;
        const words = tokens.map((t, i) => {
          if (i < start || i >= start + len) return dictKey(t.text, lang);
          return i === start ? inner.hit.entry.word : null;
        });
        const lemma = tokens
          .map((t, i) => (words[i] === null ? '' : words[i] + (i === start ? (tokens[start + len - 1]?.sep ?? '') : t.sep)))
          .join('')
          .trim();
        return result(inner.hit, { lemma, notes: [] });
      }
    }
    return null;
  }

  // Classe da palavra anterior na fala: 'nominal' (artigo/determinante), 'verbal' (verbo) ou null.
  function contextOf(text, sentence) {
    const at = sentence ? findWord(sentence, text, lang) : null;
    if (!at) return null;
    const prev = segmentWords(sentence.slice(0, at.index), lang).filter((x) => x.isWord).pop();
    if (!prev || !/^[\s']*$/u.test(sentence.slice(prev.index + prev.segment.length, at.index))) return null;
    const cands = resolve(prev.segment);
    if (!cands.length) return null;
    // "la" também é nota musical e pronome: basta um dos verbetes ser artigo/determinante.
    // Determinante só quando é a leitura principal: "che" é antes conjunção/pronome ("che ci fai").
    if (cands.some((c) => c.from.pos === 'article' || c.entry.pos === 'article') || cands[0].from.pos === 'det') return 'nominal';
    const best = cands[0];
    if (best.from.pos === 'adj') return 'nominal'; // "una nuova era"
    return best.from.pos === 'verb' || best.entry.pos === 'verb' ? 'verbal' : null;
  }

  function result(r, { lemma, notes } = {}) {
    const e = r.entry;
    return {
      found: true,
      lemma: lemma ?? e.word,
      headword: e.word,
      pos: e.pos,
      gender: e.g ?? '',
      ipa: lemma && lemma !== e.word ? '' : e.ipa,
      // Remissão sem saída: as próprias notas fazem as vezes de acepção.
      // Pronome átono: as remissões ("clitic accusative of io. me") dizem mais que a acepção própria.
      senses: [
        ...(e.s.length === 0 || CLOSED_POS.has(e.pos) ? e.f.filter((x) => x[0] === 'form').map((x) => x[2]) : []),
        ...e.s.map(([g, tags]) => (tags.length ? `(${tags.join(', ')}) ${g}` : g)),
        ...(e.s.length === 0 ? e.f.filter((x) => x[0] !== 'form').map((x) => x[2]) : []),
      ].filter(Boolean).slice(0, MAX_SENSES_OUT),
      grammar: notes ?? r.notes,
      url: `https://en.wiktionary.org/wiki/${encodeURIComponent(e.word.replace(/ /g, '_'))}#${encodeURIComponent(languageName(lang, 'en').replace(/ /g, '_'))}`,
    };
  }

  /**
   * Procura a seleção (palavra ou expressão) vista em `sentence`.
   * → { found: true, lemma, headword, pos, gender, ipa, senses, grammar, url } | { found: false }
   */
  function lookup(text, sentence = '') {
    const clean = String(text).normalize('NFC').replace(/[’ʼ′]/g, "'").trim().replace(/\s+/g, ' ');
    if (!clean) return { found: false };
    const tokens = tokenize(clean, lang);
    if (!tokens.length) return { found: false };
    const sent = String(sentence).normalize('NFC').replace(/[’ʼ′]/g, "'");
    const initial = startsSentence(clean, sent, lang);
    if (tokens.length === 1) {
      // A seleção inteira primeiro: "l'" e "dell'" são verbetes com o apóstrofo.
      const best = resolve(clean, { initial, context: contextOf(clean, sent) })[0] ?? resolve(tokens[0].text, { initial })[0];
      return best ? result(best) : { found: false };
    }
    return lookupExpression(clean, tokens, initial) ?? { found: false };
  }

  return {
    lang,
    entries: Number(meta.entries) || 0,
    builtAt: meta.builtAt ?? '',
    version: `${DICT_SCHEMA}:${RESOLVER_VERSION}:${meta.builtAt ?? ''}`,
    source: { name: 'Wiktionary', license: LICENSE, via: 'kaikki.org (Wiktextract)' },
    lookup,
    resolve,
    close: () => db.isOpen && db.close(),
  };
}

/** Palavras da seleção (segmentador do idioma) com o separador que vem depois de cada uma. */
export function tokenize(text, lang) {
  const segs = segmentWords(text, lang);
  const out = [];
  for (const s of segs) {
    if (s.isWord) out.push({ text: s.segment, sep: '' });
    else if (out.length) out[out.length - 1].sep += /\s/.test(s.segment) ? ' ' : s.segment.trim() ? s.segment : '';
  }
  for (const t of out) t.sep = t.sep.replace(/\s+/g, ' ');
  // elisão: "l'" + "amico" sem espaço entre os dois
  return out.map((t, i) => (i === out.length - 1 ? { ...t, sep: '' } : t));
}

/**
 * A seleção abre a frase? Começo da fala ou depois de . ! ? … : « " — e quebra de linha.
 * Fora da fala (não achou), vale como começo: maiúscula aí não prova nome próprio.
 */
export function startsSentence(text, sentence, lang) {
  if (!sentence) return true;
  const at = findWord(sentence, text, lang);
  if (!at) return true;
  const before = sentence.slice(0, at.index);
  return /(^|[.!?…:;«"“\-—–\n]|\s\/)\s*$/u.test(before) || /^[\s\p{P}]*$/u.test(before);
}
