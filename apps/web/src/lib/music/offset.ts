// Sincronia da letra com o vídeo. O deslocamento (s) soma ao tempo da letra para
// achar o tempo no vídeo: positivo = a letra entra mais tarde (clipe com intro).
// Fica na obra do usuário, em refs.lyrics_offset.

export const OFFSET_LIMIT_S = 300;
/** Diferenças menores que isto entre vídeo e faixa não valem um aviso. */
export const HINT_MIN_S = 2;

export function clampOffset(seconds: number): number {
	if (!Number.isFinite(seconds)) return 0;
	const v = Math.round(seconds * 10) / 10;
	return Math.max(-OFFSET_LIMIT_S, Math.min(OFFSET_LIMIT_S, v)) || 0;
}

/** "Começou agora" na linha que começa em `lineStart` (tempo da letra) com o vídeo em `videoTime`. */
export function offsetFromMark(videoTime: number, lineStart: number): number {
	return clampOffset(videoTime - lineStart);
}

/**
 * Palpite pela duração: quanto o vídeo tem a mais que a faixa. Só um palpite, porque
 * a sobra pode estar no fim do clipe. null quando não dá para saber ou é pequena demais.
 */
export function durationHint(videoSeconds: number, trackSeconds: number | null): number | null {
	if (!(videoSeconds > 0) || trackSeconds === null || !(trackSeconds > 0)) return null;
	const diff = clampOffset(videoSeconds - trackSeconds);
	return Math.abs(diff) > HINT_MIN_S ? diff : null;
}

/** "+12,6 s" / "−0,4 s". */
export function formatOffset(seconds: number): string {
	const v = clampOffset(seconds);
	return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1).replace('.', ',')} s`;
}

export interface LyricsSync {
	/** null enquanto a pessoa nunca ajustou esta música. */
	offset: number | null;
	hintDismissed: boolean;
}

export function syncFromRefs(refs: unknown): LyricsSync {
	const r = (typeof refs === 'object' && refs !== null ? refs : {}) as Record<string, unknown>;
	const raw = r.lyrics_offset;
	return {
		offset: typeof raw === 'number' && Number.isFinite(raw) ? clampOffset(raw) : null,
		hintDismissed: r.offset_hint_dismissed === true
	};
}

export type SyncUpdate = { workId: string; offset: number | null; hintDismissed: boolean | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corpo do POST /musica/sincronia. Precisa mudar ao menos uma das duas coisas. */
export function parseSyncUpdate(body: unknown): SyncUpdate | null {
	if (typeof body !== 'object' || body === null) return null;
	const b = body as Record<string, unknown>;
	if (typeof b.workId !== 'string' || !UUID.test(b.workId)) return null;
	let offset: number | null = null;
	if (b.offset !== undefined) {
		if (typeof b.offset !== 'number' || !Number.isFinite(b.offset)) return null;
		if (Math.abs(b.offset) > OFFSET_LIMIT_S) return null;
		offset = clampOffset(b.offset);
	}
	let hintDismissed: boolean | null = null;
	if (b.hintDismissed !== undefined) {
		if (typeof b.hintDismissed !== 'boolean') return null;
		hintDismissed = b.hintDismissed;
	}
	if (offset === null && hintDismissed === null) return null;
	return { workId: b.workId, offset, hintDismissed };
}
