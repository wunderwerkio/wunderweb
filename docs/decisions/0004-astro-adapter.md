# 0004: Astro adapter

Status: accepted (2026-10-08); amended 2026-10-16 ([Amendment: purge the
built CSS](#amendment-2026-10-16-purge-the-built-css)). Extends [ADR
0001](./0001-architecture.md) and ADR 0003 (the edit service); changes
nothing in the contract.

Since 2026-11-27 the local `edit` command and the runtimes' dev edit mode
described here are removed: sites are edited visually in the hosted
wunderweb service, which frames a site's preview build. The edit service's
ADR (0003) stays with that service.

## Context

Sites rendered by wunderweb are static: every page is prerendered from
content, blocks render HTML and CSS, interactivity is the platform's
(popover dialogs, `<details>`, CSS marquees). Next.js ships a React
runtime and RSC payload to every page anyway. Astro renders the same React
components on the server and ships no JavaScript unless a component asks
for it. Projects want to pick the framework; the blocks, the content and
the editor must not care.

ADR 0003 kept the renderer framework-agnostic so that "another framework
adapter reuses the first two" (annotation and bridge). This is that
adapter.

## Decision

A package `@wunderweb/astro` for Astro 7, next to
`@wunderweb/next`, with the same responsibilities: routes,
head metadata, sitemap, content source, edit mode.

- **Blocks stay React components.** `@astrojs/react` compiles them; the
  adapter renders the runtime's `Page` on the server with React's
  `prerender` (complete, never hydrated) and Astro inserts the HTML. Not
  through `@astrojs/react`'s component rendering: that reads React's stream
  as it comes, so in edit mode (every block a Suspense boundary) one
  failing block left the following ones as fallbacks completed by inline
  scripts, which the in-place refresh does not run; untagged, it also
  renders a component twice to find its renderer.
- **The project owns the route and the document.** `init --astro`
  scaffolds `src/pages/[...slug].astro` with `<html>`, `<head>` (fonts,
  icons, site CSS) and two components from the package: `Head.astro`
  (title, description, robots, canonical, hreflang alternates, Open Graph
  image, as the Next adapter's `generateMetadata`) and `Page.astro`. The
  route uses `getStaticPaths()` and `loadPage(slug)`; the sitemap is an
  endpoint (`createSitemap()`), the same XML as Next's.
- **Content sources move to core.** `fileSource`, `editServiceSource` and
  the site cache (`loadProjectSite`) have no framework in them; both
  adapters use core's. The Next adapter keeps its exports and adds its
  build phase to the production guard; the Astro adapter refuses edit mode
  when `NODE_ENV` is production (`astro build`).
- **An integration for the dev server.** `wunderweb()` in
  `astro.config.mjs` requires `@astrojs/react` and, in `astro dev`, marks
  the content route on demand (`astro:route:setup`): Astro caches
  `getStaticPaths` per module in dev, so new pages and the edit service's
  revisions would not show until a restart. `astro build` prerenders it.
  In edit mode it hides the dev toolbar (the editor's frame) and adds the
  hosts in `ALLOWED_DEV_ORIGINS` (`wunderweb edit --share`) to
  `server.allowedHosts`.
- **Refresh in place.** Next refreshes with `router.refresh()`. Astro has
  no client router on these pages: the adapter inlines a refresh (like the
  bridge, a serialised function) that fetches the page again (the
  production render path) and replaces the body elements that changed;
  unchanged ones keep their DOM (scroll, open dialogs, playing videos).
  One refresh at a time, as with Next. A failed fetch reloads.
- **No client error boundary.** In edit mode a block that throws while
  rendering shows the placeholder of its Suspense fallback, the other
  blocks render, as with the Next adapter's client boundary. Outside edit
  mode a failing block fails the build.
- **CLI.** `wunderweb edit --astro` starts `astro dev` like `--next` starts
  `next dev`; for a local site it binds 127.0.0.1 (`astro dev` binds what
  `localhost` resolves to, often only `::1`, which a port share cannot
  reach). `wunderweb init --astro` scaffolds the Astro app.

## Consequences

- `examples/astro` (the `init --astro` starter) is built in CI and the
  editor runs against it in a browser test, as against the Next example.
- Projects deploy Astro's static output; a server is only needed for
  redirects with status codes (e.g. `@astrojs/node`).
- The adapter shows Astro's note that `getStaticPaths` is ignored in dev
  (on-demand route) once per start.
- Interactive blocks would need an island (`client:*`) of their own; the
  runtime renders none today.

## Amendment (2026-10-16): purge the built CSS

### Context

A site's generated CSS safelists every theme token for every breakpoint
(`@source inline`), so the visual editor can use any of them live without
a rebuild. The built stylesheet carries all of them: on wunderwerk.io
240 KB (33 KB gzip), render-blocking on every page, of which a page uses a
fifth. Deriving the safelist from content instead needs a second
content → class mapping next to the blocks' own, and would make
`generate --check` fail on content edits. Critical CSS risks a flash of
unstyled content.

### Decisions

- **Opt-in purge after the build:** `wunderweb({ purgeCss: true })` runs
  in `astro:build:done` (`purge.ts`, postcss and postcss-selector-parser).
  `astro dev`, and so the editor, keeps the full CSS.
- **Used** is a token match over the whole text of the build: every
  prerendered HTML file (attributes, `<template>` content, inline scripts)
  and every client script, also with HTML entities and JS string escapes
  decoded. A class counts where it stands between delimiters of markup and
  code (whitespace, quotes, `=`, `<`, `>`, brackets, `,`, `;`), not inside
  a longer class name: `md:px-4` does not use `px-4`. The class itself may
  contain any character (`[&>svg:not([class*='size-'])]:size-4`).
- **A rule goes only when it cannot match:** each of its selectors
  requires an unused class, in one of its compound selectors or in every
  argument of an `:is()` / `:where()`. Classes inside `:not()`, `:has()`
  and other functions never remove a rule. `@layer` statements,
  `@property`, `@keyframes`, `@font-face` and unknown at-rules stay;
  `@layer`, `@media`, `@supports`, `@container` and `@starting-style`
  blocks are purged inside and dropped when emptied (an emptied `@layer`
  block that declared its layer first stays as a statement).
- **Steps aside with a warning** where the build does not show all markup:
  the project's on-demand pages (`astro:routes:resolved`; Astro's own
  routes, such as the server islands endpoint every server build has, do
  not count) or an island in the HTML (`client:*`, `server:defer`) skip the
  purge; a stylesheet a script, a client JSON file (a precache list may pin
  it with a revision) or another stylesheet names is left as it is.
- **Never breaks the build.** Every stylesheet is purged in memory first; one
  that cannot be (e.g. unparseable) stays as it is. Then the new files and the
  rewritten references (each through a temporary file renamed over it) are
  written, and only then the old files go. A failure while writing removes
  what was written: the build keeps its original CSS, with a warning.
- **Renamed after its content.** Assets are served `immutable` by name, but
  the name Vite gave the file hashes the unpurged content. The purged file
  gets the hash of its own content; the HTML and the server output
  (manifest) are rewritten to it and the old file is removed.
- One log line per purged file: names, sizes, removed selectors.

### Consequences

- A class a browser script adds must be written out literally in the
  script (no `"is-" + state`); a class built at runtime loses its rules.
- The editor still uses any token live; a production build only ships
  what the content uses, so new content needs a build, as it does anyway.
- Sites with on-demand pages or islands get the full CSS until the purge
  can see their markup.

## Amendment (2026-11-12): purge inlined stylesheets

Sites inline their CSS (`build: { inlineStylesheets: "always" }`) to save
the render-blocking request before the first paint. Astro then writes no
stylesheet to `_astro/`, and the purge, which only rewrote those files, did
nothing: wunderwerk.io inlined its full 260 KB instead of the purged 51 KB.

- Every `<style>` of the prerendered HTML is purged in place by the same
  rules, once per distinct CSS text (the same stylesheet is inlined in every
  page). One log line sums them up: pages, sizes, removed selectors.
- The used classes are read from the HTML **without** the contents of its
  `<style>` elements: CSS that names a class is no evidence that a page uses
  it.
- `<style>` text inside a `<script>`, a comment or a `<textarea>` is no
  stylesheet: it is neither purged nor removed from the evidence.
- A `<style>` that cannot be parsed stays as it is (a warning). Linked
  stylesheets are purged and renamed as before, in the same pass, so a site
  may mix both.

## Amendment (2026-11-19): preview mode (wunderweb)

### Context

The hosted editor (wunderweb, plan m3wn47) frames a preview of a
changeset that has not been published yet. Phase 0 proved the approach in
`examples/astro`: one commit makes a static build and a preview server,
access is checked by forward-auth, and the page comes from the content
service per request. Step 1.5 moves it into the adapter and core.

### Decisions

- **Two outputs, one commit.** `astro build` stays the static site.
  `WUNDERWEB_PREVIEW=1 astro build` (with a server adapter, e.g.
  `@astrojs/node`) is the preview build. The integration renders the
  content route on demand there, together with the site's
  `previewRoutes` (sitemap, custom routes, 404). Every other route stays
  static. CSS purge steps aside, as for any on-demand page.
- **`isPreview`** is true in a preview build only. The integration defines
  it at build time and bundles the adapter in that build, so the define
  reaches it.
- **`sourceFor(request)`**: in a preview build this is core
  `previewSource(request)`, the content service at `WUNDERWEB_CONTENT_URL`
  (read at run time). One attempt per request, never a fallback to the
  files, allowed in production. Otherwise it is `defaultSource()`, so
  files and edit mode are unchanged. `loadPage(slug, {request})` and
  `createSitemap()` take the request's source. A static build ignores
  `WUNDERWEB_CONTENT_URL`. `WUNDERWEB_EDIT_URL` in a production build is
  refused, as before.
- **Two modes on one deployment.** A framed request (`Sec-Fetch-Dest:
  iframe`, or the in-place refresh's `X-Wunderweb-Frame`) is rendered
  annotated with the bridge. Any other request takes the production render
  path.
- **Access.** Forward-auth sets `X-Wunderweb-Preview-Token`, and
  `previewSource` sends it back to the content service, which checks the
  reader's right. The site holds no credential.
- **`previewHeaders`** marks preview responses: `no-store`, `noindex`, and
  `vary` on the frame headers.
- **Extension fields.** `SitePage.extend` carries the page's
  `extend.Page` fields (resolved like the rest), so site code no longer
  reads page YAML from disk, which a preview does not have.
