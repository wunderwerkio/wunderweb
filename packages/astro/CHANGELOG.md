# @wunderwerkio/wundercms-astro

## 0.4.0

### Patch Changes

- Updated dependencies [9d08469]
  - @wunderwerkio/wundercms-core@0.4.0
  - @wunderwerkio/wundercms-react@0.4.0

## 0.3.0

### Minor Changes

- a860ede: Preview mode (wunderweb):
  
  - `WUNDERWEB_PREVIEW=1 astro build` renders the content route and the
    integration's new `previewRoutes` on demand. Each page is read per
    request from the content service at `WUNDERWEB_CONTENT_URL` (core
    `previewSource`), passing back the forward-auth token. A framed request
    is annotated; any other gets the production render.
  - The Astro adapter exports `isPreview`, `sourceFor(request)`,
    `previewHeaders` and `previewBuild`. `loadPage(slug, {request})` and
    `createSitemap()` use the request's source.
  - `SitePage.extend` carries the theme's `extend.Page` fields.
  - Static builds and edit mode are unchanged.

### Patch Changes

- da05ecc: The in-place refresh sends `X-Wunderweb-Frame: 1`. A fetch is not a frame
  navigation (`Sec-Fetch-Dest: empty`), so the header tells a preview server
  to answer with the framed, annotated render. `astro dev` ignores it.
- Updated dependencies [a860ede]
- Updated dependencies [c21c522]
- Updated dependencies [4b8ff2a]
- Updated dependencies [5df5cd2]
  - @wunderwerkio/wundercms-core@0.3.0
  - @wunderwerkio/wundercms-react@0.3.0

## 0.2.0

### Minor Changes

- 3051227: Astro adapter (ADR 0004).
  
  - astro (new): `wundercms()` integration (requires `@astrojs/react`; the
    content route renders on demand in `astro dev`; in edit mode no dev
    toolbar and the shared hosts allowed), `getStaticPaths`, `loadPage`,
    `Head.astro` (title, description, robots, canonical, hreflang, Open Graph
    image), `Page.astro` (the runtime's `Page`, server rendered, no
    hydration; in edit mode annotated and refreshed in place), `createSitemap`.
  - core: content sources shared by the adapters: `fileSource`,
    `editServiceSource` (with a `production` guard and the dev server named
    in errors), `loadProjectSite`.
  - next: uses core's content sources; exports unchanged.
  - cli: `wundercms edit --astro` starts `astro dev` reading from the
    service; `wundercms init --astro` scaffolds an Astro app.
- 21325db: Opt-in CSS purge after the build (ADR 0004 amendment).
  
  - astro: `wundercms({ purgeCss: true })` removes, after `astro build`, the
    CSS rules whose selectors require a class used nowhere in the build
    (prerendered HTML and client scripts, entity- and escape-decoded); keeps
    `@layer` order, `@property`, `@keyframes` and `@font-face`; renames each
    purged stylesheet after its content hash and rewrites the HTML and the
    server manifest. Skipped with a warning for builds with on-demand pages or
    islands, and for stylesheets a script, a client JSON file or another
    stylesheet names. A stylesheet that cannot be purged stays as it is; a
    failure while writing leaves the build with its original CSS. `astro dev`
    keeps the full CSS. New dependencies: `postcss`, `postcss-selector-parser`
    (loaded only when `purgeCss` is on).
- f3f46ac: `purgeCss` also purges inlined stylesheets (ADR 0004 amendment 2026-11-12).
  
  - astro: with `build.inlineStylesheets`, every `<style>` of the prerendered
    HTML is purged in place (once per distinct CSS text, one summary log
    line). The used classes are read from the HTML without the contents of
    its `<style>` elements. A `<style>` that cannot be parsed stays as it is.
    Before, an inlined build kept its full CSS.
- d5031ec: Compact consent banner (ADR 0005 amendment).
  
  - astro: "settings" is a text link next to the privacy link; the banner
    keeps two buttons, "only necessary" then "accept all" (right edge, also on
    a line of their own). Phones (up to 40rem): title for screen readers only,
    smaller type, both buttons side by side (about 140px instead of 300–380px
    high). Every consent button shows the pointer cursor.
  - core: shorter banner text (DE / EN) that names the purpose and the
    withdrawal. `consent.style.reject` gives "only necessary" its own
    ButtonVariant (default: `choice`); lint rejects an unknown variant.
- 8ef3002: Consent management (ADR 0005), switched on by a `consent` section in the
  site config.
  
  - core: the `consent` config (version, maxAgeDays, privacy, hosts,
    categories → Google consent signals, Google tag and Meta Pixel vendors,
    cookieless tools, style tokens, text overrides) with built-in German and
    English texts; lint checks it, rejects `consent:settings` without it and
    warns about `remote-video` on a site without it. The Url type accepts
    `consent:settings` (additive to contract 1). The loader adds
    `SitePage.consent`, gates remote videos and turns `consent:settings`
    links into settings openers. Browser-safe `@wunderwerkio/wundercms-core/consent`.
  - react: `ConsentGate` for project blocks; `MediaElement` / `RemoteVideo`
    render the gate on sites with consent; `ButtonEl` renders
    `consent:settings` as a button opening the settings; the client script
    (`consentHeadScript`, `consentScript`: Consent Mode v2 Advanced, Meta
    Pixel after consent, withdrawal deletes cookies and reloads,
    `window.wcConsent`, `wc-consent` event).
  - astro: `ConsentHead.astro` and `Consent.astro` (banner, settings
    dialog, client script; nothing in edit mode); `WUNDERCMS_CONSENT_HOSTS`
    adds hosts for tests.
