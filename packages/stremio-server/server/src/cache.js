import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Chave das candidatas do Blend: provider/modelo/idiomas (incl. nativa)/pedido/preferências e os
 * textos (não os ids). `request` é o que muda a resposta do motor: a cobertura (wordCoverage) pedida à IA; null no
 * motor local, que devolve as mesmas candidatas para qualquer cobertura.
 */
export function cacheKey({ provider, model, sourceLang, targetLang, nativeLanguage, request = null, texts, preferWords = [] }) {
  // v6: cobertura por parte das palavras (wordCoverage); até 12 candidatas por fala.
  // v5: translatedLine (a fala inteira na língua-alvo) no lugar do exemplo inventado.
  // v4: candidatas antes da escolha (src/blend/select.js); a escolha não entra no cache.
  // preferWords só entra na chave quando não está vazio.
  const parts = ['v6', provider, model ?? '', sourceLang, targetLang, nativeLanguage ?? '', request, texts];
  if (preferWords.length > 0) parts.push(preferWords);
  const payload = JSON.stringify(parts);
  return createHash('sha256').update(payload).digest('hex');
}

/** Chave das consultas (lookup/translate): tipo + provider/modelo + partes do pedido. */
export function lookupKey(kind, provider, model, parts) {
  return createHash('sha256').update(JSON.stringify([`${kind}-v2`, provider, model ?? '', ...parts])).digest('hex');
}

export function createDiskCache(dir) {
  return {
    dir,
    async get(key) {
      try {
        const data = JSON.parse(await readFile(join(dir, key.slice(0, 2), `${key}.json`), 'utf8'));
        return data?.annotations ?? null;
      } catch {
        return null;
      }
    },
    async set(key, annotations) {
      const sub = join(dir, key.slice(0, 2));
      await mkdir(sub, { recursive: true });
      const file = join(sub, `${key}.json`);
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(tmp, JSON.stringify({ createdAt: new Date().toISOString(), annotations }));
      await rename(tmp, file);
    },
  };
}
