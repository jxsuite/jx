---
status: drafted
disposition: implement
claims:
  - ui.md#6
requires: []
workspaces:
  - packages/ui
  - packages/studio
  - specs
  - docs
size: M
---

# Every kit overlay fades in and out, and a popover opened from a control inside a modal jx-dialog renders in its overlay slot

## Context

`specs/ui.md` §6, line 370, the open clause of the marker:

> **Status: Partial.** … Three things are short: `jx-menu` and `jx-dialog` declare no `@starting-style`, transition or `allow-discrete`, so neither animates its entry or exit; nothing mounts or routes a popover into `jx-dialog`'s `[part="overlay-slot"]`, and Studio's `getLayerSlot("popover", id)` (`packages/studio/src/ui/layers.ts`) always appends to `#layer-popover`, outside any open dialog; and the custom commands that ship are the unprefixed `--show` and `--close` (`src/behaviors/dialog.ts`), where the text below names a `--jx-*` command.

Verified at `ffe45081`:

- **Transitions.** `packages/ui/components/jx-popover.json` and `jx-tooltip.json` fade `opacity` with `display` and `overlay` under `allow-discrete` at `--jx-dur-1`, and put `opacity: 0` in `@starting-style`. `jx-toast.json` does the same on `display` only, because a toast is not a top-layer element. `packages/ui/tests/popover.test.ts` ("transitions display together with overlay…") holds the popover to that, and `conformance.test.ts` runs the overlay lint's `cut-exit` rule (`packages/schema/src/overlays.ts`) over every kit document, which judges popovers only. `jx-menu.json` and `jx-dialog.json` declare no transition, no `opacity` and no `@starting-style`. A submenu is a nested `jx-menu`, so one edit to the document covers every level of the stack. The jx-popover's `:popover-open` opacity already survives the Studio canvas, where the runtime transposes `:popover-open` to `[data-jx-popover-open]` (the "keeps the open rule with the attribute on the Studio canvas" case in `popover.test.ts`).
- **The overlay slot.** `[part="overlay-slot"]` is the inner `<dialog>`'s last child (`jx-dialog.json:410`), asserted in `packages/ui/tests/dialog.test.ts` (lines 199 to 225). Nothing mounts into it. `getLayerSlot` (`layers.ts:430`) resolves only the four layer hosts, and it returns a cached slot whenever `slot.parentElement` is set, so a slot whose host left the document is handed back detached.
- **The live case.** The SEO surface is a `jx-dialog` with `dismissible: true`, so `closedby="any"` (`packages/studio/src/surfaces/seo.json:5`). Its Browse button calls `browseFor` (`packages/studio/src/panels/seo-modal.ts:448`), which calls `openMenu` with the button as `opener`. `openMenu` mounts the menu through `getLayerSlot("popover", options.region)` (`packages/studio/src/surfaces/menu.ts:226`) into `#layer-popover`, and shows it with `showPopover({ source })` (`menu.ts:309`). The doc comment on `browseFor` (`seo-modal.ts:445`) says the source "is what puts it in the dialog's own top-layer hierarchy". That claim carries no "Measured in Chrome" note, unlike the kit's measured claims. `packages/studio/tests/seo-modal-media.test.ts` runs under happy-dom, which models neither the top layer nor inertness, and reads the rows from `#layer-popover`. No other `openMenu` or `getLayerSlot("popover", …)` caller opens from inside one of the thirteen `jx-dialog` surfaces today. Kit popovers that are their control's descendants (a combobox's list, a colour field's panel) are already inside any dialog around them.
- **What the standard says.** HTML's "blocked by a modal dialog" makes every connected node inert except the modal dialog and its flat-tree descendants. The top layer changes paint order. A popover's `source` sets its invoker, which drives light dismissal, focus return and the implicit anchor. Neither is an exception to inertness. The menu sits outside the dialog's subtree, so it is inert under the standard. Even if an engine let it take input, a press on it would be a click outside a `closedby="any"` dialog.
- **Commands.** `onCommand` (`packages/ui/src/behaviors/dialog.ts:107`) answers `--show` and `--close`. The same names appear in `packages/ui/stylebook/jx-dialog.json`, `docs/extending/ui-kit.md` ("Dialogs") and §5.2's marker. §6's second paragraph still says "a `--jx-*` custom command", and it offers `command="show-modal"` as the opener, which the platform delivers only to a `<dialog>`, never to the `jx-dialog` host.
- **Wrong citations.** Three places cite "specs/ui.md §7" for the overlay rule, which is §6: `packages/ui/tests/dialog.test.ts:205`, `packages/studio/src/panels/seo-modal.ts:445` and the Browse `$description` at `packages/studio/src/surfaces/seo.json:892`.
- **Teardown.** `openMenu`'s `finish()` clears its slot on the close `toggle`, and every dialog surface (`surfaces/dialog.ts:285` and twelve siblings) calls `close()` and then `slot.remove()` in the same tick. So in Studio an exit transition is cut by the removal. Screenshots are unaffected: `executeShot` (`scripts/screenshots/lib/shot.ts:1016`) emulates `prefers-reduced-motion: reduce`, and `packages/ui/project.json` zeroes every `--jx-dur-*` under it.

