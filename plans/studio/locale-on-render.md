---
status: drafted
disposition: implement
claims:
  - studio.md#20.2
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: S
---

# Every artboard draws in its pane's rendering language from its first paint

## Context

`specs/studio.md` §20.2, line 1796. The census moved the marker from the section's foot to directly under its heading, and moved the Partial off §20, whose own text ships:

> **Status: Partial.** `i18n.switchLocale`, the persisted `previewLocale`, the context-bar segment and the frame's `lang` and `dir` write ship (`packages/studio/src/canvas/canvas-utils.ts`, `panels/pane-context.ts`, `canvas/iframe-entry.ts`). A host that mounts after the value was set does not receive it: the locale is posted only to hosts already live (`postLocaleToLiveHosts` in `canvas/iframe-host.ts`) and the `render` message in `canvas/iframe-protocol.ts` carries none, so a restored `previewLocale` does not reach the artboard until the author touches the control.

§20's own marker (line 1784) ends "The one gap, a freshly mounted artboard not learning its pane's rendering language, is marked on §20.2."

**What exists** (verified on 2026-09-27; paths under `packages/studio/`)

- `i18n.switchLocale` (`src/canvas/canvas-utils.ts`, line 1329) refuses an undeclared tag, writes `tab.session.ui.previewLocale` and calls `repaint(args)`, which is `deps.renderPane`: every switch is followed by a render of that pane.
- `previewLocale` persists per document in `src/workspace/session.ts` (`uiOf`, `readUi`, `restoreSession`). `readUi` checks well-formedness only, and its comment says "the control refuses an undeclared tag on the way in and the render falls back on the way out". Nothing does the falling back.
- `src/studio.ts`, lines 792–800: a per-pane effect calls `postLocaleToLiveHosts(tabOfPane(paneId)?.session.ui.previewLocale ?? null, surfaceForPane(paneId).wrap)`. `postLocaleToLiveHosts` (`src/canvas/iframe-host.ts`, line 3214) computes `dir` with `localeDirection` (`@jxsuite/schema/locale`) and posts `{ kind: "setLocale", locale, dir }` only to hosts that are `ready`. A booting host holds one `pending` message (`deliverRender`), and the effect re-runs only when the value changes.
- The frame's `setLocale` branch (`src/canvas/iframe-entry.ts`, line 915) sets `lang` and `dir` on the document element, or removes both for `null`. The attributes live on the root, so a render (which replaces only the container's children) does not lose them. The gap is only a host that was not ready when the value was posted: a restored session, a second pane, a reload, a mode switch or a breakpoint artboard mounted afterwards.
- The precedent: `render` carries `colorScheme`, filled at post time per artboard by `schemeWireFor(viewTab)` in `mountIframeCanvas` and `mountStylebookCanvas`, and the frame applies it on every current render (`applyPreviewColorScheme` in `src/canvas/iframe-render.ts`, called at line 940). `PreparedRender` omits it because the prepared payload is shared across a pass's hosts.
- The segment: `localeOf` in `src/panels/pane-context.ts` (line 810) computes `effective = previewLocale ?? own`, where `own = localeOfPath(documentPath) ?? defaultLocale`.
- Tests: `tests/iframe-host.test.ts` ("postLocaleToLiveHosts carries the direction with the tag, to ready hosts only", and the colour-scheme describe "the colour scheme a render posts is the RENDERED tab's"), `tests/iframe-entry.test.ts` ("setLocale writes lang and dir on the root, and clears both"), `tests/pane-context.test.ts` (the language segment cases from line 725), `tests/session.test.ts`.

**Found while detailing**

