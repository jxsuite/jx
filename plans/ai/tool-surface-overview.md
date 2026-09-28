---
status: drafted
disposition: reconcile
claims:
  - ai.md#3
requires: []
size: S
---

# The Tool Surface overview says what the tools cover, where each kind lives, and that §3.6's two sources are the list

## Context

`specs/ai.md` §3, line 89:

> **Status: Partial.** The tool schemas and the edit-application path do not live in `packages/ai/src`: `packages/ai/src/tools.ts` holds only the generic registry, `ToolContext` and write ledger, the hand tools are registered in `packages/studio/src/services/ai-*.ts` (§3.6), and their document edits apply through `transactDoc` in `packages/studio/src/tabs/transact.ts`. The tool list this paragraph defers is still not enumerated here, although `AI_TOOL_TIERS` in `packages/studio/src/services/ai-system-prompt.ts` and the command records that declare `aiTool` are that list.

The paragraph under it (line 91) is the whole of §3's own text, and it is the stale part: "The tool schemas and the edit-application path live in `packages/ai/src`. This section is a placeholder; the concrete tool list will be enumerated here once it stabilizes." §3 was unmarked before the census, which added the marker only to carry this item. Its children are built: §3.0 to §3.6 are unmarked and verified in the audit record, §3.7 is `Implemented`. §3.6 already specifies the split correctly (hand tools in Studio gated by `AI_TOOL_TIERS`, command tools as a view over the window's registry, one composite registry), so the overview follows the code. Re-verified on 2026-09-26.

**What ships**

- `packages/ai/src/tools.ts` (`@jxsuite/ai/tools`): `createToolRegistry`, `createToolDefinition`, `toolSuccess`, `toolError`, `createToolContext`, `createLedger`, `createSessionFacts`, `linkCallSignal`. No concrete tool anywhere in `packages/ai/src`.
- 18 hand tools, registered by Studio: `registerAiTools` in `ai-tools.ts` (`read_document`, the seven tree writers, `create_component`, `create_page`), `registerProjectTools` in `ai-project-tools.ts` (`list_files`, `read_file`, `write_file`, `search_files`, `create_project`, `list_starters`), `registerImportTools` in `ai-import-tools.ts` (`import_site`), `registerAskTool` in `ai-ask.ts` (`ask_user`), all under `packages/studio/src/services/`. Their one table is `AI_TOOL_TIERS` (`ai-system-prompt.ts:123`), from which `document-assistant.ts:192` derives the gates.
- 11 command tools: the records declaring `aiTool` (`check_popovers`, `check_accessibility`, `open_document`, `enable_extension`, `disable_extension`, `select_node`, `set_canvas_mode`, `validate_redirects`, `add_project_locale`, `duplicate_node`, `delete_node`), projected by `packages/studio/src/services/ai-command-tools.ts`. The generated Commands reference (`docs/studio/interface/commands.md`, via `packages/studio/src/commands/reference.ts`) prints them in its Assistant column.
- The two lists are already held together: `packages/studio/tests/ai-system-prompt.test.ts:250` ("hand tools are the tier table, projected tools are the declarations, and the two are disjoint") asserts both directions, disjointness and the counts 18 and 11; `CHROME_BUDGET.assistantTools` (`packages/studio/src/commands/budget.ts`, 30) caps their sum in `packages/studio/tests/ai-command-tools.test.ts:923`.
- Edit application: `applyAndValidate` in `ai-tools.ts` runs each tree write through `transactDoc` (`packages/studio/src/tabs/transact.ts`), which puts it on the tab's undo history.
- No docs page anchors `ai.md#3`; `docs/extending/embedding/assistant-harness.md` anchors only `ai.md#3.7`. The one source comment citing §3 as a whole (`document-assistant.ts:7`, "See specs/ai.md §3.") stays true, and nothing cites §3's own paragraph.

