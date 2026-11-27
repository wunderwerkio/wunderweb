// Changesets: netChanges (what a draft changed) and rebase (carried onto a
// newer version), one test per row of the merge table and the cases the
// plan names (wunderweb plan m3wn47, step 1.3).

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	applyEdit,
	blockSpecs,
	type Change,
	compile,
	netChanges,
	type Rebased,
	readBlocks,
	rebase,
	Validator,
} from "../src/index.js";

// biome-ignore lint/suspicious/noExplicitAny: assertions on untyped documents
type Doc = any;

const text = (id: string, body: string, extra: object = {}) => ({
	type: "Text",
	id,
	body,
	...extra,
});

/** A page: blocks a, b, c; b holds a Buttons block d in `after`. */
function base(): Doc {
	return {
		id: "home",
		title: "Home",
		path: "/",
		blocks: [
			text("aaaaaaaa", "<p>a</p>"),
			text("bbbbbbbb", "<p>b</p>", {
				after: [
					{
						type: "Buttons",
						id: "dddddddd",
						items: [{ label: "Go", url: "/" }],
					},
				],
			}),
			text("cccccccc", "<p>c</p>"),
		],
	};
}

const edit = (doc: Doc, f: (d: Doc) => void): Doc => {
	const out = structuredClone(doc);
	f(out);
	return out;
};

const ids = (doc: Doc) => doc.blocks.map((b: Doc) => b.id);

/** Every change is reported exactly once: applied, done, conflict or incompatible. */
function accounted(changes: Change[], r: Rebased) {
	const all = [
		...r.applied,
		...r.done,
		...r.conflicts.map((c) => c.change),
		...r.incompatible.map((c) => c.change),
	];
	expect(all.length).toBe(changes.length);
	expect(new Set(all)).toEqual(new Set(changes));
}

/** Rebase and check the bookkeeping, and that `edits` turn current into doc. */
function carry(
	b: Doc,
	proposed: Doc,
	current: Doc,
	validate?: (doc: unknown) => { path: string; message: string }[],
): Rebased {
	const changes = netChanges(b, proposed);
	const r = rebase(changes, b, current, validate ? { validate } : {});
	accounted(changes, r);
	let replayed: unknown = current;
	for (const e of r.edits) {
		replayed = applyEdit(replayed, e).doc;
	}
	expect(replayed).toEqual(r.doc);
	// No block is ever there twice.
	const all = allIds(r.doc);
	expect(all.length, `duplicate ids in ${JSON.stringify(all)}`).toBe(
		new Set(all).size,
	);
	return r;
}

function allIds(doc: unknown): string[] {
	const out: string[] = [];
	const visit = (n: unknown) => {
		if (Array.isArray(n)) {
			n.forEach(visit);
		} else if (n && typeof n === "object") {
			const o = n as Doc;
			if (typeof o.type === "string" && typeof o.id === "string") {
				out.push(o.id);
			}
			Object.values(o).forEach(visit);
		}
	};
	visit(doc);
	return out;
}

