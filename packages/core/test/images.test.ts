// Responsive images: copy widths and the srcset the loader's pages get from
// an adapter's transformer.

import { describe, expect, it, vi } from "vitest";

import {
	IMAGE_WIDTHS,
	type ImageCandidate,
	type ImageSize,
	type ImageTransformer,
	isRasterImage,
	resolveImages,
	variantWidths,
} from "../src/index.js";

/** Fake transformer: sizes by url, copies named `<url>-<w>.webp`, calls counted. */
function fake(sizes: Record<string, ImageSize>) {
	const calls = { size: 0, resize: [] as string[] };
	const t: ImageTransformer = {
		async size(url) {
			calls.size++;
			return sizes[url];
		},
		async resize(url, size, widths) {
			calls.resize.push(url);
			return widths.map(
				(w): ImageCandidate => ({
					url: `${url}-${w}.webp`,
					width: w,
					height: Math.round((w * size.height) / size.width),
				}),
			);
		},
	};
	return { t, calls };
}

const img = (url: string, extra: Record<string, unknown> = {}) => ({
	kind: "image",
	url,
	width: 1,
	height: 1,
	...extra,
});

interface TestPage {
	locale: string;
	header: unknown[];
	blocks: unknown[];
	footer: unknown[];
	dialogs: Record<string, unknown[]>;
	image?: unknown;
}

function page(blocks: unknown[], rest: Partial<TestPage> = {}): TestPage {
	return {
		locale: "de",
		header: [],
		blocks,
		footer: [],
		dialogs: {},
		...rest,
	};
}

describe("isRasterImage", () => {
	it("jpg, jpeg, png, webp (any case, query ignored); not svg, gif, avif", () => {
		for (const u of [
			"/a.jpg",
			"https://x.test/media/b.JPEG",
			"/c.png?v=1",
			"/d.webp#x",
		]) {
			expect(isRasterImage(u), u).toBe(true);
		}
		for (const u of ["/a.svg", "/b.gif", "/c.avif", "/d", "/jpg"]) {
			expect(isRasterImage(u), u).toBe(false);
		}
	});
});

describe("variantWidths", () => {
	it("every default width below the original's", () => {
		// 701 × 301 (gcd 1): no copy below the original keeps its exact ratio.
		expect(variantWidths({ width: 701, height: 301 })).toEqual([
			64, 96, 128, 192, 256, 384, 512, 640,
		]);
		expect(variantWidths({ width: 64, height: 64 })).toEqual([]);
		expect(variantWidths({ width: 0, height: 10 })).toEqual([]);
	});

	it("moves a width by at most 5% to keep the exact aspect ratio", () => {
		// 600 × 450 (4:3): multiples of 4 keep it; all defaults already are.
		expect(variantWidths({ width: 600, height: 450 })).toEqual([
			64, 96, 128, 192, 256, 384, 512,
		]);
		// 1000 × 700 (10:7): multiples of 10. 64 → 60 is more than 5%; 96 →
		// 100 would step 1.56× from 64.
		const w = variantWidths({ width: 1000, height: 700 });
		expect(w).toEqual([64, 96, 130, 190, 260, 380, 510, 640, 770, 960]);
		for (const x of w.slice(2)) {
			expect(Number.isInteger((x * 700) / 1000), String(x)).toBe(true);
		}
	});

	it("keeps steps at most 1.5×, also to the original, for any size", () => {
		for (let width = 65; width <= 5000; width += 37) {
			for (const ratio of [0.42, 0.75, 1, 4 / 3, 1.5, 2.3]) {
				const height = Math.max(1, Math.round(width / ratio));
				const list = [...variantWidths({ width, height }), width];
				for (let i = 1; i < list.length; i++) {
					const step = (list[i] ?? 0) / (list[i - 1] ?? 1);
					expect(step, `${width}×${height}: ${list}`).toBeLessThanOrEqual(1.5);
					expect(step).toBeGreaterThan(1);
				}
				expect(list[0]).toBeLessThanOrEqual(IMAGE_WIDTHS[0] ?? 0);
			}
		}
	});

	it("takes custom widths", () => {
		expect(variantWidths({ width: 1000, height: 1000 }, [500, 100])).toEqual([
			100, 500,
		]);
	});
});

