import { describe, expect, test } from 'bun:test';
import type { AiChain, JsonRequest } from './ai';
import {
	CommonsError,
	commonsImageSearchUrl,
	imageQueryRequest,
	normalizeQuery,
	parseImageRequest,
	parseQuery,
	pickImages,
	searchCommonsImages,
	suggestImages,
	type CommonsImagePage,
	type ImageRequest
} from './image-search';

const req = (over: Partial<ImageRequest> = {}): ImageRequest => ({
	language: 'it',
	lemma: 'letto',
	sense: 'cama',
	sentence: '',
	query: '',
	...over
});

describe('parseImageRequest', () => {
	test('limpa espaços e aceita campos opcionais ausentes', () => {
		expect(parseImageRequest({ language: 'it', lemma: '  letto ' })).toEqual(req({ sense: '' }));
	});

	test('rejeita idioma inválido, sem palavra e tipo errado', () => {
		expect(parseImageRequest({ language: '??', lemma: 'letto' })).toHaveProperty('error');
		expect(parseImageRequest({ language: 'it', lemma: ' ' })).toHaveProperty('error');
		expect(parseImageRequest({ language: 'it', lemma: 'letto', sense: 3 })).toHaveProperty('error');
		expect(parseImageRequest(null)).toHaveProperty('error');
	});

	test('com busca digitada, a palavra pode faltar', () => {
		expect(parseImageRequest({ language: 'it', query: 'double bed' })).toMatchObject({
			lemma: '',
			query: 'double bed'
		});
	});
});

describe('normalizeQuery', () => {
	test('até 4 palavras, sem aspas nem operadores', () => {
		expect(normalizeQuery('"red" apple, on a wooden table')).toBe('red apple on a');
		expect(normalizeQuery('bed -painting filetype:drawing')).toBe('bed');
		expect(normalizeQuery("  children's   toy ")).toBe("children's toy");
		expect(normalizeQuery(42)).toBe('');
	});
});

describe('imageQueryRequest', () => {
	test('manda palavra, sentido e frase; pede só a busca', () => {
		const r = imageQueryRequest(req({ sentence: 'Vado a letto presto.' }));
		expect(r.system).toContain('Italian');
		expect(r.user).toBe(
			'Language: Italian (it)\nWord: letto\nMeaning: cama\nSentence: Vado a letto presto.'
		);
		expect(r.schema).toMatchObject({ required: ['query'], additionalProperties: false });
	});

	test('sem sentido nem frase, as linhas somem', () => {
		expect(imageQueryRequest(req({ sense: '' })).user).toBe('Language: Italian (it)\nWord: letto');
	});
});

describe('parseQuery', () => {
	test('normaliza; vazio é malformado', () => {
		expect(parseQuery({ query: ' Bed. ' })).toBe('Bed');
		expect(parseQuery({ query: '' })).toBeNull();
		expect(parseQuery('bed')).toBeNull();
	});
});

describe('commonsImageSearchUrl', () => {
	test('busca arquivos bitmap com miniatura e CORS aberto', () => {
		const p = new URL(commonsImageSearchUrl('bed')).searchParams;
		expect(p.get('gsrsearch')).toBe('bed filetype:bitmap');
		expect(p.get('gsrnamespace')).toBe('6');
		expect(p.get('generator')).toBe('search');
		expect(p.get('prop')).toBe('imageinfo');
		expect(p.get('iiprop')).toBe('url|mime|size');
		expect(p.get('iiurlwidth')).toBe('400');
		expect(p.get('origin')).toBe('*');
	});
});

