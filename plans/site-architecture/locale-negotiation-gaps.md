---
status: drafted
disposition: implement
claims:
  - site-architecture.md#13.6
requires:
  - _shared/page-server-entries
workspaces:
  - packages/schema
  - packages/compiler
  - specs
  - docs
size: S
---

# Every adapter's worker negotiates a multilingual site's root under its base, and `*` answers the declared default

## Context

`specs/site-architecture.md` §13.6, line 1835:

> **Status: Partial.** `locale-negotiation.ts` implements RFC 4647 Lookup and emits it into the generated worker (`packages/compiler/src/targets/compile-server.ts`); that adapter-less static output cannot negotiate is the output shape, not a gap (see below). Two things do not match this section: under `"cloudflare-pages"` a site with no server entries and no active mounts gets no worker (`skipWorker` in `packages/compiler/src/site/site-build.ts` ignores `i18n`), so it neither negotiates nor gets the prefix-always root warning; and `*` selects the first declared locale rather than `defaultLocale` whenever the default is declared later in `locales` (`resolveI18n` in `packages/schema/src/locale.ts` moves it to the front only when it is missing).

Verified at the current tree, with two more divergences the census did not list:

- **`*`.** `negotiateLocale` (`packages/compiler/src/site/locale-negotiation.ts`, line 130) and its emitted twin `jxNegotiateLocale` (line 232) return `available[0]` the moment they meet `*`. The worker passes `i18n.locales`, and `resolveI18n` only `unshift`s `defaultLocale` when it is absent, so `{ defaultLocale: "en", locales: ["fr", "en"] }` answers `*` with `fr`. The `ResolvedI18n.locales` doc comment ("Canonical tags, default first, in declaration order"), §5.5's `$site.locales` row ("Declared locales, default first") and `libraryLocales` in `packages/studio/src/browse/library-model.ts` ("because resolveI18n guarantees it is `locales[0]`") all assume an order the resolver does not produce. Separately, returning on `*` at once is not RFC 4647 §3.4, which reads (the range written as code here): "If the language range `*` is followed by other language ranges, it is skipped. If the language range `*` is the only one in the language priority list or if no other language range follows, the default value is computed and returned."
- **Pages skip.** Step 6c of `buildSite` sets `skipWorker = adapter === "cloudflare-pages" && deduped.size === 0 && mounts.length === 0` (line 868). The `_routes.json` writer below it already adds `/` to `include` when `i18n.locales.length > 1` (line 907), but only runs when a worker was emitted. The prefix-always root warning (lines 644–654) is gated on `!projectConfig.build.adapter`, so a static-shape Pages site under `prefix-always` gets neither negotiation nor the warning: its root is a silent 404. Pinned the other way by `site-build.test.ts` ("rewrites img srcset …": a Pages site with no i18n gets no `_worker.js`), which stays true.
- **Base path (new).** `localeNegotiationMiddleware` registers `app.use('/', …)` and bakes `localeHome` paths with no base, while `compileSiteServer` registers every server route under `withBase(base, …)` and `buildMountSpecs` does the same for mounts. On a site whose `url` has a path (§14.7), every request carries the prefix, so the middleware matches nothing and the root is never negotiated; had it matched, its redirect would drop the base. §14.7's table says the worker's routes are registered under the base.
- **Single-locale `prefix-always` (new).** `localeNegotiationMiddleware` returns `""` when `i18n.locales.length < 2`, whatever the routing (pinned by "emits nothing when there is nothing to negotiate", whose second case is `locales: ["en"], routing: "prefix-always"`). Under `prefix-always` nothing lives at `/`, and the root warning is gated on having no adapter, so a one-locale `prefix-always` site under any adapter ships a 404 root with no warning. §13.6's "this is the one shape where it is not [handled]" is false for it.

Everything else in §13.6 is built and tested: Lookup truncation with the singleton rule, `q=0` as a refusal, the bare root only, a 302 with `Vary: Accept-Language` and `Content-Language`, and middleware that falls through with `next()` (`packages/compiler/tests/locale-negotiation.test.ts`, `packages/compiler/tests/locale-worker.test.ts`).

Ride-alongs this plan owns (audit record, "Spec-wide decisions"): §13.4's "`prefix-always` … nothing enforces it" is stale, since §13.2 records the check; §13.1's tree annotates `pages/index.json` as "→ / (redirect to default locale)", a redirect the build never makes. §14.1.1's step-5 `_routes.json` sentence and the `_routes.json` base belong to `plan:_shared/page-server-entries`, which this plan requires.

