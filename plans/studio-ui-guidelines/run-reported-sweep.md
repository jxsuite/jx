---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#12.4
workspaces:
  - packages/studio
  - specs
  - docs
size: M
---

# Every surface runs a command through runReported, and the bare-run ratchet reaches zero

## Context

`specs/studio-ui-guidelines.md` §12.4, line 823:

> **Status: Partial.** The assistant projection and its undo witness, `coerceArgs` and `runReported` ship (`packages/studio/src/services/ai-command-tools.ts`, `src/commands/registry.ts`, `src/commands/run-reported.ts`), and the six family fixes recorded below hold. Thirteen modules still call `registry.run` bare, named in `NOT_YET_CONVERTED` in `tests/run-reported.test.ts`, and the `git.*` row's failure returns through the Source Control panel, which is §12.5's.

The contract is the section's argument corollary: both refusal shapes (`CommandUnavailableError` from the gate, `RangeError` from `coerceArgs` or a `run` body) are thrown synchronously by `registry.run`, so "a surface does not call it bare". A click, chord or notice action goes through `runReported`, which files the sentence in Problems under the surface's name. The ratchet the section names is what this plan empties.

**What exists** (verified against the tree):

- `packages/studio/src/commands/run-reported.ts`: `runReported(registry, id, args?, source = id)` and `runActiveReported(id, args?, source?)`. Both return a promise that never rejects, key the Problem `command.run:<id>`, and send a non-refusal to `console.error` as well. Fourteen modules already call them, each with a surface name: "Keyboard", "Palette", "Command Bar", "Status Bar", "Jump Bar", "Tabs", "Files", "Problems", "Notifications", "Settings", "Languages", "Assistant", "Editor".
- The sweep in `packages/studio/tests/run-reported.test.ts`: `BARE_RUN` (`/\b\w*[rR]egistry(?:\(\))?\??\.run\(/`) over comment-stripped `src/**/*.ts`; `OWNS_ITS_REFUSAL` names `commands/run-reported.ts`, `services/ai-command-tools.ts` and `services/automation.ts`; `NOT_YET_CONVERTED` names thirteen files, and a second test asserts each entry still holds a bare call. No `.run(` on a registry value escapes the regex today. The three `activeRegistry()` results bound to other names never call `.run(`: `app` in `editor/context-menu.ts`, `live` in `panels/settings-menu.ts`, and `command` in `settings/general-settings.ts`, which is a record. Nothing outside `packages/studio/src` calls one.
- The six family fixes hold: `git.createGithubRepository` has `enablement: (ctx) => ctx.project.isRepo` (`src/panels/git-panel.ts`), all three `publish.*` records read `platformSupportsPublish()` (`src/publish/publish-commands.ts`), `SPLICEABLE_SELECTION` gates Delete and Duplicate (`src/commands/defaults.ts`), `collab.showStatus` requires a `documentPath` (`src/collab/collab-commands.ts`), `view.setActivity` refuses a panel that is registered but unavailable (`src/shell.ts`), and `inspector.focus.*` requires an open document as `view.setRightTab` does (`inspectorFocusCommands`, `src/commands/defaults.ts`).

**What is missing**: eighteen call sites in the thirteen modules.