## Outcome

- ui.md §6 → Implemented:
  - `jx-menu` fades at every level of its stack, and `jx-dialog` fades with its `::backdrop`, through `@starting-style` and `allow-discrete`.
  - `overlaySlotFor` in `@jxsuite/ui/behaviors/dialog` finds an open dialog's overlay slot. Studio's `getLayerSlot("popover", id, { opener })`, which `openMenu` calls, mounts there, so the SEO Browse menu is inside the dialog it was opened from.
  - The text names `--show` and `--close`.
- ui.md stays Partial overall (§2, §3.1, §3.2, §3.3, §4.1, §5.1, §5.2, §5.4, §5.5 and §7 stay open), so nothing graduates.

## Decisions

- **Open:** route the popover into the overlay slot, or reconcile §6 to the `source`-based placement that ships? Recommendation: route, because the standard exempts only the dialog's subtree from inertness, and a `source` never changes that. A menu outside a `closedby="any"` dialog would also count as a click outside it. The kit publishes to site authors on every engine, so correctness cannot rest on one engine's leniency. The slot already ships and is documented. Implementation step 1 records the before and after behaviour in Chrome as evidence, and does not gate the design.
- **Open:** should Studio defer removing a closed menu or dialog until its exit transition ends? Recommendation: no, not in this plan. The consequence is that Studio's overlays fade in and cut out. §6 binds the element's behaviour, not a host's teardown. `MenuHandle.close` promises "the slot is emptied before this returns", and `schema-form.ts:680` closes and reopens the same region in one tick. Deferring would touch fourteen close paths. The kit's exit plays wherever a host leaves the element connected, as a site author's `popovertarget` or `--show` does.
- **Decided:** fade `opacity` only, with no `translate` or `scale`, because a moving box would race every measurement taken on toggle: the menu's clamp, `openMenu`'s `place()` and the tooltip's arrow reading. Neither element therefore gains `settling` or `data-jx-settling`, which stays `jx-popover`'s (§5.2).
- **Decided:** `jx-menu` copies `jx-popover`'s transition value exactly (`--jx-dur-1`, `--jx-ease-out`), because it is the same panel family and shares the clamp. `jx-dialog` enters at `--jx-dur-2` with `--jx-ease-out` and leaves at `--jx-dur-1` with `--jx-ease-in`, which is §4.4's pair for a surface. It is the kit's one surface-sized overlay.
- **Decided:** the dialog's open rules key on `[open]`, not `:modal`, so a dialog shown in place on the Studio canvas, or shown non-modally, is visible.
- **Decided:** the lookup lives in the kit as `overlaySlotFor(node)` in `src/behaviors/dialog.ts`, because the part is the kit's and a site author needs the same answer. It only reads the DOM, which is inside §2's allowed set. It treats `open` as modal, because the kit opens a dialog only through `showModal()`, and routing into a non-modal open dialog is harmless anyway.
- **Decided:** routing keys on the opener the caller names: `getLayerSlot(layer, id, { opener })`, popover layer only. Slot ids are reused across opens, so only the caller knows what it opened from. `openMenu` already takes `opener` from every caller that hangs a menu from a control.
- **Decided:** `getLayerSlot` treats a cached slot that is not `isConnected` as gone, and moves a connected one whose container differs. A slot inside a dialog leaves the document with that dialog, and `parentElement` stays set on a detached subtree.
- **Decided:** a menu routed into a dialog closes with it. `openMenu` listens for the inner `<dialog>`'s `close`, because removing a showing popover hides it without a `toggle`, so `finish()` would never run.
- **Decided:** no rename to `--jx-show` or `--jx-close`. The text follows the code, because the unprefixed names ship in the stylebook, the docs and Studio, and `commandfor` already scopes a custom command to its target.
- **Decided:** a routed menu picks up none of the dialog's styles. The rules in `jx-dialog.json` and `seo.json` that reach descendants key on part names (`header`, `body`, `footer`, `secondary`, `card`, `row` …). None of them is a part that `jx-menu`, `jx-menu-item` or `surfaces/menu.json` carries (`chevron`, `description`, `icon`, `label`, `text`, `value`).

