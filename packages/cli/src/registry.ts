// Block registries: a directory of items in a git repository.
//
//   <repo>/<path>/Card/item.yaml    manifest: name, description, schema (contract major),
//                                   dependencies, npm, runtime (other registries only)
//   <repo>/<path>/Card/block.yaml   laid out exactly as installed in a project
//   <repo>/<path>/Card/Card.tsx
//   <repo>/<path>/Card/Card.css
//
// Refs resolve with `git ls-remote`; files come from a partial clone
// (--filter=blob:none) with a sparse checkout of the items directory, cached
// per registry URL and reused across commands. A registry configured with
// `workingTree: true` (the wunderweb repo's own examples) is read from the
// checkout itself.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Project, Provenance, RegistryConfig } from "@wunderweb/core";
import { readDir } from "@wunderweb/core";
import YAML from "yaml";

import { git, lsRemote, tryGit } from "./git.js";

export const ITEM_FILE = "item.yaml";

/** The wunderweb repository: its release tags version contract, runtime and items together. */
export const DEFAULT_REGISTRY: RegistryConfig = {
	name: "wunderweb",
	url: "https://github.com/wunderwerkio/wunderweb.git",
	path: "registry/blocks",
};

/**
 * The default registry's name before the rename to wunderweb: a configured
 * registry or a block's provenance with it means the default registry
 * (with a warning) until a later release drops it.
 */
export const LEGACY_REGISTRY = "wundercms";

const warned = new Set<string>();
function deprecated(message: string): void {
	if (!warned.has(message)) {
		warned.add(message);
		process.emitWarning(message, "DeprecationWarning");
	}
}

/** A registry name as it is now: the legacy default name is the default's. */
export function currentRegistryName(name: string): string {
	if (name !== LEGACY_REGISTRY) {
		return name;
	}
	deprecated(
		`registry "${LEGACY_REGISTRY}" is now "${DEFAULT_REGISTRY.name}" (\`wunderweb migrate\` renames it)`,
	);
	return DEFAULT_REGISTRY.name;
}

/** Release tag of the runtime package (changesets tags per package). */
export const RUNTIME_PACKAGE = "@wunderweb/react";
const RUNTIME_TAG = `${RUNTIME_PACKAGE}@`;
/** The runtime package and its release tags before the rename (older releases). */
const LEGACY_RUNTIME_PACKAGE = "@wunderwerkio/wundercms-react";
const LEGACY_RUNTIME_TAG = `${LEGACY_RUNTIME_PACKAGE}@`;
const isRuntimeTag = (tag: string) =>
	tag.startsWith(RUNTIME_TAG) || tag.startsWith(LEGACY_RUNTIME_TAG);

export const WORKING_TREE = "working-tree";

const SHA = /^[0-9a-f]{40}$/;

export interface ItemManifest {
	name: string;
	description?: string;
	/** Contract (core schema) major the item targets. */
	schema: number;
	dependencies?: string[];
	/** npm packages the component needs: name → version range. */
	npm?: Record<string, string>;
	/** Runtime version range; registries outside the wunderweb repo only. */
	runtime?: string;
}

export interface Item {
	manifest: ItemManifest;
	/** Relative path → text, without the manifest. */
	files: Record<string, string>;
}

export interface Registry
	extends Required<Omit<RegistryConfig, "workingTree">> {
	workingTree: boolean;
	/** The wunderweb repo (tags follow the runtime version). */
	isDefault: boolean;
}

/** Registries of a project: the implicit default plus configured ones (same name replaces). */
export function registries(project: Project): Registry[] {
	const configured = (project.config.registries ?? []).map((r) => ({
		...r,
		name: currentRegistryName(r.name),
	}));
	const all = [
		...(configured.some((r) => r.name === DEFAULT_REGISTRY.name)
			? []
			: [DEFAULT_REGISTRY]),
		...configured,
	];
	return all.map((r) => ({
		name: r.name,
		url: resolveUrl(r.url, project.root),
		path: r.path ?? "",
		workingTree: r.workingTree ?? false,
		isDefault: r.name === DEFAULT_REGISTRY.name,
	}));
}

export function findRegistry(project: Project, name: string): Registry {
	const wanted = currentRegistryName(name);
	const r = registries(project).find((x) => x.name === wanted);
	if (!r) {
		throw new Error(
			`unknown registry "${name}" (configured: ${registries(project)
				.map((x) => x.name)
				.join(", ")})`,
		);
	}
	return r;
}

/** Local paths are relative to the project root; URLs stay as they are. */
function resolveUrl(url: string, root: string): string {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^[^/\\]+@[^:]+:/.test(url)) {
		return url;
	}
	return isAbsolute(url) ? url : resolve(root, url);
}

// ----------------------------------------------------------------- versions

