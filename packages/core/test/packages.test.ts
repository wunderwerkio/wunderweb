// Blocks from npm packages (config `packages`) next to the project's blocks/,
// and `deprecated` fields (lint warns, the schema still accepts them).

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	checkSiteCss,
	compileProject,
	componentClasses,
	generatedFiles,
	loadProject,
	projectBlocks,
	readContent,
	readSchema,
	SchemaError,
	Validator,
} from "../src/index.js";

function write(root: string, files: Record<string, string>) {
	for (const [f, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, f)), { recursive: true });
		writeFileSync(join(root, f), text);
	}
}

const CONFIG = [
	"schema: 1",
	"locales: [de]",
	"defaultLocale: de",
	"css: [./app/globals.css]",
	'packages: ["@acme/kit"]',
	"",
].join("\n");

const KIT = {
	"package.json": JSON.stringify({
		name: "@acme/kit",
		wunderweb: { blocks: "./blocks" },
	}),
	"blocks/Callout/block.yaml": [
		"in: [PageBlock]",
		"fields:",
		"  title: string",
		"  label?: {type: string, deprecated: true, doc: Use title.}",
		"  texts?: CalloutTexts",
		"types:",
		"  CalloutTexts:",
		"    fields:",
		"      more?: string",
		"      costs?: {type: string, deprecated: true}",
		"",
	].join("\n"),
	"blocks/Callout/Callout.tsx":
		'export function Callout() { return <aside className="kit-callout-icon" />; }\n',
	"blocks/Callout/Callout.css": ".kit-callout-icon { color: red; }\n",
};

const SITE = {
	"wunderweb.config.yaml": CONFIG,
	"blocks/Note/block.yaml": "in: [PageBlock]\nfields:\n  body: string\n",
	"blocks/Note/Note.tsx":
		'export function Note() { return <p className="site-note" />; }\n',
	"app/globals.css": "h1 { font-size: 2rem; }\n",
	"content/de/pages/home.yaml": [
		"title: Start",
		"path: /",
		"blocks:",
		"  - {type: Note, body: Hallo}",
		"  - {type: Callout, title: Neu}",
		"",
	].join("\n"),
};

/** A site with the kit installed in node_modules (a copy, as npm installs it). */
function site(
	files: Record<string, string> = {},
	kit: Record<string, string> = KIT,
) {
	const root = mkdtempSync(join(tmpdir(), "wc-pkg-"));
	write(root, { ...SITE, ...files });
	write(join(root, "node_modules", "@acme", "kit"), kit);
	return loadProject(root);
}

function file(files: { file: string; text: string }[], name: string): string {
	const f = files.find((x) => x.file.endsWith(name));
	if (!f) {
		throw new Error(`no ${name}`);
	}
	return f.text;
}

