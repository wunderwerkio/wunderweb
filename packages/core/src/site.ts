// Site loader: validated content → render-ready pages.
//
//   content/<locale>/pages/*.yaml ──┐
//   content/<locale>/fragments ─────┼─ loadSite ─▶ Site { pages[url], alternates }
//   generated/schema.json ──────────┘     │
//                                         ├─ expand Include (+ slots), chrome
//                                         ├─ apply defaults
//                                         ├─ resolve urls: page:<id> → /en/my-page,
//                                         │  asset /img.jpg → <assets>/img.jpg
//                                         └─ consent (config `consent`): texts of
//                                            the locale, remote videos gated,
//                                            consent:settings links open the settings
//
// Output is plain JSON (serializable, e.g. for React Server Components).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	gateOf,
	MEDIA,
	OPEN_ATTR,
	type PageConsent,
	pageConsent,
	SETTINGS_ID,
	SETTINGS_URL,
	videoVendor,
} from "./consent.js";
import { withDefaults } from "./defaults.js";
import { isPlain } from "./model.js";
import {
	type Config,
	type Content,
	type Project,
	readContent,
	type SourceDoc,
} from "./project.js";
import { type Finding, Validator } from "./validate.js";
import type { BlockJson, JsonSchema } from "./walk.js";

export const SCHEMA_FILE = "schema.json";

