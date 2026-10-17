---
status: ready
disposition: implement
claims:
  - studio.md#3.1
  - studio.md#5.5
  - studio.md#5.7
  - studio.md#6
  - studio.md#7.1
  - studio.md#9.1.1
  - studio.md#9.1.2
  - studio.md#9.3
  - studio.md#17.1
  - studio.md#22
  - studio.md#22.1
  - studio.md#22.2
  - studio.md#22.3
  - studio.md#22.5
  - studio.md#22.6
  - studio.md#22.7
  - studio.md#22.8
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: L
---

# Studio is organised as five workspaces, Design, Content, Media, Styles and Publish, each with its own frame, home and tabs

## Context

Studio draws one frame for every task. The Command Bar carries named layouts (Write, Design, Build, Ship, with save, rename, delete and reset: `builtInLayouts`, `applyLayout` and `saveLayout` in `packages/studio/src/shell.ts`, `projectLayouts` in `src/surfaces/commandbar.ts`), which re-arrange the docks but never decide which tabs, panels or surfaces are shown. Everything an author does that is not editing a document is a canvas tab or a Navigator panel beside the documents: the Library (`browse/library-pane.ts`, studio.md §9.1.2), Project Settings and Project Styles as editors of the `project.json` tab (`settings/settings-document.ts`, §17.1, §7.1), and Source Control as a Navigator panel (`panels/git-panel.ts`, §5.5). The rail offers Files, Source Control, Outline, Page, Data and Packages to a site author who thinks in pages, templates, components and media, and nothing lists the project by route.

The redesign was approved against sixteen mockup boards (Design page settings, Design element, Design template, Add new, Content collection, Content pages, Content entry, Media library, Media picker, Publish quick, Publish review, Publish history, Publish setup, Styles tokens, Styles elements, Settings dialog). Its target state is written into the specs in place, each section carrying an honest Pending or Partial marker that names what ships today:

- studio.md §3.1 (the frame's columns), §5.1 (the Design-only rail, the Site panel, developer panels; claimed by `plan:studio/search-panel`, which this plan enables), §5.5 (Source Control hosted by Publish), new §5.7 (Site Panel), §6 (Inspector: Page · Element · Assistant), §7.1 (Project Styles as the Styles workspace, the Variables view), §9.1.1 (Add new), §9.1.2 (the Library becomes Content), §9.3 (`public/media/`, Replace, one picker), §17.1 (Project Settings as a three-group dialog) and new §22 (the workspace model, the switcher, frames, and one subsection per workspace).
- studio-ui-guidelines.md §3.1 and §3.2 (the frame per workspace, the Inspector anatomy), claimed by `plan:studio-ui-guidelines/shell-layout-prose`, which lands with this plan's slices; §12.2 gains the rule that a tab's sub-switch and the Command Bar switcher are not dock tabs (no new open item).
- site-architecture.md §9.4 (the upload default), claimed by `plan:site-architecture/media-upload-default`, which lands with this plan's Media slice.

Code anchors for each area were surveyed before the spec text was written (shell, library, create, media, styles and settings, publish, specs and tests); the anchors that bind a decision are repeated under Implementation.

## Outcome

- studio.md §22 and §22.1–§22.8 → Implemented, except the two second markers that stay Pending as named follow-ups (below).
- studio.md §3.1, §5.5, §5.7, §6, §7.1, §9.1.1, §9.1.2, §17.1 → Implemented.
- studio.md §9.3 → Implemented.
- Follow-ups that stay Pending, claimed here until each lands or is split into its own plan: the entry body spliced into its template page's bound body (§22.5's second marker), the Missing alt text and tag filters (§22.6's second marker), deploy Rollback, and Send for review on a host with no `createPullRequest` (§22.8's second marker). When only these remain, split them into plans of their own (one per store or API they need) and delete this plan.
- Left open by the Design slice, closed by later slices: §5.7's **+** opens the Library's New menu until Add new lands (`WKS1.3`) and its media section lists `public/` alone until the scan widens (`WKS1.5`); §6's Entry tab has no entry fields until `WKS1.4`; §3.1 and §22.3 name Content's Collections panel (`WKS1.4`).
- Not a graduation: studio.md keeps other open items.

## Decisions

