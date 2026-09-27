---
status: drafted
disposition: implement
claims:
  - studio.md#3.6
requires:
  - studio/canvas-injects-context
  - site-architecture/site-state-scope
  - _shared/component-discovery
workspaces:
  - packages/studio
  - specs
  - docs
size: M
---

# A site page's Data panel lists the project `state` entries it inherits, read-only and resolved, after its own

## Context

`specs/studio.md` §3.6, marker at line 142 (the section was unmarked before the census; the cross-spec review appended the canvas sentence):

> **Status: Partial.** The `$media`, `style` and `$head` rows ship, and so does the component row's `$elements` merge (`getEffectiveMedia`, `getEffectiveStyle`, `getEffectiveHead` and `getEffectiveElements` in `packages/studio/src/site-context.ts`); the component row's `components/` limit is §5.4's rule, which is not what ships. The `state` row does not: nothing in `packages/studio/src` reads `project.json`'s `state`, so the Data panel (`panels/data-explorer.ts`, `panels/signals-panel.ts`) lists only the open document's entries, although the build merges them (`injectContext` in `packages/site/src/context.ts`). Nor does the canvas show a file in the context of the full site, as the closing sentence promises: it never merges project `state` and never supplies `$site` (no `$site` token in `packages/studio/src`), and `$page` exists only for a page with route params, where `substitutePreviewParams` (`packages/studio/src/page-params.ts`) injects `params`, `title` and `url` alone (§4.1).

The table row this plan owns (line 152): "`state` | Site-wide state entries are available (read-only) in the state explorer". "State explorer" appears nowhere else in `specs/` or `docs/`; it is the Data panel (§5.6).

The marker has three owners:

- **Canvas sentence**: `plan:studio/canvas-injects-context` makes `resolveCanvasDocument` compose a page through `resolveLayout` and `injectContext` and drops the sentence. Its integration contract: for a page only, the render document's `state` carries `$site`, `$page` and every inherited project entry the page does not declare, as bare keys. A document that is not a page carries none of them. The layout wrap happens while layout elements are shown, and reads every level through `resolveLayoutDoc` (its `loadCanvasLayout`). `serializeDataScope` (`packages/studio/src/canvas/serialize-scope.ts`) posts every def key, so `tab.session.canvas.scope` carries the inherited values too. The panel will have the values, but no rows for them.
- **Component clause**: `plan:_shared/component-discovery` rewrites the Component definitions row with studio.md §5.4 and cuts the clause from the marker.
- **The `state` row**: this plan. It lands last and deletes the marker. The stub had "whichever lands second removes the marker" between this plan and `plan:_shared/component-discovery`, but landing this plan deletes this file, and §3.6 cannot keep an open clause with no owner (`unclaimed-open`). So that plan is now a hard prerequisite.

**Verified at the detail pass** (paths under `packages/studio/src/`):

- The rows are the open document's entries. `signalsView` in `panels/signals-panel.ts` (line 1514) iterates `S.document.state` (line 1518) and reads each row's value from `S.canvas?.scope` (line 1522). The `dataScope` case in `canvas/iframe-host.ts` (line 2344) adopts that scope onto the host's tab. `definedDataNames` in `panels/data-explorer.ts` (line 282) gives the names `data.expandRow` accepts, from the same object. `listState` and `refreshState` (lines 1598–1599) count only those entries.
- Nothing reads project `state`: `grep -rn 'projectConfig?\.state\|projectConfig\.state' src` is empty, and the only `$site` token is `$sitemap` in a comment. `ProjectConfig.state` is `Record<string, unknown>` (`packages/schema/types.ts`).
- The build's precedence is page, then layout chain, then project. `resolveLayout` (`packages/site/src/layout.ts`) merges page state over layout state, recursing through each layout's own `$layout`, and `injectContext` fills only the keys still missing. The canvas reads layouts through `resolveLayoutDoc` in `site-context.ts`, which caches each parsed layout in `layoutCache`, keyed by its project-relative path.
- The canvas decides "is a page" inline: `resolveCanvasDocument` in `canvas/canvas-live-render.ts` (line 171) tests a site project and a `pages/` path. `plan:studio/canvas-injects-context` adds `isRoutedPageFile` (`@jxsuite/site/routes`) so a co-located `_card.json` is not a page, and keeps the test inline. `isPageDocument` in `panels/head-panel.ts` repeats today's test. The Navigator passes the tab's `content` (with its frontmatter) to every panel, and `SignalsPanelState` does not declare it yet.
- The project's own entries are already editable. `showSettingsDocument` (`settings/settings-document.ts`) opens the `project.json` tab over `projectState.projectConfig`. With that tab focused, the Navigator hands the Data panel the configuration object as its document (`navigatorDocument` in `panels/left-panel.ts`; the panel has no `when`). So the panel lists `project.json`'s `state` as that document's own entries, with full editors, and commits through `transactDoc` on the tab `tabs/project-config.ts` makes the document of record. Project Settings has no state section; Raw JSON (`rawJson`) shows the file.
- `mutateAddDef` (`tabs/transact.ts`, line 1278) types its `def` as `Record<string, JsonValue>`, but a naked project entry (`"siteName": "Acme"`) is a legal `JxStateDefinition` too.
- Docs: `docs/studio/logic/data.md` lists `signals-panel.ts` and `data-explorer.ts` in `code:` and says "Every entry belongs to the open file". No page's `spec:` cites `studio.md#3.6` or `#5.6`.

