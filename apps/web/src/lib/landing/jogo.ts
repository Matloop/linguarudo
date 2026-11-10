// Lógica pura da prévia da landing: texto com palavras clicáveis, jogo da música e banco local.

export type Lingua = 'en' | 'it';
export type Origem = 'filme' | 'musica' | 'livro';
export type Parte = { texto: string } | { palavra: string };

/** Quebra "Deixei na {1}" ou "The {rain} is" em pedaços de texto e palavras clicáveis. */
export function partes(modelo: string, palavras: readonly string[]): Parte[] {
	const saida: Parte[] = [];
	let ultimo = 0;
	for (const m of modelo.matchAll(/\{([^}]+)\}/g)) {
		if (m.index > ultimo) saida.push({ texto: modelo.slice(ultimo, m.index) });
		const chave = m[1];
		saida.push({ palavra: /^\d+$/.test(chave) ? palavras[Number(chave)] : chave });
		ultimo = m.index + m[0].length;
	}
	if (ultimo < modelo.length) saida.push({ texto: modelo.slice(ultimo) });
	return saida;
}

export type Jogo = {
	/** lacuna atual */
	i: number;
	tentativas: number;
	combo: number;
	pontos: number;
	/** 'ok' = acertou de primeira, 'quase' = acertou depois de errar */
	feitas: ('ok' | 'quase')[];
};

export const COMBO_MAX = 3;

export const jogoNovo = (): Jogo => ({ i: 0, tentativas: 0, combo: 1, pontos: 0, feitas: [] });

export function responder(
	jogo: Jogo,
	linhas: readonly { r: string }[],
	opcao: string
): { jogo: Jogo; certo: boolean; ganho: number } {
	const linha = linhas[jogo.i];
	if (!linha) return { jogo, certo: false, ganho: 0 };
	if (opcao !== linha.r) {
		return { jogo: { ...jogo, tentativas: jogo.tentativas + 1, combo: 1 }, certo: false, ganho: 0 };
	}
	const primeira = jogo.tentativas === 0;
	const ganho = 100 * jogo.combo;
	return {
		certo: true,
		ganho,
		jogo: {
			i: jogo.i + 1,
			tentativas: 0,
			combo: primeira ? Math.min(COMBO_MAX, jogo.combo + 1) : jogo.combo,
			pontos: jogo.pontos + ganho,
			feitas: [...jogo.feitas, primeira ? 'ok' : 'quase']
		}
	};
}

export type ItemBanco = { w: string; l: Lingua; tr: string; o: Origem };

export const temNoBanco = (banco: readonly ItemBanco[], w: string, l: Lingua) =>
	banco.some((b) => b.w === w && b.l === l);

export function adicionar(banco: readonly ItemBanco[], item: ItemBanco): ItemBanco[] {
	return temNoBanco(banco, item.w, item.l) ? [...banco] : [item, ...banco];
}

export const nPalavras = (n: number) => `${n} ${n === 1 ? 'palavra' : 'palavras'}`;
