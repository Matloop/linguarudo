import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

// Os e2e precisam do Supabase local no ar (`supabase start` na raiz).
export default defineConfig({
	webServer: [
		// LRCLIB e oEmbed falsos: o servidor do app os chama, então precisam de uma porta de verdade.
		{
			command: 'bun src/e2e/mock-sources.ts',
			port: 4599,
			reuseExistingServer: !process.env.CI
		},
		{
			command: 'bun run build && bun run preview',
			port: 4173,
			reuseExistingServer: !process.env.CI,
			env: {
				LRCLIB_URL: 'http://127.0.0.1:4599',
				YOUTUBE_OEMBED_URL: 'http://127.0.0.1:4599/oembed',
				// Os e2e pareiam várias vezes do mesmo IP.
				SYNC_PAIR_LIMITS: 'off'
			}
		}
	],
	use: { baseURL: 'http://localhost:4173' },
	testMatch: '**/*.e2e.{ts,js}'
});
