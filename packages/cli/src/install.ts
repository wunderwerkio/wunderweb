// Registry commands on a project's blocks directory:
//
//   add <Item>…      install items (and their dependencies) with provenance
//   update <Block>   three-way merge: base = recorded commit, theirs = new ref, ours = local
//   diff <Block>     local changes against the base, upstream changes since the base
//
// Installed blocks are plain project files; the build never needs the registry.

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	BLOCK_FILE,
	blockSpecs,
	compile,
	type Project,
	type ProjectBlockSpec,
	type Provenance,
	projectBlocks,
	readTheme,
} from "@wunderweb/core";
import YAML from "yaml";

import { conflicted } from "./generate.js";
import { mergeFile } from "./git.js";
import {
	DEFAULT_REGISTRY,
	findRegistry,
	type Item,
	readBase,
	readDir,
	readItem,
	registryForm,
	releaseTags,
	resolveSource,
	runtimeVersion,
	type Source,
	satisfies,
	WORKING_TREE,
	withProvenance,
} from "./registry.js";

export interface InstallOptions {
	registry?: string | undefined;
	ref?: string | undefined;
}

export interface Installed {
	block: string;
	source: Source;
	/** Installed as a dependency of another item. */
	dependency: boolean;
}

export interface AddResult {
	installed: Installed[];
	/** Messages for the user, e.g. a fallback to another tag or npm packages to install. */
	notes: string[];
}

const BLOCK_NAME = /^[A-Z][A-Za-z0-9]*$/;

/** Item and dependency names are block directory names; item files stay inside it. */
function checkItemFiles(name: string, files: Record<string, string>) {
	if (!BLOCK_NAME.test(name)) {
		throw new Error(`invalid item name "${name}" (PascalCase, e.g. Card)`);
	}
	for (const f of Object.keys(files)) {
		if (
			f.startsWith("/") ||
			/^[A-Za-z]:/.test(f) ||
			f.split(/[\\/]+/).some((part) => part === ".." || part === "")
		) {
			throw new Error(`${name}: invalid item file path "${f}"`);
		}
	}
}

/** npm packages declared by items, as a note for the user. */
function npmNote(items: [string, Item][]): string[] {
	const pkgs = items.flatMap(([n, it]) =>
		Object.entries(it.manifest.npm ?? {}).map(([p, v]) => `${p}@${v} (${n})`),
	);
	return pkgs.length
		? [`install the npm packages the blocks need: ${pkgs.join(", ")}`]
		: [];
}

/**
 * Installs items. Checks everything first (ref, dependencies, contract major,
 * runtime range, the contract with the items added, existing directories);
 * nothing is written if a check fails.
 */
export function add(
	project: Project,
	names: string[],
	opts: InstallOptions = {},
): AddResult {
	const registry = findRegistry(
		project,
		opts.registry ?? DEFAULT_REGISTRY.name,
	);
	const blocks = projectBlocks(project);
	const installed = new Set(blocks.map((b) => b.name));
	const fromPackage = new Map(
		blocks.flatMap((b) => (b.package ? [[b.name, b.package]] : [])),
	);
	for (const n of names) {
		checkItemFiles(n, {});
		const pkg = fromPackage.get(n);
		if (pkg) {
			throw new Error(
				`block ${n} comes from package ${pkg} (config \`packages\`); update the package instead`,
			);
		}
		if (installed.has(n) || existsSync(join(project.blocksDir, n))) {
			throw new Error(
				`block ${n} already exists in ${project.config.blocks} (use \`wunderweb update ${n}\`)`,
			);
		}
	}

	const notes: string[] = [];
	const planned = new Map<
		string,
		{ item: Item; source: Source; dependency: boolean }
	>();
	const first = resolveSource(project, registry, opts.ref);
	for (const name of names) {
		const { item, source } = pick(project, first, name, notes);
		planned.set(name, { item, source, dependency: false });
		// Dependencies come from the same source; installed ones are kept.
		const queue = [...(item.manifest.dependencies ?? [])];
		while (queue.length) {
			const dep = queue.shift() as string;
			if (installed.has(dep) || planned.has(dep)) {
				continue;
			}
			const found = readItem(source, dep);
			if (!found) {
				throw new Error(
					`${name}: dependency ${dep} not found in registry ${registry.name} at ${source.ref}`,
				);
			}
			checkPins(project, found, dep, source);
			planned.set(dep, { item: found, source, dependency: true });
			queue.push(...(found.manifest.dependencies ?? []));
		}
	}

	// The contract, with the items added to the project model.
	const files = new Map<string, Record<string, string>>();
	const specs: Record<string, ProjectBlockSpec> = {};
	for (const [name, { item, source }] of planned) {
		checkItemFiles(name, item.files);
		const block = item.files[BLOCK_FILE];
		if (block === undefined) {
			throw new Error(`${name}: item has no ${BLOCK_FILE}`);
		}
		const text = withProvenance(block, provenance(source, name, item));
		files.set(name, { ...item.files, [BLOCK_FILE]: text });
		specs[name] = YAML.parse(text) as ProjectBlockSpec;
	}
	checkContract(project, specs);

	for (const [name, f] of files) {
		writeBlock(join(project.blocksDir, name), f);
	}
	notes.push(...npmNote([...planned].map(([n, p]) => [n, p.item])));
	return {
		installed: [...planned].map(([block, p]) => ({
			block,
			source: p.source,
			dependency: p.dependency,
		})),
		notes,
	};
}

