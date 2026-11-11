<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { AnkiPackage } from '#lib/anki/package.ts';
	import {
		buildImport,
		summarize,
		type NotetypeMapping,
		type NotetypeSummary
	} from '#lib/anki/mapping.ts';
	import { languageLabel, type Language } from '#lib/languages.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Step = 'pick' | 'reading' | 'map' | 'media' | 'notes' | 'done';
	let step = $state<Step>('pick');
	let error = $state<string | null>(null);
	let fileName = $state('');
	// O pacote pode ser grande: fica fora do estado reativo.
	let pkg: AnkiPackage | null = null;
	let types = $state.raw<NotetypeSummary[]>([]);
	let mappings = $state<Record<string, NotetypeMapping>>({});
	let picked = $state<Language | null>(null);
	const language = $derived(picked ?? data.language);
	let progress = $state({ done: 0, total: 0 });
	let result = $state<{
		items: number;
		fichas: number;
		scheduled: number;
		skipped: number;
		mediaFailed: number;
		quota: boolean;
	} | null>(null);
	/** Sobe quando o mapeamento muda, para recalcular o resumo. */
	let version = $state(0);

	const built = $derived.by(() => {
		void version;
		void JSON.stringify(mappings);
		return pkg ? buildImport(pkg.collection, $state.snapshot(mappings), pkg.media) : null;
	});
	const counts = $derived.by(() => {
		const notes = built?.notes ?? [];
		return {
			items: notes.filter((n) => n.type === 'item').length,
			fichas: notes.filter((n) => n.type === 'ficha').length,
			reviews: notes.reduce((s, n) => s + n.cards.reduce((t, c) => t + c.logs.length, 0), 0),
			media: built?.media.size ?? 0
		};
	});

	async function choose(file: File | undefined) {
		if (!file) return;
		error = null;
		fileName = file.name;
		step = 'reading';
		try {
			const { openAnkiPackage } = await import('#lib/ui/anki-import.ts');
			pkg = await openAnkiPackage(file);
			types = summarize(pkg.collection);
			mappings = Object.fromEntries(types.map((t) => [t.id, structuredClone(t.suggestion)]));
			version++;
			if (types.length === 0) throw new Error('O pacote não tem notas.');
			step = 'map';
		} catch (e) {
			pkg = null;
			error = e instanceof Error ? e.message : 'Não deu para ler esse arquivo.';
			step = 'pick';
		}
	}

	async function run() {
		const userId = page.data.user?.id;
		if (!pkg || !built || !userId) return;
		error = null;
		try {
			const { uploadPackageMedia, withMediaPaths, sendImport } =
				await import('#lib/ui/anki-import.ts');
			step = 'media';
			progress = { done: 0, total: built.media.size };
			const media = await uploadPackageMedia(userId, pkg, built.media, (done, total) => {
				progress = { done, total };
			});
			step = 'notes';
			const notes = built.notes.map((n) => withMediaPaths(n, media.paths));
			progress = { done: 0, total: notes.length };
			const totals = await sendImport(language, notes, (done, total) => {
				progress = { done, total };
			});
			result = {
				...totals,
				skipped: built.skipped,
				mediaFailed: media.failed,
				quota: media.quota
			};
			step = 'done';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Não deu para importar agora.';
			step = 'map';
		}
	}

	function reset() {
		pkg = null;
		types = [];
		mappings = {};
		result = null;
		error = null;
		step = 'pick';
	}

	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<svelte:head>
	<title>Importar do Anki · Linguetta</title>
</svelte:head>

<div class="ph">
	<div>
		<h1>Importar do Anki</h1>
		<p>Traga um baralho (.apkg) com mídia, tags e histórico de revisões.</p>
	</div>
	<div class="acts">
		<a class="btn btn-ghost" href={resolve('/flashcards/fichas')}><Icon name="cards" />Fichas</a>
	</div>
</div>