## Implementation

1. **Evidence, before any code.** Build a standalone page with a `<dialog>` holding a button. After `showModal()`, show a `popover="auto"` panel appended to `body` with `showPopover({ source: button })`. Then check three things: whether `document.elementFromPoint` at a row's centre returns the row, whether `row.focus()` moves focus, and whether a click on the row closes a `closedby="any"` dialog. Repeat with the panel inside the dialog. Run it in the desktop app's Chromium and a current Chrome, then run Studio's Search appearance, Browse, before and after the change. Record the results in the pull request description.
2. **`packages/ui/components/jx-menu.json`**, `style`:
   - The base rule gains `"opacity": "0"` and `"transition": "opacity var(--jx-dur-1) var(--jx-ease-out), display var(--jx-dur-1) allow-discrete, overlay var(--jx-dur-1) allow-discrete"`.
   - `":popover-open"` gains `"opacity": "1"`.
   - A root-level `"@starting-style": { "&:popover-open": { "opacity": "0" } }` sits after the `@supports` block, as in `jx-popover.json`.
   - No `display` goes into `@starting-style`. The `onToggle` description is unchanged.
3. **`packages/ui/components/jx-dialog.json`**, `style`:
   - `& > [part="dialog"]` gains `"opacity": "0"` and `"transition": "opacity var(--jx-dur-1) var(--jx-ease-in), display var(--jx-dur-1) allow-discrete, overlay var(--jx-dur-1) allow-discrete"`, which is the exit. Its `&::backdrop` gains `"opacity": "0"` and the same transition.
   - A new `"& > [part=\"dialog\"][open]"` rule sets `"opacity": "1"` and the entry value `"opacity var(--jx-dur-2) var(--jx-ease-out), display var(--jx-dur-2) allow-discrete, overlay var(--jx-dur-2) allow-discrete"`. A new `"& > [part=\"dialog\"][open]::backdrop"` rule sets the same.
   - A root-level `"@starting-style"` holds `"& > [part=\"dialog\"][open]"` and `"& > [part=\"dialog\"][open]::backdrop"`, each `{ "opacity": "0" }`. It sits at the root rather than nested under the part, because `resolveNestedSelector` (`packages/runtime/src/css.ts`) is proven for `&` keys inside a root `@starting-style` (the jx-popover shape).
   - The `open` state's description gains: "Entry and exit fade the dialog and its backdrop; reduced motion zeroes both."
4. **`packages/ui/src/behaviors/dialog.ts`**: add and export the lookup below. Its doc comment carries the §6 rule, in one paragraph: inertness follows the DOM, the top layer and `source` do not change it, and a kit popover inside its control needs no routing. Nothing else in the file changes. The export is reachable as `@jxsuite/ui/behaviors/dialog`, which Studio already imports.

   ```ts
   export function overlaySlotFor(node: Element | null | undefined): HTMLElement | null;
   ```

   It walks `node.closest("jx-dialog")` outward to the nearest host whose `innerOf(host)` is `open`, and returns that inner dialog's direct child `[part="overlay-slot"]`. Taking the direct child means it never reaches a nested dialog's slot. It returns null when no open dialog surrounds `node`.

