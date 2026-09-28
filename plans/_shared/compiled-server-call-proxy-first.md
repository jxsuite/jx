---
status: drafted
disposition: implement
claims: []
workspaces:
  - packages/runtime
  - packages/server
size: S
---

# An interpreting host calls a `timing: "server"` entry only through its proxy, so the module never reaches the browser

## Context

This plan claims nothing. It is the proxy-first half of `plan:_shared/compiled-server-call`, which owns `spec.md` §11.4 and requires this plan. It was split out because it touches the runtime alone, needs neither of that plan's compiler prerequisites, and closes a source-delivery gap that should not wait for them. As `plan:_shared/no-adapter-server-tier` does for its own sentences, it rewrites its passages of §11.4 in place, and the section stays Partial and stays that plan's.

`specs/spec.md` §11.4, line 1297:

> **Status: Partial (dev boundary).** In an interpreting host (Studio's live preview and canvas, or `jx dev` on a root without a `project.json`), the interpreting runtime currently attempts a browser-side `import()` of the `$src` module before falling back to the `/__jx_server__` proxy. A `*.server.js` that is browser-loadable therefore has its **source delivered to the client** there — so do not embed secrets in the module body; read them from `env` inside the function, which only the proxy (and the compiled worker) provides. The compiled deployment does not have this gap. Making the interpreting path proxy-first is a tracked follow-up.

The leading marker (line 1240) ends with the same fact: "In an interpreting host (Studio's live preview and canvas, or `jx dev` on a root without a `project.json`) the runtime tries a browser `import()` first (Security Boundary, below)."

**What exists** (verified 2026-09-26)

- `resolveServerFunction` in `packages/runtime/src/runtime.ts` (line 3383) tries, in order: `seededModule(src)`, then `import(src)`, then `import(new URL(src, base))`. Only when both imports throw does it fall back to `resolveServerFunctionViaProxy` (line 3465). In Studio's canvas and live preview, `base` is an origin that serves the project's files, so the second import succeeds: the module's source is delivered and the function runs in the browser with no `env`. After a successful import it caches the module in `_moduleCache`.
- `seededModule` (line 1128) reads `_moduleCache` and `_moduleLoaders`. `preloadModule` (line 1102, `embedding.md` §6) is how a host fills them. `_moduleCache` is also filled when the runtime itself imports a `$src`: `resolveFunction` (line 1171; the write is at line 1218) and `importAndInstantiate` (line 3075; line 3093). So a Function entry naming the same specifier would put a server module in the browser too.
- `packages/runtime/tests/mount.test.ts` pins a server entry served by a host loader ("a timing: \"server\" function is served by its loader").
- `resolveServerFunctionViaProxy` POSTs `$src`, `$export`, `$base` and `arguments` to `/__jx_server__` (with the canvas token when set). It re-posts from an `effect()` when an argument is a `$ref`, reports a failure with `console.error`, and leaves the value unchanged. Nothing stops a slow answer to an earlier call overwriting a later one.
- The hosts that answer the proxy all call `handleServerFunction` (`packages/server/src/resolve.ts`), which passes `fn(args, process.env)`:
  - the dev server (`server.ts`, with `absRoot`);
  - Studio's live preview (`live-preview.ts`);
  - the desktop's loopback project server (`project-server.ts`);
  - the desktop's RPC path (`jxServerFunction` in `packages/desktop/src/project-session.ts`).
- The extension mounts get `process.env` merged under `.dev.vars`, plus `JX_PROJECT_ROOT` (`buildRuntime` in `packages/server/src/jx-mounts.ts`; `extensions.md` §13, line 613, says local secret values live in `.dev.vars`).
- Tests: `packages/runtime/tests/runtime-gaps-resolve.test.ts`, `describe("resolveServerFunction")`. Its first five cases rely on the in-process import of `_gaps_server_fns.ts`; the rest exercise the proxy fallback.

## Outcome

Claims nothing. Once it lands:

- The runtime never imports a `timing: "server"` module itself.
- In `spec.md` §11.4, the dev-boundary marker is replaced by normative prose and the leading marker's interpreting-host sentence is deleted. The section stays Partial for its compiled half, which `plan:_shared/compiled-server-call` closes.

## Decisions

- **Decided:** proxy only, with no import in either order. Any fallback that imports re-opens the gap whenever the proxy fails. A host that answers no proxy (a production page calling `mount()`) gets a failed POST: the entry stays `null` and the error is logged, as when a module fails to import today. `skipServerFunctions` (`embedding.md` §5.1) remains the way to opt out silently.
- **Decided:** a module the host registered with `preloadModule` is still called in process, and nothing else is. That is the host's act rather than the document's: `embedding.md` §6 documents the seam, and `mount.test.ts` pins it for server entries. The runtime keeps a separate set of host-seeded specifiers, because `_moduleCache` is shared, and without the set a Function `$src` naming the same specifier would quietly restore the gap.
- **Decided:** the proxy path drops the answer to a superseded call using a per-entry sequence number, so the interpreter and the compiled call treat a race the same way.
- **Open:** should the proxy's `env` merge the project's `.dev.vars`, as the mounts' does? Recommendation: yes. With proxy-only, the proxy is where every interpreted call runs, and §11.4 tells authors to read secrets from `env`. `extensions.md` §13 puts local secret values in `.dev.vars`, and `docs/framework/concepts/security.md` (line 64) already tells authors that values reach `env` "from the git-ignored `.dev.vars` locally", which is false for a server function today. Once `plan:_shared/compiled-server-call` builds the `jx dev` route with the mounts' env, a function reading `env.API_KEY` would work there and get `undefined` in Studio's preview. Declining leaves `server.md` §3.3 as it is, drops step 3 below, and qualifies `security.md`'s line 64 for server functions.

## Implementation

1. `packages/runtime/src/runtime.ts`:
   - Add `const _hostSeeded = new Set<string>()` beside `_moduleLoaders`. `preloadModule` adds the specifier in both of its branches.
   - Rewrite `resolveServerFunction`:
     - When `_hostSeeded.has(def.$src)`, keep today's in-process call through `seededModule`.
     - Otherwise, return `resolveServerFunctionViaProxy(def, state, key, base)`.
     - Delete both `import()` calls and the `_moduleCache.set` after them.
   - Rewrite its JSDoc ("execute client-side"), the fifth-pass comment in `buildScope` ("dev mode — execute client-side, boundary unenforced"), and `resolveServerFunctionViaProxy`'s "when a timing: "server" module cannot run in the browser".
   - In `resolveServerFunctionViaProxy`, add `let seq = 0` and take `const n = ++seq` per call; `.then` assigns only when `n === seq`, and `.catch` logs under the same guard.
2. `preloadModule`'s JSDoc gains one sentence: a registered module is also how a host runs a `timing: "server"` entry in process, and otherwise the runtime calls the proxy.
3. If the Open is accepted, in `packages/server`:
   - `dev-vars.ts` exports `projectDevEnv(root)`, returning `{ ...process.env, ...loadDevVars(root), JX_PROJECT_ROOT: root }`, and `buildRuntime` in `jx-mounts.ts` uses it.
   - `handleServerFunction(req, root, envRoot = root)` calls `fn(args, projectDevEnv(envRoot))`.
   - `server.ts` passes `activeProjectRoot ?? absRoot` as `envRoot`, as it does for `handleJxMounts`. The other callers already pass their project root.

**Integration contract.** Once this lands:

- `resolveServerFunction` never calls `import()`. An entry resolves in process only from a specifier registered with `preloadModule`; every other entry is a POST to `/__jx_server__`.
- On the proxy path, a failure keeps the entry's last value and logs, and a superseded answer is dropped.
- If the Open is accepted, `projectDevEnv(root)` is exported from `packages/server/src/dev-vars.ts`, and the proxy and the mounts share it. `plan:_shared/compiled-server-call`'s `jx dev` route reuses it.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime` (`lines = 0.963, functions = 0.98`) and from `packages/server` (`0.96`, `0.95`), with the manifest check for each. No source file is added. Ratchet if a worst file rises.

`packages/runtime/tests/runtime-gaps-resolve.test.ts`, `describe("resolveServerFunction")`:

- The five in-process cases ("static args: awaits result…", "reactive $ref args re-invoke on change", "reactive args swallow rejections…", "missing export throws", "non-function export throws") first call `preloadModule(SERVER_SRC, await import(SERVER_SRC))`, so they pin the host-seeded path.
- New "an importable module is posted to the proxy, never imported". A fixture `_server_fn_tripwire.ts`, whose module body sets `globalThis.__jxTripwire = true`, is named by `$src` with a `file:` base, so today's second `import()` would load it. The test asserts one POST to `/__jx_server__` carrying that `$src`, and that the flag is unset.
- New "a module the runtime imported for a Function entry is not reused". A `$prototype: "Function"` entry imports a specifier first; a server entry naming the same specifier then POSTs to the proxy.
- New "a superseded proxy answer is dropped". Two deferred fetches resolve in reverse order, and the entry holds the second answer.
- `mount.test.ts`'s loader case passes unchanged.

`packages/server/tests/resolve-gaps.test.ts` (if the Open is accepted):

- New "the proxy's env carries the project's .dev.vars": a fixture project whose `.dev.vars` sets `JX_TEST_VAR=1` and whose function returns `env.JX_TEST_VAR`.
- `jx-mounts.test.ts` passes unchanged over the extracted helper.

## Specs & docs

- `spec.md` §11.4, in place:
  - Delete the leading marker's last sentence ("In an interpreting host … the runtime tries a browser `import()` first (Security Boundary, below)."). The marker stays Partial.
  - Replace the dev-boundary blockquote with this paragraph: "**In an interpreting host** (Studio's live preview and canvas, `jx dev` on a root without a `project.json`, or a page that calls `mount()`), the runtime never imports a `timing: "server"` module. Every call is a `POST` to the host's `/__jx_server__` proxy (server.md §3.3), which runs the function server-side with `env`, so the module's source is not delivered to the browser. A host that answers no proxy leaves the entry `null` and reports the failed call. The one exception is the host's own act: a module it registered with `preloadModule` (embedding.md §6) is called in process."
- `embedding.md` §6: after the `preloadModule` bullet, add "It is also the only way a `timing: "server"` entry runs in process: for any specifier not registered here, the runtime calls the host's `/__jx_server__` proxy and never imports the module (spec.md §11.4)."
- `server.md` §3.3 (if the Open is accepted): "`process.env` in the dev proxy" becomes "`process.env` merged under the project's `.dev.vars`, plus `JX_PROJECT_ROOT`, as for the extension mounts (§3)". Also add: "It is the only way an interpreting runtime calls a server function (spec.md §11.4)."
- Fragments:
  - `bun run spec:change spec.md minor -m "§11.4: an interpreting host calls a server entry only through the dev proxy and never imports its module in the browser"`
  - `bun run spec:change embedding.md minor -m "§6: preloadModule is the only way a server-timed entry runs in process"`
  - `bun run spec:change server.md minor -m "§3.3: the server-function proxy is the only interpreted call path, and its env merges the project .dev.vars as the mounts do"` (drop the second clause if the Open is declined)
- Docs:
  - `docs/framework/concepts/timing.md` (`spec:` `spec.md#11.4`): replace the `:::doc-warning` callout with a `:::doc-note` saying that during development the runtime never loads a server module in the browser, and that Studio's preview and the dev server run every call on the dev server with your `.dev.vars` in `env`. No em dash.
  - `docs/framework/build/dev-server.md` (`code:` `resolve.ts`): under "Server functions", say the POST is the only path, and mention `.dev.vars` if the Open is accepted.
  - `docs/extending/embedding/runtime-host.md` (`code:` `runtime.ts`): the preloading section gains the `embedding.md` §6 sentence.
  - `docs/framework/concepts/security.md` already sends credentials to a server entry, and its line 64 becomes true for one; it does not change unless the Open is declined (see Decisions). The other pages whose `code:` lists `runtime.ts` describe no server entry.

Neither `spec.md` nor `embedding.md` changes status.

## Acceptance

- The `packages/runtime` and `packages/server` suites pass at their thresholds, and the manifest check passes for both.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass. `bun run plans:status --spec spec` still lists §11.4, owned by `plan:_shared/compiled-server-call`.
- `grep -n "await import(" packages/runtime/src/runtime.ts` finds no call inside `resolveServerFunction`.
- Observable: open a page with a server entry whose module logs on load in Studio's preview, then under `jx dev` on a root without a `project.json`. The network panel shows a POST to `/__jx_server__`, no request for the `*.server.js` file, and the log appears in the terminal rather than the browser console.
