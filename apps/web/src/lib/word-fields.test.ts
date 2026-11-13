import { describe, expect, test } from 'bun:test';
import { parseItemEdit } from './items.ts';
import {
	WORD_FIELDS,
	itemEditFields,
	itemFieldValue,
	saveDialogKey,
	type EditableItem
} from './word-fields.ts';

const item: EditableItem = {
	id: 'abc',
	lemma: 'scherzo',
	reading: '/ˈsker.tso/',
	sense: 'brincadeira',
	note: 'piada de mau gosto',
	tags: ['filme', 'gíria'],
	image: 'u/1.webp',
	audio: null
};

describe('itemEditFields', () => {
	test('um campo de texto manda o resto do item junto, para o ?/edit não apagar nada', () => {
		const fields = itemEditFields(item, 'sense', 'brincadeira, piada');
		expect(fields).toEqual({
			id: 'abc',
			lemma: 'scherzo',
			reading: '/ˈsker.tso/',
			sense: 'brincadeira, piada',
			note: 'piada de mau gosto'
		});
		const parsed = parseItemEdit(fields);
		expect(parsed.ok && parsed.value).toEqual({
			lemma: 'scherzo',
			reading: '/ˈsker.tso/',
			sense: 'brincadeira, piada',
			note: 'piada de mau gosto'
		});
	});

	test('tags e mídia só vão quando são o campo editado', () => {
		expect(itemEditFields(item, 'note', '')).not.toContainKey('tags');
		expect(itemEditFields(item, 'note', '')).not.toContainKey('image');
		const tags = itemEditFields(item, 'tags', 'filme');
		expect(parseItemEdit(tags).ok && (parseItemEdit(tags) as { value: unknown }).value).toEqual(
			expect.objectContaining({ tags: ['filme'] })
		);
		expect(itemEditFields(item, 'image', '')).toMatchObject({ image: '', lemma: 'scherzo' });
	});

	test('lema vazio volta como erro do campo', () => {
		const r = parseItemEdit(itemEditFields(item, 'lemma', '  '));
		expect(!r.ok && r.errors.lemma).toBeString();
	});
});

test('itemFieldValue: tags viram texto separado por vírgula', () => {
	expect(itemFieldValue(item, 'tags')).toBe('filme, gíria');
	expect(itemFieldValue(item, 'reading')).toBe('/ˈsker.tso/');
});

test('só lema, frase e leitura seguem o idioma de estudo', () => {
	const target = Object.entries(WORD_FIELDS)
		.filter(([, m]) => m.inTargetLanguage)
		.map(([f]) => f);
	expect(target).toEqual(['lemma', 'sentence', 'reading']);
});

describe('saveDialogKey', () => {
	test('⌥L abre os idiomas e ⌥1…⌥9 escolhem, pela tecla física', () => {
		expect(saveDialogKey({ code: 'KeyL', altKey: true })).toEqual({ type: 'idiomas' });
		expect(saveDialogKey({ code: 'Digit1', altKey: true })).toEqual({ type: 'idioma', index: 0 });
		expect(saveDialogKey({ code: 'Numpad9', altKey: true })).toEqual({ type: 'idioma', index: 8 });
	});

	test('sem ⌥, ou com outro modificador, ou ⌥0, não é atalho', () => {
		expect(saveDialogKey({ code: 'KeyL' })).toBeNull();
		expect(saveDialogKey({ code: 'KeyL', altKey: true, metaKey: true })).toBeNull();
		expect(saveDialogKey({ code: 'KeyL', altKey: true, ctrlKey: true })).toBeNull();
		expect(saveDialogKey({ code: 'Digit0', altKey: true })).toBeNull();
	});
});
