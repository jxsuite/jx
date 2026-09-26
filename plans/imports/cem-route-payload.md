---
status: stub
disposition: reconcile
claims:
  - imports.md#4.3
size: S
workspaces:
  - packages/server
---

# §4.3 states the `{ cem }` envelope `GET /__studio/cem` returns, or the unused route is retired

## Context

`specs/imports.md` §4.3, line 148:

> **Status: Partial.** The route in `packages/server/src/studio-api.ts` returns the manifest wrapped as `{ cem }`, answers `{ cem: null }` when the package, its `customElements` field or the manifest file is missing, and takes an optional `dir`. No studio platform calls it: the inspector's CEM metadata arrives through `GET /__studio/components` (§4.1).

The section was unmarked before the census and says the route "Returns the full Custom Elements Manifest JSON for a package". Disposition `reconcile`: the envelope is a deliberate shape (a missing manifest is `{ cem: null }`, not an error), and the route is declared in `packages/protocol/src/routes.ts` with its degradation sentence, so the spec lags the code rather than the other way round.

**What exists**

- The `/__studio/cem` handler in `packages/server/src/studio-api.ts`: `pkg` is required (a problem response otherwise), `dir` optional, the project's `node_modules` searched before the root's; cases in `packages/server/tests/studio-api-gaps.test.ts`.
- The `cem` route in `packages/protocol/src/routes.ts` ("Custom-elements manifest of an npm dependency", degrading to "Dependency components lose prop/slot metadata").
- No caller in `packages/studio/src/platforms/` or `packages/desktop/src/`; the CEM is read server-side by the `/__studio/components` handler instead.

**What is missing**

- §4.3 rewritten to the envelope, the `null` cases and the `dir` parameter.
- A decision the detail phase makes first: with no client, the route may be better retired from the server and from `packages/protocol/src/routes.ts`, in which case this plan's disposition becomes `remove` and §4.3 is marked Removed with that reason instead.

**Related**

- imports.md §2 (CEM discovery) and imports.md §4.1 (the route that does carry CEM metadata to the studio).
- `plan:imports/packages-route-payload` (the sibling §4.2 reconcile; the two can land in one pull request).
