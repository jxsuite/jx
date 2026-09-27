---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#2.3
requires: []
gaps: []
workspaces:
  - packages/studio
  - docs
  - specs
size: M
---

# Every label Studio generates from a key comes from one helper that keeps abbreviations uppercase and names framework keys

## Context

`specs/studio-ui-guidelines.md` §2.3, line 105:

> **Status: Partial.** Title Case through `camelToLabel()` ships (`packages/studio/src/utils/studio-utils.ts`). The helpers do not keep abbreviations uppercase (`camelToLabel("url")` gives "Url"), and `$prototype` is labelled "Kind", not "Prototype" (`src/panels/signals-panel.ts`).

The section's four bullets: Title Case for all form labels ("not 'fontFamily', 'default', 'desc'"); use `camelToLabel()` from `studio-utils.js`; abbreviations stay uppercase ("URL", "CSS", "ID"); framework keys display as "Source", "Prototype", "Export". Verified against the tree; the census was right on both named failures and missed three more places the first bullet is false.

**Generated labels today (all paths under `packages/studio/src`):**

- `utils/studio-utils.ts`: `camelToLabel` (line 18, `replaceAll(/([A-Z])/g, " $1")` plus an uppercased first letter, so `url` → "Url" and `imageURL` → "Image U R L"), `kebabToLabel` (line 35), `propLabel` (line 49, `$label` else `camelToLabel`) and `attrLabel` (line 63, `$label`, else its own inline kebab rule, so `aria-label` → "Aria Label", else `camelToLabel`). Tested in `tests/studio-utils.test.ts`, which pins "Aria Label" and "Tabindex".
- Callers: `ui/form-controls.ts:254` (schema builder card), `settings/defs-editor.ts:292` (`$defs` card), `panels/properties-panel.ts:1534`, `:1569`, `:1649` (component-prop rows, their option labels, attribute rows), `panels/style-panel.ts:1055`, `:1284`, `:1730` (`propLabel`) and `:824` (`keywordLabel`, a third capitaliser over `kebabToLabel`), `ui/color-selector.ts:59` (token names).
- A copy of the regex inline: `panels/frontmatter-fields.ts:204`.
- A fourth rule: `titleForField` in `grid/schema-columns.ts:76` (data-grid column titles), which is sentence case for snake_case (`cover_image` → "Cover image", pinned in `tests/grid-schema-columns.test.ts`).
- **Not generated at all:** `ui/schema-form.ts` labels each row with the raw key (`label: prop`, line 916) and each array-row cell likewise (`label: cellKey`, line 1132); `tests/schema-form.test.ts:287` pins `"title"`. That engine draws every schema-driven form: extension source configs in the Data panel (`panels/signals-panel.ts` `placeSchemaForm`), contributed Project Settings sections (`settings/contributed-section.ts`) and the content entry editor (`content/entry-editor.ts`). So the entry editor titles a field "pubDate" while the frontmatter panel titles the same field "Pub Date", and one Data panel entry mixes hand-cased rows ("Name", "Source") with raw ones ("contentType", "limit").
- HTML attributes whose words run together have no `$label` in `data/html-meta.json` (hand-maintained; six entries carry one, e.g. `id` → "ID", `popovertarget` → "Opens popover"), so they print "Tabindex", "Maxlength", "Readonly", "Colspan".

**Framework keys:** `panels/signals-panel.ts` hand-writes "Source" (lines 878, 1163) and "Export" (890, 1164), and "Kind" for `$prototype` (882, `textField(name, "kind", "Kind", …)`); `tests/signals-panel-schema.test.ts` finds the rows by that label (`[data-prop="Kind"]`, `["Name", "Source", "Kind"]`). `docs/studio/logic/data-sources.md` says "(**Source** and **Kind** fields)".

**Docs that name schema-form rows by raw key:** `docs/studio/logic/data-sources.md`, `docs/start/first-collection.md`, `docs/studio/data/connections.md`, `docs/studio/data/auth-and-secrets.md`, `docs/studio/data/tables.md` (e.g. **contentType**, **databaseId**, **urlEnv**, **ownerField**), and `docs/extending/extensions/project-sections.md:100` ("field labels … come from the project fragment's schema").

