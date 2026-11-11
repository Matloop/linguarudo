// Regras puras da revisão (fila, sessão, datas, formatação). Não importa o
// ts-fsrs, para não pesar no navegador; o agendamento fica em server/scheduler.ts.

import type { FichaFlashcardKind } from './fichas.ts';
import type { FlashcardKind, Origin } from './items.ts';
import { findWord } from '@linguetta/language';
import type { Language } from './languages.ts';

/** Fuso de quem ainda não escolheu o seu (user_settings.time_zone nulo). */
export const REVIEW_TIME_ZONE = 'America/Sao_Paulo';

/** Hora em que o dia de estudo vira, como no Anki: revisar à 1 h ainda conta como ontem. */
export const DEFAULT_DAY_START_HOUR = 4;

/**
 * Relógio do dia de estudo: fuso e hora da virada. Define o limite de novos, o "vence
 * hoje", os irmãos ocultos e os dias das estatísticas. O SQL faz a mesma conta em
 * review_day_start.
 */
export interface DayClock {
	timeZone: string;
	startHour: number;
}

export const DEFAULT_CLOCK: DayClock = {
	timeZone: REVIEW_TIME_ZONE,
	startHour: DEFAULT_DAY_START_HOUR
};

/** Relógio a partir de user_settings; fuso inválido cai no padrão. */
export function clockFrom(
	timeZone: string | null | undefined,
	startHour: number | null | undefined
): DayClock {
	const hour =
		Number.isInteger(startHour) && startHour! >= 0 && startHour! <= 23
			? startHour!
			: DEFAULT_DAY_START_HOUR;
	return {
		timeZone: timeZone && isTimeZone(timeZone) ? timeZone : REVIEW_TIME_ZONE,
		startHour: hour
	};
}

/** O Intl conhece o fuso (nome IANA, como America/Sao_Paulo). */
export function isTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone });
		return true;
	} catch {
		return false;
	}
}

/** Padrão de user_settings.desired_retention e os limites do check. */
export const DEFAULT_RETENTION = 0.9;
export const MIN_RETENTION = 0.7;
export const MAX_RETENTION = 0.97;

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

// ---------- Sanguessuga ----------

/** Lapsos (errou um cartão já aprendido) a partir dos quais a palavra é teimosa. Igual ao Anki. */
export const LEECH_LAPSES = 8;

/** Item teimoso: algum flashcard já chegou ao limite de lapsos (user_settings.leech_lapses). */
export function isLeech(cards: readonly { lapses: number }[], limit = LEECH_LAPSES): boolean {
	return cards.some((c) => c.lapses >= limit);
}

/**
 * Avisa no limite e depois a cada metade dele, como o Anki (8, 12, 16...). Mesma regra de
 * apply_leech no banco, que põe a teimosa em espera ou suspende conforme leech_action.
 */
export function leechAlert(lapses: number, limit = LEECH_LAPSES): boolean {
	return lapses >= limit && (lapses - limit) % Math.max(1, Math.floor(limit / 2)) === 0;
}

// ---------- Fila ----------

export interface QueueFlashcard {
	id: string;
	/** Item dono; null em flashcard de ficha (fichas não ocultam irmãos). */
	itemId: string | null;
	state: number;
	dueAt: string;
	createdAt: string;
}

export interface QueueOptions {
	now: Date;
	newLimit: number;
	newDoneToday: number;
	/** Cartões revisados desde o início do dia (dayStart): ocultam os irmãos. */
	reviewedToday?: readonly { id: string; itemId: string | null }[];
	/** Novos já vêm na ordem da fila do dia (lib/server/queue.ts): não reordena por criação. */
	plannedNew?: boolean;
}

export function newRemaining(newLimit: number, newDoneToday: number): number {
	return Math.max(0, newLimit - newDoneToday);
}

/** Aprendendo e reaprendendo têm passos em minutos: não esperam o irmão. */
function isLearning(state: number): boolean {
	return state === 1 || state === 3;
}

/**
 * Vencidos primeiro (mais atrasado antes), depois novos por ordem de criação, até o limite.
 * Irmãos ocultos: o Reconhecer e o Produzir do mesmo item não caem no mesmo dia. Um
 * flashcard em revisão ou novo sai se o irmão foi revisado hoje, e só um deles entra por
 * item. Fichas não ocultam. Quem chama já tirou os flashcards de itens conhecidos ou apagados.
 */