**Related**: site-architecture.md §3.2 and §10.4 (`plan:site-architecture/site-state-scope`, which decides the two ways site state is addressed and exports `SITE_CONTEXT_KEYS`); studio.md §4.1 (`plan:studio/canvas-injects-context`); studio.md §5.4 (`plan:_shared/component-discovery`); studio.md §6.8 (`plan:studio/data-picker-pointer-paths`, the From data… list).

## Outcome

- studio.md §3.6 → Implemented. The marker is deleted, which restores the unmarked form the section had before the census. The `state` row says what the Data panel shows.
- studio.md §5.6 (unmarked) describes the Site section and its verbs. `data.expandRow` accepts an inherited entry's name.
- In a site project, a page (a routed file under `pages/`) lists every project `state` entry that neither it nor the layouts the canvas wraps it in declare, in a trailing read-only **Site** section, each with its resolved value. A page's own entry that shadows a project entry says so. Layouts, components and `project.json` never get the section.
- Not a graduation: studio.md keeps other open items.

## Decisions

- **Decided:** a document lists inherited entries exactly when the canvas gives it page context. One predicate, `receivesPageContext(documentPath)` in `site-context.ts`, decides both, and `resolveCanvasDocument` calls it in place of its inline `isPage`. A Site row whose value the canvas never resolves would read `pending` forever. After `plan:studio/canvas-injects-context` the predicate means a routed page in a site project. Components are excluded by site-architecture.md §10.4 item 4, and `project.json`'s entries are its own rows. That plan's first Open recommends no page context for a layout opened on its own. If it resolves the other way, the Site section follows with no change here.
- **Decided:** shadowing follows the composition the canvas renders. While layout elements are shown, that is the build's precedence: page, then each layout in its chain, then project. No Site row appears for a key the page or any layout it is wrapped in declares. With layout elements hidden, the canvas renders the page alone and injects the project's value even for a key a layout declares, so that key keeps its row. The page's own row for a key the project also declares opens with a hint that it overrides the project's. The layouts' own entries are not listed, since §5.6 lists the open document's. Layout keys are read from `layoutCache`, which the canvas's layout loader fills at every level, so the panel does no read of its own. If the canvas has not read a layout yet, its keys count from the repaint the canvas's scope triggers.
- **Decided:** a Site row is named by its bare key and takes its value from `scope[key]`, the page's inherited copy, never from `scope.$site[key]`. `$site.<key>` holds the entry as written, so for a `Request` it is the definition object, not the response. The expanded row names both ways to read the entry, and omits `$site.<key>` for a name in `SITE_CONTEXT_KEYS`, where `$site` keeps its own value. This depends on `plan:site-architecture/site-state-scope`'s first Open resolving as recommended (both arrivals kept). If it drops the bare copy, rows are named `$site.<key>`, read `scope.$site`, and lose the shadowing rule and the Override verb, and the spec text below changes to match. That is why that plan is required.
- **Decided:** the rows sit in one trailing section, "Site (n)", after the five category sections, and each row keeps its category badge. Read-only rows mixed into editable sections would invite edits that cannot happen, and one heading states the provenance once. `$site` and `$page` are not rows: the build derives them, and no file holds a definition to show.
- **Open:** what can a reader do with a Site row besides read it? Recommendation: two presses in a `bar` field on the expanded row.
  - **Override on this page** copies the definition into the document under the same name, as one undo step. The row moves to the document's own section and stays open.
  - **Edit in project.json** runs `settings.open { section: "rawJson" }`, then `data.expandRow { name }`. The Data panel then lists the project's own entries with their full editors, because `project.json` is the focused document.

  These are the two paths site-architecture.md §3.2 (a page may shadow a site entry) and studio.md §17 (configuration is a document) already give, and a read-only row with no way forward is a dead end. Declining leaves the expanded row with its hint and notes only, and drops two tests and one spec sentence.

