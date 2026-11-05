---
status: drafted
disposition: implement
claims:
  - spec.md#22
  - studio.md#8.5
requires: []
workspaces:
  - packages/schema
  - packages/compiler
  - packages/runtime
  - packages/server
  - packages/desktop
  - packages/site
  - packages/studio
  - packages/collab
  - packages/ai
  - scripts
  - specs
  - docs
size: L
---

# Jx documents can be written as `.jx` files in KDL, and Studio opens, edits and saves them without losing a comment

## Context

`specs/spec.md` §22 and `specs/studio.md` §8.5 are both Pending: no host reads `.jx`. `specs/spec.md` §2.3 ("JSON as the Authoritative Format") and `specs/site-architecture.md` §2 item 4 state the position this changes.

**Why do this.** A `.jx` file is much shorter to read and write than the JSON it replaces, for people and for agents, and it makes multi-line code in a document practical. Removing sidecars is a result, not the headline, and the numbers say so:

- Of 100 `$src` functions, 88 point at the kit, which the owner excluded. 10 are in examples and none are in starters.
- Of 862 function bodies, 820 are structured, which is what Studio edits visually, and none of the 42 strings has more than one line. JSON made multi-line code impractical, so some of this is survivorship, but the immediate gain is readability.

Canonical output from the repaired prototype, against formatted JSON (not yet optimized):

| Group           | Documents | Bytes | Lines |
| --------------- | --------- | ----- | ----- |
| Starters        | 217       | -36%  | -57%  |
| Examples        | 26        | -31%  | -49%  |
| Other           | 42        | -25%  | -31%  |
| Kit             | 76        | -12%  | -33%  |
| Studio surfaces | 94        | +9%   | -23%  |

Surfaces grow because `$switch` and `map` have no sugar yet. They stay `.json` by the owner's decision.

**What the data model has to carry** (484 documents, walked with `cases`): 8,409 elements, 6,451 attribute entries, 3 `<style>` elements. 2,711 of an undercounted 3,341 attributes had no hyphen, which is why attributes are the plain case. `onjx-ready` has 9 uses.

**External ground.** KDL 2.0.0 is stable. `@bgotink/kdl` 0.4.1 (MIT, single maintainer, pre-1.0) is 35.9 KB minified and 10.3 KB gzipped, parsed a 675 KB document in 117 ms and reprinted it byte for byte. Its mutation API is not good enough for saving: removing a first child prints `root {    /- …`, and appending indents with a tab.

**An initial outside assessment got the direction right, and its syntax does not work:** `r#"..."#` is KDL 1, `onclick={ … }` is a parse error, a bare `"text"` is the same node as `text`, and its hyphen rule leaves most attributes unaccounted for.

**An earlier draft of this plan failed adversarial review on 2026-11-05.** Its grammar table round-tripped 262 of 484 documents, and its Studio and collaboration claims were false. Corrected against the code:

- **Studio has no native path to reuse.** It knows a format class or JSON (`files/serialize-document.ts:73`, `canvas/canvas-render.ts:176`, `:186`, `:870`, `files/file-ops.ts:116`). Saving `x.jx` through that today writes JSON into it.
- **The CRDT does hold text.** `source: Y.Text` is "THE authoritative file content" (`packages/collab/src/schema.ts:7`), and the server persists it (`packages/server/src/collab.ts:112`, `:123`). A client saving against a stale copy erases another author's comment.
- **Collaboration cannot see reordering.** Running `packages/collab`: peers read different key orders, a reversed style gives `diffDocs` `[]`, and a set-key leaves Y unchanged, so a moved CSS declaration silently reverts. This affects `.json` today.

## Outcome

- spec.md §22 → Implemented: `.jx` is a second native format, with no extension to enable and the same `JxDocument` in memory.
- studio.md §8.5 → Implemented: open, edit, save and collaborate, with comments and layout surviving.
- `jx validate` reports `.jx` errors by line and column. `jx convert` moves a file either way with references repaired.
- Data round-trips exactly. Comments cannot exist in `.json`, so converting to `.json` drops them, and the command says so first.
- `.jx` is not yet the recommended format. That is the last slice of `plan:_shared/jx-typechecking`.

