<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { LANG_LABELS, LANGS, LIMITS, type Lang } from '#lib/words.ts';
	import type { PageProps, SubmitFunction } from './$types';

	let { data, form }: PageProps = $props();

	let termInput: HTMLInputElement | undefined = $state();
	let saving = $state(false);
	let deleting = $state<string | null>(null);

	const addForm = $derived(form?.action === 'add' ? form : null);
	const errors = $derived((addForm && 'errors' in addForm ? addForm.errors : null) ?? {});
	const values = $derived(addForm && 'values' in addForm ? addForm.values : null);
	const added = $derived(addForm && 'added' in addForm ? addForm.added : null);
	const deleteError = $derived(
		(form?.action === 'delete' || form?.action === 'pause') && 'message' in form
			? form.message
			: null
	);
	const toReview = $derived(data.review?.count ?? 0);

	// Sem JS, o action troca a query da URL; repetir o filtro mantém a lista igual depois do POST.
	const filterQuery = $derived(data.lang ? `&lang=${data.lang}` : '');
	const defaultLang: Lang = $derived((values?.lang as Lang | undefined) ?? data.lang ?? 'en');

	const filters: { lang: Lang | null; label: string }[] = [
		{ lang: null, label: 'Todas' },
		...LANGS.map((lang: Lang) => ({ lang, label: LANG_LABELS[lang] }))
	];

	const submitAdd: SubmitFunction = () => {
		saving = true;
		return async ({ result, update }) => {
			await update();
			saving = false;
			if (result.type === 'success') termInput?.focus();
		};
	};

	let pausing = $state<string | null>(null);
	const submitPause: SubmitFunction = ({ formData }) => {
		pausing = formData.get('id')?.toString() ?? null;
		return async ({ update }) => {
			await update({ reset: false });
			pausing = null;
		};
	};

	const submitDelete: SubmitFunction = ({ formData }) => {
		deleting = formData.get('id')?.toString() ?? null;
		return async ({ update }) => {
			await update();
			deleting = null;
		};
	};
</script>

<svelte:head>
	<title>Minhas palavras · Linguarudo</title>
</svelte:head>

<div class="topo">
	<h1>Minhas palavras</h1>
	<p class="total">
		{data.words.length}
		{data.words.length === 1 ? 'palavra' : 'palavras'}
		{data.lang ? `em ${LANG_LABELS[data.lang].toLowerCase()}` : ''}
	</p>
</div>