- **Open:** should the From data… picker (studio.md §6.8) and the expression operand lists offer inherited entries? Recommendation: not in this plan. §3.6 promises the explorer only. The picker's list builder is being rebuilt by `plan:studio/data-picker-pointer-paths`, whose integration contract already expects project names to arrive later through `stateRefOptions`. After both land, that is one call over this plan's helpers. Until then, an author binds an inherited entry by typing `${state.siteName}`, which already works in the build and, after `plan:studio/canvas-injects-context`, on the canvas.

## Implementation

1. **`packages/studio/src/site-context.ts`**, beside the effective-value helpers. Add `@docs studio/logic/data` to the new functions' JSDoc.
   - `receivesPageContext(documentPath: string | null | undefined): boolean` holds for `projectState?.isSiteProject`, a path starting `pages/` or `./pages/`, and `isRoutedPageFile(documentPath)` from `@jxsuite/site/routes`: the `isPage` test `plan:studio/canvas-injects-context` writes. `resolveCanvasDocument` replaces that inline test with a call to it. If that plan has already exported an equivalent predicate, import that one in both places instead and skip this step.
   - `declaredStateKeys(doc: JxMutableNode, layoutRef: string | null): Set<string>` returns the document's own `state` keys. It adds the `state` keys of each layout in the chain starting at `layoutRef`, as `layoutCache` holds it, following each cached layout's own string `$layout`, normalized as `resolveLayoutDoc` normalizes. It stops at a path not in the cache or one already visited.
   - `getInheritedState(declared: ReadonlySet<string>): [string, JxStateDefinition][]` returns `projectState?.projectConfig?.state`'s entries in file order. It skips `$site`, `$page` and every declared key. It is read at call time, like `getEffectiveLocales`, because `projectState` is replaced wholesale on a project switch.
   - `pageInheritedState(input: { documentPath: string | null | undefined; document: JxMutableNode; frontmatter?: Record<string, unknown> | null; showLayout?: boolean }): [string, JxStateDefinition][]` is the one call both panels make. It returns `[]` unless `receivesPageContext(input.documentPath)`. Otherwise it reads the layout reference as the canvas does, `showLayout === false ? null : getEffectiveLayoutPath(frontmatter?.$layout ?? document.$layout)`, and returns `getInheritedState(declaredStateKeys(document, layoutRef))`.
   - `siteReadPaths(name: string): string[]` returns `[refAccessor("state", escapeToken(name))]`, then `refAccessor("$site", escapeToken(name))` unless `SITE_CONTEXT_KEYS` has the name. It imports `refAccessor` and `escapeToken` from `@jxsuite/runtime/pointer`, and `SITE_CONTEXT_KEYS` from `@jxsuite/site/context`. Both are existing dependencies of `@jxsuite/studio`.
2. **`packages/studio/src/surfaces/panel-signals.ts` and `panel-signals.json`**:
   - `SignalRowView` gains `origin: "document" | "site"`.
   - In the row template, the `part="delete"` `jx-action-button` moves under a `$switch` on `$map/item/origin`. Its `document` case is today's button, and it has no `site` case, so a Site row draws no delete. The switch keeps the button's `data-signal` and label bindings as they are.
