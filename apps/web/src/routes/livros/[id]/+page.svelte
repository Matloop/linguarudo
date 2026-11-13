<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { inRange, rangeProgress, rangeState, rangeSummary, type ChapterRow } from '#lib/blend/book-ui.ts';
	import { MAX_COVERAGE } from '#lib/blend/select.ts';
	import { languageLabel } from '#lib/languages.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { toast } from '#lib/ui/app-state.svelte.ts';
	import { postAction } from '#lib/ui/post-action.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Estado do formulário, inicializado dos dados (e de novo quando eles mudam de livro).
	let language = $state('');
	let bookLanguage = $state('');
	let percent = $state(10);
	let whole = $state(true);
	let from = $state(0);
	let to = $state(0);
	let chapters = $state<ChapterRow[]>([]);
	let loadedFor = '';

	const textChapters = $derived(chapters.filter((c) => c.words > 0));
	const firstSpine = $derived(textChapters[0]?.spine ?? 0);
	const lastSpine = $derived(textChapters.at(-1)?.spine ?? 0);

	$effect.pre(() => {
		const b = data.book;
		chapters = data.chapters.map((c) => ({ ...c }));
		if (loadedFor === b.id) return;
		loadedFor = b.id;
		language = b.language;
		bookLanguage = b.bookLanguage;
		percent = Math.round(b.coverage * 100);
		const texts = data.chapters.filter((c) => c.words > 0);
		const first = texts[0]?.spine ?? 0;
		const last = texts.at(-1)?.spine ?? 0;
		from = Math.max(b.rangeFrom, first);
		to = Math.min(b.rangeTo, last);
		if (to < from) [from, to] = [first, last];
		whole = from <= first && to >= last;
	});

	const rangeFrom = $derived(whole ? firstSpine : from);
	const rangeTo = $derived(whole ? lastSpine : to);

	const chapterOptions = $derived(
		textChapters.map((c) => ({ value: c.spine, label: c.title }))
	);
	const toOptions = $derived(
		textChapters.map((c) => ({ value: c.spine, label: c.title, disabled: c.spine < from }))
	);
	const languageOptions = $derived(
		data.studyLanguages.map((l) => ({ value: l, label: languageLabel(l, 'pt') }))
	);

	const progress = $derived(rangeProgress(chapters, rangeFrom, rangeTo));
	const pending = $derived(inRange(chapters, rangeFrom, rangeTo).filter((c) => c.status !== 'feito'));
	const allReady = $derived(pending.length === 0 && inRange(chapters, rangeFrom, rangeTo).length > 0);
	const invalidates = $derived(
		language !== data.book.language ||
			bookLanguage.trim() !== data.book.bookLanguage ||
			percent !== Math.round(data.book.coverage * 100)
	);
	const hasWork = $derived(chapters.some((c) => c.partsDone > 0 || c.status === 'feito'));

	type Phase = 'idle' | 'saving' | 'blending' | 'building';
	let phase = $state<Phase>('idle');
	let current = $state('');
	let notice = $state<{ kind: 'quota' | 'error'; text: string } | null>(null);
	let stopRequested = false;
	const busy = $derived(phase !== 'idle');

	function setFrom(v: number) {
		from = v;
		if (to < v) to = v;
	}

	async function post<T>(path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body ?? {})
		}).catch(() => null);
		if (!res) return { ok: false, status: 0, message: 'Sem conexão. Tente de novo.' };
		const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
		if (!res.ok || !json) {
			return { ok: false, status: res.status, message: json?.message ?? 'Não deu certo agora.' };
		}
		return { ok: true, data: json };
	}

	async function generate() {
		notice = null;
		stopRequested = false;
		if (invalidates && hasWork && !confirm('Mudar idioma ou quantidade descarta as trocas já preparadas. Continuar?')) {
			return;
		}
		phase = 'saving';
		const saved = await postAction('settings', {
			language,
			bookLanguage: bookLanguage.trim(),
			coverage: String(percent),
			from: String(rangeFrom),
			to: String(rangeTo)
		});
		if (!saved.ok) {
			phase = 'idle';
			notice = { kind: 'error', text: saved.message };
			return;
		}

		phase = 'blending';
		const bookId = data.book.id;
		for (const ch of inRange(chapters, rangeFrom, rangeTo)) {
			if (ch.status === 'feito') continue;
			current = ch.title;
			for (;;) {
				if (stopRequested) return finish('Pausado. O que já foi feito fica guardado.');
				const r = await post<{ spine: number; part: number; parts: number; done: boolean }>(
					resolve('/livros/[id]/blend', { id: bookId }),
					{ spine: ch.spine }
				);
				if (!r.ok) {
					phase = 'idle';
					current = '';
					notice =
						r.status === 429
							? {
									kind: 'quota',
									text: 'O limite grátis da IA acabou por agora. O que já foi feito fica guardado: volte mais tarde e toque em Continuar.'
								}
							: { kind: 'error', text: `${ch.title}: ${r.message}` };
					await invalidateAll();
					return;
				}
				const row = chapters.find((c) => c.spine === ch.spine);
				if (row) {
					row.parts = r.data.parts;
					row.partsDone = r.data.part;
					if (r.data.done) row.status = 'feito';
				}
				if (r.data.done) break;
			}
		}

		phase = 'building';
		current = '';
		const built = await post<{ version: number; links: number }>(
			resolve('/livros/[id]/gerar', { id: bookId })
		);
		phase = 'idle';
		if (!built.ok) {
			notice = { kind: 'error', text: built.message };
			return;
		}
		await invalidateAll();
		toast(`EPUB pronto: ${built.data.links} ${built.data.links === 1 ? 'troca' : 'trocas'}`);
	}

	async function finish(message: string) {
		phase = 'idle';
		current = '';
		toast(message);
		await invalidateAll();
	}

	const actionLabel = $derived(
		allReady && !invalidates ? 'Gerar EPUB' : progress > 0 && !invalidates ? 'Continuar' : 'Gerar'
	);
