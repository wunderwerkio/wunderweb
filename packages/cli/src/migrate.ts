// `wunderweb migrate`: renames a site from wundercms to wunderweb in place,
// one commit's worth of changes. Idempotent; `--check` only reports.
//
//   wundercms.config.yaml        → wunderweb.config.yaml
//   registry wundercms (+ URL)   → wunderweb, https://github.com/wunderwerkio/wunderweb.git
//   provenance registry          → wunderweb (blocks/*/block.yaml)
//   @wunderwerkio/wundercms-*    → @wunderweb/* (imports, package.json)
//   wundercms.css                → wunderweb.css (imports; generated/ regenerated)
//   `wundercms …` scripts        → `wunderweb …`
//   WUNDERCMS_* in source        → WUNDERWEB_*
//
// What it cannot change safely (Dockerfiles, CI, docs, scripts) it lists by
// file and line for the user.

import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
	CONFIG_FILE,
	configFileOf,
	generatedFiles,
	LEGACY_CONFIG_FILE,
	loadProject,
} from "@wunderweb/core";

import { writeGenerated } from "./generate.js";

const OLD = "wundercms";
const OLD_PACKAGES = /@wunderwerkio\/wundercms-(core|cli|react|astro|next)\b/g;
/** The old default registry's git URLs (https or ssh, with or without .git). */
const OLD_REGISTRY_URL =
	/(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)wunderwerkio\/wundercms(?:\.git)?(?![\w.-])/g;
const NEW_REGISTRY_URL = "https://github.com/wunderwerkio/wunderweb.git";
/** A provenance ref to an old release tag: kept, it names what was installed. */
const OLD_TAG_REF = /\bref: "?@wunderwerkio\/wundercms-[a-z]+@[\w.-]+"?/;
const OLD_CSS = "wundercms.css";
const NEW_CSS = "wunderweb.css";

/** Source files rewritten (imports, css, env); others are only listed. */
const SOURCE = /\.(?:[cm]?[jt]sx?|astro|css|scss|vue|svelte)$/;
/** Never read: installs, builds, VCS, vendored packages. */
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"dist-preview",
	".astro",
	".next",
	".turbo",
	"coverage",
	"vendor",
]);
/** Regenerated or reinstalled: not worth listing. */
const SKIP_FILES = new Set([
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lockb",
]);
const DEP_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

export interface MigrateResult {
	/** What changed (or would), one line each. */
	changes: string[];
	/** Mentions of the old name left for the user: `file:line: text`. */
	left: string[];
}

/** This CLI's version: the new packages' range in package.json. */
function ownVersion(): string {
	const own = fileURLToPath(new URL("../package.json", import.meta.url));
	return String(JSON.parse(readFileSync(own, "utf8")).version);
}

/** The project directory: the nearest with either config file. */
function projectRoot(from: string): string {
	for (let dir = resolve(from); ; dir = dirname(dir)) {
		if (configFileOf((f) => existsSync(join(dir, f)))) {
			return dir;
		}
		if (dirname(dir) === dir) {
			throw new Error(
				`${CONFIG_FILE} (or ${LEGACY_CONFIG_FILE}) not found in ${from} or any parent directory`,
			);
		}
	}
}

/** Files below `dir`, relative, without the skipped directories. */
function walk(dir: string, prefix = ""): string[] {
	return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap(
		(e) => {
			const rel = prefix ? `${prefix}/${e.name}` : e.name;
			if (e.isDirectory()) {
				return SKIP_DIRS.has(e.name) ? [] : walk(dir, rel);
			}
			return e.isFile() && !SKIP_FILES.has(e.name) ? [rel] : [];
		},
	);
}

