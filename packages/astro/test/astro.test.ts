// The Astro adapter without Astro: routes, head metadata, sitemap and the
// integration's hooks against a stub content source.

import type { ContentSource, SitePage, SourcePage } from "@wunderweb/core";
import { type BlockProps, createRegistry } from "@wunderweb/react";
import type { AstroIntegration } from "astro";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
	absoluteUrl,
	annotationOf,
	consentHosts,
	devHosts,
	type GetImage,
	getStaticPaths,
	headOf,
	loadPage,
	renderPage,
	responsiveImages,
	sitemapXml,
	urlOf,
	wunderweb,
} from "../src/index.js";

const config = {
	schema: 1,
	locales: ["de", "en"],
	defaultLocale: "de",
	siteUrl: "https://example.com/",
} as unknown as SourcePage["config"];

function sitePage(over: Partial<SitePage>): SitePage {
	return {
		id: "home",
		url: "/",
		locale: "de",
		title: "Start",
		alternates: { de: "/", en: "/en" },
		homes: { de: "/", en: "/en" },
		header: [],
		blocks: [],
		footer: [],
		noindex: false,
		...over,
	} as SitePage;
}

type Plain = { type: "Plain"; text: string };

const PAGES = [
	sitePage({}),
	sitePage({ id: "home", url: "/en", locale: "en", title: "Home" }),
	sitePage({
		id: "about",
		url: "/ueber-uns",
		alternates: { de: "/ueber-uns" },
		noindex: true,
	}),
];

const source: ContentSource = {
	kind: "file",
	async index() {
		return { config, breakpoints: ["base", "md"], pages: PAGES };
	},
	async page(url) {
		const page = PAGES.find((p) => p.url === url);
		return page && { page, config, breakpoints: ["base", "md"] };
	},
};

describe("routes", () => {
	it("maps rest params to page urls", () => {
		expect(urlOf(undefined)).toBe("/");
		expect(urlOf("")).toBe("/");
		expect(urlOf("en/about")).toBe("/en/about");
		expect(urlOf("en/about/")).toBe("/en/about");
		expect(urlOf("%C3%BCber")).toBe("/über");
	});

	it("lists one static path per page, the home without a slug", async () => {
		expect(await getStaticPaths(source)).toEqual([
			{ params: { slug: undefined } },
			{ params: { slug: "en" } },
			{ params: { slug: "ueber-uns" } },
		]);
	});

	it("loads the page of a slug, undefined for none", async () => {
		expect((await loadPage("en", source))?.page.title).toBe("Home");
		expect(await loadPage("nope", source)).toBeUndefined();
	});
});

describe("head", () => {
	it("resolves urls against siteUrl like Next's metadataBase", () => {
		expect(absoluteUrl("/", "https://example.com/")).toBe(
			"https://example.com",
		);
		expect(absoluteUrl("/en/a", "https://example.com")).toBe(
			"https://example.com/en/a",
		);
		expect(absoluteUrl("/en/a", undefined)).toBe("/en/a");
		expect(absoluteUrl("https://cdn.example.com/a.png", "https://x.y")).toBe(
			"https://cdn.example.com/a.png",
		);
	});

	it("has title, canonical and hreflang alternates", async () => {
		const page = await loadPage(undefined, source);
		expect(headOf(page as SourcePage)).toEqual({
			title: "Start",
			canonical: "https://example.com",
			alternates: [
				{ hreflang: "de", href: "https://example.com" },
				{ hreflang: "en", href: "https://example.com/en" },
			],
		});
	});

	it("adds description, robots and the Open Graph image when set", () => {
		const head = headOf({
			config,
			breakpoints: ["base"],
			page: sitePage({
				description: "About us",
				noindex: true,
				image: { url: "/media/og.png", width: 1200, height: 630 },
			} as Partial<SitePage>),
		});
		expect(head.description).toBe("About us");
		expect(head.robots).toBe("noindex, follow");
		expect(head.image).toEqual({
			url: "https://example.com/media/og.png",
			width: 1200,
			height: 630,
		});
	});

	it("annotates only in edit mode, with the page's block sources", () => {
		const page = sitePage({
			sources: {
				blocks: {
					"blocks/0": { file: "de/pages/home.yaml", path: "blocks/0" },
				},
			},
		} as unknown as Partial<SitePage>);
		expect(annotationOf({ page, config, breakpoints: [] })).toBeUndefined();
		expect(
			annotationOf({
				page,
				config,
				breakpoints: [],
				annotate: { revision: 3, editorOrigins: ["http://e"], findings: {} },
			}),
		).toEqual({
			revision: 3,
			editorOrigins: ["http://e"],
			findings: {},
			sources: { "blocks/0": { file: "de/pages/home.yaml", path: "blocks/0" } },
		});
	});
});

