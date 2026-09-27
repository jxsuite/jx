---
status: drafted
disposition: implement
claims:
  - studio.md#6.8
requires: []
workspaces:
  - packages/studio
size: M
---

# The From data picker writes every pointer it offers correctly, and can reach into a signal's value

## Context

`specs/studio.md` §6.8, line 732 (the census kept the section Partial and made the marker specific):

> **Status: Partial.** The picker lists the document's top-level state signals and writes `#/state/<name>` verbatim (`packages/studio/src/panels/properties-panel.ts`, `panels/events-panel.ts`, `ui/schema-form.ts`, `ui/dynamic-slot.ts`, `ui/expression-editor.ts`), so it cannot address a path into a signal's value. Nothing in Studio calls `escapeToken`, so a signal named `a/b` is listed and written as `#/state/a/b`, which reads back as `a` then `b` and breaks rule 1 below rather than being merely unreachable; a dotted name already round-trips, so that row's ❌ is stale.

Verified at the detail pass (paths under `packages/studio/src/`):

- **A slash is reachable.** The Data panel's rename (`signals-panel.ts`, the name field's `write`, ~line 600) refuses only an empty or colliding name, and `mutateRenameDef` (`tabs/transact.ts`) moves the key and rewrites no ref.
- **Writers.** `grep -rn '#/state/\${' packages/studio/src` still lists the census's fifteen sites in eight files: `editor/convert-to-repeater.ts` 179, 180, 185, 202; `ui/expression-editor.ts` 598; `ui/formula-catalog.ts` 477, 522; `ui/dynamic-slot.ts` 143 (`slotModeSeed`); `ui/schema-form.ts` 300 (`refSourcesFor`); `panels/properties-panel.ts` 1002 (`applyLadder`); `panels/signals-panel.ts` 738 (a computed's `$deps`, identifier matches only); `panels/events-panel.ts` 157, 285 (`refOptions`), 670, 1124.
- **Readers.** The stub named two; there are fifteen, each stripping the prefix by hand with no decoding: `panels/properties-panel.ts` 215 (`bindingDonor`), 233 (`boundSignalOf`, `slice(8).split("/")[0]`), 1586 (the literal a de-escalation restores); `panels/events-panel.ts` 425 (`literalDefaultOf`); `ui/expression-editor.ts` 392 (`expressionHint`), 622 (operand labels); `ui/formula-chips.ts` 69 (`refLabel`); `ui/formula-catalog.ts` 555 (`calleeEntry`); `panels/signals-panel.ts` 754 (the `$deps` note) and 383 (`resolveDefaultForCanvas`, unreachable and allowlisted in `tests/reachability.test.ts`); `editor/repeater-scope.ts` 59 (`refToStateName`); and the Edit canvas's `{name}` placeholders, `utils/edit-display.ts` 225, 289, 326 and `canvas/iframe-patch.ts` 405 (`textDisplayValue`, canvas realm). So `{a~1b}` is what the Edit canvas prints for an escaped pointer written by hand.
- **What a deep pointer looks like today.** The Content and Logic tabs draw the rung as the kit's `jx-select` over the top-level names. A held pointer that is not among them gets the kit's stand-in row (`syncSelect`, `packages/ui/src/behaviors/select.ts`), labelled with the raw pointer text; the chip says `nav/data/sections` and jumps nowhere unless the first segment happens to be a name.
- **Deep pointers are real, and mostly repeater `items`.** `sites/jxsuite.com/layouts/docs.json` repeats `#/state/nav/data/sections` twice (a `ContentEntry`); three starters' `[slug].json` pages repeat `#/state/entry/$children` (a key that begins with `$`); museum pages read `#/state/entry/data/date` and siblings. The one array index, `#/state/items/0`, is the pointer-syntax example in `docs/framework/concepts/references.md`.
- **The runtime already has the grammar.** `packages/runtime/src/pointer.ts`, exported as `@jxsuite/runtime/pointer`: `escapeToken`, `unescapeToken`, `refSegments`, `readPath`, `refAccessor`. Studio depends on `@jxsuite/runtime` and imports nothing from `/pointer` today.
- **The resolved values are already in the parent.** `tab.session.canvas.scope` is the JSON snapshot the canvas posts as `dataScope` (adopted in `canvas/iframe-host.ts`, built by `canvas/serialize-scope.ts`: functions skipped, a value over 256k characters replaced by a placeholder string); the Data panel's tree (§5.6) reads it. The one nested walk in Studio, `walk` in `editor/merge-tags.ts` (3 levels, 30 keys, an array contributes `length` and stops), never runs: its only caller passes a null scope.
- The dotted-name row is stale as the marker says: nothing in Studio splits a `#/state/` pointer on `.`.

