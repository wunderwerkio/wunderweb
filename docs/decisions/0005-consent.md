# 0005: Consent

Status: accepted (2026-10-13); amended 2026-10-16 ([Amendment: vendor
scripts after the page](#amendment-2026-10-16-vendor-scripts-after-the-page)).
Extends [ADR 0002](./0002-schema-contract.md)
(an additive Url scheme) and [ADR 0004](./0004-astro-adapter.md) (two
components).

## Context

Sites built with wunderweb embed third parties: YouTube and Vimeo videos
(`remote-video` Assets), booking calendars and other iframes, Google
Analytics, Google Ads and the Meta Pixel. Under GDPR and the ePrivacy
rules (TKG §165 in Austria, TDDDG §25 in Germany) they may only load after
the visitor agreed, refusing must be as easy as agreeing, and the choice
must be changeable at any time.

Every site would solve this again, and the usual solutions fit badly:
consent manager scripts are third parties themselves, and a React context
(the ziachfuchs.com manager) needs hydration, which wunderweb pages do not
have (ADR 0004: server rendered, no client JavaScript for content).
Every site with a `remote-video` Asset needs a gate, and editors had no
way to place a "cookie settings" button: an `#anchor` link to something not
on the page fails lint.

## Decision

Consent is part of wunderweb, switched on per site by a `consent` section
in `wunderweb.config.yaml`. Without it, pages render exactly as before.

```yaml
consent:
  version: 1                       # raise: every visitor is asked again
  maxAgeDays: 365                  # default
  privacy: "page:privacy"          # resolved per locale
  hosts: [example.com, www.example.com]   # tags load only here
  load: idle                       # default; eager: vendor scripts at once (amendment)
  categories:                      # id → Google Consent Mode signals
    statistics: [analytics_storage]
    marketing: [ad_storage, ad_user_data, ad_personalization]
    media: []                      # remote videos and embeds
  vendors:
    google: {ids: [G-…, AW-…]}     # always loaded, Advanced Consent Mode
    meta: {id: "…", category: marketing}
  cookieless: []                   # self-hosted tools without consent, named in the dialog
  style: {surface: white, text: black, choice: primary, quiet: secondary}
  text: {de: {…}, en: {…}}         # overrides of the built-in texts
```

- **Categories are explicit and map to Google signals.** The mapping is
  reviewed in git; a signal belongs to one category, so granting
  statistics never grants an advertising signal. `necessary` is implicit:
  always granted, never stored, not configurable.
- **Google: Advanced Consent Mode.** On allowed hosts `gtag.js` loads on
  every page view, whatever the choice. The head script sends `consent
  default` (every mapped signal denied, a short `wait_for_update`), turns on
  ad data redaction and URL passthrough, then applies a stored choice as an
  `update` before `js` / `config`. Google receives cookieless pings from
  visitors who refused; the site owner chooses this, the privacy policy
  must say so.
- **Meta Pixel only after consent.** It is not loaded before its category
  is granted; on grant it loads, initialises and tracks the page view.
- **Withdrawal reloads.** A loaded vendor script cannot be unloaded: the
  denied update is sent, the vendors' first-party cookies (`_ga*`,
  `_gcl_*`, `_fbp`, `_fbc`) are deleted on every parent domain, and the page
  reloads without them.
- **`media` gates remote videos.** The loader puts a gate on every
  `remote-video` Asset of a site with consent (vendor, texts of the
  locale); `MediaElement` renders it instead of the iframe, so no block
  changes and no content fields are needed. The gate keeps the iframe in a
  `<template>` (nothing loads), names the vendor, offers "load once"
  (this gate, not stored) and "always allow external media" (grants the
  category), and links the original for visitors without JavaScript. A
  poster is shown only from the site's own hosts. `ConsentGate` gives
  project blocks (an iframe Embed) the same gate. Granting `media` grants
  the whole category; there is no consent per vendor inside a category.
- **`consent:settings`** is a new Url scheme (additive to contract 1). A
  Button with it renders a real button that opens the settings; in rich
  text and other links the loader rewrites it to an in-page link marked as
  the opener (harmless without JavaScript). Lint rejects it on a site
  without consent.
- **No hydration: one small script in two parts.** The client script is a
  serialised function like the edit mode bridge. The head part (inline,
  first in `<head>`) owns the data layer and Consent Mode; the body part
  (after the banner and dialog) shows the banner when there is no valid
  choice, runs banner, dialog and gates and applies changes. The choice is
  one localStorage entry (version, time, a boolean per category), no
  cookie and no server log; without storage the visitor is asked on every
  page and everything stays denied. Site scripts use `window.wcConsent`
  (`get`, `set`, `grant`, `open`, `onChange`) and the `wc-consent` DOM
  event.
- **The runtime holds gates and script, the adapter the banner.** React
  renders gates (a Next adapter can reuse them); the Astro adapter renders
  banner and dialog statically in the page's locale (`Consent.astro`) and
  the head script (`ConsentHead.astro`). Both render nothing in edit mode,
  so the editor's frame shows no banner and loads no vendor.
- **Accessible by construction.** The banner is a non-modal dialog first in
  the tab order with a name; "accept all" and "only necessary" share one
  button variant, "settings" is quieter (since 2026-11-04 a link, and
  `style.reject` is optional: see the amendment). The settings are a modal
  `<dialog>`: no box ticked before a decision, focus stays inside, Escape
  closes without saving, focus returns. No animation with reduced motion.
- **Styled by the theme.** Colors are Color tokens and buttons the site's
  `.wc-button` variants (`style`); built-in texts in German (formal) and
  English, overridable per locale.
- **Previews never track.** Tags load only on `hosts`;
  `WUNDERWEB_CONSENT_HOSTS` adds hosts for browser tests (localhost); in a
  production build or server it takes loopback hosts only, so it can never
  extend tags to a real host.

## Consequences

- Lint checks the config (unknown signals or categories, tokens, texts of
  custom categories), rejects `consent:settings` without it and warns about
  `remote-video` on a site without it.
- Sites with consent run one inline script on every page; sites without
  run none.
- The browser test of the Astro example watches requests by host: nothing
  but Google's tag loads before consent, Meta and video hosts only after.
- Not covered: Google Tag Manager containers, TCF strings, region-specific
  defaults, per-vendor consent, a Next adapter banner.

## Amendment (2026-10-16): vendor scripts after the page

### Context

On allowed hosts the head script added `gtag.js` at once (`async`), on
every page view. On wunderwerk.io that is about 200 KB of JavaScript with
about 450 ms of execution and a longest task of 273 ms, competing with the
page's own rendering (LCP, TBT) for every visitor, whatever they chose.
The Meta Pixel (`fbevents.js`) did the same after a Marketing grant. The
two inline parts of the client script were serialised with
`Function#toString` and shipped tabs, long names and comments in every
page's HTML (about 9.5 KB raw).

### Decisions

- **Vendor scripts load after the page, when the browser is idle.** A new
  `consent.load` (`idle`, the default, or `eager`) decides when the head
  script adds `gtag.js`: with `idle` after the window's `load` event (if
  the document is already complete, straight to the idle step) in a
  `requestIdleCallback` with a 2 s timeout (`setTimeout` where it is
  missing); `eager` adds it at once, as before. Everything else in the
  head script is unchanged and still runs first, in order: `consent
  default` (all denied, `wait_for_update`), `ads_data_redaction`,
  `url_passthrough`, a stored choice as `update`, then `js` and `config`
  for every id. These commands, later updates and site events
  (`gtag("event", …)`) queue in the data layer and are processed in order
  once `gtag.js` runs, so consent always applies before the first hit.
