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

The section's four bullets: Title Case for all form labels ("not 'fontFamily', 'default', 'desc'"); use `camelToLabel()` from `studio-utils.js`; abbreviations stay uppercase ("URL", "CSS", "ID"); framework keys display as "Source", "Prototype", "Export". Verified against the tree; the census was right on both named failures and missed several more places the first bullet is false.

**Generated labels today (all paths under `packages/studio/src`):**

- `utils/studio-utils.ts`: `camelToLabel` (line 18, `replaceAll(/([A-Z])/g, " $1")` plus an uppercased first letter, so `url` → "Url" and `imageURL` → "Image U R L"), `kebabToLabel` (line 35), `propLabel` (line 49, `$label` else `camelToLabel`) and `attrLabel` (line 63, `$label`, else its own inline kebab rule, so `aria-label` → "Aria Label", else `camelToLabel`). Tested in `tests/studio-utils.test.ts`, which pins "Aria Label" and "Tabindex".
- Callers: `ui/form-controls.ts:254` (schema builder card), `settings/defs-editor.ts:292` (`$defs` card), `panels/properties-panel.ts:1534`, `:1569`, `:1649` (component-prop rows, their option labels, attribute rows), `panels/style-panel.ts:1055`, `:1284`, `:1730` (`propLabel`) and `:824` (`keywordLabel`, a third capitaliser over `kebabToLabel`, which labels every keyword row's options, `enum` and `examples` alike), `ui/color-selector.ts:59` (token names).
- A copy of the regex inline: `panels/frontmatter-fields.ts:204`.
- A fourth rule: `titleForField` in `grid/schema-columns.ts:76` (data-grid column titles), which is sentence case for snake_case (`cover_image` → "Cover image", pinned in `tests/grid-schema-columns.test.ts`).
- **Not generated at all:** `ui/schema-form.ts` labels each row with the raw key (`label: prop`, line 916) and each array-row cell likewise (`label: cellKey`, line 1132), and builds its add and remove buttons' names from it (`Add ${prop}`, line 902; `Remove ${prop} ${n}`, line 1112, so the auth settings draw "Add trustedOrigins"); `tests/schema-form.test.ts:287` pins `"title"`. That engine draws every schema-driven form: extension source configs in the Data panel (`panels/signals-panel.ts` `placeSchemaForm`), contributed Project Settings sections (`settings/contributed-section.ts`) and the content entry editor (`content/entry-editor.ts`). So the entry editor titles a field "pubDate" while the frontmatter panel titles the same field "Pub Date", and one Data panel entry mixes hand-cased rows ("Name", "Source") with raw ones ("contentType", "limit"). Also raw: a media field's accessible name (`ui/media-picker.ts:315`, `label: prop`, pinned as "src" and "poster" in `tests/media-picker.test.ts`), and a settings section's heading when it declares no title (`settings/contributed-section.ts:404`, `contribution.title ?? sectionKey`; `settings/extension-sections.ts:68`, `… ?? key`; pinned in `tests/contributed-section.test.ts:221` and `tests/extension-sections.test.ts:167`).
- HTML attributes whose words run together have no `$label` in `data/html-meta.json` (hand-maintained; six entries carry one, e.g. `id` → "ID", `popovertarget` → "Opens popover"), so they print "Tabindex", "Maxlength", "Readonly", "Colspan".

**Hand-written field labels:** the first bullet is also false where nothing is generated. Of the multi-word literal labels on a `jx-field` or a `[part="field-label"]` in `src/surfaces/*.json`, twelve are sentence case: "Repository name" (`github-publish.json`), "Items source" and "New definition name" (`convert-repeater.json`), "Minimum fidelity" (`new-project.json`), "API token", "Pages project name", "GitHub owner", "GitHub repository", "Production branch" (`publish.json`), "Script body" and "Style body" (`settings-head.json`), "Base width" (`settings-contexts.json`), beside thirteen in Title Case ("Site URL", "Crawl Depth", "Default Language", …). `data/html-meta.json`'s "Opens popover" is the one metadata `$label` in sentence case. `new-project.json`'s "What should the assistant do with it?" is a question, not a name.

**Framework keys:** `panels/signals-panel.ts` hand-writes "Source" (lines 878, 1163) and "Export" (890, 1164), and "Kind" for `$prototype` (882, `textField(name, "kind", "Kind", …)`); the row's `data-prop` is its label (`field()`, line 523), and `tests/signals-panel-schema.test.ts` (`[data-prop="Kind"]`, `["Name", "Source", "Kind"]`) and `tests/signals-panel-template.test.ts:654` find it by that label. `docs/studio/logic/data-sources.md` says "(**Source** and **Kind** fields)".

**Docs that name schema-form rows by raw key:** `docs/studio/logic/data-sources.md`, `docs/start/first-collection.md`, `docs/studio/data/connections.md`, `docs/studio/data/auth-and-secrets.md`, `docs/studio/data/tables.md` (e.g. **contentType**, **databaseId**, **urlEnv**, **ownerField**), and `docs/extending/extensions/project-sections.md:100` ("field labels … come from the project fragment's schema").

**What is missing:** one abbreviation-aware helper every generated label goes through; the schema form, frontmatter fields, media field, section headings and grid columns on it; the framework-key names in one table; the run-together attribute names split; the sentence-case field labels decided; §2.3's helper path corrected (`studio-utils.ts`, not `studio-utils.js`, and now a different module).

No gap in §14 binds §2.3. `studio.md` §6.1 (Property Panel) titles its rows with these labels but states no label rule of its own.

## Outcome

- `studio-ui-guidelines.md` §2.3 → Implemented: every key-derived label goes through `keyToLabel()`/`propLabel()` in `packages/studio/src/utils/labels.ts`, and every hand-written field label is Title Case under a test; the bullets name that module, the abbreviation rule and the framework-key table.
- `studio-ui-guidelines.md` §10's "Labels are Title Case" item becomes true of the schema-driven forms and the hand-written field labels too. The item is owned by `plan:studio-ui-guidelines/conventions-checklist`, whose Decisions say that half of the item "ships"; it does not until this plan lands, so that plan should add this one to its `requires`.

## Decisions

- **Open:** what does the `$prototype` row read? Recommendation: "Prototype", as §2.3 says, because the other two framework rows already take their key's own word (`$src` → Source, `$export` → Export), the docs already teach the key by name (the note under External sources: "a `$prototype` naming the kind"), and a friendly name that renames rather than expands is the drift the table exists to stop. If "Kind" is kept, the only differences are `FRAMEWORK_KEY_LABELS.$prototype`, the §2.3 bullet (which then says why) and the two test files that stop changing.
- **Open:** do schema-driven forms (and the content grid's column titles, which label the same fields) join the convention, or are they exempt because the key is what the author writes in `project.json`? Recommendation: join, with a JSON Schema `title` winning over the generated label, because §2.3's first bullet says all form labels and the same field is otherwise titled two ways in two editors; `title` is the standard annotation for exactly this and gives an extension a way to label `urlEnv` better than "URL Env" (no extension schema sets a property `title` today, so nothing reads differently for that). The cost is the six docs pages below, which switch to the drawn label and keep the key in code where they teach `project.json`. Two grids stay as they are either way: a database table's grid titles columns with the SQL column name (`grid/sources/connector-source.ts:107`, `title: meta.name`), because there the column name is the contract the author writes in filters and the push plan names, and a CSV grid titles them with its header row. The exemption would instead rewrite §2.3's first bullet to carve out `ui/schema-form.ts` and drop the schema-form, grid and docs steps.
- **Open:** do HTML attributes whose name runs words together get a `$label`? Recommendation: yes, for the eight that join two words an author would write apart: `tabindex` → "Tab Index", `maxlength` → "Max Length", `minlength` → "Min Length", `readonly` → "Read Only", `colspan` → "Col Span", `rowspan` → "Row Span", `aria-describedby` → "ARIA Described By", `aria-labelledby` → "ARIA Labelled By", because no splitter can find a word boundary in a lowercase run and `html-meta.json` already labels `id` and `popovertarget` this way. The label splits the name and renames nothing, because an attribute row names the attribute an author looks up: `colspan` reads "Col Span", not "Column Span", and `src`, `href`, `alt`, `rel` and `srcset` keep their Title Case. `autocomplete` and `autoplay` are single English words and keep theirs. §2.3's friendly-name rule is scoped to framework `$` keys.
- **Open:** are hand-written field labels held to the first bullet? Recommendation: yes. Title-case the twelve sentence-case field labels listed in Context and `html-meta.json`'s "Opens popover" → "Opens Popover", and add a test that walks every literal field label and metadata `$label`, because §2.3 says all form labels, most hand-written field labels already comply, and without a check the next surface adds another. A question-form label stays a sentence. Menu items, buttons, headings and accessible names are not form labels and do not change. The alternative rewrites the first bullet to cover generated labels only, and leaves forms such as the new-project wizard mixing "Project Name" with "Minimum fidelity".
- **Decided:** `implement`, not `reconcile`: the four rules are right and the code is short.
- **Decided:** the helpers live in a new dependency-free module, `src/utils/labels.ts`, because `ui/schema-form.ts` is a deliberately light engine and `studio-utils.ts` imports `store` (through `content/collection-match`) and `format/format-host`.
- **Decided:** `keyToLabel` replaces `camelToLabel`, `kebabToLabel`, `attrLabel`'s inline branch, `keywordLabel`'s capitalising, `titleForField` and the frontmatter copy, and `propLabel` moves beside it and reads `$label`, then `title`, then `keyToLabel`, because six rules for one job is how "Url", "Aria Label" and "Cover image" happened.
- **Decided:** a style keyword option goes through `keyToLabel` only when it is a bare keyword (`/^[a-z]+(?:[- ][a-z]+)*$/`: `inline-block` → "Inline Block", `top left` → "Top Left"); any other value (a function, a number, a length list) is its own label, verbatim. The keyword rows also list css-meta's `examples` (`style-panel.ts` `fieldRow`, "combobox" case), and a word splitter run over `translateX(0)`, `linear-gradient(to bottom, #fff, #000)` or `0 1px 3px rgba(0,0,0,0.12)` prints "Translate X(0)", "Linear Gradient(to Bottom, …" and "0 1px 3px Rgba(…)"; today's `keywordLabel` already prints "TranslateX(0)" and "Linear Gradient(to bottom, …".
- **Decided:** text that embeds a key inside a sentence (the schema form's add and remove buttons) uses `keyToPhrase`, the same words lowercased except abbreviations and runs of capitals (`trustedOrigins` → "trusted origins", `userIds` → "user IDs"), so the button reads "Add trusted origins" beside the row "Trusted Origins" and matches Studio's other add actions ("Add case", "Add statement").
- **Decided:** the abbreviation set is a closed, exported `LABEL_ABBREVIATIONS`, matched on whole words only (so `valid` and `grid` are untouched), with a plural rule (`ids` → "IDs"); §2.3 names the constant and gives examples rather than copying the list, so the list has one home. It covers every abbreviation in a key the repository's schemas and fixtures use today (`accountId`, `baseUrl`, `reportUri`, `clientIdEnv`, …).
- **Decided:** framework keys resolve through `FRAMEWORK_KEY_LABELS` inside `keyToLabel`, and the signals panel reads its three rows from it instead of hand-writing them, so the bullet has one table and a test.
- **Decided:** out of scope, because they are not labels generated from a key: capitalising a single name (`editor/convert-targets.ts`, `browse/library-model.ts`, `browse/library-pane.ts`, `surfaces/statusbar.ts`, `commands/keymap.ts`); names shown as the author wrote them (a schema form's `enum` choices, which are content type and connection names, import and formula names in the Data panel, a custom CSS property's `kv` row); and action text that quotes an attribute or property by its name (`Clear ${attr}`, `Remove ${prop}` in the Inspector).

## Implementation

All paths under `packages/studio/`.

1. **New `src/utils/labels.ts`**, no imports:
   - `export const LABEL_ABBREVIATIONS: ReadonlySet<string>`: `api aria css html http https id json ltr rtl seo sql svg ui uri url uuid` (lowercase keys).
   - `export const FRAMEWORK_KEY_LABELS: Readonly<Record<string, string>>`: `{ $export: "Export", $prototype: "Prototype", $src: "Source" }`.
   - A module-private word splitter, shared by the two functions below: strip one leading `$`, split on runs of `-`, `_` and whitespace, split each part at `([a-z0-9])([A-Z])`, then at `([A-Z]+)([A-Z][a-z])` except where that lowercase letter is a word-final `s` (so a run of capitals stays one word: `imageURL` → image/URL, `URLPath` → URL/Path, `IndexedDB` → Indexed/DB, and `URLs` stays whole), drop empties, and map each word: lowercase form in the set → uppercase; lowercase form is a set member plus `s` → uppercase stem plus `s`; otherwise first letter uppercased, the rest untouched.
   - `export function keyToLabel(key: string): string`: a key in `FRAMEWORK_KEY_LABELS` returns its entry; otherwise the splitter's words joined with one space. `""` → `""`; the function is idempotent (`keyToLabel("Font Family")` is "Font Family").
   - `export function keyToPhrase(key: string): string`: `keyToLabel(key)`'s words, each lowercased unless its second character is uppercase (an abbreviation or a run of capitals), joined with one space: `trustedOrigins` → "trusted origins", `userIds` → "user IDs", `$src` → "source".
   - `export function propLabel(entry: { $label?: unknown; title?: unknown } | null | undefined, key: string): string`: a non-empty string `$label`, else a non-empty string `title`, else `keyToLabel(key)`. The parameter is a weak type, so a caller whose entry type has neither property must gain one (step 3's `SchemaProperty`).
2. **`src/utils/studio-utils.ts`**: delete `camelToLabel`, `kebabToLabel`, `propLabel`, `attrLabel`.
3. **Callers:**
   - `src/settings/schema-field-ui.ts`: `SchemaProperty` gains `title?: string`. Then `src/ui/form-controls.ts:254` and `src/settings/defs-editor.ts:292`: `label: propLabel(schema, key)`.
   - `src/panels/properties-panel.ts`: `:1534` `keyToLabel(prop.name)`; `:1569` option labels `keyToLabel(o)`; `:1649` `propLabel(entry, attr)`.
   - `src/panels/style-panel.ts`: import `propLabel` and `keyToLabel` from `../utils/labels`; `keywordLabel(v)` becomes `KEYWORD.test(v) ? keyToLabel(v) : v` with `KEYWORD` the pattern in Decisions (its comment's "`Inline block`" was already wrong; it reads "Inline Block").
   - `src/ui/color-selector.ts:59`: `keyToLabel(name.replace(/^--color-?/, "")) || name`.
   - `src/panels/frontmatter-fields.ts:204`: `propLabel(entry, field)`; `FmSchemaEntry` gains `title?: string`.
   - `src/ui/schema-form.ts`: `JsonSchema` gains `title?: string`; `deriveField`'s row `label: propLabel(ps, prop)` (line 916), and its `addLabel` (line 902) interpolates `keyToPhrase(prop)` where it had `prop`; `deriveCell`'s `label: propLabel(cellSchema, cellKey)` (line 1132); the array row's `removeLabel` (line 1112) likewise interpolates `keyToPhrase(prop)`. The `"${label} pointer"` and `"${label} source"` names in `surfaces/schema-form.json` follow the label with no edit.
   - `src/ui/media-picker.ts:315`: `label: keyToLabel(prop)`, so the field's accessible name contains the row label it sits under (the rows are `keyToLabel(prop.name)`, an attribute without a `$label`, "Default", a column title).
   - `src/settings/contributed-section.ts:404`: `contribution.title ?? keyToLabel(sectionKey)`; `src/settings/extension-sections.ts:68`: `settings.label ?? info.project.title ?? keyToLabel(key)`.
   - `src/grid/schema-columns.ts`: delete `titleForField`; `columnsFromSchema` titles `propLabel(prop, field)`, `inferColumnsFromRows` titles `keyToLabel(field)`.
   - `src/panels/signals-panel.ts`: the `src`, `kind` and `export` rows in `externalFields` (878, 882, 890) and `functionFields` (1163, 1164) take `keyToLabel("$src")`, `keyToLabel("$prototype")`, `keyToLabel("$export")`. Row keys stay `src`, `kind`, `export`; the rows' `data-prop` follows the label.
4. **`data/html-meta.json`**: add `"$label"` to the eight entries named in Decisions, and `popovertarget`'s becomes "Opens Popover".
5. **Hand-written field labels** (the fourth Open decision): title-case the twelve surface labels listed in Context, in `src/surfaces/*.json` ("Repository Name", "Items Source", "New Definition Name", "Minimum Fidelity", "API Token", "Pages Project Name", "GitHub Owner", "GitHub Repository", "Production Branch", "Script Body", "Style Body", "Base Width"). Error and help text that quotes a label ("Repository name is required") is prose and keeps its case.

**Integration contract:** once this lands, `packages/studio/src/utils/labels.ts` exports `keyToLabel`, `keyToPhrase`, `propLabel`, `LABEL_ABBREVIATIONS` and `FRAMEWORK_KEY_LABELS`, and `camelToLabel`, `kebabToLabel`, `attrLabel`, `titleForField` and `keywordLabel`'s own capitaliser no longer exist. Any surface that titles a row, cell, column, field or section from a key calls `keyToLabel` or `propLabel`; a schema's `title` or a metadata `$label` always wins; a literal field label in a surface document is Title Case or a test fails. `plan:studio-ui-guidelines/conventions-checklist` may treat §10's "Labels are Title Case" item as true for every form, schema-driven ones included.

## Tests

From `packages/studio`: `bun test --isolate --coverage`.

- **New `tests/labels.test.ts`** (the `camelToLabel`, `kebabToLabel`, `propLabel` and `attrLabel` blocks move here from `tests/studio-utils.test.ts`, re-expressed against the new names):
  - `splits camelCase, kebab-case and snake_case into Title Case words`: `backgroundColor` → "Background Color", `border-box` → "Border Box", `cover_image` → "Cover Image", `zIndex` → "Z Index".
  - `keeps a run of capitals as one word`: `imageURL` → "Image URL", `URLPath` → "URL Path", `innerHTML` → "Inner HTML", `IndexedDB` → "Indexed DB".
  - `uppercases a known abbreviation as a whole word only`: `url` → "URL", `baseUrl` → "Base URL", `aria-label` → "ARIA Label", `userId` → "User ID"; `valid` → "Valid", `sqlite` → "Sqlite".
  - `keeps a plural abbreviation's s lowercase`: `ids` → "IDs", `userIds` → "User IDs", `imageURLs` → "Image URLs".
  - `names framework keys from the table and strips any other leading $`: each `FRAMEWORK_KEY_LABELS` key maps to its value; `$handler` → "Handler".
  - `is idempotent and empty-safe`: `keyToLabel(keyToLabel(k)) === keyToLabel(k)` over every fixture above, plurals included; `""` → `""`.
  - `keyToPhrase lowercases every word but an abbreviation`: `trustedOrigins` → "trusted origins", `userIds` → "user IDs", `IndexedDB` → "indexed DB", `$src` → "source".
  - `propLabel prefers $label, then title, then the key`: `{ $label: "ID" }`, `{ title: "Connection URL" }`, `{}`, `null`, and a `$label` of `""` falling through.
  - `every literal field label and metadata $label is Title Case`: walks `src/surfaces/*.json` for each `jx-field`'s literal `label` (in `$props` or `attributes`) and each `[part="field-label"]`'s literal `textContent`, and every `$label` in `data/*-meta.json`; a word after the first must begin uppercase unless it is one of a, an, and, as, at, by, for, in, of, on, or, the, to, with; a token that begins with no letter (`(optional)`, `${…}`) and a label ending in `?` are skipped. Red today on the thirteen labels in Context.
- `tests/studio-utils.test.ts`: the four moved blocks deleted.
- `tests/schema-form.test.ts`: line 287 expects "Title"; new `a row is labelled by its schema title, else by its key as a label` (`baseUrl` → "Base URL", `urlEnv` with `title: "Connection URL"` → "Connection URL"); new `an array row's cells are labelled like rows, and its buttons name the field in words` (an array `trustedOrigins` of `{ field, order }` objects: cell labels "Field", "Order", the add button "Add trusted origins", the first row's remove button "Remove trusted origins 1").
- `tests/grid-schema-columns.test.ts`: the `titleForField` block becomes `column titles are labels` through `columnsFromSchema` (`cover_image` → "Cover Image", `userId` → "User ID", a `title` annotation wins) and `inferColumnsFromRows` (`publishDate` → "Publish Date").
- `tests/style-panel.test.ts`, `keyword and font lists`: new `a keyword option is labelled in words, and any other value by itself`: a `transform` row (`tab.session.ui.styleSections = { effects: true }`) lists `translateX(0)` with `label` "translateX(0)" and `none` with "None"; a `textDecoration` row lists `line-through` as "Line Through".
- `tests/signals-panel-schema.test.ts`: "Kind" → "Prototype" in the `an external prototype's own rows` block (selectors, `fieldEl` calls, the `["Name", "Source", "Prototype"]` list, test names). `tests/signals-panel-template.test.ts:654`: `toContain("Prototype")`.
- `tests/head-panel.test.ts`: in `without a schema, fields are inferred from the frontmatter values`, add `coverUrl: "/a.png"` and expect its `[part="row-name"]` to read "Cover URL".
- `tests/properties-panel.test.ts`: new `attribute rows use metadata labels and keep abbreviations uppercase`: with an element carrying `aria-label` and `tabindex` selected, `row(c, "aria-label")` reads "ARIA Label" and `row(c, "tabindex")` reads "Tab Index" in `[part="row-name"]`.
- `tests/media-picker.test.ts:275` and `:304`: the accessible names read "Src" and "Poster"; add `heroImage` → "Hero Image" to the first.
- `tests/contributed-section.test.ts:221`: `title falls back to the section key as a label`, expecting "Analytics". `tests/extension-sections.test.ts:167`: "Things".
- `tests/head-editor.test.ts:184`: "Style Body". `tests/github-publish-gaps.test.ts:297`: "Repository Name". Any other failure the step-5 sweep causes is a pinned label and takes the new case.

Coverage: `labels.ts` is fully unit-tested (100% lines and functions), comfortably above the per-file floor in `packages/studio/bunfig.toml` (`lines = 0.958, functions = 0.941`); it ships with its test, so `bun scripts/check-coverage-manifest.ts packages/studio` finds it. No existing file's minimum moves enough to ratchet. `tests/reachability.test.ts` must stay green: every new export has a caller in `src`.

## Specs & docs

**`specs/studio-ui-guidelines.md` §2.3, in place:**

- The Partial marker is replaced by `> **Status: Implemented.**` reading: Every label Studio generates from a key goes through `packages/studio/src/utils/labels.ts`, and a test holds every literal field label to Title Case.
- Bullet 1 becomes: "**Title Case** for all form labels, generated or written by hand: "Font Family", "Default", "Description", "Base Width" — not "fontFamily", "default", "desc". A label phrased as a question stays a sentence."
- Bullet 2 becomes: "A label from a key is generated, never hand-cased: `keyToLabel()` (`src/utils/labels.ts`) splits camelCase, kebab-case and snake_case into words and capitalises each, and `propLabel()` lets metadata name the label first (a `$label` in the Inspector's `data/*-meta.json`, then a JSON Schema `title`). The Inspector's rows, the schema builder and `$defs` editor, the frontmatter fields, every schema-driven form, a settings section without a title and a content collection's grid columns use them; a sentence that names the field uses `keyToPhrase()` ("Add trusted origins")."
- Bullet 3 becomes: "Abbreviations stay uppercase: a run of capitals is one word ("imageURL" → "Image URL"), and a whole word in `LABEL_ABBREVIATIONS` is uppercased ("url" → "URL", "aria-label" → "ARIA Label", "ids" → "IDs")."
- New bullet after it: "An attribute whose name HTML runs together names its words in its `$label`: "tabindex" → "Tab Index", "maxlength" → "Max Length"."
- Bullet 4 becomes: "Framework-internal keys are displayed as friendly names from `FRAMEWORK_KEY_LABELS`: `$src` → "Source", `$prototype` → "Prototype", `$export` → "Export"."

(Each bullet follows its Open decision: an exemption or a kept "Kind" rewrites the matching bullet instead.)

Fragment: `bun run spec:change studio-ui-guidelines.md minor -m "Label Conventions (§2.3) is implemented: one helper generates every label from a key, keeps abbreviations uppercase and names framework keys, schema-driven forms and content grid columns use it, and a test holds hand-written field labels to Title Case."`

Not a graduation: the spec keeps other open items.

**Docs** (no em dashes; bold the label as Studio draws it; where a page teaches `project.json`, follow the first mention with the key in code, e.g. "**Database ID** (`databaseId`)"):

- `docs/studio/logic/data-sources.md`: "(**Source** and **Kind** fields)" → "**Prototype**"; the ContentCollection list (**Content Type**, **Filter**, **Field**, **Op**, **Value**, **Sort**, **Order**, **Limit**), the database sources (**Table**, **Limit**, **Offset**, **Include**, **ID**, **Values**) and the account sources (**Base URL**, **Redirects**, **Provider**). The Session value's `userId` is a value, not a label, and stays.
- `docs/start/first-collection.md`: step 4's **contentType** and **sort** → **Content Type** and **Sort**, and the image's alt text to match; step 2's **Items source** → **Items Source**.
- `docs/studio/data/connections.md`: **provider**, **file**, **binding**, **databaseId**, **accountId**, **urlEnv**, **hyperdriveId** → drawn labels with keys.
- `docs/studio/data/auth-and-secrets.md`: the Authentication settings list and the table's **ownerField** → drawn labels with keys. The Session's **id**, **user**, **role** (line 90) are values and stay.
- `docs/studio/data/tables.md`: Table options and the table sources' fields → drawn labels with keys.
- `docs/extending/extensions/project-sections.md:100`: say a field's label is its schema `title`, else its key in Title Case (`databaseId` reads "Database ID").
- The step-5 sweep: `docs/studio/publish/github.md:43` (**Repository Name**), `docs/studio/design/repeaters.md:18` (**Items Source**), `docs/studio/projects/create.md:100` (**Minimum Fidelity**), `docs/studio/publish/cloudflare.md:37`–`39` (**Pages Project Name**, **GitHub Owner**, **GitHub Repository**, **Production Branch**), `docs/studio/design/breakpoints.md:74`, `:108` and `docs/studio/projects/settings.md:67` (**Base Width**), `docs/studio/design/properties.md:49` (**Opens Popover**). A command or button of the same words ("**Create GitHub repository**") is not a field label and stays.

`bun run docs:sync` will also name the pages whose `code:` lists a changed file (`docs/studio/logic.md`, `logic/data.md`, `editing/frontmatter.md`, `projects/settings.md`, `projects/content-types.md`, `projects/media.md`, `design/properties.md`, `design/components.md`, `design/style-inspector.md`, `design/stylebook.md`, `design/states-and-selectors.md`, `design/tokens.md`, `docs/README.md`): beyond the edits above, none of them names a label this plan changes; say so in the pull request. The screenshots lane re-captures the shots these forms appear in (`blog-collection-state` at least); re-read the pages its comment lists.

## Acceptance

- `git grep -nE '\b(camelToLabel|kebabToLabel|attrLabel|titleForField)\b' -- packages/studio` finds nothing, nor does `git grep -n '"Kind"' -- packages/studio/src`.
- `git grep -n 'replaceAll(/(\[A-Z\])/g' -- packages/studio/src` finds nothing (the inline copy is gone).
- `git grep -nE 'label: (prop|cellKey),|Add \$\{prop\}|\?\? (sectionKey|key);' -- packages/studio/src/ui/schema-form.ts packages/studio/src/ui/media-picker.ts packages/studio/src/settings` finds nothing.
- From `packages/studio`: `bun test --isolate --coverage` is green with `src/utils/labels.ts` at 100%, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run plans:check` reports `studio-ui-guidelines.md#2.3` closed, and the pull request deletes this file; `bun run docs:status`, `docs:spec-release`, `docs:check`, `docs:links` and `docs:prose` are green.
- In Studio: a Data panel "From a module…" entry shows Source and Prototype; a ContentCollection entry shows Content Type, Filter, Sort, Limit; the content entry editor and the frontmatter panel title the same field alike; an element's attribute rows read "ARIA Label" and "Tab Index"; a `transform` row's list shows `translateX(0)` as written; Project Settings → Connections shows "Database ID", and Authentication's trusted origins offer "Add trusted origins".