3. **`packages/studio/src/panels/signals-panel.ts`**, in `signalsView`:
   - `SignalsPanelState` gains `content?: { frontmatter?: Record<string, unknown> } | null`, which the Navigator already passes.
   - Compute `inherited = pageInheritedState({ document: S.document, documentPath: S.documentPath, frontmatter: S.content?.frontmatter, showLayout: S.ui?.showLayout !== false })` and `projectKeys`, the key set of the project's `state` when `receivesPageContext(S.documentPath)`, else empty.
   - Document rows gain `origin: "document"`. An expanded row whose name is in `projectKeys` gets a leading `hint` field (key `site-shadow`): "Overrides the entry project.json declares for every page."
   - When `inherited` is non-empty, push a category `{ key: "site", label: "Site (n)", open: !collapsed.has("site"), rows }` after the loop. Each row is built as today, from `asSignalDef(def)`, `scope[name]` and `isDataRowExpanded(name)`, with `origin: "site"`, and its tree island is registered the same way. Its `fields` are `siteFields(name, def)`.
   - New `siteFields(name, def): SignalFieldView[]`:
     - A `hint` (`site-origin`): "Declared in project.json for every page."
     - A `note` "Defined as": `defHint(name, def)`, falling back to `asText(def)` when that is empty.
     - A `note` "Read it as": `siteReadPaths(name).join(" or ")`.
     - With the first Open resolved as recommended, a `bar` (`site-actions`, label "Site entry", no segments) with two buttons. The first is `override` (icon `pencil-simple`, "Override on this page"). Its press runs `transactDoc(activeTab.value, (t) => mutateAddDef(t, name, structuredClone(def)))`, then `setDataRowExpanded(name, true)` and `repaint()`. The row's expansion key is the entry name, so the moved row stays open. The second is `project` (icon `file-code`, "Edit in project.json"). Its press runs `void runActiveReported("settings.open", { section: "rawJson" }, "Data").then(() => runActiveReported("data.expandRow", { name }, "Data"))`, importing from `../commands/run-reported`.
   - `refreshState` counts `entries.length + inherited.length`, since a project `Request` is suppressed while authoring like the page's own. `listState` still counts the document's own entries: the empty state's "Add a value" is about the page's own data, and the Site section draws above it.
   - `freeName` also skips the names `getInheritedState` returns, so "+ Add…" never shadows a site entry by accident. A deliberate rename onto a site name is still accepted: that is how a page shadows one.
   - `dropSignal`, `formula.openWorkspace` and `requireDef` are unchanged. A Site row has no delete. The formula workspace edits the document's own `$expression` entries, and its refusal for an inherited name ("is not a state entry this document defines") is correct.
4. **`packages/studio/src/panels/data-explorer.ts`**: `definedDataNames()` becomes the document's own names followed by the inherited names, from `pageInheritedState` over the active tab's `documentPath`, document, `doc.content.frontmatter` and `session.ui.showLayout`. The `data.expandRow` refusal keeps its exact text when nothing is inherited, so existing tests pass unchanged. Otherwise it reads `… it defines: count; it inherits from project.json: siteName`.
5. **`packages/studio/src/tabs/transact.ts`**: `mutateAddDef`'s `def` parameter widens to `JxStateDefinition`. The existing callers pass records and are unaffected.

