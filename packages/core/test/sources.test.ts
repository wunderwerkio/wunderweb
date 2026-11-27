// Source maps, edits and effective defaults: the loader's provenance seam
// (`loadSite(project, schema, {sources: true})`) over the example projects,
// and the pure functions the edit service builds on.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import {
	anchorEdit,
	anchorPath,
	applyEdit,
	BLOCK_ID_PATTERN,
	blockSpecs,
	buildSite,
	CORE_PAGE_FIELDS,
	compile,
	compileProject,
	EditError,
	FRAME_HEADER,
	findBlock,
	isFramed,
	loadCore,
	loadProject,
	loadSite,
	type Origin,
	type PathEdit,
	pageFindings,
	previewSource,
	readBlocks,
	readContent,
	type SitePage,
	TOKEN_HEADER,
	Validator,
	valueAtPath,
} from "../src/index.js";

const EXAMPLES = join(import.meta.dirname, "..", "..", "..", "examples");
const ITEMS = blockSpecs(
	readBlocks(join(import.meta.dirname, "..", "..", "..", "registry", "blocks")),
);

// biome-ignore lint/suspicious/noExplicitAny: assertions on untyped documents
type Doc = any;

/** Rendered path of every block of a page, computed from the page JSON. */
function renderedBlocks(page: SitePage): Map<string, Doc> {
	const out = new Map<string, Doc>();
	const visit = (node: unknown, path: string) => {
		if (!node || typeof node !== "object") {
			return;
		}
		if (/^[A-Z]/.test(String((node as Doc).type))) {
			out.set(path, node);
		}
		for (const [k, v] of Object.entries(node)) {
			visit(v, `${path}/${k}`);
		}
	};
	for (const region of ["header", "blocks", "footer"] as const) {
		page[region].forEach((b, i) => {
			visit(b, `${region}/${i}`);
		});
	}
	for (const [ref, blocks] of Object.entries(page.dialogs)) {
		blocks.forEach((b, i) => {
			visit(b, `dialogs/${ref}/${i}`);
		});
	}
	return out;
}

function at(doc: Doc, path: string): Doc {
	return path
		.split("/")
		.reduce((n, seg) => (n == null ? undefined : n[seg]), doc);
}

