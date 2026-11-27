# wunderweb registry

Block items installed into projects with `wunderweb add <Item>` (the
starter set comes with `wunderweb init`). Each item is a directory, laid out
exactly as it is installed, plus its manifest:

```
blocks/Card/item.yaml    name, description, schema (contract major), dependencies
blocks/Card/block.yaml   schema: roles (`in`), traits, fields, defaults, types, rules
blocks/Card/Card.tsx     component, exports `Card`
blocks/Card/Card.css     optional block CSS (collected by `generate`)
```

Items are written against the contract only: roles, traits and core types
(`packages/core/core/<major>.yaml`). This directory is a project with an empty
theme so CI proves it: `wunderweb generate --check` and `tsc` run here.

Conventions:

- A component renders only the inside of its block (the runtime draws the
  box), or wraps itself in `ownBox()` and renders `<BoxFrame>` with options.
- Responsive behaviour inside a component uses container size queries
  (`@container`, no style or scroll-state queries); `container-type` goes on
  a wrapper that fills its slot, never on content-sized elements. The
  schema's `Responsive` values stay viewport-based.
- Render buttons with `ButtonEl`; never dialogs (the page renders each
  dialog once). Ids a component renders must be unique per instance
  (`useId`): a block can appear more than once on a page.
- Avoid dependencies on other items (prefer core types, e.g. an `Asset`
  field over embedding Media); declare them in `item.yaml` when unavoidable.
- Contribute a block back by copying its directory here in a pull request.

Releases: the runtime package's release tag (`@wunderweb/react@x.y.z`)
versions contract, runtime and items together; `add` uses the tag of the
installed runtime.
