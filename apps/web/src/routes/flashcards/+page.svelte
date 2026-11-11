<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount, tick, untrack } from 'svelte';
	import { applyAction, enhance, type SubmitFunction } from '$app/forms';
	import { invalidate, invalidateAll } from '$app/navigation';
	import {
		GRADE_LABELS,
		GRADES,
		REVIEW_DEPENDENCY,
		answerItem,
		highlightParts,
		reviewMedia,
		sessionProgress,
		startSession,
		undoLast,
		type FichaReview,
		type Grade,
		type ItemReview
	} from '#lib/review.ts';
	import { FICHA_KIND_LABELS, renderCloze } from '#lib/fichas.ts';
	import { langAttrs, languageInline, pickVoice } from '#lib/languages.ts';
	import { isTypingTarget, shortcutFor } from '#lib/shortcuts.ts';
	import { toast } from '#lib/ui/app-state.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Mark from '#lib/ui/Mark.svelte';
	import { ORIGIN_ICONS } from '#lib/ui/origins.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// A sessão vive no navegador; recarregar a página começa outra com o que vencer.
	let session = $state(startSession(untrack(() => data.queue)));
	let flipped = $state(false);
	let pending = $state(false);
	let hit = $state<Grade | null>(null);
	let message = $state<string | null>(null);
	let canSpeak = $state(false);

	let rateForm: HTMLFormElement | undefined = $state();
	let undoForm: HTMLFormElement | undefined = $state();
	let showButton: HTMLButtonElement | undefined = $state();
	let grades: HTMLElement | undefined = $state();

	const current = $derived(session.queue[0]);
	const progress = $derived(sessionProgress(session));
	const total = $derived(session.answered + session.queue.length);
	const languageName = $derived(languageInline(data.language, data.uiLanguage));
	/** Texto no idioma estudado e na língua nativa (lang e dir para leitor de tela e RTL). */
	const study = $derived(langAttrs(data.language));
	const native = $derived(data.nativeLanguage ? langAttrs(data.nativeLanguage) : {});
	const remaining = $derived(
		data.shell?.summary?.languages.find((l) => l.language === data.language)?.toReview ?? 0
	);

	onMount(() => {
		canSpeak = 'speechSynthesis' in window;
	});

	async function flip() {
		if (!current || flipped) return;
		flipped = true;
		await tick();
		grades?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
	}

	async function showFront() {
		flipped = false;
		hit = null;
		await tick();
		showButton?.focus({ preventScroll: true });
	}

	// Trocar a tag do filtro começa outra sessão com a fila nova.
	let sessionTag = untrack(() => data.tag);
	$effect(() => {
		if (data.tag === sessionTag) return;
		sessionTag = data.tag;
		session = startSession(data.queue);
		flipped = false;
		hit = null;
	});

	const tagQuery = (tag: string | null): `?${string}` | '' =>
		tag ? `?tag=${encodeURIComponent(tag)}` : '';

	/** Faces da ficha: o que pergunta e o que responde, já em HTML sanitizado. */
	function fichaFaces(f: FichaReview): { ask: string; answer: string; extra: string } {
		if (f.kind === 'lacuna') {
			return {
				ask: renderCloze(f.front, f.ord, false),
				answer: renderCloze(f.front, f.ord, true),
				extra: f.back
			};
		}
		if (f.kind === 'inverso') return { ask: f.back, answer: f.front, extra: '' };
		return { ask: f.front, answer: f.back, extra: '' };
	}

	// Mídia do flashcard atual, por lado (reviewMedia segue o ADR 0003).
	const media = $derived(current ? reviewMedia(current) : null);
	let player: HTMLAudioElement | null = null;

	function play(url: string | null) {
		if (!url) return;
		player?.pause();
		player = new Audio(url);
		// Autoplay bloqueado pelo navegador (sem interação ainda) não é erro.
		player.play().catch(() => {});
	}

	// Com a opção do perfil ligada, o áudio toca sozinho quando o lado dele aparece.
	// No verso, só se for outro áudio (o Reconhecer já tocou o mesmo na frente).
	$effect(() => {
		if (!data.autoplayAudio || !media) return;
		const audio = flipped
			? media.answer.audio !== media.ask.audio
				? media.answer.audio
				: null
			: media.ask.audio;
		untrack(() => play(audio));
	});

	function speak(audio: string | null = null) {
		if (audio) return play(audio);
		if (!current || current.source !== 'item' || !canSpeak) return;
		const utterance = new SpeechSynthesisUtterance(current.lemma);
		utterance.lang = current.language;
		const voice = pickVoice(speechSynthesis.getVoices(), current.language);
		if (voice) utterance.voice = voice;
		speechSynthesis.cancel();
		speechSynthesis.speak(utterance);
	}

	function rate(grade: Grade) {
		rateForm?.requestSubmit(rateForm.querySelector<HTMLButtonElement>(`[value="${grade}"]`));
	}

	function onkeydown(e: KeyboardEvent) {
		const action = shortcutFor(e, {
			screen: 'flashcards',
			typing: isTypingTarget(e.target),
			dialogOpen: !!document.querySelector('dialog[open], details.lang-wrap[open]'),
			flipped
		});
		if (!action) return;
		if (action.type === 'virar' && current) flip();
		else if (action.type === 'nota' && current && !pending) rate(action.grade);
		else if (action.type === 'desfazer' && session.last && !pending) undoForm?.requestSubmit();
		else return;
		e.preventDefault();
	}

	const submitRate: SubmitFunction = ({ cancel, submitter }) => {
		if (pending) return cancel();
		pending = true;
		message = null;
		hit = Number(submitter?.getAttribute('value')) as Grade;
		return async ({ result }) => {
			pending = false;
			if (result.type === 'success' && result.data && 'item' in result.data) {
				const { item, logId, rating } = result.data;
				session = answerItem(session, {
					rating: rating as Grade,
					logId,
					updated: item,
					now: new Date()
				});
				await showFront();
				invalidate(REVIEW_DEPENDENCY);
			} else if (result.type === 'failure') {
				hit = null;
				message = (result.data as { message?: string } | undefined)?.message ?? null;
				message ??= 'Não deu para salvar agora.';
				const failed = result.data as { flashcardId?: string } | undefined;
				// Flashcard avaliado em outra aba, item apagado ou marcado como conhecido: sai da fila.
				if (result.status === 409 || result.status === 404) {
					session.queue = session.queue.filter((i) => i.flashcardId !== failed?.flashcardId);
					await showFront();
					invalidate(REVIEW_DEPENDENCY);
				}
			} else if (result.type === 'redirect') {
				await applyAction(result);
			} else {
				hit = null;
				message = 'Não deu para salvar agora. Tente de novo.';
			}
		};
	};

	const submitUndo: SubmitFunction = ({ cancel }) => {
		if (pending) return cancel();
		pending = true;
		message = null;
		return async ({ result }) => {
			pending = false;
			if (result.type === 'success' && result.data && 'undone' in result.data) {
				session = undoLast(session, result.data.undone);
				flipped = true;
				toast('Última avaliação desfeita');
				invalidate(REVIEW_DEPENDENCY);
			} else if (result.type === 'failure') {
				message = (result.data as { message?: string } | undefined)?.message ?? null;
				message ??= 'Não deu para desfazer agora.';
				session.last = null;
			} else if (result.type === 'redirect') {
				await applyAction(result);
			} else {
				message = 'Não deu para desfazer agora.';
			}
		};
	};

	async function continueReviewing() {
		await invalidateAll();
		session = startSession(data.queue);
		flipped = false;
	}
