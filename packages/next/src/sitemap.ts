// app/sitemap.ts: export default createSitemap()

import type { MetadataRoute } from "next";

import { type ContentSource, defaultSource } from "./source.js";

export function createSitemap(source: ContentSource = defaultSource()) {
	return async function sitemap(): Promise<MetadataRoute.Sitemap> {
		const { config, pages } = await source.index();
		const base = config.siteUrl?.replace(/\/$/, "") ?? "";
		const abs = (u: string) => `${base}${u}`;
		return pages
			.filter((p) => !p.noindex)
			.map((p) => ({
				url: abs(p.url),
				alternates: {
					languages: Object.fromEntries(
						Object.entries(p.alternates).map(([l, u]) => [l, abs(u)]),
					),
				},
			}));
	};
}
