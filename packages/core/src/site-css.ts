// Site CSS check: the project's global stylesheets (wunderweb.config.yaml
// `css`, default app/globals.css) style the theme, not blocks.
//
//   allowed     element selectors, theme rich text classes, theme hooks:
//               .wc-rich (and anything inside it), .wc-button / .wc-button-*,
//               page regions .wc-header / .wc-main / .wc-footer / .wc-dialog
//   rejected    other wc-* classes (runtime and block internals: .wc-inner,
//               .wc-Card, .wc-card-icon …), classes only one block renders
//               (its internals: blocks/<Name>/<Name>.css next to it), and
//               styling by page region (.wc-footer .wc-button: a size token
//               that means something else in the footer)
//
// Classes several blocks or shared components (components/) render are a
// shared look of the site and may be styled here.
//
// Block CSS (blocks/<Name>/<Name>.css) is not checked: it is reviewed with
// the block it belongs to.

import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { join, relative } from "node:path";

/** Theme hooks: elements the runtime renders for the theme to style. */
const HOOK = /^wc-(rich|button(-[a-z0-9-]+)?)$/;
/** Page regions: styled themselves, never as context for what is inside. */
const REGION = /^wc-(header|main|footer|dialog)$/;
const WC = /^wc-/;

/** Source files scanned for class names components render. */
const SOURCE = /\.(tsx|jsx|ts|js)$/;
const SKIP_DIRS = new Set(["node_modules", "generated", "dist", "out"]);

export interface SiteCssContext {
	/** Theme rich text classes (allowed: content vocabulary). */
	richTextClasses: string[];
	/** Class name → blocks rendering it ("" = a shared component outside blocks/). */
	componentClasses: Map<string, Set<string>>;
}

/** Problems of one site stylesheet; `file` is used in messages. */
export function checkSiteCss(
	css: string,
	file: string,
	ctx: SiteCssContext,
): string[] {
	const problems = new Set<string>();
	const vocab = new Set(ctx.richTextClasses);
	for (const selector of selectors(css)) {
		const at = `${file}: "${selector}"`;
		const parts = compounds(selector);
		for (const [i, part] of parts.entries()) {
			for (const c of classesOf(part)) {
				if (REGION.test(c)) {
					if (i < parts.length - 1) {
						problems.add(
							`${at}: styles blocks by page region (.${c} …); style the block itself (its fields, theme tokens or blocks/<Name>/<Name>.css)`,
						);
					}
					continue;
				}
				if (HOOK.test(c) || vocab.has(c)) {
					continue;
				}
				const owners = [...(ownersOf(ctx.componentClasses, c) ?? [])];
				const [block] = owners;
				if (owners.length === 1 && block) {
					problems.add(
						`${at}: .${c} is rendered only by block ${block}; style it in blocks/${block}/${block}.css or through the block's fields`,
					);
				} else if (!owners.length && WC.test(c)) {
					problems.add(
						`${at}: .${c} is runtime markup (box, elements), not a theme hook (.wc-rich, .wc-button*, page regions); use the box fields or the block's own CSS`,
					);
				}
			}
		}
	}
	return [...problems];
}

/**
 * Class-like tokens in string literals of the project's code, with the
 * blocks rendering them: a file in blocks/<Name>/ (or in <Name>/ of a
 * package's blocks directory) counts for block Name, any other source file
 * (components/, app/, …) as shared ("").
 */
