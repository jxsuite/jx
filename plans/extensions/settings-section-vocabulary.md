---
status: drafted
disposition: implement
claims:
  - extensions.md#9.1
requires:
  - extensions/format-icon-hint
workspaces:
  - packages/studio
  - packages/ui
  - extensions/feed
size: S
---

# The settings nav draws each section's glyph, and §9.1 lists only the vocabulary the studio reads

## Context

`specs/extensions.md` §9.1, line 450:

> **Status: Partial.** `label`, `order`, both layouts, `entry.ui`, `entry.newEntry`, the `schema-builder` and `secret` controls and `#/$context/` enum pointers ship (`packages/studio/src/settings/extension-sections.ts`, `packages/studio/src/settings/contributed-section.ts`, `packages/studio/src/ui/form-controls.ts`). `icon` is carried but not drawn (`section-registry.ts` reserves it), no `renderer` escape hatch exists, and the built-in controls differ from the list: `"binding"` was replaced by the value-source ladder and a `"reference"` control ships unlisted.

Three gaps under one anchor, so one plan with a disposition per part. Re-verified on 2026-09-27; the census evidence holds, with the details below.

**`icon` (implement).**

- `deriveSettingsSection` (`packages/studio/src/settings/extension-sections.ts`) passes `$studio.settings.icon` to `registerSettingsSection`; `SettingsSection.icon` (`packages/studio/src/settings/section-registry.ts`) is documented "reserved for future nav treatments", and the comment over the built-ins in `packages/studio/src/settings/settings-document.ts` says "nothing here draws today".
- The nav is `values()` in `packages/studio/src/panels/settings-pane.ts`, which projects `key`, `label` and `tabId` only, drawn by `packages/studio/src/surfaces/settings-pane.json` as childless `jx-tab` rows. The kit's `jx-tab` (`packages/ui/components/jx-tab.json`) already has an `icon` slot whose container is `display: contents`, so an unused slot costs nothing.
- Every declared name resolves today: the ten built-ins are held to the manifest by `settings-document.test.ts` ("every built-in names a glyph the kit ships"), and the five extension sections that declare one (`lock-simple`, `database`, `rows`, `grid-four`, `magnifying-glass`) are all in `packages/ui/icons/list.json`. **Feed declares none** (`extensions/feed/src/Feed.class.json`), so it would be the one bare row.
- The rail foot's Settings submenu (`packages/studio/src/panels/settings-menu.ts`) projects `key` and `label`; `MenuRowProjection` (`packages/studio/src/surfaces/menu.ts`) has no glyph field and no menu in the studio draws one.
- The rule for an extension-declared glyph name is decided by `plan:extensions/format-icon-hint`: a key into the kit's manifest, resolved by `declaredGlyph(name, owner)` in `packages/studio/src/format/format-host.ts`, an unknown name treated as undeclared with one warning per name, and every first-party `$studio.settings.icon` held to the manifest by `packages/studio/scripts/check-icons.ts`.

**Controls (reconcile).**

- `packages/studio/src/ui/form-controls.ts` registers exactly `schema-builder`, `secret` and `reference` (`builtinFormControls`, asserted by `form-controls.test.ts`); its header says "Three, not the four the spec still lists".
- `binding` is registered by nothing. A name the registry lacks falls through to the type's default (`schema-form.ts`; "unknown ui overrides fall through to the default control" in `schema-form.test.ts`). The ladder that replaced it (studio.md §6.6) appears only where a form's host names a value source; the settings forms name none and edit fixed values (the `schema-form.ts` docstring).
- `reference` is dispatched without being named, for any field whose `$ref` is a relationship (`referenceTarget`, `packages/studio/src/ui/schema-form.ts`, `#/content/<type>` today), and can also be named in `entry.ui`. Which targets it covers is relationships.md §5's scope, Partial and owned by `plan:relationships/studio-reference-picker`.

