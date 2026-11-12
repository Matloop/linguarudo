<script lang="ts">
	// Painel "Criar" de /musica: um link do YouTube vira música (vídeo) ou álbum (playlist).
	import { enhance } from '$app/forms';
	import { LIMITS } from '#lib/items.ts';
	import { languageLabel, type UiLanguage } from '#lib/languages.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { parsePlaylistId, type Playlist } from './playlist.ts';
	import { MUSIC_LANGUAGES, type MusicLanguage } from './wordlists.ts';
	import { parseYoutubeId } from './youtube.ts';

	interface Props {
		open: boolean;
		/** Erros que o servidor devolveu na última tentativa. */
		errors: Record<string, string>;
		uiLanguage: UiLanguage;
	}

	let { open = $bindable(), errors: serverErrors, uiLanguage }: Props = $props();

	type Lyrics = 'checking' | 'ok' | 'none' | 'unknown';
	interface Track {
		youtubeId: string;
		title: string;
		artist: string;
		language: MusicLanguage;
		include: boolean;
		lyrics: Lyrics;
	}

	let dialog = $state<HTMLDialogElement>();
	let urlInput = $state<HTMLInputElement>();
	let url = $state('');
	let title = $state('');
	let artist = $state('');
	let language = $state<MusicLanguage>('en');
	let tracks = $state<Track[]>([]);
	let lookup = $state<'idle' | 'loading' | 'failed'>('idle');
	// Vídeo dentro de playlist: álbum (OLAK5uy) abre o álbum; outra playlist, só a música.
	let wantAlbum = $state<boolean | null>(null);
	let submitting = $state(false);
	let localErrors = $state<Record<string, string>>({});
	let lookupSeq = 0;

	const errors = $derived({ ...serverErrors, ...localErrors });
	const videoId = $derived(parseYoutubeId(url));
	const listId = $derived(parsePlaylistId(url));
	const both = $derived(videoId !== null && listId !== null);
	const mode = $derived<'musica' | 'album' | null>(
		listId && (!videoId || (wantAlbum ?? listId.startsWith('OLAK5uy')))
			? 'album'
			: videoId
				? 'musica'
				: null
	);
	const chosen = $derived(tracks.filter((t) => t.include));
	const checking = $derived(tracks.some((t) => t.lyrics === 'checking'));

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			requestAnimationFrame(() => urlInput?.focus());
		} else if (!open && dialog.open) dialog.close();
	});

	function reset() {
		lookupSeq++;
		url = title = artist = '';
		tracks = [];
		lookup = 'idle';
		localErrors = {};
		wantAlbum = null;
	}

	async function lyricsOf(t: Track): Promise<Lyrics> {
		const q = new URLSearchParams({ title: t.title, artist: t.artist });
		try {
			const res = await fetch(`/musica/letra?${q}`);
			return res.ok ? 'ok' : res.status === 404 ? 'none' : 'unknown';
		} catch {
			return 'unknown';
		}
	}

	async function checkLyrics(seq: number) {
		// 4 por vez: o LRCLIB é um serviço gratuito.
		let next = 0;
		const worker = async () => {
			while (next < tracks.length && seq === lookupSeq) {
				const t = tracks[next++];
				const result = await lyricsOf(t);
				if (seq !== lookupSeq) return;
				t.lyrics = result;
				if (result === 'none') t.include = false;
			}
		};
		await Promise.all(Array.from({ length: 4 }, worker));
	}

	async function fillFromLink() {
		const seq = ++lookupSeq;
		localErrors = {};
		tracks = [];
		if (!mode) return;
		lookup = 'loading';
		const q = mode === 'album' ? `list=${listId}` : `v=${videoId}`;
		try {
			const res = await fetch(`/musica/info?${q}`);
			if (!res.ok) throw new Error(String(res.status));
			if (seq !== lookupSeq) return;
			if (mode === 'album') {
				const list = (await res.json()) as Playlist;
				title = list.title;
				artist = list.artist;
				tracks = list.tracks.map((t) => ({ ...t, language, include: true, lyrics: 'checking' }));
				lookup = 'idle';
				void checkLyrics(seq);
			} else {
				const info = (await res.json()) as { title: string; artist: string };
				title = info.title;
				artist = info.artist;
				lookup = 'idle';
			}
		} catch {
			if (seq === lookupSeq) lookup = 'failed';
		}
	}

	function setLanguage(l: MusicLanguage) {
		language = l;
		for (const t of tracks) t.language = l;
	}

	function validate(): boolean {
		const e: Record<string, string> = {};
		if (!mode) e.url = 'Cole o link de um vídeo ou de uma playlist do YouTube.';
		if (mode && title.trim() === '')
			e.title = mode === 'album' ? 'Escreva o nome do álbum.' : 'Escreva o título da música.';
		if (mode && artist.trim() === '') e.artist = 'Escreva o artista.';
		if (mode === 'album' && chosen.length === 0) e.tracks = 'Escolha pelo menos uma faixa.';
		localErrors = e;
		return Object.keys(e).length === 0;
	}

	const help = $derived(
		lookup === 'loading'
			? mode === 'album'
				? 'Lendo as faixas da playlist…'
				: 'Buscando título e artista…'
			: lookup === 'failed'
				? mode === 'album'
					? 'Não deu para ler essa playlist. Confira se ela é pública.'
					: 'Não deu para ler o vídeo. Escreva o título e o artista abaixo.'
				: 'Um vídeo vira uma música. Uma playlist de álbum vira o álbum inteiro, faixa a faixa.'
	);
