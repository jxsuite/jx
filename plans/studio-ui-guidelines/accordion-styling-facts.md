---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#5.2
size: S
---

# Accordion styling states what the kit's accordion draws

## Context

`specs/studio-ui-guidelines.md` §5.2, line 339:

> **Status: Partial.** The part-keyed style block ships. Both facts beside it are stale: `jx-accordion` draws a 1px `--jx-border` rule between items (`packages/ui/components/jx-accordion.json`), and `jx-accordion-item`'s header text is `--jx-text-md`, which is why `packages/studio/src/surfaces/panel-signals.json` sets `border: none` and re-declares `--jx-text-md` to reach 11px.

Disposition `reconcile`: the kit owns its elements' look (`ui.md` §5.4), and a surface adjusting it through its own part-keyed style block is exactly the rule this section states. Only the two factual clauses are wrong. The header size may still change if `plan:studio-ui-guidelines/chrome-type-scale` adopts compact density, in which case the header draws at 11px through `--jx-text-md` and `panel-signals.json`'s override goes; the sentence then names the token, not a size.

**What exists**

- `packages/ui/components/jx-accordion.json`: `borderBlockStart: 1px solid var(--jx-border)` between items; the element observes only `multiple`.
- `packages/ui/components/jx-accordion-item.json`: the header at `--jx-text-md`.
- `packages/studio/src/surfaces/panel-signals.json`: `border: none` on `part=categories` and `--jx-text-md: var(--jx-text-sm)` on `part=category`.

**What is missing**

- §5.2's first sentence rewritten: the kit draws a rule between items and a surface that does not want it removes it in its own style block, and the header text is `--jx-text-md`.
- §5.1's example drops `size: "sm"`, which `jx-accordion` does not observe (an editorial nit in a built section, carried here because it is the same element's contract).

**Related**

- `ui.md` §5.4 (the accordion elements; §5.1 of this spec cites them as §5.3, which is stale).
- `studio-ui-guidelines.md` §2.2 (type scale), owned by `plan:studio-ui-guidelines/chrome-type-scale`.
