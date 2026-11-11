#!/usr/bin/env node
// Gera <pasta>/<idioma>.sqlite a partir de um JSONL do Wiktextract (.jsonl ou .jsonl.gz).
//   node scripts/build-dict.js <lang> <arquivo.jsonl[.gz]> <pasta> [fonte]
// Chamado pelo setup-dict.sh; dá para rodar à mão com um arquivo já baixado.
import { createReadStream, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { canonicalLanguage, languageProfile } from '@linguetta/language';
import { buildDictionary } from '../src/dict/build.js';

const [langArg, input, dir, source = ''] = process.argv.slice(2);
const tag = canonicalLanguage(langArg ?? '');
if (!tag || !input || !dir) {
  console.error('uso: node scripts/build-dict.js <lang> <arquivo.jsonl[.gz]> <pasta> [fonte]');
  process.exit(2);
}
const base = languageProfile(tag).base;

async function* objects(file) {
  let stream = createReadStream(file);
  if (file.endsWith('.gz')) stream = stream.pipe(createGunzip());
  let bad = 0;
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      if (++bad <= 3) console.warn('[build-dict] linha inválida ignorada');
    }
  }
}

mkdirSync(dir, { recursive: true });
const out = join(dir, `${base}.sqlite`);
const tmp = `${out}.building`;
const t0 = performance.now();
const r = await buildDictionary(objects(input), {
  file: tmp,
  lang: base,
  source,
  onProgress: ({ seen, entries }) => process.stderr.write(`\r[build-dict] ${seen} linhas lidas, ${entries} verbetes`),
});
renameSync(tmp, out);
process.stderr.write('\n');
const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`[build-dict] ${out}: ${r.entries} verbetes, ${r.forms} formas, ${mb} MB em ${((performance.now() - t0) / 1000).toFixed(1)} s`);
