// Escolha da letra sincronizada entre os resultados do LRCLIB (lrclib.net).
// A busca em si fica em server/lrclib.ts; aqui só a decisão, que é pura.

export interface LrclibRecord {
	/** Id do registro no LRCLIB (null se a resposta não trouxe). */
	id: number | null;
	trackName: string;
	artistName: string;
	albumName: string;
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

/** Até isto de diferença, a versão é a mesma gravação do vídeo: ganha das outras. */
export const PREFER_DURATION_S = 2;
/** Versões com mais diferença que isto provavelmente não são o mesmo áudio (outra edição, ao vivo). */
export const MAX_DURATION_DIFF_S = 10;
/**
 * Clipe com intro ou cena no fim: o vídeo fica mais longo que a faixa. Se nada chega a
 * 10 s, aceita uma faixa até isto mais curta que o vídeo; a pessoa acerta a sincronia no jogo.
 */
export const MAX_CLIP_EXTRA_S = 300;
/** Quantas versões o menu "Outras versões da letra" mostra. */
export const MAX_VERSIONS = 10;

export interface PickedLyrics {
	id: number | null;
	synced: string;
	/** Duração da faixa segundo o LRCLIB, para o palpite de sincronia. */
	duration: number | null;
}

/** Uma versão da letra no LRCLIB, para a pessoa trocar se a escolhida não bate. */
export interface LyricsVersion {
	id: number;
	trackName: string;
	artistName: string;
	albumName: string;
	duration: number | null;
	synced: boolean;
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

export function pickSynced(records: readonly LrclibRecord[], wanted: Wanted): PickedLyrics | null {
	const usable = records.filter(hasSynced);

	const scored = usable.map((r) => {
		const diff =
			wanted.duration !== null && r.duration !== null
				? Math.abs(r.duration - wanted.duration)
				: null;
		// Quanto o vídeo é mais longo que a faixa (negativo: o vídeo é mais curto).
		const extra =
			wanted.duration !== null && r.duration !== null ? wanted.duration - r.duration : null;
		const sameName =
			norm(r.trackName) === norm(wanted.title) && norm(r.artistName) === norm(wanted.artist);
		return { r, diff, extra, sameName };
	});
	const byFit = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
		(a.diff ?? Infinity) - (b.diff ?? Infinity) || Number(b.sameName) - Number(a.sameName);
	const byName = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
		Number(b.sameName) - Number(a.sameName) || (a.diff ?? Infinity) - (b.diff ?? Infinity);

	const exact = scored.filter((s) => s.diff !== null && s.diff <= PREFER_DURATION_S).sort(byName);
	const close = scored.filter((s) => s.diff === null || s.diff <= MAX_DURATION_DIFF_S).sort(byFit);
	const clip = scored
		.filter((s) => s.extra !== null && s.extra > MAX_DURATION_DIFF_S && s.extra <= MAX_CLIP_EXTRA_S)
		.sort(byName);
	const best = exact[0] ?? close[0] ?? clip[0];
	return best ? toPicked(best.r) : null;
}

const hasSynced = (r: LrclibRecord) =>
	!r.instrumental && typeof r.syncedLyrics === 'string' && r.syncedLyrics.trim() !== '';

const toPicked = (r: LrclibRecord): PickedLyrics => ({
	id: r.id,
	synced: r.syncedLyrics!,
	duration: r.duration
});

/**
 * As versões para o menu: uma por id, sem instrumentais; as sincronizadas primeiro, depois a
 * duração mais próxima da do vídeo.
 */
export function listVersions(records: readonly LrclibRecord[], wanted: Wanted): LyricsVersion[] {
	const seen = new Set<number>();
	const out: LyricsVersion[] = [];
	for (const r of records) {
		if (r.id === null || r.instrumental || seen.has(r.id)) continue;
		seen.add(r.id);
		out.push({
			id: r.id,
			trackName: r.trackName,
			artistName: r.artistName,
			albumName: r.albumName,
			duration: r.duration,
			synced: hasSynced(r)
		});
	}
	const diff = (v: LyricsVersion) =>
		wanted.duration !== null && v.duration !== null
			? Math.abs(v.duration - wanted.duration)
			: Infinity;
	return out
		.sort((a, b) => Number(b.synced) - Number(a.synced) || diff(a) - diff(b))
		.slice(0, MAX_VERSIONS);
}

// ---------- busca ----------

/** Identificação genérica pedida pelo LRCLIB. Sem e-mail nem dado pessoal. */
export const USER_AGENT = 'Linguetta (https://linguetta-app.vercel.app)';

const TIMEOUT_MS = 8_000;

export type LyricsResult =
	| {
			status: 'ok';
			id: number | null;
			synced: string;
			duration: number | null;
			versions: LyricsVersion[];
	  }
	| { status: 'none' }
	| { status: 'unavailable' };

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
				id: typeof r.id === 'number' && Number.isInteger(r.id) ? r.id : null,
				trackName: typeof r.trackName === 'string' ? r.trackName : '',
				artistName: typeof r.artistName === 'string' ? r.artistName : '',
				albumName: typeof r.albumName === 'string' ? r.albumName : '',
				duration: typeof r.duration === 'number' ? r.duration : null,
				instrumental: r.instrumental === true,
				syncedLyrics: typeof r.syncedLyrics === 'string' ? r.syncedLyrics : null
			}
		];
	});
}

/**
 * Busca a letra sincronizada e as versões para o menu. Com `id`, carrega aquele registro
 * (/api/get/{id}); senão escolhe entre /api/get (com a duração) e /api/search.
 */
export async function findSyncedLyrics(
	base: string,
	wanted: Wanted,
	fetcher: typeof fetch = fetch,
	id: number | null = null
): Promise<LyricsResult> {
	let failed = false;
	const load = async (path: string, params: Record<string, string> = {}) => {
		const url = new URL(path, base);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		const res = await getJson(fetcher, url);
		if (res.kind === 'error') failed = true;
		return res.kind === 'ok' ? asRecords(res.data) : [];
	};

	const names = { track_name: wanted.title, artist_name: wanted.artist };
	const [chosen, got, found] = await Promise.all([
		id !== null ? load(`/api/get/${id}`) : Promise.resolve([]),
		wanted.duration !== null
			? load('/api/get', { ...names, duration: String(Math.round(wanted.duration)) })
			: Promise.resolve([]),
		load('/api/search', names)
	]);
	let records = [...chosen, ...got, ...found];
	if (!records.some(hasSynced)) {
		records = [
			...records,
			...(await load('/api/search', { q: `${wanted.artist} ${wanted.title}` }))
		];
	}

	const asked = chosen.find((r) => r.id === id && hasSynced(r));
	const picked = asked ? toPicked(asked) : pickSynced(records, wanted);
	if (!picked) return failed ? { status: 'unavailable' } : { status: 'none' };
	return { status: 'ok', ...picked, versions: listVersions(records, wanted) };
}