**`renderer` (remove, pending the first Open decision).** No descriptor declares it (`git grep '"renderer"' -- '*.json'` finds none), nothing reads it, and `StudioHints` in `packages/schema/defs/class-def.schema.ts` defines no `settings` shape, so dropping the key changes no schema. `docs/extending/extensions/project-sections.md` documents it in its key table without a caveat. A renderer a descriptor could name is either studio code (a per-extension carve-out §9.1's generic path exists to avoid) or extension code running in the studio, which no host loads (§8.1; `plan:extensions/capability-timing-dispatch` recommends deferring even in-process `"client"` calls).

**Not claimed here.** §9's `description` row ("Studio help text") is read by no studio code, and Feed's `$studio.settings.description` is a key §9.1 does not list. Both belong to §9's help-text question, not to this anchor.

## Outcome

- extensions.md §9.1 → Implemented:
  - `icon`: the inner nav draws each section's glyph before its label (implement).
  - Controls: the sentence names `schema-builder`, `secret` and `reference`, and says the value-source ladder replaced `binding` (reconcile).
  - `renderer`: the row is deleted and one paragraph says why (remove). If the first Open decision goes to defer instead, the row becomes a `> **Status: Future.**` remainder under §9.1 and the section is Implemented for the rest.

## Decisions

- **Decided:** §9.1 cites §10's glyph rule rather than restating it, and the nav resolves names with `declaredGlyph`, because the census gave the two icons one rule and `plan:extensions/format-icon-hint` decides it. That is the one `requires` edge: this plan's code imports that function and its spec text cites that paragraph.
- **Decided:** resolution happens where the nav is projected (`values()` in `panels/settings-pane.ts`), for every registered section, not in `deriveSettingsSection`, because `registerSettingsSection` is the public contract any registrant reaches and one resolver at the draw covers built-ins and contributions alike. The import adds nothing to the canvas's import graph: `canvas/canvas-render.ts` already imports `format/format-host`.
- **Decided:** every row carries a `jx-icon` in `jx-tab`'s `icon` slot, with an empty name when nothing resolves, because `jx-icon` draws an empty `--jx-icon-size` box and no warning for `""`: the row draws nothing, as §9.1 says, and its label stays in the column instead of sitting a glyph's width left of its neighbours.
- **Decided:** the rail foot's submenu stays text-only, because §9.1's row names the settings nav, studio.md §17.1's "same projection" rule is about which sections appear (both or neither), no menu in the studio draws glyphs, and the sibling Preferences submenu has none to draw.
- **Decided:** `declaredGlyph`'s warning ends "treating it as undeclared (extensions.md §10)" instead of "drawing the default glyph (extensions.md §10)", because the nav's undeclared state is no glyph, not a default one; a file row's is still the extension glyph, and the new wording is true of both.
- **Decided:** `reference` is described as the relationship-field picker with relationships.md §5 cited for its targets, not as a `#/content/<type>` picker, because §5 owns and marks that scope and its plan widens it; §9.1 stays true across that change.
- **Decided:** `binding` is not re-registered as an alias for the ladder, because a settings form names no value source, so the alias would have nothing to draw. A descriptor naming it keeps its type's default control, pinned by a test.
- **Open:** `renderer`: remove, defer, or build. Recommendation: remove. A studio-registered renderer can only be studio code, which hard-codes one extension into the studio (`extension-sections.ts`: "The studio hard-codes nothing per extension"), and first-party extensions already use the generic path. An extension-shipped renderer needs extension code in the studio's document, beside the platform that writes files; `plan:extensions/capability-timing-dispatch` recommends deferring even browser-safe `"client"` capabilities for that reason, and a renderer is arbitrary UI. No descriptor declares the key, so removal breaks no project. Defer (a Future remainder waiting on a browser loading path) keeps a name nobody can use; if the in-process decision in `plan:extensions/capability-timing-dispatch` is signed the other way, a renderer should be designed against that loading path, not against this row.
- **Open:** Feed's glyph. Recommendation: declare `"icon": "rss"` and add `rss` (a Phosphor asset) to the kit's list, because Feeds is the only first-party section without one and would be the only row with an empty box. Declining leaves `packages/ui` and `extensions/feed` out of this plan and the Feeds row glyphless, which §9.1 allows.
- **Decided:** the fragment is `major`, because the recommended removal takes out `renderer`, which `project-sections.md` documented without a caveat, and the release table puts a documented removal at major (at 0.x it moves the minor). If `renderer` is deferred, the level is `minor`: `binding` has registered nothing since the ladder replaced it, so its reconcile redefines nothing a working project relies on.

## Implementation

1. **`packages/ui/icons/list.json`** (second Open decision): add `"rss": ["regular"]` between `rows` and `sidebar-simple`, then `bun run --cwd packages/ui build:icons` to rewrite `icons/manifest.json`. **`extensions/feed/src/Feed.class.json`**: `$studio.settings` gains `"icon": "rss"` as its first key, the order the other descriptors use.
2. **`packages/studio/src/format/format-host.ts`**, `declaredGlyph`: the warning's tail becomes `treating it as undeclared (extensions.md §10)`. Its doc comment names the settings nav as its second caller.
3. **`packages/studio/src/surfaces/settings-pane.ts`**: `SettingsNavView` gains `icon: string`, documented "The kit glyph drawn before the label, or `""` for none: an empty `jx-icon` still takes its box, so the label keeps the column."
4. **`packages/studio/src/surfaces/settings-pane.json`**: the mapped `jx-tab` gains `"children": [{ "tagName": "jx-icon", "attributes": { "slot": "icon" }, "$props": { "name": { "$ref": "$map/item/icon" } } }]` (the `palette.json` form), with a `$description` saying the glyph is decided by the flow and an empty name draws an empty box. The document's own `$description` adds one clause: each row draws its section's glyph through `jx-tab`'s `icon` slot. No style change: `jx-icon`'s own size and `jx-tab`'s gap place it.
5. **`packages/studio/src/panels/settings-pane.ts`**: `import { declaredGlyph } from "../format/format-host";`. In `values()`, each row adds ``icon: declaredGlyph(section.icon, `Settings section "${section.key}"`) ?? ""``. The module docstring's list of decisions (which sections, which is current, which renderer) gains "which glyph each row draws", with the import-graph note from the Decisions. Add `@docs extending/extensions/project-sections` beside the existing tag.
6. **`packages/studio/src/settings/section-registry.ts`**, `SettingsSection.icon`: "The glyph the inner nav draws before the label (extensions.md §9.1). A KEY into the kit's glyph manifest (`@jxsuite/ui/icons`), the space `PanelRecord.icon` resolves in, never a tag. A key with no row draws an empty glyph and warns once (`declaredGlyph`, `format/format-host.ts`)."
7. **`packages/studio/src/settings/settings-document.ts`**, the comment over the built-in sections: its last sentence ("The field is still documented as reserved…") becomes "The inner nav draws them (`panels/settings-pane.ts`), and a miss draws an empty box, so `settings-document.test.ts` holds every built-in to the kit's manifest."
8. **`packages/studio/src/ui/form-controls.ts`**, header: "Three, not the four the spec still lists:" becomes "Three, the list extensions.md §9.1 gives:"; the `binding` history sentence stays. Add `@docs extending/extensions/project-sections`.
9. **`packages/studio/scripts/check-icons.ts`**, `iconKeysDeclared`'s docstring: the settings-section clause (whatever `plan:extensions/format-icon-hint` left of "documented as reserved and read by nobody") says the inner nav now draws a section's key, so its miss is silent too, and it is gated elsewhere: built-ins by `settings-document.test.ts`, extension-declared keys by `extensionIconKeys`. No rule changes.

**Integration contract.** Once this lands: `SettingsNavView.icon` is the resolved glyph or `""`; the inner nav draws every registered section's `icon` through `declaredGlyph`, so any `registerSettingsSection` caller gets a glyph by naming a kit key; the rail submenu draws none. extensions.md §9.1 lists three built-in controls, names relationships.md §5 as the scope of `reference`, and has no `renderer` key. A plan that registers a new built-in control (for instance for site-architecture.md's entry widgets) adds it to that sentence and to `builtinFormControls` together.

