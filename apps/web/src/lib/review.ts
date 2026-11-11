// Regras puras da revisão (fila, sessão, datas, formatação). Não importa o
// ts-fsrs, para não pesar no navegador; o agendamento fica em server/scheduler.ts.

import type { FlashcardKind, Origin } from './items.ts';
import { findWord } from '@linguetta/language';
import type { Language } from './languages.ts';

/** Fuso que define o "dia" dos limites de flashcards novos. Único ponto do código. */
export const REVIEW_TIME_ZONE = 'America/Sao_Paulo';

/** Padrão de user_settings.new_flashcards_per_day (veja a migration de revisão). */
export const DEFAULT_NEW_PER_DAY = 10;

/** Dependência do load do layout; invalidar atualiza o "N para revisar". */
export const REVIEW_DEPENDENCY = 'app:revisao';

/** Flashcard errado que vence dentro desta janela volta na mesma sessão. */
export const LEARN_AHEAD_MS = 20 * 60_000;

export type Grade = 1 | 2 | 3 | 4;
export const GRADES: readonly Grade[] = [1, 2, 3, 4];

export const GRADE_LABELS: Record<Grade, string> = {
	1: 'Errei',
	2: 'Difícil',
	3: 'Bom',
	4: 'Fácil'
};

export function isGrade(v: unknown): v is Grade {
	return v === 1 || v === 2 || v === 3 || v === 4;
}

/** state do FSRS: 0 novo, 1 aprendendo, 2 revisão, 3 reaprendendo. */
export const STATE_NEW = 0;

/** state do FSRS em revisão (já saiu dos passos de aprendizado). */
export const STATE_REVIEW = 2;

// ---------- Dominado ----------

/**
 * Estabilidade (dias) a partir da qual um flashcard conta como dominado. O Anki chama
 * de "maduro" o intervalo de 21 dias; dominado pede bem mais: com retenção de 90%,
 * 90 dias de estabilidade são uns três meses sem esquecer.
 */
export const MASTERED_STABILITY_DAYS = 90;

/** Dominado é derivado, não guardado: todos os flashcards do item em revisão e estáveis. */
export function isMastered(cards: readonly { state: number; stability: number }[]): boolean {
	return (
		cards.length > 0 &&
		cards.every((c) => c.state === STATE_REVIEW && c.stability >= MASTERED_STABILITY_DAYS)
	);
}

// ---------- Força da memória ----------

/** Níveis da força (0–4) mostrados em Minhas palavras. 4 é o dominado. */
export const STRENGTH_LABELS = ['Nova', 'Frágil', 'Firmando', 'Firme', 'Dominada'] as const;
export type Strength = 0 | 1 | 2 | 3 | 4;

/**
 * Força do item pelo flashcard mais fraco já estudado. Só flashcards novos: 0. Um
 * Produzir recém-liberado (novo) não derruba a força do Reconhecer.
 */
export function itemStrength(cards: readonly { state: number; stability: number }[]): Strength {
	if (isMastered(cards)) return 4;
	const studied = cards.filter((c) => c.state !== STATE_NEW);
	if (studied.length === 0) return 0;
	const weakest = Math.min(...studied.map((c) => c.stability));
	if (weakest < 3) return 1;
	if (weakest < 21) return 2;
	return 3;
}

// ---------- Fila ----------

export interface QueueFlashcard {
	id: string;
	state: number;
	dueAt: string;
	createdAt: string;
}

export interface QueueOptions {
	now: Date;
	newLimit: number;
	newDoneToday: number;
}

export function newRemaining(newLimit: number, newDoneToday: number): number {
	return Math.max(0, newLimit - newDoneToday);
}

/**
 * Vencidos primeiro (mais atrasado antes), depois novos por ordem de criação, até o limite.
 * Quem chama já tirou os flashcards de itens conhecidos ou apagados.
 */
export function buildQueue<T extends QueueFlashcard>(cards: T[], opts: QueueOptions): T[] {
	const now = opts.now.getTime();
	const due = cards
		.filter((c) => c.state !== STATE_NEW && Date.parse(c.dueAt) <= now)
		.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
	const fresh = cards
		.filter((c) => c.state === STATE_NEW)
		.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
		.slice(0, newRemaining(opts.newLimit, opts.newDoneToday));
	return [...due, ...fresh];
}

export interface ReviewCounts {
	dueNow: number;
	newAvailable: number;
	newDoneToday: number;
	newLimit: number;
}

/** Quantos flashcards a pessoa pode revisar agora (o "N para revisar"). */
export function reviewCount(c: ReviewCounts): number {
	return c.dueNow + Math.min(c.newAvailable, newRemaining(c.newLimit, c.newDoneToday));
}

