<!--
	Painel de uma palavra em Minhas palavras (?item=), o "Painel A": cabeçalho com ↑/↓ e a
	posição na lista, ⋯ (Já sei, Mover para deck…, Apagar) e ×; palavra, leitura e tradução
	editáveis no lugar; Nota (tags, imagem, áudio), Contextos, Flashcards gerados e Histórico
	(fechado); "Revisar agora" preso no rodapé. No desktop fica por cima da lista, à direita;
	no mobile vira folha inferior (meia altura, arrasta para cheia ou para fechar).
	Quem usa cuida da URL e da lista: `closeHref` fecha (scrim e X), `onclose` no Esc ou no
	gesto de fechar, `onprev`/`onnext` andam na lista filtrada e `ondeleted` vem depois de apagar.
	Atalhos fora de campos: J/↓ próxima, K/↑ anterior, D já sei, R revisar, ⌫ apagar, Esc fecha.
-->
<script lang="ts" module>
	import type { FlashcardKind, Origin } from '#lib/items.ts';
	import type { ItemReviewState } from '#lib/review.ts';

	export interface WordSheetEncounter {
		id: string;
		sentence: string;
		highlight: string;
		sense: string;
		origin: Origin;
		originLabel: string;
		source: string;
		seenAt: string;
	}

	export interface WordSheetItem {
		id: string;
		lemma: string;
		reading: string;
		sense: string;
		ipa: string;
		note: string;
		tags: string[];
		image: string | null;
		audio: string | null;
		deckId: string | null;
		status: 'ativo' | 'conhecido';
		review: ItemReviewState;
		strength: number;
		leech: boolean;
		lapses: number;
		dueToday: boolean;
		next: string;
		encounters: WordSheetEncounter[];
	}

	export interface WordSheetHistory {
		rating: number;
		reviewedAt: string;
		kind: FlashcardKind;
		/** Intervalo dado por essa revisão, em dias (0 = no mesmo dia). */
		intervalDays: number | null;
	}

	export interface WordSheetCard {
		id: string;
		kind: FlashcardKind;
		isNew: boolean;
		dueAt: string;
		scheduledDays: number;
	}
