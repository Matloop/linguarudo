// Ícone de cada origem de encontro, igual em toda a interface.

import type { Origin } from '#lib/items.ts';
import type { IconName } from './Icon.svelte';

export const ORIGIN_ICONS: Record<Origin, IconName> = {
	manual: 'pencil',
	stremio: 'tv',
	musica: 'music',
	ereader: 'bookmark',
	anki: 'archive',
	blend: 'tv'
};
