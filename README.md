# wunderweb

Versioned layout schema, CLI and React runtime for content-driven sites.
Pages are YAML files in git, validated against a closed schema (no class
names, no inline CSS), rendered by React components your project owns.

The core schema is the contract (roles, traits, tokens, rich text, Include
and slots); every block, layout or content, is a project file installed from
a git-based registry and adapted locally.

| Package | Role |
| --- | --- |
| `@wunderweb/core` | Contract (core schema) per version, compiler and block definition checks, validator, site loader, Tailwind mapping |
| `@wunderweb/cli` | `init`, `generate`, `lint`, `format`, `add`, `update`, `diff`, `add-block`, `migrate` |
| `@wunderweb/react` | Renderer, box traits, helpers for block components (rich text, SVG, media, button, icon, dialog, class helpers); the editor's annotation and bridge |
| `@wunderweb/next` | Next.js 16 App Router adapter: routes, metadata, sitemap; content from the files |
| `@wunderweb/astro` | Astro 7 adapter: integration, content route helpers, head metadata, sitemap; content from the files, or from the content service in a preview build |

Install them from npm (`npm install @wunderweb/astro @wunderweb/react
@wunderweb/core`, `npm install -D @wunderweb/cli`); no token or registry
setting is needed. MIT licensed (LICENSE).

Sites are edited visually in the hosted wunderweb service (not part of this
repository); everything here works without it.

`registry/blocks` is the default block registry (Section, SideBySide, Tiles,
Stack, Text, Media, Buttons, Card, Accordion, List, Gallery, Badge, Divider,
Person, Rating, IconBlock, Timeline).

- [ADR 0001: Architecture](docs/decisions/0001-architecture.md)
- [ADR 0002: The core schema as the contract, project-owned blocks](docs/decisions/0002-schema-contract.md)
- [ADR 0004: Astro adapter](docs/decisions/0004-astro-adapter.md)
- [ADR 0005: Consent](docs/decisions/0005-consent.md)
- [ADR 0006: Images: first block priority, responsive copies](docs/decisions/0006-images.md)
- [ADR 0007: imgproxy transformer](docs/decisions/0007-imgproxy.md)
- [ADR 0008: blocks from npm packages](docs/decisions/0008-package-blocks.md)
- [Registry](registry/README.md)
- [Roadmap](docs/roadmap.md)

## Use

```sh
pnpm add @wunderweb/next @wunderweb/react @wunderweb/core
pnpm add -D @wunderweb/cli tailwindcss @tailwindcss/postcss
pnpm exec wunderweb init --locales de,en --assets https://my-bucket.s3.eu-central-1.amazonaws.com
```

```
wunderweb.config.yaml     schema version, locales, asset base, chrome fragments, registries
theme.yaml                token values, core type extensions (`extend`), rich text additions
blocks/<Name>/            block.yaml (roles, fields, defaults, rules, provenance),
                          <Name>.tsx (component), <Name>.css (optional)
content/<locale>/pages    pages; same `id` across locales = translations
content/<locale>/fragments  header, footer, shared sections (Include + slots)
generated/                schema.json, types.ts, components.ts, wunderweb.css
                          (commit; `generate --check` in CI)
app/[[...slug]]/          catch-all route from `init`
app/globals.css           site CSS (config `css`): type, button variants, rich text
                          classes - checked by `generate`, never block internals
```

### Astro

`init --astro` scaffolds an Astro 7 app instead of the Next.js one. The
blocks stay the same React components (compiled by `@astrojs/react`),
rendered on the server without hydration (no client JavaScript for
content).

```sh
pnpm add astro @astrojs/react react react-dom @wunderweb/astro @wunderweb/react @wunderweb/core
pnpm add -D @wunderweb/cli tailwindcss @tailwindcss/vite
pnpm exec wunderweb init --astro --locales de,en
```

```
astro.config.mjs            integrations: [react(), wunderweb()], Tailwind (Vite plugin), dev port 3000
src/pages/[...slug].astro   every content page: getStaticPaths, loadPage, <Head>, <Page>
src/pages/sitemap.xml.ts    export const GET = createSitemap()
src/styles/global.css       site CSS (config `css: [./src/styles/global.css]`)
```

The page owns `<html>` and `<head>` (fonts, icons, site CSS); `<Head
page>` adds title, description, robots, canonical and hreflang alternates,
`<Page page registry>` the header, main, footer and dialogs. `astro build`
prerenders every page from `getStaticPaths`; in `astro dev` the
integration renders the content route on demand, so new pages and content
edits show without a restart (Astro notes once that `getStaticPaths` is
ignored there).