5. **`packages/studio/src/ui/layers.ts`, `getLayerSlot(layer, id, options: { opener?: Element | null } = {})`**:
   - The container is `overlaySlotFor(options.opener)` when `layer === "popover"`, else `layerHost(layer)`.
   - A cached slot is returned only while `isConnected`, and it is appended to the container first when its parent differs.
   - A new slot is appended to the container.
   - The doc comment gains the routing rule and cites ui.md §6. `clearLayerSlot` is unchanged.
6. **`packages/studio/src/surfaces/menu.ts`, `openMenu`**:
   - Call `getLayerSlot("popover", options.region, { opener: options.opener })`.
   - When `slot.closest("dialog")` is non-null, add a `close` listener on it that calls `handle.close()`, with `{ once: true, signal: controller.signal }`.
   - `handle.close()` hides only a menu that `isConnected` and `open`, then calls `finish()`.
   - The module comment's "Every menu opens in a `getLayerSlot("popover", id)` slot" sentence gains "…inside the opener's dialog when the opener is in an open one (ui.md §6)".
7. **Citations and comments.**
   - `packages/studio/src/panels/seo-modal.ts:442-446`: the `browseFor` comment becomes: "A kit menu, and `openMenu` mounts it inside this dialog's `[part="overlay-slot"]` because Browse is its opener: a modal `<dialog>` makes everything outside its own subtree inert, and neither the top layer nor a popover's `source` changes that (`specs/ui.md` §6). The Browse button as `source` is what returns focus to it and anchors the menu."
   - `packages/studio/src/surfaces/seo.json:892`: the Browse `$description` says the same in one sentence and cites `specs/ui.md` §6.
   - `packages/ui/tests/dialog.test.ts:205`: "§7" becomes "§6".
8. **Tests**, as in Tests. **Spec and docs**, as in Specs & docs.

**Integration contract.** No plan requires this one today. Once it lands:

- `overlaySlotFor(node: Element | null | undefined): HTMLElement | null` is exported from `@jxsuite/ui/behaviors/dialog`.
- `getLayerSlot(layer, id, { opener })` routes a popover-layer slot into the opener's open dialog.
- `openMenu` routes by its `opener` with no option of its own, and a menu so routed closes when that dialog closes.
- `jx-menu` and `jx-dialog` fade `opacity` only, and add no settling state.

`plan:site-architecture/seo-structured-data-editor` may therefore open a menu from inside the SEO dialog with no routing code of its own. Whether that makes this plan a prerequisite is its call. `plan:ui/menu-radio-rows` and `plan:ui/studio-toast-host` edit `surfaces/menu.ts` and `layers.ts` elsewhere and conflict at most textually. `plan:ui/behaviour-list-text` lists what sidecars do. `overlaySlotFor` is a DOM read and fits its list as written.

## Tests

- **`packages/ui`** (`bun test --isolate --coverage` from `packages/ui`):
  - `tests/menu.test.ts`, new `fades in and out like a panel: display and overlay transition together under allow-discrete, and @starting-style holds opacity only`. On `documents["jx-menu"].style`, it checks that the `display` and `overlay` clauses of `transition` each contain `allow-discrete`, that the base rule is `opacity: 0` and `:popover-open` is `opacity: 1`, and that `@starting-style` has no `display` and does have `opacity`.
  - `tests/menu.test.ts`, new `keeps the open rule's opacity with the attribute on the Studio canvas`. It mirrors the jx-popover canvas case under `setCanvasDelinkPopovers(true)`: the emitted `&[data-jx-popover-open]` block contains `opacity: 1`.
  - `tests/dialog.test.ts`, new `fades the dialog and its backdrop: exit in the base rules, entry in the open rules, and no display in @starting-style`. Against the document it checks each of the four rules' `display` and `overlay` clauses for `allow-discrete`, the entry values for `--jx-dur-2` and the exit values for `--jx-dur-1`, and that `@starting-style` holds both `[open]` selectors with `opacity: 0` and no `display`. Against the emitted sheet for a mounted dialog, it checks that the `@starting-style` group contains the scoped `[part="dialog"][open]` and `[part="dialog"][open]::backdrop` selectors.
  - `tests/dialog.test.ts`, new `overlaySlotFor answers the open dialog's overlay slot for a node inside it, and null outside it or while it is closed`. It also covers a null node.
  - `tests/dialog.test.ts`, new `overlaySlotFor walks past a closed jx-dialog to the open one around it, and never into a nested dialog's slot`.
  - `conformance.test.ts` already runs `findPopoverDefects` over `jx-menu`, so `cut-exit` guards the new transition with no edit.
