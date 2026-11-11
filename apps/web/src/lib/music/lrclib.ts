// Escolha da letra sincronizada entre os resultados do LRCLIB (lrclib.net).
// A busca em si fica em server/lrclib.ts; aqui só a decisão, que é pura.

export interface LrclibRecord {
	trackName: string;
	artistName: string;
	duration: number | null;
	instrumental: boolean;
	syncedLyrics: string | null;
}

export interface Wanted {
	title: string;
	artist: string;
	/** Duração do vídeo em segundos, se já se sabe. */
	duration: number | null;
}

/** Versões com mais diferença que isto provavelmente não são o mesmo áudio (outra edição, ao vivo). */
export const MAX_DURATION_DIFF_S = 10;

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

export function pickSynced(records: readonly LrclibRecord[], wanted: Wanted): string | null {
	const usable = records.filter(
		(r) => !r.instrumental && typeof r.syncedLyrics === 'string' && r.syncedLyrics.trim() !== ''
	);

	const scored = usable
		.map((r) => {
			const diff =
				wanted.duration !== null && r.duration !== null
					? Math.abs(r.duration - wanted.duration)
					: null;
			const sameName =
				norm(r.trackName) === norm(wanted.title) && norm(r.artistName) === norm(wanted.artist);
			return { r, diff, sameName };
		})
		.filter((s) => s.diff === null || s.diff <= MAX_DURATION_DIFF_S)
		.sort(
			(a, b) =>
				(a.diff ?? Infinity) - (b.diff ?? Infinity) || Number(b.sameName) - Number(a.sameName)
		);

	return scored[0]?.r.syncedLyrics ?? null;
}

// ---------- busca ----------

/** Identificação genérica pedida pelo LRCLIB. Sem e-mail nem dado pessoal. */
export const USER_AGENT = 'Linguetta (https://linguarudo-app.vercel.app)';

const TIMEOUT_MS = 8_000;

export type LyricsResult =
	{ status: 'ok'; synced: string } | { status: 'none' } | { status: 'unavailable' };

type Fetched = { kind: 'ok'; data: unknown } | { kind: 'missing' } | { kind: 'error' };

async function getJson(fetcher: typeof fetch, url: URL): Promise<Fetched> {
	try {
		const res = await fetcher(url, {
			headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (res.status === 404) return { kind: 'missing' };
		if (!res.ok) return { kind: 'error' };
		return { kind: 'ok', data: await res.json() };
	} catch {
		return { kind: 'error' };
	}
}

function asRecords(data: unknown): LrclibRecord[] {
	const items = Array.isArray(data) ? data : [data];
	return items.flatMap((item): LrclibRecord[] => {
		if (typeof item !== 'object' || item === null) return [];
		const r = item as Record<string, unknown>;
		return [
			{
				trackName: typeof r.trackName === 'string' ? r.trackName : '',
				artistName: typeof r.artistName === 'string' ? r.artistName : '',
				duration: typeof r.duration === 'number' ? r.duration : null,
				instrumental: r.instrumental === true,
				syncedLyrics: typeof r.syncedLyrics === 'string' ? r.syncedLyrics : null
			}
		];
	});
}

/** Busca a letra sincronizada: /api/get quando se sabe a duração, depois /api/search. */
export async function findSyncedLyrics(
	base: string,
	wanted: Wanted,
	fetcher: typeof fetch = fetch
): Promise<LyricsResult> {
	let failed = false;
	const attempt = async (path: string, params: Record<string, string>) => {
		const url = new URL(path, base);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		const res = await getJson(fetcher, url);
		if (res.kind === 'error') failed = true;
		if (res.kind !== 'ok') return null;
		return pickSynced(asRecords(res.data), wanted);
	};

	const names = { track_name: wanted.title, artist_name: wanted.artist };
	const attempts: (() => Promise<string | null>)[] = [];
	if (wanted.duration !== null) {
		attempts.push(() =>
			attempt('/api/get', { ...names, duration: String(Math.round(wanted.duration!)) })
		);
	}
	attempts.push(
		() => attempt('/api/search', names),
		() => attempt('/api/search', { q: `${wanted.artist} ${wanted.title}` })
	);

	for (const run of attempts) {
		const synced = await run();
		if (synced) return { status: 'ok', synced };
	}
	return failed ? { status: 'unavailable' } : { status: 'none' };
}
