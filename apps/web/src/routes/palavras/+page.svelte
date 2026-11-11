<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { LIMITS } from '#lib/items.ts';
	import { LANGUAGE_LABELS } from '#lib/languages.ts';
	import {
		GRADE_LABELS,
		STRENGTH_LABELS,
		formatAgo,
		highlightParts,
		type Grade
	} from '#lib/review.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Mark from '#lib/ui/Mark.svelte';
	import { openSave, toast } from '#lib/ui/app-state.svelte.ts';
	import { ORIGIN_ICONS } from '#lib/ui/origins.ts';
	import type { PageProps, SubmitFunction } from './$types';

	let { data, form }: PageProps = $props();

	type Filter = 'todas' | 'hoje' | 'novas' | 'dominadas';
	const FILTERS: [Filter, string][] = [
		['todas', 'Todas'],
		['hoje', 'Para revisar'],
		['novas', 'Novas'],
		['dominadas', 'Dominadas']
	];
	const parseFilter = (v: string | null): Filter =>
		FILTERS.some(([k]) => k === v) ? (v as Filter) : 'todas';

	// Filtro e busca são locais (sem ir ao servidor); a URL guarda os dois.
	let filter = $derived(parseFilter(page.url.searchParams.get('f')));
	let q = $derived(page.url.searchParams.get('q') ?? '');
	let editing = $state(false);
	let busy = $state(false);
	let canSpeak = $state(false);
	let drawerEl: HTMLElement | undefined = $state();

	const now = $derived(new Date(data.now));
	const langName = $derived(LANGUAGE_LABELS[data.language].toLowerCase());
	const counts = $derived({
		todas: data.items.length,
		hoje: data.items.filter((i) => i.dueToday).length,
		novas: data.items.filter((i) => i.status === 'ativo' && i.strength === 0).length,
		dominadas: data.items.filter((i) => i.strength === 4).length
	});
	const rows = $derived.by(() => {
		const needle = q.trim().toLocaleLowerCase();
		return data.items.filter((i) => {
			if (filter === 'hoje' && !i.dueToday) return false;
			if (filter === 'novas' && !(i.status === 'ativo' && i.strength === 0)) return false;
			if (filter === 'dominadas' && i.strength !== 4) return false;
			return (
				!needle ||
				i.lemma.toLocaleLowerCase().includes(needle) ||
				i.sense.toLocaleLowerCase().includes(needle)
			);
		});
	});
	const selected = $derived(data.items.find((i) => i.id === data.selectedId) ?? null);
	const editErrors = $derived(
		form?.action === 'edit' && 'errors' in form && form.id === selected?.id ? form.errors : null
	);

	onMount(() => {
		canSpeak = 'speechSynthesis' in window;
	});
	// Trocar de palavra fecha a edição.
	$effect(() => {
		void data.selectedId;
		editing = false;
	});
	$effect(() => {
		if (selected && drawerEl) drawerEl.focus({ preventScroll: true });
	});

	/**
	 * Action que mantém a busca atual (item, filtro): depois do POST o SvelteKit troca a URL
	 * pela do formulário, e sem isso o painel fecharia.
	 */
	function actionKeeping(name: string) {
		const rest = page.url.search.slice(1);
		return `?/${name}${rest ? `&${rest}` : ''}`;
	}

	/** Busca da URL atual com as mudanças aplicadas (`?…` ou vazia). */
	function searchWith(changes: Record<string, string | null>): `?${string}` | '' {
		const url = new URL(page.url.href);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null || v === '' || (k === 'f' && v === 'todas')) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		return url.search as `?${string}` | '';
	}

	function syncUrl() {
		replaceState(resolve(`/palavras${searchWith({ f: filter, q: q.trim() || null })}`), page.state);
	}

	function pickFilter(e: MouseEvent, f: Filter) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		filter = f;
		syncUrl();
	}

	function closeDrawer() {
		goto(resolve(`/palavras${searchWith({ item: null })}`), { reset: false, replace: true });
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && selected && !document.querySelector('dialog[open]')) {
			if (editing) editing = false;
			else closeDrawer();
		}
	}

	function speak(text: string) {
		const u = new SpeechSynthesisUtterance(text);
		u.lang = data.language;
		speechSynthesis.cancel();
		speechSynthesis.speak(u);
	}

	function onSave(e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		openSave();
	}

	const submitEdit: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			await update({ reset: false });
			busy = false;
			if (result.type === 'success') {
				editing = false;
				toast('Alterações salvas');
			}
		};
	};

	const submitKnown: SubmitFunction = ({ formData }) => {
		const known = formData.get('known') === 'true';
		const lemma = selected?.lemma ?? '';
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				toast(known ? `“${lemma}” saiu da revisão` : `“${lemma}” voltou para a revisão`);
			} else if (result.type === 'failure') {
				toast(
					String(
						(result.data as { message?: string } | undefined)?.message ??
							'Não deu para mudar agora.'
					)
				);
			}
		};
	};

	const submitDelete: SubmitFunction = ({ cancel }) => {
		const lemma = selected?.lemma ?? '';
		if (!confirm(`Apagar “${lemma}” e o histórico de revisão dela?`)) {
			cancel();
			return;
		}
		return async ({ result }) => {
			if (result.type === 'success') {
				toast(`“${lemma}” apagada`);
				await goto(resolve(`/palavras${searchWith({ item: null })}`), {
					reset: false,
					replace: true,
					invalidateAll: true
				});
			} else if (result.type === 'failure') {
				toast(
					String(
						(result.data as { message?: string } | undefined)?.message ??
							'Não deu para apagar agora.'
					)
				);
			}
		};
	};
