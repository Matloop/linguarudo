import { error, fail, redirect } from '@sveltejs/kit';
import { parseSongInput, type SongField } from '#lib/music/song.ts';
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
		.from('songs')
		.select('id, youtube_id, title, artist, lang, played_at')
		.eq('user_id', user.id)
		.order('played_at', { ascending: false })
		.limit(RECENT_LIMIT);
	if (dbError) error(500, 'Não deu para carregar suas músicas agora.');
	return { songs: data };
};

export const actions: Actions = {
	play: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const raw = Object.fromEntries(await request.formData());
		const parsed = parseSongInput(raw);
		if (!parsed.ok) {
			const errors: PlayErrors = parsed.errors;
			return fail(400, { errors, values: parsed.values });
		}

		const { youtubeId, title, artist, lang } = parsed.value;
		const { data, error: dbError } = await locals.supabase
			.from('songs')
			.upsert(
				{
					user_id: user.id,
					youtube_id: youtubeId,
					title,
					artist,
					lang,
					played_at: new Date().toISOString()
				},
				{ onConflict: 'user_id,youtube_id' }
			)
			.select('id')
			.single();
		if (dbError) {
			const errors: PlayErrors = { form: 'Não deu para abrir a música agora. Tente de novo.' };
			return fail(500, { errors, values: { url: String(raw.url ?? ''), title, artist, lang } });
		}
		redirect(303, `/musica/${data.id}`);
	}
};
