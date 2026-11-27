// Project config and content discovery.
//
//   wunderweb.config.yaml                 (wundercms.config.yaml: read, deprecated)
//   theme.yaml                            tokens, core type extensions, rich text
//   blocks/<Name>/block.yaml              project blocks (see blocks.ts)
//   node_modules/<pkg>/<dir>/<Name>/      blocks of the packages in `packages`
//   content/<locale>/pages/**/*.yaml      Page documents (id = file name unless set)
//   content/<locale>/fragments/*.yaml     Fragment documents (ref = `fragment` field)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";

import YAML from "yaml";

import type { ConsentConfig } from "./consent.js";

export const CONFIG_FILE = "wunderweb.config.yaml";
/**
 * The config file's name before the rename to wunderweb: still read, with a
 * deprecation warning, until a later release drops it.
 */
export const LEGACY_CONFIG_FILE = "wundercms.config.yaml";
/** The package blocks key before the rename (`"wundercms": {"blocks"}`). */
const LEGACY_PACKAGE_KEY = "wundercms";

const warned = new Set<string>();
/** A deprecation warning, once per process and message. */
function deprecated(message: string): void {
	if (!warned.has(message)) {
		warned.add(message);
		process.emitWarning(message, "DeprecationWarning");
	}
}

/**
 * The config file of a directory, given which files it has: the new name,
 * else the legacy one; undefined for neither. Both at once is an error.
 * `has` may read a file system or a commit's tree.
 */
export function configFileOf(
	has: (file: string) => boolean,
): string | undefined {
	const current = has(CONFIG_FILE);
	const legacy = has(LEGACY_CONFIG_FILE);
	if (current && legacy) {
		throw new Error(
			`both ${CONFIG_FILE} and ${LEGACY_CONFIG_FILE}: keep ${CONFIG_FILE} only`,
		);
	}
	if (current) {
		return CONFIG_FILE;
	}
	return legacy ? LEGACY_CONFIG_FILE : undefined;
}

/** The config file in `dir` (warns for the legacy name), else undefined. */
function configIn(dir: string): string | undefined {
	const file = configFileOf((f) => existsSync(join(dir, f)));
	if (file === LEGACY_CONFIG_FILE) {
		deprecated(
			`${join(dir, file)} is deprecated: rename it to ${CONFIG_FILE} (\`wunderweb migrate\`)`,
		);
	}
	return file;
}

export const PAGES_DIR = "pages";
export const FRAGMENTS_DIR = "fragments";
const YAML_EXT = /\.ya?ml$/;

/** A block registry: a directory of items in a git repository. */
export interface RegistryConfig {
	name: string;
	/** Git URL, or a path relative to the project root. */
	url: string;
	/** Directory of the items in the repository. */
	path?: string;
	/** Read items from the checkout at `url` instead of git refs (the wunderweb repo's own examples). */
	workingTree?: boolean;
}

export interface Config {
	/** Core schema major version. */
	schema: number;
	theme: string;
	content: string;
	generated: string;
	/** Project blocks, one directory per block. */
	blocks: string;
	/**
	 * npm packages whose blocks the site uses as they are, next to `blocks`
	 * (e.g. a kit of blocks updated by a version bump). A package declares
	 * its blocks directory in its package.json: `"wunderweb": {"blocks":
	 * "./blocks"}`, laid out like `blocks`. A block name defined twice is an
	 * error.
	 */
	packages?: string[];
	/**
	 * Site stylesheets (theme: type scale, button variants, rich text classes),
	 * checked by `generate`: no block internals or page-region overrides.
	 * Missing files are skipped.
	 */
	css: string[];
	/** Registries next to (or replacing, by name) the default wunderweb registry. */
	registries?: RegistryConfig[];
	locales: string[];
	defaultLocale: string;
	/** Base URL for root-relative asset urls, e.g. https://bucket.s3.eu-central-1.amazonaws.com */
	assets?: string;
	/** Public site URL, for canonical links and the sitemap. */
	siteUrl?: string;
	/** Default site chrome fragments; unset = pages have no chrome. */
	chrome?: { header?: string; footer?: string };
	lint?: {
		/** Findings downgraded to warnings: {file: "de/pages/x.yaml", match: "#mehr"}. */
		allow?: { file: string; match: string }[];
	};
	/**
	 * Consent management (banner, settings, gates, Google Consent Mode, Meta
	 * Pixel); unset = none, pages render without it. Checked by lint.
	 */
	consent?: ConsentConfig;
}