- **The artboard never draws the document's own language.** With no choice made, the segment marks the document's own language as selected, with the hint "the language of the file this pane has open", and the summary names none. Nothing writes that language on the artboard. The frame boots from `canvas.html`, which is `<html lang="en">`, so a page under `pages/ar/` draws `lang="en"` left to right until the author picks Arabic from a control that already says Arabic. `setLocale`'s docblock says `null` makes the frame "fall back to whatever the rendered document declares", but nothing in the canvas declares a root language.
- **A fresh frame and a cleared one disagree.** A fresh frame keeps `canvas.html`'s `lang="en"`. `setLocale` with `null` removes it. Once `render` applies the value on every render, a `null` handled that way would strip `lang="en"` from every canvas of a project that declares no locales, which changes `:lang()` matching and `hyphens: auto` there.
- **A restored tag the project no longer declares is drawn and reported.** `postLocaleToLiveHosts` posts it verbatim, and `localeOf` reports it as the pane's language, although `readUi`'s comment promises the render falls back.
- **A restored value can miss a host that is already booting.** `restoreSession` writes the view settings only after every file has opened ("applied AFTER every tab exists", `src/workspace/session.ts`), so a pane may already have posted its render by then. The render effect in `studio.ts` (lines 745–782) does not track `previewLocale`, and `postLocaleToLiveHosts` skips a host that is not `ready`, so that host boots from a `pending` render carrying the old value and nothing re-renders it. Carrying the value on `render` alone does not close the restore case the marker names.
- **The frame writes `dir="ltr"`** for a left-to-right tag. `site-architecture.md` §13.4 says the build never does ("`dir="ltr"` is never written").
- Out of this item: neither the segment nor the artboard reads a page's `$lang` or `$dir`, or `defaults.lang` (`site-architecture.md` §13.4's other rows). `plan:studio/canvas-injects-context` asks whether `$page.locale` follows the route or this pane language, and it shares no code with this plan.

## Outcome

studio.md §20.2 → Implemented. Every `render` carries the pane's rendering language and its direction, and a render still pending on a booting host is updated, so an artboard mounted or booting when the value was set draws in it from its first paint. The segment and the artboard read one rule. A restored tag the project no longer declares falls back to the document's own language. §20's marker loses its pointer to the gap. No Future remainder.

## Decisions

- **Open:** with no language chosen, does the artboard draw in the document's own language? Recommendation: yes, on any project that declares an `i18n` block. The value is the one the segment already reports: the pane's declared choice, else the locale the file's path sits under, else the default locale. `null` is kept for a project without locales. Reasons: §20.2's last paragraph treats the document's own language as what a pane without a choice is in ("a French page open in a French pane is not a rendering context worth reporting"), the segment already marks it selected, and an Arabic translation drawn left to right is the RTL failure §20.2 exists to prevent. It changes what authors see on every translation page, which is why it needs sign-off. If declined, `getEffectiveRenderLocale` returns only the declared choice (else `null`), `localeOf` keeps its own fallback chain, and the spec and docs sentences about the document's own language are dropped.
- **Decided:** `render` carries `locale: string | null` and `dir: "ltr" | "rtl"`, the same pair `setLocale` carries, and both are required like `colorScheme`. They are filled at post time from the artboard's view tab and omitted from `PreparedRender`. This follows the protocol's own reasoning for `colorScheme`, `diffMarks` and `popoverOpen`: a booting host holds one pending message, so the value must ride on it, and the prepared payload is shared by every host in the pass, so a per-tab value cannot be baked into it. A lens gets its source tab's language through `viewTab`, which §20.2 already states.
- **Decided:** one rule, `getEffectiveRenderLocale(previewLocale, documentPath)` in `src/site-context.ts`, is read by the render, the live push in `studio.ts` and the segment's `localeOf`. §20.1 puts the locale reader's effective-value helpers there, and a push, a render and a segment each deriving the language would drift apart the way the scheme's push and render paths once did.
- **Decided:** a chosen tag is used only while the project declares it (canonicalized, then matched against `getEffectiveLocales().locales`). Otherwise the rule answers as if nothing were chosen, and the stored value is left alone. `readUi`'s comment already makes this promise, and it mirrors the refusal `i18n.switchLocale` applies on the way in. Leaving the stored value means a locale that is re-declared comes back.
- **Decided:** the frame applies the pair through one function, `applyPreviewLocale`, for both `setLocale` and `render`. `null` restores the `lang` and `dir` the frame booted with, and does not remove them. An `ltr` tag writes `lang` and restores the booted `dir` rather than writing `dir="ltr"`. The first keeps `canvas.html`'s `lang="en"` on a project without locales now that every render applies the value. The second is `site-architecture.md` §13.4's rule for the built page.
- **Decided:** a host that is still booting when the language changes has its pending render updated: `postLocaleToLiveHosts` rewrites `locale` and `dir` on a non-ready host's `pending` render instead of skipping it. `i18n.switchLocale` is followed by a render (`repaint` is `renderCanvas`), but `restoreSession` writes `previewLocale` after the files have opened and is followed by none (Context), so a render already pending would deliver the old value. Patching the one pending message is exact, covers every writer, and costs no render. Rejected: tracking `previewLocale` in `studio.ts`'s render effect, which also closes it but adds a full render to every change of a value the frame applies without one, and leaves the push path wrong for the next writer that forgets.

## Implementation

Paths under `packages/studio/`.

