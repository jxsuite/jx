---
status: drafted
disposition: implement
claims:
  - site-architecture.md#10.4
requires: []
workspaces:
  - packages/site
  - packages/compiler
  - specs
  - docs
size: M
---

# Site state reaches a page as read-only `$site.<key>` and as shadowable page state, and a built page pays for it only where it reads it bare

## Context

`specs/site-architecture.md` §10.4, marker at line 1414:

> **Status: Partial.** Data files through `$ref`, `ContentCollection` and `ContentEntry` declarations, and `$props`-only component inputs ship. Item 1 does not hold: `injectContext` (`packages/site/src/context.ts`) spreads project `state` flat onto `$site` (`$site.siteName`, not `$site.state.siteName`) and also merges it into the page's own `state` as bare keys, the page winning, which is what §3.2 describes; item 1 and §5.5's `$site.state` row describe a nesting that does not exist.

Item 1 (line 1418) says site state is "Available in pages/layouts as `$site.state.foo`, not as bare `state.foo`. This prevents naming collisions and makes the data source clear." §3.2 (line 246 and the paragraph after it) says the opposite: entries are "available to every page (read-only from the page's perspective)" and "A page may shadow a site-level `state` entry with its own." The user docs (`docs/framework/site/project-json.md`, lines 104 and 219) document what ships.

What `injectContext` does (lines 81–86 and 125–133), verified at the current tree:

- `doc.state.$site = { name, url, ...(i18n ? { defaultLocale, locales } : {}), ...projectConfig.state }`.
- Each project `state` key the document does not already hold is copied into `doc.state` as an ordinary entry. Both callers inject into the document `resolveLayout` has already merged, page state over layout state (`packages/site/src/layout.ts`, lines 73–75), so the precedence is page, then layout, then project. The callers are the build (`compilePage` in `packages/compiler/src/site/site-build.ts` line 1279, through `packages/compiler/src/site/context-injection.ts`) and the live preview (`composePage` in `packages/site/src/compose.ts`). The stub also named the Studio canvas and the cloud preview: the canvas does not call it yet (studio.md §4.1, `plan:studio/canvas-injects-context`), and the cloud preview is a backend outside this repository.
- `packages/site/tests/context.test.ts` already pins the page winning ("merges project state into page state (page wins)"), contrary to the stub. Nothing pins the layout's precedence.

Three things the stub did not find (the first two confirmed with a scratch `bun -e` run of `injectContext` and `isDynamic`):

- **`$site`'s own names are clobbered.** `state` is spread last, so a project `state` entry called `name` makes `$site.name` `"Shadow"` rather than the project `name`; `url`, `locales` and `defaultLocale` behave the same. §5.5's table says those four come from `name`, `url` and `i18n`.
- **Site state makes every built page dynamic.** A page with only static content, in a project whose `state` is `{ "siteName": "My Site" }`, is `isDynamic` → `true` after injection, because the bare copy is a naked value (`isDynamic` in `packages/compiler/src/shared.ts` skips only `$site`, `$page` and `timing: "compiler"`). So one site constant hydrates every page, and `docs/framework/build.md` line 177's advice ("reference `$site`/`$page` context instead") cannot avoid it. `compilePage`'s strip pass (lines 1355–1395) already drops an array nothing still reads, by `referencesStateKey`; inherited entries are not in it.
- **The bare copy is writable page state.** Nothing makes it read-only, and each page is its own document, so a write changes that page's copy only. §3.2's "read-only" and §10.1's "Site `state` (read-only)" cell (line 1381) describe `$site`, not the copy. `$site.<key>` holds the entry as written: the value of a naked entry, the definition object of a `$prototype` one.

The module comment in `context.ts` (line 8) still says "`$site.state.*` — site-wide reactive state".

Found in passing, not this plan's: §3.1's `state` row ("Site-wide state accessible to all pages and components") is wrong about components, which receive nothing implicitly (§10.1, §10.4 item 4). §3.1 is claimed by `plan:site-architecture/project-defs-and-charset`, which should drop "and components" from that row.

## Outcome