{#if toReview > 0}
	<a class="revisar" href={resolve('/revisar')}>
		<span class="revisar-texto">
			<strong>{toReview} para revisar</strong>
			<span>Leva poucos minutos.</span>
		</span>
		<span class="revisar-botao" aria-hidden="true">Revisar</span>
	</a>
{/if}

<form
	class="nova"
	method="POST"
	action={`?/add${filterQuery}`}
	use:enhance={submitAdd}
	aria-labelledby="nova-titulo"
>
	<h2 id="nova-titulo">Guardar palavra</h2>

	<div class="campo">
		<label for="term">Palavra ou expressão</label>
		<input
			bind:this={termInput}
			id="term"
			name="term"
			required
			maxlength={LIMITS.term}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			value={values?.term ?? ''}
			aria-invalid={errors.term ? 'true' : undefined}
			aria-describedby={errors.term ? 'term-erro' : undefined}
		/>
		{#if errors.term}<p id="term-erro" class="erro" role="alert">{errors.term}</p>{/if}
	</div>

	<div class="linha">
		<div class="campo cresce">
			<label for="translation">Tradução</label>
			<input
				id="translation"
				name="translation"
				maxlength={LIMITS.translation}
				autocomplete="off"
				value={values?.translation ?? ''}
				aria-invalid={errors.translation ? 'true' : undefined}
			/>
			{#if errors.translation}<p class="erro" role="alert">{errors.translation}</p>{/if}
		</div>

		<fieldset class="idioma">
			<legend>Idioma</legend>
			<div class="segmentos">
				{#each LANGS as lang (lang)}
					<label>
						<input type="radio" name="lang" value={lang} checked={defaultLang === lang} />
						<span title={LANG_LABELS[lang]}>{lang.toUpperCase()}</span>
					</label>
				{/each}
			</div>
			{#if errors.lang}<p class="erro" role="alert">{errors.lang}</p>{/if}
		</fieldset>
	</div>

	<div class="campo">
		<label for="context">Contexto <span class="opcional">(opcional)</span></label>
		<textarea
			id="context"
			name="context"
			rows="2"
			maxlength={LIMITS.context}
			placeholder="A frase onde você ouviu"
			aria-invalid={errors.context ? 'true' : undefined}>{values?.context ?? ''}</textarea
		>
		{#if errors.context}<p class="erro" role="alert">{errors.context}</p>{/if}
	</div>

	{#if errors.form}<p class="erro" role="alert">{errors.form}</p>{/if}

	<div class="acoes">
		<p class="status" role="status">{added ? `“${added}” guardada.` : ''}</p>
		<button class="guardar" type="submit" disabled={saving}>
			{saving ? 'Guardando…' : 'Guardar'}
		</button>
	</div>
</form>

<nav class="filtros" aria-label="Filtrar por idioma">
	{#each filters as f (f.label)}
		<a
			href={f.lang ? resolve(`/palavras?lang=${f.lang}`) : resolve('/palavras')}
			aria-current={data.lang === f.lang ? 'page' : undefined}
			data-sveltekit-noscroll
			data-sveltekit-replacestate>{f.label}</a
		>
	{/each}
</nav>

{#if deleteError}<p class="erro" role="alert">{deleteError}</p>{/if}

{#if data.words.length === 0}
	<div class="vazio">
		<p>
			{data.lang
				? `Nenhuma palavra em ${LANG_LABELS[data.lang].toLowerCase()} ainda.`
				: 'Seu banco está vazio. Guarde a primeira palavra aí em cima.'}
		</p>
	</div>
{:else}
	<ul class="lista">
		{#each data.words as word (word.id)}
			<li class:saindo={deleting === word.id || pausing === word.id} class:pausada={word.paused}>
				<div class="texto">
					<p class="termo">
						<span lang={word.lang}>{word.term}</span>
						<span class="selo {word.lang}" title={LANG_LABELS[word.lang]}
							>{word.lang.toUpperCase()}</span
						>
						{#if word.paused}<span class="selo pausa">Pausada</span>{/if}
					</p>
					{#if word.translation}<p class="traducao">{word.translation}</p>{/if}
					{#if word.context}<p class="contexto" lang={word.lang}>{word.context}</p>{/if}
				</div>
				<form method="POST" action={`?/pause${filterQuery}`} use:enhance={submitPause}>
					<input type="hidden" name="id" value={word.id} />
					<input type="hidden" name="paused" value={word.paused ? 'false' : 'true'} />
					<button
						class="icone"
						type="submit"
						aria-label={word.paused
							? `Retomar “${word.term}” na revisão`
							: `Pausar “${word.term}” na revisão`}
						title={word.paused ? 'Retomar na revisão' : 'Pausar na revisão'}
					>
						<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
							{#if word.paused}
								<path d="M8 5v14l11-7z" fill="currentColor" />
							{:else}
								<path
									d="M9 5v14M15 5v14"
									fill="none"
									stroke="currentColor"
									stroke-width="2.4"
									stroke-linecap="round"
								/>
							{/if}
						</svg>
					</button>
				</form>
				<form method="POST" action={`?/delete${filterQuery}`} use:enhance={submitDelete}>
					<input type="hidden" name="id" value={word.id} />
					<button class="icone apagar" type="submit" aria-label={`Apagar “${word.term}”`}>
						<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
							<path
								d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
				</form>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.topo {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}

	h1 {
		margin: 0;
		font-size: 28px;
		color: var(--verde);
		letter-spacing: -0.01em;
	}

	.total {
		margin: 0;
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

	.opcional {
		font-weight: 550;
		color: var(--cinza);
	}

	input:not([type='radio']),
	textarea {
		width: 100%;
		border: 2px solid var(--linha);
		background: #fff;
		border-radius: var(--raio-p);
		padding: 11px 13px;
		font-size: 16px;
	}

	#term {
		font-size: 20px;
		font-weight: 750;
		color: var(--verde);
	}

	textarea {
		resize: vertical;
		min-height: 64px;
	}

	input:focus,
	textarea:focus {
		border-color: var(--salvia);
		outline: none;
	}

	[aria-invalid='true'] {
		border-color: var(--coral) !important;
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

	.status {
		margin: 0;
		color: var(--verde);
		font-weight: 700;
		font-size: 14px;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.guardar {
		flex: none;
		border: 0;
		background: var(--coral);
		color: #fff;
		border-radius: 14px;
		padding: 12px 26px;
		font-weight: 800;
		font-size: 16px;
		box-shadow: var(--sombra-botao) var(--coral-escuro);
	}

	.guardar:active {
		transform: translateY(2px);
		box-shadow: none;
	}

	.guardar:disabled {
		opacity: 0.7;
		cursor: default;
	}

	.erro {
		margin: 0;
		color: #a53b3b;
		font-weight: 600;
		font-size: 14px;
	}

	.filtros {
		display: flex;
		gap: 8px;
		margin: 24px 0 12px;
		overflow-x: auto;
	}

	.filtros a {
		flex: none;
		text-decoration: none;
		border: 2px solid var(--linha);
		background: #fff;
		color: var(--cinza);
		padding: 6px 14px;
		border-radius: 99px;
		font-weight: 750;
		font-size: 14px;
	}

	.filtros a[aria-current='page'] {
		background: var(--verde);
		border-color: var(--verde);
		color: var(--creme);
	}

	.lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.lista li {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		background: #fff;
		border: 1.5px solid var(--linha);
		border-radius: var(--raio);
		padding: 12px 10px 12px 16px;
		transition: opacity 0.15s;
	}

	.lista li.saindo {
		opacity: 0.4;
	}

	.texto {
		flex: 1;
		min-width: 0;
	}

	.texto p {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.termo {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		font-weight: 800;
		font-size: 18px;
		color: var(--verde);
	}

	.selo {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.04em;
		padding: 2px 7px;
		border-radius: 6px;
		color: #fff;
	}

	.selo.en {
		background: var(--azul);
	}

	.selo.it {
		background: var(--ouro);
	}

	.selo.pausa {
		background: var(--linha);
		color: var(--cinza);
	}

	.lista li.pausada .termo > span:first-child,
	.lista li.pausada .traducao {
		opacity: 0.6;
	}

	.revisar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
		padding: 14px 16px;
		border-radius: 22px;
		background: var(--verde);
		color: var(--creme);
		text-decoration: none;
	}

	.revisar-texto {
		display: flex;
		flex-direction: column;
	}

	.revisar-texto strong {
		font-size: 18px;
	}

	.revisar-texto span {
		color: var(--salvia-claro);
		font-size: 14px;
	}

	.revisar-botao {
		flex: none;
		background: var(--coral);
		color: #fff;
		border-radius: 14px;
		padding: 10px 20px;
		font-weight: 800;
		box-shadow: var(--sombra-botao) var(--coral-escuro);
	}

	.traducao {
		color: var(--tinta);
		margin-top: 2px !important;
	}

	.contexto {
		margin-top: 6px !important;
		padding-left: 10px;
		border-left: 3px solid var(--salvia-claro);
		color: var(--cinza);
		font-size: 14px;
		font-style: italic;
		white-space: pre-line;
	}

	.icone {
		flex: none;
		border: 0;
		background: none;
		color: var(--cinza);
		width: 40px;
		height: 40px;
		border-radius: var(--raio-p);
		display: grid;
		place-items: center;
	}

	.icone:hover {
		background: var(--salvia-claro);
		color: var(--verde);
	}

	.apagar:hover {
		background: var(--coral-claro);
		color: #a53b3b;
	}

	.vazio {
		border: 2px dashed var(--linha);
		border-radius: var(--raio);
		padding: 28px 16px;
		text-align: center;
		color: var(--cinza);
	}

	.vazio p {
		margin: 0;
	}

	@media (min-width: 640px) {
		.nova {
			padding: 22px 24px;
		}

		.linha {
			flex-direction: row;
			align-items: flex-start;
		}

		.cresce {
			flex: 1;
		}
	}
</style>
