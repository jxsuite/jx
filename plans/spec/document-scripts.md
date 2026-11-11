---
status: drafted
disposition: implement
claims:
  - spec.md#23.2
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
  - specs
  - docs
size: L
---

# A document can carry its own client and server modules, with `$src` discouraged but still working

## Context

`specs/spec.md` §23.2:

> **Status: Pending.** A function that outgrows a body moves to a separate module named by `$src` (§5.3 4c).

A body compiles with `new Function`, so it cannot `import`, hold module state or share private helpers. Today that needs a sidecar. A `script` block in a `.jxn` file holds that code in the document. Of the 100 `$src` functions in the repository, 88 are the kit, which stays as modules by the owner's decision, so this serves code people will write rather than code that exists.

**An earlier design failed adversarial review on 2026-11-05.** Each of these was reproduced or traced in code:

- **`#client` has no document identity.** `_moduleCache` is keyed on the spelled `$src` (`runtime.ts:1448`), so document B received document A's `bump`. A second `preloadModule("#client")` replaces the first. `resolveLayout` keeps only the layout's `$script` (`packages/site/src/layout.ts:69`).
- **The sample `(server)save` was wrong.** §11's `timing: "server"` entry is a data call. It POSTs at mount with `arguments: {}`, the function receives `(args, env)`, and the entry is `null` until a call answers. So `save(count)` would write on every mount with `count` set to `{}`. Two documents' `save` also merged with `errors: []`, because the one specifier `#server` looks like one module.
- **Hosts do not transpile `.ts`.** `serveProjectFile` returns raw TypeScript as `text/javascript` (`server/src/file-response.ts:87`). So a `script` importing `./math.ts` fails on any interpreting host. This also affects a `.ts` `$src` today. Desktop's backend is Electron's Node, so `Bun.Transpiler` is not available there, and the stripper does not boot on the cloud host's Worker (`spec.md` §23.1), so a server route could not work on every host.
- **Calling a `$src` function differs by tier.** With `bump(state, by)`, `state.bump(3)` throws, `state.bump(state, 3)` works when interpreted, `compile-element` emitted `(state) => bump(state)`, and `compile-client` emitted a computed with no listener. Spec.md §5.3 4d closes this: a `$src` callable is its import in every tier.
- **`.jxn` importing `.jxn`.** `tsc` passes, and both bundlers fail.
- **Live Preview leaks server code.** `packages/site/src/shell.ts:68`, `:94` embed the whole document in the page, which would include `$script.server`. `$script` is not in `RESERVED_KEYS` (`runtime.ts:1586`), and no slice edited the schema. `serveSite`'s file lane is a second path: it would serve `components/x.jxn` as raw bytes on an origin running project script, which is the hole `packages/site/src/paths.ts` exists to refuse, and a cloud preview is readable by anyone holding its link.
- **A document becomes a self-contained program.** Today a `timing: "server"` entry needs a sidecar, so one forwarded file cannot run anything on the backend. `script timing=server` removes that: on an editing host, a single `.jxn` runs its own module in Node through `/__jx_server__` when the canvas renders it, which `packages/server/src/project-server.ts:297` already labels RCE-capable. With `.jxn` associated with the desktop app, that is one double-click from an email attachment. desktop.md §4.7 is why this can ship: the prompt is in the way of that double-click.
- **Concurrent edits to a script are lost.** A `$script` value is whole-value last-writer-wins (`packages/collab/src/schema.ts:109`, `:123`). String `body` values are too, which matters more now that they can run to many lines.

## Outcome

- spec.md §23.2 → Implemented.
- `script` and `script timing=server` hold TypeScript modules in a `.jxn` document. `$script` carries them in the data model, so `.json` can hold them too.
- Each document's modules are its own in every tier, including across a layout merge.
- Server code reaches neither a client bundle nor a preview page.
- `jx validate` and Studio advise moving a relative `$src` into `script`. It keeps working everywhere.

## Decisions

