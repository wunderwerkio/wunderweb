// Writes the generated project files (contents and staleness: core) and
// completes resolved block updates.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	blockSpecs,
	compile,
	conflicted,
	type GeneratedFile,
	type Project,
	projectBlocks,
	readBlocks,
	readTheme,
} from "@wunderweb/core";

import { withProvenance } from "./registry.js";

export {
	conflicted,
	type GeneratedFile,
	generatedFiles,
	staleFiles,
} from "@wunderweb/core";

export function writeGenerated(files: GeneratedFile[]): void {
	for (const f of files) {
		mkdirSync(join(f.file, ".."), { recursive: true });
		writeFileSync(f.file, f.text);
	}
}

/**
 * Completes updates that were merged with conflicts, once no markers are
 * left: provenance moves to the updated commit. Returns the blocks done.
 */
export function acceptResolved(project: Project): string[] {
	const done: string[] = [];
	const blocks = readBlocks(project.blocksDir);
	const resolved = blocks.filter(
		(b) => b.spec.provenance?.pending && !conflicted(b).length,
	);
	if (!resolved.length) {
		return done;
	}
	// Resolved files must satisfy the contract before provenance moves
	// (throws SchemaError; the update stays pending).
	compile(
		project.config.schema,
		readTheme(project.themeFile),
		blockSpecs(projectBlocks(project)),
	);
	for (const b of resolved) {
		const p = b.spec.provenance;
		if (!p?.pending) {
			continue;
		}
		const { pending, ...rest } = p;
		writeFileSync(
			b.file,
			withProvenance(readFileSync(b.file, "utf8"), {
				...rest,
				ref: pending.ref,
				commit: pending.commit,
			}),
		);
		done.push(b.name);
	}
	return done;
}
