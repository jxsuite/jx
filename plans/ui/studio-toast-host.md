---
status: drafted
disposition: implement
claims:
  - ui.md#5.2
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: M
---

# Studio's toast stack is a jx-toast-host of jx-toast elements, and the jx-popover row says how a popover is placed

## Context

`specs/ui.md` §5.2, line 185 (the open clause of a long marker):

> **Status: Partial.** `jx-dialog` is built: … `jx-popover`, `jx-tooltip` and `jx-spinner` are built, and so are `jx-toast` and `jx-toast-host`. What is short is the adoption the table promises: Studio's toast stack is still the hand-drawn `packages/studio/src/surfaces/toasts.json`, mounted by `src/ui/layers.ts` with its own timers, and nothing in `packages/studio/src` uses either toast element; and the `jx-popover` row below still says the panel is placed by measured viewport coordinates, which the paragraph under this marker and `src/behaviors/popover.ts` make the fallback.

The `jx-toast-host` row (line 213) lists "the hand-drawn stack in `surfaces/toasts.json`" under Replaces, and it is the one replacement in the table that has not happened. The `jx-popover` row (line 209) is a text fix that sits under the same marker. Verified against the tree on 2026-09-27.

**The kit's side is built and tested.** `packages/ui/components/jx-toast.json` and `jx-toast-host.json`, `packages/ui/src/behaviors/toast.ts` (the clock, the named holds `pointer`/`focus`/`stack`, `closeToast` with `detail.reason`), `packages/ui/src/behaviors/toast-host.ts` (`live`, `aria-atomic="false"`, the document-level `hotkey`, and the exported `focusStack` and `returnFocus`), with `packages/ui/tests/jx-toast.test.ts` and `jx-toast-host.test.ts`. `packages/desktop/src/platform.ts` (`showUpdateToast`) already uses both, with `hotkey=""` on the premise that "Studio's own toast stack … owns `F8`". That premise is false today.

**Studio's side** (paths under `packages/studio/src/`):

- `surfaces/toasts.json` is a `div part="stack"` of `div part="toast"` rows, each holding a glyph span, a message span with a three-line clamp, an optional `jx-button part="action"`, and a `jx-action-button part="dismiss"`.
- `ui/layers.ts` projects `services/notify.ts`'s `toasts` array through `projectToast` (character glyphs in `TOAST_ICON`) and keeps two sets of timers. `_toastTimers` (line 482) holds the retirement timers that `scheduleToast` (line 550) arms from `record.timeoutMs` and that `retireToast` (line 536) cancels before calling notify's `dismiss`. `_toastEntering` holds the 180ms `TOAST_ENTER_MS` settle window that `overlayIdleBlockers` publishes to `services/idle.ts`. `toastsAreHeld()` skips the retirement timer under `?automation=1` (studio.md §13.5, exception 3).
- `services/notify.ts` owns the four-toast cap (`MAX_TOASTS`) and the severity rest times (`TOAST_LIFETIME_MS`: 4s for success and info, 8s for warn and error). It calls `announce()` from `services/announce.ts` for every record, which is the one live region studio-ui-guidelines.md §13.1a specifies.
- **Correction to the stub:** `#layer-toast` in `shell/tree.ts` (`overlayLayers()`) also carries `role="status" aria-live="polite"`, pinned by `tests/shell-tree.test.ts` ("the toast host is a live region before any toast is raised") and `tests/toast-host.test.ts`. So every toast is announced twice today, once by `announce()` and again by the layer, and the layer's implicit `aria-atomic="true"` re-reads the whole stack. That breaks studio-ui-guidelines.md §13.3 rule 3 ("Nothing is announced twice").
- The hand-drawn stack does not pause on hover or focus and has no key into it. Both are new to Studio once the kit's elements draw it.

