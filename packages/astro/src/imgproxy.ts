// Responsive images through an imgproxy server (ADR 0007): instead of
// making copies at build time, the srcset lists signed imgproxy urls, which
// the server resizes and converts on request.
//
//   // src/images.ts: once per build (a page's frontmatter runs per page)
//   import { inferRemoteSize } from "astro:assets";
//   import { imgproxyTransformer } from "@wunderweb/astro";
//   export const transformer = imgproxyTransformer({
//     key: process.env.IMGPROXY_KEY, salt: process.env.IMGPROXY_SALT,
//     size: inferRemoteSize,
//   });
//
//   // [...slug].astro
//   const page = await responsiveImages(loaded, { getImage, inferRemoteSize }, { transformer });
//
// Each candidate is `<prefix>/<signature>/rs:fit:<width>:0/<base64url(source)>`
// on the site's own host: no extension, so imgproxy picks the format from
// the browser's Accept header (AVIF, WebP, else the source's) and one
// srcset serves every browser. The last candidate is the original at full
// size through imgproxy, so it is converted too; `src` stays the original
// (ADR 0006's fallback). The signature is imgproxy's: URL-safe base64
// (unpadded) of HMAC-SHA256 with the hex-decoded key over the hex-decoded
// salt plus the path after the signature.
//
// Sizes come from `size` (Astro's `inferRemoteSize`: the image header
// only), cached per url like the Astro transformer's. Nothing is fetched to
// make the urls.

import { createHmac } from "node:crypto";

import type {
	ImageCandidate,
	ImageSize,
	ImageTransformer,
} from "@wunderweb/core";

import { type InferRemoteSize, imageMeasurer, imageSkipper } from "./images.js";

export interface ImgproxyOptions {
	/** Path prefix imgproxy serves under (its IMGPROXY_PATH_PREFIX). Default "/_img". */
	prefix?: string | undefined;
	/** Hex-encoded signing key (one of imgproxy's IMGPROXY_KEY). */
	key: string;
	/** Hex-encoded salt paired with `key` (IMGPROXY_SALT). */
	salt: string;
	/** Measures an image (Astro's `inferRemoteSize`: header only, respects `image.domains`). */
	size: InferRemoteSize;
	/**
	 * The url imgproxy fetches for an Asset url, e.g. the bucket behind a
	 * CDN host (imgproxy allows only its IMGPROXY_ALLOWED_SOURCES). Default:
	 * the url itself.
	 */
	source?: ((url: string) => string) | undefined;
	/**
	 * imgproxy quality (1-100) of cover and anchored backgrounds, which sit
	 * under overlays and gradients, and of video posters, shown only until
	 * the video plays: their urls carry `q:<n>`. Default 55.
	 */
	backgroundQuality?: number | undefined;
	/**
	 * Widest video poster in px (one url for every player and screen: a
	 * wider original is fit to it). Default 960.
	 */
	posterWidth?: number | undefined;
}

/** Default quality of background and poster urls (see `backgroundQuality`). */
export const BACKGROUND_QUALITY = 55;
/** Default `posterWidth`. */
export const POSTER_WIDTH = 960;

const HEX = /^(?:[0-9a-f]{2})+$/i;

/**
 * imgproxy's signature of `path` (the part after the signature, with its
 * leading "/"): URL-safe base64, unpadded, of HMAC-SHA256(key, salt + path),
 * key and salt hex-decoded.
 */
export function imgproxySignature(
	path: string,
	key: string,
	salt: string,
): string {
	return createHmac("sha256", Buffer.from(key, "hex"))
		.update(Buffer.from(salt, "hex"))
		.update(path)
		.digest("base64url");
}

/**
 * An ImageTransformer that makes no files: `resize` and `full` return
 * signed imgproxy urls under `prefix`, `size` measures with `opts.size`.
 * Throws when key or salt is not hex.
 */
export function imgproxyTransformer(opts: ImgproxyOptions): ImageTransformer {
	for (const name of ["key", "salt"] as const) {
		if (!HEX.test(opts[name] ?? "")) {
			throw new Error(
				`wunderweb: imgproxyTransformer needs a hex-encoded ${name} (IMGPROXY_${name.toUpperCase()})`,
			);
		}
	}
	// One leading slash, none trailing: "_img/" and "/_img" are the same.
	const prefix = `/${(opts.prefix ?? "/_img").replace(/^\/+|\/+$/g, "")}`;
	const source = opts.source ?? ((url: string) => url);
	const quality = Math.round(opts.backgroundQuality ?? BACKGROUND_QUALITY);
	if (!(quality >= 1 && quality <= 100)) {
		throw new Error(
			"wunderweb: imgproxyTransformer backgroundQuality must be 1-100",
		);
	}
	const posterWidth = Math.round(opts.posterWidth ?? POSTER_WIDTH);
	if (!(posterWidth > 0)) {
		throw new Error("wunderweb: imgproxyTransformer posterWidth must be > 0");
	}
	const signed = (options: string, src: string): string => {
		const path = `/${options}/${Buffer.from(source(src)).toString("base64url")}`;
		return `${prefix}/${imgproxySignature(path, opts.key, opts.salt)}${path}`;
	};
	const url = (src: string, width: number): string =>
		signed(`rs:fit:${width}:0`, src);

	return {
		size: imageMeasurer(opts.size, imageSkipper()),
		async resize(src, size, widths) {
			return widths.map(
				(width): ImageCandidate => ({
					url: url(src, width),
					width,
					height: Math.round((width * size.height) / size.width),
				}),
			);
		},
		full(src, size: ImageSize) {
			return url(src, size.width);
		},
		// Full size, or the center crop (`c:<w>:<h>:ce`, imgproxy's crop with
		// center gravity), at the background quality.
		background(src, size: ImageSize, crop?: ImageSize) {
			return signed(
				crop
					? `c:${crop.width}:${crop.height}:ce/q:${quality}`
					: `rs:fit:${size.width}:0/q:${quality}`,
				src,
			);
		},
		// At most `posterWidth` wide (never enlarged), at the background quality.
		poster(src, size: ImageSize) {
			const width = Math.min(size.width, posterWidth);
			return signed(`rs:fit:${width}:0/q:${quality}`, src);
		},
	};
}
