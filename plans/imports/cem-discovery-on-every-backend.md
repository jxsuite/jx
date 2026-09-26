---
status: stub
disposition: implement
claims:
  - imports.md#2
size: M
workspaces:
  - packages/server
  - packages/desktop
  - packages/studio
---

# Every Studio backend discovers the Custom Elements Manifest components a project's dependencies ship

## Context

`specs/imports.md` §2, line 81:

> **Status: Partial.** Only the dev server discovers CEM components: its `GET /__studio/components` handler (`packages/server/src/studio-api.ts`) reads each installed dependency's `customElements` manifest and lists its elements as `source: "npm"` entries. The desktop session's `discoverComponents` (`packages/desktop/src/project-session.ts`) and the cloud adapter's (`packages/studio/src/platforms/cloud.ts`) list only JSON project components, so in the desktop app no npm element reaches the property inspector, the Packages panel's cherry-pick or the Insert panel.

The section was unmarked before the census, and the census first recorded it as verified against the dev server alone. Disposition `implement`: the desktop app is the end-user path to Studio, desktop.md §5.1 says a transport-mapped backend preserves the dev server's response shapes, and the studio's npm features already work wherever the registry carries npm entries, so only the discovery is missing.

**What exists**

- The CEM scan inside the `/__studio/components` handler in `packages/server/src/studio-api.ts`: `dependencies` and `devDependencies` from the scanned project's `package.json`, each resolved in the project's then the root's `node_modules`, its `customElements` manifest read, and every declaration with `customElement` and `tagName` mapped to a `source: "npm"` entry (`package`, `modulePath`, `props` from `attributes`, public field `members`, `events`, `slots`, `cssProperties`). It is inline in the route, not a function another backend can call. Cases in `packages/server/tests/studio-api-gaps.test.ts`.
- `componentMetaFrom` in `packages/schema/src/component-meta.ts`, the JSON-component extractor all three backends already share, which is the precedent for sharing this one.
- `discoverComponents` in `packages/desktop/src/project-session.ts` (wired in `packages/desktop/src/window-manager.ts` and `packages/desktop/src/chromium/index.ts`): a `**/*.json` glob that skips `node_modules`, with no `package.json` or manifest read. The session already imports server modules (`@jxsuite/server/resolve`, `/refactor`, `/data`), so a shared scan can live in `packages/server`.
- `discoverComponents` in `packages/studio/src/platforms/cloud.ts`: a bounded `.json` walk over `listDirectory` that skips `node_modules`. A cloud session is a repository, where dependencies may not be installed at all.
- The consumers, all keyed on `source === "npm"` registry entries from `loadComponentRegistry` (`packages/studio/src/files/components.ts`): `groupByPackage` in `packages/studio/src/panels/imports-panel.ts` (the cherry-pick checkboxes), `componentViews` and the enabled-npm filter in `packages/studio/src/panels/elements-panel.ts` (the Insert panel's npm cards), the npm branch in `packages/studio/src/panels/properties-panel.ts` (the inspector), and `npmSpecifier` in `packages/studio/src/files/elements.ts`.

**What is missing**

- The scan extracted from the route into a function over a project directory, with the route calling it, so the dev server and the desktop session answer one way.
- The desktop session's `discoverComponents` appending that function's npm entries to its JSON components.
- A decision for the cloud adapter: read manifests through the remote session if the backend can see installed packages, or document the omission and the degradation in desktop.md §10.1 alongside its other omissions.
- Tests on the desktop side proving an npm entry reaches the registry, beside the existing dev-server cases.

**Related**

- imports.md §4.1 (the route shape the entries follow), imports.md §4.3 (the `cem` route, which no platform calls).
- desktop.md §5.1 (transport-mapped backends preserve response shapes), desktop.md §10.1 (the cloud adapter's omissions).
- studio.md §9.1.3 (the cherry-pick and the drop write through `enableElement`).
