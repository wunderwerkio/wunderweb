// Registry items rendered from their templates through the public registry
// API, and every page of the example sites (their installed blocks).

import { join } from "node:path";

import {
	buildSite,
	compileProject,
	loadProject,
	readContent,
	type SitePage,
	Validator,
} from "@wunderweb/core";
import {
	type Components,
	createRegistry,
	Page,
	type Registry,
} from "@wunderweb/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { components } from "../generated/components";

const EXAMPLES = join(import.meta.dirname, "..", "..", "examples");
const BPS = ["base", "md", "lg"];
const registry = createRegistry(components);

function html(
	blocks: unknown[],
	opts: { dialogs?: Record<string, unknown[]>; reg?: Registry } = {},
): string {
	const page = {
		locale: "de",
		alternates: {},
		homes: { de: "/" },
		header: [],
		footer: [],
		blocks,
		dialogs: opts.dialogs,
	} as never;
	return renderToStaticMarkup(
		<Page page={page} registry={opts.reg ?? registry} breakpoints={BPS} />,
	);
}

describe("layout blocks", () => {
	it("Section: rows in a <section> box", () => {
		const out = html([
			{ type: "Section", blocks: [{ type: "Text", body: "<p>x</p>" }] },
		]);
		expect(out).toMatch(
			/^<main class="wc-main"><section class="wc-block wc-Section/,
		);
	});

	it("SideBySide: 24-column ratio, reverse per breakpoint, stacked on mobile", () => {
		const out = html([
			{
				type: "SideBySide",
				start: { type: "Text", body: "<p>a</p>" },
				end: { type: "Text", body: "<p>b</p>" },
				split: {
					ratio: { md: "7:5" },
					gap: { base: 4 },
					reverse: { lg: true },
				},
			},
		]);
		for (const c of [
			"grid-cols-1",
			"md:grid-cols-12",
			"md:col-span-7",
			"md:col-span-5",
			"lg:order-2",
			"lg:order-1",
			"gap-4",
		]) {
			expect(out).toContain(c);
		}
		// DOM order stays start, end (mobile stacking and reading order).
		expect(out.indexOf("<p>a</p>")).toBeLessThan(out.indexOf("<p>b</p>"));
	});

	it("Tiles: grid spans, flex, masonry, visibility", () => {
		const grid = html([
			{
				type: "Tiles",
				grid: {
					columns: { base: 1, md: 4 },
					visible: { base: false, lg: true },
				},
				items: [
					{
						type: "Text",
						body: "<p>x</p>",
						place: { colSpan: { md: 2 }, rowSpan: { md: 3 } },
					},
				],
			},
		]);
		for (const c of [
			"grid",
			"md:grid-cols-4",
			"md:col-span-2",
			"md:row-span-3",
			"hidden",
			"lg:grid",
		]) {
			expect(grid).toContain(c);
		}
		const masonry = html([
			{
				type: "Tiles",
				grid: { mode: "masonry", columns: { md: 3 }, gap: { base: 4 } },
				items: [{ type: "Text", body: "<p>x</p>" }],
			},
		]);
		expect(masonry).toContain("md:columns-3");
		expect(masonry).toContain("*:mb-4");
	});

	it("Timeline: markers alternate sides", () => {
		const out = html([
			{
				type: "Timeline",
				lineColor: "brand",
				items: [
					{ type: "Text", body: "<p>1</p>" },
					{ type: "Text", body: "<p>2</p>" },
				],
			},
		]);
		expect(out).toContain("wc-timeline");
		expect(out).toContain("md:col-start-3");
		expect(out).toContain("md:col-start-1 md:text-end");
		expect(out).toMatch(/wc-marker[^>]*>1</);
	});

	it("Timeline: gap spaces the items, icon markers", () => {
		const out = html([
			{
				type: "Timeline",
				gap: { base: 4, md: 8 },
				marker: "icon",
				markerIcon: '<svg viewBox="0 0 1 1"></svg>',
				mirror: false,
				items: [
					{ type: "Text", body: "<p>1</p>" },
					{ type: "Text", body: "<p>2</p>" },
				],
			},
		]);
		const ol = out.match(/<ol class="([^"]*)"/)?.[1] ?? "";

		// gap only works on a flex / grid container, not a block one.
		expect(ol).toContain("flex flex-col");
		expect(ol).toContain("md:gap-8");
		expect(out).toContain('<svg viewBox="0 0 1 1"></svg>');
		expect(out).not.toContain("md:text-end");
	});
});

