---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#13.3
requires:
  - studio-ui-guidelines/inline-error-role
workspaces:
  - packages/studio
  - specs
  - docs
size: S
---

# A failed Settings write is announced once, by its Problem, and the section only shows it

## Context

`specs/studio-ui-guidelines.md` §13.3, the leading marker:

> **Status: Partial.** Rules 1, 2 and 4 hold (`packages/studio/src/services/notify.ts`, `src/services/announce.ts`, `src/ui/layers.ts`). Rule 3 does not for a failed `project.json` write from Settings: `commitProjectConfig` (`src/tabs/project-config.ts`) files an error Problem, which is announced assertively, and the section that asked for the write draws the same failure again in a live region, a `role="alert"` line in Locales, CSS Variables, Deploy, Extensions, Overview and Contexts, or Overview's field `error` region, so a screen reader hears it twice.

Rule 3: "**Nothing is announced twice.** An operation with an Activity entry does not also toast its completion; a failure raises exactly one Problem, deduped by `key`." `plan:studio-ui-guidelines/inline-error-role` found the double announcement while detailing §13.2 and left the lines as they are, pinned by name in its `ALERT_PARTS` gate; the marker was added in the closing pass of the detailing program.

**What the code does** (verified against the working tree on 2026-09-27; paths under `packages/studio/src/`):

- **The one filing.** Every settings write goes through `updateSiteConfig` (`site-context.ts`), which calls `commitProjectConfig` and throws its `result.error`. `commitProjectConfig` files both of its failures with `notify.error(…, { key: "save:project.json", path: "project.json", source: "Settings" })`: the refused write when the editor tab holds unsaved changes (line 398) and a rejected `writeFile` (line 437). `notify` announces every record, an error assertively (`services/announce.ts`, the `announce(…)` call in `notify.ts`).
- **The second announcement.** Each section catches the rejection and draws it again:
  - `settings/locales-section.ts` `persist`, `settings/css-vars-editor.ts` `persist` and `settings/project-sections.ts` `persist` (Deploy) set a `Could not save project.json — …` sentence that `settings-locales.json`, `settings-css-vars.json` and `settings-deploy.json` draw in a `p[part="error"][role="alert"]` mounted by a `$switch`.
  - `settings/extensions-section.ts` `onToggle` and `onRemove` set `errorMessage(error)`, drawn by `settings-extensions.json`'s `p[part="section-error"][role="alert"]` (renamed from `error` on `main` to keep a kit field's own permanent `[part="error"]` from colliding, light DOM). Its `$description` says "Not a second announcement", which is the claim rule 3 contradicts. Two of the errors it catches are filed by nobody: the in-flight latch ("Another extension operation is running") and the `RangeError`s `enableExtension` and `disableExtension` throw before any write (`settings/extension-commands.ts`).
  - `settings/general-settings.ts` `persist(patch, field)` parks the write failure under the field that asked (`name`, `description`, `url`, `favicon`) or `section`. `settings-overview.json` draws `name`, `description` and `url` through the kit fields' `error`, a polite live region (`jx-textfield`'s `[part="error"]`), `favicon` in `p[part="favicon-error"][role="alert"]`, and `section` in `p[part="section-error"][role="alert"]`.
  - `settings/contexts-section.ts` parks the write failure under its `target`, the section or a row, drawn by `settings-contexts.json`'s `section-error` alert or a `row-error` line (an alert today, a polite status line once the prerequisite lands).
- **What stays single.** A favicon upload failure (`getPlatform().uploadFile` rejecting in `general-settings.ts`) and a contexts schema refusal (`reject(container, target, …)`) are filed by nobody else, so their one line is their one announcement.

## Outcome

- `studio-ui-guidelines.md` §13.3 → unmarked (its rules hold, as the census recorded before this finding). Rule 3 says a surface may repeat a Problem's sentence beside the control that caused it, as text that is not a live region.
- Every failure a Settings section shows is announced exactly once: a write failure by `commitProjectConfig`'s Problem, and every other failure a section draws by the one `notify.error` the section files itself.

## Decisions

- **Open:** keep a visual echo, or drop the section line? Recommendation: keep it as plain text, a `p` with no `role` and no `aria-live`, beside the switch or field the reader was using. The Settings pane can cover the Bottom dock, so a sighted reader looking at the section would otherwise see nothing happen, and a node that is not a live region announces nothing, so rule 3 holds. Dropping the line is simpler but leaves the reader of the section with no sign of the failure until they open Problems.
- **Decided:** a write failure is never parked on a field. Overview's `persist` and Contexts' write path set the section-level echo, never `nameError`, `descriptionError`, `urlError`, `faviconError` or a row's `error`, because a field's region is live (the kit's by construction, and the prerequisite makes every refusal line so) and is for a refused value (§13.1's inline row), which a failed write is not.
- **Decided:** a section files what the chokepoint did not. `commitProjectConfig` records each error it filed in a module-level `WeakSet` and exports `wasFiled(error): boolean`. A section's catch calls `notify.error(sentence, { key: "settings:<section>", source: "Settings" })` for an error `wasFiled` does not know, then draws the echo either way. Because Extensions' latch and `RangeError` refusals are filed by nobody today and would go silent once the line stops being an alert.
- **Decided:** requires `plan:studio-ui-guidelines/inline-error-role`, whose `inline-refusal-regions.test.ts` is the gate this plan edits (its integration contract: "Whoever takes the §13.3 double announcement edits `ALERT_PARTS`"), and whose polite `row-error` line is the one Contexts must stop using for a write failure.

