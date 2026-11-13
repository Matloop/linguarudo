<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount, tick, untrack, type ComponentProps } from 'svelte';
	import { applyAction, deserialize, enhance, type SubmitFunction } from '$app/forms';
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
		type ItemReview,
		type ReviewItem
	} from '#lib/review.ts';
	import { FICHA_KIND_LABELS, renderCloze } from '#lib/fichas.ts';
	import { playWord } from '#lib/audio.ts';
	import { langAttrs, languageInline } from '#lib/languages.ts';
	import { isTypingTarget, shortcutFor } from '#lib/shortcuts.ts';
	import { toast } from '#lib/ui/app-state.svelte.ts';
	import FichaForm from '#lib/ui/FichaForm.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import MediaField from '#lib/ui/MediaField.svelte';
	import { LIMITS } from '#lib/items.ts';
	import Mark from '#lib/ui/Mark.svelte';
	import { ORIGIN_ICONS, WORK_ICONS } from '#lib/ui/origins.ts';
	import { deckDisplayName, quotaDoneText, tomorrowText } from '#lib/decks-ui.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// A sessão vive no navegador; recarregar a página começa outra com o que vencer.
	let session = $state(startSession(untrack(() => data.queue)));
	let flipped = $state(false);
	let pending = $state(false);
	let hit = $state<Grade | null>(null);
	let message = $state<string | null>(null);
	/** Palavra que acabou de virar sanguessuga (8 lapsos, depois a cada 4). */
	let leech = $state<{ itemId: string; lemma: string; lapses: number } | null>(null);
	/** Quando o cartão atual apareceu, para a duração da revisão (estatísticas). */
	let shownAt = 0;
	/** Preferências do aparelho: tocar a palavra sozinha e mostrar frase e obra na frente. */
	const PREFS_KEY = 'linguetta:revisar';
	let autoplay = $state(false);
	let showContext = $state(true);
	let prefsLoaded = false;

	let rateForm: HTMLFormElement | undefined = $state();
	let undoForm: HTMLFormElement | undefined = $state();
	let showButton: HTMLButtonElement | undefined = $state();
	let grades: HTMLElement | undefined = $state();

	const current = $derived(session.queue[0]);
	$effect(() => {
		if (current?.flashcardId) shownAt = Date.now();
	});
	const progress = $derived(sessionProgress(session));
	const total = $derived(session.answered + session.queue.length);
	const languageName = $derived(languageInline(data.language, data.uiLanguage));
	/** Texto no idioma estudado e na língua nativa (lang e dir para leitor de tela e RTL). */
	const study = $derived(langAttrs(data.language));
	const native = $derived(data.nativeLanguage ? langAttrs(data.nativeLanguage) : {});
	/** O que uma nova carga traria agora (vencidas + novas que ainda cabem). */
	const remaining = $derived(data.queue.length);
	const budget = $derived(data.budget);

	// Fim de cota: a fila esvaziou e há novas esperando além do orçamento.
	let quotaDialog: HTMLDialogElement | undefined = $state();
	let quotaShown = $state(false);
	let extraPending = $state(false);
	const quotaOver = $derived(
		!current &&
			session.answered > 0 &&
			remaining === 0 &&
			!data.scope.obra &&
			!data.tag &&
			budget.more > 0
	);
	$effect(() => {
		if (!quotaOver || quotaShown || !quotaDialog) return;
		quotaShown = true;
		quotaDialog.showModal();
	});

	/** "+5 só hoje": a sessão continua com as novas que o escopo ganhou, sem recarregar. */
	async function addFive() {
		if (extraPending) return;
		extraPending = true;
		const body = new FormData();
		body.set('language', data.language);
		for (const deck of data.scope.decks) body.append('deck', deck);
		const res = await fetch('?/extra', {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).catch(() => null);
		extraPending = false;
		const result = res ? deserialize(await res.text()) : null;
		if (result?.type !== 'success' || !result.data) {
			toast('Não deu para somar novas agora.');
			return;
		}
		const added = (result.data.added ?? []) as typeof data.queue;
		const have = new Set(session.queue.map((i) => i.flashcardId));
		session.queue = [...session.queue, ...added.filter((i) => !have.has(i.flashcardId))];
		quotaDialog?.close();
		quotaShown = false;
		flipped = false;
		toast(`+${added.length || 5} novas hoje`);
		invalidate(REVIEW_DEPENDENCY);
	}

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
			autoplay = saved.autoplay === true;
			showContext = saved.showContext !== false;
		} catch {
			// Preferência corrompida: fica o padrão.
		}
		prefsLoaded = true;
	});

	$effect(() => {
		const prefs = JSON.stringify({ autoplay, showContext });
		if (prefsLoaded) localStorage.setItem(PREFS_KEY, prefs);
	});

	// No "produzir" a frente é a tradução: o áudio só toca no verso, para não dar a resposta.
	$effect(() => {
		if (!autoplay || current?.source !== 'item' || (current.kind === 'produzir') !== flipped)
			return;
		speak(false, (flipped ? media?.answer.audio : media?.ask.audio) ?? null);
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

	// Trocar a tag ou o escopo (deck, obra) começa outra sessão com a fila nova.
	const scopeKey = (d: typeof data) => JSON.stringify([d.tag, d.scope.decks, d.scope.obra]);
	let sessionKey = untrack(() => scopeKey(data));
	$effect(() => {
		const key = scopeKey(data);
		if (key === sessionKey) return;
		sessionKey = key;
		quotaShown = false;
		session = startSession(data.queue);
		flipped = false;
		hit = null;
	});

	const tagQuery = (tag: string | null): `?${string}` | '' => {
		const parts = data.scope.decks.map((deck) => ['deck', deck]);
		if (tag) parts.push(['tag', tag]);
		const s = parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		return s ? `?${s}` : '';
	};
	const sessionTitle = $derived(
		data.scope.obra
			? 'Desta obra'
			: data.scope.deckNames.length
				? data.scope.deckNames.map(deckDisplayName).join(' + ')
				: 'Revisão de hoje'
	);

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

	/** Gravação do flashcard vence; sem ela, a palavra vem do servidor. No autoplay o navegador pode recusar antes da primeira interação: aí fica em silêncio. */
	function speak(explicit: boolean, audio: string | null = null) {
		if (audio) return play(audio);
		if (!current || current.source !== 'item') return;
		playWord(current.lemma, current.language).catch(() => {
			if (explicit) toast('Não foi possível tocar o áudio desta palavra');
		});
	}

	function rate(grade: Grade) {
		rateForm?.requestSubmit(rateForm.querySelector<HTMLButtonElement>(`[value="${grade}"]`));
	}

	function onkeydown(e: KeyboardEvent) {
		const action = shortcutFor(e, {
			screen: 'flashcards',
			typing: isTypingTarget(e.target),
			dialogOpen: !!document.querySelector(
				'dialog[open], details.lang-wrap[open], details.rv-prefs[open], [data-drawer-open], [data-popover-open]'
			),
			flipped
		});
		if (!action) return;
		if (action.type === 'virar' && current) flip();
		else if (action.type === 'nota' && current && !pending) rate(action.grade);
		else if (action.type === 'desfazer' && session.last && !pending) undoForm?.requestSubmit();
		else return;
		e.preventDefault();
	}

	const submitRate: SubmitFunction = ({ cancel, submitter, formData }) => {
		if (pending) return cancel();
		pending = true;
		message = null;
		if (shownAt) formData.set('durationMs', String(Date.now() - shownAt));
		if (data.scope.obra) formData.set('obra', data.scope.obra);
		hit = Number(submitter?.getAttribute('value')) as Grade;
		return async ({ result }) => {
			pending = false;
			if (result.type === 'success' && result.data && 'item' in result.data) {
				const { item, logId, rating } = result.data;
				const l = result.data.leech;
				if (l?.itemId && l.lemma) leech = { itemId: l.itemId, lemma: l.lemma, lapses: l.lapses };
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

	// Edição no lugar: a palavra ou a ficha do flashcard atual, sem sair da sessão.
	type EditData =
		| {
				kind: 'item';
				id: string;
				item: {
					lemma: string;
					reading: string;
					sense: string;
					note: string;
					tags: string[];
					image: string | null;
					audio: string | null;
				};
				mediaUrls: { image: string | null; audio: string | null };
		  }
		| {
				kind: 'ficha';
				id: string;
				cloze: boolean;
				values: ComponentProps<typeof FichaForm>['values'];
				mediaUrls: ComponentProps<typeof FichaForm>['mediaUrls'];
		  };
	let editDialog: HTMLDialogElement | undefined = $state();
	let editFor = $state<{ flashcardId: string; data: EditData | null } | null>(null);
	let editErrors = $state<Record<string, string>>({});
	let editBusy = $state(false);

	async function post(url: string, body: FormData) {
		const res = await fetch(url, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).catch(() => null);
		return res ? deserialize(await res.text()) : null;
	}

	async function openEdit() {
		if (!current) return;
		const flashcardId = current.flashcardId;
		editFor = { flashcardId, data: null };
		editErrors = {};
		editDialog?.showModal();
		const body = new FormData();
		body.set('flashcardId', flashcardId);
		const r = await post('?/editLoad', body);
		if (r?.type !== 'success' || !r.data) {
			editDialog?.close();
			toast('Não deu para abrir a edição agora.');
			return;
		}
		if (editFor?.flashcardId === flashcardId) editFor.data = r.data as unknown as EditData;
	}

	/** Depois de salvar, o flashcard da fila volta do servidor já com o texto novo. */
	async function editSaved() {
		const flashcardId = editFor?.flashcardId;
		if (!flashcardId) return;
		const body = new FormData();
		body.set('flashcardId', flashcardId);
		const r = await post('?/refresh', body);
		if (r?.type === 'success' && r.data?.item) {
			const fresh = r.data.item as ReviewItem;
			session.queue = session.queue.map((i) => (i.flashcardId === flashcardId ? fresh : i));
		}
		editDialog?.close();
		toast('Salvo');
	}

	async function submitItemEdit(e: SubmitEvent) {
		e.preventDefault();
		if (editBusy) return;
		editBusy = true;
		editErrors = {};
		const r = await post('/palavras?/edit', new FormData(e.currentTarget as HTMLFormElement));
		editBusy = false;
		if (r?.type === 'success') return editSaved();
		const errors = (r?.type === 'failure' ? (r.data as { errors?: Record<string, string> }) : null)
			?.errors;
		editErrors = errors ?? { form: 'Não deu para salvar agora. Tente de novo.' };
	}

	function onFichaResult(result: { type: string; data?: unknown }) {
		// A action da ficha termina em redirect: é o sinal de que salvou.
		if (result.type === 'redirect' || result.type === 'success') return void editSaved();
		const data = (result.type === 'failure' ? result.data : null) as {
			errors?: Record<string, string>;
		} | null;
		editErrors = data?.errors ?? { form: 'Não deu para salvar agora. Tente de novo.' };
	}

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

{#snippet source(item: ItemReview, audio: string | null, withOrigin: boolean)}
	<div class="fh">
		{#if withOrigin}
			<span class="src">
				<Icon name={ORIGIN_ICONS[item.origin ?? 'manual']} size="sm" />
				{item.sourceDetail || 'Guardada à mão'}
			</span>
		{:else}<span></span>{/if}
		<button
			class="icon-btn"
			class:rec={!!audio}
			type="button"
			onclick={() => speak(true, audio)}
			aria-label="Ouvir"
			title={audio ? 'Ouvir a pronúncia guardada' : 'Ouvir'}
		>
			<Icon name="sound" size="sm" />
		</button>
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
				href={resolve(`/flashcards/estudar${tagQuery(null)}`)}
				aria-current={!data.tag}>Tudo</a
			>
			{#each data.tags as tag (tag)}
				<a
					class="chip"
					class:on={data.tag === tag}
					href={resolve(`/flashcards/estudar${tagQuery(tag)}`)}
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
		<div><h1>{sessionTitle === 'Revisão de hoje' ? 'Flashcards' : sessionTitle}</h1></div>
		<a class="btn btn-soft" href={resolve('/flashcards')}><Icon name="cards" />Decks</a>
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
					href={resolve('/flashcards/estudar?guardar')}
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
			<span class="l" title={sessionTitle}
				><Icon name="repeat" size="sm" /><span class="l-name">{sessionTitle}</span></span
			>
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
				{#if current}
					<button
						class="icon-btn"
						type="button"
						onclick={openEdit}
						aria-label="Editar este flashcard"
						title="Editar"><Icon name="pencil" size="sm" /></button
					>
				{/if}
				<details class="rv-prefs">
					<summary class="icon-btn" aria-label="Preferências da revisão" title="Preferências"
						><Icon name="settings" /></summary
					>
					<div class="menu">
						<label><input type="checkbox" bind:checked={autoplay} />Tocar a palavra sozinha</label>

						<label
							><input type="checkbox" bind:checked={showContext} />Mostrar frase e origem na frente</label
						>
					</div>
				</details>
				<a class="icon-btn" href={resolve('/flashcards')} aria-label="Sair da revisão" title="Sair"
					><Icon name="x" /></a
				>
			</span>
		</div>
		{#if session.answered === 0}{@render tagBar()}{/if}

		{#if leech}
			<div class="leech" role="status">
				<Icon name="leaf" size="sm" />
				<p>
					<b>“{leech.lemma}” está teimosa.</b> Você errou {leech.lapses} vezes depois de aprender. Uma
					frase nova ou uma nota costuma resolver.
				</p>
				<a class="btn btn-soft" href={resolve(`/palavras?item=${leech.itemId}`)}>Abrir palavra</a>
				<button
					class="icon-btn"
					type="button"
					aria-label="Fechar aviso"
					onclick={() => (leech = null)}><Icon name="x" size="sm" /></button
				>
			</div>
		{/if}

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
									{@render source(current, media?.ask.audio ?? null, showContext)}
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
									{#if current.kind === 'reconhecer' && showContext}{@render sentence(
											current,
											true
										)}{/if}
								</section>
								<section class="face back" inert={!flipped} aria-label="Verso do flashcard">
									{@render source(current, media?.answer.audio ?? null, true)}
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
					{:else if data.tomorrow !== null && budget.more > 0}
						<div class="tomorrow">{tomorrowText(data.tomorrow)}</div>
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
							<a class="btn btn-primary btn-lg" href={resolve('/flashcards')}>Voltar aos decks</a>
							<a class="btn btn-soft btn-lg" href={resolve('/inicio')}>Voltar ao início</a>
						{/if}
					</div>
				</div>
			</section>
		{/if}
	</div>
{/if}

<dialog
	class="quota"
	bind:this={quotaDialog}
	aria-labelledby="cota-titulo"
	aria-describedby="cota-texto"
>
	<form method="dialog" class="quota-in">
		<div class="eyebrow">Fim da cota</div>
		<h2 id="cota-titulo">{quotaDoneText(budget)}</h2>
		<p id="cota-texto">
			{#if data.tomorrow !== null}{tomorrowText(data.tomorrow)}{/if}
			{budget.more === 1 ? '1 nova espera' : `${budget.more} novas esperam`} para amanhã.
		</p>
		<div class="quota-acts">
			<!-- svelte-ignore a11y_autofocus -->
			<button class="btn btn-primary btn-lg" value="fim" autofocus>Concluir por hoje</button>
			{#if data.work}
				<a
					class="btn btn-soft btn-lg quota-work"
					href={resolve(`/flashcards/estudar?obra=${data.work.id}`)}
					title={data.work.title}
					onclick={() => quotaDialog?.close()}
					><Icon name={WORK_ICONS[data.work.kind] ?? 'bookmark'} size="sm" /><span
						>Estudar {data.work.n} de {data.work.title}</span
					></a
				>
			{/if}
			<button class="btn btn-ghost btn-lg" type="button" disabled={extraPending} onclick={addFive}
				>+5 só hoje</button
			>
		</div>
	</form>
</dialog>

<dialog class="editor" bind:this={editDialog} aria-label="Editar flashcard" onclose={() => (editFor = null)}>
	<div class="ed-in">
		<div class="ed-h">
			<h2>{editFor?.data?.kind === 'ficha' ? 'Editar ficha' : 'Editar palavra'}</h2>
			<button class="icon-btn" type="button" aria-label="Fechar" onclick={() => editDialog?.close()}
				><Icon name="x" /></button
			>
		</div>
		{#if editFor?.data?.kind === 'item'}
			{@const d = editFor.data}
			<form class="edit" onsubmit={submitItemEdit}>
				<input type="hidden" name="id" value={d.id} />
				<label
					>Palavra<input
						name="lemma"
						{...study}
						value={d.item.lemma}
						maxlength={LIMITS.lemma}
						required
					/></label
				>
				{#if editErrors.lemma}<p class="err" role="alert">{editErrors.lemma}</p>{/if}
				<label
					>Leitura <i class="opt">· opcional, como furigana ou pinyin</i><input
						name="reading"
						{...study}
						value={d.item.reading}
						maxlength={LIMITS.reading}
					/></label
				>
				{#if editErrors.reading}<p class="err" role="alert">{editErrors.reading}</p>{/if}
				<label>Tradução<input name="sense" value={d.item.sense} maxlength={LIMITS.sense} /></label>
				<label
					>Nota<textarea name="note" rows="3" maxlength={LIMITS.note} value={d.item.note}
					></textarea></label
				>
				<label
					>Tags <i class="opt">· separadas por vírgula</i><input
						name="tags"
						value={d.item.tags.join(', ')}
						placeholder="viagem, A2"
						autocomplete="off"
					/></label
				>
				{#if editErrors.tags}<p class="err" role="alert">{editErrors.tags}</p>{/if}
				<div class="media-row">
					<MediaField
						name="image"
						kind="image"
						label="Imagem"
						path={d.item.image}
						url={d.mediaUrls.image}
					/>
					<MediaField
						name="audio"
						kind="audio"
						label="Áudio"
						path={d.item.audio}
						url={d.mediaUrls.audio}
					/>
				</div>
				{#if editErrors.image}<p class="err" role="alert">{editErrors.image}</p>{/if}
				{#if editErrors.audio}<p class="err" role="alert">{editErrors.audio}</p>{/if}
				{#if editErrors.form}<p class="err" role="alert">{editErrors.form}</p>{/if}
				<div class="edit-acts">
					<button class="btn btn-primary" disabled={editBusy}>Salvar</button>
					<button type="button" class="btn btn-ghost" onclick={() => editDialog?.close()}
						>Cancelar</button
					>
				</div>
			</form>
		{:else if editFor?.data?.kind === 'ficha'}
			{@const d = editFor.data}
			<FichaForm
				values={d.values}
				mediaUrls={d.mediaUrls}
				errors={editErrors}
				languages={[d.values.language]}
				ui={data.uiLanguage}
				action="/flashcards/fichas/{d.id}?/save"
				cloze={d.cloze}
				onresult={onFichaResult}
			/>
		{:else}
			<p class="ed-wait">Carregando…</p>
		{/if}
	</div>
</dialog>

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
		font: 500 15.5px var(--f-body);
		color: var(--ink-2);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.rv-top .l-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.editor {
		width: min(640px, calc(100vw - 32px));
		max-height: calc(100dvh - 48px);
		padding: 0;
		border: 0;
		border-radius: var(--r-l);
		background: var(--raise);
		color: var(--ink);
		box-shadow: var(--sh-pop);
	}
	.editor::backdrop {
		background: var(--scrim);
	}
	.ed-in {
		padding: 22px 24px 20px;
	}
	.ed-h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 14px;
	}
	.ed-h h2 {
		font: 600 20px/1.25 var(--f-head);
		margin: 0;
	}
	.ed-wait {
		color: var(--ink-3);
	}
	.edit {
		display: grid;
		gap: 12px;
	}
	.edit label {
		display: grid;
		gap: 6px;
		font-size: 14.5px;
		color: var(--ink-2);
	}
	.edit .err {
		margin: 0;
		color: var(--danger, #c0392b);
		font-size: 14px;
	}
	.edit .media-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.edit-acts {
		display: flex;
		gap: 8px;
	}
	.opt {
		font-style: normal;
		color: var(--ink-3);
	}
	.quota {
		width: min(440px, calc(100vw - 32px));
		padding: 0;
		border: 0;
		border-radius: var(--r-l);
		background: var(--raise);
		color: var(--ink);
		box-shadow: var(--sh-pop);
	}
	.quota::backdrop {
		background: var(--scrim);
	}
	.quota-in {
		padding: 26px 26px 22px;
	}
	.quota h2 {
		font: 600 22px/1.25 var(--f-head);
		letter-spacing: -0.01em;
		margin: 6px 0 8px;
	}
	.quota p {
		color: var(--ink-2);
		margin: 0 0 20px;
	}
	.quota-acts {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.quota-acts .btn {
		width: 100%;
		justify-content: center;
	}
	.quota-work span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (max-width: 560px) {
		.quota {
			margin: auto 0 0;
			width: 100vw;
			max-width: 100vw;
			border-radius: var(--r-l) var(--r-l) 0 0;
			padding-bottom: var(--safe-b);
		}
	}
	.rv-top .r {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 10px;
		font: 500 14.5px var(--f-body);
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
	}
	.rv-prefs {
		position: relative;
	}
	.rv-prefs summary {
		list-style: none;
		cursor: pointer;
	}
	.rv-prefs summary::-webkit-details-marker {
		display: none;
	}
	.rv-prefs .menu {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 10;
		display: grid;
		gap: 2px;
		padding: 6px;
		min-width: 260px;
		border-radius: var(--r-m);
		background: var(--raise);
		box-shadow: var(--sh-lift);
		color: var(--ink);
	}
	.rv-prefs label {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: var(--r-s);
		cursor: pointer;
		white-space: nowrap;
	}
	.rv-prefs label:hover {
		background: var(--tile);
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
		font-size: 14px;
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
		font: 600 60.5px/1.05 var(--f-head);
		letter-spacing: -0.035em;
		overflow-wrap: anywhere;
	}
	.ask {
		font-size: 15.5px;
		color: var(--ink-3);
		margin-bottom: 12px;
	}
	.front .ask + .word {
		font-size: 43px;
		line-height: 1.15;
	}
	/* Leitura (furigana, pinyin) logo acima do lema. */
	.reading {
		margin-bottom: 4px;
		color: var(--ink-3);
		font: 400 16.5px/1.3 var(--f-body);
		letter-spacing: 0.02em;
	}
	.rd {
		display: block;
		font-size: 14px;
		color: var(--ink-3);
	}
	.ipa {
		margin-top: 10px;
		color: var(--ink-3);
		font: 400 16.5px var(--f-body);
	}
	.ctx {
		text-align: center;
		font-size: 17px;
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
		font: 400 15.5px var(--f-body);
		color: var(--ink-3);
	}
	.small-w b {
		font: 600 16.5px var(--f-head);
		color: var(--ink-2);
	}
	.tr {
		font: 600 41px/1.15 var(--f-head);
		letter-spacing: -0.03em;
		margin-top: 8px;
		overflow-wrap: anywhere;
	}
	.tr.none {
		font-size: 24px;
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
		font: 500 16.5px/1.2 var(--f-body);
	}
	.gbtn span {
		font-size: 14px;
		color: var(--ink-3);
	}
	.gbtn kbd {
		position: absolute;
		top: 7px;
		right: 7px;
		min-width: 18px;
		height: 18px;
		font-size: 12px;
	}
	.rv-hint {
		text-align: center;
		font-size: 14px;
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
		font: 600 47.5px/1.1 var(--f-head);
		letter-spacing: -0.035em;
	}
	.done p {
		color: var(--ink-2);
		margin: 12px 0 36px;
		font-size: 17.5px;
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
		font: 600 32.5px/1 var(--f-head);
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}
	.sum span {
		font-size: 14px;
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
		font-size: 14.5px;
		color: var(--ink-3);
		margin-bottom: 24px;
	}
	.done .acts {
		display: flex;
		gap: 8px;
		justify-content: center;
	}

	.leech {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 0 auto 14px;
		max-width: 640px;
		padding: 10px 12px 10px 14px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-2);
		font-size: 15px;
	}
	.leech p {
		margin: 0;
		flex: 1;
		min-width: 0;
	}
	.leech b {
		color: var(--ink);
		font-weight: 600;
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
		font-size: 15.5px;
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
			font-size: 47.5px;
		}
		.front .ask + .word {
			font-size: 34.5px;
		}
		.ctx {
			font-size: 16.5px;
		}
		.tr {
			font-size: 33.5px;
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
			font-size: 16px;
		}
		.rv-hint {
			display: none;
		}
		.done h2 {
			font-size: 36.5px;
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
