// Gravação humana do Lingua Libre no Wikimedia Commons, achada pelo título do arquivo
// ("LL-Q652 (ita)-<usuário>-<palavra>.wav"), como o Yomitan faz.

const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'Linguetta/1.0 (audio cache)';
const TIMEOUT_MS = 3000;

export type CommonsPage = {
	title: string;
	videoinfo?: { url: string; derivatives?: { src: string; type: string }[] }[];
};

export type Recording = { bytes: Uint8Array; type: 'audio/mpeg' | 'audio/wav' };

/** Busca regex do CirrusSearch. O usuário vai sem hífen para a palavra casar inteira. */
export function commonsSearch(iso: string, word: string): string {
	const escaped = word.replace(/[^\p{L}\p{M}\p{N} ]/gu, '\\$&');
	return `intitle:/LL-Q[0-9]+ \\(${iso}\\)-[^\\-]+-${escaped}\\.wav/i`;
}

function sameWord(title: string, iso: string, word: string): boolean {
	const prefix = `File:LL-Q`;
	const marker = ` (${iso})-`;
	const at = title.indexOf(marker);
	if (!title.startsWith(prefix) || at < 0 || !title.endsWith('.wav')) return false;
	const rest = title.slice(at + marker.length, -'.wav'.length);
	const spoken = rest.slice(rest.indexOf('-') + 1);
	return spoken.normalize('NFC').toLowerCase() === word.normalize('NFC').toLowerCase();
}

/** URL do áudio da primeira página que é a palavra exata: o MP3 transcodificado, senão o original. */
export function recordingUrl(pages: CommonsPage[], iso: string, word: string): string | null {
	const info = pages.find((p) => sameWord(p.title, iso, word))?.videoinfo?.[0];
	if (!info) return null;
	return info.derivatives?.find((d) => d.type === 'audio/mpeg')?.src ?? info.url;
}

async function get(url: string): Promise<Response> {
	const response = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!response.ok) throw new Error(`Commons ${response.status}`);
	return response;
}

/** A gravação da palavra, ou null se não há ou o Commons falhou (aí vale o TTS). */
export async function findRecording(iso: string, word: string): Promise<Recording | null> {
	const url = new URL(API);
	url.search = new URLSearchParams({
		action: 'query',
		format: 'json',
		formatversion: '2',
		generator: 'search',
		gsrnamespace: '6',
		gsrlimit: '10',
		gsrsearch: commonsSearch(iso, word),
		prop: 'videoinfo',
		viprop: 'url|derivatives'
	}).toString();
	try {
		const body = (await (await get(url.href)).json()) as { query?: { pages?: CommonsPage[] } };
		const file = recordingUrl(body.query?.pages ?? [], iso, word);
		if (!file) return null;
		const bytes = new Uint8Array(await (await get(file)).arrayBuffer());
		return { bytes, type: file.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav' };
	} catch (e) {
		console.warn('Commons falhou; segue para o TTS.', e);
		return null;
	}
}
