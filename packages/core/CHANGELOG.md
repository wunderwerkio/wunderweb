# @wunderwerkio/wundercms-core

## 0.5.0

### Minor Changes

- d154100: Visual editing happens only in the hosted editor (wunderweb). Removed: the CLI's `edit` command, the edit server, the coding agent bridge and the prompt bar; the runtimes' dev edit mode (`WUNDERCMS_EDIT_URL`, `editServiceSource`, Next's `edit-refresh` entry and `inspect` option). The canonical YAML formatter (`formatYaml`, `NOT_CANONICAL`, `YAML_OPTIONS`) and the frame protocol types (`ToBridge`, `FromBridge`, `Rect`, `Edges`, `BoxModel`) are in core now. `format`, `generate` and `lint` work as before.
- d154100: wundercms is now wunderweb: the packages are `@wunderweb/{core,cli,react,astro,next}` (MIT), the CLI is `wunderweb`, the site config `wunderweb.config.yaml`, the generated stylesheet `generated/wunderweb.css`, the schema `urn:wunderweb:…`, the default registry `wunderweb` at `https://github.com/wunderwerkio/wunderweb.git`, the package blocks key `"wunderweb"`, the Astro integration `wunderweb()`, the env vars `WUNDERWEB_*`. The old config file name, package blocks key and registry name are still read, with a deprecation warning. `wunderweb migrate` renames a site in place (`--check`: dry run).

## 0.4.0

### Minor Changes

- 9d08469: `parseConfig(text)` reads a `wundercms.config.yaml` from its text, with the defaults filled in and the same checks as `loadProject`, for a service that reads the config from git instead of a directory.

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
- 4b8ff2a: Changesets:
  
  - Core `netChanges(base, proposed)` returns the minimal changes, addressed
    by block id (fields, and inserts, removals and moves of blocks).
  - Core `rebase(changes, base, current, {validate})` merges three ways. Each
    change is reported as applied, done, a conflict (`changed`, `gone` or
    `neighbour`) or incompatible.
  - Edit `rebaseText` writes the result into the newer YAML text, keeping its
    comments and quoting.
- 5df5cd2: Edits addressed by block id (edit protocol 2).
  
  - `set`, `unset`, `insert` and `remove` take an optional `block` id, and
    their `path` is then relative to that block. `move` takes `block` and
    `toBlock`.
  - Core adds `findBlock`, `resolveEdit`, `anchorEdit` and `anchorPath`.
    `applyEdit` resolves anchors and gives an anchored edit an anchored
    inverse.
  - The edit service replays unsaved edits by id after a change on disk. It
    accepts field edits addressed by id even when a foreign revision moved
    blocks in between.
  - The editor sends edits anchored to the innermost block with an id. A
    selected block stays selected when it moves.
  - The editor and the service must both speak protocol 2.

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
- d5031ec: Compact consent banner (ADR 0005 amendment).
  
  - astro: "settings" is a text link next to the privacy link; the banner
    keeps two buttons, "only necessary" then "accept all" (right edge, also on
    a line of their own). Phones (up to 40rem): title for screen readers only,
    smaller type, both buttons side by side (about 140px instead of 300–380px
    high). Every consent button shows the pointer cursor.
  - core: shorter banner text (DE / EN) that names the purpose and the
    withdrawal. `consent.style.reject` gives "only necessary" its own
    ButtonVariant (default: `choice`); lint rejects an unknown variant.
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
- 4930f1e: imgproxy transformer (ADR 0007).
  
  - astro: `imgproxyTransformer({ key, salt, size, prefix?, source? })` makes
    no files: every srcset candidate is a signed, extensionless imgproxy url
    (`/_img/<signature>/rs:fit:<w>:0/<base64url(source)>`), the last one the
    original at full size, so imgproxy serves AVIF or WebP by `Accept`.
    `imgproxySignature(path, key, salt)`. `responsiveImages(page, astro,
    { transformer })` uses a given transformer instead of Astro's image service.
  - core: `ImageTransformer.full?(url, size)`, the url of the last
    (full-size) srcset candidate; default the original's url, as before.
- 4cbacf6: Blocks from npm packages and deprecated fields (ADR 0008).
  
  - core: config `packages` lists npm packages whose blocks (`"wundercms":
    {"blocks": "./blocks"}` in their package.json) the site uses next to
    `blocks/`. `projectBlocks(project)` merges both (a name defined twice is
    a SchemaError); `generate` imports package blocks by package specifier,
    adds their CSS and a Tailwind `@source`, and the site CSS check counts
    their classes for their block. `loadProject` rejects a package listed
    twice, not installed, without an existing blocks directory inside it, or
    not exporting it. `Project.packageBlocks`,
    `componentClasses(root, blocksDir, packageBlocks?)`.
  - core: an optional field's long form takes `deprecated: true`: still valid, marked
    in the JSON Schema and `types.ts`, and `lint` warns for each value that
    sets it.
  - cli: `add` refuses a block a package provides; `add` and `update` skip
    dependencies a package provides and check the contract with package
    blocks.
  - edit: the schema watcher also watches package block directories.
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

## 0.1.0

### Minor Changes

- 1fb83bc: Block inspector: `inspect` render option (Next: `WUNDERCMS_INSPECT=1`) tags blocks with their content path, embeds page data and ships an overlay to outline, select and inspect blocks. `SitePage.file` holds the source file.
- 86bfbe5: The contract is enforced where projects used to bend it (ADR 0002, "Enforcement"):
  
  - Dialogs are page-level. The loader lists the dialogs a page opens (`SitePage.dialogs`) and `Page` renders each once after the footer; `ButtonEl` only toggles it. `Button.opens` next to an `#anchor` url is the dialog fallback when the anchor is not on the page (resolved at load: link or dialog, never both). `RenderContext.dialogs`, the `dialogs` render option, `Site.dialogs` and the `Dialog` export are gone. Lint rejects a dialog repeating an anchor of the page.
  - Lint rejects a Responsive value that drops a block default's `base` (e.g. `padding: {md: …}` over a default with `base` left the block without mobile padding) and warns about values restating the block default.
  - `generate` checks the site stylesheets (config `css`, default `app/globals.css`): no runtime markup (`.wc-inner`, `.wc-icon`, `.wc-<Block>` …), no classes only one block renders (they go to `blocks/<Name>/<Name>.css`) and no styling by page region (`.wc-footer .wc-button`). Theme hooks (`.wc-rich`, `.wc-button*`, page regions themselves), rich text classes and classes shared by several blocks or components stay allowed.
  - The generated CSS ships the CSS of core traits (`Background.parallax`), so no project re-implements it.
- e603086: Core schema v1, compiler, validator, site loader and Tailwind mapping.
- b1c5b20: React runtime (registry, box traits, core block components) and Next.js 16 adapter (routes, metadata, sitemap).
- ed16cc5: The core schema is the contract only (ADR 0002): roles as extension points, traits, tokens, core types, rich text / SVG vocabulary, Include and slots. Every other block is project-owned (`blocks/<Name>/block.yaml` + component + optional CSS) and installed from a git-based registry (`registry/blocks`) with `wundercms add`, merged with `update` and compared with `diff`. The compiler checks block definitions (roles, slot nesting, types, style escape hatches, contract-major pins) and block rules are declarative (`oneOf`, `only`, `childPlace`, `actionOptional`, `ratioMax`). Themes extend core object types with optional fields (`extend`). `generate` emits a component map and collects block CSS. The runtime ships no block components: `createRegistry(components)`, `ownBox()` for components that render their own box, `ButtonEl` children / attrs for Button extensions. Timeline is its own block (was a Tiles mode). Button `subtitle`, `fallback`, `events`, the CKEditor data attributes and Card defaults moved to the projects / registry items.
- 9a2ec2f: Stepped containers: `ContainerSize` tokens accept `content` widths per step (breakpoint or px min-width); `max` and `gutter` accept steps too.

### Patch Changes

- 5b826d1: Fixes found rendering the example sites: container classes and negative side margins safelisted, Card.textAlign CSS, card media bleed, timeline gap, marquee gap, sitemap entry (`/sitemap`), font variables on `<html>`.
