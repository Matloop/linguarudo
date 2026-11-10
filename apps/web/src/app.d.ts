import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient<Database>;
			/** Usuário validado (JWT conferido via getClaims). null se não logado. */
			getUser: () => Promise<SessionUser | null>;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface SessionUser {
		id: string;
		email: string | null;
	}
}

export {};