## Outcome

- studio.md §6.8 → Implemented. Every `#/state/` pointer Studio writes is built by one function and every one it reads is parsed by one function, both over the runtime's tokenizer; the From data… list offers the paths into each entry's resolved value; a held pointer always reads back as its path, in the picker, the chip and the Edit canvas. The table's three ❌ become ✅.
- Not a graduation: studio.md keeps other open items.

## Decisions

- **Decided:** the grammar lives in a new pure module, `ui/state-pointer.ts`, importing only `@jxsuite/runtime/pointer`; the list builder lives in `ui/dynamic-slot.ts` beside `SignalOption` and `slotModeSeed`, because `canvas/iframe-patch.ts` runs in the canvas realm and must not pull `workspace/` in, while the builder needs `dataTypeLabel` from `panels/data-explorer.ts` (as `merge-tags.ts` already does). A source-scan test refuses a hand-built `#/state/` pointer anywhere else, which is what "one helper, not a template string per site" means after the pull request that lands it.
- **Decided:** a path is shown as its decoded segments joined by `›` with a space either side (`nav › data › sections`), because that is Studio's breadcrumb joiner (`chipSummary` in `ui/formula-chips.ts`, `panels/head-panel.ts`, `surfaces/statusbar.ts`) and, unlike `.` or `/`, it collides with neither character §6.8's table shows a name may carry.
- **Decided:** paths come only from `tab.session.canvas.scope`; with no scope reported the list is the names alone, as today. A declared `default` is not what the page resolves (a `ContentEntry` or `Request` has none), and §5.6 already treats "no scope yet" as knowing nothing about any entry. Keys beginning with `$` are listed like any other: the snapshot is a JSON round trip, so no reactive plumbing reaches it, and `entry › $children` is the common repeater source.
- **Decided:** one flat list in tree order (each entry's row, then its paths), each path row carrying the type of what it resolved to (`dataTypeLabel`: `Array(3)`, `{2}`, `string`) as the row's `description`, with no filtering by the position's type. All four surfaces already bind `options` to the kit's select, whose rows draw a `description`, so no surface document changes; a drill-down control would write an intermediate pointer, an undo step and a canvas render, at every level; and the top-level list is not type-filtered today either.
- **Decided:** what a position holds is always a row, labelled by its path, because §6.8 rule 1 is violated by the kit's stand-in row printing raw pointer text.
- **Decided:** the Content tab's projection effect tracks `tab.session.canvas.scope` (the Logic tab's render already runs inside its effect, so the read tracks there), because a list projected before the first render would otherwise show names only until the next selection change. The cost is one extra coalesced projection per canvas render, on the same message the Data panel already repaints on.
- **Decided:** renaming keeps accepting `/` and `~`, because §6.8 rule 2 makes the name legal and the escaping the writer's job.
- **Decided:** the Mixed text seed rides along: `slotModeSeed`'s `${state.<first>}` becomes `refAccessor("state", …)`, so `a/b` seeds `${state["a/b"]}` instead of a division. Same name, same function, one rung over; §6.6 states no seed text, so no spec edit.
- **Decided:** out of scope, each with a reason: the extra pointers (`$map/item`, `#/$params/…`) pass through unchanged, since §6.8 governs `#/state/`; Convert to Repeater's source list stays top-level names (escaped), since the Items row it creates is path-aware afterwards; `repeater-scope.ts` resolves item fields only for a path-free pointer and keeps the `item`/`index` fallback for a deep one, as it does today.
- **Open:** how far the walk reaches. Recommendation: three levels below the entry and 30 keys per object, collected breadth-first up to 40 rows per entry and listed in tree order, plus the keys of whatever the held pointer resolves to. The pointers the repository writes are at most two levels down; 30 keys is the Data panel's and the Insert data walk's breadth; the per-entry cap keeps one large `Request` response from turning the select into hundreds of rows; and listing the held path's keys makes any depth reachable by successive picks, so the cap needs no inert "… more" row (the text §5.6 refuses in the tree).
- **Open:** array elements by index. Recommendation: not offered. An array contributes its `length` row and is not descended into, and an index pointer written by hand reads back through the held row. Every array pointer in the repository is a whole list or its `length`, and a row per element would lengthen the list by the array's size for a binding nobody writes.