describe("sitemap", () => {
	it("lists indexed pages with their alternates, absolute and escaped", async () => {
		const xml = await sitemapXml(source);
		expect(xml).toBe(
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
				"<url>",
				"<loc>https://example.com/</loc>",
				'<xhtml:link rel="alternate" hreflang="de" href="https://example.com/" />',
				'<xhtml:link rel="alternate" hreflang="en" href="https://example.com/en" />',
				"</url>",
				"<url>",
				"<loc>https://example.com/en</loc>",
				'<xhtml:link rel="alternate" hreflang="de" href="https://example.com/" />',
				'<xhtml:link rel="alternate" hreflang="en" href="https://example.com/en" />',
				"</url>",
				"</urlset>",
				"",
			].join("\n"),
		);
	});
});

type Hooks = Required<AstroIntegration["hooks"]>;

/** Runs config:setup with a minimal hook context; returns the config updates. */
function setup(
	integration: AstroIntegration,
	command: "dev" | "build",
	integrations = [{ name: "@astrojs/react", hooks: {} }],
	allowedHosts: string[] | true = [],
) {
	const updates: unknown[] = [];
	const hook = integration.hooks["astro:config:setup"] as (o: unknown) => void;
	hook({
		command,
		config: { integrations, server: { allowedHosts } },
		updateConfig: (u: unknown) => updates.push(u),
	});
	return updates;
}

function routeSetup(integration: AstroIntegration, component: string) {
	const route: { component: string; prerender?: boolean } = { component };
	(integration.hooks["astro:route:setup"] as Hooks["astro:route:setup"])({
		route,
	} as Parameters<Hooks["astro:route:setup"]>[0]);
	return route.prerender;
}

