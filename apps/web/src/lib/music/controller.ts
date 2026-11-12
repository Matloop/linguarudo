// O cérebro da tela do jogo de música: TS puro, sem Svelte e sem player.
//
// A página chama `frame(tempoDoPlayer, agora)` a cada quadro e `send(ação, agora)` a
// cada clique/tecla/evento do player; os dois devolvem efeitos (pedidos ao player e
// "salvar a sincronia") que a página só executa. O que desenhar sai de `view()`.
// Assim dá para testar a tela inteira sem navegador, com um player falso e relógio
// virtual (sim/), inclusive as manias do YouTube.
//
// Regras que valem aqui e os testes conferem:
// - abrir e fechar a sincronia nunca mexe no vídeo (nem play, nem pause, nem seek);
// - lacuna sem resposta nunca aparece em texto visível;
// - a linha escolhida na sincronia só muda por toque ou ↑/↓;
// - enquanto sincroniza, o jogo congela (pontos, lacunas e contador).

import { Game, type Command, type GameGapConfig, type GapResult, type Phase } from './game.ts';
import { lineParts, maskTokens, type LinePart } from './mask.ts';
import { Playhead } from './playhead.ts';
import type { Session } from './session.ts';
import {
	EMPTY_TIMELINE,
	lineAt,
	lineTimings,
	nudgeSegment,
	offsetAt,
	resolveSync,
	segmentOf,
	serializeSync,
	suggestRate,
	withAnchor,
	withRate,
	withoutAnchor,
	type AnchorSource,
	type LineTiming,
	type StoredSync,
	type TimedLine,
	type Timeline
} from './timeline.ts';
import type { Token } from './tokenize.ts';
import type { PlayerState } from './youtube.ts';

export type { PlayerState };

export type Effect =
	| { type: 'play' }
	| { type: 'pause' }
	| { type: 'seek'; to: number }
	| { type: 'rate'; rate: number }
	| { type: 'save'; sync: StoredSync };

export type MusicEvent =
	| { type: 'start'; session: Session }
	| { type: 'backToStart' }
	| { type: 'answer'; option: string }
	| { type: 'togglePause' }
	| { type: 'repeat' }
	| { type: 'toggleSpeed' }
	| { type: 'retry' }
	| { type: 'continue' }
	| { type: 'leave' }
	| { type: 'openCard'; line: number; token: number }
	| { type: 'closeCard' }
	| { type: 'openSync' }
	| { type: 'closeSync'; conclude: boolean }
	/** Toque numa linha da letra na sincronia: escolhe e marca agora. */
	| { type: 'selectLine'; line: number }
	| { type: 'moveSelection'; delta: number }
	/** Espaço: marca de novo a linha escolhida. */
	| { type: 'mark' }
	/** Ajuste fino do trecho (na sincronia: da linha escolhida; no jogo: da linha atual). */
	| { type: 'nudge'; delta: number }
	| { type: 'zero' }
	| { type: 'undo' }
	| { type: 'deleteAnchor'; index: number }
	| { type: 'acceptRate' }
	| { type: 'autoAnchor'; line: number; video: number }
	/** Controles do vídeo pedidos de propósito no painel de sincronia. */
	| { type: 'syncTogglePlay' }
	| { type: 'syncBack'; seconds: number }
	| { type: 'syncRestart' }
	| { type: 'hidden' }
	| { type: 'playerState'; state: PlayerState }
	| { type: 'autoplayBlocked' }
	| { type: 'ended' }
	| { type: 'saved'; ok: boolean }
	| { type: 'dismissHint' };

export type Mode = 'idle' | 'game' | 'sync';

export interface LineView {
	index: number;
	present: boolean;
	/** Tempo do vídeo. */
	start: number;
	end: number;
	parts: LinePart[];
	/** A linha tem lacuna que conta (aberta ou respondida). */
	hasGap: boolean;
	result: GapResult | null;
}

export interface AnchorView {
	line: number;
	video: number;
	/** Deslocamento do trecho (vídeo − letra). */
	offset: number;
	source: AnchorSource;
}

export interface SyncView {
	selected: number;
	anchors: AnchorView[];
	/** Trecho da linha escolhida (índice em `anchors`; -1 sem âncoras). */
	segment: number;
	offset: number;
	rate: number;
	rateSuggestion: number | null;
	canUndo: boolean;
	videoPlaying: boolean;
}