const PAGE_LINK = /^page:([a-z][a-z0-9-]*)(#.+)?$/;
/** href in rich text, double or single quoted: [prefix, quote, url]. */
const HREF = /(\shref=)(["'])(.*?)\2/gi;
const ASSET_OWNER = "Asset";
const BUTTON = "Button";

export interface SitePage {
	locale: string;
	id: string;
	/** Source file relative to content/, e.g. de/pages/home.yaml */
	file: string;
	/** Full URL path incl. locale prefix, e.g. /en/my-page */
	url: string;
	title: string;
	description?: string;
	image?: Record<string, unknown>;
	noindex: boolean;
	/**
	 * The page's own fields from the theme's `extend.Page` (e.g. `service`,
	 * `updated`), resolved like the rest; absent when it has none.
	 */
	extend?: Record<string, unknown>;
	header: BlockJson[];
	blocks: BlockJson[];
	footer: BlockJson[];
	/** Same page in other locales: locale → url. Includes this page. */
	alternates: Record<string, string>;
	/** Locale home urls, e.g. for a language switch without translation. */
	homes: Record<string, string>;
	/**
	 * Dialogs the page opens (Button.opens after anchor resolution), fragment
	 * ref → blocks. Rendered once per page, however many buttons open them.
	 */
	dialogs: Record<string, BlockJson[]>;
	/** Provenance of the rendered blocks; only with `{sources: true}`. */
	sources?: PageSources;
	/** Consent banner, settings and gates in the page's locale (config `consent`). */
	consent?: PageConsent;
}

/** Where a rendered block is authored. */
export interface Origin {
	/** Content file, e.g. de/fragments/faq.yaml */
	file: string;
	/** Authored path in that file, e.g. blocks/0/items/2 */
	path: string;
	/**
	 * Path of the block in the validator's findings: for blocks reached
	 * through the page (own blocks, includes, slots) the page file's path
	 * scheme (`blocks/1{faq}/0`), for chrome and dialogs the path in `file`.
	 */
	validatorPath: string;
	/** Include blocks the block was placed through, outermost first. */
	via?: { file: string; path: string }[];
	/** The block's id in `file`, if it has one (blocks get none in the page data). */
	id?: string;
}

/**
 * Source map of a rendered page. Rendered paths: `header/0`,
 * `blocks/2/items/1`, `footer/0`, `dialogs/<ref>/0`.
 */
export interface PageSources {
	page: { file: string };
	regions: { header?: { file: string }; footer?: { file: string } };
	dialogs: Record<string, { file: string }>;
	blocks: Record<string, Origin>;
}

export interface SiteOptions {
	/** Build source maps (edit mode); off for builds. */
	sources?: boolean;
	/**
	 * Called for a page that cannot be resolved (invalid draft content);
	 * the page is skipped. Unset: the error is thrown.
	 */
	onPageError?: (src: SourceDoc, error: Error) => void;
}

export interface Site {
	config: Config;
	pages: SitePage[];
}

export class ContentError extends Error {
	constructor(readonly findings: Finding[]) {
		super(
			`content has ${findings.length} error(s):\n${findings.map((f) => `  ${f.file} ${f.at}: ${f.message}`).join("\n")}`,
		);
	}
}

export function readSchema(project: Project): JsonSchema {
	return JSON.parse(
		readFileSync(join(project.generatedDir, SCHEMA_FILE), "utf8"),
	) as JsonSchema;
}

/** Loads, validates and resolves all content. Throws ContentError on errors. */
export function loadSite(
	project: Project,
	schema: JsonSchema = readSchema(project),
	opts: SiteOptions = {},
): Site {
	const validator = new Validator(schema);
	const content = readContent(project);
	const errors = validator
		.validateSite(content, project.config)
		.filter((f) => f.level === "error");
	if (errors.length) {
		throw new ContentError(errors);
	}
	return buildSite(validator, content, project.config, opts);
}

/** Resolves validated content into pages. */
export function buildSite(
	validator: Validator,
	content: Content,
	config: Config,
	opts: SiteOptions = {},
): Site {
	const urls = pageUrls(content, config);
	const homes = Object.fromEntries(
		config.locales.map((l) => [l, localeUrl(config, l, "/")]),
	);
	const pages: SitePage[] = [];

	for (const locale of config.locales) {
		const fragments =
			content.fragments.get(locale) ?? new Map<string, SourceDoc>();
		const resolver = new Resolver(
			validator,
			config,
			locale,
			urls,
			fragments,
			opts.sources === true,
		);

		for (const src of content.pages.get(locale)?.values() ?? []) {
			if (!opts.onPageError) {
				pages.push(resolver.page(src, homes));
				continue;
			}
			try {
				pages.push(resolver.page(src, homes));
			} catch (e) {
				opts.onPageError(src, e instanceof Error ? e : new Error(String(e)));
			}
		}
	}
	return { config, pages };
}

/**
 * Findings of a page's documents by rendered block path (the innermost
 * block whose origin contains the finding); findings of the page file
 * outside any block under "". Needs a page built with `{sources: true}`.
 */
export function pageFindings(
	page: SitePage,
	findings: Finding[],
): Record<string, Finding[]> {
	const sources = page.sources;
	if (!sources) {
		return {};
	}
	// file → [authored or validator path, rendered path]
	const candidates = new Map<string, [string, string][]>();
	const add = (file: string, path: string, rendered: string) => {
		const list = candidates.get(file) ?? [];
		list.push([path, rendered]);
		candidates.set(file, list);
	};
	for (const [rendered, o] of Object.entries(sources.blocks)) {
		add(o.file, o.path, rendered);
		if (rendered.startsWith("blocks/")) {
			add(page.file, o.validatorPath, rendered);
		}
	}

	const out: Record<string, Finding[]> = {};
	const seen = new Set<string>();
	for (const f of findings) {
		const list = candidates.get(f.file);
		if (!list && f.file !== page.file) {
			continue;
		}
		const at = findingPath(f);
		// The innermost blocks containing the finding; a fragment rendered
		// several times has one candidate per instance.
		const matches = (list ?? []).filter(
			([path]) =>
				at === path || at.startsWith(`${path}/`) || at.startsWith(`${path}{`),
		);
		const longest = Math.max(-1, ...matches.map(([path]) => path.length));
		const hits: [string, string][] = matches
			.filter(([path]) => path.length === longest)
			.map(([path, rendered]) => [rendered, at.slice(path.length)]);
		if (!hits.length) {
			if (f.file !== page.file) {
				continue;
			}
			hits.push(["", at]);
		}
		// The same finding arrives through the page (validator path) and
		// through the fragment's own file: one per block and location.
		for (const [key, rel] of hits) {
			const id = `${key}\n${rel}\n${f.level}\n${f.message}`;
			if (seen.has(id)) {
				continue;
			}
			seen.add(id);
			const bucket = out[key] ?? [];
			bucket.push(f);
			out[key] = bucket;
		}
	}
	return out;
}

/** Path of a finding without the block type: "blocks/2/items (Card)" → "blocks/2/items", "(root)" → "". */
export function findingPath(f: Pick<Finding, "at">): string {
	return f.at.replace(/ \([^)]*\)$/, "").replace(/^\(root\)$/, "");
}

/** URL of a locale-less path: default locale unprefixed, others /<locale>/… */
export function localeUrl(
	config: Config,
	locale: string,
	path: string,
): string {
	if (locale === config.defaultLocale) {
		return path;
	}
	return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** id → locale → url */
function pageUrls(
	content: Content,
	config: Config,
): Map<string, Map<string, string>> {
	const out = new Map<string, Map<string, string>>();
	for (const [locale, pages] of content.pages) {
		for (const [id, src] of pages) {
			const byLocale = out.get(id) ?? new Map<string, string>();
			byLocale.set(locale, localeUrl(config, locale, String(src.doc.path)));
			out.set(id, byLocale);
		}
	}
	return out;
}

/** Position of a value while copying content: authored and validator path. */
interface Loc {
	file: string;
	path: string;
	validatorPath: string;
	via: { file: string; path: string }[];
}

const step = (loc: Loc, key: string | number): Loc => ({
	...loc,
	path: `${loc.path}/${key}`,
	validatorPath: `${loc.validatorPath}/${key}`,
});

const listLoc = (file: string): Loc => ({
	file,
	path: "blocks",
	validatorPath: "blocks",
	via: [],
});

/**
 * Fields of the core Page type (core/1.yaml); the rest of a page document
 * is the site's `extend.Page`. A list, not read from the core file: the
 * loader runs bundled into site builds (a test pins it to the core).
 */
export const CORE_PAGE_FIELDS: ReadonlySet<string> = new Set([
	"id",
	"title",
	"description",
	"image",
	"noindex",
	"path",
	"chrome",
	"header",
	"footer",
	"blocks",
]);

/** The id of an authored block, if it has one. */
function blockId(node: unknown): string | undefined {
	return isPlain(node) && typeof node.id === "string" && node.id
		? node.id
		: undefined;
}

/** Block types are PascalCase; lower-case `type` keys are values, e.g. inputs. */
const BLOCK_TYPE = /^[A-Z]/;

class Resolver {
	/** Origin of every object copied out of the content (expansion output). */
	private readonly origins = new WeakMap<object, Origin>();
	/** The locale's consent texts and resolved privacy url (config `consent`). */
	private readonly consent: PageConsent | undefined;

	constructor(
		private readonly validator: Validator,
		private readonly config: Config,
		private readonly locale: string,
		private readonly urls: Map<string, Map<string, string>>,
		private readonly fragments: Map<string, SourceDoc>,
		private readonly withSources: boolean,
	) {
		this.consent = config.consent
			? pageConsent(config.consent, locale, (u) => this.url(u, false))
			: undefined;
	}

	page(src: SourceDoc, homes: Record<string, string>): SitePage {
		const doc = src.doc;
		const chrome = doc.chrome !== false;
		const header = chrome
			? (doc.header ?? this.config.chrome?.header)
			: undefined;
		const footer = chrome
			? (doc.footer ?? this.config.chrome?.footer)
			: undefined;

		const blocks: Record<string, Origin> = {};
		const own = this.withoutIds(
			this.expand(this.copy(doc.blocks, listLoc(src.file))),
		);
		this.mapSources(own, "blocks", blocks);
		const expanded = this.finish({ ...doc, blocks: own }, "Page");
		const alternates = Object.fromEntries(this.urls.get(src.key) ?? []);
		const headerFile =
			typeof header === "string" ? this.fragments.get(header)?.file : undefined;
		const footerFile =
			typeof footer === "string" ? this.fragments.get(footer)?.file : undefined;
		const regions = {
			header:
				typeof header === "string"
					? this.fragment(header, "header", blocks)
					: [],
			blocks: expanded.blocks as BlockJson[],
			footer:
				typeof footer === "string"
					? this.fragment(footer, "footer", blocks)
					: [],
		};

		const page: SitePage = {
			locale: this.locale,
			id: src.key,
			file: src.file,
			url: alternates[this.locale] ?? "/",
			title: String(doc.title),
			noindex: doc.noindex === true,
			...regions,
			alternates,
			homes,
			dialogs: this.dialogs(Object.values(regions), blocks),
		};
		if (this.withSources) {
			page.sources = {
				page: { file: src.file },
				regions: {
					...(headerFile ? { header: { file: headerFile } } : {}),
					...(footerFile ? { footer: { file: footerFile } } : {}),
				},
				dialogs: Object.fromEntries(
					Object.keys(page.dialogs).flatMap((ref) => {
						const file = this.fragments.get(ref)?.file;
						return file ? [[ref, { file }]] : [];
					}),
				),
				blocks,
			};
		}
		if (this.consent) {
			page.consent = this.consent;
		}
		if (typeof expanded.description === "string") {
			page.description = expanded.description;
		}
		if (isPlain(expanded.image)) {
			page.image = expanded.image;
		}
		// The site's own page fields (theme `extend.Page`), resolved like the rest.
		const extend = Object.fromEntries(
			Object.entries(expanded).filter(([k]) => !CORE_PAGE_FIELDS.has(k)),
		);
		if (Object.keys(extend).length) {
			page.extend = extend;
		}
		return page;
	}

	/**
	 * A fragment's blocks, expanded and resolved, e.g. for chrome or dialogs;
	 * their origins go to `sources` under the rendered `prefix`.
	 */
	fragment(
		ref: string,
		prefix: string,
		sources: Record<string, Origin>,
	): BlockJson[] {
		const f = this.fragments.get(ref);
		if (!f) {
			return [];
		}
		const list = this.withoutIds(
			this.expand(this.copy(f.doc.blocks, listLoc(f.file))),
		);
		this.mapSources(list, prefix, sources);
		const doc = this.finish({ fragment: ref, blocks: list }, "Fragment");
		return doc.blocks as BlockJson[];
	}

	/**
	 * Resolves the buttons of a page and returns the dialogs it opens:
	 *
	 *   url "#a" + opens "f"   anchor a on the page → link (opens dropped)
	 *                          otherwise            → dialog f (url dropped)
	 *   opens "f", no url      dialog f
	 *
	 * Each dialog is listed once; buttons inside dialogs are resolved the
	 * same way (against the page's anchors), so dialogs may open dialogs.
	 */
	private dialogs(
		regions: BlockJson[][],
		sources: Record<string, Origin>,
	): Record<string, BlockJson[]> {
		const anchors = new Set(regions.flatMap((r) => this.scan(r).anchors));
		const out: Record<string, BlockJson[]> = {};
		let queue = regions;
		while (queue.length) {
			const next: BlockJson[][] = [];
			for (const b of queue.flatMap((r) => this.scan(r).buttons)) {
				const url = typeof b.url === "string" ? b.url : undefined;
				if (typeof b.opens !== "string") {
					continue;
				}
				if (url?.startsWith("#") && url.length > 1) {
					if (anchors.has(url.slice(1))) {
						delete b.opens;
						continue;
					}
					delete b.url;
				} else if (url) {
					continue;
				}
				if (!(b.opens in out)) {
					out[b.opens] = this.fragment(b.opens, `dialogs/${b.opens}`, sources);
					next.push(out[b.opens] ?? []);
				}
			}
			queue = next;
		}
		return out;
	}

	/** Anchors (block anchors, rich text ids) and Button values of resolved blocks. */
	private scan(blocks: BlockJson[]): {
		anchors: string[];
		buttons: Record<string, unknown>[];
	} {
		const anchors: string[] = [];
		const buttons: Record<string, unknown>[] = [];
		this.validator.walker.walkBlocks(
			blocks,
			"PageBlock",
			{
				block: (b) => {
					if (typeof b.anchor === "string") {
						anchors.push(b.anchor);
					}
				},
				string: (s) => {
					if (s.type === "RichText") {
						for (const m of s.value.matchAll(/\sid="([^"]+)"/g)) {
							anchors.push(m[1] ?? "");
						}
					}
				},
				value: (type, value) => {
					if (type === BUTTON) {
						buttons.push(value);
					}
				},
			},
			"",
			{ block: {}, field: "blocks" },
		);
		return { anchors, buttons };
	}

	/**
	 * Deep copy of content at `loc`, recording the origin of every object.
	 * With `slots` (inside an Include), a block carrying a `slot` id that
	 * the Include overrides is replaced by the override, authored in the
	 * including file: `{...override, slot}`.
	 */
	private copy(node: unknown, loc: Loc, slots?: Map<string, Loc>): unknown {
		if (Array.isArray(node)) {
			return node.map((v, i) => this.copy(v, step(loc, i), slots));
		}
		if (!isPlain(node)) {
			return node;
		}
		const slot = typeof node.slot === "string" ? node.slot : undefined;
		const override = slot ? slots?.get(slot) : undefined;
		if (slot && override) {
			const value = this.overrides.get(override);
			const from = { ...override, validatorPath: loc.validatorPath };
			const block = { ...(this.copy(value, from) as object), slot };
			this.origins.set(block, this.origin(from, blockId(value)));
			return block;
		}
		const isBlock = this.validator.walker.isBlockDef(
			typeof node.type === "string" ? node.type : undefined,
		);
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(node)) {
			out[k] = this.copy(v, step(loc, k), slots);
		}
		// Without source maps only Includes need their origin (for nesting).
		if (this.withSources || node.type === "Include") {
			this.origins.set(
				out,
				this.origin(loc, isBlock ? blockId(node) : undefined),
			);
		}
		return out;
	}

	/**
	 * Removes block ids from expanded (copied) blocks: they are editor
	 * metadata, components never see them. Origins keep them.
	 */
	private withoutIds(list: unknown[]): unknown[] {
		const visit = (node: unknown) => {
			if (Array.isArray(node)) {
				node.forEach(visit);
				return;
			}
			if (!isPlain(node)) {
				return;
			}
			if (
				typeof node.type === "string" &&
				this.validator.walker.isBlockDef(node.type)
			) {
				delete node.id;
			}
			Object.values(node).forEach(visit);
		};
		visit(list);
		return list;
	}

	/** Override blocks of an Include, by the location of their `with` entry. */
	private readonly overrides = new WeakMap<Loc, unknown>();

	private origin(loc: Loc, id?: string): Origin {
		const o: Origin = {
			file: loc.file,
			path: loc.path,
			validatorPath: loc.validatorPath,
		};
		if (loc.via.length) {
			o.via = loc.via;
		}
		if (id) {
			o.id = id;
		}
		return o;
	}

	/**
	 * Replaces Include blocks (copies from `copy`) with the fragment's
	 * blocks, slots applied, recursively.
	 */
	private expand(list: unknown, seen: string[] = []): unknown[] {
		if (!Array.isArray(list)) {
			return [];
		}
		return list.flatMap((b) => {
			if (!isPlain(b) || b.type !== "Include") {
				return [b];
			}
			const ref = String(b.ref);
			const f = this.fragments.get(ref);
			const at = this.origins.get(b);
			if (!f || !at || seen.includes(ref)) {
				return [];
			}
			const via = [...(at.via ?? []), { file: at.file, path: at.path }];
			const slots = new Map<string, Loc>();
			const overrides = Array.isArray(b.with) ? b.with : [];
			overrides.forEach((w, j) => {
				if (isPlain(w) && typeof w.slot === "string" && isPlain(w.block)) {
					const loc: Loc = {
						file: at.file,
						path: `${at.path}/with/${j}/block`,
						validatorPath: "",
						via: at.via ?? [],
					};
					this.overrides.set(loc, w.block);
					slots.set(w.slot, loc);
				}
			});
			const inner = this.copy(
				f.doc.blocks,
				{
					file: f.file,
					path: "blocks",
					validatorPath: `${at.validatorPath}{${ref}}`,
					via,
				},
				slots,
			);
			return this.expand(inner, [...seen, ref]);
		});
	}

	/** Rendered path → origin for every block of an expanded list. */
	private mapSources(
		list: unknown[],
		prefix: string,
		out: Record<string, Origin>,
	): void {
		if (!this.withSources) {
			return;
		}
		const visit = (node: unknown, path: string) => {
			if (!node || typeof node !== "object") {
				return;
			}
			const o = this.origins.get(node);
			if (o && BLOCK_TYPE.test(String((node as BlockJson).type))) {
				out[path] = o;
			}
			for (const [k, v] of Object.entries(node)) {
				visit(v, `${path}/${k}`);
			}
		};
		list.forEach((b, i) => {
			visit(b, `${prefix}/${i}`);
		});
	}

	private finish(
		doc: Record<string, unknown>,
		root: string,
	): Record<string, unknown> {
		const walker = this.validator.walker;
		const filled = withDefaults(walker, doc, root);
		const consent = this.consent;
		walker.walk(filled, root, {
			value: (type, value) => {
				// A remote video waits for the media category behind a gate.
				if (consent && type === ASSET_OWNER && value.kind === "remote-video") {
					const gate = gateOf(consent, MEDIA, videoVendor(String(value.url)));
					// Shown before consent: only a poster of the site's own
					// (root-relative, the asset base) may load.
					if (
						typeof value.poster === "string" &&
						/^\/(?!\/)/.test(value.poster)
					) {
						gate.poster = this.url(value.poster, true);
					}
					value.consent = gate;
				}
			},
			string: (s) => {
				if (s.type === "Url") {
					// Buttons render consent:settings as a button; other links
					// point at the settings dialog, which the consent script opens.
					s.holder[s.key] =
						s.value === SETTINGS_URL && s.owner !== BUTTON
							? `#${SETTINGS_ID}`
							: this.url(s.value, s.owner === ASSET_OWNER);
				}
				if (s.type === "RichText") {
					s.holder[s.key] = s.value.replace(
						HREF,
						(_m, pre: string, q: string, href: string) =>
							href.trim() === SETTINGS_URL
								? `${pre}${q}#${SETTINGS_ID}${q} ${OPEN_ATTR}=""`
								: `${pre}${q}${this.url(href, false)}${q}`,
					);
				}
			},
		});
		return filled;
	}

	/** page:<id>[#a] → locale url; root-relative asset url → asset base. */
	private url(url: string, asset: boolean): string {
		const m = url.match(PAGE_LINK);
		if (m) {
			// Untranslated page: link to the default locale version.
			const byLocale = this.urls.get(m[1] ?? "");
			const target =
				byLocale?.get(this.locale) ??
				byLocale?.get(this.config.defaultLocale) ??
				"/";
			return `${target}${m[2] ?? ""}`;
		}
		if (asset && url.startsWith("/") && this.config.assets) {
			return `${this.config.assets.replace(/\/$/, "")}${url}`;
		}
		return url;
	}
}
