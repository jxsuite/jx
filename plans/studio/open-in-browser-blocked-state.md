---
status: drafted
disposition: implement
claims:
  - studio.md#10.1
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: S
---

# Open in Browser is never hidden while a project is open, and says why it is blocked before it is pressed

## Context

`specs/studio.md` §10.1, line 1183 (the section was unmarked before the census):

> **Status: Partial.** The route-addressed live preview, the dirty-document overlay, the per-project origin with acknowledged reuse, the `buildSite` fallback and all seven reasons ship (`packages/studio/src/surfaces/commandbar.ts`, `preview/preview-overlay.ts`, `packages/server/src/live-preview.ts`). The blocked state does not: `view.openInBrowser` is hidden by `when: ctx.project.isSite`, its enablement asks only for an open document, so a non-page renders enabled and says nothing until pressed, the generic `requires` sentence appearing only with no document open, and a blocked invocation reports through `notify.warn` rather than the status bar, which §16.2 now keeps free of transient messages.

The body (lines 1227 to 1239) promises "never hidden", a seven-row table of reasons shown "disabled with the reason in its tooltip", and "Invoked by chord while blocked, the reason goes to the status bar". Re-verified on 2026-09-27; paths under `packages/studio/src/`.

**What ships.**

- `view.openInBrowser` in `commands/defaults.ts`: `when: (ctx) => ctx.project.isSite`, `enablement: documentOpen`, `requires: "a page to preview"`, `run: () => deps.openInBrowser()`. The deps are wired in `registerStudioCommands` (`editor/shortcuts.ts`) from `StudioCommandHooks`, which `studio.ts` fills with `toolbarPanel.runOpenInBrowser`.
- `openInBrowserTarget(tab)` in `surfaces/commandbar.ts` computes five of the table's reasons, as sentences, from the tab and `projectState`. `runOpenInBrowser()` adds the sixth (the platform has neither `previewSite` nor `buildSite`) and reports either through `notify.warn`, keyed `view.openInBrowser`, source "Preview". The seventh, "serves no origin", is only knowable from the backend's answer (`runLivePreview`, `runBuiltPreview` read `result.url`), so it can never be a pre-press reason.
- Every runtime reader of a disabled reason goes through `registry.disabledReason(id)` or `registry.run` (`commands/registry.ts`), which read `command.requires` at the moment of asking: `commandTooltip` and `overflowRows` (`surfaces/commandbar.ts`), the palette's `detail` (`panels/quick-search.ts`), `projectItem` (`surfaces/statusbar.ts`), `scriptableCommands` (`services/automation.ts`) and `CommandUnavailableError`. All of them interpolate it after "requires" (`"${title} — requires ${reason}"`, `"it requires ${requires}."`), so a reason must be a noun phrase. The table's sentences would print "Open in Browser — requires Open a page to view it in a browser."
- `handleKeyEvent` claims a chord whose command is visible but disabled and runs nothing (`registry.ts`; the docblock above `dispatchKey` in `editor/shortcuts.ts`; `commands/run-reported.ts` calls it "by design"). So today's toast on ⌘⇧O exists only because the gate is loose: once the enablement is honest, a blocked chord never reaches `runOpenInBrowser`.
- The record declares `statusbar/document`, but the status bar picks its items by id and never draws it (`studio-ui-guidelines.md` §12.1's gap; `plan:studio-ui-guidelines/unrendered-placements` drops that placement from this record). The section's last sentence names a surface that does not show the control.
- `docs/studio/interface.md` already describes the target: "It is always there. When the open file has no route it's disabled and its tooltip says why".
- Tests: `tests/commands-defaults.test.ts` ("Open in Browser hides on a non-site project and disables without a document"), `tests/commandbar.test.ts` (`describe("openInBrowserTarget")`, the two `runOpenInBrowser` suites), `tests/shortcuts.test.ts` ("⌘K and ⌘⇧P open the palette; ⌘⇧O opens the page in a browser"). `packages/server/tests/live-preview.test.ts` covers the backend and is unaffected.

**What is missing.** The control shows in a non-site project, its gate evaluates the same resolution the action performs, and its `requires` names the condition that blocks it. The stub's reading that "the code's toast is right" holds only for what the backend reports after the press; for the pre-press conditions the destination is the control itself.

## Outcome

- `studio.md` §10.1 → Implemented. While a project is open the action is drawn, disabled with the first blocking condition's `requires` phrase before it is pressed; a blocked chord runs nothing; what only the backend can answer is reported after the press through `notify`, never in the status bar.
- `studio.md` §13.1's `requires` row and §13.3 gain one sentence each, stating what ships (a live `requires` getter; a disabled command's chord is claimed and runs nothing). Neither section is open.

