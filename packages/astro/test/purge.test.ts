// The post-build CSS purge (`wunderweb({ purgeCss: true })`): which classes
// count as used, which rules go, and the build step (rename, rewrite, step
// aside) against a build directory on disk.

import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AstroIntegration } from "astro";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { onDemandPages, wunderweb } from "../src/integration.js";
import {
	decodeEntities,
	decodeJsEscapes,
	hashedName,
	purgeBuild,
	purgeCss,
	usedClasses,
	withoutStyles,
} from "../src/purge.js";

const usedIn = (...texts: string[]) => usedClasses(texts);

// The first implementation: every class scanned for in the whitespace
// pieces of the build text, accepted at delimiters. Reference for the token
// Set, which must answer exactly the same.
function usedClassesByScan(texts: string[]) {
	const boundary = (c: string) => c === "" || /[\s"'`=<>{}(),;\\]/.test(c);
	const pieces = new Set<string>();
	const add = (text: string) => {
		for (const piece of text.split(/\s+/)) if (piece) pieces.add(piece);
	};
	for (const text of texts) {
		add(text);
		const html = decodeEntities(text);
		if (html !== text) add(html);
		const js = decodeJsEscapes(text);
		if (js !== text) add(js);
		const both = decodeJsEscapes(html);
		if (both !== html && both !== js) add(both);
	}
	const haystack = `\n${[...pieces].join("\n")}\n`;
	return (name: string) => {
		if (!name) return true;
		if (pieces.has(name)) return true;
		for (
			let at = haystack.indexOf(name);
			at !== -1;
			at = haystack.indexOf(name, at + 1)
		) {
			if (
				boundary(haystack.charAt(at - 1)) &&
				boundary(haystack.charAt(at + name.length))
			) {
				return true;
			}
		}
		return false;
	};
}
const purged = (css: string, ...texts: string[]) =>
	purgeCss(css, usedIn(...texts));

describe("usedClasses", () => {
	it("finds the classes of class attributes as whole tokens", () => {
		const used = usedIn('<div class="flex md:px-4 w-1/2 py-2.5">x</div>');
		for (const c of ["flex", "md:px-4", "w-1/2", "py-2.5"]) {
			expect(used(c)).toBe(true);
		}
		// Not inside a longer class name.
		for (const c of ["px-4", "w-1", "py-2", "md:px-40", "2", "1/2"]) {
			expect(used(c)).toBe(false);
		}
		expect(used("lg:px-4")).toBe(false);
		expect(used("fle")).toBe(false);
		expect(usedIn('<p class="xmd:px-4">')("md:px-4")).toBe(false);
	});

	it("decodes HTML entities: class names with quotes and ampersands", () => {
		const name = "[&>svg:not([class*='size-'])]:size-4";
		const html =
			'<span class="[&amp;&gt;svg:not([class*=&#x27;size-&#x27;])]:size-4 inline-block">';
		expect(usedIn(html)(name)).toBe(true);
		expect(usedIn(html)("[&>svg:not([class*='size-'])]:size-3")).toBe(false);
		expect(decodeEntities("&#39;&#x27;&quot;&amp;&lt;&gt;&nbsp;&bogus;")).toBe(
			"''\"&<>\u00a0&bogus;",
		);
	});

	it("decodes JS string escapes in scripts", () => {
		const js =
			'el.className="[&>svg:not([class*=\\"size-\\"])]:size-4 w-1\\u002F2 \\x61bc";';
		const used = usedIn(js);
		expect(used('[&>svg:not([class*="size-"])]:size-4')).toBe(true);
		expect(used("w-1/2")).toBe(true);
		expect(used("abc")).toBe(true);
		expect(decodeJsEscapes("a\\nb\\u{1F600}\\'")).toBe("a\nb😀'");
	});

	it("reads scripts, templates and string literals", () => {
		const used = usedIn(
			"<template><p class=\"in-template\"></p></template><script>el.classList.add('is-open');el.classList.toggle(`is-busy`,x)</script>",
			'const c=["from-js","other"];',
		);
		for (const c of ["in-template", "is-open", "is-busy", "from-js"]) {
			expect(used(c)).toBe(true);
		}
		expect(used("is-closed")).toBe(false);
	});

	it("leaves inherited object keys alone when decoding entities", () => {
		expect(decodeEntities("a&constructor;b&toString&valueOf;&amp;")).toBe(
			"a&constructor;b&toString&valueOf;&",
		);
	});

	it("answers exactly as a scan for every boundary-delimited occurrence", () => {
		// Deterministic random texts and names over the characters that
		// matter: name characters, delimiters, Unicode space, entities.
		let seed = 42;
		const random = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		const pick = <T>(xs: readonly T[]) =>
			xs[Math.floor(random() * xs.length)] as T;
		const parts = [
			..."abcxyz-_:/.[]!@&*%#1290",
			..."\"'`=<>{}(),;\\",
			" ",
			"\n",
			"\t",
			"\u00a0",
			"&amp;",
			"&#x27;",
			"\\u002F",
			'\\"',
			"md:px-4",
			"px-4",
			"[&>svg:not([class*='size-'])]:size-4",
		];
		const texts = Array.from({ length: 40 }, () =>
			Array.from({ length: 1 + Math.floor(random() * 120) }, () =>
				pick(parts),
			).join(""),
		);
		const names = new Set<string>([
			"px-4",
			"md:px-4",
			"[&>svg:not([class*='size-'])]:size-4",
			"a b",
			"x'y",
		]);
		for (const text of texts) {
			for (let i = 0; i < 30; i++) {
				const at = Math.floor(random() * text.length);
				names.add(text.slice(at, at + 1 + Math.floor(random() * 12)));
			}
		}
		for (let i = 0; i < 300; i++) {
			names.add(
				Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
					pick(parts),
				).join(""),
			);
		}
		const used = usedClasses(texts);
		const scan = usedClassesByScan(texts);
		const differ = [...names].filter((n) => used(n) !== scan(n));
		expect(differ).toEqual([]);
		expect([...names].filter(scan).length).toBeGreaterThan(100);
	});
});

