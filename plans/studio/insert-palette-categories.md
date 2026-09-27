---
status: drafted
disposition: reconcile
claims:
  - studio.md#5.3
workspaces:
  - packages/studio
  - specs
  - docs
size: S
---

# The Elements Panel section says its categories are the groups the element data declares, in that order, and that a card inserts by click as well as by drag

## Context

`specs/studio.md` §5.3, heading line 366, marker line 368 (the section was unmarked before the census):

> **Status: Partial.** The palette ships as the rail-less Insert panel over `jx-accordion`, with live-preview cards that drag or click to insert (`packages/studio/src/panels/elements-panel.ts`). Its categories are the ones `packages/studio/data/webdata.json` declares (Structure, Text, Media, Form, Interactive, List & Table, Other), drawn after the project's Components section, not the seven listed below.

The body still reads "Categories: Layout, Typography, Media, Form, Interactive, Semantic, Table." and "Elements are drag-and-drop sources for inserting into the canvas." Re-verified against the working tree on 2026-09-27; paths under `packages/studio/` unless stated.

**What ships**

- `categoryViews` in `src/panels/elements-panel.ts` iterates `Object.entries(webdata.elements)` and is the only reader of that map (the slash menu and the canvas `+` keep their own list, `src/editor/slash-menu.ts`). A section the filter empties is skipped; `view.elementsCollapsed` keeps each section's disclosure across repaints and panel switches. `src/surfaces/panel-elements.json` draws the Components slot first, then one `jx-accordion-item` per category (`data-section` = the name). `jx-accordion`'s `multiple` defaults to true (`packages/ui/components/jx-accordion.json`).
- Click: `ACTIONS.insertElement` → `insertAtSelection(defaultDef(tag))` appends the node as the last child of `primarySelection(...)`, or of the root path `[]` when nothing is selected, and returns when no tab is open. Drag: `registerElementsDnD` in `src/panels/dnd.ts` makes each `[data-block-tag]` card a `{ type: "block", fragment: defaultDef(tag) }` source; canvas drops (`src/canvas/iframe-host.ts`) and Outline row drops both land through `applyDropInstruction` (above, below, or as the last child). `defaultDef` and `unsafeTags` live in `src/panels/shared.ts`; `registerElementsDnD` fills each empty preview with the live element, or a `span` for the six `unsafeTags` (`script`, `style`, `link`, `iframe`, `object`, `embed`).
- `data/webdata.json`'s `elements` map holds, in order: Form (14), Interactive (4), List & Table (16), Media (10), Structure (11), Text (24), Other (34); 113 tags, each once, all in `allTags`.

**Corrections to the stub**

- The palette draws **Form, Interactive, List & Table, Media, Structure, Text, Other**, not the marker's "Structure, Text, Media, Form, Interactive, List & Table, Other". The order is `CATEGORIES`' key order in `scripts/gen-webdata.ts` (alphabetical by hand; `sort-keys` is off in `.oxlintrc.json`), with Other appended.
- The groups are not derived from element metadata. `CATEGORIES` is one hand-kept table in the generator; only Other is derived: every non-obsolete element of `@webref/elements`' `html` listing that no named group holds, sorted. That puts the document-level `html`, `head` and `body` and the head-only `base`, `link`, `meta` and `title` in the palette. "The studio's element metadata" in studio.md §8.2.2 is a different file, `data/elements-meta.json`.
- `gen:webdata` cannot write its output. `package.json` runs `bun run scripts/gen-webdata.js` (Bun resolves that to the `.ts`, so it starts), but the script writes `writeFileSync("studio/data/webdata.json", …)`, a path that only exists from `packages/`; `bun run` sets the cwd to `packages/studio`, so the write throws ENOENT after the `@webref` reads. Its header (`Gen-webdata.js`, "Produces studio/webdata.json", usage `bun run studio/gen-webdata.js`) and final log line (`studio/webdata.json`) predate the package split.
- The committed file is not the generator's raw output: it is `JSON.stringify(output, null, 2)` after oxfmt, which the commit hook runs on every staged `*.json` (`nano-staged` in the root `package.json`). oxfmt collapses each `cssProps` pair onto one line and adds the trailing newline. Formatting a re-serialization of the committed data with oxfmt reproduces the committed file byte for byte (checked on 2026-09-27).

**Tests today** (`tests/elements-panel.test.ts`): "renders one accordion section per category, with a card per element" uses a `{ Media, Text }` fixture, which is declaration order and alphabetical order at once, so nothing distinguishes the two. Components drawn first is asserted in "npm components stay hidden unless the document enables them" (`sectionNames()[0]` is `components`). Click insertion is covered by the three "Insert panel — element insertion" cases. No test reads the committed `webdata.json`.

**Found, owned elsewhere.** A component card's click writes no `$elements` entry while a drop does; `plan:imports/packages-panel-section` owns that (imports.md §5.1) and routes `insertAtSelection` through a shared `placeBlock`, which leaves element cards' behaviour as described here.

