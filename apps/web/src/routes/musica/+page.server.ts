import { error, fail, redirect } from '@sveltejs/kit';
import { albumFromWork, parseAlbumInput, type Album, type AlbumField } from '#lib/music/album.ts';
import {
	parseSongInput,
	songFromWork,
	songWork,
	type Song,
	type SongField
} from '#lib/music/song.ts';
import type { Actions, PageServerLoad } from './$types';

const RECENT_LIMIT = 24;

type PlayErrors = Partial<Record<SongField | 'form', string>>;
type AlbumErrors = Partial<Record<AlbumField | 'form', string>>;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para jogar.');
	return user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = await requireUser(locals);
	const { data, error: dbError } = await locals.supabase
		.from('works')
		.select('id, kind, title, subtitle, refs, language, played_at')
		.eq('user_id', user.id)
		.in('kind', ['musica', 'album'])
		.is('deleted_at', null)
		.not('played_at', 'is', null)
		.order('played_at', { ascending: false })
		.limit(RECENT_LIMIT);
	if (dbError) error(500, 'Não deu para carregar suas músicas agora.');

	const albums = data
		.filter((w) => w.kind === 'album')
		.map(albumFromWork)
		.filter((a) => a !== null);
	// Faixa de álbum aparece dentro do álbum, não solta na estante.
	const inAlbum = new Set(albums.flatMap((a) => a.tracks));
	const shelf = data.flatMap((w): ((Album & { kind: 'album' }) | (Song & { kind: 'musica' }))[] => {
		if (w.kind === 'album') {
			const album = albums.find((a) => a.id === w.id);
			return album ? [{ kind: 'album', ...album }] : [];
		}
		const song = inAlbum.has(w.id) ? null : songFromWork(w);
		return song ? [{ kind: 'musica', ...song }] : [];
	});
	return { shelf };
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
	},

	album: async ({ locals, request }) => {
		await requireUser(locals);
		const parsed = parseAlbumInput(Object.fromEntries(await request.formData()));
		if (!parsed.ok) {
			const errors: AlbumErrors = parsed.errors;
			return fail(400, { errors });
		}
		const { data: albumId, error: dbError } = await locals.supabase.rpc('open_album', {
			p_album: parsed.value
		});
		if (dbError || !albumId) {
			const errors: AlbumErrors = { form: 'Não deu para criar o álbum agora. Tente de novo.' };
			return fail(500, { errors });
		}
		redirect(303, `/musica/album/${albumId}?faixa=1`);
	}
};
