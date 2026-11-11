<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { REVIEW_TIME_ZONE, formatAgo } from '#lib/review.ts';
	import { toast } from '#lib/ui/app-state.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import type { PageProps, SubmitFunction } from './$types';

	let { data, form }: PageProps = $props();

	let creating = $state(false);
	let revoking = $state<string | null>(null);
	let copied = $state(false);
	let openTv = $state(false);
	let openEr = $state(false);

	const newToken = $derived(form?.action === 'create' && 'token' in form ? form.token : null);
	const message = $derived(form && 'message' in form ? form.message : null);
	const connected = $derived(data.tokens.length > 0);
	const paired = $derived(data.devices.length > 0);
	const now = $derived(new Date(data.now));
	const timeZone = $derived(data.shell?.clock.timeZone ?? REVIEW_TIME_ZONE);

	// Token novo: a linha do Stremio abre mostrando ele.
	$effect(() => {
		if (newToken) openTv = true;
	});

	const SOURCES = [
		{ key: 'tv', label: 'Stremio' },
		{ key: 'mu', label: 'Música' },
		{ key: 'mao', label: 'À mão' },
		{ key: 'er', label: 'E-reader' }
	] as const;

	const sources = $derived(
		SOURCES.map((s) => ({ ...s, n: data.sources?.[s.key] ?? 0 })).filter((s) => s.n > 0)
	);
	const total = $derived(sources.reduce((sum, s) => sum + s.n, 0));

	const lastSync = $derived(
		data.devices.reduce<string | null>(
			(max, d) => (d.last_used_at && (!max || d.last_used_at > max) ? d.last_used_at : max),
			null
		)
	);

	const erStatus = $derived.by(() => {
		const n = data.devices.length;
		const sync = lastSync ? `sincronizou ${ago(lastSync)}` : 'ainda não sincronizou';
		return `${n} ${n === 1 ? 'aparelho' : 'aparelhos'} · ${sync}`;
	});

	function ago(iso: string) {
		return formatAgo(new Date(iso), now, timeZone);
	}

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
		const device = formData.get('kind') === 'aparelho';
		return async ({ update, result }) => {
			await update();
			revoking = null;
			if (result.type === 'success') {
				toast(
					device
						? 'Aparelho desconectado. Pareie de novo para sincronizar.'
						: 'Token revogado. Ele parou de funcionar.'
				);
			}
		};
	};

	async function copy() {
		if (!newToken) return;
		await navigator.clipboard.writeText(newToken);
		copied = true;
		toast('Token copiado');
	}
</script>

<svelte:head>
	<title>Integrações · Linguetta</title>
</svelte:head>

<header class="ph">
	<div>
		<h1>Integrações</h1>
		<p>Conecte os lugares onde você encontra palavras.</p>
	</div>
</header>

