import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para importar do Anki.');
	if (!shell.active) redirect(303, '/inicio');
	return { language: shell.active, languages: shell.studyLanguages, ui: shell.uiLanguage };
};
