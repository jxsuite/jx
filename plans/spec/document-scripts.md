---
status: drafted
disposition: implement
claims:
  - spec.md#23.2
requires:
  - spec/typescript-function-bodies
  - spec/function-entry-tier-parity
  - _shared/jx-document-format
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

A body compiles with `new Function`, so it cannot `import`, hold module state or share private helpers. Today that needs a sidecar. A `script` block in a `.jx` file holds that code in the document. Of the 100 `$src` functions in the repository, 88 are the kit, which stays as modules by the owner's decision, so this serves code people will write rather than code that exists.

**An earlier design failed adversarial review on 2026-11-05.** Each of these was reproduced or traced in code:

- **`#client` has no document identity.** `_moduleCache` is keyed on the spelled `$src` (`runtime.ts:1448`), so document B received document A's `bump`. A second `preloadModule("#client")` replaces the first. `resolveLayout` keeps only the layout's `$script` (`packages/site/src/layout.ts:69`).
- **The sample `(server)save` was wrong.** §11's `timing: "server"` entry is a data call. It POSTs at mount with `arguments: {}`, the function receives `(args, env)`, and the entry is `null` until a call answers. So `save(count)` would write on every mount with `count` set to `{}`. Two documents' `save` also merged with `errors: []`, because the one specifier `#server` looks like one module.
- **Hosts do not transpile `.ts`.** `serveProjectFile` returns raw TypeScript as `text/javascript` (`server/src/file-response.ts:87`). So a `script` importing `./math.ts` fails on any interpreting host. This also affects a `.ts` `$src` today. Desktop's backend is Electron's Node, so `Bun.Transpiler` is not available there, and the stripper does not boot on the cloud host's Worker (`plan:spec/typescript-function-bodies`), so a server route could not work on every host.
- **Calling a `$src` function differs by tier.** With `bump(state, by)`, `state.bump(3)` throws, `state.bump(state, 3)` works when interpreted, `compile-element` emits `(state) => bump(state)`, and `compile-client` emits a computed with no listener. `plan:spec/function-entry-tier-parity` closes this, which is why it is required here.
- **`.jx` importing `.jx`.** `tsc` passes, and both bundlers fail.
- **Live Preview leaks server code.** `packages/site/src/shell.ts:68`, `:94` embed the whole document in the page, which would include `$script.server`. `$script` is not in `RESERVED_KEYS` (`runtime.ts:1586`), and no slice edited the schema. `serveSite`'s file lane is a second path: it would serve `components/x.jx` as raw bytes on an origin running project script, which is the hole `packages/site/src/paths.ts` exists to refuse, and a cloud preview is readable by anyone holding its link.
- **Concurrent edits to a script are lost.** A `$script` value is whole-value last-writer-wins (`packages/collab/src/schema.ts:109`, `:123`). String `body` values are too, which matters more now that they can run to many lines.

## Outcome

- spec.md §23.2 → Implemented.
- `script` and `script timing=server` hold TypeScript modules in a `.jx` document. `$script` carries them in the data model, so `.json` can hold them too.
- Each document's modules are its own in every tier, including across a layout merge.
- Server code reaches neither a client bundle nor a preview page.
- `jx validate` and Studio advise moving a relative `$src` into `script`. It keeps working everywhere.

## Decisions

- **Decided (owner):** `$src` is discouraged, not disabled. `npm:` and shared modules have no other spelling, and the kit's behaviours stay as they are. The advisory is informational and fires only on a relative `$src` outside the kit.
- **Decided (owner):** a `(fn)` body cannot call a `script` helper. Only `(export)` connects them. Allowing it would mean compiling every body as a module, and a body cannot see the module's scope at run time. A body calling one gets a `ReferenceError` when run, and `plan:_shared/jx-typechecking` reports it first.
- **Decided:** the data model is `$script: { client?: string, server?: string }`, with `$src: "#client"` and `$src: "#server"` as the authored form.
- **Decided:** at load, before any merge, the specifier is qualified by its document: `jx-script:<project-relative-path>#client`. `_moduleCache`, `preloadModule`, `resolveLayout` and `collectServerEntries` then work as they are, because a page's and a layout's modules are different strings.
- **Decided:** `(server)` keeps §11's meaning exactly, as a reactive data call taking `(args, env)`. Properties on the node become `arguments`. This plan adds no imperative server call. A write is a request to an extension mount, as it is today, and adding one would be a separate §11 feature.
- **Decided:** two documents exporting the same server name fail the build, under §11's existing rule of one function per export name. Qualifying makes that rule apply, where the bare specifier merged them silently.
- **Decided:** the calling convention is §5.3 4d's once `plan:spec/function-entry-tier-parity` lands, so `state.bump` is the import itself. This plan adds no convention of its own.
- **Decided:** a module loader in the browser, with no new host route, so every interpreting host works the same way. `@jxsuite/erase/browser` also exports `loadModule`, and `setModuleLoader(fn)` is a seam beside `setBodyEraser`, so the rule that the eraser imports no runtime holds here too. `importSource` sends a `.ts` path or a `jx-script:` specifier through it, passing the host's npm resolver as an argument. The loader gets the text, erases it, rewrites relative imports to absolute URLs, loading any `.ts` target the same way, and imports the result from a `blob:` URL with a `sourceURL` comment. A `jx-script:` specifier names its document, so the loader fetches that and reads `$script.client`. This also fixes the existing `.ts` `$src` defect. No interpreting host enforces a CSP that would refuse `blob:` (spec.md §21.5), and compiled output uses the bundler instead.
- **Decided:** the loader's limits are named errors. A cycle among `.ts` modules cannot be expressed with `blob:` URLs. A bare import needs the host's `setNpmModuleResolver`, and the cloud host has no bundler to answer one. Neither limit affects `jx build`.
- **Decided:** the canvas picks up a `script` change on save. Bodies still update live. Module reload on every keystroke would rerun top-level code and hold unsaved imports, which isn't worth it in the first iteration.
- **Decided:** `$script.server` is stripped from any document handed to a browser: in `composePage`, in `serveSite`'s file lane, and in the canvas payload. The file lane parses a document only when its text contains `$script`, or when it is `.jx`, so an ordinary file is still served as bytes. `serveProjectFile` keeps serving the tree, since that is an editing host's protocol and `paths.ts` states that difference on purpose. `$script` joins `RESERVED_KEYS` and the schema. A test of bundles alone would not catch either leak, so tests also read the shell's output and the file lane's.
- **Decided:** `timing: "server"` stays unavailable in a cloud preview, which passes no `resolveToken`. A `(server)` entry there stays `null`, as a `$src` server entry does today, and docs say so.
- **Decided:** a bundler plugin resolves `./other.jx` to that document's client module under both `JX_BUNDLER` backends, and a Bun test plugin does the same so a `.jx` file's exports can be unit tested. Code moved inline would otherwise lose its coverage.
- **Decided:** `$script.client`, `$script.server` and a `Function` entry's string `body` become `Y.Text` in the collaboration schema. Two people typing in one script otherwise lose one person's edits.
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

