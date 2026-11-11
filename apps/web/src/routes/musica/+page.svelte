<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { LIMITS } from '#lib/items.ts';
	import { parseYoutubeId } from '#lib/music/youtube.ts';
	import { languageLabel } from '#lib/languages.ts';
	import { MUSIC_LANGUAGES, type MusicLanguage } from '#lib/music/wordlists.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const uiLanguage = $derived(data.shell?.uiLanguage ?? 'pt');
	const errors = $derived(form && 'errors' in form ? form.errors : {});
	const formError = $derived(errors.form);

	// Sem JS o servidor devolve os valores digitados; com JS o estado local manda.
	const initial = untrack(() => form?.values);
	let url = $state(initial?.url ?? '');
	let title = $state(initial?.title ?? '');
	let artist = $state(initial?.artist ?? '');
	let language = $state<MusicLanguage>((initial?.language as MusicLanguage | undefined) ?? 'en');
	let lookup = $state<'idle' | 'loading' | 'failed'>('idle');
	let submitting = $state(false);

	const videoId = $derived(parseYoutubeId(url));

	async function fillFromVideo() {
		const id = parseYoutubeId(url);
		if (!id) return;
		lookup = 'loading';
		try {
			const res = await fetch(`/musica/info?v=${encodeURIComponent(id)}`);
			if (!res.ok) throw new Error(String(res.status));
			const info = (await res.json()) as { title: string; artist: string };
			// Não pisa no que a pessoa já escreveu.
			if (title.trim() === '') title = info.title;
			if (artist.trim() === '') artist = info.artist;
			lookup = 'idle';
		} catch {
			lookup = 'failed';
		}
	}

	function onUrlInput() {
		lookup = 'idle';
		if (videoId && title.trim() === '' && artist.trim() === '') void fillFromVideo();
	}

	function playedAt(iso: string) {
		return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(
			new Date(iso)
		);
	}
</script>

<svelte:head>
	<title>Música · Linguetta</title>
</svelte:head>

<div class="ph">
	<div>
		<h1>Música</h1>
		<p>Complete a letra de uma música que você gosta, escolhendo a palavra certa.</p>
	</div>
</div>