## Decisions

- **Decided:** one resolution feeds the gate, the reason and the run: `openInBrowserTarget(tab, platform)` in a new module `src/preview/browser-target.ts`, because three readers computing one answer separately is how the control came to be enabled on a page the action refuses. The module sits beside `preview-overlay.ts` and is importable from `editor/shortcuts.ts`, which builds the command deps and already reaches `store`, `platform` and (through `canvas/canvas-utils.ts`) `page-params`; importing it from `surfaces/commandbar.ts` instead would load a surface that registers itself at import time.
- **Decided:** the record states its reason as a getter, `get requires() { return deps.openInBrowserBlocked() ?? "a page to preview"; }`, with `enablement: () => deps.openInBrowserBlocked() === undefined`, because every runtime reader already reads `command.requires` at the moment it asks (above) and §13.1 already sanctions a getter for a live read (`derivedEnumProperty`). Widening the type to `string | ((ctx) => string)` was rejected: it changes the core record for one reader, the context record carries none of the inputs (the document path, the route params, the backend's members), so the function would ignore its argument, and `commands/reference.ts` would have no sentence to print on the generated commands page. With `noopCommandDeps()` the getter yields "a page to preview", which is what that page prints today.
- **Decided:** the reasons are `requires` noun phrases, and §10.1's table carries them, because every surface prints the string after "requires". In precedence order:

  | Condition                                         | `requires`                                                                      |
  | ------------------------------------------------- | ------------------------------------------------------------------------------- |
  | Project is not a site                             | `a site project`                                                                |
  | Backend has neither `previewSite` nor `buildSite` | `a backend that can preview the site`                                           |
  | No open document, or one never saved              | `an open page`                                                                  |
  | Document is not under `pages/`                    | `a document under pages/, which <path> is not`                                  |
  | Catch-all route (`[...rest]`)                     | `a route that names one page, which a catch-all route does not`                 |
  | Dynamic route with unset params                   | `a value for :<param>, picked in the pane context bar's resolving-with popover` |

- **Decided:** the first condition that holds is the reason, project and backend first, because a reason the author can act on must not be shown ahead of one they cannot: picking a `:slug` value on a backend that cannot preview at all is wasted work. Today's order checks the document first.
- **Decided:** `when: (ctx) => ctx.project.open`, not removed, because with no project there is no page to route and the Command Bar's no-project state is emptied by `when` for every document verb (`file.save`, `edit.undo` and `edit.redo` all hide on `documentOpen`). §10.1 says "never hidden while a project is open".
- **Decided:** "Backend serves no origin" leaves the pre-press table and stays a post-press `notify.warn` toast, with a build or preview that reports errors (`notify.warn`) and one that throws (`notify.error`, a Problem by §16.1's default), because only the backend's answer reveals it. The status bar carries none of them (§16.2).
- **Open:** what ⌘⇧O does while blocked. Recommendation: the registry's existing rule, under which the chord is claimed (`preventDefault`) and runs nothing, with no toast and no Problem. The control is greyed with its reason in the Command Bar, the palette's greyed row answers "why can't I" (`studio-ui-guidelines.md` §12.3), it is what every other disabled chord already does (⌘Z with nothing to undo, Delete on the document element), and a per-record exception would be a second availability rule for one command. The alternative, any disabled chord posting its refusal as a toast, is a registry-wide change to §13.3 for every record and belongs to no open item. Filing it in Problems is wrong by §16.1, since nothing needs fixing. The cost: ⌘⇧O on a component, which toasts today, goes quiet.

## Implementation

Paths under `packages/studio/`. New comments cite spec sections qualified where they leave `studio.md`.

1. **New `src/preview/browser-target.ts`** (`@docs studio/interface`).
   - `export type BrowserTarget = { path: string } | { reason: string }`, moved from `surfaces/commandbar.ts`; `reason` is a `requires` phrase.
   - `export function openInBrowserTarget(tab: Tab | null, platform: StudioPlatform | null): BrowserTarget`: the body of today's `openInBrowserTarget`, with the checks in the Decisions table's order and wording. The backend check is `!platform?.previewSite && !platform?.buildSite`; "no open document" is `!tab?.documentPath` after the `./` strip; missing params keep today's `:name` list joined with ", ". The route and `trailingSlash` computation below the checks is unchanged, comment included.
   - `export function openInBrowserBlocked(): string | undefined`: `openInBrowserTarget(activeTab.value ?? null, hasPlatform() ? getPlatform() : null)`, answering the reason or `undefined`.
   - Imports: `projectState` from `../store`, `documentUrlPattern` and `dynamicRouteParams` from `../page-params`, `activeTab` from `../workspace/workspace`, `getPlatform` and `hasPlatform` from `../platform`; types `Tab` and `StudioPlatform`.
2. **`src/surfaces/commandbar.ts`.** Delete `BrowserTarget`, `openInBrowserTarget` and the `../page-params` import. `runOpenInBrowser()` reads `const platform = hasPlatform() ? getPlatform() : null` and resolves `openInBrowserTarget(activeTab.value ?? null, platform)`. On a reason it posts one `notify.warn` reading "Open in Browser requires " + the phrase + ".", keyed `OPEN_IN_BROWSER` with source "Preview" as today, and returns. Its own backend check goes, because the target made it; the dispatch becomes `runLivePreview(platform!.previewSite, target.path)` when `previewSite` exists, else `runBuiltPreview(platform!.buildSite!, target.path)` (the file already asserts `buildSite!`). Its docblock says the reason branch serves a direct caller, since `registry.run` refuses first through the same function. `runLivePreview` and `runBuiltPreview` are unchanged.
3. **`src/commands/defaults.ts`.**
   - `CommandDeps` gains `openInBrowserBlocked: () => string | undefined`, documented as the phrase that blocks Open in Browser now, injected because the answer reads the active tab, the project and the platform, none of which this module may import. `noopCommandDeps()` returns `() => undefined`.
   - The record: `when: (ctx) => ctx.project.open`, `enablement: () => deps.openInBrowserBlocked() === undefined`, and the getter from Decisions over a module constant `OPEN_IN_BROWSER_REQUIRES = "a page to preview"`, whose comment says it is what the generated command reference prints. The "A page to preview" block comment is replaced by one naming studio.md §10.1's table as the reasons' contract.
4. **`src/editor/shortcuts.ts`**, `registerStudioCommands`: pass `openInBrowserBlocked` (imported from `../preview/browser-target`) into the `defaultCommands({ … })` object. `StudioCommandHooks` and `studio.ts` are unchanged.
5. No registry change. `plan:studio-ui-guidelines/unrendered-placements` rewrites this record's `menus` line; whichever lands second takes both edits, and neither depends on the other.

**Integration contract.** Once this lands: `openInBrowserTarget(tab, platform)` and `openInBrowserBlocked()` are exported from `src/preview/browser-target.ts`, and nothing else computes an Open in Browser reason. `view.openInBrowser` is visible exactly while `project.open`, is enabled exactly when `openInBrowserBlocked()` is `undefined`, and `registry.disabledReason("view.openInBrowser")` is that phrase. `CommandDeps` has `openInBrowserBlocked`. §13.1 documents a getter `requires` as the way a record states a state-dependent reason, so a later record may follow the pattern with no registry change. `commandTooltip` is untouched, so the plans that move it (`plan:studio-ui-guidelines/git-panel-action-list`, `plan:studio-ui-guidelines/name-and-chord-gaps`) carry the per-condition reason with them for free.

## Tests

Run from `packages/studio`: `bun test --isolate --coverage`.

- **New `tests/browser-target.test.ts`.** First import `./harness` (for `installMockPlatform`, as `tests/page-params.test.ts` does); state through `setProjectState` (`../src/state`) and `openTab` / `closeAllTabs` (`../src/workspace/workspace`).
  - Moved from `commandbar.test.ts`, each passing a `{ previewSite }` platform stub: "a page resolves to the route it will be published at", "the root page is the site root", "trailingSlash: never drops the slash, as the published URL does", "a dynamic route waits for its params, then resolves the chosen page" (its reason now the phrase).
  - "a backend with only buildSite resolves a page": a `{ buildSite }` stub gives `{ path: "/" }` for `pages/index.md`.
  - "the first condition that holds is the reason": one row per Decisions-table line, each set up so the conditions after it also hold (a non-site project on a platform with neither member and a component open gives "a site project"; the same site project gives "a backend that can preview the site"; a tab whose `documentPath` is null gives "an open page"; `components/Card.json` gives "a document under pages/, which components/Card.json is not").
  - "every reason reads after requires": each phrase from the previous case starts lowercase and has no trailing full stop.
  - "openInBrowserBlocked reads the active tab and the registered platform": `installMockPlatform({ previewSite })`, a site project and a `pages/index.md` tab give `undefined`; after `closeAllTabs()`, "an open page".
- **`tests/commandbar.test.ts`.** Remove the moved `describe`. "reports the blocking reason instead of opening nothing" asserts one notification starting "Open in Browser requires". "a backend that can neither preview nor build says so rather than opening the editor's origin" asserts `toContain("a backend that can preview the site")`. `installRegistry` takes an optional deps override; two new cases pass the real `openInBrowserBlocked` (imported after the mocks), with a `{ previewSite }` platform and `ctx` `{ project: { open: true, isSite }, document: { open: true } }`:
  - "a component in a site project draws Open in Browser disabled, with its reason": `openSiteProject()`, `pageTab("components/Card.json")`, `mountBar()`; `control(btn("Open in Browser")).disabled` is true and `hintOf` is "Open in Browser — requires a document under pages/, which components/Card.json is not".
  - "a project that builds no site still draws Open in Browser, disabled": `isSiteProject: false`; the hint ends "requires a site project".
- **`tests/commands-defaults.test.ts`.** `recordingDeps()` gains `openInBrowserBlocked` returning a mutable `blocked`. The hide test is replaced by "Open in Browser shows whenever a project is open, and one function is its gate and its sentence": `{ project: { open: true, isSite: false } }` is visible; with `blocked = "a site project"` it is disabled, `disabledReason` is that phrase and `registry.run` throws `CommandUnavailableError` whose `requires` is it; with `blocked = undefined` it is enabled and `run` records `"openInBrowser"`; under `emptyContext` it is hidden. New: "with no state the record's requires is the reference sentence": `defaultCommandSet()`'s record has `requires` "a page to preview".
- **`tests/shortcuts.test.ts`.** "⌘K and ⌘⇧P open the palette; ⌘⇧O opens the page in a browser" gives the active tab `documentPath: "pages/index.json"` and installs a platform with `previewSite` before pressing, restoring `installMockPlatform()` in `finally`, since the gate is the real function now. New "⌘⇧O while Open in Browser is blocked is claimed and runs nothing": with a `previewSite` platform installed and the fixture's tab, which is not under pages/, the event is `defaultPrevented`, and neither `openInBrowser` nor `notified` was called. The `beforeAll` comment about `when` is reworded.

**Coverage.** `src/preview/browser-target.ts` is a new source file and ships with its test, so `bun scripts/check-coverage-manifest.ts packages/studio` finds it; every branch is reached above. Each file stays at or above `coverageThreshold = { lines = 0.958, functions = 0.941 }` in `packages/studio/bunfig.toml`; `commandbar.ts` only loses lines. Ratchet only if the workspace's worst file moves. No script changes.

## Specs & docs

**`specs/studio.md` §10.1**, in place, heading kept.

- The marker becomes: `> **Status: Implemented.** The route-addressed live preview, the dirty-document overlay, the per-project origin with acknowledged reuse, the buildSite fallback and the blocked state ship (packages/studio/src/surfaces/commandbar.ts, src/preview/browser-target.ts, src/commands/defaults.ts, preview/preview-overlay.ts, packages/server/src/live-preview.ts).` (paths in backticks, as the other markers write them).
- "The action is never hidden: when a page cannot be resolved it renders **disabled with the reason in its tooltip**, one of —" becomes: "The action is never hidden while a project is open. When it cannot act it renders **disabled, with the reason as its `requires`**: the tooltip's "requires …", the palette row's subtitle and the refusal an automation caller reads (studio-ui-guidelines.md §12.3). The first condition that holds, in this order, is the reason, so one the author can act on is never shown ahead of one they cannot:"
- The table becomes the Decisions table in that order, headed `Condition | Reason`, each reason as plain text with `<path>` and `:<param>` in backticks as today; the "Backend serves no origin" row goes.
- A sentence follows it: "The gate and the reason are one resolution, the same one the action runs, so the control is never enabled on a page the action would refuse (§13.1)."
- "Invoked by chord while blocked, the reason goes to the status bar instead of opening nothing." becomes (as the Open recommends): "Invoked by chord while blocked, nothing opens and nothing is posted: the chord is claimed as every disabled command's is (§13.3), and the reason is where studio-ui-guidelines.md §12.3 puts it. What only the backend can answer is reported after the press through `notify` (§16.1): an origin it does not serve, or a preview or build that reports errors, as a toast; one that throws, as a Problem. None of it reaches the status bar, which carries ambient state only (§16.2)."

**`specs/studio.md` §13.1**, the `requires` row appends: "A record whose reason depends on state declares it as a getter, read when a surface asks, and gates on the same function, as `view.openInBrowser` does (§10.1); the generated command reference prints what the getter answers with no state."

**`specs/studio.md` §13.3**, after "A chord whose command's `when` is false is **not a hit** …": "A chord whose command is visible but disabled **is** a hit: it is claimed, so the browser does not act on it, and it runs and reports nothing, because the greyed control and the palette's greyed row already say why (studio-ui-guidelines.md §12.3)." If review takes the Open's alternative instead, this sentence states the toast rule and §10.1's last sentence cites it.

**Fragment:** `bun run spec:change studio.md minor -m "§10.1 Open in Browser is never hidden while a project is open: it renders disabled with its first blocking condition as its requires phrase, a blocked chord runs nothing, and what only the backend can answer is reported after the press; §13.1 lets a state-dependent requires be a getter, and §13.3 states that a disabled command's chord is claimed and runs nothing."`

**Docs** (docs pages ban em dashes):

- `docs/studio/interface.md` (its `code:` lists `surfaces/commandbar.ts` and `preview/preview-overlay.ts`): add `packages/studio/src/preview/browser-target.ts` to `code:`. The paragraph starting "It is always there." becomes: "It is always there while a project is open. When it can't open the file you're on it's greyed out and its tooltip says why: a component isn't a page, a `[slug]` route needs a value picked in the pane context bar's **resolving with** popover first, a project that doesn't build a site has nothing to serve, and some hosts can't serve a preview at all. Pressing :kbd[⇧⌘O] then does nothing, and the command palette shows the same reason under the greyed row."
- `docs/studio/interface/problems-and-progress.md`, the paragraph "A command that refuses also lands here, …": its last clause overstates today's registry for a disabled chord, which this plan writes into §13.3. After "(**Keyboard**, **Palette**, **Command Bar**, **Problems**)" it ends the sentence and adds: "A shortcut whose command is greyed out is the exception: it does nothing and files nothing, because the greyed control and the palette already say why."
- Generated pages: `docs/studio/interface/commands.md` still prints "a page to preview" for the record, and `shortcuts.md` is unchanged.
- No change: `docs/start/studio-tour.md` and `docs/studio/interface/modes.md` (named by `docs:sync` through `commandbar.ts`) and `docs/studio/interface/canvas.md` (through `editor/shortcuts.ts`) name the button and its chord, not its gate; `docs/extending/embedding/platform-adapter.md`'s "reported that this backend could not preview the site" is history of an adapter bug and stays.
- The screenshots lane may re-capture Command Bar shots of a non-site project, where a greyed Open in Browser now appears; re-read the pages its comment lists.

This closes one of `studio.md`'s open items and not its last, so the spec does not graduate here.

## Acceptance

- `bun run plans:check --audit studio` reports nothing for this plan; in the landing pull request the plan file is deleted and `bun run plans:status --who-claims studio.md#10.1` names no plan.
- From `packages/studio`: `bun test --isolate --coverage tests/browser-target.test.ts tests/commandbar.test.ts tests/commands-defaults.test.ts tests/shortcuts.test.ts`, then the full `bun test --isolate --coverage` and `bun scripts/check-coverage-manifest.ts packages/studio` from the root.
- `bun run typecheck`, `bun run lint`, `bun run docs:status`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:spec-release` (the fragment is present) and `bun run docs:section-refs`.
- `git grep -n "isSite" packages/studio/src/commands/defaults.ts` shows only `project.buildSite`'s `when`; `git grep -n "openInBrowserTarget" packages/studio/src` shows the definition in `src/preview/browser-target.ts` and its two callers.
- In a running Studio (desktop, or the browser dev workflow): in a site project, open a component: Open in Browser is greyed, its tooltip reads "Open in Browser — requires a document under pages/, which components/….json is not", ⌘⇧O does nothing, and the palette row shows the same phrase greyed. Open a page and it is enabled and opens. Open a project that is not a site: the button is present, greyed, "requires a site project".
