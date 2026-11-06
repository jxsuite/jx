---
status: drafted
disposition: implement
claims:
  - spec.md#22
requires: []
workspaces:
  - packages/schema
  - packages/compiler
  - packages/runtime
  - packages/server
  - packages/desktop
  - packages/site
  - packages/studio
  - packages/ai
  - scripts
  - specs
  - docs
size: L
---

# Jx documents can be written in Jx Notation, as `.jxn` files, and every host reads them and writes them without losing a comment

## Context

`specs/spec.md` §22 is Pending: no host reads `.jxn`. Editing a `.jxn` document in Studio is `plan:studio/jxn-documents`, split from this plan so that `plan:site-architecture/project-jxn`, which needs the reader and reconcile and none of the collaboration work, does not wait for it. `specs/spec.md` §2.3 ("JSON as the Authoritative Format") and `specs/site-architecture.md` §2 item 4 state the position this changes.

**Why do this.** A `.jxn` file is much shorter to read and write than the JSON it replaces, for people and for agents, and it makes multi-line code in a document practical. Removing sidecars is a result, not the headline, and the numbers say so:

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

**An earlier draft of this plan failed adversarial review on 2026-11-05.** Its grammar table round-tripped 262 of 484 documents, and its Studio and collaboration claims were false. Those corrections are in `plan:studio/jxn-documents`.

## Outcome

- spec.md §22 → Implemented: `.jxn` is a second native format, with no extension to enable and the same `JxDocument` in memory.
- `jx validate` reports `.jxn` errors by line and column. `jx convert` moves a file either way with references repaired. Studio's Code view can display and highlight a `.jxn` file, and `plan:studio/jxn-documents` gives it the rest of its Studio path.
- Data round-trips exactly. Comments cannot exist in `.json`, so converting to `.json` drops them, and the command says so first.
- `.jxn` is not yet the recommended format. That is the last slice of `plan:_shared/jx-typechecking`.

## Decisions

- **Decided (owner):** the format is **Jx Notation**, and its extension is `.jxn`, as JSON is a notation. This plan's first drafts used `.jx`, which collides with a project named Jx, in the same domain, that adopted it first. Renaming cost a search-and-replace, because no reader had shipped. It also ends a confusion in a project listing, where `.jx/` is a directory of generated files. Measured 2026-11-06, with GitHub code search counts:

  | Extension | GitHub files | Who uses it                                                                                                                                                                                                                                                                                                                                              |
  | --------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `.jx`     | 731          | `jpsca/jx`, a Python web-component library also named **Jx**: `jx` on PyPI since 2025-08, 1,423 downloads that month, with a VS Code extension displayed as "Jx" that claims `.jx`. Its predecessor `jpsca/jinjax` has 433 stars. Also the JX workflow language in `cooperative-computing-lab/cctools`, active, and JXcore packages, last pushed 2022-12 |
  | `.jxc`    | 10           | JXC, a live JSON-superset configuration language, so the same niche                                                                                                                                                                                                                                                                                      |
  | `.jxt`    | 12           | Apache Cocoon's JXTemplate                                                                                                                                                                                                                                                                                                                               |
  | `.jxm`    | 320          | `jafl/jx_application_framework` menus, active, and Atari ST GFA sources                                                                                                                                                                                                                                                                                  |
  | `.kx`     | 494          | The Kinx language and kX Audio Driver, and it loses the product's name                                                                                                                                                                                                                                                                                   |
  | `.kdx`    | 309          | KDAB's KDChart and others, and it loses the product's name                                                                                                                                                                                                                                                                                               |
  | `.jxe`    | 2            | Nothing live, but it reads as "executable"                                                                                                                                                                                                                                                                                                               |
  | `.jxn`    | 8            | One data file from a weather-sounding database and stray samples, so no format                                                                                                                                                                                                                                                                           |

  None of these appears in Linguist or the shared MIME database. The new name does not change the `jx` CLI, the `.jx/` directory, `parseJxDocument` or `jx-script:`, which name the product and not the file format. The product's official name is Jx Suite, which settles the overlap in names. The repository can move to `jxsuite/jxsuite` if that is ever needed.