- site-architecture.md §10.4 → Implemented. Item 1 states the two paths that ship, `$site.<key>` and bare `state.<key>`, with their precedence and cost.
- §5.5's `$site.state` row becomes `$site.<key>`, and its marker loses the clause about it. §5.5 stays Partial under `plan:site-architecture/page-context-props` for its other clauses.
- Ride-alongs: §3.2's bullet and shadowing sentence and §10.1's Page cell say how the two paths differ; compiler.md §8.1 gains the inherited-entry rule.
- Code: `$site`'s own names are never replaced by a `state` entry, and a built page keeps an inherited entry only while something on it still reads it bare.
- site-architecture.md stays Partial; nothing graduates.

## Decisions

- **Open:** keep both arrivals, as shipped? Recommendation: yes, and rewrite item 1 to them. No tracked `project.json` declares `state`, so nothing in the repository forces the choice, but the docs have documented both paths and user projects may rely on either. The two paths do different jobs: `$site.<key>` is a constant that no page can shadow and that never makes a page dynamic, and the bare copy is a per-page default with every state shape's behaviour (a `Request`, a `LocalStorage` entry, a handler), which `$site`'s as-written copy cannot give. The collision argument item 1 made is answered by a fixed precedence (page, then layout, then project) plus the unshadowable `$site` view. The alternatives are both breaking and add nothing: nesting under `$site.state` breaks every `$site.<key>` read; dropping the bare merge takes away project-wide state shapes.
- **Decided:** a name `$site` defines itself is never replaced by a `state` entry of the same name, and that entry still arrives bare (`state.name`). The four names are reserved whether or not the project declares `i18n`, so adding `i18n` later cannot change what `$site.locales` means. This is §5.5's table as written; the code contradicts it.
- **Decided:** the bare copy is ordinary page state, writable, per page. No read-only enforcement is added: the runtime has no read-only state, and the spec's "read-only" was describing `$site`. §3.2 and §10.1 are reworded, not the code.
- **Decided:** `$site.<key>` stays the entry as written. Resolving `$prototype` entries into `$site` would run each one twice per page, once as the bare copy, and `$site` would stop being a constant. Item 1 says it is the path for constants.
- **Open:** should the build drop an inherited entry a page never reads bare? Recommendation: yes, on the terms compiler.md §8.1 already applies to arrays, because otherwise declaring one site constant ships the runtime on every page, and the docs' advice to read site data through `$site` to stay static is false. The live preview (and later the canvas) keeps every entry: those hosts interpret, so they have no static tier to protect. Declining it leaves `compilePage` unchanged, drops the compiler.md edit and the compiler tests, rewrites item 1's last sentence and the build.md bullet to "declaring any project `state` makes every page dynamic", removes `packages/compiler` from `workspaces`, and makes this plan S.
- **Decided** (with the recommendation above): a document with a `$src` Function keeps every inherited entry, because that module's reads are invisible to `referencesStateKey`, and such a document is dynamic anyway (a bodyless `$src` Function is a `$prototype` entry), so keeping them costs no static page anything. The reference scan widens from `children` and `state` to the whole composed document minus its `$head` (already resolved at build time), because a root-level `attributes`, `style` or `$switch` read is a read; for arrays that can only rescue more. It also stops scanning `$site` and `$page`: `$site` holds project definitions as written, so a project handler's body there would keep every entry it names alive on every page, whether or not the page has that handler.

## Implementation

1. **`packages/site/src/context.ts`**
   - New `export const SITE_CONTEXT_KEYS: ReadonlySet<string> = new Set(["defaultLocale", "locales", "name", "url"])`, with JSDoc: "The names `$site` defines itself (site-architecture.md §5.5). A project `state` entry with one of these names reaches the page as bare state only (§10.4)."
   - In `injectContext`, build `$site` with the project entries first and the context's own last: `doc.state.$site = { ...Object.fromEntries(Object.entries(projectConfig.state ?? {}).filter(([key]) => !SITE_CONTEXT_KEYS.has(key))), name: …, url: …, ...(i18n === null ? {} : { defaultLocale, locales }) }`. The name and url expressions are unchanged.
   - The bare-merge loop (lines 125–133) is unchanged. Its comment becomes "Merge project-level state into page state: the page, then its layout, wins (site-architecture.md §10.4)".
   - Module comment: replace "`$site.state.*` — site-wide reactive state" with "`$site.<key>` — each project `state` entry as written, read-only, never replacing the four names above (§10.4)", and add after the `$page` list: "Each project `state` entry is also copied into the page's own `state` unless the page or its layout declares the key."
