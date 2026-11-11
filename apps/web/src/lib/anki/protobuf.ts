// Leitor mínimo de protobuf: o Anki novo guarda a config de tipos de nota, modelos
// e o mapa de mídia nesse formato. Só o que o import precisa (varint e bytes).

export type ProtoValue = number | Uint8Array;

/** Campos da mensagem por número; repetidos ficam em ordem. */
export type ProtoMessage = Map<number, ProtoValue[]>;

export function readMessage(bytes: Uint8Array): ProtoMessage {
	const out: ProtoMessage = new Map();
	let pos = 0;
	const varint = (): number => {
		let result = 0;
		let shift = 0;
		for (;;) {
			if (pos >= bytes.length) throw new Error('protobuf truncado');
			const b = bytes[pos++];
			// Multiplicação em vez de << para não estourar 32 bits.
			result += (b & 0x7f) * 2 ** shift;
			if ((b & 0x80) === 0) return result;
			shift += 7;
			if (shift > 63) throw new Error('varint longo demais');
		}
	};
	while (pos < bytes.length) {
		const key = varint();
		const field = Math.floor(key / 8);
		const wire = key % 8;
		let value: ProtoValue;
		if (wire === 0) value = varint();
		else if (wire === 2) {
			const len = varint();
			if (pos + len > bytes.length) throw new Error('protobuf truncado');
			value = bytes.subarray(pos, pos + len);
			pos += len;
		} else if (wire === 1) {
			pos += 8;
			continue;
		} else if (wire === 5) {
			pos += 4;
			continue;
		} else throw new Error(`wire type ${wire} não suportado`);
		const list = out.get(field);
		if (list) list.push(value);
		else out.set(field, [value]);
	}
	return out;
}

const decoder = new TextDecoder();

export function protoString(msg: ProtoMessage, field: number): string {
	const v = msg.get(field)?.[0];
	return v instanceof Uint8Array ? decoder.decode(v) : '';
}

export function protoNumber(msg: ProtoMessage, field: number): number {
	const v = msg.get(field)?.[0];
	return typeof v === 'number' ? v : 0;
}

export function protoMessages(msg: ProtoMessage, field: number): ProtoMessage[] {
	return (msg.get(field) ?? [])
		.filter((v): v is Uint8Array => v instanceof Uint8Array)
		.map(readMessage);
}