const T = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab';
const file = (
	name: string,
	index: number,
	over: Partial<NonNullable<CommonsImagePage['imageinfo']>[number]> = {}
): CommonsImagePage => ({
	title: `File:${name}.jpg`,
	index,
	imageinfo: [
		{
			url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}.jpg`,
			descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
			mime: 'image/jpeg',
			width: 1600,
			height: 1200,
			thumburl: `${T}/${name}.jpg/500px-${name}.jpg`,
			responsiveUrls: { '2': `${T}/${name}.jpg/960px-${name}.jpg` },
			...over
		}
	]
});

describe('pickImages', () => {
	test('na ordem da busca, com miniatura, versão maior e página', () => {
		expect(pickImages([file('B', 2), file('A', 1)])).toEqual([
			{
				thumb: `${T}/A.jpg/500px-A.jpg`,
				url: `${T}/A.jpg/960px-A.jpg`,
				title: 'A',
				page: 'https://commons.wikimedia.org/wiki/File:A.jpg'
			},
			expect.objectContaining({ title: 'B' })
		]);
	});

	test('pula formato fora, imagem pequena, proporção estranha e host de fora', () => {
		const pages = [
			file('gif', 1, { mime: 'image/gif' }),
			file('tiff', 2, { mime: 'image/tiff' }),
			file('tiny', 3, { width: 200, height: 150 }),
			file('panorama', 4, { width: 6000, height: 1000 }),
			file('strip', 5, { width: 400, height: 1200 }),
			file('evil', 6, { thumburl: 'https://evil.example/x.jpg' }),
			file('noinfo', 7, { thumburl: undefined }),
			file('ok', 8, { mime: 'image/png' })
		];
		expect(pickImages(pages).map((h) => h.title)).toEqual(['ok']);
	});

	test('sem versão maior, usa a miniatura; no máximo 6', () => {
		const [hit] = pickImages([file('A', 1, { responsiveUrls: undefined })]);
		expect(hit.url).toBe(hit.thumb);
		const many = Array.from({ length: 10 }, (_, i) => file(`F${i}`, i));
		expect(pickImages(many)).toHaveLength(6);
	});
});

type Fetch = typeof globalThis.fetch;
function fakeFetch(respond: () => Response | Promise<Response>) {
	const urls: string[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		urls.push(String(input));
		return respond();
	}) as Fetch;
	return { fetch, urls };
}
const pagesResponse = (pages: CommonsImagePage[]) =>
	new Response(JSON.stringify({ query: { pages } }));

describe('searchCommonsImages', () => {
	test('lê as páginas do generator', async () => {
		const { fetch, urls } = fakeFetch(() => pagesResponse([file('Bed', 1)]));
		const hits = await searchCommonsImages('bed', fetch);
		expect(hits.map((h) => h.title)).toEqual(['Bed']);
		expect(urls[0]).toContain('gsrsearch=bed+filetype%3Abitmap');
	});

	test('nada achado é lista vazia', async () => {
		const { fetch } = fakeFetch(() => new Response(JSON.stringify({ batchcomplete: true })));
		expect(await searchCommonsImages('zzz', fetch)).toEqual([]);
	});

	test('HTTP, rede ou corpo ruim viram CommonsError', async () => {
		for (const respond of [
			() => new Response('x', { status: 503 }),
			() => new Response('<html>'),
			() => Promise.reject(new TypeError('offline'))
		]) {
			const { fetch } = fakeFetch(respond);
			await expect(searchCommonsImages('bed', fetch)).rejects.toBeInstanceOf(CommonsError);
		}
	});
});

function fakeChain(answer: unknown) {
	const calls: JsonRequest<unknown>[] = [];
	const chain: AiChain = {
		async json<T>(r: JsonRequest<T>): Promise<T> {
			calls.push(r);
			const out = r.parse(answer);
			if (out === null) throw new Error('malformada');
			return out;
		}
	};
	return { chain, calls };
}

describe('suggestImages', () => {
	test('a IA escreve a busca e o Commons dá as fotos', async () => {
		const { chain, calls } = fakeChain({ query: 'bed' });
		const { fetch, urls } = fakeFetch(() => pagesResponse([file('Bed', 1)]));
		const out = await suggestImages(chain, req(), fetch);
		expect(out.query).toBe('bed');
		expect(out.images).toHaveLength(1);
		expect(calls).toHaveLength(1);
		expect(urls[0]).toContain('gsrsearch=bed+');
	});

	test('busca digitada pula a IA', async () => {
		const { chain, calls } = fakeChain({ query: 'bed' });
		const { fetch, urls } = fakeFetch(() => pagesResponse([]));
		const out = await suggestImages(chain, req({ query: 'double bed' }), fetch);
		expect(out).toEqual({ query: 'double bed', images: [] });
		expect(calls).toHaveLength(0);
		expect(urls[0]).toContain('gsrsearch=double+bed+');
	});
});
