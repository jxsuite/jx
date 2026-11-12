# @jxsuite/formulas

Composite **pure formulas** for Jx, authored as declarative `$expression` JSON (spec §19.4c). Each formula is a named, parameterized computation (`clamp`, `sum`, `average`, `truncate`, `initials`, …) whose body is built exclusively from blessed operators, pure standard-library method operators (§19.4d), and blessed globals. No JavaScript source anywhere: every formula is inspectable data that the visual editor can open, badge with live values, and recompose.

## Formatting formulas

Six formulas exist to print a stored value from a template (`${state.formatDate($map.item.data.date, {"dateStyle":"long"})}`):

| Formula                        | Gives                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `formatDate(value, options)`   | `Intl/formatDate` in the page's locale; `""` for a `null`, `undefined` or `""` value instead of a throw |
| `formatNumber(value, options)` | `Intl/formatNumber` on the same terms                                                                   |
| `relativeTime(value, unit)`    | `Intl/formatRelativeTime` on the same terms: a signed count of units, `unit` defaulting to `"day"`      |
| `notEmpty(value)`              | `false` for `null`, `undefined`, `""`, `"0"`, `0`, `false`, `NaN` and an empty array (PHP's `empty()`)  |
| `orBlank(value)`               | `""` for `null`, `undefined`, `"0"`, `0` and `false`; the value itself otherwise                        |
| `escapeHtml(text)`             | `&`, `<`, `>`, `"` and `'` as character references; `""` for a missing value                            |

The three `Intl` ones pass `null` as the locale, so the runtime fills in `$page.locale`. A parameter whose input needs more than a text box declares a JSON Schema beside its CEM display text (`{ "text": "Intl.DateTimeFormatOptions", "type": "object", "properties": { "dateStyle": { "enum": [...] } } }`), which is what an editor derives a field from. A pure named formula in a page's state does not make the page dynamic: `jx build` resolves each call and drops the formula unless something left for the client still reads it.

## Consumption model: copy-in, not a project dependency

This package is a **studio/tooling dependency**, deliberately _not_ a runtime or project dependency. Jx documents stay self-contained plain JSON:

- **In Jx Studio**, the formula catalog lists these formulas alongside operators and blessed globals. Picking one **copies its state entry into the document** (vendoring the JSON) and inserts a `call` node referencing it. From that moment the project owns the formula: no package resolution at build or run time, no version coupling, and the user can edit their copy like any other named formula.
- **Programmatically**, `formulaEntries()` returns the catalog as ready-to-merge `state` entries for tooling that seeds documents or `project.json` state (starters, importers, AI agents):

  ```ts
  import { catalog, formulaEntries } from "@jxsuite/formulas";

  const state = { ...formulaEntries() };
  // → { clamp: { $expression: …, parameters: […] }, sum: …, … }
  ```

Because consumption is copy-in, publishing a new package version never changes existing projects. A project upgrades a formula by re-inserting it.

## Authoring a formula

One folder per formula under `formulas/`:

```
formulas/<name>/formula.json     # metadata: name, description, parameters (CEM convention)
formulas/<name>/expression.json  # the pure $expression body over $args/<name> refs
```

Then regenerate the catalog module:

```sh
bun run generate
```

The generator (`bin/generate.ts`) emits `src/catalog.ts` and **fails the build on anything impure**: unknown or mutating operators, or `call` targets outside the blessed pure globals (`window#/Math/…`, `window#/JSON/…`, …). Descriptions are mandatory because they double as editor tooltips and the LLM contract.

## Releases

Versioned independently via release-please (`formulas` component); published to npm with provenance by the repo's publish workflow when a release is cut.