/** The config's text with the registry and command names renamed. */
function migrateConfig(text: string): string {
	return text
		.replace(OLD_REGISTRY_URL, NEW_REGISTRY_URL)
		.replace(/(\bname:\s*)wundercms\b/g, "$1wunderweb")
		.replace(/`wundercms(?= )/g, "`wunderweb");
}

/** A block.yaml's text with its provenance registry renamed. */
function migrateBlock(text: string): string {
	return text.replace(/(\bregistry:\s*)wundercms\b/g, "$1wunderweb");
}

/** A source file's text: package imports, the css file, env names. */
function migrateSource(text: string): string {
	const out = text
		.replace(OLD_PACKAGES, "@wunderweb/$1")
		.replaceAll(OLD_CSS, NEW_CSS)
		.replace(/\bWUNDERCMS_/g, "WUNDERWEB_")
		.replace(/__wundercmsRefresh\b/g, "__wunderwebRefresh");
	// The Astro integration's default import, named as before: renamed with
	// its calls (`import wundercms, {…} from "@wunderweb/astro"`).
	if (
		/\bimport\s+wundercms\b[^;]*?from\s*(["'])@wunderweb\/astro\1/.test(out)
	) {
		return out.replace(/\bwundercms\b(?=\s*(?:\(|,|from\b))/g, "wunderweb");
	}
	return out;
}

/** package.json: dependencies on the new packages, scripts, the blocks key. */
function migratePackage(text: string, version: string): string {
	const pkg = JSON.parse(text) as Record<string, unknown>;
	const rename = (name: string) => name.replace(OLD_PACKAGES, "@wunderweb/$1");
	for (const field of DEP_FIELDS) {
		const deps = pkg[field] as Record<string, string> | undefined;
		if (!deps || typeof deps !== "object") {
			continue;
		}
		pkg[field] = Object.fromEntries(
			Object.entries(deps).map(([name, range]) => {
				const next = rename(name);
				if (next === name) {
					return [name, range];
				}
				// The new packages are on npm from this version on.
				return [
					next,
					String(range).startsWith("workspace:") ? range : `^${version}`,
				];
			}),
		);
	}
	const strings = (v: unknown): unknown => {
		if (typeof v === "string") {
			return rename(v);
		}
		if (!v || typeof v !== "object" || Array.isArray(v)) {
			return v;
		}
		return Object.fromEntries(
			Object.entries(v).map(([k, x]) => [rename(k), strings(x)]),
		);
	};
	if (pkg.overrides) {
		pkg.overrides = strings(pkg.overrides);
	}
	if (pkg.scripts && typeof pkg.scripts === "object") {
		pkg.scripts = Object.fromEntries(
			Object.entries(pkg.scripts as Record<string, string>).map(([k, v]) => [
				k,
				String(v).replace(
					/(^|&&\s*|;\s*|\|\|\s*|npx\s+)wundercms(?= |$)/g,
					"$1wunderweb",
				),
			]),
		);
	}
	if (OLD in pkg && !("wunderweb" in pkg)) {
		pkg.wunderweb = pkg[OLD];
		delete pkg[OLD];
	}
	// Nothing renamed: the file stays as it is (no reformatting).
	if (isDeepStrictEqual(pkg, JSON.parse(text))) {
		return text;
	}
	const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "\t";
	return `${JSON.stringify(pkg, null, indent)}\n`;
}

/**
 * Migrates the project containing `from`. With `check`, nothing is written:
 * `changes` says what would be.
 */
export function migrate(from: string, check: boolean): MigrateResult {
	const root = projectRoot(from);
	const changes: string[] = [];
	const verb = (did: string, would: string) => (check ? would : did);
	const write = (file: string, before: string, after: string) => {
		if (after === before) {
			return;
		}
		changes.push(`${verb("rewrote", "would rewrite")} ${file}`);
		if (!check) {
			writeFileSync(join(root, file), after);
		}
	};

	// 1. The config file (renamed first: everything below reads the project).
	const legacy = join(root, LEGACY_CONFIG_FILE);
	if (configFileOf((f) => existsSync(join(root, f))) === LEGACY_CONFIG_FILE) {
		changes.push(
			`${verb("renamed", "would rename")} ${LEGACY_CONFIG_FILE} to ${CONFIG_FILE}`,
		);
		const text = readFileSync(legacy, "utf8");
		if (!check) {
			writeFileSync(join(root, CONFIG_FILE), migrateConfig(text));
			rmSync(legacy);
		} else if (migrateConfig(text) !== text) {
			changes.push(`would rewrite ${CONFIG_FILE} (registry ${OLD})`);
		}
	} else {
		const text = readFileSync(join(root, CONFIG_FILE), "utf8");
		write(CONFIG_FILE, text, migrateConfig(text));
	}

	// 2. Files of the project, by kind.
	const files = walk(root);
	const project = check ? undefined : loadProject(root);
	const generatedDir = relative(
		root,
		(project ?? loadProject(root)).generatedDir,
	)
		.split("\\")
		.join("/");
	for (const file of files) {
		const name = file.split("/").at(-1) ?? file;
		if (file.startsWith(`${generatedDir}/`) || name === CONFIG_FILE) {
			continue;
		}
		if (name === LEGACY_CONFIG_FILE) {
			continue;
		}
		const kind =
			name === "block.yaml" || name === "package.json" || SOURCE.test(name);
		if (!kind) {
			continue;
		}
		const text = readFileSync(join(root, file), "utf8");
		if (name === "block.yaml") {
			write(file, text, migrateBlock(text));
		} else if (name === "package.json") {
			write(file, text, migratePackage(text, ownVersion()));
		} else if (SOURCE.test(name)) {
			write(file, text, migrateSource(text));
		}
	}

	// 3. Generated files: the new names (wunderweb.css, urn:wunderweb:…).
	const oldCss = join(root, generatedDir, OLD_CSS);
	if (existsSync(oldCss)) {
		changes.push(
			`${verb("removed", "would remove")} ${generatedDir}/${OLD_CSS} (now ${NEW_CSS})`,
		);
		if (!check) {
			rmSync(oldCss);
		}
	}
	// In a check the project is read as it is (the legacy name too).
	const regenerated = generatedFiles(project ?? loadProject(root)).filter(
		(f) => !existsSync(f.file) || readFileSync(f.file, "utf8") !== f.text,
	);
	if (regenerated.length) {
		const names = regenerated.map((f) => relative(root, f.file)).join(", ");
		changes.push(`${verb("regenerated", "would regenerate")} ${names}`);
		if (!check) {
			writeGenerated(regenerated);
		}
	}

	// 4. Mentions left (docs, CI, Dockerfiles, scripts): listed, not changed.
	const left: string[] = [];
	for (const file of walk(root)) {
		const changing =
			file === LEGACY_CONFIG_FILE ||
			file.startsWith(`${generatedDir}/`) ||
			changes.some((c) => c.endsWith(` ${file}`));
		if (check && changing) {
			continue;
		}
		const text = readFileSync(join(root, file), "utf8");
		if (!/wundercms/i.test(text) || text.includes("\u0000")) {
			continue;
		}
		text.split("\n").forEach((line, i) => {
			// A provenance ref names the release tag it was installed from: history.
			const rest = file.endsWith("block.yaml")
				? line.replace(new RegExp(OLD_TAG_REF, "g"), "")
				: line;
			if (/wundercms/i.test(rest)) {
				left.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
			}
		});
	}
	return { changes, left };
}
