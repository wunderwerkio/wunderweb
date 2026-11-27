// Responsive images: srcset / sizes for the box an image is drawn in, and
// what the browser picks from it.

import type { ImageCandidate } from "@wunderweb/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
	coverScale,
	createRegistry,
	fullSrcSet,
	type ImageAsset,
	type ImageBox,
	imageSize,
	imageSrcSet,
	MediaElement,
	type MediaOptions,
	Page,
	PORTRAIT_MEDIA,
	posterOf,
	ratioOf,
} from "../src/index.js";

describe("posterOf", () => {
	it("the loader's posterSrc, else the original poster; nothing for images", () => {
		const video = { kind: "video" as const, url: "/v.mp4", poster: "/p.jpg" };
		expect(posterOf(video)).toBe("/p.jpg");
		expect(posterOf({ ...video, posterSrc: "/_img/p" } as never)).toBe(
			"/_img/p",
		);
		expect(posterOf({ kind: "image", url: "/a.jpg" })).toBeUndefined();
		expect(
			renderToStaticMarkup(
				<MediaElement
					block={{ asset: { ...video, posterSrc: "/_img/p" } as never }}
				/>,
			),
		).toContain('poster="/_img/p"');
	});
});

/** Copies at `widths` of a `w` × `h` original (height rounded, as Astro / sharp). */
function asset(w: number, h: number, widths: number[]): ImageAsset {
	const url = "/o.jpg";
	const srcset: ImageCandidate[] = [
		...widths.map((x) => ({
			url: `/c-${x}.webp`,
			width: x,
			height: Math.round((x * h) / w),
		})),
		{ url, width: w, height: h },
	];
	return { kind: "image", url, width: w, height: h, srcset };
}

const WIDTHS = [64, 96, 128, 192, 256, 384, 512, 640, 768, 960, 1280, 1600];

/** Chrome's pick (stable): the smallest density ≥ DPR, else the largest. */
function pick(srcSet: string, sizePx: number, dpr: number): string {
	const list = srcSet
		.split(", ")
		.map((s) => {
			const [url = "", w = ""] = s.split(" ");
			return { url, density: Number.parseInt(w, 10) / sizePx };
		})
		.sort((a, b) => a.density - b.density);
	return (list.find((c) => c.density >= dpr) ?? list.at(-1))?.url ?? "";
}

