// Ações de formulário dos decks, divididas entre o hub /flashcards, a página do deck e
// /palavras (Mover para deck…). Cada uma devolve { op, ... } no sucesso ou fail(status,
// { op, message }), para a tela saber qual formulário respondeu.

import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { DECK_NAME_UI_MAX } from '#lib/decks-ui.ts';
import { deckErrorMessage, parseNewCap, parseNewOrder } from '#lib/decks.ts';
import { LANGUAGE_COOKIE, resolveActiveLanguage } from '#lib/prefs.ts';
import {
	createDeck,
	deleteDeck,
	listDecks,
	moveToDeck,
	releaseLeeches,
	renameDeck,
	setDeckOptions,
	setDeckPaused,
	setDefaultDeck,
	type DeckOptions
} from './decks.ts';
import { loadSettings } from './settings.ts';

type Event = RequestEvent;

async function context(event: Event) {
	const user = await event.locals.getUser();
	if (!user) error(401, 'Entre para mexer nos decks.');
	const settings = await loadSettings(event.locals.supabase, user.id);
	const language = resolveActiveLanguage(
		event.cookies.get(LANGUAGE_COOKIE),
		settings.studyLanguages
	);
	if (!language) error(400, 'Escolha um idioma de estudo.');
	return { user, language, form: await event.request.formData() };
}

const ids = (form: FormData, key: string) => [
	...new Set(form.getAll(key).map(String).filter(Boolean))
];

const nameOk = (raw: string) => [...raw.trim()].length <= DECK_NAME_UI_MAX;

/** Deck novo (popover do hub ou "Novo deck…" do Mover). */
export async function createAction(event: Event) {
	const { user, language, form } = await context(event);
	const name = form.get('name')?.toString() ?? '';
	if (!nameOk(name))
		return fail(400, { op: 'create', name, message: deckErrorMessage('deck_name') });
	const parentId = form.get('parent')?.toString() || null;
	const res = await createDeck(event.locals.supabase, user.id, { language, name, parentId });
	if (!res.ok) return fail(400, { op: 'create', name, message: res.message });
	return { op: 'create' as const, deck: res.value };
}

export async function renameAction(event: Event) {
	const { form } = await context(event);
	const id = form.get('id')?.toString() ?? '';
	const name = form.get('name')?.toString() ?? '';
	if (!nameOk(name))
		return fail(400, { op: 'rename', name, message: deckErrorMessage('deck_name') });
	const res = await renameDeck(event.locals.supabase, id, name);
	if (!res.ok) return fail(400, { op: 'rename', name, message: res.message });
	return { op: 'rename' as const, name };
}

export async function pauseAction(event: Event) {
	const { form } = await context(event);
	const paused = form.get('paused') === 'true';
	const res = await setDeckPaused(event.locals.supabase, ids(form, 'id'), paused);
	if (!res.ok) return fail(400, { op: 'pause', message: res.message });
	return { op: 'pause' as const, paused, n: res.value };
}

/** Decks para dentro de outro deck de topo (ou de volta ao topo). */
export async function nestAction(event: Event) {
	const { form } = await context(event);
	const parent = form.get('parent')?.toString() || null;
	for (const id of ids(form, 'id')) {
		if (id === parent) continue;
		const res = await setDeckOptions(event.locals.supabase, id, { parentId: parent });
		if (!res.ok) return fail(400, { op: 'nest', message: res.message });
	}
	return { op: 'nest' as const };
}

/** Itens e fichas para um deck (existente ou criado agora com newName). */
export async function moveAction(event: Event) {
	const { user, language, form } = await context(event);
	let deckId = form.get('deck')?.toString() || '';
	let created: string | null = null;
	const newName = form.get('newName')?.toString().trim();
	if (!deckId && newName) {
		if (!nameOk(newName)) return fail(400, { op: 'move', message: deckErrorMessage('deck_name') });
		const res = await createDeck(event.locals.supabase, user.id, { language, name: newName });
		if (!res.ok) return fail(400, { op: 'move', message: res.message });
		deckId = res.value.id;
		created = res.value.name;
	}
	if (!deckId) return fail(400, { op: 'move', message: 'Escolha um deck.' });
	const res = await moveToDeck(event.locals.supabase, deckId, {
		itemIds: ids(form, 'item'),
		fichaIds: ids(form, 'ficha')
	});
	if (!res.ok) return fail(400, { op: 'move', message: res.message });
	const decks = await listDecks(event.locals.supabase, language).catch(() => []);
	const target = decks.find((d) => d.id === deckId)?.name ?? created ?? '';
	return { op: 'move' as const, n: res.value, target, deckId };
}

/** Opções da página do deck: ordem, teto, no leitor, pausado. */
export async function optionsAction(event: Event) {
	const { form } = await context(event);
	const id = form.get('id')?.toString() ?? '';
	const opts: DeckOptions = {};
	if (form.has('newOrder')) {
		const order = parseNewOrder(form.get('newOrder'));
		if (!order) return fail(400, { op: 'options', message: 'Ordem inválida.' });
		opts.newOrder = order;
	}
	if (form.has('newCap')) {
		const cap = parseNewCap(form.get('newCap')?.toString().trim());
		if (cap === undefined)
			return fail(400, { op: 'options', message: 'O teto vai de 0 a 1000, ou vazio.' });
		opts.newCap = cap;
	}
	if (form.has('onReader')) opts.onReader = form.get('onReader') === 'true';
	if (Object.keys(opts).length) {
		const res = await setDeckOptions(event.locals.supabase, id, opts);
		if (!res.ok) return fail(400, { op: 'options', message: res.message });
	}
	if (form.has('paused')) {
		const res = await setDeckPaused(event.locals.supabase, [id], form.get('paused') === 'true');
		if (!res.ok) return fail(400, { op: 'options', message: res.message });
	}
	return { op: 'options' as const };
}

export async function defaultAction(event: Event) {
	const { form } = await context(event);
	const res = await setDefaultDeck(event.locals.supabase, form.get('id')?.toString() ?? '');
	if (!res.ok) return fail(400, { op: 'default', message: res.message });
	return { op: 'default' as const };
}

export async function deleteAction(event: Event) {
	const { form } = await context(event);
	const mode = form.get('mode') === 'delete' ? 'delete' : 'move';
	const res = await deleteDeck(event.locals.supabase, form.get('id')?.toString() ?? '', mode);
	if (!res.ok) return fail(400, { op: 'delete', message: res.message });
	return { op: 'delete' as const, mode, n: res.value };
}

/** "Voltar para a fila": tira teimosas da espera. */
export async function releaseAction(event: Event) {
	const { form } = await context(event);
	const res = await releaseLeeches(event.locals.supabase, {
		itemIds: ids(form, 'item'),
		fichaIds: ids(form, 'ficha')
	});
	if (!res.ok) return fail(400, { op: 'release', message: res.message });
	return { op: 'release' as const, n: res.value };
}
