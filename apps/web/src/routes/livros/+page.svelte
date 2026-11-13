<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { inRange, rangeProgress, rangeState } from '#lib/blend/book-ui.ts';
	import { languagePair } from '#lib/blend/filename.ts';
	import { languageLabel } from '#lib/languages.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Mark from '#lib/ui/Mark.svelte';
	import Popover from '#lib/ui/Popover.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { toast } from '#lib/ui/app-state.svelte.ts';
	import { browserSupabase } from '#lib/ui/media-upload.ts';
	import { postAction } from '#lib/ui/post-action.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const MAX_BYTES = 50 * 1024 * 1024;

	const languageOptions = $derived(
		data.studyLanguages.map((l) => ({ value: l, label: languageLabel(l, 'pt') }))
	);
	let target = $state<string>('');
	$effect(() => {
		if (!target || !data.studyLanguages.includes(target)) {
			target = data.active ?? data.studyLanguages[0] ?? '';
		}
	});

	let fileInput: HTMLInputElement | undefined = $state();
	let uploading = $state(false);
	let uploadOpen = $state(false);
	let uploadError = $state('');

	async function upload(file: File) {
		uploadError = '';
		if (!/\.epub$/i.test(file.name)) return (uploadError = 'Escolha um arquivo .epub.');
		if (file.size > MAX_BYTES) return (uploadError = 'O EPUB passa de 50 MB.');
		if (!target) return (uploadError = 'Escolha o idioma do blend.');
		uploading = true;
		const id = crypto.randomUUID();
		const { error } = await browserSupabase()
			.storage.from('books')
			.upload(`${data.userId}/${id}/original.epub`, file, {
				contentType: 'application/epub+zip',
				upsert: false
			});
		if (error) {
			uploading = false;
			uploadError = 'Não deu para enviar o arquivo. Tente de novo.';
			return;
		}
		const res = await fetch(resolve('/livros/novo'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, language: target })
		}).catch(() => null);
		const body = (await res?.json().catch(() => null)) as { message?: string } | null;
		uploading = false;
		if (!res?.ok) {
			uploadError = body?.message ?? 'Não deu para abrir o EPUB.';
			return;
		}
		uploadOpen = false;
		await goto(resolve('/livros/[id]', { id }));
	}

	function onPick(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (file) void upload(file);
		(e.currentTarget as HTMLInputElement).value = '';
	}

	async function setDevice(id: string, on: boolean) {
		const r = await postAction('device', { id, on: String(on) });
		if (!r.ok) return toast(r.message);
		toast(on ? 'Vai para o aparelho no próximo sync' : 'Sai do aparelho no próximo sync');
	}

	async function remove(id: string, title: string) {
		if (!confirm(`Apagar “${title}”? As palavras que você guardou dele ficam.`)) return;
		const r = await postAction('delete', { id });
		if (!r.ok) return toast(r.message);
		toast('Livro apagado');
	}
</script>

<svelte:head>
	<title>Livros · Linguetta</title>
</svelte:head>

