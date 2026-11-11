import { error, redirect } from '@sveltejs/kit';
import { loadStats } from '#lib/server/stats.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver suas estatísticas.');
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para ver suas estatísticas.');
	if (!shell.active) redirect(303, '/inicio');
	const language = shell.active;
	try {
		const stats = await loadStats(
			locals.supabase,
			user.id,
			language,
			new Date(),
			shell.clock,
			shell.retention
		);
		return { stats, language, timeZone: shell.clock.timeZone };
	} catch (e) {
		console.error('estatisticas', e);
		error(500, 'Não deu para carregar as estatísticas agora.');
	}
};
