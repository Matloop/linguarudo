// Gera kosync-hash-vectors.json: o hash parcial do KOReader/KOSync (util.partialMD5)
// sobre arquivos sintéticos. Rode da raiz do repo:
//   bun docs/sync/fixtures/generate-kosync-vectors.ts > docs/sync/fixtures/kosync-hash-vectors.json
// O conteúdo de cada arquivo é byte[k] = (k * 31 + 7) mod 256, k = 0..size-1.

import { createHash } from 'node:crypto';

function fileOf(size: number): Uint8Array {
	const b = new Uint8Array(size);
	for (let k = 0; k < size; k++) b[k] = (k * 31 + 7) & 0xff;
	return b;
}

/** Igual ao Lua do KOReader: i = -1 dá deslocamento 0 (lshift com contagem negativa vira 0 no LuaJIT). */
export function partialMd5(file: Uint8Array): string {
	const md5 = createHash('md5');
	for (let i = -1; i <= 10; i++) {
		const offset = i < 0 ? 0 : 1024 << (2 * i);
		if (offset >= file.length) break; // file:read devolve nil no fim do arquivo
		md5.update(file.subarray(offset, Math.min(offset + 1024, file.length)));
	}
	return md5.digest('hex');
}

const sizes = [0, 1, 200, 1024, 1025, 1500, 5000, 70_000, 1_100_000, 5_000_000, 20_000_000];
console.log(
	JSON.stringify(
		{
			generatedBy: 'docs/sync/fixtures/generate-kosync-vectors.ts',
			content: 'byte[k] = (k * 31 + 7) mod 256, para k = 0 .. size-1',
			offsets: [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (i < 0 ? 0 : 1024 << (2 * i))),
			cases: sizes.map((size) => ({ size, hash: partialMd5(fileOf(size)) }))
		},
		null,
		'\t'
	)
);