export function buildQueue<T extends QueueFlashcard>(cards: T[], opts: QueueOptions): T[] {
	const now = opts.now.getTime();
	const buried = new Map<string, Set<string>>();
	for (const r of opts.reviewedToday ?? []) {
		if (!r.itemId) continue;
		const ids = buried.get(r.itemId) ?? new Set<string>();
		ids.add(r.id);
		buried.set(r.itemId, ids);
	}
	const siblingDone = (c: T) =>
		!!c.itemId && [...(buried.get(c.itemId) ?? [])].some((id) => id !== c.id);
	const taken = new Set<string>();
	const take = (c: T) => {
		if (isLearning(c.state) || !c.itemId) return true;
		if (siblingDone(c) || taken.has(c.itemId)) return false;
		taken.add(c.itemId);
		return true;
	};
	const due = cards
		.filter((c) => c.state !== STATE_NEW && Date.parse(c.dueAt) <= now)
		.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
		.filter(take);
	const news = cards.filter((c) => c.state === STATE_NEW);
	if (!opts.plannedNew) news.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
	const fresh = news.filter(take).slice(0, newRemaining(opts.newLimit, opts.newDoneToday));
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
	c: Omit<ReviewCounts, 'dueNow'> & { now: Date; nextDueAt: string | null },
	clock: DayClock = DEFAULT_CLOCK
): Date | null {
	const options: Date[] = [];
	if (c.nextDueAt) options.push(new Date(c.nextDueAt));
	if (c.newAvailable > 0) {
		options.push(newRemaining(c.newLimit, c.newDoneToday) > 0 ? c.now : nextDayStart(c.now, clock));
	}
	if (options.length === 0) return null;
	return new Date(Math.min(...options.map((d) => d.getTime())));
}

// ---------- Datas ----------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

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

/** Instante em que o relógio de parede do fuso marca `wall` (ms de um Date.UTC). */
function wallToInstant(wall: number, near: Date, timeZone: string): number {
	// Primeiro palpite com o offset de perto; corrige se o instante tiver outro offset (horário de verão).
	const guess = wall - zoneOffsetMs(near, timeZone);
	return wall - zoneOffsetMs(new Date(guess), timeZone);
}

/**
 * Início do dia de estudo que contém `now`: o último instante em que o relógio do fuso
 * marcou a hora da virada. Com a virada às 4 h, 1 h da manhã ainda é o dia anterior.
 */
export function dayStart(now: Date, clock: DayClock = DEFAULT_CLOCK): Date {
	const local = new Date(now.getTime() + zoneOffsetMs(now, clock.timeZone));
	const wall = Date.UTC(
		local.getUTCFullYear(),
		local.getUTCMonth(),
		local.getUTCDate(),
		clock.startHour
	);
	let start = wallToInstant(wall, now, clock.timeZone);
	if (start > now.getTime()) start = wallToInstant(wall - DAY, now, clock.timeZone);
	return new Date(start);
}

/** Início do próximo dia de estudo. */
export function nextDayStart(now: Date, clock: DayClock = DEFAULT_CLOCK): Date {
	const start = dayStart(now, clock);
	// 26 h passa do dia mesmo com troca de horário; dayStart volta para a virada.
	return dayStart(new Date(start.getTime() + 26 * HOUR), clock);
}

/** Relógio de calendário (virada à meia-noite) no mesmo fuso, para datas mostradas. */
function calendar(timeZone: string): DayClock {
	return { timeZone, startHour: 0 };
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
	const day = dayStart(at, calendar(timeZone)).getTime();
	if (day === dayStart(now, calendar(timeZone)).getTime()) return `hoje às ${time}`;
	if (day === nextDayStart(now, calendar(timeZone)).getTime()) return `amanhã às ${time}`;
	const date = new Intl.DateTimeFormat('pt-BR', {
		timeZone,
		day: '2-digit',
		month: '2-digit'
	}).format(at);
	return `${date} às ${time}`;
}

/** Dias (do relógio) entre hoje e o dia de `at`; negativo se já passou. */
export function daysFrom(at: Date, now: Date, clock: DayClock): number {
	return Math.round((dayStart(at, clock).getTime() - dayStart(now, clock).getTime()) / DAY);
}

function earliest(dueAts: readonly string[]): Date | null {
	if (dueAts.length === 0) return null;
	return new Date(Math.min(...dueAts.map((d) => Date.parse(d))));
}

/** Algum flashcard do item vence até o fim do dia de estudo (ou já venceu). */
export function isDueToday(
	dueAts: readonly string[],
	now: Date,
	clock: DayClock = DEFAULT_CLOCK
): boolean {
	const at = earliest(dueAts);
	return at !== null && at.getTime() < nextDayStart(now, clock).getTime();
}