1. `src/site-context.ts`, beside `getEffectiveLocales`: add `export function getEffectiveRenderLocale(previewLocale: string | null | undefined, documentPath: string | null | undefined): string | null`.
   - `const i18n = getEffectiveLocales()`. If it is `null`, return `null`.
   - `const chosen = canonicalizeLocale(previewLocale)`. If `chosen !== null && i18n.locales.includes(chosen)`, return it.
   - Return `localeOfPath(documentPath ?? "", i18n) ?? i18n.defaultLocale`.
   - Import `canonicalizeLocale` and `localeOfPath` from `@jxsuite/schema/locale`. Move `localeOf`'s "fallback chain" paragraph into this docblock, and add the stale-tag sentence. No new `@docs` tag is needed, because `docs/studio/interface/languages.md` already lists this file in its `code:`.
2. `src/panels/pane-context.ts`, `localeOf`: keep the `< 2` early return and `pathLocale`. Compute `own = getEffectiveRenderLocale(null, tab.documentPath)!` and `effective = getEffectiveRenderLocale(tab.session.ui.previewLocale, tab.documentPath)!`. Both are non-null here because `i18n` is. `overridden` stays `effective !== own`, so a stale tag is no longer reported. The docblock points at the helper instead of restating the chain.
3. `src/canvas/iframe-protocol.ts`, the `render` variant, after `colorScheme`: add `locale: string | null` and `dir: "ltr" | "rtl"`. Their docblock gives the pending-message reason, and says `null` is "a project that declares no locales: the frame restores the language it booted with". In `setLocale`'s docblock, replace the `null` paragraph with the same sentence.
4. `src/canvas/iframe-host.ts`
   - `PreparedRender`: the `Omit` list becomes `"colorScheme" | "dir" | "gen" | "kind" | "locale"`.
   - Add `function localeWireFor(tab: Tab | null): { locale: string | null; dir: "ltr" | "rtl" }` next to `schemeWireFor`. It returns `locale = tab ? getEffectiveRenderLocale(tab.session.ui.previewLocale, tab.documentPath) : null` and `dir = localeDirection(locale)`.
   - `mountIframeCanvas`: spread `...localeWireFor(viewTab)` into the message beside `colorScheme`, with the post-time comment. `mountStylebookCanvas`: spread `...localeWireFor(tabOfContainer(canvasEl))` beside its `colorScheme`.
   - `postLocaleToLiveHosts`: for a host that is not `ready` and whose `pending` is a `render`, set `host.pending = { ...host.pending, dir, locale }` (a copy, not a mutation). A booting host with nothing pending is still skipped: its render has not been posted, and `localeWireFor` reads the value when it is. The docblock says why: a host that mounts later learns the language from its `render`, and one that is booting learns it from the render it is waiting to receive.
5. `src/studio.ts`, the per-pane locale effect (lines 792–800): `const tab = tabOfPane(paneId); postLocaleToLiveHosts(tab ? getEffectiveRenderLocale(tab.session.ui.previewLocale, tab.documentPath) : null, surfaceForPane(paneId).wrap);`. Reading `tab.documentPath` makes a tab switch re-post as well. That is harmless, because the render that follows carries the same value.
6. `src/canvas/iframe-render.ts`, beside `applyPreviewColorScheme`:
   - `export interface LocaleBaseline { lang: string | null; dir: string | null }`.
   - `export function captureLocaleBaseline(doc: Document): LocaleBaseline` reads the two root attributes.
   - `export function applyPreviewLocale(doc: Document, locale: string | null, dir: "ltr" | "rtl", baseline: LocaleBaseline): void`. It sets `lang` to `locale ?? baseline.lang`, and sets `dir` to `"rtl"` when `locale !== null && dir === "rtl"`, else to `baseline.dir`. A `null` target removes that attribute.
   - The docblock carries the reasons from Decisions (root attributes survive renders; `null` restores; `dir="ltr"` is never written, `site-architecture.md` §13.4).
7. `src/canvas/iframe-entry.ts`, `startCanvasIframe`:
   - `const localeBaseline = captureLocaleBaseline(container.ownerDocument)` with the other state at the top.
   - The `setLocale` branch body becomes `applyPreviewLocale(container.ownerDocument, msg.locale, msg.dir, localeBaseline)`, and its comment keeps the "patch-free" reasoning.
   - In the render path, directly after `applyPreviewColorScheme(container.ownerDocument, msg.colorScheme ?? null)`, add `applyPreviewLocale(container.ownerDocument, msg.locale ?? null, msg.dir ?? "ltr", localeBaseline)`. This is after the stale-generation return and before the async render, so the first paint already has the language.
   - The returned teardown restores the baseline (`applyPreviewLocale(doc, null, "ltr", localeBaseline)`), so a frame torn down in a test leaves no language for the next one to capture.