- **Decided:** KDL is a spelling, and the data model does not change. `parseJxn(text)` returns the same `JxDocument` as `parseJxDocument`. §2.3 is rewritten to say the JSON _data model_ is authoritative.
- **Decided (owner):** Markdown stays an extension, unchanged. Studio surfaces and kit components stay `.json`.
- **Decided:** `*.class.json`, `jx-extension.json`, schemas and data files stay JSON. An earlier draft kept `project.json` here too, and the owner reversed that: `project.jxn` is `plan:site-architecture/project-jxn`, which reuses this grammar's JSON block, style rows and element rows. So this plan keeps those three reusable and does not assume a `.jxn` file holds a root element.
- **Decided:** `.jxn` is an always-on built-in entry in `FormatRegistry`, and no extension can claim it. `classifyJxn(text)` answers `project`, `document` or `unreadable` from a lexical prescan of the first node that is not `$` metadata, tolerating syntax errors after it, and every caller asks it first. It lands in JDF.1, because a broken file still needs an identity. A prototype passed 19 cases, including `project "x"\ndefaults {`, and refused a binary. So `documentExtensions()`, `byExtension`, the Code view, conversion and the refactor scan all answer for it through paths format classes already use. An earlier design kept it outside the registry beside `.json`, which left it invisible to all of them.
- **Decided:** Studio runs the built-in entry in process, not through `formatAction`. It costs 10.3 KB gzipped and needs nothing from a host, so the cloud host's Studio gets it unchanged.
- **Decided:** the built-in entry's `call` is a plain function and never imports an implementation module, because the cloud host's Worker resolves those only from a build-time table. Reading `.jxn` there then needs only a version bump. `@bgotink/kdl` parsed this plan's sample under local `workerd` with `nodejs_compat` on 2026-11-05.
- **Decided:** handlers are marked, because names cannot separate them. `onboarding-flow part=x { … }` must stay an element, and `onjx-ready` must stay a handler. A property is a handler when its name starts with `on` and its value is `(ref)`. A non-ref value on a real event-handler name (the `EventHandler` members `packages/schema/src/schema.ts:178` collects, `onclick` among them) is refused, with a message pointing at `(fn)onclick "…"`. It has to be refused and not read as an attribute: `buildAttrs` emits `attributes: { onclick: "state.x++" }` into the prerender as a live inline handler with no `state` in scope, and `button onclick="state.x++"` is the first thing anyone will try. `attributes { onclick "…" }` stays as the explicit escape. Any other `on*` name with a non-ref value is an attribute, so `once="x"` and `only="x"` work, where the first version of this rule made them a member named `once` and silently dropped them. `(fn)` as a property value is refused, since a function has a block form. No tracked document notices any of this: their `on*` members are refs, functions and `$expression` objects, never a string, and no attribute key in the 774 documents walked starts with `on`. The writer keeps a ref-valued attribute with such a name in an `attributes` block, because `attributes { once (ref)"#/x" }` is the one spelling that cannot read as a handler. A child node is a handler only when annotated `(fn)` or `(on)`, and otherwise it is an element. The prototype round-trips all 484 documents this way and reads `onboarding-flow` as an element.
- **Decided:** own the JSON layer. `@bgotink/kdl`'s `toJson` turns `x (ref)"p"` into `"p"`, which caused all 222 failures above, silently. The wrapper reads JSON-in-KDL itself, as a superset that understands `(ref)` and `(fn)`. The library stays behind `packages/schema/src/jxn/` as a parser with source locations, so it remains replaceable.
- **Decided:** an escape in a quoted string must not silently change code. KDL's `\s` is a space and `\b` a backspace, so `span "${state.x.replace(/\s+/g, '')}"` parses cleanly to `/ +/g`, run with the real parser on 2026-11-06, and `\b` in a word-boundary regex is no longer one. JSON rejects `\s`, and `\d` is an error in both, so this failure is new with KDL, and it arrives exactly where people will write code by hand. No tracked template holds a backslash today, so nothing has fired. The writer emits a raw string for any value holding a backslash. `jx validate` and Studio's Problems warn on `\s` or `\b` in any non-raw string, in any position, project files included, reading the source text through the span map because the parsed value has lost the evidence. Limiting it to code positions misses `input pattern="\s+"`, which parses to `" +"`, and warning on every escape would fire on the `\"` and `\n` that quoted code needs.
- **Decided:** duplicates are checked on the target key, after NFC. Only checking duplicate KDL properties misses `div a=1 { attributes { a 2 } }`, two `style` blocks, `$id A` with `div $id=B`, and `.children` with `-`, all of which lose data silently. `div a=1 a=2` is legal KDL with the rightmost winning, and `@bgotink/kdl`'s `getProperties()` has already collapsed it, so the reader has to walk `node.entries`.
- **Decided:** source order is significant within `style`, nested blocks included, and nowhere else. The writer hoists only leading scalar declarations, which moved `style` order in 0 of 484 documents. Other key order moved in 424, which is harmless: 13 starters and `sites/test-blank` built with 0 byte differences. `examples/components/task-manager.json` compiles its two listeners in the other order, which is why the byte comparison below names starters and not every document.
- **Decided:** the writer emits raw multi-line strings only when they survive. 69 of 132 string attacks and 6 of 2,234 tracked sources do not: whitespace-only lines, CRLF and U+2028 can change silently, and control and bidi characters fail to parse. The writer checks each string by reading it back and falls back to an escaped string.
- **Decided:** reject what KDL tolerates and JSON would lose: `#inf`, `#nan`, out-of-range numbers, unknown annotations, raw control characters the library admits (U+001B), more than one positional value, more than one root, and a `__proto__` key (see `plan:schema/parse-boundary-readers`). A lone surrogate has no KDL spelling, so the writer refuses it, naming the pointer.
- **Decided:** saving reconciles by slices of source text, and does not mutate the library's tree. See below.
- **Decided:** compiled sites never ship KDL, and neither does the runtime core. `serveSite`'s file lane parses a `.jxn` document and answers `application/json`, so the runtime's `res.json()` works unchanged on any site origin, and a reader never needs a parser. For the runtime used directly, `setDocumentParser(fn)` is a seam like `setBodyEraser`, and Studio's canvas installs it. It is not a lazy `import()` in core, because a host that bundles the runtime into one file would inline that import and ship the parser anyway.
- **Decided:** an editing server answers `.jxn` as `text/plain;charset=utf-8` in `server/src/file-response.ts`, where it falls to `application/octet-stream` today. KDL's current specification draft names no media type and has no IANA section, so nothing competes with it. The operating-system type is separate (`plan:desktop/jxn-file-association`), and a site origin answers JSON, as above.

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

