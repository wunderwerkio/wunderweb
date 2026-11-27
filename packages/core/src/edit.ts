// Path edits on JSON documents (pure): the edit service applies them to its
// draft, the editor derives them from the form.
//
//   set     blocks/0/body = "<p>…</p>"        parent maps created as needed
//   unset   blocks/0/anchor
//   insert  blocks/1/items @ 2 ← {type: Card}  list created if missing
//   remove  blocks/1/items/2                   (a list item)
//   move    blocks/1/items/2 → blocks @ 0      `to` names the target list as it is
//                                              before the move, `index` the position
//                                              in it once the item is taken out
//
// Paths are authored document paths, `/`-separated; a segment indexes a
// list when the container is a list. Every edit returns its inverse.
//
// Block anchors (protocol 2): with `block`, the path is relative to the
// block with that id in the document, wherever it is now ("" = the block
// itself); `toBlock` does the same for a move's `to`. An edit made against
// one version of a file then still lands on the same block after blocks
// above it were inserted, removed or moved. Plain list items stay
// positional, inside their block.
//
//   {op: set, block: "k3x9q2m1", path: "title"}   → blocks/4/title today

import { isPlain } from "./plain.js";

export type PathEdit =
	| { op: "set"; block?: string; path: string; value: unknown }
	| { op: "unset"; block?: string; path: string }
	| {
			op: "insert";
			block?: string;
			path: string;
			index: number;
			value: unknown;
	  }
	| { op: "remove"; block?: string; path: string }
	| {
			op: "move";
			/** Anchor of `from`. */
			block?: string;
			from: string;
			/** Anchor of `to`. */
			toBlock?: string;
			to: string;
			index: number;
	  };

/** Authored path of the block with this id, undefined when the document has none. */
export function findBlock(doc: unknown, id: string): string | undefined {
	const visit = (node: unknown, path: string[]): string | undefined => {
		if (Array.isArray(node)) {
			for (const [i, item] of node.entries()) {
				const found = visit(item, [...path, String(i)]);
				if (found !== undefined) {
					return found;
				}
			}
			return undefined;
		}
		if (!isPlain(node)) {
			return undefined;
		}
		if (path.length && isBlock(node) && node.id === id) {
			return joinPath(path);
		}
		for (const [k, v] of Object.entries(node)) {
			const found = visit(v, [...path, k]);
			if (found !== undefined) {
				return found;
			}
		}
		return undefined;
	};
	return visit(doc, []);
}

/** The edit with document paths only: its anchors resolved in `doc`. */
export function resolveEdit(doc: unknown, edit: PathEdit): PathEdit {
	const at = (id: string | undefined, rel: string): string => {
		if (id === undefined) {
			return rel;
		}
		const base = findBlock(doc, id);
		if (base === undefined) {
			throw new EditError(`block ${id}: not in the document`);
		}
		return rel === "" ? base : `${base}/${rel}`;
	};
	if (edit.op === "move") {
		const { block, toBlock, ...rest } = edit;
		return { ...rest, from: at(block, edit.from), to: at(toBlock, edit.to) };
	}
	const { block, ...rest } = edit;
	return { ...rest, path: at(block, edit.path) };
}

/**
 * The edit anchored to the innermost block with an id on each of its
 * paths (unchanged where no such block is on the way).
 */
export function anchorEdit(doc: unknown, edit: PathEdit): PathEdit {
	const abs = resolveEdit(doc, edit);
	if (abs.op === "move") {
		const from = anchorPath(doc, abs.from);
		const to = anchorPath(doc, abs.to);
		const out: PathEdit = { ...abs, from: from.path, to: to.path };
		if (from.block !== undefined) {
			out.block = from.block;
		}
		if (to.block !== undefined) {
			out.toBlock = to.block;
		}
		return out;
	}
	const a = anchorPath(doc, abs.path);
	return a.block === undefined ? abs : { ...abs, block: a.block, path: a.path };
}

/** A path relative to the innermost block with an id that it passes through. */
export function anchorPath(
	doc: unknown,
	path: string,
): { block?: string; path: string } {
	const segs = splitPath(path);
	let node = doc;
	let anchor: { block?: string; path: string } = { path };
	for (const [i, seg] of segs.entries()) {
		node = valueAtPath(node, seg);
		if (node === undefined) {
			break;
		}
		if (
			isPlain(node) &&
			isBlock(node) &&
			typeof node.id === "string" &&
			node.id &&
			// A duplicated id (invalid content) would resolve to its first
			// use: such a block stays addressed by position.
			findBlock(doc, node.id) === joinPath(segs.slice(0, i + 1))
		) {
			anchor = { block: node.id, path: joinPath(segs.slice(i + 1)) };
		}
	}
	return anchor;
}