/** The item at the source, or at the newest release tag that targets the project's major. */
function pick(
	project: Project,
	source: Source,
	name: string,
	notes: string[],
): { item: Item; source: Source } {
	const item = readItem(source, name);
	if (!item) {
		throw new Error(
			`registry ${source.registry.name} has no item ${name} at ${source.ref}`,
		);
	}
	const major = project.config.schema;
	if (item.manifest.schema === major) {
		checkPins(project, item, name, source);
		return { item, source };
	}
	if (source.ref !== WORKING_TREE) {
		for (const tag of releaseTags(source.registry)) {
			const older = readItem(tag, name);
			if (older?.manifest.schema === major) {
				checkPins(project, older, name, tag);
				notes.push(
					`${name}: ${source.ref} targets contract ${item.manifest.schema}, installed ${tag.ref} (contract ${major})`,
				);
				return { item: older, source: tag };
			}
		}
	}
	throw new Error(
		`${name}: targets contract ${item.manifest.schema}, the project uses ${major}; no release of the item targets ${major}`,
	);
}

/** Contract major and, outside the wunderweb registry, the runtime range. */
function checkPins(project: Project, item: Item, name: string, source: Source) {
	if (item.manifest.schema !== project.config.schema) {
		throw new Error(
			`${name}: targets contract ${item.manifest.schema}, the project uses ${project.config.schema}`,
		);
	}
	const range = item.manifest.runtime;
	if (!source.registry.isDefault && range) {
		const v = runtimeVersion(project);
		if (!satisfies(v, range)) {
			throw new Error(`${name}: needs runtime ${range}, the project has ${v}`);
		}
	}
}

function provenance(source: Source, item: string, it: Item): Provenance {
	return {
		registry: source.registry.name,
		item,
		ref: source.ref,
		commit: source.commit,
		schema: it.manifest.schema,
	};
}

/** Compiles the project with some blocks replaced / added; throws SchemaError. */
function checkContract(
	project: Project,
	changed: Record<string, ProjectBlockSpec>,
) {
	compile(project.config.schema, readTheme(project.themeFile), {
		...blockSpecs(projectBlocks(project)),
		...changed,
	});
}

function writeBlock(dir: string, files: Record<string, string>) {
	for (const [f, text] of Object.entries(files)) {
		const path = join(dir, f);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	}
}

// ----------------------------------------------------------------- update

export interface UpdateResult {
	block: string;
	from: string;
	to: string;
	/** "unchanged": no changes upstream nor locally; "replaced": no local changes; "merged": clean merge; "conflicts". */
	outcome: "unchanged" | "replaced" | "merged" | "conflicts";
	conflicts: string[];
	/** Dependencies of the new version that were installed. */
	added: string[];
}

/**
 * Per-file three-way merge (git merge-file): base = the item at the recorded
 * commit, theirs = the item at the new ref, ours = the local files. The
 * block stays untouched when a check fails. Conflicts leave markers and a
 * pending provenance, completed by `update --continue` or `generate`.
 */
