<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '#lib/ui/Icon.svelte';
	import Mark from '#lib/ui/Mark.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const REPO = 'https://github.com/Matloop/linguarudo';
	const titulo = 'Linguetta · Aprenda com o que você já assiste, ouve e lê';
	const descricao =
		'Guarde a palavra com a frase em que você a encontrou. O Linguetta traz de volta no dia certo.';

	const acao = $derived(
		data.user
			? { href: resolve('/inicio'), texto: 'Abrir o app' }
			: { href: resolve('/entrar'), texto: 'Começar grátis' }
	);

	const PERGUNTAS = [
		{
			q: 'É grátis?',
			r: 'Sim. Você cria a conta com o seu e-mail e usa sem pagar. Não tem anúncio.'
		},
		{
			q: 'Como funciona a revisão?',
			r: 'Cada palavra guardada vira um cartão. O FSRS decide quando ela volta: a que você lembra fácil some por mais tempo, a que você erra volta logo. São 10 palavras novas por dia, e você muda isso no perfil.'
		},
		{
			q: 'Quais idiomas?',
			r: 'Você escolhe os idiomas que estuda, e cada um tem as próprias palavras. O jogo de música, por enquanto, só tem inglês e italiano.'
		},
		{
			q: 'Funciona no celular?',
			r: 'Funciona no navegador e pode ser instalado na tela inicial, no Android e no iPhone. A integração com o Stremio, por enquanto, é só no computador.'
		},
		{
			q: 'Como funciona com o Stremio?',
			r: 'Você usa o addon LingoBlend e cola um token gerado em Integrações. Durante o filme ou a série, toca numa palavra da legenda e ela chega ao seu banco com a frase e o episódio.'
		},
		{
			q: 'E meus dados?',
			r: 'Ficam na sua conta, protegidos por login. Não vendemos seus dados.'
		}
	];
</script>

<svelte:head>
	<title>{titulo}</title>
	<meta name="description" content={descricao} />
	<meta property="og:type" content="website" />
	<meta property="og:locale" content="pt_BR" />
	<meta property="og:title" content={titulo} />
	<meta property="og:description" content={descricao} />
	<meta property="og:image" content={new URL('/icon-512.png', page.url.origin).href} />
</svelte:head>

