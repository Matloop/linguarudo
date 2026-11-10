<!-- Perguntas frequentes em acordeão. -->
<script lang="ts">
	const PERGUNTAS = [
		{
			q: 'É grátis?',
			r: 'Sim. Você cria a conta e usa sem pagar.'
		},
		{
			q: 'Como funciona a revisão?',
			r: 'Toda palavra que você salva vira um cartão. O FSRS decide quando ela volta: a que você lembra fácil some por mais tempo, a que você erra volta logo. São 10 palavras novas por dia, e você muda isso quando quiser.'
		},
		{
			q: 'Funciona no celular?',
			r: 'Funciona. O Linguarudo roda no navegador e pode ser instalado na tela inicial, no Android e no iPhone. Revisão, aulas e música funcionam no celular. O plugin do Stremio, por enquanto, é só no computador.'
		},
		{
			q: 'Como funciona com o Stremio?',
			r: 'Você instala a nossa versão do Stremio no computador e entra com a sua conta do Linguarudo. Durante o filme ou a série, clica numa palavra da legenda, vê a tradução e salva. A palavra vai pro mesmo banco do app e entra na revisão.'
		},
		{
			q: 'Quais línguas?',
			r: 'Inglês e italiano, para quem fala português. Dá pra estudar as duas ao mesmo tempo. Outras línguas podem vir depois, mas ainda não têm data.'
		},
		{
			q: 'E meus dados?',
			r: 'Ficam na sua conta, protegidos por login. Não vendemos seus dados e não mostramos anúncio.'
		}
	];

	let abertas = $state<boolean[]>(PERGUNTAS.map((_, i) => i === 0));
</script>

<div class="faq">
	{#each PERGUNTAS as p, i (p.q)}
		<div class="item">
			<h3>
				<button
					type="button"
					id="q{i + 1}"
					aria-expanded={abertas[i]}
					aria-controls="r{i + 1}"
					onclick={() => (abertas[i] = !abertas[i])}
				>
					{p.q}<span class="mm" aria-hidden="true"
						><svg class="ic"><use href="#i-mais" /></svg></span
					>
				</button>
			</h3>
			<div class="resp" id="r{i + 1}" role="region" aria-labelledby="q{i + 1}" hidden={!abertas[i]}>
				{p.r}
			</div>
		</div>
	{/each}
</div>

<style>
	.faq {
		border-top: 1.5px solid var(--linha);
	}

	.item {
		border-bottom: 1.5px solid var(--linha);
	}

	h3 {
		font-size: inherit;
		letter-spacing: 0;
	}

	button {
		width: 100%;
		border: 0;
		background: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 20px 4px;
		font-size: 19px;
		font-weight: 800;
		color: var(--verde);
		text-align: left;
	}

	.mm {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: var(--salvia-claro);
		display: grid;
		place-items: center;
		flex: none;
		transition:
			transform 0.25s,
			background 0.2s;
	}

	button[aria-expanded='true'] .mm {
		transform: rotate(45deg);
		background: var(--coral);
	}

	.resp {
		padding: 0 4px 22px;
		color: var(--tinta-suave);
		font-size: 17px;
		font-weight: 550;
		max-width: 60ch;
	}

	.resp[hidden] {
		display: none;
	}

	.resp:not([hidden]) {
		animation: entra 0.25s;
	}

	@keyframes entra {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	@media (max-width: 760px) {
		button {
			font-size: 17px;
			padding: 18px 2px;
		}

		.resp {
			font-size: 16px;
		}
	}
</style>
