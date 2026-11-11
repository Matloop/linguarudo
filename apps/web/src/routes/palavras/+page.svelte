<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { LIMITS } from '#lib/items.ts';
	import { LANGUAGE_LABELS, LANGUAGES, type Language } from '#lib/languages.ts';
	import type { PageProps, SubmitFunction } from './$types';

	let { data, form }: PageProps = $props();

	let lemmaInput: HTMLInputElement | undefined = $state();
	let saving = $state(false);
	let busy = $state<string | null>(null);

	const addForm = $derived(form?.action === 'add' ? form : null);
	const errors = $derived((addForm && 'errors' in addForm ? addForm.errors : null) ?? {});
	const values = $derived(addForm && 'values' in addForm ? addForm.values : null);
	const addMessage = $derived(addForm && 'message' in addForm ? addForm.message : null);
	const editForm = $derived(form?.action === 'edit' ? form : null);
	const listError = $derived(
		(form?.action === 'delete' || form?.action === 'known') && 'message' in form
			? form.message
			: null
	);
	const languagesForm = $derived(form?.action === 'languages' ? form : null);
	const toReview = $derived(data.review?.count ?? 0);

	// Sem JS, o action troca a query da URL; repetir o filtro mantém a lista igual depois do POST.
	const filterQuery = $derived(data.language ? `&lang=${data.language}` : '');
	const defaultLanguage: Language = $derived.by(() => {
		const wanted = values?.language ?? data.language;
		return data.studyLanguages.find((l) => l === wanted) ?? data.studyLanguages[0];
	});

	const filters = $derived([
		{ language: null, label: 'Todas' },
		...data.studyLanguages.map((language) => ({ language, label: LANGUAGE_LABELS[language] }))
	]);

	function editErrors(id: string) {
		return editForm && editForm.id === id && 'errors' in editForm ? editForm.errors : null;
	}

	const submitAdd: SubmitFunction = () => {
		saving = true;
		return async ({ result, update }) => {
			await update();
			saving = false;
			if (result.type === 'success') lemmaInput?.focus();
		};
	};

	const submitRow: SubmitFunction = ({ formData }) => {
		busy = formData.get('id')?.toString() ?? null;
		return async ({ update }) => {
			await update({ reset: false });
			busy = null;
		};
	};
</script>

<svelte:head>
	<title>Minhas palavras · Linguarudo</title>
</svelte:head>