| Written                                       | Means                                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Top-level `$x` nodes                          | Document metadata                                                                                                       |
| The one other top-level node                  | The root element                                                                                                        |
| Node name                                     | `tagName`                                                                                                               |
| One positional value                          | `textContent`                                                                                                           |
| `name=value`                                  | `attributes.name`                                                                                                       |
| `.name=value`, or a `.name` child             | The member `name`: a DOM property, `map`, `cases`, or a value that has no plainer form                                  |
| `on*=(ref)"pointer"`                          | Event handler. A non-ref value is refused on a real handler name, and is an attribute on any other `on*` name           |
| `(fn)on* [params] body`, `(on)on* { … }`      | Event handler in block form. Without the annotation, a node named `on…` is an element                                   |
| `$x=value`, or a `$x` child                   | Jx member                                                                                                               |
| `state`, `style`, `attributes` child nodes    | Those members                                                                                                           |
| Any other child node                          | Child element                                                                                                           |
| `- value`                                     | Text or `$ref` child                                                                                                    |
| `(ref)"pointer"`                              | `{ "$ref": "pointer" }`, in any value position, JSON blocks included                                                    |
| `(fn)name [params] body`                      | `$prototype: "Function"`. A last string is always the body; a child block is a structured body (§20)                    |
| `$array items= key= [filter=] [sort=] { el }` | `$prototype: "Array"`, with `el` as `map`                                                                               |
| `$element [tag]`                              | Escape for a tagless node, or a reserved tag: `state`, `style`, `attributes`, `script`, `project`, `-`, or one with `$` |
| Everything else                               | A JSON block: JSON-in-KDL plus `(ref)` and `(fn)`                                                                       |

`script` and top-level `project` are reserved now, with `classifyJxn` deciding the second, so that `plan:spec/document-scripts` and `plan:site-architecture/project-jxn` can add them without breaking a document. No tracked document uses either tag at that position. Inside `map` and each value of `cases`, the element grammar applies. The prototype left those in JSON blocks, where `span part=value` means `{ span: { part: "value" } }`, a trap for anyone writing it by hand. JDF.1 adds this with the corpus test as proof. A style key that needs quoting is rejected rather than misread: `> li` is a node `>` with the value `li`, and only the reader knows that cannot be a declaration. Also defined there, each with a golden file: `div {}` equals `div`; `state {}` is `{}`; empty `children` is `(array).children`; `$element "x"` has tag `x`; parameters without a body have no sugar and use a JSON block.

