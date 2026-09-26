# jx-markdown.md audit

Audited against b900b326 on 2026-09-26.

## Verified

- §1 (relationship to JSON, opt-in `Markdown` format class): extensions/parser/src/markdown.ts, extensions/parser/package.json, packages/compiler/src/site/pages-discovery.ts
- §3 (frontmatter keys and pass-through): extensions/parser/src/transpile.ts, extensions/parser/tests/jx-markdown.test.ts
- §4–§5 (container, leaf and text directives; colon nesting): extensions/parser/src/transpile.ts, extensions/parser/src/serialize.ts, extensions/parser/tests/jx-markdown.test.ts
- §6.1–§6.4 (attribute syntax, `$`-keyword mapping, `--title`/`--description` annotations, dot-path expansion): extensions/parser/src/transpile.ts, packages/studio/src/panels/layers-panel.ts, extensions/parser/tests/jx-markdown.test.ts
- §7, §7.1, §7.2 and §7.4 (element and root styles, media keys): `applyStyleKeyMapping` in extensions/parser/src/transpile.ts, extensions/parser/tests/jx-markdown.test.ts, extensions/parser/tests/transpile.test.ts
- §8 (`children.*` array descriptor): extensions/parser/src/transpile.ts, extensions/parser/tests/jx-markdown.test.ts
- §12.1–§12.7 (the transpiler API, both entry points, the dot-path and style helpers): extensions/parser/src/transpile.ts, extensions/parser/src/md.ts, extensions/parser/package.json, extensions/parser/tests/jx-markdown.test.ts, extensions/parser/tests/transpile.test.ts
- Informative: §2, §2.1, §6 (heading only), §10, §11, §12 (heading only), §13 (Standards Alignment; `**Subset**` is a conformance class and both evidence paths exist). The CommonMark row's note is not true of the code: it says §10 names the constructs §9 does not map and that each is dropped, but §10 names none, raw HTML and hard breaks are mapped, and reference links lose their text. The row binds §9, now marked Partial, so its tier follows that marker, and the plan that closes §9 rewrites the note.

## Dispositioned without a plan

- The whole-spec header stays `Partial`; there is no preamble marker, so it is not an item of its own. Before the census no section carried a marker, so the header was the only record of the six divergences below, each now marked on its own section and owned by a stub.
- §3.1, §6.5, §6.6, §7.3, §9 and §12.8, unmarked before the census, gained leading Partial markers.
  - §3.1: no code builds the `{ tagName: "div", $id: "content" }` wrapper; `splitFormatDocument` (packages/studio/src/format/format-host.ts) builds a tagName-less `children` root.
  - §6.5: the worked example does not transpile to the JSON shown, an `li` map template does not round-trip, and a repeater among a list's items re-parses outside the list.
  - §6.6: `directiveToJx` (extensions/parser/src/transpile.ts) sends every key outside a short property list to `attributes`, not to DOM properties, and on a custom element that includes `className` and `on*`, which neither renderer reads back from `attributes`.
  - §7.3: `placeholder` and `selection` are pseudo-elements listed and emitted as one-colon pseudo-classes, so `buildStyleRules` (packages/runtime/src/css.ts) writes a selector the browser discards. The spec and the code agree here, which is why a spec-against-code reading first passed it.
  - §9: reference-style links and images are dropped with their text, and GFM footnotes with their definitions; raw HTML and hard breaks are mapped but not tabulated.
  - §12.8: roundtrip mode's output does not re-parse to the document it was given for several ordinary shapes, the path Studio's save and reopen takes (packages/studio/src/files/serialize-document.ts). The API, both modes and the render-time `tagName` refusal hold (extensions/parser/src/serialize.ts, packages/compiler/src/site/site-build.ts, extensions/parser/tests/serialize-tagname-expression.test.ts).
- The serializer writes `popover-open`, `open`, `modal` and `backdrop` style keys with their colons (`collapsePropsToAttrMap` in extensions/parser/src/serialize.ts keeps its own pseudo-class set). That form re-parses, and §7.3 describes what the transpiler reads, not what the serializer writes, so it is recorded on §12.8's marker, whose "collapsed dot-path attributes" are the §12.7 form it misses, rather than on §7.3.
- Every divergence above was measured by running `transpileJxMarkdown`, `serializeJxMarkdown` and `buildStyleRules` on small inputs at b900b326; no test suite was run.
- No roadmap, status ledger or stale status cell.

## Spec-wide decisions

- Round-trip evidence for this spec is string-level: `serializeJxMarkdown` output fed back through `transpileJxMarkdown`, which is what a saved `.md` file re-opens as. The mdast-level tests (`jxToMdast` → `mdastToJx`) do not count: `mdastToJx` is on no production path, and its directive mapping has drifted from `directiveToJx`, so they passed on exactly the shapes that lose data as text. The §6.5, §6.6 and §12.8 plans all add string-level cases.
