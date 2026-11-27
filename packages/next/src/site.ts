// Site loading, shared by pages and the sitemap route (core
// `loadProjectSite`). No React imports: route handlers (sitemap) must not
// pull in client router modules.

import { type LoadedSite, loadProjectSite } from "@wunderweb/core";

export type Loaded = LoadedSite;

/**
 * Loads and validates the site (throws on content errors). Cached once per
 * process in production; reloaded per call in dev so content edits show up.
 */
export function site(root?: string): Loaded {
	return loadProjectSite(root);
}
