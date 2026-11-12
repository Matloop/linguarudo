<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { LIMITS } from '#lib/items.ts';
	import { playWord } from '#lib/audio.ts';
	import { langAttrs, languageInline } from '#lib/languages.ts';
	import {
		GRADE_LABELS,
		STRENGTH_LABELS,
		formatAgo,
		highlightParts,
		type Grade
	} from '#lib/review.ts';
	import { deckDisplayName, plural } from '#lib/decks-ui.ts';
	import BulkBar from '#lib/ui/BulkBar.svelte';
	import DeckPicker from '#lib/ui/DeckPicker.svelte';
	import { answers } from '#lib/ui/answers.svelte.ts';
	import AnswersToggle from '#lib/ui/AnswersToggle.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Popover from '#lib/ui/Popover.svelte';
	import { postAction } from '#lib/ui/post-action.ts';
	import { Selection } from '#lib/ui/selection.svelte.ts';
	import MediaField from '#lib/ui/MediaField.svelte';
	import Mark from '#lib/ui/Mark.svelte';
	import { openSave, toast } from '#lib/ui/app-state.svelte.ts';
	import { ORIGIN_ICONS } from '#lib/ui/origins.ts';
	import type { PageProps, SubmitFunction } from './$types';

	let { data, form }: PageProps = $props();
	const timeZone = $derived(data.shell?.clock.timeZone);

	type Filter = 'todas' | 'hoje' | 'novas' | 'dominadas' | 'teimosas';
	const FILTERS: [Filter, string][] = [
		['todas', 'Todas'],
		['hoje', 'Para revisar'],
		['novas', 'Novas'],
		['dominadas', 'Dominadas'],
		['teimosas', 'Teimosas']
	];
	type Order = 'recentes' | 'az' | 'revisao' | 'forca';
	const ORDERS: [Order, string][] = [
		['recentes', 'Mais recentes'],
		['az', 'A–Z'],
		['revisao', 'Próxima revisão'],
		['forca', 'Força da memória']
	];
	const parseFilter = (v: string | null): Filter =>
		FILTERS.some(([k]) => k === v) ? (v as Filter) : 'todas';

	// Filtro e busca são locais (sem ir ao servidor); a URL guarda os dois.
	let filter = $derived(parseFilter(page.url.searchParams.get('f')));
	let q = $derived(page.url.searchParams.get('q') ?? '');
	// O servidor manda as mais recentes primeiro; as outras ordens são locais.
	let order = $derived(
		ORDERS.find(([k]) => k === page.url.searchParams.get('o'))?.[0] ?? 'recentes'
	);
	// Deck da URL (?deck=); o de topo inclui os subdecks. Deck que sumiu = todos.
	let deckFilter = $derived(
		data.decks.some((d) => d.id === page.url.searchParams.get('deck'))
			? page.url.searchParams.get('deck')
			: null
	);
	const deckScope = $derived(
		deckFilter
			? new Set(
					data.decks
						.filter((d) => d.id === deckFilter || d.parentId === deckFilter)
						.map((d) => d.id)
				)
			: null
	);
	const inDeck = $derived(data.items.filter((i) => !deckScope || deckScope.has(i.deckId)));
	let editing = $state(false);
	let busy = $state(false);
	let drawerEl: HTMLElement | undefined = $state();

	const now = $derived(new Date(data.now));
	const langName = $derived(languageInline(data.language, data.uiLanguage));
	const study = $derived(langAttrs(data.language));
	const counts = $derived({
		todas: inDeck.length,
		hoje: inDeck.filter((i) => i.dueToday).length,
		novas: inDeck.filter((i) => i.status === 'ativo' && i.strength === 0).length,
		dominadas: inDeck.filter((i) => i.strength === 4).length,
		teimosas: inDeck.filter((i) => i.leech).length
	});
	const rows = $derived.by(() => {
		const needle = q.trim().toLocaleLowerCase();
		const found = inDeck.filter((i) => {
			if (filter === 'hoje' && !i.dueToday) return false;
			if (filter === 'novas' && !(i.status === 'ativo' && i.strength === 0)) return false;
			if (filter === 'dominadas' && i.strength !== 4) return false;
			if (filter === 'teimosas' && !i.leech) return false;
			return (
				!needle ||
				i.lemma.toLocaleLowerCase().includes(needle) ||
				i.sense.toLocaleLowerCase().includes(needle)
			);
		});
		// Sem revisão marcada (já sei) vai para o fim.
		const due = (i: (typeof found)[number]) => i.dueAt ?? Number.MAX_SAFE_INTEGER;
		if (order === 'az') found.sort((a, b) => a.lemma.localeCompare(b.lemma, data.language));
		if (order === 'revisao') found.sort((a, b) => due(a) - due(b));
		if (order === 'forca') found.sort((a, b) => a.strength - b.strength);
		return found;
	});

	// Frases da lista: a escolha fica salva no navegador.
	const SENTENCES_KEY = 'linguetta.frases';
	let sentencesShown = $state(true);
	function toggleSentences() {
		sentencesShown = !sentencesShown;
		localStorage.setItem(SENTENCES_KEY, sentencesShown ? '1' : '0');
	}

	let adding = $state(false);
	async function addNew() {
		adding = true;
		const r = await postAction('extra', {});
		adding = false;
		toast(r.ok ? 'Mais 5 novas para revisar hoje' : r.message);
	}

	function pickOrder(e: Event) {
		order = (e.currentTarget as HTMLSelectElement).value as Order;
		replaceState(
			resolve(`/palavras${searchWith({ o: order === 'recentes' ? null : order })}`),
			page.state
		);
	}
	const sel = new Selection(() => rows.map((i) => i.id));
	$effect(() => {
		void rows;
		sel.prune();
	});
	const pickerDecks = $derived(data.decks.map((d) => ({ id: d.id, name: d.name, depth: d.depth })));
	let moveOpen = $state(false);
	let moving = $state(false);

	async function moveTo(choice: { deckId: string } | { newName: string }) {
		moving = true;
		const r = await postAction('move', {
			item: [...sel.ids],
			...('deckId' in choice ? { deck: choice.deckId } : { newName: choice.newName })
		});
		moving = false;
		moveOpen = false;
		if (!r.ok) return toast(r.message);
		toast(
			`${plural(Number(r.data.n), 'palavra movida', 'palavras movidas')} para ${deckDisplayName(String(r.data.target))}`
		);
		sel.clear();
	}

	function pickDeck(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		sel.clear();
		deckFilter = v || null;
		replaceState(resolve(`/palavras${searchWith({ deck: v || null })}`), page.state);
	}

	const selected = $derived(data.items.find((i) => i.id === data.selectedId) ?? null);
	const editErrors = $derived(
		form?.action === 'edit' && 'errors' in form && form.id === selected?.id ? form.errors : null
	);

	onMount(() => {
		answers.load();
		sentencesShown = localStorage.getItem(SENTENCES_KEY) !== '0';
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
		if (!selected && sel.onkeydown(e)) return;
		if (!selected && answers.onkeydown(e)) return;
		if (e.key === 'Escape' && selected && !document.querySelector('dialog[open]')) {
			if (editing) editing = false;
			else closeDrawer();
		}
	}

	function speak(text: string) {
		playWord(text, data.language).catch(() =>
			toast('Não foi possível tocar o áudio desta palavra')
		);
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
	{#each highlightParts(text, term, data.language) as part, i (i)}{#if part.hit}<mark
				>{part.text}</mark
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
	{#if data.items.length > 0}
		<div class="ph-acts">
			{#if counts.novas > 0}
				<button class="btn btn-ghost" type="button" disabled={adding} onclick={addNew}
					><Icon name="plus" size="sm" />5 novas hoje</button
				>
			{/if}
			<button
				class="btn btn-ghost"
				type="button"
				aria-pressed={!sentencesShown}
				onclick={toggleSentences}
				><Icon name="eye" size="sm" />{sentencesShown ? 'Ocultar frases' : 'Mostrar frases'}</button
			>
			<AnswersToggle />
		</div>
	{/if}
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
		{#if data.decks.length > 1}
			<label class="visually-hidden" for="deck-filtro">Deck</label>
			<select
				id="deck-filtro"
				class="input deck-filter"
				value={deckFilter ?? ''}
				onchange={pickDeck}
			>
				<option value="">Todos os decks</option>
				{#each data.decks as d (d.id)}
					<option value={d.id}
						>{d.depth ? '\u00a0\u00a0\u00a0' : ''}{deckDisplayName(d.name)
							.split(' › ')
							.at(-1)}</option
					>
				{/each}
			</select>
		{/if}
		<label class="visually-hidden" for="ordem">Ordenar</label>
		<select id="ordem" class="input deck-filter" value={order} onchange={pickOrder}>
			{#each ORDERS as [key, label] (key)}
				<option value={key}>{label}</option>
			{/each}
		</select>
	</div>

	{#if rows.length === 0}
		<div class="no-res">
			<b>Nada por aqui</b>{q.trim()
				? `Nenhuma palavra com “${q.trim()}”.`
				: 'Nenhuma palavra neste filtro.'}
		</div>
	{:else}
		<ul
			class="list"
			class:picking={sel.size > 0}
			class:no-ctx={!sentencesShown}
			aria-label="Palavras"
		>
			{#each rows as item (item.id)}
				{@const enc = item.encounters[0]}
				<li data-sel-id={item.id} class:picked={sel.has(item.id)}>
					<input
						class="ck"
						type="checkbox"
						aria-label="Selecionar {item.lemma}"
						checked={sel.has(item.id)}
						onclick={(e) => sel.toggle(item.id, e.shiftKey)}
					/>
					<a
						class="wrow"
						class:sel={item.id === data.selectedId}
						href={resolve(`/palavras${searchWith({ item: item.id })}`)}
						data-sveltekit-noscroll
						data-sveltekit-keepfocus
						data-sveltekit-replacestate
						aria-current={item.id === data.selectedId ? 'true' : undefined}
					>
						<span class="w"
							><b {...study}>{item.lemma}</b>{#if answers.shown}<span
									>{item.sense || 'Sem tradução'}</span
								>{:else}<span class="veil" aria-label="Tradução oculta"></span>{/if}</span
						>
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
							>{#if item.leech}<span class="teimosa" title="Errou {item.lapses} vezes">Teimosa</span
								>{/if}{item.status === 'conhecido' ? 'Já sei' : item.next}</span
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

<BulkBar count={sel.size} label="Ações das palavras" onclear={() => sel.clear()}>
	<Popover label="Mover para deck" bind:open={moveOpen} align="start" placement="above">
		{#snippet trigger({ toggle, expanded, id })}
			<button
				class="btn btn-ghost"
				type="button"
				aria-haspopup="dialog"
				aria-expanded={expanded}
				aria-controls={id}
				onclick={toggle}><Icon name="folder" size="sm" />Mover para deck…</button
			>
		{/snippet}
		<DeckPicker decks={pickerDecks} current={deckFilter} pending={moving} onpick={moveTo} />
	</Popover>
</BulkBar>

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
						{...study}
						value={selected.lemma}
						maxlength={LIMITS.lemma}
						required
						aria-invalid={editErrors?.lemma ? 'true' : undefined}
					/></label
				>
				{#if editErrors?.lemma}<p class="err" role="alert">{editErrors.lemma}</p>{/if}
				<label
					>Leitura <i class="opt">· opcional, como furigana ou pinyin</i><input
						name="reading"
						{...study}
						value={selected.reading}
						maxlength={LIMITS.reading}
						aria-invalid={editErrors?.reading ? 'true' : undefined}
					/></label
				>
				{#if editErrors?.reading}<p class="err" role="alert">{editErrors.reading}</p>{/if}
				<label>Tradução<input name="sense" value={selected.sense} maxlength={LIMITS.sense} /></label
				>
				<label
					>Nota<textarea name="note" rows="3" maxlength={LIMITS.note} value={selected.note}
					></textarea></label
				>
				<label
					>Tags <i class="opt">· separadas por vírgula</i><input
						name="tags"
						value={selected.tags.join(', ')}
						placeholder="viagem, A2"
						autocomplete="off"
						aria-invalid={editErrors?.tags ? 'true' : undefined}
					/></label
				>
				{#if editErrors?.tags}<p class="err" role="alert">{editErrors.tags}</p>{/if}
				<div class="media-row">
					<MediaField
						name="image"
						kind="image"
						label="Imagem"
						path={selected.image}
						url={data.selectedMedia.image}
					/>
					<MediaField
						name="audio"
						kind="audio"
						label="Áudio"
						path={selected.audio}
						url={data.selectedMedia.audio}
					/>
				</div>
				{#if editErrors?.image}<p class="err" role="alert">{editErrors.image}</p>{/if}
				{#if editErrors?.audio}<p class="err" role="alert">{editErrors.audio}</p>{/if}
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
				{#if selected.reading}<div class="dr-reading" {...study}>{selected.reading}</div>{/if}
				<h2 class="dr-word" {...study}>{selected.lemma}</h2>
				{#if data.selectedMedia.image}
					<img class="dr-img" src={data.selectedMedia.image} alt="" loading="lazy" />
				{/if}
				<div class="dr-ipa">
					{#if selected.ipa}<span>{selected.ipa}</span>{/if}
					{#if data.selectedMedia.audio}
						{@const rec = data.selectedMedia.audio}
						<button class="listen" type="button" onclick={() => void new Audio(rec).play()}
							><Icon name="sound" size="sm" />Ouvir gravação</button
						>
					{:else}<button class="listen" type="button" onclick={() => speak(selected.lemma)}
							><Icon name="sound" size="sm" />Ouvir</button
						>{/if}
				</div>
				<div class="dr-tr" class:faint={!selected.sense}>{selected.sense || 'Sem tradução'}</div>
				{#if selected.note}<p class="note">{selected.note}</p>{/if}
				{#if selected.tags.length > 0}
					<div class="item-tags">
						{#each selected.tags as tag (tag)}
							<a class="chip" href={resolve(`/flashcards/estudar?tag=${encodeURIComponent(tag)}`)}
								><Icon name="tag" size="sm" />{tag}</a
							>
						{/each}
					</div>
				{/if}

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
						{#if selected.leech}
							<p class="leech-note">
								<span class="teimosa">Teimosa</span> Você errou {selected.lapses} vezes. Vale reescrever
								ou trocar a frase do card.
							</p>
						{/if}
					</div>
				</section>

				<section class="dr-sec">
					<h3>{selected.encounters.length > 1 ? 'Contextos' : 'Contexto'}</h3>
					{#each selected.encounters as e (e.id)}
						<div class="quote">
							<div class="qs">
								<Icon name={ORIGIN_ICONS[e.origin]} size="sm" />{e.source || e.originLabel} · {formatAgo(
									new Date(e.seenAt),
									now,
									timeZone
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
									<time datetime={h.reviewedAt}
										>{formatAgo(new Date(h.reviewedAt), now, timeZone)}</time
									>
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
				<a class="btn btn-primary" href={resolve('/flashcards/estudar')}>Revisar agora</a>
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
	.dr-reading {
		color: var(--ink-3);
		font-size: 15.5px;
		margin-bottom: -2px;
	}
	.opt {
		font-style: normal;
		color: var(--ink-3);
		font-weight: 400;
	}
	.tools {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
	}
	.seg .c {
		font: 500 13.5px/1 var(--f-body);
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
	}
	.seg [data-f='hoje'] .c {
		color: var(--terra-ink);
	}
	.search {
		position: relative;
		width: 320px;
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
		height: 40px;
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
	/* Seleção (Mover para deck…): a caixa fica na margem esquerda da linha. */
	.list .ck {
		position: absolute;
		left: 14px;
		top: 50%;
		translate: 0 -50%;
		z-index: 1;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.list li:hover .ck,
	.list li:focus-within .ck,
	.list.picking .ck,
	.list .ck:checked {
		opacity: 1;
	}
	@media (hover: none) {
		.list .ck {
			opacity: 1;
		}
	}
	.list li.picked .wrow {
		background: var(--sel);
	}
	.tools > .search {
		margin-left: auto;
		flex: 0 1 320px;
		min-width: 200px;
	}
	.deck-filter {
		width: auto;
		max-width: 170px;
		flex: none;
		text-overflow: ellipsis;
	}
	.wrow {
		display: grid;
		grid-template-columns: minmax(190px, 1fr) minmax(0, 2.1fr) 28px 48px 96px;
		align-items: center;
		gap: 24px;
		padding: 16px 16px 16px 46px;
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
		font: 600 17.5px/1.3 var(--f-head);
		display: block;
		letter-spacing: -0.01em;
		overflow-wrap: anywhere;
	}
	.w span {
		font-size: 14.5px;
		color: var(--ink-3);
		display: block;
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.w .veil {
		width: 88px;
		height: 0.8em;
		margin-top: 7px;
		border-radius: 999px;
		background: var(--line);
	}
	.ctx {
		font-size: 15px;
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
		font-size: 14.5px;
		color: var(--ink-3);
		text-align: right;
		white-space: nowrap;
	}
	.next.hoje {
		color: var(--terra-ink);
		font-weight: 500;
	}
	.teimosa {
		display: inline-block;
		margin-right: 8px;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--terra-soft, color-mix(in oklab, var(--terra-ink) 12%, transparent));
		color: var(--terra-ink);
		font-size: 12.5px;
		font-weight: 500;
	}
	.leech-note {
		grid-column: 1 / -1;
		margin: 4px 0 0;
		color: var(--ink-2);
		font-size: 14px;
	}
	.list-foot {
		margin-top: 22px;
		font-size: 14px;
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
		font: 600 18.5px var(--f-head);
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
		font: 600 43px/1.1 var(--f-head);
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
		font-size: 16.5px;
	}
	.listen {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 28px;
		padding: 0 11px 0 9px;
		border: 0;
		border-radius: var(--r-s);
		font-size: 14.5px;
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
		font-size: 19.5px;
		margin-top: 16px;
	}
	.note {
		margin: 8px 0 0;
		color: var(--ink-2);
		font-size: 15.5px;
	}
	.item-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 12px;
	}
	.small {
		margin: 0;
		font-size: 15px;
	}
	.dr-sec {
		margin-top: 30px;
	}
	.dr-sec h3 {
		margin: 0 0 12px;
		font-size: 13.5px;
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
		font-size: 16px;
		line-height: 1.55;
	}
	.quote .pt {
		color: var(--ink-3);
		font-size: 14.5px;
		margin-top: 6px;
	}
	.quote .qs {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 13.5px;
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
		font: 600 18.5px/1.2 var(--f-head);
		display: block;
	}
	.next-box b.hoje {
		color: var(--terra-ink);
	}
	.next-box span {
		font-size: 14px;
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
		font-size: 15px;
	}
	.hist li + li {
		border-top: 1px solid var(--line);
	}
	.hist time,
	.hist .iv {
		color: var(--ink-3);
		font-size: 14px;
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
		font-size: 13.5px;
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
		font-size: 16.5px;
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
		font: 600 24px/1.3 var(--f-head);
	}
	.edit .err {
		margin: 6px 0 0;
		color: var(--terra-ink);
		font-size: 14px;
	}
	.media-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 14px;
	}
	.dr-img {
		display: block;
		max-width: 100%;
		max-height: 220px;
		margin: 0 0 14px;
		border-radius: 12px;
		object-fit: contain;
	}
	.edit-acts {
		display: flex;
		gap: 6px;
		margin-top: 20px;
	}

	.ph-acts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.list.no-ctx .wrow .ctx {
		display: none;
	}
	@media (min-width: 769px) {
		.list.no-ctx .wrow {
			grid-template-columns: minmax(0, 1fr) 28px 48px 96px;
		}
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
		.tools > .search {
			margin-left: 0;
			flex: none;
			order: 1;
			min-width: 0;
		}
		.deck-filter {
			max-width: none;
			width: 100%;
		}
		.list .ck {
			left: 10px;
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
			padding: 13px 10px 13px 40px;
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
			font-size: 39px;
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
