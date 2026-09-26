---
status: stub
disposition: implement
claims:
  - schema.md#3.4
  - schema.md#3.5
size: M
workspaces:
  - packages/schema
  - packages/studio
  - packages/compiler
  - packages/site
  - packages/server
  - packages/runtime
---

# The I-JSON and NFC parse boundary judges every number literal, and every reader of a Jx document crosses it, Studio and jx validate included

## Context

`specs/schema.md` §3.4, line 157:

> **Status: Partial.** `parse.ts` enforces `ijson.ts` wherever the compiler, `packages/site` and the server's class resolution call `parseJxDocument`, `parseProjectConfig` or `parseClassDef`, but `isSafeJsonNumber` exempts every literal with an exponent as well as every fraction, so an integer written `1e400` passes as `Infinity` and is written back as `null`. Other readers bypass the boundary with a bare `JSON.parse`: Studio's tab-open path (`parseJsonDocument`, `packages/schema/src/json-layout.ts`), its layout resolver (`packages/studio/src/site-context.ts`) and its `project.json` reads; `jx validate` (`packages/compiler/src/site/validate-command.ts`, `packages/schema/src/validate-project.ts`) for `project.json`, pages, components, layouts and class definitions; and `packages/site`'s `project.json` read. On those paths a repeated name is dropped silently and an unsafe integer is rounded.

`specs/schema.md` §3.5, line 172:

> **Status: Partial.** `parse.ts` puts every key and every string value into NFC for its callers (the compiler, `packages/site`'s documents, the server's class resolution). The readers §3.4's marker names as bypassing it apply no normalization, Studio's `parseJsonDocument` and layout resolver and `jx validate` among them, so a declaration and a reference typed in different forms still resolve to nothing in Studio's canvas and collab room, although the build joins them.

Both markers read Implemented before the census. They were true of `parse.ts`'s duplicate-name check and its NFC pass, and not of its number check or of the platform: §3.4's own prose names the Yjs crossing (`collab.md`) as the reason the boundary matters, and Studio's open path, which seeds that crossing, never reaches `parse.ts`. One stub owns both because they are one piece of work: the two checks live in the same crossing (`parseObject` in `parse.ts` runs `findIJsonProblems`, then `normalizeIdentifiers`), so routing a reader through it closes both at once, and splitting them would touch every caller twice. Disposition `implement`: the spec's intent is right and the code is what lags.

**What exists**

- `packages/schema/src/ijson.ts` (`findIJsonProblems`, `isSafeJsonNumber`, `describeIJsonProblem`) and `packages/schema/src/parse.ts` (`parseJxDocument`, `parseProjectConfig`, `parseClassDef`, the private `normalizeIdentifiers`), covered by `packages/schema/tests/ijson.test.ts` and `packages/schema/tests/parse.test.ts`. The duplicate-name check and a plain integer literal (`9007199254740993` throws) work as §3.4 says; the exponent exemption below does not.
- The callers that do cross it: `packages/compiler/src/compiler.ts`, `packages/compiler/src/targets/compile-element.ts`, `packages/compiler/src/site/site-loader.ts`, `layout-resolver.ts`, `prototype-resolver.ts`, `pages-discovery.ts`, `packages/site/src/compose.ts` (documents only, line 87), and `packages/server/src/resolve.ts` (`parseClassDef` only).
- `parseJsonDocument` in `packages/schema/src/json-layout.ts`: `JSON.parse(text)` plus `deriveJsonLayout(text)`, whose scanner assumes the text is already known to be well-formed.

**What is missing**

