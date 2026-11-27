// Post-build CSS purge (`wunderweb({ purgeCss: true })`): removes the rules
// of the built stylesheets that can never match, because they require a
// class that appears nowhere in the build.
//
// Sites safelist every theme token for every breakpoint (`@source inline`
// in the generated CSS), so the visual editor can use any of them live. The
// built stylesheet carries them all, render-blocking on every page; a page
// uses a small part. The editor runs on the dev server, which keeps the full
// CSS; only `astro build` output is purged.
//
// - **Used** is a token match over the whole text of the build: every
//   prerendered HTML file (attributes, `<template>` content, inline scripts)
//   and every client script, also with HTML entities and JS string escapes
//   decoded. A class a script adds must be written out literally there.
// - **A rule goes** only when each of its selectors *requires* a class that
//   is never used: a class of one of its compound selectors, or one required
//   by every argument of an `:is()` / `:where()`. Classes inside `:not()`,
//   `:has()` and other functions never remove a rule. `@layer` statements,
//   `@property`, `@keyframes`, `@font-face` and unknown at-rules stay;
//   `@layer`, `@media`, `@supports`, `@container` and `@starting-style`
//   blocks are purged inside, and dropped when that empties them.
// - **Steps aside** (with a warning) for builds with on-demand pages or
//   islands, whose HTML is not in the build, and for a stylesheet a script,
//   a client JSON file or another stylesheet names.
// - **Renames** each purged file after its own content hash and rewrites the
//   HTML and the server output to the new name: assets are cached immutable
//   by name, so new content must never be served under the old name.
// - **Inlined stylesheets** (`build.inlineStylesheets`, `<style>` in the
//   prerendered HTML) are purged in place, by the same rules. Their text is
//   no evidence of use: the used classes are read from the HTML without the
//   contents of its `<style>` elements.
// - **Never breaks the build:** a stylesheet that cannot be purged stays as
//   it is; new files and rewritten references are in place before an old
//   file goes, and a failure while writing undoes the purge (warnings).

import { createHash } from "node:crypto";
import {
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import postcss, {
	type AtRule,
	type ChildNode,
	type Container,
	type Rule,
} from "postcss";
import selectorParser from "postcss-selector-parser";

/** Whether a class name (unescaped, as in the markup) is used. */
export type UsedClass = (name: string) => boolean;

// ---------------------------------------------------------------------------
// Used classes

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
};

function fromCodePoint(code: number, fallback: string): string {
	try {
		return String.fromCodePoint(code);
	} catch {
		return fallback;
	}
}

/** HTML character references decoded (numeric and the common named ones). */
export function decodeEntities(text: string): string {
	return text.replace(
		/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));?/g,
		(match, dec?: string, hex?: string, name?: string) => {
			if (dec) return fromCodePoint(Number.parseInt(dec, 10), match);
			if (hex) return fromCodePoint(Number.parseInt(hex, 16), match);
			// Own keys only: `&constructor` is no entity.
			return name && Object.hasOwn(NAMED_ENTITIES, name)
				? (NAMED_ENTITIES[name] as string)
				: match;
		},
	);
}

const SIMPLE_ESCAPES: Record<string, string> = {
	n: "\n",
	r: "\r",
	t: "\t",
	b: "\b",
	f: "\f",
	v: "\v",
	0: "\0",
};

/** JS string escapes decoded (`\"`, `\'`, `\/`, `\n`, `\xNN`, `\uNNNN`, `\u{N}`). */
export function decodeJsEscapes(text: string): string {
	return text.replace(
		/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g,
		(match, brace?: string, u4?: string, x2?: string, ch?: string) => {
			const hex = brace ?? u4 ?? x2;
			if (hex) return fromCodePoint(Number.parseInt(hex, 16), match);
			return ch === undefined ? match : (SIMPLE_ESCAPES[ch] ?? ch);
		},
	);
}

