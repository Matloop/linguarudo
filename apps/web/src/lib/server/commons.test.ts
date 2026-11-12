import { describe, expect, test } from 'bun:test';
import { commonsSearch, recordingUrl, type CommonsPage } from './commons';

describe('commonsSearch', () => {
	test('regex de título do Lingua Libre: idioma, um usuário sem hífen e a palavra exata', () => {
		expect(commonsSearch('ita', 'perché')).toBe(
			// Sem String.raw: dentro dele o Bun troca letra acentuada pelo escape é literal.
			'intitle:/LL-Q[0-9]+ \\(ita\\)-[^\\-]+-perché\\.wav/i'
		);
	});

	test('escapa o que é especial na regex do CirrusSearch, menos letra, número e espaço', () => {
		expect(commonsSearch('fra', "aujourd'hui c.a/b-c")).toBe(
			String.raw`intitle:/LL-Q[0-9]+ \(fra\)-[^\-]+-aujourd\'hui c\.a\/b\-c\.wav/i`
		);
	});
});

const mp3 = (file: string) => ({
	src: `https://upload/transcoded/${file}.mp3`,
	type: 'audio/mpeg'
});
const page = (title: string, derivatives = [mp3(title)]): CommonsPage => ({
	title,
	videoinfo: [{ url: `https://upload/${title}`, derivatives }]
});

describe('recordingUrl', () => {
	test('MP3 transcodificado do arquivo cujo título tem a palavra exata', () => {
		const pages = [
			page('File:LL-Q188 (deu)-Sebastian Wallroth-GIZ-Haus.wav'),
			page('File:LL-Q188 (deu)-Sillim-Haus.wav')
		];
		expect(recordingUrl(pages, 'deu', 'haus')).toBe(
			'https://upload/transcoded/File:LL-Q188 (deu)-Sillim-Haus.wav.mp3'
		);
	});

	test('sem MP3, o original', () => {
		const pages = [page('File:LL-Q652 (ita)-LangPao-perché.wav', [])];
		expect(recordingUrl(pages, 'ita', 'perché')).toBe(
			'https://upload/File:LL-Q652 (ita)-LangPao-perché.wav'
		);
	});

	test('compara em NFC e sem caixa; outro idioma ou outra palavra não casa', () => {
		const nfd = 'File:LL-Q652 (ita)-LangPao-Perché.wav';
		expect(recordingUrl([page(nfd)], 'ita', 'perché')).not.toBeNull();
		expect(recordingUrl([page('File:LL-Q150 (fra)-X-perché.wav')], 'ita', 'perché')).toBeNull();
		expect(recordingUrl([page('File:LL-Q652 (ita)-X-perch.wav')], 'ita', 'perché')).toBeNull();
		expect(recordingUrl([], 'ita', 'perché')).toBeNull();
	});
});
