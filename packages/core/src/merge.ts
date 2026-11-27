// Changesets on JSON documents (pure, no files, no network): what a draft
// changed against the commit it started from, and that change carried onto
// a newer version of the same document.
//
//   netChanges(base, proposed)        → Change[]   minimal, addressed by block id
//   rebase(changes, base, current)    → result     three-way, per change
//
// Block lists are aligned by id (insert, remove, move and the blocks'
// own fields). A list where any block lacks an id is compared item by
// item when no item was added or removed, else as one value. Plain lists
// (buttons, accordion items, …) are one value. Fields are addressed
// relative to the innermost block with an id, like protocol 2 edits.
//
// rebase, per change:
//
//   only the changeset changed the value      applied to current
//   current has the changeset's value already done (dropped)
//   both changed it, to different values      conflict "changed": base, published, changeset kept
//     (a block main moved elsewhere, a block placed that main has elsewhere)
//   the block (or its list) is gone           conflict "gone"
//   placed next to a block that is not there  conflict "neighbour"
//   no longer valid against the schema        incompatible, with the validator's messages
//
// Nothing is dropped without being reported: every change ends up in
// exactly one of applied, done, conflicts or incompatible.

import {
	anchorPath,
	applyEdit,
	EditError,
	findBlock,
	type PathEdit,
	splitPath,
	valueAtPath,
} from "./edit.js";
import { isPlain } from "./plain.js";

/** A list of blocks: relative to the innermost block with an id (or the document). */
export interface ListRef {
	block?: string;
	path: string;
}

/** Where a block sat in the base: its list and its neighbours there. */
export interface BasePlace {
	list: ListRef;
	prev: string | null;
	next: string | null;
}

export type Change =
	/** A field set; `base` is its value in the base (undefined: it was not set). */
	| { op: "set"; block?: string; path: string; base: unknown; value: unknown }
	| { op: "unset"; block?: string; path: string; base: unknown }
	/** A new block (with its id) after the block `after` (null: first). */
	| { op: "insert"; list: ListRef; after: string | null; value: Block }
	/**
	 * A block removed; `base` is the block as it was, without the blocks
	 * inside it that the changeset keeps elsewhere.
	 */
	| { op: "remove"; block: string; base: Block }
	/** A block placed after `after` (null: first) in `list`; `from` where it was. */
	| {
			op: "move";
			block: string;
			list: ListRef;
			after: string | null;
			from: BasePlace;
	  };

type Block = { type: string; id: string; [k: string]: unknown };

export type ConflictReason = "changed" | "gone" | "neighbour";

export interface Conflict {
	change: Change;
	reason: ConflictReason;
	/** The value in the base, on `current` (published) and in the changeset, where they apply. */
	base?: unknown;
	published?: unknown;
	changeset?: unknown;
	/** Why the change does not apply, when an edit refused it. */
	message?: string;
}

export interface Rebased {
	/** `current` with the applied changes. */
	doc: unknown;
	/** The edits that turn `current` into `doc`, in order (block-id anchored where possible). */
	edits: PathEdit[];
	applied: Change[];
	/** Already on `current` with the same result. */
	done: Change[];
	conflicts: Conflict[];
	/** Changes that would make the document invalid, with the validator's messages. */
	incompatible: { change: Change; messages: string[] }[];
}

/** A validator error: its document path (e.g. blocks/2/title) and message. */
export interface RebaseError {
	path: string;
	message: string;
}

export interface RebaseOptions {
	/** The document's errors; a change adding one is incompatible. */
	validate?: (doc: unknown) => RebaseError[];
}

// ----------------------------------------------------------------- netChanges

interface Located {
	list: ListRef;
	node: Block;
	/** The innermost enclosing block with an id. */
	parent: string | undefined;
	prev: string | null;
	next: string | null;
}

interface Diff {
	out: Change[];
	/** Changes after the removals (lists emptied by them). */
	tail: Change[];
	inBase: Map<string, Located>;
	inProposed: Map<string, Located>;
}

