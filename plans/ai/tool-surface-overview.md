---
status: stub
disposition: reconcile
claims:
  - ai.md#3
size: S
---

# The Tool Surface overview says where the tools live and which table lists them

## Context

`specs/ai.md` §3, line 89:

> **Status: Partial.** The tool schemas and the edit-application path do not live in `packages/ai/src`: `packages/ai/src/tools.ts` holds only the generic registry, `ToolContext` and write ledger, the hand tools are registered in `packages/studio/src/services/ai-*.ts` (§3.6), and their document edits apply through `transactDoc` in `packages/studio/src/tabs/transact.ts`. The tool list this paragraph defers is still not enumerated here, although `AI_TOOL_TIERS` in `packages/studio/src/services/ai-system-prompt.ts` and the command records that declare `aiTool` are that list.

The census found §3's own paragraph divergent: it still says "The tool schemas and the edit-application path live in `packages/ai/src`" and calls itself "a placeholder; the concrete tool list will be enumerated here once it stabilizes". Its children (§3.0 to §3.7) are built and stay unmarked or Implemented. The one paragraph is one piece of work, so the placement claim and the deferred list share this stub.

Disposition `reconcile`: the split is deliberate and §3.6 already specifies it correctly (hand tools in Studio, command tools as a view over the window's registry, the composite registry the loop sees), so the overview follows the code rather than the other way round.

**What exists**

- `packages/ai/src/tools.ts`: `createToolRegistry`, `createToolDefinition`, `createToolContext`, `createLedger`, `createSessionFacts`, `linkCallSignal`; no concrete tool.
- Hand tools: `packages/studio/src/services/ai-tools.ts` (`read_document` and the tree writers), `ai-project-tools.ts`, `ai-import-tools.ts`, `ai-ask.ts`; the tier table `AI_TOOL_TIERS` in `ai-system-prompt.ts`, from which `document-assistant.ts` derives the gates.
- Command tools: `packages/studio/src/services/ai-command-tools.ts` (`advertisedCommandTools`, `composeToolRegistries`); the generated Commands reference page already lists them in its Assistant column.
- Edit application: `transactDoc` in `packages/studio/src/tabs/transact.ts`, which puts every document write on the tab's undo history.

**What is missing**

- §3's paragraph rewritten in place to name the split: the generic registry and `ToolContext` in `@jxsuite/ai/tools` (§3.7), the hand tools and the host's edit path in Studio (§3.6).
- The "placeholder" sentence replaced by a pointer to the list that exists (`AI_TOOL_TIERS` for hand tools, the command records for the rest), or by the enumeration itself if the detail phase judges a spec-side list worth keeping in step.
- The rewritten paragraph must stay true across the harness work: `plan:ai/harness-phase-1` slice J1.16 moves the portable document tools into a new `@jxsuite/ai/jx-tools` export and adds a §3.9 for them, so the placement sentence either lands after that slice or is worded so the move edits it in place.

**Related**

- §3.6 and §3.7 (the two kinds of tool, and `ToolContext`); `studio.md` §13.1 (command records that declare `aiTool`); `docs/studio/ai.md` and the generated Commands reference page.
