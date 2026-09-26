---
status: stub
disposition: implement
claims:
  - ui.md#6
size: M
workspaces:
  - packages/ui
  - packages/studio
---

# Every kit overlay animates in and out, and a popover opened inside a modal dialog renders in its overlay slot

## Context

`specs/ui.md` §6, line 370 (the open clause of a long marker):

> **Status: Partial.** The dialog half is built: … A panel shown from nothing, a stack with a floor, and an engine without anchors keep the measured placement, which is the `@supports` fallback the popover lint requires. Three things are short: `jx-menu` and `jx-dialog` declare no `@starting-style`, transition or `allow-discrete`, so neither animates its entry or exit; nothing mounts or routes a popover into `jx-dialog`'s `[part="overlay-slot"]`, and Studio's `getLayerSlot("popover", id)` (`packages/studio/src/ui/layers.ts`) always appends to `#layer-popover`, outside any open dialog; and the custom commands that ship are the unprefixed `--show` and `--close` (`src/behaviors/dialog.ts`), where the text below names a `--jx-*` command.

Disposition `implement` for the transitions. The command naming is a text fix, which would be `reconcile` on its own. It rides here because each anchor has one owner (see the audit record's spec-wide decisions). The overlay slot could go either way, and a live caller now decides it (see below).

**What exists**

- Discrete entry and exit transitions ship on `packages/ui/components/jx-popover.json`, `jx-tooltip.json` and `jx-toast.json`, as `@starting-style` plus `transition-behavior: allow-discrete` on `display` and `overlay`. `packages/ui/tests/popover.test.ts` holds `display` and `overlay` to one transition and keeps `display` out of `@starting-style`.
- `jx-menu.json` and `jx-dialog.json` declare none of it.
- The `[part="overlay-slot"]` div is at `jx-dialog.json:410`, and `packages/ui/tests/dialog.test.ts` asserts it at lines 205 to 214.
- Three places cite "specs/ui.md §7" for the overlay rule, which is §6: the comment in `packages/ui/tests/dialog.test.ts:205`, the `browseFor` doc comment in `packages/studio/src/panels/seo-modal.ts:445`, and a `$description` in `packages/studio/src/surfaces/seo.json:892`.
- `getLayerSlot` (`packages/studio/src/ui/layers.ts:430`) resolves only the four layer roots.
- The kit's own popovers do not have this problem, because each is a DOM descendant of the element that opens it (the combobox list, the colour field's panel). The problem is limited to a popover a host mounts into a layer.
- One Studio flow does this today. The SEO surface is a `jx-dialog` (`packages/studio/src/surfaces/seo.json:5`). Its Browse button calls `browseFor` (`packages/studio/src/panels/seo-modal.ts:448`), which calls `openMenu`, and `packages/studio/src/surfaces/menu.ts:226` mounts that menu through `getLayerSlot("popover", region)`, so the menu sits in `#layer-popover`, outside the open modal. The code relies on `showPopover({ source })` (`surfaces/menu.ts:309`) rather than the slot: its comment says the Browse button as `source` "is what puts it in the dialog's own top-layer hierarchy". `packages/studio/tests/seo-modal-media.test.ts` covers the listing under happy-dom, which models neither the top layer nor modal inertness.
- `onCommand` in `packages/ui/src/behaviors/dialog.ts` (lines 101 to 115) answers `--show` and `--close`, which is what `stylebook/jx-dialog.json` and §5.2 use.

**What is missing**

- The same discrete transitions on `jx-menu` (every level of the stack) and on `jx-dialog`, including its `::backdrop`. They should be zeroed by `--jx-dur-*` under reduced motion, and the popover test's assertions should be extended to both.
- The overlay slot decided against the SEO media menu, the live case. The first step is to check in a real browser whether that menu is reachable and operable while the dialog is modal. A node outside a modal dialog's subtree is inert under the HTML standard, and a popover `source` sets the popover's hierarchy for light dismiss, not its inertness.
  - If it is inert, routing is needed, and this half is `implement`: a way to find the nearest open `jx-dialog`'s `[part="overlay-slot"]` from an opener, used by `getLayerSlot("popover", …)` or `surfaces/menu.ts` whenever the opener is inside an open modal.
  - If it works, the slot sentence is what is stale, and this half is `reconcile`: §6 is rewritten to the `source`-based placement, and the slot is removed from `jx-dialog` or kept as an unused hook, with a reason.
- The three wrong §7 citations corrected to §6.
- §6's "a `--jx-*` custom command" rewritten to the unprefixed `--show` and `--close` the kit ships.

**Related**

- ui.md §5.2 (`jx-dialog`, `jx-popover`, `jx-menu`), ui.md §11 (the CSS Transitions 2 and WHATWG HTML rows).
- studio-ui-guidelines.md §8.7 (how the layers façade maps onto these primitives).