<form
	class="tile lift nova"
	method="POST"
	action="?/play"
	aria-labelledby="nova-titulo"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	<h2 id="nova-titulo"><Icon name="music" size="sm" />Escolher música</h2>

	<div class="campo">
		<label for="url">Link do YouTube</label>
		<input
			id="url"
			name="url"
			type="text"
			inputmode="url"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			placeholder="https://www.youtube.com/watch?v=…"
			bind:value={url}
			oninput={onUrlInput}
			onblur={() => videoId && title.trim() === '' && artist.trim() === '' && fillFromVideo()}
			aria-invalid={errors.url ? 'true' : undefined}
			aria-describedby="url-ajuda"
		/>
		{#if errors.url}<p class="erro" role="alert">{errors.url}</p>{/if}
		<p id="url-ajuda" class="ajuda" role="status">
			{#if lookup === 'loading'}
				Buscando título e artista…
			{:else if lookup === 'failed'}
				Não deu para ler o vídeo. Escreva o título e o artista abaixo.
			{:else}
				Cole o link e o título e o artista aparecem sozinhos. Confira, porque a letra é buscada por
				eles.
			{/if}
		</p>
	</div>

	<div class="linha">
		<div class="campo cresce">
			<label for="title">Título da música</label>
			<input
				id="title"
				name="title"
				maxlength={LIMITS.title}
				autocomplete="off"
				bind:value={title}
				aria-invalid={errors.title ? 'true' : undefined}
			/>
			{#if errors.title}<p class="erro" role="alert">{errors.title}</p>{/if}
		</div>
		<div class="campo cresce">
			<label for="artist">Artista</label>
			<input
				id="artist"
				name="artist"
				maxlength={LIMITS.title}
				autocomplete="off"
				bind:value={artist}
				aria-invalid={errors.artist ? 'true' : undefined}
			/>
			{#if errors.artist}<p class="erro" role="alert">{errors.artist}</p>{/if}
		</div>
	</div>

	<fieldset class="idioma">
		<legend>Língua da música</legend>
		<div class="segmentos">
			{#each MUSIC_LANGUAGES as l (l)}
				<label>
					<input type="radio" name="language" value={l} bind:group={language} />
					<span>{languageLabel(l, uiLanguage)}</span>
				</label>
			{/each}
		</div>
		{#if errors.language}<p class="erro" role="alert">{errors.language}</p>{/if}
	</fieldset>

	{#if formError}<p class="erro" role="alert">{formError}</p>{/if}

	<div class="acoes">
		<p class="nota">A letra vem do LRCLIB na hora de jogar. Nada dela fica guardado.</p>
		<button class="btn btn-primary btn-lg" type="submit" disabled={submitting}>
			<Icon name="play" size="sm" />{submitting ? 'Abrindo…' : 'Jogar'}
		</button>
	</div>
</form>

<section class="recentes" aria-labelledby="recentes-titulo">
	<h2 class="eyebrow" id="recentes-titulo">Tocadas recentemente</h2>
	{#if data.songs.length === 0}
		<p class="vazio">Nenhuma música ainda. Cole um link aí em cima para começar.</p>
	{:else}
		<ul class="songs">
			{#each data.songs as song (song.id)}
				<li>
					<a class="song" href={resolve('/musica/[id]', { id: song.id })}>
						<span class="art" aria-hidden="true">
							<img
								src={`https://i.ytimg.com/vi/${song.youtubeId}/mqdefault.jpg`}
								alt=""
								loading="lazy"
								width="120"
								height="68"
							/>
						</span>
						<span class="texto">
							<b>{song.title}</b>
							<span>{song.artist}</span>
						</span>
						<span class="code" title={languageLabel(song.language, uiLanguage)}
							>{song.language.toUpperCase()}</span
						>
						<span class="data">{song.playedAt ? playedAt(song.playedAt) : ''}</span>
						<span class="btn btn-soft" aria-hidden="true">Jogar de novo</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.nova {
		padding: 22px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 32px;
	}
	.nova h2 {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		font: 600 16px var(--f-head);
		letter-spacing: -0.01em;
	}
	.campo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.linha {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	label,
	legend {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--ink-3);
	}
	input:not([type='radio']) {
		width: 100%;
		height: 40px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink);
		padding: 0 12px;
		font: inherit;
		font-size: 15px;
		transition: box-shadow 0.15s;
	}
	input:not([type='radio']):focus {
		outline: none;
		box-shadow: inset 0 0 0 1.5px var(--ink-3);
	}
	[aria-invalid='true'] {
		box-shadow: inset 0 0 0 1.5px var(--terra-ink) !important;
	}
	.ajuda,
	.nota {
		margin: 0;
		font-size: 13px;
		color: var(--ink-3);
		text-wrap: pretty;
	}
	.idioma {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.idioma legend {
		padding: 0;
		margin-bottom: 6px;
	}
	.segmentos {
		display: inline-flex;
		align-self: flex-start;
		padding: 3px;
		gap: 2px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.segmentos label {
		position: relative;
		cursor: pointer;
	}
	.segmentos input {
		position: absolute;
		opacity: 0;
		inset: 0;
		margin: 0;
		cursor: pointer;
	}
	.segmentos span {
		display: block;
		height: 30px;
		line-height: 30px;
		padding: 0 12px;
		border-radius: var(--r-s);
		font-size: 13.5px;
		font-weight: 500;
		color: var(--ink-2);
	}
	.segmentos input:checked + span {
		background: var(--raise);
		color: var(--ink);
		box-shadow: var(--sh-card);
	}
	:global(.tema-escuro) .segmentos input:checked + span {
		background: rgba(247, 241, 230, 0.09);
		box-shadow: none;
	}
	.segmentos input:focus-visible + span {
		outline: 2px solid var(--ink-3);
		outline-offset: 1px;
	}
	.acoes {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.erro {
		margin: 0;
		color: var(--terra-ink);
		font-size: 13.5px;
	}

	.recentes .eyebrow {
		margin: 0 0 8px;
	}
	.vazio {
		margin: 0;
		padding: 18px 0;
		color: var(--ink-3);
	}
	.songs {
		list-style: none;
		padding: 0;
		margin: 0 -14px;
		display: flex;
		flex-direction: column;
	}
	.song {
		display: grid;
		grid-template-columns: 84px minmax(0, 1fr) auto auto auto;
		gap: 18px;
		align-items: center;
		padding: 10px 14px;
		border-radius: var(--r-m);
		color: inherit;
		text-decoration: none;
		transition: background-color 0.15s;
	}
	.song:hover {
		background: var(--hover);
	}
	.art {
		width: 84px;
		aspect-ratio: 16 / 9;
		border-radius: var(--r-s);
		overflow: hidden;
		background: var(--tile);
	}
	.art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.texto {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.texto b {
		font: 600 15.5px/1.3 var(--f-head);
		letter-spacing: -0.01em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.texto span {
		font-size: 13px;
		color: var(--ink-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.data {
		font-size: 12.5px;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	@media (min-width: 640px) {
		.linha {
			flex-direction: row;
		}
		.cresce {
			flex: 1;
		}
	}
	@media (max-width: 768px) {
		.song {
			grid-template-columns: 72px minmax(0, 1fr) auto;
			gap: 12px;
		}
		.art {
			width: 72px;
		}
		.song .data,
		.song .btn {
			display: none;
		}
		.acoes {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
