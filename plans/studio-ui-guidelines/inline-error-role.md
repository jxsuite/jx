---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#13.2
size: S
---

# An inline error announces the way the rendering rules say it does

## Context

`specs/studio-ui-guidelines.md` §13.2, line 901:

> **Status: Partial.** The toast stack, the rest times, the recovery button and the Problem rows ship (`packages/studio/src/services/notify.ts`, `src/panels/problems-panel.ts`). The inline-error rule does not hold for the kit field: a refusal drawn through `jx-textfield`'s `error` lands in its `[part="error"]` region, which is `role="status"` with `aria-live="polite"` (`packages/ui/components/jx-textfield.json`), and that is how the prompt dialog, Repeat… and the Locales settings refuse a value (`packages/studio/src/surfaces/dialog.json`, `convert-repeater.json`, `settings-locales.json`). Only hand-drawn messages carry `role="alert"`.

§13.2's bullet: "An inline error renders after the control, with `role="alert"`, and takes precedence over a warning state on the same row." The kit field that most inline refusals now go through draws its error in a permanent polite status region instead, and `ui.md` §5.1 gives the reason: the region exists before the first refusal, so that refusal is announced rather than only a later one.

Disposition `reconcile`, provisionally. `ui.md` already specifies the kit field's region and why it is permanent, and an assertive alert on a field that re-validates as the reader types would interrupt every keystroke. The alternative is `implement`: the kit's `[part="error"]` becomes `role="alert"`, which is a `ui.md` change and belongs in the same detailing pull request as `ui.md`'s own plans.

**What exists**

- `packages/ui/components/jx-textfield.json`: `p[part="error"]` with `role="status"` and `aria-live="polite"`, named in the control's `aria-describedby`.
- Studio surfaces that refuse a value through it: the prompt dialog's field (`packages/studio/src/surfaces/dialog.json`, the `showPromptDialog` flow §8.7 describes), Repeat… (`convert-repeater.json`) and the Locales settings (`settings-locales.json`, `refusal`).
- Hand-drawn inline messages that do carry `role="alert"`: `expression-editor.json`, `git-panel.json`, `grid-panel.json`, `new-project.json`, `panel-signals.json` and `ai-chat.json`.
- The assertive channel for errors that are records rather than refusals: `packages/studio/src/services/announce.ts` (§13.1a).

**What is missing**

- A decision between the two: §13.2 says an inline refusal is announced through the field's own permanent polite region (and a hand-drawn one uses the same politeness, or states why it is assertive), or the kit field's error region becomes an alert.
- Whichever is chosen, the hand-drawn `role="alert"` messages made consistent with it, or the difference between them and a field's refusal stated.
- The rest of the bullet ("takes precedence over a warning state on the same row", "counts them from two up") verified against the rows that can carry both, which the census did not reach.

**Related**

- `ui.md` §5.1 (`jx-textfield`'s error region).
- `studio-ui-guidelines.md` §13.1a (the two live regions) and §8.7 (`showPromptDialog`'s `validate`).
