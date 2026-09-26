# schema.md audit

Audited against b900b326 on 2026-09-26.

## Verified

- §2 (the export table, the `doc-ops` and `json-layout` subpaths): packages/schema/src/schema.ts, packages/schema/src/doc-ops.ts, packages/schema/src/json-layout.ts, packages/collab/src/ops.ts (the re-export), packages/schema/tests/doc-ops.test.ts, packages/schema/tests/json-layout.test.ts. The table names seven exports of many; it does not claim to be exhaustive.
- §3.1's five `state` shape cells stay **Implemented**: packages/schema/defs/state-entry.schema.ts, typed-state-def.schema.ts, function-def.schema.ts, external-class-def.schema.ts. The Computed row's Schema Definition cell is wrong and sits in the §3.1 marker.
- §3.3 (class schema): packages/schema/src/schema.ts (`generateClassSchema`), packages/schema/defs/class-def.schema.ts, packages/schema/tests/class-schema-drift.test.ts. The prose role list omits `rewrite`, `head` and `assets`; the enum carries them and the drift test holds the lockstep contract, so that is editorial and rides with `plan:schema/generator-inventory`.
- §5 (the three `$id`s and the 2020-12 `$schema`): packages/schema/src/schema.ts, packages/schema/tests/schema.test.ts, the committed packages/schema/project-schema.json and class-schema.json.
- Informative: §1 (overview), §3 (parent of §3.1 to §3.5), §6 (dependencies; omits `ajv` and `ajv-formats`), §7 (Standards Alignment; `**Adopted**` and `**Subset**` are conformance classes). Five notes overstate the code: WHATWG HTML (no DOM property set, no `tagName` enumeration), RFC 7493 (exponent-form integers are never judged), UAX #31 and RFC 7493 again (readers that bypass `parse.ts`), BCP 47 (a padded tag builds and fails the pattern) and RFC 9110 (the compiler keeps its own status table). Each binds a section now marked Partial, so its tier follows that marker, and the plan that closes the marker either corrects the note or makes it true.

## Dispositioned without a plan

- The whole-spec header stays `Partial`; there is no preamble marker, so it is not an item of its own. No roadmap, status ledger or stale status cell.
- Every marker this census changed (§3.2, §3.4 and §3.5 from Implemented to Partial; §3.1 and §4 newly led with Partial) leaves its section open, so each correction is recorded in the owning stub's `## Context`, which quotes the new marker and says what the section read before. Nothing in schema.md was closed without a plan.

## Spec-wide decisions

- **A marker whose remainder is mostly a text `reconcile` but partly code keeps one owner, and the code goes to a claim-less `implement` plan that the owner requires.** §3.1 and §3.2 are both shaped that way: the owner rewrites the section to what ships and drops the marker's code sentences once its prerequisites land, and the prerequisites carry the workspaces and the tests.