describe("imageSrcSet", () => {
	it("nothing without copies or for non-images", () => {
		expect(
			imageSrcSet({ kind: "image", url: "/a.jpg" }, { width: 50 }),
		).toEqual({});
		const a = asset(600, 600, [64]);
		expect(imageSrcSet({ ...a, kind: "video" }, { width: 50 })).toEqual({});
	});

	it("fixed width: one candidate per density 1, 1.5, 2, 3 plus the original", () => {
		const a = asset(1200, 900, WIDTHS);
		expect(imageSrcSet(a, { width: 100, height: 75, fit: "fill" })).toEqual({
			srcSet:
				"/c-128.webp 128w, /c-192.webp 192w, /c-256.webp 256w, /c-384.webp 384w, /o.jpg 1200w",
			sizes: "100px",
		});
	});

	it("no srcSet when only the original remains", () => {
		const a = asset(120, 80, [48]);
		// Drawn 60 px wide (40 px high, width from the image): 48 is below 1×.
		expect(imageSrcSet(a, { height: 40 })).toEqual({});
	});

	it("cover: descriptors divided by how much wider the image is drawn", () => {
		// 4:3 in a 48 px square: drawn 64 px wide.
		const a = asset(800, 600, [64, 256]);
		expect(coverScale(a.srcset?.[0] as ImageCandidate, 1)).toBeCloseTo(4 / 3);
		expect(imageSrcSet(a, { width: 48, height: 48, fit: "cover" })).toEqual({
			srcSet: "/c-64.webp 48w, /c-256.webp 192w, /o.jpg 600w",
			sizes: "48px",
		});
		// Portrait in a square: the width limits it, scale 1.
		const p = asset(600, 800, [64]);
		expect(imageSrcSet(p, { width: 48, height: 48, fit: "cover" }).srcSet).toBe(
			"/c-64.webp 64w, /o.jpg 600w",
		);
	});

	it("cover with an unknown box shape: no srcSet", () => {
		const a = asset(800, 600, WIDTHS);
		expect(imageSrcSet(a, { fit: "cover" })).toEqual({});
		expect(imageSrcSet(a, { width: 300, fit: "cover" })).toEqual({});
	});

	it("unknown width: sizes auto with every candidate", () => {
		const a = asset(400, 300, [64, 96, 128, 192, 256, 384]);
		expect(imageSrcSet(a, { fit: "contain" })).toEqual({
			srcSet:
				"/c-64.webp 64w, /c-96.webp 96w, /c-128.webp 128w, /c-192.webp 192w, /c-256.webp 256w, /c-384.webp 384w, /o.jpg 400w",
			sizes: "auto, 100vw",
		});
		// 16:9 crop of a 4:3 image: drawn 4/3 / (16/9) … the height limits, scale 1;
		// a 2:1 image in a 1:1 crop is drawn twice as wide.
		const wide = asset(400, 200, [64, 128]);
		expect(imageSrcSet(wide, { ratio: 1, fit: "cover" }).srcSet).toBe(
			"/c-64.webp 32w, /c-128.webp 64w, /o.jpg 200w",
		);
	});

	it("box shaped by the image: only copies of the exact ratio", () => {
		// 600 × 718: 64 → 76.58 (not exact), 300 → 359 (exact).
		const a = asset(600, 718, [64, 300]);
		expect(ratioOf(imageSize(a) ?? { width: 1, height: 1 })).toBeCloseTo(
			600 / 718,
		);
		expect(imageSrcSet(a, {})).toEqual({
			srcSet: "/c-300.webp 300w, /o.jpg 600w",
			sizes: "auto, 100vw",
		});
		// Height fixed, width from the image: S = 80 × 600 / 718.
		expect(imageSrcSet(a, { height: 80 })).toEqual({
			srcSet: "/c-300.webp 300w, /o.jpg 600w",
			sizes: "66.86px",
		});
		// With a fit the box shape is fixed: any copy.
		expect(
			imageSrcSet(a, { width: 40, height: 40, fit: "cover" }).srcSet,
		).toContain("/c-64.webp");
	});

	it("never lets the browser pick less than drawn width × DPR (DPR 1-4, 16 and 20px fonts)", () => {
		// Box and the CSS px an image candidate is drawn at in it, at a font size.
		type Drawn = (c: ImageCandidate, font: number) => number;
		const boxes: [ImageBox, Drawn][] = [];
		for (const s of [24, 38, 48, 56, 145, 300, 551]) {
			boxes.push([{ width: s, height: s, fit: "fill" }, () => s]);
			boxes.push([
				{ width: s, height: s, fit: "cover" },
				(c) => s * coverScale(c, 1),
			]);
			boxes.push([{ width: s }, () => s]);
			boxes.push([{ height: s }, (c) => s * ratioOf(c)]);
			// The same boxes in rem (Tailwind size-*, h-*): they grow with the font.
			const r = s / 16;
			boxes.push([
				{ width: r, height: r, fit: "cover", unit: "rem" },
				(c, font) => r * font * coverScale(c, 1),
			]);
			boxes.push([
				{ height: r, unit: "rem" },
				(c, font) => r * font * ratioOf(c),
			]);
		}
		let checked = 0;
		for (const [w, h] of [
			[600, 718],
			[700, 700],
			[1200, 900],
			[896, 1193],
			[4000, 1741],
			[299, 135],
		] as const) {
			const a = asset(
				w,
				h,
				WIDTHS.filter((x) => x < w),
			);
			for (const [box, drawn] of boxes) {
				const { srcSet, sizes } = imageSrcSet(a, box);
				if (!srcSet || !sizes) {
					continue;
				}
				for (const font of [16, 20]) {
					// The browser resolves rem in sizes against the default font size.
					const size =
						Number.parseFloat(sizes) * (sizes.endsWith("rem") ? font : 1);
					for (let dpr = 1; dpr <= 4.0001; dpr += 0.05) {
						const url = pick(srcSet, size, dpr);
						const c = a.srcset?.find((x) => x.url === url) as ImageCandidate;
						const need = drawn(c, font) * dpr;
						checked++;
						expect(
							c.width >= Math.min(w, need - 1e-6),
							`${w}×${h} ${JSON.stringify(box)} font ${font} dpr ${dpr.toFixed(2)}: ${url} (${c.width}) < ${need}`,
						).toBe(true);
					}
				}
				// The original is the widest candidate.
				expect(srcSet.split(", ").at(-1)?.startsWith("/o.jpg ")).toBe(true);
			}
		}
		expect(checked).toBeGreaterThan(10000);
	});

	it("rem boxes: sizes in rem, candidates for a 20px default font too", () => {
		const a = asset(
			600,
			600,
			WIDTHS.filter((x) => x < 600),
		);
		// size-14: 3.5rem = 56px at 16px, 70px at 20px.
		expect(
			imageSrcSet(a, { width: 3.5, height: 3.5, fit: "cover", unit: "rem" }),
		).toEqual({
			srcSet:
				"/c-64.webp 64w, /c-96.webp 96w, /c-128.webp 128w, /c-192.webp 192w, /c-256.webp 256w, /o.jpg 600w",
			sizes: "3.5rem",
		});
		// The same box in px: no candidate for the larger font.
		expect(imageSrcSet(a, { width: 56, height: 56, fit: "cover" }).srcSet).toBe(
			"/c-64.webp 64w, /c-96.webp 96w, /c-128.webp 128w, /c-192.webp 192w, /o.jpg 600w",
		);
	});

	it("eager images get no sizes auto", () => {
		const a = asset(400, 300, [64, 128]);
		expect(imageSrcSet(a, { fit: "contain" }, { eager: true }).sizes).toBe(
			"100vw",
		);
		expect(imageSrcSet(a, { fit: "contain" }).sizes).toBe("auto, 100vw");
	});
});

