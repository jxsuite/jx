---
status: drafted
disposition: implement
claims:
  - jx-markdown.md#3.1
requires: []
workspaces:
  - extensions/parser
  - specs
size: S
---

# The detection section states one component rule, applied to parsed frontmatter, and describes the content root Studio actually edits

## Context

`specs/jx-markdown.md` §3.1, line 75:

> **Status: Partial.** Detection ships: `isJxMarkdown` (`extensions/parser/src/transpile.ts`) performs the check and does not gate `transpileJxMarkdown`, and Studio applies the same rule through the `$studio.documentMode.componentWhen` hint in `extensions/parser/src/Markdown.class.json`. The `{ tagName: "div", $id: "content" }` wrapper does not exist: `splitFormatDocument` (`packages/studio/src/format/format-host.ts`) gives a content document a tagName-less root holding `children` plus any `state` and `imports`, and moves every other frontmatter key into a separate frontmatter object.

The section was unmarked before the census. Its last prose sentence (line 77) says content documents "produce a Jx element tree that is wrapped in a `{ tagName: "div", $id: "content" }` root by the studio". Re-verified at the current tree:

- **The wrapper is fiction.** No source in `packages/`, `extensions/` or `sites/` writes `$id: "content"`. `transpileJxMarkdown` (`extensions/parser/src/transpile.ts`, line 708) returns frontmatter keys at the top level and the body as `children` for every source, with `children` omitted when the body is empty. `splitFormatDocument` (`format-host.ts`, line 330) keeps a component whole; for a content document it builds `{ children }`, keeps `state` and `imports` on it, puts every other key (a non-qualifying `tagName` such as `div` included) into `frontmatter`, and seeds `[{ tagName: "p", children: [] }]` when the body is empty. The layers panel draws no row for that root (`layers-panel.ts`, line 825). `serializeDocument` (`packages/studio/src/files/serialize-document.ts`) merges `{ ...frontmatter, ...document, children }` back on save, and the seeded paragraph serializes to nothing (measured: `serializeJxMarkdown({ title: "T", children: [{ tagName: "p", children: [] }] })` is `"---\ntitle: T\n---\n"`). `packages/studio/tests/format-host-gaps.test.ts` ("content split") already pins the split and the seed.
- **"The same rule" is not quite true.** `isJxMarkdown` (line 261) runs `/^tagName:\s*.+-.+/m` over the raw frontmatter text. The hint is applied by `splitFormatDocument` to the parsed value: `typeof value === "string" && new RegExp(".+-.+").test(value)`. Measured with `isJxMarkdown` against the hint on `transpileJxMarkdown`'s output, they disagree on six ordinary YAML spellings:

  | Frontmatter                  | `isJxMarkdown` | Hint (what Studio does) |
  | ---------------------------- | -------------- | ----------------------- |
  | `tagName: div # my-note`     | true           | false                   |
  | `tagName: "-card"`           | true           | false                   |
  | `tagName:` then `- my-card`  | true           | false (not a string)    |
  | `tagName: [my-card` (bad)    | true           | parse throws            |
  | `tagName: >-` then `my-card` | false          | true                    |
  | `{tagName: my-card}`         | false          | true                    |

  Plain, quoted, CRLF, no-frontmatter, `title`-only and `tagName: div` sources agree.

- `isJxMarkdown` is exported from `@jxsuite/parser/transpile` and `extensions/parser/src/md.ts` and called by nothing outside the parser's own tests (`transpile.test.ts` line 193, `jx-markdown.test.ts` line 242). Studio never calls it; it classifies through the hint.
- `Markdown.class.json`'s `$studio.elements` already has a drift guard against `MD_ELEMENTS` (`extensions/parser/tests/capability-introspection.test.ts`, "Markdown.class.json $studio elements"); `documentMode` has none.

## Outcome

- jx-markdown.md §3.1 → Implemented. It states the component rule on the parsed frontmatter `tagName`, names the `Markdown` class's `documentMode` hint as where Studio reads it and `isJxMarkdown` as the standalone form, and describes the tagName-less content root Studio edits. The wrapper sentence is gone.
- `isJxMarkdown(source)` returns exactly what the hint decides for `Markdown.parse(source)`, and a test fails if the two ever diverge.
- jx-markdown.md stays Partial (§6.5, §6.6, §7.3, §9 and §12.8 remain open), so nothing graduates.

## Decisions

