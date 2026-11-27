// srcset / sizes of an image Asset for the box it is drawn in. The copies
// come from the loader's adapter (core `resolveImages`, e.g. the Astro
// adapter's `responsiveImages`): `asset.srcset`, ascending, original last.
//
//   <img src={a.url} {...imageSrcSet(a, { width: 56, height: 56, fit: "cover" })} />
//
// Rules:
// - The browser never gets a copy narrower than the drawn width × device
//   pixel ratio: `object-fit: cover` draws an image wider than its box, so
//   each candidate's w descriptor is its width divided by that scale.
// - A box that takes its size from the image (no `fit`: `h-auto` or
//   `w-auto`) lists only copies of the original's exact aspect ratio, so
//   nothing shifts by a sub-pixel when a copy loads.
// - Fixed CSS width S: sizes="<S>px" (or "<S>rem" for a rem-sized box, which
//   the browser resolves against the user's default font size, as the CSS)
//   and only the candidates a browser can pick (smallest per density 1, 1.5,
//   2, 3, for rem boxes also at a 20px default font, plus the original),
//   which keeps the HTML small. Unknown width: sizes="auto, 100vw" (eager
//   images: "100vw", `auto` is for lazy ones) and every candidate.
// - The original stays `src` and the widest candidate, so whatever the
//   browser needs, a candidate covers it.

import type { ImageCandidate, ImageSize } from "@wunderweb/core";

import type { Asset } from "./core-types.js";

/**
 * An image Asset as the loader resolves it with responsive images; a cover
 * background of the first block may also have its `portrait` center crop.
 */
export type ImageAsset = Asset & {
	srcset?: ImageCandidate[] | undefined;
	portrait?: ImageCandidate | undefined;
};

/**
 * The url for a video's `poster` attribute: the loader's `posterSrc` (e.g.
 * an image server's converted, width-capped copy), else the original.
 */
export function posterOf(asset: Asset): string | undefined {
	if (asset.kind !== "video") {
		return undefined;
	}
	const resolved = (asset as { posterSrc?: unknown }).posterSrc;
	return typeof resolved === "string" ? resolved : asset.poster;
}

/** Where a cover background shows its `portrait` crop: phones held upright, whose hero box is tall. */
export const PORTRAIT_MEDIA = "(orientation: portrait) and (max-width: 767px)";

/** The box an image is drawn in (what its CSS fixes). */
export interface ImageBox {
	/** CSS width in `unit`; unset: unknown (sizes "auto, 100vw"). */
	width?: number | undefined;
	/** CSS height in `unit`. */
	height?: number | undefined;
	/**
	 * Unit of width and height: "rem" for boxes sized in rem (Tailwind's
	 * `size-14`, `h-12`), so they follow the user's default font size.
	 * Default "px".
	 */
	unit?: "px" | "rem" | undefined;
	/** Box aspect ratio (width / height), e.g. of a 16:9 crop; width and height imply it. */
	ratio?: number | undefined;
	/**
	 * `object-fit` in a box whose shape the CSS fixes. Unset: the box takes
	 * its shape from the image (`h-auto` with a width, `w-auto` with a height).
	 */
	fit?: "cover" | "contain" | "fill" | undefined;
}

/** Device pixel ratios a fixed-width image keeps one candidate for. */
const DENSITIES = [1, 1.5, 2, 3];
/** CSS px per rem at the default font size, and a larger default (20px) rem boxes also pick for. */
const REM_PX = 16;
const LARGE_FONT = 20 / REM_PX;

/** Width / height. */
export function ratioOf(size: ImageSize): number {
	return size.width / size.height;
}

/**
 * How much wider than its box `object-fit: cover` draws an image of `size`
 * in a box of `boxRatio` (width / height): 1 if the height limits it.
 */
export function coverScale(size: ImageSize, boxRatio: number): number {
	return Math.max(1, ratioOf(size) / boxRatio);
}

/** Real pixel size of an image Asset: its original (last srcset entry), else its width / height. */
export function imageSize(asset: ImageAsset): ImageSize | undefined {
	const original = asset.srcset?.at(-1);
	if (original) {
		return { width: original.width, height: original.height };
	}
	return asset.width && asset.height
		? { width: asset.width, height: asset.height }
		: undefined;
}

/**
 * `srcSet` of only the full-size candidate (the original's pixels, e.g. as
 * AVIF / WebP from an image server), for an image whose drawn width is
 * unknown: the browser takes it over `src` at every density. Empty when it
 * is the original itself.
 */
export function fullSrcSet(asset: ImageAsset): { srcSet?: string } {
	const full = asset.srcset?.at(-1);
	if (!full || asset.kind !== "image" || full.url === asset.url) {
		return {};
	}
	return { srcSet: `${full.url} 1x` };
}

/**
 * `srcSet` and `sizes` for an image drawn in `box`; empty when the asset
 * has no copies or none is safe to offer (the img keeps its `src`).
 */
export function imageSrcSet(
	asset: ImageAsset,
	box: ImageBox = {},
	opts: {
		/** The img loads eagerly (no `loading="lazy"`): no `sizes="auto"`. */
		eager?: boolean | undefined;
	} = {},
): { srcSet?: string; sizes?: string } {
	const list = asset.srcset;
	const original = list?.at(-1);
	if (!list || !original || list.length < 2 || asset.kind !== "image") {
		return {};
	}
	const natural = !box.fit;
	const boxRatio =
		box.ratio ?? (box.width && box.height ? box.width / box.height : undefined);
	if (box.fit === "cover" && !boxRatio) {
		// Drawn width unknown: it depends on the box height. At most the
		// full-size candidate, converted by an image server; not for a WebP
		// source, which re-encoding at the same size usually makes larger.
		return /\.webp$/i.test(asset.url.replace(/[?#].*$/, ""))
			? {}
			: fullSrcSet(asset);
	}
	// Box width (CSS px at the default font size) a candidate covers at density 1.
	const effective = (c: ImageCandidate) =>
		Math.floor(
			box.fit === "cover" && boxRatio
				? c.width / coverScale(c, boxRatio)
				: c.width,
		);
	const copies = list
		.slice(0, -1)
		.filter(
			(c) =>
				!natural || c.width * original.height === c.height * original.width,
		);

	const width =
		box.width ??
		(box.height
			? box.height * (natural ? ratioOf(original) : (boxRatio ?? Number.NaN))
			: undefined);

	let chosen: ImageCandidate[];
	let sizes: string;
	if (width === undefined || !Number.isFinite(width)) {
		chosen = [...copies, original];
		sizes = opts.eager ? "100vw" : "auto, 100vw";
	} else {
		const rem = box.unit === "rem";
		// CSS px at the default font size; a rem box also at a larger one.
		const px = rem ? width * REM_PX : width;
		const scales = rem ? [1, LARGE_FONT] : [1];
		const picked = new Set<ImageCandidate>();
		for (const f of scales) {
			for (const d of DENSITIES) {
				const c = copies.find((x) => effective(x) >= px * f * d);
				if (c) {
					picked.add(c);
				}
			}
		}
		chosen = [...copies.filter((c) => picked.has(c)), original];
		// Rounded up: a larger slot only makes the browser pick wider.
		sizes = rem
			? `${Math.ceil(width * 10000) / 10000}rem`
			: `${Math.ceil(width * 100) / 100}px`;
	}
	if (chosen.length < 2) {
		return {};
	}
	return {
		srcSet: chosen.map((c) => `${c.url} ${effective(c)}w`).join(", "),
		sizes,
	};
}
