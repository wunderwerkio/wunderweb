// Responsive images through Astro's image service: every raster image of a
// page gets smaller webp copies (core `resolveImages`), which the blocks
// offer as srcset (react `imageSrcSet`).
//
//   ---
//   import { getImage, inferRemoteSize } from "astro:assets";
//   import { loadPage, responsiveImages } from "@wunderweb/astro";
//   const loaded = await loadPage(Astro.params.slug);
//   if (!loaded) return new Response(null, { status: 404 });
//   const page = await responsiveImages(loaded, { getImage, inferRemoteSize });
//   ---
//
// `inferRemoteSize` measures an image (reading only its header, no
// transform); `getImage` makes the copies. `astro build` writes them as
// hashed files to /_astro/ (cached as immutable); `astro dev` serves them
// from the /_image endpoint. Remote images need their host in
// `image.domains` (or `remotePatterns`). An image that cannot be measured
// or resized keeps its original, with one warning per reason. Pages in edit
// mode are returned untouched (no copies while editing).

import {
	type ImageCandidate,
	type ImageOptions,
	type ImageSize,
	type ImageTransformer,
	resolveImages,
	type SourcePage,
} from "@wunderweb/core";
import type { GetImageResult, UnresolvedImageTransform } from "astro";

/** `getImage` from `astro:assets`. */
export type GetImage = (
	options: UnresolvedImageTransform,
) => Promise<GetImageResult>;

/** `inferRemoteSize` from `astro:assets`. */
export type InferRemoteSize = (url: string) => Promise<ImageSize>;

/** The image functions of `astro:assets` the adapter uses. */
export interface AstroImages {
	/** Makes the copies (Astro's image service). */
	getImage: GetImage;
	/** Measures a remote image without a transform (respects `image.domains`). */
	inferRemoteSize: InferRemoteSize;
}

export interface AstroImageOptions extends ImageOptions {
	/** Format of the copies. Default "webp". */
	format?: "webp" | "avif" | "jpeg" | "png" | undefined;
	/** Quality of the copies (1-100). Default 85. */
	quality?: number | undefined;
}

export interface ResponsiveImageOptions extends AstroImageOptions {
	/**
	 * Makes the srcset instead of Astro's image service (`getImage` is then
	 * not called; `format` and `quality` do not apply), e.g.
	 * `imgproxyTransformer` (ADR 0007). Keep one per build: its caches span
	 * the pages.
	 */
	transformer?: ImageTransformer | undefined;
}

const REMOTE = /^https?:\/\//i;
/** Entries per cache: a long-running dev server forgets the oldest urls. */
const MAX_CACHED = 1000;

/** Why an image keeps its original only, with what to do about it. */
export type Skip = "not-http" | "not-allowed" | "unmeasured" | "unresized";

const HINT: Record<Skip, string> = {
	"not-http": "only absolute http(s) image urls are resized",
	"not-allowed":
		"allow their host in astro.config `image.domains` or `image.remotePatterns`",
	unmeasured: "their size could not be read (fetch or format error)",
	unresized: "the image service could not make the copies",
};

/** Warns once per reason that images keep their original only; returns undefined. */
export type SkipImage = (
	kind: Skip,
	url: string,
	reason?: unknown,
) => undefined;

/** A fresh `skip`: one console warning per reason, with its hint. */
export function imageSkipper(): SkipImage {
	const warned = new Set<Skip>();
	return (kind, url, reason) => {
		if (!warned.has(kind)) {
			warned.add(kind);
			const why =
				reason === undefined
					? ""
					: ` (${reason instanceof Error ? reason.message : String(reason)})`;
			console.warn(
				`wunderweb: images keep their original only, e.g. ${url}${why}: ${HINT[kind]}`,
			);
		}
		return undefined;
	};
}

/**
 * `ImageTransformer.size` on `inferRemoteSize`: absolute http(s) urls only,
 * successes cached per url (bounded), failures not (a later page asks
 * again), each failure reported through `skip`.
 */
export function imageMeasurer(
	inferRemoteSize: InferRemoteSize,
	skip: SkipImage,
): ImageTransformer["size"] {
	const sizes = new Map<string, Promise<ImageSize | undefined>>();
	return (url) => {
		if (!REMOTE.test(url)) {
			return Promise.resolve(skip("not-http", url));
		}
		const cached = sizes.get(url);
		if (cached) {
			return cached;
		}
		const size = inferRemoteSize(url).then(
			({ width, height }) => {
				if (width > 0 && height > 0) {
					return { width, height };
				}
				sizes.delete(url);
				return skip("unmeasured", url, "size unknown");
			},
			(e: unknown) => {
				sizes.delete(url);
				const name = e instanceof Error ? e.name : "";
				return skip(
					name === "RemoteImageNotAllowed" ? "not-allowed" : "unmeasured",
					url,
					e,
				);
			},
		);
		remember(sizes, url, size);
		return size;
	};
}

/**
 * An ImageTransformer on Astro's `inferRemoteSize` (size) and `getImage`
 * (copies). Successful results are cached per url (bounded); failures are
 * not, so a later page asks again. One warning per reason.
 */
export function astroImageTransformer(
	astro: AstroImages,
	opts: AstroImageOptions = {},
): ImageTransformer {
	const format = opts.format ?? "webp";
	const quality = opts.quality ?? 85;
	const copies = new Map<string, Promise<ImageCandidate[]>>();
	const skip = imageSkipper();

	return {
		size: imageMeasurer(astro.inferRemoteSize, skip),
		resize(url, size, widths) {
			const key = `${url} ${size.width}x${size.height} ${widths.join(",")}`;
			const cached = copies.get(key);
			if (cached) {
				return cached;
			}
			const list = astro
				.getImage({
					src: url,
					width: size.width,
					height: size.height,
					widths: [...widths],
					format,
					quality,
				})
				.then((r) =>
					r.srcSet.values.flatMap(({ url: copy, transform: t }) =>
						t.width
							? [
									{
										url: copy,
										width: t.width,
										height:
											t.height ??
											Math.round((t.width * size.height) / size.width),
									},
								]
							: [],
					),
				)
				.catch((e: unknown): ImageCandidate[] => {
					copies.delete(key);
					skip("unresized", url, e);
					return [];
				});
			remember(copies, key, list);
			return list;
		},
	};
}

/** Map.set, dropping the oldest entry beyond MAX_CACHED. */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
	map.set(key, value);
	if (map.size > MAX_CACHED) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) {
			map.delete(oldest);
		}
	}
}

/** One transformer per getImage and options: its caches span the build's pages. */
const transformers = new WeakMap<GetImage, Map<string, ImageTransformer>>();

/**
 * The page with responsive images (core `resolveImages` through Astro's
 * image service, or `opts.transformer`, e.g. `imgproxyTransformer`). Pages
 * in edit mode are returned untouched.
 */
export async function responsiveImages(
	page: SourcePage,
	astro: AstroImages,
	opts: ResponsiveImageOptions = {},
): Promise<SourcePage> {
	if (page.annotate) {
		return page;
	}
	const { transformer: given, ...rest } = opts;
	if (given) {
		return { ...page, page: await resolveImages(page.page, given, rest) };
	}
	const byOptions = transformers.get(astro.getImage) ?? new Map();
	transformers.set(astro.getImage, byOptions);
	const key = JSON.stringify(opts);
	let transformer = byOptions.get(key);
	if (!transformer) {
		transformer = astroImageTransformer(astro, opts);
		byOptions.set(key, transformer);
	}
	return {
		...page,
		page: await resolveImages(page.page, transformer, opts),
	};
}
