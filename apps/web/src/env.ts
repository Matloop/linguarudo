import { defineEnvVars } from '@sveltejs/kit/env';

function url(value: string | undefined): string {
	if (!value) throw new Error('defina PUBLIC_SUPABASE_URL (veja apps/web/.env.example)');
	new URL(value);
	return value;
}

function required(name: string) {
	return (value: string | undefined): string => {
		if (!value) throw new Error(`defina ${name} (veja apps/web/.env.example)`);
		return value;
	};
}

/** URL opcional: sem valor, usa o padrão. Os e2e apontam para um servidor falso. */
function optionalUrl(name: string, fallback: string) {
	return (value: string | undefined): string => {
		if (!value) return fallback;
		try {
			new URL(value);
		} catch {
			throw new Error(`${name} precisa ser uma URL`);
		}
		return value;
	};
}

export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: {
		public: true,
		schema: url,
		description: 'URL do projeto Supabase (local: http://127.0.0.1:54321)'
	},
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: {
		public: true,
		schema: required('PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
		description: 'Chave publicável (sb_publishable_...) do Supabase'
	},
	LRCLIB_URL: {
		schema: optionalUrl('LRCLIB_URL', 'https://lrclib.net'),
		description: 'API do LRCLIB (letras sincronizadas). Padrão: https://lrclib.net'
	},
	YOUTUBE_OEMBED_URL: {
		schema: optionalUrl('YOUTUBE_OEMBED_URL', 'https://www.youtube.com/oembed'),
		description: 'oEmbed do YouTube (título e canal do vídeo). Padrão: o endpoint oficial'
	},
	SYNC_PAIR_LIMITS: {
		schema: (value: string | undefined): 'on' | 'off' => (value === 'off' ? 'off' : 'on'),
		description:
			'Limites por IP do pareamento do e-reader (10 por hora, 5 pendentes). "off" só nos e2e. Padrão: on'
	}
});
