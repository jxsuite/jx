---
status: stub
disposition: reconcile
claims:
  - ui.md#2
size: S
---

# The principles say what a surface draws, what the cascade does and which id references the kit writes

## Context

`specs/ui.md` §2, line 23 (excerpt):

> **Status: Partial.** What holds: principle 1 up to its last clause, … principle 4 on the kit's side, … while Studio's side of it is studio-ui-guidelines.md §12's own open items; … What is short is text the code contradicts in three places. Principle 1's last clause, "a surface carries no markup of its own beyond the kit's", does not hold, and no gate looks at it: … Principle 2's cascade: only the THEME sheet is layered, while an element's own rules are emitted unlayered as `[data-jx="…"]` at (0,1,0) by `packages/runtime/src/runtime.ts` and adopted after every linked sheet, so a host rule wins by being heavier or adopted later and never by layer (…). And principle 2's id references: the kit writes no `anchor-name` anywhere, because every panel is placed against its implicit anchor (§6).

Disposition `reconcile`: in all three places the code is what the rest of the spec already describes.

- Principle 1's last clause contradicts §3.1, which makes a box that one definition draws a part of that definition. A surface is a definition, so its own `div`s are its parts. What §3.1 does forbid, a class written to reach a rule, is `plan:ui/surface-classes-to-parts`. A surface that redraws a control the kit has an element for is §5.2's toast stack, `plan:ui/studio-toast-host`.
- For principle 2's cascade, §9 layers only the theme and keeps Jx's own emitter unlayered (spec.md §9.6), and §5.5 records the weight rule a host follows to override an element's rest look.
- For principle 2's id references, §5.2, §6 and §11's CSS Anchor Positioning row all say the kit never writes `anchor-name`.

Before the census the cascade correction lived in the marker, as a paragraph beside a principle that still said the opposite.

**What exists**

- Principle 1:
  - `packages/studio/scripts/check-surface-purity.ts` refuses lit in an adapter and a kit tag in a lit template. That holds "a surface is a document". It says nothing about what markup a document holds.
  - 86 of the 89 documents in `packages/studio/src/surfaces/*.json` write a native `div`, 77 write a `span` and 29 write a `button`.
  - `packages/ui/package.json` depends on nothing in `packages/studio`, which is the kit's half of the principle.
- Principle 2:
  - The style engine in `packages/runtime/src/runtime.ts` rewrites scoped rules to `[data-jx="<uid>"]` and adopts them, unlayered, through the element's sheet state.
  - The theme layer is the `"@layer jx-ui"` key in `packages/ui/project.json`, emitted by `themeCSS()` in `packages/ui/src/theme.ts`.
  - Implicit anchoring with no `anchor-name`: the `@supports (position-area: block-end)` blocks in `packages/ui/components/jx-popover.json`, `jx-menu.json` and `jx-tooltip.json`, and `onBeforeToggle` in `packages/ui/src/behaviors/popover.ts`.
  - The worked example of the weight rule is the Edit column's handles in `packages/studio/src/surfaces/canvas-stage.json` (`& [part="edit-handle"]`). The pre-census marker also cited the dock handles' `#app > .resize-handle` in `packages/studio/styles/shell-frame.json`. That rule is class-keyed, and §3.1's marker names the class as a defect. `plan:ui/surface-classes-to-parts` re-expresses it on a part, and only then is it an example again.
- Principle 4: the kit's elements print the `title`, chord and `requires` reason a host hands them, and nothing in `packages/ui` formats a chord. Studio's side is studio-ui-guidelines.md §12.1 to §12.5, all Partial there and owned by that spec's plans. It is not claimed here.
- The gates the marker cites: `packages/ui/tests/conformance.test.ts` (its "the kit keeps its principles" block holds principles 2 and 5) and `packages/studio/scripts/check-surface-purity.ts`.

**What is missing**

- Principle 1's clause "a surface carries no markup of its own beyond the kit's" rewritten to the rule §3.1 already states. A surface's own boxes are parts of it and are styled from its own `style`. A control the kit has an element for is drawn with that element, never redrawn.
- Principle 2's clause "the kit's own sheet lives in a cascade layer so a host's rule always wins (§9)" rewritten to what ships. The theme's tokens are layered. An element's rules are unlayered at (0,1,0) and adopted last. A host overrides an element's look by weight or by order.
- `anchor-name` taken out of principle 2's list of id references, or replaced by the relationship that does exist: a popover's invoker, through `popovertarget`, `interestfor` or `showPopover({ source })`.
- The marker reduced to its evidence and flipped to Implemented once the text agrees. Principle 4's Studio half stays with studio-ui-guidelines.md §12, so the flip does not wait for it.
- A ride-along of the same kind, which carries no open item of its own (see the audit record's spec-wide decisions). §11's CSS Scoping row says the kit meets `:host`, "which the runtime translates to the tag", and cites `packages/runtime/src/runtime.ts`. No kit component document uses `:host`, and the translation is `resolveSelectorMember` in `packages/compiler/src/shared.ts`. The row's wording and evidence column should say so.

**Related**

- ui.md §3.1 (element, part, surface), ui.md §5.5 (the (0,1,0) hover rule on `jx-split`), ui.md §6, ui.md §9 (the theme layer), ui.md §11 (the CSS Scoping and CSS Cascade Layers rows).
- spec.md §9.6 (the unlayered emitter), spec.md §16.6 (`:host` translation).
- studio-ui-guidelines.md §12 (principle 4's Studio half).