describe("MediaElement", () => {
	const a = asset(1200, 900, [64, 128, 640]);
	const render = (o: Partial<MediaOptions>) =>
		renderToStaticMarkup(<MediaElement block={{ asset: a, ...o }} />);

	it("natural size: sizes auto, the original stays src", () => {
		const out = render({});
		expect(out).toContain('src="/o.jpg"');
		expect(out).toContain(
			'srcSet="/c-64.webp 64w, /c-128.webp 128w, /c-640.webp 640w, /o.jpg 1200w"',
		);
		expect(out).toContain('sizes="auto, 100vw"');
		expect(out).toContain('loading="lazy"');
	});

	it("16:9 cover crop of a 4:3 image: scale 1; fill (unknown shape) cover: none", () => {
		expect(render({ aspectRatio: "16:9" })).toContain("/c-640.webp 640w");
		expect(render({ aspectRatio: "1:1" })).toContain("/c-640.webp 480w");
		expect(render({ fill: true })).not.toContain("srcSet");
		expect(render({ fill: true, fit: "contain" })).toContain("srcSet");
	});

	it("fill cover with an image server's full candidate: that one at 1x, not for a WebP source", () => {
		const served = (url: string): ImageAsset => ({
			kind: "image",
			url,
			width: 1200,
			height: 900,
			srcset: [
				{ url: "/_img/640", width: 640, height: 480 },
				{ url: "/_img/full", width: 1200, height: 900 },
			],
		});
		const fill = (a: ImageAsset) =>
			renderToStaticMarkup(<MediaElement block={{ asset: a, fill: true }} />);
		expect(fill(served("/o.jpg"))).toContain('srcSet="/_img/full 1x"');
		expect(fill(served("/o.webp"))).not.toContain("srcSet");
	});
});

