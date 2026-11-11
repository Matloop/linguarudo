<script lang="ts">
	import { enhance } from '$app/forms';
	import { REVIEW_TIME_ZONE, formatAgo } from '#lib/review.ts';
	import { toast } from '#lib/ui/app-state.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import type { PageProps, SubmitFunction } from './$types';

	let { data, form }: PageProps = $props();

	let creating = $state(false);
	let revoking = $state<string | null>(null);
	let copied = $state(false);

	const newToken = $derived(form?.action === 'create' && 'token' in form ? form.token : null);
	const message = $derived(form && 'message' in form ? form.message : null);
	const connected = $derived(data.tokens.length > 0);
	const now = $derived(new Date(data.now));

	const submitCreate: SubmitFunction = () => {
		creating = true;
		copied = false;
		return async ({ update }) => {
			await update();
			creating = false;
		};
	};

	const submitRevoke: SubmitFunction = ({ formData }) => {
		revoking = formData.get('id')?.toString() ?? null;
		return async ({ update, result }) => {
			await update();
			revoking = null;
			if (result.type === 'success') toast('Token revogado. Ele parou de funcionar.');
		};
	};

	async function copy() {
		if (!newToken) return;
		await navigator.clipboard.writeText(newToken);
		copied = true;
		toast('Token copiado');
	}

	const dateFormat = new Intl.DateTimeFormat('pt-BR', {
		timeZone: REVIEW_TIME_ZONE,
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});

	function when(iso: string | null) {
		return iso ? dateFormat.format(new Date(iso)) : 'nunca';
	}
</script>

<svelte:head>
	<title>Integrações · Linguetta</title>
</svelte:head>

<div class="ph">
	<div>
		<h1>Integrações</h1>
		<p>
			Seu banco de palavras recebe o que você encontra em cada lugar. Tudo cai na mesma revisão.
		</p>
	</div>
</div>