{#if error}<p class="f-err" role="alert">{error}</p>{/if}

{#if step === 'pick' || step === 'reading'}
	<label class="drop" class:busy={step === 'reading'}>
		<Icon name="upload" />
		{#if step === 'reading'}
			<b>Lendo {fileName}…</b>
		{:else}
			<b>Escolher arquivo .apkg</b>
			<span>No Anki: Arquivo → Exportar → “Pacote de baralho do Anki”, com mídia.</span>
		{/if}
		<input
			type="file"
			accept=".apkg,.colpkg"
			disabled={step === 'reading'}
			onchange={(e) => choose(e.currentTarget.files?.[0])}
		/>
	</label>
{:else if step === 'map'}
	<p class="lead">
		<b>{fileName}</b> · escolha o que cada tipo de nota vira. Vocabulário entra no banco de palavras;
		Ficha guarda frente e verso como no Anki.
	</p>

	{#each types as t (t.id)}
		{@const m = mappings[t.id]}
		<section class="type">
			<header>
				<div>
					<h2>{t.name}</h2>
					<span class="faint"
						>{plural(t.notes, 'nota', 'notas')} · {plural(t.cards, 'cartão', 'cartões')}{t.cloze
							? ' · lacunas'
							: ''}</span
					>
				</div>
				<div class="seg" role="group" aria-label="Importar “{t.name}” como">
					{#if !t.cloze}
						<button
							type="button"
							aria-pressed={m.target === 'item'}
							onclick={() => (m.target = 'item')}>Vocabulário</button
						>
					{/if}
					<button
						type="button"
						aria-pressed={m.target === 'ficha'}
						onclick={() => (m.target = 'ficha')}>Ficha</button
					>
					<button
						type="button"
						aria-pressed={m.target === 'skip'}
						onclick={() => (m.target = 'skip')}>Não importar</button
					>
				</div>
			</header>
			<p class="sample">
				{#each t.fields as f, i (i)}
					<span><i>{f}</i> {t.sample[i] || '—'}</span>
				{/each}
			</p>
			{#if m.target === 'item'}
				<div class="fields">
					<label
						>Palavra
						<select bind:value={m.item.lemma}>
							{#each t.fields as f, i (i)}<option value={i}>{f}</option>{/each}
						</select>
					</label>
					{#each [['sense', 'Tradução'], ['sentence', 'Frase'], ['reading', 'Leitura']] as const as [key, label] (key)}
						<label
							>{label}
							<select bind:value={m.item[key]}>
								<option value={null}>—</option>
								{#each t.fields as f, i (i)}<option value={i}>{f}</option>{/each}
							</select>
						</label>
					{/each}
				</div>
			{/if}
		</section>
	{/each}

	<div class="go">
		{#if data.languages.length > 1}
			<label class="lang"
				>Idioma
				<select value={language} onchange={(e) => (picked = e.currentTarget.value as Language)}>
					{#each data.languages as l (l)}<option value={l}>{languageLabel(l, data.ui)}</option
						>{/each}
				</select>
			</label>
		{/if}
		<p>
			{plural(counts.items, 'palavra', 'palavras')} · {plural(counts.fichas, 'ficha', 'fichas')} ·
			{plural(counts.reviews, 'revisão', 'revisões')} · {plural(
				counts.media,
				'arquivo de mídia',
				'arquivos de mídia'
			)}
		</p>
		<button type="button" class="btn btn-ghost" onclick={reset}>Outro arquivo</button>
		<button
			type="button"
			class="btn btn-primary"
			disabled={counts.items + counts.fichas === 0}
			onclick={run}>Importar</button
		>
	</div>
{:else if step === 'media' || step === 'notes'}
	<div class="progress" role="status" aria-live="polite">
		<b>{step === 'media' ? 'Enviando mídia' : 'Importando notas'}</b>
		<span>{progress.done} de {progress.total}</span>
		<div class="bar">
			<i style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"></i>
		</div>
		<span class="faint">Deixe esta aba aberta até terminar.</span>
	</div>
{:else if step === 'done' && result}
	<div class="done" role="status">
		<Icon name="check" />
		<h2>Importação concluída</h2>
		<p>
			{plural(result.items, 'palavra', 'palavras')} e {plural(result.fichas, 'ficha', 'fichas')}.
			{#if result.scheduled > 0}
				{plural(result.scheduled, 'flashcard levou', 'flashcards levaram')} o histórico do Anki.
			{/if}
		</p>
		{#if result.skipped > 0}
			<p class="faint">{plural(result.skipped, 'nota ficou', 'notas ficaram')} de fora.</p>
		{/if}
		{#if result.quota}
			<p class="warn">Seu espaço de mídia (200 MB) acabou; parte das notas ficou sem mídia.</p>
		{:else if result.mediaFailed > 0}
			<p class="warn">
				{plural(
					result.mediaFailed,
					'arquivo de mídia não entrou',
					'arquivos de mídia não entraram'
				)}
				(formato ou tamanho).
			</p>
		{/if}
		<div class="acts">
			<a class="btn btn-ghost" href={resolve('/palavras')}>Ver palavras</a>
			<a class="btn btn-ghost" href={resolve('/flashcards/fichas')}>Ver fichas</a>
			<a class="btn btn-primary" href={resolve('/flashcards')}>Revisar</a>
		</div>
	</div>
{/if}

<style>
	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		max-width: 640px;
		padding: 48px 24px;
		border-radius: var(--r-l);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		text-align: center;
		color: var(--ink-2);
		cursor: pointer;
	}
	.drop:hover {
		background: var(--raise);
	}
	.drop.busy {
		cursor: progress;
	}
	.drop span {
		font-size: 13px;
		color: var(--ink-3);
	}
	.drop input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.drop:focus-within {
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 0 0 3px var(--ring);
	}
	.lead {
		max-width: 760px;
		color: var(--ink-2);
	}
	.type {
		max-width: 760px;
		margin: 14px 0;
		padding: 16px 18px;
		border-radius: var(--r-l);
		background: var(--raise);
		box-shadow: var(--sh-card);
	}
	.type header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}
	.type h2 {
		margin: 0;
		font-size: 16px;
	}
	.type .faint {
		font-size: 12.5px;
	}
	.sample {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 10px 0 0;
		font-size: 13px;
		color: var(--ink-2);
	}
	.sample i {
		font-style: normal;
		color: var(--ink-3);
		font-size: 11.5px;
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
		margin-top: 12px;
	}
	.fields label,
	.lang {
		font-size: 12px;
		color: var(--ink-3);
	}
	select {
		display: block;
		width: 100%;
		margin-top: 4px;
		padding: 7px 10px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		font-size: 14px;
		color: var(--ink);
	}
	.go {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		max-width: 760px;
		margin-top: 20px;
	}
	.go p {
		flex: 1;
		margin: 0;
		font-size: 13.5px;
		color: var(--ink-2);
	}
	.progress,
	.done {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 520px;
	}
	.bar {
		height: 6px;
		border-radius: 3px;
		background: var(--sunk);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: var(--accent, var(--ink));
		transition: width 0.2s;
	}
	.done h2 {
		margin: 0;
	}
	.done p {
		margin: 0;
	}
	.warn {
		color: var(--terra-ink);
	}
	.acts {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}
	@media (max-width: 640px) {
		.fields {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