## Implementation

1. **`src/tabs/project-config.ts`**: a module-level `const filed = new WeakSet<object>()`; each of the two `notify.error` calls adds the error it returns; `export function wasFiled(error: unknown): boolean`. JSDoc cites `studio-ui-guidelines.md` §13.3.
2. **The echo lines** (`src/surfaces/`): in `settings-locales.json`, `settings-css-vars.json` and `settings-deploy.json` the `error` line, and in `settings-extensions.json`, `settings-overview.json` and `settings-contexts.json` the `section-error` line, lose `role="alert"` and gain no `aria-live`. Each keeps its `$switch` (a non-live node may be mounted with its text). Rewrite each `$description` to say it repeats a failure already announced once, citing `studio-ui-guidelines.md` §13.3 (qualified: a bare `§` in `packages/studio` means `studio.md`).
3. **The sections** (`src/settings/`):
   - `locales-section.ts`, `css-vars-editor.ts`, `project-sections.ts`: in each `persist` catch, file with `notify.error` when `!wasFiled(error)`, then set the echo as today.
   - `extensions-section.ts` `onToggle` and `onRemove`: the same.
   - `general-settings.ts` `persist`: the catch sets `{ field: "section", message }` whatever `field` was passed, and files when `!wasFiled(error)`. The `field` parameter stays for `reject`, and the favicon upload's own catch keeps `reject("favicon", …)`.
   - `contexts-section.ts`: the write catch sets `target: "section"`, and files when `!wasFiled(error)`.
4. **The gate**, `tests/inline-refusal-regions.test.ts` (the prerequisite's): remove the six echo parts from `ALERT_PARTS`, and add `ECHO_PARTS` (`{ document, part }` for those six) with the check "an echo line is not a live region": no `role`, no `aria-live`, on any node carrying the part.

**Integration contract.** Once this lands, `wasFiled` is exported from `src/tabs/project-config.ts`, a Settings section never draws a write failure in a live region, and `ECHO_PARTS` names every line that repeats a Problem. A new section that shows a failure the chokepoint filed adds its line to `ECHO_PARTS`; one that shows a failure nobody filed files it itself with `notify.error`.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`, then `bun scripts/check-coverage-manifest.ts packages/studio`. No source file is added. The per-file bar is `lines = 0.958, functions = 0.941` (`packages/studio/bunfig.toml`); ratchet only if the worst file rises.

- `tests/settings-write-queue.test.ts` (or the suite that already drives `commitProjectConfig` to a rejected write): "a failed write is filed once and marked filed": one Problem with `key` `save:project.json`, and `wasFiled` true for the error returned.
- `tests/locales-section.test.ts`, `tests/css-vars-editor.test.ts`, `tests/extensions-section.test.ts`, `tests/general-settings.test.ts`, `tests/contexts-section.test.ts`: each existing failed-write case additionally asserts one call to the announcer (the `announce` double these suites already install, or a spy on `notify`) and an echo line with no `role`. New cases: "Overview parks a failed write under the section, not the field" (the name field's `error` stays empty); "Contexts parks a failed write under the section, not the row"; "an extension refusal nobody filed is filed once" (the in-flight latch).
- `tests/inline-refusal-regions.test.ts`: the new check, plus a synthetic case proving it fails on an echo line with `role="alert"`.

## Specs & docs

`specs/studio-ui-guidelines.md` §13.3, in place: delete the leading Partial marker, and rule 3 gains a sentence after "deduped by `key`": "A surface may repeat the Problem's sentence beside the control that caused it, as text that is not a live region: the Problem is the one announcement, and a failure no Problem records is filed by the surface that shows it." **Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§13.3 a surface may repeat a Problem's sentence beside the control that caused it only as text that is not a live region, so a failed Settings write is announced once."`

Docs: `docs/studio/projects/settings.md`, the "A failed write is visible" bullet: after "in the [Problems list](/docs/studio/interface/problems-and-progress)", add ", the section you were editing repeats the sentence under its title, and a screen reader hears it once". `bun run docs:sync` also names `docs/studio/interface/problems-and-progress.md` (its `code:` lists `notify.ts`), which needs no change. No em dashes.

Landing deletes this file and removes `studio-ui-guidelines.md` §13.3 from the finding in `plans/studio-ui-guidelines/README.md`'s Spec-wide decisions.

## Acceptance

- `git grep -c '"role": "alert"' packages/studio/src/surfaces` totals 9, every one a part in `ALERT_PARTS`.
- `bun test --isolate tests/inline-refusal-regions.test.ts` from `packages/studio` passes, and fails if `role="alert"` is put back on `settings-deploy.json`'s `error` line.
- By hand, with a screen reader on the dev server and `project.json` made read-only: toggle an extension, and the failure is read once; the section shows it under its title.
- `bun run plans:status --spec studio-ui-guidelines` no longer lists `studio-ui-guidelines.md#13.3`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:section-refs` and `bun run docs:prose` pass.
