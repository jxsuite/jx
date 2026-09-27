---
status: drafted
disposition: reconcile
claims:
  - studio-ui-guidelines.md#8.1
requires: []
workspaces:
  - specs
  - docs
size: S
---

# Selection states the boxes the canvas draws: a solid primary, dashed co-selected members, a faint solid hover and a collaborator's outline

## Context

`specs/studio-ui-guidelines.md` §8.1, line 424:

> **Status: Partial.** Selection as a list, the anchor and the primary, Shift-range and Ctrl/Cmd toggle, and one transaction per batch ship (`packages/studio/src/tabs/selection.ts`, `src/canvas/iframe-host.ts`). The highlight bullets do not match what the canvas draws: the overlay boxes are borders rather than outlines (`packages/studio/styles/canvas.css`, `src/canvas/iframe-overlay.ts`), the hover box is a 1px solid `--accent-50` border rather than a dashed one, and the dashed boxes are a multi-selection's co-selected members, which the bullets do not mention.

The bullets it means are lines 432 and 433: "Selection highlight: 2px solid accent outline" and "Hover highlight: 1px dashed accent outline at reduced opacity". Re-verified against 84735a9f (all paths under `packages/studio/`):

- **The rules.** `styles/canvas.css` lines 189 to 210: `.overlay-box` is `position: absolute; pointer-events: none`, `.overlay-selection` is `border: 2px solid var(--accent)`, `.overlay-hover` is `border: 1px solid var(--accent-50)`, and `.overlay-coselection` sets only `border-width: 1px; border-style: dashed`. `setCoSelection` (`src/canvas/iframe-overlay.ts`) gives each co-selection box `overlay-box overlay-selection overlay-coselection`, so it inherits the accent colour: a 1px dashed `--accent` border. The stub's "1px dashed" is right. It left out that the colour comes from `.overlay-selection`.
- **The boxes are never on the author's element.** `createOverlayLayer` builds them inside a root with `position:absolute; inset:0; pointer-events:none; overflow:hidden`. The host mounts that root beside the iframe (`canvasEl.replaceChildren(iframe, overlay.root)`, `src/canvas/iframe-host.ts` line 1808) and places each box from a rect the frame measures and posts back. Every element in Studio's sheets is `box-sizing: border-box` (`styles/tokens.css`), so each border draws inside the node's measured rect.
- **Hover.** `drawHover` (`iframe-host.ts` line 2820) hides the hover box when the hovered path is the primary. A stylebook host suppresses it over the selected tag instead. A co-selected member does get a hover box.
- **Labels.** `setSelection(rect, label)` shows `.overlay-label` on the primary's box in two cases: a stylebook specimen, labelled with its tag, and a layout element, labelled `LAYOUT · ` and then the layout file (the `layoutHit` case).
- **Presence is the one outline.** `setPresence` draws a collaborator's selection as `outline: 1.5px solid <colour>; outline-offset: 1px` with a name tag (`.overlay-presence`, `.overlay-presence-tag`). That puts it outside the node's rect, around the local borders. The stub's "borders ... are how the canvas draws any highlight" overstates: this box is an outline.
- **Preview.** `setSuppressed(true)` hides the whole layer on a preview render.
- **The structure is already tested; the look is not.** `tests/iframe-overlay.test.ts` (`describe("createOverlayLayer")`) and `tests/iframe-host.test.ts` pin the class structure: "a multi-selection measures every path and draws the others as co-selection boxes", "a selection of ONE draws no co-selection box at all", "a layoutHit selects the layout chrome, clears the document selection, and labels the box", "hover draws the hover box unless it coincides with the selection", "hover decodes to a tag and suppresses the box over the SELECTED tag", and, in `describe("preview renders")`, "hover draws no box". `tests/collab-presence.test.ts` and `tests/iframe-host-gaps.test.ts` pin the presence boxes. No suite loads `styles/canvas.css`.
- **The rest of §8.1 holds, as the census found.** `data-jx-path` resolution is in `src/canvas/iframe-position.ts`. The list, anchor, primary, toggle, range and batch helpers are `primarySelection`, `selectionAnchor`, `toggleSelected`, `rangeSelection` and `structuralBatch` in `src/tabs/selection.ts`. The canvas accumulates through `toggleSelected` on an additive hit (`iframe-host.ts` line 2143).
- **No user doc promises the old look.** `docs/studio/interface/canvas.md` cites `studio-ui-guidelines.md#8.1`. It says "Studio outlines it" and "Every selected element keeps a box on the canvas", and it never says which box is which.

