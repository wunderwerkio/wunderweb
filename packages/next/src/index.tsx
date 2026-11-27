// Next.js 16 App Router adapter: one optional catch-all route renders every
// content page.
//
//   app/[[...slug]]/layout.tsx   export default createLayout()      <html lang> per page
//   app/[[...slug]]/page.tsx     createPage({ registry })            params, metadata, page
//   app/sitemap.ts               export default createSitemap()      (from …/sitemap)
//
// Content comes from a content source (source.ts): the project's files
// (static generation; cached per process in production). A Next.js site is
// edited in its YAML; the hosted editor's preview is Astro's for now.

import { type Registry, Page as RenderPage } from "@wunderweb/react";
import type { Metadata } from "next";
import { notFound } from "next/navigation.js";
import type { ReactNode } from "react";
import { cache } from "react";

import { site } from "./site.js";
import {
	type ContentSource,
	defaultSource,
	type SourcePage,
} from "./source.js";

export {
	type ContentSource,
	defaultSource,
	fileSource,
	type PageEntry,
	type SiteIndex,
	type SourcePage,
} from "./source.js";
export { site };

export interface RouteParams {
	slug?: string[];
}

/** URL of the catch-all params: undefined → "/", ["en", "about"] → "/en/about". */
export function urlOf(params: RouteParams): string {
	const parts = (params.slug ?? []).map((p) => decodeURIComponent(p));
	return `/${parts.join("/")}`;
}

/** One load per source and URL per render: layout, metadata and page share it. */
const load = cache(
	(source: ContentSource, url: string): Promise<SourcePage | undefined> =>
		source.page(url),
);

async function pageFor(
	source: ContentSource,
	params: RouteParams,
): Promise<SourcePage> {
	const found = await load(source, urlOf(params));
	if (!found) {
		notFound();
	}
	return found;
}

type Props = { params: Promise<RouteParams> };

export interface PageOptions {
	registry: Registry;
	/** Default: the project files. */
	source?: ContentSource;
}

export function createPage({
	registry,
	source = defaultSource(),
}: PageOptions) {
	return {
		async generateStaticParams(): Promise<RouteParams[]> {
			const index = await source.index();
			return index.pages.map((p) => ({
				slug: p.url === "/" ? [] : p.url.slice(1).split("/"),
			}));
		},

		async generateMetadata({ params }: Props): Promise<Metadata> {
			const { page, config } = await pageFor(source, await params);
			const siteUrl = config.siteUrl;
			const image = page.image as
				| { url?: string; width?: number; height?: number; alt?: string }
				| undefined;
			const meta: Metadata = {
				title: page.title,
				alternates: { canonical: page.url, languages: page.alternates },
				robots: page.noindex ? { index: false, follow: true } : null,
			};
			if (siteUrl) {
				meta.metadataBase = new URL(siteUrl);
			}
			if (page.description) {
				meta.description = page.description;
			}
			if (image?.url) {
				meta.openGraph = {
					images: [
						{
							url: image.url,
							...(image.width ? { width: image.width } : {}),
							...(image.height ? { height: image.height } : {}),
						},
					],
				};
			}
			return meta;
		},

		async Page({ params }: Props) {
			const { page, breakpoints } = await pageFor(source, await params);
			return (
				<RenderPage page={page} registry={registry} breakpoints={breakpoints} />
			);
		},
	};
}

/**
 * Root layout of the catch-all route: <html lang> is the page's locale.
 * `htmlClassName` carries font variables (next/font), so theme variables on
 * :root can reference them.
 */
export function createLayout(
	opts: {
		htmlClassName?: string;
		bodyClassName?: string;
		source?: ContentSource;
	} = {},
) {
	const source = opts.source ?? defaultSource();
	return async function Layout({
		children,
		params,
	}: {
		children: ReactNode;
		params: Promise<RouteParams>;
	}) {
		const found = await load(source, urlOf(await params));
		const lang =
			found?.page.locale ?? (await source.index()).config.defaultLocale;
		return (
			<html lang={lang} className={opts.htmlClassName}>
				<body className={opts.bodyClassName}>{children}</body>
			</html>
		);
	};
}