## Decisions

- **Decided:** KDL is a spelling, and the data model does not change. `parseJx(text)` returns the same `JxDocument` as `parseJxDocument`. §2.3 is rewritten to say the JSON _data model_ is authoritative.
- **Decided (owner):** Markdown stays an extension, unchanged. Studio surfaces and kit components stay `.json`.
- **Decided:** `project.json`, `*.class.json`, `jx-extension.json`, schemas and data files stay JSON.
- **Decided:** `.jx` is an always-on built-in entry in `FormatRegistry`, and no extension can claim it. So `documentExtensions()`, `byExtension`, the Code view, conversion and the refactor scan all answer for it through paths format classes already use. An earlier design kept it outside the registry beside `.json`, which left it invisible to all of them.
- **Decided:** Studio runs the built-in entry in process, not through `formatAction`. It costs 10.3 KB gzipped and needs nothing from a host, so the cloud host's Studio gets it unchanged.
- **Decided:** the built-in entry's `call` is a plain function and never imports an implementation module, because the cloud host's Worker resolves those only from a build-time table. Reading `.jx` there then needs only a version bump. `@bgotink/kdl` parsed this plan's sample under local `workerd` with `nodejs_compat` on 2026-11-05.
- **Decided:** handlers are marked, because names cannot separate them. `onboarding-flow part=x { … }` must stay an element, and `onjx-ready` must stay a handler. A property `on*=value` is always a handler. A child node is a handler only when annotated `(fn)` or `(on)`, and otherwise it is an element. The prototype round-trips all 484 documents this way and reads `onboarding-flow` as an element.
- **Decided:** own the JSON layer. `@bgotink/kdl`'s `toJson` turns `x (ref)"p"` into `"p"`, which caused all 222 failures above, silently. The wrapper reads JSON-in-KDL itself, as a superset that understands `(ref)` and `(fn)`. The library stays behind `packages/schema/src/jx/` as a parser with source locations, so it remains replaceable.
- **Decided:** duplicates are checked on the target key, after NFC. Only checking duplicate KDL properties misses `div a=1 { attributes { a 2 } }`, two `style` blocks, `$id A` with `div $id=B`, and `.children` with `-`, all of which lose data silently.
- **Decided:** source order is significant within `style`, nested blocks included, and nowhere else. The writer hoists only leading scalar declarations, which moved `style` order in 0 of 484 documents. Other key order moved in 424, which is harmless: 13 starters and `sites/test-blank` built with 0 byte differences. `examples/components/task-manager.json` compiles its two listeners in the other order, which is why the byte comparison below names starters and not every document.
- **Decided:** the writer emits raw multi-line strings only when they survive. 69 of 132 string attacks and 6 of 2,234 tracked sources do not: whitespace-only lines, CRLF and U+2028 can change silently, and control and bidi characters fail to parse. The writer checks each string by reading it back and falls back to an escaped string.
- **Decided:** reject what KDL tolerates and JSON would lose: `#inf`, `#nan`, out-of-range numbers, unknown annotations, raw control characters the library admits (U+001B), more than one positional value, more than one root, and a `__proto__` key (see `plan:schema/parse-boundary-readers`). A lone surrogate has no KDL spelling, so the writer refuses it, naming the pointer.
- **Decided:** saving reconciles by slices of source text, and does not mutate the library's tree. See below.
- **Decided:** in collaboration, `.jx` reconciles against the current `Y.Text`, not the file on disk and not a tab's cached source.
- **Decided:** compiled sites never ship KDL, and neither does the runtime core. `serveSite`'s file lane parses a `.jx` document and answers `application/json`, so the runtime's `res.json()` works unchanged on any site origin, and a reader never needs a parser. For the runtime used directly, `setDocumentParser(fn)` is a seam like `setBodyEraser`, and Studio's canvas installs it. It is not a lazy `import()` in core, because a host that bundles the runtime into one file would inline that import and ship the parser anyway.
- **Open:** how a `style` block keeps its order in the CRDT, given a `Y.Map` has none. Recommendation: a companion `Y.Array` of keys per style block, with `diffDocs` comparing order for style objects only, because that fixes the same defect for `.json`. The alternative is whole-value last-writer-wins on `style`, which undoes the per-property merge `GRANULAR_OBJECT_KEYS` exists for. Touches `plan:collab/granular-writes`.
- **Open:** `.jx` media type. Recommendation: `text/plain;charset=utf-8` in `server/src/file-response.ts`, unless JDF.2 finds that KDL's spec names one. It falls to `application/octet-stream` today.

