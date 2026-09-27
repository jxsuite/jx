---
status: drafted
disposition: implement
claims:
  - jx-markdown.md#7.3
requires: []
workspaces:
  - extensions/parser
  - specs
  - docs
size: S
---

# `placeholder` and `selection` style keys emit the two-colon selectors CSS accepts, at any depth of a style attribute

## Context

`specs/jx-markdown.md` §7.3, line 301:

> **Status: Partial.** The mapping ships as listed (`CSS_PSEUDO_NAMES`, `CSS_PSEUDO_ELEMENTS` and `applyStyleKeyMapping` in `extensions/parser/src/transpile.ts`), but `placeholder` and `selection` are CSS pseudo-elements that have never had a one-colon form, and the transpiler gives them one colon: `style.placeholder.color` becomes `:placeholder`, `buildStyleRules` (`packages/runtime/src/css.ts`, which the compiler shares) emits `#id:placeholder`, and the browser discards the rule.

The section was unmarked before the census because the spec and the code agree: both put `placeholder` and `selection` in the one-colon list. CSS 2 gave one-colon forms only to `before`, `after`, `first-line` and `first-letter`, so a one-colon `placeholder` is exactly the silent non-match §7.3's closing paragraph says the lists exist to prevent.

Verified at the current tree (measured with `bun` scripts calling the functions, no suite run):

- `CSS_PSEUDO_NAMES` (`extensions/parser/src/transpile.ts`, ~147) lists `placeholder`, `selection`, `before` and `after`; `CSS_PSEUDO_ELEMENTS` (~182) is `["backdrop"]`. `applyStyleKeyMapping` (~194) tests the element set first, and `collapseStylePaths` (~232) tests `::` before `:`, so moving a name between the sets is enough for both directions. `transpileJxMarkdown('::input{style.placeholder.color="gray" style.selection.color="red"}')` gives `{ ":placeholder": …, ":selection": … }`, and `buildStyleRules(style, { scope: "#x" })` writes `#x:placeholder { color: gray }` and `#x:selection { color: red }`. `resolveOneNestedSelector` (`packages/runtime/src/css.ts`, ~145) concatenates a `:`-led key verbatim, as spec.md §9.2 specifies; nothing downstream rewrites it.
- No tracked `.md` file writes `style.placeholder`, `style.selection`, `style.before` or `style.after`, and no tracked JSON document carries a one-colon `:placeholder`, `:selection`, `:before` or `:after`. Every JSON document spells the two-colon form (`packages/ui/components/*.json`, `packages/studio/src/surfaces/*.json`, `"::selection"` in `packages/starters/sites/fitness-studio/project.json`), and Studio's `COMMON_SELECTORS` (`packages/studio/src/store.ts`) offers `::before`, `::after` and `::placeholder`. So the doc comment's reason for keeping `before` and `after` one-colon ("moving them would rewrite every `.md` component in the repo") is false, and so is §7.3's clause "which every existing `.md` component is written with". Because `selectorsForNode` (`packages/studio/src/utils/element-selectors.ts`) is unioned with the keys an element declares, a `.md` element transpiled to `:before` shows a second, unticked `::before` entry in the Style tab.
- The mapping reaches **top-level keys only**. `style.--dark.hover.color` gives `{ "@--dark": { "hover": … } }`, which `buildStyleRules` writes as the descendant rule `#x hover { … }`: the failure §7.3 names, one level down. The serializer strips colons and `@` at every depth (`collapsePropsToAttrMap` in `extensions/parser/src/serialize.ts`), so a Studio save of `{ "@--dark": { ":hover": … } }` writes `style.--dark.hover.color` and reopens as that broken rule; `{ ":hover": { "@--md": … } }` reopens as `{ ":hover": { "--md": … } }`.
- The `--` arm is **value-blind**. `style.--brand="red"` gives `{ "@--brand": "red" }`, and `buildStyleRules` emits nothing for it; `style.--accent.ref="#/state/accent"` gives `{ "@--accent": { "$ref": … } }`. spec.md §9.1 calls a custom property a declaration and supports reactive values on it, and the serializer writes `{ "--brand": "red" }` as `style.--brand="red"`, so a save and reopen of a `.md` document drops the property. The audit listed §7.4 as verified; this is recorded here because the fix is the same function.
- Literal colons already parse after the first key segment: `style.::marker.color`, `style.--dark.:hover.color` and `style.:popover-open::backdrop.opacity` come through `transpileJxMarkdown` exactly as written, and `applyStyleKeyMapping` leaves an already-prefixed key alone.
- The frontmatter root `style` (§7.2) is not mapped at all: YAML writes `":hover"` directly and a bare `placeholder:` stays bare. That is §7.2's contract and does not change.
- The serializer keeps its own copy of the one-colon set (`CSS_PSEUDO_NAMES` in `serialize.ts`, ~663, still listing all four names) and has no pseudo-element arm. jx-markdown.md §12.8 owns that copy: its marker names the `::backdrop` spelling, and its plan moves `collapsePropsToAttrMap` onto `collapseStylePaths`. Today a `::placeholder` key is written `style.::placeholder.color`, which reopens unchanged.
- Tests: `extensions/parser/tests/transpile.test.ts` ("overlay style keys", ~990, and the `applyStyleKeyMapping`/`expandStylePaths`/`collapseStylePaths` blocks, ~136) and `extensions/parser/tests/jx-markdown.test.ts` (the same three helpers) use top-level keys only, and none uses a moved name, a nested name or a string-valued `--` key. One assertion does pin the value-blind mapping: "prefixes known pseudo-class names with :" (`transpile.test.ts`, ~142) expects `applyStyleKeyMapping({ "first-child": "x" })` to be `{ ":first-child": "x" }`, a string value the block-only gate leaves alone. `@jxsuite/runtime` is already a devDependency of the parser and imported by `tests/markdown.test.ts`.

