<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Mark from '#lib/ui/Mark.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let sending = $state(false);
</script>

<svelte:head>
	<title>Entrar · Linguetta</title>
</svelte:head>

<div class="pg">
	<a class="brand" href={resolve('/')} aria-label="Linguetta, início"
		><Mark class="mark" /><span>Linguetta</span></a
	>
	<section class="cartao">
		<h1>Entrar</h1>
		<p class="sub">Guarde as palavras que você encontra em séries, músicas e aulas.</p>

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
				<button class="btn btn-soft btn-lg google" type="submit">
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
				<button class="btn btn-primary btn-lg" type="submit" disabled={sending}>
					{sending ? 'Enviando…' : 'Mandar link'}
				</button>
			</form>
		{/if}
	</section>
</div>

<style>
	.pg {
		min-height: 100vh;
		background: var(--page);
		color: var(--ink);
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 48px 16px;
		gap: 28px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--ink);
		text-decoration: none;
		font: 600 19.5px var(--f-head);
		letter-spacing: -0.02em;
	}
	.brand :global(.mark) {
		width: 22px;
		height: 24px;
	}
	.cartao {
		width: min(400px, 100%);
		background: var(--raise);
		border-radius: var(--r-l);
		box-shadow: var(--sh-card);
		padding: 32px 28px;
	}
	h1 {
		margin: 0;
		font: 600 28px var(--f-head);
		letter-spacing: -0.03em;
	}
	.sub {
		margin: 6px 0 24px;
		color: var(--ink-2);
		font-size: 16px;
		line-height: 1.5;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	label {
		font-weight: 500;
		font-size: 15px;
		color: var(--ink-2);
	}
	input[type='email'] {
		height: 44px;
		padding: 0 14px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink);
		font: inherit;
		font-size: 17.5px;
	}
	input[type='email']:focus {
		outline: none;
		box-shadow: inset 0 0 0 1.5px var(--ring);
	}
	input[aria-invalid='true'] {
		box-shadow: inset 0 0 0 1.5px var(--terra);
	}
	.btn {
		width: 100%;
		justify-content: center;
	}
	.btn-primary {
		margin-top: 6px;
	}
	.btn:disabled {
		opacity: 0.7;
		cursor: default;
	}
	.ou {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 20px 0 14px;
		color: var(--ink-3);
		font-size: 14.5px;
	}
	.ou::before,
	.ou::after {
		content: '';
		flex: 1;
		border-top: 1px solid var(--line);
	}
	.aviso {
		border-radius: var(--r-m);
		padding: 12px 14px;
		margin: 0 0 16px;
		font-size: 15.5px;
		line-height: 1.5;
	}
	.aviso.ok {
		background: var(--soft-bg);
	}
	.aviso.ok strong {
		display: block;
		font-weight: 600;
	}
	.aviso.erro {
		background: var(--terra-soft);
		color: var(--terra-ink);
	}
	.erro-campo {
		margin: 0;
		color: var(--terra-ink);
		font-size: 15px;
	}
</style>