/** Próxima revisão do item: "hoje", "amanhã" ou "em N dias". */
export function formatNextReview(
	dueAts: readonly string[],
	now: Date,
	clock: DayClock = DEFAULT_CLOCK
): string {
	const at = earliest(dueAts);
	if (!at || isDueToday(dueAts, now, clock)) return 'hoje';
	const days = daysFrom(at, now, clock);
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
	const days = -daysFrom(at, now, calendar(timeZone));
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

interface ReviewBase {
	flashcardId: string;
	reps: number;
	state: number;
	dueAt: string;
	language: Language;
	tags: string[];
	intervals: Record<Grade, string>;
}

/** Flashcard de ficha: frente/verso em HTML sanitizado (b, i, br). */
export interface FichaReview extends ReviewBase {
	source: 'ficha';
	/** Frente: pergunta a frente. Inverso: pergunta o verso. Lacuna: esconde a lacuna `ord`. */
	kind: FichaFlashcardKind;
	ord: number;
	fichaId: string;
	front: string;
	back: string;
	/** Mídia de cada lado: caminho no bucket no servidor, URL assinada na tela. */
	frontImage: string | null;
	frontAudio: string | null;
	backImage: string | null;
	backAudio: string | null;
}

/** O que a tela de revisão recebe por flashcard. */
export type ReviewItem = ItemReview | FichaReview;

/** Flashcard de item (palavra ou expressão do banco). */
export interface ItemReview extends ReviewBase {
	source: 'item';
	itemId: string;
	/** Reconhecer: mostra o lema, pede o sentido. Produzir: mostra o sentido, pede o lema. */
	kind: FlashcardKind;
	lemma: string;
	sense: string;
	/** Pronúncia guardada no item; vazia se não há. */
	ipa: string;
	/** Leitura (furigana, pinyin), mostrada acima do lema; vazia se não há. */
	reading: string;
	/** Frase do encontro mais recente; vazia se o item não tem encontro. */
	sentence: string;
	/** Trecho da frase a destacar (a forma vista); vazio = o lema. */
	highlight: string;
	origin: Origin | null;
	/** "Kaguya · T1E2, 42:10"; vazio se o encontro não tem obra. */
	sourceDetail: string;
	/** Imagem e áudio de pronúncia: caminho no bucket no servidor, URL assinada na tela. */
	image: string | null;
	audio: string | null;
}

/** Mídia de um lado do flashcard. */
export interface SideMedia {
	image: string | null;
	audio: string | null;
}

/**
 * Onde a mídia aparece (ADR 0003). Reconhecer: áudio na frente, imagem no verso.
 * Produzir: imagem na frente (dica), áudio ao revelar. Ficha: a mídia de cada lado vai
 * com o texto dele (o inverso troca os lados; a lacuna pergunta pela frente).
 */
export function reviewMedia(item: ReviewItem): { ask: SideMedia; answer: SideMedia } {
	if (item.source === 'item') {
		return item.kind === 'reconhecer'
			? {
					ask: { image: null, audio: item.audio },
					answer: { image: item.image, audio: item.audio }
				}
			: {
					ask: { image: item.image, audio: null },
					answer: { image: item.image, audio: item.audio }
				};
	}
	const front = { image: item.frontImage, audio: item.frontAudio };
	const back = { image: item.backImage, audio: item.backAudio };
	return item.kind === 'inverso' ? { ask: back, answer: front } : { ask: front, answer: back };
}

/** Caminhos de mídia do flashcard (para assinar de uma vez). */
export function reviewMediaPaths(item: ReviewItem): string[] {
	const all =
		item.source === 'item'
			? [item.image, item.audio]
			: [item.frontImage, item.frontAudio, item.backImage, item.backAudio];
	return all.filter((p): p is string => !!p);
}

/** Troca os caminhos pelas URLs assinadas; sem URL, a mídia some da tela. */
export function withMediaUrls<T extends ReviewItem>(item: T, urls: ReadonlyMap<string, string>): T {
	const url = (p: string | null) => (p ? (urls.get(p) ?? null) : null);
	if (item.source === 'item') return { ...item, image: url(item.image), audio: url(item.audio) };
	return {
		...item,
		frontImage: url(item.frontImage),
		frontAudio: url(item.frontAudio),
		backImage: url(item.backImage),
		backAudio: url(item.backAudio)
	};
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