/** The changes that turn `base` into `proposed`, addressed by block id where blocks have one. */
export function netChanges(base: unknown, proposed: unknown): Change[] {
	const d: Diff = {
		out: [],
		tail: [],
		inBase: blockIndex(base),
		inProposed: blockIndex(proposed),
	};
	diffNode(base, proposed, { path: "" }, d);
	// Blocks gone from the proposed document; inside a removed block only
	// the outermost one. Blocks taken into a new block were removed already.
	const taken = new Set(
		d.out.flatMap((c) => (c.op === "remove" ? [c.block] : [])),
	);
	for (const [id, at] of d.inBase) {
		const parentGone = at.parent !== undefined && !d.inProposed.has(at.parent);
		if (!d.inProposed.has(id) && !parentGone && !taken.has(id)) {
			d.out.push({ op: "remove", block: id, base: stripKept(at.node, d) });
		}
	}
	return [...d.out, ...d.tail];
}

/** Every block in an aligned list (all items blocks with unique ids), by id. */
function blockIndex(doc: unknown): Map<string, Located> {
	const out = new Map<string, Located>();
	const dup = new Set<string>();
	const visit = (node: unknown, at: ListRef) => {
		if (Array.isArray(node)) {
			if (node.length && aligned(node)) {
				const list = node as Block[];
				list.forEach((b, i) => {
					if (out.has(b.id)) {
						dup.add(b.id);
					}
					out.set(b.id, {
						list: at,
						node: b,
						parent: at.block,
						prev: list[i - 1]?.id ?? null,
						next: list[i + 1]?.id ?? null,
					});
					visit(b, { block: b.id, path: "" });
				});
				return;
			}
			node.forEach((item, i) => {
				visit(item, step(at, i));
			});
			return;
		}
		if (!isPlain(node)) {
			return;
		}
		const inner = idOf(node);
		for (const [k, v] of Object.entries(node)) {
			visit(
				v,
				inner && at.path !== "" ? { block: inner, path: k } : step(at, k),
			);
		}
	};
	visit(doc, { path: "" });
	// A duplicated id (invalid content) cannot be aligned: compare by position.
	for (const id of dup) {
		out.delete(id);
	}
	return out;
}

function diffNode(b: unknown, p: unknown, at: ListRef, d: Diff): void {
	if (equal(b, p)) {
		return;
	}
	if (Array.isArray(b) && Array.isArray(p)) {
		if (alignable(b, d.inBase) && alignable(p, d.inProposed)) {
			diffList(b as Block[], p as Block[], at, d);
			return;
		}
		// Blocks without ids: item by item when nothing was added or removed.
		if (b.length === p.length && b.some(isBlockNode)) {
			b.forEach((x, i) => {
				diffNode(x, p[i], step(at, i), d);
			});
			return;
		}
		set(at, b, p, d);
		return;
	}
	if (isPlain(b) && isPlain(p)) {
		// Another block in this place, or the same one under a new type.
		if (
			(isBlockNode(b) || isBlockNode(p)) &&
			(b.type !== p.type || b.id !== p.id)
		) {
			set(at, b, p, d);
			return;
		}
		const id = idOf(p);
		// A single block field (e.g. SideBySide.start) with an id: its fields by id.
		const inner: ListRef =
			id && at.path !== "" && b.id === id ? { block: id, path: "" } : at;
		for (const k of new Set([...Object.keys(b), ...Object.keys(p)])) {
			const child = step(inner, k);
			const had = Object.hasOwn(b, k);
			const has = Object.hasOwn(p, k);
			if (had && has) {
				diffNode(b[k], p[k], child, d);
			} else if (has && nonEmpty(p[k]) && alignable(p[k], d.inProposed)) {
				// A new list of blocks: aligned against an empty one, so blocks
				// placed there from elsewhere are moves, not copies.
				diffList([], p[k] as Block[], child, d);
			} else if (had && nonEmpty(b[k]) && alignable(b[k], d.inBase)) {
				// A list of blocks gone: its blocks are removed or moved; the
				// emptied list goes once they are.
				diffList(b[k] as Block[], [], child, d);
				d.tail.push({ ...anchor(child), op: "unset", base: [] });
			} else if (has) {
				set(child, undefined, p[k], d);
			} else {
				set(child, b[k], undefined, d);
			}
		}
		return;
	}
	set(at, b, p, d);
}