## Implementation

1. **`packages/studio/src/ui/state-pointer.ts`** (new; pure and DOM-free; `@docs studio/design/properties`), over `escapeToken`, `refSegments` and `refAccessor` from `@jxsuite/runtime/pointer`:
   - `STATE_POINTER = "#/state/"`.
   - `stateRef(name: string, ...path: string[]): string`: the prefix, then `[name, ...path].map(escapeToken).join("/")`.
   - `parseStateRef(ref: string): { name: string; path: string[] } | null`: `null` unless `ref` starts with the prefix and its first segment is non-empty; segments from `refSegments(ref.slice(prefix.length))`.
   - `stateRefLabel(ref: string): string`: a parsed pointer's segments joined by `" › "`; any other ref returned unchanged.
   - `stateAccessor(name: string): string`: `refAccessor("state", escapeToken(name))`.
   - `readSegments(root: unknown, path: readonly string[]): unknown`: the decoded-segment twin of `readPath`.
2. **`packages/studio/src/ui/dynamic-slot.ts`**:
   - `SignalOption` gains `description?: string`.
   - `slotModeSeed`: the ref seed is `{ $ref: stateRef(first) }`; the template seed is `` `\${${stateAccessor(first)}}` ``.
   - New `stateRefOptions(names: readonly string[], opts: { scope?: Record<string, unknown> | null; held?: string }): SignalOption[]`. Per name: `{ label: name, value: stateRef(name) }`, then, when `scope` has the name, the walk of `scope[name]` under the Open decision's caps (`PATH_DEPTH`, `PATH_KEYS`, `PATH_ROWS` as named constants): an object contributes its keys, an array a `length` row and nothing below it, anything else nothing. Each path row is `{ label: stateRefLabel(v), value: v = stateRef(name, ...path), description: dataTypeLabel(resolved) }`. Last, when `held` parses and is not already a row, a row for it (label `stateRefLabel(held)`), then the rows for the keys of `readSegments(scope[name], path)` not already listed.