Outside this claim, and not an item of §8.1: the forced-colours opt-out in `styles/forced-colors.json` (`.artboard, .canvas-frame, iframe.canvas-iframe`) matches no element Studio emits. The iframe's class is `jx-canvas-iframe`, and nothing carries `.artboard` or `.canvas-frame`. As a result the overlay layer, like everything else, stays in forced colours. Whoever next edits that sheet should look at it.

## Outcome

- studio-ui-guidelines.md §8.1 → Implemented. The highlight bullets state the three local boxes as the borders they are. A paragraph states the overlay layer, why the boxes are borders, the label, the collaborator's outline and Preview.
- studio-ui-guidelines.md stays `Partial`, because other plans still own open items in it. Nothing graduates.

## Decisions

- **Open:** reconcile the bullets to what ships, or change the canvas to match them (outlines, a dashed hover)? Recommendation: reconcile, because:
  - Dashed now means "co-selected". A dashed hover would differ from a co-selected member only in colour (`--accent-50` against `--accent`). Studio's chrome does not let colour carry a distinction alone (the "Colour is never the only encoding" rule on `DIFF_MARK_CSS`, `src/canvas/iframe-render.ts`). The overlay is also in forced colours (see Context), where every border takes one system colour, so there the two would be identical. As shipped, the three local boxes differ in width or line style: 2px solid, 1px dashed, 1px solid.
  - A border under `border-box` stays inside the node's rect. An outline around a node flush with the frame's edge would be cut off by the layer's `overflow: hidden`, and it would sit where a collaborator's outline sits, 1px outside the rect. As shipped, local and remote boxes never overlap.
  - Nothing user-facing promised the old look.

  If maintainers choose the canvas change instead, the disposition becomes `implement` in `packages/studio`: `.overlay-hover` goes dashed, and co-selection needs a different encoding.

- **Decided:** §8.1 enumerates every box the overlay draws for a selection: the primary, co-selected members, hover, the label and a collaborator's selection. This is the one place the spec says what the canvas draws for a selection, and a list that stopped at two boxes left the dashed box unexplained, which is the drift that opened this item. The drop indicator, the insertion "+" and the replace target stay where they are specified (§8.2 names the last two).
- **Decided:** the bullets name the tokens (`--accent`, `--accent-50`), not their colour mix. §1.1 owns the definitions, and `plan:studio-ui-guidelines/token-pipeline-prose` is correcting that section's `in srgb` to `in oklab`. Naming only the token keeps §8.1 true whichever way that lands, so there is no `requires` edge.
- **Decided:** no code or test change. The class structure is already pinned by the tests in Context. The look is a stylesheet fact that no suite can observe, because none loads `canvas.css` and happy-dom lays nothing out. A test that string-matched the stylesheet would pin bytes, not what draws. The spec cites the stylesheet as evidence instead.

## Implementation

A paper plan: every step is a spec or docs edit, all listed under Specs & docs.

1. `specs/studio-ui-guidelines.md` §8.1: the marker, the two bullets and one new paragraph.
2. `docs/studio/interface/canvas.md`: two sentences in "Selecting elements", and two `code:` entries.
3. The fragment, and deletion of this plan in the same pull request.

**Integration contract.** No plan requires this one. Once it lands, §8.1 is the contract for what the overlay layer draws for a selection, a hover and a collaborator. Any pull request that changes a box's look (the `.overlay-*` rules in `styles/canvas.css`, or `setPresence`'s inline style) edits §8.1 and `canvas.md` in the same change, and `docs:sync` flags `canvas.md` through its new `code:` entries. Two other plans edit neighbouring lines of the spec: `plan:studio-ui-guidelines/moves-without-dragging` (§8.2) and `plan:studio-ui-guidelines/caret-escape` (§8.3). They are adjacent only and can land in any order; whichever lands second rebases.

## Tests

No workspace suite changes, and none needs running. The pull request touches only `specs/` and `docs/`, and it adds no source file, so no coverage threshold or manifest entry moves. The gates that prove it:

- `bun run docs:status`: §8.1's marker form, and no open item under an Implemented header.
- `bun run docs:spec-release`: the body change carries a fragment.
- `bun run plans:check`: the claim is gone together with its plan, and no `unclaimed-open` appears.
- `bun run docs:check`: the two new `code:` entries exist, and the page set is associated.
- `bun run docs:links`, `bun run docs:prose` (no em dash in `canvas.md`) and `bun run docs:markdown`.

## Specs & docs

**`specs/studio-ui-guidelines.md`**, in place:

