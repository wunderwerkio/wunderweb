// Project blocks: one directory per block, schema, component and CSS together.
//
//   blocks/Card/block.yaml   schema: in, traits, fields, defaults, types, rules, provenance
//   blocks/Card/Card.tsx     component, exports `Card`
//   blocks/Card/Card.css     optional, collected into generated/wunderweb.css
//
// Packages listed in the config's `packages` bring more block directories
// of the same layout (projectBlocks).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import YAML from "yaml";

import { type ProjectBlockSpec, SchemaError } from "./model.js";
import type { Project } from "./project.js";

export const BLOCK_FILE = "block.yaml";

const BLOCK_NAME = /^[A-Z][A-Za-z0-9]*$/;

/** Conflict markers left by a three-way merge (`wunderweb update`). */
export const CONFLICT_MARKER = /^(<{7}|>{7}) |^={7}$/m;

export interface BlockDir {
	name: string;
	dir: string;
	/** blocks/<Name>/block.yaml */
	file: string;
	spec: ProjectBlockSpec;
	/** blocks/<Name>/<Name>.tsx (may not exist). */
	component: string;
	/** blocks/<Name>/<Name>.css, if present. */
	css?: string;
	/** Package the block comes from (config `packages`); unset = the project's own. */
	package?: string;
	/** Import specifier of the component of a package block, e.g. kit/blocks/Hero/Hero.tsx */
	importPath?: string;
}

/** Every block directory with a block.yaml, sorted by name. */
export function readBlocks(dir: string): BlockDir[] {
	if (!existsSync(dir)) {
		return [];
	}
	const problems: string[] = [];
	const out: BlockDir[] = [];
	for (const name of readdirSync(dir).sort()) {
		const blockDir = join(dir, name);
		const file = join(blockDir, BLOCK_FILE);
		if (!statSync(blockDir).isDirectory() || !existsSync(file)) {
			continue;
		}
		if (!BLOCK_NAME.test(name)) {
			problems.push(`${name}: block directory must be PascalCase, e.g. Card`);
			continue;
		}
		let spec: ProjectBlockSpec;
		const text = readFileSync(file, "utf8");
		if (CONFLICT_MARKER.test(text)) {
			problems.push(
				`block ${name}: conflict markers in ${BLOCK_FILE} (resolve them, then \`wunderweb update ${name} --continue\`)`,
			);
			continue;
		}
		try {
			spec = (YAML.parse(text) ?? {}) as ProjectBlockSpec;
		} catch (e) {
			problems.push(
				`${name}/${BLOCK_FILE}: ${(e as Error).message.split("\n")[0]}`,
			);
			continue;
		}
		const css = join(blockDir, `${name}.css`);
		out.push({
			name,
			dir: blockDir,
			file,
			spec,
			component: join(blockDir, `${name}.tsx`),
			...(existsSync(css) ? { css } : {}),
		});
	}
	if (problems.length) {
		throw new SchemaError(problems);
	}
	return out;
}

/**
 * The project's blocks and those of its packages, sorted by name. A name
 * defined twice (locally and in a package, or in two packages) is a
 * SchemaError.
 */
export function projectBlocks(project: Project): BlockDir[] {
	const local = readBlocks(project.blocksDir);
	const where = relative(project.root, project.blocksDir).split("\\").join("/");
	const owner = new Map(local.map((b) => [b.name, `${where}/${b.name}`]));
	const out = [...local];
	const problems: string[] = [];
	for (const p of project.packageBlocks) {
		for (const b of readBlocks(p.dir)) {
			const first = owner.get(b.name);
			if (first) {
				problems.push(
					`block ${b.name}: defined in ${first} and in package ${p.package}`,
				);
				continue;
			}
			owner.set(b.name, `package ${p.package}`);
			out.push({
				...b,
				package: p.package,
				importPath: `${p.specifier}/${b.name}/${b.name}.tsx`,
			});
		}
	}
	if (problems.length) {
		throw new SchemaError(problems);
	}
	// Code unit order, as readBlocks sorts the directory names.
	return out.sort((a, b) => compare(a.name, b.name));
}

function compare(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	return a < b ? -1 : 1;
}

/** Block name → spec, the input of buildModel. */
export function blockSpecs(
	blocks: BlockDir[],
): Record<string, ProjectBlockSpec> {
	return Object.fromEntries(blocks.map((b) => [b.name, b.spec]));
}
