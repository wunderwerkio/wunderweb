// The canonical form of a content file: what the hosted editor writes. A
// file in another form (as a coding agent or an IDE may write it) reads
// fine but the editor cannot patch it in place; formatting it once makes
// it editable again, with comments, quoting and key order kept.
//
//   formatYaml(text, ids?)   the CLI's `format`, the editor's normalize

import { isDeepStrictEqual } from "node:util";

import {
	type Document,
	isAlias,
	isMap,
	isScalar,
	isSeq,
	type Pair,
	parseAllDocuments,
	parseDocument,
	type YAMLMap,
} from "yaml";

import { blockIds, idsToAssign } from "./block-ids.js";
import type { Walker } from "./walk.js";

/** Serialisation that round-trips the example content byte-identical. */
export const YAML_OPTIONS = {
	lineWidth: 0,
	flowCollectionPadding: false,
} as const;

/** Message of the lint warning for a file not in canonical form. */
export const NOT_CANONICAL =
	"not in the canonical YAML form, so the visual editor cannot edit it: run `wunderweb format`";

/** Block ids to fill in while formatting: the schema's walker and the file's root def. */
export interface FormatIds {
	walker: Walker;
	/** "Page" or "Fragment". */
	root: string;
}

export type Formatted =
	/** `ids`: block ids assigned (missing or duplicate), 0 without `FormatIds`. */
	| { text: string; changed: boolean; ids: number }
	/** `yaml`: not one valid YAML document (lint reports it); `unsafe`: formatting would change content. */
	| { error: string; kind: "yaml" | "unsafe" };

/** A block id that cannot be written in place (below an alias or a merge key). */
class Unsafe extends Error {}

/**
 * The canonical form of a content file's text, or why it has none. With
 * `ids`, blocks without an id (and the later of two duplicates) get one.
 */
export function formatYaml(text: string, ids?: FormatIds): Formatted {
	const docs = parseAllDocuments(text, { merge: true });
	if (Array.isArray(docs) && docs.length > 1) {
		return { error: "a content file holds one YAML document", kind: "yaml" };
	}
	const doc = parseDocument(text, { merge: true });
	const error = doc.errors[0];
	if (error) {
		return {
			error: error.message.split("\n")[0] ?? "YAML error",
			kind: "yaml",
		};
	}
	let original: unknown;
	try {
		original = doc.toJS();
	} catch (e) {
		// E.g. too many aliases: the loader reports it too.
		return { error: firstLine(e), kind: "yaml" };
	}
	// The content after formatting: the original plus the assigned ids.
	let expected = original;
	let assigned = 0;
	if (ids) {
		const assign = idsToAssign(blockIds(ids.walker, original, ids.root));
		if (assign.size) {
			expected = structuredClone(original);
			try {
				for (const [path, id] of assign) {
					setBlockId(doc, path, id);
					blockAt(expected, path).id = id;
				}
			} catch (e) {
				if (e instanceof Unsafe) {
					return { error: e.message, kind: "unsafe" };
				}
				throw e;
			}
			assigned = assign.size;
		}
	}
	const out = doc.toString(YAML_OPTIONS);
	// Formatting never changes content (beyond ids): refuse rather than guess.
	try {
		const again = parseDocument(out, { merge: true });
		if (again.errors.length || !isDeepStrictEqual(again.toJS(), expected)) {
			return { error: "formatting would change the content", kind: "unsafe" };
		}
	} catch (e) {
		return { error: firstLine(e), kind: "unsafe" };
	}
	return { text: out, changed: out !== text, ids: assigned };
}

/**
 * Sets the `id` of the block map at `path`: an existing `id` keeps its
 * place, a new one goes right after `type` (the first key otherwise).
 */
function setBlockId(doc: Document, path: string, id: string): void {
	const node = resolve(doc, path === "" ? [] : path.split("/"));
	if (!isMap(node)) {
		throw new Unsafe(`${path}: not a block`);
	}
	const own = ownPair(node, "id");
	if (own) {
		if (isScalar(own.value)) {
			own.value.value = id;
		} else {
			own.value = doc.createNode(id);
		}
		return;
	}
	const at = node.items.findIndex((p) => keyOf(p) === "type");
	node.items.splice(at + 1, 0, doc.createPair("id", id));
}

/** The node at a path; throws when it does not resolve or crosses an alias or a merge key. */
function resolve(doc: Document, segs: string[]): unknown {
	let node: unknown = doc.contents;
	for (const [i, seg] of segs.entries()) {
		const at = segs.slice(0, i + 1).join("/");
		if (isAlias(node)) {
			throw new Unsafe(
				`${segs.slice(0, i).join("/")}: an alias; edit the YAML instead`,
			);
		}
		if (isMap(node)) {
			const pair = ownPair(node, seg);
			if (!pair) {
				throw new Unsafe(
					node.items.some((p) => keyOf(p) === "<<")
						? `${at}: inherited through a merge key; edit the YAML instead`
						: `${segs.join("/")}: does not resolve`,
				);
			}
			node = pair.value;
			continue;
		}
		if (isSeq(node)) {
			const item = node.items[Number(seg)];
			if (!/^\d+$/.test(seg) || item === undefined) {
				throw new Unsafe(`${at}: no list item`);
			}
			node = item;
			continue;
		}
		throw new Unsafe(`${at}: does not resolve`);
	}
	if (isAlias(node)) {
		throw new Unsafe(`${segs.join("/")}: an alias; edit the YAML instead`);
	}
	return node;
}

function keyOf(p: Pair): unknown {
	return isScalar(p.key) ? p.key.value : p.key;
}

function ownPair(map: YAMLMap, key: string): Pair | undefined {
	return map.items.find((p) => String(keyOf(p)) === key) as Pair | undefined;
}

/** The block object at an authored path of a plain JS document. */
function blockAt(doc: unknown, path: string): Record<string, unknown> {
	let node = doc;
	for (const seg of path.split("/")) {
		node = (node as Record<string, unknown>)[seg];
	}
	return node as Record<string, unknown>;
}

const firstLine = (e: unknown) =>
	(e as Error).message.split("\n")[0] ?? "YAML error";
