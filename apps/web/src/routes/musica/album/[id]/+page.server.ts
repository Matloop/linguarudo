import { error, redirect } from '@sveltejs/kit';
import { albumFromWork } from '#lib/music/album.ts';
import type { PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Abre uma faixa do álbum (?faixa=1 é a primeira; sem ela, a última aberta) e vai para o jogo. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para jogar.');
	if (!UUID.test(params.id)) error(404, 'Álbum não encontrado.');

	const { data: work, error: workError } = await locals.supabase
		.from('works')
		.select('id, title, subtitle, refs, language, played_at')
		.eq('id', params.id)
		.eq('user_id', user.id)
		.eq('kind', 'album')
		.is('deleted_at', null)
		.maybeSingle();
	if (workError) error(500, 'Não deu para abrir o álbum agora.');
	const album = work ? albumFromWork(work) : null;
	if (!album) error(404, 'Álbum não encontrado.');

	const asked = Number(url.searchParams.get('faixa'));
	const position = Number.isInteger(asked) && asked >= 1 ? asked - 1 : album.position;
	if (position >= album.tracks.length) error(404, 'Essa faixa não existe no álbum.');

	const { data: trackId, error: rpcError } = await locals.supabase.rpc('open_album_track', {
		p_album: album.id,
		p_position: position
	});
	if (rpcError || !trackId) error(500, 'Não deu para abrir a faixa agora.');
	redirect(303, `/musica/${trackId}?album=${album.id}`);
};
