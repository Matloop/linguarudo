import { error, fail, redirect } from '@sveltejs/kit';
import {
	ORIGIN_LABELS,
	formatWorkSource,
	isDuplicateError,
	parseItemEdit,
	parseItemInput,
	type ItemEditField,
	type ItemField,
	type FlashcardKind,
	type ItemStatus,
	type Origin,
	type SaveEntry
} from '#lib/items.ts';
import { lemmaKey } from '@linguetta/language';
import { formatNextReview, isDueToday, isLeech, itemStrength } from '#lib/review.ts';
import { droppedMedia, parseMediaField, type MediaKind } from '#lib/media.ts';
import { releaseMedia, signMedia } from '#lib/server/media.ts';
import { loadSettings } from '#lib/server/settings.ts';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 500;
/** Encontros mostrados por item; o mais recente primeiro. */
const ENCOUNTERS_SHOWN = 5;
/** Revisões mostradas no painel do item. */
const HISTORY_SHOWN = 8;

type AddErrors = Partial<Record<ItemField | 'form', string>>;
type EditErrors = Partial<Record<ItemEditField | MediaKind | 'form', string>>;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver suas palavras.');
	return user;
}

function formId(form: FormData): string | null {
	const id = form.get('id');
	return typeof id === 'string' && id !== '' ? id : null;
}

export const load: PageServerLoad = async ({ locals, url, parent }) => {
	const user = await requireUser(locals);
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para ver suas palavras.');
	if (!shell.active) redirect(303, '/inicio');
	const language = shell.active;
	const now = new Date();

	const { data, error: dbError } = await locals.supabase
		.from('items')
		.select(
			'id, language, lemma, reading, sense, ipa, note, tags, image, audio, status, seen_count, created_at, flashcards(id, kind, state, stability, due_at, lapses), encounters(id, sentence, highlight, sense, origin, position, seen_at, works(title, subtitle))'
		)
		.eq('user_id', user.id)
		.eq('language', language)
		.is('deleted_at', null)
		.is('encounters.deleted_at', null)
		.order('created_at', { ascending: false })
		.order('seen_at', { referencedTable: 'encounters', ascending: false })
		.limit(ENCOUNTERS_SHOWN, { referencedTable: 'encounters' })
		.limit(PAGE_SIZE);
	if (dbError) error(500, 'Não deu para carregar suas palavras agora.');

	const items = data.map(({ flashcards, encounters, seen_count, created_at, ...item }) => {
		const status = item.status as ItemStatus;
		const dueAts = status === 'ativo' ? flashcards.map((c) => c.due_at) : [];
		return {
			...item,
			status,
			createdAt: created_at,
			seenCount: seen_count,
			strength: itemStrength(flashcards),
			leech: isLeech(flashcards),
			lapses: Math.max(0, ...flashcards.map((c) => c.lapses)),
			hasProduce: flashcards.some((c) => c.kind === 'produzir'),
			dueToday: status === 'ativo' && isDueToday(dueAts, now, shell.clock),
			next: status === 'ativo' ? formatNextReview(dueAts, now, shell.clock) : '',
			encounters: encounters.map((e) => ({
				id: e.id,
				sentence: e.sentence,
				highlight: e.highlight,
				sense: e.sense,
				origin: e.origin as Origin,
				originLabel: ORIGIN_LABELS[e.origin as Origin],
				source: formatWorkSource(e.works, e.position),
				seenAt: e.seen_at
			}))
		};
	});

	// O painel lateral (?item=) traz o histórico de revisões daquele item.
	const selectedId = url.searchParams.get('item');
	const selected = items.find((i) => i.id === selectedId) ?? null;
	let history: { rating: number; reviewedAt: string; kind: FlashcardKind }[] = [];
	// URLs assinadas só da mídia do item aberto (a lista não mostra mídia).
	let selectedMedia: { image: string | null; audio: string | null } = { image: null, audio: null };
	if (selected) {
		const [{ data: logs }, urls] = await Promise.all([
			locals.supabase
				.from('review_logs')
				.select('rating, reviewed_at, flashcards!inner(item_id, kind)')
				.eq('user_id', user.id)
				.eq('flashcards.item_id', selected.id)
				.order('reviewed_at', { ascending: false })
				.limit(HISTORY_SHOWN),
			signMedia(locals.supabase, [selected.image, selected.audio]).catch(
				() => new Map<string, string>()
			)
		]);
		history = (logs ?? []).map((l) => ({
			rating: l.rating,
			reviewedAt: l.reviewed_at,
			kind: (l.flashcards as unknown as { kind: FlashcardKind }).kind
		}));
		selectedMedia = {
			image: selected.image ? (urls.get(selected.image) ?? null) : null,
			audio: selected.audio ? (urls.get(selected.audio) ?? null) : null
		};
	}

	return {
		items,
		language,
		uiLanguage: shell.uiLanguage,
		selectedId: selected?.id ?? null,
		selectedMedia,
		history,
		now: now.toISOString()
	};
};