describe("netChanges", () => {
	it("is empty for equal documents", () => {
		expect(netChanges(base(), base())).toEqual([]);
	});

	it("addresses fields by block id, root fields by path", () => {
		const p = edit(base(), (d) => {
			d.title = "Start";
			d.blocks[1].body = "<p>B</p>";
			d.blocks[1].after[0].justify = { base: "center" };
			delete d.blocks[2].body;
		});
		expect(netChanges(base(), p)).toEqual([
			{ op: "set", path: "title", base: "Home", value: "Start" },
			{
				op: "set",
				block: "bbbbbbbb",
				path: "body",
				base: "<p>b</p>",
				value: "<p>B</p>",
			},
			{
				op: "set",
				block: "dddddddd",
				path: "justify",
				base: undefined,
				value: { base: "center" },
			},
			{ op: "unset", block: "cccccccc", path: "body", base: "<p>c</p>" },
		]);
	});

	it("aligns block lists by id: insert, remove and move, minimal", () => {
		const p = edit(base(), (d) => {
			const [a, b, c] = d.blocks;
			d.blocks = [c, a, text("eeeeeeee", "<p>e</p>")];
			void b;
		});
		expect(netChanges(base(), p)).toEqual([
			// One move (c stays, a goes after it; moving c instead is as short).
			{
				op: "move",
				block: "aaaaaaaa",
				list: { path: "blocks" },
				after: "cccccccc",
				from: { list: { path: "blocks" }, prev: null, next: "bbbbbbbb" },
			},
			{
				op: "insert",
				list: { path: "blocks" },
				after: "aaaaaaaa",
				value: text("eeeeeeee", "<p>e</p>"),
			},
			// b and the Buttons inside it: one removal.
			{ op: "remove", block: "bbbbbbbb", base: base().blocks[1] },
		]);
	});

	it("moves a block between lists", () => {
		// A list that exists on both sides: a move.
		const withList = edit(base(), (d) => {
			d.blocks[0].after = [];
		});
		const moved = edit(withList, (d) => {
			d.blocks[0].after = [d.blocks[1].after.pop()];
		});
		expect(netChanges(withList, moved)).toEqual([
			{
				op: "move",
				block: "dddddddd",
				list: { block: "aaaaaaaa", path: "after" },
				after: null,
				from: {
					list: { block: "bbbbbbbb", path: "after" },
					prev: null,
					next: null,
				},
			},
		]);
	});

	it("compares lists with blocks without ids by position, plain lists as one value", () => {
		const b = {
			blocks: [
				{ type: "Text", body: "x" },
				{ type: "Text", body: "y" },
			],
		};
		const p = {
			blocks: [
				{ type: "Text", body: "x" },
				{ type: "Text", body: "Y" },
			],
		};
		expect(netChanges(b, p)).toEqual([
			{ op: "set", path: "blocks/1/body", base: "y", value: "Y" },
		]);
		const longer = { blocks: [...p.blocks, { type: "Text", body: "z" }] };
		expect(netChanges(b, longer)).toEqual([
			{ op: "set", path: "blocks", base: b.blocks, value: longer.blocks },
		]);
		const items = edit(base(), (d) => {
			d.blocks[1].after[0].items[0].label = "Los";
		});
		expect(netChanges(base(), items)).toEqual([
			{
				op: "set",
				block: "dddddddd",
				path: "items",
				base: [{ label: "Go", url: "/" }],
				value: [{ label: "Los", url: "/" }],
			},
		]);
	});
});

