import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	blockIds,
	blockSpecs,
	buildModel,
	buildSite,
	clientConsent,
	compile,
	type Finding,
	loadCore,
	loadProject,
	type ProjectBlockSpec,
	readBlocks,
	readContent,
	SchemaError,
	safelist,
	type Theme,
	takenIds,
	toThemeCss,
	Validator,
	Walker,
	withDefaults,
	withNewIds,
} from "../src/index.js";

// biome-ignore lint/suspicious/noExplicitAny: assertions on untyped documents
type Doc = Record<string, any>;

const REGISTRY = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"registry",
	"blocks",
);
/** Every item of the wunderweb registry, as installed in a project. */
const ITEMS = blockSpecs(readBlocks(REGISTRY));

const THEME: Theme = {
	tokens: {
		Color: { ink: "#111", paper: "#fff", brand: "#c36e01" },
		ButtonVariant: ["primary"],
		ContainerSize: {
			default: { max: "1280px", gutter: { base: "16px", md: "24px" } },
		},
		Breakpoint: { md: 768, lg: 1024 },
	},
};

const QUOTE: ProjectBlockSpec = {
	in: ["Leaf"],
	traits: ["Box"],
	fields: { text: "RichText", author: "Person", "cite?": "Link" },
};
const HERO: ProjectBlockSpec = {
	in: ["Row"],
	traits: ["Box"],
	fields: { title: "string", "media?": "Content", "aside?": "Leaf[]" },
};

const CONFIG = {
	schema: 1,
	locales: ["de"],
	defaultLocale: "de",
	theme: "",
	content: "",
	generated: "",
	blocks: "",
	css: [],
};

/** Problems of a model that must not build. */
function problems(
	blocks: Record<string, ProjectBlockSpec>,
	theme: Theme = {},
): string {
	try {
		buildModel(loadCore(1), theme, blocks);
	} catch (e) {
		if (e instanceof SchemaError) {
			return e.problems.join("\n");
		}
		throw e;
	}
	throw new Error("model built without errors");
}

/** Findings of a one-page site. */
function validate(
	blocks: unknown[],
	extra: Record<string, ProjectBlockSpec> = {},
	theme: Theme = THEME,
): Finding[] {
	const { schema } = compile(1, theme, { ...ITEMS, ...extra });
	return new Validator(schema).validateDoc(
		{
			kind: "page",
			locale: "de",
			key: "x",
			file: "x.yaml",
			doc: { title: "x", path: "/", blocks },
		},
		{ docs: [], pages: new Map(), fragments: new Map() },
		CONFIG,
	);
}

const messages = (f: Finding[]) =>
	f.map((x) => `${x.at}: ${x.message}`).join("\n");

