// Content sources: where a framework adapter's pages come from. Shared by
// the adapters (Next, Astro); no framework or React imports.
//
//   fileSource()              the project's files (build, dev server)
//   previewSource(request)    a preview build (wunderweb): the content
//                             service's page for the request's changeset

import { type Config, findProject } from "./project.js";
import { loadSite, readSchema, type Site, type SitePage } from "./site.js";
import type { Finding } from "./validate.js";

/** Per request: a hung connection fails, it is not waited for. */
const REQUEST_TIMEOUT = 10000;

export interface PageEntry {
	url: string;
	id: string;
	locale: string;
	alternates: Record<string, string>;
	noindex: boolean;
}

export interface SiteIndex {
	config: Config;
	breakpoints: string[];
	pages: PageEntry[];
}

/** A page to render; `annotate` for the editor's frame (a framed preview). */
export interface SourcePage {
	page: SitePage;
	breakpoints: string[];
	config: Config;
	annotate?: {
		revision: number;
		editorOrigins: string[];
		findings: Record<string, Finding[]>;
	};
}

export interface ContentSource {
	readonly kind: "file" | "preview";
	index(): Promise<SiteIndex>;
	/** The page at a URL path ("/", "/en/about"), undefined if none. */
	page(url: string): Promise<SourcePage | undefined>;
}

export interface LoadedSite {
	site: Site;
	byUrl: Map<string, SitePage>;
	breakpoints: string[];
}

let cached: LoadedSite | undefined;

/**
 * Loads and validates the site (throws on content errors). Cached once per
 * process in production; reloaded per call in dev so content edits show up.
 */
export function loadProjectSite(root?: string): LoadedSite {
	const reuse = !root && process.env.NODE_ENV === "production";
	if (cached && reuse) {
		return cached;
	}
	const project = findProject(root ?? process.cwd());
	const schema = readSchema(project);
	const s = loadSite(project, schema);
	const bpSpec = (schema.$defs as Record<string, { enum?: string[] }>)
		.Breakpoint;
	const loaded = {
		site: s,
		byUrl: new Map(s.pages.map((p) => [p.url, p])),
		breakpoints: bpSpec?.enum ?? ["base"],
	};
	if (reuse) {
		cached = loaded;
	}
	return loaded;
}

/** The project's content files (validated; throws on content errors). */
export function fileSource(root?: string): ContentSource {
	return {
		kind: "file",
		async index() {
			const s = loadProjectSite(root);
			return {
				config: s.site.config,
				breakpoints: s.breakpoints,
				pages: s.site.pages,
			};
		},
		async page(url) {
			const s = loadProjectSite(root);
			const page = s.byUrl.get(url);
			return (
				page && { page, breakpoints: s.breakpoints, config: s.site.config }
			);
		},
	};
}

// ----------------------------------------------------------------- preview

/** The content service's answer to `GET /site[?url=]` (the edit protocol's SiteResponse). */
interface SiteResponse extends SiteIndex {
	revision: number;
	editorOrigins: string[];
	page?: SitePage;
	findings?: Record<string, Finding[]>;
}

/** Build switch of a preview build (wunderweb): `WUNDERWEB_PREVIEW=1`. */
export const PREVIEW_ENV = "WUNDERWEB_PREVIEW";
/** The content service a preview build reads its pages from. */
export const CONTENT_URL_ENV = "WUNDERWEB_CONTENT_URL";
/** Sent by the in-place refresh (a fetch is not a frame navigation). */
export const FRAME_HEADER = "x-wunderweb-frame";
/** Set by forward-auth on every preview request; never by the browser. */
export const TOKEN_HEADER = "x-wunderweb-preview-token";

/** Whether a request renders into the editor's frame (annotated). */
export function isFramed(request: Request): boolean {
	return (
		request.headers.get("sec-fetch-dest") === "iframe" ||
		request.headers.has(FRAME_HEADER)
	);
}

export interface PreviewOptions {
	/** The content service. Default: WUNDERWEB_CONTENT_URL. */
	url?: string | undefined;
	fetch?: typeof fetch;
}

/**
 * The content service's pages for one request of a preview build: the
 * resolved page of the request's changeset (the edit protocol's GET
 * /site), fetched with the preview token forward-auth set on the request.
 * Allowed in a production server, since a preview build is one; adapters
 * use it only in a preview build. Never falls back to the files. A framed
 * request gets the annotation for the editor, any other the production
 * render.
 */
export function previewSource(
	request: Request,
	opts: PreviewOptions = {},
): ContentSource {
	const url = opts.url ?? process.env[CONTENT_URL_ENV];
	if (!url) {
		throw new Error(
			`wunderweb preview: ${CONTENT_URL_ENV} is not set; a preview never falls back to the content files`,
		);
	}
	const base = url.replace(/\/$/, "");
	const doFetch = opts.fetch ?? fetch;
	const token = request.headers.get(TOKEN_HEADER);
	const framed = isFramed(request);

	/** One `GET /site[?url=]` (edit protocol); undefined for a 404. */
	async function get(path: string): Promise<SiteResponse | undefined> {
		let res: Response;
		try {
			res = await doFetch(`${base}${path}`, {
				cache: "no-store",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT),
				...(token ? { headers: { [TOKEN_HEADER]: token } } : {}),
			});
		} catch (e) {
			throw new Error(
				`wunderweb preview: content service at ${base} unavailable (${e instanceof Error ? e.message : String(e)})`,
			);
		}
		if (res.status === 404) {
			return undefined;
		}
		if (!res.ok) {
			throw new Error(
				`wunderweb preview: content service at ${base} unavailable (${res.status} ${await res.text()})`,
			);
		}
		const body = (await res.json()) as SiteResponse;
		if (
			typeof body?.revision !== "number" ||
			!body.config ||
			!Array.isArray(body.pages) ||
			!Array.isArray(body.breakpoints) ||
			!Array.isArray(body.editorOrigins)
		) {
			throw new Error(
				`wunderweb preview: ${base}${path} is not a wunderweb content service (protocol mismatch)`,
			);
		}
		return body;
	}

	return {
		kind: "preview",
		async index() {
			const s = await get("/site");
			if (!s) {
				throw new Error(
					`wunderweb preview: content service at ${base} has no /site`,
				);
			}
			return s;
		},
		async page(path) {
			const s = await get(`/site?url=${encodeURIComponent(path)}`);
			if (!s?.page) {
				return undefined;
			}
			const page = {
				page: s.page,
				breakpoints: s.breakpoints,
				config: s.config,
			};
			// A framed request gets the annotation, any other the production render.
			return framed
				? {
						...page,
						annotate: {
							revision: s.revision,
							editorOrigins: s.editorOrigins,
							findings: s.findings ?? {},
						},
					}
				: page;
		},
	};
}

/**
 * Headers of every preview response: never cached or indexed, and framed
 * and top-level renders differ.
 */
export function setPreviewHeaders(headers: Headers): Headers {
	headers.set("cache-control", "no-store");
	headers.set("x-robots-tag", "noindex");
	// Kept with any vary the response has already.
	const vary = headers.get("vary");
	headers.set(
		"vary",
		[vary, "sec-fetch-dest", FRAME_HEADER].filter(Boolean).join(", "),
	);
	return headers;
}