describe("source maps", () => {
	for (const name of ["astro", "astro-kit"]) {
		it(`${name}: every rendered block resolves to its authored YAML`, () => {
			const project = loadProject(join(EXAMPLES, name));
			const { schema } = compileProject(project);
			const site = loadSite(project, schema, { sources: true });
			const files = new Map<string, Doc>();
			const read = (file: string) => {
				if (!files.has(file)) {
					files.set(
						file,
						YAML.parse(readFileSync(join(project.contentDir, file), "utf8")),
					);
				}
				return files.get(file);
			};

			const seen = { via: 0, slot: 0, chrome: 0, dialog: 0, blocks: 0 };
			for (const page of site.pages) {
				const sources = page.sources;
				expect(sources, page.url).toBeDefined();
				if (!sources) {
					continue;
				}
				expect(sources.page.file).toBe(page.file);
				for (const r of Object.values(sources.regions)) {
					expect(read(r.file).fragment, page.url).toBeTypeOf("string");
				}
				for (const [ref, d] of Object.entries(sources.dialogs)) {
					expect(read(d.file).fragment, page.url).toBe(ref);
				}

				for (const [path, block] of renderedBlocks(page)) {
					const origin: Origin | undefined = sources.blocks[path];
					expect(origin, `${page.url} ${path}`).toBeDefined();
					if (!origin) {
						continue;
					}
					const authored = at(read(origin.file), origin.path);
					expect(authored?.type, `${page.url} ${path}`).toBe(block.type);
					// Ids reach the source map, never the components.
					expect(authored?.id, `${page.url} ${path}`).toMatch(
						new RegExp(BLOCK_ID_PATTERN),
					);
					expect(origin.id, `${page.url} ${path}`).toBe(authored.id);
					expect(block.id, `${page.url} ${path}`).toBeUndefined();
					for (const v of origin.via ?? []) {
						expect(at(read(v.file), v.path)?.type).toBe("Include");
					}
					seen.blocks++;
					seen.via += origin.via?.length ? 1 : 0;
					seen.slot += origin.path.includes("/with/") ? 1 : 0;
					seen.chrome += /^(header|footer)\//.test(path) ? 1 : 0;
					seen.dialog += path.startsWith("dialogs/") ? 1 : 0;
				}
			}
			// Every page's blocks are mapped; the starter has chrome too.
			expect(seen.blocks).toBeGreaterThan(0);
			if (name === "astro") {
				expect(seen.chrome).toBeGreaterThan(0);
			}
		});
	}

	it("names Include, slot and validator paths; maps findings to rendered blocks", () => {
		const root = mkdtempSync(join(tmpdir(), "wc-src-"));
		const files: Record<string, string> = {
			"wunderweb.config.yaml": "schema: 1\nlocales: [de]\ndefaultLocale: de\n",
			"content/de/pages/home.yaml": [
				"title: Start",
				"path: /",
				"blocks:",
				"  - {type: Text, body: '<p>own</p>'}",
				"  - type: Include",
				"    ref: cta",
				"    with: [{slot: text, block: {type: Text, body: '<p>slot</p>'}}]",
				"  - {type: Text, body: '<p>after</p>', anchor: Bad}",
			].join("\n"),
			"content/de/fragments/cta.yaml":
				"fragment: cta\nblocks:\n  - {type: Text, slot: text, body: '<p>x</p>'}\n  - {type: Buttons, items: [{label: Go, url: /go}]}\n",
		};
		for (const [f, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, f)), { recursive: true });
			writeFileSync(join(root, f), text);
		}
		const project = loadProject(root);
		const schema = compile(1, {}, ITEMS).schema;
		const validator = new Validator(schema);
		const content = readContent(project);
		const page = buildSite(validator, content, project.config, {
			sources: true,
		}).pages[0];
		expect(page?.sources?.blocks).toEqual({
			"blocks/0": {
				file: "de/pages/home.yaml",
				path: "blocks/0",
				validatorPath: "blocks/0",
			},
			"blocks/1": {
				file: "de/pages/home.yaml",
				path: "blocks/1/with/0/block",
				validatorPath: "blocks/1{cta}/0",
			},
			"blocks/2": {
				file: "de/fragments/cta.yaml",
				path: "blocks/1",
				validatorPath: "blocks/1{cta}/1",
				via: [{ file: "de/pages/home.yaml", path: "blocks/1" }],
			},
			"blocks/3": {
				file: "de/pages/home.yaml",
				path: "blocks/2",
				validatorPath: "blocks/2",
			},
		});

		// The invalid anchor of the last block lands on its rendered path.
		const findings = validator.validateSite(content, project.config);
		const byPath = pageFindings(page as SitePage, findings);
		expect(Object.keys(byPath)).toEqual(["blocks/3"]);
		expect(byPath["blocks/3"]?.[0]).toMatchObject({
			level: "error",
			file: "de/pages/home.yaml",
			at: "blocks/2/anchor (Text)",
		});
	});

	it("is off by default", () => {
		const project = loadProject(join(EXAMPLES, "astro"));
		const site = loadSite(project, compileProject(project).schema);
		expect(site.pages[0]?.sources).toBeUndefined();
	});
});

