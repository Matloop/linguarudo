<script lang="ts">
	import '@fontsource-variable/nunito';
	import '#lib/landing/landing.css';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import icone from '#lib/assets/icone.png';
	import nome from '#lib/assets/nome.png';
	import CenaMosca from '#lib/landing/CenaMosca.svelte';
	import Icones from '#lib/landing/Icones.svelte';
	import Perguntas from '#lib/landing/Perguntas.svelte';
	import Previa from '#lib/landing/Previa.svelte';
	import Recursos from '#lib/landing/Recursos.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const REPO = 'https://github.com/Matloop/linguarudo';
	const titulo = 'Linguarudo · Inglês e italiano com o que você já assiste, ouve e lê';
	const descricao =
		'Toque numa palavra. O Linguarudo guarda e te lembra na hora certa. Inglês e italiano para quem fala português.';

	const acao = $derived(
		data.user
			? { href: resolve('/palavras'), texto: 'Abrir o app' }
			: { href: resolve('/entrar'), texto: 'Começar grátis' }
	);

	let rolou = $state(false);
</script>

<svelte:head>
	<title>{titulo}</title>
	<meta name="description" content={descricao} />
	<meta property="og:type" content="website" />
	<meta property="og:locale" content="pt_BR" />
	<meta property="og:title" content={titulo} />
	<meta property="og:description" content={descricao} />
	<meta property="og:image" content={new URL(icone, page.url.origin).href} />
</svelte:head>

<svelte:window onscroll={() => (rolou = scrollY > 8)} />

<div class="lp">
	<Icones />
	<a class="pular-link" href="#conteudo">Pular para o conteúdo</a>

	<header class="topo" class:rolou>
		<div class="wrap topo-in">
			<a class="marca" href={resolve('/')} aria-label="Linguarudo, início">
				<img src={nome} alt="" width="600" height="189" />
			</a>
			<nav aria-label="Seções da página">
				<a href="#como">Como funciona</a>
				<a href="#integracoes">Integrações</a>
				<a href="#perguntas">Perguntas</a>
			</nav>
			<a class="btn btn-coral btn-p" href={acao.href}>{acao.texto}</a>
		</div>
	</header>

	<main id="conteudo">
		<section class="hero wrap">
			<p class="selo">
				<span class="ponto" aria-hidden="true"></span><span>Grátis</span><i aria-hidden="true"
				></i><span>Inglês e italiano</span><i class="extra" aria-hidden="true"></i><span
					class="extra">Para quem fala português</span
				>
			</p>
			<h1>Aprenda com o que você já <span class="sub-onda">assiste, ouve e lê.</span></h1>
			<p class="lead">Toque numa palavra. O Linguarudo guarda e te lembra na hora certa.</p>
			<div class="acoes">
				<a class="btn btn-coral btn-g" href={acao.href}>{acao.texto}</a>
				<a class="btn btn-linha btn-g" href="#previa">Testar aqui embaixo</a>
			</div>
		</section>

		<section class="previa-sec wrap" id="previa" aria-labelledby="pvTit">
			<Previa />
		</section>

		<section class="sec wrap" id="como" aria-labelledby="comoT">
			<div class="sec-cab">
				<p class="olho">Como funciona</p>
				<h2 id="comoT">Tudo vai pro mesmo banco. Depois volta como revisão.</h2>
				<p>
					Filme, música, aula ou livro. A palavra que você tocou entra na fila e aparece de novo
					quando você estiver quase esquecendo.
				</p>
			</div>
			<Recursos />
		</section>

		<section class="sec wrap" id="integracoes" aria-labelledby="intT">
			<div class="sec-cab">
				<p class="olho">Integrações</p>
				<h2 id="intT">Onde o Linguarudo funciona</h2>
				<p>Hoje no navegador e no Stremio. Leitores de livro digital estão na fila.</p>
			</div>
			<div class="integ">
				<article class="int">
					<span class="ico"><svg class="ic"><use href="#i-web" /></svg></span>
					<h3>Web e celular <span class="st on">Disponível</span></h3>
					<p>
						Abra no navegador ou instale na tela inicial como app (PWA). Android, iPhone e
						computador.
					</p>
				</article>
				<article class="int">
					<span class="ico"><svg class="ic"><use href="#i-plugin" /></svg></span>
					<h3>Stremio <span class="st on">Disponível</span></h3>
					<p>Plugin que deixa clicar nas palavras da legenda. As palavras caem no mesmo banco.</p>
					<p class="nota">
						<svg class="ic"><use href="#i-web" /></svg>Só no computador, com a nossa versão do
						Stremio
					</p>
				</article>
				<article class="int breve">
					<span class="ico"><svg class="ic"><use href="#i-kindle" /></svg></span>
					<h3>Kindle <span class="st off">Em breve</span></h3>
					<p>Importar as palavras que você consulta no Kindle direto para o banco.</p>
				</article>
				<article class="int breve">
					<span class="ico"><svg class="ic"><use href="#i-livro" /></svg></span>
					<h3>KOReader <span class="st off">Em breve</span></h3>
					<p>Plugin para salvar palavras sem sair do livro, em leitores com KOReader.</p>
				</article>
			</div>
		</section>

		<section class="sec wrap" id="perguntas" aria-labelledby="faqT">
			<div class="faq-g">
				<div class="sec-cab">
					<p class="olho">Perguntas</p>
					<h2 id="faqT">O que todo mundo pergunta</h2>
					<p>Respostas curtas para as dúvidas mais comuns.</p>
				</div>
				<Perguntas />
			</div>
		</section>

		<section class="wrap" aria-labelledby="ctaT">
			<div class="cta escuro">
				<div class="cta-cena"><CenaMosca palavra="word" /></div>
				<div>
					<h2 id="ctaT">Sua primeira palavra está a um toque.</h2>
					<p>Crie a conta, escolha inglês ou italiano e comece pelo que você já ia ver hoje.</p>
					<div class="acoes">
						<a class="btn btn-coral btn-g" href={acao.href}>{acao.texto}</a>
						<a class="btn btn-linha btn-g" href="#previa">Testar a prévia</a>
					</div>
				</div>
			</div>
		</section>
	</main>

	<footer class="rodape wrap">
		<div class="rodape-in">
			<img src={nome} alt="Linguarudo" width="600" height="189" />
			<span class="ano">© 2026 Linguarudo</span>
			<nav aria-label="Links do rodapé">
				<a href="#integracoes">Plugin do Stremio</a>
				<a href="#perguntas">Perguntas</a>
				<a href={REPO} rel="noopener">Código-fonte</a>
			</nav>
		</div>
	</footer>