</script>

<svelte:window {onkeydown} />

<svelte:head>
	<title>Flashcards · Linguetta</title>
</svelte:head>

{#snippet source(item: ItemReview, audio: string | null)}
	<div class="fh">
		<span class="src">
			<Icon name={ORIGIN_ICONS[item.origin ?? 'manual']} size="sm" />
			{item.sourceDetail || 'Guardada à mão'}
		</span>
		{#if audio || canSpeak}
			<button
				class="icon-btn"
				class:rec={!!audio}
				type="button"
				onclick={() => speak(audio)}
				aria-label="Ouvir"
				title={audio ? 'Ouvir a pronúncia guardada' : 'Ouvir'}
			>
				<Icon name="sound" size="sm" />
			</button>
		{/if}
	</div>
{/snippet}

{#snippet picture(url: string | null)}
	{#if url}<img class="rv-img" src={url} alt="" />{/if}
{/snippet}

{#snippet sentence(item: ItemReview, underline: boolean)}
	{#if item.sentence}
		<p class="ctx" {...study}>
			{#each highlightParts(item.sentence, item.highlight || item.lemma, item.language) as part, i (i)}
				{#if part.hit}<u class:plain={!underline}>{part.text}</u>{:else}{part.text}{/if}
			{/each}
		</p>
	{/if}
{/snippet}

{#snippet fichaHead(f: FichaReview, audio: string | null)}
	<div class="fh">
		<span class="src">
			<Icon name="cards" size="sm" />
			Ficha{#if f.tags[0]}&nbsp;· {f.tags[0]}{/if}
		</span>
		<span class="src">
			{f.kind === 'lacuna' ? `Lacuna ${f.ord}` : FICHA_KIND_LABELS[f.kind]}
			{#if audio}
				<button
					class="icon-btn rec"
					type="button"
					onclick={() => play(audio)}
					aria-label="Ouvir"
					title="Ouvir"><Icon name="sound" size="sm" /></button
				>
			{/if}
		</span>
	</div>
{/snippet}

{#snippet tagBar()}
	{#if data.tags.length > 0 || data.tag}
		<nav class="tags" aria-label="Filtrar por tag">
			<a
				class="chip"
				class:on={!data.tag}
				href={resolve(`/flashcards${tagQuery(null)}`)}
				aria-current={!data.tag}>Tudo</a
			>
			{#each data.tags as tag (tag)}
				<a
					class="chip"
					class:on={data.tag === tag}
					href={resolve(`/flashcards${tagQuery(tag)}`)}
					aria-current={data.tag === tag}><Icon name="tag" size="sm" />{tag}</a
				>
			{/each}
		</nav>
	{/if}
{/snippet}

<form method="POST" action="?/undo" use:enhance={submitUndo} bind:this={undoForm} hidden>
	<input type="hidden" name="logId" value={session.last?.logId ?? ''} />
</form>

{#if session.answered === 0 && !current}
	<div class="ph">
		<div><h1>Flashcards</h1></div>
		<a class="btn btn-soft" href={resolve('/flashcards/fichas')}><Icon name="cards" />Fichas</a>
	</div>
	{@render tagBar()}
	<div class="empty">
		<div>
			<Mark class="mark mark-hero" />
			<h2>Nada para revisar</h2>
			{#if data.tag}
				<p>Nenhum flashcard com a tag “{data.tag}” para agora.</p>
			{:else if data.nextDue}
				<p>O próximo flashcard em {languageName} volta {data.nextDue}.</p>
			{:else}
				<p>
					Quando você guardar palavras ou criar fichas em {languageName}, elas aparecem aqui no dia
					certo.
				</p>
			{/if}
			<div class="acts">
				<a
					class="btn btn-primary btn-lg"
					href={resolve('/flashcards?guardar')}
					data-sveltekit-noscroll><Icon name="plus" />Guardar palavra</a
				>
				<a class="btn btn-soft btn-lg" href={resolve('/flashcards/fichas/nova')}
					><Icon name="cards" />Nova ficha</a
				>
			</div>
		</div>
	</div>
{:else}
	<div class="rv">
		<div class="rv-top">
			<span class="l"><Icon name="repeat" size="sm" />Revisão de hoje</span>
			<span
				class="bar"
				role="progressbar"
				aria-label="Progresso da revisão"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={current ? progress : 100}
				><i style:width="{current ? progress : 100}%"></i></span
			>
			<span class="r">
				<span data-testid="contador">{current ? session.answered + 1 : total} de {total}</span>
				<a class="icon-btn" href={resolve('/inicio')} aria-label="Sair da revisão" title="Sair"
					><Icon name="x" /></a
				>
			</span>
		</div>
		{#if session.answered === 0}{@render tagBar()}{/if}

		{#if current}
			<div class="rv-stage">
				{#key current.flashcardId}
					<div class="card3d enter" class:flipped data-testid="flashcard">
						<div class="card-in">
							{#if current.source === 'ficha'}
								{@const faces = fichaFaces(current)}
								<section class="face front" inert={flipped} aria-label="Frente do flashcard">
									{@render fichaHead(current, media?.ask.audio ?? null)}
									<div class="mid">
										{@render picture(media?.ask.image ?? null)}
										<!-- HTML sanitizado no servidor (sanitizeFichaHtml): só b, i e br. -->

										<!-- eslint-disable-next-line svelte/no-at-html-tags -->
										<div class="ficha-face">{@html faces.ask}</div>
									</div>
								</section>
								<section class="face back" inert={!flipped} aria-label="Verso do flashcard">
									{@render fichaHead(current, media?.answer.audio ?? null)}
									<div class="mid">
										{@render picture(media?.answer.image ?? null)}
										<!-- eslint-disable-next-line svelte/no-at-html-tags -->
										<div class="ficha-face">{@html faces.answer}</div>
										{#if faces.extra}
											<div class="divider"></div>
											<!-- eslint-disable-next-line svelte/no-at-html-tags -->
											<div class="small-w ficha-extra">{@html faces.extra}</div>
										{/if}
									</div>
								</section>
							{:else}
								<section class="face front" inert={flipped} aria-label="Frente do flashcard">
									{@render source(current, media?.ask.audio ?? null)}
									<div class="mid">
										{#if current.kind === 'produzir'}
											{@render picture(media?.ask.image ?? null)}
											<div class="ask">Como se diz em {languageName}?</div>
											<div class="word" {...native}>{current.sense}</div>
										{:else}
											{#if current.reading}<div class="reading" {...study}>
													{current.reading}
												</div>{/if}
											<div class="word" {...study}>{current.lemma}</div>
											{#if current.ipa}<div class="ipa">{current.ipa}</div>{/if}
										{/if}
									</div>
									{#if current.kind === 'reconhecer'}{@render sentence(current, true)}{/if}
								</section>
								<section class="face back" inert={!flipped} aria-label="Verso do flashcard">
									{@render source(current, media?.answer.audio ?? null)}
									<div class="mid">
										{@render picture(media?.answer.image ?? null)}
										{#if current.kind === 'produzir'}
											<div class="small-w" {...native}>{current.sense}</div>
											{#if current.reading}<div class="reading" {...study}>
													{current.reading}
												</div>{/if}
											<div class="tr" {...study}>{current.lemma}</div>
											{#if current.ipa}<div class="ipa">{current.ipa}</div>{/if}
										{:else}
											<div class="small-w">
												{#if current.reading}<span class="rd" {...study}>{current.reading}</span
													>{/if}
												<b {...study}>{current.lemma}</b>{#if current.ipa}&nbsp;· {current.ipa}{/if}
											</div>
											<div class="tr" class:none={!current.sense} {...current.sense ? native : {}}>
												{current.sense || 'Sem tradução guardada'}
											</div>
										{/if}
									</div>
									{@render sentence(current, false)}
								</section>
							{/if}
						</div>
					</div>
				{/key}

				<div class="rv-acts">
					<form
						class="grades"
						class:shown={flipped}
						method="POST"
						action="?/rate"
						use:enhance={submitRate}
						bind:this={rateForm}
						aria-label="Como foi?"
						hidden={!flipped}
					>
						<input type="hidden" name="flashcardId" value={current.flashcardId} />
						<input type="hidden" name="reps" value={current.reps} />
						<div class="grade-row" bind:this={grades}>
							{#each GRADES as grade (grade)}
								<button
									class="gbtn"
									class:hit={hit === grade}
									data-g={grade}
									name="rating"
									value={grade}
									disabled={pending}
								>
									<b>{GRADE_LABELS[grade]}</b>
									<span>{current.intervals[grade]}</span>
									<kbd aria-hidden="true">{grade}</kbd>
								</button>
							{/each}
						</div>
					</form>
					{#if !flipped}
						<button
							class="btn btn-primary btn-lg show"
							type="button"
							onclick={flip}
							bind:this={showButton}>Mostrar resposta<kbd aria-hidden="true">Espaço</kbd></button
						>
					{/if}
				</div>
			</div>
			<div class="rv-hint" aria-hidden="true">
				<span><kbd>Espaço</kbd> vira</span>
				<span><kbd>1</kbd>–<kbd>4</kbd> avalia</span>
				<span><kbd>Z</kbd> desfaz</span>
			</div>
		{:else}
			<section class="done" aria-labelledby="fim-titulo">
				<div>
					<div class="eyebrow">Revisão concluída</div>
					<h2 id="fim-titulo">{remaining > 0 ? 'Pronto por agora' : 'Pronto por hoje'}</h2>
					<p>
						Você revisou {session.answered}
						{session.answered === 1 ? 'flashcard' : 'flashcards'}.
						{#if remaining === 0}Até a próxima.{/if}
					</p>
					<div class="sum" data-testid="resumo">
						{#each GRADES as grade (grade)}
							<div data-g={grade}>
								<b>{session.byGrade[grade]}</b><span>{GRADE_LABELS[grade]}</span>
							</div>
						{/each}
					</div>
					{#if remaining > 0}
						<div class="tomorrow">
							Ainda {remaining === 1 ? 'tem 1 flashcard' : `tem ${remaining} flashcards`} para revisar.
						</div>
					{:else if data.nextDue}
						<div class="tomorrow">A próxima volta {data.nextDue}.</div>
					{/if}
					<div class="acts">
						{#if remaining > 0}
							<button class="btn btn-primary btn-lg" type="button" onclick={continueReviewing}
								>Continuar revisando</button
							>
							<a class="btn btn-soft btn-lg" href={resolve('/inicio')}>Voltar ao início</a>
						{:else}
							<a class="btn btn-primary btn-lg" href={resolve('/inicio')}>Voltar ao início</a>
							<a class="btn btn-soft btn-lg" href={resolve('/palavras')}>Ver minhas palavras</a>
						{/if}
					</div>
				</div>
			</section>
		{/if}
	</div>
{/if}

{#if message}<p class="aviso" role="alert">{message}</p>{/if}

{#if session.last && current}
	<button
		class="btn btn-soft undo"
		type="button"
		disabled={pending}
		onclick={() => undoForm?.requestSubmit()}
	>
		<Icon name="undo" size="sm" />Desfazer<kbd aria-hidden="true">Z</kbd>
	</button>
{/if}

<style>
	.rv {
		display: flex;
		flex-direction: column;
		min-height: calc(100vh - 20px - 100px);
	}
	.rv-top {
		display: grid;
		grid-template-columns: 1fr minmax(0, 520px) 1fr;
		align-items: center;
		gap: 24px;
	}
	.rv-top .l {
		font: 500 14px var(--f-body);
		color: var(--ink-2);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.rv-top .r {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 10px;
		font: 500 13px var(--f-body);
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
	}
	.rv-stage {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 36px 0 12px;
	}

	.card3d {
		width: min(580px, 100%);
		height: 340px;
		perspective: 1600px;
	}
	.card3d.enter {
		animation: cardIn 0.4s var(--ease) both;
	}
	@keyframes cardIn {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}
	.card-in {
		position: relative;
		width: 100%;
		height: 100%;
		transform-style: preserve-3d;
		transition: transform 0.65s var(--ease);
	}
	.flipped .card-in {
		transform: rotateY(180deg);
	}
	.face {
		position: absolute;
		inset: 0;
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
		background: var(--raise);
		border-radius: var(--r-l);
		box-shadow: var(--sh-lift);
		padding: 20px 26px 26px;
		display: flex;
		flex-direction: column;
	}
	:global(.tema-escuro) .face {
		background: var(--raise-2);
	}
	.face.back {
		transform: rotateY(180deg);
	}
	.fh {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 32px;
	}
	.src {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12.5px;
		color: var(--ink-3);
		min-width: 0;
	}
	.mid {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-height: 0;
	}
	.word {
		font: 600 56px/1.05 var(--f-head);
		letter-spacing: -0.035em;
		overflow-wrap: anywhere;
	}
	.ask {
		font-size: 14px;
		color: var(--ink-3);
		margin-bottom: 12px;
	}
	.front .ask + .word {
		font-size: 40px;
		line-height: 1.15;
	}
	/* Leitura (furigana, pinyin) logo acima do lema. */
	.reading {
		margin-bottom: 4px;
		color: var(--ink-3);
		font: 400 15px/1.3 var(--f-body);
		letter-spacing: 0.02em;
	}
	.rd {
		display: block;
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.ipa {
		margin-top: 10px;
		color: var(--ink-3);
		font: 400 15px var(--f-body);
	}
	.ctx {
		text-align: center;
		font-size: 15.5px;
		line-height: 1.55;
		color: var(--ink-2);
		max-width: 460px;
		margin: 0 auto;
		text-wrap: balance;
	}
	.ctx u {
		text-decoration: none;
		color: var(--ink);
		font-weight: 500;
		box-shadow: inset 0 -1.5px 0 var(--line-2);
	}
	.ctx u.plain {
		box-shadow: none;
	}
	.small-w {
		font: 400 14px var(--f-body);
		color: var(--ink-3);
	}
	.small-w b {
		font: 600 15px var(--f-head);
		color: var(--ink-2);
	}
	.tr {
		font: 600 38px/1.15 var(--f-head);
		letter-spacing: -0.03em;
		margin-top: 8px;
		overflow-wrap: anywhere;
	}
	.tr.none {
		font-size: 22px;
		color: var(--ink-3);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		margin: 18px auto 0;
		max-width: 580px;
	}
	.ph + .tags {
		margin: -12px 0 0;
		justify-content: flex-start;
	}
	.rv-img {
		display: block;
		max-width: 100%;
		max-height: 180px;
		margin: 0 auto 14px;
		border-radius: var(--r-m);
		object-fit: contain;
	}
	.icon-btn.rec {
		color: var(--accent, var(--ink));
	}
	.ficha-face {
		font: 400 18px/1.45 var(--f-body);
		max-width: 460px;
		overflow-wrap: anywhere;
		overflow-y: auto;
	}
	.ficha-face :global(b) {
		font-weight: 650;
	}
	.ficha-face :global(.cloze) {
		display: inline-block;
		min-width: 64px;
		border-bottom: 2px solid var(--ink-3);
		color: var(--ink-3);
	}
	.ficha-face :global(.cloze.open) {
		color: var(--ink);
		border-color: var(--primary);
		font-weight: 650;
	}
	.divider {
		width: 40px;
		height: 1px;
		background: var(--line-2);
		margin: 14px auto;
	}
	.ficha-extra {
		max-width: 460px;
		line-height: 1.5;
	}

	.rv-acts {
		margin-top: 28px;
		min-height: 80px;
		display: grid;
		place-items: start center;
		width: min(580px, 100%);
	}
	.rv-acts .show {
		width: 280px;
	}
	.grades {
		width: 100%;
	}
	.grades[hidden] {
		display: none;
	}
	.grade-row {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 8px;
		width: 100%;
		animation: viewIn 0.3s var(--ease) both;
	}
	.gbtn {
		position: relative;
		height: 64px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--raise);
		box-shadow: var(--sh-card);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		transition:
			box-shadow 0.18s,
			background-color 0.18s;
	}
	:global(.tema-escuro) .gbtn {
		background: rgba(247, 241, 230, 0.05);
	}
	.gbtn:hover:not(:disabled) {
		background: var(--tile);
	}
	:global(.tema-escuro) .gbtn:hover:not(:disabled) {
		background: rgba(247, 241, 230, 0.09);
	}
	.gbtn:active,
	.gbtn.hit {
		background: var(--sel);
	}
	.gbtn:disabled {
		cursor: default;
	}
	.gbtn b {
		font: 500 15px/1.2 var(--f-body);
	}
	.gbtn span {
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.gbtn kbd {
		position: absolute;
		top: 7px;
		right: 7px;
		min-width: 18px;
		height: 18px;
		font-size: 10.5px;
	}
	.rv-hint {
		text-align: center;
		font-size: 12.5px;
		color: var(--ink-3);
		display: flex;
		gap: 16px;
		justify-content: center;
		align-items: center;
	}
	.rv-hint span {
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}

	.done {
		flex: 1;
		display: grid;
		place-items: center;
		text-align: center;
		padding: 30px 0;
		animation: viewIn 0.5s var(--ease) both;
	}
	.done .eyebrow {
		justify-content: center;
		margin-bottom: 14px;
	}
	.done h2 {
		margin: 0;
		font: 600 44px/1.1 var(--f-head);
		letter-spacing: -0.035em;
	}
	.done p {
		color: var(--ink-2);
		margin: 12px 0 36px;
		font-size: 16px;
		text-wrap: pretty;
	}
	.sum {
		display: inline-grid;
		grid-template-columns: repeat(4, 112px);
		margin-bottom: 30px;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}
	.sum div {
		padding: 18px 10px 16px;
	}
	.sum div + div {
		box-shadow: inset 1px 0 0 var(--line);
	}
	.sum b {
		display: block;
		font: 600 30px/1 var(--f-head);
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}
	.sum span {
		font-size: 12.5px;
		color: var(--ink-3);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
	}
	.sum span::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--g);
	}
	.tomorrow {
		font-size: 13px;
		color: var(--ink-3);
		margin-bottom: 24px;
	}
	.done .acts {
		display: flex;
		gap: 8px;
		justify-content: center;
	}

	.aviso {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		margin: 0;
		padding: 10px 16px;
		border-radius: var(--r-m);
		background: var(--toast-bg);
		color: var(--toast-ink);
		font-size: 14px;
	}
	.undo {
		position: fixed;
		right: 32px;
		bottom: 28px;
	}

	@media (prefers-reduced-motion: reduce) {
		.card-in {
			transition: none;
		}
		.card3d.enter,
		.grade-row,
		.done {
			animation: none;
		}
	}

	@media (max-width: 768px) {
		.rv {
			min-height: calc(100dvh - 50px - var(--tab-h) - 110px);
		}
		.rv-top {
			grid-template-columns: 1fr auto;
			grid-template-areas: 'l r' 'w w';
			gap: 12px;
		}
		.rv-top .l {
			grid-area: l;
		}
		.rv-top .r {
			grid-area: r;
		}
		.rv-top .bar {
			grid-area: w;
		}
		.rv-stage {
			padding: 22px 0 4px;
			justify-content: flex-start;
		}
		.card3d {
			height: 380px;
		}
		.face {
			padding: 16px 20px 22px;
		}
		.word {
			font-size: 44px;
		}
		.front .ask + .word {
			font-size: 32px;
		}
		.ctx {
			font-size: 15px;
		}
		.tr {
			font-size: 31px;
		}
		.rv-acts {
			margin-top: 18px;
			min-height: 0;
		}
		.rv-acts .show {
			width: 100%;
		}
		.grade-row {
			gap: 6px;
		}
		.gbtn {
			height: 60px;
		}
		.gbtn kbd {
			display: none;
		}
		.gbtn b {
			font-size: 14.5px;
		}
		.rv-hint {
			display: none;
		}
		.done h2 {
			font-size: 34px;
		}
		.sum {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			width: 100%;
		}
		.done .acts {
			flex-direction: column;
		}
		.undo {
			right: 16px;
			bottom: calc(var(--tab-h) + 16px);
		}
		.aviso {
			bottom: calc(var(--tab-h) + 16px);
		}
	}
</style>