**Found while detailing (the key).** Nothing in Studio's registry binds F8. Monaco's `gotoError` binds it inside the code editor and stops propagation there (`services/monaco-setup.ts`; `StandaloneKeybindingService` calls `stopPropagation` on a handled key). Two facts limit the element's own document-level `hotkey`. First, the canvas iframe forwards only chords the keymap claims (`canvas/iframe-keys.ts`), so F8 pressed with focus in the canvas never reaches the shell document. Second, `dispatchKey` (`editor/shortcuts.ts`) resolves every keydown on `document` against `keyScopeStack(ctx)`. `shell.focusRegion` stays `"pane"` after a focus move it did not make, so a key pressed on a toast's button resolves against the canvas stack. Enter there runs `selection.insertSibling` (canvas scope) and its `preventDefault` cancels the button's own activation, and Escape also runs `selection.selectParent`. `plan:studio/canvas-block-keyboard-access` found the same hazard for the block action bar.

## Outcome

- ui.md §5.2 → Implemented. Studio's stack is a `jx-toast-host` (`live="off"`) of one `jx-toast` per toast record. The element's clock replaces Studio's retirement timers, the record's rest time is its `timeout`, and its `close` retires the record. The recovery command sits in the `action` slot. The four-toast cap, the 4s/8s rest times, the automation hold and the settle window that `probe.idle()` reads all survive.
- The `jx-popover` row says a panel shown from a source is anchored to it, with measured coordinates as the fallback.
- Every toast is announced once, through `notify()`.

## Decisions

- **Decided:** one plan, not split. The popover row is one table cell with no code, and §5.2's marker cannot read Implemented while either part is open, so both land in the pull request that flips it. The ui audit's split rule applies only where parts land in different pull requests.
- **Decided:** the host is `live="off"` and `#layer-toast` loses `role="status"` and `aria-live="polite"`, because studio-ui-guidelines.md §13.1a makes `notify()` → `announce()` the app's one voice, and ui.md §5.2 names `off` for exactly this host.
- **Decided:** the record's lifetime stays in `notify.ts`. The cap, the rest times and key dedupe are unchanged, and the surface renders whatever the store holds. A record the store drops (the cap, a `key` replace) takes its element with it and dispatches no `close`, which is the kit's "a host writing `open = false` hears nothing back" rule.
- **Decided:** every `close` reason (`timeout`, `dismissed`, `action`) retires the record through notify's `dismiss`. Nothing branches on the reason. `runAction` runs the command in the button's own click handler, and the click then bubbles to the toast's `action-slot`, which closes it with `action`. `runAction` stops calling `retireToast` itself.
- **Decided:** the element is removed when its record is dismissed, so the kit's exit transition does not play. Today's stack has none either. Keeping a closing toast mounted would need a second timer or a `transitionend` listener in `layers.ts`, plus a "settling out" idle blocker.
- **Decided:** the settle window stays in `layers.ts`, keyed to a record's arrival (`TOAST_ENTER_MS`, 0 under reduced motion), because studio-ui-guidelines.md §13.3 rule 4 and studio.md §13.5 read it there. A test pins it to at least the kit's `--jx-dur-1` (150ms), the duration of `jx-toast`'s `@starting-style` entry. Giving `jx-toast` a `data-jx-settling` state, as `jx-popover` has, would be derived rather than pinned, but it is a kit change this adoption does not need.
- **Decided:** the kit draws the toast. Its Phosphor glyphs, `--jx-bg-overlay` and unclamped wrap replace the character glyphs, `--jx-bg-panel` and the three-line clamp. The surface keeps one placement rule: `insetBlockEnd: 36px`, so the stack clears the status bar as it does today. `jx-toast-host`'s own description invites that override. Severity maps to `variant` as success → `positive`, info → `info`, warn → `warning`, error → `negative`.
- **Decided:** a keydown whose target is inside the toast layer resolves against `["global"]` in `dispatchKey`, unless a modal is open (the modal stack still wins). Otherwise Enter on a recovery button inserts a paragraph instead of pressing the button, and Escape changes the canvas selection as it returns focus. The general stale-`focus.region` problem is studio.md §13.4's and is not closed here.
- **Open:** who owns F8. Recommendation: a Studio command. `view.focusNotifications` ("Focus Notifications", View, `application`, `keybinding: "f8"`, palette only, enabled while a toast is on screen, `requires: "a notification on screen"`) calls the kit's `focusStack`, and the host sets `hotkey=""`. The iframe forwards a registry chord, so F8 works from the canvas. The chord also appears in the palette and the generated shortcut sheet, can be rebound, and stands down under a modal, where the toast layer is inert. Escape still returns focus through the element's own document listener, which runs with `hotkey` empty. The toast-host behaviour's module doc already names "Studio's command registry" as the reason `hotkey` can be empty. No studio.md §10 row is needed, because the generated sheet lists a chord §10 does not name. The alternative is to keep the element's default `F8`: no Studio command, but the key is dead while the canvas frame has focus.