**What is missing:** one abbreviation-aware helper every generated label goes through; the schema form, frontmatter fields and grid columns on it; the framework-key names in one table; the run-together attribute names split; §2.3's helper path corrected (`studio-utils.ts`, not `studio-utils.js`, and now a different module).

No gap in §14 binds §2.3. `studio.md` §6.1 (Property Panel) titles its rows with these labels but states no label rule of its own.

## Outcome

- `studio-ui-guidelines.md` §2.3 → Implemented: every key-derived label goes through `keyToLabel()`/`propLabel()` in `packages/studio/src/utils/labels.ts`; the bullets name that module, the abbreviation rule and the framework-key table.
- `studio-ui-guidelines.md` §10's "Labels are Title Case" item becomes true of the schema-driven forms too (the item is owned by `plan:studio-ui-guidelines/conventions-checklist`).

## Decisions

- **Open:** what does the `$prototype` row read? Recommendation: "Prototype", as §2.3 says, because the other two framework rows already take their key's own word (`$src` → Source, `$export` → Export), the docs already teach the key by name (the note under External sources: "a `$prototype` naming the kind"), and a friendly name that renames rather than expands is the drift the table exists to stop. If "Kind" is kept, the only differences are `FRAMEWORK_KEY_LABELS.$prototype` and the §2.3 bullet, which then says why.
- **Open:** do schema-driven forms (and the data grid's column titles, which label the same fields) join the convention, or are they exempt because the key is what the author writes in `project.json`? Recommendation: join, with a JSON Schema `title` winning over the generated label, because §2.3's first bullet says all form labels and the same field is otherwise titled two ways in two editors; `title` is the standard annotation for exactly this and gives an extension a way to label `urlEnv` better than "URL Env". The cost is the six docs pages below, which switch to the drawn label and keep the key in code where they teach `project.json`. The exemption would instead rewrite §2.3's first bullet to carve out `ui/schema-form.ts` and drop the schema-form, grid and docs steps.
- **Open:** do HTML attributes whose words run together get a `$label`? Recommendation: yes, for the eight whose halves are English words: `tabindex` → "Tab Index", `maxlength` → "Max Length", `minlength` → "Min Length", `readonly` → "Read Only", `colspan` → "Column Span", `rowspan` → "Row Span", `aria-describedby` → "ARIA Described By", `aria-labelledby` → "ARIA Labelled By", because no splitter can find a word boundary in a lowercase run and `html-meta.json` already labels `id` and `popovertarget` this way. HTML's own short names (`src`, `href`, `alt`, `rel`, `srcset`, `autocomplete`, `autoplay`) keep their Title Case, because an attribute row names the attribute an author looks up, and §2.3's friendly-name rule is scoped to framework `$` keys.
- **Decided:** `implement`, not `reconcile`: the four rules are right and the code is short.
- **Decided:** the helpers live in a new dependency-free module, `src/utils/labels.ts`, because `ui/schema-form.ts` is a deliberately light engine and `studio-utils.ts` imports `store` (through `content/collection-match`) and `format/format-host`.
- **Decided:** `keyToLabel` replaces `camelToLabel`, `kebabToLabel`, `attrLabel`'s inline branch, `keywordLabel`, `titleForField` and the frontmatter copy, and `propLabel` moves beside it and reads `$label`, then `title`, then `keyToLabel`, because six rules for one job is how "Url", "Aria Label" and "Cover image" happened.
- **Decided:** the abbreviation set is a closed, exported `LABEL_ABBREVIATIONS`, matched on whole words only (so `valid` and `grid` are untouched), with a plural rule (`ids` → "IDs"); §2.3 names the constant and gives examples rather than copying the list, so the list has one home.
- **Decided:** framework keys resolve through `FRAMEWORK_KEY_LABELS` inside `keyToLabel`, and the signals panel reads its three rows from it instead of hand-writing them, so the bullet has one table and a test.
- **Decided:** out of scope, because they are not labels generated from a key: capitalising a single name (`editor/convert-targets.ts`, `browse/library-model.ts`, `browse/library-pane.ts`, `surfaces/statusbar.ts`, `commands/keymap.ts`), and the schema form's sentence-case action text (`addLabel` "Add sort", `removeLabel`), which matches "Add case" and "Add statement" elsewhere.

## Implementation

All paths under `packages/studio/`.

1. **New `src/utils/labels.ts`**, no imports:
   - `export const LABEL_ABBREVIATIONS: ReadonlySet<string>`: `api aria css html http https id json ltr rtl seo sql svg ui uri url uuid` (lowercase keys).
   - `export const FRAMEWORK_KEY_LABELS: Readonly<Record<string, string>>`: `{ $export: "Export", $prototype: "Prototype", $src: "Source" }`.
   - `export function keyToLabel(key: string): string`: a key in `FRAMEWORK_KEY_LABELS` returns its entry; otherwise strip one leading `$`, split on runs of `-`, `_` and whitespace, split each part at `([a-z0-9])([A-Z])`, then at `([A-Z]+)([A-Z][a-z])` except where that lowercase letter is a word-final `s` (so a run of capitals stays one word: `imageURL` → image/URL, `URLPath` → URL/Path, `IndexedDB` → Indexed/DB, and `URLs` stays whole), drop empties, and map each word: lowercase form in the set → uppercase; lowercase form is a set member plus `s` → uppercase stem plus `s`; otherwise first letter uppercased, the rest untouched. Join with one space. `""` → `""`; the function is idempotent (`keyToLabel("Font Family")` is "Font Family").
   - `export function propLabel(entry: { $label?: unknown; title?: unknown } | null | undefined, key: string): string`: a non-empty string `$label`, else a non-empty string `title`, else `keyToLabel(key)`.
2. **`src/utils/studio-utils.ts`**: delete `camelToLabel`, `kebabToLabel`, `propLabel`, `attrLabel`.
3. **Callers:**
   - `src/ui/form-controls.ts:254` and `src/settings/defs-editor.ts:292`: `label: propLabel(schema, key)`.
   - `src/panels/properties-panel.ts`: `:1534` `keyToLabel(prop.name)`; `:1569` option labels `keyToLabel(o)`; `:1649` `propLabel(entry, attr)`.
   - `src/panels/style-panel.ts`: import `propLabel` from `../utils/labels`; delete `keywordLabel` (its comment's "`Inline block`" was already wrong) and have `keywordChoices` use `keyToLabel`.
   - `src/ui/color-selector.ts:59`: `keyToLabel(name.replace(/^--color-?/, "")) || name`.
   - `src/panels/frontmatter-fields.ts:204`: `propLabel(entry, field)`; `FmSchemaEntry` gains `title?: string`.
   - `src/ui/schema-form.ts`: `JsonSchema` gains `title?: string`; `deriveField`'s row `label: propLabel(ps, prop)` (line 916); `deriveCell`'s `label: propLabel(cellSchema, cellKey)` (line 1132). `addLabel`/`removeLabel` unchanged. The `"${label} pointer"` and `"${label} source"` names in `surfaces/schema-form.json` follow the label with no edit.
   - `src/grid/schema-columns.ts`: delete `titleForField`; `columnsFromSchema` titles `propLabel(prop, field)`, `inferColumnsFromRows` titles `keyToLabel(field)`.
   - `src/panels/signals-panel.ts`: the `src`, `kind` and `export` rows in `externalFields` (878, 882, 890) and `functionFields` (1163, 1164) take `keyToLabel("$src")`, `keyToLabel("$prototype")`, `keyToLabel("$export")`. Row keys stay `src`, `kind`, `export`.
4. **`data/html-meta.json`**: add `"$label"` to the eight entries named in Decisions.

**Integration contract:** once this lands, `packages/studio/src/utils/labels.ts` exports `keyToLabel`, `propLabel`, `LABEL_ABBREVIATIONS` and `FRAMEWORK_KEY_LABELS`, and `camelToLabel`, `kebabToLabel`, `attrLabel` and `titleForField` no longer exist. Any surface that titles a row, cell or column from a key calls one of the two functions; a schema's `title` or a metadata `$label` always wins. `plan:studio-ui-guidelines/conventions-checklist` may treat §10's "Labels are Title Case" item as true for every form, schema-driven ones included.

## Tests

From `packages/studio`: `bun test --isolate --coverage`.

- **New `tests/labels.test.ts`** (the `camelToLabel`, `kebabToLabel`, `propLabel` and `attrLabel` blocks move here from `tests/studio-utils.test.ts`, re-expressed against the new names):
  - `splits camelCase, kebab-case and snake_case into Title Case words`: `backgroundColor` → "Background Color", `border-box` → "Border Box", `cover_image` → "Cover Image", `zIndex` → "Z Index".
  - `keeps a run of capitals as one word`: `imageURL` → "Image URL", `URLPath` → "URL Path", `innerHTML` → "Inner HTML", `IndexedDB` → "Indexed DB".
  - `uppercases a known abbreviation as a whole word only`: `url` → "URL", `baseUrl` → "Base URL", `aria-label` → "ARIA Label", `userId` → "User ID"; `valid` → "Valid", `sqlite` → "Sqlite".
  - `keeps a plural abbreviation's s lowercase`: `ids` → "IDs", `userIds` → "User IDs", `imageURLs` → "Image URLs".
  - `names framework keys from the table and strips any other leading $`: each `FRAMEWORK_KEY_LABELS` key maps to its value; `$handler` → "Handler".
  - `is idempotent and empty-safe`: `keyToLabel(keyToLabel(k)) === keyToLabel(k)` over every fixture above, plurals included; `""` → `""`.
  - `propLabel prefers $label, then title, then the key`: `{ $label: "ID" }`, `{ title: "Connection URL" }`, `{}`, `null`, and a `$label` of `""` falling through.
- `tests/studio-utils.test.ts`: the four moved blocks deleted.
- `tests/schema-form.test.ts`: line 287 expects "Title"; new `a row is labelled by its schema title, else by its key as a label` (`baseUrl` → "Base URL", `urlEnv` with `title: "Connection URL"` → "Connection URL"); new `an array row's cells are labelled like rows` (an array of `{ field, order }` objects: cell labels "Field", "Order").
- `tests/grid-schema-columns.test.ts`: the `titleForField` block becomes `column titles are labels` through `columnsFromSchema` (`cover_image` → "Cover Image", `userId` → "User ID", a `title` annotation wins) and `inferColumnsFromRows` (`publishDate` → "Publish Date").
- `tests/signals-panel-schema.test.ts`: "Kind" → "Prototype" in the `an external prototype's own rows` block (selectors, `fieldEl` calls, the `["Name", "Source", "Prototype"]` list, test names).
- `tests/head-panel.test.ts`: in `without a schema, fields are inferred from the frontmatter values`, add `coverUrl: "/a.png"` and expect its `[part="row-name"]` to read "Cover URL".
- `tests/properties-panel.test.ts`: new `attribute rows use metadata labels and keep abbreviations uppercase`: with an element carrying `aria-label` and `tabindex` selected, `row(c, "aria-label")` reads "ARIA Label" and `row(c, "tabindex")` reads "Tab Index" in `[part="row-name"]`.

Coverage: `labels.ts` is fully unit-tested (100% lines and functions), comfortably above the per-file floor in `packages/studio/bunfig.toml` (`lines = 0.958, functions = 0.941`); it ships with its test, so `bun scripts/check-coverage-manifest.ts packages/studio` finds it. No existing file's minimum moves enough to ratchet. `tests/reachability.test.ts` must stay green: every new export has a caller.

## Specs & docs

**`specs/studio-ui-guidelines.md` §2.3, in place:**

- The Partial marker is replaced by an Implemented one reading: Every label Studio generates from a key goes through `packages/studio/src/utils/labels.ts`.
- Bullet 1 unchanged.
- Bullet 2 becomes: "A label is generated, never hand-cased: `keyToLabel()` (`src/utils/labels.ts`) splits camelCase, kebab-case and snake_case into words and capitalises each, and `propLabel()` lets metadata name the label first (`$label` in `data/css-meta.json` and `data/html-meta.json`, then a JSON Schema `title`). The Inspector's rows, the schema builder and `$defs` editor, the frontmatter fields, every schema-driven form and the data grid's column titles use them."
- Bullet 3 becomes: "Abbreviations stay uppercase: a run of capitals is one word ("imageURL" → "Image URL"), and a whole word in `LABEL_ABBREVIATIONS` is uppercased ("url" → "URL", "aria-label" → "ARIA Label", "ids" → "IDs")."
- New bullet after it: "An attribute whose words HTML runs together names them in its `$label`: "tabindex" → "Tab Index", "maxlength" → "Max Length"."
- Bullet 4 becomes: "Framework-internal keys are displayed as friendly names from `FRAMEWORK_KEY_LABELS`: `$src` → "Source", `$prototype` → "Prototype", `$export` → "Export"."

Fragment: `bun run spec:change studio-ui-guidelines.md minor -m "Label Conventions (§2.3) is implemented: one helper generates every label from a key, keeps abbreviations uppercase and names framework keys, and schema-driven forms and data-grid columns now use it."`

Not a graduation: the spec keeps other open items.

**Docs** (no em dashes; bold the label as Studio draws it; where a page teaches `project.json`, follow the first mention with the key in code, e.g. "**Database ID** (`databaseId`)"):

- `docs/studio/logic/data-sources.md`: "(**Source** and **Kind** fields)" → "**Prototype**"; the ContentCollection list (**Content Type**, **Filter**, **Field**, **Op**, **Value**, **Sort**, **Order**, **Limit**), the database sources (**Table**, **Limit**, **Offset**, **Include**, **ID**, **Values**) and the account sources (**Base URL**, **Redirects**, **Provider**). The Session value's `userId` is a value, not a label, and stays.
- `docs/start/first-collection.md`: step 4's **contentType** and **sort** → **Content Type** and **Sort**, and the image's alt text to match.
- `docs/studio/data/connections.md`: **provider**, **file**, **binding**, **databaseId**, **accountId**, **urlEnv**, **hyperdriveId** → drawn labels with keys.
- `docs/studio/data/auth-and-secrets.md`: the Authentication settings list and the table's **ownerField** → drawn labels with keys. The Session's **id**, **user**, **role** (line 90) are values and stay.
- `docs/studio/data/tables.md`: Table options and the table sources' fields → drawn labels with keys.
- `docs/extending/extensions/project-sections.md:100`: say a field's label is its schema `title`, else its key in Title Case (`databaseId` reads "Database ID").

`bun run docs:sync` will also name the pages whose `code:` lists a changed file (`docs/studio/logic.md`, `logic/data.md`, `editing/frontmatter.md`, `projects/settings.md`, `design/properties.md`, `design/components.md`, `design/style-inspector.md`, `design/stylebook.md`, `design/states-and-selectors.md`, `design/tokens.md`, `docs/README.md`): none of them names a label this plan changes, so none changes; say so in the pull request. The screenshots lane re-captures the shots these forms appear in (`blog-collection-state` at least); re-read the pages its comment lists.

## Acceptance

- `git grep -nE '\b(camelToLabel|kebabToLabel|attrLabel|titleForField|keywordLabel)\b' -- packages/studio` finds nothing, nor does `git grep -n '"Kind"' -- packages/studio/src`.
- `git grep -n 'replaceAll(/(\[A-Z\])/g' -- packages/studio/src` finds nothing (the inline copy is gone).
- From `packages/studio`: `bun test --isolate --coverage` is green with `src/utils/labels.ts` at 100%, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run plans:check` reports `studio-ui-guidelines.md#2.3` closed, and the pull request deletes this file; `bun run docs:status`, `docs:spec-release`, `docs:check`, `docs:links` and `docs:prose` are green.
- In Studio: a Data panel "From a module…" entry shows Source and Prototype; a ContentCollection entry shows Content Type, Filter, Sort, Limit; the content entry editor and the frontmatter panel title the same field alike; an element's attribute rows read "ARIA Label" and "Tab Index"; Project Settings → Connections shows "Database ID".