- The number check inside the boundary. `isSafeJsonNumber` (`packages/schema/src/ijson.ts` line 185) returns `true` for any literal matching `/[.eE]/`, so an exponent-form integer is never judged: `1e400` (RFC 7493 §2.2's own example) parses to `Infinity` and serializes as `null`, and `12345678901234567890e0` is rounded to `12345678901234567000`, both with no error. `packages/schema/tests/ijson.test.ts` locks the exemption (lines 128 to 131, `1e400`, and 156 to 158, `1e999`). §3.4 exempts only fractions and §7's RFC 7493 note calls "integers a double cannot hold" parse failures. The implement direction: judge an exponent-form literal whose value is non-finite, or is an integer the double does not hold exactly, and replace the two tests. The alternative, reconciling §3.4 and §7 to exempt exponent literals, would keep a value that becomes `null` on the next save, which §3.4 calls silent data loss.
- Studio's tab-open path. `parseJsonDocument` is called from `packages/studio/src/files/files.ts` (lines 2384 and 2471), `studio.ts` (1126), `files/file-ops.ts` (109 and 155), `tabs/project-config.ts` (170), `format/convert-file.ts` (387) and `canvas/canvas-render.ts` (852). A duplicate key is dropped on open, the lossy tree seeds the collab room and is written back by the layout-preserving save. Two decisions: enforce inside `parseJsonDocument` (one place, but it becomes a throwing parse whose failure every caller must report) or have Studio cross `parse.ts` first; and what a save writes when NFC changed a string the author never edited (the layout serializer would write the composed form, a diff nobody asked for).
- Studio's other readers, which hardening `parseJsonDocument` alone would miss:
  - `resolveLayoutDoc` in `packages/studio/src/site-context.ts` (line 199, `JSON.parse(content)`), which feeds the canvas (`canvas/canvas-live-render.ts` line 183) and the head panel (`panels/head-panel.ts` line 736). A layout typed in NFD would still resolve to nothing in the canvas, which is §3.5's own named consequence.
  - `project.json` on a project switch (`studio.ts` line 1352) and in the dev-server platform's folder pick (`platforms/devserver.ts` line 210).
  - The library preview (`browse/library-preview.ts` line 131) and the conversion input (`format/convert-file.ts` line 82, `readDocument`), each for a plain JSON document.
- `jx validate`. `packages/compiler/src/site/validate-command.ts` reads `.class.json` files for the overlay scope (line 183, inside `walkClassFiles(root).flatMap`), components, pages and layouts (line 196, `DOCUMENT_DIRS`) and `.class.json` files for the class-schema pass (line 212) with bare `JSON.parse`, and its `project.json` step goes through `validateProjectFile` (`packages/schema/src/validate-project.ts` line 65), also bare. An I-JSON problem should be a reported issue naming the file, and the validator should judge the NFC value the build will see.
- The other bare readers of the same files, for the detail phase to decide on:
  - `readProjectConfig` in `packages/site/src/compose.ts` (line 99), used by the server's live preview (`packages/server/src/live-preview.ts` line 202) and `packages/site/src/serve.ts` (line 61).
  - The compiler's format host, `loadJson` in `packages/compiler/src/site/format-host.ts` (line 56), through which class definitions are read by `packages/schema/src/format-registry.ts` (line 359) and `extension-registry.ts` (line 266).
  - `project.json` in `packages/server/src/resolve.ts` (90), `studio-api.ts` (120, 422, 465), `data-api.ts` (107) and `jx-mounts.ts` (108).
  - The runtime's document and class fetches (`packages/runtime/src/runtime.ts` lines 317 and 3169, `res.json()`).

  The detail phase decides which of these are "the parse boundary" and states the ones it leaves out, the way §7's UAX #31 row already exempts a format extension's own `parse`.

- Tests: an exponent-form fixture through `parse.ts`, and a duplicate-key fixture and a decomposed-identifier fixture through Studio's open path, its layout resolver and `jx validate`.

**Related**

- studio.md §9.4 (the layout-preserving save every Studio reader shares).
- collab.md §3 (seeding the room from the parsed document).
- extensions.md §5.4 (what `jx validate` checks).
- schema.md §7 (the RFC 7493 and UAX #31 rows, whose notes hold for the whole platform once this lands).