- **The Pixel's queue is immediate, its script later.** After a Marketing
  grant the `fbq` stub, `init` and `PageView` are created at once; only
  `fbevents.js` waits like `gtag.js` (the same helper, `__wcConsent.later`).
- **Not on first interaction.** Loading the tags only on a click, scroll
  or key would save more for visitors who never interact, but those
  visitors, and those who leave or navigate quickly, would lose their
  `page_view` and the `gclid` attribution. Idle after load keeps every page
  view and moves the cost behind what the visitor sees.
- **The inline scripts are minified.** `consent-script.js` stays the
  readable source; `scripts/consent-script.mjs` (react package) serialises
  each part, minifies it with esbuild (`target: es2020`) and writes the
  committed `consent-script.min.ts`, which `consentHeadScript` and
  `consentScript` inline as before (`(…)(config)`, `(…)()`). It refuses a
  module with anything at module level besides the two exported functions
  (each is inlined on its own). The react build regenerates it, its
  typecheck fails while it is stale. About 5 KB instead of 9.5 KB raw.

### Consequences

- Hits leave a little later (after load and idle): a visitor who leaves
  before the page finished loading sends no `page_view` any more. Sites
  that need the tag at once set `load: eager`.
- Site code keeps calling `gtag(…)` and `fbq(…)` at any time; nothing
  depends on the vendor scripts being present.
- Tests: core checks the default, `eager` and that lint rejects other
  values; the react test runs both minified parts in jsdom (default first,
  vendor scripts only after load, accept all); the Astro browser test holds
  the page's load event and sees `gtag.js` and `fbevents.js` added only
  once the document is complete, and at once with `load: eager`.

## Amendment (2026-11-04): compact banner, optional quieter rejection

### Context

On phones the banner covered 36–60% of the screen: title, four lines of
text and three full-width buttons stacked. Sites also asked for a banner
that leads to "accept all".

### Decisions

- **Two buttons, settings as a link.** "settings" moves from a third
  button into the text, next to the privacy link (`.wc-consent-link`, still
  a `<button>` with `aria-haspopup`). The order is "only necessary", then
  "accept all": the last button sits at the right edge, under a right thumb
  on phones; reading, tab and visual order match.
- **Phones (up to 40rem):** the title is visually hidden (it still names
  the dialog), smaller type, both buttons side by side at 40px. About 140px
  high instead of 300–380px.
- **Shorter text** that still names the purposes, the consent and the
  withdrawal, as the Austrian DSB expects on the first layer.
- **Equal by default, quieter only on purpose.** `style.reject` gives
  "only necessary" its own ButtonVariant; without it both share `choice`.
  The default stays equal because the Austrian DSB (cookie FAQ), the BVwG
  (ORF, W171 2303402-1, April 2026), the German DSK and VG Hannover
  (10 A 5385/22, 2025) hold a rejection less prominent than the consent to
  make the consent invalid. A site that sets `style.reject` takes that risk
  knowingly and should say so next to the setting.

### Consequences

- Lint rejects an unknown `style.reject` variant; core tests the default
  and the override, the Astro browser test the new tab order (privacy,
  settings, only necessary, accept all).
