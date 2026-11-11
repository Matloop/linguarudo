<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { LANGUAGES, LANGUAGE_LABELS, type Language } from '#lib/languages.ts';
	import type { Theme } from '#lib/prefs.ts';
	import { applyTheme, toast } from '#lib/ui/app-state.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const shell = $derived(data.shell);
	const study = $derived(shell?.studyLanguages ?? []);
	const addable = $derived(
		LANGUAGES.filter((l) => l !== shell?.nativeLanguage && !study.includes(l))
	);
	const email = $derived(data.user?.email ?? '');
	const initial = $derived((email || '?').charAt(0).toUpperCase());
	const name = $derived(email.split('@')[0] ?? '');

	let newPerDay = $derived(data.newPerDay);
	let adding = $state<Language | ''>('');

	function countOf(l: Language) {
		const n = shell?.summary?.languages.find((s) => s.language === l)?.items ?? 0;
		return n === 0 ? 'nenhuma palavra' : n === 1 ? '1 palavra' : `${n} palavras`;
	}

	/** Preferências salvam sem recarregar; o servidor responde com o redirect de volta. */
	function afterSave(done?: string) {
		return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				await invalidateAll();
				if (done) toast(done);
			} else {
				await update();
			}
		};
	}
	const quiet =
		(done?: string): SubmitFunction =>
		() =>
			afterSave(done);

	const submitTheme: SubmitFunction = ({ formData, cancel }) => {
		const theme = formData.get('tema') as Theme;
		applyTheme(theme);
		cancel();
		invalidateAll();
	};

	const submitStep: SubmitFunction = ({ formData }) => {
		newPerDay = Number(formData.get('novasPorDia'));
		return afterSave();
	};
</script>

<svelte:head>
	<title>Perfil · Linguetta</title>
</svelte:head>

<div class="ph"><div><h1>Perfil</h1></div></div>

