---
status: drafted
disposition: reconcile
claims:
  - studio-ui-guidelines.md#2.1
workspaces:
  - packages/studio
  - specs
size: S
---

# Font Stacks says which kit font token each surface draws, and Studio's own styles name no other stack

## Context

`specs/studio-ui-guidelines.md` §2.1, line 82:

> **Status: Partial.** The chrome draws the kit's font tokens: `--jx-font-sans` is `"Inter Variable", "Inter", system-ui, …` and `--font-mono` leads with the bundled JetBrains Mono (`packages/ui/project.json`, `packages/studio/styles/tokens.json`), so the sans stack in the table is only `tokens.css`'s pre-paint fallback. No content mode and no Georgia canvas face exist: `CANVAS_MODES` is preview, design, edit, stylebook and git-diff.

The table under it predates the census, which added only the marker: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` for UI chrome, `"SF Mono", "Fira Code", monospace` for code, and "Georgia, serif (content mode only)" for canvas content. Verified at the working tree on 2026-09-27:

- **Chrome.** `packages/ui/project.json` declares `--jx-font-sans: "Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif`, and 21 of the 38 documents in `packages/ui/components` declare `var(--jx-font-sans)` on the text they draw. Studio's root rule (`packages/studio/styles/tokens.json`) is `font-family: var(--jx-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif)`: the table's stack is that fallback, and it is the pre-kit system stack rather than the kit's. Inter does not ship: no `@font-face`, woff2 or stylesheet link names it, so the chrome draws Inter only where the machine has it installed.
- **Code.** `--font-mono: var(--jx-font-mono, "JetBrains Mono", "SF Mono", "Fira Code", monospace)`, whose fallback is the kit's stack verbatim, plus three `@font-face` weights (400, 500, 700) over `packages/studio/fonts/*.woff2` (`tests/build-styles.test.ts` asserts each is emitted once). Surfaces draw `var(--font-mono, monospace)`. The three Monaco editors, the function editor (`src/panels/editors.ts`) and the Code view and comparison (`src/canvas/canvas-render.ts`), are created with the literal `'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace`, since a Monaco option cannot hold a `var()`.
- **Canvas.** The stub said the iframe body uses the system sans stack. It does not: `canvas.html` declares no face and links no Studio stylesheet, so the canvas draws the document's own faces, and a page that declares none draws in the browser default, as it does when published (neither the compiler nor the runtime injects a face). The system stacks in `src/canvas/iframe-render.ts` belong to the chrome Studio injects into the frame: the empty-container placeholder, the layout-region, popover and dialog badges, and the stylebook's scaffolding, whose comment says "the parent theme vars don't exist in the iframe". `src/utils/edit-display.ts`'s `$switch` placeholder spells a mono stack there too.
- **Content mode.** It is not a canvas mode, but it survives as a `documentMode` for format-backed documents (`studio.md` §4.2's marker says so). No code gives it a face; "Georgia" appears in Studio only as a sample token value in `src/settings/css-vars-editor.ts`.
- **Other literal stacks in the Studio document.** The collab cursor flag (`cursorRulesFor`, `src/collab/monaco-cursors.ts`) and the canvas presence tag (`src/canvas/iframe-overlay.ts`, parent side) draw `10px/1.4 sans-serif`. `styles/panels.css` keeps parent copies of the three edit placeholders (`.empty-media-placeholder`, `.empty-text-placeholder…::after`, `.empty-container-placeholder` and its `::after`, the last with the system stack). No parent node matches them: the classes are written only by `src/utils/edit-display.ts`, whose output `iframe-host.ts` ships to the frame, where `iframe-render.ts`'s `EDIT_PLACEHOLDER_CSS` draws them, and `check-styles.ts` counts that template as their definition.
- **Gate interplay.** `guidelineTokenFindings()` in `packages/studio/scripts/check-styles.ts` reads every table row in the whole spec whose first cell is a backticked `--token` and whose third is a backticked value, and checks it against `tokens.css`; a token `tokens.css` does not declare (`--jx-font-sans`) is skipped silently.

**Related.** `ui.md` §4.3 (its Fonts row; not open). `plan:studio-ui-guidelines/chrome-type-scale` deletes §2.2's matching content-mode line height. `plan:studio-ui-guidelines/token-pipeline-prose` owns §1.1, whose "the sans stack is the kit's" this plan makes literally true. Neither is a prerequisite, in either direction.

## Outcome

- studio-ui-guidelines.md §2.1 → Implemented: a table naming the token each context draws (chrome `--jx-font-sans`, code `--font-mono`, canvas the document's own faces) that copies no stack; what ships (JetBrains Mono) and what does not (Inter); the content-mode Georgia face gone.
- Studio's own styles name a font family only through a token, except in the canvas frame's instrumentation and the Media view's font specimen, and a `packages/studio` test holds it (first Open decision).

## Decisions

- **Decided:** §2.1 keeps a three-row table (context, what it draws, the face a reader gets) and copies no stack, pointing at `ui.md` §4.3 and `packages/ui/project.json` for the values, because copied stacks are exactly what went stale, and the Studio facts (which surface draws which token, what ships, what the canvas draws) are not in `ui.md`. Every row's first cell is plain text, so `guidelineTokenFindings()` never reads a row as part of §1.1's table.
- **Decided:** the canvas row says the canvas draws the document's own faces and Studio sets none, and the Georgia row is deleted rather than moved onto the `content` document mode, because the canvas renders with the real runtime so a page looks as it will when published (`studio.md` §4.2), and a mode face would make a Markdown page look different in Studio than on the site.
- **Decided:** the frame's instrumentation keeps naming its stacks directly, because the frame carries nothing of Studio's cascade (`canvas.html` links no Studio stylesheet), and adopting the kit's theme there would add a stylesheet the published page does not have.
- **Decided:** Monaco's family is `MONACO_FONT_FAMILY`, exported from `src/shell.ts` beside `monacoTheme()` and read from `themeTokens` of `@jxsuite/ui/theme`, because Monaco measures glyphs from the string its options carry and cannot resolve a `var()` (the reason `monacoTheme()` exists), both callers already import `monacoTheme` from there, and `@jxsuite/ui/theme` touches no DOM and is already in the main bundle through `registerKit()`.
- **Decided:** the guard is a test in `tests/kit-tokens.test.ts`, not a new `check-styles.ts` rule, because it is one assertion over the tree, in the file that already holds Studio's tokens to the kit, reusing the script's exported comment strippers; a `check-styles.ts` rule would add a result field, a report branch and a budget for a list that ends at three allowances.
- **Decided:** the marker becomes `> **Status: Implemented.**` with one sentence, in §1's form, so the generated implementation-status page shows the section closed.
- **Open:** does the reconcile bring Studio's stragglers onto the kit's tokens, or only describe them? Recommendation: bring them (the root rule's sans fallback becomes the kit's stack verbatim, Monaco's literal becomes the kit's mono stack, the collab flag and presence tag draw the chrome's token, the dead `panels.css` copies go) and hold it with the test, because §2.1 can then state one rule with named exceptions instead of a list of stacks that drifts. Every change is inert on screen (the kit's theme is adopted before the shell mounts, and Monaco draws the bundled face once it loads) except the two 10px collab name labels, which move from the generic `sans-serif` to the chrome's face. Declining makes this a paper plan (Implementation step 1 only) that can land with its detailing; §2.1 then says the root rule's fallback is the platform's system stack, that Monaco is given a literal stack led by JetBrains Mono, and that the collab labels draw the generic `sans-serif`, and drops the sentence naming the test.
- **Open:** does Studio ship Inter, as it ships JetBrains Mono? Recommendation: no, not here; §2.1 records that the chrome draws Inter where the machine has it and the system face otherwise, because shipping it changes the chrome's face on every machine without Inter, re-captures every screenshot, and is a design call rather than a correction. If wanted, it is its own `implement` plan adding `@font-face` rules beside the mono ones.

## Implementation

1. **`specs/studio-ui-guidelines.md` §2.1**, rewritten as quoted under Specs & docs.
2. **`packages/studio/styles/tokens.json`**, the root rule: `"font-family": "var(--jx-font-sans, \"Inter Variable\", \"Inter\", system-ui, -apple-system, \"Segoe UI\", sans-serif)"`, the kit's value verbatim. Then `bun --cwd packages/studio run styles:sync` regenerates `styles/tokens.css`. Nothing else in the file moves; its `$description` ("the sans stack is the kit's") becomes true as written.
3. **`packages/studio/src/shell.ts`**: `import { themeTokens } from "@jxsuite/ui/theme";` and, directly after `monacoTheme()`, `export const MONACO_FONT_FAMILY = String(themeTokens["--jx-font-mono"]);` with a doc comment: the kit's mono stack as the string Monaco's `fontFamily` option takes, since Monaco measures glyphs from the family it is given and cannot resolve a `var()`.
4. **`src/panels/editors.ts`** (the function editor's `monacoNs.editor.create`) and **`src/canvas/canvas-render.ts`** (`createDiffEditor` and the source editor's `monaco.editor.create`): `fontFamily: MONACO_FONT_FAMILY`, added to each file's existing `../shell` import.
5. **`src/collab/monaco-cursors.ts`**, `cursorRulesFor`: `font:10px/1.4 sans-serif` becomes `font:10px/1.4 var(--jx-font-sans)`. It names the token rather than inheriting, because the flag sits inside the editor, which sets its own mono family.
6. **`src/canvas/iframe-overlay.ts`**, the presence tag's `cssText`: `font:10px/1.4 sans-serif` becomes `font:10px/1.4 var(--jx-font-sans)`.
7. **`styles/panels.css`**: delete the parent copies of the three edit placeholders (`.empty-media-placeholder`, `.empty-text-placeholder:is(…)::after`, `.empty-container-placeholder` and `.empty-container-placeholder::after`, about lines 60 to 100). Before deleting, re-run `rg -n "empty-(media|text|container)-placeholder" packages/studio/src` and confirm the writers are still only `src/utils/edit-display.ts` and the frame modules.
8. **`tests/kit-tokens.test.ts`**, the guard (Tests). Module-private: `FONT_STACK_ALLOWANCES`, a map of the three files that may spell a stack out to the reason each may (`src/canvas/iframe-render.ts` and `src/utils/edit-display.ts`: they draw inside the canvas frame, which has no kit tokens; `src/surfaces/media-pane.json`: its specimen falls back from the inspected font to the platform's), and `fontStackFindings(rel, text)`, returning each declaration of `font-family`, `fontFamily` or the `font` shorthand whose value is a string (not an object or array, so `font: { … }` in `css-vars-editor.ts` is no declaration) and still names a generic family (`serif`, `sans-serif`, `monospace`, `system-ui`, `ui-monospace`, `ui-sans-serif`, `ui-serif`, `cursive`, `fantasy`) once every `var(…)` group is removed. A custom property such as `--font-mono:` is not a `font` declaration. Comments and prose are blanked first with `stripComments`, `stripCssComments` and `stripDocProse` from `../scripts/check-styles`.
9. In the landing pull request, delete this file. It does not close the spec's last open item.

**Integration contract.** No plan requires this one. Once it lands: `MONACO_FONT_FAMILY` (`src/shell.ts`) is the family every Monaco editor is created with, and a new editor passes it; a font declaration anywhere in Studio's own styles names `var(--jx-font-sans)` or `var(--font-mono)`, or `kit-tokens.test.ts` fails naming the file and the value; §2.1 names contexts and tokens and holds no stack, so a change to the kit's stacks needs no edit there; and §2.1 names no content mode, which is what `plan:studio-ui-guidelines/chrome-type-scale` assumes when it deletes §2.2's.

## Tests

**`packages/studio`** (`bun test --isolate --coverage` from `packages/studio`):

- `tests/kit-tokens.test.ts`, new `describe("Studio's faces are the kit's")`:
  - "each font fallback in tokens.css is the kit's stack verbatim": the fallback in the root rule's `font-family: var(--jx-font-sans, …)` and in `--font-mono: var(--jx-font-mono, …)`, whitespace-squashed, equal `themeTokens["--jx-font-sans"]` and `themeTokens["--jx-font-mono"]` squashed; both patterns must match, so a moved declaration fails rather than passing unread.
  - "the face Studio ships is the one the kit's mono stack names first": the `@font-face` rules in `tokens.css` name exactly one family, and it is the first family of `themeTokens["--jx-font-mono"]`, quotes stripped.
  - "no font declaration in Studio's own styles names a family outside a var()": `fontStackFindings` over `styles/*.css`, `styles/*.json`, `src/**/*.ts` and `src/surfaces/**/*.json`, minus the allowance files, is empty; the message lists file and value.
  - "every font-stack allowance still spells a stack out": each allowance file yields at least one finding, which is both the negative control (the scanner reads something) and the ratchet (an allowance that suppresses nothing fails).
  - "the scanner reads each declaration shape": an inline fixture, where `font:10px/1.4 sans-serif`, `fontFamily: "'A', monospace"` and `"font-family": "system-ui, sans-serif"` are findings and `var(--font-mono, monospace)`, `font: 11px/1.6 var(--font-mono, monospace)`, `"--font-mono": "'A', monospace"`, `font: { value: "'Georgia', serif" }` and `@font-face { font-family: "JetBrains Mono"; }` are not.
- `tests/chrome-theme.test.ts`, beside `describe("monacoTheme")`: "MONACO_FONT_FAMILY is the kit's mono stack, as a string Monaco can measure": equals `String(themeTokens["--jx-font-mono"])` and contains no `var(`.
- `tests/editors.test.ts`, in "mounts into the dock body and leaves the canvas mounted": `created[0].options.fontFamily` is `MONACO_FONT_FAMILY`.
- `tests/canvas-render.test.ts`: "the Code view mounts a diff editor over the two texts, and no artboards" asserts `ed._options.fontFamily` is `MONACO_FONT_FAMILY`; the source editor's `create` double (about line 190) keeps the options it receives, and one Code-view mount test asserts the same.
- `tests/collab-source.test.ts`, "cursor rules escape hostile display names": the rules contain `font:10px/1.4 var(--jx-font-sans)` and no `sans-serif`.
- `tests/collab-presence.test.ts`, "setPresence draws colored boxes with name tags and clears wholesale": the tag's `style` attribute contains `var(--jx-font-sans)` and no `sans-serif`.
- `tests/build-styles.test.ts` "both sheets match their sources" is what proves step 2 was synced.

**Coverage.** No source file is added, so the manifest check is unaffected. `src/shell.ts` gains one constant, evaluated whenever the module loads; `packages/studio/bunfig.toml`'s `lines = 0.958, functions = 0.941` do not move and no ratchet applies. Every file the tests read is inside `packages/studio` (`themeTokens` comes through the `@jxsuite/ui` dependency edge), so `scripts/ci/affected.ts` needs no `EXTRA_EDGES` entry.

## Specs & docs

**`specs/studio-ui-guidelines.md` §2.1**, in place. The heading stays; the marker and the table become:

```markdown
> **Status: Implemented.** The chrome draws the kit's two font tokens, JetBrains Mono ships with Studio, and the canvas draws the document's own faces.

The stacks are the kit's `--jx-font-sans` and `--jx-font-mono` (`ui.md` §4.3), declared once in `packages/ui/project.json`. This section says which surface draws which, and repeats neither.

| Context            | Draws                                                                                                              | Face                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| UI chrome          | `--jx-font-sans`, set on the root by `styles/tokens.json` and declared by the kit's elements on the text they draw | Inter where the machine has it installed, else the platform's system face                                                             |
| Code / identifiers | `--font-mono`, Studio's alias of `--jx-font-mono`                                                                  | JetBrains Mono, which ships with Studio                                                                                               |
| Canvas             | The document's own `font-family`                                                                                   | What the page declares. Studio sets none, so a page that declares none draws in the browser's default face, as it will when published |

- **JetBrains Mono ships; Inter does not.** `styles/tokens.json` declares three `@font-face` weights (400, 500 and 700) over the woff2 files in `fonts/`, so a code view never draws a fallback face. Inter is named first and drawn where the machine has it.
- **Each fallback is the kit's own stack.** The `var()` fallback in the root rule's `font-family` and in `--font-mono` is the kit token's value verbatim, so whatever paints before the kit's theme is adopted (§1.1) is the face the theme will draw.
- **Monaco is given the stack as a string.** Monaco measures glyphs from the family its options name and cannot resolve a `var()`, so every Monaco editor is created with `MONACO_FONT_FAMILY` (`src/shell.ts`), the kit's mono stack read from `@jxsuite/ui/theme`, for the reason `monacoTheme()` exists beside it.
- **Outside a `var()` fallback, only the canvas frame spells a stack out.** The frame carries nothing of Studio's cascade, because anything declared there is a stylesheet the published page does not have, so the placeholders, badges and stylebook scaffolding Studio injects into it (`src/canvas/iframe-render.ts`, `src/utils/edit-display.ts`) name their stacks directly. Everywhere else a family is a token: `tests/kit-tokens.test.ts` refuses a font declaration in Studio's own styles that names a family outside a `var()`, with those two files and the Media view's font specimen (`src/surfaces/media-pane.json`) as its only allowances.
- **There is no content-mode face.** A format-backed document (`documentMode` `content`, `studio.md` §4.2) renders like any other, in the faces its layout and project declare.
```

Run `bun run format:md` over the file only if `docs:markdown` asks; the table's padding is the formatter's. **No other spec** changes: `ui.md` §4.3's Fonts row is already true, and §1.1 and §2.2 belong to their own plans.

**Release:** `bun run spec:change studio-ui-guidelines.md minor -m "Font Stacks names the kit token each surface draws instead of copying stacks, says JetBrains Mono ships and Inter is drawn where installed, gives the canvas the document's own faces, and drops the content-mode Georgia face that never shipped."`

**Docs pages.** None cites `studio-ui-guidelines.md#2.1`. `bun run docs:sync` will name `docs/studio/logic/code.md`, `docs/studio/interface/modes.md` and `docs/studio/design.md` (for `canvas-render.ts` and `editors.ts`) and `docs/studio/publish/collaboration.md` (for `monaco-cursors.ts`); none of them describes a typeface, so none changes, and the pull request says so. This plan does not graduate the spec.

## Acceptance

- `bun run plans:check --audit studio-ui-guidelines` reports nothing for `studio-ui-guidelines.md#2.1` once the file is deleted and the marker reads Implemented.
- `bun --cwd packages/studio run styles:check` and `bun --cwd packages/studio run lint:styles` pass; the latter proves `guidelineTokenFindings()` still parses §1.1's table and reads no §2.1 row.
- From `packages/studio`: `bun test --isolate --coverage` passes with the new cases, and the per-file thresholds hold.
- `rg -n "Consolas" packages/studio/src` finds nothing, and `rg -n "sans-serif|monospace" packages/studio/src packages/studio/styles` finds a literal stack only in the three allowance files, inside a `var()` fallback, or in prose.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check` and `bun run docs:links` pass; §2.1 names no Georgia face and no content mode, and no row of its table opens with a backticked token.
- The screenshots lane, if it runs, re-captures at most the collab name labels.