</div>

<style>
	.lp {
		min-height: 100dvh;
	}

	.pular-link {
		position: absolute;
		left: 12px;
		top: -60px;
		z-index: 100;
		background: var(--verde);
		color: var(--creme);
		padding: 10px 16px;
		border-radius: 12px;
		font-weight: 800;
		text-decoration: none;
	}

	.pular-link:focus {
		top: 12px;
	}

	/* header */
	.topo {
		position: sticky;
		top: 0;
		z-index: 40;
		background: #fdf4e3e6;
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border-bottom: 1px solid transparent;
		transition: border-color 0.2s;
	}

	.topo.rolou {
		border-color: var(--linha);
	}

	.topo-in {
		display: flex;
		align-items: center;
		gap: 28px;
		height: 64px;
	}

	.marca img {
		height: 34px;
		width: auto;
	}

	.topo nav {
		display: flex;
		gap: 4px;
		margin-left: auto;
	}

	.topo nav a {
		text-decoration: none;
		font-weight: 700;
		font-size: 15px;
		color: var(--tinta-suave);
		padding: 8px 12px;
		border-radius: 10px;
	}

	.topo nav a:hover {
		color: var(--verde);
		background: #0c40330a;
	}

	/* hero */
	.hero {
		text-align: center;
		padding: 72px 0 44px;
	}

	.selo {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		background: var(--papel);
		border: 1.5px solid var(--linha);
		border-radius: 99px;
		padding: 6px 14px;
		font-size: 14px;
		font-weight: 750;
		color: var(--tinta-suave);
		margin-bottom: 26px;
		white-space: nowrap;
	}

	.selo i {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--salvia);
	}

	.selo .ponto {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--coral);
		box-shadow: 0 0 0 3px var(--coral-claro);
	}

	.hero h1 {
		font-size: clamp(38px, 6.2vw, 80px);
		font-weight: 850;
		max-width: 14ch;
		margin: 0 auto;
		color: var(--verde);
		letter-spacing: -0.035em;
		line-height: 1.04;
	}

	.sub-onda {
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 10'%3E%3Cpath d='M0 5 Q10 0 20 5 T40 5' fill='none' stroke='%237FA886' stroke-width='3.2'/%3E%3C/svg%3E")
			repeat-x 0 100% / 0.5em 0.14em;
		padding-bottom: 0.12em;
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
	}

	.lead {
		font-size: clamp(18px, 1.9vw, 22px);
		color: var(--tinta-suave);
		max-width: 34ch;
		margin: 32px auto 0;
		font-weight: 600;
	}

	.acoes {
		display: flex;
		gap: 12px;
		justify-content: center;
		margin-top: 30px;
		flex-wrap: wrap;
	}

	.previa-sec {
		padding-bottom: 24px;
	}

	/* integrações */
	.integ {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 16px;
	}

	.int {
		background: var(--papel);
		border: 1.5px solid var(--linha);
		border-radius: 22px;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.ico {
		width: 48px;
		height: 48px;
		border-radius: 14px;
		display: grid;
		place-items: center;
		background: var(--salvia-claro);
		color: var(--verde);
	}

	.ico .ic {
		width: 24px;
		height: 24px;
	}

	.breve .ico {
		background: var(--creme-escuro);
		color: #8a6a3a;
	}

	.int h3 {
		font-size: 19px;
		color: var(--verde);
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.int p {
		font-size: 15px;
		color: var(--tinta-suave);
		font-weight: 550;
	}

	.st {
		font-size: 12px;
		font-weight: 850;
		border-radius: 99px;
		padding: 3px 9px;
		letter-spacing: 0.02em;
	}

	.st.on {
		background: var(--verde);
		color: var(--creme);
	}

	.st.off {
		color: #7a5a2a;
		box-shadow: inset 0 0 0 1.5px #e3c99b;
	}

	.int .nota {
		font-size: 13px;
		font-weight: 700;
		color: var(--verde);
		margin-top: auto;
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.nota .ic {
		width: 15px;
		height: 15px;
	}

	/* faq */
	.faq-g {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
		gap: 48px;
		align-items: start;
	}

	.faq-g .sec-cab {
		position: sticky;
		top: 96px;
	}

	/* cta final */
	.cta {
		margin-top: 96px;
		background: var(--verde);
		color: var(--creme);
		border-radius: 32px;
		padding: 44px;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 40px;
		align-items: center;
		overflow: hidden;
		position: relative;
	}

	.cta::after {
		content: '';
		position: absolute;
		right: -80px;
		bottom: -120px;
		width: 460px;
		height: 240px;
		border-radius: 50%;
		border: 30px solid #ffffff0a;
		pointer-events: none;
	}

	.cta h2 {
		font-size: clamp(30px, 3.6vw, 46px);
		font-weight: 850;
	}

	.cta p {
		color: var(--verde-texto);
		font-size: 18px;
		margin: 12px 0 26px;
		font-weight: 600;
		max-width: 42ch;
	}

	.cta .acoes {
		justify-content: flex-start;
		margin: 0;
		position: relative;
		z-index: 1;
	}

	.cta .btn-linha {
		color: var(--creme);
		box-shadow: inset 0 0 0 2px #ffffff2e;
	}

	.cta .btn-linha:hover {
		box-shadow: inset 0 0 0 2px var(--salvia);
	}

	.cta-cena {
		transform: scale(1.25);
		transform-origin: 0 50%;
		margin-right: 60px;
	}

	/* footer */
	.rodape {
		padding: 56px 0 40px;
	}

	.rodape-in {
		display: flex;
		align-items: center;
		gap: 24px;
		flex-wrap: wrap;
		border-top: 1.5px solid var(--linha);
		padding-top: 28px;
	}

	.rodape img {
		height: 28px;
		width: auto;
	}

	.ano {
		font-size: 14px;
		font-weight: 700;
		color: var(--tinta-suave);
	}

	.rodape nav {
		display: flex;
		gap: 18px;
		margin-left: auto;
		flex-wrap: wrap;
	}

	.rodape nav a {
		font-size: 14px;
		font-weight: 700;
		color: var(--tinta-suave);
		text-decoration: none;
	}

	.rodape nav a:hover {
		color: var(--verde);
		text-decoration: underline;
	}

	@media (max-width: 1080px) {
		.integ {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 760px) {
		.topo nav {
			display: none;
		}

		.topo-in {
			justify-content: space-between;
			gap: 12px;
			height: 58px;
		}

		.marca img {
			height: 28px;
		}

		.hero {
			padding: 44px 0 30px;
		}

		.selo {
			font-size: 13px;
			gap: 8px;
			margin-bottom: 20px;
		}

		.selo .extra {
			display: none;
		}

		.lead {
			margin-top: 24px;
		}

		.acoes .btn-g {
			flex: 1 1 220px;
		}

		.integ {
			grid-template-columns: 1fr;
		}

		.faq-g {
			grid-template-columns: 1fr;
			gap: 8px;
		}

		.faq-g .sec-cab {
			position: static;
		}

		.cta {
			grid-template-columns: 1fr;
			padding: 30px 22px 32px;
			gap: 12px;
			margin-top: 72px;
			border-radius: 24px;
		}

		.cta-cena {
			transform: none;
			margin: 0 0 0 -8px;
		}

		.cta .acoes .btn-g {
			flex: 1 1 200px;
		}

		.rodape nav {
			margin-left: 0;
			width: 100%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(html) {
			scroll-behavior: auto;
		}
	}

	@media (prefers-reduced-motion: no-preference) {
		:global(html:has(.lp)) {
			scroll-behavior: smooth;
		}
	}

	:global(html:has(.lp)) {
		scroll-padding-top: 76px;
	}
</style>
