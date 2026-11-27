# 0001: Architecture

Status: accepted (2026-09-28). "Core schema" and "Custom blocks" superseded by
[ADR 0002](./0002-schema-contract.md).

## Context

The layout schema in `ziachfuchs-docs/architecture/layout-system` (v2) was
battle-tested against ziachfuchs and wunderwerk.io: both sites are
expressible without escape hatches. It is a contract only: tools are
hard-wired to that repo, widgets of both sites live in the core, and there
is no runtime. wunderweb turns it into a reusable, versioned toolchain for
greenfield sites.

## Decisions

### Packages (one version line, npmjs.com since 0.5.0)

| Package | Role |
| --- | --- |
| `@wunderweb/core` | Core schema per version, compiler, validator library, migrations |
| `@wunderweb/cli` | `init`, `generate`, `lint`, `upgrade`, `add-block` |
| `@wunderweb/react` | Framework-agnostic runtime: registry, loader, renderer, trait → class mapping |
| `@wunderweb/next` | Next.js 16 App Router adapter: routes, metadata, sitemap |

```
project repo
├─ wunderweb.config.yaml  schema version, locales, content dir, asset base
├─ theme.yaml             token values, custom blocks, defaults, rich text additions
├─ content/<locale>/{pages,fragments}/*.yaml
├─ generated/             schema.json, types.ts, Tailwind preset + safelist (committed)
├─ components/            one component per block → registry.ts
└─ app/[[...slug]]/page.tsx
```

### Core schema

> Superseded by [ADR 0002](./0002-schema-contract.md): the core schema is the
> contract only; every block other than Include is project-owned.

- Holds primitives, traits, layout blocks, generic leaves, rich text / SVG
  vocabulary and token *types* (no values).
- Nothing project-specific. Widgets move to projects as **custom blocks**.
- Projects may add blocks, set token values and defaults; never change core blocks.

### Custom blocks

> Superseded by [ADR 0002](./0002-schema-contract.md): blocks live in
> `blocks/<Name>/` and may join any role.

Declared in `theme.yaml`: fields and slots typed with core types and unions
(`Content`, `Leaf`, `Inline`, …), plus where they may be placed (`Leaf` or `Row`).

### Versioning

- Semver. Published schema versions are immutable.
- Minor: additive only. Major: ships a content migration.
- A project pins its version; `wunderweb upgrade` migrates content and regenerates types.

### Styling

Tailwind only. `generate` emits a Tailwind preset (token values) and the
safelist of classes the runtime can emit.

### Runtime

- Registry: `defineRegistry<SiteBlocks>()`; a missing or mistyped component
  is a type error.
- Runtime renders layout blocks and trait wrappers (box, place, background,
  edges, decorations). Project components render block internals only.
- Loader: read content, validate, expand includes and slots, apply defaults
  (objects merge per key; `Responsive` maps and lists replace).

### i18n

```yaml
locales: [de, en]
defaultLocale: de      # /meine-seite, /en/my-page
```

- Locale = content folder (`content/de/…`). No `lang` field.
- `id` shared across locales links translations; `path` differs per locale
  and excludes the locale prefix.
- Internal links by id: `page:about` resolves to the current locale's path.
- Fragments resolve per locale.
- Runtime: hreflang alternates, language switcher counterparts, sitemap.
- Lint: unique ids and paths per locale; missing translation is a warning.
- Later, non-breaking: domain per locale.

### Linting

TypeScript checks components. `wunderweb lint` checks content: schema,
rich text / SVG vocabulary, anchors, includes and slot kinds, `page:` links,
unique paths, asset dimensions. The editor gets structural errors via
`yaml-language-server` and the generated JSON Schema.

### Generated files

Committed (as Payload, Sanity TypeGen, GraphQL Codegen). Type changes
show in PR diffs; CI runs `wunderweb generate --check`.

### Tooling

pnpm workspaces (no turbo until builds get slow), mise for Node and pnpm,
tsdown for builds, Vitest on Node, Biome, Changesets with one fixed version.
Published code runs on Node: no runtime-specific APIs.

## Consequences

- ziachfuchs and wunderwerk widgets become custom blocks in their themes.
- The current validator becomes a library; site-specific constants go.
- `Url` gains `page:<id>` links (schema change vs v2).
