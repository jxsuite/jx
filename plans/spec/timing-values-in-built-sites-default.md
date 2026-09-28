---
status: drafted
disposition: reconcile
claims: []
requires: []
size: S
---

# The timing table says what an unset `timing` means: `"client"` for a built-in prototype, build-time resolution for an external class

## Context

Split from `plan:spec/timing-values-in-built-sites`, which owns `spec.md` §11.3 and requires this plan. The census stub left one question open, "one meaning for an unset `timing`", with a `reconcile` of the table's "(default)" wording as one answer and a split if detailing chose it. This plan is that reconcile. It claims nothing because §11.3 stays Partial for the owner's work; it can land alone, before or after either of the owner's prerequisites, and its marker edit is written for either order.

`specs/spec.md` §11.3, the `"client"` row (line 1232) says "Resolved at runtime in the browser (default)". The leading marker (line 1228) ends its client sentence:

> … an external class with `timing: "client"` reaches a built page as its literal definition object (compiler.md §3), and one with no `timing` is resolved at build time (`resolvePrototypes`), so the two tiers disagree about the default.

**What ships** (verified 2026-09-27):

- **Site build, built-ins.** `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`) skips a built-in (`SKIP_PROTOTYPES`) or finds no class for its name and `continue`s, so an unset `Request`, `LocalStorage` or `Cookie` reaches `compileClient` and is lowered for the browser (§11.2 owns which ones are). An unset built-in is `"client"` in both tiers.
- **Site build, external classes.** An entry with no `timing` skips the lowering branch (`def.timing && def.timing !== "compiler"`), gets its `$src` from `imports` or the registry, and is resolved by `resolveClassPrototype`. The value is not marked `timing: "compiler"`, so `compilePage`'s strip (`packages/compiler/src/site/site-build.ts`) keeps it: an object always stays in client state, and an array stays only while something surviving still reads it (compiler.md §8.1). A scratch `buildSite` confirmed both halves: a class resolving to `{ name: "Ada" }`, bound by `${state.g.name}`, baked `<h1>Ada</h1>` and shipped `g: {"name":"Ada",…}` in `app.js`; the same entry with `timing: "compiler"` baked the same heading and shipped no script.
- **Components.** A component's state never reaches the resolver (`buildSite` compiles components with `compileElement`), so there an external class is its literal definition at every timing. `plan:compiler/client-external-class-hydration` routes component documents through the resolver.
- **The interpreter ignores `timing` on every `$prototype` entry.** `buildScope`'s fourth pass (`packages/runtime/src/runtime.ts`) calls `resolvePrototype` for each one whatever its `timing`; only a function entry's `"server"` changes the path (the fifth pass, `isServerFnDef`). Studio's canvas and preview therefore resolve an unset external class when they render, as they do a `"client"` or `"compiler"` one.
- **Usage.** 22 entries in 21 tracked `.json` documents name an external class with no `timing`, all content classes: the `ContentEntry` and `ContentCollection` pages of six starters (blog, museum, portfolio, professional-firm, real-estate, shop), `sites/jxsuite.com/layouts/docs.json` and `pages/docs/[...slug].json`, `examples/pages/advanced/markdown-blog.json` (`Markdown` and `MarkdownCollection`), the three `first-collection*` screenshot fixtures, and `packages/desktop/tests/_fixtures_content/pages/index.json`. `docs/framework/site/content-collections.md` writes its `ContentCollection` example without `timing`. None names an external class at `"compiler"`.
- **Docs that state the unbuilt default.** `docs/framework/concepts/timing.md` (the table's `"client"` row "(the default)", "`"client"` is the default: omit `timing` and the entry resolves in the browser", and the first "Rules" bullet), `docs/framework/concepts/reactivity.md` (its "Timing" table's `"client"` row, "(default)"; the page cites `spec.md#6`, so `docs:sync` does not name it) and `docs/framework/agents/authoring-rules.md` rule 13 ("`"client"` is the default"). `docs/framework/build.md` already documents the kept array ("Mark it `timing: "compiler"` to say the data really is build-time only").

## Outcome