export function update(
	project: Project,
	name: string,
	opts: InstallOptions = {},
): UpdateResult {
	const { dir, p } = installedBlock(project, name);
	if (p.pending) {
		throw new Error(
			`block ${name} has an update to ${p.pending.ref} in progress (resolve it, then run \`wunderweb update ${name} --continue\`)`,
		);
	}
	const registry = findRegistry(project, p.registry);
	const source = resolveSource(project, registry, opts.ref);
	const theirs = readItem(source, p.item);
	if (!theirs) {
		throw new Error(
			`registry ${registry.name} has no item ${p.item} at ${source.ref}`,
		);
	}
	checkItemFiles(name, theirs.files);
	checkPins(project, theirs, name, source);
	const base = baseOf(project, p);
	const ours = registryForm(readDir(dir) ?? {});
	const result: UpdateResult = {
		block: name,
		from: p.ref,
		to: source.ref,
		outcome: "merged",
		conflicts: [],
		added: [],
	};

	// Nothing to merge: same files locally, at the base and upstream.
	if (same(ours, base.files) && same(base.files, theirs.files)) {
		return { ...result, outcome: "unchanged" };
	}
	const unmodified = same(ours, base.files);
	const merged = unmodified
		? { ...theirs.files }
		: mergeFiles(ours, base.files, theirs.files, source.ref, result.conflicts);
	const next = provenance(source, p.item, theirs);

	if (result.conflicts.length) {
		const kept: Provenance = {
			...p,
			pending: { ref: next.ref, commit: next.commit },
		};
		replaceBlock(dir, merged, kept);
		return { ...result, outcome: "conflicts" };
	}

	// A clean result must still satisfy the contract (new dependencies included).
	const spec = YAML.parse(
		withProvenance(merged[BLOCK_FILE] ?? "", next),
	) as ProjectBlockSpec;
	// New dependencies of the new version (transitively), installed with it.
	const missing: string[] = [];
	const deps: Record<string, ProjectBlockSpec> = {};
	const depFiles = new Map<string, Record<string, string>>();
	const queue = [...(theirs.manifest.dependencies ?? [])];
	// Dependencies a package provides are not installed into blocks/.
	const provided = new Set(
		projectBlocks(project)
			.filter((b) => b.package)
			.map((b) => b.name),
	);
	while (queue.length) {
		const d = queue.shift() as string;
		checkItemFiles(d, {});
		if (
			d === name ||
			missing.includes(d) ||
			provided.has(d) ||
			existsSync(join(project.blocksDir, d))
		) {
			continue;
		}
		const item = readItem(source, d);
		if (!item) {
			throw new Error(`${name}: dependency ${d} not found at ${source.ref}`);
		}
		checkItemFiles(d, item.files);
		checkPins(project, item, d, source);
		const text = withProvenance(
			item.files[BLOCK_FILE] ?? "",
			provenance(source, d, item),
		);
		missing.push(d);
		deps[d] = YAML.parse(text) as ProjectBlockSpec;
		depFiles.set(d, { ...item.files, [BLOCK_FILE]: text });
		queue.push(...(item.manifest.dependencies ?? []));
	}
	checkContract(project, { ...deps, [name]: spec });

	replaceBlock(dir, merged, next);
	for (const [d, f] of depFiles) {
		writeBlock(join(project.blocksDir, d), f);
	}
	return {
		...result,
		outcome: unmodified ? "replaced" : "merged",
		added: missing,
	};
}

/** `update --continue`: conflicts resolved, provenance moves to the pending commit. */
export function continueUpdate(project: Project, name: string): string {
	const { dir, p } = installedBlock(project, name);
	if (!p.pending) {
		throw new Error(`block ${name} has no update in progress`);
	}
	const left = conflicted({ dir });
	if (left.length) {
		throw new Error(
			`block ${name}: conflict markers left in ${left.join(", ")}`,
		);
	}
	// The resolved block must satisfy the contract before provenance moves.
	checkContract(project, {});
	const { pending, ...rest } = p;
	const file = join(dir, BLOCK_FILE);
	writeFileSync(
		file,
		withProvenance(readFileSync(file, "utf8"), {
			...rest,
			ref: pending.ref,
			commit: pending.commit,
		}),
	);
	return pending.ref;
}