## Tests

- **`packages/studio`** (`bun test --isolate --coverage` from `packages/studio`):
  - `tests/settings-pane-surface.test.ts`: the `values()` fixture's rows gain `icon` (`"sliders-horizontal"`, `""`). New `each row draws its glyph in the tab's icon slot, and an empty one where none resolves`: the first row's `jx-icon[slot="icon"]` has `name` `sliders-horizontal`, the second's exists with `""`, and both rows' `label` and accessible name are unchanged. New `update redraws a row's glyph`: an `update` with a different icon moves the `name`.
  - `tests/settings-document.test.ts`, `describe("a section's icon")`: the docstring says the nav draws the key now (a miss is an empty box, which is why the built-ins stay held to the manifest). New `the inner nav draws each built-in's glyph` (Overview → `sliders-horizontal`, Raw JSON → `code`). New `a section naming a glyph the kit lacks draws an empty one and warns once` (`registerSettingsSection` with `icon: "no-such-glyph-ssv"`, `console.warn` spied, two redraws, `name` `""`, one warning containing `Settings section "` and the name). New `a section with no icon draws an empty glyph and keeps its label` (no `icon`, `name` `""`, no warning). "a $studio.settings contribution lands at its declared order" also asserts the Content Types row draws `grid-four`, which proves a contribution's glyph crosses `deriveSettingsSection`.
  - `tests/schema-form.test.ts`, beside "unknown ui overrides fall through to the default control": `the retired binding control falls through to the field's default` (`ui: { field: { control: "binding" } }` on a boolean draws the checkbox).
  - The warning test from `plan:extensions/format-icon-hint` (`tests/format-icon.test.ts`) changes only if it asserts the old tail.
  - Coverage: thresholds are `lines = 0.958, functions = 0.941` per file (`packages/studio/bunfig.toml`); the one new branch (`?? ""` in `values()`) is reached both ways. No new source file, so the manifest check is unaffected; no ratchet, since no worst file moves.
