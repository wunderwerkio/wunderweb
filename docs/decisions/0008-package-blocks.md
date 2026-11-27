# 0008: Blocks from npm packages

Status: accepted (2026-11-16). Extends [ADR 0002](./0002-schema-contract.md)
(a block's schema still lives in its `block.yaml`) and leaves the registry
(`add` / `diff` / `update`) unchanged.

Since 2026-11-27 the local `edit` command and the runtimes' dev edit mode
described here are removed: sites are edited visually in the hosted
wunderweb service, which frames a site's preview build. The edit service's
ADR (0003) stays with that service.

## Context

Registry items are copied into a site's `blocks/` and become project code
(ADR 0002). That suits blocks a site adapts. It does not suit a family of
sites that must all run the same blocks and take updates as they come: the
Sonnenseite sites (repository `sonnenseite-template`) share about 15 blocks
plus site code (forms, actions, routes) that a registry item cannot carry,
and no update has reached any of them since their blocks were copied. The
template ships these as one versioned npm package instead
(`@wunderwerkio/sonnenseite-kit`); wunderweb has to read a block's
`block.yaml`, component and CSS from that package.

Packages also need a way to retire a content field without breaking the
sites that still set it until their next major version migrates the
content.

## Decision

- **Config `packages`.** `wunderweb.config.yaml` lists npm packages:
  `packages: ["@wunderwerkio/sonnenseite-kit"]`. A package declares its
  blocks directory in its `package.json`, `"wunderweb": {"blocks":
  "./blocks"}`, laid out like a project's `blocks/` (`<Name>/block.yaml`,
  `<Name>.tsx`, optional `<Name>.css`). wunderweb finds the package as Node
  does (`node_modules` of the project, then of each parent: workspaces
  hoist) and keeps the path through `node_modules` (a workspace link is not
  resolved). `loadProject` fails when a package is listed twice, is not
  installed, declares no blocks directory, names one that does not exist or
  lies outside the package, or has `exports` that do not export the
  directory (a subpath pattern `./<dir>/*`, a parent's, or `./*`, mapped to
  the same path). Whether a block's component exports its name is checked by
  `generate` as for local blocks.
- **One block set.** `projectBlocks(project)` is the project's blocks plus
  those of its packages, sorted by name; a name defined twice (locally and
  in a package, or in two packages) is a SchemaError. Everything that read
  `blocks/` reads this set: `generate` (schema, types, component map, block
  CSS), `compileProject` / `lint`, the contract check of `add` and
  `update`, the edit service's schema watcher.
- **Component map.** A package block is imported by package specifier,
  `import { Hero } from "<package>/<dir>/Hero/Hero.tsx"`, so the generated
  file is the same wherever the package is installed. The package ships
  TypeScript source and the site compiles it:
  - TypeScript: the `.tsx` extension in the specifier needs
    `allowImportingTsExtensions` (set by Astro's base tsconfigs; a Next.js
    site sets it itself, with `noEmit`).
  - Bundler: Vite (Astro) `ssr.noExternal: ["<package>"]`; Next.js
    `transpilePackages: ["<package>"]`. Only the Astro case has a fixture
    (`examples/astro-kit`).
- **Tailwind and the site CSS check.** `generated/wunderweb.css` gets one
  `@source` per package blocks directory (Tailwind does not scan
  `node_modules`). The site CSS check counts a package block's files for
  that block, also when a workspace links the package from inside the
  project (real paths compared), so `generate` still rejects site CSS that
  styles a package block's internals.
- **No registry operations on package blocks.** `add` refuses a block a
  package provides (update the package instead); `add` and `update` skip
  dependencies a package provides.
- **`deprecated: true` on a field** (long form, in a block's `fields` or a
  type's `fields`; only optional fields, `key?`, else content could satisfy
  neither the schema nor the warning). The schema keeps accepting the field and marks it with
  the JSON Schema annotation `deprecated: true`; `types.ts` marks it
  `@deprecated`; `lint` reports each value that sets it as a warning
  (`field "x" is deprecated (<doc>); remove it or run the migration of the
  block's package`), so `lint --quiet` and CI pass while the content is
  still old. Removing the field is a breaking change of the block.

## Consequences

- A site updates package blocks with a version bump; `generate` picks up
  the new `block.yaml`s, `lint` checks the content against them. With
  `generated/` committed, a bump needs `generate` (or `generate --check`
  fails), as any block change does.
- A package block cannot import the site's `generated/types`; it types its
  own fields (or ships its own generated types).
- The editor sees package blocks through `generated/schema.json`. Its schema
  watcher watches the package block directories resolved at its start, like
  `blocks/`; after an install that moves the package (other hoisting, other
  blocks directory) restart the (since removed) `edit` command.
- Content migrations for a package's major versions are the package's
  business (e.g. a `migrate` command it ships), not wunderweb's.
- Fixture: `examples/astro-kit` (site) and `examples/kit` (package), built
  and linted in CI with the other examples.
