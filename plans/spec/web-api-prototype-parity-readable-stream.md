---
status: drafted
disposition: remove
claims: []
requires: []
workspaces:
  - packages/runtime
  - packages/schema
  - examples
  - packages/starters
  - packages/studio
  - packages/ui
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
size: S
---

# `ReadableStream` stops being a built-in prototype, so every built-in name resolves to a value

## Context

This plan claims nothing. It was item 1 of `plan:spec/web-api-prototype-parity`, which owns spec.md §11.2 and requires this plan. It was split out for three reasons:

- its recommended disposition (remove) differs from that plan's (implement);
- it touches `packages/runtime` and `packages/schema`, where that plan's code is in `packages/compiler`;
- it needs none of that plan's prerequisites, so it can land first.

`specs/spec.md` §11.2 has two open parts that this plan settles:

- the marker's first clause (line 1192): "The interpreter's `resolvePrototype` handles every Web API row but `ReadableStream`, whose case returns `null`";
- the row (line 1207): ``| `ReadableStream`  | Streams API  | **Pending** — stub returns `null` |``.

**What exists** (re-verified):

- `resolvePrototype` in `packages/runtime/src/runtime.ts`, `case "ReadableStream": { return null; }` (line 3008). The runtime test "ReadableStream: returns null" (`packages/runtime/tests/runtime.test.ts:1154`) pins it.
- `BUILT_IN_PROTOTYPES` (line 14) and `ExternalClassDef`'s `$prototype.examples` (line 41) in `packages/schema/defs/external-class-def.schema.ts` list the name. The second list is in `packages/schema/schema.json` and all 28 committed `document.schema.json` files. `BUILT_IN_PROTOTYPES` has no consumer yet; `plan:compiler/client-external-class-hydration` makes it the external-class test.
- The name appears in three other places:
  - `specs/schema.md` §3.1: "All 13 built-in prototypes" and the line `` `ReadableStream` — (stub) ``;
  - spec.md §12.1's marker: "… `Blob` and `ReadableStream` (§11.2) are missing from the table";
  - `packages/schema/README.md` (line 59), which ships to npm.
- Nothing authors or documents it:
  - Studio's `DEF_TEMPLATES` (`packages/studio/src/panels/signals-panel.ts`) has no stream source;
  - no `docs/` page names it;
  - no tracked document carries `"$prototype": "ReadableStream"`.

**Why a contract is hard to write.** The census asked detailing to write the contract first, covering what the entry holds, its source and its cancellation. Every answer runs into one of three problems:

- A `ReadableStream` can be read once, by one locked reader, so the stream itself cannot be the value of an entry that any number of bindings read.
- Its accumulated chunks are a text value, and the only source a JSON document can name for them is a fetched body. That is `Request`'s territory, and the cancellation would be `Request`'s abort.
- `$src` on a non-`Function` prototype already means "an external class" (§12.2).

So a streamed body is a `Request` option, not a prototype of its own.

## Outcome

- **No claim changes state.** spec.md §11.2 stays Partial and stays `plan:spec/web-api-prototype-parity`'s.
- **spec.md §11.2.** The marker no longer names `ReadableStream`, and its row reads `**Removed**` with the reason. The row is not open, so it no longer blocks §11.2's flip.
- **`BUILT_IN_PROTOTYPES`** lists twelve names. The runtime resolves every one of them, apart from `Function` and `Array`, to a value, and a test holds that. A `$prototype: "ReadableStream"` entry resolves as any unknown name does: one console warning and `null`.
- **schema.md §3.1, spec.md §12.1's marker and the schema README** no longer list the name.

## Decisions

- **Open:** remove `ReadableStream`, defer it, or implement it? Recommendation: remove it, for the reasons under Context. It was never documented as working, so the removal is a patch. The alternatives:
  - **Defer.** The cell reads **Future**, naming a streamed response body to be specified with `Request`. The runtime case warns once and returns `null`, and the name stays in `BUILT_IN_PROTOTYPES` and the schema, so nothing regenerates. §11.2 can still graduate.
  - **Implement.** This plan is re-detailed as its own `implement`. The value would be the accumulated text of a `url` fetch with `done` and `error` fields. It would require `plan:spec/compiled-request-fetch`, reuse that plan's abort for cancellation, and add a Studio source. That is an `M` in both tiers.
- **Decided:** the row stays in the table with a `**Removed**` cell rather than being deleted. §11.2's table is the list of prototype names, and a reader holding an older document should find what became of this one. `openItems()` reads a `**Removed**` cell as closed.
- **Decided:** the runtime case is deleted, not kept as a silent `null`. The default branch then warns (`unknown $prototype "ReadableStream" …`) and returns `ref(null)`. A name that validates and silently does nothing is the defect the census found. The warning costs nothing, because no tracked document uses the name.
- **Decided:** `ExternalClassDef` is otherwise unchanged. It never used `BUILT_IN_PROTOTYPES` to require `$src`, so no document's validity moves; only the `examples` list shrinks.

## Implementation

1. **`packages/schema/defs/external-class-def.schema.ts`**: delete `"ReadableStream"` from `BUILT_IN_PROTOTYPES` and from `$prototype.examples`.
2. **`packages/runtime/src/runtime.ts`**: delete `case "ReadableStream"` from `resolvePrototype`.
3. **Regenerate.** Run `bun run schema:sync`.
   - Its report should name only the `examples` pointer: in `packages/schema/schema.json`, and in the embedded copies in the 28 `document.schema.json` files (`examples/`, 13 under `packages/starters/sites/`, `packages/studio/`, `packages/ui/`, 10 under `scripts/screenshots/fixtures/`, `sites/jxsuite.com/`, `sites/test-blank/`).
   - Anything else in the report is unrelated drift.
   - Commit the regenerated files; never hand-edit them.