describe("resolveImages", () => {
	const A = "https://cdn.test/a.jpg";
	const B = "https://cdn.test/b.png";

	it("attaches copies and the original (last, real size) to every raster image", async () => {
		const { t, calls } = fake({
			[A]: { width: 200, height: 100 },
			[B]: { width: 100, height: 100 },
		});
		const input = page(
			[
				{ type: "Media", asset: img(A) },
				{ type: "Gallery", items: [{ asset: img(B) }, { asset: img(A) }] },
			],
			{
				header: [{ type: "Logo", logo: img("/logo.svg") }],
				footer: [{ type: "Media", asset: img(A, { kind: "video" }) }],
				dialogs: { d: [{ type: "Media", asset: img(B) }] },
				image: img(A),
			},
		);
		const out = await resolveImages(input, t);
		const media = out.blocks[0] as { asset: { srcset: ImageCandidate[] } };
		expect(media.asset.srcset).toEqual([
			{ url: `${A}-64.webp`, width: 64, height: 32 },
			{ url: `${A}-96.webp`, width: 96, height: 48 },
			{ url: `${A}-128.webp`, width: 128, height: 64 },
			{ url: `${A}-192.webp`, width: 192, height: 96 },
			{ url: A, width: 200, height: 100 },
		]);
		const dialog = out.dialogs.d?.[0] as { asset: { srcset: unknown[] } };
		expect(dialog.asset.srcset.at(-1)).toEqual({
			url: B,
			width: 100,
			height: 100,
		});
		// Not raster, not an image, outside the rendered regions: untouched.
		expect(out.header).toEqual(input.header);
		expect(out.footer).toEqual(input.footer);
		expect(out.image).toBe(input.image);
		// One measure and one resize per url.
		expect(calls.size).toBe(2);
		expect(calls.resize.sort()).toEqual([A, B]);
		// The input page is not modified.
		expect(JSON.stringify(input)).not.toContain("srcset");
	});

	it("a transformer's `full` url replaces the original as the last candidate", async () => {
		const { t } = fake({ [A]: { width: 200, height: 100 } });
		const calls: [string, ImageSize][] = [];
		const out = await resolveImages(page([{ type: "Media", asset: img(A) }]), {
			...t,
			full(url, size) {
				calls.push([url, size]);
				return `${url}-full.webp`;
			},
		});
		const media = out.blocks[0] as {
			asset: { url: string; srcset: ImageCandidate[] };
		};
		expect(media.asset.srcset.at(-1)).toEqual({
			url: `${A}-full.webp`,
			width: 200,
			height: 100,
		});
		expect(media.asset.srcset).toHaveLength(5);
		// `src` stays the original.
		expect(media.asset.url).toBe(A);
		expect(calls).toEqual([[A, { width: 200, height: 100 }]]);
	});

	it("cover and anchored backgrounds get no copies; contain and fill do", async () => {
		const { t } = fake({ [A]: { width: 200, height: 100 } });
		const bg = (position?: string) => ({
			type: "Section",
			background: { asset: img(A), ...(position ? { position } : {}) },
		});
		const out = await resolveImages(
			page([bg(), bg("cover"), bg("top-left"), bg("contain"), bg("fill")]),
			t,
		);
		const has = out.blocks.map(
			(b) =>
				"srcset" in (b as { background: { asset: object } }).background.asset,
		);
		expect(has).toEqual([false, false, false, true, true]);
	});

	it("with `background`, cover and anchored backgrounds get its url; the first block's cover also a portrait crop", async () => {
		const { t, calls } = fake({ [A]: { width: 200, height: 100 } });
		const server: ImageTransformer = {
			...t,
			full: (url) => `${url}-full`,
			background: (url, _size, crop) =>
				crop ? `${url}-bg-${crop.width}x${crop.height}` : `${url}-bg`,
		};
		type Out = {
			background?: {
				asset: { srcset?: unknown[]; url: string; portrait?: unknown };
			};
			asset?: { srcset?: unknown[] };
		};
		const out = await resolveImages(
			page([
				{ type: "Section", background: { asset: img(A) } },
				{
					type: "Section",
					background: { asset: img(A), position: "top-left" },
				},
				{ type: "Section", background: { asset: img(A) } },
				{ type: "M", asset: img(A) },
			]),
			server,
		);
		const [hero, anchored, later, media] = out.blocks as Out[];
		const bg = [{ url: `${A}-bg`, width: 200, height: 100 }];
		expect(hero?.background?.asset.srcset).toEqual(bg);
		// Full height (100), 3:4: 75 wide.
		expect(hero?.background?.asset.portrait).toEqual({
			url: `${A}-bg-75x100`,
			width: 75,
			height: 100,
		});
		expect(hero?.background?.asset.url).toBe(A);
		expect(anchored?.background?.asset.srcset).toEqual(bg);
		expect(later?.background?.asset.srcset).toEqual(bg);
		// Only the first block's background is the hero.
		expect(later?.background?.asset.portrait).toBeUndefined();
		// The same url elsewhere still gets its copies, resized once.
		expect(media?.asset?.srcset?.length).toBeGreaterThan(1);
		expect(calls.resize).toEqual([A]);
	});

	it("no portrait crop for a hero image already narrower than 3:4; none without `background`", async () => {
		const tall = "https://cdn.test/tall.jpg";
		const { t } = fake({ [tall]: { width: 60, height: 100 } });
		const out = await resolveImages(
			page([{ type: "Section", background: { asset: img(tall) } }]),
			{ ...t, background: (url) => `${url}-bg` },
		);
		const asset = (
			out.blocks[0] as { background: { asset: Record<string, unknown> } }
		).background.asset;
		expect(asset.srcset).toHaveLength(1);
		expect(asset.portrait).toBeUndefined();
		const plain = await resolveImages(
			page([{ type: "Section", background: { asset: img(tall) } }]),
			{ ...t, full: (url) => `${url}-full` },
		);
		expect(
			(plain.blocks[0] as { background: { asset: object } }).background.asset,
		).not.toHaveProperty("srcset");
	});

	it("leaves an image the transformer cannot measure alone", async () => {
		const { t } = fake({});
		const out = await resolveImages(page([{ type: "M", asset: img(A) }]), t);
		expect(out.blocks[0]).toEqual({ type: "M", asset: img(A) });
	});

	it("video posters get the transformer's `poster` url as posterSrc; the original stays", async () => {
		const P = "https://cdn.test/poster.jpg";
		const { t } = fake({ [P]: { width: 1280, height: 720 } });
		const video = {
			type: "M",
			asset: { kind: "video", url: "https://cdn.test/v.mp4", poster: P },
		};
		const out = await resolveImages(page([video]), {
			...t,
			poster: (url, size) => `${url}-${size.width}`,
		});
		const asset = (out.blocks[0] as { asset: Record<string, unknown> }).asset;
		expect(asset.posterSrc).toBe(`${P}-1280`);
		expect(asset.poster).toBe(P);
		expect(asset).not.toHaveProperty("srcset");
		// Without `poster`: untouched.
		const plain = await resolveImages(page([video]), t);
		expect(plain.blocks[0]).toEqual(video);
	});

	it("an image the transformer throws for keeps its original; the others resolve", async () => {
		const C = "https://cdn.test/c.jpg";
		const sizes: Record<string, ImageSize> = {
			[A]: { width: 200, height: 100 },
			[C]: { width: 200, height: 100 },
		};
		const errors: string[] = [];
		let resizes = 0;
		const t: ImageTransformer = {
			async size(url) {
				if (url === B) {
					throw new Error("fetch failed");
				}
				return sizes[url];
			},
			async resize(url, _size, widths) {
				resizes++;
				if (url === C) {
					throw new Error("decode failed");
				}
				return widths.map((w) => ({
					url: `${url}-${w}`,
					width: w,
					height: w / 2,
				}));
			},
		};
		const input = page([
			{ type: "M", asset: img(B) },
			{ type: "M", asset: img(B) },
			{ type: "M", asset: img(C) },
			{ type: "M", asset: img(A) },
		]);
		const out = await resolveImages(input, t, {
			onError: (url, e) => errors.push(`${url}: ${(e as Error).message}`),
		});
		const srcset = (i: number) =>
			(out.blocks[i] as { asset: { srcset?: ImageCandidate[] } }).asset.srcset;
		expect(srcset(0)).toBeUndefined();
		expect(srcset(1)).toBeUndefined();
		expect(srcset(2)).toBeUndefined();
		expect(srcset(3)?.at(-1)).toEqual({ url: A, width: 200, height: 100 });
		// One report per url and failure.
		expect(errors.sort()).toEqual([
			`${B}: fetch failed`,
			`${C}: decode failed`,
		]);
		// Nothing memoized across calls: the next page asks again.
		await resolveImages(input, t, { onError: () => {} });
		expect(resizes).toBe(4);
	});

	it("warns by default when the transformer throws", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const t: ImageTransformer = {
			size: () => Promise.reject(new Error("boom")),
			resize: async () => [],
		};
		const out = await resolveImages(page([{ type: "M", asset: img(A) }]), t);
		expect(out.blocks[0]).toEqual({ type: "M", asset: img(A) });
		expect(String(warn.mock.calls[0]?.[0])).toContain(
			`${A} keeps its original only (boom)`,
		);
		warn.mockRestore();
	});

	it("an image no wider than the smallest width has only the original", async () => {
		const { t, calls } = fake({ [A]: { width: 48, height: 48 } });
		const out = await resolveImages(page([{ type: "M", asset: img(A) }]), t);
		expect(
			(out.blocks[0] as { asset: { srcset: unknown } }).asset.srcset,
		).toEqual([{ url: A, width: 48, height: 48 }]);
		expect(calls.resize).toEqual([]);
	});

	it("uses the widths option", async () => {
		const { t } = fake({ [A]: { width: 1000, height: 500 } });
		const out = await resolveImages(page([{ type: "M", asset: img(A) }]), t, {
			widths: [300],
		});
		const srcset = (out.blocks[0] as { asset: { srcset: ImageCandidate[] } })
			.asset.srcset;
		expect(srcset.map((c) => c.width)).toEqual([300, 1000]);
	});
});
