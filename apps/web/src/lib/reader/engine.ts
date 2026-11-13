// Camada fina sobre o foliate-js (vendorizado em ./foliate): abre o EPUB paginado, avisa
// a posição, os toques nos links do blend e nas bordas da página. Só no navegador.

import { readBlendLink, type BlendLink } from './blend-link.ts';

export type TocEntry = { label: string; href: string; depth: number };

export type Relocation = {
	spine: number;
	/** 0–1 dentro do capítulo. */
	chapterFraction: number;
	/** 0–1 no livro. */
	bookFraction: number;
	chapter: string;
};

export type BlendTap = {
	link: BlendLink;
	/** Texto do link como está na página (a forma). */
	form: string;
	/** O elemento, no documento do capítulo (para achar a frase). */
	anchor: HTMLAnchorElement;
	/** Onde o link está na janela, para o cartão não cobrir a palavra. */
	rect: { top: number; bottom: number; left: number; right: number };
};

export type EngineEvents = {
	onRelocate: (r: Relocation) => void;
	onBlendTap: (tap: BlendTap) => void;
	/** Clique ou toque fora de link: bordas esquerda e direita, ou o meio. */
	onTap: (zone: 'left' | 'right' | 'middle') => void;
	onKey: (e: KeyboardEvent) => void;
};

export type Engine = {
	toc: TocEntry[];
	language: string;
	goToHref: (href: string) => Promise<void>;
	goToPosition: (spine: number, chapterFraction: number) => Promise<void>;
	start: () => Promise<void>;
	prev: () => Promise<void>;
	next: () => Promise<void>;
	/** Vira para o lado (no livro da direita para a esquerda, esquerda é avançar). */
	goLeft: () => Promise<void>;
	goRight: () => Promise<void>;
	setStyles: (css: string) => void;
	destroy: () => void;
};

/* O foliate não tem tipos: o mínimo que usamos dele. */
type FoliateRenderer = HTMLElement & {
	goTo: (t: { index: number; anchor?: number }) => Promise<void>;
	setStyles?: (css: string) => void;
	destroy?: () => void;
};
type FoliateView = HTMLElement & {
	open: (file: Blob) => Promise<void>;
	close: () => void;
	init: (o: { showTextStart?: boolean }) => Promise<void>;
	goTo: (href: string) => Promise<unknown>;
	goLeft: () => Promise<void>;
	goRight: () => Promise<void>;
	prev: () => Promise<void>;
	next: () => Promise<void>;
	renderer: FoliateRenderer;
	lastLocation?: { tocItem?: { label?: string } | null };
	book: {
		dir?: string;
		sections: { linear?: string; size?: number }[];
		metadata?: { language?: string | string[] };
		toc?: { label?: string; href?: string; subitems?: unknown[] }[];
	};
};

function flattenToc(items: FoliateView['book']['toc'], depth = 0, out: TocEntry[] = []) {
	for (const item of items ?? []) {
		if (item.href) out.push({ label: (item.label ?? '').trim() || '—', href: item.href, depth });
		flattenToc(item.subitems as FoliateView['book']['toc'], depth + 1, out);
	}
	return out;
}

/** Fração da borda que vira página no toque (cada lado). */
const EDGE = 0.28;

