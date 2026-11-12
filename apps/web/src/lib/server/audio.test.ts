import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { audioKey, encodeWav, parseAudioQuery, supertonicIso } from './audio';

const query = (params: Record<string, string>) => parseAudioQuery(new URLSearchParams(params));
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('parseAudioQuery', () => {
	test('tag canônica, base e texto normalizado (NFC, sem espaço nas pontas, minúsculo)', () => {
		expect(query({ lang: 'pt-br', text: '  Perché ' })).toEqual({
			lang: 'pt-BR',
			base: 'pt',
			text: 'perché'
		});
	});

	test('recusa texto vazio, ausente ou com mais de 80 caracteres', () => {
		expect(query({ lang: 'it', text: '   ' })).toBeNull();
		expect(query({ lang: 'it' })).toBeNull();
		expect(query({ lang: 'it', text: 'a'.repeat(81) })).toBeNull();
		expect(query({ lang: 'it', text: 'a'.repeat(80) })?.text).toHaveLength(80);
	});

	test('recusa idioma ausente ou que não é tag BCP 47', () => {
		expect(query({ text: 'ciao' })).toBeNull();
		expect(query({ lang: 'not a tag!', text: 'ciao' })).toBeNull();
	});
});

describe('audioKey', () => {
	test('base/sha256 hex do texto normalizado', () => {
		expect(audioKey('it', 'perché')).toBe(`it/${sha('perché')}`);
	});

	test('mesma chave para caixa, espaços e forma Unicode diferentes', () => {
		expect(audioKey('it', ' Perché')).toBe(audioKey('it', 'perché'));
	});
});

describe('supertonicIso', () => {
	test('base que o Supertonic fala dá o código ISO 639-3 do Lingua Libre', () => {
		expect(supertonicIso('it')).toBe('ita');
		expect(supertonicIso('pt')).toBe('por');
		expect(supertonicIso('lv')).toBe('lvs');
	});

	test('base fora do Supertonic dá null', () => {
		expect(supertonicIso('zh')).toBeNull();
		expect(supertonicIso('la')).toBeNull();
		expect(supertonicIso('toString')).toBeNull();
	});
});

describe('encodeWav', () => {
	test('cabeçalho RIFF de PCM 16 bits mono', () => {
		const wav = encodeWav(new Float32Array(3), 44100);
		const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
		const ascii = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
		expect(wav.byteLength).toBe(44 + 3 * 2);
		expect([ascii(0), ascii(8), ascii(12), ascii(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
		expect(view.getUint32(4, true)).toBe(36 + 6);
		expect(view.getUint16(20, true)).toBe(1);
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(44100);
		expect(view.getUint32(28, true)).toBe(44100 * 2);
		expect(view.getUint16(32, true)).toBe(2);
		expect(view.getUint16(34, true)).toBe(16);
		expect(view.getUint32(40, true)).toBe(6);
	});

	test('amostras cortadas em [-1, 1] e escaladas para int16', () => {
		const wav = encodeWav(Float32Array.of(0, 0.5, 2, -3), 16000);
		const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
		const samples = [0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true));
		expect(samples).toEqual([0, 16383, 32767, -32767]);
	});
});
