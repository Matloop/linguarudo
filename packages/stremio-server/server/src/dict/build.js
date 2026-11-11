// Monta o dicionário local de um idioma a partir do Wiktextract (Wiktionary em inglês, kaikki.org).
//
// Entrada: objetos JSON do Wiktextract, um por verbete (palavra + classe). Saída: um SQLite
// (node:sqlite, sem dependência) com só o que o cartão usa:
//   entry(id, word, key, pos, ipa, data)  data = JSON { s: [[glosa, tags]], f: [[tipo, alvo, nota]], g, n }
//     s: acepções "de verdade" (glosas em inglês, até MAX_SENSES)
//     f: remissões form_of/alt_of ("feminine singular of pulitissimo" → pulitissimo)
//     g: gênero do substantivo (masculine/feminine/neuter), n: tamanho da tabela de formas
//   form(key, entry, tags)   forma flexionada → verbete do lema (tabelas `forms` dos lemas)
//   meta(k, v)               schema, idioma, fonte, data de geração, contagens
// `key` = lemmaKey (NFC + minúsculas do idioma) com apóstrofo tipográfico trocado pelo reto.
import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { languageProfile } from '@linguetta/language';
import { dictKey } from './key.js';

export const DICT_SCHEMA = 1;
export const MAX_SENSES = 12;

// Classes que ninguém clica numa legenda.
const SKIP_POS = new Set(['character', 'symbol', 'punct', 'romanization', 'suffix', 'prefix', 'infix', 'interfix', 'affix', 'circumfix']);
// Linhas das tabelas `forms` que não são formas de verdade.
const SKIP_FORM_TAGS = new Set(['table-tags', 'inflection-template', 'class', 'romanization', 'auxiliary', 'obsolete', 'archaic', 'error-unrecognized-form']);
// Tags de acepção que valem mostrar ao lado da glosa.
const KEEP_SENSE_TAGS = new Set([
  'colloquial', 'informal', 'formal', 'slang', 'vulgar', 'derogatory', 'offensive', 'figuratively', 'literally', 'idiomatic',
  'archaic', 'obsolete', 'dated', 'rare', 'literary', 'poetic', 'regional', 'humorous', 'ironic', 'euphemistic',
  'transitive', 'intransitive', 'reflexive', 'pronominal', 'impersonal', 'auxiliary', 'uncountable', 'countable', 'plural',
]);
const GENDERS = ['masculine', 'feminine', 'neuter'];

const firstIpa = (sounds) => {
  if (!Array.isArray(sounds)) return '';
  const s = sounds.find((x) => typeof x?.ipa === 'string' && x.ipa && !(x.tags ?? []).length) ?? sounds.find((x) => typeof x?.ipa === 'string' && x.ipa);
  return s ? s.ipa.slice(0, 120) : '';
};

// Glosa da acepção: a última da lista (as anteriores repetem a acepção-mãe). Remissões
// ("inflection of fintare:", "third-person singular...") juntam todas.
const glossOf = (sense, join) => {
  const g = (Array.isArray(sense.glosses) ? sense.glosses : []).filter((x) => typeof x === 'string' && x.trim());
  if (!g.length) return '';
  return (join ? g.join(' ') : g[g.length - 1]).replace(/\s+/g, ' ').trim().slice(0, 300);
};