describe("package blocks", () => {
	it("compiles local and package blocks into one schema", () => {
		const p = site();
		expect(projectBlocks(p).map((b) => [b.name, b.package])).toEqual([
			["Callout", "@acme/kit"],
			["Note", undefined],
		]);
		const { schema } = compileProject(p);
		expect(Object.keys(schema.$defs ?? {})).toEqual(
			expect.arrayContaining(["Callout", "Note", "CalloutTexts"]),
		);
	});

	it("generates the component map, block CSS and Tailwind sources for package blocks", () => {
		const files = generatedFiles(site());
		const components = file(files, "components.ts");
		expect(components).toContain(
			'import { Callout } from "@acme/kit/blocks/Callout/Callout.tsx";',
		);
		expect(components).toContain('import { Note } from "../blocks/Note/Note";');
		const css = file(files, "wunderweb.css");
		expect(css).toContain('@source "../node_modules/@acme/kit/blocks";');
		expect(css).toContain("/* Block Callout */\n.kit-callout-icon");
	});

	it("finds a package installed in a parent node_modules (workspace hoisting)", () => {
		const outer = mkdtempSync(join(tmpdir(), "wc-pkg-ws-"));
		write(join(outer, "node_modules", "@acme", "kit"), KIT);
		write(join(outer, "site"), SITE);
		const p = loadProject(join(outer, "site"));
		expect(file(generatedFiles(p), "wunderweb.css")).toContain(
			'@source "../../node_modules/@acme/kit/blocks";',
		);
	});

	it("follows a workspace link to the package", () => {
		const root = mkdtempSync(join(tmpdir(), "wc-pkg-link-"));
		write(root, SITE);
		write(join(root, "packages", "kit"), KIT);
		mkdirSync(join(root, "node_modules", "@acme"), { recursive: true });
		symlinkSync(
			join(root, "packages", "kit"),
			join(root, "node_modules", "@acme", "kit"),
		);
		const p = loadProject(root);
		expect(projectBlocks(p).map((b) => b.name)).toEqual(["Callout", "Note"]);
		// Paths stay those through node_modules, not the link target.
		const files = generatedFiles(p);
		expect(file(files, "wunderweb.css")).toContain(
			'@source "../node_modules/@acme/kit/blocks";',
		);
		expect(file(files, "components.ts")).toContain(
			'from "@acme/kit/blocks/Callout/Callout.tsx"',
		);
		// Kit classes stay owned by their block, not shared site code.
		expect(
			componentClasses(p.root, p.blocksDir, p.packageBlocks).get(
				"kit-callout-icon",
			),
		).toEqual(new Set(["Callout"]));
	});

	it("rejects a block defined locally and in a package", () => {
		const p = site({
			"blocks/Callout/block.yaml": "in: [PageBlock]\nfields:\n  x: string\n",
			"blocks/Callout/Callout.tsx": "export function Callout() {}\n",
		});
		expect(() => projectBlocks(p)).toThrow(SchemaError);
		expect(() => projectBlocks(p)).toThrow(
			/block Callout: defined in blocks\/Callout and in package @acme\/kit/,
		);
	});

	it("rejects a block defined in two packages", () => {
		const root = mkdtempSync(join(tmpdir(), "wc-pkg-two-"));
		write(root, {
			...SITE,
			"wunderweb.config.yaml": CONFIG.replace(
				'packages: ["@acme/kit"]',
				'packages: ["@acme/kit", "@acme/other"]',
			),
		});
		write(join(root, "node_modules", "@acme", "kit"), KIT);
		write(join(root, "node_modules", "@acme", "other"), {
			...KIT,
			"package.json": JSON.stringify({
				name: "@acme/other",
				wunderweb: { blocks: "./blocks" },
			}),
		});
		expect(() => projectBlocks(loadProject(root))).toThrow(
			/block Callout: defined in package @acme\/kit and in package @acme\/other/,
		);
	});

	it("rejects a package listed twice", () => {
		expect(() =>
			site({
				"wunderweb.config.yaml": CONFIG.replace(
					'packages: ["@acme/kit"]',
					'packages: ["@acme/kit", "@acme/kit"]',
				),
			}),
		).toThrow(/packages: a package is listed twice/);
	});

	it("rejects a blocks directory outside the package, missing or not exported", () => {
		const manifest = (extra: object) => ({
			...KIT,
			"package.json": JSON.stringify({ name: "@acme/kit", ...extra }),
		});
		for (const blocks of ["..", ".", "./missing", "/tmp"]) {
			expect(() => site({}, manifest({ wunderweb: { blocks } }))).toThrow(
				/which is not a directory inside the package/,
			);
		}
		expect(() =>
			site(
				{},
				manifest({
					wunderweb: { blocks: "./blocks" },
					exports: { ".": "./index.js" },
				}),
			),
		).toThrow(
			/does not export its blocks: add "exports": \{"\.\/blocks\/\*": "\.\/blocks\/\*"\}/,
		);
		for (const exports of [
			{ "./blocks/*": "./blocks/*" },
			{ "./*": "./*" },
			{ "./blocks/*": { import: "./blocks/*" } },
		]) {
			const p = site(
				{},
				manifest({ wunderweb: { blocks: "./blocks/" }, exports }),
			);
			expect(p.packageBlocks[0]?.specifier).toBe("@acme/kit/blocks");
		}
	});

	it("rejects a package that is not installed or declares no blocks", () => {
		const root = mkdtempSync(join(tmpdir(), "wc-pkg-missing-"));
		write(root, SITE);
		expect(() => loadProject(root)).toThrow(
			/packages: @acme\/kit is not installed/,
		);
		expect(() =>
			site({}, { ...KIT, "package.json": '{"name": "@acme/kit"}' }),
		).toThrow(/packages: @acme\/kit declares no "wunderweb": \{"blocks": …\}/);
	});

	it("rejects site CSS styling a package block's internals", () => {
		const p = site();
		const ctx = {
			richTextClasses: [],
			componentClasses: componentClasses(p.root, p.blocksDir, p.packageBlocks),
		};
		const problems = checkSiteCss(
			".kit-callout-icon { color: blue; }",
			"app/globals.css",
			ctx,
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/kit-callout-icon.*Callout/);
	});
});