**What the harness program will move.** `plan:ai/harness-phase-1#J1.16` moves the document tools' definitions into a new `@jxsuite/ai/jx-tools` export and adds a new ai.md section for them; `plan:ai/harness-phase-1#J1.25` does the same for the project tools; `plan:ai/harness-phase-1#J1.20` edits §3.6 in place. Studio still registers every hand tool after those slices (`registerAiTools` stays as a wrapper), `@jxsuite/ai/tools` still defines no concrete tool, and the new `applyDocOpsAsUser` that the Studio document host calls lands in `tabs/transact.ts`. The rewrite below is worded so each of those statements holds before and after. Two facts §3.6 states today do move, so the rewrite states neither: J1.16 and J1.25 put Studio's hosts in `packages/studio/src/services/harness/` (`studio-documents.ts`, `studio-project.ts`), so which Studio file registers a hand tool may stop matching §3.6's `services/ai-*.ts`; and J1.20 puts a tier on each of the 29 definitions and builds the composite from a catalog, so whether the tiers stay one table (`AI_TOOL_TIERS`) is that slice's call. Each of those slices then edits §3.6 alone.

## Outcome

- ai.md §3 → Implemented: the line-89 marker is deleted, so §3 reads unmarked like §3.0 to §3.6, and the line-91 paragraph is replaced by a scope sentence, a placement paragraph and a pointer to the list.
- No code, test or docs page changes.
- ai.md does not graduate: `plan:ai/harness-phase-1` owns its whole-spec marker and §2.2, and other sections stay open (`bun run plans:status --spec ai`).

## Decisions

- **Open:** enumerate the tools in §3, or point at the sources that already list them. Recommendation: point, and state in prose what the surface covers, because the list already has one source per kind, held to the registries in both directions with counts by `ai-system-prompt.test.ts`; a spec copy would be a third list that no gate checks, every tool added or projected would be a spec release, and the harness program moves rows between packages and adds a facts table over all 29 names, so a copy would churn with each slice. The command side is already published to users by the generated Commands reference; a generated hand-tool page is not part of this plan (it would make it an `implement`), and the user docs describe those capabilities in prose.
- **Decided:** the placement is stated as who registers each kind and which module applies its document edits, and "defines no concrete tool" is scoped to `@jxsuite/ai/tools`, because those are the claims that stay true across the harness moves; where a tool's definition is written is exactly what the moves change, so the text does not say it.
- **Decided:** §3 names neither the hand-tool table nor the files that register the hand tools; it reaches both through §3.6 ("the ones §3.6 gates by tier", "registered by Studio"), not as `AI_TOOL_TIERS` or `services/ai-*.ts` a second time, because `plan:ai/harness-phase-1#J1.20` may replace the table with a tier on each definition and `#J1.25` may register the project tools from `services/harness/`, and a slice that does either then edits §3.6 alone. §3.6 is where the tier contract (tier, blurb, derived gates) is written. The harness plan is active and cannot take an edge, so the wording, not a `requires`, is what keeps §3 true across it.
- **Decided:** the marker is deleted, not rewritten as `Implemented`, because §3 was unmarked before the census and its unmarked siblings §3.0 to §3.6 read as closed the same way. This is the spec-wide rule for ai.md's three census-added markers (§2, §3, §4; `plans/ai/README.md`).
- **Decided:** no `requires`. The rewrite is true against today's tree and after each harness slice listed in Context, so an edge to `plan:ai/harness-phase-1` (active, size L) would hold this item open until that whole program lands for no gain.
- **Decided:** the release is `minor`, the program's level for a `reconcile`, and not `major`: no behaviour an author or a host relies on is redefined, only the description of where things live.

## Implementation

A paper plan: the whole change is the spec edit under Specs & docs, the fragment, and this file's deletion, in one pull request that may be the one that details it once review signs the Open decision off.

1. `specs/ai.md` §3: delete line 89 (the marker) and replace line 91 (the paragraph) with the three paragraphs quoted under Specs & docs. The heading `## 3. Tool Surface` and every subsection are untouched.
2. Run `bun run spec:change ai.md minor -m "…"` with the sentence under Specs & docs.
3. Delete `plans/ai/tool-surface-overview.md`. No other plan names it in `requires` or cites it, and `bun run plans:check` (`citation-unknown`) would name one that did.

If review declines the recommendation and wants the enumeration, the third paragraph becomes a two-column table (tool, kind) under §3 plus a test in `packages/studio` that reads it against `AI_TOOL_TIERS` and the `aiTool` declarations; that reads a file outside the workspace, so it needs an `EXTRA_EDGES` entry in `scripts/ci/affected.ts`, and the plan's disposition becomes `implement` with `workspaces: [packages/studio, scripts]`.

