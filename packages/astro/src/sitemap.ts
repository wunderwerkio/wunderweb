// src/pages/sitemap.xml.ts:
//
//   import { createSitemap } from "@wunderweb/astro";
//   export const GET = createSitemap();
//
// Every indexed page with its hreflang alternates (the Next adapter's
// sitemap.xml), absolute with config `siteUrl`.

import type { ContentSource } from "@wunderweb/core";

import { defaultSource, previewHeaders, sourceFor } from "./source.js";

const xml = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&apos;",
			})[c] as string,
	);

/** sitemap.xml of the site's indexed pages. */
export async function sitemapXml(
	source: ContentSource = defaultSource(),
): Promise<string> {
	const { config, pages } = await source.index();
	// As Next's sitemap: the site url and the path, the home with its slash.
	const base = config.siteUrl?.replace(/\/$/, "") ?? "";
	const abs = (u: string) => xml(`${base}${u}`);
	const urls = pages
		.filter((p) => !p.noindex)
		.map((p) =>
			[
				"<url>",
				`<loc>${abs(p.url)}</loc>`,
				...Object.entries(p.alternates).map(
					([l, u]) =>
						`<xhtml:link rel="alternate" hreflang="${xml(l)}" href="${abs(u)}" />`,
				),
				"</url>",
			].join("\n"),
		);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
		...urls,
		"</urlset>",
		"",
	].join("\n");
}

/**
 * A GET endpoint (APIRoute) serving sitemapXml(): of `source`, else of the
 * request's source (a preview build lists the changeset's pages).
 */
export function createSitemap(
	source?: ContentSource,
): (context?: { request?: Request }) => Promise<Response> {
	return async (context) => {
		const body = await sitemapXml(source ?? sourceFor(context?.request));
		const headers = new Headers({
			"content-type": "application/xml; charset=utf-8",
		});
		return new Response(body, { headers: previewHeaders(headers) });
	};
}