**Integration contract.** Once this lands, `site-context.ts` exports `receivesPageContext`, `declaredStateKeys`, `getInheritedState`, `pageInheritedState` and `siteReadPaths`, and `resolveCanvasDocument` decides "is a page" through `receivesPageContext`. For a tab, `pageInheritedState` is exactly the set of project entries the canvas adds to its render as bare state. A later plan that lists inherited names elsewhere (the From data… picker) calls these and nothing else. `SignalRowView.origin` distinguishes Site rows, and `data.expandRow` accepts their names. studio.md §3.6 is unmarked and §5.6 states the Site section.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`, then `bun scripts/check-coverage-manifest.ts packages/studio`.

- **`tests/site-context.test.ts`**:
  - `describe("receivesPageContext")`: true for `pages/index.json` and `./pages/blog/[slug].json` in a site project. False for `pages/blog/_card.json`, `components/card.json`, `layouts/base.json`, `project.json`, a null path, and a `pages/` path when `isSiteProject` is false.
  - `describe("declaredStateKeys")`: a document's own keys with a null layout reference. It adds the keys of a cached layout and of the layout that one names in turn (seed the cache through `resolveLayoutDoc` over the mock platform's `readFile`). It stops at an uncached layout and at a layout that names itself.
  - `describe("getInheritedState")`: project entries in file order minus the declared set; empty with no project, no `state`, or everything declared; never lists `$site` or `$page`.
  - `describe("pageInheritedState")`: empty for a component path; a frontmatter `$layout` wins over the document's; `showLayout: false` ignores the layout's keys; `defaults.layout` applies when neither names one; `$layout: false` adds no layout keys.
  - `describe("siteReadPaths")`: `siteName` gives `state.siteName` and `$site.siteName`; `name` gives `state.name` only; `a/b` gives `state["a/b"]` and `$site["a/b"]`.
- **`tests/signals-panel-site-state.test.ts`** (new). Its first import is `./harness`. It calls `mock.module("../src/commands/run-reported", …)` with a recording `runActiveReported` and a pass-through `runReported`, then imports `./signals-panel-fixture` with `await import`. Each case draws with `drawSignals(state, { documentPath, scope })` after `setProjectState({ isSiteProject: true, projectConfig: { state: … } })`.
  - "a page lists the project's entries in a Site section after its own": categories end with `Site (2)`, and `listedNames` ends with the two site names in file order.
  - "a Site row reads its value from the canvas scope's bare key": with `scope: { siteName: "Acme", $site: { siteName: "Acme" } }` the summary is `string` and tone `value`; with no scope it is the definition hint.
  - "an entry the page declares has no Site row, and its own row says it overrides the project's".
  - "an entry the page's layout declares has no Site row, until layout elements are hidden": the layout comes from the cache, and with `ui.showLayout` false the key is listed.
  - "a layout, a component, a co-located `_` file, project.json and a non-site project draw no Site section".
  - "a Site row has no delete, and its editor says where it is defined and how to read it": no `[part="delete"]` in the row; `fieldProps` gives `Defined as`, `Read it as` and `Site entry`; the tree island is painted from the scope value.
  - "a name $site defines itself is read as state only": project `state` `{ name: "Shadow" }` reads `state.name`.
  - "Override on this page copies the definition as one undo step, and the row moves and stays open": `docState().tagline` deep-equals the project definition, the Site section is gone (or shorter), the row is under State and expanded, and one undo removes the copy. A naked project value (`"Acme"`) is copied as a naked value.
  - "Edit in project.json opens the raw configuration and expands the entry there": the recorded calls are `settings.open { section: "rawJson" }` then `data.expandRow { name: "tagline" }`.
  - "Refresh is offered when only the site has entries".
  - "+ Add… skips a name the site declares": project `state` `{ $newSignal: 1 }`, and adding a Value creates `$newSignal1`.
  - "a Site section collapses and is remembered like any other".
- **`tests/panel-gap-commands.test.ts`**, `describe("data.expandRow")`:
  - "expands a row a page inherits from project.json": a `pages/index.json` tab in a site project.
  - "the refusal lists inherited names separately".
  - The existing component-document cases stay byte-for-byte.
- **`tests/canvas-live-render.test.ts`** and **`canvas-live-render-gaps.test.ts`** must pass unchanged. They guard that `resolveCanvasDocument`'s page test means the same thing after it moves into `receivesPageContext`.

Coverage: `packages/studio/bunfig.toml` gates every file at `lines = 0.958, functions = 0.941`. No source file is added. Each new function and branch in `site-context.ts`, `signals-panel.ts` and `data-explorer.ts` is reached above. Raise the threshold to just under the new minimum if the run shows the worst file rose.

## Specs & docs

**`specs/studio.md`**, in place:

- §3.6 marker: delete it. By the time this lands, `plan:_shared/component-discovery` and `plan:studio/canvas-injects-context` have cut it to the `state` sentence. If anything other than that sentence remains, stop and re-read those plans instead of deleting it.
- §3.6 table, the `state` row's effect becomes: "The Data panel lists each entry a page inherits, read-only and with its resolved value, in a **Site** section after the page's own (§5.6); an entry the page or its layout declares under the same name overrides it, as in the build (`site-architecture.md` §10.4)". Run `bun run format` to re-pad the table.
- §3.6 closing paragraph: "Individual file `$media`, `$style`, and `$elements` merge on top of (not replace) site-level definitions." becomes "Individual file `$media`, `style`, `$elements` and `state` merge on top of (not replace) site-level definitions." This adds `state` and corrects `$style` in a sentence already being edited.
- §5.6 opening line: "One list of the open document's state entries: **how each is defined, and what it resolved to.**" becomes "One list of the open document's state entries, and of those it inherits from the site (§3.6): **how each is defined, and what it resolved to.**"
- §5.6, a new paragraph after "Expanding a row opens the entry's editor…":

  > "**What a page inherits is listed, and is not edited here.** A page, which the canvas composes as the build does (§4.1), also reads every `project.json` `state` entry that neither it nor a layout it is shown wrapped in declares (`site-architecture.md` §10.4). Those entries follow the page's own, in one **Site** section; a layout, a component or `project.json` itself has none. Each row has the same badge, name and value slot as the others, and no delete. Expanded, it says where the entry is defined and how the page reads it: `state.<key>`, and `$site.<key>` unless `$site` defines that name itself. Its resolved value sits underneath. Two verbs stand in for the editor. **Override on this page** copies the definition into the open document under the same name, as one undo step. **Edit in project.json** opens the project configuration with that entry's row expanded. An entry the page or its layout declares has no Site row, because it is not what the page reads, and the page's own row says that it overrides the project's."

  Drop the verbs sentences if the first Open is declined.

- §5.6, the `data.expandRow` paragraph: "and a refusal listing the entries the document defines when the name is not one of them" becomes "and a refusal listing the entries the document defines, and those it inherits, when the name is neither".
- Fragment: `bun run spec:change studio.md minor -m "§3.6 and §5.6: in a site project the Data panel lists the project state entries a page inherits, read-only and resolved, in a Site section after the page's own, with verbs to override one on the page or edit it in project.json; an entry the page or its layout declares overrides the project's, as in the build."`

**Docs** (no em dashes). `bun run docs:sync` names `docs/studio/logic/data.md`, `docs/studio/logic.md` and `docs/studio/logic/data-sources.md` through `signals-panel.ts` and `data-explorer.ts`, and `docs/studio/interface/languages.md` through `site-context.ts`.

- `docs/studio/logic/data.md`:
  - Add `packages/studio/src/site-context.ts` to `code:`.
  - "Read the list": after the five section names, add ", and in a site project a **Site** section for what the page inherits (see [Site data](#site-data))".
  - "Every entry belongs to the open file, so each page or component carries its own data, saved inside its own JSON file." gains ", apart from the **Site** section, which lists what a page reads from `project.json`."
  - A new `## Site data` section after "Rename and delete":

    > "In a site project, every page also reads the `state` entries declared in [`project.json`](/docs/framework/site/project-json). The Data panel lists them after the page's own entries, in a **Site** section, with what each resolved to on the canvas. A Site row can't be edited or deleted here. Open it to see where the entry is defined and how the page reads it: as `state.siteName`, like the page's own entries, or as `$site.siteName`, which no page can change. **Override on this page** copies the entry into this page under the same name. The page's copy wins from then on, and the row moves into the page's own sections. Undo removes it. **Edit in project.json** opens the project settings on **Raw JSON** with the entry open in the Data panel, where a change reaches every page. An entry that the page, or its layout, declares under the same name takes the site's place, as it does in the built site. So it has no Site row, and its own row says it overrides one. A layout or component opened on its own shows no site data: a component receives only what its props pass in, and a layout reads site data through the page it wraps."