**Integration contract.** Once this lands, ai.md §3 states: `@jxsuite/ai/tools` is the generic layer and defines no concrete tool; Studio registers the hand tools and applies their document edits through `packages/studio/src/tabs/transact.ts`; command tools are projected records; the list is the hand tools §3.6 gates by tier plus the `aiTool` declarations, held together by `packages/studio/tests/ai-system-prompt.test.ts`. A later change that moves hand-tool definitions into another `@jxsuite/ai` subpath adds a clause to the placement paragraph saying where those definitions come from, and nothing in it becomes false by the move. A change that renames or replaces the hand-tool table, or moves where Studio registers a hand tool, edits §3.6 only. A change that moves or renames the parity test edits the file name in §3's third paragraph.

## Tests

No workspace suite changes and none needs to run for this plan: no source, test or fixture is touched, so no per-file coverage figure or `coverageThreshold` moves and the manifest check is unaffected.

The gates that prove it, all run by the `checks` job:

- `bun run docs:status`: §3 carries no marker, and the ai.md header stays `Partial` with its remaining open items.
- `bun run plans:check`: no `claim-not-open` (this file is deleted with the marker) and no `unclaimed-open` for ai.md.
- `bun run docs:spec-release`: the §3 body change is covered by the fragment.
- `bun run docs:check` and `bun run docs:links`: no anchor or link moves (the heading and its number are unchanged, and the new text adds no link).
- `bun run docs:markdown`: the edit is one paragraph per line with no escaped heading.

## Specs & docs

**ai.md**, in place. Delete the line-89 marker. Replace the line-91 paragraph with these three paragraphs, one line each:

> The assistant works a Jx project through tools. It reads and edits the open document, its element tree and its state, with each edit rendered live on the canvas and reachable by undo (§3.2); it lists, reads, searches and writes project files, and creates pages and components; it creates or imports a project when none is open (§3.5); it puts a question to the author (§3.4); and it runs the Studio commands that declare themselves tools (§3.6).
>
> **Where a tool lives follows who wrote it (§3.6).** `@jxsuite/ai/tools` is the generic layer: the registry, the `ToolDefinition` shape, `ToolContext` and the turn's write ledger (§3.7). It defines no concrete tool. The hand tools are registered by Studio, and their document edits apply through Studio's transaction path (`packages/studio/src/tabs/transact.ts`), which is what puts each one on the tab's undo history. The command tools are Studio's command records, projected from the window's registry.
>
> **The list is what §3.6 names, not this section.** The hand tools are the ones §3.6 gates by tier, and the command tools are the records that declare `aiTool` (`studio.md` §13.1). `packages/studio/tests/ai-system-prompt.test.ts` holds each to what is registered, in both directions, and the two name sets disjoint, so a copy here would be a third list that nothing holds to the other two.

Fragment: `bun run spec:change ai.md minor -m "§3: the overview says what the tools cover, that @jxsuite/ai/tools is the generic layer with no concrete tool, that Studio registers the hand tools and applies their edits through its transaction path, and that the list is the two sources §3.6 names."`

Docs: none changes. No page's `spec:` cites `ai.md#3` and the plan changes no file any page's `code:` lists. `docs/studio/ai.md` already points users at the Commands reference's Assistant column, and `docs/studio/ai/document-assistant.md` describes the tree tools in prose, both of which stay true.

The spec does not graduate (see Outcome), so there is no `spec:bump` and `plans/ai/` stays.

## Acceptance

- `grep -n "placeholder\|live in \`packages/ai/src\`" specs/ai.md` prints nothing.
- `sed -n '/^## 3. Tool Surface/,/^### 3.0/p' specs/ai.md` shows the heading, no `> **Status:` line, and the three paragraphs above.
- `bun run plans:status --spec ai` no longer lists §3 as open; `bun run plans:status --who-claims ai.md#3` names no plan.
- `ls specs/changes/ai-*.md` includes the new fragment, and `bun run spec:release --dry` shows it minting an ai.md minor.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:markdown` pass.
- The facts the text asserts still hold: `grep -c 'name: "' packages/ai/src/tools.ts` prints `0` (`@jxsuite/ai/tools` defines no concrete tool; scoped to that file because a harness slice may add another subpath that does), and `grep -n "hand tools are the tier table" packages/studio/tests/ai-system-prompt.test.ts` finds the parity test.
