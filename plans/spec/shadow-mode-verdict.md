---
status: drafted
disposition: implement
claims: []
requires: []
workspaces:
  - packages/runtime
  - packages/compiler
  - docs
size: S
---

# The shadow-mode verdict lives in `@jxsuite/runtime/css`, so a browser-side caller reads it without the compiler

## Context

This plan claims nothing. It is the first bullet of `plan:spec/shadow-dom-parity#SDP1.2`, split out under `plans/README.md`'s rule that a plan is split when a dependent needs only part of it. Two plans need the verdict where a browser can import it:

- `plan:spec/shadow-dom-parity` (spec.md §16.6) reads it in the interpreter: SDP1.3 resolves a component's mode at connection with `resolveShadowMode(def, { shadow: _shadowDefault })`, and SDP1.4's `composePage` reads it in `packages/site`. That plan requires this one.
- `plan:studio/cem-contract-editors` (studio.md §6.5) offers CSS parts only to a component whose `resolveShadowMode(doc, projectConfig.defaults)` is not `null`, and Studio does not depend on `@jxsuite/compiler`. Its own Decisions say that only this move is needed, and that the whole of `plan:spec/shadow-dom-parity` (four slices behind `plan:spec/compiled-slot-distribution` and `plan:compiler/element-binding-table`) is otherwise what it waits for.

**What exists** (verified against the working tree on 2026-09-27):

- `packages/compiler/src/shadow.ts` holds `ShadowMode`, `ShadowSetting`, a private `asSetting`, `resolveShadowMode(doc, defaults)` and `styleScopePrefix(tagName, shadow)`. Its module comment carries `@docs framework/concepts/components`, and `docs/framework/concepts/components.md` lists the file in `code:`.
- Callers: `packages/compiler/src/targets/compile-element.ts`, `packages/compiler/src/shared.ts` and `packages/compiler/src/site/site-build.ts`, each importing from `../shadow` or `./shadow`. `packages/compiler/tests/shadow-dom.test.ts` imports both functions from `../src/shadow` and holds `resolveShadowMode`'s four cases.
- `@jxsuite/runtime/css` is already a package export (`"./css": "./src/css.ts"` in `packages/runtime/package.json`), and `runtime.ts` re-exports its names in one block (the `export { buildStyleRules, … } from "./css.ts"` near the end of the file). `css.ts` already imports types from `@jxsuite/schema/types`.

## Outcome

- No claim changes status. spec.md §16.6's marker cites `packages/compiler/src/shadow.ts` for what the compiler ships, and that file still exports the verdict, so no spec sentence changes.
- `resolveShadowMode`, `ShadowMode` and `ShadowSetting` are defined in `packages/runtime/src/css.ts` and exported from `@jxsuite/runtime/css` and `@jxsuite/runtime`. `packages/compiler/src/shadow.ts` re-exports them and keeps `styleScopePrefix`, which only the compiler uses.

## Decisions

- **Decided:** the move is verbatim: same names, same signature, same rule, no behaviour change. The verdict is one rule both tiers apply, and the audit record's spec-wide decision puts such a rule in one runtime export; a stylesheet-free function needs no inlining into generated modules.
- **Decided:** `packages/compiler/src/shadow.ts` re-exports rather than every caller being repointed, so the three compiler imports, `plan:spec/cem-manifest-export`'s site-build call and every plan citation of that file stay valid. `styleScopePrefix` stays there: it is the compiler's choice of CSS scope for a component sheet, and nothing outside the compiler reads it.
- **Decided:** the four `resolveShadowMode` cases are copied into the runtime's own suite, because coverage is enforced per workspace and the function's lines now belong to `packages/runtime`. The compiler's cases stay unchanged and now pin the re-export.
- **Decided:** the moved function keeps its `@docs framework/concepts/components` tag, on its own JSDoc (as `css.ts` tags each function), so `components.md` lists `css.ts` in `code:` beside `shadow.ts`.

## Implementation

