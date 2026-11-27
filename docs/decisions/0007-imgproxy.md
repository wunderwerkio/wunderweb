# 0007: imgproxy transformer

Status: accepted (2026-11-11). Extends [ADR 0006](./0006-images.md);
changes nothing in the contract (`srcset` is still added by an adapter
after loading).

## Context

ADR 0006 makes the responsive copies at build time through Astro's image
service: on wunderwerk.io about 500 webp files (quality 85) of about 60
originals, written to `/_astro/`. That adds about 45 s to a build without
Astro's cache, needs sharp in the build, serves WebP only (no AVIF), and
the largest candidate is the unconverted original. Every further site
pays the same again.

An image server resizes and converts on request instead. One imgproxy
instance can serve every site at `/_img` on the site's own host (the
cluster routes that path to it), signed per site, cached in front.

## Decision

- **`imgproxyTransformer({ prefix, key, salt, size, source })` (astro).**
  An `ImageTransformer` that makes no files:
  - `size`: as the Astro transformer (`inferRemoteSize`, the image header
    only; cached per url, failures not, one warning per reason).
  - `resize`: one url per width,
    `<prefix>/<signature>/rs:fit:<width>:0/<base64url(source url)>`.
  - `full`: the same at the original's width, so the last candidate is
    converted too.
  - No extension: imgproxy negotiates the format from `Accept` (AVIF, else
    WebP, else the source's), so one srcset serves every browser and the
    HTML does not grow per format (ADR 0006: HTML size cost FCP).
  - The signature is imgproxy's: URL-safe base64 (unpadded) of
    HMAC-SHA256 with the hex-decoded key over the hex-decoded salt plus
    the path after the signature. Key and salt that are not hex throw.
  - `source` maps an Asset url to the url imgproxy fetches (e.g. the
    bucket behind a CDN host); default the url itself.
  - `prefix` defaults to `/_img` (imgproxy's `IMGPROXY_PATH_PREFIX`).
- **`ImageTransformer.full?(url, size)` (core).** Optional url of the last,
  full-size candidate. Without it the last candidate stays the original's
  url, as before. The Asset's `url` (the img `src`) is never changed, so a
  browser without srcset support still gets the original (ADR 0006).
- **`responsiveImages(page, astro, { transformer })` (astro).** A given
  transformer replaces the Astro one; `getImage` is then not called.
  The site keeps the Astro transformer as its fallback where it has no key
  (local `astro dev`, the editor).

## Consequences

- Builds fetch only image headers: no copies, no `/_astro/*.webp`.
- The key signs urls at build time: it is a build secret, never shipped in
  the image or the page.
- Image urls depend on key and salt: a new key changes every url (pages
  must be rebuilt; the image server keeps the old pair until they are).
- Every srcset candidate needs the image server; `src` does not.
- The image server must match the transformer: `IMGPROXY_AUTO_AVIF` and
  `IMGPROXY_AUTO_WEBP` on (else the source format is served), any cache in
  front of it varying on `Accept`, `IMGPROXY_PATH_PREFIX` equal to `prefix`,
  one of its `IMGPROXY_KEY` / `IMGPROXY_SALT` pairs equal to the site's
  (else every candidate is a 403), and the `source` urls under
  `IMGPROXY_ALLOWED_SOURCES`. imgproxy accepts several comma-separated
  pairs, so a rotation lists old and new until the pages are rebuilt.
  wunderwerk's setup: wunderwerk-infra ADR 0009.
- One transformer per build, not per page: its size cache and warnings
  span the pages.

## Amendment (2026-11-11): cover and anchored backgrounds

Cover and anchored backgrounds had no candidates at all (ADR 0006: their
drawn width depends on the box height), so a hero background, often the
page's LCP image, went out as the unconverted original. On wunderwerk.io
the home hero (2160×940 WebP, 237 KB) is drawn cover in a portrait box on
phones (397×807 at Lighthouse's mobile viewport): 21% of it is visible,
and at imgproxy's AVIF q68 the full image grew to 343 KB (a grainy photo).

- **`ImageTransformer.background?(url, size, crop?)` (core).** The url of a
  cover or anchored background at full size, or of its center `crop`.
  Backgrounds get it as their only candidate; without it they stay alone.
- **Portrait crop for the hero (core, react).** The first block's cover
  background (the block react gives `priority`) also gets `portrait`: the
  center crop at full height and 3:4 (`PORTRAIT_RATIO`), when the image is
  wider. Cover draws a wide image by its height and centers it, so a box
  at most 3:4 shows exactly that strip; react renders a `<picture>` whose
  `<source media="(orientation: portrait) and (max-width: 767px)">` serves
  it. Only the first block: its box is tall; a short box further down
  could be wider than 3:4 and would be cropped differently. Not with
  parallax (a taller layer).
- **`backgroundQuality` (imgproxyTransformer, default 55).** Backgrounds
  sit under overlays and gradients; their urls carry `q:55`.
- **`fill` Media.** A cover box of unknown shape gets the `full` candidate
  at 1x, except for a WebP source, which re-encoding at the same size
  usually makes larger.

Measured on the hero (AVIF q55): phones get the 705×940 crop (70 KB)
instead of the 237 KB original; elsewhere the full image is 212 KB.

## Amendment (2026-11-11): video posters

`<video poster>` takes a single url, so posters went out as the original
(wunderwerk.io: a 1280×720 JPEG, 92 KB, drawn at most 807 CSS px wide,
flagged by Lighthouse). `ImageTransformer.poster?(url, size)` gives video
Assets a `posterSrc`; react's `posterOf` renders it, else the original.
imgproxy fits it to `posterWidth` (default 960: an 807 px player at 1x,
phones at about 2.4x) at `backgroundQuality`: a poster shows only until
the video plays. Measured: 92 KB JPEG → 29 KB AVIF.