</script>

<svelte:head>
	<title>Minhas palavras · Linguetta</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

{#snippet strength(level: number)}
	<span class="str" title={STRENGTH_LABELS[level]} aria-label="Força: {STRENGTH_LABELS[level]}">
		{#each [1, 2, 3, 4] as n (n)}<i class:on={n <= level}></i>{/each}
	</span>
{/snippet}

{#snippet sentence(text: string, term: string)}
	{#each highlightParts(text, term) as part, i (i)}{#if part.hit}<mark>{part.text}</mark
			>{:else}{part.text}{/if}{/each}
{/snippet}

<div class="ph">
	<div>
		<h1>Minhas palavras</h1>
		<p>
			{#if data.items.length === 0}
				Nenhuma palavra em {langName} ainda.
			{:else}
				{data.items.length}
				{data.items.length === 1 ? 'palavra' : 'palavras'} em {langName}{#if counts.hoje > 0}
					· {counts.hoje} para revisar hoje{/if}
			{/if}
		</p>
	</div>
</div>

{#if data.items.length === 0}
	<div class="empty">
		<div>
			<Mark class="mark mark-hero" />
			<h2>Seu banco está vazio</h2>
			<p>
				Guarde palavras à mão ou toque nelas na legenda do Stremio. Elas aparecem aqui, com a frase
				onde você as viu.
			</p>
			<div class="acts">
				<a class="btn btn-primary btn-lg" href={resolve('/palavras?guardar')} onclick={onSave}
					><Icon name="plus" />Guardar palavra</a
				>
			</div>
		</div>
	</div>
{:else}
	<div class="tools">
		<nav class="seg" aria-label="Filtro">
			{#each FILTERS as [key, label] (key)}
				<a
					href={resolve(`/palavras${searchWith({ f: key, item: null })}`)}
					data-f={key}
					aria-current={filter === key ? 'page' : undefined}
					onclick={(e) => pickFilter(e, key)}>{label}<span class="c">{counts[key]}</span></a
				>
			{/each}
		</nav>
		<form class="search" method="GET" role="search" onsubmit={(e) => e.preventDefault()}>
			<Icon name="search" size="sm" />
			<label class="visually-hidden" for="busca">Buscar</label>
			{#if filter !== 'todas'}<input type="hidden" name="f" value={filter} />{/if}
			<input
				id="busca"
				name="q"
				type="search"
				placeholder="Buscar palavra ou tradução"
				autocomplete="off"
				bind:value={q}
				oninput={syncUrl}
				onkeydown={(e) => e.key === 'Escape' && (e.currentTarget as HTMLInputElement).blur()}
			/>
			<kbd>/</kbd>
		</form>
	</div>

	{#if rows.length === 0}
		<div class="no-res">
			<b>Nada por aqui</b>{q.trim()
				? `Nenhuma palavra com “${q.trim()}”.`
				: 'Nenhuma palavra neste filtro.'}
		</div>
	{:else}
		<ul class="list" aria-label="Palavras">
			{#each rows as item (item.id)}
				{@const enc = item.encounters[0]}
				<li>
					<a
						class="wrow"
						class:sel={item.id === data.selectedId}
						href={resolve(`/palavras${searchWith({ item: item.id })}`)}
						data-sveltekit-noscroll
						data-sveltekit-keepfocus
						data-sveltekit-replacestate
						aria-current={item.id === data.selectedId ? 'true' : undefined}
					>
						<span class="w"><b>{item.lemma}</b><span>{item.sense || 'Sem tradução'}</span></span>
						<span class="ctx"
							>{#if enc?.sentence}{@render sentence(
									enc.sentence,
									enc.highlight || item.lemma
								)}{/if}</span
						>
						<span class="src-ic" title={enc ? enc.source || enc.originLabel : 'Guardada à mão'}
							><Icon name={ORIGIN_ICONS[enc?.origin ?? 'manual']} /></span
						>
						{@render strength(item.strength)}
						<span class="next" class:hoje={item.dueToday}
							>{item.status === 'conhecido' ? 'Já sei' : item.next}</span
						>
					</a>
				</li>
			{/each}
		</ul>
		<div class="list-foot">
			<span class="legend"><Icon name="tv" size="sm" />Stremio</span>
			<span class="legend"><Icon name="music" size="sm" />Música</span>
			<span class="legend"><Icon name="pencil" size="sm" />À mão</span>
			<span class="legend force">{@render strength(3)}Força da memória</span>
		</div>
	{/if}
{/if}

{#if selected}
	{@const enc = selected.encounters[0]}
	<a
		class="drawer-scrim"
		href={resolve(`/palavras${searchWith({ item: null })}`)}
		aria-hidden="true"
		tabindex="-1"><span class="visually-hidden">Fechar</span></a
	>
	<section
		class="drawer"
		aria-label="Detalhes de “{selected.lemma}”"
		tabindex="-1"
		bind:this={drawerEl}
		data-drawer-open
	>
		<div class="dr-h">
			<span class="eyebrow"
				><Icon name={ORIGIN_ICONS[enc?.origin ?? 'manual']} size="sm" />{enc
					? enc.source || enc.originLabel
					: 'Guardada à mão'}</span
			>
			<a
				class="icon-btn"
				href={resolve(`/palavras${searchWith({ item: null })}`)}
				aria-label="Fechar"
				data-sveltekit-noscroll><Icon name="x" /></a
			>
		</div>

		{#if editing}
			<form
				class="dr-body edit"
				method="POST"
				action={actionKeeping('edit')}
				use:enhance={submitEdit}
				aria-label="Editar “{selected.lemma}”"
			>
				<input type="hidden" name="id" value={selected.id} />
				<label
					>Palavra<input
						name="lemma"
						value={selected.lemma}
						maxlength={LIMITS.lemma}
						required
						aria-invalid={editErrors?.lemma ? 'true' : undefined}
					/></label
				>
				{#if editErrors?.lemma}<p class="err" role="alert">{editErrors.lemma}</p>{/if}
				<label>Tradução<input name="sense" value={selected.sense} maxlength={LIMITS.sense} /></label
				>
				<label
					>Nota<textarea name="note" rows="3" maxlength={LIMITS.note} value={selected.note}
					></textarea></label
				>
				{#if editErrors?.form}<p class="err" role="alert">{editErrors.form}</p>{/if}
				<div class="edit-acts">
					<button class="btn btn-primary" disabled={busy}>Salvar</button>
					<button type="button" class="btn btn-ghost" onclick={() => (editing = false)}
						>Cancelar</button
					>
				</div>
			</form>
		{:else}
			<div class="dr-body">
				<h2 class="dr-word">{selected.lemma}</h2>
				{#if selected.ipa || canSpeak}
					<div class="dr-ipa">
						{#if selected.ipa}<span>{selected.ipa}</span>{/if}
						{#if canSpeak}<button class="listen" type="button" onclick={() => speak(selected.lemma)}
								><Icon name="sound" size="sm" />Ouvir</button
							>{/if}
					</div>
				{/if}
				<div class="dr-tr" class:faint={!selected.sense}>{selected.sense || 'Sem tradução'}</div>
				{#if selected.note}<p class="note">{selected.note}</p>{/if}

				<section class="dr-sec">
					<h3>Próxima revisão</h3>
					<div class="next-box">
						{#if selected.status === 'conhecido'}
							<div><b>Fora da revisão</b><span>Você marcou que já sabe</span></div>
						{:else}
							<div>
								<b class:hoje={selected.dueToday}
									>{selected.next.charAt(0).toUpperCase() + selected.next.slice(1)}</b
								><span
									>{selected.dueToday
										? 'Está na fila de agora'
										: 'Você não precisa fazer nada até lá'}</span
								>
							</div>
						{/if}
						<div class="str-l">
							{@render strength(selected.strength)}<span>{STRENGTH_LABELS[selected.strength]}</span>
						</div>
					</div>
				</section>

				<section class="dr-sec">
					<h3>{selected.encounters.length > 1 ? 'Contextos' : 'Contexto'}</h3>
					{#each selected.encounters as e (e.id)}
						<div class="quote">
							<div class="qs">
								<Icon name={ORIGIN_ICONS[e.origin]} size="sm" />{e.source || e.originLabel} · {formatAgo(
									new Date(e.seenAt),
									now
								)}
							</div>
							{#if e.sentence}<p>
									{@render sentence(e.sentence, e.highlight || selected.lemma)}
								</p>{/if}
							{#if e.sense && e.sense !== selected.sense}<div class="pt">{e.sense}</div>{/if}
						</div>
					{:else}
						<p class="faint small">
							Guardada sem frase. A próxima vez que ela aparecer, a frase entra aqui.
						</p>
					{/each}
				</section>

				<section class="dr-sec">
					<h3>Histórico</h3>
					{#if data.history.length === 0}
						<p class="faint small">Ainda não revisada. Ela entra na revisão como palavra nova.</p>
					{:else}
						<ul class="hist">
							{#each data.history as h, i (i)}
								<li>
									<time datetime={h.reviewedAt}>{formatAgo(new Date(h.reviewedAt), now)}</time>
									<span class="grade" data-g={h.rating}>{GRADE_LABELS[h.rating as Grade]}</span>
									<span class="iv">{h.kind === 'produzir' ? 'Produzir' : 'Reconhecer'}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			</div>
		{/if}

		<div class="dr-foot">
			{#if selected.dueToday}
				<a class="btn btn-primary" href={resolve('/revisar')}>Revisar agora</a>
			{/if}
			<button type="button" class="btn btn-ghost" onclick={() => (editing = !editing)}
				><Icon name="pencil" size="sm" />Editar</button
			>
			<form method="POST" action={actionKeeping('known')} use:enhance={submitKnown}>
				<input type="hidden" name="id" value={selected.id} />
				<input
					type="hidden"
					name="known"
					value={selected.status === 'conhecido' ? 'false' : 'true'}
				/>
				<button
					class="btn btn-ghost"
					aria-label={selected.status === 'conhecido'
						? `Voltar “${selected.lemma}” para a revisão`
						: `Marcar “${selected.lemma}” como conhecida`}
					><Icon
						name={selected.status === 'conhecido' ? 'refresh' : 'check'}
						size="sm"
					/>{selected.status === 'conhecido' ? 'Revisar de novo' : 'Já sei'}</button
				>
			</form>
			<form method="POST" action="?/delete" use:enhance={submitDelete} class="del">
				<input type="hidden" name="id" value={selected.id} />
				<button class="btn btn-danger" aria-label="Apagar “{selected.lemma}”">Apagar</button>
			</form>
		</div>
	</section>
{/if}

<style>
	.tools {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
	}
	.seg .c {
		font: 500 12px/1 var(--f-body);
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
	}
	.seg [data-f='hoje'] .c {
		color: var(--terra-ink);
	}
	.search {
		position: relative;
		width: 280px;
		margin: 0;
	}
	.search > :global(.ic) {
		position: absolute;
		left: 12px;
		top: 50%;
		translate: 0 -50%;
		color: var(--ink-3);
		pointer-events: none;
	}
	.search input {
		width: 100%;
		height: 36px;
		padding: 0 40px 0 36px;
		border: 0;
		border-radius: var(--r-m);
		outline: none;
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		transition:
			box-shadow 0.18s,
			background-color 0.18s;
	}
	.search input::placeholder {
		color: var(--ink-3);
	}
	.search input:focus {
		background: var(--raise);
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 0 0 3px var(--ring);
	}
	.search kbd {
		position: absolute;
		right: 9px;
		top: 50%;
		translate: 0 -50%;
	}
	.list {
		display: flex;
		flex-direction: column;
		margin: 0 -14px;
		padding: 0;
		list-style: none;
	}
	.list li {
		position: relative;
	}
	.wrow {
		display: grid;
		grid-template-columns: minmax(170px, 1fr) minmax(0, 2.1fr) 28px 44px 84px;
		align-items: center;
		gap: 22px;
		padding: 13px 16px;
		border-radius: var(--r-m);
		text-align: left;
		width: 100%;
		position: relative;
		color: inherit;
		text-decoration: none;
		transition: background-color 0.15s;
	}
	li + li .wrow::before {
		content: '';
		position: absolute;
		left: 16px;
		right: 16px;
		top: 0;
		height: 1px;
		background: var(--line);
		transition: opacity 0.15s;
	}
	.wrow:hover {
		background: var(--hover);
	}
	.wrow.sel {
		background: var(--sel);
	}
	.wrow:hover::before,
	.wrow.sel::before,
	li:hover + li .wrow::before,
	li:has(.sel) + li .wrow::before {
		opacity: 0;
	}
	.w {
		min-width: 0;
	}
	.w b {
		font: 600 16px/1.3 var(--f-head);
		display: block;
		letter-spacing: -0.01em;
		overflow-wrap: anywhere;
	}
	.w span {
		font-size: 13px;
		color: var(--ink-3);
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ctx {
		font-size: 13.5px;
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.src-ic {
		color: var(--ink-3);
		display: grid;
		place-items: center;
	}
	.next {
		font-size: 13px;
		color: var(--ink-3);
		text-align: right;
		white-space: nowrap;
	}
	.next.hoje {
		color: var(--terra-ink);
		font-weight: 500;
	}
	.list-foot {
		margin-top: 22px;
		font-size: 12.5px;
		color: var(--ink-3);
		display: flex;
		gap: 18px;
		align-items: center;
	}
	.legend {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.legend.force {
		margin-left: auto;
	}
	.no-res {
		text-align: center;
		padding: 56px 0;
		color: var(--ink-3);
	}
	.no-res b {
		display: block;
		color: var(--ink);
		font: 600 17px var(--f-head);
		margin-bottom: 4px;
	}

	/* Painel lateral: preso à janela, por cima do canto direito do painel. */
	.drawer-scrim {
		display: none;
	}
	.drawer {
		position: fixed;
		z-index: 45;
		top: 18px;
		right: 18px;
		bottom: 18px;
		width: 420px;
		max-width: calc(100vw - 36px);
		background: var(--raise);
		border-radius: var(--r-l);
		box-shadow: var(--sh-pop);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: drawerIn 0.4s var(--ease) both;
	}
	:global(.tema-escuro) .drawer {
		background: var(--raise-2);
	}
	.drawer:focus {
		outline: none;
	}
	@keyframes drawerIn {
		from {
			transform: translateX(calc(100% + 24px));
		}
	}
	.dr-h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 12px 0 16px;
	}
	.dr-h .eyebrow {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dr-body {
		flex: 1;
		overflow-y: auto;
		padding: 14px 28px 28px;
		margin: 0;
	}
	.dr-word {
		font: 600 40px/1.1 var(--f-head);
		letter-spacing: -0.03em;
		margin: 8px 0 0;
		overflow-wrap: anywhere;
	}
	.dr-ipa {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 10px;
		color: var(--ink-3);
		font-size: 15px;
	}
	.listen {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 28px;
		padding: 0 11px 0 9px;
		border: 0;
		border-radius: var(--r-s);
		font-size: 13px;
		font-weight: 500;
		color: var(--accent-ink);
		background: var(--sel);
		cursor: pointer;
		transition: background-color 0.15s;
	}
	.listen:hover {
		background: var(--press);
	}
	.dr-tr {
		font-size: 18px;
		margin-top: 16px;
	}
	.note {
		margin: 8px 0 0;
		color: var(--ink-2);
		font-size: 14px;
	}
	.small {
		margin: 0;
		font-size: 13.5px;
	}
	.dr-sec {
		margin-top: 30px;
	}
	.dr-sec h3 {
		margin: 0 0 12px;
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-3);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.quote {
		padding: 14px 16px;
		border-radius: var(--r-m);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.quote + .quote {
		margin-top: 8px;
	}
	.quote p {
		margin: 0;
		font-size: 14.5px;
		line-height: 1.55;
	}
	.quote .pt {
		color: var(--ink-3);
		font-size: 13px;
		margin-top: 6px;
	}
	.quote .qs {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: var(--ink-3);
		margin-bottom: 8px;
	}
	.next-box {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 16px;
		border-radius: var(--r-m);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.next-box b {
		font: 600 17px/1.2 var(--f-head);
		display: block;
	}
	.next-box b.hoje {
		color: var(--terra-ink);
	}
	.next-box span {
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.str-l {
		text-align: right;
		flex: none;
	}
	.str-l > span:last-child {
		display: block;
		margin-top: 4px;
	}
	.hist {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.hist li {
		display: grid;
		grid-template-columns: 84px 1fr auto;
		gap: 12px;
		align-items: center;
		padding: 8px 2px;
		font-size: 13.5px;
	}
	.hist li + li {
		border-top: 1px solid var(--line);
	}
	.hist time,
	.hist .iv {
		color: var(--ink-3);
		font-size: 12.5px;
	}
	.dr-foot {
		padding: 14px 20px;
		display: flex;
		gap: 4px;
		border-top: 1px solid var(--line);
	}
	.dr-foot form {
		margin: 0;
	}
	.dr-foot .btn-primary {
		flex: 1;
	}
	.dr-foot .del {
		margin-left: auto;
	}
	.edit label {
		display: block;
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-3);
		margin-top: 16px;
	}
	.edit input,
	.edit textarea {
		display: block;
		width: 100%;
		margin-top: 6px;
		padding: 9px 12px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		font-size: 15px;
		color: var(--ink);
		resize: vertical;
		outline: none;
	}
	.edit input:focus,
	.edit textarea:focus {
		background: var(--raise);
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 0 0 3px var(--ring);
	}
	.edit input[name='lemma'] {
		font: 600 22px/1.3 var(--f-head);
	}
	.edit .err {
		margin: 6px 0 0;
		color: var(--terra-ink);
		font-size: 12.5px;
	}
	.edit-acts {
		display: flex;
		gap: 6px;
		margin-top: 20px;
	}

	@media (max-width: 1180px) {
		.wrow {
			grid-template-columns: minmax(150px, 1fr) minmax(0, 1.6fr) 28px 44px 80px;
			gap: 16px;
		}
	}
	@media (max-width: 980px) {
		.wrow .ctx {
			display: none;
		}
		.wrow {
			grid-template-columns: minmax(0, 1fr) 28px 44px 84px;
		}
	}
	@media (max-width: 768px) {
		.tools {
			flex-direction: column-reverse;
			align-items: stretch;
			gap: 12px;
		}
		.search {
			width: 100%;
		}
		.search kbd {
			display: none;
		}
		.seg {
			overflow-x: auto;
			scrollbar-width: none;
			justify-content: flex-start;
		}
		.seg::-webkit-scrollbar {
			display: none;
		}
		.seg > a {
			flex: none;
			padding: 0 11px;
		}
		.list {
			margin: 0 -8px;
		}
		.wrow {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'w n' 'c c';
			gap: 4px 12px;
			padding: 13px 10px;
		}
		.wrow .w {
			grid-area: w;
		}
		.wrow .ctx {
			display: -webkit-box;
			grid-area: c;
			white-space: normal;
			-webkit-line-clamp: 1;
			line-clamp: 1;
			-webkit-box-orient: vertical;
			margin-top: 2px;
		}
		.wrow .src-ic,
		.wrow :global(.str) {
			display: none;
		}
		.wrow .next {
			grid-area: n;
			align-self: start;
			padding-top: 3px;
		}
		li + li .wrow::before {
			left: 10px;
			right: 10px;
		}
		.list-foot {
			flex-wrap: wrap;
			gap: 10px 16px;
		}
		.drawer-scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 50;
			background: var(--scrim);
			animation: fade 0.25s var(--ease) both;
		}
		.drawer {
			z-index: 51;
			top: auto;
			left: 0;
			right: 0;
			bottom: 0;
			width: auto;
			max-width: none;
			max-height: 88dvh;
			border-radius: var(--r-l) var(--r-l) 0 0;
			animation-name: sheetIn;
		}
		.drawer::before {
			content: '';
			position: absolute;
			top: 8px;
			left: 50%;
			translate: -50% 0;
			width: 36px;
			height: 4px;
			border-radius: 4px;
			background: var(--line-2);
		}
		.dr-h {
			padding-top: 18px;
		}
		.dr-body {
			padding: 8px 22px 22px;
		}
		.dr-word {
			font-size: 36px;
		}
		.dr-foot {
			padding-bottom: calc(14px + var(--safe-b));
			flex-wrap: wrap;
		}
	}
	@keyframes sheetIn {
		from {
			transform: translateY(105%);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
