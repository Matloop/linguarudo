<script lang="ts">
	import { enhance } from '$app/forms';
	import { REVIEW_TIME_ZONE } from '#lib/review.ts';
	import type { PageProps, SubmitFunction } from './$types';

	let { data, form }: PageProps = $props();

	let creating = $state(false);
	let revoking = $state<string | null>(null);
	let copied = $state(false);

	const newToken = $derived(form?.action === 'create' && 'token' in form ? form.token : null);
	const message = $derived(form && 'message' in form ? form.message : null);

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
		return async ({ update }) => {
			await update();
			revoking = null;
		};
	};

	async function copy() {
		if (!newToken) return;
		await navigator.clipboard.writeText(newToken);
		copied = true;
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
	<title>Integrações · Linguarudo</title>
</svelte:head>

<h1>Integrações</h1>

<section class="cartao" aria-labelledby="stremio-titulo">
	<h2 id="stremio-titulo">Stremio (LingoBlend)</h2>
	<p>
		O LingoBlend troca algumas palavras da legenda pela língua que você estuda. Com um token, ele
		salva as palavras que você clicar aqui no seu banco e traz primeiro as que você está aprendendo.
	</p>
	<ol>
		<li>Gere um token.</li>
		<li>No player, abra o menu do botão da língua (IT/EN).</li>
		<li>Cole o token no campo “Token do Linguarudo”.</li>
	</ol>

	<form method="POST" action="?/create" use:enhance={submitCreate} class="gerar">
		<div class="campo">
			<label for="label">Nome <span class="opcional">(opcional)</span></label>
			<input id="label" name="label" maxlength="60" placeholder="Stremio" autocomplete="off" />
		</div>
		<button class="botao" type="submit" disabled={creating}>
			{creating ? 'Gerando…' : 'Gerar token'}
		</button>
	</form>

	{#if newToken}
		<div class="novo" role="status">
			<p><strong>Copie agora.</strong> Este token não aparece de novo.</p>
			<div class="copiar">
				<input
					readonly
					value={newToken}
					aria-label="Token gerado"
					onfocus={(e) => e.currentTarget.select()}
				/>
				<button type="button" class="botao-secundario" onclick={copy}>
					{copied ? 'Copiado' : 'Copiar'}
				</button>
			</div>
		</div>
	{/if}

	{#if message}<p class="erro" role="alert">{message}</p>{/if}
</section>

<section aria-labelledby="tokens-titulo">
	<h2 id="tokens-titulo">Tokens ativos</h2>
	{#if data.tokens.length === 0}
		<p class="vazio">Nenhum token ainda.</p>
	{:else}
		<ul class="lista">
			{#each data.tokens as t (t.id)}
				<li class:saindo={revoking === t.id}>
					<div class="texto">
						<p class="nome">{t.label} <code>…{t.token_hint}</code></p>
						<p class="meta">Criado em {when(t.created_at)} · Último uso: {when(t.last_used_at)}</p>
					</div>
					<form method="POST" action="?/revoke" use:enhance={submitRevoke}>
						<input type="hidden" name="id" value={t.id} />
						<button
							class="revogar"
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

<style>
	h1 {
		margin: 0 0 16px;
		font-size: 28px;
		color: var(--verde);
		letter-spacing: -0.01em;
	}

	h2 {
		margin: 0;
		font-size: 16px;
		color: var(--verde);
	}

	section + section {
		margin-top: 28px;
	}

	section > h2 {
		margin-bottom: 10px;
	}

	.cartao {
		background: var(--papel);
		border: 1.5px solid var(--linha);
		border-radius: 22px;
		padding: 18px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.cartao p,
	.cartao ol {
		margin: 0;
		color: var(--tinta-suave);
	}

	.cartao ol {
		padding-left: 22px;
	}

	.gerar {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		flex-wrap: wrap;
	}

	.campo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-width: 180px;
	}

	label {
		font-weight: 700;
		font-size: 14px;
		color: var(--verde);
	}

	.opcional {
		font-weight: 600;
		color: var(--cinza);
	}

	input {
		border: 1.5px solid var(--linha);
		border-radius: var(--raio-p);
		background: #fff;
		padding: 10px 12px;
		min-width: 0;
	}

	input:focus-visible {
		outline: 2px solid var(--salvia);
		outline-offset: 1px;
	}

	.botao {
		border: 0;
		background: var(--coral);
		color: #fff;
		border-radius: 14px;
		padding: 12px 22px;
		font-weight: 800;
		box-shadow: var(--sombra-botao) var(--coral-escuro);
	}

	.botao:active {
		transform: translateY(2px);
		box-shadow: none;
	}

	.botao:disabled {
		opacity: 0.7;
		cursor: default;
	}

	.novo {
		border: 1.5px dashed var(--salvia);
		background: #fff;
		border-radius: var(--raio);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.novo p {
		color: var(--verde);
	}

	.copiar {
		display: flex;
		gap: 8px;
	}

	.copiar input {
		flex: 1;
		font-family: ui-monospace, monospace;
		font-size: 14px;
	}

	.botao-secundario,
	.revogar {
		border: 1.5px solid var(--linha);
		background: #fff;
		color: var(--verde);
		border-radius: var(--raio-p);
		padding: 8px 14px;
		font-weight: 700;
	}

	.revogar {
		color: #a53b3b;
	}

	.botao-secundario:hover,
	.revogar:hover {
		background: var(--creme-escuro);
	}

	.erro {
		color: #a53b3b;
		font-weight: 600;
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
		align-items: center;
		gap: 10px;
		background: #fff;
		border: 1.5px solid var(--linha);
		border-radius: var(--raio);
		padding: 12px 12px 12px 16px;
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

	.nome {
		font-weight: 800;
		color: var(--verde);
	}

	.nome code {
		font-weight: 600;
		color: var(--cinza);
	}

	.meta {
		font-size: 14px;
		color: var(--cinza);
	}

	.vazio {
		margin: 0;
		color: var(--cinza);
	}
</style>