## Outcome

- studio.md §5.3 → Implemented (marker deleted): the element sections are `webdata.json`'s `elements` groups in declared order, after the components, with Other last; the filter and the disclosure memory are specified; an element card inserts by click at the selection and by drag on the canvas or the Outline.
- `bun run gen:webdata` runs from `packages/studio`, and its output after oxfmt reproduces the committed file from unchanged inputs. The data is not regenerated.

## Decisions

- **Decided:** §5.3 names the source and the rule, not the member list, because the groups live in one table (`CATEGORIES`) and the one hand copy of them, §5.3's "Categories:" line, drifted unnoticed. It names `data/webdata.json` by path and says it is not §8.2.2's `elements-meta.json`, because "element metadata" already means that file in this spec.
- **Decided:** §5.3 places the categories "after the components (§5.4)" without naming a component section, because `plan:_shared/component-discovery` defers component sectioning to desktop.md §6.2–§6.5 and `plan:desktop/component-scope-sections` replaces the one Components section with All Components, or Active and Global. Worded this way, §5.3 is true in every landing order, so this plan requires neither.
- **Decided:** repair `gen:webdata` here (script path, write target, stale header and log line) and do not regenerate, because the new text names the generator as the place the categories are declared, and a named generator that cannot write its output is how a generated file gets edited by hand. The pull request already touches `packages/studio` for its tests.
- **Decided:** two test cases pin the rule (below), because the only ordering test cannot tell declared order from alphabetical order.
- **Open:** does this plan also change what the palette offers, leading with Structure and Text instead of the alphabetical Form, and dropping `html`, `head`, `body`, `base`, `link`, `meta` and `title` from Other? Recommendation: no, describe what ships, because the ordering rule written here survives a reorder unchanged, so a reorder can land later as a `CATEGORIES` edit with no spec release, and either change needs a regeneration that also re-derives `allTags`, `cssProps` and `eventHandlers` from whichever `@webref` releases are installed, a review of the Style sidebar's data in its own right. If the sign-off says yes, the plan adds the `CATEGORIES` edit (and an exclusion set for Other), one regeneration reviewed as its own commit, and Other's sentence in §5.3 gains "except the document and head-only elements".
- **Decided:** fragment level `minor`, the program's level for a `reconcile`. Nothing an author writes depends on the palette's layout.

## Implementation

One pull request. Paths under `packages/studio/` unless they start with `specs/` or `docs/`.

1. `scripts/gen-webdata.ts`:
   - `writeFileSync(new URL("../data/webdata.json", import.meta.url), json)`, so the output lands in `data/` from any cwd. The formatting stays oxfmt's job, as for every other committed JSON file.
   - Header: name the file `gen-webdata.ts`, say it writes `data/webdata.json` and that the file is committed after `oxfmt` (the commit hook does it), and give the usage as "`bun run gen:webdata` (from packages/studio)". Final log line: "Written → data/webdata.json".
   - A doc comment on `CATEGORIES`: the Insert palette draws these groups in this key order, then Other, the remaining non-obsolete HTML elements (studio.md §5.3). `CATEGORIES` itself is unchanged.
2. `package.json`: `"gen:webdata": "bun run scripts/gen-webdata.ts"`.
3. `src/panels/elements-panel.ts`, comment only: `categoryViews`' doc reads "The categories that still have something in them, with the filter applied, in the order `webdata.elements` declares them (studio.md §5.3)."
4. `tests/elements-panel.test.ts`: two cases (below); `import webdata from "../data/webdata.json";` beside the other imports.
5. `specs/studio.md` §5.3, the fragment, `docs/studio/design/elements.md`, and the deletion of this file, as under Specs & docs.

`data/webdata.json` is not touched.

**Integration contract.** No plan requires this one. Once it lands, studio.md §5.3 states the element sections as `webdata.json`'s `elements` groups in declared order, drawn after the components, with no member list and no component section named, so `plan:_shared/component-discovery` and `plan:desktop/component-scope-sections` re-section the components without editing §5.3, and `plan:imports/packages-panel-section`'s `placeBlock` keeps §5.3's click sentence true as long as an element card still appends `defaultDef(tag)` as the last child of the primary selection. `bun run gen:webdata` works from `packages/studio`, so a later change to the groups is a `CATEGORIES` edit plus one regeneration.

## Tests

`bun test --isolate --coverage` from `packages/studio`. The file already imports `./harness` first.

In `describe("Insert panel — categories and filter")`:

- "sections follow the order the element data declares, not the alphabet": `renderElements({ elements: { Text: [{ tag: "p" }], Media: [{ tag: "img" }] } })`; `sectionNames()` equals `["Text", "Media"]`.
- "the committed element data is drawn whole, in its order, with Other last and each tag once": `renderElements(webdata)`; `sectionNames()` equals `Object.keys(webdata.elements)` and its last entry is `"Other"`; the `data-block-tag` of every `.element-card` has no duplicate and its count equals `Object.values(webdata.elements).flat().length`. `beforeEach` seeds an empty registry, so no components section is drawn. Select cards the way the file's other cases do at landing time: `.element-card` today, `[part="element-card"]` once `plan:ui/surface-classes-to-parts` lands (its integration contract names this count test).