- `spec.md` §11.3 states the unset rule for built-ins, external classes and interpreting hosts, and its marker no longer names the default as a disagreement. The section stays Partial and stays `plan:spec/timing-values-in-built-sites`'s.
- The docs pages above say the same, and `build.md` gains the unset case.

## Decisions

- **Open:** what does an unset `timing` mean? Recommendation: reconcile the text to what ships, a built-in is `"client"` and an external class is resolved during the build with its value kept as client state, because both alternatives break working sites. Making an unset external class `"client"` would move those starters' `ContentEntry` and `ContentCollection` entries into the browser, where they cannot run: they read `#/$context/`, which `plan:compiler/client-external-class-hydration` refuses at `"client"` timing because a built site has no proxy to supply it. Making it `"compiler"` would strip the value, breaking every page whose computed or handler still reads it, which is the failure the array rescue exists for (issue #122, compiler.md §8.1). `plan:compiler/client-external-class-hydration` (the owner's prerequisite, not this plan's) already decided that only an explicit `"client"` hydrates, so no plan's code changes with this answer.
- **Decided:** the paragraph also states what an interpreting host does, because the stub's "the two tiers disagree" is only true of the text: the interpreter resolves every `$prototype` entry when it renders, whatever its `timing`, and has no build to defer to. Saying so is what makes one rule cover both tiers.
- **Decided:** the fragment is `minor`, not `major`. The behaviour authors rely on (content entries without `timing`) does not change; only a sentence that never held in a build does.
- **Decided:** stripping an unread object value, as an unread array already is, stays out of scope. It would stop those starters' `[slug]` pages shipping their entry as state, but it is a compiler.md §8.1 change with its own risk (a read the string search misses breaks the page at runtime). The docs tip below gets authors the same result explicitly.

## Implementation

A paper plan: the steps are the text edits under "Specs & docs". In the landing pull request, delete this file and remove `spec/timing-values-in-built-sites-default` from the `requires` of `plan:spec/timing-values-in-built-sites`, and re-read that plan's Specs & docs, which extends the paragraph this plan adds.

**Integration contract.** Once this lands, §11.3 carries a paragraph headed **An unset `timing`.** directly under the table, which `plan:spec/timing-values-in-built-sites` extends with a sentence on the build failing for a class it cannot locate. The `"client"` row's "When" cell reads "the default for a built-in prototype". The marker's client sentence names only the gaps `plan:compiler/client-external-class-hydration` has not yet closed (the external-class one until CEC1.2, the component one until CEC1.1), and no longer mentions the default.

## Tests

No code changes. The gates that prove it: `bun run docs:status` (marker forms), `bun run docs:spec-release` (the fragment covers the body change), `bun run plans:check` (the owner's `requires` edge is gone with this file), `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` (the four pages).

## Specs & docs

**`specs/spec.md` §11.3**, in place:

- The table's `"client"` row, "When" cell: "Resolved at runtime in the browser (default)" becomes "Resolved at runtime in the browser (the default for a built-in prototype)". Re-pad the table (`bun run format:md`).
- Directly under the table, before the trailing `> **Status: Implemented.**` note, add:

  > **An unset `timing`.** What an entry with no `timing` means depends on what it names. A built-in prototype (§11.2) is `"client"`. An external class (§12) is resolved by a site build during the build, as a `"compiler"` one is, and templates over its value are baked into the page; unlike a `"compiler"` entry it is not stripped afterwards, so the built page also keeps the value as the entry's initial state (an array only while something the page runs in the browser still reads it, compiler.md §8.1). A class that must be constructed in the browser says `"client"`; one that only the HTML reads is best written `"compiler"`, which ships no state for it. An interpreting host (Studio's canvas and preview, or `jx dev` on a root without a `project.json`) has no build: it resolves every `$prototype` entry when it interprets the document, whatever its `timing`, so only a function entry's `"server"` (§11.4) changes where an interpreted value comes from.

  (Written as a plain paragraph, not a blockquote; the `>` above only sets it off here.)

