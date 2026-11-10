import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDiskCache } from './cache.js';
import { selectProvider } from './config.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const provider = selectProvider();
const cache = createDiskCache(process.env.LINGOBLEND_CACHE_DIR || join(here, '..', '.cache'));
const port = Number(process.env.PORT) || 7979;
const host = '127.0.0.1'; // só localhost

const server = createApp({ provider, cache });
server.listen(port, host, () => {
  console.log(`LingoBlend em http://${host}:${port}  provider=${provider.name} model=${provider.model}  cache=${cache.dir}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
