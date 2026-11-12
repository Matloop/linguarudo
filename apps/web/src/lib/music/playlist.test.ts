import { describe, expect, test } from 'bun:test';
import { fetchPlaylist, parsePlaylistId, parsePlaylistPage } from './playlist.ts';

const lockup = (id: string, title: string, channel: string) => ({
	lockupViewModel: {
		contentId: id,
		contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
		metadata: {
			lockupMetadataViewModel: {
				title: { content: title },
				metadata: {
					contentMetadataViewModel: {
						metadataRows: [{ metadataParts: [{ text: { content: channel } }] }]
					}
				}
			}
		}
	}
});

const page = (data: unknown) =>
	`<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;

describe('parsePlaylistId', () => {
	test('lê o list= de playlist e de vídeo dentro da playlist', () => {
		expect(parsePlaylistId('https://www.youtube.com/playlist?list=OLAK5uy_abc-123')).toBe(
			'OLAK5uy_abc-123'
		);
		expect(parsePlaylistId('https://music.youtube.com/watch?v=AbC123_-xyZ&list=PL06EFF001')).toBe(
			'PL06EFF001'
		);
	});

	test('mix automático (RD…), link sem list e host estranho ficam de fora', () => {
		expect(parsePlaylistId('https://www.youtube.com/watch?v=AbC123_-xyZ&list=RDAbC123_-xyZ')).toBe(
			null
		);
		expect(parsePlaylistId('https://www.youtube.com/watch?v=AbC123_-xyZ')).toBe(null);
		expect(parsePlaylistId('https://evil.test/playlist?list=PL06EFF001')).toBe(null);
		expect(parsePlaylistId('isso não é link')).toBe(null);
	});
});

describe('parsePlaylistPage', () => {
	test('formato novo (lockupViewModel): título, artista e faixas sem repetir', () => {
		const html = page({
			metadata: { playlistMetadataRenderer: { title: 'Album - La voce del padrone' } },
			contents: [
				lockup('AAAAAAAAAA1', 'Summer On A Solitary Beach', 'Franco Battiato - Topic'),
				lockup('AAAAAAAAAA2', 'Bandiera bianca (Remastered)', 'Franco Battiato - Topic'),
				lockup('AAAAAAAAAA1', 'Summer On A Solitary Beach', 'Franco Battiato - Topic')
			]
		});
		expect(parsePlaylistPage(html)).toEqual({
			title: 'La voce del padrone',
			artist: 'Franco Battiato',
			tracks: [
				{
					youtubeId: 'AAAAAAAAAA1',
					title: 'Summer On A Solitary Beach',
					artist: 'Franco Battiato'
				},
				{ youtubeId: 'AAAAAAAAAA2', title: 'Bandiera bianca', artist: 'Franco Battiato' }
			]
		});
	});

	test('formato antigo (playlistVideoRenderer) também vale', () => {
		const html = page({
			metadata: { playlistMetadataRenderer: { title: 'Minhas' } },
			contents: [
				{
					playlistVideoRenderer: {
						videoId: 'BBBBBBBBBB1',
						title: { runs: [{ text: 'Banda Inventada - Canção Falsa' }] },
						shortBylineText: { runs: [{ text: 'Outro Canal' }] }
					}
				}
			]
		});
		expect(parsePlaylistPage(html)).toEqual({
			title: 'Minhas',
			artist: 'Banda Inventada',
			tracks: [{ youtubeId: 'BBBBBBBBBB1', title: 'Canção Falsa', artist: 'Banda Inventada' }]
		});
	});

	test('página sem dados ou sem faixas devolve null', () => {
		expect(parsePlaylistPage('<html>nada</html>')).toBe(null);
		expect(parsePlaylistPage(page({ contents: [] }))).toBe(null);
	});
});

describe('fetchPlaylist', () => {
	test('pede a página da playlist e erro de rede vira null', async () => {
		let asked = '';
		const ok = (async (input: string | URL) => {
			asked = String(input);
			return new Response(page({ contents: [lockup('AAAAAAAAAA1', 'X', 'Y - Topic')] }));
		}) as unknown as typeof fetch;
		const out = await fetchPlaylist('http://yt.test/playlist', 'PL06EFF001', ok);
		expect(out?.tracks).toHaveLength(1);
		expect(new URL(asked).searchParams.get('list')).toBe('PL06EFF001');

		const down = (async () => {
			throw new Error('rede');
		}) as unknown as typeof fetch;
		expect(await fetchPlaylist('http://yt.test/playlist', 'PL06EFF001', down)).toBe(null);
	});
});