`wunderweb({ purgeCss: true })` shrinks the built CSS: the generated CSS
safelists every token for every breakpoint (the editor uses any of them
live), and after `astro build` the integration removes the rules whose
selectors require a class that appears nowhere in the build (HTML and
client scripts), then renames each purged stylesheet after its content and
rewrites the HTML and server manifest to it (one log line per file). A
class a browser script adds must be written out literally in the script.
Stylesheets Astro inlines (`build.inlineStylesheets`) are purged in place in
each page's `<style>`, with one summary log line; the CSS itself never
counts as a use.
Builds with on-demand pages or islands are skipped with a warning, as is a
stylesheet a script, a client JSON file or another stylesheet names; a
failure leaves the original CSS. `astro dev` keeps the full CSS. Details: [ADR 0004
amendment](docs/decisions/0004-astro-adapter.md#amendment-2026-10-16-purge-the-built-css),
inlined stylesheets: [amendment
2026-11-12](docs/decisions/0004-astro-adapter.md#amendment-2026-11-12-purge-inlined-stylesheets).

Loop: edit `theme.yaml` or a block → `wunderweb generate`; edit content →
`wunderweb lint` (editor autocomplete via the generated JSON Schema).

Blocks: `wunderweb add Accordion` installs a registry item (default: the tag
of the installed runtime; `--ref` for another tag, branch or commit) and
records where it came from. Edit it like any project code; `wunderweb diff
Accordion` shows local and upstream changes, `wunderweb update Accordion`
merges a newer version (three-way, conflict markers on overlap).
`wunderweb add-block Hero --in Row` scaffolds a block written from scratch.
Registries are read with your git credentials (SSH or `gh auth setup-git`).

Blocks from npm packages: `packages: ["@acme/kit"]` in
`wunderweb.config.yaml` uses the blocks of an installed package as they are,
next to `blocks/` (the package's `package.json` names its blocks directory,
`"wunderweb": {"blocks": "./blocks"}`, and exports it). `generate` imports
them by package specifier and adds the directory as a Tailwind `@source`; a
block name defined twice is an error, and `add` refuses a block a package
provides. The package ships TypeScript source: the site compiles it (Vite
`ssr.noExternal`, Next.js `transpilePackages`, and `allowImportingTsExtensions`
in tsconfig for the `.tsx` specifiers). An optional field marked
`deprecated: true` (long form) stays valid; `lint` warns where content sets
it. Details: [ADR 0008](docs/decisions/0008-package-blocks.md).

Links: `page:<id>` resolves to the page in the current locale
(`/meine-seite`, `/en/my-page`). Root-relative asset urls resolve against
`assets`. Dialogs: `Button.opens` shows a fragment in a dialog, rendered once
per page; with an `#anchor` url it is the fallback when the anchor is not on
the page.

Styling: a look belongs to a token (theme), a field or variant (block) or a
rich text class (theme), never to its context. `generate` rejects site CSS
that targets runtime markup, the internals of one block (put them in
`blocks/<Name>/<Name>.css`) or blocks inside a page region
(`.wc-footer .wc-button`). `lint` rejects responsive values that drop a
block default's `base`.

### From wundercms

wunderweb was called wundercms. In a site that still has the old names,
run once (and commit the result):

```sh
npx @wunderweb/cli migrate --check   # what would change
npx @wunderweb/cli migrate
npm install
```

`migrate` renames `wundercms.config.yaml`, the registry entry and its URL,
the provenance in `blocks/*/block.yaml`, the `@wunderwerkio/wundercms-*`
imports and dependencies (to `@wunderweb/*`), the `wundercms` commands in
`package.json` scripts, `WUNDERCMS_*` variables in source, and regenerates
`generated/` (`wunderweb.css`, `urn:wunderweb:…`). It lists what it leaves
to you (docs, Dockerfiles, CI). Running it again changes nothing. Until
then the CLI, core and the hosted service still read the old config file
name, package blocks key (`"wundercms": {"blocks"}`) and registry name,
with a deprecation warning.

## Images

**First block.** `<Page>` renders the page's first block with
`ctx.priority`: its background image loads at once with
`fetchpriority="high"` (it is usually the largest contentful paint), every
other image lazily. A first block hidden at some breakpoint (`visible`)
does not get it (an eager image loads even where it is hidden), nor do its
child blocks or the header. `<Blocks priority>` does the same for other
lists. No `<link rel=preload>` is added: the image is in the HTML, so the
browser's preload scanner finds it (ADR 0006). React's server renderer
hoists such a hint for an eager high-priority image on its own; the Astro
adapter drops hoisted hints, as before.

**Responsive images.** An adapter can give every jpg / png / webp image a
srcset of smaller copies. Astro, in `src/pages/[...slug].astro`:

```astro
---
import { getImage, inferRemoteSize } from "astro:assets";
import { loadPage, responsiveImages } from "@wunderweb/astro";
const loaded = await loadPage(Astro.params.slug);
if (!loaded) return new Response(null, { status: 404 });
const page = await responsiveImages(loaded, { getImage, inferRemoteSize });
---
```

- `responsiveImages` (astro) measures each image (`inferRemoteSize`, its
  header only, no transform) and makes webp copies (quality 85, `getImage`)
  at the widths of core's `IMAGE_WIDTHS` (64…3840 px, each step at most
  1.5×) below the original; `astro build` writes them to `/_astro/`
  (hashed, immutable). Remote images need their host in `image.domains`.
  An image that cannot be measured or resized keeps its original, with one
  warning per reason (its own hint); failures are not cached, so `astro
  dev` retries them. Pages in the editor's frame are returned untouched.
- **imgproxy instead of build-time copies** (ADR 0007): create the
  transformer once per build, in a module of its own (a page's frontmatter
  runs per page, and the transformer's size cache and warnings should span
  the pages), and pass it as `responsiveImages`' third argument:

  ```ts
  // src/images.ts
  import { inferRemoteSize } from "astro:assets";
  import { imgproxyTransformer } from "@wunderweb/astro";
  export const transformer = imgproxyTransformer({ key, salt, size: inferRemoteSize });
  // [...slug].astro: responsiveImages(loaded, { getImage, inferRemoteSize }, { transformer })
  ```

  Every candidate is then a signed,
  extensionless imgproxy url on the site's own host
  (`/_img/<signature>/rs:fit:<w>:0/<base64url(source)>`; `prefix` changes
  `/_img`), the last one the original at full size; imgproxy picks AVIF or
  WebP from the browser's `Accept`. No files are made. `key` and `salt` are
  imgproxy's hex-encoded pair (a build secret); `source` maps an Asset url
  to the url imgproxy may fetch (e.g. the bucket behind a CDN host). The
  server must match (ADR 0007, Consequences).
- core `resolveImages(page, transformer)` does this for any adapter with
  an `ImageTransformer` (`size(url)`, `resize(url, size, widths)`,
  optionally `full(url, size)`): each image Asset gets `srcset: [{url,
  width, height}, …]`, ascending, the original last at its real size (at
  `full`'s url if the transformer has one). Copies keep the original's
  exact aspect ratio where a width within 5% allows it. Cover and anchored
  backgrounds get none: how wide they are drawn depends on the box height.
  A transformer with `background(url, size, crop?)` (imgproxy: full size at
  `backgroundQuality`, default 55) gives them that one url, rendered as
  `srcSet="<url> 1x"` (react `fullSrcSet`). The first block's cover
  background also gets `portrait`, the center crop at full height and 3:4
  (`PORTRAIT_RATIO`), which a `<picture>` serves to upright phones
  (`PORTRAIT_MEDIA`): their tall box shows only that strip. A `fill` Media
  (cover in a box of unknown shape) gets the `full` candidate at 1x, except
  for a WebP source, which re-encoding at the same size makes larger.
  Video posters (`<video poster>` takes one url, no srcset) get the
  transformer's `poster(url, size)` as `posterSrc` (imgproxy: at most
  `posterWidth`, default 960, at `backgroundQuality`); renderers use react
  `posterOf(asset)`, which falls back to the original `poster`.
  A transformer that throws for an image leaves it with its original
  (`onError`, default a warning); the page still renders.
- Blocks offer them with react `imageSrcSet(asset, box)`, which returns
  `srcSet` and `sizes` for the box the image is drawn in:

  ```tsx
  <img src={a.url} {...imageSrcSet(a, { width: 56, height: 56, fit: "cover" })} … />
  ```

  `box`: what the CSS fixes. `width` (px) gives `sizes="<width>px"` and
  only the candidates a browser picks at 1, 1.5, 2 and 3× (plus the
  original), keeping the HTML small; without it `sizes="auto, 100vw"`
  (lazy images; `{ eager: true }` gives `100vw`) and every candidate. A
  box sized in rem (Tailwind `size-14`, `h-6`) is given with `unit: "rem"`:
  `sizes` is then in rem, which the browser resolves against the user's
  default font size like the CSS, and the candidates also cover a 20px
  default. A site that pins the root font size (`html { font-size: 16px }`)
  has px boxes: give them in px. `fit: "cover"` with a known box shape
  (`width` and `height`, or `ratio`) divides each descriptor by how much
  wider the image is drawn than its box; cover with an unknown shape gets
  no srcset. Without `fit` the box takes its shape from the image (`h-auto`,
  or `w-auto` with a `height`): only copies of the exact ratio, so nothing
  shifts when a copy loads. A browser never picks a copy narrower than the
  drawn width × device pixel ratio; the original stays `src`.
  `MediaElement`, contain / fill backgrounds and the registry's Person,
  Gallery and Rating use it.

## Consent

A `consent` section in `wunderweb.config.yaml` adds a consent banner,
settings, gates for third-party content, Google Consent Mode v2
(Advanced) and the Meta Pixel ([ADR 0005](docs/decisions/0005-consent.md)).
Without it nothing changes.

```yaml
consent:
  version: 1                     # raise to ask every visitor again
  privacy: "page:privacy"
  hosts: [example.com, www.example.com]   # tags never load elsewhere (previews, localhost)
  load: idle                     # default: vendor scripts after the page; eager: at once
  categories:
    statistics: [analytics_storage]
    marketing: [ad_storage, ad_user_data, ad_personalization]
    media: []                    # remote videos and embeds
  vendors:
    google: {ids: [G-XXXXXXX, AW-123456789]}
    meta: {id: "1234567890", category: marketing}
  style: {surface: paper, text: ink, choice: primary, quiet: secondary}
  # reject: outline  # own variant for "only necessary" (default: choice); legal risk, see ADR 0005
  text: {de: {categories: {media: {vendors: [YouTube, Google Kalender]}}}}
```

Astro: two lines in the content route.

```astro
<head><meta charset="utf-8" /><ConsentHead page={page} /> …</head>
<body><Consent page={page} /><Page page={page} registry={registry} /></body>
```

(`@wunderweb/astro/ConsentHead.astro`, `…/Consent.astro`;
both render nothing in the editor's frame.)

- The banner: text with the privacy and "settings" links, then "only
  necessary" and "accept all" (last, at the right edge) as two equal
  buttons (unless `style.reject`). On phones (up to 40rem) the title is for screen readers only and
  the buttons sit side by side, so the banner stays about 140px high.
- `remote-video` Assets are gated automatically (category `media`): a
  placeholder naming the vendor, "load once", "always allow external
  media", a link to the original without JavaScript.
- Project blocks use the same gate: `<ConsentGate ctx={ctx}
  category="media" vendor="Google Kalender" fallback={url}>…</ConsentGate>`.
- `consent:settings` as a Button url (or a rich text link) opens the
  settings, e.g. in the footer or the privacy policy.
- Site scripts: `window.wcConsent` (`get()`, `set(choice)`,
  `grant(category)`, `open()`, `onChange(fn)`) and the `wc-consent` event
  on `document`; `gtag` is always defined.
- Vendor scripts stay off the critical path: `gtag.js` (and `fbevents.js`
  after a Marketing grant) are added after the page's load event when the
  browser is idle; the Consent Mode commands, `config` and site events
  queue until then. `load: eager` adds them at once. The inline script is
  minified from `packages/react/src/consent-script.js` into the generated
  `consent-script.min.ts` (`node scripts/consent-script.mjs` in the react
  package; build and typecheck keep it current).
- Browser tests: `WUNDERWEB_CONSENT_HOSTS=localhost` lets tags load on
  localhost (in production builds only loopback hosts are taken).

## Visual editing

Sites are edited visually in the hosted wunderweb service: its editor
frames the site's preview build (Astro, `WUNDERWEB_PREVIEW=1`, see "Astro")
and keeps every change in a changeset until it is published as a commit. A
Next.js site is edited in its YAML. Without the service, content stays plain
YAML in git: edit it in the IDE or through a coding agent, and check it with
`generate --check` and `lint` in CI.

What a site keeps with the editor is in this repository: the preview build
and its content source (`previewSource`, `WUNDERWEB_CONTENT_URL`), the
annotation of a framed page and the bridge (`@wunderweb/react`), the frame
protocol (core's `ToBridge` / `FromBridge`), and the canonical YAML form
(`wunderweb format`).

Comments, quoting and key order of the YAML are kept, so diffs show only
the change. A file written in another YAML style (e.g. `{ a: 1 }`, lists
not indented) cannot be patched in place: `wunderweb format` rewrites it in
the editor's form, content and comments kept; `wunderweb lint` warns about
such files. Files the editor cannot rewrite exactly (aliases, merge keys,
YAML errors) are changed in the repository.

For coding agents editing content: change only what the task needs instead
of rewriting whole files, and run `wunderweb format` (and `wunderweb lint`)
afterwards, so the files stay editable in the hosted editor.

## Examples

`examples/astro` is the `init --astro` starter (de / en, with consent): the
build and the consent browser test of the Astro adapter. It installs its
blocks from this repository's working tree (`registries` in its config).
`examples/astro-kit` uses the blocks of the package `examples/kit`
(config `packages`, ADR 0008).

## Development

```sh
mise install
pnpm install
pnpm lint && pnpm build && pnpm typecheck && pnpm test
```

Record changes with `pnpm changeset`. All packages share one version.