function diffList(b: Block[], p: Block[], at: ListRef, d: Diff): void {
	const here = key(at);
	const kept = new Set(
		lcs(
			b.map((x) => x.id),
			p.map((x) => x.id).filter((id) => key(d.inBase.get(id)?.list) === here),
		),
	);
	let after: string | null = null;
	for (const block of p) {
		const was = d.inBase.get(block.id);
		if (!was) {
			// Base blocks placed inside the new block leave their old place first.
			takeOut(innerIds(block), [], d);
			d.out.push({ op: "insert", list: at, after, value: block });
		} else {
			if (key(was.list) !== here || !kept.has(block.id)) {
				d.out.push({
					op: "move",
					block: block.id,
					list: at,
					after,
					from: { list: was.list, prev: was.prev, next: was.next },
				});
			}
			diffNode(was.node, block, { block: block.id, path: "" }, d);
		}
		after = block.id;
	}
}

/**
 * A changed value (the whole of it). Base blocks it now holds that were
 * elsewhere leave their old place first, so no block is there twice.
 */
function set(at: ListRef, b: unknown, p: unknown, d: Diff): void {
	if (p !== undefined) {
		takeOut(innerIds(p, true), innerIds(b, true), d);
	}
	d.out.push(
		p === undefined
			? { ...anchor(at), op: "unset", base: b }
			: { ...anchor(at), op: "set", base: b, value: p },
	);
}

/** Removes for the base blocks among `ids` that were not already in `here`. */
function takeOut(ids: string[], here: string[], d: Diff): void {
	for (const id of ids) {
		const old = d.inBase.get(id);
		if (old && !here.includes(id)) {
			d.out.push({ op: "remove", block: id, base: stripKept(old.node, d) });
		}
	}
}

/** A base block without the blocks inside it that the proposed document has (elsewhere). */
function stripKept(block: Block, d: Diff): Block {
	const strip = (node: unknown): unknown => {
		if (Array.isArray(node)) {
			return node
				.filter((x) => {
					const id = isPlain(x) ? idOf(x) : undefined;
					return !(id && d.inProposed.has(id) && d.inBase.has(id));
				})
				.map(strip);
		}
		if (!isPlain(node)) {
			return node;
		}
		return Object.fromEntries(
			Object.entries(node).map(([k, v]) => [k, strip(v)]),
		);
	};
	return strip(block) as Block;
}

/** Ids of the blocks inside a value (with `self`, the value's own id too). */
function innerIds(value: unknown, self = false): string[] {
	const out: string[] = [];
	const visit = (node: unknown, top: boolean) => {
		if (Array.isArray(node)) {
			for (const x of node) {
				visit(x, false);
			}
			return;
		}
		if (!isPlain(node)) {
			return;
		}
		const id = idOf(node);
		if (id && (self || !top)) {
			out.push(id);
		}
		for (const v of Object.values(node)) {
			visit(v, false);
		}
	};
	visit(value, true);
	return out;
}

/** Longest common subsequence of two id lists. */
function lcs(a: string[], b: string[]): string[] {
	const n = b.length;
	// t[i * (n + 1) + j]: LCS length of a[i..] and b[j..].
	const t = new Array<number>((a.length + 1) * (n + 1)).fill(0);
	const at = (i: number, j: number) => t[i * (n + 1) + j] ?? 0;
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			t[i * (n + 1) + j] =
				a[i] === b[j]
					? at(i + 1, j + 1) + 1
					: Math.max(at(i + 1, j), at(i, j + 1));
		}
	}
	const out: string[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < n) {
		if (a[i] === b[j]) {
			out.push(a[i] as string);
			i++;
			j++;
		} else if (at(i + 1, j) >= at(i, j + 1)) {
			i++;
		} else {
			j++;
		}
	}
	return out;
}