describe("purgeCss", () => {
	it("removes the rules of unused classes and keeps the rest byte for byte", () => {
		const css = ".a{color:red}.b{color:blue}div{margin:0}";
		expect(purged(css, 'class="a"')).toEqual({
			css: ".a{color:red}div{margin:0}",
			removed: 1,
		});
	});

	it("returns the input unchanged when nothing is unused", () => {
		const css = "/* x */\n.a { color: red }\n";
		expect(purged(css, 'class="a"')).toEqual({ css, removed: 0 });
	});

	it("matches escaped selectors to the class names of the markup", () => {
		const css =
			".md\\:px-4{padding:1rem}.w-1\\/2{width:50%}.py-2\\.5{padding:.5rem}.lg\\:px-4{padding:2rem}";
		expect(purged(css, 'class="md:px-4 w-1/2 py-2.5"').css).toBe(
			".md\\:px-4{padding:1rem}.w-1\\/2{width:50%}.py-2\\.5{padding:.5rem}",
		);
	});

	it("keeps a class whose name has quotes (entity-encoded in the HTML)", () => {
		const css =
			".\\[\\&\\>svg\\:not\\(\\[class\\*\\=\\'size-\\'\\]\\)\\]\\:size-4>svg:not([class*=size-]){width:1rem}" +
			".\\[\\&\\>svg\\:not\\(\\[class\\*\\=\\'size-\\'\\]\\)\\]\\:size-3>svg:not([class*=size-]){width:.75rem}";
		const out = purged(
			css,
			'<i class="[&amp;&gt;svg:not([class*=&#x27;size-&#x27;])]:size-4">',
		);
		expect(out.removed).toBe(1);
		expect(out.css).toContain("size-4");
		expect(out.css).not.toContain("size-3");
	});

	it("removes media blocks it empties and keeps the others", () => {
		const css =
			"@media (width>=48rem){.md\\:block{display:block}}@media (width>=64rem){.lg\\:block{display:block}.lg\\:flex{display:flex}}";
		expect(purged(css, 'class="lg:flex"').css).toBe(
			"@media (width>=64rem){.lg\\:flex{display:flex}}",
		);
	});

	it("recurses into @supports, @container and @starting-style", () => {
		const css =
			"@supports (display:grid){.x{display:grid}}@container (width>1px){.y{color:red}}@starting-style{.z{opacity:0}}";
		expect(purged(css, "").css).toBe("");
		expect(purged(css, 'class="y"').css).toBe(
			"@container (width>1px){.y{color:red}}",
		);
	});

	it("removes a selector list only when every selector requires an unused class", () => {
		const css = ".a,.b{color:red}.c,.d{color:blue}.e,div{margin:0}";
		const out = purged(css, 'class="b"');
		expect(out.css).toBe(".a,.b{color:red}.e,div{margin:0}");
		expect(out.removed).toBe(2);
	});

	it("requires a class of :is()/:where() only when every argument requires it", () => {
		const css =
			".group-hover\\:x:is(:where(.group):hover *){color:red}" +
			":where(.a,.b) p{color:blue}" +
			":is(.a,.c) p{color:green}" +
			":is(.a,div) p{color:black}";
		expect(purged(css, 'class="group-hover:x"').css).toBe(
			":is(.a,div) p{color:black}",
		);
		expect(purged(css, 'class="group-hover:x group c"').css).toBe(
			".group-hover\\:x:is(:where(.group):hover *){color:red}:is(.a,.c) p{color:green}:is(.a,div) p{color:black}",
		);
	});

	it("never removes for classes inside :not(), :has() or other functions", () => {
		const css =
			"p:not(.gone){color:red}div:has(.gone){color:blue}li:nth-child(2 of .gone){color:green}:host(.gone){color:black}";
		expect(purged(css, "")).toEqual({ css, removed: 0 });
	});

	it("keeps @layer statements, @property, @keyframes, @font-face and unknown at-rules", () => {
		const css =
			"@layer theme,base,utilities;@property --x{syntax:'*';inherits:false}@keyframes spin{to{transform:rotate(1turn)}}@font-face{font-family:F;src:url(f.woff2)}@scope (.gone){.gone{color:red}}@page{margin:0}";
		expect(purged(css, "")).toEqual({ css, removed: 0 });
	});

	it("drops an emptied @layer block, or keeps it as a statement where it set the order", () => {
		const declared =
			"@layer a,b;@layer a{.x{color:red}}@layer b{.y{color:blue}}";
		expect(purged(declared, 'class="y"').css).toBe(
			"@layer a,b;@layer b{.y{color:blue}}",
		);
		const first = "@layer a{.x{color:red}}@layer b{.y{color:blue}}";
		expect(purged(first, 'class="y"').css).toBe(
			"@layer a;@layer b{.y{color:blue}}",
		);
		expect(purged("@layer{.x{color:red}}.y{color:blue}", 'class="y"').css).toBe(
			".y{color:blue}",
		);
	});

	it("purges nested rules and drops a rule emptied by it", () => {
		const css =
			".card{color:red;&.gone{color:blue}}.wrap{.gone &{color:green}}.box{@media (width>1px){.gone{color:black}}}";
		const out = purged(css, 'class="card wrap box"');
		expect(out.css).toBe(".card{color:red}");
		expect(out.removed).toBe(3);
	});

	it("keeps rules of elements, attributes, ids and the universal selector", () => {
		const css =
			"*,:before{box-sizing:border-box}html{color:red}[data-open]{display:block}#main{margin:0}::backdrop{opacity:.5}";
		expect(purged(css, "")).toEqual({ css, removed: 0 });
	});
});

