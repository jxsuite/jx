# Plans

A plan is the design and the checklist for closing something a spec admits is not built. Plans are **transient**: each one is deleted in the pull request that lands it, and git history (`git log --diff-filter=D -- plans/`) is where a landed plan's reasoning lives afterwards. The specs stay the source of truth throughout; a plan is how an open item in a spec gets from `Partial` or `Pending` to `Implemented`, `Future` or `Removed`.

The program this directory exists for: walk every draft spec, plan every open item, execute the plans in dependency order, and graduate each spec to `Implemented` so the initial implementation of Jx can be called complete. `bun run plans:check` keeps the plans honest; `bun run plans:status` shows where the program stands.

## Layout and IDs

```text
plans/README.md                  this contract, and the only plans/ path a permanent file may cite
plans/<spec-stem>/README.md      the audit record for specs/<spec-stem>.md; it existing is what "audited" means
plans/<spec-stem>/<slug>.md      one plan; its ID is <spec-stem>/<slug>
plans/_shared/<slug>.md          a plan that claims items in two or more specs, or enables plans in two or more
```

- A plan's **ID is its path** without `plans/` and `.md`: `plans/compiler/csp-emission.md` is `compiler/csp-emission`. There is no `id` field, so the ID cannot drift from the file.
- A plan's **title is its one H1.** There is no `title` field, for the same reason.
- Slugs are lowercase kebab-case. `<spec-stem>` names an existing `specs/<spec-stem>.md`.
- Inside `plans/`, cite a plan as `` `plan:compiler/csp-emission` `` and one of its slices as `` `plan:ai/harness-phase-1#J1.24` ``. The prefix mirrors `gap:` and is what makes a citation searchable.

## Frontmatter

```yaml
---
status: drafted # stub | drafted | ready | active
disposition: implement # implement | reconcile | defer | remove
claims: # the spec items this plan closes; the docs `spec:` grammar
  - compiler.md#3
requires: # plans that must land first; one entry per line
  - spec/csp-hash-sources
gaps: # gap: ids (without the prefix) this plan closes
  - ui-aria
workspaces: # the directories it changes
  - packages/compiler
size: M # S | M | L; anything bigger is split
prs: # every pull request that carried a slice of it
  - jxsuite/jx#400
---
```

| Field         | Required                     | Rule                                                                                                                                                |
| ------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`      | yes                          | See the lifecycle below. There is no `done`: a landed plan is deleted.                                                                              |
| `disposition` | yes                          | What happens to the claimed items. See below.                                                                                                       |
| `claims`      | yes (may be `[]`)            | `<spec>.md#<anchor>` for a section, bare `<spec>.md` for a whole-spec marker above §1. No `specs/` prefix, no `§`. Each item has exactly one owner. |
| `requires`    | no                           | Plan IDs. Written in **one direction only**, by the dependent; the reverse edges are derived.                                                       |
| `gaps`        | no                           | `gap:` ids from a Standards Alignment row that this plan closes.                                                                                    |
| `workspaces`  | past `stub`, for `implement` | Existing directories, so a plan's CI cost is visible before it starts.                                                                              |
| `size`        | yes                          | `S`, `M` or `L`. An `L` plan past `stub` requires a `## Slices` table.                                                                              |
| `prs`         | once `active`                | `owner/repo#N` for every pull request that carried a slice.                                                                                         |

## Lifecycle

| Status    | Means                                                                     | Required                                                                     |
| --------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `stub`    | The census found the item and wrote down what exists and what is missing. | Frontmatter, the H1, and `## Context` quoting the marker with code evidence. |
| `drafted` | The design is written; decisions may still be open.                       | Every template heading. `- **Open:** …` items are allowed in `## Decisions`. |
| `ready`   | Signed off in review.                                                     | No `**Open:**` item, and every `requires` target is `ready` or `active`.     |
| `active`  | A multi-slice plan with work merged or in review.                         | `requires: []`, a non-empty `prs`, and a `## Slices` table.                  |

A single-pull-request plan goes from `ready` straight to deleted. **Landing a plan** means the pull request that closes its last claim also deletes the file and removes its ID from every dependent's `requires`. The gate refuses a dangling edge, and that refusal is the point: it makes whoever lands a prerequisite re-read the plans that assumed it.

