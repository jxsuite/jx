---
status: drafted
disposition: implement
claims:
  - server.md#3.5
requires: []
workspaces:
  - packages/server
  - packages/studio
size: M
---

# Each Studio tab's canvas and static files are served from an origin of its own project

## Context

server.md §3.5 is Pending: "The static lanes (§3, step 7) answer from the server's one `activeProjectRoot`, which is whichever project was activated last. Two Studio tabs on one dev server, each with its own project, therefore read each other's media."

What the code does today:

- `packages/server/src/server.ts` keeps one `activeProjectRoot` for the process, set by `POST /__studio/activate`. The absolute-path lane, the extension asset mounts, the project-root lane, the `public/` lane and the npm lane all read it.
- `packages/studio/src/platforms/devserver.ts` registers no `canvasUrl`, so `resolveCanvasUrl()` in `packages/studio/src/canvas/iframe-host.ts` loads `canvas.html` from the shell's own origin (`bundleUrl("../canvas.html")`). Every authored URL the canvas loads resolves against that one origin.
- The git routes had the same defect and were closed per request with `?dir=` (server.md §4.1). That mechanism needs Studio to build the URL; authored site-absolute references, stylesheet `url()`s, fonts and module imports are not URLs Studio builds.
- Two parts of the system already give a project its own origin: the live preview (`packages/server/src/live-preview.ts`, server.md §3.4) keys one by normalized project root, and the desktop shells load the canvas from a loopback project server (`packages/server/src/project-server.ts`), with `canvasUrl` registered by the platform.

Reproduced on 2026-10-18 with two scratch projects and two tabs on one dev server: after the second tab activated, the first tab's `fetch("/New-Block-Foundation-Lancaster.jpg")` (a file only the first project has) answered 404.

## Outcome

server.md §3.5 → Implemented, and server.md graduates again (its only open item).

## Decisions

- **Decided:** an origin per project, not a request parameter, because the URL space of authored references can only mean one project if the origin means one project. A `Referer`-keyed lookup scopes the first request and loses the stylesheet chain behind it; a cookie is shared by every tab on the origin.
- **Decided:** the shell's origin keeps the Studio bundle and `/__studio/*`; only the canvas and the project's static lanes move, because every `/__studio/*` route already names its project (`?dir=` or a path).
- **Open:** reuse `project-server.ts` (the desktop's loopback project server, token-gated) or `live-preview.ts`'s origin map for the canvas origin. The project server already serves `canvas.html` and the resolve routes behind a token; the preview map already has the lifetime rule (keyed by root, lives for the process).
- **Open:** whether the devserver platform registers `canvasUrl` at activation (as electrobun does through `canvasUrlDeferred`) or the shell asks the server for it per project.

## Implementation

- `packages/server`: an origin per activated project root, serving `canvas.html` and its bundle, the project's static lanes (§3, step 7) and the resolve routes, gated as server.md §4.2 gates the desktop loopback; `POST /__studio/activate` answers its URL.
- `packages/studio/src/platforms/devserver.ts`: register the returned origin as `canvasUrl` (deferred until activation), so `canvasBaseOrigin()`, `documentBase()` and `loopbackAssetSrc()` in `src/canvas/canvas-origin.ts` address it; Studio-built previews (`previewFileSrc`) follow through `loopbackAssetSrc`.
- Integration contract: after this lands, a static request on a project origin is answered from that project only, whatever any other tab activated.

## Tests

- `packages/server/tests`: two projects activated in turn each keep their own origin, and each origin answers its own `public/` file and 404s the other's.
- `packages/studio/tests`: the devserver platform registers the activated origin as `canvasUrl`; `canvas-origin` tests cover the cross-origin branch already.
- Coverage thresholds in both workspaces hold; ratchet if the worst file rises.

## Specs & docs

- server.md §3.5: marker to Implemented, the body rewritten to what ships; §3 step 7's pointer to §3.5 kept. Graduate server.md in place with `bun run spec:bump specs/server.md patch -m "…"` and delete `plans/server/`.
- Docs: the page `bun run docs:sync` names for packages/server/src/server.ts and the devserver platform.

## Acceptance

- Two Studio tabs on two projects served by one dev server: each tab's canvas and Media grid show its own project's images, before and after the other tab activates.
- `bun run docs:status` and `bun run plans:check` pass with server.md Implemented.
