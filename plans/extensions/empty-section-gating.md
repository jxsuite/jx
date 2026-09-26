---
status: stub
disposition: implement
claims:
  - extensions.md#8.4
  - extensions.md#8.6
size: S
workspaces:
  - packages/compiler
  - packages/server
---

# One non-empty-section predicate gates every section owner's head, emit, assets, loading and mounts

## Context

`specs/extensions.md` §8.4, line 351:

> **Status: Partial.** Contribution, host-written files, error collection, ordering and the non-empty gate on `emit` itself ship (`packages/compiler/src/site/site-build.ts`). The gating bullet's comparison does not hold: section loading (`loadProjectSections`, `packages/compiler/src/site/project-sections.ts`, which the dev server also uses) runs whenever the key is present, and the dev server activates every mount whatever its section holds (`buildRuntime`, `packages/server/src/jx-mounts.ts`); only the site build's mount activation matches `emit`.

`specs/extensions.md` §8.6, line 405:

> **Status: Partial.** Contribution, placement below the project's `$head` and warning on failure ship (`collectExtensionHead`, `packages/compiler/src/site/site-build.ts`). Gating does not match `emit` and `assets`: `collectExtensionHead` skips only an absent or `null` section, so an empty object still contributes where those two skip it.

§8.4 was unmarked and §8.6 read `Implemented` before the census. They are one defect seen from two sections: five places decide whether a section owner is active, and they use four different tests. `emit` and `assets` (`packages/compiler/src/site/asset-mounts.ts`) skip an absent, `null` or empty section; the site build's `activeMounts` skips an absent or empty one (and would throw on `null`, since `Object.keys(null)` does); `collectExtensionHead` skips only absent or `null`; `loadProjectSections` and the dev server's `buildRuntime` skip only an absent key, and `buildRuntime` activates mounts with no section check at all. §8.6's gating bullet and `collectExtensionHead`'s own doc comment ("contributes when the project declares a non-empty value for its section key") both say the code lags, so §8.6 is an `implement`. §8.4's comparison is the detail phase's choice per consumer: make section loading and the dev server's mounts gate on a non-empty section (`implement`), or narrow the sentence to the consumers that do (`reconcile`).

**What exists**

- The non-empty gate, written three times: the `emit` loop in `packages/compiler/src/site/site-build.ts` (step 6e, whose comment claims "same gating as sections/mounts"), the section check in `packages/compiler/src/site/asset-mounts.ts`, and `activeMounts` in the same site-build file (step 1c).
- `collectExtensionHead` in `packages/compiler/src/site/site-build.ts`, called once before routes are built, with its output placed before the project's `$head` in `resolvedSiteHead`; `head` on `extensions/feed/src/Feed.class.json`, covered by `packages/compiler/tests/feed-integration.test.ts`. The feed's own schema rejects `{ "feed": {} }` (`extensions/feed/tests/extension-manifest.test.ts`), so no first-party output changes; a third-party section that validates empty is what the gate protects.
- `loadProjectSections` in `packages/compiler/src/site/project-sections.ts` (`key in projectConfig`), reached from the dev server through `packages/server/src/resolve.ts`.
- `buildRuntime` in `packages/server/src/jx-mounts.ts`, which takes `registry.serverMounts()` ungated and copies each present section into the shared `sections` map.

**What is missing**

- One exported predicate, "the project declares a non-empty value for this section key", used by `emit`, `assets`, `head`, the site build's mount activation and, if the detail phase keeps §8.4's sentence, section loading and the dev server's mount activation, so the five cannot drift again.
- The empty-object check in `collectExtensionHead`, with a test in `packages/compiler/tests/` that an empty section contributes no head entries.
- For §8.4: either the dev server and section loading gated the same way, with tests in `packages/server/tests/` that an empty or absent section mounts nothing, or the gating bullet rewritten to name what `emit` matches.

**Related**

- extensions.md §8.5 (the `assets` gate, which already matches), extensions.md §9 (`projectData` and `_project[<key>]`), extensions.md §11 (mount activation).
- site-architecture.md §8.3 (head merge order).