// A class counts as used where it stands as a token: between the start or
// end of the text and the characters that delimit class names in markup and
// scripts (whitespace, quotes, `=`, `<`, `>`, brackets of code, `,`, `;`,
// `\`). Characters that class names themselves are made of (`:`, `/`, `.`,
// `[`, `!`, `@`) are not, so `px-4` is not found in `md:px-4`, `px-40`,
// `w-1` not in `w-1/2`, `py-2` not in `py-2.5`. The class itself may contain
// any of them (`[&>svg:not([class*='size-'])]:size-4`).
// Whitespace is `\s` (Unicode spaces included).
const DELIMITERS = /[\s"'`=<>{}(),;\\]+/;
const HAS_DELIMITER = /[\s"'`=<>{}(),;\\]/;

function isBoundary(text: string, at: number): boolean {
	return at < 0 || at >= text.length || DELIMITERS.test(text.charAt(at));
}

/**
 * The classes used by a build, from the text of its files (HTML, scripts).
 * Each text is searched as it is, entity-decoded and escape-decoded.
 */
export function usedClasses(texts: Iterable<string>): UsedClass {
	// Every run between delimiters, once. A class without a delimiter in its
	// name is used exactly when it is one of them: O(1) per class.
	const tokens = new Set<string>();
	// Whitespace-separated pieces, once: the text a class with a delimiter in
	// its name (`[class*='size-']`, rare) is searched in.
	const pieces = new Set<string>();
	const add = (text: string) => {
		for (const piece of text.split(/\s+/)) {
			if (!piece || pieces.has(piece)) continue;
			pieces.add(piece);
			for (const token of piece.split(DELIMITERS)) {
				if (token) tokens.add(token);
			}
		}
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
	let haystack: string | undefined;
	const cache = new Map<string, boolean>();
	return (name) => {
		if (!name) return true;
		if (!HAS_DELIMITER.test(name)) return tokens.has(name);
		const known = cache.get(name);
		if (known !== undefined) return known;
		haystack ??= `\n${[...pieces].join("\n")}\n`;
		let found = false;
		for (
			let at = haystack.indexOf(name);
			at !== -1;
			at = haystack.indexOf(name, at + 1)
		) {
			if (
				isBoundary(haystack, at - 1) &&
				isBoundary(haystack, at + name.length)
			) {
				found = true;
				break;
			}
		}
		cache.set(name, found);
		return found;
	};
}

// ---------------------------------------------------------------------------
// Stylesheet

type Selector = selectorParser.Selector;

const IS_WHERE = /^:(?:is|where)$/i;

/** Whether a (complex) selector can only match an element with an unused class. */
export function requiresUnused(selector: Selector, used: UsedClass): boolean {
	for (const node of selector.nodes) {
		if (node.type === "class" && !used(node.value)) {
			return true;
		}
		if (
			node.type === "pseudo" &&
			IS_WHERE.test(node.value) &&
			node.nodes.length > 0 &&
			node.nodes.every((arg) => requiresUnused(arg, used))
		) {
			return true;
		}
	}
	return false;
}

/** The number of selectors of a rule if every one of them requires an unused class, else 0. */
function unusedSelectors(rule: Rule, used: UsedClass): number {
	let count = 0;
	let all = true;
	try {
		selectorParser((root) => {
			count = root.nodes.length;
			all = count > 0 && root.nodes.every((s) => requiresUnused(s, used));
		}).processSync(rule.selector);
	} catch {
		return 0; // a selector the parser does not know stays
	}
	return all ? count : 0;
}

// Group rules whose children are style rules in the same scope.
const GROUPS = new Set(["media", "supports", "container", "starting-style"]);

export interface PurgeCssResult {
	css: string;
	/** Selectors of the removed rules. */
	removed: number;
}

/** The stylesheet without the rules that require an unused class. */
export function purgeCss(css: string, used: UsedClass): PurgeCssResult {
	const root = postcss.parse(css);
	let removed = 0;
	// Layers declared so far (full dotted names), in document order: an
	// emptied `@layer x { }` that declared x first becomes `@layer x;` so the
	// layer order stays.
	const layers = new Set<string>();

	const layerNames = (at: AtRule, scope: string) =>
		at.params
			.split(",")
			.map((n) => n.trim())
			.filter(Boolean)
			.map((n) => (scope ? `${scope}.${n}` : n));

	// Purges a container's children; true if it had children and has none left.
	const purge = (container: Container, scope: string): boolean => {
		const had = (container.nodes?.length ?? 0) > 0;
		for (const node of [...(container.nodes ?? [])] as ChildNode[]) {
			if (node.type === "rule") {
				const n = unusedSelectors(node, used);
				if (n > 0) {
					removed += n;
					node.remove();
				} else if (purge(node, scope)) {
					node.remove();
				}
			} else if (node.type === "atrule") {
				const name = node.name.toLowerCase();
				if (name === "layer") {
					if (!node.nodes) {
						for (const n of layerNames(node, scope)) layers.add(n);
						continue;
					}
					const [full] = layerNames(node, scope);
					const first = full !== undefined && !layers.has(full);
					if (full !== undefined) layers.add(full);
					if (purge(node, full ?? scope)) {
						if (first) {
							node.replaceWith(
								postcss.atRule({ name: node.name, params: node.params }),
							);
						} else {
							node.remove();
						}
					}
				} else if (GROUPS.has(name) && node.nodes) {
					if (purge(node, scope)) node.remove();
				}
			}
		}
		return had && (container.nodes?.length ?? 0) === 0;
	};

	purge(root, "");
	return { css: removed > 0 ? root.toString() : css, removed };
}

// ---------------------------------------------------------------------------
// Build

export interface PurgeLogger {
	info(message: string): void;
	warn(message: string): void;
}

export interface PurgeBuildOptions {
	/** The client output (`astro:build:done` `dir`). */
	clientDir: string;
	/** The build's assets directory inside clientDir (`build.assets`, `_astro`): only its stylesheets are purged. */
	assetsDir: string;
	/** The server output (`build.server`) with the manifest naming the assets; absent for static builds. */
	serverDir?: string | undefined;
	/** Patterns of pages rendered on demand: their HTML is not in the build, so nothing is purged. */
	onDemandPages?: string[];
	logger: PurgeLogger;
}

export interface PurgedFile {
	/** Paths relative to clientDir. */
	from: string;
	to: string;
	before: number;
	after: number;
	removed: number;
}

// Client files read for used classes. Scripts and JSON are also namers: a
// stylesheet they name is left as it is (a script may add it elsewhere with
// classes the build does not show; JSON may pin it with a hash or integrity).
const TEXT = new Set([".html", ".htm", ".js", ".mjs", ".cjs", ".json"]);
const SERVER = new Set([".js", ".mjs", ".cjs", ".json"]);

async function files(dir: string): Promise<string[]> {
	let entries: string[];
	try {
		entries = await readdir(dir, { recursive: true });
	} catch {
		return [];
	}
	return entries.map((e) => join(dir, e));
}

const isHtml = (file: string) => /\.html?$/i.test(file);

// A `<style>` element of prerendered HTML: open tag, CSS, close tag. Its CSS
// cannot contain `</style` (the HTML parser would end the element there).
// Raw-text regions (`<script>`, comments, `<textarea>`) are matched first and
// left as they are: `<style>` written inside a script string or a comment is
// no stylesheet, and the text around it stays evidence of use.
const STYLE =
	/<script\b[\s\S]*?<\/script\s*>|<!--[\s\S]*?-->|<textarea\b[\s\S]*?<\/textarea\s*>|(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;

/** Calls `style` for each `<style>` element of `html` (open tag, CSS, close tag); the rest stays. */
function replaceStyles(
	html: string,
	style: (open: string, css: string, close: string) => string,
): string {
	return html.replace(
		STYLE,
		(match, open?: string, css?: string, close?: string) =>
			open === undefined ? match : style(open, css ?? "", close ?? ""),
	);
}

/** The HTML without the contents of its `<style>` elements (whose CSS names classes it does not use). */
export function withoutStyles(html: string): string {
	return replaceStyles(html, (open, _css, close) => `${open}${close}`);
}

/** Totals of the `<style>` elements purged in a build's HTML. */
export interface PurgedInline {
	/** HTML files with at least one purged `<style>`. */
	pages: number;
	before: number;
	after: number;
	removed: number;
}

/**
 * Every `<style>` of `html` purged with `purge`, which caches by CSS text
 * (the same stylesheet is inlined in many pages) and answers undefined for
 * a `<style>` it cannot parse: that one stays as it is.
 */
function purgeStyles(
	html: string,
	purge: (css: string) => PurgeCssResult | undefined,
): { html: string; before: number; after: number; removed: number } {
	let before = 0;
	let after = 0;
	let removed = 0;
	const next = replaceStyles(html, (open, css, close) => {
		const result = purge(css);
		if (!result || result.removed === 0) return `${open}${css}${close}`;
		before += Buffer.byteLength(css);
		after += Buffer.byteLength(result.css);
		removed += result.removed;
		return `${open}${result.css}${close}`;
	});
	return { html: next, before, after, removed };
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

async function exists(file: string): Promise<boolean> {
	try {
		await stat(file);
		return true;
	} catch {
		return false;
	}
}

// Vite's `[name].[hash]`: 8 base64url characters. A segment counts as that
// hash only with an uppercase letter in it, which ~98% of hashes have and
// names like `main.template.css` lack. A hash without one stays in the
// name (`Icons.abcd1234.<new>.css`): longer, never wrong.
const VITE_HASH = /\.(?=[\w-]*[A-Z])[\w-]{8}$/;

/** `Name.<hash>.css` with the hash of the content (Vite's hash replaced, else added). */
export function hashedName(file: string, css: string): string {
	const hash = createHash("sha256").update(css).digest("base64url").slice(0, 8);
	const stem = basename(file)
		.replace(/\.css$/i, "")
		.replace(VITE_HASH, "");
	return `${stem}.${hash}.css`;
}

interface Plan {
	sheet: string;
	from: string;
	to: string;
	css: string;
	before: number;
	removed: number;
}

/**
 * Purges the stylesheets of a build in place; returns what changed. Never
 * fails the build and never leaves it broken: a stylesheet that cannot be
 * purged stays as it is, and a failure while writing undoes the purge
 * (warnings). New files and references are written before the old files
 * go; a reference left behind still finds its file.
 */
export async function purgeBuild(
	opts: PurgeBuildOptions,
): Promise<PurgedFile[]> {
	try {
		return await purge(opts);
	} catch (error) {
		opts.logger.warn(
			`purgeCss failed, the build keeps its original CSS: ${message(error)}`,
		);
		return [];
	}
}

async function purge(opts: PurgeBuildOptions): Promise<PurgedFile[]> {
	const { clientDir, logger } = opts;
	const rel = (file: string) => relative(clientDir, file);
	if (opts.onDemandPages && opts.onDemandPages.length > 0) {
		logger.warn(
			`purgeCss skipped: pages rendered on demand (${opts.onDemandPages.join(", ")}) are not in the build output, so the classes they use are unknown`,
		);
		return [];
	}

	// 1. Read, decide and purge in memory; nothing is written yet.
	const all = await files(clientDir);
	const texts = new Map<string, string>();
	for (const file of all) {
		if (TEXT.has(extname(file).toLowerCase())) {
			texts.set(file, await readFile(file, "utf8"));
		}
	}
	for (const [file, text] of texts) {
		// `<astro-island>`: client:*; `replaceServerIsland(`: server:defer.
		if (isHtml(file) && /<astro-island\b|\breplaceServerIsland\(/.test(text)) {
			logger.warn(
				`purgeCss skipped: ${rel(file)} has an island (client:* or server:defer), whose markup is not in the build output`,
			);
			return [];
		}
	}

	const assets = join(clientDir, opts.assetsDir);
	const sheets = all.filter(
		(f) =>
			extname(f).toLowerCase() === ".css" &&
			!relative(assets, f).startsWith(".."),
	);
	const css = new Map<string, string>();
	for (const sheet of sheets) css.set(sheet, await readFile(sheet, "utf8"));

	const html = [...texts.keys()].filter(isHtml);
	// The text classes count as used in: HTML without its inlined CSS.
	const evidence = () =>
		[...texts].map(([f, text]) => (isHtml(f) ? withoutStyles(text) : text));
	const candidates: string[] = [];
	for (const sheet of sheets) {
		const name = basename(sheet);
		if (!html.some((f) => texts.get(f)?.includes(name))) continue;
		const namer =
			[...texts].find(([f, text]) => !isHtml(f) && text.includes(name))?.[0] ??
			[...css].find(([f, text]) => f !== sheet && text.includes(name))?.[0];
		if (namer) {
			logger.warn(
				`purgeCss leaves ${rel(sheet)} as it is: ${rel(namer)} names it and may use classes the build does not show`,
			);
			continue;
		}
		candidates.push(sheet);
	}
	const inline = html.some((f) => /<style\b/i.test(texts.get(f) ?? ""));
	if (candidates.length === 0 && !inline) return [];

	const used = usedClasses(evidence());
	const plans: Plan[] = [];
	for (const sheet of candidates) {
		const before = css.get(sheet) ?? "";
		try {
			const result = purgeCss(before, used);
			const from = basename(sheet);
			const to = result.removed > 0 ? hashedName(sheet, result.css) : from;
			if (to !== from && (await exists(join(dirname(sheet), to)))) {
				logger.warn(
					`purgeCss leaves ${rel(sheet)} as it is: ${to} exists already`,
				);
				continue;
			}
			plans.push({
				sheet,
				from,
				to,
				css: result.css,
				before: Buffer.byteLength(before),
				removed: result.removed,
			});
		} catch (error) {
			logger.warn(`purgeCss leaves ${rel(sheet)} as it is: ${message(error)}`);
		}
	}
	const renames = plans.filter((p) => p.to !== p.from);

	// The files naming a renamed sheet (HTML; the server manifest), rewritten.
	const rewrite = (text: string) =>
		renames.reduce(
			(t, p) => (t.includes(p.from) ? t.split(p.from).join(p.to) : t),
			text,
		);
	// Inlined stylesheets, purged per CSS text (once for every page that has it).
	const inlined = new Map<string, PurgeCssResult | undefined>();
	const purgeInline = (text: string): PurgeCssResult | undefined => {
		if (inlined.has(text)) return inlined.get(text);
		let result: PurgeCssResult | undefined;
		try {
			result = purgeCss(text, used);
		} catch (error) {
			logger.warn(
				`purgeCss leaves an inlined <style> as it is: ${message(error)}`,
			);
		}
		inlined.set(text, result);
		return result;
	};
	const totals: PurgedInline = { pages: 0, before: 0, after: 0, removed: 0 };
	const purgedHtml = new Map<string, string>();
	if (inline) {
		for (const file of html) {
			const text = texts.get(file) ?? "";
			const result = purgeStyles(text, purgeInline);
			if (result.removed === 0) continue;
			purgedHtml.set(file, result.html);
			totals.pages += 1;
			totals.before += result.before;
			totals.after += result.after;
			totals.removed += result.removed;
		}
	}

	const references = new Map<string, string>();
	const server = opts.serverDir
		? (await files(opts.serverDir)).filter((f) =>
				SERVER.has(extname(f).toLowerCase()),
			)
		: [];
	for (const file of [...html, ...server]) {
		const text = texts.get(file) ?? (await readFile(file, "utf8"));
		const next = rewrite(purgedHtml.get(file) ?? text);
		if (next !== text) references.set(file, next);
	}

	// 2. Write the new stylesheets, then every reference (each through a
	// temporary file renamed over it). A failure removes what was written.
	const written: string[] = [];
	const temporary = (file: string) => `${file}.purgecss-${process.pid}.tmp`;
	const undo = async () => {
		for (const file of written) await rm(file, { force: true }).catch(() => {});
	};
	const write = async (file: string, text: string, flag: "wx" | "w") => {
		try {
			await writeFile(file, text, { flag });
		} catch (error) {
			// A partly written file of ours goes; one that existed stays.
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				await rm(file, { force: true }).catch(() => {});
			}
			throw error;
		}
		written.push(file);
	};
	try {
		for (const p of renames) {
			await write(join(dirname(p.sheet), p.to), p.css, "wx");
		}
		for (const [file, text] of references) {
			await write(temporary(file), text, "w");
		}
	} catch (error) {
		await undo();
		throw error;
	}
	// Each rename replaces a reference whole. Should one fail, the old and
	// the new stylesheets both stay, so every reference still resolves.
	for (const file of references.keys()) {
		try {
			await rename(temporary(file), file);
		} catch (error) {
			for (const f of references.keys()) {
				await rm(temporary(f), { force: true }).catch(() => {});
			}
			logger.warn(
				`purgeCss could not rewrite ${file}, the original stylesheets stay next to the purged ones: ${message(error)}`,
			);
			return [];
		}
	}

	// 3. Only now the old stylesheets go.
	const purged: PurgedFile[] = [];
	for (const p of plans) {
		if (p.to !== p.from) {
			await rm(p.sheet).catch((error) =>
				logger.warn(
					`purgeCss could not remove ${rel(p.sheet)}: ${message(error)}`,
				),
			);
		}
		const entry: PurgedFile = {
			from: rel(p.sheet),
			to: rel(join(dirname(p.sheet), p.to)),
			before: p.before,
			after: Buffer.byteLength(p.css),
			removed: p.removed,
		};
		purged.push(entry);
		logger.info(
			`purgeCss ${entry.from} → ${entry.to}: ${kb(entry.before)} → ${kb(entry.after)}, ${entry.removed} unused selectors`,
		);
	}
	if (totals.pages > 0) {
		const pages = totals.pages === 1 ? "1 page" : `${totals.pages} pages`;
		logger.info(
			`purgeCss inlined <style> of ${pages}: ${kb(totals.before)} → ${kb(totals.after)}, ${totals.removed} unused selectors`,
		);
	}
	return purged;
}
