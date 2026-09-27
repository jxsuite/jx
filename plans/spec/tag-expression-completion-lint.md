---
status: drafted
disposition: implement
claims: []
requires: []
workspaces:
  - packages/schema
  - packages/compiler
  - packages/studio
  - specs
  - docs
size: M
---

# `jx validate` and Studio warn when a chosen tag reads a value the same document writes

## Context

`specs/spec.md` §19.6, line 2174, the first of the marker's two open parts:

> **Status: Partial.** All three positions ship in the interpreter, the element target and the static target. Two parts do not: `jx validate` has no lint for a tag discriminant that is also an assignment target (`packages/compiler/src/site/validate-command.ts` runs only the popover, dialog and accessibility lints), and `compile-client.ts` refuses a tag expression on a dynamic page ("A tag chosen at creation is not supported on a dynamic page yet").

§19.6's "Why once and not live" paragraph (line 2236) rests on the lint: "`jx validate` warns when a tag discriminant is also an assignment target, so the case where the rule bites is caught before it ships." The promise is repeated in the `tagExpressionSchema` docstring (`packages/schema/defs/tag-expression.schema.ts`) and in `renderNode`'s comment (`packages/runtime/src/runtime.ts:1385`). Nothing implements it.

This is an enabling plan: it claims nothing, and `plan:spec/tag-expression-completion`, which owns §19.6 and does the compiled half, requires it. They are split because the compiled half requires `plan:spec/compiled-keyed-lists` and this half needs none of that. Verified on 2026-09-27.

**What exists**

- `lintDocument` in `validate-command.ts` (line 252) runs `findPopoverDefects`, `findDialogDefects` and `findA11yDefects` over each well-formed document into `ProjectTreeLintFinding`s (`source`, `rule`, `path`, `message`, `detail`, `severity`). `formatProjectTreeLint` prints `file: severity: message [source/rule]`. Warnings never fail the run, and `--strict` fails it only on an error.
- The three lints live in `@jxsuite/schema` (`src/overlays.ts`, `src/dialogs.ts`, `src/a11y.ts`) so that `jx validate` and Studio judge documents alike. Studio files popover and dialog findings as Problems at the save chokepoint (`reportSaved` in `packages/studio/src/files/file-ops.ts:231`, calling `reportPopoverProblems`).
- `@jxsuite/schema` cannot import `@jxsuite/runtime` (runtime depends on schema), but the schema's own operator defs enumerate the mutating set: `assignmentOperatorSchema`, `noArgMethodSchema`, `oneArgMethodSchema` and `spliceMethodSchema` (`packages/schema/defs/expression-node.schema.ts:88`).
- `collectAssignedStateKeys` (`packages/compiler/src/shared.ts:475`) already recognises writes: mutating nodes' `#/state/` targets, and in string bodies `state.<key>` followed by an assignment or a mutating array method. It answers a different question (which top-level keys the prerender must not bake), and it misses `state.a.b = …`, bracket access and prefix `++`.
- No committed document (sites, starters, examples, Studio surfaces, `packages/ui`) declares a chosen tag, so no existing project gains a warning.

## Outcome

- `jx validate` reports a `warn` finding (`expression/tag-discriminant-written`) for every element whose chosen tag reads a pointer the same document writes, and Studio files the same finding as a Problem on save.
- spec.md §19.6 states the rule. Its marker stays Partial, now naming only compiled gaps, and those accurately (`plan:spec/tag-expression-completion` flips it).

## Decisions

