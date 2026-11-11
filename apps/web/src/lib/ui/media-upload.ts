// Upload de mídia direto do navegador para o Storage (ADR 0003). A imagem vira WebP
// de até 1024 px aqui; o áudio vai como veio, até 1 MB. O nome é o sha256 do conteúdo,
// então mandar o mesmo arquivo de novo não ocupa espaço.

import { createBrowserClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';
import type { Database } from '#lib/database.types.ts';
import {
	AUDIO_TYPES,
	MEDIA_BUCKET,
	MEDIA_LIMITS,
	audioExt,
	formatBytes,
	mediaPath,
	sha256Hex,
	type MediaKind
} from '#lib/media.ts';

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;
export function browserSupabase() {
	return (client ??= createBrowserClient<Database>(
		PUBLIC_SUPABASE_URL,
		PUBLIC_SUPABASE_PUBLISHABLE_KEY
	));
}

export class MediaError extends Error {
	constructor(
		readonly code: 'quota' | 'too_big' | 'format' | 'upload',
		message: string
	) {
		super(message);
	}
}

/** Pronto para subir: bytes, extensão e tipo. */
export interface PreparedMedia {
	blob: Blob;
	ext: string;
	contentType: string;
}

/** Imagem → WebP com o lado maior em até 1024 px, baixando a qualidade se passar de 1 MB. */
export async function imageToWebp(source: Blob): Promise<PreparedMedia> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(source);
	} catch {
		bitmap = await loadViaImg(source);
	}
	const scale = Math.min(1, MEDIA_LIMITS.imageSide / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new MediaError('format', 'Não deu para ler a imagem.');
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();
	for (const quality of [0.82, 0.7, 0.55, 0.4]) {
		const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', quality));
		if (!blob || blob.type !== 'image/webp') {
			throw new MediaError('format', 'Este navegador não converte imagem para WebP.');
		}
		if (blob.size <= MEDIA_LIMITS.bytes) return { blob, ext: 'webp', contentType: 'image/webp' };
	}
	throw new MediaError('too_big', 'A imagem ficou grande demais mesmo comprimida.');
}

/** SVG e formatos que createImageBitmap não abre direto passam por um <img>. */
async function loadViaImg(source: Blob): Promise<ImageBitmap> {
	const url = URL.createObjectURL(source);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const w = img.naturalWidth || 512;
		const h = img.naturalHeight || 512;
		return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h });
	} catch {
		throw new MediaError('format', 'Não deu para ler a imagem.');
	} finally {
		URL.revokeObjectURL(url);
	}
}

export function prepareAudio(source: Blob, filename = ''): PreparedMedia {
	const ext = audioExt(source.type, filename);
	if (!ext) throw new MediaError('format', 'Formato de áudio não aceito.');
	if (source.size > MEDIA_LIMITS.bytes) {
		throw new MediaError(
			'too_big',
			`O áudio tem ${formatBytes(source.size)}; o máximo é ${formatBytes(MEDIA_LIMITS.bytes)}.`
		);
	}
	return { blob: source, ext, contentType: AUDIO_TYPES[ext] };
}

export async function prepareMedia(
	kind: MediaKind,
	source: Blob,
	filename = ''
): Promise<PreparedMedia> {
	return kind === 'image' ? imageToWebp(source) : prepareAudio(source, filename);
}

/** Sobe para <userId>/<sha256>.<ext> e devolve o caminho. Já existir é sucesso. */
export async function uploadMedia(userId: string, media: PreparedMedia): Promise<string> {
	const bytes = new Uint8Array(await media.blob.arrayBuffer());
	const path = mediaPath(userId, await sha256Hex(bytes), media.ext);
	const { error } = await browserSupabase()
		.storage.from(MEDIA_BUCKET)
		.upload(path, media.blob, { contentType: media.contentType, upsert: false });
	if (!error) return path;
	const msg = `${error.message} ${(error as { statusCode?: string }).statusCode ?? ''}`;
	if (/exists|duplicate|409/i.test(msg)) return path;
	if (/row-level security|403|unauthorized/i.test(msg)) {
		throw new MediaError('quota', 'Seu espaço de mídia (200 MB) acabou.');
	}
	if (/size|413|payload/i.test(msg)) {
		throw new MediaError('too_big', 'Arquivo grande demais (máximo 1 MB).');
	}
	throw new MediaError('upload', 'Não deu para enviar o arquivo agora.');
}
