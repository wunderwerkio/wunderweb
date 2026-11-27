// Responsive images: smaller copies of the raster images a page renders,
// made by an adapter's transformer (e.g. Astro's getImage) at build time.
//
//   resolveImages(page, transformer)
//     every jpg / png / webp image Asset of header, blocks, footer, dialogs
//     → asset.srcset: [copy 64w, copy 96w, …, original]   (ascending)
//
// The original is always the last candidate, at its real size: a component
// that picks from the list (react `imageSrcSet`) can always fall back to it.
// A transformer with `full` (an image server, ADR 0007) gives that candidate
// its own url, e.g. the original converted to AVIF / WebP; `src` stays the
// original.
// Copy widths come from IMAGE_WIDTHS (each step at most 1.5×); where a
// nearby width keeps the original's exact aspect ratio, that width is used,
// so layouts whose height follows the image do not shift by a sub-pixel.
//
// Cover backgrounds (and anchored ones, drawn at natural size) get no
// copies: how wide a cover image is drawn depends on the box height, which
// only the layout knows. A transformer with `background` (an image server)
// gives them one candidate at full size, typically at a lower quality, as
// they sit under overlays. The page's first block (the hero, often the LCP
// image) also gets `portrait`: the center crop at full height and
// PORTRAIT_RATIO, which a tall box on a portrait phone shows identically
// (cover draws a wide image by its height and centers it), so phones skip
// the sides they never see.

import { isPlain } from "./plain.js";

/** Pixel size of an image. */
export interface ImageSize {
	width: number;
	height: number;
}

/** One entry of an image's srcset: a copy (or the original) and its pixel size. */
export interface ImageCandidate extends ImageSize {
	url: string;
}

/** Measures and resizes images; implemented by an adapter (e.g. Astro's getImage). */
export interface ImageTransformer {
	/** Real pixel size of the image at `url`; undefined leaves the image alone. */
	size(url: string): Promise<ImageSize | undefined>;
	/**
	 * Copies of the image at these widths (each below `size.width`), height
	 * in ratio, rounded. Returned in the order of `widths`; may be fewer.
	 */
	resize(
		url: string,
		size: ImageSize,
		widths: readonly number[],
	): Promise<ImageCandidate[]>;
	/**
	 * Url of the last srcset candidate, at the original's full size: e.g. the
	 * original converted to a smaller format by an image server. Default: the
	 * original's url. The Asset's own `url` (the img `src`) stays the
	 * original either way.
	 */
	full?(url: string, size: ImageSize): string;
	/**
	 * Url of a cover or anchored background: the image at full size, or its
	 * center `crop` (pixels, full height), e.g. converted at a lower quality.
	 * Without it backgrounds keep their original only.
	 */
	background?(url: string, size: ImageSize, crop?: ImageSize): string;
	/**
	 * Url of a video's poster image (one url: `<video poster>` takes no
	 * srcset), e.g. converted and capped in width. Video Assets get it as
	 * `posterSrc`; their `poster` stays the original.
	 */
	poster?(url: string, size: ImageSize): string;
}

/** Width / height of the first block's portrait crop: a phone's tall hero box shows at most this. */
export const PORTRAIT_RATIO = 3 / 4;

export interface ImageOptions {
	/** Copy widths to choose from, ascending. Default IMAGE_WIDTHS. */
	widths?: readonly number[] | undefined;
	/**
	 * Called when the transformer throws for an image (it keeps its original
	 * only). Default: a console warning.
	 */
	onError?: ((url: string, error: unknown) => void) | undefined;
}

/** Default copy widths in px: phone avatars to 4K screens, each step at most 1.5×. */
export const IMAGE_WIDTHS: readonly number[] = [
	64, 96, 128, 192, 256, 384, 512, 640, 768, 960, 1280, 1600, 1920, 2560, 3840,
];

/** Largest step between neighbouring widths. */
const MAX_STEP = 1.5;
/** How far a width may move to keep the original's exact aspect ratio. */
const RATIO_TOLERANCE = 0.05;
const RASTER = /\.(jpe?g|png|webp)$/i;