- `docs/framework/site/project-json.md`: at the end of the "Site state and shared types" paragraph as `plan:site-architecture/site-state-scope` leaves it, add: "In Jx Studio, each page's [Data panel](/docs/studio/logic/data#site-data) lists these entries under **Site**."
- No change: `docs/studio/logic.md`, `docs/studio/logic/data-sources.md` and `docs/studio/interface/languages.md`, whose behaviour is unchanged. No docs image shows a site project with project `state`, so the screenshots lane should recapture nothing.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` passes at its thresholds, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run typecheck` and `bun run lint` are clean.
- `sed -n '/^### 3.6 /,/^## 4\. /p' specs/studio.md | grep -c 'Status:'` prints `0`, and `bun run plans:status --spec studio` no longer lists `studio.md#3.6`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- In Studio against a scratch copy of a starter from `packages/starters/sites/`, with `"state": { "siteName": "Acme", "tagline": { "type": "string", "default": "Hello" } }` added to its `project.json`:
  - Opening a page shows **Site (2)** after the page's sections, with `siteName` reading `string`.
  - Binding a heading to `${state.siteName}` shows `Acme` in preview.
  - **Override on this page** on `tagline` moves it under **State**, still open, and ⌘Z moves it back.
  - **Edit in project.json** focuses the `project.json` tab on Raw JSON, with `tagline` open in the Data panel.
  - Opening a component shows no Site section.