- **`packages/schema`**: `$script` in the schema and `types`, `qualifyScripts(doc, path)`, the grammar rows in `src/jx/`, `$src` advisory data.
- **Compiler**: `site-build.ts` `rewriteSidecarSrc` treats a `jx-script:` specifier as a bundle entry. `BundleRequest` gains `virtualEntry: { contents, resolveDir }` in both backends (esbuild `stdin`, Bun virtual files), with relative imports resolving from the document's directory. `server-entries.ts` collects `#server` the same way. `Bun.build({ files })` has been run successfully in isolation.
- **`packages/erase`**: `loadModule` in the browser entry, including import rewriting, which reads specifiers through the parser the stripper already carries.
- **`packages/site`**: `composePage` qualifies before `resolveLayout`, and strips server scripts before `pageShell`. `serve.ts`'s file lane strips them too.
- **Runtime**: `RESERVED_KEYS`, `setModuleLoader`, and the two cases in `importSource`. The eraser loader from `plan:spec/typescript-function-bodies` also fires for a document with `$script.client` or a `.ts` `$src`, and the runtime installs the `loadModule` it returns as well as `eraseBody`.
- **Hosts**: no route. The cloud host needs nothing beyond what `plan:spec/typescript-function-bodies` already asks of it.
- **Studio**: `script` shown in the code surface as TypeScript, the advisory in Problems, `$script.server` removed from the canvas payload.
- **Collab**: `TEXT_KEYS` and the path-aware rule for `body`, with `plan:collab/granular-writes`.

**Integration contract.** Once this lands, `plan:_shared/jx-typechecking` may rely on: `$script` as the module text; `(export)` entries being the import itself on `state`; a server export's parameters being `(args, env)`.

## Tests

- `packages/compiler`: two documents with same-named client exports each get their own; a page and its layout keep both modules; eager and `$lazy` from one script; bundling under both backends; no server import in any client bundle; same-named server exports across documents fail the build naming both files; `.jx` importing `.jx`.
- `packages/erase`, `packages/runtime`: the loader on a script with relative `.ts` imports, including with the entry and the runtime built as two files, a shared import loaded once, the named errors for a cycle and a bare import, and each qualified specifier resolving to its own document.
- `packages/site`, `packages/server`, `packages/desktop`: neither Live Preview HTML nor a document fetched through the file lane contains `$script.server`; the mount-time data call receives declared arguments.
- `packages/collab`: concurrent edits to one script merge.
- `packages/schema`: `$script` validates; advisories fire on a relative `$src` and not on `npm:` or the kit; corpus round trip with synthetic scripts.
- Chrome MCP pass on a component with `script` in the canvas and Live Preview. Coverage thresholds ratchet. `bun test --isolate` throughout.

## Specs & docs

- `spec.md` §23.2: state the rules and delete the marker. §22 gains the rows. §4.2, §5.3 4c, §11 name `#client`, `#server` and qualification. §17 reserves `$script`. `bun run spec:change spec.md minor -m "A document can carry its own client and server modules"`.
- `compiler.md` §12: bundling. `embedding.md`: `setModuleLoader`, its limits, and `preloadModule` with qualified specifiers. `site-architecture.md`: the file lane's stripping. `collab.md`: text keys. Each with a fragment.
- Docs per slice: `docs/framework/concepts/functions.md`, `components.md`, `timing.md`, `docs/studio/logic/code.md`, with "sidecar" retired in favour of "`$src` module". Examples stop using a relative `$src`.

## Acceptance

- The sample above runs in `jx build` output, the canvas and Live Preview, with `bump` working from a click in each.
- `grep` finds no `$script.server` content in any client bundle or preview page.
- A `.ts` `$src` loads in the canvas and in Live Preview on the dev server and on desktop, and in a cloud preview once that host's side lands.
- `bun run all-the-things`, `plans:check`, `docs:check` and `schema:verify` are green.

## Slices

| Slice | Scope                                                                                  | Claims       | State |
| ----- | -------------------------------------------------------------------------------------- | ------------ | ----- |
| DSC.1 | `$script`, qualification, schema, bundling, server entries, `.jx` imports              | spec.md#23.2 | open  |
| DSC.2 | Browser module loader, `.ts` `$src`, Live Preview and file-lane stripping, reservation | spec.md#23.2 | open  |
| DSC.3 | Grammar rows, Studio, advisory, `Y.Text`, examples; closes the marker                  | spec.md#23.2 | open  |
