<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { applyAction, enhance } from '$app/forms';
	import { invalidate, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import mascote from '#lib/assets/mascote.png';
	import {
		GRADE_LABELS,
		GRADES,
		REVIEW_DEPENDENCY,
		SOURCE_LABELS,
		STATE_NEW,
		answerItem,
		highlightParts,
		sessionProgress,
		startSession,
		undoLast,
		type Grade
	} from '#lib/review.ts';
	import { LANG_LABELS } from '#lib/words.ts';
	import type { PageProps, SubmitFunction } from './$types';

	let { data }: PageProps = $props();

	// A sessão vive no navegador; recarregar a página começa outra com o que vencer.
	let session = $state(startSession(untrack(() => data.queue)));
	let flipped = $state(false);
	let pending = $state(false);
	let message = $state<string | null>(null);
	let canSpeak = $state(false);

	let rateForm: HTMLFormElement | undefined = $state();
	let undoForm: HTMLFormElement | undefined = $state();
	let frontButton: HTMLButtonElement | undefined = $state();
	let back: HTMLElement | undefined = $state();

	const current = $derived(session.queue[0]);
	const progress = $derived(sessionProgress(session));
	const total = $derived(session.answered + session.queue.length);

	const WAVE = 'M6 18 Q 43 6 80 16 T 155 16 T 230 14 T 294 12';
	const SPEECH_LANG = { en: 'en-US', it: 'it-IT' } as const;

	onMount(() => {
		canSpeak = 'speechSynthesis' in window;
	});

	async function flip() {
		if (!current || flipped) return;
		flipped = true;
		await tick();
		back?.focus();
	}

	async function showFront() {
		flipped = false;
		await tick();
		frontButton?.focus();
	}

	function speak() {
		if (!current || !canSpeak) return;
		const utterance = new SpeechSynthesisUtterance(current.term);
		utterance.lang = SPEECH_LANG[current.lang];
		const voice = speechSynthesis
			.getVoices()
			.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(current.lang));
		if (voice) utterance.voice = voice;
		speechSynthesis.cancel();
		speechSynthesis.speak(utterance);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
		if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]'))
			return;

		if (e.key === ' ') {
			if (!current) return;
			e.preventDefault();
			flip();
		} else if (/^[1-4]$/.test(e.key) && flipped && !pending) {
			e.preventDefault();
			rateForm?.requestSubmit(rateForm.querySelector<HTMLButtonElement>(`[value="${e.key}"]`));
		} else if (e.key.toLowerCase() === 'z' && session.last && !pending) {
			e.preventDefault();
			undoForm?.requestSubmit();
		}
	}

	const submitRate: SubmitFunction = ({ cancel }) => {
		if (pending) return cancel();
		pending = true;
		message = null;
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
				message = result.data?.message ?? 'Não deu para salvar agora.';
				const data = result.data;
				const cardId = data && 'cardId' in data ? data.cardId : null;
				// Cartão avaliado em outra aba ou limite de novos batido: sai da fila.
				if (result.status === 409 || result.status === 404) {
					const dropNew = data && 'reason' in data && data.reason === 'new_limit';
					session.queue = session.queue.filter(
						(i) => i.cardId !== cardId && !(dropNew && i.state === STATE_NEW)
					);
					await showFront();
					invalidate(REVIEW_DEPENDENCY);
				}
			} else if (result.type === 'redirect') {
				await applyAction(result);
			} else {
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
				flipped = false;
				invalidate(REVIEW_DEPENDENCY);
				await tick();
				frontButton?.focus();
			} else if (result.type === 'failure') {
				message = result.data?.message ?? 'Não deu para desfazer agora.';
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
	<title>Revisar · Linguarudo</title>
</svelte:head>

{#snippet sourceIcon(source: keyof typeof SOURCE_LABELS)}
	<span class="origem" title={`Origem: ${SOURCE_LABELS[source]}`}>
		<svg
			viewBox="0 0 24 24"
			width="18"
			height="18"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{#if source === 'stremio'}
				<rect x="3" y="5" width="18" height="12" rx="2" /><path d="M10 9l4 2-4 2z M8 21h8" />
			{:else if source === 'lesson'}
				<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" />
			{:else if source === 'music'}
				<path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" />
			{:else}
				<path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" />
			{/if}
		</svg>
		<span class="visually-hidden">Origem: {SOURCE_LABELS[source]}</span>
	</span>
{/snippet}

{#snippet wave(value: number)}
	<svg
		class="onda"
		viewBox="0 0 300 30"
		preserveAspectRatio="none"
		role="progressbar"
		aria-label="Progresso da sessão"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={value}
	>
		<path class="fundo" d={WAVE} pathLength="100" />
		<path class="cheia" d={WAVE} pathLength="100" style:stroke-dashoffset={100 - value} />
	</svg>
{/snippet}

<form
	method="POST"
	action="?/undo"
	use:enhance={submitUndo}
	bind:this={undoForm}
	class="desfazer-form"
>
	<input type="hidden" name="logId" value={session.last?.logId ?? ''} />
</form>

{#if current}
	<div class="topo">
		<a class="fechar" href={resolve('/palavras')} aria-label="Sair da revisão">
			<svg
				viewBox="0 0 24 24"
				width="20"
				height="20"
				fill="none"
				stroke="currentColor"
				stroke-width="2.4"
				stroke-linecap="round"
				aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg
			>
		</a>
		{@render wave(progress)}
		<span class="contador" aria-label={`${session.answered} de ${total} respondidos`}
			>{session.answered}/{total}</span
		>
	</div>

	{#if flipped}
		<section class="cartao virado" aria-label="Cartão" tabindex="-1" bind:this={back}>
			<p class="selo {current.lang}" title={LANG_LABELS[current.lang]}>
				{current.lang.toUpperCase()}
			</p>
			<p class="termo" lang={current.lang}>{current.term}</p>
			<hr />
			<p class="traducao" class:sem={!current.translation}>
				{current.translation || 'Sem tradução'}
			</p>
			{#if current.context}
				<p class="contexto" lang={current.lang}>
					{#each highlightParts(current.context, current.term) as part, i (i)}
						{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}
					{/each}
				</p>
			{/if}
			<div class="rodape">
				{@render sourceIcon(current.source)}
				{#if canSpeak}
					<button class="ouvir" type="button" onclick={speak}>
						<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
							<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" />
							<path
								d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
							/>
						</svg>
						Ouvir
					</button>
				{/if}
			</div>
		</section>

		<form
			class="notas"
			method="POST"
			action="?/rate"
			use:enhance={submitRate}
			bind:this={rateForm}
			aria-label="Como foi?"
		>
			<input type="hidden" name="cardId" value={current.cardId} />
			<input type="hidden" name="reps" value={current.reps} />
			{#each GRADES as grade (grade)}
				<button class="nota n{grade}" name="rating" value={grade} disabled={pending}>
					<span class="rotulo">{GRADE_LABELS[grade]}</span>
					<span class="intervalo">{current.intervals[grade]}</span>
					<kbd aria-hidden="true">{grade}</kbd>
				</button>
			{/each}
		</form>
	{:else}
		<button class="cartao frente" type="button" onclick={flip} bind:this={frontButton}>
			<span class="selo {current.lang}" title={LANG_LABELS[current.lang]}>
				{current.lang.toUpperCase()}
			</span>
			<span class="termo" lang={current.lang}>{current.term}</span>
			<span class="dica">Toque para virar <kbd aria-hidden="true">Espaço</kbd></span>
		</button>

		<button class="mostrar" type="button" onclick={flip}>Mostrar resposta</button>
	{/if}
{:else if session.answered > 0}
	<section class="fim" aria-labelledby="fim-titulo">
		{@render wave(100)}
		<img class="mascote" src={mascote} alt="" width="140" height="140" />
		<h1 id="fim-titulo">Sessão concluída!</h1>
		<p class="placar">
			<strong>{session.correct} de {session.answered}</strong>
			{session.answered === 1 ? 'resposta certa' : 'respostas certas'}
		</p>
		{#if data.review && data.review.count > 0}
			<p class="proximo">Ainda tem {data.review.count} para revisar.</p>
			<button class="primario" type="button" onclick={continueReviewing}>Continuar revisando</button
			>
		{:else if data.review?.next}
			<p class="proximo">O próximo cartão vence {data.review.next}.</p>
		{/if}
		<a class="secundario" href={resolve('/palavras')}>Voltar para Minhas palavras</a>
	</section>
{:else}
	<section class="fim vazio" aria-labelledby="vazio-titulo">
		<img class="mascote" src={mascote} alt="" width="140" height="140" />
		<h1 id="vazio-titulo">Nada para revisar agora</h1>
		{#if data.review?.next}
			<p class="proximo">O próximo cartão vence {data.review.next}.</p>
		{:else}
			<p class="proximo">Guarde palavras novas (ou retome as pausadas) e elas viram cartões.</p>
		{/if}
		<a class="primario" href={resolve('/palavras')}>Ir para Minhas palavras</a>
	</section>
{/if}

{#if message}<p class="aviso" role="alert">{message}</p>{/if}

{#if session.last}
	<button
		class="desfazer"
		type="button"
		disabled={pending}
		onclick={() => undoForm?.requestSubmit()}
	>
		<svg
			viewBox="0 0 24 24"
			width="18"
			height="18"
			fill="none"
			stroke="currentColor"
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg
		>
		Desfazer <kbd aria-hidden="true">Z</kbd>
	</button>
{/if}

<style>
	.topo {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 18px;
	}

	.fechar {
		flex: none;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: var(--raio-p);
		color: var(--cinza);
	}

	.fechar:hover {
		background: var(--linha);
	}

	.onda {
		flex: 1;
		height: 30px;
		min-width: 120px;
		overflow: visible;
	}

	.onda path {
		fill: none;
		stroke-linecap: round;
		stroke-width: 9;
	}

	.onda .fundo {
		stroke: var(--linha);
	}

	.onda .cheia {
		stroke: var(--salvia);
		stroke-dasharray: 100 200;
		transition: stroke-dashoffset 0.6s cubic-bezier(0.3, 1.4, 0.5, 1);
	}

	.contador {
		flex: none;
		min-width: 44px;
		text-align: right;
		color: var(--cinza);
		font-weight: 750;
		font-variant-numeric: tabular-nums;
	}

	.cartao {
		width: 100%;
		min-height: min(52dvh, 420px);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 28px 20px;
		background: var(--papel);
		border: 2px solid var(--linha);
		border-radius: 28px;
		box-shadow: 0 6px 0 var(--linha);
		text-align: center;
		animation: entra 0.25s ease-out;
	}

	.cartao.frente {
		cursor: pointer;
		color: inherit;
	}

	.cartao.frente:active {
		transform: translateY(3px);
		box-shadow: 0 3px 0 var(--linha);
	}

	.cartao.virado {
		justify-content: flex-start;
		animation-name: vira;
	}

	.cartao.virado:focus {
		outline: none;
	}

	@keyframes entra {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}

	@keyframes vira {
		from {
			transform: perspective(800px) rotateY(-12deg);
			opacity: 0.4;
		}
	}

	.selo {
		margin: 0;
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.04em;
		padding: 3px 8px;
		border-radius: 6px;
		color: #fff;
	}

	.selo.en {
		background: var(--azul);
	}

	.selo.it {
		background: var(--ouro);
	}

	.termo {
		margin: 0;
		font-size: clamp(32px, 9vw, 48px);
		font-weight: 850;
		line-height: 1.1;
		color: var(--verde);
		letter-spacing: -0.01em;
		overflow-wrap: anywhere;
	}

	.virado .termo {
		font-size: clamp(26px, 7vw, 36px);
	}

	.dica {
		margin-top: 18px;
		color: var(--cinza);
		font-size: 14px;
		font-weight: 650;
	}

	hr {
		width: 60%;
		border: 0;
		border-top: 2px dashed var(--linha);
		margin: 4px 0;
	}

	.traducao {
		margin: 0;
		font-size: 24px;
		font-weight: 750;
		color: var(--tinta);
		overflow-wrap: anywhere;
	}

	.traducao.sem {
		color: var(--cinza);
		font-weight: 600;
		font-size: 18px;
	}

	.contexto {
		margin: 4px 0 0;
		max-width: 34em;
		padding: 10px 14px;
		border-radius: 14px;
		background: #fff;
		border-left: 4px solid var(--salvia-claro);
		color: var(--cinza);
		font-style: italic;
		text-align: left;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	mark {
		background: var(--salvia-claro);
		color: var(--verde);
		font-weight: 800;
		font-style: normal;
		border-radius: 4px;
		padding: 0 2px;
	}

	.rodape {
		margin-top: auto;
		padding-top: 12px;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.origem {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 99px;
		background: var(--salvia-claro);
		color: var(--verde);
	}

	.ouvir {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 8px 18px;
		border: 2px solid var(--linha);
		border-radius: 99px;
		background: #fff;
		color: var(--verde);
		font-weight: 800;
	}

	.ouvir:hover {
		border-color: var(--salvia);
	}

	.mostrar,
	.primario {
		display: block;
		width: 100%;
		margin-top: 18px;
		min-height: 56px;
		border: 0;
		border-radius: 18px;
		background: var(--verde);
		color: var(--creme);
		font-weight: 800;
		font-size: 18px;
		text-align: center;
		text-decoration: none;
		padding: 15px;
		box-shadow: var(--sombra-botao) var(--verde-escuro);
	}

	.mostrar:active,
	.primario:active,
	.nota:active {
		transform: translateY(2px);
		box-shadow: none;
	}

	.notas {
		margin-top: 18px;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 10px;
	}

	.nota {
		position: relative;
		min-height: 68px;
		border: 0;
		border-radius: 18px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		color: #fff;
		font-weight: 800;
		box-shadow: var(--sombra-botao) var(--sombra, #0003);
	}

	.nota:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.rotulo {
		font-size: 18px;
	}

	.intervalo {
		font-size: 14px;
		font-weight: 700;
		opacity: 0.9;
	}

	.n1 {
		background: var(--coral);
		--sombra: var(--coral-escuro);
	}

	.n2 {
		background: var(--ouro);
		--sombra: #b97f37;
	}

	.n3 {
		background: var(--salvia);
		--sombra: #5d8664;
	}

	.n4 {
		background: var(--azul);
		--sombra: #4f6f9d;
	}

	kbd {
		display: none;
		font: inherit;
		font-size: 12px;
		font-weight: 800;
		padding: 0 6px;
		border-radius: 6px;
		background: #0000001a;
	}

	.nota kbd {
		position: absolute;
		top: 8px;
		right: 10px;
	}

	.dica kbd,
	.desfazer kbd {
		background: var(--linha);
		color: var(--cinza);
	}

	/* Atalhos só fazem sentido com teclado e ponteiro fino (desktop). */
	@media (hover: hover) and (pointer: fine) {
		kbd {
			display: inline-block;
		}
	}

	.desfazer {
		display: flex;
		width: fit-content;
		align-items: center;
		gap: 8px;
		margin: 18px auto 0;
		min-height: 44px;
		padding: 8px 16px;
		border: 2px solid var(--linha);
		border-radius: 99px;
		background: #fff;
		color: var(--cinza);
		font-weight: 750;
	}

	.desfazer:hover {
		color: var(--verde);
		border-color: var(--salvia);
	}

	.desfazer-form {
		display: none;
	}

	.aviso {
		margin: 14px 0 0;
		padding: 12px 14px;
		border-radius: 14px;
		background: var(--coral-claro);
		color: #a53b3b;
		font-weight: 650;
	}

	.fim {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 6px;
		max-width: 440px;
		margin: 0 auto;
	}

	.fim .onda {
		width: 100%;
		margin-bottom: 18px;
	}

	.mascote {
		width: 132px;
		height: auto;
		margin-bottom: 6px;
	}

	.fim h1 {
		margin: 0;
		color: var(--verde);
		font-size: 28px;
		letter-spacing: -0.01em;
	}

	.placar {
		margin: 4px 0 0;
		font-size: 18px;
	}

	.placar strong {
		color: var(--verde);
		font-size: 22px;
	}

	.proximo {
		margin: 8px 0 0;
		color: var(--cinza);
	}

	.secundario {
		margin-top: 14px;
		font-weight: 750;
	}

	@media (min-width: 640px) {
		.notas {
			grid-template-columns: repeat(4, 1fr);
		}
	}
</style>