/** Blocks have a PascalCase `type`; lower-case `type` keys are values (e.g. inputs). */
function isBlock(node: Record<string, unknown>): boolean {
	return typeof node.type === "string" && /^[A-Z]/.test(node.type);
}

/** An edit whose path does not resolve in the document. */
export class EditError extends Error {}

export function splitPath(path: string): string[] {
	return path === "" ? [] : path.split("/");
}

export function joinPath(segments: (string | number)[]): string {
	return segments.join("/");
}

/** Keys that would reach the prototype instead of an authored key. */
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);

/** Value at an authored path (own keys only), undefined when it does not resolve. */
export function valueAtPath(doc: unknown, path: string): unknown {
	let node = doc;
	for (const seg of splitPath(path)) {
		if (Array.isArray(node)) {
			node = isIndex(seg) ? node[Number(seg)] : undefined;
		} else if (isPlain(node)) {
			node = Object.hasOwn(node, seg) ? node[seg] : undefined;
		} else {
			return undefined;
		}
	}
	return node;
}

/**
 * Applies one edit to a copy of `doc`; throws EditError if it does not
 * apply. An anchored edit gets an anchored inverse (undo finds its block
 * even after others moved).
 */
export function applyEdit(
	doc: unknown,
	edit: PathEdit,
): { doc: unknown; inverse: PathEdit } {
	const anchored =
		edit.block !== undefined ||
		(edit.op === "move" && edit.toBlock !== undefined);
	const r = applyPlain(doc, resolveEdit(doc, edit));
	return anchored ? { doc: r.doc, inverse: anchorEdit(r.doc, r.inverse) } : r;
}

function applyPlain(
	doc: unknown,
	edit: PathEdit,
): { doc: unknown; inverse: PathEdit } {
	for (const path of edit.op === "move" ? [edit.from, edit.to] : [edit.path]) {
		const bad = splitPath(path).find((seg) => UNSAFE.has(seg));
		if (bad !== undefined) {
			throw new EditError(`${path}: "${bad}" is not an editable key`);
		}
	}
	const root = structuredClone(doc);
	switch (edit.op) {
		case "set": {
			const segs = splitPath(edit.path);
			const key = last(segs, edit.path);
			const { node, created } = parentOf(root, segs, true, edit.path);
			const had = has(node, key);
			const old = get(node, key);
			put(node, key, structuredClone(edit.value), edit.path);
			const inverse: PathEdit = created
				? { op: "unset", path: created }
				: had
					? { op: "set", path: edit.path, value: old }
					: { op: "unset", path: edit.path };
			return { doc: root, inverse };
		}
		case "unset": {
			const segs = splitPath(edit.path);
			const key = last(segs, edit.path);
			const { node } = parentOf(root, segs, false, edit.path);
			if (Array.isArray(node)) {
				throw new EditError(`${edit.path}: use remove for list items`);
			}
			if (!has(node, key)) {
				throw new EditError(`${edit.path}: not set`);
			}
			const old = get(node, key);
			delete (node as Record<string, unknown>)[key];
			return { doc: root, inverse: { op: "set", path: edit.path, value: old } };
		}
		case "insert": {
			const segs = splitPath(edit.path);
			const key = last(segs, edit.path);
			const { node, created } = parentOf(root, segs, true, edit.path);
			let list = get(node, key);
			let createdList = created;
			if (list === undefined) {
				list = [];
				put(node, key, list, edit.path);
				createdList ??= edit.path;
			}
			if (!Array.isArray(list)) {
				throw new EditError(`${edit.path}: not a list`);
			}
			checkIndex(edit.index, list.length, edit.path);
			list.splice(edit.index, 0, structuredClone(edit.value));
			const inverse: PathEdit = createdList
				? { op: "unset", path: createdList }
				: { op: "remove", path: `${edit.path}/${edit.index}` };
			return { doc: root, inverse };
		}
		case "remove": {
			const { list, index } = listItem(root, edit.path);
			const [old] = list.splice(index, 1);
			return {
				doc: root,
				inverse: {
					op: "insert",
					path: joinPath(splitPath(edit.path).slice(0, -1)),
					index,
					value: old,
				},
			};
		}
		case "move": {
			// `to` names the target list before the item is taken out.
			const { list, index } = listItem(root, edit.from);
			const target = valueAtPath(root, edit.to);
			if (!Array.isArray(target)) {
				throw new EditError(`${edit.to}: not a list`);
			}
			if (edit.to === edit.from || edit.to.startsWith(`${edit.from}/`)) {
				throw new EditError(`${edit.from}: cannot move into itself`);
			}
			const source = joinPath(splitPath(edit.from).slice(0, -1));
			const [item] = list.splice(index, 1);
			checkIndex(edit.index, target.length, edit.to);
			target.splice(edit.index, 0, item);
			// Paths after the move: the removal shifts later siblings' paths
			// down, the insert shifts them up.
			const to = shiftPath(edit.to, source, index + 1, -1);
			return {
				doc: root,
				inverse: {
					op: "move",
					from: `${to}/${edit.index}`,
					to: shiftPath(source, to, edit.index, 1),
					index,
				},
			};
		}
	}
}

