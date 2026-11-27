# @wunderwerkio/wundercms-react

## 0.5.1

### Patch Changes

- @wunderweb/core@0.5.1

## 0.5.0

### Minor Changes

- d154100: wundercms is now wunderweb: the packages are `@wunderweb/{core,cli,react,astro,next}` (MIT), the CLI is `wunderweb`, the site config `wunderweb.config.yaml`, the generated stylesheet `generated/wunderweb.css`, the schema `urn:wunderweb:…`, the default registry `wunderweb` at `https://github.com/wunderwerkio/wunderweb.git`, the package blocks key `"wunderweb"`, the Astro integration `wunderweb()`, the env vars `WUNDERWEB_*`. The old config file name, package blocks key and registry name are still read, with a deprecation warning. `wunderweb migrate` renames a site in place (`--check`: dry run).

### Patch Changes

- Updated dependencies [d154100]
- Updated dependencies [d154100]
  - @wunderweb/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [9d08469]
  - @wunderwerkio/wundercms-core@0.4.0

## 0.3.0

### Minor Changes

- c21c522: Block ids. Every block may carry an `id` (a short lowercase slug), unique
  within its file. It is editor metadata:
  
  - The loader no longer passes `id` to components, and the generated block
    types drop `id?: string`. A component that reads `block.id` for an HTML id
    must use `useId` or a field of its own. With source maps, `Origin.id`
    carries the id.
  - `wundercms format` fills in missing ids (eight lowercase letters and
    digits) and re-assigns the later of two duplicates. `format --check`
    counts both.
  - A duplicate id is a content error. `wundercms lint` warns once per file
    about blocks without an id.
  - The editor gives duplicated and newly added blocks fresh ids, and no
    longer shows `id` as a field.
  - Registry Accordion: the `name` of its items no longer comes from
    `block.id`.

### Patch Changes

- Updated dependencies [a860ede]
- Updated dependencies [c21c522]
- Updated dependencies [4b8ff2a]
- Updated dependencies [5df5cd2]
  - @wunderwerkio/wundercms-core@0.3.0

## 0.2.0

### Minor Changes

- 8dd4252: Vendor scripts load after the page (ADR 0005 amendment).
  
  - core: `consent.load` (`idle`, the default, or `eager`), passed through
    `PageConsent.load` and `ClientConsent.load`; lint rejects other values.
    `LOAD_STRATEGIES` and `LoadStrategy` are exported.
  - react: with `idle` the head script adds `gtag.js` after the load event
    when the browser is idle, and the Meta Pixel adds `fbevents.js` the same
    way (its `fbq` queue is still created at once). Consent default, stored
    choice, `js` and `config` are queued first, as before. `eager` keeps the
    previous behaviour.
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
- 066fc48: Edit mode (ADR 0003, phase 1): `wundercms edit` starts the edit service and
  the visual editor for a project in `next dev`.
  
  - core: source maps in the loader (`loadSite(project, schema, {sources: true})`,
    `pageFindings`), `applyEdit`, `effectiveDefault` (shared with
    `withDefaults`), content from in-memory documents (`contentFiles`,
    `parseSource`), `staleGenerated` (moved from the CLI), browser-safe
    `@wunderwerkio/wundercms-core/edit`.
  - react: `annotate` (rendered paths, revision, source-path keys, per-block
    boundary with placeholders) replaces `inspect` (kept as an alias);
    `./bridge` entry. The block inspector and `mountInspector` are removed.
  - next: content source seam (`fileSource`, `editServiceSource` with
    `WUNDERCMS_EDIT_URL`), `./edit-refresh` client entry; `createSitemap` and
    `generateStaticParams` are async.
  - cli: `wundercms edit [--port] [--site] [--next] [--open] [--share]`.
  - edit (new): the service (draft, revisions, YAML patching, REST + SSE,
    agent bridge to the Wunderfactory session API) with the built editor.
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

- 8dd4252: The inline consent scripts (`consentHeadScript`, `consentScript`) are
  minified with esbuild from `consent-script.js` into the generated
  `consent-script.min.ts`: about 5 KB instead of 9.5 KB in every page.
