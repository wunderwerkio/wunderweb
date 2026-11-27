// Block ids: a stable name for a block within its file, so edits and merges
// can address it after blocks above it moved. Editor metadata only: the
// loader keeps ids out of what components receive (Origin carries them).
//
//   blocks:
//     - type: Text
//       id: k3x9q2m1      ← first key after `type`, unique within the file
//
// Ids that `format` and the editor assign are eight lowercase letters and
// digits; ids written by hand may be any short slug (e.g. `kurzanfrage`).

import type { BlockJson, Json, Walker } from "./walk.js";

/** Pattern of a valid block id (hand-written ids included). */
export const BLOCK_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LENGTH = 8;

/** A block of a document with its authored path, e.g. blocks/0/after/1. */
export interface BlockAt {
	path: string;
	block: BlockJson;
}

export interface BlockIds {
	/** Every block in document order (Include overrides included). */
	blocks: BlockAt[];
	/** Blocks without an id. */
	missing: BlockAt[];
	/** Later blocks reusing an id of an earlier one; `first` is the earlier path. */
	duplicates: (BlockAt & { id: string; first: string })[];
}

/**
 * The blocks of one document (a page or fragment, `root` its def name) and
 * the state of their ids. Only the document's own blocks: Includes are not
 * expanded, their `with` override blocks are part of the including file.
 */
export function blockIds(walker: Walker, doc: Json, root: string): BlockIds {
	const out: BlockIds = { blocks: [], missing: [], duplicates: [] };
	const seen = new Map<string, string>();
	walker.walk(doc, root, {
		block: (block, path) => {
			const at = { path, block };
			out.blocks.push(at);
			const id = block.id;
			if (typeof id !== "string" || id === "") {
				out.missing.push(at);
				return;
			}
			const first = seen.get(id);
			if (first !== undefined) {
				out.duplicates.push({ ...at, id, first });
				return;
			}
			seen.set(id, path);
		},
	});
	return out;
}

/** Sets `id` as the first key after `type` (key order is the YAML's). */
function setFirstAfterType(b: BlockJson, id: string): void {
	const rest = Object.entries(b).filter(([k]) => k !== "type" && k !== "id");
	for (const [k] of rest) {
		delete b[k];
	}
	delete b.id;
	b.id = id;
	for (const [k, v] of rest) {
		b[k] = v;
	}
}

/** A fresh id not in `taken` (which it is added to). */
export function newBlockId(taken: Set<string>): string {
	for (;;) {
		// Browser-safe (the editor assigns ids too). 256 % 36 skews the
		// first letters slightly; uniqueness within a file is what counts.
		const bytes = globalThis.crypto.getRandomValues(new Uint8Array(LENGTH));
		let id = "";
		for (const b of bytes) {
			id += ALPHABET[b % ALPHABET.length];
		}
		if (!taken.has(id)) {
			taken.add(id);
			return id;
		}
	}
}

/**
 * Ids to assign so every block of the document has a unique id: authored
 * path → new id, for blocks without one and the later of two duplicates.
 */
export function idsToAssign(ids: BlockIds): Map<string, string> {
	const taken = idsOf(ids);
	const out = new Map<string, string>();
	for (const { path } of [...ids.missing, ...ids.duplicates]) {
		out.set(path, newBlockId(taken));
	}
	return out;
}

/** Every block id used in a document. */
export function takenIds(walker: Walker, doc: Json, root: string): Set<string> {
	return idsOf(blockIds(walker, doc, root));
}

function idsOf(ids: BlockIds): Set<string> {
	return new Set(
		ids.blocks
			.map((b) => b.block.id)
			.filter((id): id is string => typeof id === "string"),
	);
}

/**
 * A copy of a block for another place in the file (duplicate, new block):
 * it and every block inside it get a fresh id not in `taken`.
 */
export function withNewIds<T>(walker: Walker, block: T, taken: Set<string>): T {
	const copy = structuredClone(block);
	const type = (copy as { type?: unknown }).type;
	if (typeof type !== "string" || !walker.isBlockDef(type)) {
		return copy;
	}
	walker.walk(copy, type, {
		block: (b) => {
			setFirstAfterType(b, newBlockId(taken));
		},
	});
	return copy;
}