describe("integration", () => {
	const env = (vars: Record<string, string | undefined>, fn: () => void) => {
		const saved = Object.fromEntries(
			Object.keys(vars).map((k) => [k, process.env[k]]),
		);
		Object.assign(process.env, vars);
		for (const [k, v] of Object.entries(vars)) {
			if (v === undefined) {
				delete process.env[k];
			}
		}
		try {
			fn();
		} finally {
			for (const [k, v] of Object.entries(saved)) {
				if (v === undefined) {
					delete process.env[k];
				} else {
					process.env[k] = v;
				}
			}
		}
	};

	it("needs @astrojs/react", () => {
		expect(() => setup(wunderweb(), "build", [])).toThrow(/@astrojs\/react/);
	});

	it("renders the content route on demand in dev, prerenders it in a build", () => {
		const dev = wunderweb();
		setup(dev, "dev");
		expect(routeSetup(dev, "src/pages/[...slug].astro")).toBe(false);
		expect(routeSetup(dev, "src/pages/other.astro")).toBeUndefined();

		const build = wunderweb();
		setup(build, "build");
		expect(routeSetup(build, "src/pages/[...slug].astro")).toBeUndefined();

		const custom = wunderweb({ route: "src/pages/[...path].astro" });
		setup(custom, "dev");
		expect(routeSetup(custom, "src/pages/[...path].astro")).toBe(false);
	});

	it("in a preview build renders the content route and the previewRoutes on demand", () => {
		const resolved = (i: AstroIntegration) =>
			(i.hooks["astro:routes:resolved"] as (o: unknown) => void)({
				routes: [],
			});
		env({ WUNDERWEB_PREVIEW: "1" }, () => {
			const i = wunderweb({ previewRoutes: ["src/pages/sitemap.xml.ts"] });
			expect(setup(i, "build")).toEqual([
				{
					vite: {
						define: { __WUNDERWEB_PREVIEW__: "true" },
						ssr: { noExternal: ["@wunderweb/astro"] },
					},
				},
			]);
			expect(routeSetup(i, "src/pages/[...slug].astro")).toBe(false);
			expect(routeSetup(i, "src/pages/sitemap.xml.ts")).toBe(false);
			expect(routeSetup(i, "src/pages/about.astro")).toBeUndefined();
			expect(() => resolved(i)).not.toThrow();

			// A previewRoutes entry that names no route: refused, not prerendered.
			const typo = wunderweb({ previewRoutes: ["src/pages/sitemap.ts"] });
			setup(typo, "build");
			routeSetup(typo, "src/pages/[...slug].astro");
			expect(() => resolved(typo)).toThrow(
				/no route for src\/pages\/sitemap.ts/,
			);

			// `astro dev` is never a preview build.
			expect(setup(wunderweb(), "dev")).toEqual([]);
		});
		env({ WUNDERWEB_PREVIEW: undefined }, () => {
			const i = wunderweb({ previewRoutes: ["src/pages/sitemap.xml.ts"] });
			expect(setup(i, "build")).toEqual([]);
			expect(routeSetup(i, "src/pages/sitemap.xml.ts")).toBeUndefined();
			expect(() => resolved(i)).not.toThrow();
		});
	});

	it("allows the hosts of ALLOWED_DEV_ORIGINS in dev, and keeps the dev toolbar", () => {
		env(
			{ ALLOWED_DEV_ORIGINS: "3000--main--ws.example.dev,b.example.dev:8080" },
			() => {
				expect(setup(wunderweb(), "dev")).toEqual([
					{
						server: {
							allowedHosts: ["3000--main--ws.example.dev", "b.example.dev"],
						},
					},
				]);
				// A config allowing every host keeps doing so.
				expect(setup(wunderweb(), "dev", undefined, true)).toEqual([]);
				expect(setup(wunderweb(), "build")).toEqual([]);
			},
		);
		env({ ALLOWED_DEV_ORIGINS: undefined }, () =>
			expect(setup(wunderweb(), "dev")).toEqual([]),
		);
	});

	it("takes only loopback consent test hosts in production", () => {
		expect(consentHosts("localhost, 127.0.0.1, example.com", false)).toEqual([
			"localhost",
			"127.0.0.1",
			"example.com",
		]);
		expect(consentHosts("localhost, example.com", true)).toEqual(["localhost"]);
	});

	it("reads hosts from ALLOWED_DEV_ORIGINS", () => {
		expect(devHosts(undefined)).toEqual([]);
		expect(devHosts(" a.dev , https://b.dev:8443,")).toEqual([
			"a.dev",
			"b.dev",
		]);
	});
});

