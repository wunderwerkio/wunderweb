# 0002: The core schema as the single contract, all blocks project-owned

Status: accepted (2026-09-30). Supersedes the "Core schema" and "Custom
blocks" sections of [ADR 0001](./0001-architecture.md).

## Context

ADR 0001 wanted a core schema with "nothing project-specific", yet the core
defined concrete blocks and fields that existed because one of the two
example sites needed them (Person, Badge, Gallery, the Tiles timeline mode,
marquee, Button subtitle / fallback / events, CKEditor data attributes, …),
and the validator named a project block (`Form`). Projects could add blocks
but not adapt the ones core shipped: a Card or Section needing one more
option meant a core change, `.wc-*` CSS overrides or waiting for a release.
Core versions are immutable and additive-only, so every such tweak would
stay in the core forever.

Nothing is published yet (all packages at `0.0.0`), so core v1 is rewritten
in place. After the first publish the immutability and additive-only rules
apply to the contract.

## Decisions

### Contract scope

The core schema (`packages/core/core/<major>.yaml`) says what a page accepts,
not which blocks exist:

- roots (Page, Fragment) and the five roles, ordered PageBlock > Row >
  Content > Leaf > Inline;
- traits (Box, Surround, Linkable);
- token types (Color, ButtonVariant, ContainerSize, Breakpoint) and scales;
- primitive and object types used by traits or mechanisms (Asset, Link,
  Button, Icon, Background, Placement, BoxLayout, RichText, Svg, Url, …);
- the rich text and SVG vocabulary;
- the mechanisms: Include with slots, `page:` links, i18n, dialogs
  (`Button.opens`).

Include is the only core block. Roles are extension points: in core,
`PageBlock = Row | Include`, `Row = Content`, `Content = Leaf`, and Leaf and
Inline are empty. A role nobody joins accepts nothing (JSON Schema `not: {}`,
TypeScript `never`). Rules on core types stay in core: a Button needs url or
opens, an Icon needs svg or text, parallax needs an asset.

### Project-owned blocks

Every other block, layout (Section, SideBySide, Tiles, Stack, Timeline) and
content (Text, Card, …), is a project file: `blocks/<Name>/block.yaml`
(schema), `<Name>.tsx` (component exporting `<Name>`) and optional
`<Name>.css`. `block.yaml` declares its roles (`in`), traits, fields,
defaults, the types it uses, declarative rules and, when installed from a
registry, its provenance. `theme.yaml` keeps tokens, core type extensions
(`extend`: optional fields only) and the rich text vocabulary.

`generate` compiles core + theme + blocks, emits types, a component map
(`generated/components.ts`) and the block CSS; a schema without a component
is an error. Installing a block never edits TypeScript or the CSS entry.

The contract checks block definitions at compile time: a role is required
and must exist; a slot (a field whose type is or reaches a role) must accept
only roles lower than the block's (Surround slots excepted); types must be
core types, roles or declared; free-text fields named like style escape
hatches (`className`, `style`, …) are rejected; names must not clash with
core names; direct block references must not recurse; a pinned contract
major must match the project. Rules that named blocks in the validator are
declared in the block definition instead: `oneOf`, `only` (with `when`),
`childPlace` (Placement fields a slot grants, e.g. grid spans),
`actionOptional` (a Button field without url / opens, e.g. a form submit)
and `ratioMax` (split ratios).

Surround depth is one: a block placed in `before` / `after` may not carry
surround content itself. The three nested cases in the ziachfuchs content
were flattened into the parent's surround list, with margins keeping the
spacing (pixel-identical renders), so no lint limit was needed.

The runtime keeps page and fragment rendering, the box traits (`BoxFrame`),
rich text, SVG, media / button / icon / dialog elements, class helpers,
inspect mode and language links. A component renders only its inside (the
runtime draws the box) or is marked with `ownBox()` and renders `BoxFrame`
itself with its options (flat, element, outer / inner classes).

### Git-based registry, own CLI

