---
status: stub
disposition: reconcile
claims:
  - spec.md#12.1
  - spec.md#12.5
requires:
  - spec/request-url-params
size: S
---

# The built-in prototype table and the import-map resolution order describe the extension registry that ships

## Context

Both sections describe how a `$prototype` name resolves with no `$src`, and both describe it as it was before content classes moved into `@jxsuite/parser`'s extension manifest, so one reconcile covers both.

`specs/spec.md` §12.1, line 1311:

> **Status: Partial.** `Function`, `LocalStorage`, `SessionStorage` and `Request` resolve in the interpreter, except `Request`'s URL params (§11.1); their compiled lowering is §11.2's. The compile-time rows do not match the code: there is no `MarkdownFile` (the parser's manifest, `extensions/parser/jx-extension.json`, names it `Markdown`); `MarkdownCollection`, `ContentCollection` and `ContentEntry` resolve only through the extension registry, once `@jxsuite/parser` is listed in `project.json` `extensions` (`registryClassPath` in `packages/compiler/src/site/prototype-resolver.ts`); `Array` is a children-level node (§10), not a state prototype; and the runtime built-ins `URLSearchParams`, `Cookie`, `IndexedDB`, `Set`, `Map`, `FormData`, `Blob` and `ReadableStream` (§11.2) are missing from the table.

`specs/spec.md` §12.5, line 1455:

> **Status: Partial.** The import-map rules ship. Two statements do not match the code: imports cascade from `project.json` (`packages/site/src/context.ts`), not `site.json`, and the last step before the unknown-prototype warning is the extension registry's manifest classes, present only for extensions listed in `project.json` `extensions`, not built-in mappings (§12.1).

The census also removed a false sentence from §12.5's trailing Implemented marker ("Built-in prototype mappings (`MarkdownFile`, `MarkdownCollection`) resolve at compile time without imports").

**What exists**

- `resolvePrototype` and `resolveFunction` in `packages/runtime/src/runtime.ts` (the client built-ins); `packages/compiler/src/site/prototype-resolver.ts` (`doc.imports`, then `registryClassPath`); `buildExtensionRegistry` in `packages/schema/src/extension-registry.ts`, fed by the `project.json` `extensions` list.
- `extensions/parser/jx-extension.json` (`Markdown`, `Csv`, `MarkdownCollection`, `ContentCollection`, `ContentEntry`, `Content`).
- `injectContext` in `packages/site/src/context.ts` merges project `imports` into page `imports`, the page winning.

**What is missing**

- §12.1 rewritten to the client built-ins actually handled (the §11.2 set plus `Function`), with the compile-time content classes described as extension classes and pointed at `parser.md` §3 and §6 and `extensions.md` §6; the `MarkdownFile` example and the `@jxsuite/parser/MarkdownFile.class.json` path corrected.
- Not the `Request` row. Its "HTTP fetch with reactive URL params" is `plan:spec/request-url-params`'s phrase: that plan's `implement` default keeps it, and only its fallback rewords it. The row therefore waits on that plan, and this plan requires it.
  - That plan also removes "except `Request`'s URL params (§11.1)" from §12.1's marker when it lands. What is left of the marker is this plan's to close.
  - This reconcile keeps the row's description exactly as that plan leaves it, even if the table is restructured around it.
  - The rest of this rewrite does not depend on `urlParams`. If the wait matters, detailing can land it early as a slice that leaves §12.1's marker naming only what is still open. §12.1 flips after `plan:spec/request-url-params` lands.
- §12.5's cascading row (`project.json`) and resolution order (extension registry) corrected.
- §5.3 4e's `MarkdownCollection` example gains the `extensions` prerequisite.
- Disposition `reconcile`: the extension architecture is deliberate (`extensions.md` §6), so the spec follows the code.

**Related**

- `parser.md` §3, §6; `extensions.md` §6; §5.3 4e; §11.1 and the `Request` row (`plan:spec/request-url-params`); §11.2; `docs/framework/concepts/data-prototypes.md`.
