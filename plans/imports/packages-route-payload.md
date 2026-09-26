---
status: stub
disposition: reconcile
claims:
  - imports.md#4.2
size: S
workspaces:
  - packages/server
---

# §4.2 describes `GET /__studio/packages` as the project's dependency list it is

## Context

`specs/imports.md` §4.2, line 142:

> **Status: Partial.** The route in `packages/server/src/studio-api.ts` lists every installed dependency and devDependency, CEM-bearing or not, as `{ name, version, dev, hasCem, customElementsPath }`, and the studio reads it as its general dependency list (`listPackages` in `packages/studio/src/platforms/devserver.ts`, typed `PackageInfo[]` in `packages/protocol/src/types.ts`). No client reads `hasCem`.

The section was unmarked before the census and says the route "Lists CEM-bearing npm dependencies". Disposition `reconcile`: the code is right. The route became the studio's dependency list (the Dependencies editor, the Extensions settings section and the About dialog all read it through `platform.listPackages()`), and `packages/protocol/src/routes.ts` already declares it as "List dependencies (PackageInfo[])". CEM metadata reaches the studio through `GET /__studio/components` (§4.1), not through this route.

**What exists**

- The `/__studio/packages` handler in `packages/server/src/studio-api.ts`: reads `dependencies` and `devDependencies` from the project's `package.json`, resolves each in the project's then the root's `node_modules`, skips a dependency that is not installed, and returns `{ name, version, dev, hasCem, customElementsPath }`. Cases in `packages/server/tests/studio-api-gaps.test.ts`.
- `PackageInfo` in `packages/protocol/src/types.ts` (`name`, `version`, optional `dev`); the `packages` route in `packages/protocol/src/routes.ts`.
- The desktop backend's `listPackages` in `packages/server/src/packages.ts`, which lists every declared dependency whether installed or not and carries no CEM fields.
- Consumers: `packages/studio/src/settings/dependencies-editor.ts`, `packages/studio/src/settings/extensions-section.ts`, `packages/studio/src/about/about-modal.ts`.

**What is missing**

- §4.2 rewritten to the payload: every dependency and devDependency with `name`, `version` and `dev`, per `PackageInfo`.
- A decision the detail phase makes: drop the unread `hasCem` and `customElementsPath` fields so the dev-server route matches `PackageInfo` and the desktop backend, or document them as dev-server extras. Likewise whether an uninstalled dependency is listed, where the two backends disagree today.

**Related**

- imports.md §4.3 (the CEM route, reconciled separately in `plan:imports/cem-route-payload`).
- studio.md §5.1 (the Packages panel) and studio.md §9.1.3 (the `$elements` service the cherry-pick writes through).
