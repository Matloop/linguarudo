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
	}
});