2. **`packages/compiler/src/site/site-build.ts`**, `compilePage` (the Open decision above):
   - Before the `injectContext` call (line 1279): `const declaredStateKeys = new Set(Object.keys(layoutDoc.state ?? {}));`. After it: `const inheritedStateKeys = Object.keys(projectConfig.state ?? {}).filter((key) => key !== "$site" && key !== "$page" && !declaredStateKeys.has(key));`.
   - In the strip block (line 1355), after the loop that fills `strippable` and before the fixpoint: when `collectSrcImports(layoutDoc).length === 0`, add each `key` of `inheritedStateKeys` for which `key in layoutDoc.state` to `strippable` (a `timing: "compiler"` one has already been deleted by the loop above). Import `collectSrcImports` from `../shared.ts` beside `buildInitialScope`. Rename `strippable` to `droppable` and extend the comment above it to "an inherited project entry is only droppable on the same terms (compiler.md §8.1)".
   - The fixpoint (lines 1378–1391): after `const surviving = { ...layoutDoc.state }`, `delete surviving.$site` and `delete surviving.$page`, then delete the droppable keys as now; the haystack becomes `JSON.stringify({ ...layoutDoc, $head: undefined, state: surviving })`. The dropped keys are gone from `layoutDoc.state` after the final loop, so nothing else in `compilePage` changes, and `isDynamic` never sees an inherited entry nothing reads.
3. **`packages/compiler/src/site/context-injection.ts`**: no change.

