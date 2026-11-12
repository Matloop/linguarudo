// Abre um .apkg/.colpkg: zip com a coleção (SQLite, às vezes comprimida com zstd),
// o mapa de mídia (JSON no formato antigo, protobuf+zstd no novo) e os arquivos.

import { unzipSync } from 'fflate';
import { decompress } from 'fzstd';
import type { Database, SqlJsStatic } from 'sql.js';
import { readCollection, type AnkiCollection } from './collection.ts';
import { protoMessages, protoNumber, protoString, readMessage } from './protobuf.ts';

export interface AnkiPackage {
	collection: AnkiCollection;
	/** Arquivo de mídia por nome original; lido (e descomprimido) só quando pedido. */
	media: Map<string, () => Uint8Array>;
}

export class AnkiPackageError extends Error {}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function isZstd(data: Uint8Array): boolean {
	return ZSTD_MAGIC.every((b, i) => data[i] === b);
}

function maybeZstd(data: Uint8Array): Uint8Array {
	return isZstd(data) ? decompress(data) : data;
}

/** Nome no zip ("0", "1", …) → nome original do arquivo. */
function mediaMap(raw: Uint8Array | undefined): Map<string, string> {
	const out = new Map<string, string>();
	if (!raw || raw.length === 0) return out;
	if (isZstd(raw)) {
		// MediaEntries { repeated MediaEntry entries = 1 }; MediaEntry { name = 1, legacy_zip_filename = 255 }.
		const entries = protoMessages(readMessage(decompress(raw)), 1);
		entries.forEach((e, i) => {
			const legacy = e.has(255) ? String(protoNumber(e, 255)) : String(i);
			out.set(legacy, protoString(e, 1));
		});
		return out;
	}
	const json = JSON.parse(new TextDecoder().decode(raw)) as Record<string, string>;
	for (const [zipName, name] of Object.entries(json)) out.set(zipName, name);
	return out;
}

const COLLECTIONS = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];

/**
 * O Anki declara colunas com COLLATE unicase, uma collation só dele. O sql.js não a
 * tem e não consulta tabelas WITHOUT ROWID que a usam (fields, templates): "no query
 * solution". Só lemos, então tiramos a collation do esquema e reabrimos o banco.
 */
function withoutAnkiCollation(SQL: SqlJsStatic, db: Database): Database {
	const uses = db.exec("select count(*) from sqlite_master where sql like '%collate unicase%'")[0]
		?.values[0][0];
	if (!uses) return db;
	db.exec(`
		pragma writable_schema = on;
		update sqlite_master set sql = replace(replace(sql, 'COLLATE unicase', ''), 'collate unicase', '')
			where sql like '%collate unicase%';
		pragma writable_schema = off;
	`);
	const clean = new SQL.Database(db.export());
	db.close();
	return clean;
}

export function readPackage(data: Uint8Array, SQL: SqlJsStatic): AnkiPackage {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(data);
	} catch {
		throw new AnkiPackageError('Esse arquivo não é um pacote do Anki (.apkg).');
	}
	const name = COLLECTIONS.find((n) => files[n]);
	if (!name) throw new AnkiPackageError('O pacote não tem uma coleção do Anki dentro.');

	const db = withoutAnkiCollation(SQL, new SQL.Database(maybeZstd(files[name])));
	let collection: AnkiCollection;
	try {
		collection = readCollection(db);
	} catch {
		throw new AnkiPackageError('Não deu para ler a coleção desse pacote.');
	} finally {
		db.close();
	}

	const media = new Map<string, () => Uint8Array>();
	for (const [zipName, original] of mediaMap(files['media'])) {
		const raw = files[zipName];
		if (raw && original) media.set(original, () => maybeZstd(raw));
	}
	return { collection, media };
}