// ----------------------------------------------------------------- rebase

/**
 * Carries `changes` (from `netChanges(base, …)`) onto `current`, a newer
 * version of `base`. Each change is compared three ways; see the table at
 * the top of this file. The changes hold the base values they compare
 * against, so `base` itself is not read.
 */
export function rebase(
	changes: Change[],
	_base: unknown,
	current: unknown,
	opts: RebaseOptions = {},
): Rebased {
	const out: Rebased = {
		doc: current,
		edits: [],
		applied: [],
		done: [],
		conflicts: [],
		incompatible: [],
	};
	// Blocks the changeset itself places: not a sign that main moved them.
	const placed = new Set(
		changes.flatMap((c) =>
			c.op === "move" ? [c.block] : c.op === "insert" ? [c.value.id] : [],
		),
	);
	let errors = errorKeys(current, opts);
	for (const change of changes) {
		const r = carry(change, out.doc, placed);
		if (r.kind === "done") {
			out.done.push(change);
			continue;
		}
		if (r.kind === "conflict") {
			out.conflicts.push({ change, ...r.conflict });
			continue;
		}
		let next: unknown = out.doc;
		try {
			for (const e of r.edits) {
				next = applyEdit(next, e).doc;
			}
		} catch (e) {
			if (e instanceof EditError) {
				out.conflicts.push({ change, reason: "gone", message: e.message });
				continue;
			}
			throw e;
		}
		if (opts.validate) {
			const now = errorKeys(next, opts);
			const added = [...now].filter(([k]) => !errors.has(k));
			if (added.length) {
				out.incompatible.push({ change, messages: added.map(([, m]) => m) });
				continue;
			}
			errors = now;
		}
		out.doc = next;
		out.edits.push(...r.edits);
		out.applied.push(change);
	}
	return out;
}

/**
 * The document's errors by a key that survives blocks moving (the error's
 * path anchored to its block's id) → "path: message".
 */
function errorKeys(doc: unknown, opts: RebaseOptions): Map<string, string> {
	const out = new Map<string, string>();
	for (const e of opts.validate?.(doc) ?? []) {
		const a = anchorPath(doc, e.path);
		out.set(
			JSON.stringify([a.block ?? null, a.path, e.message]),
			`${e.path}: ${e.message}`,
		);
	}
	return out;
}

type Carried =
	| { kind: "edit"; edits: PathEdit[] }
	| { kind: "done" }
	| { kind: "conflict"; conflict: Omit<Conflict, "change"> };

const conflict = (
	reason: ConflictReason,
	values: Omit<Conflict, "change" | "reason"> = {},
): Carried => ({ kind: "conflict", conflict: { reason, ...values } });