1. **`packages/runtime/src/css.ts`**: add `ShadowMode`, `ShadowSetting`, the private `asSetting` and `resolveShadowMode`, moved verbatim from `packages/compiler/src/shadow.ts` with their JSDoc. `resolveShadowMode`'s JSDoc gains the module comment's two paragraphs on light DOM being the default and on the two modes, and `@docs framework/concepts/components`. Extend the existing `import type` from `@jxsuite/schema/types` with `JxDocument`, `JxElement` and `ProjectConfig`.
2. **`packages/runtime/src/runtime.ts`**: add `resolveShadowMode` to the `export { … } from "./css.ts"` block and `ShadowMode`, `ShadowSetting` to the `export type { … } from "./css.ts"` line.
3. **`packages/compiler/src/shadow.ts`**: replace the three definitions and `asSetting` with `export { resolveShadowMode, type ShadowMode, type ShadowSetting } from "@jxsuite/runtime/css";` and an `import type { ShadowMode } from "@jxsuite/runtime/css";` for `styleScopePrefix`. The module comment keeps its text and its `@docs` tag, and gains one sentence: the verdict is the runtime's (`@jxsuite/runtime/css`), re-exported here for the compiler's callers.

**Integration contract.** Once this lands, `@jxsuite/runtime/css` and `@jxsuite/runtime` export `resolveShadowMode(doc, defaults)`, `ShadowMode` and `ShadowSetting`, and a browser-side caller (Studio, the interpreter, `packages/site`) imports them from there. `packages/compiler/src/shadow.ts` still exports all three, plus `styleScopePrefix`. `plan:spec/shadow-dom-parity`'s SDP1.2 starts from the function already in `css.ts` and adds `resolveHostKey` beside it; `plan:studio/cem-contract-editors` needs nothing else from that plan.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime` and from `packages/compiler`, then `bun scripts/check-coverage-manifest.ts packages/runtime` and `bun scripts/check-coverage-manifest.ts packages/compiler`. No source file is added. The per-file bars are `lines = 0.963, functions = 0.98` (`packages/runtime/bunfig.toml`) and `lines = 0.982, functions = 0.98` (`packages/compiler/bunfig.toml`); ratchet a workspace only if its worst file rises.

- **`packages/runtime/tests/css.test.ts`**, new `describe("resolveShadowMode (spec.md §16.6)")`, the four cases of the compiler's `describe("resolveShadowMode")` copied: "light DOM unless something says otherwise", "a project default turns it on for every component", the own-setting-wins case in both directions (`$shadow: "closed"` over an `"open"` default, `$shadow: false` over an `"open"` default), and "a value that is not a mode is ignored rather than guessed at".
- **`packages/compiler/tests/shadow-dom.test.ts`**: unchanged. Its import from `../src/shadow` now goes through the re-export, which is the pin that the compiler's callers see the same function.

## Specs & docs

- No spec edit and no fragment: no behaviour changes and no spec sentence becomes false (spec.md §16.6's marker names `packages/compiler/src/shadow.ts`, which still exports the verdict). `bun run docs:spec-release` has nothing to check.
- `docs/framework/concepts/components.md` (`spec: spec.md#16.6`): add `packages/runtime/src/css.ts` to `code:`, since the moved function carries the page's `@docs` tag. No text change: the page describes `$shadow` and `defaults.shadow`, which behave as before.
- `bun run docs:sync` also names the pages whose `code:` lists `css.ts` or `runtime.ts` (`styling.md`, `overlays.md`, `color-schemes.md`, `reactivity.md`, `elements.md` and the others). None describes where the shadow verdict is computed, so the pull request states that no update is needed.

Landing deletes this file and removes `spec/shadow-mode-verdict` from `plan:spec/shadow-dom-parity`'s `requires` (and from `plan:studio/cem-contract-editors`' if it was repointed here).

## Acceptance

- `git grep -n "export function resolveShadowMode" -- packages` prints only `packages/runtime/src/css.ts`.
- `bun -e 'import { resolveShadowMode } from "./packages/runtime/src/css.ts"; console.log(resolveShadowMode({ $shadow: false }, { shadow: "open" }), resolveShadowMode({}, { shadow: "closed" }))'` prints `null closed`.
- `bun test --isolate --coverage` passes in `packages/runtime` and `packages/compiler` at their thresholds, and both manifest checks pass.
- `bun run docs:check`, `bun run docs:links` and `bun run plans:check` pass.
