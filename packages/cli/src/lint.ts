// Content lint: validator findings and files not in the canonical YAML form
// (the editor cannot patch them), grouped per file.
//
//   de/pages/home.yaml
//     error    blocks/2/items/0 (Card)  missing required "body"
//     warning  id                       no translation in en

import {
	blockIds,
	type Content,
	type Finding,
	type Project,
	readContent,
	readSchema,
	Validator,
} from "@wunderweb/core";

import { canonicalFindings } from "./format.js";

export interface LintResult {
	findings: Finding[];
	errors: number;
	warnings: number;
}

export function lint(project: Project): LintResult {
	const validator = new Validator(readSchema(project));
	const content = readContent(project);
	const findings = [
		...validator.validateSite(content, project.config),
		...canonicalFindings(project),
		...missingIdFindings(validator, content),
	];
	return {
		findings,
		errors: findings.filter((f) => f.level === "error").length,
		warnings: findings.filter((f) => f.level === "warning").length,
	};
}

/** One warning per file with blocks that have no id (`format` fills them in). */
function missingIdFindings(validator: Validator, content: Content): Finding[] {
	const out: Finding[] = [];
	for (const src of content.docs) {
		if (src.parseError) {
			continue;
		}
		const root = src.kind === "page" ? "Page" : "Fragment";
		const { missing } = blockIds(validator.walker, src.doc, root);
		const n = missing.length;
		if (n) {
			out.push({
				level: "warning",
				file: src.file,
				at: "(file)",
				message: `${n} block${n === 1 ? "" : "s"} without an id (first at ${missing[0]?.path}): run \`wunderweb format\``,
			});
		}
	}
	return out;
}

export function formatFindings(
	findings: Finding[],
	showWarnings: boolean,
): string {
	const shown = findings.filter((f) => showWarnings || f.level === "error");
	const byFile = new Map<string, Finding[]>();
	for (const f of shown) {
		byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
	}

	const lines: string[] = [];
	for (const [file, list] of [...byFile].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		lines.push(file);
		for (const f of list) {
			lines.push(`  ${f.level.padEnd(8)} ${f.at}  ${f.message}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}
