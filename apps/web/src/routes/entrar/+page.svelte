<script lang="ts">
	import { enhance } from '$app/forms';
	import mascote from '#lib/assets/mascote.png';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let sending = $state(false);
</script>

<svelte:head>
	<title>Entrar · Linguarudo</title>
</svelte:head>

<section class="cartao">
	<img class="mascote" src={mascote} alt="" width="120" height="120" />
	<h1>Entrar</h1>
	<p class="sub">Guarde as palavras que você pega em séries, músicas e aulas.</p>

	{#if data.authError}
		<p class="aviso erro" role="alert">{data.authError}</p>
	{/if}

	{#if form?.sent}
		<div class="aviso ok" role="status">
			<strong>Link enviado para {form.sent}.</strong>
			Abra o e-mail neste aparelho e toque em “Entrar”.
		</div>
	{:else}
		<form method="POST" action="?/google">
			<input type="hidden" name="next" value={data.next} />
			<button class="google" type="submit">
				<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
					<path
						fill="#4285F4"
						d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6a5.1 5.1 0 0 1-2.2 3.3v2.8h3.6c2-1.9 3.2-4.7 3.2-8.2Z"
					/>
					<path
						fill="#34A853"
						d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.9A11 11 0 0 0 12 23Z"
					/>
					<path
						fill="#FBBC05"
						d="M5.7 14c-.2-.7-.4-1.3-.4-2s.1-1.4.4-2V7.1H2a11 11 0 0 0 0 9.8L5.7 14Z"
					/>
					<path
						fill="#EA4335"
						d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.2-3.2A11 11 0 0 0 2 7.1L5.7 10C6.6 7.4 9 5.4 12 5.4Z"
					/>
				</svg>
				Entrar com Google
			</button>
			{#if form && 'google' in form}
				<p class="erro-campo" role="alert">{form.message}</p>
			{/if}
		</form>

		<p class="ou"><span>ou receba um link por e-mail</span></p>

		<form
			method="POST"
			action="?/magic"
			use:enhance={() => {
				sending = true;
				return async ({ update }) => {
					await update();
					sending = false;
				};
			}}
		>
			<input type="hidden" name="next" value={data.next} />
			<label for="email">E-mail</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				inputmode="email"
				required
				placeholder="voce@exemplo.com"
				value={form && 'email' in form ? form.email : ''}
				aria-invalid={form && 'email' in form ? 'true' : undefined}
				aria-describedby={form && 'email' in form ? 'email-erro' : undefined}
			/>
			{#if form && 'email' in form}
				<p id="email-erro" class="erro-campo" role="alert">{form.message}</p>
			{/if}
			<button class="primario" type="submit" disabled={sending}>
				{sending ? 'Enviando…' : 'Mandar link'}
			</button>
		</form>
	{/if}
</section>

<style>
	.cartao {
		max-width: 420px;
		margin: 8px auto 0;
		background: var(--papel);
		border: 1.5px solid var(--linha);
		border-radius: 24px;
		padding: 24px 20px 28px;
	}

	.mascote {
		display: block;
		width: 104px;
		height: auto;
		margin: -4px auto 4px;
	}

	h1 {
		margin: 0;
		text-align: center;
		color: var(--verde);
		font-size: 28px;
		letter-spacing: -0.01em;
	}

	.sub {
		margin: 4px 0 22px;
		text-align: center;
		color: var(--cinza);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	label {
		font-weight: 700;
		font-size: 14px;
		color: var(--verde);
	}

	input[type='email'] {
		border: 2px solid var(--linha);
		background: #fff;
		border-radius: var(--raio-p);
		padding: 12px 14px;
		font-size: 16px;
	}

	input[type='email']:focus {
		border-color: var(--salvia);
		outline: none;
	}

	input[aria-invalid='true'] {
		border-color: var(--coral);
	}

	button {
		border: 0;
		border-radius: 14px;
		padding: 13px 18px;
		font-weight: 800;
		font-size: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
	}

	button:active {
		transform: translateY(2px);
		box-shadow: none;
	}

	.google {
		background: #fff;
		border: 2px solid var(--linha);
		box-shadow: var(--sombra-botao) var(--linha);
		color: var(--tinta);
	}

	.primario {
		margin-top: 6px;
		background: var(--coral);
		color: #fff;
		box-shadow: var(--sombra-botao) var(--coral-escuro);
	}

	.primario:disabled {
		opacity: 0.7;
		cursor: default;
	}

	.ou {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 20px 0 14px;
		color: var(--cinza);
		font-size: 14px;
	}

	.ou::before,
	.ou::after {
		content: '';
		flex: 1;
		border-top: 1.5px solid var(--linha);
	}

	.aviso {
		border-radius: 14px;
		padding: 12px 14px;
		margin: 0 0 16px;
	}

	.aviso.ok {
		background: var(--salvia-claro);
		color: var(--verde);
	}

	.aviso.ok strong {
		display: block;
	}

	.aviso.erro {
		background: var(--coral-claro);
		color: #a53b3b;
	}

	.erro-campo {
		margin: 0;
		color: #a53b3b;
		font-size: 14px;
		font-weight: 600;
	}
</style>