**Grammar decisions JDF.1 made, against the corpus.** `spec.md` §22.1 states them; the reasons are here. A lone `$array` child means a list of one, because that is 253 occurrences against 15 for the whole of `children` being one mapped array, which is spelled `.children { $array … }`. `$head` rows are elements in documents too, as in project files, and a non-list `$head` is written `(object)$head`. `$element tag text` is allowed, because a `<style>` or `<script>` with text is the reason the escape exists. A style value may be a list, for `@font-face`. `(object)` and `(array)` exist because `-` items cannot say "an empty list" and a block of names cannot say "an empty object where a list was expected". A structured function body is a child block of `-` items.

**Conformance, measured 2026-11-06.** `@bgotink/kdl` 0.4.1 passes 318 of the 319 cases at KDL's `2.0.0` tag. The one miss, `zero_space_before_slashdash_arg_fail`, admits `node/-arg`, which loses nothing. Through `parseJxn`, none of the 319 throws anything but a `JxnError`, and `classifyJxn` answers all of them. The suite is not vendored, so re-run this when the pinned version moves: `packages/schema/tests/jxn.test.ts` holds the syntax the grammar leans on as a table.

### Saving: the reconcile algorithm

`serializeJxn(doc, previousSource?)` with no source emits canonical form. With one:

1. Parse `previousSource` with locations.
2. Walk the new document and the old tree together, matching members by key and children by a longest-common-subsequence over `(tagName, $id, key)`, so a pointer shift from an insertion does not misplace comments.
3. An unchanged subtree copies its exact source slice, comments and blank lines included.
4. A changed scalar replaces only its value's span. A changed subtree is emitted canonically at the old indent, and comments attached to surviving descendants stay.
5. A comment attached to a deleted node goes with it.

The property the tests hold: any single `doc-ops` operation changes only the lines of the node it touched. Reconcile takes the grammar as a parameter, because `plan:site-architecture/project-jxn` runs it over a project file.

### Where it lands

- **`packages/schema/src/jxn/`** (`@jxsuite/schema/jxn`): `parseJxn`, `serializeJxn`, and a span map from JSON Pointer to source offsets. `parse.ts` exports its NFC pass so both readers share it.
- **`FormatRegistry`** (`packages/schema/src/format-registry.ts:719`): the built-in entry, with `documentKinds` page, component and layout. `FormatRegistry` refuses an extension claiming `.jxn`, as it does for `.json`.
- **Unnamed `.json` sites.** Each is a silent failure if missed, so JDF.2 classifies them by name, along with `compiler/src/site/layout-resolver.ts:29` (a loud failure), `compiler.ts:97`, `pages-discovery.ts:83`, `:203`, `site-build.ts:462`, `compile-element.ts:135`, `:182`, `:200`, `validate-command.ts:444`, `project-session.ts:1145`:
  - Preview: `site/src/compose.ts:140`, `server/src/live-preview.ts:211`.
  - AI writes skip validation: `services/ai-project-tools.ts:52`, `:302`.
  - Also `platforms/cloud.ts:1406`.
- **Refactoring.** `server/src/refactor/apply.ts:171` prefers `serialize`, which is given no source (`scan.ts:107`). `loadDoc` closes over the file's text for the built-in entry, so a rename reconciles rather than strips comments.
- **Runtime.** `resolve()` at `runtime.ts:394` calls `res.json()`. With a parser installed, a `.jxn` URL answered as anything but JSON is read as text and parsed. With none, it fails naming the import that fixes it.
- **`packages/site`.** `serve.ts`'s file lane, for `.jxn` under `SERVABLE_ROOTS`. `contentTypeFor` otherwise answers `application/octet-stream`. `compose.ts:92` already routes a non-JSON page through `io.parse`, which reaches the built-in entry. `COMPONENT_FILE` at `compose.ts:140` is one of the named sites below.
- **`jx convert`** in `compiler/src/cli.ts`, lazily importing the refactor pass from `@jxsuite/server` as `jx dev` does: `jx convert <paths…> --to jxn|json [--dry-run]`. It writes to the old path, then renames, with the refusals of studio.md §8.4. Converting a commented `.jxn` to `.json` refuses without `--drop-comments`, naming the count. Rollback is the same command in reverse, and data is lossless both ways.