describe("edits addressed by block id", () => {
	const doc = () => ({
		id: "x",
		blocks: [
			{ type: "Text", id: "aaaaaaaa", body: "a" },
			{
				type: "Section",
				id: "bbbbbbbb",
				blocks: [
					{ type: "Text", body: "no id" },
					{ type: "Text", id: "cccccccc", body: "c", items: [{ id: "v" }] },
				],
			},
		],
	});

	it("finds blocks by id, never the document or a value", () => {
		expect(findBlock(doc(), "cccccccc")).toBe("blocks/1/blocks/1");
		expect(findBlock(doc(), "x")).toBeUndefined();
		expect(findBlock(doc(), "v")).toBeUndefined();
	});

	it("anchors paths to the innermost block with an id", () => {
		const d = doc();
		expect(anchorPath(d, "blocks/1/blocks/1/body")).toEqual({
			block: "cccccccc",
			path: "body",
		});
		// A block without an id: its enclosing block with one.
		expect(anchorPath(d, "blocks/1/blocks/0/body")).toEqual({
			block: "bbbbbbbb",
			path: "blocks/0/body",
		});
		expect(anchorPath(d, "blocks/0")).toEqual({ block: "aaaaaaaa", path: "" });
		expect(anchorPath(d, "blocks")).toEqual({ path: "blocks" });
		expect(
			anchorEdit(d, {
				op: "move",
				from: "blocks/1/blocks/1",
				to: "blocks",
				index: 0,
			}),
		).toEqual({
			op: "move",
			block: "cccccccc",
			from: "",
			to: "blocks",
			index: 0,
		});
	});

	it("apply to the block wherever it moved; the inverse is anchored too", () => {
		const d = doc() as Doc;
		d.blocks.unshift({ type: "Text", body: "inserted above" });
		const { doc: out, inverse } = applyEdit(d, {
			op: "set",
			block: "cccccccc",
			path: "body",
			value: "changed",
		});
		expect((out as Doc).blocks[2].blocks[1].body).toBe("changed");
		expect(inverse).toEqual({
			op: "set",
			block: "cccccccc",
			path: "body",
			value: "c",
		});
		// Undo after yet another block moved in front.
		(out as Doc).blocks.unshift({ type: "Text", body: "again" });
		const undone = applyEdit(out, inverse).doc as Doc;
		expect(undone.blocks[3].blocks[1].body).toBe("c");
	});

	it("give an insert an inverse that removes the inserted block by its id", () => {
		const { doc: out, inverse } = applyEdit(doc(), {
			op: "insert",
			block: "bbbbbbbb",
			path: "blocks",
			index: 0,
			value: { type: "Text", id: "dddddddd", body: "d" },
		});
		expect(inverse).toEqual({ op: "remove", block: "dddddddd", path: "" });
		const back = applyEdit(out, inverse).doc;
		expect(back).toEqual(doc());
	});

	it("are refused when the block is gone; positional edits stay as they are", () => {
		expect(() =>
			applyEdit(doc(), {
				op: "set",
				block: "zzzzzzzz",
				path: "body",
				value: 1,
			}),
		).toThrow(/block zzzzzzzz: not in the document/);
		expect(
			applyEdit(doc(), { op: "set", path: "blocks/0/body", value: "z" })
				.inverse,
		).toEqual({ op: "set", path: "blocks/0/body", value: "a" });
	});
});

describe("applyEdit", () => {
	const doc = {
		title: "Start",
		blocks: [
			{ type: "Text", body: "<p>a</p>" },
			{ type: "Tiles", items: [{ type: "Card" }, { type: "Media" }] },
		],
	};
	const frozen = structuredClone(doc);

	/** Applies an edit, then its inverse: back to the original. */
	function roundTrip(edit: PathEdit): Doc {
		const { doc: next, inverse } = applyEdit(doc, edit);
		expect(applyEdit(next, inverse).doc).toEqual(frozen);
		expect(doc).toEqual(frozen);
		return next;
	}

	it("sets and unsets values, creating parent maps", () => {
		expect(
			roundTrip({ op: "set", path: "blocks/0/body", value: "<p>b</p>" })
				.blocks[0].body,
		).toBe("<p>b</p>");
		expect(
			roundTrip({
				op: "set",
				path: "blocks/0/layout/padding/md/top",
				value: 4,
			}).blocks[0].layout,
		).toEqual({ padding: { md: { top: 4 } } });
		expect(roundTrip({ op: "unset", path: "title" })).not.toHaveProperty(
			"title",
		);
	});

	it("inserts, removes and moves list items", () => {
		expect(
			roundTrip({
				op: "insert",
				path: "blocks/1/items",
				index: 1,
				value: { type: "Text" },
			}).blocks[1].items.map((b: Doc) => b.type),
		).toEqual(["Card", "Text", "Media"]);
		expect(
			roundTrip({
				op: "insert",
				path: "blocks/0/after",
				index: 0,
				value: { type: "Buttons" },
			}).blocks[0].after,
		).toEqual([{ type: "Buttons" }]);
		expect(
			roundTrip({ op: "remove", path: "blocks/0" }).blocks.map(
				(b: Doc) => b.type,
			),
		).toEqual(["Tiles"]);
		expect(
			roundTrip({
				op: "move",
				from: "blocks/1/items/1",
				to: "blocks/1/items",
				index: 0,
			}).blocks[1].items.map((b: Doc) => b.type),
		).toEqual(["Media", "Card"]);
		expect(
			roundTrip({
				op: "move",
				from: "blocks/1/items/0",
				to: "blocks",
				index: 0,
			}).blocks.map((b: Doc) => b.type),
		).toEqual(["Card", "Text", "Tiles"]);
	});

	it("rejects paths that do not resolve", () => {
		expect(() =>
			applyEdit(doc, { op: "set", path: "blocks/7/body", value: "x" }),
		).toThrow(EditError);
		expect(() =>
			applyEdit(doc, { op: "remove", path: "blocks/0/body" }),
		).toThrow(/not a list item/);
		expect(() =>
			applyEdit(doc, { op: "insert", path: "blocks", index: 5, value: {} }),
		).toThrow(/index 5/);
		// Keys that would reach the prototype are not authored keys.
		expect(() =>
			applyEdit(doc, { op: "set", path: "__proto__/polluted", value: true }),
		).toThrow(EditError);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(valueAtPath(doc, "constructor")).toBeUndefined();
	});
});

