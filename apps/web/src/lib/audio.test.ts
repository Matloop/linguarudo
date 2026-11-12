import { expect, test } from 'bun:test';
import { audioUrl } from './audio';

test('audioUrl codifica idioma e palavra', () => {
	expect(audioUrl('olá & mais', 'pt-BR')).toBe('/audio?lang=pt-BR&text=ol%C3%A1+%26+mais');
});