- **Studio, minimum.** The built-in entry through `format/format-host.ts` and a Monarch grammar with TypeScript embedded in strings, here because `plan:site-architecture/project-jxn` opens a project file in the Code view with no other part of Studio's document path.

**Related, no edge.** `plan:schema/parse-boundary-readers` changes `parse.ts`, and whichever lands second shares the NFC and key-collision code. `plan:_shared/formats-from-extensions` rewrites nearby messages in `format-registry.ts` and `format-host.ts`, and owns studio.md §8.1. `plan:_shared/component-discovery` rewrites the component listing at `documentExtensions`. `plan:_shared/project-file-access` owns the project file's call sites, so this plan's discovery and glob work must not treat a root `project.jxn` as a document.

**Integration contract.** Once this lands: `parseJxn(serializeJxn(doc))` deep-equals `doc`, with `style` order equal, for every valid document. Errors carry offsets. Pointer-to-span lookup works for any parsed node. `script` is reserved. `plan:spec/document-scripts` adds grammar rows and `plan:_shared/jx-typechecking` reads the span map.

## Tests

- `packages/schema`: the corpus test, over every tracked document, deep-equal plus `style` order. The KDL conformance suite. Rejections, including each silent-loss case above. `once="x"` as an attribute and `onclick=(ref)"…"` as a handler. The escape warning firing on `\s` and `\b` in a quoted body and not in a raw one. NFC. The string attack set through the writer. A golden file per grammar row. Reconcile: every `doc-ops` operation, asserting a confined diff.
- `packages/compiler`: `.jxn` page, layout and component build byte-identically to their `.json` twins, for all starters. `jx validate` reports line and column. `jx convert` both ways, refusals, comment refusal, references repaired.
- `packages/runtime`, `packages/server`, `packages/desktop`, `packages/site`: `serveSite` answering a `.jxn` document as JSON, the `setDocumentParser` seam, the media type, an assertion that no KDL parser enters the core bundle, and that no compiled site contains KDL.
- Coverage thresholds ratchet in every touched workspace. `bun test --isolate` throughout.

## Specs & docs

- `spec.md` §22: the grammar and rules; delete the marker. §2.3 rewritten in place, which is `major`; §1, §3, §4.1 amended. §18 gains KDL 2.0.0 and JSON-in-KDL rows, with `scripts/docs/standards.json`. Fragments: `bun run spec:change spec.md minor -m "Add the .jxn document format"` and `bun run spec:change spec.md major -m "The JSON data model is authoritative, and .json and .jxn are two spellings of it"`.
- `extensions.md` §7, §8 and `site-architecture.md` §2 item 4, §12: a second native format. `compiler.md` §12: `jx convert`. `embedding.md`: `setDocumentParser`. `server.md`: the media type. Each with a fragment. No heading renumbered.
- Docs land with the slice that ships the behaviour, not at the end: `docs/framework/concepts/jxn-files.md` with a `docs/nav.json` entry in JDF.2, `docs/framework/build/cli.md` in JDF.2, `docs/extending/extensions/formats.md`, `docs/framework/agents/authoring-rules.md`. `@docs` tags on each new source file. No em dashes in docs pages.

## Acceptance

- The corpus test passes on every document, and each starter's `jx build` output as `.jxn` matches its `.json` build byte for byte.
- A `jx validate` error on a `.jxn` file names line and column.
- No compiled site output contains KDL, and the runtime core bundle does not contain the parser.
- `bun run all-the-things`, `plans:check`, `docs:check` and `docs:standards` are green.

## Slices

Order: JDF.2, JDF.3. JDF.1 landed: the grammar, `parseJxn`, the canonical `serializeJxn`, `classifyJxn`, `lintJxn`, the span map and the corpus test (467 of 467 documents, with `style` order; -26% bytes, -43% lines).

| Slice | Scope                                                                                                                             | Claims     | State |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----- |
| JDF.2 | Built-in entry, dispatch in compiler, server, desktop, site and runtime, `jx validate`, `jx convert`, media type, first docs page | spec.md#22 | open  |
| JDF.3 | Reconcile, and refactoring through it, the Monarch grammar; closes §22                                                            | spec.md#22 | open  |
