<script lang="ts" module>
	/** O que a IA precisa saber da palavra para sugerir imagem; null ou sem lema não busca. */
	export type ImageSuggestContext = {
		language: string;
		lemma: string;
		sense?: string;
		sentence?: string;
	};
</script>

<script lang="ts">
	import { page } from '$app/state';
	import { isAudioName, isImageName, type MediaKind } from '#lib/media.ts';
	import Icon from './Icon.svelte';
	import Popover from './Popover.svelte';
	import { MediaError, prepareMedia, uploadMedia } from './media-upload.ts';

	// Campo de imagem ou áudio de um formulário: escolhe o arquivo, comprime (imagem),
	// sobe direto para o Storage e guarda o caminho num input escondido.
	// Imagem com `suggest`: "✦ Sugerir com IA" abre uma grade de fotos do Wikimedia Commons
	// (a IA só escreve a busca); a escolhida segue o mesmo caminho de um arquivo enviado.

	type ImageHit = { thumb: string; url: string; title: string; page: string };

	let {
		name,
		kind,
		path = null,
		url = null,
		label,
		addLabel,
		onchange,
		suggest
	}: {
		/** Nome do campo no formulário (o valor é o caminho no bucket, ou vazio). */
		name: string;
		kind: MediaKind;
		path?: string | null;
		/** URL assinada da mídia que já existe. */
		url?: string | null;
		label: string;
		/** Texto do botão quando vazio (padrão: o rótulo). */
		addLabel?: string;
		/** Depois de enviar (caminho novo) ou remover (null): a edição no lugar salva aqui. */
		onchange?: (path: string | null) => void;
		/** Só imagem: contexto da palavra no momento do clique (lido do formulário, por ex.). */
		suggest?: () => ImageSuggestContext | null;
	} = $props();

	let value = $state<string | null>(null);
	let preview = $state<string | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let input: HTMLInputElement | undefined = $state();
	$effect.pre(() => {
		value = path;
		preview = url;
	});

	const accept = $derived(kind === 'image' ? 'image/*' : 'audio/*,.mp3,.ogg,.m4a,.wav,.flac,.opus');

	async function choose(file: File | undefined) {
		if (!file) return;
		error = null;
		const ok =
			kind === 'image'
				? file.type.startsWith('image/') || isImageName(file.name)
				: file.type.startsWith('audio/') || isAudioName(file.name);
		if (!ok) {
			error = kind === 'image' ? 'Escolha uma imagem.' : 'Escolha um arquivo de áudio.';
			return;
		}
		try {
			await send(file, file.name);
		} finally {
			if (input) input.value = '';
		}
	}

	/** Comprime (imagem), sobe e guarda o caminho. Devolve se deu certo. */
	async function send(source: Blob, filename: string): Promise<boolean> {
		const userId = page.data.user?.id;
		if (!userId) {
			error = 'Entre de novo para enviar arquivos.';
			return false;
		}
		busy = true;
		try {
			const media = await prepareMedia(kind, source, filename);
			value = await uploadMedia(userId, media);
			preview = URL.createObjectURL(media.blob);
			onchange?.(value);
			return true;
		} catch (e) {
			error = e instanceof MediaError ? e.message : 'Não deu para enviar o arquivo agora.';
			return false;
		} finally {
			busy = false;
		}
	}

	// ---------- Sugerir com IA (só imagem) ----------
	let suggestOpen = $state(false);
	let context = $state<ImageSuggestContext | null>(null);
	let query = $state('');
	let hits = $state<ImageHit[] | null>(null);
	let searching = $state(false);
	let suggestError = $state<string | null>(null);
	let picking = $state<string | null>(null);
	let searchAbort: AbortController | null = null;

	function readContext(): ImageSuggestContext | null {
		const c = suggest?.();
		return c && c.lemma.trim() ? c : null;
	}

	// Some sem lema; reage ao que o `suggest` lê de estado (campos não controlados, não).
	const canSuggest = $derived(kind === 'image' && !!readContext());

	async function toggleSuggest(toggle: () => void) {
		if (suggestOpen) return toggle();
		const c = readContext();
		if (!c) {
			error = 'Escreva a palavra antes de pedir uma imagem.';
			return;
		}
		error = null;
		// Palavra nova: a busca anterior não vale mais.
		if (!context || context.lemma !== c.lemma || context.language !== c.language) {
			query = '';
			hits = null;
		}
		context = c;
		toggle();
		if (!hits && !searching) await search(query);
	}

	/** Sem busca escrita, a IA escreve uma; com busca, vai direto ao Commons. */
	async function search(typed: string) {
		if (!context) return;
		searchAbort?.abort();
		const controller = new AbortController();
		searchAbort = controller;
		searching = true;
		suggestError = null;
		const q = typed.trim();
		try {
			const res = await fetch('/palavras/imagem', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...context, ...(q ? { query: q } : {}) }),
				signal: controller.signal
			});
			const body = (await res.json().catch(() => null)) as {
				query?: unknown;
				images?: unknown;
				message?: unknown;
			} | null;
			if (controller.signal.aborted) return;
			if (!res.ok || !body) {
				suggestError =
					typeof body?.message === 'string' && body.message
						? body.message
						: 'Não deu para buscar imagens agora.';
				return;
			}
			if (typeof body.query === 'string') query = body.query;
			hits = Array.isArray(body.images) ? (body.images as ImageHit[]) : [];
		} catch {
			if (!controller.signal.aborted) suggestError = 'Não deu para buscar imagens agora.';
		} finally {
			if (searchAbort === controller) {
				searchAbort = null;
				searching = false;
			}
		}
	}

	/** Baixa a versão maior (o Wikimedia manda CORS aberto) e sobe como um arquivo escolhido. */
	async function pick(hit: ImageHit, close: () => void) {
		if (picking || busy) return;
		picking = hit.url;
		suggestError = null;
		try {
			let blob: Blob;
			try {
				const res = await fetch(hit.url, { mode: 'cors', credentials: 'omit' });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				blob = await res.blob();
			} catch {
				suggestError = 'Não deu para baixar essa imagem. Tente outra.';
				return;
			}
			error = null;
			if (await send(blob, `${hit.title}.jpg`)) close();
			else suggestError = error;
		} finally {
			picking = null;
		}
	}

	function onQueryKey(e: KeyboardEvent) {
		// Dentro de <form>: Enter busca em vez de enviar o formulário.
		if (e.key === 'Enter') {
			e.preventDefault();
			void search(query);
		}
	}

	function clear() {
		value = null;
		preview = null;
		error = null;
		onchange?.(null);
	}
