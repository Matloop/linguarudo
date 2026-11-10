<!-- Seis cards com mini telas animadas. As animações esperam o card entrar na tela. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import icone from '#lib/assets/icone.png';

	let grade: HTMLDivElement;
	let pronto = $state(false);

	onMount(() => {
		pronto = true;
		const cards = [...grade.querySelectorAll<HTMLElement>('.card')];
		const io = new IntersectionObserver(
			(es) =>
				es.forEach((e) => {
					if (!e.isIntersecting) return;
					e.target.classList.add('visto');
					io.unobserve(e.target);
				}),
			{ threshold: 0.35 }
		);
		const repete = (e: Event) => {
			const c = e.currentTarget as HTMLElement;
			if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
			if (!c.classList.contains('visto')) return;
			c.getAnimations({ subtree: true }).forEach((a) => {
				if (a.playState === 'finished') {
					a.cancel();
					a.play();
				}
			});
		};
		for (const c of cards) {
			io.observe(c);
			c.addEventListener('mouseenter', repete);
		}
		return () => {
			io.disconnect();
			for (const c of cards) c.removeEventListener('mouseenter', repete);
		};
	});
</script>

<div class="grade" class:pronto bind:this={grade}>
	<article class="card">
		<div class="tela t1" aria-hidden="true">
			<div class="t-cab"><img src={icone} alt="" />Minhas palavras<span>342</span></div>
			<ul>
				<li class="an">
					<b>window</b><em>janela</em><span class="tg">EN</span><span class="orig"
						><svg class="ic"><use href="#i-filme" /></svg>filme</span
					>
				</li>
				<li class="an">
					<b>pioggia</b><em>chuva</em><span class="tg it">IT</span><span class="orig"
						><svg class="ic"><use href="#i-musica" /></svg>música</span
					>
				</li>
				<li class="an">
					<b>basket</b><em>cesta</em><span class="tg">EN</span><span class="orig"
						><svg class="ic"><use href="#i-livro" /></svg>livro</span
					>
				</li>
				<li class="an">
					<b>tardi</b><em>tarde</em><span class="tg it">IT</span><span class="orig"
						><svg class="ic"><use href="#i-plugin" /></svg>Stremio</span
					>
				</li>
			</ul>
		</div>
		<h3>Seu banco de palavras</h3>
		<p>
			Cada palavra fica guardada com a frase e o lugar onde apareceu. Inglês e italiano no mesmo
			lugar, separados por etiqueta.
		</p>
	</article>

	<article class="card">
		<div class="tela t2" aria-hidden="true">
			<div class="fc">
				<div class="fc-in an">
					<div class="fc-f"><small>EN · do filme</small><b>kitchen</b></div>
					<div class="fc-v"><b>cozinha</b><small>/ˈkɪtʃ.ɪn/ · substantivo</small></div>
				</div>
			</div>
			<div class="notas">
				<span class="n1">De novo<small>10 min</small></span>
				<span class="bom an">Bom<small class="an">3 dias</small></span>
				<span>Fácil<small>8 dias</small></span>
			</div>
		</div>
		<h3>Revisão na hora certa</h3>
		<p>
			O algoritmo FSRS calcula quando você está perto de esquecer cada palavra. Ela volta nesse dia.
		</p>
	</article>

	<article class="card">
		<div class="tela t3" aria-hidden="true">
			<div class="ceu"></div>
			<div class="predio" style="left:8%;width:22%;height:46%"></div>
			<div class="predio" style="left:34%;width:16%;height:62%"></div>
			<div class="predio" style="right:6%;width:26%;height:52%"></div>
			<span class="tagS"><svg class="ic"><use href="#i-plugin" /></svg>STREMIO</span>
			<div class="mini-ct an">
				<b>tardi</b> <span class="tg it">IT</span>
				<p>tarde, atrasado</p>
				<span class="mini-salvar">+ Salvar</span>
			</div>
			<div class="leg"><span>Ele sempre chega <u class="an">tardi</u> no jantar.</span></div>
			<svg class="cursor an" style="--cx:168px;--cy:166px" viewBox="0 0 18 24"
				><path
					d="M2 2l13 12-6 .8 3.6 7-2.6 1.2-3.4-7L2 20z"
					fill="#fff"
					stroke="#073026"
					stroke-width="1.4"
					stroke-linejoin="round"
				/></svg
			>
		</div>
		<h3>Legenda que ensina</h3>
		<p>
			Com o plugin do Stremio, a legenda fica clicável. Toque numa palavra, veja a tradução e salve.
		</p>
	</article>

	<article class="card">
		<div class="tela t4" aria-hidden="true">
			<div class="leg4">
				<span style="--c:var(--azul)"><i></i>quem</span><span style="--c:var(--salvia)"
					><i></i>ação</span
				><span style="--c:var(--coral)"><i></i>o quê</span><span style="--c:var(--ouro)"
					><i></i>quando</span
				>
			</div>
			<div class="frase-m">
				<span class="pc an" style="--c:var(--azul)">We</span><span
					class="pc an"
					style="--c:var(--salvia)">have</span
				><span class="pc an" style="--c:var(--coral)">a meeting</span><span
					class="pc an"
					style="--c:var(--ouro)">tomorrow</span
				>
			</div>
			<p class="pt">Nós temos uma reunião amanhã.</p>
			<span class="ok4 an"><svg class="ic"><use href="#i-ok" /></svg>Frase montada</span>
		</div>
		<h3>Aulas curtas</h3>
		<p>Uns cinco minutos, uma ideia por vez. As cores mostram quem faz, o que faz e quando.</p>
	</article>

	<article class="card">
		<div class="tela t5" aria-hidden="true">
			<div class="combo cmb">
				<svg viewBox="0 0 50 50"
					><circle cx="25" cy="25" r="21" stroke="#ffffff1c" /><circle
						class="arcM an"
						cx="25"
						cy="25"
						r="21"
						stroke="#B5DDAA"
						pathLength="100"
						stroke-dasharray="100 100"
					/></svg
				><span>×3</span>
			</div>
			<span class="mais5 an">+300</span>
			<p class="l-ant">La pioggia balla sul tetto</p>
			<p class="l-at">E <mark class="an">sento</mark> la tua voce</p>
			<p class="l-pt">E ouço sua voz</p>
		</div>
		<h3>Música</h3>
		<p>Complete a letra enquanto a música toca. Acertou de primeira, o combo sobe.</p>
	</article>

	<article class="card">
		<div class="tela t6" aria-hidden="true">
			<div class="t-cab">
				<svg class="ic"><use href="#i-cadeado" /></svg>Sua conta
			</div>
			<ul class="csv">
				<li class="an"><svg class="ic"><use href="#i-ok" /></svg>sem anúncio</li>
				<li class="an"><svg class="ic"><use href="#i-ok" /></svg>seus dados não são vendidos</li>
				<li class="an"><svg class="ic"><use href="#i-ok" /></svg>sem sequência pra manter</li>
				<li class="an"><svg class="ic"><use href="#i-ok" /></svg>sem vidas pra perder</li>
			</ul>
		</div>
		<h3>Sem anúncio, sem pressão</h3>
		<p>
			Seu banco fica na sua conta. Não mostramos anúncio, não vendemos seus dados e ninguém te cobra
			sequência.
		</p>
	</article>
