---
status: stub
disposition: implement
claims:
  - ui.md#3.1
size: M
workspaces:
  - packages/studio
---

# Studio's surface documents write no class to reach a rule, and a gate refuses one

## Context

`specs/ui.md` §3.1, line 37:

> **Status: Partial.** The kit's side holds: no element writes a class and the only sheet the kit emits is the token block (`packages/ui/tests/conformance.test.ts`, `theme.test.ts`). The surface side does not: `packages/studio/src/surfaces/shell.json` writes `resize-handle` on its `jx-split` handles to reach the rules in `styles/shell-frame.json`, and `surfaces/panel-elements.json` writes `components-section` and `element-card*`, which `styles/panels.css` styles and `src/panels/dnd.ts` queries as runtime handles where this section says a handle is `part`; no gate refuses a class in a surface document outside the platform and third-party contract.

Disposition `implement`: §3.1 is explicit that "a class written to reach a rule is a defect" and that "a runtime handle is `part`". The kit already meets that rule, but these Studio surfaces do not.

**What exists**

- The kit's gates: "the kit ships no CSS class" in `packages/ui/tests/conformance.test.ts`, and "the theme sheet is tokens and nothing else" in `packages/ui/tests/theme.test.ts`.
- `packages/studio/src/surfaces/shell.json`, lines 42, 55 and 72: `resize-handle` and `resize-handle resize-handle-row` on the dock handles. They are styled by `.resize-handle` and `#app > .resize-handle` in `packages/studio/styles/shell-frame.json` (mirrored in `shell-frame.css`) and by `.resize-handle-row` in `styles/shell.css`. The id prefix is there only to outweigh the element's own (0,1,0) rule.
- `packages/studio/src/surfaces/panel-elements.json`, lines 207 to 354: `components-section`, `element-card`, `element-card-preview` and `element-card-label`. They are styled in `packages/studio/styles/panels.css` (lines 111 to 163), and queried in `src/panels/dnd.ts` at lines 262, 280 and 312.
- The same card classes are written by `src/panels/stylebook-doc.ts` (including the `& .element-card-preview` specimen scope) and styled for the canvas by a copy of those rules in `src/canvas/iframe-render.ts` (lines 616 to 658). That is a project document drawn in the canvas, not a surface, so the detail phase decides whether it follows.
- Legitimate classes that must stay: `electrobun-webkit-app-region-drag` and `-no-drag` in `surfaces/boot-failure.json` and `surfaces/commandbar.json`, which is the platform-contract case §3.1 names.
- The gates that exist do not cover this. `packages/studio/scripts/check-surface-purity.ts` refuses lit in an adapter and a kit tag in a lit template. `scripts/check-styles.ts` bans an `sp-` tag, and its orphan rule works the other way, asking that a class have CSS.

**What is missing**

- The dock handles and the element cards addressed by `part`. Their rules move to part selectors or to the owning document's `style`, and `dnd.ts` queries `[part="…"]`.
- The shell-frame override re-expressed on a part selector at a weight that still beats the element's own rule, following the rule §5.5 records for overriding an element's rest look.
- A gate over `packages/studio/src/surfaces/*.json` that refuses a `class` attribute outside an allow-list of platform and third-party contracts (the Electrobun drag regions, Tabulator's class names), either inside `check-surface-purity.ts` or beside it.

**Related**

- ui.md §2 (principle 1). The pre-census §2 marker cited the dock handles' `#app > .resize-handle` as the worked example of the weight rule. Once this plan lands, the part-keyed rule that replaces it is an example again, and `plan:ui/principles-text` may cite it. ui.md §5.5 (the `jx-split` hover-weight rule).
- studio-ui-guidelines.md §1.1 (a converted surface keeps its rules in its own `style`, keyed on `part`), studio-ui-guidelines.md §6.2 (`part` as the chrome's only style hook).