export const actions: Actions = {
	add: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const settings = await loadSettings(locals.supabase, user.id);
		const parsed = parseItemInput(
			Object.fromEntries(await request.formData()),
			settings.studyLanguages
		);
		if (!parsed.ok) {
			const errors: AddErrors = parsed.errors;
			return fail(400, { action: 'add' as const, errors, values: parsed.values });
		}

		const { language, lemma, reading, sense, sentence } = parsed.value;
		const entry: SaveEntry = {
			language,
			lemma,
			lemma_key: lemmaKey(lemma, language),
			reading,
			sense,
			note: '',
			ipa: '',
			part_of_speech: ''
		};
		if (sentence) {
			entry.encounter = {
				form: '',
				sentence,
				highlight: '',
				sense,
				position: {},
				origin: 'manual',
				seen_at: null,
				client_id: null
			};
		}
		const { data, error: dbError } = await locals.supabase.rpc('save_items', { p_items: [entry] });
		const saved = data?.[0];
		if (dbError || !saved) {
			const errors: AddErrors = { form: 'Não deu para salvar agora. Tente de novo.' };
			return fail(500, { action: 'add' as const, errors, values: { ...parsed.value } });
		}
		if (!saved.created && !saved.encounter_id) {
			const errors: AddErrors = { lemma: `“${saved.lemma}” já está no seu banco.` };
			return fail(409, { action: 'add' as const, errors, values: { ...parsed.value } });
		}
		return {
			action: 'add' as const,
			added: saved.lemma,
			message: saved.created
				? `“${saved.lemma}” guardada.`
				: `“${saved.lemma}” já estava no banco. A frase entrou como novo encontro.`
		};
	},

	edit: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const id = formId(form);
		const parsed = parseItemEdit(Object.fromEntries(form));
		if (!id)
			return fail(400, {
				action: 'edit' as const,
				id,
				errors: { form: 'Palavra não encontrada.' } as EditErrors
			});
		// Mídia só muda se o formulário trouxer os campos (como as tags).
		const media: { image?: string | null; audio?: string | null } = {};
		const mediaErrors: EditErrors = {};
		for (const kind of ['image', 'audio'] as const) {
			if (!form.has(kind)) continue;
			const r = parseMediaField(form.get(kind), user.id, kind);
			if (r.ok) media[kind] = r.value;
			else mediaErrors[kind] = r.error;
		}
		if (!parsed.ok || Object.keys(mediaErrors).length > 0) {
			const errors: EditErrors = { ...(parsed.ok ? {} : parsed.errors), ...mediaErrors };
			return fail(400, { action: 'edit' as const, id, errors });
		}

		// A chave de identidade sai do lema e do idioma do item (ADR 0004).
		const { data: current } = await locals.supabase
			.from('items')
			.select('language, image, audio')
			.eq('id', id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.maybeSingle();
		if (!current) {
			const errors: EditErrors = { form: 'Palavra não encontrada.' };
			return fail(404, { action: 'edit' as const, id, errors });
		}

		const { data, error: dbError } = await locals.supabase
			.from('items')
			.update({
				...parsed.value,
				...media,
				lemma_key: lemmaKey(parsed.value.lemma, current.language)
			})
			.eq('id', id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select('id');
		if (dbError || data.length === 0) {
			const errors: EditErrors = isDuplicateError(dbError)
				? { lemma: `“${parsed.value.lemma}” já está no seu banco.` }
				: { form: 'Não deu para salvar agora. Tente de novo.' };
			return fail(isDuplicateError(dbError) ? 409 : dbError ? 500 : 404, {
				action: 'edit' as const,
				id,
				errors
			});
		}
		const kept = [
			'image' in media ? (media.image ?? null) : current.image,
			'audio' in media ? (media.audio ?? null) : current.audio
		];
		await releaseMedia(locals.supabase, droppedMedia([current.image, current.audio], kept));
		return { action: 'edit' as const, id, edited: parsed.value.lemma };
	},

	known: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const id = formId(form);
		const status: ItemStatus = form.get('known') === 'true' ? 'conhecido' : 'ativo';
		if (!id) return fail(400, { action: 'known' as const, message: 'Palavra não encontrada.' });

		const { data, error: dbError } = await locals.supabase
			.from('items')
			.update({ status })
			.eq('id', id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select('id');
		if (dbError || data.length === 0) {
			return fail(dbError ? 500 : 404, {
				action: 'known' as const,
				message: 'Não deu para mudar agora. Tente de novo.'
			});
		}
		return { action: 'known' as const, id, status };
	},

	delete: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const id = formId(await request.formData());
		if (!id) return fail(400, { action: 'delete' as const, message: 'Palavra não encontrada.' });

		// Apagar marca deleted_at: a exclusão precisa chegar aos outros aparelhos (sync).
		const { data: gone, error: dbError } = await locals.supabase
			.from('items')
			.update({ deleted_at: new Date().toISOString() })
			.eq('id', id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select('image, audio');
		if (dbError) {
			return fail(500, { action: 'delete' as const, message: 'Não deu para apagar agora.' });
		}
		// Arquivos que só esse item usava saem do Storage.
		await releaseMedia(
			locals.supabase,
			(gone ?? []).flatMap((g) => [g.image, g.audio]).filter((p): p is string => !!p)
		);
		return { action: 'delete' as const, deleted: id };
	}
};