</div>

<style>
	.grade {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
	}

	.card {
		background: var(--papel);
		border: 1.5px solid var(--linha);
		border-radius: 26px;
		padding: 12px 12px 22px;
		display: flex;
		flex-direction: column;
		transition:
			border-color 0.2s,
			transform 0.2s;
	}

	.card:hover {
		border-color: #d5c7aa;
		transform: translateY(-2px);
	}

	.card h3 {
		font-size: 21px;
		color: var(--verde);
		margin: 18px 10px 6px;
	}

	.card > p {
		color: var(--tinta-suave);
		font-size: 16px;
		margin: 0 10px;
		font-weight: 550;
	}

	.tela {
		height: 220px;
		border-radius: 18px;
		position: relative;
		overflow: hidden;
		padding: 16px;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.pronto .card:not(:global(.visto)) .an {
		animation-play-state: paused;
	}

	.t-cab {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 800;
		margin-bottom: 10px;
	}

	.t-cab img {
		width: 22px;
		height: 22px;
		border-radius: 6px;
	}

	.t-cab span {
		margin-left: auto;
		font-weight: 700;
		opacity: 0.7;
	}

	/* 1 banco */
	.t1 {
		background: var(--salvia-claro);
	}

	.t1 ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.t1 li {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #fff;
		border-radius: 10px;
		padding: 7px 10px;
		font-size: 14px;
		box-shadow: 0 1px 0 #0c40331a;
		animation: desliza 0.4s both;
	}

	.t1 li:nth-child(2) {
		animation-delay: 0.15s;
	}

	.t1 li:nth-child(3) {
		animation-delay: 0.3s;
	}

	.t1 li:nth-child(4) {
		animation-delay: 0.45s;
	}

	@keyframes desliza {
		from {
			opacity: 0;
			transform: translateX(-16px);
		}
	}

	.t1 li b {
		color: var(--verde);
	}

	.t1 li em {
		font-style: normal;
		color: var(--tinta-suave);
	}

	.t1 .orig {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		font-weight: 700;
		color: var(--tinta-suave);
	}

	.t1 .orig .ic {
		width: 14px;
		height: 14px;
	}

	/* 2 revisão */
	.t2 {
		background: var(--creme-escuro);
		align-items: center;
		gap: 14px;
		perspective: 700px;
	}

	.fc {
		width: 190px;
		height: 104px;
		position: relative;
	}

	.fc-in {
		position: absolute;
		inset: 0;
		transform-style: preserve-3d;
		animation: vira 0.7s 1s both cubic-bezier(0.4, 1.3, 0.5, 1);
	}

	@keyframes vira {
		to {
			transform: rotateY(180deg);
		}
	}

	.fc-f,
	.fc-v {
		position: absolute;
		inset: 0;
		backface-visibility: hidden;
		border-radius: 14px;
		background: #fff;
		box-shadow: 0 3px 0 #e3d3b2;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.fc-f b {
		font-size: 26px;
		color: var(--verde);
	}

	.fc-f small,
	.fc-v small {
		font-size: 12px;
		color: var(--tinta-suave);
		font-weight: 700;
	}

	.fc-v {
		transform: rotateY(180deg);
	}

	.fc-v b {
		font-size: 22px;
		color: var(--verde);
	}

	.notas {
		display: flex;
		gap: 6px;
	}

	.notas span {
		background: #fff;
		border-radius: 10px;
		padding: 5px 10px;
		font-size: 13px;
		font-weight: 800;
		text-align: center;
		color: var(--verde);
		box-shadow: 0 2px 0 #e3d3b2;
	}

	.notas small {
		display: block;
		font-size: 11px;
		color: var(--tinta-suave);
		font-weight: 700;
	}

	.notas .n1 {
		color: #a53b3b;
	}

	.notas .bom {
		animation: escolhe 0.35s 2s both;
	}

	@keyframes escolhe {
		to {
			background: var(--verde);
			color: var(--creme);
			box-shadow: 0 2px 0 var(--verde-escuro);
		}
	}

	.notas .bom small {
		animation: escolhe2 0.35s 2s both;
	}

	@keyframes escolhe2 {
		to {
			color: var(--verde-texto);
		}
	}

	/* 3 stremio */
	.t3 {
		background: #101b17;
		padding: 0;
	}

	.ceu {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(circle at 75% 25%, #e0a45855 0 12%, transparent 13%),
			linear-gradient(#2b3e57, #1a2a33 70%);
	}

	.predio {
		position: absolute;
		bottom: 0;
		background: #0f2a2a;
		border-radius: 4px 4px 0 0;
	}

	.tagS {
		position: absolute;
		left: 12px;
		top: 12px;
		font-size: 11px;
		font-weight: 850;
		letter-spacing: 0.06em;
		background: #ffffff1f;
		color: #fff;
		border-radius: 6px;
		padding: 3px 7px;
		display: flex;
		gap: 5px;
		align-items: center;
	}

	.tagS .ic {
		width: 13px;
		height: 13px;
	}

	.leg {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 22px;
		text-align: center;
	}

	.leg span {
		background: #000b;
		color: #fff;
		font-weight: 700;
		font-size: 15px;
		padding: 3px 10px;
		border-radius: 6px;
	}

	.leg u {
		text-decoration: underline 2px var(--coral);
		text-underline-offset: 3px;
		border-radius: 4px;
		animation: marca 0.2s 1.2s both;
	}

	@keyframes marca {
		to {
			background: #f07c7c55;
		}
	}

	.cursor {
		position: absolute;
		left: 0;
		top: 0;
		width: 18px;
		animation: aponta 1s 0.2s both cubic-bezier(0.3, 0.9, 0.4, 1);
	}

	@keyframes aponta {
		from {
			transform: translate(250px, 200px);
		}
		to {
			transform: translate(var(--cx), var(--cy));
		}
	}

	.mini-ct {
		position: absolute;
		left: 50%;
		bottom: 62px;
		translate: -50% 0;
		background: var(--creme);
		color: var(--verde-escuro);
		border-radius: 12px;
		padding: 8px 12px;
		width: 180px;
		box-shadow: 0 10px 24px #0008;
		animation: surgeM 0.3s 1.35s both;
	}

	@keyframes surgeM {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.9);
		}
	}

	.mini-ct b {
		font-size: 17px;
		color: var(--verde);
	}

	.mini-ct p {
		margin: 0;
		font-size: 13px;
		color: var(--tinta-suave);
	}

	.mini-salvar {
		display: inline-block;
		margin-top: 6px;
		background: var(--coral);
		border-radius: 8px;
		padding: 3px 9px;
		font-size: 12px;
		font-weight: 850;
	}

	/* 4 aulas */
	.t4 {
		background: #e4ecf5;
		gap: 14px;
	}

	.leg4 {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		font-size: 12px;
		font-weight: 700;
		color: var(--tinta-suave);
	}

	.leg4 i {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 3px;
		margin-right: 4px;
		background: var(--c);
	}

	.frase-m {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		min-height: 46px;
		border-bottom: 2px solid #c8d5e4;
		padding-bottom: 8px;
	}

	.pc {
		border-radius: 10px;
		padding: 5px 9px;
		font-weight: 850;
		font-size: 15px;
		background: var(--c);
		color: var(--verde-escuro);
		animation: cai 0.35s both cubic-bezier(0.3, 1.5, 0.5, 1);
	}

	.pc:nth-child(1) {
		animation-delay: 0.3s;
	}

	.pc:nth-child(2) {
		animation-delay: 0.55s;
	}

	.pc:nth-child(3) {
		animation-delay: 0.8s;
	}

	.pc:nth-child(4) {
		animation-delay: 1.05s;
	}

	@keyframes cai {
		from {
			opacity: 0;
			transform: translateY(-22px) rotate(-4deg);
		}
	}

	.pt {
		font-size: 14px;
		color: var(--tinta-suave);
		font-weight: 650;
	}

	.ok4 {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 800;
		color: var(--verde);
		animation: surgeM 0.3s 1.5s both;
	}

	/* 5 música */
	.t5 {
		background: var(--verde);
		color: var(--creme);
		align-items: center;
		text-align: center;
		gap: 10px;
	}

	.l-ant {
		color: #ffffff55;
		font-weight: 700;
		font-size: 14px;
	}

	.l-at {
		font-size: 20px;
		font-weight: 800;
	}

	.l-at mark {
		background: none;
		color: #b5ddaa;
		display: inline-block;
		animation: pega 0.4s 0.9s both;
	}

	@keyframes pega {
		0% {
			transform: scale(0.5);
		}
		60% {
			transform: scale(1.12);
		}
	}

	.l-pt {
		color: var(--verde-texto);
		font-size: 13px;
		font-weight: 600;
	}

	.combo {
		position: absolute;
		right: 14px;
		top: 14px;
		width: 50px;
		height: 50px;
		display: grid;
		place-items: center;
		font-weight: 900;
		font-size: 16px;
	}

	.combo svg {
		position: absolute;
		inset: 0;
		transform: rotate(-90deg);
	}

	.combo circle {
		fill: none;
		stroke-width: 4;
		stroke-linecap: round;
	}

	.arcM {
		animation: enche 1.2s 0.5s both;
	}

	@keyframes enche {
		from {
			stroke-dasharray: 0 100;
		}
	}

	.mais5 {
		position: absolute;
		right: 20px;
		top: 66px;
		font-weight: 900;
		color: #b5ddaa;
		font-size: 14px;
		animation: surgeM 0.3s 1.2s both;
	}

	/* 6 sua conta */
	.t6 {
		background: #fff;
		border: 1.5px solid var(--linha);
		gap: 10px;
	}

	.csv {
		font: 600 14px/1.9 var(--fonte);
		background: var(--papel);
		border-radius: 10px;
		padding: 10px 12px;
		margin: 0;
		list-style: none;
		color: var(--verde-escuro);
		border: 1px solid var(--linha);
	}

	.csv li {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		animation: desliza 0.3s both;
	}

	.csv .ic {
		width: 15px;
		height: 15px;
		margin-right: 6px;
		vertical-align: -2px;
		color: var(--salvia);
	}

	.csv li:nth-child(2) {
		animation-delay: 0.2s;
	}

	.csv li:nth-child(3) {
		animation-delay: 0.4s;
	}

	.csv li:nth-child(4) {
		animation-delay: 0.6s;
	}

	@media (max-width: 1080px) {
		.grade {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 760px) {
		.grade {
			grid-template-columns: 1fr;
		}

		.tela {
			height: 210px;
		}
	}
</style>
