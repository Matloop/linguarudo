import { error } from '@sveltejs/kit';
import { wordKey } from '#lib/music/tokenize.ts';
import type { PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BANK_LIMIT = 5000;

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para jogar.');
	if (!UUID.test(params.id)) error(404, 'Música não encontrada.');

	const { data: song, error: songError } = await locals.supabase
		.from('songs')
		.select('id, youtube_id, title, artist, lang')
		.eq('id', params.id)
		.eq('user_id', user.id)
		.maybeSingle();
	if (songError) error(500, 'Não deu para abrir a música agora.');
	if (!song) error(404, 'Música não encontrada.');

	// Abrir a música a coloca no topo de "Tocadas recentemente".
	await locals.supabase
		.from('songs')
		.update({ played_at: new Date().toISOString() })
		.eq('id', song.id)
		.eq('user_id', user.id);

	const [bankWords, total] = await Promise.all([
		locals.supabase
			.from('words')
			.select('term, translation, ipa, pos')
			.eq('user_id', user.id)
			.eq('lang', song.lang)
			.limit(BANK_LIMIT),
		locals.supabase
			.from('words')
			.select('id', { count: 'exact', head: true })
			.eq('user_id', user.id)
	]);
	if (bankWords.error) error(500, 'Não deu para carregar seu banco agora.');

	// Só palavras soltas entram na conta das lacunas; expressões ("give up") ficam de fora.
	const bank = bankWords.data
		.map((w) => ({ key: wordKey(w.term), translation: w.translation, ipa: w.ipa, pos: w.pos }))
		.filter((w) => w.key !== '' && !/\s/.test(w.key));

	return { song, bank, bankTotal: total.count ?? bankWords.data.length };
};