- 3ac7fa2: Editor in the wunderwerk corporate identity, built from shadcn/ui components,
  with a larger UI.
  
  - edit: field edits that would add an error are refused (`422 invalid` with
    the findings; the draft and history stay as they were; `refuseInvalid:
    false` turns it off). The form checks values before sending, never leaves
    an empty object behind when unsetting, and hides "Unset" on required
    fields.
  - edit: in the frame, a toolbar for the selected block (parent, move,
    duplicate, add after, remove) and drag handles for padding, gap, margin and
    content gap, written at the breakpoint of the frame's width.
  - edit: the properties panel groups fields by intent in tabs (the block's
    own, Layout, Style, More) with a count of set values each, one breakpoint
    bar for all responsive fields (following the frame's width), spacing as
    sliders over the spacing scale that point at their band in the frame,
    values set on the block marked in copper, short enums as toggles, field
    docs behind a hint and "Only values set on this block".
  - edit: rich text sends only what was typed, without empty paragraphs or
    long `<br>` runs.
  - edit: the agent bridge follows the engine's session API: a new session is
    created with its first message, a prompt without a chosen session never
    lands in an existing one, the reply stream starts at the prompt's revision.
  - react: the edit bridge reports the selected block's measured spacing
    (`{wc: "box"}`) and outlines in the wunderwerk copper.
- Updated dependencies [3051227]
- Updated dependencies [d5031ec]
- Updated dependencies [8dd4252]
- Updated dependencies [8ef3002]
- Updated dependencies [5697d3f]
- Updated dependencies [066fc48]
- Updated dependencies [4930f1e]
- Updated dependencies [4cbacf6]
- Updated dependencies [0abc7c6]
- Updated dependencies [2cd5e1f]
  - @wunderwerkio/wundercms-core@0.2.0

## 0.1.0

### Minor Changes

- 1fb83bc: Block inspector: `inspect` render option (Next: `WUNDERCMS_INSPECT=1`) tags blocks with their content path, embeds page data and ships an overlay to outline, select and inspect blocks. `SitePage.file` holds the source file.
- 86bfbe5: The contract is enforced where projects used to bend it (ADR 0002, "Enforcement"):
  
  - Dialogs are page-level. The loader lists the dialogs a page opens (`SitePage.dialogs`) and `Page` renders each once after the footer; `ButtonEl` only toggles it. `Button.opens` next to an `#anchor` url is the dialog fallback when the anchor is not on the page (resolved at load: link or dialog, never both). `RenderContext.dialogs`, the `dialogs` render option, `Site.dialogs` and the `Dialog` export are gone. Lint rejects a dialog repeating an anchor of the page.
  - Lint rejects a Responsive value that drops a block default's `base` (e.g. `padding: {md: …}` over a default with `base` left the block without mobile padding) and warns about values restating the block default.
  - `generate` checks the site stylesheets (config `css`, default `app/globals.css`): no runtime markup (`.wc-inner`, `.wc-icon`, `.wc-<Block>` …), no classes only one block renders (they go to `blocks/<Name>/<Name>.css`) and no styling by page region (`.wc-footer .wc-button`). Theme hooks (`.wc-rich`, `.wc-button*`, page regions themselves), rich text classes and classes shared by several blocks or components stay allowed.
  - The generated CSS ships the CSS of core traits (`Background.parallax`), so no project re-implements it.
- b1c5b20: React runtime (registry, box traits, core block components) and Next.js 16 adapter (routes, metadata, sitemap).
- ed16cc5: The core schema is the contract only (ADR 0002): roles as extension points, traits, tokens, core types, rich text / SVG vocabulary, Include and slots. Every other block is project-owned (`blocks/<Name>/block.yaml` + component + optional CSS) and installed from a git-based registry (`registry/blocks`) with `wundercms add`, merged with `update` and compared with `diff`. The compiler checks block definitions (roles, slot nesting, types, style escape hatches, contract-major pins) and block rules are declarative (`oneOf`, `only`, `childPlace`, `actionOptional`, `ratioMax`). Themes extend core object types with optional fields (`extend`). `generate` emits a component map and collects block CSS. The runtime ships no block components: `createRegistry(components)`, `ownBox()` for components that render their own box, `ButtonEl` children / attrs for Button extensions. Timeline is its own block (was a Tiles mode). Button `subtitle`, `fallback`, `events`, the CKEditor data attributes and Card defaults moved to the projects / registry items.

### Patch Changes

- 5b826d1: Fixes found rendering the example sites: container classes and negative side margins safelisted, Card.textAlign CSS, card media bleed, timeline gap, marquee gap, sitemap entry (`/sitemap`), font variables on `<html>`.
- Updated dependencies [1fb83bc]
- Updated dependencies [5b826d1]
- Updated dependencies [86bfbe5]
- Updated dependencies [e603086]
- Updated dependencies [b1c5b20]
- Updated dependencies [ed16cc5]
- Updated dependencies [9a2ec2f]
  - @wunderwerkio/wundercms-core@0.1.0