/** Reduz um objeto do Wiktextract ao que vai para o banco; null quando não serve. */
export function compactEntry(obj) {
  if (!obj || typeof obj.word !== 'string' || !obj.word.trim() || SKIP_POS.has(obj.pos)) return null;
  const word = obj.word.normalize('NFC').trim();
  const s = [];
  const f = [];
  let g = '';
  for (const sense of Array.isArray(obj.senses) ? obj.senses : []) {
    if (!sense || typeof sense !== 'object') continue;
    const tags = Array.isArray(sense.tags) ? sense.tags : [];
    if (!g) g = GENDERS.find((t) => tags.includes(t)) ?? '';
    const refs = [
      ...(Array.isArray(sense.form_of) ? sense.form_of.map((r) => ['form', r]) : []),
      ...(Array.isArray(sense.alt_of) ? sense.alt_of.map((r) => ['alt', r]) : []),
    ].filter(([, r]) => typeof r?.word === 'string' && r.word.trim());
    if (refs.length) {
      const note = glossOf(sense, true);
      for (const [kind, r] of refs) {
        const target = r.word.normalize('NFC').trim();
        if (target !== word && !f.some((x) => x[1] === target)) f.push([kind, target, note]);
      }
      continue;
    }
    if (tags.includes('no-gloss')) continue;
    const gloss = glossOf(sense, false);
    if (!gloss || s.some((x) => x[0] === gloss) || s.length >= MAX_SENSES) continue;
    s.push([gloss, tags.filter((t) => KEEP_SENSE_TAGS.has(t))]);
  }
  if (!s.length && !f.length) return null;
  const forms = [];
  if (s.length) {
    const multi = /\s/.test(word);
    for (const x of Array.isArray(obj.forms) ? obj.forms : []) {
      if (typeof x?.form !== 'string') continue;
      const form = x.form.normalize('NFC').trim();
      const tags = Array.isArray(x.tags) ? x.tags : [];
      if (!form || form === word || form === '-' || form.length > 60 || (!multi && /\s/.test(form))) continue;
      if (tags.some((t) => SKIP_FORM_TAGS.has(t))) continue;
      forms.push([form, tags.filter((t) => t !== 'canonical').join(' ')]);
    }
  }
  return { word, pos: typeof obj.pos === 'string' ? obj.pos : '', ipa: firstIpa(obj.sounds), s, f, g, forms };
}

/**
 * Grava o banco de `lang` em `file` (substitui o que houver) a partir de objetos do Wiktextract
 * (iterável síncrono ou assíncrono). Objetos com `lang_code` de outro idioma ficam de fora:
 * dá para alimentar com o dump completo (raw-wiktextract-data.jsonl).
 */
export async function buildDictionary(objects, { file, lang, source = '', onProgress } = {}) {
  const base = languageProfile(lang).base;
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE entry (id INTEGER PRIMARY KEY, word TEXT NOT NULL, key TEXT NOT NULL, pos TEXT NOT NULL, ipa TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE form (key TEXT NOT NULL, entry INTEGER NOT NULL, tags TEXT NOT NULL, PRIMARY KEY (key, entry)) WITHOUT ROWID;
  `);
  const insEntry = db.prepare('INSERT INTO entry (word, key, pos, ipa, data) VALUES (?, ?, ?, ?, ?)');
  const insForm = db.prepare('INSERT OR IGNORE INTO form (key, entry, tags) VALUES (?, ?, ?)');
  let seen = 0;
  let entries = 0;
  let forms = 0;
  db.exec('BEGIN');
  try {
    for await (const obj of objects) {
      seen++;
      if (onProgress && seen % 50000 === 0) onProgress({ seen, entries });
      if (obj?.lang_code && obj.lang_code !== base && obj.lang_code !== lang) continue;
      const e = compactEntry(obj);
      if (!e) continue;
      const data = { s: e.s, f: e.f };
      if (e.g) data.g = e.g;
      if (e.forms.length) data.n = e.forms.length;
      const { lastInsertRowid: id } = insEntry.run(e.word, dictKey(e.word, lang), e.pos, e.ipa, JSON.stringify(data));
      entries++;
      for (const [form, tags] of e.forms) forms += Number(insForm.run(dictKey(form, lang), id, tags).changes);
    }
    const meta = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
    const builtAt = new Date().toISOString();
    for (const [k, v] of Object.entries({ schema: DICT_SCHEMA, lang: base, source, builtAt, entries, forms })) meta.run(k, String(v));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.close();
    rmSync(file, { force: true });
    throw e;
  }
  db.exec('CREATE INDEX entry_key ON entry (key)');
  db.exec('VACUUM');
  db.close();
  return { seen, entries, forms };
}
