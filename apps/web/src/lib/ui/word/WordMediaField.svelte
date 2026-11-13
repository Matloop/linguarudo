<!--
	Imagem ou áudio da palavra, em cima do MediaField (envio direto para o Storage).
	Modo "form": input escondido `image`/`audio` com o caminho, para o <form> em volta.
	Modo "inline": salva no ?/edit logo depois de enviar ou remover (só o campo mexido vai).
		<WordMediaField kind="image" mode="inline" item={selected} url={data.selectedMedia.image} />
-->
<script lang="ts">
	import type { MediaKind } from '#lib/media.ts';
	import { itemEditFields, type EditableItem } from '#lib/word-fields.ts';
	import MediaField from '../MediaField.svelte';
	import { EDIT_ACTION, saveField } from './inline-save.ts';

	let {
		kind,
		mode = 'form',
		path = null,
		url = null,
		item,
		error = '',
		action = EDIT_ACTION,
		addLabel,
		onsaved
	}: {
		kind: MediaKind;
		mode?: 'form' | 'inline';
		/** Caminho atual no bucket (no inline, o padrão é item.image/item.audio). */
		path?: string | null;
		/** URL assinada da mídia atual. */
		url?: string | null;
		item?: EditableItem;
		/** Modo form: erro vindo da action. */
		error?: string;
		action?: string;
		/** Texto do botão quando não há mídia (ex.: "Adicionar imagem"). */
		addLabel?: string;
		onsaved?: (kind: MediaKind, path: string | null) => void;
	} = $props();

	const label = $derived(kind === 'image' ? 'Imagem' : 'Áudio');
	const current = $derived(mode === 'inline' && item ? (item[kind] ?? null) : path);

	let saving = $state(false);
	let inlineError = $state('');

	async function save(next: string | null) {
		if (mode !== 'inline' || !item) return;
		const target = item;
		saving = true;
		inlineError = '';
		const r = await saveField(action, () => itemEditFields(target, kind, next ?? ''), kind);
		saving = false;
		if (r.ok) onsaved?.(kind, next);
		else inlineError = r.error;
	}

	const shownError = $derived(mode === 'inline' ? inlineError : error);
</script>

<div class="word-media" class:busy={saving}>
	<MediaField
		name={kind}
		{kind}
		{label}
		{addLabel}
		path={current}
		{url}
		onchange={mode === 'inline' ? save : undefined}
	/>
	{#if shownError}<p class="err" role="alert">{shownError}</p>{/if}
</div>

<style>
	.word-media {
		min-width: 0;
	}
	.busy {
		opacity: 0.6;
		pointer-events: none;
	}
	.err {
		margin: 6px 0 0;
		color: var(--terra-ink);
		font-size: 12.5px;
	}
</style>