describe("hashedName", () => {
	it("replaces Vite's hash with one of the new content, or adds one", () => {
		const a = hashedName("/x/_astro/Icons.CmhFXA_r.css", "a{}");
		expect(a).toMatch(/^Icons\.[\w-]{8}\.css$/);
		expect(a).not.toBe("Icons.CmhFXA_r.css");
		expect(hashedName("/x/Icons.CmhFXA_r.css", "a{}")).toBe(a);
		expect(hashedName("/x/Icons.CmhFXA_r.css", "b{}")).not.toBe(a);
		expect(hashedName("/x/site.css", "a{}")).toBe(a.replace("Icons", "site"));
	});

	it("keeps name segments that are no Vite hash", () => {
		const hash = hashedName("/x/a.css", "a{}").slice(2, 10);
		expect(hashedName("/x/main.template.css", "a{}")).toBe(
			`main.template.${hash}.css`,
		);
		expect(hashedName("/x/site.override.css", "a{}")).toBe(
			`site.override.${hash}.css`,
		);
		expect(hashedName("/x/v2.css", "a{}")).toBe(`v2.${hash}.css`);
		// A hash with no uppercase letter is kept: a longer name, still unique.
		expect(hashedName("/x/Icons.abcd12-_.css", "a{}")).toBe(
			`Icons.abcd12-_.${hash}.css`,
		);
		expect(hashedName("/x/Icons.DcUlM7-6.css", "a{}")).toBe(
			`Icons.${hash}.css`,
		);
		expect(hashedName("/x/Icons.490KOyoB.css", "a{}")).toBe(
			`Icons.${hash}.css`,
		);
	});
});