## Outcome

- site-architecture.md §13.6 → Implemented: every adapter, `"cloudflare-pages"` included, emits a worker that answers the site root whenever the root has something to negotiate (more than one locale, or `prefix-always`); the middleware and its redirect targets carry the deployment base; `*` is skipped when another range follows it and otherwise answers `defaultLocale`.
- `resolveI18n` lists `defaultLocale` first in every case, which makes §5.5's `$site.locales` row true (§5.5 stays Partial for its other items under `plan:site-architecture/page-context-props`).
- site-architecture.md stays Partial; nothing graduates.

## Decisions

- **Open:** does a `"cloudflare-pages"` site with no server tier emit a worker so its root negotiates, or stay static with the root warning widened to it and §13.6 reconciled to exclude it? Recommendation: emit it, because the author chose an adapter and §13.6, `docs/framework/site/i18n.md` and the other three adapters all say an adapter site negotiates. `_routes.json` wakes the worker for the root alone, so the rest of the site stays static and the cost is one Functions invocation per root visit. The reconcile would leave every two-locale `prefix-except-default` Pages site silently un-negotiated. One new requirement follows: the worker bundle resolves `hono` from the project root (`bundleWorkerSource` in `packages/compiler/src/site/bundler.ts`), as it already does for every other adapter. `@jxsuite/create` adds `hono` for every non-static adapter (`packages/create/generate.ts`); a hand-configured Pages project without it now fails its build with the bundler's unresolved-`hono` error, and the docs say so.
- **Open:** does a single-locale `prefix-always` site under an adapter get the root redirect? Recommendation: yes, `negotiatesRoot` is true for every `prefix-always` site, because nothing else lives at `/` in that mode (§13.6: "the redirect is what makes the root work at all") and today that shape ships a 404 root with no warning on every adapter. The emitted `Vary` is redundant with one locale but harmless. The alternative, widening the root warning to adapter builds, leaves a deployment that can answer its root not answering it.
- **Decided:** `*` is skipped inside the loop (`continue`), so a trailing `*` falls through to the `fallback` argument, which every caller passes as `defaultLocale`, and a `*` followed by another range defers to that range, because that is RFC 4647 §3.4 word for word and it makes the answer independent of `available`'s order. Behaviour change: `*, fr` now answers `fr` where it answered the first declared locale.
- **Decided:** `resolveI18n` always puts `defaultLocale` first and keeps the rest in declaration order, because `ResolvedI18n` documents it, §5.5 states it and `libraryLocales` relies on it. Studio's locale settings edit the raw declared list (`declaredLocales` in `packages/studio/src/settings/locales-section.ts`), so no project file is rewritten; the visible change is ordering for a project that declares its default later (`$site.locales`, the Languages panel's columns, the Library's language facet). Only `packages/starters/sites/museum` declares `i18n` in this repository, default first.
- **Decided:** one exported predicate, `negotiatesRoot(i18n)` in `locale-negotiation.ts`, decides the middleware, the Pages `skipWorker` exemption and the `_routes.json` root entry, because those three encode "does the root negotiate" separately today (`i18n.locales.length < 2` in two places, nothing in `skipWorker`), which is how the Pages gap arose.
- **Decided:** the middleware registers at `withBase(base, "/")` and bakes `withBase(base, localeHome(…))` as each home, because every other worker route is registered under the base (§14.7's worker row) and an unbased `app.use('/')` matches no request a based site receives. Only the trailing-slash root is registered, matching the URL the build's own links use.
- **Decided:** this plan requires `plan:_shared/page-server-entries`, because that plan rewrites the same `skipWorker` and `_routes.json` lines and puts the deployment base on the `include` list, without which a based Pages site's worker is never woken for its root; it also owns §14.1.1, whose skip paragraph this plan edits.

## Implementation

1. **`packages/schema/src/locale.ts`**
   - `resolveI18n`: replace the `if (!locales.includes(defaultLocale)) { locales.unshift(defaultLocale); }` block with `const ordered = [defaultLocale, ...locales.filter((tag) => tag !== defaultLocale)];` and return `locales: ordered`. The comment keeps the "joins the list rather than being rejected" reasoning and adds: the default leads whether it was declared first, later or not at all, because `*` negotiation, `$site.locales` (site-architecture.md §5.5) and every locale menu read `locales[0]` as the default.
   - `ResolvedI18n.locales` doc: "Canonical tags: the default first, then the rest in declaration order."
2. **`packages/compiler/src/site/locale-negotiation.ts`**
   - New `export function negotiatesRoot(i18n: ResolvedI18n | null): boolean`, `i18n !== null && (i18n.locales.length > 1 || i18n.routing === "prefix-always")`, with a JSDoc: the root has a choice to make with two locales, and under `prefix-always` it has no page of its own even with one (site-architecture.md §13.6).
   - `negotiateLocale`: `if (range === "*") { continue; }`, commented with the RFC 4647 §3.4 rule. JSDoc: drop "`*` selects the first available locale…"; `available` becomes "Canonical tags; the answer does not depend on their order"; `fallback` becomes "The site's `defaultLocale`: the answer when nothing matches, and to a trailing `*`".
   - `localeNegotiationMiddleware(i18n: ResolvedI18n | null, base = "")`: return `""` when `!negotiatesRoot(i18n)`. Emit `const JX_ROOT = ${JSON.stringify(withBase(base, "/"))}` beside `JX_LOCALES`; build `JX_LOCALE_HOMES` from `withBase(base, localeHome(locale, i18n))`; register `app.use(JX_ROOT, …)`; `const home = JX_LOCALE_HOMES[locale] || JX_ROOT` and redirect only when `home !== JX_ROOT`. In the emitted `jxNegotiateLocale`, `if (range === '*') continue`. Import `withBase` from `@jxsuite/schema/asset-paths`, as `compile-server.ts` does. Keep every emitted helper above the first `app.use(`, which the drift test slices on.
3. **`packages/compiler/src/targets/compile-server.ts`**, `compileSiteServer`: `localeNegotiationMiddleware(i18n, base)`. The `opts.i18n` JSDoc reads "drives the root negotiation middleware, registered at `base`".
4. **`packages/compiler/src/site/site-build.ts`**
   - Import `negotiatesRoot` from `./locale-negotiation.ts`.
   - Step 6c: `skipWorker` gains `&& !negotiatesRoot(i18n)` (on top of `plan:_shared/page-server-entries`' `serverEntries.length === 0`). Its comment: a Pages site with no server tier and no root to negotiate needs no worker; one with mounts, server entries or a negotiating root always gets one.
   - The `_routes.json` `include` condition becomes `negotiatesRoot(i18n)` in place of `i18n && i18n.locales.length > 1`; the `.map((p) => withBase(basePath, p))` that plan adds stays.
   - The prefix-always root warning keeps its condition; its comment says why `!adapter` is now exactly the unhandled shape: `negotiatesRoot` is true for every `prefix-always` site, so under any adapter the worker answers the root.
5. No Studio code changes: `libraryLocales`' comment becomes true as written.

**Integration contract.** Once this lands: `resolveI18n(config).i18n.locales[0] === i18n.defaultLocale` for every non-null result, the rest canonical, deduplicated and in declaration order (`plan:site-architecture/page-context-props` relies on this for `$site.locales`). `negotiateLocale(header, available, fallback)` skips `*` and does not depend on `available`'s order. `negotiatesRoot(i18n)` is exported from `packages/compiler/src/site/locale-negotiation.ts` and is the one definition of "the worker answers the root". `localeNegotiationMiddleware(i18n, base = "")` registers at the based root. Every adapter emits a worker when `negotiatesRoot(i18n)`, and a Pages build then writes `_routes.json` with the based root and `/_jx/*`. `compileSiteServer`'s signature is unchanged. §13.6 is Implemented.

## Tests

**`packages/schema`** (`bun test --isolate --coverage` from `packages/schema`), `tests/locale.test.ts`, `describe("resolveI18n")`:

- `a default declared later moves to the front`: `{ defaultLocale: "en", locales: ["fr", "en", "de"] }` resolves `locales` to `["en", "fr", "de"]`.
- `the default is matched canonically when it moves`: `{ defaultLocale: "EN-us", locales: ["fr", "en-US"] }` resolves to `["en-US", "fr"]`, no duplicate.
- The existing "a default missing from locales joins the front of the list" and "falls back to the first locale" cases are unchanged and still pass.

**`packages/compiler`** (`bun test --isolate --coverage` from `packages/compiler`):

- `tests/locale-negotiation.test.ts`
  - `CORPUS` gains `"*, fr"`, `"*, ja"`, `"ja, *"`, `"*;q=0.5, de"` and `"fr;q=0, *"`, so the drift guard covers the new branch.
  - `negotiateLocale`: retitle the wildcard test `a trailing wildcard takes the declared default, wherever it is declared` and add `negotiateLocale("*", ["fr-CA", "en"], "en")` → `"en"`. New `a wildcard followed by other ranges is skipped`: `"*, fr-CA"` → `"fr-CA"`, `"*, ja"` → `"en"`, `"*;q=0.5, de"` → `"de"` (all against `SITE.locales`, fallback `"en"`).
  - New `describe("negotiatesRoot")`: `null` → false; one locale under `prefix-except-default` → false; one locale under `prefix-always` → true; two locales under either routing → true.
  - `localeNegotiationMiddleware`: "emits nothing when there is nothing to negotiate" keeps `null` and swaps its second case to `locales: ["en"], routing: "prefix-except-default"`. New `a single-locale prefix-always site still answers its root`: the source contains `"en":"/en/"` and `status: 302`. "it registers as middleware on /" asserts `const JX_ROOT = "/"` and `app.use(JX_ROOT`. New `under a deployment base, the root and every home carry it`: `localeNegotiationMiddleware(SITE, "/m/site")` contains `const JX_ROOT = "/m/site/"`, `"fr-CA":"/m/site/fr-ca/"` and `"en":"/m/site/"`.
  - Drift guard: new `and when the default is not first in the list`, running the corpus through both copies with `available = ["fr-CA", "en", "de"]`, fallback `"en"`. "the baked-in home map matches localeHome for every locale" loops over base `""` and `"/m/site"` and compares with `withBase(base, localeHome(locale, i18n))`.
- `tests/locale-worker.test.ts`: a second `describe("a cloudflare-pages site with no server tier negotiates its root")` with its own temp root, built the way the first block builds (factor `writeJson`, the `hono` symlink and `get` into helpers taking the root and the worker). Project: `build: { adapter: "cloudflare-pages" }`, `url: "https://pages.example/m/site/"`, `i18n: { defaultLocale: "en", locales: ["fr", "en"] }`, pages `index.json` and `fr/index.json`, no server entries. Cases:
  - `emits _worker.js and wakes it for the based root`: `dist/_worker.js` exists and `dist/_routes.json`'s `include` equals `["/m/site/", "/m/site/_jx/*"]`.
  - `sends a French reader to the French home under the base`: `GET /m/site/` with `fr` is a 302 to `/m/site/fr/` with `Vary: Accept-Language`.
  - `answers a lone wildcard with the default declared second`: `GET /m/site/` with `*` is a 200 whose body is `served /m/site/`, with `Content-Language: en`.
  - `lets a range after the wildcard decide`: `*, fr` is a 302 to `/m/site/fr/`.
  - `leaves the origin's own root alone`: `GET /` with `fr` is a 200 `served /` with no `Content-Language`.
- `tests/site-build.test.ts`, a new `describe("buildSite — cloudflare-pages with locales and no server tier")` beside the Pages block, each case scaffolding its own project with one `pages/index.json` (and `pages/en/index.json` under `prefix-always`):
  - `two locales get a worker and a root entry`: `_worker.js` exists and contains `Accept-Language`; `_routes.json` `include` is `["/", "/_jx/*"]`.
  - `one locale with prefix-always gets a worker`: `_worker.js` exists.
  - `one locale with prefix-except-default stays static`: neither `_worker.js` nor `_routes.json` exists.
- `tests/site-build-reporting.test.ts`, in "prefix-always with no runtime to answer the root": new `says nothing under an adapter, even with one locale`: `build: { adapter: "cloudflare-pages" }`, `locales: ["en"]`, `prefix-always`, no page at `/`; no warning contains `no page claims "/"`.

**Coverage.** No source file is added, so both manifest checks are unaffected. `negotiatesRoot` is covered by its own suite and by the build; the new `continue` is covered by the corpus. Thresholds: `packages/compiler/bunfig.toml` `{ lines = 0.982, functions = 0.98 }`, `packages/schema/bunfig.toml` `{ lines = 0.99, functions = 0.99 }`; ratchet only if the run shows either workspace's worst file rose.

## Specs & docs

**`specs/site-architecture.md`**, in place:

- **§13.6 marker** becomes: "> **Status: Implemented.** `locale-negotiation.ts` implements RFC 4647 Lookup and emits it into the generated worker (`packages/compiler/src/targets/compile-server.ts`) under every adapter, `"cloudflare-pages"` included, registered at the deployment base (§14.7). That adapter-less static output cannot negotiate is the output shape, not a gap (see below)."
- **§13.6 body:**
  - "Which deployments can negotiate" ends, after "…and negotiation runs there.": "It runs whenever the root has something to answer: the site declares more than one locale, or declares `prefix-always`, under which nothing else lives at `/` even with one. That is why `"cloudflare-pages"`, the one adapter that can decline to emit a worker (§14.1.1), does not decline for such a site: its `_routes.json` wakes the worker for the root, and the rest of the site stays static."
  - "The bare `/` only." gains a closing sentence: "On a site served below a base path (§14.7) the root is the base, `/m/my-site/`, and every redirect keeps it; the origin's own `/` is not the site's root."
  - The algorithm paragraph: "`*` selects the site's own default." becomes "`*` is skipped when another range follows it, and otherwise selects the site's `defaultLocale`, wherever `locales` declares it (RFC 4647 §3.4)."
- **§13 marker:** "§13.1–§13.5 and §13.7 ship:" becomes "§13.1–§13.7 ship:"; "…and translations advertise one another in `<head>` and in the sitemap. What is not whole belongs to §13.6, and its own marker says what." becomes "…, translations advertise one another in `<head>` and in the sitemap, and under any adapter the root sends a visitor to their own language." The second paragraph stays.
- **§13.1 (ride-along):** delete the tree's last line (`└── index.json # → / (redirect to default locale)`), turn `├── fr/` into `└── fr/` and its children's `│   ` prefix into four spaces. After the fence add: "This is the `prefix-always` layout (§13.2); under `prefix-except-default` the default locale's pages sit directly in `pages/`, unprefixed. No page claims `/`: under an adapter the generated worker sends a visitor who arrives there to their own language (§13.6), and a static build with no page at `/` says so."
- **§13.4 (ride-along):** "Note what §13.4 does **not** claim: `prefix-always` is accepted and canonicalized by §13.2, but nothing enforces it — a page outside the locale tree still builds and is served as the default locale. Enforcement belongs with the routing work in §13.2, not here." becomes "Under `prefix-always` a page outside the locale tree still builds and is served as the default locale, so its `lang` is the default's; §13.2's check is what names it."
- **§5.5 marker:** delete the clause ", and `$site.locales` puts the default first only when it was missing from `locales` (`resolveI18n` in `packages/schema/src/locale.ts`, §13.6)", joining the preceding clause to the next with "and". The marker stays Partial for `plan:site-architecture/page-context-props`; the row itself is already right.
- **§14.1**, the `"cloudflare-pages"` row: "unless the site has neither server entries nor active extension mounts" becomes "unless the site has no server entries, no active extension mounts and no root to negotiate (§13.6)". The `_redirects` part of the row is `plan:site-architecture/build-output-prose`'s; whichever lands second rebases.
- **§14.1.1** (Implemented by then): the closing paragraph's "with no server entries _and_ no active mounts, no worker and no `_routes.json` are emitted" becomes "with no server entries, no active mounts _and_ no root to negotiate (§13.6), no worker and no `_routes.json` are emitted". Step 5's "plus `/` when `i18n` declares more than one locale" (written by `plan:_shared/page-server-entries`) becomes "plus `/` whenever the worker negotiates the root (§13.6)".
- **§14.2** tree comment: "skipped entirely when there are no server entries and no active mounts" becomes "skipped entirely when there are no server entries, no active mounts and no root to negotiate".
- **§14.7** table, "The generated worker (§14.1)": "so its routes and its extension mounts are registered under the base" becomes "so its routes, its extension mounts and the root's locale negotiation (§13.6) are registered under the base".
- **§16**, the RFC 4647 row's note: after "`q=0` honoured as a refusal" insert ", and `*` skipped when another range follows it and otherwise answered with `defaultLocale`". Evidence paths unchanged.

**Fragment:** `bun run spec:change site-architecture.md minor -m "§13.6: every adapter's worker negotiates the root of a site with more than one locale or with prefix-always, cloudflare-pages included and under the deployment base, and a wildcard is skipped when another range follows it and otherwise answers defaultLocale, which resolved locales now always list first"`.

**Docs** (no em dashes). `bun run docs:sync` names `docs/framework/site/i18n.md` (`spec:` `site-architecture.md#13.6`; `code:` `locale.ts`, `locale-negotiation.ts`) and `docs/framework/site/deployment.md` (`code:` `site-build.ts`), plus the pages that list `site-build.ts` for other reasons (`build.md`, `redirects.md`, `seo.md` and others), which describe nothing this changes.

- `docs/framework/site/i18n.md`:
  - The context table's `$site.locales` row: "every declared locale, in order" becomes "every declared locale, your default first".
  - "With an adapter, the generated worker handles `/`:" becomes "With an adapter, the generated worker handles `/`. That includes Cloudflare Pages, which otherwise ships no worker for a site with no server functions: a site with more than one locale, or with `prefix-always`, gets one that wakes for `/` alone. Like every adapter's worker it needs `hono` in your project's dependencies, which `bun create @jxsuite` adds for you. On a site served from a subfolder, the root is the subfolder and the redirect keeps it:"
  - The table gains two rows after `ja, ko`: `` `*` `` | anything | your default locale; `` `*, fr` `` | `fr` | redirect to `/fr/`; a `*` counts only at the end.
- `docs/framework/site/deployment.md`:
  - Adapters table, Pages row: "only when there is a server tier" becomes "only when there is a server tier or a root to negotiate".
  - "What the worker serves": "Three route families, and nothing else:" becomes "Three route families:". After the table, before "**Pages are never rendered per request.**", add: "On a site with more than one locale, or with `prefix-always`, it also answers the site root, sending a visitor to their language before the page is served (see [Locales and languages](/docs/framework/site/i18n#sending-a-visitor-to-their-language))."
  - The Pages bullet (as `plan:_shared/page-server-entries` leaves it): "plus `/` when the site has more than one locale" becomes "plus `/` when the site has more than one locale or uses `prefix-always`"; "A Pages site with no server functions and no mounts gets no worker at all" becomes "A Pages site with no server functions, no mounts and a single locale without `prefix-always` gets no worker at all".
- `docs/studio/publish/cloudflare.md` (not named by `docs:sync`, but it states the Pages worker's scope): line 11's "if your project has a database or sign-ins, it also runs the small worker Jx emits for their `/_jx/*` routes" becomes "if your project has a database, sign-ins or more than one language, it also runs the small worker Jx emits for its `/_jx/*` routes and for choosing a visitor's language at `/`". Line 62's "because only the `/_jx/*` routes reach the worker" becomes "because only the `/_jx/*` routes, and the root of a multilingual site, reach the worker", and "to wake it for `/_jx/*` and nothing else" becomes "to wake it for those paths and nothing else".

No spec graduates; `plans/site-architecture/` stays. Landing deletes this file and removes `site-architecture/locale-negotiation-gaps` from `plan:site-architecture/page-context-props`' `requires`, whose `$site.locales` item this closes.

## Acceptance

- `bun test --isolate --coverage` passes from `packages/schema` and from `packages/compiler` with no per-file threshold failure; `bun scripts/check-coverage-manifest.ts packages/schema` and `bun scripts/check-coverage-manifest.ts packages/compiler` pass.
- `bun -e 'import { resolveI18n } from "./packages/schema/src/locale.ts"; console.log(resolveI18n({ i18n: { defaultLocale: "en", locales: ["fr", "en"] } }).i18n.locales)'` prints `[ "en", "fr" ]`.
- `bun -e 'import { negotiateLocale as n } from "./packages/compiler/src/site/locale-negotiation.ts"; console.log(n("*", ["fr", "en"], "en"), n("*, fr", ["fr", "en"], "en"))'` prints `en fr`.
- A `"cloudflare-pages"` project with two locales and no server functions, built with `bunx jx build`, has `dist/_worker.js` and a `dist/_routes.json` whose `include` names `/`; with one locale and `prefix-except-default` it has neither.
- `sed -n '/^### 13.6 /,/^### 13.7 /p' specs/site-architecture.md` shows `> **Status: Implemented.**`; `bun run plans:status --spec site-architecture` no longer lists `site-architecture.md#13.6`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:standards` and `bun run docs:markdown` pass.
