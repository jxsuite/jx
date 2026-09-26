---
status: stub
disposition: reconcile
claims:
  - desktop.md#7.4
size: S
---

# §7.4 draws the desktop package as it is laid out, and the spec's stale paths and names are corrected with it

## Context

`specs/desktop.md` §7.4, line 705:

> **Status: Partial.** The prose below ships: distribution names in `packages/desktop/release-assets.json`, `build.copy` in `packages/desktop/electrobun.config.ts`, and the `postBuild` check in `packages/desktop/scripts/verify-bundle.ts`. The tree does not match the package: the entry is `packages/desktop/src/index.ts`, the PAL handlers are `project-session.ts` (re-exported by `handlers.ts`) beside `window-manager.ts`, the webview init is `src/init.ts` bundled by `scripts/pre-build.ts` and staged to `views/studio/dist/init.js`, and no code-services module exists (§5.3).

The section was unmarked before the census. Disposition `reconcile`: the package's layout is the working one, and the tree is a sketch from before the package existed (`jx-studio-app/src/bun/main.js`, `studio-handlers.js`, `code-services.js`, `src/views/studio/{index.html, init.js}`).

This stub also owns the spec's editorial drift: stale paths, counts and names in sections whose status holds. None of it is a status, so none of it has a marker, and the audit record that lists it is deleted when the spec graduates. The riders below land in the same change as the tree.

**What exists**

- `packages/desktop/src/index.ts` (the main-process entry `electrobun.config.ts` names), `project-session.ts`, `window-manager.ts`, `handlers.ts`, `rpc-schema.ts`, `init.ts`, `boot.ts`, `platform.ts`, and `chromium/` for the NixOS launcher.
- `packages/desktop/scripts/pre-build.ts` (bundles `src/init.ts` to `assets/studio/dist/init.js`), `stage-studio-assets.ts`, `post-build.ts` and `verify-bundle.ts`; `build.copy` maps `assets/studio/**` to `views/studio/**`.

**What is missing**

- The tree rewritten to the package as it stands, keeping the `.hutch/devkit` and `vendor/electrobun` notes, which hold.
- If `plan:_shared/desktop-code-services` lands first, the tree names where the code services live; otherwise it names none.

**Editorial riders**

- §1: the NixOS row's Storage cell says "Filesystem via dev server", but §9.1 says that launcher's backend "is **not** the dev server". It is `createProjectServer()` from `@jxsuite/server` (`packages/desktop/src/chromium/index.ts`).
- §3.1: the launcher-only extras paragraph cites `resize-edges.ts` and `panels/toolbar.ts`. `panels/toolbar.ts` does not exist, and `windowControls` is read in `packages/studio/src/surfaces/commandbar.ts` and `packages/studio/src/resize-edges.ts`. The same paragraph calls `updater` and `windowControls` "the two today". `githubAuth` is a third (`packages/desktop/src/platform.ts`), and nothing in `packages/studio/src` reads `updater`.
- §3.5: `Utils.openExternal` is said to come from `electrobun/bun`. `packages/desktop/src/utils.ts` imports `electrobun/main`, and §7.1 itself calls `electrobun/bun` a deprecated alias.
- §5.1: the route table is "roughly 60 routes", but `STUDIO_ROUTES` in `packages/protocol/src/routes.ts` holds 71. The generated reference is `docs/extending/reference/studio-routes.md` (written by `scripts/docs/generators/studio-routes.ts`), and `docs/extending/embedding/backend-protocol.md` only links to it.
- §7.2, §7.3 and §8.1: the samples are headed with paths that do not exist (`packages/studio-desktop/platform.js`, `src/bun/studio-handlers.js`, `packages/studio/platforms/devserver.js`).

**Related**

- desktop.md §5.3 (code services), desktop.md §7.1 (the process split the tree illustrates), desktop.md §9.3 (the Nix build runs `pre-build-rpc.ts` instead).
- desktop.md §3.1 and §3.6, whose own open items belong to `plan:desktop/settings-patch-cross-process-lock` and `plan:desktop/github-token-stays-in-launcher`. The riders touch only their prose paths and counts.