/** Applies edits in order; throws on the first one that does not apply. */
export function applyEdits(
	doc: unknown,
	edits: PathEdit[],
): { doc: unknown; inverse: PathEdit[] } {
	let current = doc;
	const inverse: PathEdit[] = [];
	for (const e of edits) {
		const r = applyEdit(current, e);
		current = r.doc;
		inverse.unshift(r.inverse);
	}
	return { doc: current, inverse };
}

/**
 * `path` after items of the list at `list` from index `from` on moved by
 * `delta`, e.g. shiftPath("blocks/3/body", "blocks", 1, 1) → "blocks/4/body".
 */
export function shiftPath(
	path: string,
	list: string,
	from: number,
	delta: number,
): string {
	const prefix = list === "" ? "" : `${list}/`;
	if (!path.startsWith(prefix) || path === list) {
		return path;
	}
	const [seg = "", ...rest] = splitPath(path.slice(prefix.length));
	if (!isIndex(seg) || Number(seg) < from) {
		return path;
	}
	return `${prefix}${joinPath([Number(seg) + delta, ...rest])}`;
}

function isIndex(seg: string): boolean {
	return /^(0|[1-9]\d*)$/.test(seg);
}

function last(segs: string[], path: string): string {
	const key = segs.at(-1);
	if (key === undefined) {
		throw new EditError(`empty path "${path}"`);
	}
	return key;
}

function has(node: unknown, key: string): boolean {
	if (Array.isArray(node)) {
		return isIndex(key) && Number(key) < node.length;
	}
	return isPlain(node) && Object.hasOwn(node, key);
}

function get(node: unknown, key: string): unknown {
	return has(node, key)
		? (node as Record<string, unknown>)[Array.isArray(node) ? Number(key) : key]
		: undefined;
}

function put(node: unknown, key: string, value: unknown, path: string) {
	if (Array.isArray(node)) {
		if (!isIndex(key) || Number(key) >= node.length) {
			throw new EditError(`${path}: no list item ${key}`);
		}
		node[Number(key)] = value;
		return;
	}
	(node as Record<string, unknown>)[key] = value;
}

/**
 * Container of the last segment. With `create`, missing maps along the way
 * are created; `created` is the outermost one (the inverse unsets it).
 */
function parentOf(
	root: unknown,
	segs: string[],
	create: boolean,
	path: string,
): { node: unknown; created: string | undefined } {
	let node = root;
	let created: string | undefined;
	for (const [i, seg] of segs.slice(0, -1).entries()) {
		let next = get(node, seg);
		if (next === undefined && create && isPlain(node)) {
			next = {};
			node[seg] = next;
			created ??= joinPath(segs.slice(0, i + 1));
		}
		if (!Array.isArray(next) && !isPlain(next)) {
			throw new EditError(
				`${path}: ${joinPath(segs.slice(0, i + 1))} does not resolve`,
			);
		}
		node = next;
	}
	if (!Array.isArray(node) && !isPlain(node)) {
		throw new EditError(`${path}: does not resolve`);
	}
	return { node, created };
}

function listItem(
	root: unknown,
	path: string,
): { list: unknown[]; index: number } {
	const segs = splitPath(path);
	const key = last(segs, path);
	const list = valueAtPath(root, joinPath(segs.slice(0, -1)));
	if (!Array.isArray(list) || !isIndex(key) || Number(key) >= list.length) {
		throw new EditError(`${path}: not a list item`);
	}
	return { list, index: Number(key) };
}

function checkIndex(index: number, length: number, path: string) {
	if (!Number.isInteger(index) || index < 0 || index > length) {
		throw new EditError(`${path}: index ${index} out of range 0..${length}`);
	}
}
