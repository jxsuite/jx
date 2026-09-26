---
status: stub
disposition: implement
claims:
  - extensions.md#5.4
size: S
workspaces:
  - sites/jxsuite.com
---

# Every canonical schema URL the shipped defaults reference is served from jxsuite.com

## Context

`specs/extensions.md` §5.4, line 194:

> **Status: Partial.** Offline resolution of the committed entry documents, host-first resolution of first-party refs and whole-tree `jx validate` ship (`packages/compiler/src/site/schema-command.ts`, `packages/compiler/src/site/validate-command.ts`). The canonical URLs are not all served: the `copy` map in `sites/jxsuite.com/project.json` publishes `schema/v1`, `schema/project/v1`, `schema/class/v1` and `schema/document/paths/v2`, but not `https://jxsuite.com/schema/project/core/v2` or the `https://jxsuite.com/schema/project/fields/v2` default union, so a client fetching either gets a 404 rather than the shipped default.

The section was unmarked before the census. Its last bullet promises that a client fetching the canonical URLs "gets the shipped defaults", which is what makes the §5.3 degradation (under-suggestion, never false errors) true for a client that does not have the entry documents. The parser and connector project fragments write `{ "$ref": "https://jxsuite.com/schema/project/fields/v2" }` at their field positions, so the unserved fields URL is the one such a client meets first.

**What exists**

- The shipped defaults: `packages/schema/schemas/project.core.schema.json` (`$id` `https://jxsuite.com/schema/project/core/v2`), `packages/schema/schemas/project.fields.schema.json` (`$id` `https://jxsuite.com/schema/project/fields/v2`) and `packages/schema/schemas/document.paths.schema.json`.
- The `copy` map in `sites/jxsuite.com/project.json`, which already publishes four artifacts at `schema/<path>/index.json` beside their `$id`s.
- Everything else in §5.4: `readBundledProjectSchemas` and `restrictedSchemaLoader` in `packages/compiler/src/site/schema-command.ts`, the whole-tree walk and residual-relative-`$ref` check in `packages/compiler/src/site/validate-command.ts`, and the by-id registration of `file:///project.schema.json` and `file:///document.schema.json` in `packages/studio/src/services/monaco-setup.ts`.

**What is missing**

- Two `copy` entries, `schema/project/core/v2/index.json` and `schema/project/fields/v2/index.json`, and a check that holds every `$id` under `https://jxsuite.com/schema/` a shipped default or first-party fragment references to a published path, so the next union resource cannot ship unserved. The extension fragments' own `$id`s (`https://jxsuite.com/schema/ext/...`) are a naming convention that nothing resolves (§5.1); the detail phase decides whether the check covers them.
- Rides along, spec-only: the §4 key table lists `schemas.project` and `schemas.document` but not `schemas.fields`, which `packages/schema/defs/extension-manifest.schema.ts`, `loadExtension` (`packages/schema/src/extension-registry.ts`) and `composeProjectSchemas` (`packages/schema/src/project-schemas.ts`) all accept, and whose `$defs` members are unioned into the fields resource this plan publishes. No first-party extension ships one yet.
- Rides along, spec-only: §5.3's fields row says the entry "adds extension field extras (e.g. connector column shapes)", but no extension contributes extras. No `extensions/*/jx-extension.json` declares `schemas.fields`, `composeProjectSchemas` adds extras only from one (`ext.fields`, `packages/schema/src/project-schemas.ts`), and a connector project's generated union (`scripts/screenshots/fixtures/data/project.schema.json`, `$defs.Fields.anyOf`) holds only `JxFieldSchema` and `RelationshipRef`. The example is struck, or the row says no first-party extension contributes extras yet.

**Related**

- extensions.md §4 (the manifest's `schemas` key), extensions.md §5.1 (fragment `$id` convention), extensions.md §5.3 (the two union resources and their degradation).
- schema.md §5 (the `$id`s of the core artifacts).