describe("onDemandPages", () => {
	it("lists the project's on-demand pages, not endpoints or Astro's own routes", () => {
		const r = (
			pattern: string,
			type: "page" | "endpoint" | "redirect",
			isPrerendered: boolean,
			origin: "project" | "internal" = "project",
		) => ({ pattern, type, isPrerendered, origin });
		expect(
			onDemandPages([
				r("/[...slug]", "page", true),
				r("/en", "endpoint", false),
				r("/_actions/[...path]", "endpoint", false, "internal"),
				r("/404", "page", false, "internal"),
				r("/old", "redirect", false),
				r("/account", "page", false),
				r("/_server-islands/[name]", "page", false, "internal"),
			]),
		).toEqual(["/account"]);
	});
});

describe("purgeBuild", () => {
	let root: string;
	let client: string;
	let server: string;
	let logs: { info: string[]; warn: string[] };
	const logger = {
		info: (m: string) => logs.info.push(m),
		warn: (m: string) => logs.warn.push(m),
	};
	const CSS =
		"@layer base{html{color:red}}@media (width>=48rem){.md\\:flex{display:flex}.md\\:grid{display:grid}}.used{margin:0}.unused{margin:1px}";

	const put = async (file: string, text: string) => {
		await mkdir(dirname(join(root, file)), { recursive: true });
		await writeFile(join(root, file), text);
	};
	const get = (file: string) => readFile(join(root, file), "utf8");
	const page = (body: string) =>
		`<!doctype html><html><head><link rel="stylesheet" href="/_astro/site.AbCd1234.css"></head><body>${body}</body></html>`;
	const run = (over: Partial<Parameters<typeof purgeBuild>[0]> = {}) =>
		purgeBuild({
			clientDir: client,
			assetsDir: "_astro",
			serverDir: server,
			logger,
			...over,
		});

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "wc-purge-"));
		client = join(root, "client");
		server = join(root, "server");
		logs = { info: [], warn: [] };
		await put("client/_astro/site.AbCd1234.css", CSS);
		await put("client/index.html", page('<div class="used md:flex">'));
		await put("client/en/about.html", page('<div class="used">'));
		await put(
			"server/chunks/manifest.mjs",
			'const m={"assets":["/_astro/site.AbCd1234.css","/index.html"]};',
		);
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it("purges, renames after the content and rewrites the HTML and the server manifest", async () => {
		const [file] = await run();
		const to = hashedName("site.AbCd1234.css", await get(`client/${file?.to}`));
		expect(file).toMatchObject({
			from: "_astro/site.AbCd1234.css",
			to: `_astro/${to}`,
			removed: 2,
		});
		expect(await get(`client/_astro/${to}`)).toBe(
			"@layer base{html{color:red}}@media (width>=48rem){.md\\:flex{display:flex}}.used{margin:0}",
		);
		expect(await readdir(join(client, "_astro"))).toEqual([to]);
		for (const html of ["client/index.html", "client/en/about.html"]) {
			expect(await get(html)).toContain(`href="/_astro/${to}"`);
		}
		expect(await get("server/chunks/manifest.mjs")).toContain(
			`"/_astro/${to}"`,
		);
		expect(logs.info).toEqual([
			`purgeCss _astro/site.AbCd1234.css → _astro/${to}: 0.1 KB → 0.1 KB, 2 unused selectors`,
		]);
		expect(logs.warn).toEqual([]);
	});

	it("counts a class a client script adds as used", async () => {
		await put("client/_astro/menu.Zz.js", 'b.classList.add("unused")');
		const [file] = await run();
		expect(file?.removed).toBe(1);
		expect(await get(`client/${file?.to}`)).toContain(".unused{");
	});

	it("keeps the name when nothing is unused", async () => {
		await put(
			"client/index.html",
			page('<div class="used unused md:flex md:grid">'),
		);
		const [file] = await run();
		expect(file).toMatchObject({ to: file?.from, removed: 0 });
		expect(await get("client/_astro/site.AbCd1234.css")).toBe(CSS);
	});

	it("steps aside for on-demand pages", async () => {
		expect(await run({ onDemandPages: ["/account"] })).toEqual([]);
		expect(logs.warn[0]).toMatch(
			/skipped: pages rendered on demand \(\/account\)/,
		);
		expect(await get("client/_astro/site.AbCd1234.css")).toBe(CSS);
	});

	it.each([
		["client:*", '<astro-island component-url="/_astro/X.js"></astro-island>'],
		[
			"server:defer",
			'<script data-island-id="1">let response=await fetch("/_server-islands/Cart");replaceServerIsland("1", response);</script>',
		],
	])("steps aside for islands (%s)", async (_, markup) => {
		await put("client/en/about.html", page(markup));
		expect(await run()).toEqual([]);
		expect(logs.warn[0]).toMatch(/skipped: en\/about\.html has an island/);
		expect(await get("client/_astro/site.AbCd1234.css")).toBe(CSS);
	});

	it("leaves a stylesheet a script names", async () => {
		await put("client/_astro/x.Q1.js", 'l.href="/_astro/site.AbCd1234.css"');
		expect(await run()).toEqual([]);
		expect(logs.warn[0]).toMatch(
			/leaves _astro\/site\.AbCd1234\.css as it is: _astro\/x\.Q1\.js names it/,
		);
		expect(await get("client/index.html")).toContain("site.AbCd1234.css");
	});

	it("leaves a stylesheet another stylesheet names", async () => {
		await put(
			"client/_astro/print.Pr1nTabc.css",
			'@import "./site.AbCd1234.css";',
		);
		await put(
			"client/index.html",
			page(
				'<div class="used md:flex"><link rel="stylesheet" href="/_astro/print.Pr1nTabc.css">',
			),
		);
		const files = await run();
		expect(logs.warn).toContainEqual(
			expect.stringMatching(
				/leaves _astro\/site\.AbCd1234\.css as it is: _astro\/print\.Pr1nTabc\.css names it/,
			),
		);
		expect(files.map((f) => f.from)).toEqual(["_astro/print.Pr1nTabc.css"]);
		expect(await get("client/_astro/site.AbCd1234.css")).toBe(CSS);
		expect(await get("client/en/about.html")).toContain("site.AbCd1234.css");
	});

	it("leaves a stylesheet a client JSON file names (a manifest may pin it)", async () => {
		await put(
			"client/precache.json",
			'[{"url":"/_astro/site.AbCd1234.css","revision":null}]',
		);
		expect(await run()).toEqual([]);
		expect(logs.warn[0]).toMatch(
			/leaves _astro\/site\.AbCd1234\.css as it is: precache\.json names it/,
		);
		expect(await get("client/_astro/site.AbCd1234.css")).toBe(CSS);
		expect(await get("client/precache.json")).toContain("site.AbCd1234.css");
	});

	it("leaves a stylesheet it cannot parse and purges the others", async () => {
		await put("client/_astro/broken.Br0kenAb.css", ".unused{color:red");
		await put(
			"client/index.html",
			page(
				'<div class="used md:flex"><link rel="stylesheet" href="/_astro/broken.Br0kenAb.css">',
			),
		);
		const files = await run();
		expect(logs.warn).toEqual([
			expect.stringMatching(
				/^purgeCss leaves _astro\/broken\.Br0kenAb\.css as it is: .*Unclosed block/,
			),
		]);
		expect(files.map((f) => f.from)).toEqual(["_astro/site.AbCd1234.css"]);
		expect(await get("client/_astro/broken.Br0kenAb.css")).toBe(
			".unused{color:red",
		);
		expect(await get("client/index.html")).toContain(
			"/_astro/broken.Br0kenAb.css",
		);
		expect(await get("client/index.html")).not.toContain("site.AbCd1234.css");
	});

	it("keeps the build as it was when writing fails halfway", async () => {
		// The new stylesheet and index.html's rewrite are written, en/ is
		// read-only: about.html cannot be rewritten.
		const before = {
			index: await get("client/index.html"),
			about: await get("client/en/about.html"),
			manifest: await get("server/chunks/manifest.mjs"),
		};
		await chmod(join(client, "en"), 0o555);
		try {
			expect(await run()).toEqual([]);
		} finally {
			await chmod(join(client, "en"), 0o755);
		}
		expect(logs.warn).toEqual([
			expect.stringMatching(
				/^purgeCss failed, the build keeps its original CSS: .*EACCES/,
			),
		]);
		expect(logs.info).toEqual([]);
		expect(await readdir(join(client, "_astro"))).toEqual([
			"site.AbCd1234.css",
		]);
		expect(await get("client/_astro/site.AbCd1234.css")).toBe(CSS);
		expect(await get("client/index.html")).toBe(before.index);
		expect(await get("client/en/about.html")).toBe(before.about);
		expect(await get("server/chunks/manifest.mjs")).toBe(before.manifest);
		expect(
			(await readdir(client, { recursive: true })).filter((f) =>
				f.endsWith(".tmp"),
			),
		).toEqual([]);
	});

	describe("inlined stylesheets (build.inlineStylesheets)", () => {
		const inlined = (body: string, css = CSS) =>
			`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`;
		const PURGED =
			"@layer base{html{color:red}}@media (width>=48rem){.md\\:flex{display:flex}}.used{margin:0}";

		beforeEach(async () => {
			await rm(join(client, "_astro"), { recursive: true });
			await put("client/index.html", inlined('<div class="used md:flex">'));
			await put("client/en/about.html", inlined('<div class="used">'));
		});

		it("purges each <style> in place; its own CSS is no evidence of use", async () => {
			expect(await run()).toEqual([]);
			for (const html of ["client/index.html", "client/en/about.html"]) {
				expect(await get(html)).toContain(`<style>${PURGED}</style>`);
			}
			expect(logs.info).toEqual([
				"purgeCss inlined <style> of 2 pages: 0.3 KB → 0.2 KB, 4 unused selectors",
			]);
			expect(logs.warn).toEqual([]);
		});

		it("counts a class a client script adds as used", async () => {
			await put("client/_astro/menu.Zz.js", 'b.classList.add("unused")');
			await run();
			expect(await get("client/index.html")).toContain(".unused{margin:1px}");
		});

		it("purges inlined and linked stylesheets together", async () => {
			await put("client/_astro/site.AbCd1234.css", CSS);
			await put(
				"client/index.html",
				`${inlined('<div class="used md:flex">', ".unused{color:red}.used{color:blue}")}`.replace(
					"</head>",
					'<link rel="stylesheet" href="/_astro/site.AbCd1234.css"></head>',
				),
			);
			const [file] = await run();
			const index = await get("client/index.html");
			expect(index).toContain("<style>.used{color:blue}</style>");
			expect(index).toContain(`href="/${file?.to}"`);
			expect(file?.removed).toBe(2);
		});

		it("leaves a <style> it cannot parse", async () => {
			await put(
				"client/index.html",
				inlined('<div class="used">', ".unused{color:red"),
			);
			await run();
			expect(await get("client/index.html")).toContain(
				"<style>.unused{color:red</style>",
			);
			expect(logs.warn).toEqual([
				expect.stringMatching(
					/^purgeCss leaves an inlined <style> as it is: .*Unclosed block/,
				),
			]);
		});

		it("leaves a <style> with nothing unused untouched", async () => {
			await put(
				"client/index.html",
				inlined('<div class="used unused md:flex md:grid">'),
			);
			await put(
				"client/en/about.html",
				inlined('<div class="used unused md:flex md:grid">'),
			);
			expect(await run()).toEqual([]);
			expect(await get("client/index.html")).toContain(`<style>${CSS}</style>`);
			expect(logs.info).toEqual([]);
		});
	});

	it("withoutStyles leaves <style> written in scripts, comments and textareas", () => {
		const raw = [
			'<script>el.innerHTML = "<style>" + css + "</style>"; el.classList.add("open");</script>',
			"<!-- <style>.x{}</style> -->",
			"<textarea><style>.y{}</style></textarea>",
		].join("");
		expect(withoutStyles(raw)).toBe(raw);
	});

	it("leaves a script that writes <style> strings untouched and counts its classes", async () => {
		const script =
			'<script>const s = "<style>"; b.classList.add("unused"); const e = "</style>";</script>';
		await put("client/index.html", page(`<div class="used md:flex">${script}`));
		const [file] = await run();
		expect(await get("client/index.html")).toContain(script);
		expect(await get(`client/${file?.to}`)).toContain(".unused{");
	});

	it("withoutStyles drops the CSS of <style> elements, keeps the tags", () => {
		expect(
			withoutStyles(
				'<style media="print">.a{x:y}</style><p class="b"></p><STYLE>.c{}</STYLE >',
			),
		).toBe('<style media="print"></style><p class="b"></p><STYLE></STYLE >');
	});

	it("purges only linked stylesheets of the assets directory", async () => {
		await put("client/_astro/widget.Xy.css", ".unused{color:red}");
		await put("client/public.css", ".unused{color:red}");
		await put(
			"client/index.html",
			page(
				'<div class="used md:flex"><link rel="stylesheet" href="/public.css">',
			),
		);
		const files = await run();
		expect(files.map((f) => f.from)).toEqual(["_astro/site.AbCd1234.css"]);
		expect(await get("client/_astro/widget.Xy.css")).toBe(".unused{color:red}");
		expect(await get("client/public.css")).toBe(".unused{color:red}");
	});
});

