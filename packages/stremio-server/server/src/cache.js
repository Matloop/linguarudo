import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Chave estável: depende só do provider/modelo/idiomas/densidade e dos textos (não dos ids). */
export function cacheKey({ provider, model, sourceLang, targetLang, density, texts }) {
  const payload = JSON.stringify(['v1', provider, model ?? '', sourceLang, targetLang, Number(density), texts]);
  return createHash('sha256').update(payload).digest('hex');
}

export function createDiskCache(dir) {
  return {
    dir,
    async get(key) {
      try {
        const data = JSON.parse(await readFile(join(dir, key.slice(0, 2), `${key}.json`), 'utf8'));
        return Array.isArray(data?.annotations) ? data.annotations : null;
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
