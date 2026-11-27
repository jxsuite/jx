---
title: "Dev server internals"
description: "Inside @jxsuite/server, the protocol's reference implementation: the route chain, the Studio API mount, the resolve proxies, and the security model."
spec:
  - server.md#3 # core endpoints
  - server.md#4 # studio filesystem API
  - server.md#4.2 # security
  - server.md#5 # code services
  - project-state.md#3.2 # the desktop and Server-Sent Events bindings
  - project-state.md#9 # the rename cascade
  - project-state.md#10.2 # the dev server's project state host
  - project-state.md#11.3 # collaboration rooms keyed by document
code:
  - packages/server/src/server.ts
  - packages/server/src/code-api.ts
  - packages/server/src/studio-api.ts
  - packages/server/src/resolve.ts
  - packages/server/src/jx-mounts.ts
  - packages/server/src/project-server.ts
  - packages/server/src/project-events.ts
---

# Dev server internals

`@jxsuite/server` is the reference implementation of the [backend protocol](/docs/extending/embedding/backend-protocol): a Bun-native dev server whose `/__studio/*` mount is the literal route table, plus the proxies and services that make documents behave in development as they do in production. This page is the architecture tour for backend implementers. For using the server day to day, see [the dev server](/docs/framework/build/dev-server) in the Framework section.

## One handler, an ordered route chain

`createDevServer()` stands up a single `Bun.serve` fetch handler that checks routes in a fixed order; the first claimant wins, and anything unclaimed falls through to static file serving:

1. `/__reload`: the SSE live-reload endpoint (skipped when `watch: false`).
2. `POST /__jx_resolve__`: the `$prototype`/`$src` resolution proxy.
3. `POST /__jx_server__`: the `timing: "server"` function proxy.
4. `/_jx/*`: extension server mounts.
5. `/__studio/*` is the Studio API (skipped when `studio: false`): the collab WebSocket upgrade, the project state stream, `activate`, then the AI, site-import, and code sub-APIs, then `handleStudioApi` for everything else.
6. Custom `middleware`, if the embedder passed one.
7. Static files: project files at their natural URLs, the active project's tree, `public/` at the site root, and bare npm specifiers resolved through the active project's `node_modules`, then the root's, and bundled on demand.

Ordering is load-bearing: the privileged endpoints must be claimed before the static fallback can ever see their paths, and `middleware` deliberately sits after the protocol routes so an embedder cannot accidentally shadow them.

`jx dev` on a site project passes a `middleware` (step 6) that answers `POST /_jx/server/<export>` for the server functions its last build collected, then serves the built pages from `dist/`. A built page calls that route, as it does the deployed worker, and the middleware stands in for it. It is exported as `createServerFunctionMiddleware` for embedders that host a built site.

## The Studio API mount and activation

`handleStudioApi` (in `studio-api.ts`) implements the protocol's route table against the filesystem. Its central piece of state is the **active project root**: `POST /__studio/activate` stores an absolute path, and from then on file operations, static serving, and format dispatch resolve against it. This is what lets one server open projects that live outside its own `root`.

Format and extension behavior is served from a per-project **extension registry**, built by scanning the project's dependencies and cached against the project file's mtime. Edit the manifest and the next request rebuilds the registry. The `formats`, `format`, and `project-schemas` routes all answer from it.

A host embedding `handleStudioApi` directly passes `onFileMoved` alongside `allowedRoots` and `onProjectCreated`, and `projectEvents` to serve the project state routes below. `createDevServer` wires `onFileMoved` to the collaboration registry, and a host running its own collab layer must do the same for every room it keys by path: a rename moves the file out from under such a room, and the next save from anyone still in the room would write its pre-rename content back, recreating the file the rename deleted. It is called with the OLD absolute path, and it is the same hook the file watcher already uses. A room `createDevServer` keys by document (below) ignores it.

## The project state stream