<div class="intg">
	<section class="tile lift ig stremio" aria-labelledby="stremio-titulo">
		<div class="ig-h">
			<span class="ig-logo tv"><Icon name="tv" /></span>
			{#if connected}<span class="status">Conectado</span>{:else}<span class="soon-tag"
					>Não conectado</span
				>{/if}
		</div>
		<h2 class="ig-t" id="stremio-titulo">Stremio</h2>
		<span class="ig-s">Pelo addon LingoBlend</span>
		<p>
			Toque numa palavra da legenda. Ela chega com a frase e o episódio, e o LingoBlend traz
			primeiro as palavras que você está aprendendo.
		</p>
		<div class="ig-stats">
			<span><b>{data.stremio.words}</b> {data.stremio.words === 1 ? 'palavra' : 'palavras'}</span>
			{#if data.stremio.last}<span>Última: {formatAgo(new Date(data.stremio.last.at), now)}</span
				>{/if}
		</div>
		{#if data.stremio.last}
			<div class="ig-last">
				<Icon name="tv" size="sm" /><span
					><b>{data.stremio.last.lemma}</b>{#if data.stremio.last.source}
						· {data.stremio.last.source}{/if}</span
				>
			</div>
		{/if}

		{#if newToken}
			<div class="novo" role="status">
				<p><strong>Copie agora.</strong> Este token não aparece de novo.</p>
				<div class="token">
					<input
						readonly
						value={newToken}
						aria-label="Token gerado"
						onfocus={(e) => e.currentTarget.select()}
					/>
					<button type="button" class="btn btn-soft sm" onclick={copy}>
						{copied ? 'Copiado' : 'Copiar'}
					</button>
				</div>
			</div>
		{/if}

		{#if message}<p class="erro" role="alert">{message}</p>{/if}

		<section class="tokens" aria-labelledby="tokens-titulo">
			<h3 id="tokens-titulo">Tokens ativos</h3>
			{#if data.tokens.length === 0}
				<p class="vazio">Nenhum token ainda.</p>
			{:else}
				<ul>
					{#each data.tokens as t (t.id)}
						<li class:saindo={revoking === t.id}>
							<div class="texto">
								<p class="nome">{t.label} <code>…{t.token_hint}</code></p>
								<p class="meta">
									Criado em {when(t.created_at)} · Último uso: {when(t.last_used_at)}
								</p>
							</div>
							<form method="POST" action="?/revoke" use:enhance={submitRevoke}>
								<input type="hidden" name="id" value={t.id} />
								<button
									class="btn btn-ghost sm"
									type="submit"
									aria-label={`Revogar ${t.label} …${t.token_hint}`}
								>
									Revogar
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<form method="POST" action="?/create" use:enhance={submitCreate} class="gerar">
			<label class="campo">
				<span>Nome <i>· opcional</i></span>
				<input name="label" maxlength="60" placeholder="Stremio" autocomplete="off" />
			</label>
			<button class="btn btn-primary" type="submit" disabled={creating}>
				<Icon name="refresh" size="sm" />{creating ? 'Gerando…' : 'Gerar token'}
			</button>
		</form>

		<details class="como">
			<summary>Como conectar</summary>
			<ol class="steps">
				<li><span><b>Gere um token</b>Aqui em cima. Ele aparece uma vez só.</span></li>
				<li><span><b>Abra o menu da língua</b>No player do Stremio, no botão IT/EN.</span></li>
				<li><span><b>Cole o token</b>No campo do token. Pronto: as palavras chegam aqui.</span></li>
			</ol>
		</details>
	</section>

	<section class="tile ig soon" aria-labelledby="ereader-titulo">
		<div class="ig-h">
			<span class="ig-logo"><Icon name="bookmark" /></span><span class="soon-tag">Em breve</span>
		</div>
		<h2 class="ig-t" id="ereader-titulo">E-reader</h2>
		<span class="ig-s">CrossNext</span>
		<p>Marque uma palavra enquanto lê. Ela chega com a frase e a página.</p>
	</section>

	<section class="tile ig soon" aria-labelledby="anki-titulo">
		<div class="ig-h">
			<span class="ig-logo"><Icon name="archive" /></span><span class="soon-tag">Em breve</span>
		</div>
		<h2 class="ig-t" id="anki-titulo">Anki</h2>
		<span class="ig-s">Baralhos</span>
		<p>Suas palavras no Anki, com a frase e a tradução.</p>
	</section>
</div>

<section class="how-int">
	<h2>Como o banco junta tudo</h2>
	<ol class="steps row">
		<li><span><b>Você encontra</b>No Stremio, numa música ou à mão.</span></li>
		<li><span><b>Guarda com a frase</b>A palavra entra no banco do idioma certo.</span></li>
		<li><span><b>Revisa num lugar só</b>Tudo cai na mesma fila, no dia certo.</span></li>
	</ol>
</section>

<style>
	.intg {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr);
		gap: 14px;
		align-items: start;
	}
	.ig {
		padding: 22px;
		display: flex;
		flex-direction: column;
	}
	.ig-h {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 18px;
	}
	.ig-logo {
		width: 40px;
		height: 40px;
		border-radius: var(--r-m);
		display: grid;
		place-items: center;
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-2);
	}
	.ig-logo.tv {
		background: var(--primary);
		color: var(--on-primary);
		box-shadow: none;
	}
	.ig-t {
		margin: 0;
		font: 600 18px/1.25 var(--f-head);
		letter-spacing: -0.01em;
		display: block;
	}
	.ig-s {
		font-size: 13px;
		color: var(--ink-3);
	}
	.ig p {
		margin: 12px 0 0;
		color: var(--ink-2);
		font-size: 13.5px;
		text-wrap: pretty;
	}
	.ig-stats {
		display: flex;
		gap: 16px;
		margin-top: 16px;
		font-size: 12.5px;
		color: var(--ink-3);
		align-items: baseline;
	}
	.ig-stats b {
		font: 600 15px var(--f-head);
		color: var(--ink);
		margin-right: 2px;
	}
	.ig-last {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 14px;
		padding: 9px 12px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		font-size: 13px;
		color: var(--ink-3);
		min-width: 0;
	}
	.ig-last span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ig-last b {
		color: var(--ink);
		font-weight: 500;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 13px;
		font-weight: 500;
		color: var(--ink-2);
	}
	.status::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--salvia);
	}
	.soon-tag {
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-3);
		padding: 2px 8px;
		border-radius: 4px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.soon .ig-t {
		color: var(--ink-2);
	}
	.soon .ig-logo {
		color: var(--ink-3);
	}

	.novo {
		margin-top: 16px;
	}
	.novo p {
		margin: 0 0 8px;
	}
	.token {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 5px 5px 5px 12px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.token input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		outline: none;
		font:
			500 13px ui-monospace,
			'SF Mono',
			Menlo,
			monospace;
		color: var(--ink-2);
	}
	.sm {
		height: 30px;
		padding: 0 12px;
		font-size: 13px;
	}
	.erro {
		color: var(--terra-ink) !important;
	}

	.tokens {
		margin-top: 20px;
		border-top: 1px solid var(--line);
		padding-top: 14px;
	}
	.tokens h3 {
		margin: 0 0 6px;
		font: 500 12.5px var(--f-body);
		color: var(--ink-3);
	}
	.tokens .vazio {
		margin: 4px 0 0;
		color: var(--ink-3);
	}
	.tokens ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.tokens li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 0;
		transition: opacity 0.2s;
	}
	.tokens li + li {
		border-top: 1px solid var(--line);
	}
	.tokens li.saindo {
		opacity: 0.4;
	}
	.tokens .texto p {
		margin: 0;
	}
	.tokens .nome {
		font-weight: 500;
		color: var(--ink);
		font-size: 14px;
	}
	.tokens code {
		font:
			500 12.5px ui-monospace,
			'SF Mono',
			Menlo,
			monospace;
		color: var(--ink-3);
	}
	.tokens .meta {
		font-size: 12.5px;
		color: var(--ink-3);
		margin-top: 2px;
	}
	.gerar {
		display: flex;
		align-items: flex-end;
		gap: 10px;
		margin-top: 16px;
		flex-wrap: wrap;
	}
	.campo {
		flex: 1;
		min-width: 160px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.campo span {
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-3);
	}
	.campo i {
		font-style: normal;
		font-weight: 400;
	}
	.campo input {
		height: 36px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink);
		font: inherit;
		font-size: 14px;
	}
	.como {
		margin-top: 18px;
	}
	.como summary {
		cursor: pointer;
		font-size: 13px;
		font-weight: 500;
		color: var(--ink-2);
	}
	.como .steps {
		margin-top: 14px;
	}

	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		counter-reset: s;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.steps li {
		counter-increment: s;
		display: grid;
		grid-template-columns: 26px 1fr;
		gap: 12px;
		font-size: 13.5px;
		color: var(--ink-2);
	}
	.steps li::before {
		content: counter(s);
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font: 600 12px var(--f-head);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--ink-2);
	}
	.steps b {
		color: var(--ink);
		font-weight: 500;
		display: block;
	}
	.how-int {
		margin-top: 40px;
	}
	.how-int h2 {
		margin: 0 0 18px;
		font: 500 13px var(--f-body);
		color: var(--ink-3);
	}
	.steps.row {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 20px;
	}

	@media (max-width: 1100px) {
		.intg {
			grid-template-columns: 1fr 1fr;
		}
		.stremio {
			grid-column: 1 / -1;
		}
	}
	@media (max-width: 768px) {
		.intg,
		.steps.row {
			grid-template-columns: 1fr;
		}
	}
</style>