export interface Feedback {
	options: readonly string[];
	chosen: string;
	answer: string;
}

export interface MusicView {
	mode: Mode;
	phase: Phase;
	/** A linha acesa (uma só). */
	shownLine: number;
	score: number;
	combo: number;
	maxCombo: number;
	results: GapResult[];
	/** Erradas de verdade (sem as puladas). */
	wrong: GapResult[];
	answerable: GameGapConfig | null;
	totalGaps: number;
	gapNumber: number;
	lines: LineView[];
	feedback: Feedback | null;
	notice: { text: string; tone: 'ok' | 'err' | '' };
	/** Deslocamento do trecho da linha atual (barra de baixo). */
	offset: number;
	slow: boolean;
	sync: SyncView | null;
	card: { line: number; token: number; tokens: Token[] } | null;
	gameOver: { line: number; parts: LinePart[]; revealed: boolean } | null;
	/** Âncoras que caíram ao abrir (a letra mudou). */
	droppedAnchors: number;
	hintDismissed: boolean;
	hasSync: boolean;
}

export interface ControllerInit {
	lines: readonly TimedLine[];
	stored: StoredSync;
}

const NOTICE_MS = 3_200;
const FEEDBACK_MS = 1_400;
/** −/+ da barra: salva quando a pessoa para de mexer. */
const SAVE_DEBOUNCE_MS = 900;
/** Eventos de estado do player logo depois de um pedido nosso são eco dele, não da pessoa. */
const OWN_ECHO_MS = 1_000;
const PRAISE = ['Isso!', 'Na mosca!', 'Certinho!'];

export class MusicController {
	#lines: readonly TimedLine[];
	#timeline: Timeline;
	#timings: LineTiming[];
	#hintDismissed: boolean;
	#lrclibId: number | null;
	#dropped: number;

	#mode: Mode = 'idle';
	#session: Session | null = null;
	#game: Game | null = null;
	#playhead = new Playhead();
	#time = 0;
	#videoPlaying = false;
	#ownUntil = -Infinity;
	#slow = false;

	#card: { line: number; token: number } | null = null;
	#pausedByCard = false;
	#selected = 0;
	#before: Timeline = EMPTY_TIMELINE;
	#history: Timeline[] = [];
	#revealed = false;

	#notice = { text: '', tone: '' as 'ok' | 'err' | '', until: 0 };
	#feedback: (Feedback & { until: number }) | null = null;
	#streak = 0;
	#saveAt: number | null = null;

	#rev = 0;
	#shown = -1;
	#cache: { key: string; view: MusicView } | null = null;

	constructor(init: ControllerInit) {
		this.#lines = init.lines;
		const { timeline, dropped } = resolveSync(init.stored, init.lines);
		this.#timeline = timeline;
		this.#dropped = dropped;
		this.#timings = lineTimings(timeline, init.lines);
		this.#hintDismissed = init.stored.hintDismissed;
		this.#lrclibId = init.stored.lrclibId;
	}

	// ---------- leitura ----------

	get timeline(): Timeline {
		return this.#timeline;
	}

	get mode(): Mode {
		return this.#mode;
	}

	/** Tempo do vídeo em que o jogo confia (s). */
	get time(): number {
		return this.#time;
	}

	get videoPlaying(): boolean {
		return this.#videoPlaying;
	}

	get game(): Game | null {
		return this.#game;
	}

	/** Muda a cada mudança visível (fora o relógio). */
	get revision(): string {
		return `${this.#rev}:${this.#game?.revision ?? -1}`;
	}

	/** Começo da linha no vídeo (para guardar o momento da palavra salva). */
	lineStart(line: number): number {
		return Math.max(0, this.#timings[line]?.start ?? 0);
	}

	waitMs(now: number): number | null {
		return this.#game?.waitRemainingMs(now) ?? null;
	}

	stored(): StoredSync {
		return serializeSync(this.#timeline, this.#lines, {
			hintDismissed: this.#hintDismissed,
			lrclibId: this.#lrclibId
		});
	}

	// ---------- relógio ----------