- **Decided:** five workspaces, ids `design`, `content`, `media`, `styles`, `publish` in that order, `⌘1`–`⌘5`, because each is a task an author names and the mockups give each a home; a sixth is a spec change, not a budget one (`studio-ui-guidelines.md` §12.2).
- **Decided:** the workspace REPLACES the named layouts rather than sitting beside them: two mechanisms that both re-arrange docks would disagree about which one the docks reflect. Layout presets, their four verbs, the `+`, and the stored `layout`/`layouts` fields are deleted; the dock record stays.
- **Decided:** tab ownership is derived by `workspaceOfTab(tab)` and never stored, so a tab cannot belong to a workspace its content contradicts, and activation sets the workspace, so cross-workspace links need no door of their own (§22.1).
- **Decided:** a dock a workspace hides is hidden by an `#app` class set in `applyDockLayout`, not by inline style and not by writing the dock record, so the author's sizes survive (`studio-ui-guidelines.md` §3.1).
- **Decided:** the switcher is a `jx-tabs` tablist in the Command Bar's layouts slot, not a dock declaration, so the dock-tab cap does not apply and `commandbar/primary` gains nothing. Publish's count is `ctx.git.dirtyCount`; the quick-publish chevron is a separate button.
- **Decided:** the ⌘1–8 `panel.focus.*` chords are removed (the commands stay, chordless), because the digits belong to the workspaces and a Design-only rail cannot own them.
- **Decided:** the ⚙ Settings menu moves from the rail foot to the Command Bar, and the rail-foot Library button is deleted with the Library.
- **Decided:** `NAVIGATOR_PANEL_IDS` gains `site` and loses `page`; `DEFAULT_PANEL_ID = "site"`; `RENAMED_PANEL_IDS` maps `page → site`. `git` leaves the navigator in the Publish slice. `files`, `search`, `packages`, `git`, `i18n` and `insert` are `rail: false`; the Preferences switch **Show developer panels** (default off) puts `files` and `packages` back.
- **Decided:** `INSPECTOR_TAB_IDS = ["page", "properties", "style", "events", "assistant"]`; the strip groups the three node leaves under Element with a sub-switch, so `view.setRightTab { tab: "style" }` keeps working and the `inspector/tab:*` shots keep resolving. A document-level Page tab needs `PANEL_PLACEMENT_MATRIX`'s inspector row widened, with the matching `studio-ui-guidelines.md` §12.1 edit in the same slice.
- **Decided:** the Page tab's title is contextual (Page, Template, Component, Entry, Document), and the strip switches Page ↔ Element only on a selection transition through empty.
- **Decided:** Add new is one dialog over one pure `deriveCreation(kind, name, ctx)`, with `createFileIn` split into validate/compose and write so New File and Add new share refusals; one exported custom-element-name validator replaces `VALID_NAME` (`editor/convert-to-component.ts`) and `componentSeed` (`browse/library-pane.ts`); a hyphenless slug gains `site-`. `file.new` binds `mod+n` on desktop and `mod+alt+n` where a browser owns `mod+n`.
- **Decided:** collection creation writes `content.<name>` through `commitProjectConfig`/`updateSiteConfig`, creates the folder with a first entry, and with own pages writes `pages/<name>/[slug].json` in the blog starter's shape.
- **Decided:** Content is built only on `content/collection-match.ts`; `contentTypeFor` and the folder categories are deleted. The collection's page pattern is derived by scanning `pages/` for `$paths.contentType`, not stored in `project.json`.
- **Decided:** an entry opens as its own file in its writing editor and the canvas wraps it in the collection's template LAYOUT (`resolveCanvasDocument` in `canvas/canvas-live-render.ts` gains the entry branch: entry `$layout` ?? template page `$layout` ?? `defaults.layout`). Splicing the entry into the template PAGE's bound body is a follow-up, because the edit transforms cannot map paths through a bound node today.
- **Decided:** Media's Unused filter is lazy over `media-usage`; Missing alt text and tags are not shipped until a store exists (no fake filters). Uploads without context default to `public/media/` (`uploadDirFor`, the library model's media dir); collection documents keep `content/<c>/images/`. Replace overwrites the same path, then forgets that path's version and invalidates usages. The scan covers `public/**` and `content/*/images/**`.
- **Decided:** one picker flow module (`ui/media-picker.ts`) owns the compact popover and the pick-mode dialog; `panels/seo-modal.ts`'s forked media choices collapse into it.
- **Decided:** Styles keeps the `stylebook` wire value; `styles.open` becomes an alias for `view.setWorkspace { workspace: "styles" }`; the `project.json` tab gains a `tokens` editor rendering `renderCssVarsEditor`; Settings › CSS Variables is removed and its deep links repointed.
- **Decided:** Project Settings becomes a `jx-dialog` over the existing settings surface (region `overlay.dialog:settings`), `settings.open { section, entry }` keeps its args and refusal; `SettingsSection` and the `$studio.settings` block gain `group` (default `integrations`); `cssVars` and `deploy` leave Settings; the `settings` editor kind, `SETTINGS_TAB_MODES` and `shell.settingsTab` are deleted; Raw JSON's Edit as code opens `project.json` in `source` in Styles and closes the dialog.
- **Decided:** Publish's Review changes reuses the Source Control panel's values and verbs (`gitPanelValues`, its actions, `doCommitAndSync`, `chooseBranch`) moved into a flow module the workspace owns, which also closes `studio-ui-guidelines.md` §12.5's second action list when `plan:studio-ui-guidelines/git-panel-action-list` re-checks it. `listDeployments` returns every row. `panel.focus.git` callers (status bar branch item, GitHub publish notice) run `view.setWorkspace { workspace: "publish" }`. `git.*` and `publish.*` ids are stable.
- **Decided:** follow-ups stay claimed here rather than in stubs, because they share anchors with in-scope items and one anchor has one owner; they are split out when nothing else in their section is open.