function carry(change: Change, doc: unknown, placed: Set<string>): Carried {
	switch (change.op) {
		case "set":
		case "unset": {
			const holder =
				change.block === undefined ? "" : findBlock(doc, change.block);
			if (holder === undefined) {
				return conflict("gone");
			}
			const published = valueAtPath(doc, join(holder, change.path));
			const value = change.op === "set" ? change.value : undefined;
			if (equal(published, value)) {
				return { kind: "done" };
			}
			if (!equal(published, change.base)) {
				return conflict("changed", {
					base: change.base,
					published,
					changeset: value,
				});
			}
			// Blocks the value holds that the document has elsewhere: placing
			// them would put them there twice.
			const twice = elsewhere(doc, value, published);
			if (twice) {
				return conflict("changed", { published: twice, changeset: value });
			}
			const edit: PathEdit =
				change.op === "set"
					? { op: "set", path: change.path, value: change.value }
					: { op: "unset", path: change.path };
			return { kind: "edit", edits: [anchored(edit, change.block)] };
		}
		case "insert": {
			const existing = findBlock(doc, change.value.id);
			if (existing !== undefined) {
				const published = valueAtPath(doc, existing);
				return equal(published, change.value)
					? { kind: "done" }
					: conflict("changed", { published, changeset: change.value });
			}
			const twice = elsewhere(doc, change.value, undefined);
			if (twice) {
				return conflict("changed", {
					published: twice,
					changeset: change.value,
				});
			}
			const place = position(doc, change.list, change.after, undefined);
			if (place.kind === "conflict") {
				return place;
			}
			return {
				kind: "edit",
				edits: [
					anchored(
						{
							op: "insert",
							path: change.list.path,
							index: place.index,
							value: change.value,
						},
						change.list.block,
					),
				],
			};
		}
		case "remove": {
			const at = findBlock(doc, change.block);
			if (at === undefined) {
				return { kind: "done" };
			}
			const published = valueAtPath(doc, at);
			if (!equal(published, change.base)) {
				// The block the changeset removes was changed since: keep both views.
				return conflict("changed", {
					base: change.base,
					published,
					changeset: undefined,
				});
			}
			return {
				kind: "edit",
				edits: [{ op: "remove", block: change.block, path: "" }],
			};
		}
		case "move": {
			const now = placeOf(doc, change.block);
			if (now === undefined) {
				return conflict("gone");
			}
			const place = position(doc, change.list, change.after, change.block);
			if (place.kind === "conflict") {
				return place;
			}
			if (place.already) {
				return { kind: "done" };
			}
			if (movedOnMain(now, change.from, placed)) {
				return conflict("changed", {
					base: change.from,
					published: { list: now.list, prev: now.prev, next: now.next },
					changeset: { list: change.list, after: change.after },
				});
			}
			const edit: PathEdit = {
				op: "move",
				block: change.block,
				from: "",
				to: change.list.path,
				index: place.index,
			};
			if (change.list.block !== undefined) {
				edit.toBlock = change.list.block;
			}
			// A list the block is the first of: created first.
			const create: PathEdit[] = place.exists
				? []
				: [
						anchored(
							{ op: "set", path: change.list.path, value: [] },
							change.list.block,
						),
					];
			return { kind: "edit", edits: [...create, edit] };
		}
	}
}

/**
 * The first block id in `value` (beyond those already in `published`)
 * that the document has: the block found there, else undefined.
 */
function elsewhere(
	doc: unknown,
	value: unknown,
	published: unknown,
): unknown | undefined {
	const here = innerIds(published, true);
	for (const id of innerIds(value, true)) {
		if (here.includes(id)) {
			continue;
		}
		const at = findBlock(doc, id);
		if (at !== undefined) {
			return valueAtPath(doc, at);
		}
	}
	return undefined;
}

interface Place {
	list: ListRef;
	ids: unknown[];
	index: number;
	prev: string | null;
	next: string | null;
}

/** Where a block is now: its list (anchored) and neighbours. */
function placeOf(doc: unknown, id: string): Place | undefined {
	const at = findBlock(doc, id);
	if (at === undefined) {
		return undefined;
	}
	const segs = splitPath(at);
	const listPath = segs.slice(0, -1).join("/");
	const ids = ((valueAtPath(doc, listPath) ?? []) as unknown[]).map((x) =>
		isPlain(x) ? x.id : undefined,
	);
	const index = Number(segs.at(-1));
	const near = (i: number) => {
		const x = ids[i];
		return typeof x === "string" ? x : null;
	};
	return {
		list: anchorPath(doc, listPath),
		ids,
		index,
		prev: near(index - 1),
		next: near(index + 1),
	};
}

/**
 * Whether main moved the block since the base: another list, or on the
 * wrong side of a base neighbour that is still there and that the
 * changeset does not place itself.
 */