3. **Writers** (each `` `#/state/${x}` `` becomes `stateRef(x)`): `convert-to-repeater.ts` (`optional()` and `confirm()`), `formula-catalog.ts` (both `insert` callbacks), `signals-panel.ts` (`$deps`), `events-panel.ts` (`seedForHandlerMode`, the handler `refOptions` rows, the add-event default at ~1124). Function refs are names only: functions are absent from the scope.
4. **Readers**: `properties-panel.ts` `bindingDonor` returns `stateRefLabel(ref)`; `boundSignalOf` returns `parseStateRef(ref)?.name ?? null`, so the chip's `known` test and `revealSignal` receive the decoded entry the path starts at. `expression-editor.ts` `expressionHint`, `formula-chips.ts` `refLabel`, `signals-panel.ts`'s `$deps` note, and the four Edit canvas placeholders in `utils/edit-display.ts` and `canvas/iframe-patch.ts` use `stateRefLabel`. `formula-catalog.ts` `calleeEntry` and `signals-panel.ts` `resolveDefaultForCanvas` use `parseStateRef` (a callee is a path-free pointer). `repeater-scope.ts` `refToStateName` returns the parsed name only when `path` is empty.
5. **The literal a de-escalation restores**: new `boundLiteralDefault(ref: string, defs): string | undefined` in `properties-panel.ts` beside `defaultAsString`: for a parsed pointer, the entry's declared default read at `path` with `readSegments`, stringified as `defaultAsString` does. Replaces the inline expression at ~1586 and `events-panel.ts`'s `literalDefaultOf`.
6. **The four lists**, each passing `scope: activeTab.value?.session.canvas.scope ?? null` and the position's current `$ref` as `held`:
   - `properties-panel.ts` `applyLadder`: `sources = [...stateRefOptions(opts.stateDefs, …), ...extraSignals]`; the ref branch keeps `description` when it maps `sources` to `row.options`. `ContentOption` (`surfaces/properties-panel.ts`) gains `description?`.
   - `events-panel.ts` `refOptions(plan)`; `LogicOption` (`surfaces/logic-panel.ts`) gains `description?`.
   - `schema-form.ts`: `SchemaFormContext` gains `scope?: Record<string, unknown> | null`. `refSourcesFor` keeps deciding whether the rung is offered; the ref branch of `deriveField` (~line 950) builds `row.options` from `stateRefOptions(ctx.signals ?? [], { held, scope: ctx.scope })` followed by the `$params` rows. `SchemaFormOption` gains `description?`. `signals-panel.ts`'s mount passes `scope: S.canvas?.scope ?? null`.
   - `expression-editor.ts` `walkOperand`: `refOptions` from `stateRefOptions(stateDefs, { held: refValue, scope })`; `nothingToBind` still counts `stateDefs`. `ExprOption` (`surfaces/expression-editor.ts`) gains `description?`.
7. **Reactivity**: the Content tab's effect in `properties-panel.ts` (~line 712) adds `void tab.session.canvas.scope;`; `events-panel.ts` `watch()` adds the same read beside its others, for the reader's benefit.

**Integration contract.** Once this lands, Studio code may rely on: `stateRef`, `parseStateRef`, `stateRefLabel`, `stateAccessor` and `readSegments` from `ui/state-pointer.ts`, safe in both realms; `stateRefOptions` from `ui/dynamic-slot.ts`, which escapes, walks the canvas scope and lists the held pointer; and a test that fails on any hand-built `#/state/` pointer under `src/`. A plan that adds names to the picker (project `state` or `$site` after `plan:studio/canvas-injects-context` and `plan:studio/site-state-in-data-panel`) passes them to `stateRefOptions` and gets paths and read-back with no further change. studio.md §6.8 then states the list's shape as a contract.

## Tests

`cd packages/studio && bun test --isolate --coverage`, then `bun scripts/check-coverage-manifest.ts packages/studio`.

