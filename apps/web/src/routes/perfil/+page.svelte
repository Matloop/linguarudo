<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import {
		MAX_STUDY_LANGUAGES,
		UI_LANGUAGES,
		langAttrs,
		languageLabel,
		languageSelfLabel,
		parseLanguage,
		type Language
	} from '#lib/languages.ts';
	import type { Theme } from '#lib/prefs.ts';
	import { applyTheme, toast } from '#lib/ui/app-state.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import LanguagePicker from '#lib/ui/LanguagePicker.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const shell = $derived(data.shell);
	const T = {
		ui: 'Interface',
		uiSub: 'Língua dos menus e botões',
		native: 'Língua nativa',
		nativeSub: 'A língua das traduções e dos sentidos',
		nativeNone: 'Ainda não escolhida',
		nativeChange: 'Trocar',
		nativeSaved: (name: string) => `Língua nativa: ${name}`,
		study: 'Estudo',
		studySub: 'Cada idioma tem as próprias palavras e revisões',
		studyNone: 'Nenhum idioma ainda. Adicione o primeiro.',
		studyList: 'Seus idiomas',
		studyAdd: 'Adicionar idioma',
		added: (name: string) => `${name} adicionado aos seus idiomas`,
		removed: (name: string) => `${name} saiu dos seus idiomas`,
		removeLabel: (name: string) => `Tirar ${name}`,
		removeTitle: 'Tirar dos seus idiomas',
		removeConfirm: (name: string) =>
			`Tirar ${name}? As palavras continuam guardadas e voltam se você adicionar o idioma de novo.`
	} as const;

	const study = $derived(shell?.studyLanguages ?? []);
	const native = $derived(shell?.nativeLanguage ?? null);
	const uiLanguage = $derived(shell?.uiLanguage ?? 'pt');
	let pickingNative = $state(false);
	let pickingStudy = $state(false);

	function labelOf(raw: string) {
		const tag = parseLanguage(raw);
		return tag ? languageLabel(tag, uiLanguage) : raw;
	}
	const email = $derived(data.user?.email ?? '');
	const initial = $derived((email || '?').charAt(0).toUpperCase());
	const name = $derived(email.split('@')[0] ?? '');

	let newPerDay = $derived(data.newPerDay);

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

	<div class="set-row">
		<div>
			<b id="interface-titulo">{T.ui}</b>
			<span>{T.uiSub}</span>
		</div>
		<form
			class="seg"
			method="POST"
			action="?/interface"
			use:enhance={quiet()}
			aria-labelledby="interface-titulo"
		>
			<input type="hidden" name="voltar" value="/perfil" />
			{#each UI_LANGUAGES as l (l)}
				<button name="interface" value={l} aria-pressed={uiLanguage === l} lang={l}
					>{languageSelfLabel(l)}</button
				>
			{/each}
		</form>
	</div>

	<section class="set-row langs" id="nativa" aria-labelledby="nativa-titulo">
		<div>
			<b id="nativa-titulo">{T.native}</b>
			<span>{T.nativeSub}</span>
		</div>
		<div class="current">
			{#if native}
				<span class="code">{native.toUpperCase()}</span>
				<span class="nm">{languageLabel(native, uiLanguage)}</span>
				<span class="faint" {...langAttrs(native)}>· {languageSelfLabel(native)}</span>
			{:else}
				<span class="faint">{T.nativeNone}</span>
			{/if}
		</div>
		<details class="pick" bind:open={pickingNative}>
			<summary class="btn btn-soft"><Icon name="pencil" size="sm" />{T.nativeChange}</summary>
			<div class="pick-box">
				<LanguagePicker
					id="nativa-picker"
					action="?/nativa"
					name="nativa"
					ui={uiLanguage}
					exclude={native ? [native] : []}
					hidden={{ voltar: '/perfil' }}
					submit={({ formData }) => {
						const tag = String(formData.get('nativa') ?? '');
						pickingNative = false;
						return afterSave(T.nativeSaved(labelOf(tag)));
					}}
				/>
			</div>
		</details>
	</section>

	<section class="set-row langs" id="idiomas" aria-labelledby="idiomas-titulo">
		<div>
			<b id="idiomas-titulo">{T.study}</b>
			<span>{T.studySub}</span>
		</div>
		{#if study.length === 0}
			<p class="faint none">{T.studyNone}</p>
		{:else}
			<ul class="chips" aria-label={T.studyList}>
				{#each study as lang (lang)}
					<li>
						<span class="code">{lang.toUpperCase()}</span>
						<span class="nm">{languageLabel(lang, uiLanguage)}</span>
						<span class="faint">· {countOf(lang)}</span>
						<form
							method="POST"
							action="?/idiomas"
							use:enhance={quiet(T.removed(languageLabel(lang, uiLanguage)))}
						>
							<input type="hidden" name="voltar" value="/perfil" />
							{#each study.filter((l) => l !== lang) as keep (keep)}
								<input type="hidden" name="idiomas" value={keep} />
							{/each}
							<button
								class="icon-btn"
								aria-label={T.removeLabel(languageLabel(lang, uiLanguage))}
								title={T.removeTitle}
								onclick={(e) => {
									if (!confirm(T.removeConfirm(languageLabel(lang, uiLanguage))))
										e.preventDefault();
								}}><Icon name="x" size="sm" /></button
							>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
		{#if study.length < MAX_STUDY_LANGUAGES}
			<details class="pick" bind:open={pickingStudy}>
				<summary class="btn btn-soft"><Icon name="plus" size="sm" />{T.studyAdd}</summary>
				<div class="pick-box">
					<LanguagePicker
						id="estudo-picker"
						action="?/adicionarIdioma"
						name="idioma"
						ui={uiLanguage}
						exclude={native ? [...study, native] : study}
						hidden={{ voltar: '/perfil' }}
						submit={({ formData }) => {
							const tag = String(formData.get('idioma') ?? '');
							pickingStudy = false;
							return afterSave(T.added(labelOf(tag)));
						}}
					/>
				</div>
			</details>
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
	.current {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1 1 auto;
		font-size: 14px;
	}
	.current .nm {
		font-weight: 500;
	}
	.none {
		flex: 1 1 100%;
		margin: 0;
		font-size: 13.5px;
	}
	.pick summary {
		list-style: none;
		cursor: pointer;
	}
	.pick summary::-webkit-details-marker {
		display: none;
	}
	.pick[open] summary {
		background: var(--hover);
	}
	.pick-box {
		margin-top: 8px;
		width: min(380px, calc(100vw - 48px));
		padding: 10px;
		border-radius: var(--r-l);
		background: var(--raise);
		box-shadow: var(--sh-card);
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
	}
</style>