<div class="lp">
	<a class="skip" href="#conteudo">Pular para o conteúdo</a>

	<header class="top wrap">
		<a class="brand" href={resolve('/')} aria-label="Linguetta, início">
			<Mark class="mark" /><span class="wordmark">Linguetta</span>
		</a>
		<nav aria-label="Seções da página">
			<a href="#como">Como funciona</a>
			<a href="#integracoes">Integrações</a>
			<a href="#perguntas">Perguntas</a>
		</nav>
		<div class="top-acts">
			{#if !data.user}<a class="btn btn-ghost" href={resolve('/entrar')}>Entrar</a>{/if}
			<a class="btn btn-primary" href={acao.href}>{acao.texto}</a>
		</div>
	</header>

	<main id="conteudo">
		<section class="hero wrap">
			<div class="hero-text">
				<p class="eyebrow">Grátis · Para quem fala português</p>
				<h1>Aprenda com o que você já assiste, ouve e lê.</h1>
				<p class="lead">
					Guarde a palavra com a frase em que você a encontrou. O Linguetta traz de volta no dia
					certo, antes de você esquecer.
				</p>
				<div class="acts">
					<a class="btn btn-primary btn-lg" href={acao.href}>{acao.texto}</a>
					<a class="btn btn-soft btn-lg" href="#como">Como funciona</a>
				</div>
			</div>

			<figure class="shot" aria-label="Exemplo de cartão de revisão">
				<div class="card">
					<div class="card-h">
						<span class="src"><Icon name="tv" size="sm" />Kaguya · T1E2, 42:10</span>
						<span class="lang">IT</span>
					</div>
					<div class="card-mid">
						<b lang="it">festa</b>
						<span>/ˈfɛs.ta/</span>
					</div>
					<p class="ctx" lang="it">Stasera ci sono tante <u>feste</u> nel quartiere.</p>
				</div>
				<div class="grades" aria-hidden="true">
					<span data-g="1"><b>Errei</b>1 min</span>
					<span data-g="2"><b>Difícil</b>8 min</span>
					<span data-g="3"><b>Bom</b>1 dia</span>
					<span data-g="4"><b>Fácil</b>4 dias</span>
				</div>
				<figcaption>Um cartão de verdade: a palavra, a frase e de onde ela veio.</figcaption>
			</figure>
		</section>

		<section class="sec wrap" id="como" aria-labelledby="como-t">
			<p class="eyebrow">Como funciona</p>
			<h2 id="como-t">Tudo vai para o mesmo banco. Depois volta como revisão.</h2>
			<ol class="steps">
				<li>
					<b>Você encontra</b>
					<span>Numa série no Stremio, numa música ou numa conversa. Guarde à mão com N.</span>
				</li>
				<li>
					<b>Guarda com a frase</b>
					<span>A palavra entra no banco do idioma certo, com o contexto em que apareceu.</span>
				</li>
				<li>
					<b>Revisa no dia certo</b>
					<span>Um cartão por vez: você vê a palavra, lembra o sentido e diz como foi.</span>
				</li>
			</ol>
		</section>

		<section class="sec wrap" id="integracoes" aria-labelledby="int-t">
			<p class="eyebrow">Integrações</p>
			<h2 id="int-t">Onde o Linguetta funciona</h2>
			<div class="ints">
				<article>
					<span class="ico"><Icon name="globe" /></span>
					<h3>Web e celular <span class="on">Disponível</span></h3>
					<p>No navegador ou instalado na tela inicial. Android, iPhone e computador.</p>
				</article>
				<article>
					<span class="ico"><Icon name="tv" /></span>
					<h3>Stremio <span class="on">Disponível</span></h3>
					<p>Pelo addon LingoBlend. Toque numa palavra da legenda. Só no computador.</p>
				</article>
				<article>
					<span class="ico"><Icon name="music" /></span>
					<h3>Música <span class="on">Disponível</span></h3>
					<p>Complete a letra de uma música do YouTube. Em inglês e italiano.</p>
				</article>
				<article class="soon">
					<span class="ico"><Icon name="bookmark" /></span>
					<h3>E-reader <span>Em breve</span></h3>
					<p>Marcar palavras enquanto lê, pelo CrossNext.</p>
				</article>
				<article class="soon">
					<span class="ico"><Icon name="archive" /></span>
					<h3>Anki <span>Em breve</span></h3>
					<p>Levar suas palavras para o Anki, com a frase e a tradução.</p>
				</article>
			</div>
		</section>

		<section class="sec wrap faq" id="perguntas" aria-labelledby="faq-t">
			<div>
				<p class="eyebrow">Perguntas</p>
				<h2 id="faq-t">O que todo mundo pergunta</h2>
			</div>
			<div class="qs">
				{#each PERGUNTAS as p, i (p.q)}
					<details open={i === 0}>
						<summary>{p.q}<Icon name="plus" size="sm" /></summary>
						<p>{p.r}</p>
					</details>
				{/each}
			</div>
		</section>

		<section class="wrap" aria-labelledby="cta-t">
			<div class="cta">
				<Mark class="cta-mark" />
				<h2 id="cta-t">Sua primeira palavra está a um toque.</h2>
				<p>Crie a conta e comece pelo que você já ia ver hoje.</p>
				<a class="btn btn-lg cta-btn" href={acao.href}>{acao.texto}</a>
			</div>
		</section>
	</main>

	<footer class="foot wrap">
		<span class="brand small"><Mark class="mark" /><span class="wordmark">Linguetta</span></span>
		<span class="faint">© 2026 Linguetta</span>
		<nav aria-label="Links do rodapé">
			<a href="#integracoes">Stremio</a>
			<a href="#perguntas">Perguntas</a>
			<a href={REPO} rel="noopener">Código-fonte</a>
		</nav>
	</footer>
</div>

<style>
	.lp {
		min-height: 100vh;
		background: var(--page);
		color: var(--ink);
	}
	.wrap {
		width: min(1120px, 100% - 48px);
		margin-inline: auto;
	}
	.skip {
		position: absolute;
		left: 12px;
		top: -60px;
		padding: 8px 12px;
		border-radius: var(--r-m);
		background: var(--primary);
		color: var(--on-primary);
		z-index: 10;
	}
	.skip:focus {
		top: 12px;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 28px;
		height: 72px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--ink);
		text-decoration: none;
	}
	.brand :global(.mark) {
		width: 22px;
		height: 24px;
	}
	.wordmark {
		font: 600 18px var(--f-head);
		letter-spacing: -0.02em;
	}
	.top nav {
		display: flex;
		gap: 22px;
		margin-left: auto;
		font-size: 14px;
	}
	.top nav a,
	.foot nav a {
		color: var(--ink-2);
		text-decoration: none;
	}
	.top nav a:hover,
	.foot nav a:hover {
		color: var(--ink);
	}
	.top-acts {
		display: flex;
		gap: 6px;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
		gap: 56px;
		align-items: center;
		padding: 72px 0 96px;
	}
	.hero h1 {
		margin: 14px 0 0;
		font: 600 54px/1.06 var(--f-head);
		letter-spacing: -0.04em;
		text-wrap: balance;
	}
	.lead {
		margin: 20px 0 0;
		font-size: 18px;
		line-height: 1.55;
		color: var(--ink-2);
		max-width: 500px;
		text-wrap: pretty;
	}
	.acts {
		display: flex;
		gap: 8px;
		margin-top: 32px;
		flex-wrap: wrap;
	}

	.shot {
		margin: 0;
	}
	.card {
		background: var(--raise);
		border-radius: var(--r-l);
		box-shadow: var(--sh-lift);
		padding: 18px 22px 24px;
		height: 300px;
		display: flex;
		flex-direction: column;
	}
	:global(.tema-escuro) .card {
		background: #1a3626;
	}
	.card-h {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.src {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}
	.lang {
		font: 600 10.5px var(--f-head);
		letter-spacing: 0.04em;
		padding: 3px 6px;
		border-radius: 4px;
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--ink-2);
	}
	.card-mid {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}
	.card-mid b {
		font: 600 52px/1 var(--f-head);
		letter-spacing: -0.035em;
	}
	.card-mid span {
		color: var(--ink-3);
		font-size: 15px;
	}
	.ctx {
		margin: 0;
		text-align: center;
		color: var(--ink-2);
		font-size: 15px;
	}
	.ctx u {
		text-decoration: none;
		color: var(--ink);
		font-weight: 500;
		box-shadow: inset 0 -1.5px 0 var(--line-2);
	}
	.grades {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 8px;
		margin-top: 14px;
	}
	.grades span {
		height: 56px;
		border-radius: var(--r-m);
		background: var(--raise);
		box-shadow: var(--sh-card);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		color: var(--ink-3);
	}
	:global(.tema-escuro) .grades span {
		background: rgba(247, 241, 230, 0.05);
	}
	.grades b {
		font-weight: 500;
		font-size: 14px;
		color: var(--ink);
	}
	figcaption {
		margin-top: 14px;
		font-size: 13px;
		color: var(--ink-3);
		text-align: center;
	}

	.sec {
		padding: 72px 0;
		border-top: 1px solid var(--line);
	}
	.sec h2,
	.cta h2 {
		margin: 12px 0 0;
		font: 600 34px/1.15 var(--f-head);
		letter-spacing: -0.03em;
		max-width: 640px;
		text-wrap: balance;
	}
	.steps {
		list-style: none;
		margin: 40px 0 0;
		padding: 0;
		counter-reset: s;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 32px;
	}
	.steps li {
		counter-increment: s;
		display: flex;
		flex-direction: column;
		gap: 6px;
		color: var(--ink-2);
		font-size: 15px;
		line-height: 1.5;
	}
	.steps li::before {
		content: counter(s);
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font: 600 13px var(--f-head);
		box-shadow: inset 0 0 0 1px var(--line-2);
		margin-bottom: 8px;
	}
	.steps b {
		color: var(--ink);
		font: 600 17px var(--f-head);
		letter-spacing: -0.01em;
	}

	.ints {
		margin-top: 40px;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.ints article {
		padding: 22px;
		border-radius: var(--r-l);
		background: var(--tile);
	}
	.ico {
		width: 40px;
		height: 40px;
		border-radius: var(--r-m);
		display: grid;
		place-items: center;
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-2);
	}
	.ints h3 {
		margin: 16px 0 0;
		font: 600 17px var(--f-head);
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.ints h3 span {
		font: 500 12px var(--f-body);
		color: var(--ink-3);
		padding: 2px 8px;
		border-radius: 4px;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.ints h3 span.on {
		box-shadow: none;
		padding: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-2);
	}
	.ints h3 span.on::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--salvia);
	}
	.ints p {
		margin: 8px 0 0;
		color: var(--ink-2);
		font-size: 14px;
		line-height: 1.5;
	}
	.soon h3 {
		color: var(--ink-2);
	}

	.faq {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: 48px;
	}
	.qs details {
		border-bottom: 1px solid var(--line);
	}
	.qs summary {
		list-style: none;
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		padding: 18px 0;
		font: 600 16px var(--f-head);
	}
	.qs summary::-webkit-details-marker {
		display: none;
	}
	.qs summary :global(.ic) {
		color: var(--ink-3);
		transition: transform 0.2s var(--ease);
	}
	.qs details[open] summary :global(.ic) {
		transform: rotate(45deg);
	}
	.qs p {
		margin: 0 0 18px;
		color: var(--ink-2);
		line-height: 1.6;
		text-wrap: pretty;
	}

	.cta {
		margin: 24px 0 72px;
		padding: 64px 32px;
		border-radius: var(--r-l);
		background: #11261a;
		color: #f7f1e6;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.cta :global(.cta-mark) {
		width: 36px;
		height: 39px;
		opacity: 0.9;
	}
	.cta h2 {
		margin-top: 20px;
	}
	.cta p {
		margin: 12px 0 28px;
		color: rgba(247, 241, 230, 0.72);
	}
	.cta-btn {
		background: #f7f1e6;
		color: #11261a;
	}
	.cta-btn:hover {
		background: #fffaf0;
	}

	.foot {
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 28px 0 40px;
		border-top: 1px solid var(--line);
		font-size: 13.5px;
	}
	.brand.small :global(.mark) {
		width: 16px;
		height: 18px;
	}
	.brand.small .wordmark {
		font-size: 15px;
	}
	.foot nav {
		margin-left: auto;
		display: flex;
		gap: 18px;
	}

	@media (max-width: 900px) {
		.top nav {
			display: none;
		}
		.top-acts {
			margin-left: auto;
		}
		.hero {
			grid-template-columns: 1fr;
			padding: 40px 0 64px;
			gap: 40px;
		}
		.hero h1 {
			font-size: 40px;
		}
		.steps,
		.ints,
		.faq {
			grid-template-columns: 1fr;
		}
		.faq {
			gap: 16px;
		}
	}
	@media (max-width: 560px) {
		.wrap {
			width: calc(100% - 32px);
		}
		.top-acts .btn-ghost {
			display: none;
		}
		.hero h1 {
			font-size: 34px;
		}
		.sec h2,
		.cta h2 {
			font-size: 27px;
		}
		.card-mid b {
			font-size: 42px;
		}
		.foot {
			flex-wrap: wrap;
		}
		.foot nav {
			margin-left: 0;
			width: 100%;
		}
	}
</style>
