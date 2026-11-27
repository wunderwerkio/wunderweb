// The CLI on temporary project directories, with a temporary local git
// repository as the registry (tags and commits made here: no network, no auth).

import { execFileSync, spawnSync } from "node:child_process";
import {
	appendFileSync,
	chmodSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const CLI = join(ROOT, "packages", "cli", "src", "index.ts");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
/** Tag of the runtime version the CLI reports (packages share one version). */
const VERSION = JSON.parse(
	readFileSync(join(ROOT, "packages", "cli", "package.json"), "utf8"),
).version as string;
const TAG = `@wunderweb/react@${VERSION}`;
const ITEMS = "registry/blocks";

const CACHE = mkdtempSync(join(tmpdir(), "wc-cache-"));

function cli(cwd: string, ...args: string[]): { code: number; out: string } {
	try {
		return {
			code: 0,
			out: execFileSync(TSX, [CLI, ...args], {
				cwd,
				encoding: "utf8",
				stdio: "pipe",
				env: { ...process.env, WUNDERWEB_CACHE: CACHE },
			}),
		};
	} catch (e) {
		const err = e as { status: number; stdout: string; stderr: string };
		return { code: err.status, out: `${err.stdout}${err.stderr}` };
	}
}

/** Like `cli`, with stderr (warnings) in `out` also on success. */
function cliWithStderr(
	cwd: string,
	...args: string[]
): { code: number; out: string } {
	const r = spawnSync(TSX, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, WUNDERWEB_CACHE: CACHE },
	});
	return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

/** The text without the block ids `format` assigns. */
function withoutIds(text: string): string {
	return text.replace(/\n +id: [a-z0-9]{8}(?=\n)/g, "");
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: "pipe",
	}).trim();
}

/** A registry repository with the wunderweb items, tagged with the runtime version. */
function registry() {
	const dir = mkdtempSync(join(tmpdir(), "wc-registry-"));
	git(dir, "init", "-q", "-b", "main");
	git(dir, "config", "user.email", "test@example.com");
	git(dir, "config", "user.name", "test");
	cpSync(join(ROOT, ITEMS), join(dir, ITEMS), { recursive: true });
	const reg = {
		dir,
		write(file: string, text: string) {
			const p = join(dir, ITEMS, file);
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, text);
			return reg;
		},
		read(file: string) {
			return readFileSync(join(dir, ITEMS, file), "utf8");
		},
		commit(message: string) {
			git(dir, "add", "-A");
			git(dir, "commit", "-q", "-m", message);
			return git(dir, "rev-parse", "HEAD");
		},
		tag(name: string) {
			git(dir, "tag", name);
		},
	};
	reg.commit("items");
	reg.tag(TAG);
	return reg;
}

type Registry = ReturnType<typeof registry>;

function project(reg: Registry, ...args: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "wc-cli-"));
	const r = cli(dir, "init", "--registry", reg.dir, ...args);
	if (r.code) {
		throw new Error(r.out);
	}
	return dir;
}

/** A copy of a prepared project (installs are slow to repeat). */
function copy(dir: string): string {
	const to = mkdtempSync(join(tmpdir(), "wc-cli-"));
	cpSync(dir, to, { recursive: true });
	return to;
}

const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const provenance = (dir: string, block: string) =>
	read(dir, `blocks/${block}/block.yaml`).split("\n")[0] ?? "";

let reg: Registry;
let base: string;

beforeAll(() => {
	reg = registry();
	base = project(
		reg,
		"--locales",
		"de,en",
		"--assets",
		"https://bucket.example.com",
	);
}, 120_000);

