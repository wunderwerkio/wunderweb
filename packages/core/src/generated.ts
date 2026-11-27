// Generated project files, from core version + theme + blocks (after the
// contract checks: blocks, and site stylesheets styling no block internals):
//
//   generated/schema.json     JSON Schema (validation, editor autocomplete)
//   generated/types.ts        TypeScript types (component props)
//   generated/components.ts   component map: block type → blocks/<Name>/<Name>.tsx
//                             (package blocks: <package>/<dir>/<Name>/<Name>.tsx)
//   generated/wunderweb.css   Tailwind v4 theme tokens, block CSS, safelist
//
// Written by the CLI (`generate`); `staleGenerated` tells the CLI and the
// edit service whether they are current.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
	type BlockDir,
	blockSpecs,
	CONFLICT_MARKER,
	projectBlocks,
} from "./blocks.js";
import { CSS_FILE, toThemeCss } from "./css.js";
import { compile, readTheme } from "./index.js";
import { SchemaError } from "./model.js";
import type { Project } from "./project.js";
import { SCHEMA_FILE } from "./site.js";
import { checkSiteCss, componentClasses } from "./site-css.js";

export const TYPES_FILE = "types.ts";
export const COMPONENTS_FILE = "components.ts";

export interface GeneratedFile {
	file: string;
	text: string;
}

/**
 * Contents of all generated files. Throws SchemaError when a block breaks
 * the contract, has no component, pins another contract major or still
 * has unresolved update conflicts.
 */
export function generatedFiles(project: Project): GeneratedFile[] {
	const blocks = projectBlocks(project);
	checkBlocks(blocks);
	const theme = readTheme(project.themeFile);
	const { model, schema, types } = compile(
		project.config.schema,
		theme,
		blockSpecs(blocks),
		"site",
	);
	checkCss(project, model.richText.classes);
	const dir = project.generatedDir;

	// Tailwind scans the project; the runtime package ships compiled classes
	// (box traits, elements) that must be scanned too, and so do the blocks
	// (node_modules is not scanned by default: package blocks are listed).
	const runtime = relative(
		dir,
		join(project.root, "node_modules", "@wunderweb", "react", "dist"),
	);
	const blockCss = blocks.flatMap((b) =>
		b.css ? [{ block: b.name, css: readFileSync(b.css, "utf8") }] : [],
	);

	return [
		{
			file: join(dir, SCHEMA_FILE),
			text: `${JSON.stringify(schema, null, "\t")}\n`,
		},
		{ file: join(dir, TYPES_FILE), text: types },
		{ file: join(dir, COMPONENTS_FILE), text: componentMap(blocks, dir) },
		{
			file: join(dir, CSS_FILE),
			text: toThemeCss(
				model,
				[
					runtime,
					relative(dir, project.blocksDir),
					...project.packageBlocks.map((p) => relative(dir, p.dir)),
				].map(posix),
				blockCss,
			),
		},
	];
}

/** Files whose content differs from what generate would write. */
export function staleFiles(files: GeneratedFile[]): string[] {
	return files
		.filter(
			(f) => !existsSync(f.file) || readFileSync(f.file, "utf8") !== f.text,
		)
		.map((f) => f.file);
}

/**
 * Generated files that differ from what `generate` would write now (theme,
 * blocks or stylesheets changed without regenerating). Throws SchemaError
 * when the blocks break the contract.
 */
export function staleGenerated(project: Project): string[] {
	return staleFiles(generatedFiles(project));
}

/** Files of a block that still hold conflict markers. */
export function conflicted(b: Pick<BlockDir, "dir">): string[] {
	return Object.entries(readDir(b.dir) ?? {})
		.filter(([, text]) => CONFLICT_MARKER.test(text))
		.map(([f]) => f);
}

/**
 * Site stylesheets style the theme (type, button variants, rich text
 * classes), not blocks: block internals and region overrides are rejected.
 */
function checkCss(project: Project, richTextClasses: string[]) {
	const files = project.cssFiles.filter((f) => existsSync(f));
	if (!files.length) {
		return;
	}
	const ctx = {
		richTextClasses,
		componentClasses: componentClasses(
			project.root,
			project.blocksDir,
			project.packageBlocks,
		),
	};
	const problems = files.flatMap((f) =>
		checkSiteCss(
			readFileSync(f, "utf8"),
			posix(relative(project.root, f)),
			ctx,
		),
	);
	if (problems.length) {
		throw new SchemaError(problems);
	}
}

/** Component present and exported by name; no unresolved update. */
function checkBlocks(blocks: BlockDir[]) {
	const problems: string[] = [];
	for (const b of blocks) {
		const where = `block ${b.name}`;
		const markers = conflicted(b);
		if (markers.length) {
			problems.push(
				`${where}: conflict markers in ${markers.join(", ")} (resolve them, then \`wunderweb update ${b.name} --continue\`)`,
			);
			continue;
		}
		if (b.spec.provenance?.pending) {
			problems.push(
				`${where}: update to ${b.spec.provenance.pending.ref} not completed (run \`wunderweb generate\` or \`wunderweb update ${b.name} --continue\`)`,
			);
		}
		if (!existsSync(b.component)) {
			problems.push(
				`${where}: no component (${b.name}/${b.name}.tsx exporting ${b.name})`,
			);
			continue;
		}
		const exported = new RegExp(
			`export\\s+(?:const|let|function|class)\\s+${b.name}\\b|export\\s*\\{[^}]*\\b${b.name}\\b[^}]*\\}`,
		);
		if (!exported.test(readFileSync(b.component, "utf8"))) {
			problems.push(`${where}: ${b.name}.tsx does not export ${b.name}`);
		}
	}
	if (problems.length) {
		throw new SchemaError(problems);
	}
}

function componentMap(blocks: BlockDir[], dir: string): string {
	const imports = blocks.map((b) => {
		if (b.importPath) {
			return `import { ${b.name} } from "${b.importPath}";`;
		}
		let from = posix(relative(dir, b.component)).replace(/\.tsx$/, "");
		if (!from.startsWith(".")) {
			from = `./${from}`;
		}
		return `import { ${b.name} } from "${from}";`;
	});
	return [
		"// Generated by wunderweb from the blocks directory - do not edit.",
		"// One component per block: blocks/<Name>/<Name>.tsx exports <Name>.",
		"",
		'import type { Components } from "@wunderweb/react";',
		"",
		...imports,
		'import type { BlockMap } from "./types";',
		"",
		`export const components: Components<BlockMap> = {${blocks.length ? `\n${blocks.map((b) => `\t${b.name},`).join("\n")}\n` : ""}};`,
		"",
	].join("\n");
}

function posix(p: string): string {
	return p.split("\\").join("/");
}

/** Files of a directory, recursively: relative path → text. */
export function readDir(dir: string): Record<string, string> | undefined {
	if (!existsSync(dir) || !statSync(dir).isDirectory()) {
		return undefined;
	}
	const out: Record<string, string> = {};
	const walk = (d: string) => {
		for (const name of readdirSync(d).sort()) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) {
				walk(p);
			} else {
				out[relative(dir, p).split("\\").join("/")] = readFileSync(p, "utf8");
			}
		}
	};
	walk(dir);
	return out;
}
