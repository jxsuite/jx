---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#3.1
  - studio-ui-guidelines.md#3.2
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: S
---

# Layout draws the shell frame each workspace chooses: four tracks, three docks, and a three-tab Inspector

## Context

This plan began as a `reconcile`: §3.1 drew a five-column, six-row shell (a full-width tab-strip row, a 48px activity bar, an Assistant column with `--panel-w-chat: 320px`) and §3.2 said both side panels shared one anatomy, where the code ships four rows, a 56px labelled rail, the strip inside each pane cell, the Assistant as an Inspector tab and three dock anatomies. That reconcile is done: the workspace redesign (studio.md §22) rewrote both sections in place with this plan's drafted text, adapted to the target frame, and the census evidence it rested on (`styles/shell-frame.json`'s `#app` track lists, `DOCK_DEFAULTS` and `applyDockLayout()` in `src/shell.ts`, the cells of `src/surfaces/shell.json`, the three dock documents) is quoted in the new markers.

What remains open is what the redesign adds, and the new markers say so:

> §3.1 **Status: Partial.** … Two parts do not ship as drawn: the Navigator and the Inspector are hidden by collapsing their docks on entry, which writes the dock record's `collapsed` rather than setting a class that leaves the record alone (their widths are kept); and Content draws no Navigator, because its Collections panel does not exist yet (`studio.md` §22.5).

The rail's `rail-hidden` class and the three-tab Inspector have shipped; what is left of §3.1 is the side docks' class and Content's Navigator.

> §3.2 **Status: Partial.** … Two parts do not: the Inspector's strip is four tabs with no Element tab and no sub-switch (`studio.md` §6), and the Navigator's panel is chosen from the rail in every workspace rather than by the workspace's frame outside Design (`studio.md` §22.3).

Both were built by the workspace redesign (studio.md §22.3, the frames, and §22.4, Design), which has landed. This plan owns the two guideline anchors because a plan lives under one spec; what it still closes is the side docks' class and the guideline text that follows from it.

## Outcome

- `studio-ui-guidelines.md` §3.1 → Implemented when the frame slice hides docks per workspace by an `#app` class and the Design slice ships the three-tab Inspector.
- `studio-ui-guidelines.md` §3.2 → Implemented with the Design slice.
- `docs/studio/interface.md` stops saying the docks are remembered per project.
- The spec stays Partial, so nothing graduates.

## Decisions

- **Decided:** keep the anchors here rather than move them into the workspace redesign's plan, because that plan claimed studio.md only and a plan claiming two specs belongs in `plans/_shared/`; the code is that plan's, and this one is the guideline's checklist.
- **Decided:** a workspace hides a dock with a class on `#app` that zeroes the dock's variable and leaves the dock record untouched, because the record is the author's and the workspace's choice is applied on every entry.
- **Decided:** the Element tab's Content · Style · Logic switch is a control inside the tab's body, not a second `jx-tabs` strip, and §12.2 says it is not counted as dock tabs.
- **Decided:** no frame gate in this plan. The census's open question (a `guidelineFrameFindings()` check in `packages/studio/scripts/check-styles.ts` holding §3.1's quoted track lists to `#app`) is withdrawn from this plan's scope: the redesign changes no track, and a gate is its own change with its own tests.

## Implementation

1. With the frame slice: `applyDockLayout()` in `packages/studio/src/shell.ts` sets the workspace's hide classes on `#app`, and `styles/shell-frame.json` gains their rules (regenerated with `bun run styles:sync`, never hand-edited). The dock record is not written by a workspace entry.
2. With the Design slice: `src/surfaces/inspector-dock.json` draws three tabs, and the Element tab's body draws its sub-switch.
3. `docs/studio/interface.md`, the `:::doc-note` under "Inspector": "Studio remembers your layout: dock widths and which docks are collapsed carry over to your next session, per project." becomes "Studio remembers your docks: their widths and which ones are collapsed carry over to your next session, whichever project you open. Each workspace still chooses which docks it shows." (unless the workspace docs already say it).

## Tests

Covered by the workspace plan's suites: the frame cases in `shell-workspace.test.ts` (a workspace entry hides and restores docks without changing the stored record) and the Inspector cases in `right-panel*.test.ts` (three tabs, the sub-switch, `view.setRightTab { tab: "style" }`). `bun --cwd packages/studio run lint:styles` and `styles:check` pass after `styles:sync`.

## Specs & docs

- §3.1 and §3.2: delete the second half of each marker (the "does not" sentences) and set each to `> **Status: Implemented.**` with its evidence paths, in place.
- Fragment: `bun run spec:change studio-ui-guidelines.md minor -m "§3.1 and §3.2: each workspace's frame hides docks by an #app class without touching the dock record, and the Inspector dock is three tabs with the Element tab's sub-switch inside its body"`.
- Docs: the `interface.md` note above; no em dashes.

## Acceptance

- `bun run plans:status --spec studio-ui-guidelines` lists neither `#3.1` nor `#3.2`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:prose` pass.
- In Studio: switching to Media hides the rail, Navigator and Inspector; switching back to Design shows them at the widths they had.