describe("init", () => {
	it("scaffolds a valid project with the starter blocks", () => {
		for (const f of [
			"wunderweb.config.yaml",
			"theme.yaml",
			"content/en/pages/home.yaml",
			"app/[[...slug]]/page.tsx",
			"generated/types.ts",
			"generated/components.ts",
			"generated/wunderweb.css",
		]) {
			expect(existsSync(join(base, f)), f).toBe(true);
		}
		const components = read(base, "generated/components.ts");
		for (const b of [
			"Section",
			"SideBySide",
			"Tiles",
			"Stack",
			"Text",
			"Media",
			"Buttons",
			"Card",
		]) {
			expect(existsSync(join(base, "blocks", b, `${b}.tsx`)), b).toBe(true);
			expect(components).toContain(
				`import { ${b} } from "../blocks/${b}/${b}";`,
			);
		}
		expect(components).toMatch(
			/export const components: Components<BlockMap> = \{/,
		);
		expect(existsSync(join(base, "blocks", "Card", "item.yaml"))).toBe(false);
		// Card CSS is collected into the generated CSS.
		expect(read(base, "generated/wunderweb.css")).toContain("/* Block Card */");

		const lint = cli(base, "lint");
		expect(lint.code, lint.out).toBe(0);
		expect(lint.out).toContain("0 error(s)");
		expect(cli(base, "generate", "--check").code).toBe(0);
	});

	it("records registry, item, tag, commit and pinned major", () => {
		const commit = git(reg.dir, "rev-list", "-n", "1", TAG);
		expect(provenance(base, "Card")).toBe(
			`provenance: { registry: wunderweb, item: Card, ref: "${TAG}", commit: ${commit}, schema: 1 }`,
		);
	});

	it("scaffolds an Astro app with --astro", () => {
		const dir = copy(base);
		for (const f of ["app", "wunderweb.config.yaml"]) {
			rmSync(join(dir, f), { recursive: true, force: true });
		}
		const r = cli(dir, "init", "--astro", "--registry", reg.dir);
		expect(r.code, r.out).toBe(0);
		for (const f of [
			"astro.config.mjs",
			"src/pages/[...slug].astro",
			"src/pages/sitemap.xml.ts",
			"src/styles/global.css",
			"tsconfig.json",
		]) {
			expect(existsSync(join(dir, f)), f).toBe(true);
		}
		expect(existsSync(join(dir, "app"))).toBe(false);
		expect(read(dir, "wunderweb.config.yaml")).toContain(
			"css: [./src/styles/global.css]",
		);
		expect(read(dir, "astro.config.mjs")).toContain(
			"integrations: [react(), wunderweb()]",
		);
		// The site stylesheet is where `generate` checks it.
		expect(cli(dir, "generate", "--check").code).toBe(0);
	});

	it("does not overwrite existing files", () => {
		const dir = mkdtempSync(join(tmpdir(), "wc-cli-"));
		writeFileSync(join(dir, "theme.yaml"), "tokens: {}\n");
		cli(dir, "init", "--registry", reg.dir);
		expect(read(dir, "theme.yaml")).toBe("tokens: {}\n");
	});
});

describe("generate and lint", () => {
	it("generate --check and lint detect a stale theme", () => {
		const dir = copy(base);
		writeFileSync(
			join(dir, "theme.yaml"),
			read(dir, "theme.yaml").replace('brand: "#c36e01"', 'accent: "#c36e01"'),
		);
		const check = cli(dir, "generate", "--check");
		expect(check.code).toBe(1);
		expect(check.out).toMatch(/stale/);
		expect(cli(dir, "lint").code).toBe(1);
	});

	it("generate --check detects a stale block schema", () => {
		const dir = copy(base);
		appendFileSync(join(dir, "blocks/Text/block.yaml"), "  lead?: string\n");
		const check = cli(dir, "generate", "--check");
		expect(check.code).toBe(1);
		expect(check.out).toMatch(/types\.ts/);
	});

	it("fails for a site stylesheet styling block internals", () => {
		const dir = copy(base);
		appendFileSync(
			join(dir, "app/globals.css"),
			".wc-card-icon .wc-icon { padding: 15px; }\n.wc-footer .wc-button { min-height: 48px; }\n",
		);
		const gen = cli(dir, "generate", "--check");
		expect(gen.code).toBe(1);
		expect(gen.out).toMatch(
			/app\/globals\.css: "\.wc-card-icon \.wc-icon": \.wc-card-icon is rendered only by block Card/,
		);
		expect(gen.out).toMatch(/styles blocks by page region/);
	});

	it("fails for a block schema without component", () => {
		const dir = copy(base);
		rmSync(join(dir, "blocks/Stack/Stack.tsx"));
		const gen = cli(dir, "generate");
		expect(gen.code).toBe(1);
		expect(gen.out).toMatch(
			/block Stack: no component \(Stack\/Stack.tsx exporting Stack\)/,
		);
	});

	it("fails for an installed block pinning another contract major", () => {
		const dir = copy(base);
		const f = join(dir, "blocks/Stack/block.yaml");
		writeFileSync(
			f,
			read(dir, "blocks/Stack/block.yaml").replace(
				"schema: 1 }",
				"schema: 2 }",
			),
		);
		const gen = cli(dir, "generate", "--check");
		expect(gen.code).toBe(1);
		expect(gen.out).toMatch(
			/block Stack: pins contract major 2, the project uses 1/,
		);
	});

	it("lint reports content errors with file and path", () => {
		const dir = copy(base);
		const home = join(dir, "content", "de", "pages", "home.yaml");
		writeFileSync(
			home,
			readFileSync(home, "utf8").replace(
				"type: Text",
				"type: Text\n    className: hidden",
			),
		);
		const lint = cli(dir, "lint");
		expect(lint.code).toBe(1);
		expect(lint.out).toMatch(
			/de\/pages\/home\.yaml\n {2}error {4}blocks\/0 \(Text\) {2}unknown field "className"/,
		);
	});

	it("format brings content back to the form the visual editor edits; lint warns until then", () => {
		const dir = copy(base);
		const file = join(dir, "content", "de", "pages", "home.yaml");
		const original = readFileSync(file, "utf8");
		// As a coding agent might write it: lists not indented under their key.
		const agent = parseDocument(original).toString({
			lineWidth: 0,
			indentSeq: false,
		});
		expect(agent).not.toBe(original);
		writeFileSync(file, agent);

		const lint = cli(dir, "lint");
		expect(lint.code, lint.out).toBe(0);
		expect(lint.out).toMatch(
			/de\/pages\/home\.yaml\n {2}warning {2}\(file\) {2}not in the canonical YAML form.*wunderweb format/,
		);
		const check = cli(dir, "format", "--check");
		expect(check.code).toBe(1);
		expect(check.out).toContain("de/pages/home.yaml");

		const format = cli(dir, "format");
		expect(format.code, format.out).toBe(0);
		expect(format.out).toContain("formatted de/pages/home.yaml");
		expect(withoutIds(readFileSync(file, "utf8"))).toBe(original);
		expect(cli(dir, "format", "--check").code).toBe(0);
		expect(cli(dir, "lint").out).not.toMatch(/canonical/);
	});

	it("format keeps the file mode and never replaces a symlinked file", () => {
		const dir = copy(base);
		const pages = join(dir, "content", "de", "pages");
		const file = join(pages, "home.yaml");
		const original = readFileSync(file, "utf8");
		const agent = parseDocument(original).toString({
			lineWidth: 0,
			indentSeq: false,
		});
		writeFileSync(file, agent);
		chmodSync(file, 0o640);
		// A linked page outside the content directory.
		const outside = join(dir, "outside.yaml");
		writeFileSync(outside, agent.replace("id: home", "id: linked"));
		symlinkSync(outside, join(pages, "linked.yaml"));

		const r = cli(dir, "format");
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/de\/pages\/linked\.yaml: .*symlink.*not formatted/);
		expect(withoutIds(readFileSync(file, "utf8"))).toBe(original);
		expect(statSync(file).mode & 0o777).toBe(0o640);
		expect(lstatSync(join(pages, "linked.yaml")).isSymbolicLink()).toBe(true);
		expect(readFileSync(outside, "utf8")).toContain("id: linked");
	});

	it("format gives every block a unique id after its type; lint warns without one and fails on duplicates", () => {
		const dir = copy(base);
		const file = join(dir, "content", "de", "pages", "home.yaml");
		writeFileSync(
			file,
			[
				"id: home",
				"title: Home",
				"path: /",
				"blocks:",
				"  - type: Text",
				"    id: hand-made",
				"    body: <p>a</p>",
				"    after:",
				"      - {type: Buttons, items: [{label: Go, url: /}]}",
				"  - type: Text",
				"    id: hand-made",
				"    body: <p>b</p>",
				"  - type: Text",
				"    body: <p>c</p>",
				"",
			].join("\n"),
		);
		const before = cli(dir, "lint");
		expect(before.code).toBe(1);
		expect(before.out).toMatch(
			/error {4}blocks\/1 \(Text\) {2}block id "hand-made" already used at blocks\/0/,
		);
		expect(before.out).toMatch(
			/warning {2}\(file\) {2}2 blocks without an id \(first at blocks\/0\/after\/0\)/,
		);
		expect(cli(dir, "format", "--check").out).toMatch(
			/8 block id\(s\) missing or duplicate/,
		);

		const format = cli(dir, "format");
		expect(format.code, format.out).toBe(0);
		// 3 here, 5 in the fixture's other files.
		expect(format.out).toContain("assigned 8 block id(s)");
		const text = readFileSync(file, "utf8");
		const doc = parseDocument(text).toJS() as {
			blocks: { id: string; after?: { id: string }[] }[];
		};
		const ids = [
			doc.blocks[0]?.id,
			doc.blocks[0]?.after?.[0]?.id,
			doc.blocks[1]?.id,
			doc.blocks[2]?.id,
		];
		expect(ids[0]).toBe("hand-made");
		for (const id of ids.slice(1)) {
			expect(id).toMatch(/^[a-z0-9]{8}$/);
		}
		expect(new Set(ids).size).toBe(4);
		// First key after `type`, in block and flow style alike.
		expect(text).toMatch(/- \{type: Buttons, id: [a-z0-9]{8}, items:/);
		expect(text).toMatch(
			/- type: Text\n {4}id: [a-z0-9]{8}\n {4}body: <p>c<\/p>/,
		);

		// A second run changes nothing; lint is clean of id findings.
		const again = cli(dir, "format");
		expect(again.out).toContain("content is in canonical form");
		expect(readFileSync(file, "utf8")).toBe(text);
		const after = cli(dir, "lint");
		expect(after.code, after.out).toBe(0);
		expect(after.out).not.toMatch(/block id|without an id/);
	});

	it("format leaves files it cannot parse alone and says so", () => {
		const dir = copy(base);
		const file = join(dir, "content", "de", "pages", "home.yaml");
		writeFileSync(file, "title: [\n");
		const format = cli(dir, "format");
		expect(format.code).toBe(1);
		expect(format.out).toMatch(/de\/pages\/home\.yaml: .*not formatted/);
		expect(readFileSync(file, "utf8")).toBe("title: [\n");
	});

	it("add-block scaffolds a block written from scratch", () => {
		const dir = copy(base);
		const add = cli(dir, "add-block", "Quote");
		expect(add.code, add.out).toBe(0);
		expect(read(dir, "blocks/Quote/block.yaml")).toMatch(
			/^doc: .*\nin: \[Leaf\]/,
		);
		expect(read(dir, "blocks/Quote/Quote.tsx")).toMatch(
			/BlockProps<QuoteBlock>/,
		);
		expect(read(dir, "generated/types.ts")).toMatch(
			/export interface QuoteBlock extends Box/,
		);
		expect(read(dir, "generated/components.ts")).toContain("\tQuote,");
		expect(cli(dir, "add-block", "Quote").code).toBe(1);
	});
});

describe("add", () => {
	it("installs an item and its dependencies at the runtime's tag", () => {
		const dir = copy(base);
		rmSync(join(dir, "blocks/Card"), { recursive: true });
		rmSync(join(dir, "blocks/Media"), { recursive: true });
		const add = cli(dir, "add", "Card");
		expect(add.code, add.out).toBe(0);
		expect(add.out).toContain(`added Card from wunderweb ${TAG}`);
		expect(add.out).toMatch(/added Media from wunderweb .* as a dependency/);
		expect(provenance(dir, "Media")).toContain("item: Media");
		expect(read(dir, "generated/components.ts")).toContain("\tCard,");
	});

	it("installs from a release tagged before the rename, for a runtime installed under its old name", () => {
		const old = registry();
		const legacyTag = `@wunderwerkio/wundercms-react@${VERSION}`;
		git(old.dir, "tag", "-d", TAG);
		old.tag(legacyTag);
		const dir = copy(base);
		writeFileSync(
			join(dir, "wunderweb.config.yaml"),
			read(dir, "wunderweb.config.yaml").replace(
				/url: "[^"]*"/,
				`url: ${JSON.stringify(old.dir)}`,
			),
		);
		const runtime = join(dir, "node_modules/@wunderwerkio/wundercms-react");
		mkdirSync(runtime, { recursive: true });
		writeFileSync(
			join(runtime, "package.json"),
			JSON.stringify({
				name: "@wunderwerkio/wundercms-react",
				version: VERSION,
			}),
		);
		rmSync(join(dir, "blocks/Card"), { recursive: true });
		rmSync(join(dir, "blocks/Media"), { recursive: true });
		const add = cli(dir, "add", "Card");
		expect(add.code, add.out).toBe(0);
		expect(add.out).toContain(`added Card from wunderweb ${legacyTag}`);
	});

	it("refuses to overwrite an existing block", () => {
		const dir = copy(base);
		const add = cli(dir, "add", "Card");
		expect(add.code).toBe(1);
		expect(add.out).toMatch(/block Card already exists/);
	});

	it("generates with package blocks and refuses to add a block a package provides", () => {
		const dir = copy(base);
		const kit = join(dir, "node_modules", "@acme", "kit");
		mkdirSync(join(kit, "blocks"), { recursive: true });
		writeFileSync(
			join(kit, "package.json"),
			'{"name": "@acme/kit", "wunderweb": {"blocks": "./blocks"}}',
		);
		cpSync(join(dir, "blocks", "Card"), join(kit, "blocks", "Card"), {
			recursive: true,
		});
		rmSync(join(dir, "blocks", "Card"), { recursive: true });
		appendFileSync(
			join(dir, "wunderweb.config.yaml"),
			'packages: ["@acme/kit"]\n',
		);

		const gen = cli(dir, "generate");
		expect(gen.code, gen.out).toBe(0);
		expect(read(dir, "generated/components.ts")).toContain(
			'import { Card } from "@acme/kit/blocks/Card/Card.tsx";',
		);
		const lint = cli(dir, "lint");
		expect(lint.code, lint.out).toBe(0);

		const add = cli(dir, "add", "Card");
		expect(add.code).toBe(1);
		expect(add.out).toMatch(/block Card comes from package @acme\/kit/);
		const update = cli(dir, "update", "Card");
		expect(update.code).toBe(1);
		expect(update.out).toMatch(/block Card comes from package @acme\/kit/);
	});

	it("writes nothing when a check fails", () => {
		const r = registry();
		r.write("Broken/item.yaml", "name: Broken\nschema: 1\n")
			.write("Broken/block.yaml", "in: [Leaf]\nfields:\n  items: Row[]\n")
			.write("Broken/Broken.tsx", "export function Broken() { return null; }\n")
			.write("Bleed/item.yaml", "name: Bleed\nschema: 1\n")
			.write(
				"Bleed/block.yaml",
				"in: [Leaf]\ntraits: [Box]\nfields: {}\ndefaults:\n  place: {bleed: true}\n",
			)
			.write("Bleed/Bleed.tsx", "export function Bleed() { return null; }\n")
			.commit("broken items");
		const dir = project(r);

		const broken = cli(dir, "add", "Broken", "Accordion", "--ref", "main");
		expect(broken.code).toBe(1);
		expect(broken.out).toMatch(/Broken.items: slot accepts Row/);
		expect(existsSync(join(dir, "blocks/Broken"))).toBe(false);
		expect(existsSync(join(dir, "blocks/Accordion"))).toBe(false);

		// A field the project's contract lacks is named.
		const bleed = cli(dir, "add", "Bleed", "--ref", "main");
		expect(bleed.code).toBe(1);
		expect(bleed.out).toMatch(/unknown field "bleed"/);
		expect(existsSync(join(dir, "blocks/Bleed"))).toBe(false);
	});

	it("rejects item names escaping the blocks directory", () => {
		const dir = copy(base);
		const up = cli(dir, "add", "../generated");
		expect(up.code).toBe(1);
		expect(up.out).toMatch(/invalid item name "..\/generated"/);
	});

	it("installs from another registry's default branch", () => {
		const other = registry();
		other
			.write(
				"Quote/item.yaml",
				"name: Quote\nschema: 1\nnpm: {left-pad: ^1.3.0}\n",
			)
			.write(
				"Quote/block.yaml",
				"in: [Leaf]\ntraits: [Box]\nfields:\n  text: string\n",
			)
			.write("Quote/Quote.tsx", "export function Quote() { return null; }\n");
		const head = other.commit("quote");
		const dir = copy(base);
		writeFileSync(
			join(dir, "wunderweb.config.yaml"),
			read(dir, "wunderweb.config.yaml").replace(
				/^registries: .*$/m,
				`registries: [{name: wunderweb, url: ${JSON.stringify(reg.dir)}, path: ${ITEMS}}, {name: team, url: ${JSON.stringify(other.dir)}, path: ${ITEMS}}]`,
			),
		);
		const add = cli(dir, "add", "Quote", "--registry", "team");
		expect(add.code, add.out).toBe(0);
		expect(add.out).toContain(
			"install the npm packages the blocks need: left-pad@^1.3.0 (Quote)",
		);
		expect(provenance(dir, "Quote")).toContain(
			`registry: team, item: Quote, ref: HEAD, commit: ${head}`,
		);
	});

	it("falls back to the newest tag targeting the project's major, or fails", () => {
		const r = registry();
		const newer = "@wunderweb/react@9.0.0";
		r.write(
			"Accordion/item.yaml",
			r.read("Accordion/item.yaml").replace("schema: 1", "schema: 2"),
		)
			.write("Future/item.yaml", "name: Future\nschema: 2\n")
			.write("Future/block.yaml", "in: [Leaf]\nfields: {}\n")
			.write("Future/Future.tsx", "export function Future() { return null; }\n")
			.commit("contract 2");
		r.tag(newer);
		const dir = project(r);

		const add = cli(dir, "add", "Accordion", "--ref", newer);
		expect(add.code, add.out).toBe(0);
		expect(add.out).toContain(
			`Accordion: ${newer} targets contract 2, installed ${TAG} (contract 1)`,
		);
		expect(provenance(dir, "Accordion")).toContain(`ref: "${TAG}"`);

		const future = cli(dir, "add", "Future", "--ref", newer);
		expect(future.code).toBe(1);
		expect(future.out).toMatch(
			/Future: targets contract 2, the project uses 1; no release/,
		);
		expect(existsSync(join(dir, "blocks/Future"))).toBe(false);
	});
});