- **Decided (owner):** `$src` is discouraged, not disabled. `npm:` and shared modules have no other spelling, and the kit's behaviours stay as they are. The advisory is informational and fires only on a relative `$src` outside the kit.
- **Decided (owner):** a `(fn)` body cannot call a `script` helper. Only `(export)` connects them. Allowing it would mean compiling every body as a module, and a body cannot see the module's scope at run time. A body calling one gets a `ReferenceError` when run, and `plan:spec/jx-typechecking` reports it first.
- **Decided:** the data model is `$script: { client?: string, server?: string }`, with `$src: "#client"` and `$src: "#server"` as the authored form.
- **Decided:** at load, before any merge, the specifier is qualified by its document: `jx-script:<project-relative-path>#client`. `_moduleCache`, `preloadModule`, `resolveLayout` and `collectServerEntries` then work as they are, because a page's and a layout's modules are different strings.
- **Decided:** `(server)` keeps §11's meaning exactly, as a reactive data call taking `(args, env)`. Properties on the node become `arguments`. This plan adds no imperative server call. A write is a request to an extension mount, as it is today, and adding one would be a separate §11 feature.
- **Decided:** two documents exporting the same server name fail the build, under §11's existing rule of one function per export name. Qualifying makes that rule apply, where the bare specifier merged them silently.
- **Decided:** the calling convention is §5.3 4d's, so `state.bump` is the import itself. This plan adds no convention of its own.
- **Decided:** a module loader in the browser, with no new host route, so every interpreting host works the same way. `@jxsuite/erase/browser` also exports `loadModule`, and `setModuleLoader(fn)` is a seam beside `setBodyEraser`, so the rule that the eraser imports no runtime holds here too. `importSource` sends a `.ts` path or a `jx-script:` specifier through it, passing the host's npm resolver as an argument. The loader gets the text, erases it, rewrites relative imports to absolute URLs, loading any `.ts` target the same way, and imports the result from a `blob:` URL with a `sourceURL` comment. A `jx-script:` specifier names its document, so the loader fetches that and reads `$script.client`. This also fixes the existing `.ts` `$src` defect. No interpreting host enforces a CSP that would refuse `blob:` (spec.md §21.5), and compiled output uses the bundler instead.
- **Decided:** the loader's limits are named errors. A cycle among `.ts` modules cannot be expressed with `blob:` URLs. A bare import needs the host's `setNpmModuleResolver`, and the cloud host has no bundler to answer one. Neither limit affects `jx build`.
- **Decided:** the canvas picks up a `script` change on save. Bodies still update live. Module reload on every keystroke would rerun top-level code and hold unsaved imports, which isn't worth it in the first iteration.
- **Decided:** `$script.server` is stripped from any document handed to a browser: in `composePage`, in `serveSite`'s file lane, and in the canvas payload. The file lane parses a document only when its text contains `$script`, or when it is `.jxn`, so an ordinary file is still served as bytes. `serveProjectFile` keeps serving the tree, since that is an editing host's protocol and `paths.ts` states that difference on purpose. `$script` joins `RESERVED_KEYS` and the schema. A test of bundles alone would not catch either leak, so tests also read the shell's output and the file lane's.
- **Decided:** `timing: "server"` stays unavailable in a cloud preview, which passes no `resolveToken`. A `(server)` entry there stays `null`, as a `$src` server entry does today, and docs say so.
- **Decided:** the browser loader erases and the build bundles, so a script using `enum` or a parameter property would run built and fail interpreted. The build refuses what the eraser refuses (§23.1's rule for a body, minus `import` and `export`, which a module has). Built with the loader in DSC.2, so the two land agreeing.
- **Decided:** a bundler plugin resolves `./other.jxn` to that document's client module under both `JX_BUNDLER` backends, and a Bun test plugin does the same so a `.jxn` file's exports can be unit tested. Code moved inline would otherwise lose its coverage.
- **Decided:** `$script.client`, `$script.server` and a `Function` entry's string `body` become `Y.Text` in the collaboration schema. Two people typing in one script otherwise lose one person's edits.
- **Decided (DSC.2):** the runtime qualifies with the address it read a document from, which is an absolute URL, where a build and `composePage` use the project-relative path. A document handed over as an object is addressed at `<base>#jx-inline-<n>`: its client script runs from the text it carries, and no host can find its server script, so the proxy refuses the call. The canvas hands its frame an object, which is why DSC.3 qualifies the canvas payload with the document's path. It has to qualify each document before `distributePageIntoLayout` merges them (`packages/studio/src/canvas/canvas-live-render.ts`, `resolveCanvasLayout` and the page merge): the DSC.2 browser pass showed a page's `#client` entry running its layout's script on the canvas, because the merge keeps only the layout's `$script` and both entries qualify to one inline address, and a page naming `#client` inside a layout with no `$script` not drawn at all ("The page could not be rendered", in Edit as well as Preview). Qualifying by path leaves the frame to fetch the saved document for the text, and neither the loader nor the runtime's module cache drops a module whose text was never handed over, so picking a change up on save needs the text handed to the frame or the specifier's module invalidated.
- **Decided (DSC.2):** the loader takes a `text` option, so the runtime hands it the script of a document it already read. Nothing is fetched twice, and a document read again with its script edited drops the module made from the old text.
- **Decided (DSC.2):** an erased module keeps every import that is not `import type`, so a name imported only for its type has to say so. A bundler drops such an import and the loader cannot, so this is a rule for authors, stated in spec.md §23.2 and the docs, and `plan:spec/jx-typechecking` can report it with `verbatimModuleSyntax`.
- **Decided (DSC.2):** a server script is held to the erasable rule as a client one is, at build and on a development host, so one rule covers `$script` and the type checker reads both sides the same way.
- **Decided (DSC.2):** a development host imports a server script once per text, where a file module is imported once per process. A script is edited in the editor that is running it, so a stale one would be the first thing an author sees.
- **Open:** an export used eagerly and another used with `$lazy` share one module, so `$lazy` saves nothing. Recommendation: `jx validate` advises moving the lazy export to its own `$src` module, since a document has only one client script.

## Implementation

### Grammar rows added to spec.md §22

| Written                     | Means                                                               |
| --------------------------- | ------------------------------------------------------------------- |
| `script body`               | `$script.client`                                                    |
| `script timing=server body` | `$script.server`                                                    |
| `(export)name`              | `$prototype: "Function"`, `$src: "#client"`, `$export: name`        |
| `(server)name [k=v…]`       | `timing: "server"`, `$src: "#server"`, `$export: name`, `arguments` |

```kdl
my-counter {
    script #"""
        import { clamp } from "./math.ts"

        export function bump(state: State, by: number): void {
            state.count = clamp(state.count + by, 0, state.max)
        }
        """#

    script timing=server #"""
        export async function history(args: { limit: number }, env: Env) {
            return env.DB.prepare("SELECT * FROM counts LIMIT ?").bind(args.limit).all()
        }
        """#

    state {
        count 0
        max type=number default=10 attribute=max
        limit 20
        (export)bump
        (server)history limit=(ref)"#/state/limit"
    }

    button type=button onclick=(ref)"#/state/bump" "Add"
}
```

### Where it lands

- **`packages/schema`**: `$script` in the schema and `types`, `qualifyScripts(doc, path)`, the grammar rows in `src/jxn/`, `$src` advisory data.
- **Compiler** (built in DSC.1): `site-build.ts` `rewriteSidecarSrc` treats a `jx-script:` specifier as a bundle entry. `BundleRequest` has `contents`, the text of a module at a path no file is at (`<document>.jx-client.ts`), in both backends (Bun `files`, an esbuild `onLoad`), so relative imports resolve from the document's directory. `site/document-scripts.ts` holds the one plugin that resolves `jx-script:` and `.jxn` imports for the page bundles and the worker's, and `@jxsuite/compiler/bun-plugin` is the same for Bun's module loader, with `?server` for a test of a server module. `server-entries.ts` needed no change: a qualified specifier passes through it. `RESERVED_KEYS` gained `$script` here rather than in DSC.2, since the schema accepts the key from this slice on.
- **`packages/erase`** (built in DSC.2): `loadModule` in the browser entry, including import rewriting. Imports are found by pattern in the erased text with strings and comments blanked (`maskCode`), not through the stripper's parser: the stripper does not export its parser, and a second copy of TypeScript's would double a file a page loads only when it must.
- **`packages/site`** (built in DSC.2): `composePage` qualifies each document as it is read, before `resolveLayout`, and the merged page carries no `$script` at all, since one `$script` cannot speak for two documents; the page fetches a client module from the document that has it. `serve.ts`'s file lane strips `$script.server` from a `.json` file naming `$script` and from every `.jxn` file.
- **Runtime**: `RESERVED_KEYS`, `setModuleLoader`, and the two cases in `importSource`. The eraser loader (`spec.md` §23.1) also fires for a document with `$script.client` or a `.ts` `$src`, and the runtime installs the `loadModule` it returns as well as `eraseBody`.
- **Hosts** (built in DSC.2): no route for a client script. The cloud host needs nothing beyond serving the body eraser it already serves for `spec.md` §23.1. For a server script, `packages/server/src/server-script.ts` bundles the script with the compiler's own plugin (`@jxsuite/compiler/document-scripts`) into a temporary file, imports it and removes it, once per text, behind `/__jx_server__` and `jx dev`'s stand-in for the worker.
- **Studio**: `script` shown in the code surface as TypeScript, the advisory in Problems, `$script.server` removed from the canvas payload.
- **Collab**: `TEXT_KEYS` and the path-aware rule for `body`, with `plan:collab/granular-writes`.

**Integration contract.** Once this lands, `plan:spec/jx-typechecking` may rely on: `$script` as the module text; `(export)` entries being the import itself on `state`; a server export's parameters being `(args, env)`.

## Tests

- `packages/compiler`: two documents with same-named client exports each get their own; a page and its layout keep both modules; eager and `$lazy` from one script; bundling under both backends; no server import in any client bundle; same-named server exports across documents fail the build naming both files; `.jxn` importing `.jxn`.
- `packages/erase`, `packages/runtime`: the loader on a script with relative `.ts` imports, including with the entry and the runtime built as two files, a shared import loaded once, the named errors for a cycle and a bare import, and each qualified specifier resolving to its own document.
- `packages/site`, `packages/server`, `packages/desktop`: neither Live Preview HTML nor a document fetched through the file lane contains `$script.server`; the mount-time data call receives declared arguments; on desktop, no server module runs in a folder the user has not answered for.
- `packages/collab`: concurrent edits to one script merge.
- `packages/schema`: `$script` validates; advisories fire on a relative `$src` and not on `npm:` or the kit; corpus round trip with synthetic scripts.
- Chrome MCP pass on a component with `script` in the canvas and Live Preview. Coverage thresholds ratchet. `bun test --isolate` throughout.

## Specs & docs

- `spec.md` §23.2: state the rules and delete the marker. §22 gains the rows. §4.2, §5.3 4c, §11 name `#client`, `#server` and qualification. §17 reserves `$script`. `bun run spec:change spec.md minor -m "A document can carry its own client and server modules"`.
- `compiler.md` §12: bundling. `embedding.md` §6.3: `setModuleLoader`, its limits, and `preloadModule` with qualified specifiers. `server.md` §3.4, where the preview origin's lanes are specified: the file lane's stripping; §3.3 and §2: a server script behind the proxy and `jx dev`. `collab.md`: text keys. Each with a fragment.
- Docs per slice: `docs/framework/concepts/functions.md`, `components.md`, `timing.md`, `docs/studio/logic/code.md`, with "sidecar" retired in favour of "`$src` module". Examples stop using a relative `$src`.

## Acceptance

- The sample above runs in `jx build` output, the canvas and Live Preview, with `bump` working from a click in each.
- `grep` finds no `$script.server` content in any client bundle or preview page.
- A `.ts` `$src` loads in the canvas and in Live Preview on the dev server and on desktop, and in a cloud preview once that host's side lands.
- `bun run all-the-things`, `plans:check`, `docs:check` and `schema:verify` are green.

## Slices

| Slice | Scope                                                                                                                                                                                                  | Claims       | State  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------ |
| DSC.1 | `$script`, qualification, schema, bundling, server entries, `.jxn` imports, the Bun plugin                                                                                                             | spec.md#23.2 | merged |
| DSC.2 | Browser module loader, `.ts` `$src`, Live Preview and file-lane stripping; `jx dev` and `/__jx_server__` answering a `jx-script:` server module; refusing non-erasable TypeScript in a script at build | spec.md#23.2 | merged |
| DSC.3 | Grammar rows, Studio, advisory, `Y.Text`, examples; closes the marker                                                                                                                                  | spec.md#23.2 | open   |
