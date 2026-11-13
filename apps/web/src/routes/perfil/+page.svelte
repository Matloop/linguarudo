<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import {
		MAX_STUDY_LANGUAGES,
		UI_LANGUAGES,
		langAttrs,
		languageLabel,
		languageSelfLabel,
		parseLanguage,
		type Language
	} from '#lib/languages.ts';
	import type { LeechAction, NewOrder } from '#lib/decks.ts';
	import type { Theme } from '#lib/prefs.ts';
	import { applyTheme, toast } from '#lib/ui/app-state.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import LanguagePicker from '#lib/ui/LanguagePicker.svelte';
	import Select from '#lib/ui/Select.svelte';
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
		langs: 'Idiomas de estudo',
		langsSub: 'Cada idioma tem as próprias palavras e revisões',
		langsNone: 'Nenhum idioma ainda. Adicione o primeiro.',
		langsList: 'Seus idiomas',
		langsAdd: 'Adicionar idioma',
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

	let leechLapses = $derived(data.leechLapses);
	const ORDER_LABELS: [NewOrder, string, string][] = [
		['importance', 'Importância', 'Vem antes o que você mais viu, em mais obras'],
		['deck', 'Ordem do baralho', 'Cada baralho na ordem em que as palavras entraram'],
		['random', 'Aleatória', 'Sorteio estável no dia']
	];
	const LEECH_LABELS: [LeechAction, string][] = [
		['wait', 'Esperar reencontro'],
		['tag', 'Só avisar'],
		['suspend', 'Pausar']
	];
	const leechHint = $derived(
		data.leechAction === 'wait'
			? 'Sai da fila e volta quando você a encontrar de novo numa obra'
			: data.leechAction === 'tag'
				? 'Continua na fila, marcada como teimosa'
				: 'Sai da fila até você trazer de volta na aba Teimosas'
	);
	let retention = $derived(data.retention);
	const clock = $derived(shell?.clock ?? { timeZone: 'America/Sao_Paulo', startHour: 4 });
	let startHour = $derived(clock.startHour);

	/** Fusos IANA que o navegador conhece; o atual entra mesmo se faltar na lista. */
	const zones = $derived.by(() => {
		const all = Intl.supportedValuesOf?.('timeZone') ?? [];
		return all.includes(clock.timeZone) ? all : [clock.timeZone, ...all];
	});
	// Só no navegador: no servidor o fuso seria o do host.
	let browserZone = $state<string | null>(null);
	let zoneForm: HTMLFormElement | undefined = $state();
	onMount(() => {
		browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
	});

	/**
	 * Carga aproximada em relação a 90%: o intervalo do FSRS cresce com R^(1/decay) − 1
	 * (decay ≈ −0,5), e o número de revisões cai na mesma proporção.
	 */
	function loadVs90(pct: number) {
		const gap = (r: number) => Math.pow(r, -2) - 1;
		return gap(0.9) / gap(pct / 100);
	}
	const retentionHint = $derived.by(() => {
		if (retention === 90) return 'Padrão. Lembra 9 de cada 10 cartões na hora de revisar';
		const x = loadVs90(retention);
		const n = x.toFixed(1).replace('.', ',');
		return x > 1
			? `Cerca de ${n}× as revisões de 90%`
			: `Cerca de ${n}× as revisões de 90%, esquecendo mais`;
	});

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

	const submitLapses: SubmitFunction = ({ formData }) => {
		leechLapses = Number(formData.get('erros'));
		return afterSave();
	};

	const submitRetention: SubmitFunction = ({ formData }) => {
		retention = Number(formData.get('retencao'));
		return afterSave();
	};

	const submitHour: SubmitFunction = ({ formData }) => {
		startHour = Number(formData.get('virada'));
		return afterSave();
	};

	function hourLabel(h: number) {
		return `${String(h).padStart(2, '0')}:00`;
	}
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
			<b id="idiomas-titulo">{T.langs}</b>
			<span>{T.langsSub}</span>
		</div>
		{#if study.length === 0}
			<p class="faint none">{T.langsNone}</p>
		{:else}
			<ul class="chips" aria-label={T.langsList}>
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
				<summary class="btn btn-soft"><Icon name="plus" size="sm" />{T.langsAdd}</summary>
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

	<h2 class="group" id="estudo">Estudo</h2>

	<div class="set-row stack">
		<div>
			<b id="ordem-titulo">Ordem das novas</b>
			<span>{ORDER_LABELS.find(([k]) => k === data.newOrder)?.[2]}. Vale para Estudar tudo.</span>
		</div>
		<form
			class="seg"
			method="POST"
			action="?/ordem"
			use:enhance={quiet('Ordem salva')}
			aria-labelledby="ordem-titulo"
		>
			<input type="hidden" name="voltar" value="/perfil" />
			{#each ORDER_LABELS as [key, label] (key)}
				<button name="ordem" value={key} aria-pressed={data.newOrder === key}>{label}</button>
			{/each}
		</form>
	</div>

	<div class="set-row">
		<div>
			<b id="ret-titulo">Retenção desejada</b>
			<span>{retentionHint}</span>
		</div>
		<form
			class="stepper"
			method="POST"
			action="?/retencao"
			use:enhance={submitRetention}
			aria-labelledby="ret-titulo"
		>
			<input type="hidden" name="voltar" value="/perfil" />
			<button
				name="retencao"
				value={retention - 1}
				aria-label="Menos"
				disabled={retention <= data.minRetention}>−</button
			>
			<output aria-live="polite">{retention}%</output>
			<button
				name="retencao"
				value={retention + 1}
				aria-label="Mais"
				disabled={retention >= data.maxRetention}>+</button
			>
		</form>
	</div>

	<div class="set-row">
		<div>
			<b id="erros-titulo">Teimosa depois de</b>
			<span>Erros seguidos no mesmo flashcard</span>
		</div>
		<form
			class="stepper"
			method="POST"
			action="?/teimosas"
			use:enhance={submitLapses}
			aria-labelledby="erros-titulo"
		>
			<input type="hidden" name="voltar" value="/perfil" />
			<button
				name="erros"
				value={leechLapses - 1}
				aria-label="Menos"
				disabled={leechLapses <= data.minLeechLapses}>−</button
			>
			<output aria-live="polite" class="wide">{leechLapses} erros</output>
			<button
				name="erros"
				value={leechLapses + 1}
				aria-label="Mais"
				disabled={leechLapses >= data.maxLeechLapses}>+</button
			>
		</form>
	</div>

	<div class="set-row stack">
		<div>
			<b id="acao-titulo">Com a teimosa</b>
			<span>{leechHint}</span>
		</div>
		<form
			class="seg"
			method="POST"
			action="?/teimosas"
			use:enhance={quiet()}
			aria-labelledby="acao-titulo"
		>
			<input type="hidden" name="voltar" value="/perfil" />
			{#each LEECH_LABELS as [key, label] (key)}
				<button name="acao" value={key} aria-pressed={data.leechAction === key}>{label}</button>
			{/each}
		</form>
	</div>

	<div class="set-row">
		<div>
			<b id="virada-titulo">O dia vira às</b>
			<span>Revisar antes disso conta como o dia anterior</span>
		</div>
		<form
			class="stepper"
			method="POST"
			action="?/virada"
			use:enhance={submitHour}
			aria-labelledby="virada-titulo"
		>
			<input type="hidden" name="voltar" value="/perfil" />
			<button name="virada" value={(startHour + 23) % 24} aria-label="Mais cedo">−</button>
			<output aria-live="polite" class="wide">{hourLabel(startHour)}</output>
			<button name="virada" value={(startHour + 1) % 24} aria-label="Mais tarde">+</button>
		</form>
	</div>

	<div class="set-row">
		<div>
			<b id="fuso-titulo">Fuso horário</b>
			<span>
				{#if browserZone && browserZone !== clock.timeZone}
					Este aparelho está em {browserZone.replaceAll('_', ' ')}
				{:else}
					Define quando o dia de estudo começa
				{/if}
			</span>
		</div>
		<form
			bind:this={zoneForm}
			class="zone"
			method="POST"
			action="?/fuso"
			use:enhance={quiet('Fuso salvo')}
			aria-labelledby="fuso-titulo"
		>
			<input type="hidden" name="voltar" value="/perfil" />
			<Select
				name="fuso"
				labelledby="fuso-titulo"
				align="end"
				value={clock.timeZone}
				options={zones.map((z) => ({ value: z, label: z.replaceAll('_', ' ') }))}
				onchange={() => tick().then(() => zoneForm?.requestSubmit())}
			/>
			<noscript><button class="btn btn-soft">Salvar</button></noscript>
		</form>
		{#if browserZone && browserZone !== clock.timeZone}
			<form method="POST" action="?/fuso" use:enhance={quiet('Fuso salvo')}>
				<input type="hidden" name="voltar" value="/perfil" />
				<button class="btn btn-soft" name="fuso" value={browserZone}>Usar este</button>
			</form>
		{/if}
	</div>

	<div class="set-row">
		<div>
			<b id="autoplay-titulo">Tocar áudio sozinho</b>
			<span>Na revisão, a gravação do flashcard toca ao aparecer</span>
		</div>
		<form
			class="seg"
			method="POST"
			action="?/autoplay"
			use:enhance={quiet()}
			aria-labelledby="autoplay-titulo"
		>
			<input type="hidden" name="voltar" value="/perfil" />
			<button name="autoplay" value="on" aria-pressed={data.autoplayAudio}>Ligado</button>
			<button name="autoplay" value="off" aria-pressed={!data.autoplayAudio}>Desligado</button>
		</form>
	</div>

	<h2 class="group" id="conta">Conta e aparência</h2>

	<div class="set-row">
		<div>
			<b>Integrações</b>
			<span>{data.stremioConnected ? 'Stremio conectado' : 'Nenhuma conectada ainda'}</span>
		</div>
		<a class="btn btn-soft" href={resolve('/integracoes')}>Ver integrações</a>
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
		font-size: 14.5px;
		color: var(--ink-3);
	}
	.group {
		margin: 34px 0 4px;
		padding: 0 4px 10px;
		border-bottom: 1px solid var(--line);
		font: 600 17px/1.2 var(--f-head);
		letter-spacing: -0.01em;
		color: var(--ink);
	}
	.group + .set-row {
		border-top: 0;
	}
	/* Seg de três opções: texto em cima, botões embaixo, largura cheia. */
	.set-row.stack {
		flex-direction: column;
		align-items: stretch;
		gap: 12px;
	}
	.set-row.stack .seg {
		display: flex;
	}
	.set-row.stack .seg > button {
		flex: 1;
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
		font-size: 21.5px;
	}
	.profile-card b {
		font: 600 21.5px var(--f-head);
		letter-spacing: -0.01em;
		display: block;
	}
	.profile-card .faint {
		font-size: 15px;
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
		font-size: 15.5px;
	}
	.chips li:hover {
		background: var(--hover);
	}
	.chips .nm {
		font-weight: 500;
	}
	.chips .faint {
		font-size: 14.5px;
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
		font-size: 15.5px;
	}
	.current .nm {
		font-weight: 500;
	}
	.none {
		flex: 1 1 100%;
		margin: 0;
		font-size: 15px;
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
		font: 600 16.5px var(--f-head);
		font-variant-numeric: tabular-nums;
	}
	.stepper output.wide {
		min-width: 56px;
	}
	.zone {
		display: flex;
		gap: 8px;
		align-items: center;
		min-width: 0;
	}
	.zone :global(.sel) {
		width: 220px;
	}
	.f-err {
		color: var(--terra-ink);
		font-size: 15px;
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