No source file is added and no statement changes (`elements-panel.ts` gains a comment; `scripts/gen-webdata.ts` is never imported by a test and sits outside the manifest check's `src/**`), so no per-file figure moves and `coverageThreshold` in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) stays. `bun scripts/check-coverage-manifest.ts packages/studio` is unaffected.

## Specs & docs

`specs/studio.md` §5.3, in place (heading unchanged):

- **Delete the marker.** The section again leads with its "**§5.3 and §5.4 are one panel — Insert (`insert`).**" paragraph, unchanged.
- The palette sentence becomes: "HTML element palette, one section per category in the kit's accordion (`jx-accordion` with `multiple`, its default), drawn after the components (§5.4). Each element displays as a full-width card with:"
- The **Live preview** bullet gains ", or a `span` standing in for `script`, `style`, `link`, `iframe`, `object` and `embed`, whose live element would run, load or apply rather than show". The **Tag label** bullet is unchanged.
- "Categories: Layout, Typography, Media, Form, Interactive, Semantic, Table." is replaced by: "**The categories are data, not a list kept here.** They are the groups of the `elements` map in `packages/studio/data/webdata.json`, drawn in the order the map declares them. `CATEGORIES` in `packages/studio/scripts/gen-webdata.ts` (`bun run gen:webdata`) declares each named group and keeps only the tags `@webref/elements` lists as current; every remaining non-obsolete HTML element goes, sorted, into a last group, **Other**, so each element has exactly one section. This is not the element metadata §8.2.2 reads (`elements-meta.json`): that file decides which tags hold a caret, this one only what the palette offers."
- New paragraph: "A filter field above the accordion narrows every section, the components included, to the tags containing its text. A section it empties is not drawn, and a filter that matches nothing says so and offers to clear itself. Each section's open or closed state survives repaints and panel switches."
- "Elements are drag-and-drop sources for inserting into the canvas." is replaced by: "**An element card inserts two ways.** A click appends the element as the last child of the primary selection (§6.7), or of the document root when nothing is selected, and does nothing when no document is open. A drag drops it on the canvas or on an Outline row (§5.2), before, after or inside the target. Both insert `defaultDef(tag)` (`packages/studio/src/panels/shared.ts`): the tag with the placeholder text, attributes or children that keep a new element visible and valid (a heading reads Heading, an `a` carries `href="#"`, a `ul` holds one `li`)."

**Fragment:** `bun run spec:change studio.md minor -m "§5.3 states the Insert palette's element sections as the groups webdata.json declares, drawn in declared order after the components with Other last, and specifies the filter and inserting an element card by click as well as by drag."`

**Docs.** No page's `spec:` cites `studio.md#5.3`. `docs/studio/design/elements.md` lists `elements-panel.ts` in `code:`, so `bun run docs:sync` names it:

- Frontmatter gains `spec:` with `- studio.md#5.3`, so a later §5.3 release flags the page.
- "What's in the palette", second bullet, becomes: "**Element categories** come below: the HTML elements grouped by category in accordion sections, with **Other** last for every element no named group holds. Each card shows a small preview of the element and its tag name." Its click and drag sections already match the new text. No em dash.

`docs/studio/interface/canvas.md` ("The Insert panel") is unchanged. No image changes, so the screenshots lane has nothing to recapture for this pull request.

studio.md does not graduate: other studio.md items stay open, so `plans/studio/` stays.

## Acceptance

- `sed -n '/^### 5.3 /,/^### 5.4 /p' specs/studio.md | grep -c "Status: Partial\|Layout, Typography\|drag-and-drop sources"` prints 0.
- `bun run plans:status --who-claims studio.md#5.3` names no plan; `bun run plans:check --audit studio` reports nothing for studio.md §5.3.
- `ls specs/changes/studio-*.md` includes the new fragment, and `bun run spec:release --dry` mints a studio.md minor.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:markdown` and `bun run docs:prose` pass.
- From `packages/studio`: `bun test --isolate --coverage tests/elements-panel.test.ts` passes, and the full `bun test --isolate --coverage` keeps every file above `coverageThreshold`.
- From `packages/studio`: `bun run gen:webdata` exits 0 and logs `Written → data/webdata.json`; after `bunx oxfmt data/webdata.json`, `git diff -- data/webdata.json` is empty unless an installed `@webref` release moved (`elements` and `allTags` follow `@webref/elements`, `cssProps` `@webref/css`, `eventHandlers` `@webref/idl`). Discard that diff (`git checkout -- data/webdata.json`); it is not part of this pull request.
- In Studio, run **Show Insert** in a site project: the sections read the components, then Form, Interactive, List & Table, Media, Structure, Text, Other; with a `section` selected, clicking the `p` card appends a `p` reading "Paragraph text" as that section's last child.