</script>

<svelte:head>
	<title>{data.book.title} · Livros · Linguetta</title>
</svelte:head>

<a class="back" href={resolve('/livros')}><Icon name="arrow" size="sm flip" />Livros</a>

<div class="ph">
	<div>
		<h1>{data.book.title}</h1>
		{#if data.book.author}<p>{data.book.author}</p>{/if}
	</div>
	{#if data.book.version}
		<div class="ph-acts">
			<a class="btn btn-soft" href={resolve('/livros/[id]/ler', { id: data.book.id })}
				><Icon name="play" size="sm" />Ler</a
			>
			<a class="btn btn-ghost" href={resolve('/livros/[id]/baixar', { id: data.book.id })} data-sveltekit-reload
				>Baixar EPUB</a
			>
		</div>
	{/if}
</div>

<section class="tile form" aria-label="Configuração do blend">
	<div class="field">
		<span class="lbl" id="lbl-range">Capítulos</span>
		<div class="seg" role="group" aria-labelledby="lbl-range">
			<button type="button" aria-pressed={whole} disabled={busy} onclick={() => (whole = true)}>Livro inteiro</button>
			<button type="button" aria-pressed={!whole} disabled={busy} onclick={() => (whole = false)}
				>Intervalo de capítulos</button
			>
		</div>
	</div>

	{#if !whole}
		<div class="row2">
			<div class="field">
				<span class="lbl" id="lbl-from">Do capítulo</span>
				<Select
					options={chapterOptions}
					value={from}
					onchange={setFrom}
					labelledby="lbl-from"
					disabled={busy}
					searchable={chapterOptions.length > 12}
				/>
			</div>
			<div class="field">
				<span class="lbl" id="lbl-to">Até o capítulo</span>
				<Select
					options={toOptions}
					bind:value={to}
					labelledby="lbl-to"
					disabled={busy}
					searchable={toOptions.length > 12}
				/>
			</div>
		</div>
	{/if}
	<p class="summary" data-testid="resumo">{rangeSummary(chapters, rangeFrom, rangeTo)}</p>

	<div class="row2">
		<div class="field">
			<span class="lbl" id="lbl-lang">Misturar em</span>
			<Select options={languageOptions} bind:value={language} labelledby="lbl-lang" disabled={busy} />
		</div>
		<div class="field">
			<label class="lbl" for="book-lang">Língua do livro</label>
			<input
				id="book-lang"
				class="input"
				bind:value={bookLanguage}
				disabled={busy}
				autocomplete="off"
				spellcheck="false"
				placeholder="pt-BR"
			/>
		</div>
	</div>

	<div class="field">
		<label class="lbl" for="quanto">Quanto: {percent}%</label>
		<input
			id="quanto"
			class="range"
			type="range"
			min="1"
			max={MAX_COVERAGE * 100}
			step="1"
			bind:value={percent}
			disabled={busy}
		/>
		<span class="faint small">Parte das palavras do texto trocadas pelo idioma que você estuda.</span>
	</div>
</section>

<section class="tile run" aria-label="Geração">
	<div class="state">
		<span class="meta" data-testid="estado">{rangeState(chapters, rangeFrom, rangeTo)}</span>
		<span
			class="bar"
			role="progressbar"
			aria-label="Progresso do blend"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress * 100)}><i style:width="{Math.round(progress * 100)}%"></i></span
		>
		{#if phase === 'saving'}
			<span class="faint small" aria-live="polite">Salvando…</span>
		{:else if phase === 'blending'}
			<span class="faint small" aria-live="polite">Preparando as trocas: {current}</span>
		{:else if phase === 'building'}
			<span class="faint small" aria-live="polite">Montando o EPUB…</span>
		{/if}
	</div>

	{#if notice}
		<p class="notice" class:quota={notice.kind === 'quota'} role="alert">{notice.text}</p>
	{/if}

	<div class="acts">
		{#if phase === 'blending'}
			<button class="btn btn-ghost" type="button" onclick={() => (stopRequested = true)}
				><Icon name="pause" size="sm" />Pausar</button
			>
		{/if}
		<span class="sp"></span>
		<button
			class="btn btn-primary"
			type="button"
			disabled={busy || !language || !bookLanguage.trim()}
			onclick={generate}
			data-testid="gerar"><Icon name="sparks" size="sm" />{busy ? 'Gerando…' : actionLabel}</button
		>
	</div>
</section>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-2);
		text-decoration: none;
		font-size: 14px;
		margin-bottom: 8px;
	}
	.back:hover {
		color: var(--ink);
	}
	.ph-acts {
		display: flex;
		gap: 8px;
	}
	.form,
	.run {
		gap: 18px;
		margin-bottom: 16px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.lbl {
		font-size: 14px;
		font-weight: 500;
		color: var(--ink-2);
	}
	.row2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.summary {
		margin: -6px 0 0;
		color: var(--ink-2);
		font-size: 14px;
	}
	.range {
		width: 100%;
		accent-color: var(--primary);
	}
	.small {
		font-size: 13px;
	}
	.state {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.meta {
		color: var(--ink-2);
		font-size: 14px;
	}
	.notice {
		margin: 0;
		padding: 12px 14px;
		border-radius: var(--r-s);
		background: var(--terra-soft);
		color: var(--terra-ink);
		font-size: 14px;
	}
	.notice.quota {
		background: var(--sunk);
		color: var(--ink);
	}
	.acts {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.sp {
		flex: 1;
	}
	@media (max-width: 768px) {
		.row2 {
			grid-template-columns: 1fr;
		}
	}
</style>