**Integration contract.** Once this lands:

- `getEffectiveRenderLocale(previewLocale, documentPath)` in `src/site-context.ts` is the one answer to "what language does this pane render in": `null` without an `i18n` block, otherwise a declared canonical tag.
- Every `render` message carries `locale` and `dir`, and one still pending on a booting host carries the current value when it is delivered.
- The frame's `applyPreviewLocale` is the only writer of the canvas root's `lang` and `dir`.
- `plan:studio/canvas-injects-context` may read the helper if it decides `$page.locale` follows the pane.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`.

- `tests/site-context.test.ts`, new `describe("getEffectiveRenderLocale")`:
  - "null in a project that declares no locales, whatever was chosen".
  - "a declared choice wins over the path and the default", including a lowercase `fr-ca` choice answering the declared `fr-CA`.
  - "a choice the project no longer declares answers as if none were made" (the restored-session case).
  - "with no choice, the path's locale, else the default" (`pages/fr/a-propos.json` → `fr`, `pages/about.json` → the default).
  - "a project declaring one locale still answers it" (`["ar"]` → `ar`).
- `tests/iframe-host.test.ts`, new `describe("the language a render posts")`, with a project declaring `en` and `ar`:
  - "a host mounted after the language was set draws in it": `previewLocale = "ar"` before `mountIframeCanvas`; after `ready` the pending render is `{ dir: "rtl", kind: "render", locale: "ar" }`.
  - "with no choice, a translation's render carries its own language": a tab at `pages/ar/index.json` → `ar`/`rtl`.
  - "the render posts the RENDERED tab's language, not the focused tab's": the two-tab shape of `twoSchemes`.
  - "a stylebook mount carries its stage's tab language".
  - "a language set while the host boots reaches the render it is waiting for" (the restore case): `mountIframeCanvas` with no choice, then `previewLocale = "ar"` and `postLocaleToLiveHosts("ar", canvasEl)` before `ready`. After `ready`, the one `render` posted carries `{ dir: "rtl", locale: "ar" }` and no `setLocale` was posted (filter the channel's posts by `kind`: `ready` may also post `keymap` and a selection request). It fails today, when the pending render carries no language.
  - The existing "postLocaleToLiveHosts carries the direction with the tag, to ready hosts only" holds: it asserts that nothing is posted before `ready`, and a patched pending render is still posted only then.
  - "a project without locales posts locale null": `{ dir: "ltr", locale: null }`.
- `tests/iframe-entry.test.ts`: `renderMsg` gains `dir: "ltr", locale: null`, and so does the stylebook fixture at line 1360.
  - "a render applies its language and direction before the first paint": after the flush the root has `lang="ar"` and `dir="rtl"`, and `renderComplete` followed.
  - "a render with no language restores the root the frame booted with": `lang="en"` is set before `startCanvasIframe`, then `ar`, then `null`. The root ends at `lang="en"` with no `dir`.
  - "a left-to-right language writes no dir": `ar` then `fr` leaves `lang="fr"` and no `dir`.
  - "a stale-generation render does not move the language".
  - The existing "setLocale writes lang and dir on the root, and clears both" holds unchanged, because the test DOM boots with neither attribute.
- `tests/iframe-entry-gaps.test.ts` (`renderMsg`) and `tests/iframe-entry-idle.test.ts` (the inline render in "the sample carries the generation…"): the two fields are added. These fixtures are typed `ParentToIframe`, and root `tsc` covers `packages/**/tests`.
- `tests/iframe-render.test.ts`, new `describe("applyPreviewLocale")`: it sets `lang` and `rtl`; `ltr` restores the booted `dir`; `null` restores both, from a baseline with values and from an empty one; `captureLocaleBaseline` reads the root.
- `tests/pane-context.test.ts`, in the language segment block: "a restored tag the project no longer declares is not reported as the pane's language". With `multilingual(["en", "fr"], "pages/fr/a-propos.json")` and `previewLocale = "ar"`, the summary is `Base` and French is checked.

Coverage: the per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) hold. Each new function and branch has a case above, and no touched file is the workspace floor (`surfaces/preferences.ts` for lines, `studio.ts` for functions, whose change adds no function). There is no ratchet and no new source file, so the manifest check needs nothing.

## Specs & docs

- **studio.md §20** (line 1784): delete the marker's last sentence ("The one gap, … is marked on §20.2.").
- **studio.md §20.2**: the marker becomes

  > **Status: Implemented.** `i18n.switchLocale` (`packages/studio/src/canvas/canvas-utils.ts`) writes the persisted `previewLocale`. The context-bar segment (`panels/pane-context.ts`) and every artboard read one rule, `getEffectiveRenderLocale` (`site-context.ts`). The `render` message carries its answer with the direction (`canvas/iframe-host.ts`, `canvas/iframe-protocol.ts`), `setLocale` moves the artboards already live, and the frame writes `lang` and `dir` (`applyPreviewLocale` in `canvas/iframe-render.ts`).

  After the "What it changes is `lang` and `dir`" paragraph, insert:

  > **Every artboard draws in it from its first paint.** The language rides on each render with its direction, as the colour scheme does, so a restored session, a second pane, a reload and a breakpoint added later draw in the pane's language without the control being touched. A change reaches the artboards already live without a render, and one still loading on the render it is waiting to receive. With no language chosen, the artboard draws in the document's own, which is the language the segment marks as selected: the locale its path sits under (`site-architecture.md` §13.3), else the default locale. A stored tag the project no longer declares is dropped on the way out rather than drawn, the counterpart of refusing one on the way in. `dir="ltr"` is never written, as on the built page (`site-architecture.md` §13.4), and a project that declares no locales leaves the artboard's language as the canvas booted it.

  If the Open decision is declined, the sentence beginning "With no language chosen" is dropped.

- **studio.md §19**, the UAX #9 row: Evidence gains `packages/studio/src/canvas/iframe-render.ts` and `packages/studio/tests/iframe-host.test.ts`. The Note is unchanged.
- **Fragment:** `bun run spec:change studio.md minor -m "§20.2 every artboard draws in its pane's rendering language from its first paint: the render message carries the language and its direction, a pane with no choice draws in the document's own language, and a stored tag the project no longer declares falls back to it."`
- **`docs/studio/interface/languages.md`** (its `spec:` cites `studio.md#20`, and its `code:` lists `src/site-context.ts`). In "Rendering language", after "It's the same axis as breakpoint and colour scheme: a preview state, stored with the tab.", add: "It stays set when you reopen the project, and the canvas draws in it from the start, including in a second pane or at a breakpoint you add later." Replace the paragraph "The bar only names a language when it differs from the document's own, so a French page open in a French pane reads as it always did." with: "With no language chosen, the canvas draws in the page's own language: the language of the folder the file sits in, or the project's default. An Arabic translation mirrors as soon as you open it. The bar only names a language when it differs from the page's own, so a French page open in a French pane reads as it always did. If the project stops listing a language a pane was set to, the pane goes back to the page's own." Neither addition has an em dash. If the Open decision is declined, only the first addition and the last sentence land.
- Unchanged: `docs/studio/interface/tabs.md`, `modes.md`, `docs/studio/design/breakpoints.md`, `stylebook.md` and `components.md` list `panels/pane-context.ts` or `src/studio.ts`, and none of them describes the language segment. `docs:sync` also names `docs/framework/site/i18n.md` (the `@docs framework/site/i18n` tag on `src/site-context.ts`) and `docs/studio/interface/canvas.md` (the `@docs studio/interface/canvas` tags in `src/canvas/iframe-render.ts`); neither says what language the canvas draws in, so neither changes. `docs/extending/reference/standards.md` is generated.
- No graduation: studio.md keeps other open items (`bun run plans:status --spec studio`). The landing pull request deletes this file.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` is green with no file below its threshold, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run typecheck` and `bun run lint` are clean.
- `bun run plans:status --spec studio` no longer lists §20.2. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:standards`, `bun run docs:prose`, `bun run docs:links` and `bun run docs:section-refs` pass. `bun run docs:sync` names `docs/studio/interface/languages.md`, and it is in the diff; the other pages it names are the ones Specs & docs lists as unchanged.
- By hand, in a project whose `i18n.locales` is `["en", "ar"]`, following the `packages/studio:verify` recipe:
  - Open `pages/about.json`, choose Arabic, and reload. The canvas iframe's `<html>` has `lang="ar" dir="rtl"` on first paint, and the layout is mirrored without the control being touched.
  - Split right, and switch the side pane to design with breakpoints. Every new artboard is RTL.
  - Open `pages/ar/index.json` with no choice: RTL, and the segment names nothing (per the Open decision).
  - Choose English: `lang="en"` and no `dir` attribute.
  - Remove `ar` from Settings › Locales and reopen: `pages/about.json` draws `lang="en"`, and the summary reads `Base`.
