<!--
	Prévia interativa da landing: Filme, Música e Leitura com palavras clicáveis
	e um "Seu banco" local. Nada sai do navegador.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import mascote from '#lib/assets/mascote.png';
	import CenaFilme from './CenaFilme.svelte';
	import CenaMosca from './CenaMosca.svelte';
	import { DICIONARIO, FILME, LIVRO, MUSICA, ORIGEM } from './conteudo.ts';
	import {
		adicionar,
		jogoNovo,
		nPalavras,
		partes,
		responder,
		temNoBanco,
		COMBO_MAX,
		type ItemBanco,
		type Lingua,
		type Origem
	} from './jogo.ts';

	type Aba = 'filme' | 'musica' | 'leitura';
	const ABAS: { id: Aba; nome: string; icone: string }[] = [
		{ id: 'filme', nome: 'Filme', icone: 'i-filme' },
		{ id: 'musica', nome: 'Música', icone: 'i-musica' },
		{ id: 'leitura', nome: 'Leitura', icone: 'i-livro' }
	];
	const CORES = ['#7FA886', '#F07C7C', '#E0A458', '#6C8EBF'];

	let L = $state<Lingua>('en');
	let aba = $state<Aba>('filme');
	let banco = $state<ItemBanco[]>([]);
	let ultimo = $state('');
	let gaveta = $state(false);
	let trocando = $state(false);

	// filme
	let fala = $state(0);

	// música
	let jogo = $state(jogoNovo());
	let errados = $state<string[]>([]);
	let aviso = $state('');
	const musica = $derived(MUSICA[L]);

	// cartão de palavra
	type Aberto = { w: string; l: Lingua; o: Origem; x: number; y: number };
	let cartao = $state<Aberto | null>(null);
	let pegando = $state('');
	const verbete = $derived(cartao ? DICIONARIO[cartao.l][cartao.w] : null);
	const salvo = $derived(cartao ? temNoBanco(banco, cartao.w, cartao.l) : false);

	let palcoEl: HTMLDivElement;
	let cartaoEl = $state<HTMLDivElement>();
	let salvarEl = $state<HTMLButtonElement>();
	let rudoEl: HTMLImageElement;
	let comboEl = $state<HTMLDivElement>();
	let qtdEls: HTMLElement[] = [];
	const abaEls: HTMLButtonElement[] = [];
	let alvo: HTMLButtonElement | null = null;

	const calmo = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const desk = () => matchMedia('(min-width: 960px)').matches;
	const tem = (w: string) => temNoBanco(banco, w, L);

	/** Reinicia uma animação CSS presa a uma classe. */
	function repete(el: Element | undefined, classe: string) {
		if (!el) return;
		el.classList.remove(classe);
		void (el as HTMLElement).offsetWidth;
		el.classList.add(classe);
	}

	async function abre(btn: HTMLButtonElement, w: string, o: Origem) {
		if (!DICIONARIO[L][w]) return;
		alvo = btn;
		cartao = { w, l: L, o, x: 8, y: 8 };
		await tick();
		if (!cartaoEl) return;
		const P = palcoEl.getBoundingClientRect();
		const r = btn.getBoundingClientRect();
		const cw = cartaoEl.offsetWidth;
		const ch = cartaoEl.offsetHeight;
		let x = r.left - P.left + r.width / 2 - cw / 2;
		let y = r.bottom - P.top + 10;
		x = Math.max(8, Math.min(x, P.width - cw - 8));
		if (y + ch > P.height - 8) y = r.top - P.top - ch - 10;
		y = Math.max(8, y);
		cartao.x = x;
		cartao.y = y;
		repete(cartaoEl, 'surge');
		salvarEl?.focus({ preventScroll: true });
	}

	function fecha(volta = false) {
		if (!cartao) return;
		cartao = null;
		if (volta && alvo?.isConnected) alvo.focus({ preventScroll: true });
	}

	function ouve() {
		if (!cartao || !('speechSynthesis' in window)) return;
		speechSynthesis.cancel();
		const u = new SpeechSynthesisUtterance(cartao.w);
		u.lang = cartao.l === 'it' ? 'it-IT' : 'en-US';
		u.rate = 0.9;
		speechSynthesis.speak(u);
	}

	function salva() {
		if (!cartao || !verbete || salvo || !alvo) return;
		const item: ItemBanco = { w: cartao.w, l: cartao.l, tr: verbete.tr, o: cartao.o };
		const el = alvo;
		fecha();
		el.focus({ preventScroll: true });
		lambe(el, item.w, () => {
			banco = adicionar(banco, item);
			ultimo = item.l + item.w;
			for (const q of qtdEls) repete(q, 'sobe');
		});
	}

	function boca() {
		const r = rudoEl.getBoundingClientRect();
		return { x: r.left + r.width * (desk() ? 0.21 : 0.79), y: r.top + r.height * 0.56 };
	}

	/** A língua do Rudo sai da boca, pega a palavra e volta com ela. */
	async function lambe(el: HTMLElement, w: string, depois: () => void) {
		if (calmo() || !el.animate) return depois();
		const b = boca();
		const a = el.getBoundingClientRect();
		const tx = a.left + a.width / 2;
		const ty = a.top + a.height / 2;
		const d = Math.hypot(tx - b.x, ty - b.y);
		const ang = Math.atan2(ty - b.y, tx - b.x);

		const lng = document.createElement('i');
		lng.className = 'voo-lng';
		lng.style.transform = `translate(${b.x}px,${b.y - 4.5}px) rotate(${ang}rad)`;
		document.body.append(lng);
		await lng.animate([{ width: '0px' }, { width: d + 'px' }], {
			duration: Math.min(320, 160 + d * 0.25),
			easing: 'cubic-bezier(.2,.8,.4,1)',
			fill: 'forwards'
		}).finished;

		const chip = document.createElement('span');
		chip.className = 'voo-chip';
		chip.textContent = w;
		document.body.append(chip);
		const cw = chip.offsetWidth;
		const ch = chip.offsetHeight;
		pegando = w;
		await Promise.all([
			lng.animate([{ width: d + 'px' }, { width: '0px' }], {
				duration: 300,
				easing: 'ease-in',
				fill: 'forwards'
			}).finished,
			chip.animate(
				[
					{ transform: `translate(${tx - cw / 2}px,${ty - ch / 2}px) scale(1)` },
					{ transform: `translate(${b.x - cw / 2}px,${b.y - ch / 2}px) scale(.25)`, opacity: 0.5 }
				],
				{ duration: 300, easing: 'ease-in', fill: 'forwards' }
			).finished
		]);
		lng.remove();
		chip.remove();
		repete(rudoEl, 'engole');
		depois();
		pegando = '';
	}

	// ---------- filme ----------
	function vaiFala(n: number) {
		fecha();
		fala = Math.max(0, Math.min(FILME.falas.length - 1, n));
	}

	// ---------- música ----------
	function escolhe(btn: HTMLButtonElement, opcao: string) {
		const r = responder(jogo, musica.linhas, opcao);
		if (!r.certo) {
			if (jogo.i >= musica.linhas.length) return;
			jogo = r.jogo;
			errados = [...errados, opcao];
			aviso = `“${opcao}” não é. Tente outra.`;
			return;
		}
		const pos = btn.getBoundingClientRect();
		const mais = document.createElement('span');
		mais.className = 'voo-mais';
		mais.textContent = '+' + r.ganho;
		mais.style.left = pos.left + pos.width / 2 - 16 + 'px';
		mais.style.top = pos.top - 8 + 'px';
		document.body.append(mais);
		setTimeout(() => mais.remove(), 900);
		if (r.jogo.combo > jogo.combo) repete(comboEl, 'sobe');
		jogo = r.jogo;
		errados = [];
		aviso = '';
	}

	function recomeca() {
		jogo = jogoNovo();
		errados = [];
		aviso = '';
	}

	const infoMusica = $derived(
		aviso ||
			(jogo.i >= musica.linhas.length
				? 'Todas as lacunas feitas'
				: `Lacuna ${jogo.i + 1} de ${musica.linhas.length}`)
	);

	// ---------- abas ----------
	function vaiAba(i: number, foco = false) {
		const n = (i + ABAS.length) % ABAS.length;
		fecha();
		aba = ABAS[n].id;
		if (foco) abaEls[n]?.focus();
	}

	function teclaAba(e: KeyboardEvent, i: number) {
		const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ABAS.length - 1 }[e.key];
		if (k === undefined) return;
		e.preventDefault();
		vaiAba(k, true);
	}

	// ---------- EN / IT ----------
	function trocaLingua(l: Lingua) {
		if (l === L || trocando) return;
		fecha();
		recomeca();
		if (calmo()) {
			L = l;
			return;
		}
		trocaPara = l;
		trocando = true;
		setTimeout(() => {
			L = l;
			trocando = false;
		}, 700);
	}
	let trocaPara = $state<Lingua>('it');

	// ---------- teclado e clique fora ----------
	function teclaDoc(e: KeyboardEvent) {
		if (e.key === 'Escape' && cartao) return fecha(true);
		if (aba !== 'musica' || !'1234'.includes(e.key) || e.key.length !== 1) return;
		if ((e.target as HTMLElement).matches?.('input,textarea,select')) return;
		const linha = musica.linhas[jogo.i];
		const opcao = linha?.ops[Number(e.key) - 1];
		if (!opcao || errados.includes(opcao)) return;
		const btn = document.querySelector<HTMLButtonElement>(`.ops [data-op="${opcao}"]`);
		if (btn) escolhe(btn, opcao);
	}

	function cliqueDoc(e: MouseEvent) {
		if (!cartao) return;
		const t = e.target as HTMLElement;
		if (cartaoEl?.contains(t) || t.closest?.('.pal')) return;
		fecha();
	}