describe("rebase: the merge table", () => {
	it("applies a value only the changeset changed", () => {
		const p = edit(base(), (d) => {
			d.blocks[0].body = "<p>A</p>";
		});
		const current = edit(base(), (d) => {
			d.title = "Published";
		});
		const r = carry(base(), p, current);
		expect(r.applied).toHaveLength(1);
		expect((r.doc as Doc).blocks[0].body).toBe("<p>A</p>");
		expect((r.doc as Doc).title).toBe("Published");
	});

	it("drops a change main already made with the same value", () => {
		const p = edit(base(), (d) => {
			d.blocks[0].body = "<p>A</p>";
		});
		const r = carry(base(), p, p);
		expect(r.done).toHaveLength(1);
		expect(r.edits).toEqual([]);
	});

	it("keeps base, published and changeset values when both changed a value", () => {
		const p = edit(base(), (d) => {
			d.blocks[0].body = "<p>mine</p>";
		});
		const current = edit(base(), (d) => {
			d.blocks[0].body = "<p>theirs</p>";
		});
		const r = carry(base(), p, current);
		expect(r.conflicts).toEqual([
			{
				change: expect.objectContaining({ block: "aaaaaaaa", path: "body" }),
				reason: "changed",
				base: "<p>a</p>",
				published: "<p>theirs</p>",
				changeset: "<p>mine</p>",
			},
		]);
		expect((r.doc as Doc).blocks[0].body).toBe("<p>theirs</p>");
	});

	it("reports a change to a block that is gone on main", () => {
		const p = edit(base(), (d) => {
			d.blocks[2].body = "<p>C</p>";
		});
		const current = edit(base(), (d) => {
			d.blocks.pop();
		});
		const r = carry(base(), p, current);
		expect(r.conflicts.map((c) => c.reason)).toEqual(["gone"]);
	});

	it("reports a change to a file that is gone on main", () => {
		const p = edit(base(), (d) => {
			d.blocks[0].body = "<p>A</p>";
			d.title = "New";
		});
		const r = carry(base(), p, {});
		expect(r.conflicts.map((c) => c.reason)).toEqual(["changed", "gone"]);
		expect(r.conflicts[0]?.published).toBeUndefined();
	});

	it("reports a block inserted next to a block that is gone", () => {
		const p = edit(base(), (d) => {
			d.blocks.splice(3, 0, text("eeeeeeee", "<p>e</p>"));
		});
		const current = edit(base(), (d) => {
			d.blocks.pop();
		});
		const r = carry(base(), p, current);
		expect(r.conflicts.map((c) => [c.reason, c.change.op])).toEqual([
			["neighbour", "insert"],
		]);
	});

	it("holds a change that no longer validates, with the validator's message", () => {
		const items = blockSpecs(
			readBlocks(
				join(import.meta.dirname, "..", "..", "..", "registry", "blocks"),
			),
		);
		const { schema } = compile(
			1,
			{ tokens: { ButtonVariant: ["primary"] } },
			items,
		);
		const validator = new Validator(schema);
		const validate = (doc: unknown) =>
			validator
				.validateDoc(
					{
						kind: "page",
						locale: "de",
						key: "home",
						file: "x.yaml",
						doc: doc as Doc,
					},
					{ docs: [], pages: new Map(), fragments: new Map() },
					{
						schema: 1,
						locales: ["de"],
						defaultLocale: "de",
						theme: "",
						content: "",
						generated: "",
						blocks: "",
						css: [],
					},
				)
				.filter((f) => f.level === "error")
				.map((f) => ({
					path: f.at.replace(/ \([^)]*\)$/, "").replace(/^\(root\)$/, ""),
					message: f.message,
				}));
		expect(validate(base())).toEqual([]);
		// The changeset sets a field main's schema no longer has (here: one
		// the schema never had, standing in for a removed field).
		const p = edit(base(), (d) => {
			d.blocks[0].tagline = "gone from the schema";
			d.blocks[1].body = "<p>B</p>";
		});
		// Main moved the blocks around and has an error of its own (an
		// empty body): moving it does not make the changeset's edits incompatible.
		const current = edit(base(), (d) => {
			d.blocks.reverse();
			d.blocks[0].body = "";
		});
		expect(validate(current)).toHaveLength(1);
		const r = carry(base(), p, current, validate);
		expect(r.incompatible).toEqual([
			{
				change: expect.objectContaining({ block: "aaaaaaaa", path: "tagline" }),
				messages: [expect.stringMatching(/^blocks\/2: .*tagline/)],
			},
		]);
		// The other change still applies; the incompatible one is held.
		expect((r.doc as Doc).blocks[1].body).toBe("<p>B</p>");
		expect((r.doc as Doc).blocks[2].tagline).toBeUndefined();
	});
});