/** Version of the runtime installed in the project, else of this CLI (all packages share one version). */
export function runtimeVersion(project: Project): string {
	for (let dir = project.root; ; dir = dirname(dir)) {
		// The runtime as named now, else as installed before the rename.
		for (const name of [RUNTIME_PACKAGE, LEGACY_RUNTIME_PACKAGE]) {
			const pkg = join(dir, "node_modules", name, "package.json");
			if (existsSync(pkg)) {
				return String(JSON.parse(readFileSync(pkg, "utf8")).version);
			}
		}
		if (dirname(dir) === dir) {
			break;
		}
	}
	const own = fileURLToPath(new URL("../package.json", import.meta.url));
	return String(JSON.parse(readFileSync(own, "utf8")).version);
}

/** Minimal semver range check: "*", "1.2.3", "^1.2.3", "~1.2.3", ">=1.2.0 <2.0.0". */
export function satisfies(version: string, range: string): boolean {
	const v = parseVersion(version);
	return range
		.trim()
		.split(/\s+/)
		.every((part) => {
			if (part === "*" || part === "") {
				return true;
			}
			const m = part.match(/^(\^|~|>=|<=|>|<|=)?v?(\d+(?:\.\d+){0,2})$/);
			if (!m) {
				throw new Error(`unsupported version range "${range}"`);
			}
			const op = m[1] ?? "=";
			const w = parseVersion(m[2] ?? "");
			const c = compareVersions(v, w);
			switch (op) {
				case "^":
					return (
						c >= 0 &&
						(w[0] > 0
							? v[0] === w[0]
							: w[1] > 0
								? v[1] === w[1]
								: v[2] === w[2])
					);
				case "~":
					return c >= 0 && v[0] === w[0] && v[1] === w[1];
				case ">=":
					return c >= 0;
				case "<=":
					return c <= 0;
				case ">":
					return c > 0;
				case "<":
					return c < 0;
				default:
					return c === 0;
			}
		});
}

function parseVersion(v: string): [number, number, number] {
	const [a = 0, b = 0, c = 0] = v
		.replace(/^v/, "")
		.split(/[.-]/)
		.slice(0, 3)
		.map((x) => Number.parseInt(x, 10) || 0);
	return [a, b, c];
}

function compareVersions(a: number[], b: number[]): number {
	for (let i = 0; i < 3; i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		if (d) {
			return d;
		}
	}
	return 0;
}

// ----------------------------------------------------------------- refs

export interface Source {
	registry: Registry;
	/** Tag, branch, sha or "working-tree". */
	ref: string;
	commit: string;
}

/**
 * Resolves the ref to install from. Default: the wunderweb registry's tag of
 * the installed runtime version; other registries their default branch.
 */
export function resolveSource(
	project: Project,
	registry: Registry,
	ref?: string,
): Source {
	if (registry.workingTree && ref === undefined) {
		const commit =
			tryGit(["rev-parse", "HEAD"], registry.url)?.trim() ?? WORKING_TREE;
		return { registry, ref: WORKING_TREE, commit };
	}
	if (ref && SHA.test(ref)) {
		return { registry, ref, commit: ref };
	}
	const refs = lsRemote(registry.url, ["--tags", "--heads"]);
	if (ref) {
		const commit =
			refs.get(`refs/tags/${ref}`) ?? refs.get(`refs/heads/${ref}`);
		if (!commit) {
			throw new Error(`registry ${registry.name}: no tag or branch "${ref}"`);
		}
		return { registry, ref, commit };
	}
	if (registry.isDefault) {
		// Releases before the rename are tagged with the old runtime name.
		const version = runtimeVersion(project);
		const tag = [RUNTIME_TAG, LEGACY_RUNTIME_TAG]
			.map((prefix) => `${prefix}${version}`)
			.find((t) => refs.has(`refs/tags/${t}`));
		const commit = tag && refs.get(`refs/tags/${tag}`);
		if (!tag || !commit) {
			throw new Error(
				`registry ${registry.name}: no tag ${RUNTIME_TAG}${version} for the installed runtime (pass --ref)`,
			);
		}
		return { registry, ref: tag, commit };
	}
	const head = lsRemote(registry.url, ["--symref"]);
	const commit = head.get("HEAD");
	if (!commit) {
		throw new Error(`registry ${registry.name}: no default branch`);
	}
	return { registry, ref: "HEAD", commit };
}