<div class="topo">
	<h1>Minhas palavras</h1>
	<p class="total">
		{data.items.length}
		{data.items.length === 1 ? 'palavra' : 'palavras'}
		{data.language ? `em ${LANGUAGE_LABELS[data.language].toLowerCase()}` : ''}
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
		<label for="lemma">Palavra ou expressão</label>
		<input
			bind:this={lemmaInput}
			id="lemma"
			name="lemma"
			required
			maxlength={LIMITS.lemma}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			value={values?.lemma ?? ''}
			aria-invalid={errors.lemma ? 'true' : undefined}
			aria-describedby={errors.lemma ? 'lemma-erro' : undefined}
		/>
		{#if errors.lemma}<p id="lemma-erro" class="erro" role="alert">{errors.lemma}</p>{/if}
	</div>

	<div class="linha">
		<div class="campo cresce">
			<label for="sense">Sentido</label>
			<input
				id="sense"
				name="sense"
				maxlength={LIMITS.sense}
				autocomplete="off"
				placeholder="O que quer dizer"
				value={values?.sense ?? ''}
				aria-invalid={errors.sense ? 'true' : undefined}
			/>
			{#if errors.sense}<p class="erro" role="alert">{errors.sense}</p>{/if}
		</div>

		<fieldset class="idioma">
			<legend>Idioma</legend>
			<div class="segmentos">
				{#each data.studyLanguages as language (language)}
					<label>
						<input
							type="radio"
							name="language"
							value={language}
							checked={defaultLanguage === language}
						/>
						<span title={LANGUAGE_LABELS[language]}>{language.toUpperCase()}</span>
					</label>
				{/each}
			</div>
			{#if errors.language}<p class="erro" role="alert">{errors.language}</p>{/if}
		</fieldset>
	</div>

	<div class="campo">
		<label for="sentence">Frase <span class="opcional">(opcional)</span></label>
		<textarea
			id="sentence"
			name="sentence"
			rows="2"
			maxlength={LIMITS.sentence}
			placeholder="A frase onde você viu ou ouviu"
			aria-invalid={errors.sentence ? 'true' : undefined}>{values?.sentence ?? ''}</textarea
		>
		{#if errors.sentence}<p class="erro" role="alert">{errors.sentence}</p>{/if}
	</div>

	{#if errors.form}<p class="erro" role="alert">{errors.form}</p>{/if}

	<div class="acoes">
		<p class="status" role="status">{addMessage ?? ''}</p>
		<button class="guardar" type="submit" disabled={saving}>
			{saving ? 'Guardando…' : 'Guardar'}
		</button>
	</div>
</form>

<nav class="filtros" aria-label="Filtrar por idioma">
	{#each filters as f (f.label)}
		<a
			href={f.language ? resolve(`/palavras?lang=${f.language}`) : resolve('/palavras')}
			aria-current={data.language === f.language ? 'page' : undefined}
			data-sveltekit-noscroll
			data-sveltekit-replacestate>{f.label}</a
		>
	{/each}
</nav>

{#if listError}<p class="erro" role="alert">{listError}</p>{/if}

{#if data.items.length === 0}
	<div class="vazio">
		<p>
			{data.language
				? `Nenhuma palavra em ${LANGUAGE_LABELS[data.language].toLowerCase()} ainda.`
				: 'Seu banco está vazio. Guarde a primeira palavra aí em cima.'}
		</p>
	</div>
{:else}
	<ul class="lista" aria-label="Palavras">
		{#each data.items as item (item.id)}
			{@const known = item.status === 'conhecido'}
			{@const itemErrors = editErrors(item.id)}
			<li class:saindo={busy === item.id} class:conhecida={known}>
				<div class="texto">
					<p class="termo">
						<span lang={item.language}>{item.lemma}</span>
						<span class="selo {item.language}" title={LANGUAGE_LABELS[item.language]}
							>{item.language.toUpperCase()}</span
						>
						{#if known}<span class="selo estado">Conhecida</span>
						{:else if item.mastered}<span class="selo dominada">Dominada</span>{/if}
					</p>
					{#if item.sense}<p class="sentido">{item.sense}</p>{/if}
					{#if item.note}<p class="nota">{item.note}</p>{/if}
					{#if item.encounters.length > 0}
						<ul class="encontros" aria-label={`Encontros de “${item.lemma}”`}>
							{#each item.encounters as encounter (encounter.id)}
								<li>
									{#if encounter.sentence}<p class="frase" lang={item.language}>
											{encounter.sentence}
										</p>{/if}
									<p class="fonte">
										{[encounter.origin, encounter.source].filter(Boolean).join(' · ')}
									</p>
								</li>
							{/each}
						</ul>
					{/if}

					<details class="editar" open={itemErrors ? true : undefined}>
						<summary>Editar</summary>
						<form method="POST" action={`?/edit${filterQuery}`} use:enhance={submitRow}>
							<input type="hidden" name="id" value={item.id} />
							<div class="campo">
								<label for={`lemma-${item.id}`}>Palavra</label>
								<input
									id={`lemma-${item.id}`}
									name="lemma"
									required
									maxlength={LIMITS.lemma}
									value={item.lemma}
									aria-invalid={itemErrors?.lemma ? 'true' : undefined}
								/>
								{#if itemErrors?.lemma}<p class="erro" role="alert">{itemErrors.lemma}</p>{/if}
							</div>
							<div class="campo">
								<label for={`sense-${item.id}`}>Sentido</label>
								<input
									id={`sense-${item.id}`}
									name="sense"
									maxlength={LIMITS.sense}
									value={item.sense}
									aria-invalid={itemErrors?.sense ? 'true' : undefined}
								/>
								{#if itemErrors?.sense}<p class="erro" role="alert">{itemErrors.sense}</p>{/if}
							</div>
							<div class="campo">
								<label for={`note-${item.id}`}>Nota</label>
								<textarea
									id={`note-${item.id}`}
									name="note"
									rows="2"
									maxlength={LIMITS.note}
									aria-invalid={itemErrors?.note ? 'true' : undefined}>{item.note}</textarea
								>
								{#if itemErrors?.note}<p class="erro" role="alert">{itemErrors.note}</p>{/if}
							</div>
							{#if itemErrors?.form}<p class="erro" role="alert">{itemErrors.form}</p>{/if}
							<button class="salvar" type="submit">Salvar</button>
						</form>
					</details>
				</div>
				<form method="POST" action={`?/known${filterQuery}`} use:enhance={submitRow}>
					<input type="hidden" name="id" value={item.id} />
					<input type="hidden" name="known" value={known ? 'false' : 'true'} />
					<button
						class="icone"
						type="submit"
						aria-label={known
							? `Voltar “${item.lemma}” para a revisão`
							: `Marcar “${item.lemma}” como conhecida`}
						title={known ? 'Voltar para a revisão' : 'Já conheço'}
					>
						<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
							{#if known}
								<path
									d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{:else}
								<path
									d="M5 12.5l4.5 4.5L19 7"
									fill="none"
									stroke="currentColor"
									stroke-width="2.4"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{/if}
						</svg>
					</button>
				</form>
				<form method="POST" action={`?/delete${filterQuery}`} use:enhance={submitRow}>
					<input type="hidden" name="id" value={item.id} />
					<button class="icone apagar" type="submit" aria-label={`Apagar “${item.lemma}”`}>
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

<details class="idiomas" open={languagesForm && 'message' in languagesForm ? true : undefined}>
	<summary>Idiomas de estudo</summary>
	<form method="POST" action={`?/languages${filterQuery}`} use:enhance>
		<fieldset>
			<legend>Quais idiomas você estuda?</legend>
			{#each LANGUAGES as language (language)}
				<label class="marcar">
					<input
						type="checkbox"
						name="languages"
						value={language}
						checked={data.studyLanguages.includes(language)}
					/>
					{LANGUAGE_LABELS[language]}
				</label>
			{/each}
		</fieldset>
		{#if languagesForm && 'message' in languagesForm}
			<p class="erro" role="alert">{languagesForm.message}</p>
		{/if}
		<button class="salvar" type="submit">Salvar idiomas</button>
	</form>
</details>

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

	input:not([type='radio'], [type='checkbox']),
	textarea {
		width: 100%;
		border: 2px solid var(--linha);
		background: #fff;
		border-radius: var(--raio-p);
		padding: 11px 13px;
		font-size: 16px;
	}

	#lemma {
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
		background: var(--verde);
	}

	.selo.en {
		background: var(--azul);
	}

	.selo.it {
		background: var(--ouro);
	}

	.selo.estado {
		background: var(--linha);
		color: var(--cinza);
	}

	.selo.dominada {
		background: var(--salvia);
	}

	.lista li.conhecida .termo > span:first-child,
	.lista li.conhecida .sentido {
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

	.sentido {
		color: var(--tinta);
		margin-top: 2px !important;
	}

	.nota {
		margin-top: 4px !important;
		color: var(--cinza);
		font-size: 14px;
		white-space: pre-line;
	}

	.encontros {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.encontros li {
		padding-left: 10px;
		border-left: 3px solid var(--salvia-claro);
	}

	.frase {
		color: var(--tinta);
		font-size: 14px;
		font-style: italic;
		white-space: pre-line;
	}

	.fonte {
		color: var(--cinza);
		font-size: 12px;
		font-weight: 650;
	}

	.editar {
		margin-top: 8px;
	}

	.editar summary,
	.idiomas summary {
		cursor: pointer;
		color: var(--cinza);
		font-weight: 700;
		font-size: 13px;
	}

	.editar form,
	.idiomas form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 10px;
	}

	.salvar {
		align-self: flex-start;
		border: 0;
		background: var(--verde);
		color: var(--creme);
		border-radius: 12px;
		padding: 8px 18px;
		font-weight: 800;
		font-size: 14px;
	}

	.idiomas {
		margin-top: 28px;
		background: var(--papel);
		border: 1.5px solid var(--linha);
		border-radius: 22px;
		padding: 14px 16px;
	}

	.idiomas fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
	}

	.idiomas legend {
		padding: 0;
		margin-bottom: 8px;
	}

	.marcar {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
		color: var(--tinta);
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
