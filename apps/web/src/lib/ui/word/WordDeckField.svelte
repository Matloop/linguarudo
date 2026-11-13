<!--
	Deck da palavra: linha "Deck" com o nome atual e um DeckPicker num popover.
	Modo "form": input escondido `deck` (vazio = o padrão do idioma, "Minhas palavras").
	Modo "inline": escolher move na hora pelo ?/move de /palavras (aceita "Novo deck…").
		<WordDeckField mode="inline" decks={data.decks} item={selected} />
-->
<script lang="ts">
	import { deckDisplayName } from '#lib/decks-ui.ts';
	import type { DeckOption, EditableItem } from '#lib/word-fields.ts';
	import Icon from '../Icon.svelte';
	import DeckPicker from '../DeckPicker.svelte';
	import Popover from '../Popover.svelte';
	import FieldRow from './FieldRow.svelte';
	import { MOVE_ACTION, saveField } from './inline-save.ts';

	let {
		decks,
		mode = 'form',
		value = null,
		item,
		loading = false,
		error = '',
		action = MOVE_ACTION,
		onsaved
	}: {
		decks: DeckOption[];
		mode?: 'form' | 'inline';
		/** Deck escolhido (no inline, o padrão é item.deckId); null = o padrão do idioma. */
		value?: string | null;
		item?: EditableItem;
		/** Lista ainda carregando (diálogo Guardar busca os decks do idioma escolhido). */
		loading?: boolean;
		/** Modo form: erro vindo da action. */
		error?: string;
		action?: string;
		onsaved?: (deck: { deckId: string } | { newName: string }) => void;
	} = $props();

	let open = $state(false);
	// Segue o item/valor de fora; escolher no formulário sobrescreve até ele mudar.
	let picked = $derived<string | null>(mode === 'inline' && item ? (item.deckId ?? null) : value);
	let saving = $state(false);
	let inlineError = $state('');

	const fallback = $derived(decks.find((d) => d.isDefault) ?? null);
	const current = $derived(decks.find((d) => d.id === picked) ?? fallback);
	const name = $derived(
		current ? deckDisplayName(current.name) : loading ? 'Carregando…' : 'Minhas palavras'
	);

	async function pick(choice: { deckId: string } | { newName: string }, close: () => void) {
		if (mode === 'form') {
			if ('deckId' in choice) picked = choice.deckId;
			close();
			return;
		}
		if (!item) return;
		const id = item.id;
		saving = true;
		inlineError = '';
		const fields: Record<string, string> =
			'deckId' in choice
				? { item: id, deck: choice.deckId }
				: { item: id, newName: choice.newName };
		const r = await saveField(action, () => fields, 'deck');
		saving = false;
		if (r.ok) {
			if ('deckId' in choice) picked = choice.deckId;
			close();
			onsaved?.(choice);
		} else {
			inlineError = r.error;
		}
	}

	const shownError = $derived(mode === 'inline' ? inlineError : error);
</script>

<div class="deck-field">
	{#if mode === 'form'}<input type="hidden" name="deck" value={picked ?? ''} />{/if}
	<FieldRow icon="cards" label="Deck" error={open ? '' : shownError}>
		<Popover bind:open label="Escolher deck" align="start" width={300}>
			{#snippet trigger({ toggle, expanded, id })}
				<button
					type="button"
					class="pick"
					aria-label="Deck: {name}. Trocar deck"
					aria-expanded={expanded}
					aria-controls={id}
					disabled={loading && decks.length === 0}
					onclick={toggle}
				>
					<span class="nm">{name}</span>
					<Icon name="down" size="sm" />
				</button>
			{/snippet}
			{#snippet children({ close })}
				<DeckPicker
					{decks}
					current={current?.id ?? null}
					allowNew={mode === 'inline'}
					pending={saving}
					onpick={(choice) => pick(choice, close)}
				/>
				{#if shownError}<p class="err" role="alert">{shownError}</p>{/if}
			{/snippet}
		</Popover>
	</FieldRow>
</div>

<style>
	.pick {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		margin: 0 -6px;
		padding: 1px 6px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--ink);
		font-size: 16px;
		line-height: 1.5;
		text-align: left;
		cursor: pointer;
	}
	.pick:hover:not(:disabled) {
		background: var(--hover);
	}
	.pick:disabled {
		color: var(--ink-3);
		cursor: default;
	}
	.pick :global(.ic) {
		color: var(--ink-3);
		flex: none;
	}
	.nm {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.err {
		margin: 8px 0 0;
		color: var(--terra-ink);
		font-size: 12.5px;
	}
</style>