### Dispositions

| Disposition | The claimed items end as                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `implement` | `Implemented`: the code is built.                                                                                                              |
| `reconcile` | `Implemented`: the code is right and the spec was wrong, so the spec text is rewritten to what ships.                                          |
| `defer`     | An `Implemented` part plus a `> **Status: Future.**` remainder (the `spec.md` §6.6 shape). Future is not open, so a spec can graduate with it. |
| `remove`    | `Removed`, with a sentence saying why. The numbered heading stays.                                                                             |

`reconcile`, `defer` and `remove` are paper plans: they may land in the same pull request that details them, once review signs them off.

## The template

```markdown
---
(frontmatter)
---

# The title, as a sentence about the outcome

## Context

What the spec says (quote the marker and its line), what the code does today (paths), and what is missing.

## Outcome

The end state per claim: "§5 → Implemented; modal stacking → Future".

## Decisions

- **Decided:** … because …
- **Open:** … (allowed only while drafted)

## Implementation

Files, the existing functions and modules to reuse, and an integration contract for the plans that require this one: what they may rely on once it lands.

## Tests

Which suites, which new cases, and the coverage ratchet for every touched workspace.

## Specs & docs

The exact in-place spec edits, the marker change, the fragment (`bun run spec:change <spec> <level> -m "…"`, with no raw angle-bracket tags in the sentence), and the docs pages `bun run docs:sync` names. This is the step AGENTS.md requires of every plan.

## Acceptance

Checks a reviewer can run that prove the claims are closed.

## Slices

| Slice | Scope | Claims | State |
| ----- | ----- | ------ | ----- |
| CS1.1 | …     | …      | open  |
```

A stub needs only the H1 and `## Context`. A slice id is an uppercase-led prefix, a dot and a number (`J1.4`, `CS1.1`), unique across all plans, because the gate searches the repository for every declared slice id.

## What a plan claims

An open item is anything `openItems()` in `scripts/docs/lib/spec-status.ts` reads as Partial or Pending: a section's leading marker, a later marker in the same section, a second status on a marker line, a table cell that opens with a bold status word, or a whole-spec marker above §1. `specs/README.md` ("What counts as an open item") is the contract for those forms.

- In an **audited** spec, every open item is claimed by exactly one plan (`unclaimed-open`), and a section whose open part sits under a later marker or a cell must lead with the open status (`marker-leading`), because the first marker is what the implementation-status page and the standards tiers read.
- A claim on anything that is not open fails (`claim-not-open`). When that is the plan's last claim, the message tells you to delete the plan.
- A plan lives under the spec it claims from. A plan claiming items in two specs lives in `_shared/`.

## Prerequisites and granularity

- `requires` names **plans, never spec sections.** A section edge would satisfy itself silently the moment its marker flipped; a plan edge goes dangling and forces the dependent to be edited.
- One owner per item. If two plans would each do half of one item, the first becomes an enabling plan that claims nothing and the owner requires it.
- **Split** a plan when a dependent needs only part of it, when its parts have different dispositions, when they touch disjoint workspaces with no shared decision, or when it would exceed `L`.
- **Merge** plans that would form a cycle, or that always land together.

## Citations: why nothing permanent names a plan

Specs, code, tests, scripts, workflows and spec fragments cite **spec sections**, never a plan ID and never a slice id. `packages/studio/UX-REDESIGN-PLAN.md` was deleted while 28 tracked files still named it, and roughly 170 comments in Studio still say "plan §5.3" about a document nobody can open. So while a plan exists, `plan:` tokens and its slice ids may appear only under `plans/`, which means deleting it can never leave a dangling reference.

- Exempt: this file, and `CHANGELOG.md` files, which release-please writes from commit subjects.
- Put plan IDs in pull request descriptions and commit **bodies**, not subjects.
- Specs never link to plans. A plan is how a spec's open item closes, not part of the contract, and a backlink would make every plan edit a spec release.
- A `*-PLAN.md` file anywhere, or anything under `.claude/plans/`, is refused: plan documents live here, where the gate can see them.

## The audit record