- **§8.1 marker (line 424)** becomes: "> **Status: Implemented.** Selection as a list, the anchor and the primary, Shift-range and Ctrl/Cmd toggle, one transaction per batch, and the highlight boxes below ship (`packages/studio/src/tabs/selection.ts`, `src/canvas/iframe-host.ts`, `src/canvas/iframe-overlay.ts`, `styles/canvas.css`)."
- **Lines 432 and 433** (the two highlight bullets) become three bullets, in the list's existing no-full-stop style:
  - "Selection highlight: a 2px solid `--accent` border around the primary. A stylebook specimen and a layout element also carry a label on the box's top edge (`.overlay-label`) naming the tag or the layout file"
  - "Co-selection highlight: a 1px dashed `--accent` border around each other member of a multi-selection. A selection of one draws none"
  - "Hover highlight: a 1px solid `--accent-50` border, never drawn over the primary"
- **A new paragraph** goes directly after the bullet list, before "**Selection is a list.**": "**A highlight is a box on the host's overlay layer, never a style on the author's element.** The frame is the document and the host does not reach into it, so each box is a positioned element over the iframe, placed from the rect the frame measures and posts back (`src/canvas/iframe-overlay.ts`, `styles/canvas.css`). The boxes draw borders, which Studio's `box-sizing: border-box` keeps inside the node's rect, so a node flush with the frame's edge is not clipped by the layer's `overflow: hidden`. The three differ in width or line style, not in colour alone, so they stay apart for a reader who cannot tell the colours apart; that is why hover is solid, since dashed is how a co-selected member reads. A collaborator's selection is the one box drawn differently: a 1.5px outline in that peer's colour, offset 1px outside the rect and tagged with their name, so it rings the local boxes rather than covering them. In Preview the whole layer is hidden."
- §14 is unchanged. The new paragraph cites no standard, and the WCAG 2.2 row's bound sections stay as they are.
- **Fragment.** `bun run spec:change studio-ui-guidelines.md minor -m "§8.1: the canvas highlights are stated as drawn, borders on boxes over the frame and never styles on the author's element: a 2px solid accent border on the primary, a 1px dashed accent border on each other member of a multi-selection, a 1px solid half-strength accent hover border never drawn over the primary, and a collaborator's selection as an outline in their colour outside the node"`. The level is minor: a reconcile that changes no behaviour an author relies on.

**Docs** (no em dashes):

- **`docs/studio/interface/canvas.md`.** Its `spec:` cites `studio-ui-guidelines.md#8.1`, which is why `bun run docs:sync` names it.
  - Line 48: "Studio outlines it," becomes "Studio draws a solid box around it,". Directly after that sentence, add: "Pointing at an element draws a thinner, fainter box, so you can see what a click would select."
  - Line 52: "Every selected element keeps a box on the canvas, while the block action bar, the Inspector's single-element controls and the status trail address the one you clicked most recently;" becomes "Every selected element keeps a box on the canvas: the one you clicked most recently keeps the solid box, and each of the others gets a thin dashed one. The block action bar, the Inspector's single-element controls and the status trail address the solid one;". The rest of the sentence ("the status bar says **N selected** ...") is unchanged.
  - `code:` gains `packages/studio/src/canvas/iframe-overlay.ts` and `packages/studio/styles/canvas.css`. Each box's look lives in one of those two files, and the page now describes it.
- **No change** to these pages:
  - `docs/studio/design/layers.md` ("On the canvas, every selected element gets a box") is still true.
  - `docs/studio/publish/collaboration.md` ("a peer's colored selection box") is still true.
  - `docs/studio/editing/writing.md` cites §8.3, not §8.1.

No spec graduates. `plans/studio-ui-guidelines/` stays.

## Acceptance

- `bun run plans:status --spec studio-ui-guidelines` no longer lists `studio-ui-guidelines.md#8.1`. `bun run plans:check`, `docs:status`, `docs:spec-release`, `docs:check`, `docs:links`, `docs:prose` and `docs:markdown` pass.
- `sed -n '/^### 8.1/,/^### 8.2/p' specs/studio-ui-guidelines.md` shows `> **Status: Implemented.**` as the first blockquote, and `git grep -n "accent outline" -- specs/studio-ui-guidelines.md` prints nothing.
- The new bullets' figures match the code: `grep -n -A2 '^\.overlay-' packages/studio/styles/canvas.css` shows 2px solid `--accent`, 1px solid `--accent-50` and 1px dashed. `grep -n "outline:1.5px" packages/studio/src/canvas/iframe-overlay.ts` shows the presence outline with `outline-offset:1px`.
- By hand, in Studio's Edit mode, the spec and `canvas.md` describe what is on screen. Click one element, Ctrl/Cmd-click a second and hover a third: the second has the solid 2px box, the first a thin dashed one, and the third a faint 1px solid one. Hovering the second draws nothing extra.
