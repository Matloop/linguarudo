// Mídia de itens e fichas (ADR 0003): imagem WebP e áudio no bucket privado "midia",
// em <user_id>/<sha256>.<ext>. Regras puras, usadas no navegador e no servidor; o
// banco confere o mesmo formato (valid_media_path) e a cota (media_usage).

export const MEDIA_BUCKET = 'midia';

export const MEDIA_LIMITS = {
	/** Teto por arquivo, igual ao file_size_limit do bucket. */
	bytes: 1024 * 1024,
	/** Lado maior da imagem depois de comprimida. */
	imageSide: 1024,
	/** Cota por usuário. */
	quota: 200 * 1024 * 1024
} as const;

export type MediaKind = 'image' | 'audio';

/** Extensões de áudio aceitas e o tipo que vai no upload. */
export const AUDIO_TYPES = {
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	opus: 'audio/opus',
	m4a: 'audio/mp4',
	aac: 'audio/aac',
	wav: 'audio/wav',
	webm: 'audio/webm',
	flac: 'audio/flac'
} as const;
export type AudioExt = keyof typeof AUDIO_TYPES;

const MIME_TO_EXT: Record<string, AudioExt> = {
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/ogg': 'ogg',
	'audio/opus': 'opus',
	'audio/mp4': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/aac': 'aac',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
	'audio/wave': 'wav',
	'audio/webm': 'webm',
	'audio/flac': 'flac',
	'audio/x-flac': 'flac'
};

/** Extensão do áudio pelo tipo ou, sem tipo útil, pelo nome do arquivo. */
export function audioExt(mime: string, filename = ''): AudioExt | null {
	const byMime = MIME_TO_EXT[mime.toLowerCase().split(';')[0].trim()];
	if (byMime) return byMime;
	const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
	return ext in AUDIO_TYPES ? (ext as AudioExt) : null;
}

/** Extensões de imagem que o navegador sabe abrir para converter em WebP. */
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif']);

export function isImageName(filename: string): boolean {
	return IMAGE_EXTS.has(filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '');
}

export function isAudioName(filename: string): boolean {
	return audioExt('', filename) !== null;
}

const AUDIO_EXT_RE = Object.keys(AUDIO_TYPES).join('|');

/** O caminho é do usuário e tem o formato do tipo pedido (mesma regra do banco). */
export function isMediaPath(userId: string, path: string, kind: MediaKind): boolean {
	const ext = kind === 'image' ? 'webp' : `(?:${AUDIO_EXT_RE})`;
	return new RegExp(`^${userId}/[0-9a-f]{64}\\.${ext}$`).test(path);
}

export function mediaPath(userId: string, sha256: string, ext: string): string {
	return `${userId}/${sha256}.${ext}`;
}

export type MediaFieldResult = { ok: true; value: string | null } | { ok: false; error: string };

/** Campo de mídia de um formulário: vazio tira a mídia; senão, tem que ser do usuário. */
export function parseMediaField(raw: unknown, userId: string, kind: MediaKind): MediaFieldResult {
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (!value) return { ok: true, value: null };
	if (!isMediaPath(userId, value, kind)) {
		return { ok: false, error: kind === 'image' ? 'Imagem inválida.' : 'Áudio inválido.' };
	}
	return { ok: true, value };
}

/** Caminhos que saíram (estavam antes e não estão mais). */
export function droppedMedia(
	before: readonly (string | null | undefined)[],
	after: readonly (string | null | undefined)[]
): string[] {
	const keep = new Set(after.filter(Boolean));
	return [...new Set(before.filter((p): p is string => !!p && !keep.has(p)))];
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',')} MB`;
}

/** Hex do SHA-256 (Web Crypto: navegador, Bun e Node). */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
