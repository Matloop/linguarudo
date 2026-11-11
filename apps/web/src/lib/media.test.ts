import { describe, expect, test } from 'bun:test';
import {
	audioExt,
	droppedMedia,
	formatBytes,
	isImageName,
	isMediaPath,
	mediaPath,
	parseMediaField,
	sha256Hex
} from './media.ts';

const U = '00000000-0000-0000-0000-0000000000aa';
const H = 'a'.repeat(64);

describe('caminho da mídia', () => {
	test('imagem é sempre webp e do próprio usuário', () => {
		expect(isMediaPath(U, mediaPath(U, H, 'webp'), 'image')).toBe(true);
		expect(isMediaPath(U, mediaPath(U, H, 'png'), 'image')).toBe(false);
		expect(isMediaPath(U, mediaPath('outro', H, 'webp'), 'image')).toBe(false);
		expect(isMediaPath(U, `${U}/../${H}.webp`, 'image')).toBe(false);
	});

	test('áudio aceita os formatos dos decks', () => {
		for (const ext of ['mp3', 'ogg', 'm4a', 'wav', 'flac']) {
			expect(isMediaPath(U, mediaPath(U, H, ext), 'audio')).toBe(true);
		}
		expect(isMediaPath(U, mediaPath(U, H, 'webp'), 'audio')).toBe(false);
		expect(isMediaPath(U, mediaPath(U, 'xyz', 'mp3'), 'audio')).toBe(false);
	});

	test('campo vazio tira a mídia; caminho alheio é erro', () => {
		expect(parseMediaField('', U, 'image')).toEqual({ ok: true, value: null });
		expect(parseMediaField(undefined, U, 'audio')).toEqual({ ok: true, value: null });
		expect(parseMediaField(` ${U}/${H}.mp3 `, U, 'audio')).toEqual({
			ok: true,
			value: `${U}/${H}.mp3`
		});
		expect(parseMediaField(`bb/${H}.mp3`, U, 'audio').ok).toBe(false);
	});
});

test('extensão do áudio pelo tipo ou pelo nome', () => {
	expect(audioExt('audio/mpeg')).toBe('mp3');
	expect(audioExt('audio/ogg; codecs=opus')).toBe('ogg');
	expect(audioExt('', 'Pronúncia.MP3')).toBe('mp3');
	expect(audioExt('application/octet-stream', 'x.m4a')).toBe('m4a');
	expect(audioExt('video/mp4', 'x.mp4')).toBeNull();
	expect(isImageName('foto.JPG')).toBe(true);
	expect(isImageName('som.mp3')).toBe(false);
});

test('mídia que saiu na edição', () => {
	expect(droppedMedia(['a', 'b', null], ['b', 'c'])).toEqual(['a']);
	expect(droppedMedia(['a', 'a'], [null])).toEqual(['a']);
	expect(droppedMedia([null], ['a'])).toEqual([]);
});

test('bytes legíveis', () => {
	expect(formatBytes(512)).toBe('512 B');
	expect(formatBytes(2048)).toBe('2 KB');
	expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
	expect(formatBytes(200 * 1024 * 1024)).toBe('200 MB');
});

test('sha256 em hex', async () => {
	expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
	);
});