Starter blocks come from a registry: a directory of items in a git
repository, each laid out exactly as installed plus an `item.yaml` manifest
(`name`, `description`, `schema` = contract major, `dependencies`, `npm`,
`runtime` for registries outside this repo). The default registry is
`registry/blocks` in this repository; its release tags (the runtime
package's changesets tag) version contract, runtime and items together.
More registries are configured in `wunderweb.config.yaml`.

- Transport is plain git with the developer's credentials: `ls-remote`
  resolves refs, a partial clone with sparse checkout is cached per URL.
  No tokens, any host; CI never needs registry access (installed blocks are
  committed files).
- `add` resolves the ref (default: the tag of the installed runtime),
  dependencies, the contract-major pin (falling back to the newest tag whose
  item matches, or failing), compiles the project with the items added and
  refuses existing directories; nothing is written if a check fails.
  Provenance (registry, item, ref, commit, schema) is the first line of
  `block.yaml`.
- `update` is a per-file three-way merge (`git merge-file`): base = the
  item at the recorded commit, theirs = the new ref, ours = local files.
  Unmodified blocks are replaced; overlaps leave conflict markers, a
  non-zero exit and a pending provenance, completed by `update --continue`
  or by `generate` once no markers are left. `diff` shows local and upstream
  changes against the base.
- No shadcn compatibility: the CLI is the only interface because it checks
  the contract, pins and provenance. Contributing back is a pull request
  copying a block directory into the registry.
- This repository's examples install from the working tree
  (`workingTree: true`), so they always use the current items; CI compiles
  and type-checks every item against the core alone (`registry/` is a
  project with an empty theme).

### Fixed depth, dedicated blocks

Nesting stays PageBlock → Row → Content → Leaf, plus Inline via Surround.
There is no recursion and no depth-limit rule: complex sections become
dedicated, named project blocks (e.g. Timeline, formerly a Tiles mode),
reviewed as code, instead of deeper content trees.

### Container queries inside components

`Responsive<T>` values stay viewport-based (page layout, visibility,
section spacing). Components adapt to the width of their slot with
container size queries inside the component: size queries only (no style or
scroll-state queries), `container-type` on a wrapper that fills its slot,
never on content-sized elements. Tailwind v4 and Next.js 16 already require
newer browsers than container size queries.

### Block ids (2026-11-19)

Every block, `Include` and slot overrides included, may carry an `id`, the
first key after `type`. It names the block within its file so that edits,
merges and rebases can address it after blocks above it moved (wunderweb,
plan m3wn47 step 1.1).

- **Editor metadata, not content.** The loader removes ids from the blocks
  it hands to components, and the generated TypeScript types have no `id`.
  With source maps on, `Origin.id` carries it. Production HTML does not
  depend on ids. Components that need a unique HTML id use `useId` or an
  explicit field; until this change some sites read `block.id` for that
  (Form, Accordion), and they need to switch when they upgrade.
- **Format.** An id is a short lowercase slug (`^[a-z0-9][a-z0-9-]{0,63}$`),
  so ids written by hand or imported (`kurzanfrage`, `p429`) stay valid.
  `wunderweb format` and the editor assign eight lowercase letters and
  digits.
- **Uniqueness.** Within one file. The validator reports a duplicate as an
  error. `wunderweb lint` warns, once per file, about blocks without an id,
  and `wunderweb format` fills them in and re-assigns the later of two
  duplicates. A block without an id stays valid and is addressed by its
  position.
- Plain list items inside a block (accordion entries, buttons, menu entries)
  have no ids. They stay positional.

### Enforcement (2026-10-01)

An audit of the wunderwerk example found the contract bent where nothing
checked it: a site button component rendered a copy of its dialog per button
(four `id="kosten"` on the home page, the anchor link scrolled nowhere), a
`layout.padding: {md: …}` silently dropped a Card's mobile padding, site CSS
restyled block internals by context (`.wc-card-icon[data-icon-badge]`,
`.wc-footer .wc-button[data-size="sm"]`, heading sizes keyed on
`.font-light` / `:has(> .highlight-brush)`), and the parallax animation of the
core `Background.parallax` trait lived only in one site's CSS. Each is now a
check, so the next project cannot repeat it:

- **Dialogs are page-level.** The loader resolves every Button of a page:
  `opens` with an `#anchor` url is the fallback dialog, used only when the
  anchor is not on the page (link or dialog, never both). The page lists its
  dialogs (`SitePage.dialogs`); `Page` renders each once. Components render
  buttons, never dialogs (no `ctx.dialogs`, no exported `Dialog`). Lint
  rejects a dialog repeating an anchor of the page, and the example render
  test asserts unique ids on every page.
- **Defaults merge visibly.** Lint rejects a Responsive value that drops a
  block default's `base` (restate it, `base: {}` for none) and warns about
  values equal to the block default.
- **Site CSS styles the theme, not blocks.** `generate` checks the site
  stylesheets (config `css`, default `app/globals.css`). Allowed: elements,
  theme hooks (`.wc-rich`, `.wc-button*`, the page regions `.wc-header` /
  `.wc-main` / `.wc-footer` / `.wc-dialog` themselves), rich text classes,
  classes several blocks or shared components render. Rejected: runtime
  markup (`.wc-inner`, `.wc-icon`, `.wc-<Block>` …), classes only one block
  renders (they belong in `blocks/<Name>/<Name>.css`), and styling by page
  region (`.wc-footer .wc-button`): a token means the same everywhere, a
  different look is a field, a variant or a rich text class.
- **Traits ship their CSS.** What a core trait needs to work (parallax)
  is in the generated CSS.

## Consequences

- Core releases become rare, additive and safe for every project; site
  tweaks (card spacing, timeline marker size, icon sizes) are local edits.
- Editors and agents see exactly the blocks a site renders: the generated
  JSON Schema includes each block's roles (`x-roles`), doc and rules.
- Registry items can drift from installed copies; `diff` / `update` and
  provenance by commit make that visible and mergeable.
- Block CSS lives with the block; the core CSS carries contract-level rules
  only (containers, rich text vocabulary, trait CSS, safelist). Site CSS is
  checked to stay theme-level.
