// `wunderweb format`: content files in the canonical YAML form, the one the
// hosted editor writes and can patch in place. A coding agent runs it after
// editing content so the files stay editable in the editor.

import { randomUUID } from "node:crypto";
import {
	chmodSync,
	lstatSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import {
	contentFiles,
	type Finding,
	formatYaml,
	NOT_CANONICAL,
	type Project,
	readSchema,
	Walker,
} from "@wunderweb/core";

export interface FormatResult {
	/** Files not in canonical form (written unless checking). */
	changed: string[];
	/**
	 * Files that could not be formatted, with the reason. `yaml`: not one
	 * valid YAML document (lint reports it), `unsafe`: formatting would
	 * change content, `io`: reading or writing failed.
	 */
	failed: { file: string; error: string; kind: "yaml" | "unsafe" | "io" }[];
	/** Block ids assigned (or, checking, missing or duplicate) over all files. */
	ids: number;
}

/**
 * Formats the content files. With `ids` (the default), blocks without an
 * id and the later of two duplicates get one; this needs the generated
 * schema to tell blocks from values.
 */
export function format(
	project: Project,
	check: boolean,
	{ ids = true }: { ids?: boolean } = {},
): FormatResult {
	const out: FormatResult = { changed: [], failed: [], ids: 0 };
	const walker = ids ? new Walker(readSchema(project)) : undefined;
	for (const { file, kind } of contentFiles(project)) {
		const path = join(project.contentDir, file);
		try {
			// Links are not followed: content stays inside.
			const link = linkOnTheWay(project.contentDir, file);
			if (link) {
				out.failed.push({
					file,
					error: `${link} is a symlink (not followed in content)`,
					kind: "io",
				});
				continue;
			}
			const source = readFileSync(path, "utf8");
			const r = formatYaml(
				source,
				walker && { walker, root: kind === "page" ? "Page" : "Fragment" },
			);
			if ("error" in r) {
				out.failed.push({ file, error: r.error, kind: r.kind });
				continue;
			}
			if (r.changed) {
				// The editor or an agent may have written it meanwhile: never
				// replace a newer text with the format of an older one.
				if (!check && !writeAtomicIfUnchanged(path, source, r.text)) {
					out.failed.push({
						file,
						error: "changed while formatting, run again",
						kind: "io",
					});
					continue;
				}
				out.changed.push(file);
				out.ids += r.ids;
			}
		} catch (e) {
			// E.g. removed since listed, or not writable: the other files go on.
			out.failed.push({ file, error: (e as Error).message, kind: "io" });
		}
	}
	return out;
}

/** The first symlink on the way from the content dir to the file (relative), if any. */
function linkOnTheWay(dir: string, file: string): string | undefined {
	let at = dir;
	const segs = file.split(/[\\/]/);
	for (const [i, seg] of segs.entries()) {
		at = join(at, seg);
		if (lstatSync(at).isSymbolicLink()) {
			return segs.slice(0, i + 1).join("/");
		}
	}
	return undefined;
}

/**
 * Replaces the file unless its text changed since `source` was read: a
 * fresh temp file (exclusive create) + rename, so an interrupted write
 * never leaves a truncated file. False when the file changed.
 */
function writeAtomicIfUnchanged(
	path: string,
	source: string,
	text: string,
): boolean {
	const tmp = join(dirname(path), `.${basename(path)}.${randomUUID()}.wc-tmp`);
	try {
		writeFileSync(tmp, text, { flag: "wx" });
		// The file keeps its permissions (exactly, not reduced by the umask).
		chmodSync(tmp, statSync(path).mode & 0o7777);
		if (readFileSync(path, "utf8") !== source) {
			return false;
		}
		renameSync(tmp, path);
		return true;
	} finally {
		rmSync(tmp, { force: true });
	}
}

/**
 * Lint warnings for content files the editor cannot patch. Files that are
 * not valid YAML are left to lint's own findings; missing block ids are
 * the validator's.
 */
export function canonicalFindings(project: Project): Finding[] {
	const r = format(project, true, { ids: false });
	return [
		...r.changed.map((file) => ({ file, message: NOT_CANONICAL })),
		...r.failed
			.filter((f) => f.kind === "unsafe")
			.map((f) => ({
				file: f.file,
				message: `the visual editor cannot edit it and \`wunderweb format\` cannot rewrite it (${f.error}): edit it in the IDE`,
			})),
	].map(({ file, message }) => ({
		level: "warning" as const,
		file,
		at: "(file)",
		message,
	}));
}