/** Config with absolute paths. */
export interface Project {
	root: string;
	config: Config;
	themeFile: string;
	contentDir: string;
	generatedDir: string;
	blocksDir: string;
	/** Block directories of the config's `packages`, in config order. */
	packageBlocks: PackageBlocks[];
	/** Site stylesheets (config `css`), absolute. */
	cssFiles: string[];
}

/** The blocks directory of an installed package. */
export interface PackageBlocks {
	/** Package name, e.g. @wunderwerkio/sonnenseite-kit */
	package: string;
	/** Absolute, through node_modules (a workspace link is not resolved). */
	dir: string;
	/** Import specifier of the directory, e.g. @wunderwerkio/sonnenseite-kit/blocks */
	specifier: string;
}

export interface SourceDoc {
	kind: "page" | "fragment";
	locale: string;
	/** Page id or fragment ref. */
	key: string;
	/** Path relative to the content dir, e.g. de/pages/home.yaml */
	file: string;
	doc: Record<string, unknown>;
	parseError?: string;
}

export interface Content {
	docs: SourceDoc[];
	pages: Map<string, Map<string, SourceDoc>>;
	fragments: Map<string, Map<string, SourceDoc>>;
}

const DEFAULTS = {
	theme: "./theme.yaml",
	content: "./content",
	generated: "./generated",
	blocks: "./blocks",
	css: ["./app/globals.css"],
};

/** Finds wunderweb.config.yaml (or the legacy name) upwards from `from`. */
export function findProject(from: string = process.cwd()): Project {
	let dir = resolve(from);
	while (!configIn(dir)) {
		const up = dirname(dir);
		if (up === dir) {
			throw new Error(
				`${CONFIG_FILE} (or ${LEGACY_CONFIG_FILE}) not found in ${from} or any parent directory`,
			);
		}
		dir = up;
	}
	return loadProject(dir);
}

export function loadProject(root: string): Project {
	const file = configIn(root) ?? CONFIG_FILE;
	const config = parseConfig(readFileSync(join(root, file), "utf8"));
	const packageBlocks = (config.packages ?? []).map((p) =>
		packageBlocksOf(root, p),
	);

	return {
		root,
		config,
		themeFile: resolve(root, config.theme),
		contentDir: resolve(root, config.content),
		generatedDir: resolve(root, config.generated),
		blocksDir: resolve(root, config.blocks),
		packageBlocks,
		cssFiles: config.css.map((c) => resolve(root, c)),
	};
}

/**
 * The text of a wunderweb.config.yaml with its defaults filled in; throws
 * on a config that is not valid. No file system: a hosted service reads
 * the text from git. Paths stay as written (relative to the config).
 */
export function parseConfig(text: string): Config {
	const raw = YAML.parse(text) as Partial<Config> | null;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`${CONFIG_FILE}: not a mapping`);
	}
	const config = { ...DEFAULTS, ...raw } as Config;

	const problems: string[] = [];
	if (!Number.isInteger(config.schema)) {
		problems.push("schema: core major version (integer) required");
	}
	for (const key of ["theme", "content", "generated", "blocks"] as const) {
		if (typeof config[key] !== "string" || !config[key]) {
			problems.push(`${key}: path required`);
		}
	}
	if (config.locales === undefined || config.locales?.length === 0) {
		problems.push("locales: at least one locale required");
	} else if (
		!Array.isArray(config.locales) ||
		!config.locales.every((l) => typeof l === "string")
	) {
		problems.push("locales: list of locale codes");
	}
	if (
		typeof config.defaultLocale !== "string" ||
		!Array.isArray(config.locales) ||
		!config.locales.includes(config.defaultLocale)
	) {
		problems.push("defaultLocale must be one of locales");
	}
	if (
		!Array.isArray(config.css) ||
		!config.css.every((c) => typeof c === "string")
	) {
		problems.push("css: list of site stylesheet paths");
	}
	const packages = config.packages ?? [];
	if (
		!Array.isArray(packages) ||
		!packages.every((p) => typeof p === "string")
	) {
		problems.push("packages: list of npm package names");
	} else if (new Set(packages).size !== packages.length) {
		problems.push("packages: a package is listed twice");
	}
	if (problems.length) {
		throw new Error(`${CONFIG_FILE}: ${problems.join("; ")}`);
	}
	return config;
}

