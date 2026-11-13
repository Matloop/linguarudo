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

/** Opcional: sem valor, string vazia. */
function optional(value: string | undefined): string {
	return value?.trim() ?? '';
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
	YOUTUBE_PLAYLIST_URL: {
		schema: optionalUrl('YOUTUBE_PLAYLIST_URL', 'https://www.youtube.com/playlist'),
		description: 'Página de playlist do YouTube (faixas do álbum). Padrão: a página pública'
	},
	SUPERTONIC_DIR: {
		schema: (value: string | undefined): string => value ?? '',
		description:
			'Pasta local do Supertonic 3 (onnx/ e voice_styles/). Vazio: baixa do Hugging Face para o /tmp no primeiro uso'
	},
	SYNC_PAIR_LIMITS: {
		schema: (value: string | undefined): 'on' | 'off' => (value === 'off' ? 'off' : 'on'),
		description:
			'Limites por IP do pareamento do e-reader (10 por hora, 5 pendentes). "off" só nos e2e. Padrão: on'
	},
	GROQ_API_KEY: {
		schema: optional,
		description:
			'Chave do Groq (grátis em console.groq.com/keys): IA que preenche o diálogo Guardar. Vazia: pula o Groq'
	},
	GEMINI_API_KEY: {
		schema: optional,
		description:
			'Chave do Gemini (grátis em aistudio.google.com/apikey): reserva quando o Groq falha. Vazia: pula o Gemini'
	},
	GROQ_MODEL: {
		schema: optional,
		description: 'Modelo do Groq. Vazio: openai/gpt-oss-120b'
	},
	GEMINI_MODEL: {
		schema: optional,
		description: 'Modelo do Gemini. Vazio: gemini-3.5-flash-lite'
	}
});
