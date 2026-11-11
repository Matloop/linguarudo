<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { LIMITS } from '#lib/items.ts';
	import { parseYoutubeId } from '#lib/music/youtube.ts';
	import { LANGUAGE_LABELS } from '#lib/languages.ts';
	import { MUSIC_LANGUAGES, type MusicLanguage } from '#lib/music/wordlists.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

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
	<title>Música · Linguarudo</title>
</svelte:head>

<div class="topo">
	<h1>Música</h1>
	<p class="sub">Complete a letra de uma música que você gosta.</p>
</div>

<form
	class="nova"
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
	<h2 id="nova-titulo">Escolher música</h2>

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
					<span>{LANGUAGE_LABELS[l]}</span>
				</label>
			{/each}
		</div>
		{#if errors.language}<p class="erro" role="alert">{errors.language}</p>{/if}
	</fieldset>

	{#if formError}<p class="erro" role="alert">{formError}</p>{/if}

	<div class="acoes">
		<p class="nota">A letra vem do LRCLIB na hora de jogar. Nada dela fica guardado.</p>
		<button class="jogar" type="submit" disabled={submitting}>
			{submitting ? 'Abrindo…' : 'Jogar'}
		</button>
	</div>
</form>

<section class="recentes" aria-labelledby="recentes-titulo">
	<h2 id="recentes-titulo">Tocadas recentemente</h2>
	{#if data.songs.length === 0}
		<div class="vazio">
			<p>Nenhuma música ainda. Cole um link aí em cima para começar.</p>
		</div>
	{:else}
		<ul>
			{#each data.songs as song (song.id)}
				<li>
					<a href={resolve('/musica/[id]', { id: song.id })}>
						<span class="miniatura" aria-hidden="true">
							<img
								src={`https://i.ytimg.com/vi/${song.youtubeId}/mqdefault.jpg`}
								alt=""
								loading="lazy"
								width="120"
								height="68"
							/>
						</span>
						<span class="texto">
							<strong>{song.title}</strong>
							<span class="artista">{song.artist}</span>
						</span>
						<span class="selo {song.language}" title={LANGUAGE_LABELS[song.language]}
							>{song.language.toUpperCase()}</span
						>
						<span class="data">{song.playedAt ? playedAt(song.playedAt) : ''}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.topo {
		margin-bottom: 16px;
	}

	h1 {
		margin: 0;
		font-size: 28px;
		color: var(--verde);
		letter-spacing: -0.01em;
	}

	.sub {
		margin: 4px 0 0;
		color: var(--cinza);
		font-weight: 650;
	}

	.nova {
		background: var(--papel);
		border: 1.5px solid var(--linha);
		border-radius: 22px;
		padding: 18px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	h2 {
		margin: 0;
		font-size: 16px;
		color: var(--verde);
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
		gap: 14px;
	}

	label,
	legend {
		font-weight: 700;
		font-size: 14px;
		color: var(--verde);
	}

	input:not([type='radio']) {
		width: 100%;
		border: 2px solid var(--linha);
		background: #fff;
		border-radius: var(--raio-p);
		padding: 11px 13px;
		font-size: 16px;
	}

	input:focus {
		border-color: var(--salvia);
		outline: none;
	}

	[aria-invalid='true'] {
		border-color: var(--coral) !important;
	}

	.ajuda {
		margin: 0;
		font-size: 13px;
		color: var(--tinta-suave);
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
		background: #fff;
		border: 2px solid var(--linha);
		border-radius: 99px;
		padding: 3px;
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
		padding: 6px 16px;
		border-radius: 99px;
		font-weight: 800;
		font-size: 14px;
		color: var(--cinza);
	}

	.segmentos input:checked + span {
		background: var(--verde);
		color: var(--creme);
	}

	.segmentos input:focus-visible + span {
		outline: 3px solid var(--azul);
		outline-offset: 1px;
	}

	.acoes {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.nota {
		margin: 0;
		font-size: 13px;
		color: var(--tinta-suave);
		min-width: 0;
	}

	.jogar {
		flex: none;
		border: 0;
		background: var(--coral);
		color: var(--verde-escuro);
		font-weight: 850;
		font-size: 16px;
		border-radius: 14px;
		padding: 12px 26px;
		box-shadow: var(--sombra-botao) var(--coral-escuro);
	}

	.jogar:active:not(:disabled) {
		transform: translateY(2px);
		box-shadow: 0 1px 0 var(--coral-escuro);
	}

	.jogar:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.erro {
		margin: 0;
		color: var(--coral-escuro);
		font-weight: 700;
		font-size: 14px;
	}

	.recentes {
		margin-top: 28px;
	}

	.recentes ul {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.recentes a {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px 8px 8px;
		background: var(--papel);
		border: 1.5px solid var(--linha);
		border-radius: var(--raio);
		text-decoration: none;
		color: var(--tinta);
	}

	.recentes a:hover {
		border-color: var(--salvia);
	}

	.miniatura {
		flex: none;
		width: 84px;
		aspect-ratio: 16 / 9;
		border-radius: 10px;
		overflow: hidden;
		background: var(--verde);
	}

	.miniatura img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.texto {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.texto strong {
		color: var(--verde);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.artista {
		font-size: 14px;
		color: var(--tinta-suave);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selo {
		font-size: 11px;
		font-weight: 850;
		letter-spacing: 0.05em;
		border-radius: 6px;
		padding: 2px 7px;
		background: var(--salvia-claro);
		color: var(--verde);
	}

	.selo.it {
		background: #f6e2c2;
		color: #7a4b12;
	}

	.data {
		font-size: 13px;
		color: var(--cinza);
		font-weight: 650;
	}

	.vazio {
		margin-top: 12px;
		border: 1.5px dashed var(--linha);
		border-radius: var(--raio);
		padding: 18px;
		text-align: center;
		color: var(--tinta-suave);
		font-weight: 600;
	}

	.vazio p {
		margin: 0;
	}

	@media (min-width: 640px) {
		.linha {
			flex-direction: row;
		}

		.cresce {
			flex: 1;
		}
	}
</style>
