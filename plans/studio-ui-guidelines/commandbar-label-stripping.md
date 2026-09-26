---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#12.2
size: S
workspaces:
  - packages/studio
---

# The Command Bar keeps its labels at every width, and crowding is answered by the budget rather than by hiding text

## Context

`specs/studio-ui-guidelines.md` §12.2, line 783:

> **Status: Partial.** The caps ship in `packages/studio/src/commands/budget.ts`, checked by `scripts/check-chrome-budget.ts` and, for the assistant, by `tests/ai-command-tools.test.ts`. The label stripping this section forbids still ships: `src/surfaces/commandbar.json` hides every primary button's label under `@container toolbar (max-width: 1140px)`.

**What exists**

- `packages/studio/src/commands/budget.ts`: `CHROME_BUDGET` (`commandbarPrimary` 5, `dockTabs` 4, `assistantTools` 30, `blockbarFormat` 8). Its header cites the 1140px container query as the counter-example the cap exists to answer.
- `scripts/check-chrome-budget.ts` (joins the rail declarations; runs in the `checks` job) and the assistant cap asserted in `packages/studio/tests/ai-command-tools.test.ts`.
- `packages/studio/src/surfaces/commandbar.json`: under `@container toolbar (max-width: 1140px)`, `[part="primary"] [part="text"]` and every primary `jx-button`'s `[part="label"]` are `display: none`.

**What is missing**

- The container query's label-hiding rules removed, so every primary button keeps its visible label (and, per §12.3, its title as the accessible name).
- A narrow-width answer that the section allows: fewer primary rows moving to `commandbar/overflow` below a breakpoint, or the bar wrapping, decided in detailing and checked in a real browser at the narrowest window the app allows, as §4.6 asks of a layout change.
- The screenshot lane re-captures any shot taken at a width under 1140px; the pull request re-reads the pages it lists.

**Related**

- `studio.md` §13 (command registry) and `studio-ui-guidelines.md` §12.3 (the name on every invoking surface).
- The shot contract (`scripts/screenshots/README.md`), for the re-capture.