function mergeFiles(
	ours: Record<string, string>,
	base: Record<string, string>,
	theirs: Record<string, string>,
	ref: string,
	conflicts: string[],
): Record<string, string> {
	const out: Record<string, string> = {};
	const names = new Set([
		...Object.keys(ours),
		...Object.keys(base),
		...Object.keys(theirs),
	]);
	const tmp = mkdtempSync(join(tmpdir(), "wunderweb-merge-"));
	try {
		for (const f of [...names].sort()) {
			const [o, b, t] = [ours[f], base[f], theirs[f]];
			if (o === b) {
				if (t !== undefined) {
					out[f] = t;
				}
				continue;
			}
			if (t === b || o === t) {
				if (o !== undefined) {
					out[f] = o;
				}
				continue;
			}
			if (o === undefined || t === undefined) {
				// Deleted on one side, changed on the other: keep the changed file.
				out[f] = (o ?? t) as string;
				conflicts.push(
					`${f} (deleted ${o === undefined ? "locally" : "upstream"}, changed on the other side)`,
				);
				continue;
			}
			const paths = {
				ours: join(tmp, "ours"),
				base: join(tmp, "base"),
				theirs: join(tmp, "theirs"),
			};
			writeFileSync(paths.ours, o);
			writeFileSync(paths.base, b ?? "");
			writeFileSync(paths.theirs, t);
			const m = mergeFile(paths, { ours: "local", base: "base", theirs: ref });
			out[f] = m.text;
			if (m.conflicts) {
				conflicts.push(f);
			}
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	return out;
}

/** Replaces a block directory's files (removed files deleted), provenance on top. */
function replaceBlock(
	dir: string,
	files: Record<string, string>,
	p: Provenance,
) {
	for (const f of Object.keys(readDir(dir) ?? {})) {
		if (!(f in files)) {
			rmSync(join(dir, f));
		}
	}
	writeBlock(dir, {
		...files,
		[BLOCK_FILE]: withProvenance(files[BLOCK_FILE] ?? "", p),
	});
}

function installedBlock(
	project: Project,
	name: string,
): { dir: string; p: Provenance } {
	const dir = join(project.blocksDir, name);
	const file = join(dir, BLOCK_FILE);
	if (!existsSync(file)) {
		const pkg = projectBlocks(project).find((b) => b.name === name)?.package;
		throw new Error(
			pkg
				? `block ${name} comes from package ${pkg} (config \`packages\`); update the package instead`
				: `no block ${name} in ${project.config.blocks}`,
		);
	}
	// Provenance is the first line: readable while the rest has conflict markers.
	const first = readFileSync(file, "utf8").split("\n")[0] ?? "";
	const p = first.startsWith("provenance:")
		? ((YAML.parse(first) as { provenance?: Provenance }).provenance ??
			undefined)
		: undefined;
	if (!p) {
		throw new Error(
			`block ${name} was not installed from a registry (no provenance)`,
		);
	}
	return { dir, p };
}

function baseOf(project: Project, p: Provenance): Item {
	const base = readBase(project, p);
	if (!base) {
		throw new Error(
			`base of ${p.item} not found: registry ${p.registry} has no item ${p.item} at commit ${p.commit}`,
		);
	}
	return base;
}

function same(a: Record<string, string>, b: Record<string, string>): boolean {
	const ka = Object.keys(a).sort();
	const kb = Object.keys(b).sort();
	return (
		ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
	);
}

// ----------------------------------------------------------------- diff

/** Unified diffs: local changes (base → local) and upstream changes (base → ref). */
export function diff(
	project: Project,
	name: string,
	opts: InstallOptions = {},
): { local: string; upstream: string; ref: string; base: string } {
	const { dir, p } = installedBlock(project, name);
	const registry = findRegistry(project, p.registry);
	const source = resolveSource(project, registry, opts.ref);
	const theirs = readItem(source, p.item);
	if (!theirs) {
		throw new Error(
			`registry ${registry.name} has no item ${p.item} at ${source.ref}`,
		);
	}
	const base = baseOf(project, p);
	const ours = registryForm(readDir(dir) ?? {});
	return {
		local: unifiedDiff(base.files, ours, `${p.ref}`, "local"),
		upstream: unifiedDiff(base.files, theirs.files, `${p.ref}`, source.ref),
		ref: source.ref,
		base: p.ref,
	};
}

function unifiedDiff(
	a: Record<string, string>,
	b: Record<string, string>,
	labelA: string,
	labelB: string,
): string {
	const tmp = mkdtempSync(join(tmpdir(), "wunderweb-diff-"));
	try {
		writeBlock(join(tmp, "a"), a);
		writeBlock(join(tmp, "b"), b);
		mkdirSync(join(tmp, "a"), { recursive: true });
		mkdirSync(join(tmp, "b"), { recursive: true });
		let out = "";
		try {
			execFileSync(
				"git",
				["diff", "--no-index", "--no-color", "--no-prefix", "a", "b"],
				{ cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
			);
		} catch (e) {
			// Exit code 1 = differences.
			const err = e as { status?: number; stdout?: string; message: string };
			if (err.status !== 1) {
				throw new Error(`git diff: ${err.message}`);
			}
			out = err.stdout ?? "";
		}
		return out
			.replace(/^--- a\//gm, `--- ${labelA}/`)
			.replace(/^\+\+\+ b\//gm, `+++ ${labelB}/`);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}
