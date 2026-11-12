// Reamostragem contínua para 16 kHz, usada quando o AudioContext não aceita rodar
// direto em 16 kHz. Cada amostra de saída é a média das amostras de entrada que
// caem no seu intervalo: um filtro passa-baixa simples, suficiente para fala.

export class Resampler {
	readonly ratio: number;
	/** Quanto do intervalo da próxima amostra de saída já foi somado. */
	#acc = 0;
	#weight = 0;

	constructor(inputRate: number, outputRate: number) {
		if (!(inputRate > 0) || !(outputRate > 0)) throw new Error('taxa de amostragem inválida');
		this.ratio = inputRate / outputRate;
	}

	push(input: Float32Array): Float32Array {
		const ratio = this.ratio;
		if (ratio === 1) return input.slice();
		const out = new Float32Array(Math.ceil((this.#weight + input.length) / ratio) + 1);
		let n = 0;
		let acc = this.#acc;
		let weight = this.#weight;
		for (let i = 0; i < input.length; i++) {
			const x = input[i];
			const room = ratio - weight;
			if (room > 1) {
				acc += x;
				weight += 1;
				continue;
			}
			// A amostra de entrada fecha a de saída; o que sobra começa a próxima.
			acc += x * room;
			out[n++] = acc / ratio;
			const rest = 1 - room;
			acc = x * rest;
			weight = rest;
		}
		this.#acc = acc;
		this.#weight = weight;
		return out.slice(0, n);
	}
}
