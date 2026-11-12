import { error } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import { SUPERTONIC_DIR } from '$app/env/private';
import { audioKey, encodeWav, parseAudioQuery, supertonicIso } from '#lib/server/audio.ts';
import { findRecording, type Recording } from '#lib/server/commons.ts';
import { synthesize } from '#lib/server/supertonic.ts';
import type { RequestHandler } from './$types';

// Função própria (config diferente das outras rotas): o modelo carregado chega a ~550 MB
// de RAM e o primeiro uso baixa 380 MB para o /tmp (~15 s).
export const config: Config = { memory: 2048, maxDuration: 60 };

// Uma extensão por fonte: gravação do Commons em .mp3, TTS em .wav.
const EXTENSION = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav' } as const;

type Bucket = ReturnType<App.Locals['supabase']['storage']['from']>;

/** O arquivo é imutável; o redirect fica pouco tempo no cache do navegador. */
function redirectTo(url: string): Response {
	return new Response(null, {
		status: 302,
		headers: { Location: url, 'Cache-Control': 'private, max-age=300' }
	});
}

/** URL pública do áudio já guardado; a gravação humana vence o TTS. */
async function findCached(bucket: Bucket, key: string): Promise<string | null> {
	const urls = Object.values(EXTENSION).map(
		(ext) => bucket.getPublicUrl(`${key}.${ext}`).data.publicUrl
	);
	const found = await Promise.all(
		urls.map((url) =>
			fetch(url, { method: 'HEAD' }).then(
				(r) => r.ok,
				() => false
			)
		)
	);
	return urls.find((_, i) => found[i]) ?? null;
}

async function produce(text: string, base: string, iso: string): Promise<Recording> {
	const recording = await findRecording(iso, text);
	if (recording) return recording;
	const { samples, sampleRate } = await synthesize(text, base, SUPERTONIC_DIR);
	return { bytes: encodeWav(samples, sampleRate), type: 'audio/wav' };
}

/** Guarda e devolve a URL pública. 409 vale: outro pedido guardou o mesmo áudio antes. */
async function store(bucket: Bucket, key: string, audio: Recording): Promise<string> {
	const path = `${key}.${EXTENSION[audio.type]}`;
	const { error: failure } = await bucket.upload(path, audio.bytes, { contentType: audio.type });
	if (failure && failure.statusCode !== '409') {
		console.error('Falha ao guardar o áudio', path, failure);
		error(502, 'Não deu para guardar o áudio.');
	}
	return bucket.getPublicUrl(path).data.publicUrl;
}

/**
 * Áudio da palavra (ADR 0005): redirect para o arquivo público no bucket "audio".
 * Ordem: cache, gravação humana do Lingua Libre, Supertonic 3.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!(await locals.getUser())) error(401, 'Entre para ouvir.');
	const query = parseAudioQuery(url.searchParams);
	if (!query) error(400, 'Mande lang (tag BCP 47) e text (de 1 a 80 caracteres).');
	const iso = supertonicIso(query.base);
	if (!iso) error(404, 'Ainda não há áudio para este idioma.');

	const bucket = locals.supabase.storage.from('audio');
	const key = audioKey(query.base, query.text);
	const cached = await findCached(bucket, key);
	if (cached) return redirectTo(cached);
	return redirectTo(await store(bucket, key, await produce(query.text, query.base, iso)));
};