describe("integration", () => {
	type Hook = (o: unknown) => unknown;
	const hook = (i: AstroIntegration, name: string) =>
		i.hooks[name as keyof AstroIntegration["hooks"]] as Hook;

	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "wc-purge-int-"));
		await mkdir(join(root, "client/_astro"), { recursive: true });
		await writeFile(
			join(root, "client/_astro/s.AbCd1234.css"),
			".a{color:red}.b{color:blue}",
		);
		await writeFile(
			join(root, "client/index.html"),
			'<link rel="stylesheet" href="/_astro/s.AbCd1234.css"><p class="a">',
		);
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	const build = async (integration: AstroIntegration, onDemand = false) => {
		const info: string[] = [];
		const warn: string[] = [];
		hook(
			integration,
			"astro:config:done",
		)({
			config: {
				build: { assets: "_astro", server: pathToFileURL(`${root}/server/`) },
			},
			buildOutput: "server",
		});
		hook(
			integration,
			"astro:routes:resolved",
		)({
			routes: [
				{
					pattern: "/[...slug]",
					type: "page",
					isPrerendered: !onDemand,
					origin: "project",
				},
				// Astro adds it to every server build.
				{
					pattern: "/_server-islands/[name]",
					type: "page",
					isPrerendered: false,
					origin: "internal",
				},
			],
		});
		await hook(
			integration,
			"astro:build:done",
		)({
			dir: pathToFileURL(`${root}/client/`),
			logger: {
				info: (m: string) => info.push(m),
				warn: (m: string) => warn.push(m),
			},
		});
		return { info, warn, files: await readdir(join(root, "client/_astro")) };
	};

	it("purges after the build with purgeCss", async () => {
		const { info, files } = await build(wunderweb({ purgeCss: true }));
		expect(info).toHaveLength(1);
		expect(files).toHaveLength(1);
		expect(files[0]).not.toBe("s.AbCd1234.css");
	});

	it("leaves the build alone by default", async () => {
		const { info, warn, files } = await build(wunderweb());
		expect([info, warn, files]).toEqual([[], [], ["s.AbCd1234.css"]]);
	});

	it("warns and leaves the CSS when the content route renders on demand", async () => {
		const { warn, files } = await build(wunderweb({ purgeCss: true }), true);
		expect(warn).toHaveLength(1);
		expect(files).toEqual(["s.AbCd1234.css"]);
	});
});
