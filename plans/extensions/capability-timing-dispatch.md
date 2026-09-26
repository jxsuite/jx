---
status: stub
disposition: implement
claims:
  - extensions.md#6.1
  - extensions.md#8.1
size: M
workspaces:
  - packages/schema
  - packages/compiler
  - packages/server
  - packages/studio
  - packages/desktop
---

# Hosts invoke a capability only where its declared timing allows, and the studio calls client capabilities in-process

## Context

`specs/extensions.md` §6.1, line 243:

> **Status: Partial.** Steps 2 to 4 ship in `buildExtensionRegistry` (`packages/schema/src/extension-registry.ts`) and `FormatEntry` (`packages/schema/src/format-registry.ts`). Step 1 diverges: hosts resolve `<specifier>/jx-extension.json` through the package's exports map, the rule §9.2 states, and never locate a manifest through the `"jx"` field, which only the catalogue reads, as the §9.2 hint (`declaresJxField`, `packages/server/src/extension-catalog.ts`). Step 5 is not built: no host reads a capability's `timing` (§8.1).

`specs/extensions.md` §8.1, line 331:

> **Status: Partial.** `timing` is parsed with its default (`DEFAULT_TIMING`, `packages/schema/src/format-registry.ts`) and forwarded to the studio (`packages/server/src/studio-api.ts`), but no host acts on it: the compiler and server import the implementation whatever a capability declares, and the studio round-trips every call through `formatAction` (`packages/studio/src/format/format-host.ts`), including the `"client"` capabilities `Markdown` and `Csv` declare.

Both sections were unmarked before the census. §6.1 step 5 and §8.1 are one contract stated twice, so they are one piece of work and one plan. §6.1 step 1 rides along because it shares the anchor: it is a one-sentence reconcile, since §9.2 ("Discovery follows the exports map, and `"jx"` is a hint") already states the rule the code follows. No host locates a manifest through `"jx"`: its two readers use it only as that hint, `declaresJxField` in `packages/server/src/extension-catalog.ts` (the catalogue's `problem` row for a package that declares `"jx"` but does not export the manifest, served by the dev server and desktop) and `scripts/check-extension-catalog.ts`.

**What exists**

- `CapabilityInfo.timing` with `DEFAULT_TIMING = ["compiler", "server"]` (`packages/schema/src/format-registry.ts`), tested in `packages/schema/tests/format-registry.test.ts`.
- The round-trip endpoints: `POST /__studio/format` (`packages/server/src/studio-api.ts`) and `POST /__jx_resolve__` (`packages/server/src/server.ts`); the per-format capability summary with `timing` that `listFormats` returns to the studio.
- `formatAction` on the dev-server and cloud platforms (`packages/studio/src/platforms/devserver.ts`, `packages/studio/src/platforms/cloud.ts`) and on desktop (`packages/desktop/src/platform.ts`, an RPC to `formatAction` in `packages/desktop/src/project-session.ts`, whose main-process handler calls `entry.call("parse" | "serialize")` directly and so is a node host that needs the same timing check as the server). The studio calls one of them for every parse and serialize.
- `"timing": ["compiler", "server", "client"]` on `parse` and `serialize` in `extensions/parser/src/Markdown.class.json`, and on `parse` and `rewrite` in `extensions/parser/src/Csv.class.json` (which declares no `serialize`, §8).
- `loadExtension` in `packages/schema/src/extension-registry.ts`, which resolves `<specifier>/jx-extension.json`.

**What is missing**

- Node hosts (compiler, server, desktop's main process) checking that their own environment is listed before importing an implementation, and a stated behaviour when it is not: the compiler has no dev server to delegate to, so the detail phase decides between an error and skipping.
- The studio calling a `"client"` capability in-process: loading the implementation module in the browser (how it is bundled or served, and on which platforms, since §8.5 already describes browser hosts that cannot execute extension code), and falling back to `formatAction` otherwise.
- §6.1 step 1 rewritten to the exports-map rule, with `"jx"` described as the hint §9.2 makes it.

**Related**

- extensions.md §8.5 (the host that cannot execute extension code), extensions.md §9.2 (discovery follows the exports map).
- studio.md §8.1 (format-class dispatch through `formatAction`).
- server.md §3.2 (`POST /__jx_resolve__`) and server.md §4.1 (the studio API endpoints).