- **`packages/ui`**: no new case; `tests/icons-build.test.ts` ("carries every name and weight the list asks for") and `tests/icons.test.ts` prove the regenerated manifest. Data only, so the `lines = 0.99, functions = 1.0` bar is untouched.
- **`extensions/feed`**: no test asserts `$studio`; its suite re-runs unchanged. The `EXTRA_EDGES` entry `plan:extensions/format-icon-hint` adds (`extensions/*/src/**/*.class.json` → `packages/studio`) re-runs Studio's suite, where `tests/icons.test.ts` holds `rss` to the manifest.

## Specs & docs

**`specs/extensions.md` §9.1**, in place:

- The marker becomes:

  > **Status: Implemented.** Sections are derived in `packages/studio/src/settings/extension-sections.ts`, drawn in the inner nav with their glyph by `packages/studio/src/panels/settings-pane.ts`, and rendered by `packages/studio/src/settings/contributed-section.ts`; the built-in controls register in `packages/studio/src/ui/form-controls.ts`.

- The `icon` row: "Section glyph, drawn before the label in the settings nav: a glyph NAME from the Jx UI kit's icon set (`@jxsuite/ui/icons`), never an element tag, under §10's rule. A section that declares none, or names a glyph the kit does not ship, draws nothing in its place, and its label keeps the column."
- The `renderer` row is deleted, and after the table: "**There is no renderer key.** A section is drawn by the generic renderer from its fragment schema and the keys above. Earlier versions listed a `renderer` key naming a studio-registered renderer; no host read it and no descriptor declared it, and a renderer an extension could name would be extension code running in the studio, which no host loads (§8.1). It is removed rather than kept as a name that does nothing." (If `renderer` is deferred instead, the row stays and this paragraph becomes a `> **Status: Future.**` blockquote naming the missing browser loading path.)
- The controls paragraph up to "Enum choices": "Built-in controls: `"schema-builder"` (visual JSON-Schema field editor), `"secret"` (value committed via the platform's secret store, **never** project.json; §13) and `"reference"` (the entry picker for a relationship field, [relationships.md](./relationships.md) §5, which the form draws for such a field without being named), plus implicit defaults per type/enum/format. A name the studio does not register falls through to the implicit default. There is no binding control: the value-source ladder ([studio.md](./studio.md) §6.6) replaced it on every form whose host names somewhere a value can come from, and a settings form names none, so its fields edit fixed values." The `#/$context/` sentence stays.

