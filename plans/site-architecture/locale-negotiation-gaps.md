---
status: stub
disposition: implement
claims:
  - site-architecture.md#13.6
size: S
workspaces:
  - packages/compiler
  - packages/schema
---

# A multilingual Cloudflare Pages site negotiates its root, and `*` picks the declared default

## Context

`specs/site-architecture.md` §13.6, line 1833:

> **Status: Partial.** `locale-negotiation.ts` implements RFC 4647 Lookup and emits it into the generated worker (`packages/compiler/src/targets/compile-server.ts`); that adapter-less static output cannot negotiate is the output shape, not a gap (see below). Two things do not match this section: under `"cloudflare-pages"` a site with no server entries and no active mounts gets no worker (`skipWorker` in `packages/compiler/src/site/site-build.ts` ignores `i18n`), so it neither negotiates nor gets the prefix-always root warning; and `*` selects the first declared locale rather than `defaultLocale` whenever the default is declared later in `locales` (`resolveI18n` in `packages/schema/src/locale.ts` moves it to the front only when it is missing).

Before the census the marker was Partial for the wrong reason: it named adapter-less static output, which the section itself records as a property of the output shape rather than work. The two real gaps above were found by the auditor. Everything else is built and tested: Lookup truncation with the singleton rule, `q=0` as a refusal, the bare `/` only, a 302 with `Vary: Accept-Language` and `Content-Language`, and middleware that falls through with `next()` (`packages/compiler/tests/locale-negotiation.test.ts`, `locale-worker.test.ts`).

**What exists**

- `negotiateLocale` in `packages/compiler/src/site/locale-negotiation.ts` and its emitted twin `jxNegotiateLocale`; both answer `*` with `available[0]`.
- `resolveI18n` in `packages/schema/src/locale.ts`, which `unshift`s `defaultLocale` into `locales` only when it was absent; `packages/schema/tests/locale.test.ts`.
- `skipWorker` in `packages/compiler/src/site/site-build.ts` (`adapter === "cloudflare-pages"` with no server entries and no mounts), and the prefix-always root warning a few hundred lines above it, gated on `!projectConfig.build.adapter`.

**What is missing**

- A `"cloudflare-pages"` build that needs negotiation (more than one locale) emits `_worker.js` with the negotiation middleware and `/` in `_routes.json`, or, if the detail phase prefers to keep the static-only shortcut, the prefix-always root warning fires for that shape too and §13.6's "a site with `build.adapter` set gets a generated worker" is reconciled.
- `*` answering `defaultLocale`: either `resolveI18n` always puts the default first (which also makes §5.5's "`$site.locales`, default first" true; `plan:site-architecture/page-context-props` requires this plan for that row) or the negotiator is handed the default explicitly. A test with `locales: ["fr", "en"]` and `defaultLocale: "en"`.
- Editorial ride-alongs: §13.4's "`prefix-always` … nothing enforces it" is stale (§13.2 records the check), and §13.1's tree annotates `pages/index.json` as a redirect the build never makes. §14.1.1's step-5 `_routes.json` sentence is not this plan's: §14.1.1's own plan owns it.

**Related**

- site-architecture.md §13.2 (the prefix-always check), site-architecture.md §14.1 (output targets) and site-architecture.md §5.5 (`$site.locales`).
- site-architecture.md §16 (the RFC 4647 and RFC 9110 rows bound to §13.6).
