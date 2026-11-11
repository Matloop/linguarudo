// Atalhos de teclado do app. Puro: a tela diz onde está e o que está aberto, e
// recebe a ação. Quem chama faz o preventDefault e executa.

import type { Grade } from './review.ts';

/** 'decks' é o hub /flashcards e a página do deck; 'flashcards' é o player. */
export type Screen = 'inicio' | 'decks' | 'palavras' | 'flashcards' | 'outra';

export interface KeyContext {
	screen: Screen;
	/** Foco num campo de texto: as letras são do texto, não atalhos. */
	typing: boolean;
	/** Diálogo aberto: ele cuida das próprias teclas. */
	dialogOpen: boolean;
	/** Só na revisão: o verso do flashcard está à mostra. */
	flipped?: boolean;
}

export interface KeyLike {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	repeat?: boolean;
}

export type Shortcut =
	| { type: 'guardar' }
	| { type: 'barra' }
	| { type: 'flashcards' }
	| { type: 'buscar' }
	| { type: 'virar' }
	| { type: 'nota'; grade: Grade }
	| { type: 'desfazer' };

export function shortcutFor(e: KeyLike, ctx: KeyContext): Shortcut | null {
	if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return null;
	if (ctx.typing || ctx.dialogOpen) return null;
	const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

	if (k === 'n') return { type: 'guardar' };
	if (k === '[') return { type: 'barra' };

	switch (ctx.screen) {
		case 'inicio':
		case 'decks':
			return k === 'r' ? { type: 'flashcards' } : null;
		case 'palavras':
			return k === '/' ? { type: 'buscar' } : null;
		case 'flashcards':
			if (k === 'z') return { type: 'desfazer' };
			if (!ctx.flipped) return k === ' ' || k === 'Enter' ? { type: 'virar' } : null;
			if (k === '1' || k === '2' || k === '3' || k === '4') {
				return { type: 'nota', grade: Number(k) as Grade };
			}
			return null;
		default:
			return null;
	}
}

/** O alvo do evento é um campo onde se digita? */
export function isTypingTarget(target: EventTarget | null): boolean {
	if (!target || typeof target !== 'object' || !('tagName' in target)) return false;
	const el = target as HTMLElement;
	const tag = el.tagName;
	if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
	if (tag !== 'INPUT') return false;
	const type = (el as HTMLInputElement).type;
	return !['button', 'submit', 'checkbox', 'radio', 'reset', 'range'].includes(type);
}