/**
 * Finds a package the way Node does (node_modules of the root, then of each
 * parent: workspaces hoist) and reads its `wunderweb.blocks`: an existing
 * directory inside the package, exported if the package has `exports`
 * (the component map imports `<package>/<dir>/<Name>/<Name>.tsx`).
 */
function packageBlocksOf(root: string, name: string): PackageBlocks {
	const fail = (why: string) =>
		new Error(`${CONFIG_FILE}: packages: ${name} ${why}`);
	let dir = resolve(root);
	for (;;) {
		const pkgDir = join(dir, "node_modules", name);
		const manifest = join(pkgDir, "package.json");
		if (existsSync(manifest)) {
			let meta: {
				wunderweb?: { blocks?: unknown };
				[LEGACY_PACKAGE_KEY]?: { blocks?: unknown };
				exports?: unknown;
			};
			try {
				meta = JSON.parse(readFileSync(manifest, "utf8"));
			} catch (e) {
				throw fail(`has an unreadable package.json (${(e as Error).message})`);
			}
			let blocks = meta.wunderweb?.blocks;
			if (
				blocks === undefined &&
				meta[LEGACY_PACKAGE_KEY]?.blocks !== undefined
			) {
				blocks = meta[LEGACY_PACKAGE_KEY].blocks;
				deprecated(
					`${name}: "${LEGACY_PACKAGE_KEY}" in its package.json is deprecated: name it "wunderweb"`,
				);
			}
			if (typeof blocks !== "string") {
				throw fail(
					'declares no "wunderweb": {"blocks": …} in its package.json',
				);
			}
			const blocksDir = resolve(pkgDir, blocks);
			const rel = relative(pkgDir, blocksDir).split("\\").join("/");
			if (
				!rel ||
				rel.startsWith("..") ||
				isAbsolute(rel) ||
				!existsSync(blocksDir) ||
				!statSync(blocksDir).isDirectory()
			) {
				throw fail(
					`has "wunderweb": {"blocks": "${blocks}"}, which is not a directory inside the package`,
				);
			}
			if (!exportsDir(meta.exports, rel)) {
				throw fail(
					`does not export its blocks: add "exports": {"./${rel}/*": "./${rel}/*"} to its package.json`,
				);
			}
			return {
				package: name,
				dir: join(pkgDir, rel),
				specifier: `${name}/${rel}`,
			};
		}
		const up = dirname(dir);
		if (up === dir) {
			throw fail(
				`is not installed (no node_modules/${name} in ${root} or a parent; run npm install)`,
			);
		}
		dir = up;
	}
}

/**
 * Whether a package's `exports` let `<package>/<rel>/<file>` resolve: no
 * `exports` at all, or a subpath pattern covering the directory
 * (`./<rel>/*`, a parent's `./x/*`, or `./*`) mapped to the same path.
 */
function exportsDir(exports: unknown, rel: string): boolean {
	if (exports === undefined) {
		return true;
	}
	if (typeof exports !== "object" || exports === null) {
		return false;
	}
	const target = (v: unknown): string | undefined => {
		if (typeof v === "string") {
			return v;
		}
		if (typeof v === "object" && v !== null) {
			const c = v as Record<string, unknown>;
			return target(c.import ?? c.default);
		}
		return undefined;
	};
	return Object.entries(exports as Record<string, unknown>).some(
		([key, value]) => {
			if (!key.endsWith("/*")) {
				return false;
			}
			const prefix = key.slice(0, -1);
			return `./${rel}/`.startsWith(prefix) && target(value) === `${prefix}*`;
		},
	);
}