- **`packages/studio`** (`bun test --isolate --coverage` from `packages/studio`):
  - `tests/ui-layers-gaps.test.ts`, new `getLayerSlot routes a popover slot into the opener's open dialog, and no other layer`. It checks the slot's parent is the overlay slot and the region attribute is kept, that an opener outside any dialog or inside a closed one gets `#layer-popover`, and that `getLayerSlot("dialog", id, { opener })` ignores the opener.
  - `tests/ui-layers-gaps.test.ts`, new `a cached slot that left the document is replaced, and a connected one moves to the container asked for`.
  - `tests/surfaces-menu.test.ts`, new `a menu opened from a control inside an open jx-dialog mounts in that dialog's overlay slot`.
  - `tests/surfaces-menu.test.ts`, new `a menu routed into a dialog closes with it`. It closes the dialog through the kit's `close(host)` and removes its slot, then checks that `onClosed` fired once and that the next `getLayerSlot("popover", region)` is a connected slot in `#layer-popover`.
  - `tests/seo-modal-media.test.ts`: `menuRows()` reads `jx-dialog[part="seo"] [part="overlay-slot"] jx-menu-item`, and `afterEach` hides every `jx-menu` in the document. New `Browse mounts the media menu inside the Search appearance dialog, not the popover layer`.
- **Coverage.** No new source file, so the manifest check is unaffected. `overlaySlotFor` must reach 100% of functions under `packages/ui/bunfig.toml` (`lines = 0.99, functions = 1.0`). `layers.ts` and `menu.ts` must hold `packages/studio/bunfig.toml`'s floor (`lines = 0.958, functions = 0.941`): each new branch (routed vs layer, stale vs moved slot, dialog close) has a case above. Neither worst file moves, so nothing ratchets. Run the whole Studio suite, because the `isConnected` change alters what a test that rebuilds `document.body` gets back from `getLayerSlot`.

## Specs & docs

**`specs/ui.md` §6**, in place:

- **Marker.** `> **Status: Implemented.**`, keeping the evidence sentences about the dialog half, the popover half, anchor positioning and the measured fallback, with these changes:
  - The dialog half reads "it opens on a `--show` custom command aimed at the element and closes on `--close`".
  - The transitions sentence becomes "Entry and exit are discrete transitions: `@starting-style` and `transition-behavior: allow-discrete` on `display`, and on `overlay` for each element that enters the top layer, on `jx-popover`, `jx-tooltip`, `jx-toast`, `jx-menu` at every level of its stack, and `jx-dialog` with its `::backdrop` (`packages/ui/tests/popover.test.ts`, `menu.test.ts`, `dialog.test.ts`)."
  - "Three things are short: …" is replaced by "A popover opened from a control inside an open `jx-dialog` renders in its `[part="overlay-slot"]`: `overlaySlotFor` in `src/behaviors/dialog.ts` finds it, and Studio's `getLayerSlot("popover", id, { opener })` (`packages/studio/src/ui/layers.ts`), which `openMenu` calls with its opener, mounts there."