function movedOnMain(
	now: Place,
	from: BasePlace,
	placed: Set<string>,
): boolean {
	if (key(now.list) !== key(from.list)) {
		return true;
	}
	const before = (id: string | null) =>
		id !== null && !placed.has(id) && now.ids.indexOf(id) > now.index;
	const after = (id: string | null) =>
		id !== null &&
		!placed.has(id) &&
		now.ids.includes(id) &&
		now.ids.indexOf(id) < now.index;
	return before(from.prev) || after(from.next);
}

/**
 * Index in the list for a block after `after` (`moving` taken out first).
 * `already`: the moving block sits right there.
 */
function position(
	doc: unknown,
	list: ListRef,
	after: string | null,
	moving: string | undefined,
):
	| { kind: "at"; index: number; already: boolean; exists: boolean }
	| { kind: "conflict"; conflict: Omit<Conflict, "change"> } {
	const holder = list.block === undefined ? "" : findBlock(doc, list.block);
	if (holder === undefined) {
		return { kind: "conflict", conflict: { reason: "gone" } };
	}
	const value = valueAtPath(doc, join(holder, list.path));
	if (value !== undefined && !Array.isArray(value)) {
		return { kind: "conflict", conflict: { reason: "gone" } };
	}
	const ids = ((value ?? []) as unknown[]).map((x) =>
		isPlain(x) ? x.id : undefined,
	);
	const without = ids.filter((id) => id !== moving);
	let index = 0;
	if (after !== null) {
		const i = without.indexOf(after);
		if (i < 0) {
			return { kind: "conflict", conflict: { reason: "neighbour" } };
		}
		index = i + 1;
	}
	const already =
		moving !== undefined &&
		ids.includes(moving) &&
		ids.indexOf(moving) === index;
	return { kind: "at", index, already, exists: value !== undefined };
}

// ----------------------------------------------------------------- helpers

function anchored(edit: PathEdit, block: string | undefined): PathEdit {
	return block === undefined ? edit : ({ ...edit, block } as PathEdit);
}

function anchor(at: ListRef): { block?: string; path: string } {
	return at.block === undefined
		? { path: at.path }
		: { block: at.block, path: at.path };
}

function step(at: ListRef, k: string | number): ListRef {
	return { ...at, path: join(at.path, String(k)) };
}

function join(a: string, b: string): string {
	if (a === "") {
		return b;
	}
	return b === "" ? a : `${a}/${b}`;
}

function key(at: ListRef | undefined): string {
	return at ? JSON.stringify([at.block ?? null, at.path]) : "";
}

function isBlockNode(node: unknown): node is Record<string, unknown> {
	return (
		isPlain(node) && typeof node.type === "string" && /^[A-Z]/.test(node.type)
	);
}

function idOf(node: Record<string, unknown>): string | undefined {
	return isBlockNode(node) && typeof node.id === "string" && node.id
		? node.id
		: undefined;
}

/** A list of blocks that all have ids, none twice (an empty list too). */
function aligned(list: unknown[]): boolean {
	const ids = new Set<string>();
	for (const x of list) {
		const id = isBlockNode(x) ? idOf(x) : undefined;
		if (!id || ids.has(id)) {
			return false;
		}
		ids.add(id);
	}
	return true;
}

function nonEmpty(v: unknown): boolean {
	return Array.isArray(v) && v.length > 0;
}

/** Aligned, and every block indexed (no id used twice in the document). */
function alignable(list: unknown, index: Map<string, Located>): boolean {
	return (
		Array.isArray(list) &&
		aligned(list) &&
		list.every((x) => index.has((x as Block).id))
	);
}

function equal(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((x, i) => equal(x, b[i]));
	}
	if (isPlain(a) && isPlain(b)) {
		const ka = Object.keys(a);
		return (
			ka.length === Object.keys(b).length &&
			ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
		);
	}
	return false;
}