	frame(raw: number, now: number): Effect[] {
		const out: Effect[] = [];
		this.#time = this.#playhead.read(raw, now);
		if (this.#notice.text && now >= this.#notice.until) {
			this.#notice = { text: '', tone: '', until: 0 };
			this.#changed();
		}
		if (this.#feedback && now >= this.#feedback.until) {
			this.#feedback = null;
			this.#changed();
		}
		if (this.#saveAt !== null && now >= this.#saveAt && this.#mode !== 'sync') {
			this.#saveAt = null;
			out.push(this.#save());
		}
		if (this.#mode === 'game' && this.#game) {
			out.push(...this.#run(this.#game.tick(this.#time, now), now));
		}
		this.#updateShown();
		return out;
	}

	// ---------- ações ----------

	send(event: MusicEvent, now: number): Effect[] {
		switch (event.type) {
			case 'start':
				return this.#start(event.session, now);
			case 'backToStart':
				return this.#backToStart(now);
			case 'answer':
				return this.#answer(event.option, now);
			case 'togglePause':
				return this.#togglePause(now);
			case 'repeat':
				return this.#gameOnly(() => this.#run(this.#game!.repeatLine(), now));
			case 'toggleSpeed':
				if (this.#mode !== 'game') return [];
				this.#slow = !this.#slow;
				this.#changed();
				return [{ type: 'rate', rate: this.#slow ? 0.75 : 1 }];
			case 'retry':
				return this.#retry(now);
			case 'continue':
				if (!this.#game || this.#game.phase !== 'gameover') return [];
				return this.#run(this.#game.continueAfterGameOver(), now);
			case 'leave':
				if (this.#game?.phase === 'gameover') {
					this.#revealed = true;
					this.#changed();
				}
				return [];
			case 'openCard':
				return this.#openCard(event.line, event.token, now);
			case 'closeCard':
				return this.#closeCard(now);
			case 'openSync':
				return this.#openSync(now);
			case 'closeSync':
				return this.#closeSync(event.conclude, now);
			case 'selectLine':
				if (this.#mode !== 'sync') return [];
				this.#select(event.line);
				this.#edit(withAnchor(this.#timeline, this.#lines, this.#anchorNow(this.#selected)));
				return [];
			case 'moveSelection':
				if (this.#mode !== 'sync') return [];
				this.#select(this.#selected + event.delta);
				return [];
			case 'mark':
				if (this.#mode !== 'sync') return [];
				this.#edit(withAnchor(this.#timeline, this.#lines, this.#anchorNow(this.#selected)));
				return [];
			case 'nudge':
				return this.#nudge(event.delta, now);
			case 'zero':
				if (this.#mode !== 'sync') return [];
				this.#edit({ ...EMPTY_TIMELINE });
				return [];
			case 'undo':
				return this.#undo();
			case 'deleteAnchor':
				if (this.#mode !== 'sync') return [];
				this.#edit(withoutAnchor(this.#timeline, event.index));
				return [];
			case 'acceptRate': {
				if (this.#mode !== 'sync') return [];
				const rate = suggestRate(this.#timeline, this.#lines);
				if (rate !== null) this.#edit(withRate(this.#timeline, rate));
				return [];
			}
			case 'autoAnchor': {
				if (this.#mode !== 'sync') return [];
				const next = withAnchor(this.#timeline, this.#lines, {
					line: event.line,
					video: event.video,
					source: 'auto'
				});
				if (next !== this.#timeline) this.#setTimeline(next);
				return [];
			}
			case 'syncTogglePlay':
				if (this.#mode !== 'sync') return [];
				return this.#own([{ type: this.#videoPlaying ? 'pause' : 'play' }], now);
			case 'syncBack':
				if (this.#mode !== 'sync') return [];
				return this.#own([{ type: 'seek', to: Math.max(0, this.#time - event.seconds) }], now);
			case 'syncRestart':
				if (this.#mode !== 'sync') return [];
				return this.#own([{ type: 'seek', to: 0 }, { type: 'play' }], now);
			case 'hidden':
				return this.#hidden(now);
			case 'playerState':
				return this.#playerState(event.state, now);
			case 'autoplayBlocked':
				this.#videoPlaying = false;
				if (this.#game?.phase === 'playing' && this.#mode === 'game') {
					this.#say('O navegador não deixou tocar sozinho. Toque em Continuar.', now);
					return this.#run(this.#game.pause(now), now);
				}
				return [];
			case 'ended':
				this.#videoPlaying = false;
				if (this.#mode !== 'game' || !this.#game) return [];
				this.#card = null;
				return this.#run(this.#game.finishNow(), now);
			case 'saved':
				if (!event.ok) this.#say('Não deu para salvar a sincronia agora.', now, 'err');
				return [];
			case 'dismissHint':
				this.#hintDismissed = true;
				this.#changed();
				return [this.#save()];
		}
	}

	// ---------- retrato ----------

	view(): MusicView {
		const key = this.revision;
		if (this.#cache?.key === key) return this.#cache.view;
		const view = this.#buildView();
		this.#cache = { key, view };
		return view;
	}

	#buildView(): MusicView {
		const game = this.#game;
		const session = this.#session;
		const results = game ? [...game.results] : [];
		const resultByLine = new Map(results.map((r) => [r.line, r]));
		const gapByLine = new Map((session?.gaps ?? []).map((g) => [g.line, g]));

		const lines: LineView[] = session
			? session.lines.map((l, i) => {
					const timing = this.#timings[i];
					const result = resultByLine.get(i) ?? null;
					const gap = gapByLine.get(i);
					// Linha cortada não tem lacuna: mostra a linha inteira.
					const counts = gap !== undefined && (timing.present || result !== null);
					return {
						index: i,
						present: timing.present,
						start: timing.start,
						end: timing.end,
						parts: lineParts(l.tokens, counts ? gap : null, result),
						hasGap: counts,
						result
					};
				})
			: [];

		const answerable = game?.answerable ?? null;
		const counted = (session?.gaps ?? []).filter((g) => lines[g.line]?.hasGap);
		const open = answerable ? counted.findIndex((g) => g.line === answerable.line) + 1 : 0;

		let card: MusicView['card'] = null;
		if (this.#card && session) {
			const { line, token } = this.#card;
			const gap = lines[line]?.hasGap ? gapByLine.get(line) : null;
			card = {
				line,
				token,
				tokens: maskTokens(session.lines[line].tokens, gap, resultByLine.get(line))
			};
		}

		let gameOver: MusicView['gameOver'] = null;
		if (game?.phase === 'gameover' && session) {
			const line = game.gameOverLine;
			const tokens = session.lines[line]?.tokens ?? [];
			const gap = gapByLine.get(line);
			gameOver = {
				line,
				revealed: this.#revealed,
				parts: lineParts(tokens, gap, this.#revealed ? { ok: false } : resultByLine.get(line))
			};
		}

		let sync: SyncView | null = null;
		if (this.#mode === 'sync') {
			const segment = segmentOf(this.#timeline, this.#selected);
			sync = {
				selected: this.#selected,
				anchors: this.#timeline.anchors.map((a) => ({
					line: a.line,
					video: a.video,
					offset: offsetAt(this.#timeline, this.#lines, a.line),
					source: a.source
				})),
				segment,
				offset: offsetAt(this.#timeline, this.#lines, this.#selected),
				rate: this.#timeline.rate,
				rateSuggestion: suggestRate(this.#timeline, this.#lines),
				canUndo: this.#history.length > 0,
				videoPlaying: this.#videoPlaying
			};
		}

		return {
			mode: this.#mode,
			phase: game?.phase ?? 'ready',
			shownLine: this.#shown,
			score: game?.score ?? 0,
			combo: game?.combo ?? 1,
			maxCombo: game?.maxCombo ?? 1,
			results,
			wrong: results.filter((r) => !r.ok && !r.skipped),
			answerable,
			totalGaps: game?.total ?? 0,
			gapNumber: open || results.length,
			lines,
			feedback: this.#feedback
				? {
						options: this.#feedback.options,
						chosen: this.#feedback.chosen,
						answer: this.#feedback.answer
					}
				: null,
			notice: { text: this.#notice.text, tone: this.#notice.tone },
			offset: offsetAt(this.#timeline, this.#lines, Math.max(0, this.#shown)),
			slow: this.#slow,
			sync,
			card,
			gameOver,
			droppedAnchors: this.#dropped,
			hintDismissed: this.#hintDismissed,
			hasSync: this.#timeline.anchors.length > 0
		};
	}

	// ---------- internos: jogo ----------

	#start(session: Session, now: number): Effect[] {
		if (this.#mode !== 'idle' || session.lines.length !== this.#lines.length) return [];
		this.#session = session;
		this.#game = new Game(session.config);
		this.#game.setTiming(this.#timings);
		this.#mode = 'game';
		this.#card = null;
		this.#revealed = false;
		this.#feedback = null;
		this.#shown = -1;
		this.#changed();
		if (this.#dropped > 0) this.#say('A letra mudou desde a sua sincronia. Confira.', now);
		else this.#notice = { text: '', tone: '', until: 0 };
		return this.#run(this.#game.start(), now);
	}

	#backToStart(now: number): Effect[] {
		if (this.#mode !== 'game') return [];
		this.#mode = 'idle';
		this.#game = null;
		this.#session = null;
		this.#card = null;
		this.#feedback = null;
		this.#shown = -1;
		this.#changed();
		return this.#own([{ type: 'pause' }, { type: 'seek', to: 0 }], now);
	}

	#gameOnly(fn: () => Effect[]): Effect[] {
		if (this.#mode !== 'game' || !this.#game || this.#card) return [];
		return fn();
	}

	#answer(option: string, now: number): Effect[] {
		const game = this.#game;
		if (this.#mode !== 'game' || !game) return [];
		const gap = game.answerable;
		if (!gap) return [];
		const effects = this.#run(game.answer(option), now);
		const result = game.results.find((r) => r.line === gap.line);
		if (!result) return effects;
		this.#feedback = {
			options: gap.options,
			chosen: option,
			answer: gap.answer,
			until: now + FEEDBACK_MS
		};
		if (result.ok)
			this.#say(`${PRAISE[this.#streak++ % PRAISE.length]} +${result.points}`, now, 'ok');
		else this.#say(`Era “${gap.answer}”. Foi para revisar.`, now, 'err');
		return effects;
	}

	#togglePause(now: number): Effect[] {
		return this.#gameOnly(() => {
			const game = this.#game!;
			if (game.phase === 'paused') return this.#run(game.resume(now), now);
			if (game.phase === 'playing' || game.phase === 'waiting')
				return this.#run(game.pause(now), now);
			return [];
		});
	}

	#retry(now: number): Effect[] {
		const game = this.#game;
		if (!game || (game.phase !== 'gameover' && game.phase !== 'finished')) return [];
		if (game.phase === 'gameover') {
			const gap = this.#session?.gaps.find((g) => g.line === game.gameOverLine);
			if (gap) this.#say(`Era “${gap.answer}”.`, now, 'err');
		}
		this.#revealed = false;
		this.#feedback = null;
		this.#changed();
		return this.#run(game.retry(), now);
	}

	#openCard(line: number, token: number, now: number): Effect[] {
		const session = this.#session;
		const game = this.#game;
		if (this.#mode !== 'game' || !session || !game) return [];
		const t = session.lines[line]?.tokens[token];
		if (!t || t.key === null) return [];
		// A palavra da lacuna aberta não abre cartão (seria a resposta).
		const gap = session.gaps.find((g) => g.line === line);
		if (gap && gap.token === token && !game.results.some((r) => r.line === line)) return [];
		this.#card = { line, token };
		this.#changed();
		if (game.phase === 'playing' || game.phase === 'waiting') {
			this.#pausedByCard = true;
			return this.#run(game.pause(now), now);
		}
		return [];
	}

	#closeCard(now: number): Effect[] {
		if (!this.#card) return [];
		this.#card = null;
		this.#changed();
		if (this.#pausedByCard) {
			this.#pausedByCard = false;
			if (this.#game?.phase === 'paused') return this.#run(this.#game.resume(now), now);
		}
		return [];
	}

	#hidden(now: number): Effect[] {
		if (this.#mode === 'sync') {
			return this.#videoPlaying ? this.#own([{ type: 'pause' }], now) : [];
		}
		const game = this.#game;
		if (this.#mode === 'game' && game && (game.phase === 'playing' || game.phase === 'waiting')) {
			return this.#run(game.pause(now), now);
		}
		return [];
	}

	#playerState(state: PlayerState, now: number): Effect[] {
		if (state === 'playing') this.#videoPlaying = true;
		else if (state !== 'buffering') this.#videoPlaying = false;
		this.#changed();
		// A pessoa mexeu no próprio player do YouTube: o jogo acompanha.
		const game = this.#game;
		if (this.#mode !== 'game' || !game || now < this.#ownUntil) return [];
		if (state === 'paused' && game.phase === 'playing') return this.#run(game.pause(now), now);
		if (state === 'playing' && game.phase === 'paused' && !this.#card) {
			return this.#run(game.resume(now), now);
		}
		if (state === 'playing' && game.phase === 'waiting') return this.#own([{ type: 'pause' }], now);
		return [];
	}

	// ---------- internos: sincronia ----------

	#openSync(now: number): Effect[] {
		const game = this.#game;
		if (this.#mode !== 'game' || !game) return [];
		if (game.phase !== 'playing' && game.phase !== 'waiting' && game.phase !== 'paused') return [];
		// Cartão aberto fecha sem retomar: o jogo vai congelar de qualquer jeito.
		this.#card = null;
		this.#pausedByCard = false;
		this.#saveAt = null;
		game.suspend(now);
		this.#mode = 'sync';
		this.#before = this.#timeline;
		this.#history = [];
		const lit = lineAt(this.#timings, this.#time);
		this.#selected = lit >= 0 ? lit : 0;
		this.#updateShown();
		this.#changed();
		return [];
	}

	#closeSync(conclude: boolean, now: number): Effect[] {
		const game = this.#game;
		if (this.#mode !== 'sync' || !game) return [];
		const changed = this.#timeline !== this.#before;
		if (!conclude) this.#setTimeline(this.#before);
		this.#mode = 'game';
		this.#history = [];
		game.relocate(this.#time, this.#videoPlaying);
		this.#updateShown();
		this.#changed();
		if (!conclude) {
			this.#say('Ajuste cancelado.', now);
			return [];
		}
		if (!changed) return [];
		this.#say('Sincronia salva.', now, 'ok');
		return [this.#save()];
	}

	#select(line: number) {
		const next = Math.max(0, Math.min(this.#lines.length - 1, line));
		if (next === this.#selected) return;
		this.#selected = next;
		this.#changed();
	}

	#anchorNow(line: number) {
		return { line, video: this.#time, source: 'manual' as const };
	}

	#nudge(delta: number, now: number): Effect[] {
		if (this.#mode === 'sync') {
			this.#edit(nudgeSegment(this.#timeline, this.#lines, this.#selected, delta));
			return [];
		}
		if (this.#mode !== 'game') return [];
		const line = Math.max(0, this.#game?.activeLine ?? 0);
		const next = nudgeSegment(this.#timeline, this.#lines, line, delta);
		if (next === this.#timeline) return [];
		this.#setTimeline(next);
		this.#saveAt = now + SAVE_DEBOUNCE_MS;
		return [];
	}

	/** Mudança manual na sincronia (entra no desfazer). */
	#edit(next: Timeline) {
		if (next === this.#timeline) return;
		this.#history.push(this.#timeline);
		this.#setTimeline(next);
	}

	#undo(): Effect[] {
		if (this.#mode !== 'sync') return [];
		const prev = this.#history.pop();
		if (!prev) return [];
		// As âncoras automáticas que chegaram depois continuam (se ainda couberem).
		let tl = prev;
		for (const a of this.#timeline.anchors) {
			if (a.source === 'auto' && !prev.anchors.some((p) => p.line === a.line)) {
				tl = withAnchor(tl, this.#lines, a);
			}
		}
		this.#setTimeline(tl);
		return [];
	}

	#setTimeline(tl: Timeline) {
		this.#timeline = tl;
		this.#timings = lineTimings(tl, this.#lines);
		this.#game?.setTiming(this.#timings);
		this.#updateShown();
		this.#changed();
	}

	#save(): Effect {
		return { type: 'save', sync: this.stored() };
	}

	// ---------- internos: comum ----------

	#updateShown() {
		let shown = -1;
		if (this.#mode === 'sync') shown = lineAt(this.#timings, this.#time);
		else if (this.#game) shown = this.#game.activeLine;
		if (shown !== this.#shown) {
			this.#shown = shown;
			this.#changed();
		}
	}

	/** Comandos do jogo viram efeitos; o seek avisa o relógio. */
	#run(commands: Command[], now: number): Effect[] {
		return this.#own(commands, now);
	}

	#own(effects: (Command | Extract<Effect, { type: 'rate' }>)[], now: number): Effect[] {
		for (const e of effects) {
			if (e.type === 'seek') this.#playhead.seek(e.to, now);
			if (e.type === 'play') this.#videoPlaying = true;
			if (e.type === 'pause') this.#videoPlaying = false;
		}
		if (effects.length > 0) {
			this.#ownUntil = now + OWN_ECHO_MS;
			this.#changed();
		}
		return effects;
	}

	#say(text: string, now: number, tone: 'ok' | 'err' | '' = '') {
		this.#notice = { text, tone, until: now + NOTICE_MS };
		this.#changed();
	}

	#changed() {
		this.#rev++;
	}
}