- **Decided:** the wrapper sentence is rewritten to what ships, not built, because the tagName-less root is load-bearing: the frontmatter panel owns every non-machinery key, the layers panel hides the root, and save merges the frontmatter back. A `div#content` root would put a real element into every saved content page that the author never wrote.
- **Open:** align `isJxMarkdown` with the hint, or document it as a raw-text approximation? Recommendation: align it (this plan's `implement` disposition), because §3.1 and §12.2 both say the utility "performs this check", and it returns `true` for `tagName: div # my-note`, a file Studio opens as content and the runtime renders as a `div`. The change is one function in a workspace nobody else calls into. If maintainers decline, the disposition becomes `reconcile`, the Implementation and Tests steps below drop to the spec edit alone, and §3.1's `isJxMarkdown` sentence instead reads "`isJxMarkdown(source)` (§12.2) approximates the rule over the raw frontmatter text, and can disagree with it for a YAML comment, a block scalar, a flow mapping or a non-string value". Removing the export is the third option and is rejected: it is public API on `@jxsuite/parser/transpile`, and keeping it costs a function.
- **Decided:** `isJxMarkdown` reads the frontmatter by calling `transpileJxMarkdown` itself, not a frontmatter-only remark pipeline, because `Markdown.parse` is `transpileJxMarkdown` (`extensions/parser/src/markdown.ts`, line 52), so the object the utility tests is the object Studio's hint tests, by construction. The cost is a full transpile in a utility no production path calls.
- **Decided:** a source whose frontmatter (or body) fails to transpile returns `false` rather than throwing, because a predicate should not throw, and such a file cannot open in Studio as either kind.
- **Decided:** the pattern stays `.+-.+`, not HTML's valid-custom-element-name production, because the rule only chooses an editing mode and mirrors `spec.md` §16.1's hyphenated root; validating the name belongs to registration.
- **Decided:** the rule is joined to `Markdown.class.json` by a drift test, not by importing the class JSON into `transpile.ts`, because the transpiler is browser-safe code with no reason to load Studio hints, and the `$studio.elements` guard already sets this pattern.
- **Decided:** no dependency on `plan:spec/root-tagname-optional`. The new §3.1 text never says how a tagName-less root renders, only how it is detected and edited, so it is right whichever lands first.

## Implementation

1. **`extensions/parser/src/transpile.ts`, `isJxMarkdown`** (the "Detection" block, line 250). Replace the body and docblock:

   ```ts
   /** The component rule: a character on each side of a hyphen (specs/jx-markdown.md §3.1). */
   const COMPONENT_TAG = /.+-.+/;

   /**
    * Whether a markdown source is a Jx component rather than content markdown: its parsed
    * frontmatter `tagName` is a string matching the rule `Markdown.class.json` declares as
    * `$studio.documentMode.componentWhen` (specs/jx-markdown.md §3.1). A source that does not
    * transpile is not a component.
    */
   export function isJxMarkdown(source: string): boolean {
     let tagName: unknown;
     try {
       ({ tagName } = transpileJxMarkdown(source));
     } catch {
       return false;
     }
     return typeof tagName === "string" && COMPONENT_TAG.test(tagName);
   }
   ```

   `transpileJxMarkdown` is a hoisted function declaration later in the same module, so the order in the file does not change. `md.ts`'s re-export and the README's export table are untouched.

2. **Tests**, as in Tests.
3. **`specs/jx-markdown.md` §3.1 and §12.2** and the fragment, as in Specs & docs.

**Integration contract.** No plan requires this one. Once it lands, `isJxMarkdown(source)` is `true` exactly when `Markdown.parse(source).tagName` is a string matching `.+-.+`, and `false` when `parse` throws, guarded by a test that reads the pattern and key from `Markdown.class.json`; a change to either side goes red there. jx-markdown.md §3.1 describes a content document as a tagName-less root with its non-machinery frontmatter held apart and merged back on save, which `plan:jx-markdown/roundtrip-lossless` may cite for the save path it tests. `plan:jx-markdown/directive-attribute-routing` edits `directiveToJx` in the same file, a different function, so either can land first.

## Tests

Workspace: `extensions/parser` (`bun test --isolate --coverage` from `extensions/parser`).

- `tests/transpile.test.ts`, `describe("isJxMarkdown")`, new cases:
  - `false when the hyphen sits only in a YAML comment`: `---\ntagName: div # my-note\n---\n` → `false`.
  - `false when nothing precedes the hyphen`: `---\ntagName: "-card"\n---\n` → `false`.
  - `false for a non-string tagName`: `---\ntagName:\n  - my-card\n---\n` → `false`.
  - `false, without throwing, when the frontmatter does not parse`: `---\ntagName: [my-card\n---\n` → `false`.
  - `true for a block-scalar tagName`: `---\ntagName: >-\n  my-card\n---\n` → `true`.
  - `true for flow-mapping frontmatter`: `---\n{tagName: my-card}\n---\n` → `true`.
  - The five existing cases here and the four in `jx-markdown.test.ts` keep their expectations.
- `tests/capability-introspection.test.ts`, new `describe("Markdown.class.json $studio documentMode")` (add `import { isJxMarkdown } from "../src/transpile"`):
  - `defaults to content and promotes on tagName`: `def.$studio.documentMode.default` is `"content"` and `componentWhen.frontmatterKey` is `"tagName"`.
  - `isJxMarkdown decides as the hint does on what parse returns (drift guard)`: for each source in a table (the six above plus plain `my-card`, CRLF, no frontmatter, `title` only and `tagName: div`), compute `expected` by applying `new RegExp(componentWhen.matches)` to `Markdown.parse(source)[componentWhen.frontmatterKey]` when it is a string (`false` when it is not, or when `parse` throws) and assert `isJxMarkdown(source)` equals it.
- `tests/jx-markdown.test.ts`, new string-level case (the audit's round-trip evidence rule):
  - `a content document's seeded empty paragraph serializes to its frontmatter alone`: `serializeJxMarkdown({ title: "T", children: [{ tagName: "p", children: [] }] }, { mode: "roundtrip" })` equals `"---\ntitle: T\n---\n"`, and `transpileJxMarkdown` of that string equals `{ title: "T" }`.
- **Coverage.** No new source file, so the manifest check is unaffected. `transpile.ts` gains one `try`/`catch`, both arms reached by the cases above, against the per-file `coverageThreshold = { lines = 0.987, functions = 0.975 }` in `extensions/parser/bunfig.toml`. The regex branch it replaces is deleted, so the file's coverage cannot fall; if the run shows the workspace's worst file rose, ratchet the threshold to just below the new minimum.

## Specs & docs

**`specs/jx-markdown.md` §3.1**, in place (heading unchanged). Delete the `> **Status: Partial.**` blockquote, matching every other verified section of this spec, which carries no marker. Replace the paragraph on line 77 with two:

> A `.md` file is a Jx component, rather than content markdown, when its frontmatter `tagName` is a string with at least one character on each side of a hyphen (the pattern `.+-.+`), the Markdown form of the hyphenated root that makes a document a custom element definition (`spec.md` §16.1). The rule reads the parsed frontmatter, so a quoted or block-scalar `tagName`, or one written in flow-mapping frontmatter, counts, and a hyphen in a YAML comment does not. The `Markdown` format class declares it as data, `$studio.documentMode: { "default": "content", "componentWhen": { "frontmatterKey": "tagName", "matches": ".+-.+" } }` (`parser.md` §3), and Studio classifies each file it opens by that hint (`studio.md` §8.1). `isJxMarkdown(source)` (§12.2) applies the same rule to a source string, for a caller outside the format registry.
>
> Detection does **not** gate the pipeline: every `.md` file goes through `transpileJxMarkdown()`, which returns the same shape either way, frontmatter keys at the top level and the body as `children`. A content document therefore has no element of its own at the root. Studio edits it as that root: `children`, `state` and `imports` stay on the document, every other frontmatter key is held apart as the document's frontmatter, and the two are merged back when the file is saved (`studio.md` §8.3). A body with no blocks is given one empty paragraph to type into, which serializes to nothing. This enables gradual enhancement: any `.md` file can add Jx schema at any point without changing how it is processed.

**`specs/jx-markdown.md` §12.2**, in place: "Returns `true` if the markdown source is a Jx component (frontmatter has `tagName` with a hyphen)." becomes "Returns `true` when the source is a Jx component by §3.1's rule, applied to the frontmatter `transpileJxMarkdown` parses, and `false` otherwise, including for a source that does not transpile."

**Fragment:** `bun run spec:change jx-markdown.md minor -m "3.1 states the component rule on the parsed frontmatter tagName, names the Markdown class's documentMode hint as where Studio reads it, and describes the tagName-less content root Studio edits instead of a div wrapper; isJxMarkdown applies the same rule and returns false for a source that does not transpile"`.

**Docs.** No page cites `jx-markdown.md#3.1` or `#12.2`. `bun run docs:sync` names `docs/framework/site/jx-markdown.md` (its `code:` lists `transpile.ts`, its `spec:` the whole spec): no change, because its line "A `.md` file whose frontmatter has a `tagName` containing a hyphen is a component; a file without one is a content document … that produces a plain element tree" stays true and never mentioned the wrapper. `docs/extending/extensions/formats.md` describes `documentMode` accurately and its `code:` names only `Markdown.class.json`, which does not change. `extensions/parser/README.md`'s export table is unchanged.

No spec graduates: the header stays `Partial`.

## Acceptance

- `bun run plans:status --spec jx-markdown` no longer lists `jx-markdown.md#3.1`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:markdown` pass.
- `git grep -n 'id: "content"' -- specs extensions packages` prints nothing, and `sed -n '/^### 3.1/,/^## 4\./p' specs/jx-markdown.md | grep -c 'Status: Partial'` prints `0`.
- From `extensions/parser`: `bun -e 'import { isJxMarkdown as j } from "./src/transpile.ts"; console.log(j("---\ntagName: div # my-note\n---\n"), j("---\n{tagName: my-card}\n---\n"), j("---\ntagName: [x-y\n---\n"))'` prints `false true false`.
- `bun test --isolate --coverage` from `extensions/parser` passes with the nine new cases listed and no per-file threshold failure.