/** Quando aparece o próximo flashcard, para o estado vazio. */
export function nextAvailableAt(
	c: Omit<ReviewCounts, 'dueNow'> & { now: Date; nextDueAt: string | null }
): Date | null {
	const options: Date[] = [];
	if (c.nextDueAt) options.push(new Date(c.nextDueAt));
	if (c.newAvailable > 0) {
		options.push(newRemaining(c.newLimit, c.newDoneToday) > 0 ? c.now : nextDayStart(c.now));
	}
	if (options.length === 0) return null;
	return new Date(Math.min(...options.map((d) => d.getTime())));
}

// ---------- Datas ----------

/** Diferença (ms) entre o relógio de parede do fuso e o UTC naquele instante. */
function zoneOffsetMs(at: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(at);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	const wall = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second')
	);
	return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** Meia-noite (no fuso) do dia que contém `now`. */
export function dayStart(now: Date, timeZone = REVIEW_TIME_ZONE): Date {
	const local = new Date(now.getTime() + zoneOffsetMs(now, timeZone));
	const midnightWall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
	// Primeiro palpite com o offset de agora; corrige se a meia-noite tiver outro offset (horário de verão).
	let guess = midnightWall - zoneOffsetMs(now, timeZone);
	guess = midnightWall - zoneOffsetMs(new Date(guess), timeZone);
	return new Date(guess);
}

/** Meia-noite (no fuso) do dia seguinte. */
export function nextDayStart(now: Date, timeZone = REVIEW_TIME_ZONE): Date {
	const start = dayStart(now, timeZone);
	// 26 h passa do dia mesmo com troca de horário; dayStart volta para a meia-noite.
	return dayStart(new Date(start.getTime() + 26 * 3600_000), timeZone);
}

// ---------- Formatação ----------

/** Quando, em linguagem de gente: "hoje às 18:00", "amanhã às 09:30", "14/11 às 18:00". */
export function formatWhen(at: Date, now: Date, timeZone = REVIEW_TIME_ZONE): string {
	if (at.getTime() <= now.getTime()) return 'agora';
	const time = new Intl.DateTimeFormat('pt-BR', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(at);
	const day = dayStart(at, timeZone).getTime();
	if (day === dayStart(now, timeZone).getTime()) return `hoje às ${time}`;
	if (day === nextDayStart(now, timeZone).getTime()) return `amanhã às ${time}`;
	const date = new Intl.DateTimeFormat('pt-BR', {
		timeZone,
		day: '2-digit',
		month: '2-digit'
	}).format(at);
	return `${date} às ${time}`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Dias de calendário (no fuso) entre hoje e o dia de `at`; negativo se já passou. */
function calendarDaysFrom(at: Date, now: Date, timeZone: string): number {
	return Math.round((dayStart(at, timeZone).getTime() - dayStart(now, timeZone).getTime()) / DAY);
}

function earliest(dueAts: readonly string[]): Date | null {
	if (dueAts.length === 0) return null;
	return new Date(Math.min(...dueAts.map((d) => Date.parse(d))));
}

/** Algum flashcard do item vence até o fim de hoje (ou já venceu). */
export function isDueToday(
	dueAts: readonly string[],
	now: Date,
	timeZone = REVIEW_TIME_ZONE
): boolean {
	const at = earliest(dueAts);
	return at !== null && at.getTime() < nextDayStart(now, timeZone).getTime();
}

/** Próxima revisão do item: "hoje", "amanhã" ou "em N dias". */
export function formatNextReview(
	dueAts: readonly string[],
	now: Date,
	timeZone = REVIEW_TIME_ZONE
): string {
	const at = earliest(dueAts);
	if (!at || isDueToday(dueAts, now, timeZone)) return 'hoje';
	const days = calendarDaysFrom(at, now, timeZone);
	return days === 1 ? 'amanhã' : `em ${days} dias`;
}

/** "Quarta, 11 de novembro". */
export function formatToday(now: Date, timeZone = REVIEW_TIME_ZONE): string {
	const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long' })
		.format(now)
		.replace(/-feira$/, '');
	const date = new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'long' }).format(
		now
	);
	return `${weekday[0].toUpperCase()}${weekday.slice(1)}, ${date}`;
}

/** Há quanto tempo: "agora", "há 5 min", "há 3 h", "ontem", "há 3 dias", "12 out". */
export function formatAgo(at: Date, now: Date, timeZone = REVIEW_TIME_ZONE): string {
	const ms = now.getTime() - at.getTime();
	if (ms < MIN) return 'agora';
	if (ms < HOUR) return `há ${Math.floor(ms / MIN)} min`;
	const days = -calendarDaysFrom(at, now, timeZone);
	if (days <= 0) return `há ${Math.floor(ms / HOUR)} h`;
	if (days === 1) return 'ontem';
	if (days < 7) return `há ${days} dias`;
	return new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'short' })
		.format(at)
		.replace('.', '')
		.replace(' de ', ' ');
}