describe("renderPage", () => {
	const Boom = () => {
		throw new Error("boom");
	};
	const registry = createRegistry<{ Plain: Plain; Boom: { type: "Boom" } }>({
		Plain: ({ block }: BlockProps<Plain>) =>
			createElement("p", null, block.text),
		Boom,
	});
	const blocks = [
		{ type: "Plain", text: "A" },
		{ type: "Boom" },
		{ type: "Plain", text: "B" },
		// Larger than React's progressive chunk size (outlined by default).
		{ type: "Plain", text: "x".repeat(20000) },
	];

	it("renders the page completely, without React's resource hints", async () => {
		const html = await renderPage(
			{
				config,
				breakpoints: ["base"],
				page: sitePage({ blocks: [blocks[0], blocks[2]] } as Partial<SitePage>),
			},
			registry,
		);
		expect(html).toContain('<main class="wc-main">');
		expect(html).toMatch(/<p>A<\/p>.*<p>B<\/p>/s);
		expect(html).not.toContain("<link");
		expect(html).not.toContain("<script");
	});

	it("in edit mode shows a failing block's placeholder and renders the rest", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const html = await renderPage(
			{
				config,
				breakpoints: ["base"],
				page: sitePage({ blocks } as Partial<SitePage>),
				annotate: { revision: 1, editorOrigins: [], findings: {} },
			},
			registry,
		);
		error.mockRestore();
		expect(html).toContain('data-wc-revision="1"');
		expect(html).toMatch(/data-wc-error="" data-block="Boom"/);
		expect(html).toMatch(
			/<p>A<\/p>.*data-block="Boom".*<p>B<\/p>.*<p>x+<\/p>/s,
		);
		// Complete: nothing left to inline scripts.
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<!--$?-->");
		expect(html).not.toContain('hidden id="S:');
	});

	it("renders the first block's background eagerly, without a preload hint", async () => {
		const hero = {
			type: "Plain",
			text: "hero",
			background: { asset: { kind: "image", url: "https://cdn.test/h.webp" } },
		};
		const html = await renderPage(
			{
				config,
				breakpoints: ["base"],
				page: sitePage({ blocks: [hero, hero] } as Partial<SitePage>),
			},
			registry,
		);
		const imgs = html.match(/<img [^>]*>/g) ?? [];
		expect(imgs[0]).toContain('fetchPriority="high"');
		expect(imgs[0]).not.toContain("loading=");
		expect(imgs[1]).toContain('loading="lazy"');
		expect(html).not.toContain("<link");
	});

	it("fails outside edit mode", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			renderPage(
				{
					config,
					breakpoints: ["base"],
					page: sitePage({ blocks } as Partial<SitePage>),
				},
				registry,
			),
		).rejects.toThrow("boom");
		error.mockRestore();
	});
});

