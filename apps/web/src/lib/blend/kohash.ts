// Hash parcial do KOReader (CONTRACT §9): MD5 de até 1024 bytes em cada deslocamento
// 1024 << (2i), i = -1..10 (o primeiro é 0). É o que o aparelho calcula sobre o arquivo
// aberto; o servidor calcula o mesmo ao gerar cada versão.

import { createHash } from 'node:crypto';

const STEP = 1024;

export function koHash(bytes: Uint8Array): string {
	const md5 = createHash('md5');
	for (let i = -1; i <= 10; i++) {
		const offset = i < 0 ? 0 : STEP << (2 * i);
		if (offset >= bytes.length) break;
		md5.update(bytes.subarray(offset, Math.min(bytes.length, offset + STEP)));
	}
	return md5.digest('hex');
}