{#snippet uploader()}
	<Popover label="Enviar EPUB" bind:open={uploadOpen} width={320}>
		{#snippet trigger({ toggle, expanded, id })}
			<button
				class="btn btn-primary"
				type="button"
				aria-haspopup="dialog"
				aria-expanded={expanded}
				aria-controls={id}
				onclick={toggle}
				data-testid="enviar-epub"><Icon name="upload" size="sm" />Enviar EPUB</button
			>
		{/snippet}
		{#snippet children({ close })}
			<div class="pop-form">
				<span class="pop-title" id="blend-lang">Misturar em</span>
				{#if languageOptions.length}
					<Select options={languageOptions} bind:value={target} labelledby="blend-lang" />
				{:else}
					<p class="faint">Escolha um idioma de estudo no Perfil primeiro.</p>
				{/if}
				<p class="faint small">Arquivo .epub de até 50 MB. O original fica guardado para gerar de novo.</p>
				{#if uploadError}<p class="err" role="alert">{uploadError}</p>{/if}
				<input
					bind:this={fileInput}
					class="visually-hidden"
					type="file"
					accept=".epub,application/epub+zip"
					onchange={onPick}
					data-testid="arquivo-epub"
				/>
				<div class="pop-row">
					<span class="sp"></span>
					<button class="btn btn-ghost" type="button" onclick={close}>Cancelar</button>
					<button
						class="btn btn-primary"
						type="button"
						disabled={uploading || !target}
						onclick={() => fileInput?.click()}
						>{uploading ? 'Enviando…' : 'Escolher arquivo'}</button
					>
				</div>
			</div>
		{/snippet}
	</Popover>
{/snippet}

<div class="ph">
	<div>
		<h1>Livros</h1>
		{#if data.books.length}<p>Livros com blend: algumas palavras trocadas pelo idioma que você estuda.</p>{/if}
	</div>
	{#if data.books.length}<div class="ph-acts">{@render uploader()}</div>{/if}
</div>

{#if data.books.length === 0}
	<div class="empty">
		<div>
			<Mark class="mark mark-hero" />
			<h2>Nenhum livro ainda</h2>
			<p>
				Envie um EPUB e escolha quanto misturar. O Linguetta troca algumas palavras pelo idioma que
				você estuda, com a tradução a um toque.
			</p>
			<div class="acts">{@render uploader()}</div>
		</div>
	</div>
{:else}
	<ul class="books" aria-label="Seus livros">
		{#each data.books as b (b.id)}
			{@const total = inRange(b.chapters, b.range_from, b.range_to).length}
			{@const pct = Math.round(rangeProgress(b.chapters, b.range_from, b.range_to) * 100)}
			{@const ready = pct >= 100 && total > 0}
			<li class="tile lift book" data-testid="livro">
				<div class="top">
					<div class="txt">
						<a class="title" href={resolve('/livros/[id]', { id: b.id })}>{b.title}</a>
						<span class="meta">
							{#if b.author}{b.author} · {/if}<span
								title="{languageLabel(b.book_language, 'pt')} com {languageLabel(b.language, 'pt')}"
								>{languagePair(b.book_language, b.language)}</span
							>
						</span>
					</div>
					<label class="device" title="Baixar no aparelho no próximo sync">
						<span>No aparelho</span>
						<input
							class="switch"
							type="checkbox"
							checked={b.on_device}
							onchange={(e) => setDevice(b.id, e.currentTarget.checked)}
						/>
					</label>
				</div>
				<div class="state">
					<span class="meta" data-testid="estado">{rangeState(b.chapters, b.range_from, b.range_to)}</span>
					<span
						class="bar"
						role="progressbar"
						aria-label="Capítulos prontos"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={pct}><i style:width="{pct}%"></i></span
					>
				</div>
				<div class="acts">
					{#if b.current_version}
						<a class="btn btn-soft" href={resolve('/livros/[id]/ler', { id: b.id })}
							><Icon name="play" size="sm" />Ler</a
						>
						<a
							class="btn btn-ghost"
							href={resolve('/livros/[id]/baixar', { id: b.id })}
							data-sveltekit-reload><Icon name="down" size="sm" />Baixar EPUB</a
						>
					{/if}
					<a class="btn btn-ghost" href={resolve('/livros/[id]', { id: b.id })}
						><Icon name="sparks" size="sm" />{ready && b.current_version
							? 'Ajustar'
							: pct > 0
								? 'Continuar'
								: 'Gerar'}</a
					>
					<span class="sp"></span>
					<button
						class="icon-btn"
						type="button"
						aria-label="Apagar {b.title}"
						title="Apagar"
						onclick={() => remove(b.id, b.title)}><Icon name="trash" /></button
					>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.ph-acts {
		display: flex;
		gap: 8px;
	}
	.books {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 14px;
	}
	.book {
		gap: 14px;
	}
	.top {
		display: flex;
		align-items: flex-start;
		gap: 16px;
	}
	.txt {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}
	.title {
		font: 600 19px/1.3 var(--f-head);
		color: var(--ink);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.title:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.meta {
		color: var(--ink-2);
		font-size: 14px;
	}
	.device {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 14px;
		color: var(--ink-2);
		white-space: nowrap;
		cursor: pointer;
	}
	.state {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.acts {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.sp {
		flex: 1;
	}
	.pop-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.pop-title {
		font-size: 14px;
		font-weight: 500;
		color: var(--ink-2);
	}
	.pop-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 4px;
	}
	.small {
		margin: 0;
		font-size: 13px;
	}
	.err {
		margin: 0;
		font-size: 13.5px;
		color: var(--terra-ink);
	}
	@media (max-width: 768px) {
		.top {
			flex-direction: column;
			gap: 10px;
		}
	}
</style>