export async function openBook(
	container: HTMLElement,
	file: Blob,
	events: EngineEvents
): Promise<Engine> {
	await import('./foliate/view.js');
	const view = document.createElement('foliate-view') as FoliateView;
	view.style.display = 'block';
	view.style.width = '100%';
	view.style.height = '100%';
	container.append(view);
	await view.open(file);

	const renderer = view.renderer;
	renderer.setAttribute('flow', 'paginated');
	renderer.setAttribute('max-inline-size', '680px');
	renderer.setAttribute('max-column-count', '2');
	renderer.setAttribute('margin', '28px');
	renderer.setAttribute('gap', '6%');

	const lang = view.book.metadata?.language;
	const language = (Array.isArray(lang) ? lang[0] : lang) ?? '';

	// Fração no livro pelo começo da página (a do foliate conta até o fim da página: a
	// primeira página de um capítulo curto já daria 90%). Mesmo peso por tamanho que ele usa.
	const sizes = view.book.sections.map((s) => (s.linear !== 'no' && (s.size ?? 0) > 0 ? s.size! : 0));
	const total = sizes.reduce((a, b) => a + b, 0);
	const bookFraction = (index: number, inSection: number) => {
		if (!total) return 0;
		const before = sizes.slice(0, index).reduce((a, b) => a + b, 0);
		return Math.min(1, (before + inSection * (sizes[index] ?? 0)) / total);
	};

	// Posição: o renderer dá o capítulo e a fração nele; a view, o item do sumário (ela
	// ouve o renderer antes, então lastLocation já está atualizada).
	renderer.addEventListener('relocate', (e) => {
		const { index, fraction } = (e as CustomEvent<{ index: number; fraction: number }>).detail;
		const inSection = Number.isFinite(fraction) ? fraction : 0;
		events.onRelocate({
			spine: index,
			chapterFraction: inSection,
			bookFraction: bookFraction(index, inSection),
			chapter: view.lastLocation?.tocItem?.label?.trim() ?? ''
		});
	});

	// Link do blend não navega: vira cartão. Os outros seguem o foliate.
	view.addEventListener('link', (e) => {
		const { a } = (e as CustomEvent<{ a: HTMLAnchorElement }>).detail;
		const link = readBlendLink(a.getAttribute('href'));
		if (!link) return;
		e.preventDefault();
		const frame = a.ownerDocument.defaultView?.frameElement?.getBoundingClientRect();
		const r = a.getBoundingClientRect();
		const dx = frame?.left ?? 0;
		const dy = frame?.top ?? 0;
		events.onBlendTap({
			link,
			form: (a.textContent ?? '').replace(/\s+/g, ' ').trim(),
			anchor: a,
			rect: { top: r.top + dy, bottom: r.bottom + dy, left: r.left + dx, right: r.right + dx }
		});
	});

	view.addEventListener('load', (e) => {
		const { doc } = (e as CustomEvent<{ doc: Document }>).detail;
		doc.addEventListener('keydown', (k) => events.onKey(k));
		doc.addEventListener('click', (c) => {
			if (c.defaultPrevented || (c.target as Element | null)?.closest?.('a[href]')) return;
			if (!doc.getSelection()?.isCollapsed) return;
			const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
			const x = (frame?.left ?? 0) + c.clientX;
			const w = window.innerWidth;
			events.onTap(x < w * EDGE ? 'left' : x > w * (1 - EDGE) ? 'right' : 'middle');
		});
	});

	return {
		toc: flattenToc(view.book.toc),
		language,
		goToHref: async (href) => {
			await view.goTo(href);
		},
		goToPosition: async (spine, chapterFraction) => {
			const last = view.book.sections.length - 1;
			const index = Math.max(0, Math.min(spine, last));
			await renderer.goTo({ index, anchor: Math.max(0, Math.min(1, chapterFraction)) });
		},
		start: () => view.init({ showTextStart: false }),
		prev: () => view.prev(),
		next: () => view.next(),
		goLeft: () => view.goLeft(),
		goRight: () => view.goRight(),
		setStyles: (css) => renderer.setStyles?.(css),
		destroy: () => {
			view.close();
			view.remove();
		}
	};
}

/** CSS que entra em cada capítulo: cores do tema, tamanho da letra e o link do blend. */
export function bookCss(o: {
	ink: string;
	accent: string;
	hl: string;
	fontScale: number;
	dark: boolean;
}): string {
	// O color-scheme igual ao da página deixa o iframe transparente (diferente, o navegador
	// pinta um fundo opaco: branco no tema escuro).
	return `
:root { color-scheme: ${o.dark ? 'dark' : 'light'}; }
html {
	color: ${o.ink} !important;
	background: transparent !important;
	font-size: ${Math.round(o.fontScale * 100)}% !important;
	font-family: Charter, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
}
body { color: inherit !important; background: transparent !important; }
p, li, blockquote, dd { line-height: 1.6; hyphens: auto; -webkit-hyphens: auto; }
a[href^="#lb:"] {
	color: inherit !important;
	text-decoration: underline dotted ${o.accent} !important;
	text-decoration-thickness: 1.5px !important;
	text-underline-offset: 0.2em;
	cursor: pointer;
	border-radius: 3px;
	-webkit-tap-highlight-color: transparent;
}
a[href^="#lb:"]:hover, a[href^="#lb:"][data-lb-open] { background: ${o.hl}; }
::selection { background: ${o.hl}; }
`;
}