- **`tests/state-pointer.test.ts`** (new):
  - "stateRef and parseStateRef are inverses": for `count`, `user.name`, `a/b`, `t~x`, `~1` (written `#/state/~01`, RFC 6901 §4's order) and `("entry", "$children")`, `parseStateRef(stateRef(n, ...p))` equals `{ name: n, path: p }`, and the written strings are pinned.
  - "parseStateRef refuses what is not a state pointer": `#/state/`, `#/$params/slug`, `window#/Math/max`, `$map/item`, `""` give `null`.
  - "stateRefLabel decodes and joins": `#/state/a~1b` gives `a/b`, `#/state/nav/data/sections` gives `nav › data › sections`, `#/$params/slug` is unchanged.
  - "stateAccessor quotes what is not an identifier": `count` gives `state.count`, `a/b` gives `state["a/b"]`.
  - "no Studio source spells a state pointer by hand": scans `src/**/*.ts` except `ui/state-pointer.ts` for `` `#/state/${ ``, `startsWith("#/state/")`, `replace("#/state/"` and `"#/state/".length`, and expects none.
- **`tests/dynamic-slot.test.ts`**: `stateRefOptions` gives names only with a null scope; walks a scope in tree order with labels and descriptions; lists `entry › $children`; gives an array a `length` row and nothing below; honours the three caps, and collects breadth-first (a wide object whose first key is deep still lists every first-level key); treats the large-value placeholder as a leaf; appends an unlisted held pointer and its keys once. `slotModeSeed` for `a/b`: `{ $ref: "#/state/a~1b" }` and `${state["a/b"]}`.
- **`tests/properties-panel.test.ts`**, new describe "From data… addresses the pointer grammar (§6.8)": a signal named `a/b` is offered as `a/b` and written `#/state/a~1b`; an escaped pointer reads back (the select holds it, the chip says `a/b` and opens that row); with `tab.session.canvas.scope` set, `nav › data › sections` is offered and picking it writes `#/state/nav/data/sections`; a held pointer past the walk is listed by its path, never as pointer text; a deep binding's chip names the path and opens `nav`; a scope assigned after the first projection adds the path rows with no selection change; de-escalating a deep binding restores the default at its path.
- **`tests/events-panel.test.ts`**: the repeater's Items lists `entry › $children` from the scope and writes the pointer; a handler bound to a function named `a/b` is written and read back escaped.
- **`tests/schema-form.test.ts`**: `ctx.scope` adds path rows to a ref field; a held pointer is listed.
- **`tests/expression-editor.test.ts`**: operand `refOptions` carry paths from the active tab's scope; `expressionHint` for `#/state/a~1b` reads `= a/b`.
- **`tests/formula-chips.test.ts`**, **`tests/formula-catalog.test.ts`**: a chip labels `#/state/a~1b` as `a/b`; `calleeEntry("#/state/a~1b", …)` finds the formula named `a/b`, and its `insert` writes the escaped target.
- **`tests/convert-to-repeater.test.ts`**, **`tests/repeater-scope.test.ts`**, **`tests/signals-panel.test.ts`**: a source named `a/b` confirms to `#/state/a~1b`; `#/state/a~1b` resolves the entry `a/b`, and a deep pointer yields `item`/`index`; the `$deps` note decodes.
- **`tests/edit-display-gaps.test.ts`**, **`tests/iframe-patch.test.ts`**: a bound text reads `{a/b}` and `{nav › data › sections}` in the Edit canvas.

Coverage: `packages/studio/bunfig.toml` gates every file at `lines = 0.958, functions = 0.941`. `ui/state-pointer.ts` is new and ships with its test in the same pull request (the manifest check fails otherwise); expect 100%. Raise the threshold to just under the new minimum if the worst file rises.

## Specs & docs

**`specs/studio.md`**, in place:

- §6.8 marker: replace it with the line below, and keep the heading as it is (the picker still addresses only what it lists):

  > **Status: Implemented.** Studio builds every `#/state/` pointer with `stateRef` and reads every one back with `parseStateRef` (`packages/studio/src/ui/state-pointer.ts`, over `@jxsuite/runtime/pointer`); the list is `stateRefOptions` in `ui/dynamic-slot.ts`.

- §6.8 first paragraph: "Three consequences the picker does not yet cover:" becomes "The picker covers each consequence:", and the table's three ❌ become ✅.
- §6.8: replace the paragraph beginning "The first gap is the common one" with two paragraphs. "**Under each entry, the list walks what it resolved to.** After an entry's own row come the paths into the value the canvas resolved it to (§5.6): three levels below the entry and 30 keys per object, collected shallowest first up to 40 rows per entry and listed in tree order. An array contributes its `length` and is not descended into. A key that begins with `$` is listed like any other; `#/state/entry/$children` is how a content entry's body is repeated. Each row is labelled with its path, its segments joined by `›` with a space either side, and described by the type of what it resolved to. Before the canvas reports a scope, the list is the entries alone." Then: "**What a position holds is always on the list.** A pointer the walk does not reach (an index written by hand, a path past a cap, a value not resolved yet) is its own row, labelled with its path rather than the pointer text, and the keys of what it resolves to are listed after it, so a deeper path is one more pick away. The provenance chip (§6.7) and the Edit canvas's placeholder read the same path, and the chip opens the Data panel row of the entry the path starts at." Adjust the numbers and the array sentence if the two Open decisions resolve otherwise.
- §6.8: "Two rules for whatever closes this:" becomes "Two rules the picker keeps:"; rule 2's last sentence becomes "Every segment is built with `escapeToken` from `@jxsuite/runtime/pointer` and read back with `refSegments`, the tokenizer the runtime resolves the same pointer with."
- §6.8: delete the closing paragraph "Until then the gap is stated rather than hidden…".
- §6.6's table: the **From data…** row's meaning becomes "a `$ref` to a state entry, or to a path into its value (§6.8)".
- Fragment: `bun run spec:change studio.md minor -m "The From data picker escapes every name it writes, reads escaped and nested pointers back as paths, and lists the paths into each state entry's resolved value"`.

**Docs** (no page's `spec:` cites `studio.md#6.8`; these list a changed file in `code:`; no em dashes):

- `docs/studio/design/properties.md`: add `packages/studio/src/ui/state-pointer.ts` to `code:`. The **Bound** bullet names "the signal, or the value inside it such as `nav › data › sections`, or the formula". The **From data…** bullet becomes "the current value of a signal, or of a value inside it, picked from a list." After "declare them first in the Data panel", add: "Once the canvas has rendered, the list also offers the values inside each signal, labelled by their path, and a name containing a slash is written for you in the form the document needs."
- `docs/studio/logic/formulas.md`: add the same file to `code:`; the **From data…** bullet as above; the operand sentence's "(a state value)" becomes "(a state value, or a value inside one)".
- `docs/studio/logic/events.md`: the Condition row's "(a signal)" becomes "(a signal, or a value inside one)".
- `docs/studio/design/repeaters.md`: after the Items/Filter/Sort paragraph, add: "For **Items**, the list includes the arrays inside a signal, so a content entry's `$children` or `data › sections` can be repeated without editing JSON."
- `docs/studio/logic.md`, `docs/studio/logic/data.md`, `docs/studio/logic/data-sources.md`, `docs/studio/design/components.md`, `docs/studio/interface/canvas.md`: no change; the behaviour they describe is unchanged.

## Acceptance

- `grep -rnE '#/state/\$\{|startsWith\("#/state/"\)|replace\("#/state/"|"#/state/"\.length' packages/studio/src` prints nothing.
- `cd packages/studio && bun test --isolate --coverage` is green, and `bun scripts/check-coverage-manifest.ts packages/studio` lists `src/ui/state-pointer.ts`.
- `bun run typecheck` and `bun run lint` are clean.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` pass, and `bun run plans:status --spec studio` no longer lists §6.8.
- In Studio (the `packages/studio:verify` recipe): open `sites/jxsuite.com/layouts/docs.json`, select the sidebar repeater, and the Logic tab's **Items** reads `nav › data › sections`, with its siblings under `nav` in the list. Rename a Data panel entry to `a/b`, bind a heading's text to it from the Content tab: the source view shows `#/state/a~1b`, the chip reads `a/b` and opens that row, and the Edit canvas shows `{a/b}`.