## Outcome

- jx-markdown.md §7.3 → Implemented, its marker removed: `placeholder`, `selection`, `before` and `after` are restored with two colons, every recognised name is restored wherever it names a block, and the escape hatch for any other selector is stated.
- §7.4, §12.4, §12.5 and §12.7 stay unmarked, with bodies that state the every-depth, block-only mapping and the custom-property rule.
- jx-markdown.md stays Partial: §3.1, §6.5, §6.6, §9 and §12.8 remain open. Nothing graduates.

## Decisions

- **Decided:** `placeholder` and `selection` move to `CSS_PSEUDO_ELEMENTS`, because neither has a one-colon form and the element set is already checked first in both directions.
- **Decided:** no compatibility rewrite of `:placeholder` or `:selection` in the runtime or the compiler, because spec.md §9.2 makes a nested key literal selector text that the emitter concatenates, so special-casing two names there would be the only non-literal key in the resolver. The one producer of those keys was the transpiler, a `.md` source is re-transpiled on every read, and no tracked document carries either key, so fixing the transpiler fixes every `.md` document on its next read. A hand-written JSON `:placeholder` is an invalid selector like any other.
- **Decided:** `serialize.ts` is not touched, because the serializer's pseudo-class copy is jx-markdown.md §12.8's item. In the interim a two-colon key is written with its colons (`style.::placeholder.color`, as `::backdrop` is today) and reopens unchanged; a one-colon `:placeholder` typed into Studio's custom-selector dialog is written `style.placeholder.color` and reopens as the corrected `::placeholder`.
- **Decided:** the lists grow only by the moves in this plan; any other pseudo-class or pseudo-element is written with its own colons (`style.::marker.color`), which §7.3 now states, because that form already parses and passes through unchanged and needs no list kept in step with CSS.
- **Open:** do `before` and `after` move to the two-colon set too? Recommendation: yes, because every JSON document in the repository and Studio's Style tab spell them `::before` and `::after`, no tracked `.md` file uses them, the rendered CSS is identical, and once the serializer moves onto `collapseStylePaths` a Studio-authored `::before` can only be written as the §7.3 bare name if `before` maps to `::before`. If declined, they stay in `CSS_PSEUDO_NAMES` and §7.3 drops only the false clause.
- **Open:** is the mapping applied at every depth, and only to keys that hold a block? Recommendation: yes, because §7.3 and §7.4 name no depth and spec.md §9.2 composes selectors and at-rules to any depth in either order, the serializer already writes nested keys unprefixed so a breakpoint-scoped state breaks on every Studio save, and the block-only gate is what keeps a nested custom property (`style.hover.--accent`) a declaration under recursion, which also fixes the dropped top-level `style.--brand`. A block is a plain object that is not a `{ "$ref": … }` binding; arrays (the `@font-face` array form) are values. No tracked `.md` file writes a three-segment style path, so nothing in the repository changes. If declined, §7.3 and §12.5 state "first segment only", and §7.4 gains a Partial marker for the dropped custom property with a stub plan in the same pull request.