<div class="settings">
	<div class="profile-card">
		<span class="avatar">{initial}</span>
		<div><b>{name}</b><span class="faint">{email}</span></div>
	</div>

	{#if form?.message}<p class="f-err" role="alert">{form.message}</p>{/if}

	<section class="set-row langs" id="idiomas" aria-labelledby="idiomas-titulo">
		<div>
			<b id="idiomas-titulo">Idiomas</b>
			<span>Cada idioma tem as próprias palavras e revisões</span>
		</div>
		<ul class="chips" aria-label="Seus idiomas">
			{#each study as lang (lang)}
				<li>
					<span class="code">{lang.toUpperCase()}</span>
					<span class="nm">{LANGUAGE_LABELS[lang]}</span>
					<span class="faint">· {countOf(lang)}</span>
					{#if study.length > 1}
						<form
							method="POST"
							action="?/idiomas"
							use:enhance={quiet(`${LANGUAGE_LABELS[lang]} saiu dos seus idiomas`)}
						>
							<input type="hidden" name="voltar" value="/perfil" />
							{#each study.filter((l) => l !== lang) as keep (keep)}
								<input type="hidden" name="idiomas" value={keep} />
							{/each}
							<button
								class="icon-btn"
								aria-label="Tirar {LANGUAGE_LABELS[lang]}"
								title="Tirar dos seus idiomas"
								onclick={(e) => {
									const ok = confirm(
										`Tirar ${LANGUAGE_LABELS[lang]}? As palavras continuam guardadas e voltam se você adicionar o idioma de novo.`
									);
									if (!ok) e.preventDefault();
								}}><Icon name="x" size="sm" /></button
							>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
		{#if addable.length > 0}
			<form
				class="add"
				method="POST"
				action="?/adicionarIdioma"
				use:enhance={({ formData }) => {
					const lang = formData.get('idioma') as Language;
					adding = '';
					return afterSave(`${LANGUAGE_LABELS[lang]} adicionado aos seus idiomas`);
				}}
			>
				<input type="hidden" name="voltar" value="/perfil" />
				<select name="idioma" aria-label="Idioma para adicionar" bind:value={adding} required>
					<option value="" disabled>Escolha um idioma</option>
					{#each addable as lang (lang)}
						<option value={lang}>{LANGUAGE_LABELS[lang]}</option>
					{/each}
				</select>
				<button class="btn btn-soft" disabled={!adding}
					><Icon name="plus" size="sm" />Adicionar idioma</button
				>
			</form>
		{/if}
	</section>

	<div class="set-row">
		<div>
			<b>Integrações</b>
			<span>{data.stremioConnected ? 'Stremio conectado' : 'Nenhuma conectada ainda'}</span>
		</div>
		<a class="btn btn-soft" href={resolve('/integracoes')}>Ver integrações</a>
	</div>

	<div class="set-row">
		<div>
			<b id="npd-titulo">Palavras novas por dia</b>
			<span>Revisões não têm limite</span>
		</div>
		<form
			class="stepper"
			method="POST"
			action="?/novasPorDia"
			use:enhance={submitStep}
			aria-labelledby="npd-titulo"
		>
			<input type="hidden" name="voltar" value="/perfil" />
			<button name="novasPorDia" value={newPerDay - 1} aria-label="Menos" disabled={newPerDay <= 0}
				>−</button
			>
			<output aria-live="polite">{newPerDay}</output>
			<button
				name="novasPorDia"
				value={newPerDay + 1}
				aria-label="Mais"
				disabled={newPerDay >= data.maxNewPerDay}>+</button
			>
		</form>
	</div>

	<div class="set-row">
		<div>
			<b id="tema-titulo">Tema</b>
			<span>Claro em papel creme ou escuro em verde profundo</span>
		</div>
		<form
			class="seg"
			method="POST"
			action="?/tema"
			use:enhance={submitTheme}
			aria-labelledby="tema-titulo"
		>
			<input type="hidden" name="voltar" value="/perfil" />
			<button name="tema" value="claro" aria-pressed={data.theme === 'claro'}>Claro</button>
			<button name="tema" value="escuro" aria-pressed={data.theme === 'escuro'}>Escuro</button>
		</form>
	</div>

	<div class="set-row">
		<div>
			<b>Sair</b>
			<span>Você pode entrar de novo pelo link no e-mail</span>
		</div>
		<form method="POST" action="/sair">
			<button class="btn btn-ghost">Sair</button>
		</form>
	</div>
</div>

<style>
	.settings {
		max-width: 640px;
	}
	.set-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 16px 4px;
	}
	.set-row + .set-row {
		border-top: 1px solid var(--line);
	}
	.set-row b {
		font-weight: 500;
		display: block;
	}
	.set-row > div > span {
		font-size: 13px;
		color: var(--ink-3);
	}
	.profile-card {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 26px;
	}
	.profile-card .avatar {
		width: 52px;
		height: 52px;
		font-size: 20px;
	}
	.profile-card b {
		font: 600 20px var(--f-head);
		letter-spacing: -0.01em;
		display: block;
	}
	.profile-card .faint {
		font-size: 13.5px;
	}

	.langs {
		flex-wrap: wrap;
	}
	.langs > div {
		flex: 1 1 100%;
	}
	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1 1 100%;
	}
	.chips li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 4px 6px 8px;
		border-radius: var(--r-m);
		font-size: 14px;
	}
	.chips li:hover {
		background: var(--hover);
	}
	.chips .nm {
		font-weight: 500;
	}
	.chips .faint {
		font-size: 13px;
		flex: 1;
	}
	.chips form {
		margin-left: auto;
	}
	.add {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.add select {
		height: 36px;
		padding: 0 10px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		border: 0;
		color: var(--ink);
		font: inherit;
		font-size: 14px;
	}

	.stepper {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.stepper button {
		width: 30px;
		height: 30px;
		border-radius: var(--r-s);
		font-weight: 500;
		color: var(--ink-2);
	}
	.stepper button:hover:not(:disabled) {
		background: var(--raise);
	}
	.stepper button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.stepper output {
		min-width: 34px;
		text-align: center;
		font: 600 15px var(--f-head);
		font-variant-numeric: tabular-nums;
	}
	.f-err {
		color: var(--terra-ink);
		font-size: 13.5px;
		margin: 0 0 12px;
	}

	@media (max-width: 768px) {
		.set-row {
			flex-wrap: wrap;
			gap: 10px 16px;
		}
		.set-row > div:first-child {
			flex: 1 1 180px;
			min-width: 0;
		}
		.set-row > :last-child {
			flex-shrink: 0;
		}
		.add {
			flex-wrap: wrap;
		}
	}
</style>