## Implementation

Paths under `packages/studio/src/` unless stated. Code comments cite qualified sections (`ui.md §5.2`, `studio-ui-guidelines.md §13.1a`), because a bare `§` in this package means studio.md.

1. **`surfaces/toasts.json`, rewritten.**
   - The root is `tagName: "jx-toast-host"` with `attributes`: `part: "stack"`, `live: "off"`, `label: "Notifications"` and `hotkey: ""` (the Open; omit `hotkey` under the alternative).
   - `style` keeps only `insetBlockEnd: "36px"` and `& [part="action-wrap"] { display: contents }`. Every other rule goes, because the kit draws it.
   - `children` stays one `$prototype: Array` over `#/state/toasts`, keyed by `$map/item/id`. Its `map` is a `jx-toast` with:
     - `$props`: `open: true`, `variant` from `$map/item/variant`, `timeout` from `$map/item/timeout`.
     - `attributes`: `dismiss-label: "Dismiss notification"`.
     - `onclose`: a Function calling `#/state/closed` with `[$map/item/id]`.
     - Two children. The first is a `span` whose `textContent` is `${$map.item.message}` (the default slot). The second is the existing `$switch` on `$map/item/hasAction`, whose container span now carries `slot: "action"`, `role: "none"` and `part: "action-wrap"`. Its `true` case is today's `jx-button` unchanged: `part: "action"`, `title`, `disabled`, and `onclick` calling `runAction`. A `$switch` always renders its container (spec.md §14.1), so the container is the slotted child.
   - Rewrite `$description` to say the stack and every toast are the kit's, and that the surface only projects records.