</script>

<dialog
	class="sheet"
	bind:this={dialog}
	aria-labelledby="criar-titulo"
	onclose={() => {
		open = false;
		reset();
	}}
	onclick={(e) => e.target === dialog && (open = false)}
>
	<form
		method="POST"
		action={mode === 'album' ? '?/album' : '?/play'}
		novalidate
		use:enhance={({ cancel }) => {
			if (!validate()) {
				cancel();
				return;
			}
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<header>
			<h2 id="criar-titulo">Criar</h2>
			<button class="icon-btn" type="button" aria-label="Fechar" onclick={() => (open = false)}>
				<Icon name="x" size="sm" />
			</button>
		</header>

		<div class="corpo">
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
					placeholder="Cole o link de um vídeo ou de uma playlist"
					bind:this={urlInput}
					bind:value={url}
					oninput={() => void fillFromLink()}
					aria-invalid={errors.url ? 'true' : undefined}
					aria-describedby="url-ajuda"
				/>
				{#if errors.url}<p class="erro" role="alert">{errors.url}</p>{/if}
				<p id="url-ajuda" class="ajuda" role="status">{help}</p>
			</div>

			{#if both}
				<div class="segmentos" role="group" aria-label="O que jogar">
					<button
						type="button"
						aria-pressed={mode === 'musica'}
						onclick={() => ((wantAlbum = false), void fillFromLink())}>Só esta música</button
					>
					<button
						type="button"
						aria-pressed={mode === 'album'}
						onclick={() => ((wantAlbum = true), void fillFromLink())}>Álbum inteiro</button
					>
				</div>
			{/if}

			{#if mode && lookup === 'loading'}
				<div class="sk-bloco" aria-hidden="true">
					<span class="sk" style:width="60%"></span>
					<span class="sk" style:width="35%"></span>
					{#if mode === 'album'}{#each [0, 1, 2, 3] as i (i)}<span class="sk"></span>{/each}{/if}
				</div>
			{:else if mode && (title || artist || lookup === 'failed')}
				{#if mode === 'album' && tracks.length > 0}
					<div class="capa-linha">
						<img
							src={`https://i.ytimg.com/vi/${tracks[0].youtubeId}/mqdefault.jpg`}
							alt=""
							width="64"
							height="64"
						/>
						<span class="meta">{tracks.length} faixas na playlist</span>
					</div>
				{/if}
				<div class="linha">
					<div class="campo cresce">
						<label for="title">{mode === 'album' ? 'Nome do álbum' : 'Título da música'}</label>
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
							maxlength={LIMITS.subtitle}
							autocomplete="off"
							bind:value={artist}
							aria-invalid={errors.artist ? 'true' : undefined}
						/>
						{#if errors.artist}<p class="erro" role="alert">{errors.artist}</p>{/if}
					</div>
				</div>

				<fieldset class="idioma">
					<legend>{mode === 'album' ? 'Língua do álbum' : 'Língua da música'}</legend>
					<div class="segmentos">
						{#each MUSIC_LANGUAGES as l (l)}
							<label>
								<input
									type="radio"
									name="language"
									value={l}
									checked={language === l}
									onchange={() => setLanguage(l)}
								/>
								<span>{languageLabel(l, uiLanguage)}</span>
							</label>
						{/each}
					</div>
					{#if errors.language}<p class="erro" role="alert">{errors.language}</p>{/if}
				</fieldset>

				{#if mode === 'album' && tracks.length > 0}
					<fieldset class="faixas">
						<legend>Faixas</legend>
						<ol>
							{#each tracks as t, i (t.youtubeId)}
								<li class:fora={!t.include}>
									<input
										type="checkbox"
										bind:checked={t.include}
										disabled={t.lyrics === 'none'}
										aria-label={`Incluir ${t.title}`}
									/>
									<span class="n">{i + 1}</span>
									<span class="nome">{t.title}</span>
									<button
										type="button"
										class="code"
										title="Trocar a língua da faixa"
										aria-label={`Língua de ${t.title}: ${languageLabel(t.language, uiLanguage)}. Trocar`}
										onclick={() => (t.language = t.language === 'en' ? 'it' : 'en')}
										>{t.language.toUpperCase()}</button
									>
									{#if t.lyrics === 'checking'}
										<span class="selo">Conferindo…</span>
									{:else if t.lyrics === 'ok'}
										<span class="selo ok">Letra ok</span>
									{:else if t.lyrics === 'none'}
										<span class="selo sem">Sem letra</span>
									{:else}
										<span class="selo">Não conferida</span>
									{/if}
								</li>
							{/each}
						</ol>
						{#if errors.tracks}<p class="erro" role="alert">{errors.tracks}</p>{/if}
						<p class="ajuda">
							Faixa sem letra no LRCLIB fica de fora. Faixa em outra língua: clique no código.
						</p>
					</fieldset>
					<input type="hidden" name="tracks" value={JSON.stringify(chosen)} />
				{/if}
			{/if}

			{#if errors.form}<p class="erro" role="alert">{errors.form}</p>{/if}
		</div>

		<footer>
			<p class="nota">
				{#if mode === 'album' && tracks.length > 0}
					{checking ? 'Conferindo as letras…' : `${chosen.length} de ${tracks.length} faixas`}
				{:else}
					A letra vem do LRCLIB na hora de jogar.
				{/if}
			</p>
			<button class="btn btn-ghost" type="button" onclick={() => (open = false)}>Cancelar</button>
			<button class="btn btn-primary" type="submit" disabled={submitting || lookup === 'loading'}>
				<Icon name="play" size="sm" />
				{#if submitting}Abrindo…{:else if mode === 'album'}Jogar álbum{:else}Jogar{/if}
			</button>
		</footer>
	</form>
</dialog>

<style>
	.sheet {
		position: fixed;
		inset: 0 0 0 auto;
		width: min(460px, 100%);
		max-width: none;
		height: 100dvh;
		max-height: none;
		margin: 0;
		padding: 0;
		border: 0;
		color: var(--ink);
		background: var(--raise-2);
		box-shadow: var(--sh-pop);
	}
	.sheet[open] {
		animation: entra 0.28s var(--ease) both;
	}
	.sheet::backdrop {
		background: var(--scrim);
		animation: fade 0.22s var(--ease) both;
	}
	@keyframes entra {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	form {
		height: 100%;
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 6px;
	}
	h2 {
		margin: 0;
		font: 600 17.5px var(--f-head);
		letter-spacing: -0.01em;
	}
	.corpo {
		flex: 1;
		overflow-y: auto;
		padding: 10px 20px 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	footer {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 20px calc(14px + var(--safe-b));
		border-top: 1px solid var(--line);
	}
	.nota {
		margin: 0 auto 0 0;
		font-size: 14px;
		color: var(--ink-3);
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
		font-size: 14px;
		font-weight: 500;
		color: var(--ink-3);
	}
	input:not([type='radio'], [type='checkbox'], [type='hidden']) {
		width: 100%;
		height: 40px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink);
		padding: 0 12px;
		font: inherit;
		font-size: 16px;
		transition: box-shadow 0.15s;
	}
	input:not([type='radio'], [type='checkbox']):focus {
		outline: none;
		box-shadow: inset 0 0 0 1.5px var(--ink-3);
	}
	[aria-invalid='true'] {
		box-shadow: inset 0 0 0 1.5px var(--terra-ink) !important;
	}
	.ajuda {
		margin: 0;
		font-size: 14px;
		color: var(--ink-3);
		text-wrap: pretty;
	}
	.erro {
		margin: 0;
		color: var(--terra-ink);
		font-size: 14.5px;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	legend {
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
	.segmentos span,
	.segmentos button {
		display: block;
		height: 30px;
		line-height: 30px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--r-s);
		background: none;
		font-size: 15px;
		font-weight: 500;
		color: var(--ink-2);
	}
	.segmentos input:checked + span,
	.segmentos button[aria-pressed='true'] {
		background: var(--raise);
		color: var(--ink);
		box-shadow: var(--sh-card);
	}
	:global(.tema-escuro) .segmentos input:checked + span,
	:global(.tema-escuro) .segmentos button[aria-pressed='true'] {
		background: rgba(247, 241, 230, 0.09);
		box-shadow: none;
	}
	.segmentos input:focus-visible + span {
		outline: 2px solid var(--ink-3);
		outline-offset: 1px;
	}
	.capa-linha {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.capa-linha img {
		width: 64px;
		height: 64px;
		object-fit: cover;
		border-radius: var(--r-s);
		background: var(--tile);
	}
	.meta {
		font-size: 14px;
		color: var(--ink-3);
	}
	.faixas ol {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: var(--r-m);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.faixas li {
		display: grid;
		grid-template-columns: 18px 20px minmax(0, 1fr) auto auto;
		gap: 10px;
		align-items: center;
		padding: 7px 10px;
		border-top: 1px solid var(--line);
		font-size: 15px;
	}
	.faixas li:first-child {
		border-top: 0;
	}
	.faixas li.fora .nome,
	.faixas li.fora .n {
		opacity: 0.5;
	}
	.faixas input[type='checkbox'] {
		width: 16px;
		height: 16px;
		margin: 0;
		accent-color: var(--prog);
	}
	.n {
		font-size: 13px;
		color: var(--ink-3);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.nome {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.code {
		min-width: 28px;
		height: 24px;
		padding: 0 5px;
		border: 0;
		border-radius: var(--r-s);
		font: 600 12px/1 var(--f-head);
		letter-spacing: 0.04em;
		color: var(--ink-2);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.code:hover {
		background: var(--hover);
	}
	.selo {
		font-size: 12.5px;
		padding: 2px 8px;
		border-radius: 999px;
		white-space: nowrap;
		color: var(--ink-3);
		background: var(--tile);
	}
	.selo.ok {
		color: var(--ok-ink);
		background: var(--ok-soft);
	}
	.selo.sem {
		color: var(--terra-ink);
		background: var(--terra-soft);
	}
	.sk-bloco {
		display: grid;
		gap: 10px;
	}
	.sk {
		display: block;
		height: 14px;
		border-radius: 4px;
		background: linear-gradient(90deg, var(--tile), var(--hover), var(--tile));
		background-size: 200% 100%;
		animation: brilho 1.2s linear infinite;
	}
	@keyframes brilho {
		to {
			background-position: -200% 0;
		}
	}
	@media (min-width: 520px) {
		.linha {
			flex-direction: row;
		}
		.cresce {
			flex: 1;
		}
	}
	@media (max-width: 520px) {
		.sheet {
			inset: auto 0 0 0;
			width: 100%;
			height: calc(100dvh - 24px - var(--safe-t));
			border-radius: var(--r-l) var(--r-l) 0 0;
		}
		.selo {
			display: none;
		}
		.faixas li {
			grid-template-columns: 18px 20px minmax(0, 1fr) auto;
		}
	}
</style>