The dev server runs the project state host for the active project ([`project-state.md` §10.2](https://github.com/jxsuite/jx/blob/main/specs/project-state.md#102-dev-server)), the same module the desktop backend runs, from `project-events.ts`. It starts on the first request that needs it, so a Studio that never subscribes pays nothing, and it serves `activeProjectRoot ?? root`, like every other route. Activating another project closes it, which ends every open stream, and the next request starts a host over the new project in a new epoch.

- **`GET /__studio/project/events`** is a Server-Sent Events stream, separate from `/__reload`. Its first frame, `event: subscribe`, answers the subscribe that the `Last-Event-ID` header names (`<epoch>:<rev>`): the events since, or a snapshot when there is no cursor or the log no longer holds it. Every later frame is `event: project` with `{ epoch, events }`, and its `id:` names the last revision it carries, so a browser's own reconnection resumes exactly where it stopped. `?clientId=` names the client. `?root=` names the project the client activated, spelled as it posted it to `activate`; while another project is active the stream is refused with `409 conflict`, because every tab shares the server's one active project and no frame says which one a stream describes. The stream sends no `retry:` and closes when the host ends the subscription, or when the reader falls more than 4 MiB behind.
- **A conditional write or delete** is the ordinary file route with a base. `PUT /__studio/file` carrying `If-Match: "<hash>"` (or `If-None-Match: *` for a new file) and `Jx-Write-Id` writes the body's bytes through the host and answers `{ ok, rev, hash, path }` with the hash as its `ETag`. `DELETE /__studio/file` carrying `If-Match` for a file, or a `{ files }` JSON body for a directory, and `Jx-Write-Id`, deletes through it. A stale base is a `412` `precondition-failed` problem naming the path, the document and the hash on disk. A request that names neither a base nor `Jx-Write-Id` keeps the unconditional, last-writer-wins behaviour, since the server cannot tell over HTTP which client subscribed.
- **A rename as one operation** is `POST /__studio/project/rename` with a `RenameOperation` body (`{ opId, from, to, policy, dirtyReferrers, rewrites? }`, paths relative to the active project). The host plans the move and every reference rewrite, applies them one step at a time, and puts every file back if a step fails, so the project ends either fully renamed or exactly as it was ([`project-state.md` §9](https://github.com/jxsuite/jx/blob/main/specs/project-state.md#9-rename-cascade)). The answer is always `200` with the result: `{ ok: true, rev, files, references, errors, buffers, … }` once applied, or `{ ok: false, reason, message, paths }` when refused. A refusal carries `unrestored` only when the host could not undo a step, and lists the paths it left changed. The paths in the body carry no project, so the request names the project the client activated as `?root=`, as a stream does; while another project is active it is refused with `409 conflict`. A referrer named in `dirtyReferrers` is refused under `policy: "refuse"`, and left on disk under `"rewrite-buffer"`, its rewrite coming back in `buffers` for the client to apply to its unsaved copy. A rewrite the client sent itself for such a referrer is not written either. A malformed body, or a path outside the project, is a `400`. The older `POST /__studio/file/rename` stays, for clients that do not subscribe and for format conversions.
- **The live preview overlay** (`POST` and `DELETE /__studio/preview/overlay`) of the active project is keyed by document and client, as on the desktop: a rename the host observes moves an overlay, a removal drops it, and activating another project unpublishes the overlays of the one before. A `clientId` in the request body names the client that sets or clears it, and its overlays outlive its last open stream naming the same `clientId` by 30 seconds. An overlay set without one is shared by every client that names none, so any of them may clear it.
- **The usage query** (`/__studio/references`) answers from the host's graph once the host is indexed and settled, and walks the tree otherwise.

Studio's dev-server adapter exposes the client half as `projectState`, with the `{ subscribe, write, delete, rename }` shape the desktop adapter exposes. The reload stream keeps its `fs` frames meanwhile, so a Studio that does not subscribe sees no change.

**Collaboration rooms inside the active project are keyed by document.** The collaboration registry follows the host's events: a rename the host observes moves a room (a peer still at the old path and one opening the new path share it), a removal closes it, and a save goes through the host's conditional write with the hash the room loaded or last saved, so a stale save is refused and reaches every participant as a `doc-conflict` control message rather than overwriting the disk. Two saves of one room run one after the other, so pressing Save twice, or two peers saving together, is never a conflict with itself. Activating another project saves each room with unsaved edits through the host of the project it belongs to, and then closes it. A room outside the active project is keyed by its path, as before; if a later activation brings its file into the active project, the room is saved and closed, so one file never has two rooms.

### Which root a path is measured against

Two roots are in play once a project is activated: the root the server was started on, and the project Studio bound to it. The API's convention is one sentence, and it is worth reading twice because the two are usually the same and the difference only shows up when they are not:

**A path you send is relative to the server root. A path you get back is relative to the active project.**

So `?path=`, `?dir=` and a rename's `from`/`to` all resolve against the server root, while the file lists, the reference reports and the refactor reports all name files relative to the project. The refactor routes are where this bites: their sweep runs inside the project, so `/__studio/references` re-expresses your target into the project's space before scanning, and a target that lands outside the project comes back as a `400`. It is never a `200` carrying zero references, which would answer a question nobody asked.

## The resolve proxies

`resolve.ts` implements the two endpoints the runtime uses to run server-side code during development. `handleResolve` takes a `$prototype`/`$src` entry, imports the module server-side (`.js` directly; `.class.json` via its `$implementation`, or a class constructed from the schema), instantiates it with the config, and returns the resolved value. `handleServerFunction` imports a module and invokes a named export with an arguments object. Both do dynamic `import()` of project code. They are remote-code-execution surfaces by design, which is why the security model below exists.

`code-api.ts` adds the code services behind the `codeService` platform member: `oxfmt` formatting (through `code-format.ts`, which `jx format` shares) and `oxlint` diagnostics for the function-body editor. The same dispatch, `runCodeService`, answers the desktop backend's `codeService` request in its own process. oxlint runs under the host's own runtime with an explicit empty configuration, so every host lints with oxlint's default rules rather than whichever `.oxlintrc.json` sits above its working directory.

## Extension server mounts

`jx-mounts.ts` dispatches `/_jx/*` to extension classes that declare a `server` block, the same fetch-style handlers the generated site worker mounts in production, so data-backed documents work identically in both environments. In development it adds conveniences: `env` is `process.env` merged under the project's `.dev.vars` plus `JX_PROJECT_ROOT`, connectors with a `local` provider get stood in locally (D1 becomes SQLite under `.jx/data/`), and table schemas sync additively on first touch. It mounts the same set, too: a class that owns a project section is mounted only when that section is non-empty, exactly as in the built worker. See [server mounts](/docs/extending/extensions/server) for the extension-author side.

## The security model

The dev server and the desktop's `createProjectServer` share one set of primitives (`packages/server/src/net-guard.ts`); the dev server applies all but the token:

- **Loopback bind** (`127.0.0.1`) by default is the primary control, because other local processes and LAN pages can't read a loopback page's location. A `hostname` option (`jx dev --host`) can widen the bind for containers, but that removes the control and should only be used behind trusted isolation.
- **Origin/Host gate** guards every privileged surface: the RCE-capable `/__jx_resolve__` / `/__jx_server__` routes, the `/_jx/` mounts, and the whole `/__studio/*` API. A loopback (or absent) Origin passes; a cross-origin Origin or a rebinding Host is rejected. The browser Studio and the served site are same-origin, so they pass; a malicious external page does not. The dev server needs no token because it is same-origin; the desktop server, whose canvas iframe is cross-origin, adds a per-server token on top.
- **Fetch Metadata** is read on the same surfaces. `Sec-Fetch-Site` says what a request _intends_, which `Origin` can't: a same-origin `GET` sends no `Origin` at all, so that check has to accept an absent one. `same-origin` and `none` pass; `cross-site` passes only as a top-level document navigation (a person clicking a link); **`same-site` is rejected**, because on loopback there's no "site" bigger than the origin, so `same-site` means _another port on your machine_. A request with no `Sec-Fetch-*` at all passes, because curl, Bun's fetch and the desktop bridge don't send it and the threat here is a browser page, which always does.
- **File containment** (`containedPath`) pairs a lexical `relative()` check with a `realpath` re-check, so a `../` or absolute path can't escape and a symlink can't point outside the project root. It guards static serving, `assertAccessible` for the filesystem API, and every `$src` / `$base` / `$implementation` resolved before a dynamic `import()`. Over-encoded paths are rejected after a single decode.
- **Two-root activation**: `assertAccessible(filePath, root, activeProjectRoot)` allows a path under the server root or the project root Studio bound via `POST /__studio/activate`. Activation itself accepts four kinds of root: one contained under the server root, an explicit `allowedRoots` entry, a project this server just created, or a project the account already owns (an absolute directory holding a project file under the user's home directory). That last kind is what opens an _existing_ project: projects normally live outside whatever tree the server happens to serve. Anything else is a `403`, and a refused activation is an error to show the user. The endpoints that take no `dir` (the git surface especially) fall back to the server's own root, so swallowing the refusal would quietly act on the wrong tree.

:::doc-warning
The resolve proxies import and execute arbitrary project code by design. Keep the loopback bind, and if you must widen it, put the server behind trusted isolation. The Origin/Host gate assumes the network itself is not hostile.
:::

:::doc-note
**One route is exempt from the token, and only from the token: the OAuth callback** (`/__jx_oauth__/callback`) on the desktop's project server. An identity provider redirects the user's own browser there, and a page cannot append a secret to a URL it does not compose. A token gate would make sign-in impossible rather than safe. The `state` parameter does that job: unguessable, single-use, short-lived, compared in constant time. The Host and Fetch Metadata checks still apply, and an IdP redirect is exactly the one cross-site shape they admit, a top-level document navigation.
:::

:::doc-note
**No response ever carries an `Access-Control-Allow-` header.** The entire model rests on the browser refusing cross-origin reads, so one CORS header would give that away. A check enforces the absence rather than trusting it; nothing in the code makes a load-bearing absence visible.
:::

## The desktop project server's socket

The desktop's `createProjectServer` carries Studio's requests over one WebSocket per window: a request is `{ id, method, params }`, and its reply is `{ id, result }` or `{ id, error }`. Three things on it go beyond a request and its reply:

- **A handler can keep talking to the socket that asked.** Each handler is given the request's connection, whose `send` writes a frame to that socket alone, `buffered` reports how many bytes the socket still holds for a reader that has not taken them, `onClose` runs when it closes, and `afterReply` runs right after the reply is sent, so nothing the handler holds back can arrive before the reply. The project state subscription is built on it: `projectSubscribe` answers with a snapshot or the missed events, then pushes `projectEvents` frames to that socket and a `projectEnded` frame when the backend ends the subscription ([`project-state.md` §3.2](https://github.com/jxsuite/jx/blob/main/specs/project-state.md#32-transport-bindings)). A socket holds one subscription, so subscribing again replaces it, and a socket that falls more than 4 MiB behind is sent `projectEnded` instead of more events, so it catches up by subscribing again.
- **A socket that subscribed writes with a base.** Once a socket has subscribed, `writeFile`, `uploadFile` and `deleteFile` are refused on it with an `invalid-request` problem, and it writes through `projectWrite` and `projectDelete`. A socket that never subscribed keeps the unconditional calls, last-writer-wins. A rename goes through `projectRename`, which takes a `RenameOperation` and answers the host's result, a refusal included, exactly as the dev server's `POST /__studio/project/rename` does; `renameFile` stays on every socket, since a format conversion is still a rename whose bytes change.
- **A refusal can say why in a structured form.** A handler that throws `RpcProblemError` sends its RFC 9457 problem document as `problem` beside the `error` sentence. A conditional write or delete whose base is stale (`projectWrite`, `projectDelete`) is refused with the `412` `precondition-failed` problem, which names the path, the document and the hash on disk.

## Related

- [The dev server](/docs/framework/build/dev-server): the user-level page, covering options, live reload, and the proxies from the document author's view
- [The backend protocol](/docs/extending/embedding/backend-protocol): the contract this server is the reference for
- [Protocol route reference](/docs/extending/reference/studio-routes): every `/__studio/*` route it serves
- [Extension security model](/docs/extending/extensions/security): the trust boundaries extensions themselves live under
