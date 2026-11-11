<script lang="ts">
	import { page } from '$app/state';
	import { isAudioName, isImageName, type MediaKind } from '#lib/media.ts';
	import Icon from './Icon.svelte';
	import { MediaError, prepareMedia, uploadMedia } from './media-upload.ts';

	// Campo de imagem ou áudio de um formulário: escolhe o arquivo, comprime (imagem),
	// sobe direto para o Storage e guarda o caminho num input escondido.

	let {
		name,
		kind,
		path = null,
		url = null,
		label
	}: {
		/** Nome do campo no formulário (o valor é o caminho no bucket, ou vazio). */
		name: string;
		kind: MediaKind;
		path?: string | null;
		/** URL assinada da mídia que já existe. */
		url?: string | null;
		label: string;
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
		const userId = page.data.user?.id;
		if (!userId) {
			error = 'Entre de novo para enviar arquivos.';
			return;
		}
		busy = true;
		try {
			const media = await prepareMedia(kind, file, file.name);
			value = await uploadMedia(userId, media);
			preview = URL.createObjectURL(media.blob);
		} catch (e) {
			error = e instanceof MediaError ? e.message : 'Não deu para enviar o arquivo agora.';
		} finally {
			busy = false;
			if (input) input.value = '';
		}
	}

	function clear() {
		value = null;
		preview = null;
		error = null;
	}
</script>

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
			{busy ? 'Enviando…' : label}
		</button>
	{/if}
	{#if error}<p class="err" role="alert">{error}</p>{/if}
</div>

<style>
	.media-field {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		min-width: 0;
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
