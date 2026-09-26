---
status: stub
disposition: reconcile
claims:
  - compiler.md#2
  - compiler.md#5.2
  - compiler.md#5.3
  - compiler.md#5.6
size: S
---

# The class-document sections describe the format and the route that ship

## Context

Three sections describe one contract, the `.class.json` document the compiler accepts, and all three describe an older shape; §2's route table repeats §5.6's detection rule. They share one decision (restate `schema.md` §3.3 correctly, or defer to it), so one stub claims all four. Disposition `reconcile`: the code, the class schema and every shipped class document agree with each other, and only this spec disagrees with them.

`specs/compiler.md` §2, line 24 (unmarked before the census; the route-0 status cell stays `**Implemented**`, because the route itself ships):

> **Status: Partial.** Route 0's condition is not the file extension: `compile()` in `packages/compiler/src/compiler.ts` takes route 0 on `isClassDef(raw)`, which is exactly `$prototype === "Class"` (`packages/schema/src/guards.ts`), whatever the file is called (§5.6).

`specs/compiler.md` §5.2, line 298:

> **Status: Partial.** The example below would neither validate nor compile. The class schema (`classDefSchema` in `packages/schema/defs/class-def.schema.ts`, published as `https://jxsuite.com/schema/class/v1`) requires `$prototype: "Class"` and `title`, and `compileClassJson` takes the class name from `title` and throws without it; a method carries `role`, `access`, `scope`, `identifier` and a `parameters` array, and is async when its `returnType` names a `Promise` or its body awaits, not through an `async` key (`extensions/connector/src/D1.class.json` is a shipped document).

`specs/compiler.md` §5.3, line 339:

> **Status: Partial.** The table does not match `class-def.schema.ts` or `compile-class.ts`: a field is private through `access: "private"`, not a `#`-prefixed key; an accessor is `role: "accessor"` with `getter`/`setter` objects, not a `get`/`set` prefix or `accessor: true`; `parameters` holds reusable typed parameter schemas that a method's parameters reference by `$ref` (`resolveParams`), not constructor config fields; and `constructor` takes `superCall.arguments` beside `body`.

`specs/compiler.md` §5.6, line 374 (its trailing `Implemented` marker, which describes the compilation, stays):

> **Status: Partial.** Neither condition below routes a document: route 0 is taken on `isClassDef(raw)` in `packages/compiler/src/compiler.ts`, which is exactly `$prototype === "Class"` (`packages/schema/src/guards.ts`). A `.class.json` file without that key, or a root whose `$defs` has `constructor`, `methods` or `fields` and no `tagName`, falls through to the static, element or client route; §2's route-0 condition has the same drift.

**What exists**

- `packages/schema/defs/class-def.schema.ts` (`classDefSchema`, `ClassFieldDef`, `ClassMethodDef`, `ClassConstructorDef`, `ClassParameterDef`) and the generated `class-schema.json` (`$id` `https://jxsuite.com/schema/class/v1`, from `packages/schema/src/schema.ts`).
- `compileClassJson` in `packages/compiler/src/targets/compile-class.ts`: class name from `title`; `access`, `scope` and `identifier` on fields and methods; `role: "accessor"` with `getter`/`setter`; async from `returnType` or `isMethodAsync` (an `await ` in the body); `superCall.arguments`.
- `isClassDef` in `packages/schema/src/guards.ts`; route 0 in `compile()` (`packages/compiler/src/compiler.ts`).
- Shipped documents: `extensions/connector/src/D1.class.json`, `extensions/parser/src/*.class.json`, `extensions/auth/src/*.class.json`; `packages/compiler/tests/compile-class.test.ts`.

**What is missing**

- §5.2's example replaced by a document that validates against `class-schema.json` and compiles.
- §5.3's table rewritten to the categories as `class-def.schema.ts` defines them.
- §5.6's detection rule stated as `$prototype: "Class"`, and §2's route-0 condition cell ("Input is `.class.json`") changed with it; both markers then go.
- The detail phase decides whether §5.2 and §5.3 keep a restatement or point at `schema.md` §3.3, the class schema's own section, and records the release level (minor, per the program's table for a `reconcile`).

**Related**

- `schema.md` §3.3 (the class schema); `spec.md` §12.4 (`.class.json` schema-defined classes); `extensions.md` §6 and §7 (the admission and `format` blocks a class document also carries).
- `plan:compiler/client-external-class-hydration`, which compiles or imports such a class for the browser.