## Implementation

Each slice lands its code, tests, docs, screenshot re-authoring and marker flips together. Anchors (paths under `packages/studio/`):

1. **Model, switcher, ownership, frames** (`WKS1.1`). A DOM-free `src/workspace/workspaces.ts` (ids, titles, icons, presets, `workspaceOfTab`) loaded by `commands/app-commands.ts`; `shell.workspace` beside `shell.leftTab` in `src/shell.ts`, persisted through `persistProjectShell` with stale ids read as `design`; `LayoutPreset` generalised into the workspace frame and applied from `applyDockLayout` with `#app` classes; `view.setWorkspace` replacing `view.setLayout`/`saveLayout`/`renameLayout`/`deleteLayout`/`resetLayout`; `ctx.workspace` in `commands/context.ts`, `emptyContext`, `commands/live-context.ts` and `panelContext()` in `panels/panel-registry.ts`; the tab-strip filter in the pane-strip derivation (`workspace/pane-derive.ts`, `panels/pane-grid.ts`); MRU per workspace in the session; `layouts-slot` in `surfaces/commandbar.json` becomes the switcher, with the ⚙ menu (`panels/settings-menu.ts`) moved from `surfaces/rail.json`.
2. **Design** (`WKS1.2`). `src/surfaces/site-panel.json` + adapter, routes via `@jxsuite/site/routes`, drag sources through `mountSurface(..., { onNodeCreated })` as `surfaces/files-panel.ts` does; rail roster in `panels/navigator-panels.ts`; the developer-panels preference in `settings/developer-panels.ts` (Preferences › Appearance); Inspector strip in `commands/defaults.ts` (`INSPECTOR_TABS`), `panels/right-panel.ts`, `surfaces/inspector-dock.json`, with `renderPagePanel` from `panels/head-panel.ts` re-hosted; Insert click-insert calling `enableElement`; slash menu and canvas `+` Components group.
3. **Add new** (`WKS1.3`). `src/surfaces/add-new.json` + adapter, `src/create/add-new.ts` (`deriveCreation`), the shared validator, `file.new`, and the repointed callers (`content.newEntry`, Library/Content New, Media Upload, convert-to-component's tag).
4. **Content** (`WKS1.4`). Collections panel, Content home over `browse/library-*` re-scoped to collections, the collection header derivation, the entry layout branch in `canvas/canvas-live-render.ts`, the writing-mode banner, the Entry tab body (`content/entry-fields.ts`, `content/draft-state.ts`, `mountSchemaForm`); delete `library.*`, the `manage` editor kind and its routing (`canvas/canvas-render.ts`, `commands/context.ts`, `editor/shortcuts.ts`, `files/fs-events.ts`), the rail Library button.
5. **Media** (`WKS1.5`). `src/surfaces/media-library.json` + flow module, `ui/media-picker.ts` pick mode, `files/media-upload.ts` default, Replace with version and usage invalidation, scan scope.
6. **Styles** (`WKS1.6`). `tokens` editor on the `project.json` tab (`tabs/tab.ts` `inferModes`, `settings/settings-document.ts`), the pane-context View picker, `styles.open` alias, deep links (`panels/style-panel.ts`, `settings/css-vars-editor.ts`, `settings/general-settings.ts`).
7. **Settings dialog** (`WKS1.7`). `settings.open` into the dialog layer, `group` on `SettingsSection` and `settings/extension-sections.ts`, the Moved footnote, removal of `cssVars` and `deploy`, deletion of the `settings` editor kind and `shell.settingsTab`, Raw JSON's Edit as code.
8. **Publish** (`WKS1.8`). `src/surfaces/publish-workspace.json` + flow module absorbing the git panel's verbs, `publish.quick` and its dialog, `listDeployments` in `publish/pages-service.ts`, Branches with a confirmed cloud checkout, Hosting absorbing `renderDeploySection`; delete the `git` navigator panel and repoint `panel.focus.git` callers.
9. **Docs, shots and closure** (`WKS1.9`). The docs pages below, every screenshot that names a removed command, panel, region or argument re-authored, and the marker flips each slice did not already make.

**Integration contract.** Once `WKS1.1` lands, `view.setWorkspace { workspace }` is a registered project-level setter with an enum schema, `ctx.workspace` is a context key in every context, and `workspaceOfTab` is the one ownership rule; later slices add homes and frames, never a second switch. Once `WKS1.2` lands, `plan:studio/search-panel` re-details Search against a Design-only rail with no digit chord. Once `WKS1.4` lands, `plan:site-architecture/library-collection-views` re-details its collection scope against the Content home.

## Tests

`cd packages/studio && bun test --isolate --coverage`, then `bun scripts/check-coverage-manifest.ts packages/studio`. Every new `src/**/*.ts` ships with its suite; DOM suites import `./harness` first; commands that lazily import their implementation double it with `mock.module()`.

- New: `workspaces.test.ts` (ids, `workspaceOfTab` for every tab kind, stale-id reads), `shell-workspace.test.ts` (persistence, MRU, home per workspace, strip filter including a split), `commandbar-workspaces.test.ts` (tablist semantics, badge, chevron), `site-panel.test.ts`, `add-new.test.ts` and `add-new-derive.test.ts`, `collections-panel.test.ts`, `content-home.test.ts`, `canvas-live-render-entry.test.ts`, `media-library.test.ts`, `styles-tokens-mode.test.ts`, `settings-dialog.test.ts`, `publish-workspace.test.ts`, `publish-quick.test.ts`.
- Updated or deleted with the code they pin: `shell-layouts.test.ts`, `commandbar-layouts.test.ts`, `rail.test.ts`, `panel-registry.test.ts`, `right-panel*.test.ts`, `library-*.test.ts`, `media-*.test.ts`, `settings-*.test.ts`, `stylebook-*.test.ts`, `git-panel-*.test.ts`, `publish-*.test.ts`, `app-commands-composition.test.ts`, `commands-budget.test.ts`, `shortcuts.test.ts`, `files-create.test.ts` (must stay green across the validate/write split).
- Gates per slice: `bun scripts/check-shot-contract.ts`, `bun scripts/check-chrome-budget.ts` (Inspector declares 3 tabs; rail groups ≤ 4), `bun scripts/check-command-levels.ts`, `check-surface-purity.ts`, `check-styles.ts`, `check-icons.ts`. Ratchet `packages/studio/bunfig.toml` when the worst file rises.

## Specs & docs

- The target-state text is already in place (this plan's first change set): studio.md §3.1, §5.1, §5.4 (one pointer paragraph), §5.5, §5.7, §6, §7.1, §9.1.1, §9.1.2, §9.3, §17.1, §22; studio-ui-guidelines.md §3.1, §3.2, §12.2; site-architecture.md §9.4. Released as `minor` fragments.
- Each slice flips the markers of what it ships, in place, and records a `minor` fragment for its spec (`bun run spec:change studio.md minor -m "…"`, no plan or slice id in the sentence).
- Wording that turns false when a slice lands and must be edited in that slice: studio.md §14.8 ("beside its named layouts", `WKS1.1`), studio-ui-guidelines.md §8.4 (the rail-foot Settings menu's anchoring, `WKS1.1`), studio.md §4.2's mode list (`manage`, `settings`, `tokens`: coordinate with `plan:studio/canvas-modes-table`), studio.md §13's Library and Source Control menu notes (`WKS1.4`, `WKS1.8`), §9.4's stale "(§9.2)" (rehomed here from the deleted the deleted library-upload-destination-text plan).
- Docs, per `bun run docs:sync`: `docs/studio/interface.md` (layout tabs → workspaces), `docs/start/studio-tour.md`, `docs/start/first-project.md`, `docs/studio/projects/browse.md` (→ Content), `docs/studio/projects/media.md`, `docs/studio/projects/settings.md`, `docs/studio/design/stylebook.md`, `docs/studio/design/tokens.md`, `docs/studio/editing/frontmatter.md`, `docs/studio/publish.md`, `docs/studio/publish/source-control.md`, `docs/studio/publish/cloudflare.md`, `docs/nav.json`; `@docs` tags on every new module and their `code:` entries. No em dashes.

## Acceptance

- `bun run plans:status --spec studio` lists none of this plan's claims except the follow-up anchors (§22.5, §22.6, §22.8) once `WKS1.9` lands.
- `bun run all-the-things` green; `bun run plans:check`, `docs:status`, `docs:spec-release`, `docs:check`, `docs:links`, `docs:prose`, `docs:markdown`, `docs:section-refs`, `docs:standards` pass; `bun scripts/check-shot-contract.ts` and `bun scripts/check-chrome-budget.ts` pass.
- In Studio (the `packages/studio:verify` recipe) on a scratch copy of `packages/starters/sites/blog`: `⌘1`–`⌘5` switch workspaces and each shows only its tabs; the Site panel lists pages by route with the blog post page nested under its collection; Add new creates a page, a collection with its own page, and a component; an entry opens inside its layout with the layout locked; Media uploads to `public/media/` and Replace updates every usage; Styles' Variables view edits a token with the canvas following; Settings opens as a dialog in three groups; Publish › Review changes commits.

## Slices

| Slice   | Scope                                                                                                                                   | Claims                                                                              | State |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----- |
| WKS1.1  | Workspace model, `view.setWorkspace` and `⌘1`–`⌘5`, tab ownership and strip filter, switcher with ⚙ menu, frame presets                 | studio.md#22, studio.md#22.1, studio.md#22.2, studio.md#22.3, studio.md#3.1 (frame) | open  |
| WKS1.2  | Design: Site panel, Design-only rail and developer panels, Inspector Page · Element · Assistant with auto-switch, insert fixes          | studio.md#5.7, studio.md#6, studio.md#3.1 (Inspector)                               | done  |
| WKS1.3  | Add new dialog, `deriveCreation`, `file.new`, collection creation, one custom-element-name validator                                    | studio.md#9.1.1                                                                     | open  |
| WKS1.4  | Content: Collections panel, Content home, collection header, entries in their layout, Entry tab; Library deleted                        | studio.md#9.1.2, studio.md#22.5                                                     | open  |
| WKS1.5  | Media: media library surface, pick mode, `public/media/` default, Replace, scan scope                                                   | studio.md#9.3, studio.md#22.6                                                       | open  |
| WKS1.6  | Styles: Styles workspace frame, `tokens` editor, View picker, `styles.open` alias, CSS Variables moved                                  | studio.md#7.1, studio.md#22.7                                                       | open  |
| WKS1.7  | Project Settings dialog in three groups, `group` on sections and contributions, settings editor kind deleted                            | studio.md#17.1                                                                      | open  |
| WKS1.8  | Publish: Review changes, Deploys, Branches, Hosting, quick publish; `git` navigator panel removed                                       | studio.md#5.5, studio.md#22.8                                                       | open  |
| WKS1.9  | Docs, screenshots, stale wording in neighbouring sections, remaining marker flips                                                       | —                                                                                   | open  |
| WKS1.10 | Follow-ups: entry spliced into its template page, Missing alt text and tag filters, deploy Rollback, review without `createPullRequest` | studio.md#22.5, studio.md#22.6, studio.md#22.8 (second markers)                     | open  |