2. **`ui/layers.ts`, the toast block (lines 461 to 690).**
   - Delete `TOAST_ICON`, `_toastTimers` and the rest-timer half of `scheduleToast`, which becomes `trackSettle(record)` and arms only `_toastEntering`. Delete the timer loop in `unmountToastHost`.
   - Give `trackSettle` its own memory. `scheduleToast`'s guard is `_toastTimers.has(id) || _toastEntering.has(id)`, and without the first half every re-run of the mount effect (each arrival, each registry change) re-arms a window for every record whose window has closed, so a resting toast reappears in `overlayIdleBlockers()` (studio-ui-guidelines.md §13.3 rule 4). That already happens today to a toast with no rest timer (`timeoutMs: 0`, or any toast under `?automation=1`). Add `_toastSettled: Set<string>`: `trackSettle` returns for an id in it and adds the id when it runs. The effect drops ids no longer in `toasts`, and `unmountToastHost` clears it beside `_toastEntering`.
   - Nothing changes for rows that exist when the host first renders, but a test pins them. The host's `connectedCallback` (`packages/runtime/src/runtime.ts`) captures its children for `distributeSlots` and re-appends them. A `jx-toast` that finished initialising before that capture would come back with its clock parked by `onToastUnmount` and never restarted, which is sticky, because the runtime initialises an element once. Today the host wins: both await `buildScope`, the host starts first, and it resolves five `$src` functions to the toast's six.
   - `retireToast(id)` becomes `_toastEntering.delete(id); dismiss(id)`.
   - `ToastProjection` drops `icon` and `severity` and gains `variant` (from a `TOAST_VARIANT: Record<Severity, "positive" | "info" | "warning" | "negative">`) and `timeout` (`toastsAreHeld() ? 0 : (record.timeoutMs ?? 0)`).
   - `ToastScope.dismissToast` becomes `closed(id)` → `retireToast(id)`. `runAction` keeps its registry guard and `runReported` call but no longer retires the toast.
   - Add `export function focusToastStack(): boolean`. It finds the `jx-toast-host` in `_toastLayer` and returns `focusStack(host)` from `@jxsuite/ui/behaviors/toast-host`, or `false` when there is no host.
   - Add `export function inToastLayer(target: EventTarget | null): boolean`, true when `target` is a node inside `_toastLayer`.
   - Rewrite the module header's toast paragraph: the stack is `jx-toast-host`, and this module projects records, passes rest times, retires a record on `close`, and publishes the settle window. Add `@docs studio/interface/problems-and-progress`. Update `TOAST_ENTER_MS`'s doc to say it covers `jx-toast`'s `--jx-dur-1` entry transition. `toastsAreHeld` keeps its studio.md §13.5 doc and now means "rendered with `timeout` 0".
