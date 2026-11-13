import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import type { FichaEdit } from '#lib/fichas.ts';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient<Database>;
			/** Usuário validado (JWT conferido via getClaims). null se não logado. */
			getUser: () => Promise<SessionUser | null>;
		}
		// interface Error {}
		// interface PageData {}
		interface PageState {
			/** Ficha aberta no diálogo por cima da lista de fichas (pushState). */
			ficha?: FichaEdit;
		}
		// interface Platform {}
	}

	interface SessionUser {
		id: string;
		email: string | null;
	}
}

export {};