describe("contract", () => {
	it("core alone: roles are extension points, only PageBlock holds Include", () => {
		const { model, schema, types } = compile(1, {});
		expect(Object.keys(model.blocks)).toEqual(["Include"]);
		expect(Object.keys(model.roles)).toEqual([
			"PageBlock",
			"Row",
			"Content",
			"Leaf",
			"Inline",
		]);
		const defs = schema.$defs as Doc;
		expect(defs.PageBlock.oneOf).toEqual([{ $ref: "#/$defs/Include" }]);
		// An empty role accepts nothing, and stays a valid schema.
		expect(defs.Leaf).toMatchObject({ "x-role": 3, not: {} });
		expect(types).toContain("export type Leaf = never;");
		expect(types).toContain("export type PageBlock = Row | IncludeBlock;");
	});

	it("an empty role rejects content instead of failing to compile", () => {
		const { schema } = compile(1, {});
		const found = new Validator(schema).validateDoc(
			{
				kind: "page",
				locale: "de",
				key: "x",
				file: "x.yaml",
				doc: { title: "x", path: "/", blocks: [{ type: "Text", body: "x" }] },
			},
			{ docs: [], pages: new Map(), fragments: new Map() },
			CONFIG,
		);
		expect(found.length).toBeGreaterThan(0);
	});

	it("every registry item compiles against the core alone", () => {
		for (const [name, spec] of Object.entries(ITEMS)) {
			const deps = Object.fromEntries(
				Object.entries(ITEMS).filter(([n]) =>
					JSON.stringify(spec.fields ?? {}).includes(`"${n}"`),
				),
			);
			expect(
				() => compile(1, {}, { ...deps, [name]: spec }),
				name,
			).not.toThrow();
		}
		// And all of them together (no clashing types).
		expect(() => compile(1, {}, ITEMS)).not.toThrow();
	});

	it("project blocks join any role; members appear in the role unions", () => {
		const m = buildModel(loadCore(1), THEME, {
			...ITEMS,
			Quote: QUOTE,
			Hero: HERO,
			Top: { in: ["PageBlock"], traits: ["Box"], fields: { rows: "Row[]" } },
			Group: { in: ["Content"], fields: { items: "Leaf[]" } },
			Tag: { in: ["Inline"], fields: { text: "string" } },
		});
		expect(m.roles.Leaf?.members).toContain("Quote");
		expect(m.roles.Row?.members).toContain("Hero");
		expect(m.roles.PageBlock?.members).toContain("Top");
		expect(m.roles.Content?.members).toContain("Group");
		expect(m.roles.Inline?.members).toContain("Tag");
		expect(m.roles.Inline?.members).not.toContain("Quote");
		expect(m.blocks.Hero?.roles).toEqual(["Row"]);
	});

	it("emits role and doc of each block, and block rules", () => {
		const { schema } = compile(1, {}, ITEMS);
		const defs = schema.$defs as Doc;
		expect(defs.Text["x-roles"]).toEqual(["Leaf", "Inline"]);
		expect(defs.Stack.description).toMatch(/stacked vertically/);
		expect(defs.Tiles["x-rules"]).toContainEqual({
			kind: "childPlace",
			fields: ["colSpan", "rowSpan"],
			slot: "items",
			when: [{ path: "grid.mode", values: ["grid"], default: "grid" }],
		});
	});

	it("a union of role aliases emits valid JSON Schema", () => {
		const { schema } = compile(
			1,
			{ types: { Mixed: "Row | Leaf" } },
			{
				...ITEMS,
				Pair: { in: ["PageBlock"], fields: { items: "Mixed[]" } },
			},
		);
		const defs = schema.$defs as Doc;
		const names = defs.Mixed.oneOf.map((x: Doc) => x.$ref.split("/").pop());
		expect(names).toContain("Tiles");
		expect(names).toContain("Text");
		expect(new Set(names).size).toBe(names.length);
		const found = validate(
			[{ type: "Pair", items: [{ type: "Text", body: "<p>x</p>" }] }],
			{ Pair: { in: ["PageBlock"], fields: { items: "Mixed[]" } } },
			{
				...THEME,
				types: { Mixed: "Row | Leaf" },
			},
		);
		expect(found).toEqual([]);
	});

	it("rejects blocks without a role or with an unknown one", () => {
		const p = problems({
			Loose: { fields: { x: "string" } } as never,
			Page2: { in: ["Page"], fields: {} },
		});
		expect(p).toMatch(/block Loose: "in" must list its roles/);
		expect(p).toMatch(/block Page2: unknown role "Page"/);
	});

	it("rejects slots accepting the block's own or a higher role", () => {
		const p = problems(
			{
				Deep: { in: ["Leaf"], fields: { items: "Row[]" } },
				Same: { in: ["Row"], fields: { items: "Row[]" } },
				Nested: { in: ["Content"], fields: { x: "Holder" } },
				Tiny: { in: ["Leaf", "Inline"], fields: { items: "Leaf[]" } },
			},
			{ types: { Holder: { fields: { inner: "Content" } } } },
		);
		expect(p).toMatch(/Deep.items: slot accepts Row, which is not lower/);
		expect(p).toMatch(/Same.items: slot accepts Row/);
		// Roles reached through object types count.
		expect(p).toMatch(/Nested.x: slot accepts Content/);
		// A block joining Inline has no block slots.
		expect(p).toMatch(/Tiny.items: slot accepts Leaf/);
	});

	it("allows surround slots on any role, and lower-role slots", () => {
		expect(() =>
			buildModel(
				loadCore(1),
				{},
				{
					...ITEMS,
					Box2: {
						in: ["Leaf", "Inline"],
						traits: ["Box", "Surround"],
						fields: {},
					},
					Hero: HERO,
				},
			),
		).not.toThrow();
	});

	it("rejects recursive block references", () => {
		const p = problems({
			A: { in: ["Leaf"], fields: { b: "B" } },
			B: { in: ["Leaf"], fields: { a: "A" } },
		});
		expect(p).toMatch(/recursive block reference \(A → B → A\)/);
	});

	it("rejects unknown types, clashes and style escape hatches", () => {
		const p = problems({
			Card2: { in: ["Leaf"], fields: { x: "Nope", className: "string" } },
			Include: { in: ["Leaf"], fields: {} },
			Asset: { in: ["Leaf"], fields: {} },
			Styled: { in: ["Leaf"], fields: { "style?": "string" } },
		});
		expect(p).toMatch(/Card2.x: unknown type "Nope"/);
		expect(p).toMatch(/Card2.className: style escape hatches are not allowed/);
		expect(p).toMatch(/Styled.style: style escape hatches/);
		expect(p).toMatch(/block Include: clashes with a core name/);
		expect(p).toMatch(/block Asset: clashes with a core name/);
		// Typed fields may use such names (Divider.style: LineStyle).
		expect(() =>
			compile(1, {}, { Divider: ITEMS.Divider as ProjectBlockSpec }),
		).not.toThrow();
	});

	it("rejects a type declared differently by two blocks, accepts identical ones", () => {
		const p = problems({
			A: {
				in: ["Leaf"],
				fields: { x: "Stars" },
				types: { Stars: { type: "number" } },
			},
			B: {
				in: ["Leaf"],
				fields: { x: "Stars" },
				types: { Stars: { type: "integer" } },
			},
		});
		expect(p).toMatch(/type "Stars" already declared differently by block A/);
		expect(() =>
			compile(
				1,
				{},
				{
					Person: ITEMS.Person as ProjectBlockSpec,
					Rating: ITEMS.Rating as ProjectBlockSpec,
				},
			),
		).not.toThrow();
	});

	it("rejects a pinned contract major other than the project's", () => {
		const p = problems({
			Old: {
				in: ["Leaf"],
				fields: {},
				provenance: {
					registry: "wunderweb",
					item: "Old",
					ref: "x",
					commit: "y",
					schema: 2,
				},
			},
		});
		expect(p).toMatch(/block Old: pins contract major 2, the project uses 1/);
	});

	it("reports malformed block definitions, rules and provenance", () => {
		const p = problems({
			Null: null as never,
			Rules: { in: ["Leaf"], fields: {}, rules: "x" as never },
			Scalar: { in: ["Leaf"], fields: {}, rules: [null as never] },
			Pinned: {
				in: ["Leaf"],
				fields: {},
				provenance: { registry: "", item: "Pinned", schema: 1 } as never,
			},
		});
		expect(p).toMatch(/block Null: block definition must be a map/);
		expect(p).toMatch(/block Rules.rules: must be a list/);
		expect(p).toMatch(/block Scalar.rules\[0\]: unknown rule/);
		expect(p).toMatch(/Pinned.provenance.registry: non-empty string required/);
		expect(p).toMatch(/Pinned.provenance.commit: non-empty string required/);
	});

	it("points moved theme keys to their new place", () => {
		const p = problems({}, { blocks: {}, defaults: {} } as never);
		expect(p).toMatch(/unknown key "blocks" \(blocks are project files now/);
		expect(p).toMatch(/unknown key "defaults" \(block defaults belong/);
	});
});

describe("block ids", () => {
	const text = (id?: string) => ({
		type: "Text",
		...(id === undefined ? {} : { id }),
		body: "<p>x</p>",
	});

	it("are optional; hand-written slugs and generated ids are valid", () => {
		expect(validate([text(), text("kurzanfrage"), text("p429")])).toEqual([]);
	});

	it.each(["a", "a".repeat(64), "kurz-anfrage", "k3x9q2m1", "0lead"])(
		"accepts id %j",
		(id) => {
			expect(validate([text(id)])).toEqual([]);
		},
	);

	it.each(["Not Valid", "-lead", "", "a".repeat(65), "ümlaut", 42])(
		"rejects id %j",
		(id) => {
			const found = validate([{ type: "Text", id, body: "<p>x</p>" }]);
			expect(found.map((f) => [f.level, f.at])).toEqual([
				["error", "blocks/0/id (Text)"],
			]);
		},
	);

	it("must be unique within the file, nested and Include overrides included", () => {
		const found = validate([
			{
				...text("aaaaaaaa"),
				after: [
					{
						type: "Buttons",
						id: "bbbbbbbb",
						items: [{ label: "Go", url: "/" }],
					},
				],
			},
			text("bbbbbbbb"),
			{
				type: "Include",
				id: "cccccccc",
				ref: "x",
				with: [{ slot: "s", block: text("aaaaaaaa") }],
			},
		]).filter((f) => f.message.includes("block id"));
		expect(found.map((f) => [f.level, f.at, f.message])).toEqual([
			[
				"error",
				"blocks/1 (Text)",
				'block id "bbbbbbbb" already used at blocks/0/after/0; ids must be unique within a file (`wunderweb format` assigns a new one)',
			],
			[
				"error",
				"blocks/2/with/0/block (Text)",
				'block id "aaaaaaaa" already used at blocks/0; ids must be unique within a file (`wunderweb format` assigns a new one)',
			],
		]);
	});

	it("are listed per document, and a copy gets fresh ones for itself and its blocks", () => {
		const { schema } = compile(1, THEME, ITEMS);
		const walker = new Walker(schema);
		const doc = {
			title: "x",
			path: "/",
			blocks: [
				{ ...text("aaaaaaaa"), after: [{ type: "Buttons", items: [] }] },
			],
		};
		const ids = blockIds(walker, doc, "Page");
		expect(ids.blocks.map((b) => b.path)).toEqual([
			"blocks/0",
			"blocks/0/after/0",
		]);
		expect(ids.missing.map((b) => b.path)).toEqual(["blocks/0/after/0"]);

		const taken = takenIds(walker, doc, "Page");
		const copy = withNewIds(walker, doc.blocks[0] as Doc, taken);
		expect(copy.id).toMatch(/^[a-z0-9]{8}$/);
		expect(copy.id).not.toBe("aaaaaaaa");
		expect((copy.after[0] as Doc).id).toMatch(/^[a-z0-9]{8}$/);
		// The first key after `type`, as `format` writes it.
		expect(Object.keys(copy)).toEqual(["type", "id", "body", "after"]);
		expect(Object.keys(copy.after[0])).toEqual(["type", "id", "items"]);
		// The source stays as it was.
		expect(doc.blocks[0]?.id).toBe("aaaaaaaa");
		expect(doc.blocks[0]?.after[0]).toEqual({ type: "Buttons", items: [] });
		expect(taken.size).toBe(3);
	});

	it("do not reach the components; the source map carries them", () => {
		// A block whose list items (values, not blocks) have an `id` of their own.
		const Steps: ProjectBlockSpec = {
			in: ["Leaf"],
			fields: { steps: "Step[]" },
			types: { Step: { fields: { id: "string", label: "string" } } },
		};
		const { schema } = compile(1, THEME, { ...ITEMS, Steps });
		const validator = new Validator(schema);
		const page = {
			kind: "page" as const,
			locale: "de",
			key: "x",
			file: "de/pages/x.yaml",
			doc: {
				id: "x",
				title: "x",
				path: "/",
				blocks: [
					{
						...text("aaaaaaaa"),
						after: [
							{
								type: "Buttons",
								id: "bbbbbbbb",
								items: [{ label: "Go", url: "/" }],
							},
						],
					},
					{
						type: "Include",
						id: "iiiiiiii",
						ref: "faq",
						with: [{ slot: "intro", block: text("oooooooo") }],
					},
					{
						type: "Steps",
						id: "ssssssss",
						steps: [{ id: "first", label: "One" }],
					},
				],
			},
		};
		const fragment = {
			kind: "fragment" as const,
			locale: "de",
			key: "faq",
			file: "de/fragments/faq.yaml",
			doc: {
				fragment: "faq",
				blocks: [{ ...text("ffffffff"), slot: "intro" }, text("gggggggg")],
			},
		};
		const content = {
			docs: [page, fragment],
			pages: new Map([["de", new Map([["x", page]])]]),
			fragments: new Map([["de", new Map([["faq", fragment]])]]),
		};
		expect(
			validator
				.validateSite(content, CONFIG)
				.filter((f) => f.level === "error"),
		).toEqual([]);
		for (const sources of [false, true]) {
			const built = buildSite(validator, content, CONFIG, { sources }).pages[0];
			// Page ids are content: they stay.
			expect(built?.id).toBe("x");
			const blocks = built?.blocks as Doc[];
			expect(blocks.map((b) => b.type)).toEqual([
				"Text",
				"Text",
				"Text",
				"Steps",
			]);
			// Values keep their own `id`; only block ids go.
			expect(blocks[3]).toEqual({
				type: "Steps",
				steps: [{ id: "first", label: "One" }],
			});
			expect(blocks[0]?.id).toBeUndefined();
			expect(blocks[0]?.after[0].id).toBeUndefined();
			expect(blocks[0]?.after[0].items).toEqual([{ label: "Go", url: "/" }]);
			expect(blocks[1]?.id).toBeUndefined();
			expect(blocks[2]?.id).toBeUndefined();
			// The authored content is untouched.
			expect(page.doc.blocks[0]?.id).toBe("aaaaaaaa");
			if (sources) {
				const ids = Object.fromEntries(
					Object.entries(built?.sources?.blocks ?? {}).map(([k, o]) => [
						k,
						[o.file, o.id],
					]),
				);
				expect(ids).toEqual({
					"blocks/0": ["de/pages/x.yaml", "aaaaaaaa"],
					"blocks/0/after/0": ["de/pages/x.yaml", "bbbbbbbb"],
					// The slot override, authored in the page.
					"blocks/1": ["de/pages/x.yaml", "oooooooo"],
					"blocks/2": ["de/fragments/faq.yaml", "gggggggg"],
					"blocks/3": ["de/pages/x.yaml", "ssssssss"],
				});
			}
		}
	});
});

describe("core type extensions", () => {
	it("adds optional fields to core object types (schema and types)", () => {
		const { schema, types } = compile(
			1,
			{
				extend: {
					Button: { "subtitle?": { type: "string", doc: "Second line." } },
				},
			},
			ITEMS,
		);
		expect((schema.$defs as Doc).Button.properties.subtitle).toMatchObject({
			type: "string",
			description: "Second line.",
		});
		expect(types).toMatch(/interface Button \{[^}]*subtitle\?: string;/);
	});

	it("rejects required, changed or style fields and non-object types", () => {
		const p = problems(
			{},
			{
				extend: {
					Button: {
						level: "string",
						"label?": "string",
						"className?": "string",
					},
					Url: { "x?": "string" },
				},
			},
		);
		expect(p).toMatch(/Button.level: added fields must be optional/);
		expect(p).toMatch(/Button.label\?: core fields cannot be changed/);
		expect(p).toMatch(/Button.className\?: style escape hatches/);
		expect(p).toMatch(/extend.Url: only core object types can be extended/);
	});
});

describe("declarative rules", () => {
	it("oneOf: list items need title or body", () => {
		expect(
			messages(validate([{ type: "List", items: [{ link: { url: "/x" } }] }])),
		).toMatch(/every list item needs title or body/);
		expect(validate([{ type: "List", items: [{ title: "x" }] }])).toEqual([]);
	});

	it("only: mode-specific options, defaults count for unset modes", () => {
		expect(
			messages(
				validate([
					{
						type: "Tiles",
						grid: { alignX: "center" },
						items: [{ type: "Text", body: "<p>x</p>" }],
					},
				]),
			),
		).toMatch(/grid.alignX only apply when grid.mode is flex/);
		expect(
			messages(
				validate([
					{
						type: "Text",
						body: "<p>x</p>",
						after: [
							{
								type: "Gallery",
								columns: { base: 2 },
								mode: "marquee",
								items: [{ asset: { kind: "image", url: "/a.png" } }],
							},
						],
					},
				]),
			),
		).toMatch(/columns only apply when mode is grid or masonry/);
		expect(
			messages(
				validate([
					{
						type: "Media",
						asset: { kind: "image", url: "/a.png" },
						loop: true,
					},
				]),
			),
		).toMatch(/video options on an image/);
	});

	it("childPlace: spans only where the parent slot grants them", () => {
		const text = {
			type: "Text",
			body: "<p>x</p>",
			place: { colSpan: { md: 2 } },
		};
		expect(validate([{ type: "Tiles", items: [text] }])).toEqual([]);
		expect(
			messages(
				validate([{ type: "Tiles", grid: { mode: "flex" }, items: [text] }]),
			),
		).toMatch(/place.colSpan only apply in slots whose block grants them/);
		expect(messages(validate([text]))).toMatch(/place.colSpan only apply/);
	});

	it("actionOptional: a marked Button field needs no url or opens", () => {
		const Form: ProjectBlockSpec = {
			in: ["Leaf"],
			fields: { "submit?": "Button", "other?": "Button" },
			rules: [{ actionOptional: ["submit"] }],
		};
		expect(
			validate([{ type: "Form", submit: { label: "Go" } }], { Form }),
		).toEqual([]);
		expect(
			messages(validate([{ type: "Form", other: { label: "Go" } }], { Form })),
		).toMatch(/other \(Form\): button needs url or opens/);
	});

	it("ratioMax: split ratio parts fit the 24 column grid", () => {
		expect(
			messages(
				validate([
					{
						type: "SideBySide",
						start: { type: "Text", body: "<p>x</p>" },
						split: { ratio: { md: "20:8" } },
					},
				]),
			),
		).toMatch(/split.ratio 20:8 exceeds 24 columns/);
	});

	it("rejects rules on unknown fields or of unknown kinds", () => {
		const p = problems({
			X: {
				in: ["Leaf"],
				fields: { "a?": "string", "b?": "Button" },
				rules: [
					{ oneOf: ["a", "nope"] },
					{ only: ["a"], when: { missing: [1] } },
					{ actionOptional: ["a"] },
					{ childPlace: ["colSpan"], slot: "a" },
					{ sometimes: ["a"] },
				],
			},
		});
		expect(p).toMatch(/X.rules\[0\]: unknown field "nope"/);
		expect(p).toMatch(/X.rules\[1\]: unknown field "missing"/);
		expect(p).toMatch(/X.rules\[2\]: a is not a Button field/);
		expect(p).toMatch(/X.rules\[3\]: a is not a slot/);
		expect(p).toMatch(/X.rules\[4\]: unknown rule/);
	});

	it("surround depth is one: a block in before / after has no before / after", () => {
		expect(
			messages(
				validate([
					{
						type: "Text",
						body: "<p>x</p>",
						after: [
							{
								type: "Text",
								body: "<p>y</p>",
								after: [{ type: "Badge", text: "z" }],
							},
						],
					},
				]),
			),
		).toMatch(/block in after may not have before \/ after itself/);
	});
});

describe("defaults", () => {
	it("merges objects key by key and replaces responsive maps", () => {
		const { schema } = compile(1, THEME, {
			...ITEMS,
			Card: {
				...(ITEMS.Card as ProjectBlockSpec),
				defaults: {
					...(ITEMS.Card?.defaults ?? {}),
					background: { color: "paper" },
				},
			},
		});
		const v = new Validator(schema);
		const card = withDefaults(
			v.walker,
			{
				type: "Card",
				body: "<p>x</p>",
				layout: { container: "default", gap: { base: 1 } },
			},
			"Card",
		) as Doc;
		// Block default merged with the Background type default.
		expect(card.background).toEqual({ color: "paper", position: "cover" });
		// Default padding kept, content gap replaces the default map as a whole.
		expect(card.layout.padding.md).toEqual({
			top: 6,
			right: 6,
			bottom: 6,
			left: 6,
		});
		expect(card.layout.gap).toEqual({ base: 1 });
		expect(card.appearance).toEqual({ rounded: "xl", shadow: "lg" });
	});

	it("fills nested blocks", () => {
		const { schema } = compile(1, THEME, ITEMS);
		const v = new Validator(schema);
		const tiles = withDefaults(
			v.walker,
			{ type: "Tiles", items: [{ type: "Card", body: "<p>x</p>" }] },
			"Tiles",
		) as Doc;
		expect(tiles.items[0].appearance.shadow).toBe("lg");
	});

	it("rejects invalid defaults and names the field", () => {
		expect(() =>
			compile(
				1,
				{},
				{
					Bad: {
						in: ["Leaf"],
						traits: ["Box"],
						fields: {},
						defaults: { place: { bleed: true } },
					},
				},
			),
		).toThrow(/Bad.defaults.place: invalid default .*unknown field "bleed"/);
	});
});

describe("site", () => {
	function project(files: Record<string, string>) {
		const root = mkdtempSync(join(tmpdir(), "wc-site-"));
		for (const [f, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, f)), { recursive: true });
			writeFileSync(join(root, f), text);
		}
		return loadProject(root);
	}

	const files = {
		"wunderweb.config.yaml":
			"schema: 1\nlocales: [de, en]\ndefaultLocale: de\nassets: https://bucket.example.com/\nchrome: {header: header}\n",
		"content/de/pages/about.yaml": [
			"title: Über uns",
			"path: /ueber-uns",
			"blocks:",
			"  - type: Include",
			"    ref: cta",
			"    with: [{slot: text, block: {type: Text, body: '<p>Hallo</p>'}}]",
			"  - type: Media",
			"    asset: {kind: image, url: /img/team.jpg, width: 800, height: 600}",
		].join("\n"),
		"content/de/pages/home.yaml":
			"title: Start\npath: /\nblocks:\n  - {type: Text, body: '<p><a href=\"page:about#team\">Team</a></p>'}\n",
		"content/en/pages/about.yaml":
			"id: about\ntitle: About\npath: /about-us\nblocks:\n  - {type: Buttons, items: [{label: Home, url: 'page:home'}]}\n",
		"content/de/fragments/cta.yaml":
			"fragment: cta\nblocks:\n  - {type: Text, slot: text, body: '<p>x</p>'}\n  - {type: Buttons, items: [{label: Start, url: 'page:home'}]}\n",
		"content/de/fragments/header.yaml":
			"fragment: header\nblocks:\n  - {type: Text, body: '<p>DE</p>'}\n",
		"content/en/fragments/header.yaml":
			"fragment: header\nblocks:\n  - {type: Text, body: '<p>EN</p>'}\n",
	};

	it("resolves locales, translations, links, includes and assets", () => {
		const p = project(files);
		const { schema } = compile(1, {}, ITEMS);
		const v = new Validator(schema);
		const content = readContent(p);
		const findings = v.validateSite(content, p.config);
		expect(findings.filter((f) => f.level === "error")).toEqual([]);
		// en/home missing → the en about page links to the de home.
		expect(findings.map((f) => f.message)).toContain(
			'page link "page:home": no translation, links to the de page',
		);

		const site = buildSite(v, content, p.config);
		const byUrl = Object.fromEntries(site.pages.map((pg) => [pg.url, pg]));
		expect(Object.keys(byUrl).sort()).toEqual([
			"/",
			"/en/about-us",
			"/ueber-uns",
		]);

		const about = byUrl["/ueber-uns"];
		expect(about?.alternates).toEqual({ de: "/ueber-uns", en: "/en/about-us" });
		expect(about?.header[0]).toMatchObject({ body: "<p>DE</p>" });
		expect(byUrl["/en/about-us"]?.header[0]).toMatchObject({
			body: "<p>EN</p>",
		});

		// Include expanded with slot; page: links resolved; asset base applied.
		expect(about?.blocks.map((b) => b.type)).toEqual([
			"Text",
			"Buttons",
			"Media",
		]);
		expect(about?.blocks[0]).toMatchObject({ body: "<p>Hallo</p>" });
		expect(about?.blocks[1]).toMatchObject({ items: [{ url: "/" }] });
		expect(about?.blocks[2]).toMatchObject({
			asset: { url: "https://bucket.example.com/img/team.jpg" },
		});
		expect(byUrl["/"]?.blocks[0]).toMatchObject({
			body: '<p><a href="/ueber-uns#team">Team</a></p>',
		});
		expect(byUrl["/en/about-us"]?.blocks[0]).toMatchObject({
			items: [{ url: "/" }],
		});
	});

	it("rejects an Include replacing a slot", () => {
		const p = project({
			...files,
			"content/de/pages/about.yaml": [
				"title: Über uns",
				"path: /ueber-uns",
				"blocks:",
				"  - type: Include",
				"    ref: cta",
				"    with: [{slot: text, block: {type: Include, ref: header}}]",
			].join("\n"),
		});
		const v = new Validator(compile(1, {}, ITEMS).schema);
		const errors = v
			.validateSite(readContent(p), p.config)
			.map((f) => f.message)
			.join("\n");
		expect(errors).toMatch(/slot "text": an Include cannot replace a slot/);
	});

	it("rejects duplicate paths and locale prefixes", () => {
		const p = project({
			...files,
			"content/de/pages/dup.yaml":
				"title: Dup\npath: /ueber-uns\nblocks: [{type: Text, body: '<p>x</p>'}]\n",
			"content/de/pages/pre.yaml":
				"title: Pre\npath: /en/x\nblocks: [{type: Text, body: '<p>x</p>'}]\n",
		});
		const v = new Validator(compile(1, {}, ITEMS).schema);
		const errors = v
			.validateSite(readContent(p), p.config)
			.filter((f) => f.level === "error")
			.map((f) => f.message);
		expect(errors.join("\n")).toMatch(/path "\/ueber-uns" already used/);
		expect(errors.join("\n")).toMatch(/starts with locale "en"/);
	});

	// A lead form section (anchor "form") reused as the dialog of #form buttons.
	const dialogFiles = {
		"wunderweb.config.yaml": "schema: 1\nlocales: [de]\ndefaultLocale: de\n",
		"content/de/fragments/form.yaml":
			"fragment: form\nblocks:\n  - {type: Text, anchor: form, body: '<p>Form</p>'}\n",
		"content/de/pages/with.yaml": [
			"title: With",
			"path: /with",
			"blocks:",
			"  - {type: Buttons, items: [{label: a, url: '#form', opens: form}, {label: b, url: '#form', opens: form}]}",
			"  - {type: Include, ref: form}",
		].join("\n"),
		"content/de/pages/without.yaml": [
			"title: Without",
			"path: /without",
			"blocks:",
			"  - {type: Buttons, items: [{label: a, url: '#form', opens: form}, {label: b, opens: form}]}",
		].join("\n"),
	};

	it("lists each dialog once per page; #anchor + opens falls back to the dialog", () => {
		const p = project(dialogFiles);
		const v = new Validator(compile(1, {}, ITEMS).schema);
		const content = readContent(p);
		expect(
			v.validateSite(content, p.config).filter((f) => f.level === "error"),
		).toEqual([]);
		const site = buildSite(v, content, p.config);
		const byUrl = Object.fromEntries(site.pages.map((pg) => [pg.url, pg]));

		// Anchor on the page: plain links, no dialog.
		expect(byUrl["/with"]?.dialogs).toEqual({});
		expect(byUrl["/with"]?.blocks[0]).toMatchObject({
			items: [{ url: "#form" }, { url: "#form" }],
		});
		expect(JSON.stringify(byUrl["/with"]?.blocks[0])).not.toContain("opens");

		// No anchor: both buttons open the one dialog.
		expect(Object.keys(byUrl["/without"]?.dialogs ?? {})).toEqual(["form"]);
		expect(byUrl["/without"]?.blocks[0]).toMatchObject({
			items: [{ opens: "form" }, { opens: "form" }],
		});
		expect(JSON.stringify(byUrl["/without"]?.blocks[0])).not.toContain("#form");
	});

	it("rejects a dialog repeating an anchor of the page", () => {
		const p = project({
			...dialogFiles,
			"content/de/pages/with.yaml": [
				"title: With",
				"path: /with",
				"blocks:",
				"  - {type: Buttons, items: [{label: a, opens: form}]}",
				"  - {type: Include, ref: form}",
			].join("\n"),
		});
		const v = new Validator(compile(1, {}, ITEMS).schema);
		const errors = v
			.validateSite(readContent(p), p.config)
			.filter((f) => f.level === "error")
			.map((f) => f.message);
		expect(errors.join("\n")).toMatch(
			/dialog "form" repeats anchor "form" of the page/,
		);
	});
});