3. **`shell/tree.ts`, `overlayLayers()`.** Remove `role="status"` and `aria-live="polite"` from `#layer-toast` and keep `data-jx-region="overlay.toasts"`. Replace the comment: the layer is not a live region, `notify()` announces every record once (studio-ui-guidelines.md §13.1a), and the `jx-toast-host` inside it is `live="off"`.
4. **`commands/defaults.ts`** (under the Open's recommendation). Add `focusNotifications: () => boolean` and `hasNotifications: () => boolean` to `CommandDeps` and to `noopCommandDeps()`. The no-op `focusNotifications` returns `false`, and the no-op `hasNotifications` returns `true`: `defaultCommandSet()` is built on the no-op deps, and the sweep "every predicate is exercised by the all-enabled context" in `tests/commands-defaults.test.ts` expects every `enablement` to answer true. Append the `view.focusNotifications` record after `view.cycleRegionBack`, with `category: "View"`, `level: "application"`, `keybinding: "f8"`, `menus: ["palette"]`, `group: "4_docks"`, `enablement: () => deps.hasNotifications()`, `requires: "a notification on screen"` and `run: () => { deps.focusNotifications(); }`. `context-menu.ts`'s `enablement: () => deps.styleClipboard() !== null` is the precedent for a predicate that reads deps.
5. **`editor/shortcuts.ts`.**
   - In the deps that `registerStudioCommands` passes to `defaultCommands({ … })` (line 867, beside `cycleRegion`), wire `focusNotifications: focusToastStack` and `hasNotifications: () => toasts.length > 0`. Import `toasts` from `../services/notify` and `focusToastStack` and `inToastLayer` from `../ui/layers`.
   - In `dispatchKey`, compute `const ctx = registry.context()`. Resolve against `["global"]` when `inToastLayer(event.target) && !ctx.modal.open`, and against `keyScopeStack(ctx)` otherwise. Extend the docblock with the reason.
6. **Nothing else changes.**
   - `services/notify.ts`, `services/announce.ts` and `services/idle.ts` are untouched.
   - `packages/desktop/src/platform.ts`'s comment becomes true as written, and desktop is not edited.
   - studio.md §13.5's "`ui/layers.ts` holds a toast open instead of retiring it on its timer" stays true, since the timer is now the element's and `layers.ts` passes 0.

**Integration contract.** No plan requires this one. Once it lands:

- ui.md §5.2 is Implemented.
- `layers.ts` exports `focusToastStack()` and `inToastLayer()`. `overlayIdleBlockers()`, `toastsAreHeld()` and `TOAST_ENTER_MS` keep their meaning.
- A key pressed inside the toast layer reaches only `global`-scoped records.
- `#layer-toast` is not a live region. A new toast surface must not add one, because `notify()` is the one voice.
- Under the recommendation, F8 is the registry's `view.focusNotifications`, so `plan:studio/preferences-keyboard-rebinding` and `plan:studio/keyboard-shortcut-tables` see it as an ordinary record, and `plan:studio/canvas-block-keyboard-access` must not bind F8.
- `plan:studio/grid-save-activity` is independent. It changes the Activity quiescence source, and this plan changes only the overlay one.

## Tests

All in `packages/studio`: `bun test --isolate --coverage` from `packages/studio`, then `bun scripts/check-coverage-manifest.ts packages/studio` from the root. `packages/ui` is untouched, so its suite is not needed.

- **`tests/toast-host.test.ts`**, rewritten in place against the kit's parts. The kit keeps `[part="message"]`, `[part="dismiss"] [part="control"]` and `[part="action"] [part="control"]`, and `jx-toast` replaces `[part="toast"]`.
  - "the fourth layer announces nothing of its own" replaces the live-region test. `#layer-toast` has no `role` or `aria-live`. The `jx-toast-host` has `aria-live="off"` and no `role`. After `notify.success("Copied")`, every element with a `role` of `status` or `alert`, or an `aria-live` other than `off`, is one of announce's regions (`#jx-live-polite`, `#jx-live-assertive`).
  - "a notification paints a jx-toast whose variant follows its severity". Read `dataset.variant`, which the element writes, because a `$props` write does not reflect the `variant` attribute. success → `positive`, info → `info`, warn → `warning`, and `notify.error(…, { tier: "toast" })` → `negative`. The message is in `[part="message"]`.
  - "the rendered toast carries its record's rest time": `timeout` is 4000 for info and 8000 for warn.
  - "four at most": five `notify.info` calls render four `jx-toast`s, the first message gone.
  - Kept, with new selectors: only toasts render, arrival order, dismiss removes the record, a resting toast retires itself after its own timeout (the element's clock now), the recovery label is the command title, the action runs with its args and retires the toast, disabled carries the reason, and an unregistered id or no action renders no button.
  - "pressed with no registry to reach, it leaves the toast where it is" is kept, but its comment changes. The kit closes a toast on any click inside the `action` slot (`onToastAction`), including one `runAction` declines. The toast survives because clearing the registry re-projects `hasAction: false` and removes the button. So the case also asserts the stale button is no longer inside `#layer-toast`.
  - "a close from the element retires the record, whatever the reason": for each of `timeout`, `dismissed` and `action`, `closeToast(el, reason)` from `@jxsuite/ui/behaviors/toast` empties `toasts`.
  - "a toast under the pointer outlives its rest time". Raise a toast with `timeoutMs: 400`, which outlasts the render as the existing lifetime test's comment requires. Dispatch `pointerover` on it right after `flush()`, wait past 400ms, and the record is still there. Then `pointerout` with a `relatedTarget` outside the stack, and the record retires (polled, as the existing lifetime test is). This proves Studio runs no timer of its own.
  - "a settled toast does not settle again when another arrives": with reduced motion off, raise a sticky toast, wait past `TOAST_ENTER_MS`, and raise a second one. `overlayIdleBlockers()` names only the second. This fails without `_toastSettled`.
  - "a toast raised before the host mounts retires on its own clock": `unmountToastHost()`, `notify.info("early", { timeoutMs: 250 })`, `mountToastHost()`, then poll until `toasts` is empty.
  - "under ?automation=1 every toast is rendered sticky": the element's `timeout` is 0 and the record survives. This replaces "nothing is scheduled".
  - "focusToastStack puts focus on the first control and Escape gives it back": from a focused button outside the layer, then a `keydown` Escape on `document`.
  - "the settle window covers the kit's entry transition": `TOAST_ENTER_MS >= parseFloat(String(themeTokens["--jx-dur-1"]))`, with `themeTokens` from `@jxsuite/ui/theme`.
  - Kept: the two `overlayIdleBlockers` cases, "timeoutMs 0 holds", "toastsAreHeld is false without ?automation=1", and unmounting (no toast rendered, blockers empty, the record survives).
- **`tests/shell-tree.test.ts`**: "the toast host is a live region before any toast is raised" becomes "the toast layer is not a live region". It asserts no `role` or `aria-live` on `#layer-toast` and that the layer still carries `data-jx-region="overlay.toasts"`.
- **`tests/commands-defaults.test.ts`**:
  - The recording deps gain `focusNotifications` (it records `"focusNotifications"`) and `hasNotifications` (returns true), and the run-order list gains `"focusNotifications"` after `"cycleRegion:-1"`.
  - A new case asserts the record's chord (`f8`), its absent `keyScope` (so `global`) and its `requires`, and that `enablement` follows `hasNotifications`.
  - The no-op deps case calls both new deps. The all-enabled sweep stays green because the no-op `hasNotifications` answers true.
- **`tests/shortcuts.test.ts`**:
  - New "a key pressed inside the toast stack reaches only global chords". With an element selection and a canvas stack, a `keydown` Enter whose target is a button inside `#layer-toast` runs no command and is not `defaultPrevented`. The same Enter on the stage runs `selection.insertSibling`.
  - New "F8 runs view.focusNotifications from the canvas stack". This file mocks `notify` with a recorder that stores nothing (`tests/notify-mock.ts`), and with no toast the record is disabled and the chord is claimed silently, so the case would prove nothing. Push a toast record into the real `toasts` array, which the mock re-exports, and `flush()`. Then `pressDoc("F8")` with an element selection, and assert `document.activeElement` is inside `#layer-toast`.
- **`tests/iframe-keys.test.ts`**, in "the frame's table is the app's keymap" (the table built from `appCommandSet()`): `chords` holds `{ chord: "f8", scope: "global" }`, and `shouldForwardKey` answers true for an F8 press under the canvas and caret stacks. A hand-built table would pass before the change, so the case must use that describe's `live` table.
- **`tests/surfaces-a11y.test.ts`** runs the overlay, dialog and accessibility lints over every surface document, the rewritten `toasts.json` included, and needs no edit.
- **Coverage.** `packages/studio/bunfig.toml` gates each file at lines 0.958 and functions 0.941. `layers.ts` loses code and gains two exported functions, both exercised above. `defaults.ts`'s new closures are run by the recording-deps sweep. If the workspace's worst file rises, ratchet `coverageThreshold` to just below it. No source file is added, so the manifest check needs nothing new.

## Specs & docs

**`specs/ui.md`, in place** (no heading moves, and each paragraph and table row stays one line):

1. **§5.2 marker (line 185).** `Partial` → `Implemented`. Keep everything up to and including "…and so are `jx-toast` and `jx-toast-host`." Replace the rest ("What is short is … make the fallback.") with:

   > Studio's notification stack is the last two: `packages/studio/src/surfaces/toasts.json` is a `jx-toast-host` with `live="off"`, because `notify()` already announces every record once (studio-ui-guidelines.md §13.1a), holding one `jx-toast` per toast record that `src/ui/layers.ts` projects from `services/notify.ts`. Each toast takes its record's rest time as `timeout` (0 under `?automation=1`) and its recovery command in the `action` slot, and its `close` retires the record, so the shell keeps no clock of its own. Studio sets `hotkey` empty and binds F8 as a command, `view.focusNotifications`, which its canvas frame forwards (`packages/studio/tests/toast-host.test.ts`).

   Under the Open's alternative, the last sentence becomes "The stack keeps the element's own `F8`."

2. **§5.2 "A toast carries no live region" paragraph.** Replace "and Studio's `surfaces/toasts.json` sits inside a host that already speaks" with "and Studio's stack is a host with `live="off"` inside an application that already speaks".
3. **`jx-popover` row, Owns cell (line 209).** Replace "placed by measured viewport coordinates" with "placed against its source by `position-area` (`placement`) when shown from one, and by measured viewport coordinates otherwise".
4. **§5 marker (line 144).** Drop "Studio's adoption of the toast stack (§5.2), " from the list of what remains. `plan:ui/builder-section-text` edits the same list, so whichever lands second rebases it and keeps the grammar.
5. **§10 marker.** "(§5.1, §5.2, §5.4, §6)" loses `§5.2`, keeping whatever other entries are still open at that point.
6. **§2 marker (line 23), only if `plan:ui/principles-text` has not landed.** "(a surface that redraws a control the kit has an element for is a different defect, and §5.2 names the one that remains, the toast stack)" becomes "(a surface that redraws a control the kit has an element for is a different defect)". That plan rewrites the whole marker, and its new principle 1 names no toast stack.

**Fragment:** `bun run spec:change ui.md minor -m "Studio's notification stack is a jx-toast-host of jx-toast elements, silent because notify() announces every record, with each toast's clock and close replacing the shell's own timers; the jx-popover row says a panel shown from a source is anchored to it, with measured coordinates as the fallback"`.

ui.md does not graduate: §2, §3.1 to §3.3, §4.1, §5.1, §5.4, §5.5, §6 and §7 stay open. No studio.md or studio-ui-guidelines.md text changes. §13.1a, §13.2 and §13.3 hold as written, and studio.md §13.5's exception 3 is still accurate.

**Docs.**

- `docs/studio/interface/problems-and-progress.md` (`spec: studio.md#16`) changes.
  - Add `packages/studio/src/ui/layers.ts` and `packages/studio/src/surfaces/toasts.json` to its `code:` list, to pair with the new `@docs` tag.
  - In "## Toasts", after the "It retires itself" paragraph, add: "**It waits while you read it.** While the pointer is over a toast, or the keyboard is inside one, no toast counts down, and each resumes with the time it had left. Press :kbd[F8] to put the keyboard on the first button in the stack, even from the canvas, and :kbd[Escape] to go back to where you were. In the code editor, :kbd[F8] moves to the next lint marker instead." There are no em dashes. Under the Open's alternative, drop "even from the canvas".
- `docs/extending/ui-kit.md` (`spec:` cites `ui.md#5.2`) needs no change. Its toast section describes the elements, and its popover section already describes anchored placement.
- `docs/studio/interface/canvas.md` lists `editor/shortcuts.ts` in `code:`, but the dispatcher rule does not touch the canvas, so it needs no change.
- The generated `docs/studio/interface/commands.md` and `shortcuts.md` pick up `view.focusNotifications` by themselves.

## Acceptance

- In `packages/studio`, `bun test --isolate --coverage` passes, and `bun scripts/check-coverage-manifest.ts packages/studio` passes. `bun run typecheck` and `bun run lint` pass.
- `grep -n "_toastTimers\|TOAST_ICON" packages/studio/src/ui/layers.ts` and `grep -n 'role="status"\|aria-live="polite"' packages/studio/src/shell/tree.ts` print nothing. `grep -c "jx-toast" packages/studio/src/surfaces/toasts.json` is non-zero.
- `bun run plans:status --spec ui` no longer lists `ui.md#5.2`. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass.
- In a running Studio:
  - A copy raises a toast that stays while hovered and retires after its rest time once the pointer leaves.
  - With a block selected in the canvas, F8 focuses the toast's first button, Enter runs its command without inserting a paragraph, and Escape returns focus to the canvas.
  - A screen reader hears the toast once.
- The screenshots lane may commit re-captured images where a shot shows a toast. Re-read the pages its comment lists.