describe("page extension fields", () => {
	it("pins the core Page fields to the core contract", () => {
		const page = loadCore(1).types?.Page as { fields: Record<string, unknown> };
		expect(
			new Set(Object.keys(page.fields).map((k) => k.replace(/\?$/, ""))),
		).toEqual(CORE_PAGE_FIELDS);
	});

	it("carries the theme's extend.Page fields on the page, resolved", () => {
		const { schema } = compile(
			1,
			{
				tokens: { ButtonVariant: ["primary"] },
				extend: {
					Page: {
						"service?": "string",
						"updated?": "string",
						"source?": "Url",
					},
				},
			},
			ITEMS,
		);
		const validator = new Validator(schema);
		const doc = {
			id: "home",
			title: "Home",
			path: "/",
			service: "App-Entwicklung",
			updated: "2026-11-19",
			source: "page:home",
			blocks: [],
		};
		const page = {
			kind: "page" as const,
			locale: "de",
			key: "home",
			file: "de/pages/home.yaml",
			doc,
		};
		const site = buildSite(
			validator,
			{
				docs: [page],
				pages: new Map([["de", new Map([["home", page]])]]),
				fragments: new Map(),
			},
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
		);
		expect(site.pages[0]?.extend).toEqual({
			service: "App-Entwicklung",
			updated: "2026-11-19",
			// A Url field: resolved like any other.
			source: "/",
		});
	});
});

describe("previewSource", () => {
	const SITE = {
		revision: 3,
		config: { locales: ["de"] },
		breakpoints: ["base"],
		pages: [],
		editorOrigins: ["https://app.example"],
		page: { url: "/", title: "Home" },
		findings: {},
	};

	function service() {
		const calls: { url: string; token: string | null }[] = [];
		const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({
				url: String(input),
				token: new Headers(init?.headers).get(TOKEN_HEADER),
			});
			return new Response(JSON.stringify(SITE), {
				headers: { "content-type": "application/json" },
			});
		}) as typeof globalThis.fetch;
		return { calls, fetch };
	}

	it("passes the request's preview token back and strips the annotation top-level", async () => {
		const s = service();
		const request = new Request("https://site.preview.example/", {
			headers: { [TOKEN_HEADER]: "signed" },
		});
		const page = await previewSource(request, {
			url: "http://content:1",
			fetch: s.fetch,
		}).page("/");
		expect(s.calls).toEqual([
			{ url: "http://content:1/site?url=%2F", token: "signed" },
		]);
		expect(page?.annotate).toBeUndefined();
		expect(page?.page.title).toBe("Home");
	});

	it("annotates a framed request, by Sec-Fetch-Dest or the refresh's header", async () => {
		for (const headers of [
			{ "sec-fetch-dest": "iframe" },
			{ [FRAME_HEADER]: "1" },
		]) {
			const request = new Request("https://site.preview.example/", { headers });
			expect(isFramed(request)).toBe(true);
			const page = await previewSource(request, {
				url: "http://content:1",
				fetch: service().fetch,
			}).page("/");
			expect(page?.annotate?.revision).toBe(3);
		}
	});

	it("does not annotate a top-level request", () => {
		expect(isFramed(new Request("https://x/"))).toBe(false);
		expect(
			isFramed(
				new Request("https://x/", {
					headers: { "sec-fetch-dest": "document" },
				}),
			),
		).toBe(false);
	});

	it("works in a production server and never falls back to the files", async () => {
		const was = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			const page = await previewSource(new Request("https://x/"), {
				url: "http://content:1",
				fetch: service().fetch,
			}).page("/");
			expect(page).toBeDefined();
		} finally {
			if (was === undefined) {
				delete process.env.NODE_ENV;
			} else {
				process.env.NODE_ENV = was;
			}
		}
		expect(() => previewSource(new Request("https://x/"), { url: "" })).toThrow(
			/WUNDERWEB_CONTENT_URL is not set/,
		);
	});
});
