---
status: drafted
disposition: reconcile
claims:
  - spec.md#16.7
size: S
---

# The development/production table names the hosts behind each renderer and cites compiler.md for the bundle sizes it used to guess

## Context

`specs/spec.md` §16.7, line 1745:

> **Status: Partial.** Both renderers exist as tabled. The Development column describes Studio's live preview and canvas (`packages/server/src/live-preview.ts`) and roots without a `project.json`, not `jx dev` on a site project, which builds with `buildSite` and serves the compiled pages (`startDev` in `packages/server/src/dev.ts`); and the "~10 kB deps" figure has no committed measurement.

The table under it has two columns, Development and Production, and four rows (Renderer, State, Source, Bundle); the Bundle cell of Production reads "`.js` classes only (~10 kB deps)". Re-verified against the working tree on 2026-09-27.

**What ships, and where the table is wrong**

- Interpreter: `@jxsuite/runtime` (`packages/runtime/src/runtime.ts`) builds DOM directly, with `@vue/reactivity` as its only third-party dependency (`packages/runtime/package.json`); it exports `mount` (line 178), `Jx` and `defineElement` for a page to call itself (embedding.md §2).
- Studio's canvas imports the runtime (`packages/studio/src/canvas/iframe-render.ts` and its siblings). Studio's live preview serves the source tree through `serveSite` with a shell that imports the runtime bundle from `/__jx_live__/runtime.js` (`packages/server/src/live-preview.ts`, `packages/site/src/shell.ts`; `packages/server/tests/live-preview.test.ts`, "a page renders as a shell that hands the document to the runtime", "the runtime bundle is served, and cached hard").
- `jx dev` (`packages/compiler/src/site/dev-command.ts`) spawns `@jxsuite/server/dev`. On a root with a `project.json`, `startDev` builds with `buildSite`, serves `dist/` through `createDistMiddleware` ahead of the source fallback, and rebuilds before every reload; any other root gets a plain `createDevServer`, which serves the directory as-is and resolves bare specifiers from `node_modules`, so a hand-written page there interprets only if it loads the runtime itself (`packages/server/tests/dev.test.ts`, "builds a site project and serves its pages with the reload client", "boots a non-site root without the dist middleware"). server.md §2 and site-architecture.md's `jx dev` paragraph already say this. So the Development column is right for its hosts but its heading reads as "whatever `jx dev` serves", which is compiled output on every site project.
- Compiled output: static HTML and CSS, per-island ES modules for dynamic pages, and component modules under `dist/components/`; `@vue/reactivity` and `lit-html` are bundled into `/assets/` and named by the import map only on pages that carry one (`CLIENT_RUNTIME_MODULES` in `packages/compiler/src/site/client-runtime.ts`, compiler.md §12 "The client runtime"; `packages/compiler/tests/client-runtime.test.ts`). "`.js` classes only" is therefore also wrong: a static page ships no JavaScript.
- The figure: compiler.md Appendix A measures the two bundles the build emits (20.7 kB and 7.3 kB raw, 7.8 kB and 3.3 kB gzip, 28 kB and 11.1 kB total) and says of the old figure "An earlier revision of this table claimed ~7 kB and ~3 kB (~10 kB total); those figures described neither file." §16.7 still carries the retracted number. No test or script in the repository measures it.

**Also stale, outside the claim but the same fact.** §21.3 (Implemented) opens "The interpreting runtime — the dev server, the Studio canvas, and `@jxsuite/runtime` used directly as a library —", which names the dev server as an interpreting host; `docs/framework/concepts/security.md` repeats it. Four docs pages describe development as interpreted: `docs/framework/concepts/documents.md` ("In development, the runtime loads the `.json` file … In production, the build compiles the JSON away, emitting plain JavaScript classes"), `docs/framework/build/dev-server.md` ("During development you don't run the compiled `dist/` output", and "In development there is no build"), and `docs/framework/build/cli.md` ("local development without a build"). No docs page cites `spec.md#16.7`.

