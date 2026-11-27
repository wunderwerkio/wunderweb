# @wunderwerkio/wundercms-next

## 0.5.0

### Minor Changes

- d154100: Visual editing happens only in the hosted editor (wunderweb). Removed: the CLI's `edit` command, the edit server, the coding agent bridge and the prompt bar; the runtimes' dev edit mode (`WUNDERCMS_EDIT_URL`, `editServiceSource`, Next's `edit-refresh` entry and `inspect` option). The canonical YAML formatter (`formatYaml`, `NOT_CANONICAL`, `YAML_OPTIONS`) and the frame protocol types (`ToBridge`, `FromBridge`, `Rect`, `Edges`, `BoxModel`) are in core now. `format`, `generate` and `lint` work as before.
- d154100: wundercms is now wunderweb: the packages are `@wunderweb/{core,cli,react,astro,next}` (MIT), the CLI is `wunderweb`, the site config `wunderweb.config.yaml`, the generated stylesheet `generated/wunderweb.css`, the schema `urn:wunderweb:…`, the default registry `wunderweb` at `https://github.com/wunderwerkio/wunderweb.git`, the package blocks key `"wunderweb"`, the Astro integration `wunderweb()`, the env vars `WUNDERWEB_*`. The old config file name, package blocks key and registry name are still read, with a deprecation warning. `wunderweb migrate` renames a site in place (`--check`: dry run).

### Patch Changes

- Updated dependencies [d154100]
- Updated dependencies [d154100]
  - @wunderweb/core@0.5.0
  - @wunderweb/react@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [9d08469]
  - @wunderwerkio/wundercms-core@0.4.0
  - @wunderwerkio/wundercms-react@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [a860ede]
- Updated dependencies [c21c522]
- Updated dependencies [4b8ff2a]
- Updated dependencies [5df5cd2]
  - @wunderwerkio/wundercms-core@0.3.0
  - @wunderwerkio/wundercms-react@0.3.0

## 0.2.0

### Minor Changes

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

### Patch Changes

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
- 8f20b8f: Dev server reloads content per request; the site is cached once per process only in production.
- Updated dependencies [1fb83bc]
- Updated dependencies [5b826d1]
- Updated dependencies [86bfbe5]
- Updated dependencies [e603086]
- Updated dependencies [b1c5b20]
- Updated dependencies [ed16cc5]
- Updated dependencies [9a2ec2f]
  - @wunderwerkio/wundercms-core@0.1.0
  - @wunderwerkio/wundercms-react@0.1.0