describe("update and diff", () => {
	let r: Registry;
	let dir: string;
	let next: string;

	beforeAll(() => {
		r = registry();
		dir = project(r);
		// Upstream: Text gets a new last line, Stack a new first line, Section a changed doc.
		r.write("Text/Text.tsx", `${r.read("Text/Text.tsx")}\n// upstream text\n`)
			.write("Stack/Stack.tsx", `// upstream\n${r.read("Stack/Stack.tsx")}`)
			.write(
				"Section/block.yaml",
				r
					.read("Section/block.yaml")
					.replace(
						"doc: Rows on one shared background.",
						"doc: Rows on one background (upstream).",
					),
			);
		next = r.commit("upstream changes");
	}, 120_000);

	it("replaces an unmodified block cleanly", () => {
		const d = copy(dir);
		const up = cli(d, "update", "Text", "--ref", "main");
		expect(up.code, up.out).toBe(0);
		expect(up.out).toMatch(/Text: updated main/);
		expect(read(d, "blocks/Text/Text.tsx")).toBe(r.read("Text/Text.tsx"));
		expect(provenance(d, "Text")).toContain(`ref: main, commit: ${next}`);
		expect(cli(d, "generate", "--check").code).toBe(0);
	});

	it("merges non-overlapping local and upstream changes", () => {
		const d = copy(dir);
		const f = join(d, "blocks/Stack/Stack.tsx");
		writeFileSync(f, `${readFileSync(f, "utf8")}\n// local change\n`);
		const up = cli(d, "update", "Stack", "--ref", "main");
		expect(up.code, up.out).toBe(0);
		expect(up.out).toMatch(/merged local changes with main/);
		const text = read(d, "blocks/Stack/Stack.tsx");
		expect(text).toContain("// upstream");
		expect(text).toContain("// local change");
		expect(provenance(d, "Stack")).toContain(`commit: ${next}`);
	});

	it("leaves conflict markers on overlap, keeps the provenance until resolved", () => {
		const d = copy(dir);
		const f = join(d, "blocks/Section/block.yaml");
		const before = provenance(d, "Section");
		writeFileSync(
			f,
			readFileSync(f, "utf8").replace(
				"doc: Rows on one shared background.",
				"doc: Rows on one background (local).",
			),
		);
		const up = cli(d, "update", "Section", "--ref", "main");
		expect(up.code).toBe(1);
		expect(up.out).toMatch(/conflicts merging main[\s\S]*block.yaml/);
		const text = readFileSync(f, "utf8");
		expect(text).toMatch(
			/<<<<<<< local\ndoc: Rows on one background \(local\)\.\n=======/,
		);
		// Old base kept, the update is pending.
		expect(provenance(d, "Section")).toContain(
			before.split("commit: ")[1]?.split(",")[0],
		);
		expect(provenance(d, "Section")).toContain(
			`pending: { ref: main, commit: ${next} }`,
		);
		expect(cli(d, "generate", "--check").out).toMatch(
			/conflict markers in block.yaml/,
		);
		expect(cli(d, "update", "Section", "--ref", "main").out).toMatch(
			/update to main in progress/,
		);
		expect(cli(d, "update", "Section", "--continue").code).toBe(1);

		// Resolve, then continue: provenance moves to the new commit.
		writeFileSync(
			f,
			text.replace(/<<<<<<< local\n(.*\n)=======\n.*\n>>>>>>> main\n/, "$1"),
		);
		const cont = cli(d, "update", "Section", "--continue");
		expect(cont.code, cont.out).toBe(0);
		expect(provenance(d, "Section")).toContain(`ref: main, commit: ${next}`);
		expect(provenance(d, "Section")).not.toContain("pending");
		expect(cli(d, "generate", "--check").code).toBe(0);
	});

	it("generate completes an update once no markers are left", () => {
		const d = copy(dir);
		const f = join(d, "blocks/Section/block.yaml");
		writeFileSync(
			f,
			readFileSync(f, "utf8").replace(
				"doc: Rows on one shared background.",
				"doc: Local.",
			),
		);
		expect(cli(d, "update", "Section", "--ref", "main").code).toBe(1);
		writeFileSync(
			f,
			readFileSync(f, "utf8").replace(
				/<<<<<<< local\n.*\n=======\n(.*\n)>>>>>>> main\n/,
				"$1",
			),
		);
		const gen = cli(d, "generate");
		expect(gen.code, gen.out).toBe(0);
		expect(gen.out).toMatch(/update of Section completed/);
		expect(provenance(d, "Section")).toContain(`commit: ${next}`);
	});

	it("updates and diffs a block installed from the registry's old name wundercms, with a warning", () => {
		const d = copy(dir);
		// As a site had it before the rename: registry and provenance named wundercms.
		const config = join(d, "wunderweb.config.yaml");
		writeFileSync(
			config,
			readFileSync(config, "utf8").replace(
				"{name: wunderweb,",
				"{name: wundercms,",
			),
		);
		const block = join(d, "blocks/Text/block.yaml");
		writeFileSync(
			block,
			readFileSync(block, "utf8").replace(
				"registry: wunderweb,",
				"registry: wundercms,",
			),
		);
		expect(provenance(d, "Text")).toContain("registry: wundercms,");
		const diff = cliWithStderr(d, "diff", "Text", "--ref", "main");
		expect(diff.code, diff.out).toBe(0);
		expect(diff.out).toContain("+// upstream text");
		expect(diff.out).toMatch(/registry "wundercms" is now "wunderweb"/);
		const up = cli(d, "update", "Text", "--ref", "main");
		expect(up.code, up.out).toBe(0);
		expect(up.out).toMatch(/Text: updated main/);
		// The update writes the new name.
		expect(provenance(d, "Text")).toContain("registry: wunderweb,");
		expect(provenance(d, "Text")).toContain(`commit: ${next}`);
	});

	/**
	 * A copy whose Text block was installed from a repository the registry
	 * has no history of: neither its commit nor its release tag is there.
	 */
	const withoutBase = () => {
		const d = copy(dir);
		const block = join(d, "blocks/Text/block.yaml");
		writeFileSync(
			block,
			readFileSync(block, "utf8")
				.replace(/commit: [0-9a-f]{40}/, `commit: ${"dead".repeat(10)}`)
				.replace(
					/ref: "?@wunderweb\/react@[\w.-]+"?/,
					'ref: "@wunderwerkio/wundercms-react@0.4.0"',
				),
		);
		return d;
	};

	it("takes the base from the recorded release tag when the commit is gone", () => {
		const d = copy(dir);
		const block = join(d, "blocks/Text/block.yaml");
		writeFileSync(
			block,
			readFileSync(block, "utf8").replace(
				/commit: [0-9a-f]{40}/,
				`commit: ${"dead".repeat(10)}`,
			),
		);
		const up = cliWithStderr(d, "update", "Text", "--ref", "main");
		expect(up.code, up.out).toBe(0);
		expect(up.out).toMatch(/Text: updated main/);
		expect(up.out).not.toMatch(/two-way merge/);
	});

	it("updates a block whose base commit is gone with a two-way merge: differences become conflicts", () => {
		const d = withoutBase();
		const up = cliWithStderr(d, "update", "Text", "--ref", "main");
		expect(up.code, up.out).toBe(1);
		expect(up.out).toMatch(
			/Text: base commit (dead){10} not in registry wunderweb: two-way merge/,
		);
		const text = read(d, "blocks/Text/Text.tsx");
		// Unchanged lines are kept as they are; what differs is a conflict.
		expect(text).toMatch(
			/<<<<<<< local\n=======\n\n\/\/ upstream text\n>>>>>>> main\n$/,
		);
		expect(
			text.startsWith(r.read("Text/Text.tsx").split("\n")[0] as string),
		).toBe(true);
		// Resolved: the provenance moves to the new commit.
		writeFileSync(join(d, "blocks/Text/Text.tsx"), r.read("Text/Text.tsx"));
		expect(cli(d, "generate").code).toBe(0);
		expect(provenance(d, "Text")).toContain(`commit: ${next}`);
	});

	it("without a base, keeps a file on one side only and calls it a conflict", () => {
		const d = withoutBase();
		writeFileSync(join(d, "blocks/Text/Text.notes.md"), "local only\n");
		// Only the extra local file differs from upstream.
		writeFileSync(join(d, "blocks/Text/Text.tsx"), r.read("Text/Text.tsx"));
		const up = cli(d, "update", "Text", "--ref", "main");
		expect(up.code, up.out).toBe(1);
		expect(up.out).toMatch(/Text\.notes\.md \(only local, no base/);
		expect(read(d, "blocks/Text/Text.notes.md")).toBe("local only\n");
		expect(provenance(d, "Text")).toContain("pending");
	});

	it("diffs a block whose base commit is gone against upstream directly", () => {
		const d = withoutBase();
		const out = cliWithStderr(d, "diff", "Text", "--ref", "main");
		expect(out.code, out.out).toBe(0);
		expect(out.out).toMatch(/# Local against upstream \(local → main\)/);
		expect(out.out).toContain("+// upstream text");
	});

	it("diff shows local changes and upstream changes", () => {
		const d = copy(dir);
		const f = join(d, "blocks/Text/Text.tsx");
		writeFileSync(
			f,
			readFileSync(f, "utf8").replace(
				"export function Text",
				"// local note\nexport function Text",
			),
		);
		const out = cli(d, "diff", "Text", "--ref", "main");
		expect(out.code, out.out).toBe(0);
		const [local, upstream] = out.out.split("# Upstream changes");
		expect(local).toContain("# Local changes");
		expect(local).toContain("+// local note");
		expect(local).not.toContain("upstream text");
		expect(upstream).toContain("+// upstream text");
		expect(upstream).not.toContain("local note");
	});
});

describe("migrate", () => {
	/** Walks a project's text files (no node_modules). */
	function texts(dir: string, prefix = ""): string[] {
		return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap(
			(e) => {
				const rel = prefix ? `${prefix}/${e.name}` : e.name;
				if (e.isDirectory()) {
					return e.name === "node_modules" ? [] : texts(dir, rel);
				}
				return [rel];
			},
		);
	}

	/** The init project as a site had it before the rename to wunderweb. */
	function legacy(): string {
		const d = copy(base);
		const rename = (from: string, to: string) => {
			writeFileSync(join(d, to), read(d, from));
			rmSync(join(d, from));
		};
		rename("wunderweb.config.yaml", "wundercms.config.yaml");
		writeFileSync(
			join(d, "wundercms.config.yaml"),
			read(d, "wundercms.config.yaml").replace(
				/^registries: .*$/m,
				"registries: [{name: wundercms, url: git@github.com:wunderwerkio/wundercms.git, path: registry/blocks}]",
			),
		);
		rename("generated/wunderweb.css", "generated/wundercms.css");
		for (const f of texts(d)) {
			const text = read(d, f);
			const old = text
				.replaceAll("@wunderweb/", "@wunderwerkio/wundercms-")
				.replaceAll("wunderweb.css", "wundercms.css")
				.replaceAll("registry: wunderweb,", "registry: wundercms,")
				.replaceAll("urn:wunderweb:", "urn:wundercms:");
			if (old !== text) {
				writeFileSync(join(d, f), old);
			}
		}
		writeFileSync(
			join(d, "package.json"),
			`${JSON.stringify(
				{
					name: "site",
					scripts: {
						generate: "wundercms generate",
						check: "wundercms generate --check && wundercms lint --quiet",
					},
					dependencies: {
						"@wunderwerkio/wundercms-next": "file:vendor/next.tgz",
						"@wunderwerkio/wundercms-react": "0.4.0",
						react: "19.3.0",
					},
					devDependencies: { "@wunderwerkio/wundercms-cli": "0.4.0" },
					overrides: {
						"@wunderwerkio/wundercms-react": "$@wunderwerkio/wundercms-react",
					},
				},
				null,
				"\t",
			)}\n`,
		);
		writeFileSync(
			join(d, "Dockerfile"),
			"RUN npx wundercms generate --check\n",
		);
		return d;
	}

	it("renames a site in place: config, registry, provenance, generated files, imports, package.json", () => {
		const d = legacy();
		const check = cli(d, "migrate", "--check");
		expect(check.code, check.out).toBe(1);
		expect(check.out).toMatch(
			/would rename wundercms\.config\.yaml to wunderweb\.config\.yaml/,
		);
		expect(existsSync(join(d, "wundercms.config.yaml"))).toBe(true);

		const r = cli(d, "migrate");
		expect(r.code, r.out).toBe(0);
		expect(existsSync(join(d, "wundercms.config.yaml"))).toBe(false);
		const config = read(d, "wunderweb.config.yaml");
		expect(config).toContain(
			"registries: [{name: wunderweb, url: https://github.com/wunderwerkio/wunderweb.git, path: registry/blocks}]",
		);
		expect(provenance(d, "Text")).toContain("registry: wunderweb,");
		expect(existsSync(join(d, "generated/wundercms.css"))).toBe(false);
		expect(read(d, "generated/wunderweb.css")).toContain(
			"Generated by wunderweb",
		);
		expect(read(d, "generated/schema.json")).toContain("urn:wunderweb:");
		expect(read(d, "app/globals.css")).toContain(
			'@import "../generated/wunderweb.css";',
		);
		expect(read(d, "blocks/Text/Text.tsx")).toContain(
			'from "@wunderweb/react"',
		);
		expect(read(d, "app/[[...slug]]/page.tsx")).toContain(
			'from "@wunderweb/next"',
		);
		const pkg = JSON.parse(read(d, "package.json"));
		expect(pkg.scripts).toEqual({
			generate: "wunderweb generate",
			check: "wunderweb generate --check && wunderweb lint --quiet",
		});
		expect(pkg.dependencies).toEqual({
			"@wunderweb/next": `^${VERSION}`,
			"@wunderweb/react": `^${VERSION}`,
			react: "19.3.0",
		});
		expect(Object.keys(pkg.dependencies)).toEqual([
			"@wunderweb/next",
			"@wunderweb/react",
			"react",
		]);
		expect(pkg.devDependencies).toEqual({ "@wunderweb/cli": `^${VERSION}` });
		expect(pkg.overrides).toEqual({ "@wunderweb/react": "$@wunderweb/react" });
		// What it leaves to the user, by file and line.
		expect(r.out).toMatch(/left to change by hand:\n\s+Dockerfile:1: /);

		// The migrated site is consistent.
		expect(cli(d, "generate", "--check").code).toBe(0);
		const lint = cli(d, "lint", "--quiet");
		expect(lint.code, lint.out).toBe(0);
		// The provenance keeps the release tag a block was installed from.
		const left = texts(d)
			.filter((f) => f !== "Dockerfile")
			.filter((f) =>
				/wundercms/i.test(
					read(d, f).replace(
						/ref: "?@wunderwerkio\/wundercms-react@[\w.-]+"?/g,
						"",
					),
				),
			);
		expect(left).toEqual([]);
	});

	it("changes nothing the second time", () => {
		const d = legacy();
		expect(cli(d, "migrate").code).toBe(0);
		const before = Object.fromEntries(texts(d).map((f) => [f, read(d, f)]));
		const again = cli(d, "migrate");
		expect(again.code, again.out).toBe(0);
		expect(again.out).toMatch(/nothing to migrate/);
		expect(Object.fromEntries(texts(d).map((f) => [f, read(d, f)]))).toEqual(
			before,
		);
		expect(cli(d, "migrate", "--check").code).toBe(0);
	});

	it("leaves a package.json with nothing to rename as it is", () => {
		const d = copy(base);
		const text =
			'{\n  "name": "site",\n  "files": ["a", "b"],\n  "dependencies": { "react": "19.3.0" }\n}';
		writeFileSync(join(d, "package.json"), text);
		const r = cli(d, "migrate");
		expect(r.code, r.out).toBe(0);
		expect(r.out).toMatch(/nothing to migrate/);
		expect(read(d, "package.json")).toBe(text);
	});

	it("keeps a package.json's indent when it renames", () => {
		const d = copy(base);
		writeFileSync(
			join(d, "package.json"),
			'{\n  "name": "site",\n  "dependencies": {\n    "@wunderwerkio/wundercms-react": "0.4.0"\n  }\n}\n',
		);
		expect(cli(d, "migrate").code).toBe(0);
		expect(read(d, "package.json")).toBe(
			`{\n  "name": "site",\n  "dependencies": {\n    "@wunderweb/react": "^${VERSION}"\n  }\n}\n`,
		);
	});

	it("refuses a directory with both config files", () => {
		const d = legacy();
		writeFileSync(join(d, "wunderweb.config.yaml"), "schema: 1\n");
		const r = cli(d, "migrate");
		expect(r.code).toBe(1);
		expect(r.out).toMatch(
			/both wunderweb\.config\.yaml and wundercms\.config\.yaml/,
		);
	});
});