`plans/<spec-stem>/README.md` has no frontmatter and holds only what cannot be derived:

```markdown
# <spec> audit

Audited against <commit> on <date>.

## Verified

The unmarked sections checked against the code, with the evidence path for each.

## Dispositioned without a plan

Stale cells corrected, a roadmap retired, a Subset gap kept as the intended end state.

## Spec-wide decisions

Decisions that bind several of this spec's plans.
```

The map from open items to plans is **not** written here: `bun run plans:status --spec <stem>` derives it. The record is deleted when the spec graduates.

## The program

**Census** (breadth-first, before any detailing, so that every plan ID exists and `requires` can point in any direction). For each spec:

1. Read it end to end against the code. A roadmap row or a status cell may be months stale; verify, do not copy.
2. Correct the markers until `marker-leading` passes. Give every unbuilt part of an unmarked spec a leading Partial or Pending marker.
3. Retire in-spec roadmaps: move each open item onto its feature section's marker, then mark a numbered roadmap section `Removed` (its heading stays) or delete an unnumbered one.
4. Write the audit record and one `stub` per open item.
5. Remove the spec from `UNAUDITED` in `scripts/docs/check-plans.ts`, and release the marker edits as a `patch` fragment.

A spec that proves to have no open item graduates in its census pull request, because `graduation-ready` is an error.

**Detail** (consecutively, one pull request per spec, in the order below). Take each stub to `drafted`; review signs off the decisions; the plans move to `ready`. Paper dispositions may land in the same pull request.

**Execute** (from `bun run plans:status`'s ready queue, in topological order). Each pull request lands the code, tests and docs, the marker flip with its fragment, the plan's deletion or its slice row update, and the removal of its edges from every dependent after re-checking their integration contracts.

**Graduate** (in the pull request that closes a spec's last open item): set `**Status:** Implemented`, run `bun run spec:bump <spec> patch -m "…"` **in place** (a fragment would leave `-draft` on an Implemented header until the release branch mints it, and `docs:status` refuses that), and delete `plans/<spec-stem>/`.

### Provisional detailing order

Re-derive it after each detailing pull request with `bun run plans:status`, which orders specs by the `requires` edges between their plans.

| #   | Spec                                                            | Why here                                                                                          |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 0   | collab                                                          | The pilot: two items and no dependents, so it shakes out the template.                            |
| 1   | spec                                                            | The core format, cited by ten specs.                                                              |
| 2   | schema, extensions, relationships, imports, parser, jx-markdown | Only those still draft after the census. extensions is cited nineteen times by site-architecture. |
| 3   | compiler                                                        | Cites spec and extensions.                                                                        |
| 4   | site-architecture                                               | Cites extensions and spec.                                                                        |
| 5   | ai                                                              | `plan:ai/harness-phase-1` covers most of it.                                                      |
| 6   | ui and studio-ui-guidelines                                     | One pull request: they cite each other throughout and share accessibility gaps.                   |
| 7   | studio                                                          | Cites studio-ui-guidelines, site-architecture and ui.                                             |
| 8   | desktop                                                         | Cites studio and server.                                                                          |
| 9   | standards                                                       | Only if still draft.                                                                              |

### Release levels for the program's spec edits

| Change                                            | Level                                                  | Form                         |
| ------------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| Marker corrections, roadmap retirement, a `defer` | patch                                                  | fragment                     |
| An `implement`                                    | minor                                                  | fragment                     |
| A `reconcile`                                     | minor; major if it redefines behaviour authors rely on | fragment                     |
| A `remove`                                        | major if it was ever documented as working, else patch | fragment                     |
| Graduation                                        | patch, or minor when it rides on the last execution    | `spec:bump` in place, always |

## Commands

```sh
bun run plans:check                     # the gate (CI runs it in the checks job)
bun run plans:check --audit compiler    # preview a census: judge one spec as audited, report only it
bun run plans:status                    # per-spec readiness, the ready queue, topological waves, the spec order
bun run plans:status --spec compiler    # one spec: its open items and who claims each
bun run plans:status --who-claims compiler.md#3
bun run plans:status --mermaid          # the requires graph, for a pull request description
git log --diff-filter=D --stat -- plans/   # the plans that have landed
```