4. **`packages/schema/README.md`**, line 59: drop `` `ReadableStream`, `` from the built-in list. No em dash (the file is in `docs:prose`'s corpus).
5. The spec edits below.

**Integration contract.** Once this lands:

- `BUILT_IN_PROTOTYPES` holds `Function`, `Request`, `URLSearchParams`, `FormData`, `LocalStorage`, `SessionStorage`, `Cookie`, `IndexedDB`, `Array`, `Set`, `Map` and `Blob`.
- spec.md §11.2's marker names neither `ReadableStream` nor a stub, and the row is closed.
- `plan:spec/web-api-prototype-parity` may flip §11.2 once its own rows are built. Its "lowers every built-in" test iterates this list.
- `plan:schema/generator-inventory`'s Built-in Prototypes rewrite has no `ReadableStream` line to keep. Its integration contract says that plan "implements `ReadableStream`"; whichever lands second corrects that sentence.
- `plan:spec/reconcile-built-in-prototypes`'s §12.1 table does not list the name.
- Under `plan:compiler/client-external-class-hydration`, `isExternalClassDef` holds for a `ReadableStream` entry, so a `timing: "compiler"` one fails the build as naming no class. That is the right answer for an unknown name.

## Tests

**`packages/runtime`.** Run `bun test --isolate --coverage` there and `bun scripts/check-coverage-manifest.ts packages/runtime`. In `packages/runtime/tests/runtime.test.ts`:

- "ReadableStream: returns null" becomes "ReadableStream is not a built-in: warns and resolves to null". It spies on `console.warn` as "unknown $prototype: warns and returns ref(null)" does, and asserts the warning names `ReadableStream`.
- Add "every built-in prototype but Function and Array resolves without the unknown-prototype warning". It iterates `BUILT_IN_PROTOTYPES` from `@jxsuite/schema/defs` (the runtime already depends on `@jxsuite/schema`) with a minimal config per name:
  - `Request` with `manual: true`;
  - `IndexedDB` with `database`, `store` and the file's existing `indexedDB` stub;
  - `Cookie` and the storage entries with a `default`.

  It asserts that no warning was logged. This is what stops a stub from being listed again.

**`packages/schema`.** Run `bun test --isolate --coverage` there. No case asserts the list's length or members (checked: no test references `BUILT_IN_PROTOTYPES` or `ReadableStream`), and `bun run schema:verify` holds the regenerated files.

**Coverage.** Deleting the case removes three lines from `runtime.ts`, and no source file is added. The bars are unchanged: runtime `lines = 0.963, functions = 0.98`; schema `lines = 0.99, functions = 0.99`. The regenerated workspaces run in CI through `affected.ts` and must stay green.

## Specs & docs

**spec.md §11.2.**

- The marker's first sentence becomes "The interpreter's `resolvePrototype` handles every Web API row; the `Array` row is the §10 children node, not a state prototype." The marker stays `Partial`.
- The row becomes ``| `ReadableStream` | Streams API | **Removed** — not a built-in: a stream is read once, by one reader, so it cannot be an entry's value, and a streamed body belongs to `Request` |``.
- Re-pad the table with the formatter.

**spec.md §12.1's marker.** "… `FormData`, `Blob` and `ReadableStream` (§11.2) are missing from the table" becomes "… `FormData` and `Blob` (§11.2) are missing from the table". The marker stays Partial and stays `plan:spec/reconcile-built-in-prototypes`'s.

**schema.md §3.1.**

- Delete the line ``- `ReadableStream` — (stub)``.
- "All 13 built-in prototypes" becomes "All 12 built-in prototypes", unless `plan:schema/generator-inventory` has already replaced that lead sentence.
- The marker is untouched.

**Fragments:**

- `bun run spec:change spec.md patch -m "ReadableStream is no longer a built-in prototype: it was never implemented, and a stream that can be read only once cannot be a state value every binding reads."`
- `bun run spec:change schema.md patch -m "The built-in prototype list drops ReadableStream, which was never implemented."`

The level is patch because the name was listed only as Pending or a stub, never as working.

**Docs.**

- No docs page names `ReadableStream`: `docs/framework/concepts/data-prototypes.md` and `reactivity.md` already omit it.
- `bun run docs:sync` names the pages whose `code:` lists `runtime.ts`. None describes the name, so the pull request states that no update is needed.

**Landing.** This plan claims nothing, so it graduates nothing. The pull request that lands it deletes this file and removes `spec/web-api-prototype-parity-readable-stream` from `plans/spec/web-api-prototype-parity.md`'s `requires`.

## Acceptance

- `grep -rn "ReadableStream" specs/spec.md specs/schema.md packages/schema/README.md packages/schema/defs packages/runtime/src` prints only the `**Removed**` row.
- `bun run schema:verify` passes. `git diff --stat` lists only `external-class-def.schema.ts`, `runtime.ts`, the README, the two specs, the fragments, the test and the 29 regenerated schema files.
- These pass: `bun run plans:check --audit spec`, `bun run plans:check --audit schema`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`.
- `bun run plans:status --who-claims spec.md#11.2` still names `spec/web-api-prototype-parity`.
- `cd packages/runtime && bun test --isolate --coverage` passes at its thresholds.