- The leading marker's client sentence, in the wording that stands, loses its default clause: ", and one with no `timing` is resolved at build time (`resolvePrototypes`), so the two tiers disagree about the default" is deleted and the sentence ends at the full stop. Today that leaves "The client row holds in the interpreter, but in compiled output only for the built-ins a target lowers (§11.2) and for a registry class with a `lower` capability: an external class with `timing: "client"` reaches a built page as its literal definition object (compiler.md §3)."; after `plan:compiler/client-external-class-hydration#CEC1.2` it leaves "The client row holds in the interpreter, and in compiled output for an external class (compiler.md §3) and for the built-ins a target lowers (§11.2)." Then, only if `plan:compiler/client-external-class-hydration#CEC1.1` has not landed, add after it: "A component's state never reaches the build-time resolver, so in a component an external class stays its literal definition whatever its `timing` (compiler.md §3)." The compiler and server sentences are unchanged, and the marker stays `Partial`.
- Fragment: `bun run spec:change spec.md minor -m "§11.3 states what an unset timing means: client for a built-in prototype, and build-time resolution for an external class, whose value a built page keeps as initial state; an interpreting host resolves every prototype entry as it interprets the document."`

**Docs** (no em dashes; `bun run docs:sync` names `timing.md` through `spec.md#11.3`, and the other three pages are named by hand because none cites §11.3):

- `docs/framework/concepts/timing.md`, the table's `"client"` row: "At runtime, in the visitor's browser (the default)" becomes "At runtime, in the visitor's browser (the default for a Web-API prototype)". Re-pad the table.
- `docs/framework/concepts/reactivity.md`, "## Timing": the `"client"` row's "Resolved at runtime in the browser (default)" becomes "Resolved at runtime in the browser (the default for a Web-API prototype)", and a sentence follows the table: "What an entry without `timing` does is on [Timing](/docs/framework/concepts/timing#leaving-timing-out)." Re-pad the table.
- `docs/framework/concepts/timing.md`, "## Client": replace the paragraph with "A Web-API [data prototype](/docs/framework/concepts/data-prototypes) (`Request`, `LocalStorage`, `IndexedDB`, …) with no `timing` is client-timed: it resolves in the visitor's browser. An external class, such as a content collection, is different; see [Leaving timing out](#leaving-timing-out)."
- The same page, a new "## Leaving timing out" section before "## How it works": "What an entry without `timing` does depends on what it names:" followed by three bullets. "A Web-API data prototype resolves in the browser, as `"client"`." "An external class (a content collection, or your own `.class.json`) resolves during the build, as `"compiler"` does, and the page also keeps its value as state, so code running in the browser can still read it. Write `"compiler"` when only the HTML reads the value: the entry is dropped after the build and the page can ship no JavaScript. Write `"client"` when the class has to run in the visitor's browser." "Studio's canvas and preview have no build, so they resolve every entry while they show the page, whatever its `timing`."
- The same page, "## Rules": the bullet "`"client"` is the default whenever `timing` is absent." becomes "With no `timing`, a Web-API data prototype resolves in the browser and an external class resolves during the build."
- `docs/framework/agents/authoring-rules.md`, rule 13: "`timing` (`"compiler"`, `"server"`, `"client"`) decides where a data source resolves. Left out, a Web-API prototype such as `Request` is `"client"`, and an external class such as `ContentCollection` is resolved during the build; write `"compiler"` when only the HTML reads it."
- `docs/framework/build.md`, "Why is my page shipping JavaScript?": a bullet after the first, "**An external class with no `timing`**, such as a `ContentEntry`, is resolved during the build and its value also ships as page state. Write `timing: "compiler"` when only the HTML reads it."

spec.md does not graduate.

## Acceptance

- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass.
- `grep -n "disagree about the default" specs/spec.md` prints nothing; `grep -n "An unset \`timing\`" specs/spec.md` prints the §11.3 paragraph.
- `grep -rn "is the default whenever\|(the default)\|(default)" docs/framework/concepts/timing.md docs/framework/concepts/reactivity.md` prints nothing.
- `bun run plans:status --who-claims spec.md#11.3` still names `spec/timing-values-in-built-sites`.
