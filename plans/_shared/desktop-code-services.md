---
status: stub
disposition: implement
claims:
  - desktop.md#5.3
  - studio.md#6.4
size: M
workspaces:
  - packages/desktop
  - packages/server
---

# The desktop app formats, lints and minifies function bodies in its own Bun process, and the code editor's text names the one host that has none

## Context

`specs/desktop.md` §5.3, line 471:

> **Status: Partial.** The dev server runs all three (`handleCodeApi` in `packages/server/src/code-api.ts`), and the null-stub contract below holds on every platform. Neither desktop launcher runs any: `codeService` in `packages/desktop/src/project-session.ts` resolves `null` for both, so the Bun process §7.1 draws with code services has none, and the function editor (`packages/studio/src/panels/editors.ts`) formats, lints and minifies nothing on the desktop.

`specs/studio.md` §6.4, line 663 (opened by the markers stage):

> **Status: Partial.** The editor and its Format, Minify and Lint calls ship (`codeService` in `packages/studio/src/services/code-services.ts`, called from `panels/editors.ts`), and the dev server serves them (`/__studio/code/*` in `packages/server/src/code-api.ts`). The desktop app, the end-user path, does not: its `codeService` returns `null` (`packages/desktop/src/project-session.ts`), as does the cloud host's (`packages/studio/src/platforms/cloud.ts`), so format, minify and lint silently do nothing there.

desktop.md §5.3 was this plan's census claim: it was the retired §11 roadmap's row "Port code services (format, lint, minify) to run in Bun process directly (currently stubbed)", and the section was unmarked before the census. studio.md §6.4 ("Monaco-powered editor for function `body` strings. Integrated with server code services") was unmarked too; the cross-spec review found it (M5) and the markers stage opened it. It joins this plan rather than getting its own because the desktop half of it is the same missing code, which is why the plan moved from `plans/desktop/` to `plans/_shared/`.

Disposition `implement`, for both claims. §7.1 and §7.4 of desktop.md both place code services in the desktop's Bun process, the dev server already has the implementation, and the null stub is §5.3's degradation for a platform with no server-side code tooling, which the desktop is not. The cloud half of the §6.4 marker is not a second implementation: desktop.md §5.3 already makes `codeService` null-returning "for platforms without server-side code tooling", the three routes are `optional` in `STUDIO_ROUTES` with that degradation recorded on each, the cloud adapter lists "code services" among its declared omissions, and its backend is not in this repository and composes per-project schemas in a Worker (studio.md §3.4's platform list), so it could not run the dev server's implementation as it stands: lint spawns the `oxlint` CLI and minify is `Bun.Transpiler`. So once the desktop ships, §6.4's "Integrated with server code services" is qualified to the host's code services (desktop.md §5.3), naming the cloud as the host that degrades, and §6.4 flips with §5.3.

**What exists**

- `handleCodeApi(req, url)` in `packages/server/src/code-api.ts`: `oxfmt`'s Node API for format, `Bun.Transpiler` for minify, the `oxlint` CLI (located by `resolveOxlintBin`, which returns `null` in a packaged app) for lint. server.md §5 marks it Implemented.
- `codeService` in `packages/desktop/src/project-session.ts` (`async function codeService(_params) { return null; }`), registered by `packages/desktop/src/window-manager.ts` and `packages/desktop/src/chromium/index.ts`, declared in `packages/desktop/src/rpc-schema.ts`, and forwarded by both adapters (`packages/desktop/src/platform.ts`, `packages/desktop/src/chromium/platform.ts`).
- The callers: `packages/studio/src/services/code-services.ts` (returns `null` when a platform has no `codeService`) and `packages/studio/src/panels/editors.ts`: format on open, lint on open and on a 750 ms debounce while typing, and minify when the function editor closes (`closeFunctionEditor`). Each treats a `null` result as a no-op (`result?.code != null`, `result?.diagnostics`, `minResult?.code ?? currentCode`), so the degradation is silent by §5.3's contract; there is no Format, Minify or Lint control to disable.
- The dev server platform (`packages/studio/src/platforms/devserver.ts`) POSTs to `/__studio/code/<action>` and returns `null` on a non-OK response; the cloud platform's `codeService` (`packages/studio/src/platforms/cloud.ts`) returns `null` unconditionally, and its header comment lists code services among the cloud omissions that degrade per `@jxsuite/protocol`'s route table.
- `STUDIO_ROUTES` in `packages/protocol/src/routes.ts`: `codeFormat`, `codeMinify` and `codeLint`, each `optional` with its degradation ("Code editors skip format-on-open/save (codeService returns null).", "Compiled-output minification is skipped.", "Code editors show no lint markers.").
- `jxResolve` in the same desktop session, which already answers an RPC by handing a synthetic `Request` to a server handler: the shape a code-services port can reuse.

**What is missing**

- The session's `codeService` answering `format`, `lint` and `minify` from the same implementation the dev server uses, rather than a second copy.
- The tools in the packaged app: `oxfmt`'s native binding and an `oxlint` binary staged by `build.copy` in `packages/desktop/electrobun.config.ts` (and present in the Nix bundle's `node_modules`), with `resolveOxlintBin` finding them there and `packages/desktop/scripts/verify-bundle.ts` asserting they were staged, or a stated per-tool degradation where one cannot ship.
- Tests on both launchers' handler maps, and the parity check in `packages/desktop/tests/_rpc-parity.ts` still passing.
- studio.md §6.4's sentence qualified: code services come from the host (desktop.md §5.3), and a host without server-side code tooling (the cloud) resolves `null`, so the editor opens unformatted, shows no lint markers and saves the body unminified. Whether that degradation should stay silent or be said once in the editor is a detail-stage question; §5.3's contract today is silent.

**Related**

- desktop.md §7.1 (the Bun process box lists code services), desktop.md §7.4 (the stale tree names a code-services module; `plan:desktop/app-structure-tree` rewrites it, and names where the code services live if this plan lands first).
- server.md §5 (the dev server's code services).
- The cloud platform's `codeService` could forward to its backend's `studio/code/*` route and return `null` on a non-OK response, as `devserver.ts` does, letting a cloud backend opt in without a Studio release. That is not needed to close §6.4 (the backend is outside this repository) and would add `packages/studio` to the workspaces; decide it at detail.
- `plans/studio/README.md` lists §6.4 under Verified from before the markers stage opened it; the audit record is stale on that one line.