- 5697d3f: Cover and anchored backgrounds through an image server (ADR 0007 amendment).
  
  - core: `ImageTransformer.background(url, size, crop?)`; `resolveImages`
    gives cover and anchored backgrounds that url as their only candidate,
    and the first block's cover background also `portrait`, the center crop
    at full height and 3:4 (`PORTRAIT_RATIO`).
  - astro: `imgproxyTransformer` implements `background` at
    `backgroundQuality` (default 55; `c:<w>:<h>:ce` for the crop).
  - react: `fullSrcSet(asset)`, `PORTRAIT_MEDIA`; cover and anchored
    backgrounds render `srcSet="<url> 1x"`, the hero a `<picture>` whose
    source serves the crop to upright phones. A `fill` Media gets its `full`
    candidate at 1x (not for WebP sources).
- 4930f1e: imgproxy transformer (ADR 0007).
  
  - astro: `imgproxyTransformer({ key, salt, size, prefix?, source? })` makes
    no files: every srcset candidate is a signed, extensionless imgproxy url
    (`/_img/<signature>/rs:fit:<w>:0/<base64url(source)>`), the last one the
    original at full size, so imgproxy serves AVIF or WebP by `Accept`.
    `imgproxySignature(path, key, salt)`. `responsiveImages(page, astro,
    { transformer })` uses a given transformer instead of Astro's image service.
  - core: `ImageTransformer.full?(url, size)`, the url of the last
    (full-size) srcset candidate; default the original's url, as before.
- 0abc7c6: Faster images: the hero loads first, every other raster image in the size
  it is drawn at.
  
  - react: `Page` renders the first block with `ctx.priority` (new
    `RenderContext.priority`, `Blocks` option `priority`): its background
    image loads without `loading="lazy"` and with `fetchpriority="high"`;
    not when the block is hidden at some breakpoint, never for child blocks
    or the header.
  - core: `resolveImages(page, transformer, opts)` attaches
    `srcset: ImageCandidate[]` (copies ascending, original last) to every
    jpg / png / webp image Asset a page renders, except cover and anchored
    backgrounds; an image the transformer throws for keeps its original
    (`opts.onError`). `IMAGE_WIDTHS`, `variantWidths`, `isRasterImage` and
    the types `ImageCandidate`, `ImageSize`, `ImageTransformer`, `ImageOptions`.
  - react: `imageSrcSet(asset, box, opts)` returns `srcSet` / `sizes` for the
    box an image is drawn in (cover scaling, exact-ratio copies where the
    image shapes the box, only the candidates a browser picks for a fixed
    width, rem boxes with `sizes` in rem, no `sizes="auto"` for eager images),
    with `coverScale`, `ratioOf`, `imageSize` and the types `ImageAsset`,
    `ImageBox`. `MediaElement` and contain / fill backgrounds use it.
  - astro: `responsiveImages(page, { getImage, inferRemoteSize }, opts)` and
    `astroImageTransformer({ getImage, inferRemoteSize }, opts)`: sizes from
    the image header, webp copies (quality 85) through Astro's image service,
    hashed files in `/_astro/`; pages in edit mode untouched, images Astro
    may not fetch or resize keep their original (one warning per reason).
  - registry: Person, Gallery and Rating offer the copies for their boxes.
  
  Without `responsiveImages` (or another adapter) assets have no `srcset`
  and render as before.
- 2cd5e1f: Video posters through an image server (ADR 0007 amendment).
  
  - core: `ImageTransformer.poster(url, size)`; `resolveImages` gives video
    Assets with a raster poster a `posterSrc`.
  - astro: `imgproxyTransformer` implements `poster`, fit to `posterWidth`
    (default 960) at `backgroundQuality`.
  - react: `posterOf(asset)`; `MediaElement` and video backgrounds use it.

### Patch Changes

- Updated dependencies [3051227]
- Updated dependencies [d5031ec]
- Updated dependencies [8dd4252]
- Updated dependencies [8dd4252]
- Updated dependencies [8ef3002]
- Updated dependencies [5697d3f]
- Updated dependencies [066fc48]
- Updated dependencies [3ac7fa2]
- Updated dependencies [4930f1e]
- Updated dependencies [4cbacf6]
- Updated dependencies [0abc7c6]
- Updated dependencies [2cd5e1f]
  - @wunderwerkio/wundercms-core@0.2.0
  - @wunderwerkio/wundercms-react@0.2.0
