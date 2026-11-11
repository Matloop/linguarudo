import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// A tela virou Flashcards (ADR 0003); links antigos seguem funcionando.
export const load: PageServerLoad = ({ url }) => {
	redirect(308, `/flashcards${url.search}`);
};
