<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatAgo } from '#lib/review.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import type { PageProps, SubmitFunction } from './$types';

	let { data, form }: PageProps = $props();

	let sending = $state<'approve' | 'deny' | null>(null);

	const decided = $derived(form && 'decided' in form ? form.decided : null);
	const message = $derived(form && 'message' in form ? form.message : null);
	const askedAgo = $derived(
		data.pairing && data.now
			? formatAgo(new Date(data.pairing.createdAt), new Date(data.now), data.shell?.clock.timeZone)
			: ''
	);

	const submit: SubmitFunction = ({ action }) => {
		sending = action.search.includes('deny') ? 'deny' : 'approve';
		return async ({ update }) => {
			await update({ reset: false });
			sending = null;
		};
	};
</script>

<svelte:head>
	<title>Parear aparelho · Linguetta</title>
</svelte:head>

<div class="parear">
	<section class="tile lift card" aria-labelledby="parear-titulo">
		<span class="ig-logo"><Icon name="bookmark" /></span>

		{#if decided === 'approved'}
			<h1 id="parear-titulo">Pronto, aparelho conectado</h1>
			<p class="lead">
				<b>{form && 'deviceName' in form ? form.deviceName : 'O aparelho'}</b> já pode sincronizar. Ele
				recebe o acesso em alguns segundos.
			</p>
			<div class="acts">
				<a class="btn btn-primary" href="/integracoes">Ver em Integrações</a>
			</div>
		{:else if decided === 'denied'}
			<h1 id="parear-titulo">Pedido recusado</h1>
			<p class="lead">
				O aparelho não ganhou acesso à sua conta. Se foi engano, gere outro código nele.
			</p>
			<div class="acts">
				<a class="btn btn-ghost" href="/inicio">Voltar ao início</a>
			</div>
		{:else if data.pairing}
			<p class="eyebrow">Parear e-reader</p>
			<h1 id="parear-titulo">Conectar <b>{data.pairing.deviceName}</b> à sua conta?</h1>
			<p class="lead">
				Ele vai receber seu banco de palavras e mandar o que você salvar e revisar no livro.
			</p>
			<dl class="facts">
				{#if data.pairing.deviceModel}
					<div>
						<dt>Modelo</dt>
						<dd>{data.pairing.deviceModel}</dd>
					</div>
				{/if}
				<div>
					<dt>Código</dt>
					<dd><code class="ucode">{data.code}</code></dd>
				</div>
				<div>
					<dt>Pedido</dt>
					<dd>{askedAgo}</dd>
				</div>
			</dl>
			<p class="hint">Confira se é o mesmo código da tela do aparelho.</p>
			{#if message}<p class="erro" role="alert">{message}</p>{/if}
			<div class="acts">
				<form method="POST" action="?/approve" use:enhance={submit}>
					<input type="hidden" name="code" value={data.code} />
					<input type="hidden" name="deviceName" value={data.pairing.deviceName} />
					<button class="btn btn-primary" type="submit" disabled={sending !== null}>
						{sending === 'approve' ? 'Aprovando…' : 'Aprovar'}
					</button>
				</form>
				<form method="POST" action="?/deny" use:enhance={submit}>
					<input type="hidden" name="code" value={data.code} />
					<input type="hidden" name="deviceName" value={data.pairing.deviceName} />
					<button class="btn btn-ghost" type="submit" disabled={sending !== null}>
						{sending === 'deny' ? 'Recusando…' : 'Recusar'}
					</button>
				</form>
			</div>
		{:else}
			<p class="eyebrow">Parear e-reader</p>
			<h1 id="parear-titulo">Digite o código do aparelho</h1>
			{#if data.invalid || message}
				<p class="erro" role="alert">Código inválido ou vencido. Gere outro no aparelho.</p>
			{:else}
				<p class="lead">
					No aparelho, abra Linguetta e escolha Parear. O código tem seis caracteres.
				</p>
			{/if}
			<form method="GET" class="entrada">
				<label class="campo">
					<span>Código</span>
					<input
						name="code"
						placeholder="K7Q-4MP"
						autocomplete="off"
						autocapitalize="characters"
						spellcheck="false"
						maxlength="12"
						required
					/>
				</label>
				<button class="btn btn-primary" type="submit">Continuar</button>
			</form>
		{/if}
	</section>
</div>

<style>
	.parear {
		display: grid;
		place-items: start center;
		padding: 48px 0 24px;
	}
	.card {
		width: min(100%, 460px);
		padding: 32px;
		gap: 0;
	}
	.ig-logo {
		width: 40px;
		height: 40px;
		border-radius: var(--r-m);
		display: grid;
		place-items: center;
		background: var(--primary);
		color: var(--on-primary);
		margin-bottom: 20px;
	}
	.eyebrow {
		margin: 0 0 6px;
	}
	h1 {
		margin: 0;
		font: 600 24px/1.3 var(--f-head);
		letter-spacing: -0.015em;
		text-wrap: balance;
	}
	h1 b {
		font-weight: 600;
		color: var(--accent-ink);
	}
	.lead {
		margin: 10px 0 0;
		color: var(--ink-2);
		font-size: 15.5px;
		text-wrap: pretty;
	}
	.lead b {
		color: var(--ink);
		font-weight: 500;
	}
	.facts {
		margin: 22px 0 0;
		padding: 4px 16px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.facts div {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 16px;
		padding: 10px 0;
		font-size: 15px;
	}
	.facts div + div {
		border-top: 1px solid var(--line);
	}
	.facts dt {
		color: var(--ink-3);
	}
	.facts dd {
		margin: 0;
		color: var(--ink);
		font-weight: 500;
		text-align: right;
	}
	.ucode {
		font: 600 16.5px var(--f-mono);
		letter-spacing: 0.12em;
	}
	.hint {
		margin: 10px 0 0;
		font-size: 14px;
		color: var(--ink-3);
	}
	.erro {
		margin: 12px 0 0;
		color: var(--terra-ink);
		font-size: 15px;
	}
	.acts {
		display: flex;
		gap: 8px;
		margin-top: 24px;
		flex-wrap: wrap;
	}
	.entrada {
		display: flex;
		align-items: flex-end;
		gap: 10px;
		margin-top: 22px;
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
		font-size: 13.5px;
		font-weight: 500;
		color: var(--ink-3);
	}
	.campo input {
		height: 40px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink);
		font: 600 16.5px var(--f-mono);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.campo input::placeholder {
		color: var(--ink-3);
		font-weight: 400;
	}
</style>