describe("consent", () => {
	function project(files: Record<string, string>) {
		const root = mkdtempSync(join(tmpdir(), "wc-consent-"));
		for (const [f, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, f)), { recursive: true });
			writeFileSync(join(root, f), text);
		}
		return loadProject(root);
	}

	const CONSENT = [
		"consent:",
		"  version: 1",
		"  privacy: 'page:privacy'",
		"  hosts: [example.com, www.example.com]",
		"  categories:",
		"    statistics: [analytics_storage]",
		"    marketing: [ad_storage, ad_user_data, ad_personalization]",
		"    media: []",
		"  vendors:",
		"    google: {ids: [G-TEST123, AW-123456]}",
		"    meta: {id: '1234567890', category: marketing}",
	].join("\n");
	const BASE_CONFIG = "schema: 1\nlocales: [de, en]\ndefaultLocale: de\n";

	const files = (config: string) => ({
		"wunderweb.config.yaml": `${BASE_CONFIG}${config}\n`,
		"content/de/pages/privacy.yaml": [
			"id: privacy",
			"title: Datenschutz",
			"path: /datenschutz",
			"blocks:",
			"  - type: Text",
			"    body: '<p>Ändern Sie Ihre Wahl in den <a href=\"consent:settings\">Cookie-Einstellungen</a>.</p>'",
			"  - type: Buttons",
			"    items: [{label: Cookie-Einstellungen, url: 'consent:settings'}]",
			"  - type: Media",
			"    asset: {kind: remote-video, url: 'https://www.youtube.com/watch?v=2oV060kNYfU'}",
		].join("\n"),
		"content/en/pages/privacy.yaml":
			"id: privacy\ntitle: Privacy\npath: /privacy\nblocks:\n  - {type: Text, body: '<p>x</p>'}\n",
	});

	const lint = (p: ReturnType<typeof project>) => {
		const v = new Validator(compile(1, {}, ITEMS).schema);
		const content = readContent(p);
		return { v, content, findings: v.validateSite(content, p.config) };
	};
	const errors = (f: Finding[]) =>
		f
			.filter((x) => x.level === "error")
			.map((x) => `${x.file} ${x.at}: ${x.message}`)
			.join("\n");

	it("a valid consent config loads; consent:settings is a Url", () => {
		const p = project(files(CONSENT));
		const { v, content, findings } = lint(p);
		expect(errors(findings)).toBe("");
		expect(findings.map((f) => f.message).join("\n")).not.toMatch(
			/remote-video/,
		);

		const site = buildSite(v, content, p.config);
		const byUrl = Object.fromEntries(site.pages.map((pg) => [pg.url, pg]));
		// The privacy page resolves per locale.
		expect(byUrl["/datenschutz"]?.consent?.privacy).toBe("/datenschutz");
		expect(byUrl["/en/privacy"]?.consent?.privacy).toBe("/en/privacy");
		expect(byUrl["/en/privacy"]?.consent?.categories.map((c) => c.id)).toEqual([
			"statistics",
			"marketing",
			"media",
		]);
	});

	it("vendor scripts load when idle by default; load: eager passes through", () => {
		const page = (config: string) => {
			const p = project(files(config));
			const { v, content, findings } = lint(p);
			expect(errors(findings)).toBe("");
			const consent = buildSite(v, content, p.config).pages[0]?.consent;
			if (!consent) {
				throw new Error("no consent on the page");
			}
			return consent;
		};
		const idle = page(CONSENT);
		expect(idle.load).toBe("idle");
		expect(clientConsent(idle).load).toBe("idle");
		const eager = page(CONSENT.replace("  hosts:", "  load: eager\n  hosts:"));
		expect(eager.load).toBe("eager");
		expect(clientConsent(eager, ["localhost"]).load).toBe("eager");
	});

	it("only necessary shares the choice variant unless style.reject names one", () => {
		const page = (config: string) => {
			const p = project(files(config));
			const { v, content, findings } = lint(p);
			expect(errors(findings)).toBe("");
			return buildSite(v, content, p.config).pages[0]?.consent;
		};
		expect(page(CONSENT)?.style.reject).toBeUndefined();
		const quiet = page(`${CONSENT}\n  style: {reject: secondary}`);
		expect(quiet?.style).toMatchObject({
			choice: "primary",
			reject: "secondary",
		});

		const p = project(files(`${CONSENT}\n  style: {reject: nope}`));
		expect(errors(lint(p).findings)).toMatch(
			/consent.style.reject: "nope" is not a ButtonVariant/,
		);
	});

	it("rejects an unknown load strategy", () => {
		for (const value of ["lazy", "true", "[idle]"]) {
			const p = project(
				files(CONSENT.replace("  hosts:", `  load: ${value}\n  hosts:`)),
			);
			expect(errors(lint(p).findings)).toMatch(
				/wunderweb.config.yaml consent.load: when vendor scripts load: idle or eager \(default idle\)/,
			);
		}
	});

	it("rejects an unknown Google consent signal", () => {
		const p = project(
			files(CONSENT.replace("[analytics_storage]", "[analytics_cookies]")),
		);
		expect(errors(lint(p).findings)).toMatch(
			/wunderweb.config.yaml consent.categories.statistics: unknown Google consent signal "analytics_cookies"/,
		);
	});

	it("rejects a vendor pointing to a missing category", () => {
		const p = project(
			files(CONSENT.replace("category: marketing", "category: ads")),
		);
		expect(errors(lint(p).findings)).toMatch(
			/wunderweb.config.yaml consent.vendors.meta.category: unknown category "ads"/,
		);
	});

	it("rejects config holes: hosts, privacy url, inherited names, text shapes, Google without signals", () => {
		const cases: [string, string, RegExp][] = [
			[
				"[example.com, www.example.com]",
				"[example.com, localhost]",
				/consent.hosts: production hostnames only/,
			],
			["'page:privacy'", "'//evil.example/x'", /consent.privacy: page:<id>/],
			[
				"category: marketing",
				"category: toString",
				/consent.vendors.meta.category: unknown category "toString"/,
			],
			[
				"    media: []",
				"    media: []\n  text: {en: {banner: {title: {x: 1}}, gate: {nope: x}}}",
				/consent.text.en.banner.title: text[\s\S]*consent.text.en.gate.nope: unknown field/,
			],
			["'page:privacy'", "'https://?'", /consent.privacy: page:<id>/],

			[
				"    media: []",
				"    media: []\n  text: {de: {categories: abc}}",
				/consent.text.de.categories: map of category id/,
			],
			[
				"    statistics: [analytics_storage]\n    marketing: [ad_storage, ad_user_data, ad_personalization]",
				"    statistics: []\n    marketing: []",
				/consent.vendors.google: no category grants a Google consent signal/,
			],
		];
		for (const [from, to, expected] of cases) {
			const p = project(files(CONSENT.replace(from, to)));
			expect(errors(lint(p).findings)).toMatch(expected);
		}
	});

	it("rejects a privacy page missing in the default locale", () => {
		const p = project({
			...files(CONSENT.replace("'page:privacy'", "'page:en-only'")),
			"content/en/pages/en-only.yaml":
				"id: en-only\ntitle: X\npath: /x\nblocks:\n  - {type: Text, body: '<p>x</p>'}\n",
		});
		expect(errors(lint(p).findings)).toMatch(
			/consent.privacy: no page with id "en-only" in the default locale/,
		);
	});

	it("checks single-quoted page links in rich text", () => {
		const p = project({
			...files(CONSENT),
			"content/de/pages/other.yaml":
				"id: other\ntitle: X\npath: /x\nblocks:\n  - {type: Text, body: \"<p><a href='page:missing'>x</a></p>\"}\n",
		});
		expect(errors(lint(p).findings)).toMatch(
			/de\/pages\/other.yaml blocks\/0\/body \(Text\): page link "page:missing": no page/,
		);
	});

	it("rejects a single-quoted consent:settings link without consent config", () => {
		const p = project({
			...files(""),
			"content/de/pages/privacy.yaml":
				"id: privacy\ntitle: Datenschutz\npath: /datenschutz\nblocks:\n  - {type: Text, body: \"<p><a href='consent:settings'>x</a></p>\"}\n",
		});
		expect(errors(lint(p).findings)).toMatch(
			/blocks\/0\/body \(Text\): "consent:settings" needs a consent section/,
		);
	});

	it("rejects consent:settings without consent config (Button and RichText)", () => {
		const p = project(files(""));
		const found = errors(lint(p).findings);
		expect(found).toMatch(
			/de\/pages\/privacy.yaml blocks\/0\/body \(Text\): "consent:settings" needs a consent section in wunderweb.config.yaml/,
		);
		expect(found).toMatch(
			/de\/pages\/privacy.yaml blocks\/1\/items\/0\/url \(Buttons\): "consent:settings" needs a consent section/,
		);
	});

	it("warns about remote-video without consent config", () => {
		const p = project({
			...files(""),
			"content/de/pages/privacy.yaml":
				"id: privacy\ntitle: Datenschutz\npath: /datenschutz\nblocks:\n  - {type: Media, asset: {kind: remote-video, url: 'https://youtu.be/2oV060kNYfU'}}\n",
		});
		const { findings } = lint(p);
		expect(errors(findings)).toBe("");
		expect(
			findings
				.filter((f) => f.level === "warning")
				.map((f) => `${f.at}: ${f.message}`),
		).toContain(
			"blocks/0/asset (Media): remote-video loads a third party without consent; add a consent section to wunderweb.config.yaml",
		);
	});
});

