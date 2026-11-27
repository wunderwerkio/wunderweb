// @wunderweb/astro: Astro 7 adapter. One rest route renders
// every content page; blocks are the project's React components (compiled
// by @astrojs/react), rendered on the server only (no hydration).
//
//   astro.config.mjs            integrations: [react(), wunderweb()]
//   src/pages/[...slug].astro   getStaticPaths, loadPage, <Head>, <Page>
//   src/pages/sitemap.xml.ts    export const GET = createSitemap()
//
//   ---
//   import { getStaticPaths as paths, loadPage } from "@wunderweb/astro";
//   import Head from "@wunderweb/astro/Head.astro";
//   import Page from "@wunderweb/astro/Page.astro";
//   export const getStaticPaths = () => paths();
//   const page = await loadPage(Astro.params.slug);
//   if (!page) return new Response(null, { status: 404 });
//   ---
//   <html lang={page.page.locale}><head><Head page={page} /></head>
//   <body><Page page={page} registry={registry} /></body></html>
//
// Consent (site config `consent`): <ConsentHead page> first in <head>,
// <Consent page> first in <body> (banner, settings dialog, client script).
//
// Content comes from a content source: the project's files. A preview build
// (WUNDERWEB_PREVIEW=1, see integration.ts) reads each request's page from
// the content service, annotated for the hosted editor when framed.

export {
	CONTENT_URL_ENV,
	type ContentSource,
	FRAME_HEADER,
	fileSource,
	isFramed,
	type PageEntry,
	PREVIEW_ENV,
	previewSource,
	type SiteIndex,
	type SourcePage,
	TOKEN_HEADER,
} from "@wunderweb/core";
export { consentScript } from "@wunderweb/react";
export {
	CONSENT_HOSTS_ENV,
	consentHeadOf,
	consentHosts,
	consentOf,
} from "./consent.js";
export { absoluteUrl, type HeadData, headOf } from "./head.js";
export {
	type AstroImageOptions,
	type AstroImages,
	astroImageTransformer,
	type GetImage,
	type InferRemoteSize,
	type ResponsiveImageOptions,
	responsiveImages,
} from "./images.js";
export {
	BACKGROUND_QUALITY,
	type ImgproxyOptions,
	imgproxySignature,
	imgproxyTransformer,
	POSTER_WIDTH,
} from "./imgproxy.js";
export {
	DEFAULT_ROUTE,
	devHosts,
	previewBuild,
	type WunderwebOptions,
	wunderweb,
} from "./integration.js";
export { annotationOf, refreshScript, renderPage } from "./page.js";
export { createSitemap, sitemapXml } from "./sitemap.js";
export {
	defaultSource,
	getStaticPaths,
	isPreview,
	loadPage,
	previewHeaders,
	sourceFor,
	urlOf,
} from "./source.js";

import { wunderweb } from "./integration.js";

export default wunderweb;