## Implementation

### The grammar

```kdl
/- kdl-version 2
$schema "https://jxsuite.com/schema/v1"
$id Counter

// Comments stay in the file.
my-counter {
    state {
        count 0
        label ""
        max type=number default=10 attribute=max
        rows {
            - id=a name="First"
        }
        (fn)reset #"""
            state.count = 0
            console.log(`reset to ${state.count}`)
            """#
        (fn)rename event #"""
            const input = event.target as HTMLInputElement
            state.label = input.value
            """#
    }

    style display=inline-flex gap="6px" {
        "&:hover" color="var(--color-action)"
        #"&[data-kind="urgent"]"# backgroundColor="var(--chip-urgent-bg)"
    }

    span part=value aria-live=polite "${state.count}"
    button type=button onclick=(ref)"#/state/reset" "Reset"
    input .value="${state.label}" oninput=(ref)"#/state/rename"
    p {
        - "Hello "
        strong "world"
        - "!"
    }
    $array items=(ref)"#/state/rows" key=(ref)"$map/item/id" {
        li (ref)"$map/item/name"
    }
    slot
}
```

| Written                                       | Means                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Top-level `$x` nodes                          | Document metadata                                                                                            |
| The one other top-level node                  | The root element                                                                                             |
| Node name                                     | `tagName`                                                                                                    |
| One positional value                          | `textContent`                                                                                                |
| `name=value`                                  | `attributes.name`                                                                                            |
| `.name=value`, or a `.name` child             | The member `name`: a DOM property, `map`, `cases`, or a value that has no plainer form                       |
| `on*=value`                                   | Event handler                                                                                                |
| `(fn)on* [params] body`, `(on)on* { … }`      | Event handler in block form. Without the annotation, a node named `on…` is an element                        |
| `$x=value`, or a `$x` child                   | Jx member                                                                                                    |
| `state`, `style`, `attributes` child nodes    | Those members                                                                                                |
| Any other child node                          | Child element                                                                                                |
| `- value`                                     | Text or `$ref` child                                                                                         |
| `(ref)"pointer"`                              | `{ "$ref": "pointer" }`, in any value position, JSON blocks included                                         |
| `(fn)name [params] body`                      | `$prototype: "Function"`. A last string is always the body; a child block is a structured body (§20)         |
| `$array items= key= [filter=] [sort=] { el }` | `$prototype: "Array"`, with `el` as `map`                                                                    |
| `$element [tag]`                              | Escape for a tagless node, or a reserved tag: `state`, `style`, `attributes`, `script`, `-`, or one with `$` |
| Everything else                               | A JSON block: JSON-in-KDL plus `(ref)` and `(fn)`                                                            |

`script` is reserved now so that `plan:spec/document-scripts` can add it without breaking a document. Inside `map` and each value of `cases`, the element grammar applies. The prototype left those in JSON blocks, where `span part=value` means `{ span: { part: "value" } }`, a trap for anyone writing it by hand. JDF.1 adds this with the corpus test as proof. Also defined there, each with a golden file: `div {}` equals `div`; `state {}` is `{}`; empty `children` is `(array).children`; `$element "x"` has tag `x`; parameters without a body have no sugar and use a JSON block.

### Saving: the reconcile algorithm

`serializeJx(doc, previousSource?)` with no source emits canonical form. With one:

1. Parse `previousSource` with locations.
2. Walk the new document and the old tree together, matching members by key and children by a longest-common-subsequence over `(tagName, $id, key)`, so a pointer shift from an insertion does not misplace comments.
3. An unchanged subtree copies its exact source slice, comments and blank lines included.
4. A changed scalar replaces only its value's span. A changed subtree is emitted canonically at the old indent, and comments attached to surviving descendants stay.
5. A comment attached to a deleted node goes with it.

The property the tests hold: any single `doc-ops` operation changes only the lines of the node it touched.

### Where it lands

- **`packages/schema/src/jx/`** (`@jxsuite/schema/jx`): `parseJx`, `serializeJx`, and a span map from JSON Pointer to source offsets. `parse.ts` exports its NFC pass so both readers share it.
- **`FormatRegistry`** (`packages/schema/src/format-registry.ts:719`): the built-in entry, with `documentKinds` page, component and layout. `FormatRegistry` refuses an extension claiming `.jx`, as it does for `.json`.
- **Unnamed `.json` sites.** Each is a silent failure if missed, so JDF.2 and JDF.4 classify them by name, along with `compiler.ts:97`, `pages-discovery.ts:83`, `:203`, `site-build.ts:462`, `compile-element.ts:135`, `:182`, `:200`, `validate-command.ts:444`, `project-session.ts:1145`:
  - Layouts vanish: `panels/head-panel.ts:95`, `panels/site-model.ts:338`. Loud failure: `compiler/src/site/layout-resolver.ts:29`.
  - No `$layout`: `content/page-summaries.ts:53`, `content/collection-pages.ts:149`.
  - Components cannot draw: `panels/component-preview.ts:68`, `browse/library-preview.ts:276`, `style/stylebook-specimens.ts:45`.
  - Not routes: `panels/properties-panel.ts:442`, `grid/redirects-grid.ts:77`.
  - Preview: `site/src/compose.ts:140`, `server/src/live-preview.ts:211`.
  - AI writes skip validation: `services/ai-project-tools.ts:52`, `:302`.
  - Also `platforms/cloud.ts:1406`.
- **Refactoring.** `server/src/refactor/apply.ts:171` prefers `serialize`, which is given no source (`scan.ts:107`). `loadDoc` closes over the file's text for the built-in entry, so a rename reconciles rather than strips comments.
- **Runtime.** `resolve()` at `runtime.ts:394` calls `res.json()`. With a parser installed, a `.jx` URL answered as anything but JSON is read as text and parsed. With none, it fails naming the import that fixes it.
- **`packages/site`.** `serve.ts`'s file lane, for `.jx` under `SERVABLE_ROOTS`. `contentTypeFor` otherwise answers `application/octet-stream`. `compose.ts:92` already routes a non-JSON page through `io.parse`, which reaches the built-in entry. `COMPONENT_FILE` at `compose.ts:140` is one of the named sites below.
- **`jx convert`** in `compiler/src/cli.ts`, lazily importing the refactor pass from `@jxsuite/server` as `jx dev` does: `jx convert <paths…> --to jx|json [--dry-run]`. It writes to the old path, then renames, with the refusals of studio.md §8.4. Converting a commented `.jx` to `.json` refuses without `--drop-comments`, naming the count. Rollback is the same command in reverse, and data is lossless both ways.
- **Studio.** The built-in entry through `format/format-host.ts`, a Monarch grammar with TypeScript embedded in strings, and `format/convert-file.ts` gaining the pair through its existing derivation. `create/add-new.ts:700`, `:717` keep creating `.json` until the last slice of `plan:_shared/jx-typechecking`.
- **Collaboration.** `collab/collab-session.ts:399`, `:634` serialize against the current `Y.Text` and write a minimal text diff in one transaction. `:456` surfaces a Code view parse error as a Problem and keeps the text, instead of swallowing it and discarding the edit. `parseCollabSource` already refreshes `tab.doc.source` for a format path.

**Related, no edge.** `plan:schema/parse-boundary-readers` changes `parse.ts`, and whichever lands second shares the NFC and key-collision code. `plan:collab/room-schema-skew` sets the rule for changing the shared schema while a room has peers on two versions, which the `style` order change must follow. `plan:_shared/formats-from-extensions` rewrites nearby messages in `format-registry.ts` and `format-host.ts`, and owns studio.md §8.1. `plan:_shared/component-discovery` rewrites the component listing at `documentExtensions`.