export function componentClasses(
	root: string,
	blocksDir: string,
	packageBlocks: { dir: string }[] = [],
): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	const add = (token: string, owner: string) => {
		const owners = out.get(token) ?? new Set<string>();
		owners.add(owner);
		out.set(token, owners);
	};
	const scan = (file: string, owner: string) => {
		// The box of a block carries wc-<Name> (BoxFrame): the block's own.
		if (owner) {
			add(`wc-${owner}`, owner);
		}
		const text = readFileSync(file, "utf8");
		for (const m of text.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
			// Template literals: `wc-tiles-${mode}` names the wc-tiles-* family.
			const literal = (m[2] ?? "").replace(/\$\{[^}]*\}/g, "*");
			for (const token of literal.split(/\s+/)) {
				if (/^-?[a-z][a-z0-9]*(-[a-z0-9*]+)+$/.test(token)) {
					add(token, owner);
				}
			}
		}
	};
	// A package linked into the project (workspace) lies inside the root
	// too: its files count for their block, not as shared site code.
	const packageDirs = packageBlocks
		.filter((p) => existsSync(p.dir))
		.map((p) => realpathSync(p.dir));
	const inside = (file: string, dir: string) => {
		const rel = relative(dir, file);
		return !rel.startsWith("..") && rel.includes("/");
	};
	// Real paths on both sides, so a symlinked root compares too.
	const real = (p: string) => (existsSync(p) ? realpathSync(p) : p);
	const blocks = real(blocksDir);
	for (const file of sourceFiles(real(root))) {
		if (packageDirs.some((d) => inside(file, d))) {
			continue;
		}
		const rel = relative(blocks, file);
		scan(file, inside(file, blocks) ? (rel.split("/")[0] ?? "") : "");
	}
	for (const dir of packageDirs) {
		for (const file of sourceFiles(dir)) {
			// Files next to the block directories (an index) are shared.
			scan(
				file,
				inside(file, dir) ? (relative(dir, file).split("/")[0] ?? "") : "",
			);
		}
	}
	return out;
}

/** Owners of a class, matching template families (wc-tiles-* covers wc-tiles-flex). */
function ownersOf(
	classes: Map<string, Set<string>>,
	c: string,
): Set<string> | undefined {
	const exact = classes.get(c);
	if (exact) {
		return exact;
	}
	for (const [token, owners] of classes) {
		if (
			token.includes("*") &&
			new RegExp(
				`^${token.replace(/[.+?^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9-]+")}$`,
			).test(c)
		) {
			return owners;
		}
	}
	return undefined;
}

function sourceFiles(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir).flatMap((name) => {
		if (name.startsWith(".") || SKIP_DIRS.has(name)) {
			return [];
		}
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			return sourceFiles(p);
		}
		return SOURCE.test(name) && !name.endsWith(".d.ts") ? [p] : [];
	});
}

/** Complex selectors of every style rule (at-rule preludes and keyframes skipped). */
export function selectors(css: string): string[] {
	const text = css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(["'])(?:(?!\1)[^\\]|\\.)*\1/g, '""');
	const out: string[] = [];
	// Brace depth of @keyframes / @theme bodies: their preludes are not selectors.
	let skipUntil = -1;
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "{") {
			const prelude = text.slice(start, i).trim();
			if (skipUntil < 0) {
				if (
					/^@(keyframes|-webkit-keyframes|theme|font-face|property)\b/.test(
						prelude,
					)
				) {
					skipUntil = depth;
				} else if (
					prelude &&
					!prelude.startsWith("@") &&
					!prelude.startsWith("--")
				) {
					out.push(...splitList(prelude));
				}
			}
			depth++;
			start = i + 1;
		} else if (ch === "}") {
			depth--;
			if (depth === skipUntil) {
				skipUntil = -1;
			}
			start = i + 1;
		} else if (ch === ";") {
			start = i + 1;
		}
	}
	return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Splits a selector list at top-level commas (not inside :is(), :where() …). */
function splitList(list: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < list.length; i++) {
		const ch = list[i];
		if (ch === "(" || ch === "[") {
			depth++;
		} else if (ch === ")" || ch === "]") {
			depth--;
		} else if (ch === "," && depth === 0) {
			out.push(list.slice(start, i));
			start = i + 1;
		}
	}
	out.push(list.slice(start));
	return out;
}

/** Compound selectors of a complex selector, split at top-level combinators. */
function compounds(selector: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = "";
	for (const ch of selector) {
		if (ch === "(" || ch === "[") {
			depth++;
		} else if (ch === ")" || ch === "]") {
			depth--;
		}
		if (depth === 0 && /[\s>+~]/.test(ch)) {
			if (cur.trim()) {
				out.push(cur.trim());
			}
			cur = "";
			continue;
		}
		cur += ch;
	}
	if (cur.trim()) {
		out.push(cur.trim());
	}
	return out;
}

/** Class names in a compound selector, incl. inside :is() / :not() / :has(); escapes removed. */
function classesOf(compound: string): string[] {
	return [...compound.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) =>
		(m[1] ?? "").replace(/\\(.)/g, "$1"),
	);
}