</script>

{#snippet suggestButton(cls: string)}
	<Popover
		bind:open={suggestOpen}
		label="Imagens sugeridas"
		align={value ? 'end' : 'start'}
		width={340}
	>
		{#snippet trigger({ toggle, expanded, id })}
			<button
				type="button"
				class={cls}
				disabled={busy}
				aria-haspopup="dialog"
				aria-expanded={expanded}
				aria-controls={id}
				title="Fotos do Wikimedia Commons; a IA escolhe a busca"
				onclick={() => toggleSuggest(toggle)}
				><span class="spark" aria-hidden="true">✦</span>Sugerir com IA</button
			>
		{/snippet}
		{#snippet children({ close })}
			<div class="sug">
				<div class="sug-q">
					<input
						type="text"
						bind:value={query}
						placeholder={searching && !query ? 'A IA está escolhendo a busca…' : 'Busca em inglês'}
						aria-label="Busca de imagens (em inglês)"
						maxlength="80"
						onkeydown={onQueryKey}
					/>
					<button
						type="button"
						class="mini"
						onclick={() => search(query)}
						disabled={searching}
						title="Buscar de novo"
						aria-label="Buscar de novo"><Icon name="refresh" size="sm" /></button
					>
				</div>
				{#if suggestError}
					<p class="err" role="alert">{suggestError}</p>
				{/if}
				{#if searching}
					<div class="sug-grid" aria-busy="true">
						{#each { length: 6 }, i (i)}<span class="sug-cell ghost"></span>{/each}
					</div>
				{:else if hits && hits.length > 0}
					<div class="sug-grid">
						{#each hits as hit (hit.url)}
							<button
								type="button"
								class="sug-cell"
								class:loading={picking === hit.url}
								disabled={!!picking || busy}
								title={hit.title}
								aria-label="Usar {hit.title}"
								onclick={() => pick(hit, close)}
							>
								<img src={hit.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" />
							</button>
						{/each}
					</div>
					<p class="sug-hint">
						{picking ? 'Enviando…' : 'Clique para usar. Fica salva no seu banco.'}
						<a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer"
							>Wikimedia Commons</a
						>
					</p>
				{:else if hits}
					<p class="sug-hint">Nenhuma foto para essa busca. Tente outras palavras.</p>
				{/if}
			</div>
		{/snippet}
	</Popover>
{/snippet}

<div class="media-field" class:filled={!!value}>
	<input type="hidden" {name} value={value ?? ''} />
	<input
		bind:this={input}
		class="file"
		type="file"
		{accept}
		tabindex="-1"
		aria-hidden="true"
		onchange={(e) => choose(e.currentTarget.files?.[0])}
	/>
	{#if value && preview}
		{#if kind === 'image'}
			<img src={preview} alt="" class="thumb" />
		{:else}
			<audio src={preview} controls preload="none" class="player"></audio>
		{/if}
		<div class="acts">
			<button type="button" class="mini" onclick={() => input?.click()} disabled={busy}
				>Trocar</button
			>
			{#if canSuggest}{@render suggestButton('mini')}{/if}
			<button type="button" class="mini" onclick={clear} aria-label="Remover {label.toLowerCase()}"
				><Icon name="x" size="sm" /></button
			>
		</div>
	{:else if value}
		<span class="kept">{kind === 'image' ? 'Imagem guardada' : 'Áudio guardado'}</span>
		<button type="button" class="mini" onclick={clear} aria-label="Remover {label.toLowerCase()}"
			><Icon name="x" size="sm" /></button
		>
	{:else}
		<button type="button" class="pick" onclick={() => input?.click()} disabled={busy}>
			<Icon name={busy ? 'upload' : kind === 'image' ? 'image' : 'sound'} size="sm" />
			{busy ? 'Enviando…' : (addLabel ?? label)}
		</button>
		{#if canSuggest}{@render suggestButton('pick ai')}{/if}
	{/if}
	{#if error}<p class="err" role="alert">{error}</p>{/if}
</div>

<style>
	.media-field {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	/* Sem imagem, a grade abre a partir do campo inteiro (não do botão, que fica à direita
	   de "Adicionar imagem") e nunca passa da largura dele. Com imagem, abre para a esquerda. */
	@media (min-width: 561px) {
		.media-field:not(.filled) :global(.pop-wrap) {
			position: static;
		}
		.media-field:not(.filled) :global(.pop) {
			left: 0;
			right: auto;
			width: min(var(--w), 100%);
		}
	}
	.file {
		display: none;
	}
	.pick {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border: 1px dashed var(--line-2);
		border-radius: var(--r-m);
		background: transparent;
		color: var(--ink-2);
		font-size: 13px;
	}
	.pick:hover:not(:disabled) {
		background: var(--tile);
	}
	.pick.ai {
		border-style: solid;
		border-color: var(--line);
	}
	.spark {
		margin-right: 4px;
	}
	.sug-q {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.sug-q input {
		flex: 1;
		min-width: 0;
		height: 32px;
		padding: 0 10px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-m);
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 13px;
	}
	.sug-q .mini {
		height: 32px;
	}
	.sug-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin-top: 10px;
	}
	.sug-cell {
		aspect-ratio: 4 / 3;
		padding: 0;
		overflow: hidden;
		border: 0;
		border-radius: 8px;
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.sug-cell img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.sug-cell:hover:not(:disabled),
	.sug-cell:focus-visible,
	.sug-cell.loading {
		outline: 2px solid var(--ink-2);
		outline-offset: 2px;
	}
	.sug-cell:disabled:not(.loading) {
		opacity: 0.55;
	}
	.sug-cell.ghost {
		animation: pulse 1.1s ease-in-out infinite alternate;
	}
	@keyframes pulse {
		to {
			opacity: 0.45;
		}
	}
	.sug-hint {
		margin: 10px 0 0;
		color: var(--ink-3);
		font-size: 12px;
	}
	.sug-hint a {
		color: inherit;
	}
	.sug .err {
		margin-top: 8px;
	}
	.thumb {
		width: 64px;
		height: 48px;
		object-fit: cover;
		border-radius: 8px;
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.player {
		height: 32px;
		max-width: 220px;
	}
	.acts {
		display: flex;
		gap: 4px;
	}
	.mini {
		display: inline-flex;
		align-items: center;
		height: 28px;
		padding: 0 8px;
		border: 0;
		border-radius: 6px;
		background: var(--tile);
		color: var(--ink-2);
		font-size: 12.5px;
	}
	.kept {
		font-size: 13px;
		color: var(--ink-3);
	}
	.err {
		width: 100%;
		margin: 0;
		color: var(--terra-ink);
		font-size: 12.5px;
	}
</style>