/** Whether a url names a raster image the transformers handle (jpg, png, webp). */
export function isRasterImage(url: string): boolean {
	return RASTER.test(url.replace(/[?#].*$/, ""));
}

/**
 * Copy widths for an image of `size`: every width below the original's.
 * A width moves (by at most 5%) to one whose copy keeps the original's
 * exact aspect ratio when the steps stay at most 1.5× (also to the original).
 */
export function variantWidths(
	size: ImageSize,
	widths: readonly number[] = IMAGE_WIDTHS,
): number[] {
	const { width: w, height: h } = size;
	if (!(w > 0 && h > 0)) {
		return [];
	}
	// Copies of exact ratio: widths that are multiples of w / gcd(w, h).
	const step = w / gcd(w, h);
	const targets = [...new Set(widths)]
		.filter((t) => t > 0 && t < w)
		.sort((a, b) => a - b);
	const out: number[] = [];
	targets.forEach((t, i) => {
		const prev = out.at(-1) ?? 0;
		const next = targets[i + 1] ?? w;
		const exact = Math.round(t / step) * step;
		const fits =
			exact > prev &&
			exact < w &&
			Math.abs(exact - t) <= t * RATIO_TOLERANCE &&
			(prev === 0 || exact / prev <= MAX_STEP) &&
			next / exact <= MAX_STEP;
		const chosen = fits ? exact : t;
		if (chosen > prev) {
			out.push(chosen);
		}
	});
	return out;
}

/**
 * The page with a `srcset` on every raster image Asset it renders (header,
 * blocks, footer, dialogs): copies from the transformer, the original last.
 * The page is not modified; its regions are copied. Images the transformer
 * cannot measure or throws for (`opts.onError`) are left alone. Cover and
 * anchored backgrounds get the transformer's `background` url as their only
 * candidate, the first block's also `portrait`; without `background` they
 * are left alone.
 */
export async function resolveImages<
	P extends {
		header: unknown[];
		blocks: unknown[];
		footer: unknown[];
		dialogs?: Record<string, unknown[]> | undefined;
	},
>(page: P, transformer: ImageTransformer, opts: ImageOptions = {}): Promise<P> {
	const regions = structuredClone({
		header: page.header,
		blocks: page.blocks,
		footer: page.footer,
		dialogs: page.dialogs,
	});
	const assets: Collected[] = [];
	collect(regions, undefined, undefined, assets);
	const hero = firstBackground(regions.blocks);

	const byUrl = new Map<string, Promise<ImageCandidate[] | undefined>>();
	await Promise.all(
		assets.map(async ({ asset, background, poster }) => {
			if (poster) {
				await resolvePoster(asset, transformer, opts);
				return;
			}
			const url = String(asset.url);
			if (background) {
				if (transformer.background) {
					await resolveBackground(asset, transformer, opts, asset === hero);
				}
				return;
			}
			let srcset = byUrl.get(url);
			if (!srcset) {
				srcset = candidatesOf(url, transformer, opts);
				byUrl.set(url, srcset);
			}
			const list = await srcset;
			if (list) {
				asset.srcset = list;
			}
		}),
	);

	const { dialogs, ...rest } = regions;
	return { ...page, ...rest, ...(dialogs === undefined ? {} : { dialogs }) };
}

/** A video's `posterSrc` from the transformer's `poster`; left alone without it, unmeasured or on error. */
async function resolvePoster(
	asset: Record<string, unknown>,
	transformer: ImageTransformer,
	opts: ImageOptions,
): Promise<void> {
	const url = String(asset.poster);
	const poster = transformer.poster;
	if (!poster) {
		return;
	}
	try {
		const size = await transformer.size(url);
		if (size) {
			asset.posterSrc = poster(url, size);
		}
	} catch (error) {
		(opts.onError ?? warnImage)(url, error);
	}
}

/** The background asset of the page's first block (react gives that block `priority`). */
function firstBackground(blocks: unknown[]): unknown {
	const first = blocks[0];
	const background = isPlain(first) ? first.background : undefined;
	return isPlain(background) ? background.asset : undefined;
}

/**
 * A cover or anchored background: `srcset` of the transformer's background
 * url, and for the hero (`portrait`) the center crop at full height when
 * the image is wider than PORTRAIT_RATIO. Left alone when the transformer
 * cannot measure it or throws.
 */
async function resolveBackground(
	asset: Record<string, unknown>,
	transformer: ImageTransformer,
	opts: ImageOptions,
	portrait: boolean,
): Promise<void> {
	const url = String(asset.url);
	const background = transformer.background;
	if (!background) {
		return;
	}
	try {
		const size = await transformer.size(url);
		if (!size) {
			return;
		}
		const srcset: ImageCandidate[] = [
			{ url: background(url, size), width: size.width, height: size.height },
		];
		const cropWidth = Math.round(size.height * PORTRAIT_RATIO);
		const crop =
			portrait && cropWidth < size.width
				? { width: cropWidth, height: size.height }
				: undefined;
		asset.srcset = srcset;
		if (crop) {
			asset.portrait = { url: background(url, size, crop), ...crop };
		}
	} catch (error) {
		(opts.onError ?? warnImage)(url, error);
	}
}

/** The srcset of one image; undefined (original only) when the transformer cannot or throws. */
async function candidatesOf(
	url: string,
	transformer: ImageTransformer,
	opts: ImageOptions,
): Promise<ImageCandidate[] | undefined> {
	let size: ImageSize | undefined;
	let copies: ImageCandidate[];
	let full: string;
	try {
		size = await transformer.size(url);
		if (!size) {
			return undefined;
		}
		const widths = variantWidths(size, opts.widths ?? IMAGE_WIDTHS);
		copies = widths.length ? await transformer.resize(url, size, widths) : [];
		full = transformer.full?.(url, size) ?? url;
	} catch (error) {
		// An optional optimisation must not fail the page: keep the original.
		(opts.onError ?? warnImage)(url, error);
		return undefined;
	}
	return [
		...copies
			.filter((c) => c.width > 0 && c.width < size.width)
			.sort((a, b) => a.width - b.width),
		{ url: full, width: size.width, height: size.height },
	];
}

/** Background positions that stretch the asset over the box at a known width. */
const SIZED_BACKGROUND = new Set(["contain", "fill"]);

/**
 * An Asset to resolve: a raster image (`background`: drawn cover or
 * anchored), or a video with a raster `poster`.
 */
interface Collected {
	asset: Record<string, unknown>;
	background: boolean;
	poster: boolean;
}

/** Assets to resolve: raster images (cover and anchored backgrounds marked) and video posters. */
function collect(
	node: unknown,
	key: string | undefined,
	parent:
		| { node: Record<string, unknown>; key: string | undefined }
		| undefined,
	out: Collected[],
): void {
	if (Array.isArray(node)) {
		for (const v of node) {
			collect(v, key, parent, out);
		}
		return;
	}
	if (!isPlain(node)) {
		return;
	}
	if (
		node.kind === "image" &&
		typeof node.url === "string" &&
		isRasterImage(node.url)
	) {
		const background = key === "asset" && parent?.key === "background";
		const position = background ? (parent.node.position ?? "cover") : "";
		out.push({
			asset: node,
			background: background && !SIZED_BACKGROUND.has(String(position)),
			poster: false,
		});
		return;
	}
	if (
		node.kind === "video" &&
		typeof node.poster === "string" &&
		isRasterImage(node.poster)
	) {
		out.push({ asset: node, background: false, poster: true });
		return;
	}
	for (const [k, v] of Object.entries(node)) {
		collect(v, k, { node, key }, out);
	}
}

function warnImage(url: string, error: unknown): void {
	const why = error instanceof Error ? error.message : String(error);
	console.warn(`wunderweb: ${url} keeps its original only (${why})`);
}

function gcd(a: number, b: number): number {
	let x = Math.round(a);
	let y = Math.round(b);
	while (y) {
		[x, y] = [y, x % y];
	}
	return x;
}