- **Open:** does Studio file the finding too? §19.6 names only `jx validate`. Recommendation: yes, at save beside the popover report, because Studio is where a chosen tag is authored (the Inspector's Tag row) and its canvas, which runs the interpreter, is where "a `<div>` that never became an `<a>`" is seen. The cost is one small report module and one line in `reportSaved`. Without it, drop `packages/studio` from `workspaces` and the Studio steps below.
- **Open:** does a discriminant that reads a `Request` also warn? §19.6 names only writes. Recommendation: yes, as a second rule, `tag-discriminant-late`, for a read (after the computed closure below) of a state entry with `$prototype: "Request"` and a `timing` other than `"compiler"`. Its response arrives after the element is created, so the element keeps the tag a pending request selects, which is the same bite as a write. A compiler-timing request is settled at build and is exempt.
- **Decided:** the lint is `findTagExpressionDefects` in a new `@jxsuite/schema/tag-expressions` module, because both surfaces already import their lints from `@jxsuite/schema`, and the mutating set is read from the schema's operator defs so the two cannot disagree.
- **Decided:** severity `warn`, advisory as the other lints are, and never fatal even under `--strict`: §19.6 says "warns", and the document still renders, with its first tag.
- **Decided:** reads and writes compare as pointer paths, and they overlap when either is a segment-wise prefix of the other. A write to `#/state/user` changes a discriminant reading `#/state/user/role`, and a `push` onto `#/state/items` changes one reading `#/state/items/length`. Top-level keys (`collectAssignedStateKeys`'s granularity) would flag every write to any member of an object the discriminant reads one field of.
- **Decided:** the read set closes over computed state entries, to a fixpoint: a `${}` template string, a non-mutating `$expression` (named formulas included), or a Function whose string body returns (`bodyReturnsValue`). A discriminant routinely reads a derived key, like the `imageKey: "${state.image ? 'set' : ''}"` pattern in `packages/compiler/tests/compile-element.test.ts`, and a lint blind to it would miss the ordinary case.
- **Decided:** a `$map/` read is compared only with `$map/` writes inside the same repeater's template (nested repeaters excluded), because `$map` names a different row everywhere else. `parent#/`, `window#/` and other schemes are not compared.
- **Decided:** string bodies are scanned for `state` member chains (dot or bracket with a literal key) that are assigned, compound-assigned, updated (`++`/`--` either side), `delete`d, or receive an array-mutation method call (`push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`). Writes through an alias, and writes a `$src` module makes, are not seen; the spec says so.
- **Decided:** one finding per element and read pointer, naming the first overlapping write's location, in document order, so Problem keys and CLI output are stable.
- **Decided:** `collectAssignedStateKeys` is left alone. Folding it into the new collector would change which bindings the prerender bakes, a behaviour change outside §19.6.
- **Decided:** no edge to `plan:spec/expression-build-checks` (the critic's suggestion). Its `walkExpressions` lives in `@jxsuite/runtime/expression`, which `@jxsuite/schema` cannot import, and this lint needs only pointer collection, not that walker's position-aware judgement. Either plan may land first.

## Implementation

1. **`packages/schema/src/tag-expressions.ts`** (new; JSDoc `@docs framework/concepts/expressions`):
   - `export type TagExpressionRule = "tag-discriminant-written" | "tag-discriminant-late";` (the second only per the Open).
   - `export interface TagExpressionDefect { rule: TagExpressionRule; path: PopoverPath; pointer: string; writtenAt: PopoverPath | null; message: string; detail: string; severity: "warn" }`, with `PopoverPath` from `./overlays`.
   - `export function findTagExpressionDefects(doc: JxElement): TagExpressionDefect[]`, built from private helpers:
     - `MUTATING`: a `Set` from `assignmentOperatorSchema.enum`, `noArgMethodSchema.enum`, `oneArgMethodSchema.enum` and `spliceMethodSchema.const`.
     - `pointerPath(ref)`: `{ scheme: "state" | "map", segments }` for `#/state/…` and `$map/…` (unescaping `~1` then `~0`), else `null`.
     - `operandRefs(operand)`: every `$ref` string in an operand tree, through `target`, `value`, `initial`, `cases`, `default` and arrays.
     - `bodyReads(text)` and `bodyWrites(text)`: the member-chain scans above, turned into segment paths.
     - `readSet(expression, state)`: the discriminant's refs, closed over computed entries by first segment, with a visited set.
     - `collect(value, path, repeater, sink)`: one deep walk of the document that records each tag site (an object whose `tagName` passes `isTagExpression`, with its path and innermost repeater) and each write: a mutating node's `target.$ref`, and `bodyWrites` of a Function def's string `body`, with its path and repeater. It enters a mapped array's `map` (`isMappedArray`) with `repeater` set to that path, so statement lists, `$switch` cases, inline handlers and state entries are all reached.
   - Per the Request Open: after the closure, a `#/state/` read whose first segment names an entry with `$prototype: "Request"` and a `timing` other than `"compiler"` yields a `tag-discriminant-late` finding with `writtenAt: null`.
   - The message names the pointer ("This tag is chosen once, when the element is created, but `#/state/href` is written later in this document"). The detail names the write's location and the remedy: choose the tag from a value nothing writes, or swap content with a `$switch`, and see docs/framework/concepts/expressions.
2. **`packages/schema/package.json`**: export `"./tag-expressions": "./src/tag-expressions.ts"`.
3. **`packages/compiler/src/site/validate-command.ts`**: `ProjectTreeLintFinding.source` gains `"expression"`. `lintDocument` appends `findTagExpressionDefects(doc)` as `{ ...pick(defect), file, source: "expression" }`. The docstrings that say "three lints" say four.
4. **Studio** (per the Open):
   - `packages/studio/src/services/expression-report.ts` (new; `@docs studio/interface/problems-and-progress`): `export const EXPRESSION_PROBLEM_SOURCE = "Expressions"` and `export function reportExpressionProblems(doc: JxElement, path?: string): number`. It clears the source's records, then `notify("warn", …)` per defect with `detail`, `key: "expression.<rule>.<path joined by />.<pointer>"`, `tier: "problem"` and the document path. No action, since which write is wrong is the author's call.
   - `packages/studio/src/files/file-ops.ts`, `reportSaved`: call `reportExpressionProblems(doc, tab.documentPath ?? undefined)` after `reportPopoverProblems`.

**Integration contract.** `@jxsuite/schema/tag-expressions` exports `findTagExpressionDefects`, `TagExpressionDefect` and `TagExpressionRule`. `jx validate` reports them with `source: "expression"`, which `plan:spec/expression-build-checks` may reuse for its own findings, and Studio files them under the `Expressions` Problem source at save. spec.md §19.6 carries the rule as a **The warning.** paragraph and a marker naming only compiled gaps, which `plan:spec/tag-expression-completion` replaces with `Implemented`.

## Tests

Run `bun test --isolate --coverage` from `packages/schema`, `packages/compiler` and `packages/studio`.

**`packages/schema/tests/tag-expressions.test.ts`** (new):

- `nothing is reported when nothing writes the discriminant`.
- `an assignment in a state handler writing the pointer is one warning on the element`: `path`, `pointer`, `writtenAt` and `severity`.
- `a write to an ancestor and a write below the read both overlap`: `push` on `#/state/items` against a read of `#/state/items/length`, and `=` on `#/state/user/role` against `#/state/user`.
- `a sibling whose name shares a prefix does not overlap`: `#/state/hrefs` against `#/state/href`.
- `string bodies: assignment, compound assignment, prefix and postfix updates, delete, bracket keys and mutating methods` (one table).
- `a statement nested in then, else and $switch cases, and an inline handler on another element, are writes`.
- `a read through a computed is followed to a fixpoint`: a template, a pure `$expression` and a returning Function body, two levels deep and cyclic, without looping.
- `every pointer in a nested-node discriminant is a read`.
- `a $map/ read is judged only against writes in its own repeater`.
- `escaped pointer segments name their entry`: `#/state/a~1b`.
- `findings are one per element and pointer, in document order`.
- `the mutating set equals the closed set of assignment and array-mutation operators`: the ten tokens.
- Per the Open: `a Request read is tag-discriminant-late, and a compiler-timing Request is not`.

**`packages/compiler/tests/validate-command.test.ts`:** `a chosen tag whose discriminant a handler writes is an expression warning, and the tree stays valid under strict`, asserting the `formatProjectTreeLint` line `pages/link.json: warn: … [expression/tag-discriminant-written]`.

**`packages/studio/tests/expression-report.test.ts`** (new; first import `./harness`, as `popover-report.test.ts` does): `files one warning per finding under Expressions, with its document path`; `a clean document files nothing and clears the previous run`; `two elements reading one written pointer are two Problems`. **`packages/studio/tests/file-ops.test.ts`**: `saving a document files its tag-expression warnings`.

Coverage: the two new source files ship with their tests, so the manifest check (`bun scripts/check-coverage-manifest.ts packages/schema` and `… packages/studio`) passes. `tag-expressions.ts` must meet `packages/schema/bunfig.toml`'s per-file `lines = 0.99, functions = 0.99`; the touched compiler and Studio files are held to `lines = 0.982, functions = 0.98` and `lines = 0.958, functions = 0.941`. Ratchet a threshold to just below a raised worst file.

## Specs & docs

**`specs/spec.md` §19.6, edited in place:**

- The marker becomes:

  > **Status: Partial.** All three positions ship in the interpreter, and `jx validate` and Studio warn when a tag discriminant is also written (`findTagExpressionDefects` in `packages/schema/src/tag-expressions.ts`). Compiled output does not honour the tag position yet. `compile-client.ts` refuses a tag expression on a dynamic page. The element target re-reads the discriminant on every render, emits `[object Object]` for a chosen tag at a repeater row's root, and compiles a `$map/` discriminant to an unbound `_item`. The static target reads a nested discriminant node as a truthy object and resolves a build-time row's `$map/` discriminant against the page.

- In **Why once and not live.**, the sentence "`jx validate` warns when a tag discriminant is also an assignment target, so the case where the rule bites is caught before it ships." becomes "`jx validate` warns when the discriminant is also written (below), so the case where the rule bites is caught before it ships."
- After that paragraph, add:

  > **The warning.** `jx validate` warns, and Studio files a Problem when the document is saved, when a pointer the discriminant reads is written in the same document. The reads are every `$ref` in the discriminant's operand tree, plus, for each `state` entry they name that is computed (a `${}` template, a pure `$expression`, or a Function whose string body returns), that entry's own reads. A write is the `target` of an assignment or array-mutation node anywhere in the document, statement lists included, or a `state` member a Function's string body assigns, updates, deletes or calls an array-mutation method on. A read and a write overlap when either path is a prefix of the other, and a `$map/` pointer is compared only with writes in the same repeater's template. Writes made through an alias or by a `$src` module are not seen. A discriminant that reads a `Request` entry, unless its `timing` is `"compiler"`, draws the same warning, because the response arrives after the element is created.

  The last sentence goes if the Request Open is declined, and "and Studio files a Problem when the document is saved" goes if the Studio Open is.

**Fragment:** `bun run spec:change spec.md minor -m '§19.6: jx validate warns, and Studio files a Problem on save, when a chosen tag reads a pointer the same document writes or a pending Request, and the marker names the compiled gaps that remain.'` (trimmed to match the Opens as resolved).

**Docs** (no em dashes in any page below):

- `docs/framework/concepts/expressions.md` (`spec: spec.md#19`): the frontmatter gains `code: [packages/schema/src/tag-expressions.ts]`, matching the module's `@docs` tag; `plan:spec/named-formula-recursion` adds `expression.ts` to the same list, so whichever lands second appends. In "Choosing an element's tag", a third rule after the two bullets: "**`jx validate` warns when the same file writes the value the choice reads**, for example a button that sets `href`, because the element would keep the tag it was created with. Studio shows the same warning in Problems when you save. The check follows derived values back to what they read, and it cannot see changes made by a sidecar script."
- `docs/framework/build/cli.md` (its `code:` lists `validate-command.ts`), `jx validate`: "every well-formed document is also judged by the popover, dialog and accessibility rules" becomes "…by the popover, dialog, [accessibility](/docs/framework/concepts/accessibility) and [chosen-tag](/docs/framework/concepts/expressions) rules". The format sentence stays.
- `docs/studio/interface/problems-and-progress.md` (per the Studio Open): the frontmatter `code:` gains `packages/studio/src/services/expression-report.ts`, and after the popover paragraph: "Saving also checks every element whose tag is chosen by a formula, and files a warning under **Expressions** when the same file writes the value that choice reads. The row has no **Fix** button, because which write is wrong is your decision."
- No other page changes. `bun run docs:sync` also names `docs/framework/agents.md` and `docs/framework/agents/authoring-rules.md` for `validate-command.ts`, and the pages listing `file-ops.ts`. None enumerates the lints.

This plan does not graduate `spec.md`.

## Acceptance

- From `packages/schema`, `packages/compiler` and `packages/studio`: `bun test --isolate --coverage` is green with no file below its threshold, and the manifest check passes for each.
- This prints one `tag-discriminant-written` finding for `#/state/href` at path `children,0`:

  ```sh
  bun -e 'import { findTagExpressionDefects } from "./packages/schema/src/tag-expressions.ts"; const t = { $expression: { operator: "?:", target: { $ref: "#/state/href" }, value: "a", initial: "div" } }; console.log(findTagExpressionDefects({ tagName: "div", state: { href: "", go: { $expression: { operator: "=", target: { $ref: "#/state/href" }, value: "/x" } } }, children: [{ tagName: t }] }).map((d) => [d.rule, d.pointer, String(d.path)]))'
  ```

- `jx validate --strict` on a project with such a page exits `0` and prints the warning line.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` are green. `bun run plans:status --spec spec` still lists §19.6, owned by `plan:spec/tag-expression-completion`.