/** Minutos de revisão para `n` flashcards, a uns 30 s cada. */
export function estimateMinutes(n: number): number {
	return n <= 0 ? 0 : Math.max(1, Math.ceil(n / 2));
}

function decimal(n: number): string {
	return (Math.round(n * 10) / 10).toString().replace('.', ',');
}

/** Intervalo curto em PT: "10 min", "14 h", "3 d", "2 meses", "1,5 ano". */
export function formatInterval(ms: number): string {
	if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`;
	if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
	const days = ms / DAY;
	if (days < 31) return `${Math.round(days)} d`;
	if (days < 365) {
		const months = Math.round(days / 30);
		return months === 1 ? '1 mês' : `${months} meses`;
	}
	const years = Math.round((days / 365) * 10) / 10;
	return `${decimal(years)} ${years < 2 ? 'ano' : 'anos'}`;
}

// ---------- Frase de origem ----------

export interface TextPart {
	text: string;
	hit: boolean;
}

/**
 * Quebra o contexto em pedaços, marcando cada ocorrência da palavra ou expressão como
 * trecho inteiro pelas fronteiras de palavra do idioma (findWord: caixa e NFC/NFD não
 * importam; acentos sim).
 */
export function highlightParts(context: string, term: string, language: Language): TextPart[] {
	const parts: TextPart[] = [];
	let from = 0;
	while (from < context.length) {
		const hit = findWord(context.slice(from), term, language);
		if (!hit || hit.length === 0) break;
		const at = from + hit.index;
		if (at > from) parts.push({ text: context.slice(from, at), hit: false });
		parts.push({ text: context.slice(at, at + hit.length), hit: true });
		from = at + hit.length;
	}
	if (from < context.length) parts.push({ text: context.slice(from), hit: false });
	return parts.length ? parts : [{ text: context, hit: false }];
}

// ---------- Sessão ----------

/** O que a tela de revisão recebe por flashcard. */
export interface ReviewItem {
	flashcardId: string;
	/** Reconhecer: mostra o lema, pede o sentido. Produzir: mostra o sentido, pede o lema. */
	kind: FlashcardKind;
	reps: number;
	state: number;
	dueAt: string;
	lemma: string;
	sense: string;
	/** Pronúncia guardada no item; vazia se não há. */
	ipa: string;
	/** Leitura (furigana, pinyin), mostrada acima do lema; vazia se não há. */
	reading: string;
	language: Language;
	/** Frase do encontro mais recente; vazia se o item não tem encontro. */
	sentence: string;
	/** Trecho da frase a destacar (a forma vista); vazio = o lema. */
	highlight: string;
	origin: Origin | null;
	/** "Kaguya · T1E2, 42:10"; vazio se o encontro não tem obra. */
	sourceDetail: string;
	intervals: Record<Grade, string>;
}

export interface Session {
	queue: ReviewItem[];
	answered: number;
	correct: number;
	byGrade: Record<Grade, number>;
	last: { logId: string; rating: Grade; flashcardId: string; requeued: boolean } | null;
}

export function startSession(items: ReviewItem[]): Session {
	return { queue: items, answered: 0, correct: 0, byGrade: { 1: 0, 2: 0, 3: 0, 4: 0 }, last: null };
}

/** Tira o flashcard do topo; se ele vence logo (errou), volta para o fim da fila. */
export function answerItem(
	s: Session,
	a: { rating: Grade; logId: string; updated: ReviewItem; now: Date }
): Session {
	const rest = s.queue.filter((i) => i.flashcardId !== a.updated.flashcardId);
	const requeued = Date.parse(a.updated.dueAt) <= a.now.getTime() + LEARN_AHEAD_MS;
	return {
		queue: requeued ? [...rest, a.updated] : rest,
		answered: s.answered + 1,
		correct: s.correct + (a.rating === 1 ? 0 : 1),
		byGrade: { ...s.byGrade, [a.rating]: s.byGrade[a.rating] + 1 },
		last: { logId: a.logId, rating: a.rating, flashcardId: a.updated.flashcardId, requeued }
	};
}

/** Desfaz a última nota: o flashcard volta ao topo com o estado anterior. */
export function undoLast(s: Session, restored: ReviewItem): Session {
	if (!s.last) return s;
	const rest = s.queue.filter((i) => i.flashcardId !== restored.flashcardId);
	return {
		queue: [restored, ...rest],
		answered: s.answered - 1,
		correct: s.correct - (s.last.rating === 1 ? 0 : 1),
		byGrade: { ...s.byGrade, [s.last.rating]: Math.max(0, s.byGrade[s.last.rating] - 1) },
		last: null
	};
}

/** Progresso da sessão, 0–100 (para o pathLength=100 da onda). */
export function sessionProgress(s: Session): number {
	const total = s.answered + s.queue.length;
	return total === 0 ? 100 : Math.round((s.answered / total) * 100);
}
