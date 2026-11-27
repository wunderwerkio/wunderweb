# 0006: Images: first block priority, responsive copies

Status: accepted (2026-10-16). Extends [ADR 0001](./0001-architecture.md)
and [ADR 0004](./0004-astro-adapter.md); changes nothing in the contract
(`srcset` is added by an adapter after loading, never authored).

## Context

Content references images at their upload size: a 600 px avatar drawn at
56 px, a 4000 px hero. Every image rendered `loading="lazy"`, the hero
too, so the browser found the largest contentful paint only after layout.
On wunderwerk.io the hero was the LCP element (6.5 s on mobile) and
desktop pages downloaded about 3.5 MB more image data than they draw.

The renderer cannot know how wide an image is drawn: that is the block's
CSS. The loader cannot resize images: that needs an image pipeline, which
the framework has (Astro's image service, sharp).

## Decision

- **First block priority (react).** `Page` passes `priority` to the main
  `Blocks`; the first block renders with `ctx.priority`, and its
  background image renders without `loading="lazy"`, with
  `fetchpriority="high"`. Only the first block: the hero sits there on
  every page that has one, and a wrong guess costs one eager image. Not
  when the block is hidden at some breakpoint (an eager image loads even
  where it is hidden); never child blocks (`ctx.render` renders with the
  context without it) or the header. No `<link rel=preload>`: the image is
  in the HTML, so the preload scanner finds it; React's hoisted hint is
  dropped by the Astro adapter as before.
- **Copies are an adapter step on the loaded page (core).**
  `resolveImages(page, transformer)` attaches `srcset` (copies ascending,
  the original last at its real size) to each raster image Asset of the
  rendered regions. The `ImageTransformer` (`size`, `resize`) is the seam:
  Astro implements it with `inferRemoteSize` (size, no transform) and
  `getImage` (copies), a test with a fake. A transformer that throws for
  an image leaves it with its original: an optional optimisation never
  fails a page. Widths:
  `IMAGE_WIDTHS` below the original, each step at most 1.5×; a width moves
  by up to 5% when that keeps the original's exact aspect ratio. Cover and
  anchored backgrounds get no copies: their drawn width depends on the box
  height.
- **The block picks for its box (react `imageSrcSet`).** A component
  states what its CSS fixes (`width`, `height`, `ratio`, `fit`). Rules:
  the browser must never pick a copy narrower than the drawn width × device
  pixel ratio (cover: descriptors divided by how much wider the image is
  drawn); a box shaped by the image lists only exact-ratio copies (a copy
  of another ratio would shift the layout by a sub-pixel when it loads); a
  fixed width lists only what a browser picks at 1, 1.5, 2 and 3× plus the
  original (a rem-sized box: `sizes` in rem, which follows the user's
  default font size like the CSS, and the picks also for a 20px default) (the full lists pushed the home HTML over a TCP slow-start
  window: +150 ms FCP on mobile); an unknown width uses `sizes="auto,
  100vw"`. The original stays `src`, so a browser without srcset support
  or a picked copy that fails is no worse than before.
- **Astro (`responsiveImages(page, { getImage, inferRemoteSize })`).**
  Measured from the image header (a `getImage` with `inferSize` would be
  a full transform), webp at quality 85, hashed files in `/_astro/`
  (immutable cache). Pages in edit mode stay untouched (no copies while
  editing). Images Astro may not fetch or resize keep their original,
  with one warning per reason, so a missing config or a broken file never
  breaks a build; failures are not cached and the caches are bounded, so
  a dev server retries and does not grow without end.

## Consequences

- Builds fetch every original once (Astro caches transforms in
  `node_modules/.astro`) and write about ten copies per image.
- Projects opt in per adapter call; without it assets have no `srcset`
  and render as before. Blocks that render images call `imageSrcSet`
  with their box; a block that does not offers only the original.
- A site that renders `/_image` on demand lets anyone make its server
  fetch and resize allowed remote images; a static site can switch the
  endpoint off in production (wunderwerk.io does).