/** A content file, relative to the content dir, e.g. de/pages/home.yaml. */
export interface ContentFile {
	kind: SourceDoc["kind"];
	locale: string;
	file: string;
	/** Key when the document names none: page file name (with sub dirs) or fragment file name. */
	fallbackKey: string;
}

/** Reads every document of every locale; parse errors are kept, not thrown. */
export function readContent(project: Project): Content {
	return index(
		contentFiles(project).map((f) => {
			let text: string;
			try {
				text = readFileSync(join(project.contentDir, f.file), "utf8");
			} catch (e) {
				// E.g. removed between listing and reading: a finding, not a crash.
				return parseFailure(f, e);
			}
			return parseSource(f, text);
		}),
	);
}

/** Content files of the project, per locale: pages, then fragments. */
export function contentFiles(project: Project): ContentFile[] {
	const out: ContentFile[] = [];
	for (const locale of project.config.locales) {
		const base = join(project.contentDir, locale);
		for (const dir of [PAGES_DIR, FRAGMENTS_DIR]) {
			for (const file of yamlFiles(join(base, dir))) {
				const info = contentFile(
					relative(project.contentDir, file),
					project.config,
				);
				if (info) {
					out.push(info);
				}
			}
		}
	}
	return out;
}

/**
 * Kind, locale and fallback key of a path relative to the content dir;
 * undefined for files that are not content (other dirs, locales, extensions).
 */
export function contentFile(
	file: string,
	config: Pick<Config, "locales">,
): ContentFile | undefined {
	const parts = file.split(/[\\/]/);
	if (parts.some((p) => p === "" || p === "." || p === "..")) {
		return undefined;
	}
	const [locale, dir, ...rest] = parts;
	const name = rest.join("/");
	if (
		!locale ||
		!config.locales.includes(locale) ||
		!YAML_EXT.test(name) ||
		(dir === FRAGMENTS_DIR && rest.length !== 1)
	) {
		return undefined;
	}
	const rel = parts.join("/");
	if (dir === PAGES_DIR) {
		return {
			kind: "page",
			locale,
			file: rel,
			fallbackKey: name.replace(YAML_EXT, ""),
		};
	}
	if (dir === FRAGMENTS_DIR) {
		return {
			kind: "fragment",
			locale,
			file: rel,
			fallbackKey: basename(name).replace(YAML_EXT, ""),
		};
	}
	return undefined;
}

/** A document from its text (in memory); parse errors are kept, not thrown. */
export function parseSource(f: ContentFile, text: string): SourceDoc {
	try {
		const doc = (YAML.parse(text, { merge: true }) ?? {}) as Record<
			string,
			unknown
		>;
		return sourceDoc(f, doc);
	} catch (e) {
		return parseFailure(f, e);
	}
}

function parseFailure(f: ContentFile, e: unknown): SourceDoc {
	return {
		kind: f.kind,
		locale: f.locale,
		key: f.fallbackKey,
		file: f.file,
		doc: {},
		parseError: (e as Error).message.split("\n")[0] ?? "",
	};
}

/** A document from its parsed JSON: key from `id` / `fragment`, else the file name. */
export function sourceDoc(
	f: ContentFile,
	doc: Record<string, unknown>,
): SourceDoc {
	const own = f.kind === "page" ? doc.id : doc.fragment;
	return {
		kind: f.kind,
		locale: f.locale,
		key: typeof own === "string" ? own : f.fallbackKey,
		file: f.file,
		doc: isRecord(doc) ? doc : {},
	};
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Groups documents per locale and key. */
export function index(docs: SourceDoc[]): Content {
	const pages = new Map<string, Map<string, SourceDoc>>();
	const fragments = new Map<string, Map<string, SourceDoc>>();
	for (const d of docs) {
		const target = d.kind === "page" ? pages : fragments;
		const byLocale = target.get(d.locale) ?? new Map<string, SourceDoc>();
		target.set(d.locale, byLocale);
		if (!byLocale.has(d.key)) {
			byLocale.set(d.key, d);
		}
	}
	return { docs, pages, fragments };
}

function yamlFiles(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.sort()
		.flatMap((name) => {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) {
				return yamlFiles(p);
			}
			return YAML_EXT.test(name) ? [p] : [];
		});
}
