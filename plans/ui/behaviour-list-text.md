---
status: stub
disposition: reconcile
claims:
  - ui.md#3.3
  - ui.md#7
size: S
---

# §3.3 and §7 say what a behaviour sidecar is for and list the ones the kit ships

## Context

`specs/ui.md` §3.3, line 78:

> **Status: Partial.** The mechanism ships: `(state, event)` exports under `packages/ui/src/behaviors/`, preloaded under their `jx-ui:` specifiers by `KIT_MODULES` in `src/index.ts`, with `onMount` receiving `(state, host)`. The list of what the kit ships is stale in three places: no behaviour does label scrubbing (§5.5's `jx-dimension-field` row says it is promised nowhere), overflow measurement is the host's (§5.5, `jx-toolbar`), and tree drag and drop is a host island (§5.5, `jx-tree`).

`specs/ui.md` §7, line 380 (excerpt):

> **Status: Partial.** … Every keyboard pattern in this section now has an element behind it. One sentence says something the code does not: "Focus moves are the one thing a behaviour sidecar is for". Several sidecars also own keys that write a value or activate a control, arithmetic the closed operator set cannot express: `onSplitKeydown` in `src/behaviors/split.ts` (Home, End, Enter and the arrows), `number-field.ts` (Shift with an arrow steps by ten), `color-area.ts` (the cross-axis arrows), `tabs.ts` (Delete activates the close button) and `combobox.ts` (the list and commit keys).

Disposition `reconcile` for both. They are one statement made twice: what a sidecar is for.

- For §3.3, §5.5 decided all three items deliberately and gives its reasons, so the spec's own later text is right and §3.3's list is what is stale.
- For §7, §3.2's "Declarative first" bullet already says what ships: a sidecar is "only for what the closed operator set cannot express". Clamped, stepped value arithmetic is that, and so is activating another part from a key. §7's sentence is the narrower, stale one.

**What exists**

- Twenty behaviour modules in `packages/ui/src/behaviors/`, registered through `KIT_MODULES` in `packages/ui/src/index.ts`. The `onMount(state, host)` call is in `packages/runtime/src/runtime.ts`.
- The behaviours §3.3's list names that do ship:
  - roving focus: `menu.ts`, `toolbar.ts`, `tabs.ts`, `tree.ts`, `action-group.ts`, `swatch-group.ts`
  - typeahead: `menu.ts`, `tree.ts`
  - the anchor-fallback clamp: `popover.ts`
  - split dragging: `split.ts`
  - colour maths: `packages/ui/src/color.ts`
- Nothing in `packages/ui` or `packages/studio` scrubs a label. The header comment of `toolbar.ts` says the toolbar owns no overflow menu, and `tree.ts` has no drag code.
- The key handlers that are not focus moves:
  - `packages/ui/src/behaviors/split.ts:460`, `onSplitKeydown`: writes `value` on Home, End, Enter and the arrows.
  - `number-field.ts:118`, `onNumberKeydown`: Shift with an arrow steps by ten.
  - `color-area.ts:185`, `onAreaKeydown`: the cross-axis arrows write the other channel.
  - `tabs.ts:297`: Delete clicks the tab's close button.
  - `combobox.ts:389`, `onComboboxKeydown`: opens, moves and commits the list.

**What is missing**

- Label scrubbing, overflow measurement and tree drag and drop taken out of §3.3's list. Each could instead point at the §5.5 paragraph that gives it away.
- The sentence "Each is named in the catalogue entry of the element that uses it" checked against the list that results.
- §7's "Focus moves are the one thing a behaviour sidecar is for" rewritten to what ships. A sidecar owns focus moves and the key arithmetic the operator set cannot express. Everything else about a key is a `$switch` on `event#/key`.
- Both markers reduced to their evidence and flipped to Implemented.

**Related**

- ui.md §2 (principle 3's list of what the kit adds, principle 5's allowed set), ui.md §3.2 (the "Declarative first" bullet), ui.md §5.5 (the overflow, drag-island and dimension-field decisions).