| Module                         | Site                                                                       | Command(s)                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas/canvas-render.ts`      | `renderDerivationNotice`'s action (`void registry?.run(pin.id)`)           | `pane.pin`                                                                                                                                                                                                |
| `canvas/iframe-host.ts`        | the `popoverTargetClick` case and the two branches of `commandTargetClick` | `canvas.setPopoverOpen`, `canvas.setDialogOpen`                                                                                                                                                           |
| `content/entry-editor.ts`      | the `openContentTypes` action                                              | `settings.open { section: "content" }`                                                                                                                                                                    |
| `editor/context-menu.ts`       | `activateRow` (`contextMenuRegistry().run(id)`)                            | any `context/element` record                                                                                                                                                                              |
| `panels/frontmatter-panel.ts`  | the card's `openSeo`                                                       | `document.openSeo`                                                                                                                                                                                        |
| `panels/head-panel.ts`         | the Page panel's `openSeo`                                                 | `document.openSeo`                                                                                                                                                                                        |
| `panels/pane-context.ts`       | `menuRow`'s `run`, `runContextCommand`, `manageContexts`                   | `pane.derive`, `pane.pin`, `pane.unsplit`; `canvas.setBreakpoint`, `i18n.switchLocale`, `canvas.setRouteParam`, `canvas.setTestProp`, `canvas.setColorScheme`, `canvas.setLayoutVisible`; `settings.open` |
| `panels/properties-panel.ts`   | `revealSignal` (two calls), the `openLayout` action                        | `view.setActivity`, `data.expandRow`; `pane.derive { preset: "layout" }`                                                                                                                                  |
| `panels/seo-modal.ts`          | `seoProvenance`'s `open`                                                   | `settings.open { section }`                                                                                                                                                                               |
| `panels/style-panel.ts`        | the local `runCommand`, called from six places                             | `view.setActivity`, `settings.open`, `data.expandRow`, `canvas.setPopoverOpen`, `canvas.setDialogOpen`                                                                                                    |
| `publish/deploy-checklist.ts`  | `runNextStep`                                                              | the next step's `command` (`git.init`, `git.createGithubRepository`, `git.push`, `publish.setUp`, `publish.deploy`)                                                                                       |
| `publish/publish-panel.ts`     | `openAccounts`                                                             | `app.preferences { section: "accounts" }`                                                                                                                                                                 |
| `settings/general-settings.ts` | the `openStyles` action                                                    | `styles.open`                                                                                                                                                                                             |

The refusals these sites let out are real, not theoretical. `pane.derive` refuses a preset with a `RangeError` (the reason `properties-panel.ts` hides the Open Layout chip in a derived pane). `canvas.setPopoverOpen` throws on a path that names no popover, and `iframe-host.ts` records that the throw once "came straight back out of this message listener, taking every handler queued behind that message with it".

**No double report** (§13.3 rule 3). None of the eighteen sites catches or notifies on its own, and the run bodies behind them report operational failures and then _return_: `initRepository` and `pushCurrentBranch` (`src/panels/git-panel.ts`), `createGithubRepository` (`src/github/github-publish.ts`) and `runDeploy`'s `activity.fail` (`src/publish/publish-commands.ts`) all do. No `notify.error` or `notify.warn` in `src/` is followed by a `throw` within ten lines. So `runReported` files only what escaped to the console before: the gate's refusal, a coercion or argument refusal, or a crash.

**One collision**: `reportSeoProblems` (`src/panels/head-panel.ts`) runs `clearProblems((record) => record.source === SEO_PROBLEM_SOURCE)` every time the SEO modal opens. A refusal filed from that modal under its own name, "Search appearance", would be erased the next time the modal opened, though nothing had fixed it. The other three wholesale-cleared sources (`POPOVER_PROBLEM_SOURCE` "Popover", `A11Y_PROBLEM_SOURCE` "Accessibility", `REDIRECTS_PROBLEM_SOURCE` "Redirects") are not names any of these sites would use.

**Not this plan's**: the `git.*` row's return path through `ACTIONS` in `git-panel.ts` is a direct call, not a `registry.run`. `plan:studio-ui-guidelines/git-panel-action-list` owns it under §12.5, whose marker states it. Three plans edit files this one touches, with no shared function and no ordering either way: `plan:studio-ui-guidelines/name-and-chord-gaps` (`context-menu.ts`'s `buildRows`, leaving `activateRow` here by its own Decided line), `plan:studio-ui-guidelines/unrendered-placements` (`pane-context.ts`'s preset rows) and `plan:studio-ui-guidelines/retire-renderer-registry` (`canvas-render.ts`). Whichever lands second rebases.

## Outcome

- studio-ui-guidelines.md §12.4 → Implemented. `NOT_YET_CONVERTED` and its assertion are deleted. The sweep admits a bare `.run(` on a registry only in the three owners of their refusal, and every other surface files a refusal in Problems under its own name.

## Decisions

- **Decided:** a site spelled `activeRegistry()?.run(…)` becomes `void runActiveReported(id, args, source)`, and a site that holds a registry becomes `void runReported(registry, id, args, source)`. This is the split `run-reported.ts` documents: `runActiveReported` keeps the `?.`'s silence before a registry is published. `canvas-render.ts` and `properties-panel.ts`'s `revealSignal` only held a nullable `activeRegistry()` result, so they take `runActiveReported`. `context-menu.ts` holds `contextMenuRegistry()`, which is never null (the app's registry or the fallback), so it takes `runReported`.
- **Decided:** `activateRow` keeps its order: `const settled = runReported(contextMenuRegistry(), id, undefined, "Context Menu"); dismissContextMenu(); void settled;`. `runReported` enters `registry.run` synchronously, so every `run` still reads `deps.target()` before dismissal clears it. That ordering is the reason the current code runs first.
- **Decided:** a two-verb reveal (`revealSignal`, and the Style tab's `view.setActivity` + `data.expandRow` pair) runs both verbs, and each refusal is its own Problem row. The two gates are independent ("an open project" and a name the document defines), so two rows means two failures, which §13.3 rule 3 permits. Today a synchronous throw from the first verb silently skips the second, and nothing depends on that.
- **Decided:** `reportSeoProblems` clears only its own rows: `clearProblems((record) => record.source === SEO_PROBLEM_SOURCE && record.key?.startsWith("seo.") === true)`. The SEO modal then files its refusals under `SEO_PROBLEM_SOURCE`, the name the person sees. Clearing by source is broader than the report's own key space (`seo.<warning id>`), and a refusal must outlive a re-check that did not fix it. Narrowing the clear costs one line; a second, differently cased "Search Appearance" group in Problems would look like a bug.
- **Decided:** the sweep's regex and file walk stay as they are. It already matches every spelling in the tree, and the registry values bound to other names never call `.run(` (see Context). Widening it to arbitrary `\w+\.run(` would hit effect scopes and `EmptyStateAction.run`.
- **Open:** the source names, which are user-visible text (the Problems panel groups by them, and `docs/studio/interface/problems-and-progress.md` says a refusal "is grouped under the surface that ran it"). Recommendation: the name the person sees on the control's surface, following the fourteen existing callers: "Canvas" (`canvas-render.ts`, `iframe-host.ts`), "Entry Editor" (`entry-editor.ts`), "Context Menu" (`context-menu.ts`, which also serves the Outline's right-click), "Document Header" (`frontmatter-panel.ts`), "Page" (`head-panel.ts`, its `registerPanel` title), "Context Bar" (`pane-context.ts`), "Content" and "Style" (`properties-panel.ts`, `style-panel.ts`, their titles in `INSPECTOR_TABS`), `SEO_PROBLEM_SOURCE` (`seo-modal.ts`), "Deploy Checklist" (`deploy-checklist.ts`), "Publish" (`publish-panel.ts`) and "Settings" (`general-settings.ts`). The one arguable pair is "Content": it is the Inspector tab's title and already the source of the content-collection reports in `content/entry-commands.ts`. "Inspector" for both Inspector tabs is the alternative. I recommend the tab titles, because a row naming the tab that was clicked is the more useful answer, and the row also names the command, so the two "Content" groups stay distinguishable.

## Implementation

All paths are under `packages/studio/src/` unless noted. Each conversion imports `runActiveReported` or `runReported` from `../commands/run-reported` and drops the `activeRegistry` import where it becomes unused (`iframe-host.ts`, `entry-editor.ts`, `frontmatter-panel.ts`, `head-panel.ts`, `seo-modal.ts`, `style-panel.ts`, `publish-panel.ts`; oxlint flags any that remain).

1. `canvas/canvas-render.ts`, `renderDerivationNotice`: in the action's `run`, `void runActiveReported(pin.id, undefined, "Canvas")`. Keep `const registry = activeRegistry(); const pin = registry?.get("pane.pin")`: it decides whether the action is drawn at all.
2. `canvas/iframe-host.ts`, the `popoverTargetClick` and `commandTargetClick` cases: the three calls become `void runActiveReported("canvas.setPopoverOpen" | "canvas.setDialogOpen", { open, path: msg.targetPath }, "Canvas")`. The kind guards (`isPopover`, `isDialog`, the null check) stay: they implement the platform's "ignore the click" (spec.md §8.7) and must not turn into Problems.
3. `content/entry-editor.ts`, `openContentTypes`: `void runActiveReported("settings.open", { section: "content" }, "Entry Editor")`.
4. `editor/context-menu.ts`, `activateRow`: as in Decisions. Update the JSDoc: "A disabled row never reaches here; a refusal that does (state moved between render and click) is filed in Problems under Context Menu."
5. `panels/frontmatter-panel.ts`, `openSeo`: `void runActiveReported("document.openSeo", undefined, "Document Header")`.
6. `panels/head-panel.ts`: `openSeo` becomes `void runActiveReported("document.openSeo", undefined, "Page")`. In `reportSeoProblems`, narrow the clear as in Decisions and extend the JSDoc: "Cleared by its own `seo.` keys, not by source, so a refusal filed from the modal under the same name survives a re-check."
7. `panels/pane-context.ts`: `menuRow`'s `run` keeps `focusPane(row.pane)` first, then `void runActiveReported(row.command, row.args, "Context Bar")`. `runContextCommand` becomes `void runActiveReported(id, { ...args, pane: paneId }, "Context Bar")`. `manageContexts` becomes `void runActiveReported("settings.open", { section: "contexts" }, "Context Bar")`.
8. `panels/properties-panel.ts`: `revealSignal` becomes two `void runActiveReported(…, "Content")` calls (drop the local `registry`), and `openLayout` becomes `void runActiveReported("pane.derive", { preset: "layout" }, "Content")`. In `layoutView`, the comment on `layoutCanOpen` says a derived pane's `pane.derive` "can only throw into a floating `void registry.run(…)` that swallows it". Rewrite it: from a derived pane the chip could only file a refusal, and a control that can only refuse is still worse than no control. The gate stays.
9. `panels/seo-modal.ts`, `seoProvenance`'s `open`: `void runActiveReported("settings.open", { section }, SEO_PROBLEM_SOURCE)`, importing the constant from `./head-panel` as a value. `seo-modal.ts` already imports that module's types, and `head-panel.ts` does not import `seo-modal.ts`, so no cycle is added.
10. `panels/style-panel.ts`, `runCommand`: the body becomes `void runActiveReported(id, args, "Style")`. Its six callers are unchanged.
11. `publish/deploy-checklist.ts`, `runNextStep`: `void runActiveReported(next.command, undefined, "Deploy Checklist")`.
12. `publish/publish-panel.ts`, `openAccounts`: `void runActiveReported("app.preferences", { section: "accounts" }, "Publish")`.
13. `settings/general-settings.ts`, `openStyles`: `void runActiveReported("styles.open", undefined, "Settings")`.
14. `tests/run-reported.test.ts`: delete `NOT_YET_CONVERTED` and its JSDoc. The first sweep test becomes "every bare `.run(` on a registry is an owner of its refusal" (`unexplained` filters on `OWNS_ITS_REFUSAL` alone). The second becomes "each owner named still spells it bare" (`stale` over `OWNS_ITS_REFUSAL` alone). In the file header, delete the sentence that describes the `?.run(` ratchet.
15. `commands/run-reported.ts`, header: replace "and the `?.run(` spelling issue 333 did not list survives in a RATCHET … must drop its entry" with "and no other file may spell it bare." Add to `runReported`'s `source` JSDoc: "the name the person sees on the surface the control belongs to, and never a source a report clears wholesale (`clearProblems` by source), which would erase the refusal on a re-check that fixed nothing."

**Integration contract.** Once this lands, `tests/run-reported.test.ts` fails on any `registry.run(`, `registry?.run(`, `activeRegistry()?.run(` or `contextMenuRegistry().run(` in `packages/studio/src` outside `commands/run-reported.ts`, `services/ai-command-tools.ts` and `services/automation.ts`, with no ratchet to add a file to. A plan that adds a control running a command (`plan:studio-ui-guidelines/git-panel-action-list`, `plan:studio-ui-guidelines/name-and-chord-gaps`, `plan:studio-ui-guidelines/unrendered-placements`, `plan:studio/file-tree-command-records`) must call `runReported`/`runActiveReported` with a surface name. `reportSeoProblems` clears only `seo.`-keyed rows. The Context Bar's preset rows file under "Context Bar", and a plan that redraws them from a placement keeps that name. studio-ui-guidelines.md §12.4 is `Implemented`.

## Tests

From `packages/studio`: `bun test --isolate --coverage`. The sweep reads the whole `src` tree, so the whole suite is the proof. The new cases share one shape. The DOM test files already import `./harness` first. Each case publishes a registry (or reuses the file's existing fake) whose record for the site's id refuses, triggers the control, and asserts that `problems.map((r) => [r.source, r.message])` equals `[[<source>, <sentence>]]` and that the trigger did not throw. `<sentence>` is `registry.refusalMessage(id)` for a gate refusal (`enablement: () => false` with a `requires`), or the thrown `RangeError`'s message. The refusing records are entered only up to the gate or a synchronous throw, so no lazily imported implementation runs and no `mock.module()` double is needed.

- `tests/run-reported.test.ts`: the two sweep tests as rewritten in step 14. The helper tests are unchanged.
- `tests/canvas-render.test.ts`, beside the "is still open here" case: "Keep This Document files a refusal under Canvas" (`pane.pin` gated off; click `[part="empty-action"]`).
- `tests/iframe-host.test.ts`, in the `withRegistry` block: "an invoker click the popover record refuses is filed under Canvas, and the next message still runs". Deliver `popoverTargetClick` at a path that is not a popover in a document that has one (the `RangeError` "names no popover"), then deliver a valid `commandTargetClick` and assert that `opened` gains its entry.
- `tests/entry-editor.test.ts`, beside "a document in no collection says so and offers the content types section": "Open Content Types files a refusal under Entry Editor".
- `tests/context-menu.test.ts`: "a row whose run refuses is filed under Context Menu, and the menu still closes". Publish a registry with one `selection`-level `context/element` record whose `run` throws `RangeError`, right-click, click the row, then assert the row and that the menu is dismissed.
- `tests/frontmatter-panel.test.ts`, beside "the card offers the door to Search appearance, and it runs the command": "a refused door is filed under Document Header".
- `tests/head-panel.test.ts`, beside the `document.openSeo` case: "a refused door is filed under Page".
- `tests/pane-context.test.ts`: "a preset row the record refuses is filed under Context Bar" (`pane.derive` throwing `RangeError`), and "Manage contexts… files a refusal under Context Bar".
- `tests/properties-panel.test.ts`: "Open Layout's refusal is filed under Content" (a fake `{ run }` that throws `RangeError`, in the shape of the existing Open Layout test). Next to the existing `data.expandRow` assertion: "a bound chip runs both reveal verbs, and a refused first verb does not stop the second".
- `tests/seo-modal.test.ts`, in "SEO warnings are Problems too": "a provenance chip's refusal is filed under Search appearance and survives the modal's re-check". Click the site-head chip with `settings.open` gated off, close and reopen the modal, and assert that the refusal row is still listed beside the re-filed warnings.
- `tests/style-panel.test.ts`: "a Target Line refusal is filed under Style" (`runMock.mockImplementationOnce` throwing `RangeError`, then the contexts segment).
- `tests/deploy-checklist.test.ts`, in "the deploy-checklist surface": "the action's refusal is filed under Deploy Checklist" (`git.init` gated off).
- `tests/publish-panel.test.ts`, beside the `app.preferences` case: "the Accounts link's refusal is filed under Publish".
- `tests/general-settings.test.ts`, in "global styles shortcut": "Open Project Styles' refusal is filed under Settings".

Coverage: no source file is added, so the manifest check (`bun scripts/check-coverage-manifest.ts packages/studio`) is unaffected. Every conversion removes a `?.` branch and each gains a test, so no file should fall. `packages/studio/bunfig.toml` gates per file at `lines = 0.958, functions = 0.941`. If the coverage table shows the workspace floor rising meaningfully, ratchet the threshold to just below the new minimum.

## Specs & docs

**`specs/studio-ui-guidelines.md` §12.4**, in place:

- The marker becomes (replacing the Partial blockquote):

  ```markdown
  > **Status: Implemented.** The assistant projection and its undo witness, `coerceArgs` and `runReported` ship (`packages/studio/src/services/ai-command-tools.ts`, `src/commands/registry.ts`, `src/commands/run-reported.ts`), the six family fixes recorded below hold, and every surface runs a command through `runReported` or `runActiveReported`: the sweep in `tests/run-reported.test.ts` allows a bare `registry.run` only in the helper and in the two callers that hand the refusal to its reader.
  ```

  The `git.*` clause is dropped: §12.5's marker states the Source Control panel's bypass, and this section's `git.*` row (the record's missing `enablement`) holds.

- The corollary's last sentence, "The sweep in `tests/run-reported.test.ts` holds the tree to that spelling; the `?.run(` sites it has not reached yet are a ratchet there, named one by one, that only shrinks.", becomes: "The sweep in `tests/run-reported.test.ts` holds the tree to that spelling, and names the only callers that may run a record bare: the helper itself, and `services/automation.ts` and `services/ai-command-tools.ts`, which hand the refusal to the script or the model that reads it."

§10 does not cite §12.4, so its marker is untouched. No other spec names the ratchet.

Fragment: `bun run spec:change studio-ui-guidelines.md minor -m "§12.4: the last thirteen surfaces that ran a command bare now run it through runReported, so a refusal from the canvas, the context menu, the context bar, the Inspector, Search appearance, Settings and Publish lands in Problems under that surface's name, and the bare-run ratchet is gone"`.

**Docs** (no em dashes):

- `docs/studio/interface/problems-and-progress.md` (its `code:` lists `run-reported.ts`): the paragraph "A command that refuses also lands here, whichever surface you ran it from…" becomes true as written. Add one example to its parenthetical: "(**Keyboard**, **Palette**, **Command Bar**, **Context Menu**, **Problems**)".
- Checked, no change: every other page `bun run docs:sync` names through `code:`. They describe what each control does, which this plan does not change, not where its refusal goes. `docs/studio/interface/modes.md` (`canvas-render.ts`, `pane-context.ts`), `docs/studio/design.md` and `docs/studio/logic/code.md` (`canvas-render.ts`); `docs/studio/projects/content-types.md` (`entry-editor.ts`); `docs/studio/interface/canvas.md` (`context-menu.ts`); `docs/studio/editing/frontmatter.md` (`frontmatter-panel.ts`, `head-panel.ts`, `seo-modal.ts`) and `docs/studio/editing.md` (`head-panel.ts`); `docs/studio/interface/tabs.md` and `docs/studio/design/breakpoints.md` (`pane-context.ts`); `docs/studio/design/stylebook.md` (`pane-context.ts`, `style-panel.ts`); `docs/studio/design/components.md` (`pane-context.ts`, `properties-panel.ts`); `docs/studio/design/properties.md` (`properties-panel.ts`); `docs/studio/design/style-inspector.md`, `docs/studio/design/states-and-selectors.md` and `docs/README.md` (`style-panel.ts`); `docs/studio/publish.md` (`deploy-checklist.ts`); `docs/studio/publish/cloudflare.md` (`publish-panel.ts`); `docs/studio/projects/settings.md` (`general-settings.ts`). `docs/extending/reference/standards.md` is generated. No docs page's `spec:` cites `studio-ui-guidelines.md#12.4`.

studio-ui-guidelines.md keeps other open items, so it does not graduate.

## Acceptance

- `bun run plans:status --spec studio-ui-guidelines` no longer lists `studio-ui-guidelines.md#12.4`. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run docs:section-refs` pass.
- `git grep -n NOT_YET_CONVERTED packages/studio` prints nothing.
- `git grep -nF -e 'activeRegistry()?.run(' -e 'registry?.run(' -e 'contextMenuRegistry().run(' packages/studio/src` prints only the doc-comment line in `commands/run-reported.ts`.
- From `packages/studio`: `bun test --isolate --coverage` passes with no per-file threshold failure, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- In Studio (the `packages/studio:verify` recipe): split a pane, choose Layout from the ⟲ menu on a page with no layout, and press **Keep This Document** on a lens, or choose a preset the page cannot support. The Problems tab gains a row under **Context Bar** or **Canvas** carrying the record's sentence, and the console shows no uncaught error.