describe("rebase: cases", () => {
	it("merges a reorder on main with a field edit in the changeset", () => {
		const p = edit(base(), (d) => {
			d.blocks[2].body = "<p>C</p>";
			d.blocks[1].after[0].items = [{ label: "Los", url: "/" }];
		});
		const current = edit(base(), (d) => {
			d.blocks.reverse();
		});
		const r = carry(base(), p, current);
		expect(r.conflicts).toEqual([]);
		expect(ids(r.doc)).toEqual(["cccccccc", "bbbbbbbb", "aaaaaaaa"]);
		expect((r.doc as Doc).blocks[0].body).toBe("<p>C</p>");
		expect((r.doc as Doc).blocks[1].after[0].items[0].label).toBe("Los");
	});

	it("carries a reorder in the changeset onto blocks main inserted", () => {
		const p = edit(base(), (d) => {
			d.blocks.push(d.blocks.shift());
		});
		const current = edit(base(), (d) => {
			d.blocks.splice(1, 0, text("ffffffff", "<p>main</p>"));
		});
		const r = carry(base(), p, current);
		expect(r.conflicts).toEqual([]);
		expect(ids(r.doc)).toEqual([
			"ffffffff",
			"bbbbbbbb",
			"cccccccc",
			"aaaaaaaa",
		]);
	});

	it("inserts after the same neighbour when main moved it", () => {
		const p = edit(base(), (d) => {
			d.blocks.splice(1, 0, text("eeeeeeee", "<p>e</p>"));
		});
		const current = edit(base(), (d) => {
			d.blocks.push(d.blocks.shift());
		});
		const r = carry(base(), p, current);
		expect(ids(r.doc)).toEqual([
			"bbbbbbbb",
			"cccccccc",
			"aaaaaaaa",
			"eeeeeeee",
		]);
	});

	it("reports a removal of a block main changed since", () => {
		const p = edit(base(), (d) => {
			d.blocks.splice(1, 1);
		});
		const current = edit(base(), (d) => {
			d.blocks[1].body = "<p>edited on main</p>";
		});
		const r = carry(base(), p, current);
		expect(r.conflicts).toEqual([
			expect.objectContaining({
				reason: "changed",
				published: expect.objectContaining({ body: "<p>edited on main</p>" }),
				changeset: undefined,
			}),
		]);
		expect(ids(r.doc)).toContain("bbbbbbbb");
	});

	it("treats a removal main made too as done", () => {
		const p = edit(base(), (d) => {
			d.blocks.splice(1, 1);
		});
		const r = carry(base(), p, p);
		expect(r.done).toHaveLength(1);
	});

	it("moves a block into a block the changeset inserted", () => {
		const p = edit(base(), (d) => {
			const buttons = d.blocks[1].after.pop();
			d.blocks.push(text("eeeeeeee", "<p>e</p>", { after: [buttons] }));
		});
		const r = carry(base(), p, base());
		expect(r.conflicts).toEqual([]);
		expect(r.doc).toEqual(p);
	});

	it("moves a block into a list the base did not have, without copying it", () => {
		const p = edit(base(), (d) => {
			d.blocks[0].after = [d.blocks[1].after.pop()];
		});
		const changes = netChanges(base(), p);
		expect(changes.map((c) => c.op)).toEqual(["move"]);
		const r = carry(base(), p, base());
		expect(r.doc).toEqual(p);
	});

	it("moves a block into a new block placed before its old place", () => {
		const p = edit(base(), (d) => {
			const buttons = d.blocks[1].after.pop();
			d.blocks.splice(1, 0, text("eeeeeeee", "<p>e</p>", { after: [buttons] }));
		});
		const r = carry(base(), p, base());
		expect(r.conflicts).toEqual([]);
		expect(r.doc).toEqual(p);
	});

	it("unwraps a block: its child moved out, the block removed", () => {
		const p = edit(base(), (d) => {
			const buttons = d.blocks[1].after.pop();
			d.blocks.splice(1, 1, buttons);
		});
		const r = carry(base(), p, base());
		expect(r.conflicts).toEqual([]);
		expect(r.doc).toEqual(p);
	});

	it("drops a list of blocks the changeset emptied and removed", () => {
		const p = edit(base(), (d) => {
			delete d.blocks[1].after;
		});
		const r = carry(base(), p, base());
		expect(r.conflicts).toEqual([]);
		expect(r.doc).toEqual(p);
	});

	it("reports a move of a block main moved elsewhere", () => {
		const withList = edit(base(), (d) => {
			d.blocks[0].after = [];
			d.blocks[2].after = [];
		});
		const p = edit(withList, (d) => {
			d.blocks[0].after = [d.blocks[1].after.pop()];
		});
		const current = edit(withList, (d) => {
			d.blocks[2].after = [d.blocks[1].after.pop()];
		});
		const r = carry(withList, p, current);
		expect(r.conflicts).toEqual([
			expect.objectContaining({
				reason: "changed",
				published: expect.objectContaining({
					list: { block: "cccccccc", path: "after" },
				}),
				changeset: { list: { block: "aaaaaaaa", path: "after" }, after: null },
			}),
		]);
		expect((r.doc as Doc).blocks[2].after).toHaveLength(1);
	});

	it("reports a move into a list or next to a block that is gone", () => {
		const withList = edit(base(), (d) => {
			d.blocks[0].after = [];
		});
		const p = edit(withList, (d) => {
			d.blocks[0].after = [d.blocks[1].after.pop()];
		});
		const gone = carry(
			withList,
			p,
			edit(withList, (d) => {
				d.blocks.shift();
			}),
		);
		expect(gone.conflicts.map((c) => c.reason)).toEqual(["gone"]);
		const reorder = edit(base(), (d) => {
			d.blocks.push(d.blocks.shift());
		});
		const neighbour = carry(
			base(),
			reorder,
			edit(base(), (d) => {
				d.blocks.pop();
			}),
		);
		expect(neighbour.conflicts.map((c) => c.reason)).toEqual(["neighbour"]);
	});

	it("never loses a changeset value silently", () => {
		// Changesets and main versions that touch the same blocks every way:
		// each change is applied, already done, or reported.
		const changesets = [
			(d: Doc) => {
				d.blocks[0].body = "<p>x</p>";
			},
			(d: Doc) => {
				d.blocks.splice(1, 1);
			},
			(d: Doc) => {
				d.blocks.reverse();
			},
			(d: Doc) => {
				d.blocks.push(text("eeeeeeee", "<p>e</p>"));
			},
			(d: Doc) => {
				d.blocks[1].after[0].items = [];
			},
			(d: Doc) => {
				d.blocks[0].after = [d.blocks[1].after.pop()];
			},
			(d: Doc) => {
				d.blocks.splice(1, 1, d.blocks[1].after[0]);
			},
		];
		const mains = [
			(_: Doc) => {},
			(d: Doc) => {
				d.blocks[0].body = "<p>y</p>";
			},
			(d: Doc) => {
				d.blocks = [];
			},
			(d: Doc) => {
				d.blocks.splice(2, 1);
			},
			(d: Doc) => {
				d.blocks[1].after = [];
			},
			(d: Doc) => {
				d.blocks.unshift(text("ffffffff", "<p>f</p>"));
			},
			(d: Doc) => {
				d.blocks[2].after = [d.blocks[1].after.pop()];
			},
			(d: Doc) => {
				d.blocks.reverse();
			},
		];
		for (const [i, c] of changesets.entries()) {
			for (const [j, m] of mains.entries()) {
				const p = edit(base(), c);
				const current = edit(base(), m);
				const r = carry(base(), p, current);
				// Applied changes are in effect in the result; when nothing
				// conflicts, the result is the changeset on top of main.
				for (const change of r.applied) {
					const again = rebase([change], base(), r.doc);
					expect(again.done, `changeset ${i}, main ${j}`).toEqual([change]);
				}
				if (j === 0) {
					expect(r.doc, `changeset ${i} on an unchanged main`).toEqual(p);
				}
			}
		}
	});
});