Fragment: `bun run spec:change extensions.md major -m "§9.1: the settings nav draws each section's icon under the §10 glyph rule; the built-in controls are schema-builder, secret and reference, the value-source ladder having replaced binding; the renderer key, which nothing read, is removed."` (`minor`, without the last clause, if `renderer` is deferred.)

**Docs** (no em dashes). `bun run docs:sync` names these pages; what changes in each:

- `docs/extending/extensions/project-sections.md` (`spec:` extensions.md#9.1): the `icon` row becomes "Section icon, drawn before the label in the settings nav. Names a glyph from the Jx UI kit icon set (`@jxsuite/ui/icons`), never an element tag. A section with no icon, or one the kit doesn't ship, shows no glyph, and Studio warns once about an unknown name." The `renderer` row is deleted. Under "Controls and dynamic enums", the `"binding"` bullet is replaced by "`"reference"`: an entry picker for a relationship field (see [Relationships](/docs/framework/site/relationships)). A field whose schema is a reference gets it without naming it.", and the last bullet becomes "Implicit defaults per type, enum, and format cover everything else, including any control name Studio doesn't register. Settings forms edit fixed values; there is no binding control." `code:` gains `packages/studio/src/panels/settings-pane.ts` and `packages/studio/src/ui/form-controls.ts`, matching the new `@docs` tags.
- Checked, no change: `docs/studio/projects/settings.md` (lists the pane, registry and document files; "its sections listed down the left" stays true, and its pictures come from the screenshots lane), `docs/studio/data/tables.md` and `docs/studio/data/auth-and-secrets.md` (list `form-controls.ts`, whose change is a comment), `docs/studio/interface/modes.md` and `docs/studio/design/stylebook.md` (list `settings-document.ts`, a comment), `docs/studio/interface.md` and `docs/extending/extensions/formats.md` (list `format-host.ts`; the warning's wording is not quoted), `docs/extending/ui-kit.md` (its `icons/list.json` paragraph stays true).

No spec graduates: extensions.md keeps other open items.

## Acceptance

- `bun run plans:status --spec extensions` no longer lists `extensions.md#9.1`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- `git grep -n -e '"binding"' -e '| `renderer`' -- specs/extensions.md docs/extending/extensions` prints nothing, and `git grep -n "reserved for future nav" -- packages/studio` prints nothing.
- `bun --cwd packages/studio scripts/check-icons.ts` exits 0 and reports eight extension keys (seven after `plan:extensions/format-icon-hint`, plus Feed's `rss`).
- `bun test --isolate --coverage` passes from `packages/studio`, `packages/ui` and `extensions/feed` with no per-file threshold failure, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- By hand, in Studio on a project enabling parser, connector, auth, search and feed: every Project Settings row draws its glyph with the labels in one column, Feeds draws `rss`, and the gear's submenu is unchanged. With a descriptor's `icon` set to an unknown name, that row draws no glyph, its label stays aligned, and the console warns once naming the section. The screenshots lane re-captures the seven shots that open Project Settings (`settings-document`, `css-variables-shot`, `blog-content-type`, `blog-schema-fields`, `content-type-builder-shot`, `data-tables-shot`, `connections-section`); review the images and the pages it lists.