{#if total > 0}
	<section class="origem" aria-labelledby="origem-titulo">
		<div class="origem-top">
			<b id="origem-titulo">De onde vieram suas palavras</b><span>{total} no total</span>
		</div>
		<div class="barra" aria-hidden="true">
			{#each sources as s (s.key)}
				<i style:flex={s.n} style:background="var(--src-{s.key})"></i>
			{/each}
		</div>
		<div class="leg">
			{#each sources as s (s.key)}
				<span><i style:background="var(--src-{s.key})"></i>{s.label} <b>{s.n}</b></span>
			{/each}
		</div>
	</section>
{/if}

{#if message}<p class="erro" role="alert">{message}</p>{/if}

<div class="fontes">
	<section class="fonte" class:aberta={openTv} aria-labelledby="stremio-titulo">
		<div class="fonte-row">
			<span class="f-ic"><Icon name="tv" /></span>
			<div class="f-t">
				<b id="stremio-titulo">Stremio</b>
				{#if connected}
					<span class="on"
						>Conectado{#if data.stremio.last}
							· última palavra {ago(data.stremio.last.at)}{/if}</span
					>
				{:else}
					<span>Legendas viram palavras no seu banco</span>
				{/if}
			</div>
			<button
				type="button"
				class="btn {connected ? 'btn-soft' : 'btn-primary'}"
				aria-expanded={openTv}
				aria-controls="stremio-corpo"
				onclick={() => (openTv = !openTv)}
			>
				{connected ? 'Gerenciar' : 'Conectar'}
			</button>
		</div>
		{#if openTv}
			<div class="f-body" id="stremio-corpo">
				{#if newToken || !connected}
					<ol class="passos">
						{#if newToken}
							<li class="feito">
								<div class="pt" role="status">
									<b>Token gerado</b><span>Copie agora: ele aparece uma vez só.</span>
									<div class="token">
										<input
											readonly
											value={newToken}
											aria-label="Token gerado"
											onfocus={(e) => e.currentTarget.select()}
										/>
										<button type="button" class="btn btn-soft btn-sm" onclick={copy}>
											{copied ? 'Copiado' : 'Copiar'}
										</button>
									</div>
								</div>
							</li>
						{:else}
							<li>
								<div class="pt">
									<b>Gere um token</b>
									<form method="POST" action="?/create" use:enhance={submitCreate} class="gerar">
										<input
											name="label"
											maxlength="60"
											placeholder="Nome (opcional)"
											aria-label="Nome"
											autocomplete="off"
										/>
										<button class="btn btn-primary btn-sm" type="submit" disabled={creating}>
											{creating ? 'Gerando…' : 'Gerar token'}
										</button>
									</form>
								</div>
							</li>
						{/if}
						<li>
							<div class="pt">
								<b>Cole no LingoBlend</b><span>No player do Stremio, menu IT/EN → Token.</span>
							</div>
						</li>
					</ol>
				{/if}
				{#if connected}
					<ul class="lista" class:sep={newToken} aria-label="Tokens ativos">
						{#each data.tokens as t (t.id)}
							<li class:saindo={revoking === t.id}>
								<div class="n">
									<b>{t.label}</b><code>…{t.token_hint}</code>
									<small>{t.last_used_at ? `Usado ${ago(t.last_used_at)}` : 'Nunca usado'}</small>
								</div>
								<form method="POST" action="?/revoke" use:enhance={submitRevoke}>
									<input type="hidden" name="id" value={t.id} />
									<button
										class="btn btn-ghost btn-sm"
										type="submit"
										aria-label={`Revogar ${t.label} …${t.token_hint}`}
									>
										Revogar
									</button>
								</form>
							</li>
						{/each}
					</ul>
					<form method="POST" action="?/create" use:enhance={submitCreate} class="f-foot">
						<button class="btn btn-soft btn-sm" type="submit" disabled={creating}>
							<Icon name="plus" size="sm" />{creating ? 'Gerando…' : 'Novo token'}
						</button>
					</form>
				{/if}
			</div>
		{/if}
	</section>

	<section class="fonte" class:aberta={openEr} aria-labelledby="ereader-titulo">
		<div class="fonte-row">
			<span class="f-ic"><Icon name="bookmark" /></span>
			<div class="f-t">
				<b id="ereader-titulo">E-reader</b>
				{#if paired}
					<span class="on">{erStatus}</span>
				{:else}
					<span>Leia no X4 e salve palavras no seu banco</span>
				{/if}
			</div>
			{#if paired}
				<button
					type="button"
					class="btn btn-soft"
					aria-expanded={openEr}
					aria-controls="ereader-corpo"
					onclick={() => (openEr = !openEr)}
				>
					Gerenciar
				</button>
			{:else}
				<a class="btn btn-primary" href={resolve('/parear')}>Parear</a>
			{/if}
		</div>
		{#if openEr && paired}
			<div class="f-body" id="ereader-corpo">
				<ul class="lista" aria-label="Aparelhos">
					{#each data.devices as d (d.id)}
						<li class:saindo={revoking === d.id}>
							<div class="n">
								<b>{d.label}</b><code>…{d.token_hint}</code>
								<small
									>{#if d.model}{d.model} ·
									{/if}{d.last_used_at
										? `Sincronizou ${ago(d.last_used_at)}`
										: 'Ainda não sincronizou'}</small
								>
							</div>
							<form method="POST" action="?/revoke" use:enhance={submitRevoke}>
								<input type="hidden" name="id" value={d.id} />
								<input type="hidden" name="kind" value="aparelho" />
								<button
									class="btn btn-ghost btn-sm"
									type="submit"
									aria-label={`Revogar aparelho ${d.label} …${d.token_hint}`}
								>
									Revogar
								</button>
							</form>
						</li>
					{/each}
				</ul>
				<div class="f-foot">
					<a class="btn btn-soft btn-sm" href={resolve('/parear')}
						><Icon name="plus" size="sm" />Parear outro</a
					>
				</div>
			</div>
		{/if}
	</section>

	<section class="fonte breve" aria-labelledby="anki-titulo">
		<div class="fonte-row">
			<span class="f-ic"><Icon name="archive" /></span>
			<div class="f-t"><b id="anki-titulo">Anki</b><span>Exportar baralhos</span></div>
			<span class="tag">Em breve</span>
		</div>
	</section>
</div>

<style>
	.origem {
		margin: 4px 0 36px;
	}
	.origem-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	.origem-top b {
		font: 600 15px var(--f-body);
	}
	.origem-top span {
		color: var(--ink-3);
		font-size: 14.5px;
		font-variant-numeric: tabular-nums;
	}
	.barra {
		display: flex;
		height: 10px;
		border-radius: 99px;
		overflow: hidden;
		gap: 3px;
	}
	.barra i {
		display: block;
		height: 100%;
		border-radius: 3px;
	}
	.leg {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 20px;
		margin-top: 12px;
		font-size: 14.5px;
		color: var(--ink-2);
	}
	.leg span {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.leg i {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
	.leg b {
		color: var(--ink);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.erro {
		margin: 0 0 14px;
		color: var(--terra-ink);
	}

	.fontes {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.fonte {
		background: var(--raise);
		border-radius: var(--r-l);
		box-shadow: var(--sh-card);
		overflow: hidden;
	}
	:global(.tema-escuro) .fonte {
		background: var(--tile);
	}
	.fonte-row {
		display: grid;
		grid-template-columns: 44px 1fr auto;
		align-items: center;
		gap: 16px;
		padding: 16px 18px;
	}
	.f-ic {
		width: 44px;
		height: 44px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-2);
	}
	.f-ic :global(.ic) {
		width: 21px;
		height: 21px;
	}
	.f-t {
		min-width: 0;
	}
	.f-t b {
		display: block;
		font: 600 18px/1.3 var(--f-head);
		letter-spacing: -0.01em;
	}
	.f-t span {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 14.5px;
		color: var(--ink-3);
	}
	.f-t .on {
		color: var(--ok-ink);
	}
	.f-t .on::before {
		content: '';
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
	}
	.fonte.breve {
		background: none;
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.fonte.breve .f-t b {
		color: var(--ink-2);
	}
	.fonte.breve .f-ic {
		color: var(--ink-3);
	}
	.tag {
		font-size: 13.5px;
		font-weight: 500;
		color: var(--ink-3);
		padding: 3px 9px;
		border-radius: 99px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}

	.f-body {
		padding: 4px 18px 20px 78px;
		animation: abre 0.3s var(--ease);
	}
	@keyframes abre {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	.btn-sm {
		height: 32px;
		padding: 0 12px;
		font-size: 14.5px;
	}

	.passos {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
		counter-reset: p;
	}
	.passos li {
		counter-increment: p;
		display: grid;
		grid-template-columns: 26px 1fr;
		gap: 12px;
		align-items: start;
	}
	.passos li::before {
		content: counter(p);
		width: 26px;
		height: 26px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font: 600 13.5px var(--f-head);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--ink-2);
	}
	.passos li.feito::before {
		content: '✓';
		background: var(--ok-soft);
		color: var(--ok-ink);
		box-shadow: none;
	}
	.pt {
		padding-top: 2px;
		min-width: 0;
	}
	.pt > b {
		display: block;
		font-weight: 500;
	}
	.pt > span {
		color: var(--ink-3);
		font-size: 14.5px;
	}
	.token,
	.gerar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
		max-width: 460px;
	}
	.token {
		padding: 5px 5px 5px 14px;
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
			500 14.5px ui-monospace,
			Menlo,
			monospace;
		color: var(--ink);
		text-overflow: ellipsis;
	}
	.gerar input {
		flex: 1;
		min-width: 0;
		height: 32px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink);
		font: inherit;
		font-size: 14.5px;
	}

	.lista {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.lista.sep {
		margin-top: 16px;
		border-top: 1px solid var(--line);
	}
	.lista li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		transition: opacity 0.2s;
	}
	.lista li + li {
		border-top: 1px solid var(--line);
	}
	.lista li.saindo {
		opacity: 0.4;
	}
	.lista .n {
		flex: 1;
		min-width: 0;
	}
	.lista .n b {
		font-weight: 500;
	}
	.lista .n code {
		font:
			500 13.5px ui-monospace,
			Menlo,
			monospace;
		color: var(--ink-3);
		margin-left: 6px;
	}
	.lista .n small {
		display: block;
		font-size: 14px;
		color: var(--ink-3);
	}
	.f-foot {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}

	@media (max-width: 768px) {
		.fonte-row {
			gap: 12px;
			padding: 14px;
		}
		.f-body {
			padding: 4px 14px 18px;
		}
	}
</style>
