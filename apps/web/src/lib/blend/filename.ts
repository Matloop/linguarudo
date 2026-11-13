// Nome do arquivo do livro em /Linguetta/ (CONTRACT §13, `file`): título limpo (sem
// /\:*?"<>| e controles, até 80 code points) + "." + par em maiúsculas (primeiro subtag de
// cada língua, língua do livro primeiro) + ".epub". Colisão ganha " (2)", " (3)"... antes
// do par, na ordem da lista.

const FORBIDDEN = /[/\\:*?"<>|\p{Cc}]/gu;

export function cleanTitle(title: string): string {
	const clean = title.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim();
	const cut = [...clean].slice(0, 80).join('').trim().replace(/^\.+|\.+$/g, '').trim();
	return cut || 'Livro';
}

export function languagePair(bookLanguage: string, language: string): string {
	const first = (tag: string) => (tag.split('-')[0] || tag).toUpperCase();
	return `${first(bookLanguage)}-${first(language)}`;
}

export function bookFileName(title: string, bookLanguage: string, language: string, n = 1): string {
	const suffix = n > 1 ? ` (${n})` : '';
	return `${cleanTitle(title)}${suffix}.${languagePair(bookLanguage, language)}.epub`;
}

/** Nomes únicos para a lista, na ordem dela (comparação sem caixa, como no FAT do SD). */
export function uniqueFileNames(
	books: readonly { title: string; bookLanguage: string; language: string }[]
): string[] {
	const used = new Set<string>();
	return books.map((b) => {
		for (let n = 1; ; n++) {
			const name = bookFileName(b.title, b.bookLanguage, b.language, n);
			const key = name.toLocaleLowerCase();
			if (!used.has(key)) {
				used.add(key);
				return name;
			}
		}
	});
}