describe("deprecated fields", () => {
	function lint(content: string) {
		const p = site({ "content/de/pages/home.yaml": content });
		for (const f of generatedFiles(p)) {
			mkdirSync(dirname(f.file), { recursive: true });
			writeFileSync(f.file, f.text);
		}
		return new Validator(readSchema(p)).validateSite(readContent(p), p.config);
	}
	const page = (block: string) =>
		`title: Start\npath: /\nblocks:\n  - ${block}\n`;

	it("marks them in the schema and the types", () => {
		const files = generatedFiles(site());
		const schema = JSON.parse(file(files, "schema.json"));
		expect(schema.$defs.Callout.properties.label).toMatchObject({
			type: "string",
			deprecated: true,
		});
		expect(schema.$defs.CalloutTexts.properties.costs.deprecated).toBe(true);
		const types = file(files, "types.ts");
		expect(types).toMatch(
			/\* @deprecated Use title\.\s*\*\/\n\s*label\?: string;/,
		);
		expect(types).toMatch(/@deprecated[^\n]*\n[^\n]*costs\?: string;/);
	});

	it("accepts content using them, with a warning per value", () => {
		const findings = lint(
			page(
				"{type: Callout, title: Neu, label: Alt, texts: {costs: x, more: y}}",
			),
		);
		expect(findings.filter((f) => f.level === "error")).toEqual([]);
		expect(
			findings
				.filter((f) => f.level === "warning")
				.map((f) => [f.at, f.message]),
		).toEqual([
			[
				"blocks/0 (Callout)",
				'field "label" is deprecated (Use title.); remove it or run the migration of the block\'s package',
			],
			[
				"blocks/0/texts (Callout)",
				'field "costs" is deprecated; remove it or run the migration of the block\'s package',
			],
		]);
	});

	it("does not warn when the content leaves them out", () => {
		expect(lint(page("{type: Callout, title: Neu, texts: {more: y}}"))).toEqual(
			[],
		);
	});

	it("keeps an unknown field an error", () => {
		const errors = lint(page("{type: Callout, title: Neu, gone: x}")).filter(
			(f) => f.level === "error",
		);
		expect(errors.map((f) => f.message)).toEqual(['unknown field "gone"']);
	});

	it("must be optional", () => {
		const kit = {
			...KIT,
			"blocks/Callout/block.yaml":
				"in: [PageBlock]\nfields:\n  title: {type: string, deprecated: true}\n",
		};
		expect(() => compileProject(site({}, kit))).toThrow(
			/Callout\.title: a deprecated field must be optional \(title\?\)/,
		);
	});
});