**Vocabulary other plans already use.** §11.4's markers say "an interpreting host (Studio's live preview and canvas, or `jx dev` on a root without a `project.json`)" and cite §16.7 for `jx dev` on a site project; `plan:_shared/compiled-server-call-proxy-first` writes the list as "Studio's live preview and canvas, `jx dev` on a root without a `project.json`, or a page that calls `mount()`". This plan makes §16.7 the place that phrase is defined.

## Outcome

- spec.md §16.7 → Implemented: the columns are named for the host (interpreting host, compiled), a Hosts row lists each column's hosts, the bundle row names the two dependencies and cites compiler.md §12 and Appendix A instead of a figure, and one paragraph says why `jx dev` compiles a site project and what "interpreting host" means elsewhere in the spec.
- spec.md §21.3's host list matches §16.7. Its status does not change.
- Four docs pages stop describing development as interpreted.
- No code, test or schema change. spec.md does not graduate.

## Decisions

- **Decided:** reconcile, keeping `jx dev`'s build-then-serve behaviour, because it is deliberate (the dev server previews what ships, so a gap between the renderers shows up before a deploy), server.md §2 and site-architecture.md already specify it, and the audit record's spec-wide decisions list this reconcile by name.
- **Decided:** the bundle cell names `@vue/reactivity` and `lit-html` and cites compiler.md §12 and Appendix A, with no figure and no new measurement test, because compiler.md Appendix A is the one measured home for those sizes and has already retracted the number §16.7 repeats; a second copy in the format spec is what went stale here.
- **Decided:** the columns are split by host, and the Hosts row includes a page that loads `@jxsuite/runtime` itself (`mount()`, `defineElement`), because such a page interprets in production too; that is why "development" was the wrong axis, and §21.3 already counts `@jxsuite/runtime` "used directly as a library" as an interpreter host.
- **Decided:** §21.3's opening clause and `security.md`'s copy of it are corrected in the same pull request, because once §16.7 says `jx dev` on a site project serves compiled pages, "the dev server" as an interpreting host is a contradiction inside one spec. §21.3 stays Implemented; the fragment covers the body change.
- **Decided:** fragment level `minor`, the program's level for a `reconcile`, and not `major`, because no behaviour changes: every host already does what the new table says, and server.md §2 has specified `jx dev`'s build since before the census.
- **Open:** retitle the heading from "Development vs. Production" to "Interpreted vs. Compiled". Recommendation: retitle, because the table's axis becomes the host, `jx dev` is development yet compiled, and `mount()` in a deployed page is production yet interpreted; the number stays, so `spec.md#16.7` anchors, the docs `spec:` grammar and every "§16.7" citation are unaffected, and only the gitignored implementation-status page (regenerated on every docs gate) prints the title. Declining keeps the old title over the new columns, which is consistent but reads as the contradiction this plan removes.

## Implementation

A paper plan. One pull request makes the edits under Specs & docs, adds the fragment and deletes this file.

1. `specs/spec.md` §16.7 (line 1743 onward), in place, as quoted under Specs & docs: heading text (if the Open is accepted), marker, a new lead paragraph, the table, and a closing paragraph. §16.8 is untouched.
2. `specs/spec.md` §21.3 (line 2395), the first two sentences only, as quoted under Specs & docs.
3. The four docs pages, as quoted under Specs & docs.
4. `bun run spec:change spec.md minor -m "…"` with the sentence under Specs & docs.
5. Delete `plans/spec/dev-production-table.md`.

