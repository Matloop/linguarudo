import { error } from '@sveltejs/kit';
import { albumFromWork } from '#lib/music/album.ts';
import { songFromWork } from '#lib/music/song.ts';
import { wordKey } from '#lib/music/tokenize.ts';
import type { PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BANK_LIMIT = 5000;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para jogar.');
	if (!UUID.test(params.id)) error(404, 'Música não encontrada.');

	const { data: work, error: workError } = await locals.supabase
		.from('works')
		.select('id, title, subtitle, refs, language, played_at')
		.eq('id', params.id)
		.eq('user_id', user.id)
		.eq('kind', 'musica')
		.is('deleted_at', null)
		.maybeSingle();
	if (workError) error(500, 'Não deu para abrir a música agora.');
	const song = work ? songFromWork(work) : null;
	if (!song) error(404, 'Música não encontrada.');

	// Abrir a música a coloca no topo de "Tocadas recentemente".
	await locals.supabase
		.from('works')
		.update({ played_at: new Date().toISOString() })
		.eq('id', song.id)
		.eq('user_id', user.id);

	const items = () =>
		locals.supabase
			.from('items')
			.select('id', { count: 'exact', head: true })
			.eq('user_id', user.id);
	const [bankItems, total] = await Promise.all([
		locals.supabase
			.from('items')
			.select('lemma, sense, ipa, part_of_speech')
			.eq('user_id', user.id)
			.eq('language', song.language)
			.is('deleted_at', null)
			.limit(BANK_LIMIT),
		items().is('deleted_at', null)
	]);
	if (bankItems.error) error(500, 'Não deu para carregar seu banco agora.');

	// Só palavras soltas entram na conta das lacunas; expressões ("give up") ficam de fora.
	const bank = bankItems.data
		.map((i) => ({ key: wordKey(i.lemma), sense: i.sense, ipa: i.ipa, pos: i.part_of_speech }))
		.filter((w) => w.key !== '' && !/\s/.test(w.key));

	return {
		song,
		bank,
		bankTotal: total.count ?? bankItems.data.length,
		album: await albumNav(locals, user.id, url.searchParams.get('album'), song.id)
	};
};

/** Veio de um álbum: em que faixa está e qual é a próxima (para o resumo). */
async function albumNav(
	locals: App.Locals,
	userId: string,
	albumId: string | null,
	songId: string
) {
	if (!albumId || !UUID.test(albumId)) return null;
	const { data: work } = await locals.supabase
		.from('works')
		.select('id, title, subtitle, refs, language, played_at')
		.eq('id', albumId)
		.eq('user_id', userId)
		.eq('kind', 'album')
		.is('deleted_at', null)
		.maybeSingle();
	const album = work ? albumFromWork(work) : null;
	const index = album?.tracks.indexOf(songId) ?? -1;
	if (!album || index < 0) return null;

	const nextId = album.tracks[index + 1];
	const { data: next } = nextId
		? await locals.supabase.from('works').select('title').eq('id', nextId).maybeSingle()
		: { data: null };
	return {
		id: album.id,
		title: album.title,
		track: index + 1,
		total: album.tracks.length,
		next: next ? { title: next.title, href: `/musica/album/${album.id}?faixa=${index + 2}` } : null
	};
}
