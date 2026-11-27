# Roadmap to v1

See [ADR 0001](./decisions/0001-architecture.md) and
[ADR 0002](./decisions/0002-schema-contract.md).

## M1: Core extraction (`schema`)

- Import `layout.schema.yaml` v2 and tools from `ziachfuchs-docs/architecture/layout-system`.
- Remove widgets from core; add custom block declarations (fields, slots, placement) to themes.
- Theme token values (colors, containers, breakpoints, button variants).
- Compiler and validator as a TypeScript library; configurable paths; drop site constants.
- `page:<id>` links, locale-aware documents.
- Ported checks: reject cases, ziachfuchs and wunderwerk examples as fixtures.

## M2: CLI

- `init`: config, theme skeleton, content folders, registry stub, catch-all route, YAML schema mapping.
- `generate` (`--check`): schema.json, types.ts, Tailwind preset and safelist.
- `lint`: content rules incl. i18n.
- `add-block`.

## M3: React runtime

- Registry type, loader (validate, includes, slots, defaults, locales).
- Layout blocks and trait wrapper → Tailwind classes.
- Reference leaf components (unstyled) for bootstrapping.

## M4: Next.js adapter

- `generateStaticParams`, `generateMetadata` (hreflang), sitemap, language switch data.

## M5: Conformance

- Render ziachfuchs node 277 and wunderwerk home; screenshot diff vs production.
- Sort gaps: token, component default, missing prop.

## M6: Contract and project-owned blocks (ADR 0002)

- Core schema reduced to the contract; roles as extension points, Include
  the only core block.
- Block definitions checked by the contract (roles, slot nesting, types,
  style escape hatches, pins); declarative block rules.
- Git-based registry (`registry/blocks`), `add` / `update` / `diff`,
  generated component map and block CSS.
- Examples on the new model, installing from the working tree; renders
  pixel-identical to before the move.

## Gaps from M5 conformance

Each came up rendering a live site (see `examples/*/CONFORMANCE.md`).

Local (registry item or project block, no core change):

- Timeline marker size (fixed 40 px; wunderwerk uses 56 px): a `markerSize`
  field on the project's Timeline.
- Icon size between `lg` (56) and `xl` (72) for wunderwerk card icons: a
  size option on the project's Card (or its icon element).
- Row inside a tile / horizontal Stack (ziachfuchs footer): a row direction
  on the project's Stack, or a dedicated footer block.

Contract-level (additive trait changes for a later 1.x minor):

- `Background.position` per breakpoint (different crops on mobile).
- `Placement.order` for grid items (reorder cells per breakpoint without
  duplicating blocks).
Not gaps:

- The closed spacing scale rounds free px paddings by 4–8 px by design.
- Full-bleed children (marquees edge to edge, heading in the container): a
  Section without `container` whose text rows set their own
  `layout.container` (wunderwerk `team-marquee`, `logos`).

## Contract enforcement (ADR 0002, 2026-10-01)

Done: page-level dialogs (rendered once, `#anchor` + `opens` fallback),
lint for responsive values dropping a default's `base` and for restated
defaults, `generate` check of site CSS (no runtime markup, single-block
internals or region overrides), trait CSS (parallax) in the generated CSS.

Next candidates:

- The site CSS check reads class names from string literals; classes built
  at runtime from other expressions are not attributed to their block.
- Block CSS is not checked (reviewed with the block); a check that it only
  targets its own block's markup would close the last CSS loophole.

## M7: Visual editing in the hosted service

Visual editing moved to the hosted wunderweb service (not in this
repository). What sites keep with it is here: source maps in the loader,
the preview build and its content source, the annotation and bridge in the
runtime, the frame protocol in core and the canonical YAML form (`format`).
The local edit command and the block inspector are removed.

## Later

- `upgrade` with migrations (first major).
- CI check that installed blocks are behind the registry.
- Domain per locale.
- Asset checks against S3.