**Integration contract.** No plan requires this one, and it requires none: its text is true of the code today and stays true whichever of the §11.4 plans lands first. Once it lands, `spec.md §16.7` is the definition a spec, plan or docs page may cite for "interpreting host" (Studio's canvas and live preview, and any page that loads `@jxsuite/runtime` itself, including one `jx dev` serves from a root without a `project.json`) and for "compiled output" (`jx build`, and `jx dev` on a site project). `plan:_shared/compiled-server-call-proxy-first` and `plan:_shared/compiled-server-call` may shorten their §11.4 host lists to "an interpreting host (§16.7)" but need not. Both edit `docs/framework/build/dev-server.md`'s "Server functions" subsection; this plan edits the page's opening paragraph and the one-paragraph intro of "Running server-side code: the two proxies" above it, so whichever lands second rebases an adjacent hunk at most.

## Tests

No workspace suite changes and none needs to run: no source, test or fixture is touched, so no `coverageThreshold` moves and the manifest check is unaffected. The behaviour the new text states is already held by `packages/server/tests/dev.test.ts` (site project built and served from `dist/`; non-site root without the dist middleware), `packages/server/tests/live-preview.test.ts` (the shell hands the document to the runtime; the runtime bundle is served) and `packages/compiler/tests/client-runtime.test.ts` (both modules resolve to `/assets/`).

The gates that prove it, all in the `checks` job:

- `bun run docs:status`: §16.7's first marker is `Implemented`; the spec header stays `Partial`.
- `bun run plans:check`: no `claim-not-open` (this file is deleted with the marker) and no `unclaimed-open` for spec.md.
- `bun run docs:spec-release`: the §16.7 and §21.3 body changes are covered by the fragment.
- `bun run docs:check` and `bun run docs:links`: the new `spec.md#16.7` entry in `documents.md` resolves, and no heading number moves.
- `bun run docs:prose`: the four docs edits carry no em dash and no banned word.
- `bun run docs:markdown`: no escaped heading.

## Specs & docs

**`specs/spec.md` §16.7**, in place:

1. Heading (if the Open is accepted): `### 16.7 Interpreted vs. Compiled`.
2. Replace the Partial marker (line 1745) with:

   > **Status: Implemented.** The interpreter is `@jxsuite/runtime` (`packages/runtime/src/runtime.ts`), which Studio's canvas imports and the live preview serves beside the source tree (`packages/server/src/live-preview.ts`, `packages/server/tests/live-preview.test.ts`). `jx dev` on a site project serves `buildSite` output (`startDev` in `packages/server/src/dev.ts`, `packages/server/tests/dev.test.ts`), and a built page loads `@vue/reactivity` and `lit-html` from the site (`packages/compiler/src/site/client-runtime.ts`, `packages/compiler/tests/client-runtime.test.ts`).

3. Insert before the table: "A document reaches the reader through one of two renderers, and the **host** decides which, not whether the project is in development. An **interpreting host** loads `@jxsuite/runtime`, which reads the JSON in the browser and builds the DOM from it. **Compiled output** is what the site build emits, and the JSON is gone from it."
4. Replace the table with:

   |          | Interpreting host                                                                                                                                                                                                                     | Compiled output                                                                                                                                                               |
   | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Hosts    | Studio's canvas and live preview (server.md §3.4); any page that loads `@jxsuite/runtime` itself, through `mount()` (embedding.md §2) or `defineElement`, including a page `jx dev` serves as-is from a root without a `project.json` | `jx build`; `jx dev` on a site project, which runs the same build before every reload (server.md §2)                                                                          |
   | Renderer | `@jxsuite/runtime`                                                                                                                                                                                                                    | `lit-html`, on pages and components that render in the browser                                                                                                                |
   | State    | `@vue/reactivity`                                                                                                                                                                                                                     | `@vue/reactivity`                                                                                                                                                             |
   | Source   | JSON interpreted live                                                                                                                                                                                                                 | JSON compiled away                                                                                                                                                            |
   | Ships    | `.json` documents + the runtime bundle                                                                                                                                                                                                | HTML and CSS, plus ES modules for dynamic pages and components; the two dependencies are served from the site's `/assets/` (compiler.md §12), sized in compiler.md Appendix A |

5. Append after the table, as a plain paragraph (the quote marks the text, not a blockquote):

   > `jx dev` compiles a site project rather than interpreting it on purpose: the page it serves is the page `jx build` ships, so a difference between the two renderers shows up while the author is working, not after a deploy. Studio's canvas and live preview interpret because they show the document being edited, including bytes not yet saved (server.md §3.4). Elsewhere in this specification, "an interpreting host" and "the interpreter" mean the left column, and "compiled output", "a built site" and "in production" mean the right one, `jx dev` on a site project included. What each column may evaluate is §21.

   Run `bunx oxfmt specs/spec.md` afterwards so the table's columns are padded (not `bun run format`, which also runs the dormant Markdown unwrap over every file).

**`specs/spec.md` §21.3**, in place, the first two sentences become: "The interpreting runtime, in every interpreting host §16.7 names (Studio's canvas and live preview, and any page that loads `@jxsuite/runtime` as a library), compiles `${}` templates and inline `body` functions with `new Function` on the fly (§6.6). Any page hosting the interpreter must allow `'unsafe-eval'` in its CSP; `jx dev` on a site project serves compiled output (§16.7) and needs none." The rest of §21.3 is unchanged.

**Fragment:** `bun run spec:change spec.md minor -m "§16.7 names the hosts behind each renderer, interpreting hosts (Studio's canvas and live preview, and pages that load the runtime) and compiled output (jx build, and jx dev on a site project), and cites compiler.md Appendix A for the bundle sizes in place of an unmeasured figure; §21.3's host list follows, and §16.7 is Implemented."`

**Docs** (no page may contain an em dash):

- `docs/framework/concepts/documents.md` (`spec:` cites `spec.md#1`–`#3`), "How it works": the sentences from "In development, the runtime loads" to the end of the paragraph become "Where the runtime interprets a document (Studio's canvas and live preview, or a page that loads `@jxsuite/runtime` itself), it loads the `.json` file, builds a reactive scope from `state`, and renders the tree with real DOM calls. Everywhere else the [build](/docs/framework/build) compiles the JSON away, emitting static HTML, extracted CSS and, only for what changes at runtime, JavaScript modules. That includes `jx dev` on a site project, which builds before it serves, so what you preview is what ships." Add `- spec.md#16.7` to its `spec:` list, so a later §16.7 edit names this page in `docs:sync`.
- `docs/framework/build/dev-server.md` (`code:` lists `live-preview.ts` and `server.ts`): the opening paragraph becomes "The Jx dev server is a Bun-native server from `@jxsuite/server`. It reloads the browser when files change, executes server-side code on your behalf, and backs Studio's file operations. What it serves depends on the root: on a site project, [`jx dev`](/docs/framework/build/cli) builds the site first and serves the built pages, so the browser shows what `jx build` would ship; any other root is served as-is." In "Running server-side code: the two proxies", the second sentence becomes "When the runtime interprets your documents, as in Studio's live preview or a page of your own that loads `@jxsuite/runtime`, there is no build, so the runtime hands that work to the dev server through two POST endpoints." The `:::doc-note` about `jx dev` and the subsections are unchanged.
- `docs/framework/build/cli.md`, "Related": "local development without a build" becomes "what `jx dev` runs underneath, and the proxies Studio's preview uses".
- `docs/framework/concepts/security.md` (`spec:` cites `spec.md#21`), "The interpreter needs `'unsafe-eval'`": the first sentence becomes "The interpreting runtime, meaning the Studio canvas and live preview and `@jxsuite/runtime` loaded by a page of your own (through `mount()`, for example), compiles `${}` templates and inline `body` functions with `new Function` on the fly." Append to the paragraph: "`jx dev` on a site project serves compiled pages, which need none."
- No other page changes: `docs/framework/build.md` already describes compiled output and quotes compiler.md Appendix A's gzip sizes, and no page's `spec:` cites `spec.md#16.7` today.

**Graduation:** not here. spec.md keeps many open items after this lands, so the header stays `Partial` and `plans/spec/` stays.

## Acceptance

- `sed -n '/^### 16.7 /,/^### 16.8 /p' specs/spec.md | grep -m1 "Status:"` prints the `Implemented` marker, and `… | grep -c "10 kB"` prints 0.
- `grep -c "the dev server, the Studio canvas" specs/spec.md docs/framework/concepts/security.md` prints 0 for both files.
- `git grep -n "without a build\|In development, the runtime\|you don't run the compiled" -- docs` prints nothing.
- `grep -n "spec.md#16.7" docs/framework/concepts/documents.md` prints one line.
- `bun run plans:status --who-claims spec.md#16.7` names no plan, and `ls specs/changes/spec-*.md` includes the new fragment.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