</script>

<svelte:document onkeydown={teclaDoc} onclick={cliqueDoc} />

{#snippet pal(w: string, o: Origem, nota?: 'ok' | 'quase')}
	<button
		type="button"
		class="pal"
		class:salva={tem(w) || pegando === w}
		class:pegou={pegando === w}
		class:aberta={cartao?.w === w && cartao.o === o}
		class:ok={nota === 'ok'}
		class:quase={nota === 'quase'}
		lang={L}
		aria-haspopup="dialog"
		onclick={(e) => abre(e.currentTarget, w, o)}>{w}</button
	>
{/snippet}

{#snippet texto(modelo: string, palavras: readonly string[], o: Origem)}
	{#each partes(modelo, palavras) as p, k (k)}{#if 'texto' in p}{p.texto}{:else}{@render pal(
				p.palavra,
				o
			)}{/if}{/each}
{/snippet}

<div class="previa escuro">
	<div class="pv-topo">
		<h2 class="pv-tit" id="pvTit">
			<span class="dedo" aria-hidden="true"></span>Toque numa palavra sublinhada
		</h2>
		<div class="abas" role="tablist" aria-label="Tipo de conteúdo">
			{#each ABAS as a, i (a.id)}
				<button
					type="button"
					role="tab"
					id="tab-{a.id}"
					aria-controls="pn-{a.id}"
					aria-selected={aba === a.id}
					tabindex={aba === a.id ? 0 : -1}
					bind:this={abaEls[i]}
					onclick={() => vaiAba(i)}
					onkeydown={(e) => teclaAba(e, i)}
				>
					<svg class="ic"><use href="#{a.icone}" /></svg>{a.nome}
				</button>
			{/each}
		</div>
		<div class="lingua-sel" role="group" aria-label="Língua que você estuda">
			<button
				type="button"
				aria-pressed={L === 'en'}
				title="Inglês"
				onclick={() => trocaLingua('en')}
			>
				EN<span class="visually-hidden"> (inglês)</span>
			</button>
			<button
				type="button"
				aria-pressed={L === 'it'}
				title="Italiano"
				onclick={() => trocaLingua('it')}
			>
				IT<span class="visually-hidden"> (italiano)</span>
			</button>
		</div>
	</div>

	<div class="pv-corpo">
		<div class="palco" bind:this={palcoEl}>
			<!-- Filme -->
			<div
				class="pn"
				role="tabpanel"
				id="pn-filme"
				aria-labelledby="tab-filme"
				hidden={aba !== 'filme'}
			>
				<div class="quadro">
					<CenaFilme />
					<span class="f-titulo">A chave · ep. 1</span>
					<span class="f-tag">cena de exemplo</span>
					<div class="legenda">
						<p aria-live="polite">{@render texto(FILME.falas[fala], FILME[L], 'filme')}</p>
					</div>
				</div>
				<div class="f-ctrl">
					<button
						type="button"
						class="cb"
						aria-label="Fala anterior"
						disabled={fala === 0}
						onclick={() => vaiFala(fala - 1)}
					>
						<svg class="ic"><use href="#i-ant" /></svg>
					</button>
					<button
						type="button"
						class="cb"
						aria-label="Próxima fala"
						disabled={fala === FILME.falas.length - 1}
						onclick={() => vaiFala(fala + 1)}
					>
						<svg class="ic"><use href="#i-prox" /></svg>
					</button>
					<span class="conta">Fala {fala + 1} de {FILME.falas.length}</span>
					<svg class="onda" viewBox="0 0 300 22" preserveAspectRatio="none" aria-hidden="true">
						<path class="fundo" d="M6 13 Q 43 4 80 12 T 155 12 T 230 10 T 294 9" pathLength="100" />
						<path
							class="cheia"
							d="M6 13 Q 43 4 80 12 T 155 12 T 230 10 T 294 9"
							pathLength="100"
							style:stroke-dashoffset={100 - Math.round(((fala + 1) / FILME.falas.length) * 100)}
						/>
					</svg>
				</div>
			</div>

			<!-- Música -->
			<div
				class="pn"
				role="tabpanel"
				id="pn-musica"
				aria-labelledby="tab-musica"
				hidden={aba !== 'musica'}
			>
				<div class="musica">
					<div class="m-cab">
						<div class="m-capa" aria-hidden="true"></div>
						<div class="m-txt">
							<b>{musica.titulo}</b><small>Rudo &amp; as Moscas · música de exemplo</small>
						</div>
						<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
						<span class="pontos" aria-label="Pontos">{String(jogo.pontos).padStart(4, '0')}</span>
						<div class="combo" bind:this={comboEl} aria-label="Combo ×{jogo.combo}">
							<svg viewBox="0 0 50 50" aria-hidden="true">
								<circle cx="25" cy="25" r="21" stroke="#ffffff1c" />
								<circle
									class="arco"
									cx="25"
									cy="25"
									r="21"
									stroke="#B5DDAA"
									pathLength="100"
									stroke-dasharray="{((jogo.combo - 1) / (COMBO_MAX - 1)) * 100} 100"
								/>
							</svg>
							<span aria-hidden="true">×{jogo.combo}</span>
						</div>
					</div>
					<div class="letra">
						{#each musica.linhas as l, k (l.r)}
							<p class="lin" class:atual={k === jogo.i} lang={L}>
								{#each partes(l.t, []) as p, j (j)}{#if 'texto' in p}{p.texto}{:else if jogo.feitas[k]}{@render pal(
											l.r,
											'musica',
											jogo.feitas[k]
										)}{:else}<span class="gap" aria-label="lacuna">&nbsp;</span>{/if}{/each}
								<span class="tr" lang="pt-BR">{l.pt}</span>
							</p>
						{/each}
					</div>
					{#if jogo.i >= musica.linhas.length}
						<div class="m-fim">
							<b>Música fechada · {jogo.pontos} pontos</b>
							<span>Toque nas palavras que você acertou para salvar.</span>
							<button type="button" class="btn-fino" onclick={recomeca}>Tocar de novo</button>
						</div>
					{:else}
						<div class="ops" role="group" aria-label="Opções para a lacuna">
							{#each musica.linhas[jogo.i].ops as op, k (op)}
								<button
									type="button"
									class="op"
									class:errou={errados.includes(op)}
									style:--c={CORES[k]}
									data-op={op}
									lang={L}
									disabled={errados.includes(op)}
									onclick={(e) => escolhe(e.currentTarget, op)}
								>
									<span class="k" aria-hidden="true">{k + 1}</span>{op}
								</button>
							{/each}
						</div>
					{/if}
					<div class="m-rod">
						<span aria-live="polite">{infoMusica}</span><span>Escolha a palavra que falta</span>
					</div>
				</div>
			</div>

			<!-- Leitura -->
			<div
				class="pn"
				role="tabpanel"
				id="pn-leitura"
				aria-labelledby="tab-leitura"
				hidden={aba !== 'leitura'}
			>
				<div class="leitor">
					<article class="pagina" aria-label="Página de exemplo de um livro">
						<div class="pg-cab"><span>A feira</span><span>Cap. 3</span></div>
						<h3>III. Mais cedo que o sol</h3>
						{#each LIVRO.paragrafos as p, k (k)}
							<p>{@render texto(p, LIVRO[L], 'livro')}</p>
						{/each}
						<div class="pg-rod">
							<span>18%</span>
							<svg class="onda" viewBox="0 0 300 16" preserveAspectRatio="none" aria-hidden="true">
								<path
									class="fundo"
									d="M6 10 Q 43 3 80 9 T 155 9 T 230 7 T 294 7"
									pathLength="100"
								/>
								<path
									class="cheia"
									d="M6 10 Q 43 3 80 9 T 155 9 T 230 7 T 294 7"
									pathLength="100"
								/>
							</svg>
							<span>Página 47 de 212</span>
						</div>
					</article>
				</div>
			</div>

			{#if cartao && verbete}
				<div
					class="cartao"
					role="dialog"
					aria-labelledby="ctW"
					aria-describedby="ctTr"
					tabindex="-1"
					bind:this={cartaoEl}
					style:left="{cartao.x}px"
					style:top="{cartao.y}px"
				>
					<button type="button" class="ct-x" aria-label="Fechar cartão" onclick={() => fecha(true)}>
						<svg class="ic"><use href="#i-x" /></svg>
					</button>
					<div class="ct-meta">
						<span class="tg" class:it={cartao.l === 'it'}>{cartao.l.toUpperCase()}</span>
						<span>{verbete.classe}</span>
					</div>
					<p class="ct-w"><b id="ctW" lang={cartao.l}>{cartao.w}</b><span>{verbete.ipa}</span></p>
					<p class="ct-tr" id="ctTr">{verbete.tr}</p>
					<p class="ct-ex">
						<span lang={cartao.l}>{verbete.ex}</span><small>{verbete.exPt}</small>
					</p>
					<div class="ct-acoes">
						<button type="button" class="b-ouvir" onclick={ouve}>
							<svg class="ic"><use href="#i-som" /></svg>Ouvir
						</button>
						<button
							type="button"
							class="b-salvar"
							disabled={salvo}
							bind:this={salvarEl}
							onclick={salva}
						>
							<svg class="ic"><use href={salvo ? '#i-ok' : '#i-mais'} /></svg>
							<span>{salvo ? 'No banco' : 'Salvar'}</span>
						</button>
					</div>
				</div>
			{/if}

			{#if trocando}
				<div class="troca" role="status">
					<div class="troca-cena"><CenaMosca /></div>
					<p>Pegando palavras em {trocaPara === 'it' ? 'italiano' : 'inglês'}…</p>
				</div>
			{/if}
		</div>

		<aside class="banco" class:aberto={gaveta} aria-label="Seu banco de palavras">
			<img class="rudo" bind:this={rudoEl} src={mascote} alt="" width="372" height="352" />
			<div class="banco-cab">
				<h3>Seu banco</h3>
				<span class="qtd" bind:this={qtdEls[0]}>{nPalavras(banco.length)}</span>
			</div>
			<button
				type="button"
				class="gaveta-btn"
				aria-expanded={gaveta}
				aria-controls="gaveta"
				onclick={() => (gaveta = !gaveta)}
			>
				<span
					><b class="qtd-m" bind:this={qtdEls[1]}>{nPalavras(banco.length)}</b> no seu banco</span
				>
				<svg class="ic"><use href="#i-baixo" /></svg>
			</button>
			<div class="gaveta" id="gaveta">
				{#if banco.length === 0}
					<p class="vazio">Salve uma palavra e o Rudo traz pra cá.</p>
				{/if}
				<ul class="lista" aria-live="polite">
					{#each banco as b (b.l + b.w)}
						<li class:novo={ultimo === b.l + b.w}>
							<b lang={b.l}>{b.w}</b><em>{b.tr}</em>
							<span class="lado">
								<span class="tg" class:it={b.l === 'it'}>{b.l.toUpperCase()}</span>
								<span class="orig">
									<svg class="ic" aria-hidden="true"><use href="#{ORIGEM[b.o].icone}" /></svg
									>{ORIGEM[b.o].nome}
								</span>
							</span>
						</li>
					{/each}
				</ul>
			</div>
			<p class="banco-rod">Prévia: nada sai do seu navegador.</p>
		</aside>
	</div>
</div>

<style>
	.previa {
		background: var(--verde);
		color: var(--creme);
		border-radius: 32px;
		padding: 22px;
		position: relative;
	}

	.pv-topo {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
		margin-bottom: 18px;
	}

	.pv-tit {
		font-size: 16px;
		font-weight: 750;
		color: var(--verde-texto);
		letter-spacing: 0;
		margin-right: auto;
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.dedo {
		display: inline-block;
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--coral);
		box-shadow: 0 0 0 4px #f07c7c33;
		animation: pulsa 1.8s infinite;
	}

	@keyframes pulsa {
		50% {
			box-shadow: 0 0 0 8px #f07c7c00;
		}
	}

	.abas {
		display: flex;
		background: var(--verde-escuro);
		border-radius: 14px;
		padding: 4px;
		gap: 2px;
	}

	.abas button {
		border: 0;
		background: none;
		color: var(--verde-texto);
		font-weight: 800;
		font-size: 15px;
		padding: 8px 16px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.abas button .ic {
		width: 18px;
		height: 18px;
	}

	.abas button:hover {
		color: var(--creme);
	}

	.abas button[aria-selected='true'] {
		background: var(--creme);
		color: var(--verde);
	}

	.lingua-sel {
		display: flex;
		background: var(--verde-escuro);
		border-radius: 14px;
		padding: 4px;
	}

	.lingua-sel button {
		border: 0;
		background: none;
		color: var(--verde-texto);
		font-weight: 850;
		font-size: 14px;
		padding: 8px 13px;
		border-radius: 10px;
		letter-spacing: 0.04em;
	}

	.lingua-sel button[aria-pressed='true'] {
		background: var(--ouro);
		color: var(--verde-escuro);
	}

	.pv-corpo {
		display: grid;
		grid-template-columns: 1fr;
		gap: 18px;
	}

	.palco {
		position: relative;
		min-width: 0;
	}

	.pn[hidden] {
		display: none;
	}

	.pn {
		animation: entra 0.3s;
	}

	@keyframes entra {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	/* palavra clicável */
	.pal {
		border: 0;
		background: none;
		padding: 0 0.08em;
		margin: 0 -0.04em;
		font: inherit;
		color: inherit;
		border-radius: 5px;
		text-decoration: underline 2.5px var(--coral);
		text-underline-offset: 0.22em;
		transition: background 0.15s;
	}

	.pal:hover,
	.pal.aberta {
		background: #f07c7c40;
	}

	.pal.salva {
		text-decoration-color: var(--ouro);
		background: #e0a45833;
	}

	.pal.pegou {
		animation: pegou 0.3s;
	}

	@keyframes pegou {
		50% {
			transform: scale(0.85);
		}
	}

	/* filme */
	.quadro {
		position: relative;
		aspect-ratio: 16/9;
		border-radius: 20px;
		overflow: hidden;
		background: #16354a;
	}

	.f-tag {
		position: absolute;
		right: 12px;
		top: 12px;
		font-size: 12px;
		font-weight: 700;
		background: #0007;
		border-radius: 8px;
		padding: 3px 8px;
		color: #fff;
	}

	.f-titulo {
		position: absolute;
		left: 14px;
		top: 12px;
		font-size: 13px;
		font-weight: 700;
		color: #fff;
		text-shadow: 0 1px 4px #0008;
	}

	.legenda {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 7%;
		display: flex;
		justify-content: center;
		padding: 0 16px;
	}

	.legenda p {
		background: #000000b3;
		color: #fff;
		font-weight: 700;
		font-size: clamp(15px, 2.1vw, 24px);
		line-height: 1.45;
		padding: 4px 14px;
		border-radius: 8px;
		text-align: center;
		max-width: 92%;
	}

	.f-ctrl {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 12px;
	}

	.cb {
		border: 0;
		background: var(--verde-escuro);
		color: var(--creme);
		border-radius: 12px;
		height: 40px;
		min-width: 40px;
		display: grid;
		place-items: center;
		padding: 0 10px;
	}

	.cb:hover {
		background: var(--verde-medio);
	}

	.cb:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.conta {
		font-size: 14px;
		font-weight: 700;
		color: var(--verde-texto);
		white-space: nowrap;
	}

	/* música */
	.musica {
		background: var(--verde-escuro);
		border-radius: 20px;
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-height: 100%;
	}

	.m-cab {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.m-capa {
		width: 52px;
		height: 52px;
		border-radius: 12px;
		background: linear-gradient(135deg, var(--azul), #3d4f8a);
		position: relative;
		overflow: hidden;
		flex: none;
	}

	.m-capa::after {
		content: '';
		position: absolute;
		width: 70%;
		aspect-ratio: 1;
		border-radius: 50%;
		right: -25%;
		top: 15%;
		background: radial-gradient(circle, var(--creme) 0 10%, #111 11% 100%);
	}

	.m-txt {
		flex: 1;
		min-width: 0;
	}

	.m-txt b,
	.m-txt small {
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.m-txt b {
		font-size: 16px;
	}

	.m-txt small {
		color: var(--verde-texto);
		font-size: 13px;
		font-weight: 600;
	}

	.eq {
		display: flex;
		gap: 3px;
		align-items: flex-end;
		height: 16px;
		margin-right: 6px;
	}

	.eq i {
		width: 3px;
		background: var(--salvia);
		border-radius: 2px;
		animation: eq 0.9s ease-in-out infinite alternate;
	}

	.eq i:nth-child(2) {
		animation-delay: -0.3s;
	}

	.eq i:nth-child(3) {
		animation-delay: -0.6s;
	}

	@keyframes eq {
		from {
			height: 4px;
		}
		to {
			height: 16px;
		}
	}

	.pontos {
		font:
			800 18px/1 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		color: var(--creme);
		letter-spacing: 0.03em;
	}

	.combo {
		position: relative;
		width: 50px;
		height: 50px;
		display: grid;
		place-items: center;
		font-weight: 900;
		font-size: 16px;
		flex: none;
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

	.arco {
		transition: stroke-dasharray 0.4s;
	}

	.combo:global(.sobe) {
		animation: lp-sobe 0.4s;
	}

	.letra {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 6px;
		padding: 6px 4px;
		text-align: center;
		flex: 1;
	}

	.lin {
		font-size: clamp(17px, 1.9vw, 22px);
		font-weight: 750;
		color: #ffffff55;
		transition:
			color 0.3s,
			font-size 0.3s;
	}

	.lin.atual {
		color: var(--creme);
		font-size: clamp(21px, 2.6vw, 30px);
	}

	.tr {
		display: block;
		font-size: 14px;
		font-weight: 600;
		color: var(--verde-texto);
		margin-top: 2px;
	}

	.lin:not(.atual) .tr {
		display: none;
	}

	.gap {
		display: inline-block;
		min-width: 3.6em;
		border-bottom: 3px dashed currentColor;
		line-height: 1.05;
		opacity: 0.7;
	}

	.lin.atual .gap {
		opacity: 1;
		color: var(--coral);
		border-bottom-style: solid;
		animation: pisca 1s infinite;
	}

	@keyframes pisca {
		50% {
			border-color: transparent;
		}
	}

	.pal.ok {
		color: #b5ddaa;
		animation: pega 0.4s;
	}

	.pal.quase {
		color: #f5c98a;
		animation: pega 0.4s;
	}

	@keyframes pega {
		0% {
			transform: scale(0.5);
		}
		60% {
			transform: scale(1.12);
		}
	}

	.ops {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.op {
		position: relative;
		border: 0;
		background: var(--creme);
		color: var(--verde-escuro);
		border-radius: 14px;
		padding: 13px 12px 13px 48px;
		font-weight: 850;
		font-size: 18px;
		text-align: left;
		box-shadow: 0 4px 0 var(--c);
		transition: transform 0.08s;
	}

	.op .k {
		position: absolute;
		left: 12px;
		top: 50%;
		translate: 0 -50%;
		width: 26px;
		height: 26px;
		border-radius: 8px;
		background: var(--c);
		color: var(--verde-escuro);
		display: grid;
		place-items: center;
		font-size: 13px;
	}

	.op:active {
		transform: translateY(3px);
		box-shadow: 0 1px 0 var(--c);
	}

	.op:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.op.errou {
		animation: nao 0.35s;
		background: var(--coral-claro);
	}

	@keyframes nao {
		25%,
		75% {
			transform: translateX(-5px);
		}
		50% {
			transform: translateX(5px);
		}
	}

	.m-rod {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		font-size: 14px;
		color: var(--verde-texto);
		font-weight: 600;
		min-height: 22px;
	}

	.m-fim {
		display: grid;
		place-items: center;
		text-align: center;
		gap: 8px;
		padding: 10px;
		min-height: 118px;
	}

	.m-fim b {
		font-size: 22px;
	}

	.m-fim span {
		color: var(--verde-texto);
	}

	.btn-fino {
		border: 0;
		background: var(--creme);
		color: var(--verde);
		border-radius: 12px;
		padding: 9px 16px;
		font-weight: 800;
	}

	/* leitura */
	.leitor {
		background: #2a3a35;
		border-radius: 22px;
		padding: 14px;
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: 100%;
	}

	.pagina {
		background: #f7f3ea;
		color: #2b2b28;
		border-radius: 8px;
		width: 100%;
		max-width: 720px;
		padding: 26px clamp(20px, 5vw, 64px) 18px;
		font-family: var(--fonte-livro);
		box-shadow: inset 0 0 0 1px #0000000d;
	}

	.pg-cab {
		display: flex;
		justify-content: space-between;
		font: 600 12px/1 var(--fonte);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #8a867c;
		margin-bottom: 20px;
	}

	.pagina h3 {
		font: italic 400 15px/1.3 var(--fonte-livro);
		letter-spacing: 0;
		text-align: center;
		color: #6b675e;
		margin: 0 0 14px;
	}

	.pagina p {
		font-size: clamp(16px, 1.6vw, 19px);
		line-height: 1.68;
		text-align: justify;
		hyphens: auto;
		text-indent: 1.4em;
	}

	.pagina p:first-of-type {
		text-indent: 0;
	}

	.pagina p:first-of-type::first-letter {
		font-size: 3.1em;
		float: left;
		line-height: 0.9;
		padding: 0.06em 0.08em 0 0;
		color: var(--verde);
	}

	.pagina .pal {
		font-weight: 600;
		color: #1e3a32;
	}

	.pg-rod {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 16px;
		font: 600 12px/1 var(--fonte);
		color: #8a867c;
	}

	.pg-rod .onda {
		height: 16px;
	}

	.pg-rod .onda path {
		stroke-width: 5;
	}

	.pg-rod .onda .fundo {
		stroke: #0000001a;
	}

	.pg-rod .onda .cheia {
		stroke-dashoffset: 82;
	}

	/* cartão de palavra */
	.cartao {
		position: absolute;
		z-index: 20;
		width: min(310px, 100% - 16px);
		background: var(--creme);
		color: var(--verde-escuro);
		border-radius: 18px;
		padding: 16px;
		box-shadow: 0 18px 40px #0007;
	}

	.cartao:global(.surge) {
		animation: surge 0.22s;
	}

	@keyframes surge {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.97);
		}
	}

	.ct-x {
		position: absolute;
		right: 8px;
		top: 8px;
		border: 0;
		background: none;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		color: var(--tinta-suave);
	}

	.ct-x:hover {
		background: #0c40330d;
	}

	.ct-meta {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 12px;
		font-weight: 800;
		color: var(--tinta-suave);
	}

	.ct-w {
		margin: 6px 0 0;
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}

	.ct-w b {
		font-size: 28px;
		letter-spacing: -0.02em;
		color: var(--verde);
	}

	.ct-w span {
		font-size: 15px;
		color: var(--tinta-suave);
		font-family: 'Charis SIL', 'Doulos SIL', 'Gentium', var(--fonte-livro);
	}

	.ct-tr {
		font-size: 18px;
		font-weight: 750;
		margin-top: 2px;
	}

	.ct-ex {
		margin: 10px 0 14px;
		padding: 10px 12px;
		background: var(--papel);
		border-radius: 12px;
		font-size: 15px;
		font-weight: 650;
		border: 1px solid var(--linha);
	}

	.ct-ex small {
		display: block;
		font-weight: 550;
		color: var(--tinta-suave);
		font-size: 13px;
		margin-top: 2px;
	}

	.ct-acoes {
		display: flex;
		gap: 8px;
	}

	.ct-acoes button {
		flex: 1;
		border: 0;
		border-radius: 12px;
		padding: 11px;
		font-weight: 850;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
	}

	.b-ouvir {
		background: var(--salvia-claro);
		color: var(--verde);
	}

	.b-ouvir:hover {
		background: #cfe0c8;
	}

	.b-salvar {
		background: var(--coral);
		color: var(--verde-escuro);
		box-shadow: 0 3px 0 var(--coral-escuro);
	}

	.b-salvar:disabled {
		background: var(--salvia-claro);
		box-shadow: none;
		cursor: default;
		color: var(--verde);
	}

	/* trocando de língua */
	.troca {
		position: absolute;
		inset: 0;
		z-index: 25;
		background: #0c4033ee;
		border-radius: 20px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		font-weight: 750;
		color: var(--verde-texto);
	}

	.troca-cena {
		transform: scale(0.7);
		margin: -20px 0;
	}

	/* banco */
	.banco {
		background: var(--verde-escuro);
		border-radius: 20px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		position: relative;
		min-height: 0;
	}

	.rudo {
		width: 86px;
		height: auto;
		position: absolute;
		transform-origin: 50% 90%;
		pointer-events: none;
		z-index: 3;
	}

	.rudo:global(.engole) {
		animation: engole 0.45s;
	}

	@keyframes engole {
		30% {
			scale: 1.08 0.92;
		}
		65% {
			scale: 0.97 1.04;
		}
	}

	.banco-cab {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		padding: 6px 2px 12px;
	}

	.banco-cab h3 {
		font-size: 20px;
	}

	.qtd {
		font-size: 14px;
		font-weight: 750;
		color: var(--verde-texto);
	}

	.qtd:global(.sobe),
	.qtd-m:global(.sobe) {
		display: inline-block;
		animation: lp-sobe 0.4s;
		color: var(--ouro);
	}

	.gaveta-btn {
		display: none;
	}

	.lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow: auto;
		flex: 1;
		min-height: 0;
	}

	.lista li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px 10px;
		background: #ffffff0d;
		border-radius: 12px;
		padding: 9px 12px;
		align-items: center;
	}

	.lista li.novo {
		animation: chega 0.55s;
	}

	@keyframes chega {
		0% {
			background: #f07c7c66;
			transform: scale(0.92);
		}
		100% {
			background: #ffffff0d;
		}
	}

	.lista b {
		font-size: 16px;
	}

	.lista em {
		font-style: normal;
		color: var(--verde-texto);
		font-size: 14px;
		grid-column: 1;
	}

	.lado {
		grid-row: 1/3;
		grid-column: 2;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
	}

	.orig {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		font-weight: 700;
		color: var(--verde-texto);
	}

	.orig .ic {
		width: 14px;
		height: 14px;
	}

	.vazio {
		border: 1.5px dashed #ffffff2e;
		border-radius: 14px;
		padding: 16px;
		font-size: 15px;
		color: var(--verde-texto);
		font-weight: 600;
		text-align: center;
	}

	.banco-rod {
		font-size: 12px;
		color: #9db8a6;
		margin-top: 12px;
		padding: 0 2px;
	}

	/* desktop: painel lateral */
	@media (min-width: 960px) {
		.previa {
			padding: 26px;
		}

		.pv-corpo {
			grid-template-columns: minmax(0, 1fr) 300px;
			gap: 22px;
		}

		.palco {
			min-height: 500px;
		}

		.pn {
			height: 100%;
		}

		.rudo {
			left: 8px;
			top: 6px;
			width: 74px;
			transform: scaleX(-1);
		}

		.banco-cab {
			padding: 0 2px 12px 82px;
			min-height: 76px;
			align-items: center;
		}

		.lista {
			max-height: 380px;
		}
	}

	/* tablet e celular: gaveta presa embaixo */
	@media (max-width: 959px) {
		.banco {
			position: sticky;
			bottom: 10px;
			z-index: 30;
			padding: 0;
			box-shadow:
				0 -6px 24px #0005,
				0 0 0 1.5px #ffffff14;
			margin-top: 6px;
		}

		.banco-cab,
		.banco-rod {
			display: none;
		}

		.rudo {
			width: 62px;
			left: 6px;
			top: -30px;
		}

		.gaveta-btn {
			display: flex;
			align-items: center;
			gap: 10px;
			width: 100%;
			border: 0;
			background: none;
			color: var(--creme);
			padding: 14px 16px 14px 78px;
			text-align: left;
			font-size: 15px;
			font-weight: 650;
			min-height: 54px;
		}

		.gaveta-btn b {
			font-weight: 850;
		}

		.gaveta-btn .ic {
			margin-left: auto;
			transition: transform 0.25s;
		}

		.gaveta-btn[aria-expanded='true'] .ic {
			transform: rotate(180deg);
		}

		.gaveta {
			display: none;
			padding: 0 12px 12px;
		}

		.banco.aberto .gaveta {
			display: block;
		}

		.gaveta .lista {
			max-height: 34vh;
		}
	}

	@media (max-width: 760px) {
		.previa {
			border-radius: 24px;
			padding: 14px;
		}

		.pv-topo {
			gap: 10px;
			margin-bottom: 14px;
		}

		.pv-tit {
			flex: 1;
			font-size: 14px;
			min-width: 0;
		}

		.lingua-sel {
			order: 2;
		}

		.abas {
			order: 3;
			flex: 1 1 100%;
		}

		.abas button {
			flex: 1;
			justify-content: center;
			padding: 8px 6px;
			font-size: 14px;
			gap: 6px;
		}

		.abas button .ic {
			width: 16px;
			height: 16px;
		}

		.lingua-sel button {
			padding: 8px 10px;
		}

		.quadro {
			aspect-ratio: 4/3;
			border-radius: 16px;
		}

		.legenda {
			bottom: 5%;
			padding: 0 8px;
		}

		.legenda p {
			padding: 3px 10px;
			max-width: 100%;
		}

		.musica {
			padding: 14px;
			gap: 12px;
			border-radius: 16px;
		}

		.eq {
			display: none;
		}

		.m-capa {
			width: 44px;
			height: 44px;
		}

		.op {
			font-size: 16px;
			padding: 12px 8px 12px 42px;
		}

		.op .k {
			left: 10px;
			width: 24px;
			height: 24px;
		}

		.pontos {
			font-size: 15px;
		}

		.leitor {
			padding: 8px;
			border-radius: 16px;
		}

		.pagina {
			padding: 18px 18px 14px;
		}

		.pg-cab {
			margin-bottom: 14px;
		}
	}
</style>
