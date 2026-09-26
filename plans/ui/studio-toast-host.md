---
status: stub
disposition: implement
claims:
  - ui.md#5.2
size: M
workspaces:
  - packages/studio
---

# Studio's toast stack is a jx-toast-host of jx-toast elements

## Context

`specs/ui.md` §5.2, line 185 (the open clause of a long marker):

> **Status: Partial.** `jx-dialog` is built: … `jx-popover`, `jx-tooltip` and `jx-spinner` are built, and so are `jx-toast` and `jx-toast-host`. What is short is the adoption the table promises: Studio's toast stack is still the hand-drawn `packages/studio/src/surfaces/toasts.json`, mounted by `src/ui/layers.ts` with its own timers, and nothing in `packages/studio/src` uses either toast element; and the `jx-popover` row below still says the panel is placed by measured viewport coordinates, which the paragraph under this marker and `src/behaviors/popover.ts` make the fallback.

The `jx-toast-host` row (line 213) lists "the hand-drawn stack in `surfaces/toasts.json`" under Replaces. Every other entry's replacement has happened, and this one has not. Disposition `implement`.

This stub also owns the `jx-popover` row's text (line 209). The fix involves no code and would be `reconcile` on its own. It is here because it sits under the same marker, and each anchor has exactly one owner.

**What exists**

- The kit's side, built and tested:
  - `packages/ui/components/jx-toast.json` and `jx-toast-host.json`
  - `packages/ui/src/behaviors/toast.ts` (named holds, `close` with `detail.reason`)
  - `packages/ui/src/behaviors/toast-host.ts` (the `live` role, `aria-atomic="false"`, the F8 `hotkey`)
  - `packages/ui/tests/jx-toast.test.ts` and `jx-toast-host.test.ts`
- Studio's side:
  - `packages/studio/src/surfaces/toasts.json` is a `div part="stack"` of spans and buttons.
  - `packages/studio/src/ui/layers.ts` imports it as `toastsDoc`, renders `toasts` from `services/notify.ts`, and keeps its own retirement timers (`_toastTimers`, line 482; `dismiss`, line 535).
  - The host announces through its own live region, called from `notify()`, which is what §5.2's `live="off"` case is for.

**What is missing**

- `toasts.json` re-authored over `jx-toast-host`, probably with `live="off"` because Studio already announces each record once (studio-ui-guidelines.md §13.1a). It needs one `jx-toast` per record, with the recovery command in the `action` slot.
- The timers in `layers.ts` retired in favour of each toast's `timeout` and named holds. The severity durations in studio-ui-guidelines.md §13.2 (4s and 8s) and the four-toast cap must survive the move. The "settling in" signal that `probe.idle()` reads also has to survive (studio-ui-guidelines.md §13.3).
- `close`'s `detail.reason` routed back to `notify`'s `dismiss`.
- The element's F8 `hotkey` checked against Studio's own keymap.
- The `jx-popover` row rewritten to the anchored placement, with the measured coordinate as the fallback.

**Related**

- ui.md §6 (discrete transitions on `jx-toast`), ui.md §7 (the toast host's own key), ui.md §11 (the WCAG row's SC 2.2.1 evidence).
- studio-ui-guidelines.md §13.1a, §13.2 and §13.3 (the notification tiers the stack renders).