</script>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { playWord } from '#lib/audio.ts';
	import { deckDisplayName, plural } from '#lib/decks-ui.ts';
	import { langAttrs, type Language, type UiLanguage } from '#lib/languages.ts';
	import {
		DEFAULT_CLOCK,
		GRADES,
		GRADE_LABELS,
		STRENGTH_LABELS,
		formatAgo,
		formatNextReview,
		highlightParts,
		type DayClock,
		type Grade
	} from '#lib/review.ts';
	import { isTypingTarget } from '#lib/shortcuts.ts';
	import type { DeckOption } from '#lib/word-fields.ts';
	import DeckPicker from './DeckPicker.svelte';
	import Icon from './Icon.svelte';
	import Popover from './Popover.svelte';
	import { toast } from './app-state.svelte.ts';
	import { ORIGIN_ICONS } from './origins.ts';
	import { postAction } from './post-action.ts';
	import WordField from './word/WordField.svelte';
	import WordMediaField from './word/WordMediaField.svelte';

	let {
		item: selected,
		media,
		cards,
		history,
		historyTotal,
		historyLapses,
		decks,
		language,
		nativeLanguage = 'pt',
		now,
		clock = DEFAULT_CLOCK,
		position = null,
		closeHref,
		onclose,
		onprev,
		onnext,
		ondeleted
	}: {
		item: WordSheetItem;
		/** URLs assinadas da imagem e do áudio do item. */
		media: { image: string | null; audio: string | null };
		/** Flashcards do item (Reconhecer, Produzir). */
		cards: WordSheetCard[];
		/** Últimas revisões, a mais recente primeiro. */
		history: WordSheetHistory[];
		/** Total de revisões e de erros (Errei) do item, além das que vieram em `history`. */
		historyTotal: number;
		historyLapses: number;
		/** Decks do idioma (Mover para deck… e o nome do deck nos flashcards). */
		decks: DeckOption[];
		language: Language;
		/** Língua da tradução (rótulo IT→PT dos flashcards). */
		nativeLanguage?: UiLanguage;
		now: Date;
		clock?: DayClock;
		/** Posição da palavra na lista filtrada (0-based), ou null se ela não está na lista. */
		position?: { index: number; total: number } | null;
		/** Link que fecha o painel (scrim e X). */
		closeHref: string;
		/** Esc ou gesto de fechar a folha. */
		onclose: () => void;
		onprev?: () => void;
		onnext?: () => void;
		/** Depois de apagar; quem usa fecha o painel e recarrega a lista. */
		ondeleted: () => Promise<void> | void;
	} = $props();

	const study = $derived(langAttrs(language));
	const timeZone = $derived(clock.timeZone);
	const code = (tag: string) => tag.split('-')[0].toUpperCase();
	const deck = $derived(
		decks.find((d) => d.id === selected.deckId) ?? decks.find((d) => d.isDefault) ?? null
	);
	const canPrev = $derived(!!position && position.index > 0);
	const canNext = $derived(!!position && position.index < position.total - 1);

	let drawerEl: HTMLElement | undefined = $state();
	let bodyEl: HTMLElement | undefined = $state();
	let menuOpen = $state(false);
	let menuView = $state<'menu' | 'decks'>('menu');
	let moving = $state(false);
	let histOpen = $state(false);

	// Trocar de palavra: foco no painel, histórico fechado, rolagem no topo.
	$effect(() => {
		void selected.id;
		histOpen = false;
		menuOpen = false;
		bodyEl?.scrollTo({ top: 0 });
		drawerEl?.focus({ preventScroll: true });
	});
	$effect(() => {
		if (!menuOpen) menuView = 'menu';
	});

	// ---------- status ----------
	const STATUS: Record<ItemReviewState, string> = {
		atrasada: 'Atrasada',
		hoje: 'Para revisar hoje',
		aprendendo: 'Aprendendo',
		nova: 'Nova, ainda não revisada',
		dominada: 'Dominada',
		depois: '',
		conhecida: 'Já sei · fora da revisão'
	};
	const statusText = $derived(STATUS[selected.review] || `Próxima revisão ${selected.next}`);
	const showStrength = $derived(selected.review !== 'nova' && selected.review !== 'conhecida');

	// ---------- ações ----------
	function speak() {
		if (media.audio) {
			void new Audio(media.audio).play().catch(() => toast('Não foi possível tocar o áudio'));
			return;
		}
		playWord(selected.lemma, language).catch(() =>
			toast('Não foi possível tocar o áudio desta palavra')
		);
	}

	async function toggleKnown() {
		menuOpen = false;
		const known = selected.status !== 'conhecido';
		const lemma = selected.lemma;
		const r = await postAction('known', { id: selected.id, known: String(known) });
		if (!r.ok) return toast(r.message);
		toast(known ? `“${lemma}” saiu da revisão` : `“${lemma}” voltou para a revisão`);
	}

	async function remove() {
		menuOpen = false;
		const lemma = selected.lemma;
		if (!confirm(`Apagar “${lemma}” e o histórico de revisão dela?`)) return;
		const r = await postAction('delete', { id: selected.id }, { reload: false });
		if (!r.ok) return toast(r.message || 'Não deu para apagar agora.');
		toast(`“${lemma}” apagada`);
		await ondeleted();
	}

	async function moveTo(choice: { deckId: string } | { newName: string }) {
		moving = true;
		const r = await postAction('/palavras?/move', {
			item: selected.id,
			...('deckId' in choice ? { deck: choice.deckId } : { newName: choice.newName })
		});
		moving = false;
		if (!r.ok) return toast(r.message);
		menuOpen = false;
		toast(`“${selected.lemma}” movida para ${deckDisplayName(String(r.data.target))}`);
	}

	function review() {
		if (selected.dueToday) void goto(resolve('/flashcards/estudar'));
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
		if (document.querySelector('dialog[open], [data-popover-open]')) return;
		if (e.key === 'Escape') {
			onclose();
			return;
		}
		if (isTypingTarget(e.target)) return;
		const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
		const run: Record<string, (() => void) | undefined> = {
			j: canNext ? onnext : undefined,
			ArrowDown: canNext ? onnext : undefined,
			k: canPrev ? onprev : undefined,
			ArrowUp: canPrev ? onprev : undefined,
			d: toggleKnown,
			r: selected.dueToday ? review : undefined,
			Backspace: remove,
			Delete: remove
		};
		const fn = run[key];
		if (!fn) return;
		e.preventDefault();
		fn();
	}

	// ---------- folha inferior (mobile) ----------
	const MOBILE = '(max-width: 768px)';
	let full = $state(false);
	let dragH = $state<number | null>(null);
	let startY = 0;
	let startH = 0;

	function grabStart(e: PointerEvent) {
		if (!drawerEl || !matchMedia(MOBILE).matches || e.button !== 0) return;
		if ((e.target as HTMLElement).closest('button, a, input, [role="dialog"]')) return;
		startY = e.clientY;
		startH = drawerEl.getBoundingClientRect().height;
		dragH = startH;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function grabMove(e: PointerEvent) {
		if (dragH === null) return;
		dragH = Math.max(80, Math.min(window.innerHeight - 16, startH - (e.clientY - startY)));
	}

	function grabEnd(e: PointerEvent) {
		if (dragH === null) return;
		const dy = e.clientY - startY;
		const h = dragH;
		dragH = null;
		if (dy < -50) full = true;
		else if (dy > 70) {
			// Da cheia volta para a meia; da meia (ou arrastando muito) fecha.
			if (full && h > window.innerHeight * 0.35) full = false;
			else onclose();
		}
	}

	function onBodyScroll() {
		if (!full && bodyEl && bodyEl.scrollTop > 24 && matchMedia(MOBILE).matches) full = true;
	}

	// ---------- histórico ----------
	const chrono = $derived([...history].reverse());
	const maxIv = $derived(Math.max(1, ...history.map((h) => h.intervalDays ?? 0)));
	const barH = (iv: number | null) => Math.max(3, Math.round(64 * Math.sqrt((iv ?? 0) / maxIv)));
	function ivText(days: number | null): string {
		if (days === null) return '';
		if (days === 0) return '→ mesmo dia';
		return `→ ${plural(days, 'dia', 'dias')}`;
	}

	// ---------- flashcards ----------
	function cardDue(c: WordSheetCard): { when: string; sub: string } {
		if (selected.status === 'conhecido') return { when: 'Fora da revisão', sub: 'você já sabe' };
		if (c.isNew) return { when: 'Nova', sub: 'ainda não estudada' };
		const when = formatNextReview([c.dueAt], now, clock);
		return {
			when: when.charAt(0).toUpperCase() + when.slice(1),
			sub: c.scheduledDays > 0 ? `intervalo ${c.scheduledDays} d` : 'aprendendo'
		};
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet strength(level: number)}
	<span class="str" title={STRENGTH_LABELS[level]} aria-label="Força: {STRENGTH_LABELS[level]}">
		{#each [1, 2, 3, 4] as n (n)}<i class:on={n <= level}></i>{/each}
	</span>
{/snippet}

{#snippet sentence(text: string, term: string)}
	{#each highlightParts(text, term, language) as part, i (i)}{#if part.hit}<mark>{part.text}</mark
			>{:else}{part.text}{/if}{/each}
{/snippet}

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- closeHref já vem resolvido -->
<a class="drawer-scrim" href={closeHref} aria-hidden="true" tabindex="-1" data-sveltekit-noscroll
	><span class="visually-hidden">Fechar</span></a
>
<section
	class="drawer"
	class:full
	class:dragging={dragH !== null}
	style:height={dragH !== null ? `${dragH}px` : undefined}
	aria-label="Detalhes de “{selected.lemma}”"
	tabindex="-1"
	bind:this={drawerEl}
	data-drawer-open
>
	<div
		class="dr-h"
		role="presentation"
		onpointerdown={grabStart}
		onpointermove={grabMove}
		onpointerup={grabEnd}
		onpointercancel={grabEnd}
	>
		<span class="grab" aria-hidden="true"></span>
		{#if position}
			<span class="nav">
				<button
					type="button"
					class="icon-btn sm"
					title="Anterior (K)"
					aria-label="Palavra anterior"
					disabled={!canPrev}
					onclick={() => onprev?.()}><Icon name="down" size="sm flip" /></button
				>
				<button
					type="button"
					class="icon-btn sm"
					title="Próxima (J)"
					aria-label="Próxima palavra"
					disabled={!canNext}
					onclick={() => onnext?.()}><Icon name="down" size="sm" /></button
				>
				<span class="pos">{position.index + 1} de {position.total}</span>
			</span>
		{/if}
		<span class="sp"></span>
		<Popover bind:open={menuOpen} label="Mais ações" width={menuView === 'decks' ? 300 : 236}>
			{#snippet trigger({ toggle, expanded, id })}
				<button
					type="button"
					class="icon-btn sm"
					class:on={expanded}
					title="Mais ações"
					aria-label="Mais ações"
					aria-haspopup="dialog"
					aria-expanded={expanded}
					aria-controls={id}
					onclick={toggle}><Icon name="more" size="sm" /></button
				>
			{/snippet}
			{#if menuView === 'menu'}
				<div class="menu">
					<button type="button" class="mi" onclick={toggleKnown}>
						<Icon name={selected.status === 'conhecido' ? 'refresh' : 'check'} size="sm" />
						{#if selected.status === 'conhecido'}
							<span>Revisar de novo<small>Volta para a revisão</small></span>
						{:else}
							<span>Já sei<small>Marca como dominada</small></span>
						{/if}
						<kbd>D</kbd>
					</button>
					<button type="button" class="mi" onclick={() => (menuView = 'decks')}>
						<Icon name="cards" size="sm" /><span
							>Mover para deck…{#if deck}<small>Agora em {deckDisplayName(deck.name)}</small
								>{/if}</span
						>
					</button>
					<div class="sep" role="separator"></div>
					<button type="button" class="mi danger" onclick={remove}>
						<Icon name="trash" size="sm" /><span>Apagar</span><kbd>⌫</kbd>
					</button>
				</div>
			{:else}
				<div class="decks">
					<DeckPicker
						decks={decks.map((d) => ({ id: d.id, name: d.name, depth: d.depth }))}
						current={deck?.id ?? null}
						pending={moving}
						onpick={moveTo}
					/>
				</div>
			{/if}
		</Popover>
		<a
			class="icon-btn sm"
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- closeHref já vem resolvido
			href={closeHref}
			title="Fechar (Esc)"
			aria-label="Fechar"
			data-sveltekit-noscroll><Icon name="x" size="sm" /></a
		>
	</div>

	<div class="dr-body" bind:this={bodyEl} onscroll={onBodyScroll}>
		<div class="eye" class:late={selected.review === 'atrasada'}>
			<span class="st" data-st={selected.review}></span>{statusText}
			{#if showStrength}<span class="dot-sep">·</span>força {@render strength(
					selected.strength
				)}{/if}
			{#if selected.leech}<span class="teimosa" title="Errou {selected.lapses} vezes">Teimosa</span
				>{/if}
		</div>

		<div class="head">
			<WordField mode="inline" field="lemma" item={selected} {language} />
			<div class="ipa">
				<div class="bare reading">
					<WordField
						mode="inline"
						field="reading"
						item={selected}
						{language}
						placeholder={selected.ipa || 'Leitura ou IPA'}
					/>
				</div>
				<button class="listen" type="button" onclick={speak}
					><Icon name="sound" size="sm" />{media.audio ? 'Ouvir gravação' : 'Ouvir'}</button
				>
			</div>
			<div class="bare tr">
				<WordField mode="inline" field="sense" item={selected} {language} />
			</div>
			{#if selected.leech}
				<p class="leech-note">
					Você errou {selected.lapses} vezes. Vale reescrever a nota ou trocar a frase do card.
				</p>
			{/if}
		</div>

		<section class="sec">
			<h3>Nota</h3>
			<div class="bare note">
				<WordField mode="inline" field="note" item={selected} {language} />
			</div>
			<div class="bare tags">
				<WordField mode="inline" field="tags" item={selected} {language} />
			</div>
			<div class="media" class:has-img={!!media.image}>
				<WordMediaField
					kind="image"
					mode="inline"
					item={selected}
					url={media.image}
					addLabel="Adicionar imagem"
				/>
			</div>
			<div class="media">
				<WordMediaField
					kind="audio"
					mode="inline"
					item={selected}
					url={media.audio}
					addLabel="Adicionar áudio"
				/>
			</div>
		</section>

		<section class="sec">
			<h3>
				Contextos{#if selected.encounters.length > 0}<span class="aside"
						>{plural(selected.encounters.length, 'encontro', 'encontros')}</span
					>{/if}
			</h3>
			{#each selected.encounters as e (e.id)}
				<div class="quote">
					<div class="qs">
						<Icon name={ORIGIN_ICONS[e.origin]} size="sm" /><span class="src"
							>{e.source || e.originLabel}</span
						><span class="sp"></span><time datetime={e.seenAt}
							>{formatAgo(new Date(e.seenAt), now, timeZone)}</time
						>
					</div>
					{#if e.sentence}<p {...study}>
							{@render sentence(e.sentence, e.highlight || selected.lemma)}
						</p>{/if}
					{#if e.sense && e.sense !== selected.sense}<div class="pt">{e.sense}</div>{/if}
				</div>
			{:else}
				<p class="faint small">
					Guardada sem frase. A próxima vez que ela aparecer, a frase entra aqui.
				</p>
			{/each}
		</section>

		<section class="sec">
			<h3>
				Flashcards gerados{#if deck}<span class="aside">Deck {deckDisplayName(deck.name)}</span
					>{/if}
			</h3>
			{#if cards.length === 0}
				<p class="faint small">Nenhum flashcard ainda.</p>
			{:else}
				<div class="cards">
					{#each cards as c (c.id)}
						{@const due = cardDue(c)}
						<div class="fc">
							<span class="dir"
								>{c.kind === 'produzir'
									? `${code(nativeLanguage)}→${code(language)}`
									: `${code(language)}→${code(nativeLanguage)}`}</span
							>
							<div class="fc-t">
								<b>{c.kind === 'produzir' ? 'Produzir' : 'Reconhecer'}</b>
								<span
									>{c.kind === 'produzir'
										? `${selected.sense || '…'} → ?`
										: `${selected.lemma} → ${selected.sense || '?'}`}</span
								>
							</div>
							<div class="nx">{due.when}<small>{due.sub}</small></div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section class="sec">
			{#if historyTotal === 0}
				<h3>Histórico</h3>
				<p class="faint small">Ainda não revisada. Ela entra na revisão como palavra nova.</p>
			{:else}
				<h3>
					<button
						type="button"
						class="hist-tg"
						aria-expanded={histOpen}
						aria-controls="hist-{selected.id}"
						onclick={() => (histOpen = !histOpen)}
						>Histórico<span class="aside"
							>{plural(historyTotal, 'revisão', 'revisões')} · {plural(
								historyLapses,
								'erro',
								'erros'
							)}</span
						><Icon name="right" size="sm" /></button
					>
				</h3>
				{#if histOpen}
					<div id="hist-{selected.id}">
						<div class="chart" aria-hidden="true">
							{#each chrono as h, i (i)}
								<i data-g={h.rating} style:height="{barH(h.intervalDays)}px"></i>
							{/each}
						</div>
						<div class="chart-x">
							<span>{formatAgo(new Date(chrono[0].reviewedAt), now, timeZone)}</span>
							<span>intervalo após cada revisão</span>
							<span>{formatAgo(new Date(chrono[chrono.length - 1].reviewedAt), now, timeZone)}</span
							>
						</div>
						<div class="legend">
							{#each GRADES as g (g)}<span data-g={g}>{GRADE_LABELS[g]}</span>{/each}
						</div>
						<ul class="hist">
							{#each history as h, i (i)}
								<li>
									<time datetime={h.reviewedAt}
										>{formatAgo(new Date(h.reviewedAt), now, timeZone)}</time
									>
									<span
										><span class="grade" data-g={h.rating}>{GRADE_LABELS[h.rating as Grade]}</span
										><small>{h.kind === 'produzir' ? 'Produzir' : 'Reconhecer'}</small></span
									>
									<span class="iv">{ivText(h.intervalDays)}</span>
								</li>
							{/each}
						</ul>
						{#if historyTotal > history.length}
							<p class="faint more">Mostrando as últimas {history.length}.</p>
						{/if}
					</div>
				{/if}
			{/if}
		</section>
	</div>

	<div class="dr-foot">
		{#if selected.dueToday}
			<a class="btn btn-primary" href={resolve('/flashcards/estudar')}
				><Icon name="play" size="sm" />Revisar agora<kbd>R</kbd></a
			>
		{:else}
			<span class="next">
				{selected.status === 'conhecido'
					? 'Fora da revisão'
					: selected.review === 'nova'
						? 'Entra na revisão como nova'
						: `Próxima revisão ${selected.next}`}
			</span>
		{/if}
		{#if position}
			<span class="navhint"><kbd>J</kbd><kbd>K</kbd> próxima/anterior</span>
		{/if}
	</div>
</section>

<style>
	/* Painel lateral: preso à janela, por cima do canto direito da lista. */
	.drawer-scrim {
		display: none;
	}
	.drawer {
		position: fixed;
		z-index: 45;
		top: 12px;
		right: 12px;
		bottom: 12px;
		width: 440px;
		max-width: calc(100vw - 24px);
		background: var(--raise-2);
		border-radius: var(--r-l);
		box-shadow: var(--sh-pop);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		/* Sem preencher depois: transform no painel prenderia o Popover fixo do mobile. */
		animation: drawerIn 0.4s var(--ease) backwards;
	}
	.drawer:focus {
		outline: none;
	}
	@keyframes drawerIn {
		from {
			transform: translateX(calc(100% + 24px));
		}
	}

	/* Cabeçalho: ↑/↓ e posição, ⋯ e ×. */
	.dr-h {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 10px 10px 0 12px;
		position: relative;
		flex: none;
	}
	.grab {
		display: none;
	}
	.nav {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.icon-btn.sm {
		width: 30px;
		height: 30px;
	}
	.icon-btn:disabled {
		opacity: 0.35;
		cursor: default;
		background: none;
	}
	.icon-btn.on {
		background: var(--press);
		color: var(--ink);
	}
	.pos {
		margin-left: 6px;
		font-size: 12.5px;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
	.sp {
		flex: 1;
	}
	.dr-h :global(.pop) {
		padding: 6px;
	}
	.menu {
		display: flex;
		flex-direction: column;
	}
	.mi {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 7px 10px;
		border: 0;
		border-radius: var(--r-m);
		background: none;
		color: var(--ink);
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}
	.mi:hover,
	.mi:focus-visible {
		background: var(--hover);
		outline: none;
	}
	.mi :global(.ic) {
		color: var(--ink-3);
	}
	.mi > span {
		flex: 1;
		min-width: 0;
	}
	.mi small {
		display: block;
		font-size: 12px;
		color: var(--ink-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mi.danger,
	.mi.danger :global(.ic) {
		color: var(--terra-ink);
	}
	.sep {
		height: 1px;
		background: var(--line);
		margin: 6px 4px;
	}
	.decks {
		padding: 8px;
	}

	.dr-body {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 12px 26px 28px;
	}

	/* Topo: status, palavra, leitura + Ouvir, tradução. */
	.eye {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 13px;
		font-weight: 500;
		color: var(--ink-3);
	}
	.eye.late {
		color: var(--terra-ink);
	}
	.dot-sep {
		opacity: 0.6;
	}
	.eye .str {
		margin-left: 2px;
		height: 12px;
	}
	.eye .str :global(i) {
		height: 12px;
	}
	.st {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 2px;
		border-radius: 50%;
		background: var(--line-2);
	}
	.st[data-st='hoje'] {
		background: var(--salvia);
	}
	.st[data-st='atrasada'] {
		background: var(--terra-ink);
	}
	.st[data-st='aprendendo'] {
		background: none;
		box-shadow: inset 0 0 0 1.5px var(--salvia);
	}
	.st[data-st='nova'] {
		background: none;
		box-shadow: inset 0 0 0 1.5px var(--ink-3);
		opacity: 0.7;
	}
	.teimosa {
		display: inline-block;
		margin-left: 4px;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--gold-soft);
		color: var(--gold-ink);
		font-size: 12px;
	}
	.head {
		margin-top: 4px;
	}
	.head :global(.ed.big),
	.head :global(.f-word) {
		font-size: 38px;
		line-height: 1.12;
		letter-spacing: -0.03em;
	}
	.head > :global(.lemma) {
		display: inline-block;
		max-width: 100%;
		min-width: 50%;
	}
	.ipa {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 4px;
	}
	.ipa .reading {
		min-width: 0;
		color: var(--ink-3);
	}
	.reading :global(.ed),
	.reading :global(input) {
		font-size: 15px;
	}
	.listen {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		height: 28px;
		padding: 0 11px 0 9px;
		border: 0;
		border-radius: var(--r-s);
		font-size: 13.5px;
		font-weight: 500;
		color: var(--accent-ink);
		background: var(--sel);
		cursor: pointer;
		transition: background-color 0.15s;
	}
	.listen:hover {
		background: var(--press);
	}
	.tr {
		margin-top: 12px;
	}
	.tr :global(.ed),
	.tr :global(input) {
		font-size: 19px;
	}
	.leech-note {
		margin: 10px 0 0;
		color: var(--ink-2);
		font-size: 13.5px;
	}

	/* Campos sem a moldura de formulário: o rótulo some (fica para o leitor de tela). */
	.bare :global(.field) {
		display: block;
		padding: 0;
		border: 0;
	}
	.bare :global(.field > .ic) {
		display: none;
	}
	.bare :global(.lbl) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.ipa .bare :global(.ed) {
		padding-right: 22px;
	}

	/* Seções. */
	.sec {
		margin-top: 26px;
	}
	.sec h3 {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin: 0 0 10px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ink-3);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.aside {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 500;
		font-size: 12.5px;
		color: var(--ink-3);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.note :global(.ed),
	.note :global(textarea) {
		font-size: 14.5px;
		line-height: 1.55;
		color: var(--ink-2);
	}
	.tags {
		margin-top: 8px;
	}
	.tags :global(.ed) {
		font-size: 13.5px;
	}
	.media {
		margin-top: 10px;
	}
	.media.has-img :global(.media-field) {
		position: relative;
		display: block;
	}
	.media.has-img :global(.thumb) {
		display: block;
		width: 100%;
		height: auto;
		max-height: 220px;
		object-fit: cover;
		border-radius: var(--r-m);
	}
	.media.has-img :global(.acts) {
		position: absolute;
		right: 8px;
		bottom: 8px;
	}
	.media :global(.pick) {
		border-color: var(--line);
		color: var(--ink-3);
	}
	.small {
		margin: 0;
		font-size: 14px;
	}

	.quote {
		padding: 12px 14px;
		border-radius: var(--r-m);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.quote + .quote {
		margin-top: 6px;
	}
	.qs {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12.5px;
		color: var(--ink-3);
		margin-bottom: 6px;
	}
	.qs .src {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.qs time {
		flex: none;
	}
	.quote p {
		margin: 0;
		font-size: 14.5px;
		line-height: 1.5;
	}
	.quote .pt {
		color: var(--ink-3);
		font-size: 13px;
		margin-top: 4px;
	}

	.cards {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fc {
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr) auto;
		gap: 12px;
		align-items: center;
		padding: 10px 12px;
		border-radius: var(--r-m);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.dir {
		display: grid;
		place-items: center;
		width: 38px;
		height: 32px;
		border-radius: 7px;
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		font: 700 10px/1 var(--f-head);
		letter-spacing: 0.02em;
		color: var(--ink-2);
	}
	.fc-t b {
		display: block;
		font-weight: 500;
		font-size: 14px;
	}
	.fc-t span {
		display: block;
		font-size: 12.5px;
		color: var(--ink-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nx {
		text-align: right;
		font-size: 13px;
		color: var(--ink-2);
	}
	.nx small {
		display: block;
		font-size: 12px;
		color: var(--ink-3);
	}

	.sec h3:has(.hist-tg) {
		display: block;
	}
	.hist-tg {
		display: flex;
		align-items: center;
		gap: 10px;
		width: calc(100% + 12px);
		margin: -4px -6px;
		padding: 4px 6px;
		border: 0;
		border-radius: 6px;
		background: none;
		font: inherit;
		color: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		cursor: pointer;
	}
	.hist-tg:hover {
		background: var(--hover);
	}
	.hist-tg .aside {
		margin-left: auto;
	}
	.hist-tg :global(.ic) {
		transition: transform 0.2s var(--ease);
	}
	.hist-tg[aria-expanded='true'] :global(.ic) {
		transform: rotate(90deg);
	}
	.chart {
		display: flex;
		align-items: flex-end;
		gap: 5px;
		height: 64px;
		margin-top: 14px;
		padding: 0 2px;
		border-bottom: 1px solid var(--line);
	}
	.chart i {
		flex: 1;
		max-width: 28px;
		border-radius: 3px 3px 0 0;
		background: var(--g);
	}
	.chart-x {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		margin-top: 5px;
		font-size: 11.5px;
		color: var(--ink-3);
	}
	.legend {
		display: flex;
		gap: 12px;
		margin-top: 8px;
		font-size: 12px;
		color: var(--ink-3);
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.legend span::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: var(--g);
	}
	.hist {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
	}
	.hist li {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr) auto;
		gap: 10px;
		align-items: center;
		padding: 7px 0;
		font-size: 13.5px;
	}
	.hist li + li {
		border-top: 1px solid var(--line);
	}
	.hist time,
	.hist .iv,
	.hist small {
		color: var(--ink-3);
		font-size: 12.5px;
	}
	.hist small {
		margin-left: 8px;
	}
	.more {
		margin: 8px 0 0;
		font-size: 12.5px;
	}

	/* Rodapé fixo. */
	.dr-foot {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
		padding: 12px 16px;
		border-top: 1px solid var(--line);
	}
	.dr-foot .btn-primary {
		flex: 1;
	}
	.next {
		flex: 1;
		font-size: 14px;
		color: var(--ink-2);
	}
	.navhint {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: var(--ink-3);
		white-space: nowrap;
	}
	.navhint kbd {
		min-width: 20px;
		height: 20px;
		font-size: 11.5px;
	}

	/* Mobile: folha inferior, meia altura; arrasta para cheia ou para baixo para fechar. */
	@media (max-width: 768px) {
		.drawer-scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 50;
			background: var(--scrim);
			animation: fade 0.25s var(--ease) both;
		}
		.drawer {
			z-index: 51;
			top: auto;
			left: 0;
			right: 0;
			bottom: 0;
			width: auto;
			max-width: none;
			height: 58dvh;
			border-radius: 22px 22px 0 0;
			animation-name: sheetIn;
			transition: height 0.32s var(--ease);
		}
		.drawer.full {
			height: calc(100dvh - var(--safe-t) - 12px);
		}
		.drawer.dragging {
			transition: none;
		}
		.dr-h {
			flex-wrap: wrap;
			padding: 0 10px 0 18px;
			touch-action: none;
			cursor: grab;
		}
		.grab {
			display: block;
			flex-basis: 100%;
			width: 38px;
			max-width: 38px;
			height: 5px;
			margin: 8px auto 6px;
			border-radius: 99px;
			background: var(--line-2);
		}
		.nav,
		.navhint {
			display: none;
		}
		.dr-body {
			padding: 2px 22px 22px;
		}
		.head :global(.ed.big),
		.head :global(.f-word) {
			font-size: 34px;
		}
		.dr-foot {
			padding-bottom: calc(12px + var(--safe-b));
		}
		.dr-foot .btn-primary {
			height: 46px;
			font-size: 15px;
		}
		.dr-foot .btn-primary kbd {
			display: none;
		}
	}
	@keyframes sheetIn {
		from {
			transform: translateY(105%);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