/** Release tags, newest first (the wunderweb registry: runtime tags only). */
export function releaseTags(registry: Registry): Source[] {
	const refs = lsRemote(registry.url, ["--tags"]);
	return [...refs]
		.map(([ref, commit]) => ({ tag: ref.replace(/^refs\/tags\//, ""), commit }))
		.filter((t) => !registry.isDefault || isRuntimeTag(t.tag))
		.sort((a, b) =>
			compareVersions(
				parseVersion(b.tag.replace(/^.*@/, "")),
				parseVersion(a.tag.replace(/^.*@/, "")),
			),
		)
		.map((t) => ({ registry, ref: t.tag, commit: t.commit }));
}

// ----------------------------------------------------------------- items

/** Reads an item at a source; undefined if the registry has no such item there. */
export function readItem(source: Source, name: string): Item | undefined {
	const files =
		source.ref === WORKING_TREE
			? readDir(join(source.registry.url, source.registry.path, name))
			: readAt(source.registry, source.commit, name);
	if (!files) {
		return undefined;
	}
	const manifestText = files[ITEM_FILE];
	if (manifestText === undefined) {
		throw new Error(
			`registry ${source.registry.name}: item ${name} has no ${ITEM_FILE}`,
		);
	}
	const { [ITEM_FILE]: _, ...rest } = files;
	return {
		manifest: YAML.parse(manifestText) as ItemManifest,
		files: rest,
	};
}

/** The item as it was at the commit recorded in a block's provenance. */
export function readBase(project: Project, p: Provenance): Item | undefined {
	const registry = findRegistry(project, p.registry);
	return readItem({ registry, ref: p.commit, commit: p.commit }, p.item);
}

function readAt(
	registry: Registry,
	commit: string,
	item: string,
): Record<string, string> | undefined {
	if (!SHA.test(commit)) {
		return undefined;
	}
	// Working-tree registries: the commit lives in the local repository itself.
	const repo = registry.workingTree ? registry.url : checkout(registry, commit);
	if (!repo) {
		return undefined;
	}
	const prefix = [registry.path, item].filter(Boolean).join("/");
	const list = tryGit(
		["ls-tree", "-r", "--name-only", commit, "--", `${prefix}/`],
		repo,
	);
	if (!list?.trim()) {
		return undefined;
	}
	return Object.fromEntries(
		list
			.trim()
			.split("\n")
			.map((f) => [
				f.slice(prefix.length + 1),
				git(["show", `${commit}:${f}`], repo),
			]),
	);
}

/**
 * Partial clone with a sparse checkout of the items directory, cached per
 * registry URL. Returns the clone directory with `commit` checked out.
 */
function checkout(registry: Registry, commit: string): string | undefined {
	const dir = join(cacheRoot(), hash(registry.url));
	const url = isAbsolute(registry.url)
		? `file://${registry.url}`
		: registry.url;
	if (!existsSync(join(dir, ".git"))) {
		mkdirSync(dirname(dir), { recursive: true });
		git([
			"clone",
			"--quiet",
			"--filter=blob:none",
			"--no-checkout",
			"--sparse",
			url,
			dir,
		]);
		if (registry.path) {
			git(["sparse-checkout", "set", registry.path], dir);
		}
	}
	const has = () =>
		tryGit(["cat-file", "-e", `${commit}^{commit}`], dir) !== undefined;
	if (!has()) {
		git(
			[
				"fetch",
				"--quiet",
				"--filter=blob:none",
				"origin",
				"+refs/heads/*:refs/remotes/origin/*",
				"+refs/tags/*:refs/tags/*",
			],
			dir,
		);
	}
	if (
		!has() &&
		tryGit(
			["fetch", "--quiet", "--filter=blob:none", "origin", commit],
			dir,
		) === undefined
	) {
		return undefined;
	}
	// Fetches the blobs of the sparse paths in one go.
	git(["checkout", "--quiet", "--detach", commit], dir);
	return dir;
}

function cacheRoot(): string {
	return (
		process.env.WUNDERWEB_CACHE ??
		join(
			process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
			"wunderweb",
			"registries",
		)
	);
}

function hash(s: string): string {
	return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

/** Files of a directory (recursive), relative path → text. */

// ----------------------------------------------------------------- provenance

/** Provenance is the first line of an installed block.yaml (one flow map). */
const PROVENANCE_LINE = /^provenance:.*(?:\r?\n|$)/m;

export function withProvenance(blockYaml: string, p: Provenance): string {
	const line = `provenance: ${YAML.stringify(p, { collectionStyle: "flow", lineWidth: 0 }).trim()}\n`;
	return line + stripProvenance(blockYaml);
}

export function stripProvenance(blockYaml: string): string {
	return blockYaml.replace(PROVENANCE_LINE, "");
}

/** Block schema file of an item / installed block. */
export const BLOCK_FILE = "block.yaml";

/** Installed files → registry form (provenance removed). */
export function registryForm(
	files: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(files).map(([f, t]) => [
			f,
			f === BLOCK_FILE ? stripProvenance(t) : t,
		]),
	);
}

export { readDir };