- **Paragraph 2.** From "Dialogs are `<dialog>` opened with `showModal()`" to the end of the paragraph becomes: "Dialogs are `<dialog>` opened with `showModal()`. A plain `<dialog>` takes the platform's invoker commands (`command="show-modal" commandfor="…"`, `command="close"`). `jx-dialog` is not itself a `<dialog>`, and the platform delivers only custom commands to any other element, so it answers `--show` and `--close` aimed at the host. Any other custom command reaches a surface as a `CommandEvent` it may answer declaratively. Entry and exit are `@starting-style` and `transition-behavior: allow-discrete` on `display` and `overlay`, fading `opacity` only, so nothing a toggle measures moves while they run. A dialog enters at `--jx-dur-2` and leaves at `--jx-dur-1` (§4.4)."
- **Paragraph 3.** The sentence "A modal `<dialog>` makes everything outside it inert, so a popover opened from a control inside one renders inside its `[part="overlay-slot"]`." becomes: "A modal `<dialog>` makes everything outside its own subtree inert, and the top layer does not change that: a popover's `source` sets its invoker (light dismissal, focus return, the implicit anchor), never its inertness. So a popover opened from a control inside one must be the dialog's descendant. A kit popover that is its control's descendant (a combobox's list, a colour field's panel) already is. Any other renders inside the dialog's `[part="overlay-slot"]`, which `overlaySlotFor(opener)` in `@jxsuite/ui/behaviors/dialog` returns for the nearest open `jx-dialog` around the opener." The submenu sentence is unchanged.
- **Paragraph 4.** "a popover is `surfaces/menu.ts` or `getLayerSlot("popover", id)` plus a mounted document" becomes "a popover is `surfaces/menu.ts` or `getLayerSlot("popover", id, { opener })` plus a mounted document, and the slot is mounted in the opener's dialog whenever the opener is inside an open one".
- **§11, the CSS Transitions 2 row.**
  - Evidence gains `packages/ui/components/jx-menu.json`, `packages/ui/components/jx-dialog.json`, `packages/ui/tests/menu.test.ts` and `packages/ui/tests/dialog.test.ts`.
  - The note's second clause becomes "`popover.test.ts`, `menu.test.ts` and `dialog.test.ts` hold `display` and `overlay` to one transition and keep `display` out of `@starting-style`".
  - The row carries no gap id. This plan closes no `gap:`, and `gap:ui-html-overlays` stays the intended end state.
- **Fragment:** `bun run spec:change ui.md minor -m "§6 is implemented: jx-menu at every level and jx-dialog with its backdrop fade in and out through starting-style and allow-discrete transitions on display and overlay; a popover opened from a control inside an open jx-dialog renders in its overlay slot, found by overlaySlotFor and used by Studio's getLayerSlot and openMenu; the text names the --show and --close commands jx-dialog answers"`. The level is minor: an implement, and the command text follows what already shipped.

**Docs** (no em dashes). `bun run docs:sync` names three pages:

- `docs/extending/ui-kit.md` (its `code:` lists `behaviors/dialog.ts` and `behaviors/menu.ts`):
  - The `spec:` frontmatter gains `- ui.md#6 # the overlay model`.
  - In "Dialogs", the `overlay-slot` clause becomes: "and `overlay-slot`, the box a popover opened from a control inside the dialog must render into, because a modal makes everything outside itself inert and the top layer does not change that. `overlaySlotFor(control)` from `@jxsuite/ui/behaviors/dialog` returns it for the open dialog around a control, or null; mount the panel there before you open it. A panel that already sits inside its control, like a combobox's list, needs nothing."
  - The same section gains "The dialog and its backdrop fade in and out, and a reader who asks for reduced motion gets no fade."
  - "Show a menu" gains "A menu fades in and out at every level, as a panel does."
- `docs/studio/interface/canvas.md` (its `code:` lists `surfaces/menu.ts`): no change, because it describes no menu's placement.
- `docs/studio/editing/frontmatter.md` (its `code:` lists `seo-modal.ts`): no change, because its Search appearance section already describes a Browse that works.

No spec graduates.

## Acceptance

- `bun run plans:status --spec ui` no longer lists `ui.md#6`. `bun run plans:check`, `docs:status`, `docs:spec-release`, `docs:check`, `docs:links`, `docs:prose`, `docs:markdown` and `docs:standards` pass.
- `sed -n '/^## 6\./,/^## 7\./p' specs/ui.md` shows `> **Status: Implemented.**` as the section's first blockquote, and contains no `--jx-*` command and no "Three things are short".
- `git grep -n -e 'ui.md` §7' -e 'ui.md §7' -- packages` prints nothing that concerns the overlay slot.
- `bun test --isolate --coverage` passes from `packages/ui` and from `packages/studio`, with the new cases listed and no per-file threshold failure.
- In Studio, with motion allowed:
  - Search appearance → Browse on Social image puts the menu above the dialog. A row takes the pointer and the keyboard and commits its path.
  - Escape closes the menu and leaves the dialog open. A click on a row does not close the dialog.
  - A context menu, its submenu and a confirm dialog visibly fade in.
  - With `prefers-reduced-motion: reduce` emulated, none of them fades.
- The pull request description records step 1's before and after results.