describe("responsiveImages", () => {
	const A = "https://cdn.test/a.jpg";
	const media = (url: string) => ({
		type: "Media",
		asset: { kind: "image", url, width: 1, height: 1 },
	});
	type Fail = "none" | "measure" | "resize-once" | "resize";
	/**
	 * astro:assets as Astro's: inferRemoteSize reads the size (respecting
	 * the allowed hosts), getImage makes the srcSet values for `widths`.
	 */
	function fakeAstro(allowed = ["cdn.test"], fail: Fail = "none") {
		const calls: { fn: string; o: unknown }[] = [];
		let resizeFailures = 0;
		const inferRemoteSize = vi.fn(async (url: string) => {
			calls.push({ fn: "inferRemoteSize", o: url });
			if (!allowed.includes(new URL(url).hostname)) {
				const e = new Error(`Remote image ${url} is not allowed`);
				e.name = "RemoteImageNotAllowed";
				throw e;
			}
			if (fail === "measure") {
				throw new Error(`Failed to get the dimensions for ${url}.`);
			}
			return { width: 400, height: 300 };
		});
		const getImage = vi.fn(async (o: Record<string, unknown>) => {
			calls.push({ fn: "getImage", o });
			if (
				fail === "resize" ||
				(fail === "resize-once" && resizeFailures++ === 0)
			) {
				throw new Error("sharp: unsupported image format");
			}
			const [w, h] = [o.width as number, o.height as number];
			const widths = (o.widths as number[] | undefined) ?? [];
			return {
				options: o,
				srcSet: {
					values: widths.map((x) => ({
						url: `/_astro/a_${x}.${String(o.format)}`,
						descriptor: `${x}w`,
						transform: { width: x, height: Math.round(x / (w / h)) },
					})),
				},
			};
		});
		return {
			astro: {
				getImage: getImage as unknown as GetImage,
				inferRemoteSize,
			},
			calls,
		};
	}
	const srcsetOf = (p: SourcePage, i = 0) =>
		(p.page.blocks[i] as unknown as { asset: { srcset?: unknown[] } }).asset
			.srcset;

	it("measures without a transform, makes webp copies at quality 85, original last", async () => {
		const { astro, calls } = fakeAstro();
		const page = sitePage({
			blocks: [media(A), media(A)],
		} as Partial<SitePage>);
		const out = await responsiveImages(
			{ config, breakpoints: [], page },
			astro,
		);
		expect(srcsetOf(out, 1)).toEqual([
			{ url: "/_astro/a_64.webp", width: 64, height: 48 },
			{ url: "/_astro/a_96.webp", width: 96, height: 72 },
			{ url: "/_astro/a_128.webp", width: 128, height: 96 },
			{ url: "/_astro/a_192.webp", width: 192, height: 144 },
			{ url: "/_astro/a_256.webp", width: 256, height: 192 },
			{ url: "/_astro/a_384.webp", width: 384, height: 288 },
			{ url: A, width: 400, height: 300 },
		]);
		// One measure (no getImage transform for it), one getImage for the copies.
		expect(calls.map((c) => c.fn)).toEqual(["inferRemoteSize", "getImage"]);
		expect(calls[1]?.o).toMatchObject({
			src: A,
			width: 400,
			height: 300,
			quality: 85,
			format: "webp",
		});
		expect(calls[1]?.o).not.toHaveProperty("inferSize");
		// Cached across pages of the build.
		await responsiveImages({ config, breakpoints: [], page }, astro);
		expect(calls).toHaveLength(2);
		// The loaded page is not modified.
		expect(JSON.stringify(page)).not.toContain("srcset");
	});

	it("leaves images alone with one warning per reason, each with its own hint", async () => {
		const { astro } = fakeAstro([]);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const page = sitePage({
			blocks: [
				media("https://other.test/a.jpg"),
				media("https://other.test/b.jpg"),
				media("/local.jpg"),
				media("/other.jpg"),
			],
		} as Partial<SitePage>);
		const out = await responsiveImages(
			{ config, breakpoints: [], page },
			astro,
		);
		expect(JSON.stringify(out.page)).not.toContain("srcset");
		const messages = warn.mock.calls.map((c) => String(c[0]));
		expect(messages).toHaveLength(2);
		const remote = messages.find((m) => m.includes("other.test/a.jpg"));
		const local = messages.find((m) => m.includes("/local.jpg"));
		expect(remote).toContain("image.domains");
		expect(local).toContain("only absolute http(s) image urls");
		expect(local).not.toContain("image.domains");
		warn.mockRestore();
	});

	it("a failed measure is not cached and does not point at image.domains", async () => {
		const { astro, calls } = fakeAstro(["cdn.test"], "measure");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const page = sitePage({ blocks: [media(A)] } as Partial<SitePage>);
		const out = await responsiveImages(
			{ config, breakpoints: [], page },
			astro,
		);
		expect(srcsetOf(out)).toBeUndefined();
		expect(String(warn.mock.calls[0]?.[0])).toContain("size could not be read");
		expect(String(warn.mock.calls[0]?.[0])).not.toContain("image.domains");
		await responsiveImages({ config, breakpoints: [], page }, astro);
		expect(calls.filter((c) => c.fn === "inferRemoteSize")).toHaveLength(2);
		warn.mockRestore();
	});

	it("a failed resize keeps the original, warns, and is retried on the next page", async () => {
		const { astro, calls } = fakeAstro(["cdn.test"], "resize-once");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const page = sitePage({ blocks: [media(A)] } as Partial<SitePage>);
		const first = await responsiveImages(
			{ config, breakpoints: [], page },
			astro,
		);
		// Original only: the page renders, the image without srcset copies.
		expect(srcsetOf(first)).toEqual([{ url: A, width: 400, height: 300 }]);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain(
			"could not make the copies",
		);
		const second = await responsiveImages(
			{ config, breakpoints: [], page },
			astro,
		);
		expect(srcsetOf(second)).toHaveLength(7);
		expect(calls.filter((c) => c.fn === "getImage")).toHaveLength(2);
		warn.mockRestore();
	});

	it("returns pages in edit mode untouched", async () => {
		const { astro, calls } = fakeAstro();
		const loaded: SourcePage = {
			config,
			breakpoints: [],
			page: sitePage({ blocks: [media(A)] } as Partial<SitePage>),
			annotate: { revision: 1, editorOrigins: [], findings: {} },
		};
		expect(await responsiveImages(loaded, astro)).toBe(loaded);
		expect(calls).toHaveLength(0);
	});
});
