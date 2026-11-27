// Head metadata of a page, as the Next adapter emits it: title,
// description, robots, canonical and hreflang alternates (absolute with
// config `siteUrl`), Open Graph image. Rendered by Head.astro.

import type { SourcePage } from "@wunderweb/core";

export interface HeadData {
	title: string;
	description?: string;
	/** "noindex, follow" for pages with `noindex`. */
	robots?: string;
	canonical: string;
	/** hreflang → href, the page's translations (itself included). */
	alternates: { hreflang: string; href: string }[];
	image?: { url: string; width?: number; height?: number; alt?: string };
}

/** `url` against `siteUrl`: "/" → "https://site.tld", "/en/a" → "https://site.tld/en/a". */
export function absoluteUrl(url: string, siteUrl: string | undefined): string {
	if (!siteUrl || /^[a-z][a-z0-9+.-]*:/i.test(url)) {
		return url;
	}
	const base = siteUrl.replace(/\/$/, "");
	return url === "/" ? base : `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function headOf({ page, config }: SourcePage): HeadData {
	const abs = (u: string) => absoluteUrl(u, config.siteUrl);
	const image = page.image as
		| { url?: string; width?: number; height?: number; alt?: string }
		| undefined;
	const head: HeadData = {
		title: page.title,
		canonical: abs(page.url),
		alternates: Object.entries(page.alternates).map(([hreflang, href]) => ({
			hreflang,
			href: abs(href),
		})),
	};
	if (page.description) {
		head.description = page.description;
	}
	if (page.noindex) {
		head.robots = "noindex, follow";
	}
	if (image?.url) {
		head.image = {
			url: abs(image.url),
			...(image.width ? { width: image.width } : {}),
			...(image.height ? { height: image.height } : {}),
			...(image.alt ? { alt: image.alt } : {}),
		};
	}
	return head;
}