describe("backgrounds", () => {
	const registry = createRegistry<{ Box: { type: "Box" } }>({
		Box: () => null,
	});
	const render = (blocks: unknown[]) =>
		renderToStaticMarkup(
			<Page
				page={
					{
						locale: "de",
						alternates: {},
						homes: { de: "/" },
						header: [],
						footer: [],
						blocks,
					} as never
				}
				registry={registry}
				breakpoints={["base"]}
			/>,
		).match(/<img [^>]*>/g) ?? [];
	const bg = (position: string) => ({
		type: "Box",
		background: { asset: asset(400, 300, [64, 128]), position },
	});

	it("contain / fill get the copies; the eager first one without sizes auto", () => {
		const imgs = render([bg("contain"), bg("fill"), bg("cover")]);
		expect(imgs).toHaveLength(3);
		const [first, second, cover] = imgs;
		expect(first).toContain('fetchPriority="high"');
		expect(first).toContain('sizes="100vw"');
		expect(second).toContain('loading="lazy"');
		expect(second).toContain('sizes="auto, 100vw"');
		expect(cover).not.toContain("srcSet");
	});

	it("cover / anchored with only an image server's full candidate: that one at 1x", () => {
		const full = (position: string) => ({
			type: "Box",
			background: {
				asset: {
					kind: "image",
					url: "/o.jpg",
					width: 400,
					height: 300,
					srcset: [{ url: "/_img/full", width: 400, height: 300 }],
				},
				position,
			},
		});
		const [cover, anchored] = render([full("cover"), full("top-left")]);
		expect(cover).toContain('srcSet="/_img/full 1x"');
		expect(cover).toContain('src="/o.jpg"');
		expect(cover).not.toContain("sizes");
		expect(anchored).toContain('srcSet="/_img/full 1x"');
	});

	it("a cover background with a portrait crop: a picture whose source serves upright phones", () => {
		const hero = (position: string, parallax = false) => ({
			type: "Box",
			background: {
				asset: {
					kind: "image",
					url: "/o.jpg",
					width: 400,
					height: 300,
					srcset: [{ url: "/_img/bg", width: 400, height: 300 }],
					portrait: { url: "/_img/crop", width: 225, height: 300 },
				},
				position,
				parallax,
			},
		});
		const html = (blocks: unknown[]) =>
			renderToStaticMarkup(
				<Page
					page={
						{
							locale: "de",
							alternates: {},
							homes: { de: "/" },
							header: [],
							footer: [],
							blocks,
						} as never
					}
					registry={createRegistry<{ Box: { type: "Box" } }>({
						Box: () => null,
					})}
					breakpoints={["base"]}
				/>,
			);
		const out = html([hero("cover")]);
		expect(out).toMatch(
			new RegExp(
				`<picture><source media="${PORTRAIT_MEDIA.replace(/[()]/g, "\\$&")}" srcSet="/_img/crop 1x"/><img [^>]*srcSet="/_img/bg 1x"[^>]*></picture>`,
			),
		);
		expect(out).toContain('fetchPriority="high"');
		// Anchored (natural size) or parallax (a taller layer): no crop.
		expect(html([hero("top-left")])).not.toContain("<picture>");
		expect(html([hero("cover", true)])).not.toContain("<picture>");
	});
});

describe("fullSrcSet", () => {
	it("the full candidate at 1x; nothing when it is the original or absent", () => {
		const a = asset(400, 300, [64]);
		expect(fullSrcSet(a)).toEqual({});
		expect(fullSrcSet({ kind: "image", url: "/o.jpg" })).toEqual({});
		const srcset = [{ url: "/_img/full", width: 400, height: 300 }];
		expect(fullSrcSet({ kind: "image", url: "/o.jpg", srcset })).toEqual({
			srcSet: "/_img/full 1x",
		});
		expect(fullSrcSet({ kind: "video", url: "/o.mp4", srcset })).toEqual({});
	});
});