describe("tailwind", () => {
	it("safelists every responsive class the runtime emits", () => {
		const list = safelist(buildModel(loadCore(1), THEME));
		for (const c of [
			"pt-4",
			"md:pt-4",
			"lg:-mt-24",
			"md:col-span-7",
			"lg:grid-cols-(--wc-cols-lg)",
			"bg-brand",
			"text-ink",
			"md:hidden",
			"lg:flex",
			"rounded-xs",
			"md:max-w-(--wc-mw-md)",
			"wc-container-default",
		]) {
			expect(list).toContain(c);
		}
		// Breakpoints of other themes are not included.
		expect(list.some((c) => c.startsWith("sm:"))).toBe(false);
	});

	it("safelists class helper output regardless of the blocks (card media bleed)", () => {
		const list = safelist(buildModel(loadCore(1), THEME));
		for (const c of ["-ml-4", "-mr-4", "md:-ml-6", "md:-mr-6", "-mt-6"]) {
			expect(list).toContain(c);
		}
	});

	it("emits stepped containers: content width per step plus gutter", () => {
		const css = toThemeCss(
			buildModel(loadCore(1), {
				...THEME,
				tokens: {
					...THEME.tokens,
					ContainerSize: {
						page: {
							content: { md: "750px", lg: "970px", "1366": "1250px" },
							gutter: { base: "24px", md: "32px" },
						},
					},
				},
			}),
		);
		const block = css.slice(css.indexOf("@utility wc-container-page"));
		// Fluid below the first step, gutter only.
		expect(block).toMatch(
			/margin-inline: auto;\n {2}padding-inline: 24px;\n {2}@media \(width >= 768px\)/,
		);
		// Step: new gutter and content width + 2 gutters.
		expect(block).toMatch(
			/@media \(width >= 768px\) \{\n {4}padding-inline: 32px;\n {4}max-width: calc\(750px \+ 2 \* 32px\);/,
		);
		expect(block).toMatch(
			/@media \(width >= 1024px\) \{\n {4}max-width: calc\(970px \+ 2 \* 32px\);/,
		);
		// Numeric key = raw min-width in px.
		expect(block).toMatch(
			/@media \(width >= 1366px\) \{\n {4}max-width: calc\(1250px \+ 2 \* 32px\);/,
		);
	});

	it("emits theme css", () => {
		const css = toThemeCss(buildModel(loadCore(1), THEME));
		expect(css).toMatch(/--color-brand: #c36e01;/);
		expect(css).toMatch(/--breakpoint-md: 768px;/);
		expect(css).toMatch(
			/@utility wc-container-default \{[^}]*max-width: 1280px;/,
		);
		expect(css).toMatch(
			/@media \(width >= 768px\) \{\n {4}padding-inline: 24px;/,
		);
		expect(css).toMatch(/@source inline\("/);
		// Contract-level only: no block CSS without blocks.
		expect(css).not.toContain("wc-force-align");
	});

	it("collects block CSS, repeating breakpoint rules per theme breakpoint", () => {
		const css = toThemeCss(
			buildModel(loadCore(1), THEME),
			[],
			[
				{
					block: "Card",
					css: '.wc-force-align [class*="text-align-"] { text-align: inherit; }\n@media (--wc-breakpoint) {\n  .bp\\:wc-align-inherit { text-align: inherit; }\n}\n',
				},
			],
		);
		expect(css).toContain("/* Block Card */");
		expect(css).toContain(
			'.wc-force-align [class*="text-align-"] { text-align: inherit; }',
		);
		expect(css).toContain(
			"@media (width >= 768px) {\n  .md\\:wc-align-inherit { text-align: inherit; }\n}",
		);
		expect(css).toContain(
			"@media (width >= 1024px) {\n  .lg\\:wc-align-inherit",
		);
		expect(css).not.toContain("--wc-breakpoint");
		// Breakpoint names starting with a digit are escaped.
		const wide = toThemeCss(
			buildModel(loadCore(1), { tokens: { Breakpoint: { "2xl": 1536 } } }),
			[],
			[
				{
					block: "X",
					css: "@media (--wc-breakpoint) { .bp\\:x { color: red; } }",
				},
			],
		);
		expect(wide).toContain(".\\32 xl\\:x { color: red; }");
		// Braces in strings and comments do not end the breakpoint block.
		const quoted = toThemeCss(
			buildModel(loadCore(1), THEME),
			[],
			[
				{
					block: "Q",
					css: '@media (--wc-breakpoint) { /* } */ .bp\\:q::after { content: "}"; } }',
				},
			],
		);
		expect(quoted).toContain(
			'@media (width >= 768px) { /* } */ .md\\:q::after { content: "}"; } }',
		);
	});
});
