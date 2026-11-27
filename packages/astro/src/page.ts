// The page's HTML for Page.astro: the runtime's Page, rendered on the
// server once and completely (React `prerender`, never hydrated).
//
// Not through @astrojs/react's component rendering: it reads React's
// stream as it comes, so in edit mode, where every block is a Suspense
// boundary, a failing block would leave the following ones as fallbacks
// completed by inline scripts, which the in-place refresh does not run.
// `prerender` waits for every boundary: a failing block shows its
// placeholder, the others their content.

import type { SourcePage } from "@wunderweb/core";
import {
	type Annotation,
	type Registry,
	Page as RenderPage,
} from "@wunderweb/react";
import { createElement } from "react";
import { prerender } from "react-dom/static";

import { mountRefresh } from "./refresh-script.js";

/** The annotation of a page in edit mode (no client boundary: the Suspense fallback shows). */
export function annotationOf(page: SourcePage): Annotation | undefined {
	const a = page.annotate;
	if (!a) {
		return undefined;
	}
	return {
		revision: a.revision,
		editorOrigins: a.editorOrigins,
		findings: a.findings,
		...(page.page.sources ? { sources: page.page.sources.blocks } : {}),
	};
}

/**
 * Resource hints React hoists out of the page (image preloads, stylesheets):
 * outside a document render they would lead the body. Dropped, as
 * @astrojs/react does.
 */
const HOISTED =
	/<link\s[^>]*rel="(?:preload|modulepreload|stylesheet|preconnect|dns-prefetch)"[^>]*>/g;

/**
 * HTML of the page's header, main, footer and dialogs. Throws on a block
 * that fails to render, except in edit mode (its placeholder shows).
 */
export async function renderPage(
	page: SourcePage,
	registry: Registry,
): Promise<string> {
	const annotate = annotationOf(page);
	const { prelude } = await prerender(
		createElement(RenderPage, {
			page: page.page,
			registry,
			breakpoints: page.breakpoints,
			...(annotate ? { annotate } : {}),
		}),
		{
			// Every boundary inline: React outlines large ones (completed by
			// inline scripts) for progressive display, which a static page and
			// the in-place refresh do not need.
			progressiveChunkSize: Number.POSITIVE_INFINITY,
			onError(error) {
				// Edit mode: the block's boundary shows a placeholder.
				console.error(error);
			},
		},
	);
	const html = await new Response(prelude).text();
	return html.replace(HOISTED, "");
}

/** Inline script registering the edit mode refresh with the bridge. */
export const refreshScript = `(${mountRefresh})()`;