## Implementation

Written for the recommended answers to both Open items.

1. **`extensions/parser/src/transpile.ts`**:
   - `CSS_PSEUDO_NAMES`: remove `placeholder`, `selection`, `before`, `after`. Replace its doc comment with: pseudo-CLASS names, restored with one colon (jx-markdown.md §7.3). Keep the overlay-states comment, fixing its stray capital ("Have no way").
   - `CSS_PSEUDO_ELEMENTS`: `new Set(["backdrop", "placeholder", "selection", "before", "after"])`. Doc comment: pseudo-ELEMENT names, restored with two colons; `backdrop`, `placeholder` and `selection` have no one-colon form, so a one-colon rule is discarded by the browser; `before` and `after` have a legacy one CSS still accepts, and take two so a `.md` key matches the one Studio's Style tab and every JSON document write.
   - Add `import { isJsonObject, isRef } from "@jxsuite/schema/guards";` (already a dependency; `serialize.ts` imports `isRef` from it, and `guards.ts` has type-only imports, so the browser-safe `./transpile` entry stays browser-safe). Add a private `isStyleBlock(value: unknown): value is Record<string, unknown>` returning `isJsonObject(value) && !isRef(value)`, with a one-line comment: a nested rule body, as opposed to a declaration value (a string, a `$ref` binding, or the `@font-face` array form).
   - `applyStyleKeyMapping`: for each entry, a non-block value is copied under its own key; a block is first mapped recursively, then keyed `::name`, `:name`, `@--name` or as-is by the existing three arms. Rewrite the JSDoc (the current bullet list is garbled into one sentence): maps every key that holds a block, at every depth; a declaration keeps its name.
   - `collapseStylePaths`: move the key loop into a recursive private `unmapStyleKeys(obj)` with the same gate (a non-block value keeps its key; a block is unmapped recursively, then stripped by the existing `::`, `:` and `@--` arms, keeping the "`::` before `:`" comment) and return `collapseDotPaths(unmapStyleKeys(styleObj))`. JSDoc: inverse of `expandStylePaths` at every depth; a key the mapping would not have produced (`:placeholder`, `::marker`) is kept as written.
   - `expandStylePaths` and `routeAttributes`: code unchanged (both already call `applyStyleKeyMapping`); refresh `expandStylePaths`' JSDoc to say "at every depth".
2. No change in `packages/runtime`, `packages/compiler`, `packages/studio` or `extensions/parser/src/serialize.ts`.

**Integration contract.** `applyStyleKeyMapping`, `expandStylePaths` and `collapseStylePaths` keep their names, signatures and exports (`@jxsuite/parser`, `@jxsuite/parser/transpile`). The pseudo-element names are `backdrop`, `placeholder`, `selection`, `before`, `after` (two colons); the pseudo-class names are the seventeen §7.3 lists (one colon). Both functions act on keys holding a block (a plain object that is not a `$ref`) at every depth and leave every other key as written, and `expandStylePaths(collapseStylePaths(style))` deep-equals `style` for any style built from recognised names, literal-colon keys, breakpoints, declarations and custom properties. `plan:jx-markdown/roundtrip-lossless` may build `collapsePropsToAttrMap` on `collapseStylePaths` and get the §7.3 spelling for every name at every depth by construction, and its string-level corpus may include `::placeholder`, breakpoint-scoped states and custom properties. It lists this plan in `requires`. Until it lands, `serialize.ts` keeps its stale one-colon copy, with the interim spellings stated in Decisions.

## Tests

**`extensions/parser`** (`bun test --isolate --coverage` from `extensions/parser`), in `tests/transpile.test.ts`, beside "overlay style keys" (add `serializeJxMarkdown` from `../src/serialize` and `buildStyleRules` from `@jxsuite/runtime/css` to the imports):

`describe("pseudo-element style keys take two colons")`:

- `placeholder, selection, before and after become pseudo-elements`: `applyStyleKeyMapping` of each bare name with an object value gives `::placeholder`, `::selection`, `::before`, `::after`.
- `the rule is one the browser keeps`: `transpileJxMarkdown('::input{style.placeholder.color="gray" style.selection.color="red"}').children[0].style`, through `buildStyleRules(style, { scope: "#x" })`, has rule texts exactly `["#x::placeholder { color: gray }", "#x::selection { color: red }"]`.
- `each collapses to its bare name and re-expands to itself`: `collapseStylePaths({ "::placeholder": { color: "gray" }, "::before": { content: "'x'" } })` is `{ "placeholder.color": "gray", "before.content": "'x'" }`, and `expandStylePaths` of that equals the input.
- `a key the mapping never writes is kept as written`: `collapseStylePaths({ ":placeholder": { color: "b" }, "::marker": { color: "r" } })` is `{ ":placeholder.color": "b", "::marker.color": "r" }`, and `expandStylePaths` of that equals the input.

`describe("style keys are restored at every depth")`:

- `a state inside a breakpoint, and a breakpoint inside a state`: `::button{style.--md.hover.color="x" style.hover.--md.gap="1rem" style.hover.placeholder.color="y"}` gives `{ "@--md": { ":hover": { color: "x" } }, ":hover": { "@--md": { gap: "1rem" }, "::placeholder": { color: "y" } } }`; with `mediaQueries: { "--md": "(min-width: 768px)" }` and scope `#x`, the rules include selector `#x:hover` under condition `@media (min-width: 768px)` and `#x:hover::placeholder`, and no selector contains a space.
- `a custom property keeps its name, at the top and inside a block`: `::div{style.--accent="teal" style.hover.--accent="navy" style.--glow.ref="#/state/glow"}` gives `{ "--accent": "teal", ":hover": { "--accent": "navy" }, "--glow": { "$ref": "#/state/glow" } }`, and `buildStyleRules({ "--accent": "teal" }, { scope: "#x" })` texts are `["#x { --accent: teal }"]`.
- `only a block is mapped`: `applyStyleKeyMapping({ hover: "x", "first-child": "x", "@font-face": [{ "font-family": "A" }] })` returns all three unchanged.
- `collapseStylePaths inverts every depth`: for `{ "@--md": { ":hover": { color: "x" } }, ":hover": { "@--md": { gap: "1rem" }, "::placeholder": { color: "y" }, "--accent": "navy" }, "--accent": "teal", "--glow": { "$ref": "#/state/glow" } }`, `expandStylePaths(collapseStylePaths(style))` deep-equals `style`.
- `a Studio save and reopen keeps nested states and custom properties`: for `{ tagName: "my-x", children: [{ tagName: "button", style: { "@--dark": { ":hover": { color: "x" } }, "--brand": "red", "::placeholder": { color: "gray" } } }] }`, `transpileJxMarkdown(serializeJxMarkdown(doc))` deep-equals `doc` (it fails today on the first two keys).

The existing cases in `tests/jx-markdown.test.ts` and "overlay style keys" pass unchanged: all use object values and names that do not move. In `tests/transpile.test.ts`, "prefixes known pseudo-class names with :" changes one assertion: its string-valued `{ "first-child": "x" }` becomes `{ "first-child": { color: "x" } }` → `{ ":first-child": { color: "x" } }`, since the string form is now the `only a block is mapped` case.

**Coverage.** No source file is added, so `bun scripts/check-coverage-manifest.ts extensions/parser` is unaffected. The two new private helpers are exercised by the cases above; `transpile.ts` must stay at or above `coverageThreshold = { lines = 0.987, functions = 0.975 }` in `extensions/parser/bunfig.toml`. Ratchet only if the run shows the workspace's worst file moved.

## Specs & docs

**`specs/jx-markdown.md`**, in place:

- **§7.3**: delete the Partial marker, matching every other verified section of this spec, which carries no marker. The first body sentence after the `:` restriction becomes "CSS pseudo-class and pseudo-element names are written **without** their colons inside `style.*` attributes, and the transpiler restores them:". The example is unchanged. The class list becomes "Recognized pseudo-CLASS names, which take one colon: `hover`, `focus`, `active`, `visited`, `disabled`, `checked`, `valid`, `invalid`, `required`, `empty`, `first-child`, `last-child`, `focus-within`, `focus-visible`, `popover-open`, `open`, `modal`." The element paragraph becomes "Recognized pseudo-ELEMENT names, which take **two** colons: `backdrop`, `placeholder`, `selection`, `before`, `after`. A separate set because the prefix differs, not because the concept does. `backdrop`, `placeholder` and `selection` have never had a one-colon form, so a one-colon rule for them is discarded by the browser; `before` and `after` have a legacy one-colon form CSS still accepts, and take two so a `.md` component and Studio's Style tab name the same key." Insert after it: "A name is restored at every depth of the style path, wherever it names a block: `style.--dark.hover.color` is a `:hover` block inside the `@--dark` block (§7.4), and `style.hover.placeholder.color` is a `::placeholder` block inside `:hover`. A key that holds a value rather than a block is a declaration and keeps its name." Keep the "unrecognized name" paragraph and append: "Only the first character of an attribute key is restricted, so a selector outside both lists is written with its own colons after `style.`: `style.::marker.color`, `style.:user-invalid.outline`, `style.:popover-open::backdrop.opacity`. Such a key is kept exactly as written."
- **§7.4**: after the example add: "The `@` is restored at every depth, so a breakpoint may sit inside a state (`style.hover.--md.gap`) as well as around one (§7.3). Only a `--` key that holds a block is a breakpoint: a `--` key given a value (`style.--accent="teal"`, or a binding written `style.--accent.ref="#/state/accent"`) is a CSS custom property, a declaration under spec.md §9.1, and keeps its name."
- **§12.4**: "Like `expandDotPaths`, then applies `applyStyleKeyMapping` (§12.5). Used for style attribute expansion."
- **§12.5**: "Maps the keys of a style object that hold a block, at every depth: pseudo-class names get `:` and pseudo-element names get `::` (§7.3), `--` keys get `@` (§7.4). A block is a plain object that is not a `{ "$ref": … }` binding; any other key is a declaration and is left as written. Used internally by `routeAttributes()` to transform `style.*` dot-path attributes after generic expansion."
- **§12.7**: "Inverse of `expandStylePaths`: strips the `:`, `::` and `@` prefixes §12.5 adds, at every depth, before flattening. A key §12.5 would not have produced, such as `:placeholder` or `::marker`, is kept as written and re-expands to itself."

**Fragment:** `bun run spec:change jx-markdown.md minor -m "§7.3: placeholder, selection, before and after are pseudo-elements restored with two colons, and style keys are restored at every depth wherever they name a block, so a custom property keeps its name."`

**Docs** (no em dashes). No page's `spec:` cites a §7 or §12 anchor; `docs/framework/site/jx-markdown.md` lists `transpile.ts` in `code:` and cites the whole spec.

- `docs/framework/site/jx-markdown.md`, "Style attributes": the first paragraph's last sentence becomes "Pseudo-_elements_ get two colons back: `placeholder`, `selection`, `before`, `after` and `backdrop` become `::placeholder`, `::selection` and so on, the spelling the Style tab writes. Names are restored at any depth, so `style.--dark.hover.color` is a hover rule inside the dark breakpoint." After the "Only recognised names are restored" paragraph add: "Any other pseudo-class or pseudo-element keeps its colons, since only the first character of an attribute key is restricted: `style.::marker.color` works as written. A `--` key that holds a value, such as `style.--accent="teal"`, is a CSS custom property and keeps its name."
- `docs/framework/site/content-collections.md` (lists `md.ts`, unchanged) and `docs/studio/design/states-and-selectors.md` (already says `::placeholder`): no change.

No spec graduates; `plans/jx-markdown/` stays.

## Acceptance

- `bun test --isolate --coverage` from `extensions/parser` passes with the cases above and no per-file threshold failure; `bun scripts/check-coverage-manifest.ts extensions/parser` passes.
- By hand from `extensions/parser`: `transpileJxMarkdown('::input{style.placeholder.color="gray"}').children[0].style` is `{ "::placeholder": { color: "gray" } }` (today `:placeholder`), and `transpileJxMarkdown('::div{style.--brand="red" style.--md.hover.color="x"}')` keeps `--brand` and nests `:hover` under `@--md`.
- `git grep -n '"placeholder"\|"selection"' -- extensions/parser/src/transpile.ts` shows both only in `CSS_PSEUDO_ELEMENTS`.
- `sed -n '/^### 7\.3 /,/^### 7\.4 /p' specs/jx-markdown.md` shows no `Status:` marker and the two lists above; `bun run plans:status --spec jx-markdown` no longer lists `jx-markdown.md#7.3`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
