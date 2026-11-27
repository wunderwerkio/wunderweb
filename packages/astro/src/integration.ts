// The Astro integration: dev server settings for content, the preview
// build, and an opt-in CSS purge after the build.
//
//   // astro.config.mjs
//   integrations: [react(), wunderweb()]
//
// - In `astro dev` the content route (`src/pages/[...slug].astro`) renders
//   on demand, so content edits and new pages show without a restart (Astro caches getStaticPaths in dev). `astro
//   build` prerenders it. The hosts in ALLOWED_DEV_ORIGINS (e.g. a dev
//   proxy's) may reach the dev server.
// - `wunderweb({ purgeCss: true })`: after `astro build`, the built
//   stylesheets lose the rules no page can match (purge.ts).
// - Preview build (wunderweb): `WUNDERWEB_PREVIEW=1 astro build` with a
//   server adapter. The content route and the site's `previewRoutes` render
//   on demand from the content service (WUNDERWEB_CONTENT_URL at run time,
//   per request); every other route stays static. `isPreview` is true in
//   that build only. A static build ignores WUNDERWEB_CONTENT_URL and
//   reads the content files.

import { fileURLToPath } from "node:url";
import { PREVIEW_ENV } from "@wunderweb/core";
import type { AstroIntegration, IntegrationResolvedRoute } from "astro";

export const NAME = "@wunderweb/astro";
export const DEFAULT_ROUTE = "src/pages/[...slug].astro";
const REACT = "@astrojs/react";

export interface WunderwebOptions {
	/** The content route, relative to the project root. Default `src/pages/[...slug].astro`. */
	route?: string;
	/**
	 * After `astro build`, remove the CSS rules that require a class used
	 * nowhere in the build (HTML and client scripts) and rename the purged
	 * stylesheets after their content (`purge.ts`). Off by default. Skipped
	 * with a warning for builds with on-demand pages or islands; a class a
	 * script adds must be written out literally in it. `astro dev` keeps
	 * the full CSS.
	 */
	purgeCss?: boolean;
	/**
	 * Further routes (components relative to the project root, e.g.
	 * `src/pages/sitemap.xml.ts`) that read content and so render on demand
	 * in a preview build, like the content route.
	 */
	previewRoutes?: string[];
}

/** Whether this process builds a preview (`WUNDERWEB_PREVIEW=1`). */
export function previewBuild(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[PREVIEW_ENV] === "1";
}

/** Hosts of ALLOWED_DEV_ORIGINS ("a.example.com,b:8080" → ["a.example.com", "b"]). */
export function devHosts(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((h) => h.trim())
		.filter(Boolean)
		.map((h) => {
			try {
				return new URL(h.includes("://") ? h : `http://${h}`).hostname;
			} catch {
				return h;
			}
		});
}

/**
 * Patterns of the project's pages rendered on demand. Astro's own routes
 * (its 404 page, the server islands endpoint every server build has) are
 * not: a server island in use shows in the prerendered HTML (purge.ts).
 */
export function onDemandPages(
	routes: Pick<
		IntegrationResolvedRoute,
		"type" | "isPrerendered" | "origin" | "pattern"
	>[],
): string[] {
	return routes
		.filter(
			(r) => r.type === "page" && !r.isPrerendered && r.origin !== "internal",
		)
		.map((r) => r.pattern);
}

export function wunderweb(opts: WunderwebOptions = {}): AstroIntegration {
	const route = opts.route ?? DEFAULT_ROUTE;
	const onDemandInPreview = new Set([route, ...(opts.previewRoutes ?? [])]);
	let dev = false;
	let preview = false;
	const matched = new Set<string>();
	let assetsDir = "_astro";
	let serverDir: string | undefined;
	let onDemand: string[] = [];
	return {
		name: NAME,
		hooks: {
			"astro:config:setup": ({ command, config, updateConfig }) => {
				if (!config.integrations.some((i) => i.name === REACT)) {
					throw new Error(
						`${NAME}: blocks are React components; add @astrojs/react before wunderweb() in \`integrations\``,
					);
				}
				dev = command === "dev";
				preview = command === "build" && previewBuild();
				if (preview) {
					updateConfig({
						vite: {
							define: { __WUNDERWEB_PREVIEW__: "true" },
							// Bundled, so the define reaches the adapter's code.
							ssr: { noExternal: [NAME] },
						},
					});
				}
				if (!dev) {
					return;
				}
				const hosts = devHosts(process.env.ALLOWED_DEV_ORIGINS);
				if (hosts.length > 0 && config.server.allowedHosts !== true) {
					updateConfig({ server: { allowedHosts: hosts } });
				}
			},
			"astro:config:done": ({ config }) => {
				assetsDir = config.build.assets;
				// Absent after a static build; the server manifest names the assets.
				serverDir = fileURLToPath(config.build.server);
			},
			"astro:route:setup": ({ route: r }) => {
				if (dev && r.component === route) {
					r.prerender = false;
				}
				if (preview && onDemandInPreview.has(r.component)) {
					r.prerender = false;
					matched.add(r.component);
				}
			},
			"astro:routes:resolved": ({ routes }) => {
				onDemand = onDemandPages(routes);
				// A route left out by a typo would be prerendered in a preview
				// build: one snapshot instead of the changeset, per request.
				const missing = [...onDemandInPreview].filter((c) => !matched.has(c));
				if (preview && missing.length) {
					throw new Error(
						`${NAME}: preview build: no route for ${missing.join(", ")} (route / previewRoutes name components relative to the project root, e.g. src/pages/sitemap.xml.ts)`,
					);
				}
			},
			"astro:build:done": async ({ dir, logger }) => {
				if (!opts.purgeCss) {
					return;
				}
				// Loaded only here: postcss stays out of dev and default builds.
				const { purgeBuild } = await import("./purge.js");
				await purgeBuild({
					clientDir: fileURLToPath(dir),
					assetsDir,
					serverDir,
					onDemandPages: onDemand,
					logger,
				});
			},
		},
	};
}