**Integration contract.** Once this lands, `@jxsuite/site/context` exports `SITE_CONTEXT_KEYS`. `injectContext` gives `$site` the project `name`, `url` and (with `i18n`) `defaultLocale` and `locales`, never replaced by `state`, plus every other project `state` entry as written; it copies every project `state` entry the document does not declare into `doc.state`, so the page, then its layout, wins. A plan that adds a `$site` property (`plan:site-architecture/page-context-props`'s `$site.$head`) adds its name to `SITE_CONTEXT_KEYS`. `plan:studio/site-state-in-data-panel` may rely on: in a live renderer every inherited entry is present bare in the document's state and in `$site`; the bare entries are the page's own, writable and shadowed by a page or layout entry of the same name; `$site` is the read-only view. A built page's client state holds an inherited entry only if the page reads it as `state.<key>` or has a `$src` Function. site-architecture.md §10.4 item 1 and §5.5's `$site.<key>` row state this.

## Tests

**`packages/site`** (`bun test --isolate --coverage` from `packages/site`):

- `tests/context.test.ts`, `describe("injectContext")`:
  - `a name $site defines itself is never replaced by project state`: project `state` `{ name: "Shadow", url: "/x", locales: ["zz"], defaultLocale: "zz", theme: "dark" }` with `i18n` `{ defaultLocale: "en", locales: ["en", "fr"], routing: "prefix-always" }`. `$site.name` is `"Test Site"`, `$site.url` `"https://example.com"`, `$site.defaultLocale` `"en"`, `$site.locales` `["en", "fr"]`, `$site.theme` `"dark"`; the bare `doc.state.name` is `"Shadow"`.
  - `without i18n, a state entry named locales is bare state only`: `"locales" in doc.state.$site` is `false` and `doc.state.locales` is the state's array.
  - The existing "spreads project state into $site" and "merges project state into page state (page wins)" stay.
- `tests/compose.test.ts`, `describe("composePage")`:
  - `project state fills only the keys neither the page nor its layout declares`: layout `state` `{ theme: "sepia", accent: "red" }`, page `state` `{ accent: "blue" }`, config `state` `{ theme: "dark", accent: "green", siteName: "Acme" }`. `page.doc.state` has `theme` `"sepia"`, `accent` `"blue"`, `siteName` `"Acme"`, and `page.doc.state.$site.theme` is `"dark"`.

**`packages/compiler`** (`bun test --isolate --coverage` from `packages/compiler`): new `tests/site-build-site-state.test.ts`, modelled on `site-build-state-retention.test.ts` (own temp root `__test-site-state__`, `buildSite` once in `beforeAll`, removed in `afterAll`). `project.json`: `name: "Probe"`, `url: "https://example.com"`, `build.outDir: "./dist"`, `state: { siteName: "Acme", tagline: "Hello", theme: "dark", clicks: 0, name: "Shadow" }`, no default layout. Each page names its own layout, whose root tag names the island file, so no two pages share one. Templates are `textContent`, which prerender resolves (a template text child does not, compiler.md §2.2).

- `a page that reads no site state ships no JavaScript`: `pages/plain.json` (layout `plain-shell`, a `p` with fixed text). Its HTML has no `plain-shell.js` and `dist/plain-shell.js` does not exist. Fails today.
- `site state read through $site or as a constant is prerendered, and the page stays static`: `pages/about.json` (layout `about-shell`) with `textContent` `${$site.siteName}`, `${state.tagline}` and `${$site.name} / ${state.name}`. The HTML contains `Acme`, `Hello` and `Probe / Shadow`; no `about-shell.js`.
- `an entry the page writes stays live, and one it never reads is dropped`: `pages/counter.json` (layout `counter-shell`), state `bump: { $prototype: "Function", body: "state.clicks++" }`, a `button` with `onclick: { $ref: "#/state/bump" }` and `textContent` `${state.clicks}`. The island's `reactive({…})` writes each entry on its own line and `$site` as one JSON object, so assert by line: `dist/counter-shell.js` matches `/^\s*clicks:\s*0,$/m` and does not match `/^\s*siteName:/m`.
- `the page, then its layout, wins over the project`: `pages/page-theme.json` (layout `page-shell`, page `state` `{ theme: "light" }`) and `pages/layout-theme.json` (layout `themed-shell`, whose `state` is `{ theme: "sepia" }`), each with `textContent` `${state.theme}`. The prerendered `p` reads `light` and `sepia` respectively.
- `a page with a $src handler keeps every inherited entry`: `pages/sidecar.json` (layout `sidecar-shell`) with state `go: { $prototype: "Function", $src: "./sidecar.js" }` on a button's `onclick`, and `pages/sidecar.js` exporting `go`. `dist/sidecar-shell.js` matches `/^\s*siteName:\s*"Acme",$/m`.

**Coverage.** `packages/site/bunfig.toml` gates `{ lines = 0.99, functions = 1.0 }` per file; the `filter` callback in `injectContext` runs in every case with project state. `packages/compiler/bunfig.toml` gates `{ lines = 0.982, functions = 0.98 }`; the new branch and the `$src` guard in `compilePage` are both reached above. No source file is added, so the manifest check is unaffected. Ratchet a threshold only if the run shows that workspace's worst file rose.

## Specs & docs

**`specs/site-architecture.md`**, in place:

- **§10.4 marker** (line 1414) becomes: "> **Status: Implemented.** `injectContext` (`packages/site/src/context.ts`) gives a page both paths in the build and the live preview, and `compilePage` (`packages/compiler/src/site/site-build.ts`) drops a bare copy nothing on the built page reads."
- **§10.4 item 1** (line 1418) becomes: "1. **Site state** — The one inherited value a page reads by name, and it stops at the component boundary (item 4). A page or layout reaches a project `state` entry two ways. As **`$site.<key>`** it is read-only: `$site` is injected context, which never makes a page dynamic, so this is the path for a site-wide constant. It holds the entry as written, and a name `$site` defines itself (§5.5) is never replaced: an entry called `name` is `state.name`, while `$site.name` stays the project `name`. As **bare `state.<key>`** it is the page's own entry, copied in only when neither the page nor its layout declares the key, so either one shadows it. The copy behaves as the page's own entry of that shape (spec.md §5.3): writable, with a write reaching that page alone. A built page keeps the copy only while something on it still reads `state.<key>` (compiler.md §8.1), so a site constant costs nothing on a page that reads it through `$site` or not at all."
- **§5.5**: the `$site.state` row becomes ``| `$site.<key>` | Each `project.json` `state` entry, as written | Site-wide state; never replaces a name above (§10.4) |``, placed after `$site.defaultLocale`. In the marker (line 523), delete "the `$site.state` row describes a nesting that does not exist (§10.4), and ", leaving "… `$site.$head` are never injected, and `$site.locales` puts the default first …".
- **§3.2**: the bullet (line 246) becomes "`state` entries are available to every page and its layout, read-only as `$site.<key>` and as the page's own `state` entries (§10.4)". "A page may shadow a site-level `state` entry with its own." becomes "A page or its layout may shadow a site-level `state` entry by declaring the same key; `$site.<key>` still reads the site's value."
- **§10.1**, Page row (line 1381): "Site `state` (read-only)" becomes "Site `state` (as page state, and read-only as `$site`)".

**`specs/compiler.md`** §8.1 (unmarked, unclaimed), after the paragraph "**An array is only stripped when nothing still reads it.** …", add: "**An inherited site entry is dropped on the same terms.** A project `state` entry that neither the page nor its layout declares reaches the page as its own entry (`site-architecture.md` §10.4), and, unread, it would make every page of the site dynamic. The build therefore drops it in the same fixpoint as an array, when no surviving state definition and no surviving node references it. A read through `$site` is not such a reference: `$site` is injected context. A document with a `$src` Function keeps every inherited entry, because that module's reads are invisible to the scan, and such a document is dynamic anyway."

Run `bun run format` so the two tables are re-padded.

**Fragments:**

- `bun run spec:change site-architecture.md minor -m "§10.4: site state reaches a page two ways, as read-only \$site entries that never replace the names the site context defines and as the page's own shadowable, writable state, which a built page keeps only where it still reads it; §10.4 and §5.5 no longer describe a nested site state object."`
- `bun run spec:change compiler.md minor -m "§8.1: a project state entry a page inherits is dropped from the built page on the same terms as an array, unless the document has a \$src handler."`

**Docs** (no em dashes). `bun run docs:sync` names the pages whose `code:` lists `context.ts` or `site-build.ts`, or whose `spec:` cites §3, §5 or §10:

- `docs/framework/site/project-json.md`, "Site state and shared types" (line 104) becomes: "`state` declares site-wide data. Every page and layout receives it two ways. Under the read-only `$site` entry, each key sits beside `$site.name` and `$site.url`, and a state key with one of those names (or `locales` and `defaultLocale`) never replaces them. As the page's own `state`, each key is copied in unless the page or its layout declares the same key, in which case theirs wins; the copy is ordinary state the page may change. A built page keeps that copy only if something on it reads `state.<key>`, so a value read through `$site` never adds JavaScript." "What documents inherit" (line 219): "`state` merges into page state (page wins) and is exposed as `$site`." becomes "`state` merges into page state (the page or its layout wins) and is exposed, read-only, as `$site`."
- `docs/framework/build.md`: "Three kinds of state are exempt" becomes "Four kinds", with a fourth bullet "a project `state` entry the page never reads as `state.<key>` (dropped, like an array nothing still reads)". The "Live `state`" bullet (line 177) gains: "A project `state` entry counts only on the pages that read it as `state.<key>`."
- `docs/framework/site/layouts.md`, the State bullet: after "**the page wins** on any shared key." add "Project `state` fills in any key neither declares."
- `docs/framework/site/i18n.md` (`code:` `context.ts`) is unchanged: its `$site.locales` and `$site.defaultLocale` rows become unconditionally true. `seo.md`, `color-schemes.md`, `redirects.md` and `deployment.md` (`code:` `site-build.ts`) describe nothing this changes.

No spec graduates; `plans/site-architecture/` stays. Landing deletes this file and removes `site-architecture/site-state-scope` from the `requires` of `plan:site-architecture/page-context-props` and `plan:studio/site-state-in-data-panel`, after re-reading their contracts against the one above.

## Acceptance

- `bun test --isolate --coverage` passes from `packages/site` and `packages/compiler` with no per-file threshold failure; `bun scripts/check-coverage-manifest.ts packages/site` and `… packages/compiler` pass.
- `bun -e 'import { injectContext } from "./packages/site/src/context.ts"; const d = {}; injectContext(d, { name: "S", url: "u", state: { name: "Shadow", siteName: "Acme" } }, { urlPattern: "/" }); console.log(d.state.$site.name, d.state.name, d.state.$site.siteName)'` prints `S Shadow Acme` (today `Shadow Shadow Acme`).
- A scratch project with `state: { "siteName": "Acme" }` and one page of static content, built with `bunx jx build`, emits that page with no island script, and a page with a handler that writes `state.siteName` still emits one.
- `sed -n '/^### 10.4 /,/^### 10.6 /p' specs/site-architecture.md` shows `> **Status: Implemented.**`; `sed -n '/^### 5.5 /,/^## 6\. /p;/^### 10.4 /,/^### 10.6 /p' specs/site-architecture.md | grep -c '\$site\.state'` and `grep -c '\$site\.state' packages/site/src/context.ts` each print `0`; `bun run plans:status --spec site-architecture` no longer lists `site-architecture.md#10.4`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