**Integration contract.** Once this lands: `parseJx(serializeJx(doc))` deep-equals `doc`, with `style` order equal, for every valid document. Errors carry offsets. Pointer-to-span lookup works for any parsed node. `script` is reserved. `plan:spec/document-scripts` adds grammar rows and `plan:_shared/jx-typechecking` reads the span map.

## Tests

- `packages/schema`: the corpus test, over every tracked document, deep-equal plus `style` order. The KDL conformance suite. Rejections, including each silent-loss case above. NFC. The string attack set through the writer. A golden file per grammar row. Reconcile: every `doc-ops` operation, asserting a confined diff.
- `packages/compiler`: `.jx` page, layout and component build byte-identically to their `.json` twins, for all starters. `jx validate` reports line and column. `jx convert` both ways, refusals, comment refusal, references repaired.
- `packages/collab`, `packages/studio`: B comments in Code view, A edits a style, B's comment survives, and only one text is ever persisted. A reversed style converges on both peers. Open, edit and save a commented file with a one-line diff, a rename keeping comments, and each named `.json` site. Chrome MCP pass.
- `packages/runtime`, `packages/server`, `packages/desktop`, `packages/site`: `serveSite` answering a `.jx` document as JSON, the `setDocumentParser` seam, the media type, an assertion that no KDL parser enters the core bundle, and that no compiled site contains KDL.
- Coverage thresholds ratchet in every touched workspace. `bun test --isolate` throughout.

## Specs & docs

- `spec.md` §22: the grammar and rules; delete the marker. §2.3 rewritten in place, which is `major`; §1, §3, §4.1 amended. §18 gains KDL 2.0.0 and JSON-in-KDL rows, with `scripts/docs/standards.json`. Fragments: `bun run spec:change spec.md minor -m "Add the .jx document format"` and `bun run spec:change spec.md major -m "The JSON data model is authoritative, and .json and .jx are two spellings of it"`.
- `studio.md` §8.5: delete the marker; §8.4's derivation names `.jx`. `collab.md` §3.1: `style` order. `extensions.md` §7, §8 and `site-architecture.md` §2 item 4, §12: a second native format. `compiler.md` §12: `jx convert`. `embedding.md`: `setDocumentParser`. `server.md`: the media type. Each with a fragment. No heading renumbered.
- Docs land with the slice that ships the behaviour, not at the end: `docs/framework/concepts/jx-files.md` with a `docs/nav.json` entry in JDF.2, `docs/framework/build/cli.md` in JDF.2, `docs/studio/` pages in JDF.4, `docs/extending/extensions/formats.md`, `docs/framework/agents/authoring-rules.md`. `@docs` tags on each new source file. No em dashes in docs pages.

## Acceptance

- The corpus test passes on every document, and each starter's `jx build` output as `.jx` matches its `.json` build byte for byte.
- Opening a commented `.jx` in Studio, editing one style value and saving produces a one-line diff, solo and in a collaborative session.
- A `jx validate` error on a `.jx` file names line and column.
- No compiled site output contains KDL, and the runtime core bundle does not contain the parser.
- `bun run all-the-things`, `plans:check`, `docs:check` and `docs:standards` are green.

## Slices

Order: JDF.1, JDF.2, then JDF.3 and JDF.4.

| Slice | Scope                                                                                                                                         | Claims        | State |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----- |
| JDF.1 | Spec §22 grammar, `parseJx`, canonical `serializeJx`, span map, corpus test, conformance                                                      | spec.md#22    | open  |
| JDF.2 | Built-in entry, dispatch in compiler, server, desktop, site and runtime, `jx validate`, `jx convert`, media type, first docs page; closes §22 | spec.md#22    | open  |
| JDF.3 | Reconcile, and refactoring through it                                                                                                         | studio.md#8.5 | open  |
| JDF.4 | Studio open, edit and save, Monarch, the named Studio sites, collaboration; closes §8.5                                                       | studio.md#8.5 | open  |
