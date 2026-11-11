import { error, fail, redirect } from '@sveltejs/kit';
import { parseSongInput, songFromWork, songWork, type SongField } from '#lib/music/song.ts';
import type { Actions, PageServerLoad } from './$types';

const RECENT_LIMIT = 12;

type PlayErrors = Partial<Record<SongField | 'form', string>>;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para jogar.');
	return user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = await requireUser(locals);
	const { data, error: dbError } = await locals.supabase
		.from('works')
		.select('id, title, subtitle, refs, language, played_at')
		.eq('user_id', user.id)
		.eq('kind', 'musica')
		.is('deleted_at', null)
		.not('played_at', 'is', null)
		.order('played_at', { ascending: false })
		.limit(RECENT_LIMIT);
	if (dbError) error(500, 'Não deu para carregar suas músicas agora.');
	return { songs: data.map(songFromWork).filter((s) => s !== null) };
};

export const actions: Actions = {
	play: async ({ locals, request }) => {
		await requireUser(locals);
		const raw = Object.fromEntries(await request.formData());
		const parsed = parseSongInput(raw);
		if (!parsed.ok) {
			const errors: PlayErrors = parsed.errors;
			return fail(400, { errors, values: parsed.values });
		}

		// A obra é achada pelo vídeo (ou criada); open_work também marca played_at.
		const { data: workId, error: dbError } = await locals.supabase.rpc('open_work', {
			p_work: songWork(parsed.value)
		});
		if (dbError || !workId) {
			const { title, artist, language } = parsed.value;
			const errors: PlayErrors = { form: 'Não deu para abrir a música agora. Tente de novo.' };
			return fail(500, { errors, values: { url: String(raw.url ?? ''), title, artist, language } });
		}
		redirect(303, `/musica/${workId}`);
	}
};
