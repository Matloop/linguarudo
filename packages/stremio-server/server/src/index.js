import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDiskCache } from './cache.js';
import { selectDictionaries, selectProvider, selectTranslator } from './config.js';
import { MT_MODEL_DIRNAME } from './mt/opus-mt.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const provider = selectProvider();
const translator = selectTranslator(process.env, { defaultDir: join(here, '..', '.models', MT_MODEL_DIRNAME) });
const dictionaries = selectDictionaries(process.env, { defaultDir: join(here, '..', '.dict') });
const cache = createDiskCache(process.env.LINGOBLEND_CACHE_DIR || join(here, '..', '.cache'));
const port = Number(process.env.PORT) || 7979;
const host = '127.0.0.1'; // só localhost

const server = createApp({ provider, translator, dictionaries, cache });
server.listen(port, host, () => {
  console.log(`LingoBlend em http://${host}:${port}  provider=${provider.name} model=${provider.model}  cache=${cache.dir}`);
  console.log(translator.available ? `tradução local: ${translator.model} (${translator.dir})` : translator.reason);
  const langs = Object.entries(dictionaries.status());
  console.log(langs.length ? `dicionário local: ${langs.map(([l, d]) => `${l} (${d.entries} verbetes)`).join(', ')} (${dictionaries.dir})` : dictionaries.reason);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