describe("leaves", () => {
	it("Card: media bleeds over the padding, forced alignment", () => {
		const out = html([
			{
				type: "Card",
				body: "<p class='text-align-center'>x</p>",
				textAlign: { base: "start", md: "inherit" },
				layout: { padding: { base: { top: 4, left: 4, right: 4 } } },
				media: { type: "Media", asset: { kind: "image", url: "/a.jpg" } },
			},
		]);
		expect(out).toContain("-mt-4 -ml-4 -mr-4");
		expect(out).toContain("wc-force-align text-start");
		expect(out).toContain("md:wc-align-inherit");
	});

	it("Card: icon beside the body per breakpoint", () => {
		const out = html([
			{
				type: "Card",
				body: "<p>x</p>",
				icon: { text: "1" },
				iconPlacement: { base: "start", md: "top" },
			},
		]);
		expect(out).toContain(
			"wc-card-icon flex gap-3 flex-row items-start md:flex-col",
		);
	});

	it("Media: remote video embeds, aspect ratio crops, link wraps the media", () => {
		const out = html([
			{
				type: "Media",
				asset: {
					kind: "remote-video",
					url: "https://www.youtube.com/watch?v=2oV060kNYfU",
				},
				aspectRatio: "16:9",
			},
			{
				type: "Media",
				asset: { kind: "image", url: "/a.jpg" },
				link: { url: "/x" },
			},
		]);
		expect(out).toContain("https://www.youtube-nocookie.com/embed/2oV060kNYfU");
		expect(out).toContain("aspect-ratio:16 / 9");
		expect(out).toContain(
			'<a href="/x" class="block h-full"><div class="wc-media',
		);
		expect(out).not.toContain("absolute inset-0 z-20");
	});

	it("Gallery marquee: gap spaces the items", () => {
		const img = { asset: { kind: "image", url: "/a.png" } };
		const out = html([
			{
				type: "Gallery",
				mode: "marquee",
				gap: { base: 10, md: 20 },
				items: [img, img],
			},
		]);
		const track = out.match(/<ul class="(wc-marquee-track[^"]*)"/)?.[1] ?? "";

		expect(track).toContain("gap-10");
		expect(track).toContain("md:gap-20");
		expect(track).not.toContain("gap-6");
	});

	it("responsive images: Person, Gallery, Rating pick from the copies for their box", () => {
		const copy = (url: string, width: number, height: number) => ({
			url,
			width,
			height,
		});
		// 4:3 avatar in the 3rem (48px) cover box: drawn 4rem (64px) wide.
		const avatar = {
			kind: "image",
			url: "/p.jpg",
			width: 800,
			height: 600,
			srcset: [
				copy("/p-32.webp", 32, 24),
				copy("/p-64.webp", 64, 48),
				copy("/p-256.webp", 256, 192),
				copy("/p.jpg", 800, 600),
			],
		};
		// 3:2 logo: 40 px high marquee item, 60 px wide; its copy is below 1×.
		const logo = {
			kind: "image",
			url: "/l.png",
			width: 300,
			height: 200,
			srcset: [copy("/l-48.webp", 48, 32), copy("/l.png", 300, 200)],
		};
		// 2:1 rating logo, 1.5rem high (3rem wide); copies of the exact ratio.
		const badge = {
			kind: "image",
			url: "/g.png",
			width: 400,
			height: 200,
			srcset: [
				copy("/g-64.webp", 64, 32),
				copy("/g-96.webp", 96, 48),
				copy("/g-130.webp", 130, 66),
				copy("/g-192.webp", 192, 96),
				copy("/g.png", 400, 200),
			],
		};
		// Square photo for a circle marquee: copies of the exact ratio.
		const photo = {
			kind: "image",
			url: "/f.jpg",
			width: 300,
			height: 300,
			srcset: [
				copy("/f-64.webp", 64, 64),
				copy("/f-128.webp", 128, 128),
				copy("/f-192.webp", 192, 192),
				copy("/f-256.webp", 256, 256),
				copy("/f.jpg", 300, 300),
			],
		};
		/** The <img> elements of one block, rendered alone. */
		const imgsOf = (block: Record<string, unknown>) =>
			html([block]).match(/<img [^>]*>/g) ?? [];

		// Person: h-12 w-12 is 3rem; candidates also for a 20px default font.
		const person = imgsOf({ type: "Person", name: "Ann", avatars: [avatar] });
		expect(person).toHaveLength(1);
		expect(person[0]).toContain(
			'srcSet="/p-64.webp 48w, /p-256.webp 192w, /p.jpg 600w" sizes="3rem"',
		);
		expect(person[0]).toContain('src="/p.jpg"');

		// Marquee: 40px high, 60px wide; the only copy is below 1×.
		const marquee = imgsOf({
			type: "Gallery",
			mode: "marquee",
			itemHeight: 40,
			items: [{ asset: logo }],
		});
		expect(marquee.length).toBeGreaterThan(0);
		for (const img of marquee) {
			expect(img).toContain('src="/l.png"');
			expect(img).not.toContain("srcSet");
		}

		// Circle marquee: `!w-auto` draws it 80px high at the image's ratio.
		const circles = imgsOf({
			type: "Gallery",
			mode: "marquee",
			shape: "circle",
			itemHeight: 80,
			items: [{ asset: photo }],
		});
		expect(circles.length).toBeGreaterThan(0);
		for (const img of circles) {
			expect(img).toContain(
				'srcSet="/f-128.webp 128w, /f-192.webp 192w, /f-256.webp 256w, /f.jpg 300w" sizes="80px"',
			);
		}

		// Grid: column width unknown; the 130 copy (130 × 66) is not 2:1.
		const grid = imgsOf({ type: "Gallery", items: [{ asset: badge }] });
		expect(grid).toHaveLength(1);
		expect(grid[0]).toContain(
			'srcSet="/g-64.webp 64w, /g-96.webp 96w, /g-192.webp 192w, /g.png 400w" sizes="auto, 100vw"',
		);

		// Grid with a 1:1 crop of a 2:1 image: drawn twice as wide as the cell.
		const wide = {
			...badge,
			srcset: badge.srcset.filter((c) => c.url !== "/g-130.webp"),
		};
		const cropped = imgsOf({
			type: "Gallery",
			aspectRatio: "1:1",
			items: [{ asset: wide }],
		});
		expect(cropped).toHaveLength(1);
		expect(cropped[0]).toContain(
			'srcSet="/g-64.webp 32w, /g-96.webp 48w, /g-192.webp 96w, /g.png 200w" sizes="auto, 100vw"',
		);

		// Rating: h-6 (1.5rem) high, as wide as the 2:1 logo: 3rem.
		const rating = imgsOf({ type: "Rating", value: 5, logo: badge });
		expect(rating).toHaveLength(1);
		expect(rating[0]).toContain(
			'srcSet="/g-64.webp 64w, /g-96.webp 96w, /g-192.webp 192w, /g.png 400w" sizes="3rem"',
		);
	});

	it("Buttons: flat box, button opens a dialog fragment", () => {
		const out = html(
			[{ type: "Buttons", items: [{ label: "Kosten", opens: "form" }] }],
			{ dialogs: { form: [{ type: "Text", body: "<p>dialog</p>" }] } },
		);
		expect(out).toMatch(
			/<div class="wc-block wc-Buttons relative" data-block="Buttons"><div class="wc-buttons/,
		);
		expect(out.toLowerCase()).toContain('popovertarget="wc-dialog-form"');
		expect(out).toContain('id="wc-dialog-form" popover="auto"');
		expect(out).toContain("<p>dialog</p>");
	});

	it("List, Accordion, Badge, Divider, Person, Rating, IconBlock render", () => {
		const out = html([
			{
				type: "List",
				marker: "check",
				items: [{ title: "a" }, { body: "<p>b</p>" }],
			},
			{
				type: "Accordion",
				icon: "plus",
				items: [{ title: "q", body: "<p>a</p>" }],
			},
			{ type: "Badge", text: "new" },
			{ type: "Divider", style: "dashed" },
			{ type: "Person", name: "Ann", rating: 4 },
			{ type: "Rating", value: 5, label: "Google" },
			{ type: "IconBlock", icon: { text: "↓" } },
		]);
		for (const s of [
			"wc-list",
			"✓",
			"wc-accordion",
			">+<",
			"wc-badge",
			"border-dashed",
			"wc-person",
			'aria-label="4 / 5"',
			"wc-rating-label",
			"wc-icon",
		]) {
			expect(out).toContain(s);
		}
	});
});

describe("examples render", () => {
	// examples/astro has an async block (Feed): its build renders it.
	for (const name of ["astro-kit"]) {
		it(`${name}: every page renders with its installed blocks`, async () => {
			const project = loadProject(join(EXAMPLES, name));
			const { schema } = compileProject(project);
			const site = buildSite(
				new Validator(schema),
				readContent(project),
				project.config,
			);
			// Computed path: the example's own components are type-checked in the example.
			const map = join(project.generatedDir, "components.ts");
			const mod = (await import(map)) as { components: Components<object> };
			const reg = createRegistry(mod.components);

			for (const page of site.pages as SitePage[]) {
				const out = renderToStaticMarkup(
					<Page
						page={page as never}
						registry={reg}
						breakpoints={["base", "sm", "md", "lg", "xl", "2xl"]}
					/>,
				);
				expect(out.length, page.url).toBeGreaterThan(200);
				// Ids are unique on the rendered page: dialogs render once and
				// never repeat an anchor of the page.
				const ids = [...out.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
				const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
				expect(dup, page.url).toEqual([]);
			}
		});
	}
});
