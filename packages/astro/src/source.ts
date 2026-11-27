// Content sources of the Astro adapter: the shared ones from core.
//
// defaultSource(): fileSource(), the project's files.
//
// sourceFor(request): in a preview build (WUNDERWEB_PREVIEW=1 at build
// time, wunderweb) the content service's page for the request's changeset
// (core `previewSource`), else defaultSource(). Pass the request to
// loadPage, createSitemap and your own routes; previewHeaders marks the
// response as a preview (no cache, noindex).

import {
	type ContentSource,
	fileSource,
	previewSource,
	type SourcePage,
	setPreviewHeaders,
} from "@wunderweb/core";

/** Defined by the integration in a preview build (the adapter is bundled then). */
declare const __WUNDERWEB_PREVIEW__: boolean | undefined;

/** Whether this is a preview build (`WUNDERWEB_PREVIEW=1` at build time). */
export const isPreview: boolean =
	typeof __WUNDERWEB_PREVIEW__ !== "undefined" &&
	__WUNDERWEB_PREVIEW__ === true;

let fallback: ContentSource | undefined;

/** The project's files (fileSource()). */
export function defaultSource(): ContentSource {
	fallback ??= fileSource();
	return fallback;
}

/** The content source of a request: the preview's in a preview build, else the default. */
export function sourceFor(request: Request | undefined): ContentSource {
	if (isPreview) {
		if (!request) {
			throw new Error(
				"wunderweb preview: the content comes per request; pass Astro.request",
			);
		}
		return previewSource(request);
	}
	return defaultSource();
}

/**
 * Marks a response as a preview (pass the response's headers, or
 * Astro.response.headers): never cached or indexed; framed and top-level
 * renders differ. Nothing outside a preview build.
 */
export function previewHeaders(headers: Headers): Headers {
	return isPreview ? setPreviewHeaders(headers) : headers;
}

/**
 * URL path of a `[...slug]` route's param: undefined → "/", "en/about" →
 * "/en/about" (decoded, without a trailing slash).
 */
export function urlOf(slug: string | undefined): string {
	const path = (slug ?? "")
		.split("/")
		.filter(Boolean)
		.map((p) => decodeURIComponent(p))
		.join("/");
	return `/${path}`;
}

/** Static paths of a `src/pages/[...slug].astro` route: one per content page. */
export async function getStaticPaths(
	source: ContentSource = defaultSource(),
): Promise<{ params: { slug: string | undefined } }[]> {
	const index = await source.index();
	return index.pages.map((p) => ({
		params: { slug: p.url === "/" ? undefined : p.url.slice(1) },
	}));
}

/**
 * The page of a `[...slug]` route, undefined if there is none (render the
 * 404 page then). For a framed preview request it carries the annotation
 * for the editor.
 *
 *   const page = await loadPage(Astro.params.slug, { request: Astro.request });
 *   if (!page) return new Response(null, { status: 404 });
 *
 * With `request`, the source is `sourceFor(request)`; a source given
 * directly (or as `{source}`) wins.
 */
export function loadPage(
	slug: string | undefined,
	from?: ContentSource | { request?: Request; source?: ContentSource },
): Promise<SourcePage | undefined> {
	let source: ContentSource;
	if (from && "page" in from) {
		source = from;
	} else {
		source = from?.source ?? sourceFor(from?.request);
	}
	return source.page(urlOf(slug));
}
