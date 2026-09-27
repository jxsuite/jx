---
status: drafted
disposition: implement
claims:
  - spec.md#4e
  - spec.md#11.1
requires:
  - spec/compiled-request-fetch
workspaces:
  - packages/runtime
  - packages/compiler
  - packages/schema
  - examples
  - packages/starters
  - packages/studio
  - packages/ui
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
  - specs
  - docs
size: M
---

# A `Request`'s `urlParams` becomes its query string in both tiers, and a change to any value it reads re-fetches

## Context

Two sections carry the same `Request` example with the same unread field, so one plan claims both.

`specs/spec.md` §5.3 4e, line 454:

> **Status: Partial.** The `Request` example's `urlParams` field is read by nothing (§11.1): the runtime's `Request` case, `ExternalClassDef` and the compiled `emitRequestFetch` (`packages/compiler/src/shared.ts`) all ignore it, so the entry fetches `/api/users/` once and never re-fetches when `userId` changes.

`specs/spec.md` §11.1, line 1173:

> **Status: Partial.** `$prototype` dispatch ships (`resolvePrototype` in `packages/runtime/src/runtime.ts`). The example's `urlParams` field is read by nothing: the runtime's `Request` case reads only `url`, `method`, `headers`, `body`, `debounce` and `manual`, `ExternalClassDef` does not declare it, and the compiled `emitRequestFetch` (`packages/compiler/src/shared.ts`) ignores it, so a `Request` re-fetches reactively only through a `${…}` template in `url`.

Re-verified against `84735a9f` on 2026-09-27.

**What exists**

- **Runtime.** The `Request` case of `resolvePrototype` (`packages/runtime/src/runtime.ts:2823`) builds `url` inside an `effect()`: `evaluateTemplate` for a template, the literal otherwise, then the guard `!url || url === "undefined" || url.includes("undefined")`. `debounce`, `manual`, `skipAutoRequests` and an `AbortController` cleared by `onEffectCleanup` all ship.
- **The precedent for the values.** The `URLSearchParams` case beside it (line 2878) already resolves each key as a `$ref` (`resolveRef`), a template (`evaluateTemplate`) or a literal inside a `computed`, and returns `new URLSearchParams(p).toString()`.
- **Compiler.** `emitRequestFetch` (`packages/compiler/src/shared.ts:155`), shared by the client target (`compile-client.ts:219`) and the element target (`compile-element.ts:745`, `statePrefix: "this.state"`). `plan:spec/compiled-request-fetch` (drafted, required here) adds `debounce` and abort, and its integration contract fixes where a re-triggering read goes: between `const url` and `const _ac`, never inside the timer.
- **Schema.** `externalClassDefSchema` (`packages/schema/defs/external-class-def.schema.ts`) is open and declares no `urlParams`, so the field validates without a shape. `JxPrototypeDef` (`packages/schema/types.ts`) types `url` as `string` and has no `urlParams`.
- **Where the field is promised:** §11.1's example, §5.3 4e's example, §12.1's `Request` row ("HTTP fetch with reactive URL params"), `docs/framework/concepts/data-prototypes.md` (the opening example, the `Request` bullet, and "a `Request` whose `urlParams` reference state re-fetches"), and `specs/schema.md` §3.1's Built-in Prototypes list (`Request` — …, urlParams, timing).

**What the census missed**

- **The example cannot be read as written.** `"urlParams": { "$ref": "#/state/userId" }` binds the whole field to a scalar. No query-string reading serializes a bare `42` meaningfully (`new URLSearchParams("42")` is `42=`), so both examples change whichever disposition is signed.
- **`url` as a `$ref` is admitted and broken.** The schema declares `url: { $ref: "#/$defs/StringOrRef" }` (line 133). The runtime destructures it into a string-typed local and calls `url.includes(...)` on the object, which throws. The compiled target emits `const url = {"$ref":…};` and fetches `[object Object]`.
- **Studio does not edit it.** The Data panel's `Request` fields are URL, method and timing only (`dataFields` in `packages/studio/src/panels/signals-panel.ts`), with no headers, body or debounce either.

**Related**

- §11.2: the compiled `Request`'s debounce and abort (`plan:spec/compiled-request-fetch`); the `URLSearchParams` row and its compiled lowering (`plan:spec/web-api-prototype-parity`).
- §12.1: this plan owns the `Request` row's phrase, and `plan:spec/reconcile-built-in-prototypes` owns the section. That plan requires this one and leaves the row's wording as this plan leaves it.
- `schema.md` §3.1: `plan:schema/generator-inventory` requires this plan and keeps or drops `urlParams` on the `Request` line accordingly. `plan:schema/prototype-property-declarations` narrows the same marker for other names; the two plans have no edge, and the marker edit below is written for either landing order.

## Outcome

- **spec.md §5.3 4e → Implemented.** The example uses the map form.
- **spec.md §11.1 → Implemented.** The section defines `urlParams` (both forms, the value rules, the serialization, re-fetching) and says `url` may be a `$ref`. Both tiers build the URL through one rule, `requestUrl`, which the runtime calls and compiled modules inline, held equal by a test.
- **spec.md §12.1.** The marker no longer says "except `Request`'s URL params (§11.1)", and the `Request` row keeps "HTTP fetch with reactive URL params". The section stays Partial and stays `plan:spec/reconcile-built-in-prototypes`'s to close.
- **spec.md §11.2.** The debounce-and-abort paragraph that `plan:spec/compiled-request-fetch` adds names `urlParams` among the reads that re-fetch.
- **schema.md §3.1.** `ExternalClassDef` declares `urlParams` for `$prototype: "Request"` alone, and the marker stops naming it. The marker stays Partial.
- **In a built site and in the interpreter:** a `Request` with `urlParams` fetches `url?…` and re-fetches, debounced and aborting the fetch it replaces, whenever a value it reads changes. A `Request` without `urlParams` and without a `$ref` `url` compiles to the text it compiles to once `plan:spec/compiled-request-fetch` has landed.

## Decisions

- **Open:** keep `urlParams` (`implement`), or reconcile every example to a `${…}` template in `url`? Recommendation: implement.
  - A template does not encode. `?q=${state.q}` sends a typed `&`, `#` or `=` raw and splits the query, and a template cannot drop an optional parameter: it sends `sort=null`.
  - `urlParams` encodes by construction (`URLSearchParams`) and leaves out a `null`. It costs one small pure function and its inlined copy.
  - Five places document it, and §12.1's row advertises it.
  - Fallback if signed the other way: this becomes a `reconcile` with a `major` fragment, because authors were told the field works. §11.1 and §5.3 4e use `"url": "/api/users?id=${state.userId}"`. The field is struck from schema.md §3.1's `Request` line, data-prototypes.md and §12.1's row ("HTTP fetch with a reactive URL"). No code changes, and `workspaces` shrinks to `specs` and `docs`.
- **Open:** what does a missing value do? Recommendation: `undefined` holds the fetch, `null` leaves the parameter out, and every other value is sent.
  - `undefined` is Jx's existing "not ready" signal: a `url` that interpolates `undefined` is not fetched in either tier today. It is what a `$ref` to an entry or a prop not yet set resolves to.
  - `null` is a value an author writes on purpose. Dropping it is §8.3's rule that nothing is an attribute the element does not have, applied to the query, and it is what makes an optional filter expressible.
  - Holding on `null` too would leave no spelling for "no filter". Dropping both would fetch the unfiltered list before the key arrives, which is exactly the fetch the example's author did not want.
- **Decided:** `urlParams` takes two forms. Any other shape is refused by the schema, a string literal included.
  - **A map** from parameter names to values. Each value is a literal (a string, number, boolean, `null`, or an array of scalars), a `$ref`, or a `${…}` template.
  - **A single `$ref`**, whose value is an object read as a map or a string read as a query string.

  Reasons:
  - `filter` and `sort` on the same definition already take "a reactive `$ref` binding, or an object".
  - The string branch is what lets a `URLSearchParams` entry (§11.2, a computed query string) feed a `Request`.
  - A whole-`$ref` read as a map would instead send a parameter literally named `$ref`.

- **Decided:** a template value that is one expression end to end keeps its value's type (`isSingleExpression`, as `evaluateAttrTemplate` does for §8.3), and any other template is text. So `"${state.q}"` and `{ "$ref": "#/state/q" }` send the same parameter, and the `undefined` rule applies to both. A mixed template such as `"id-${state.x}"` is sent as written.
- **Decided:** serialization is `URLSearchParams`'s. That is form encoding (a space becomes `+`), the same encoding §11.2's `URLSearchParams` prototype uses.
  - Parameters go in key order. An array appends its parameter once per item, which is the only list form `URLSearchParams` has. Any other value becomes `String(value)`.
  - The query joins an existing one with `&`, or with nothing after a trailing `?` or `&`, or starts one with `?`. It is inserted before a `#` fragment. An empty query leaves `url` untouched.
  - A name `url` already carries is appended, not replaced. Replacing would need `url` parsed with a base, and a relative `url` has none in a module.
- **Decided:** `url` resolves a `$ref` in both tiers through the same code. The schema has admitted it all along, and both tiers break on it today (see Context). A `url` template stays text through `evaluateTemplate`, unchanged.
- **Decided:** one rule serves both tiers.
  - `requestUrl(url, params)` lives in a new `packages/runtime/src/request-url.ts` and is re-exported from `@jxsuite/runtime`.
  - The compiled targets inline a copy: `requestUrlHelperSource()` in `packages/compiler/src/shared.ts`, emitted beside `attrHelperSource()`.
  - A behavioural drift test holds the copy to `requestUrl` by comparing outputs.

  This is the spec-wide rule in `plans/spec/README.md`, in the shape `plan:spec/compiled-cookie-attributes` chose. The code string lives in the compiler, so `dist/runtime.js` does not carry text it never runs. Outputs are compared rather than source text, because a changed branch would otherwise pass.

- **Decided:** the schema declares `urlParams` in an `allOf` entry, `if` `$prototype` is `"Request"` `then` the property. Only `Request` reads it, and a flat declaration would constrain an extension class's parameter of the same name, which is the `filter`/`sort` trap schema.md §3.1 records. `plan:schema/prototype-property-declarations` introduces the same `allOf` for `FormData` and `Blob`. Whichever lands second appends to the other's array, and neither requires the other.
- **Decided:** Studio's Data panel gains no `urlParams` field. It edits URL, method and timing and none of a `Request`'s other options, and `docs/studio/logic/data-sources.md` documents exactly those three. A map is edited in the source view.
- **Decided:** the only prerequisite is `plan:spec/compiled-request-fetch`.
  - That plan fixes the effect this one extends. Without it a compiled `urlParams` change would start one racing fetch per keystroke, and its §11.2 paragraph is the one this plan amends.
  - No edge to `plan:spec/web-api-prototype-parity`. A whole-`$ref` to a `URLSearchParams` entry reads the literal definition object in compiled output until that plan lowers the prototype, but §11.2's marker already discloses that gap, and nothing in this plan's text or code waits on it.
  - No edge to `plan:spec/timing-values-in-built-sites`. The integration contract below tells it which function to call.

## Implementation

1. **`packages/runtime/src/request-url.ts`** (new). It exports `requestUrl(url: unknown, params: unknown): string | undefined`, where `undefined` means "do not fetch". In order:
   - `url` that is not a string, is `""`, or `includes("undefined")` returns `undefined`. This is today's guard, moved here unchanged.
   - `params === undefined` returns `undefined`.
   - A string `params` is read with `new URLSearchParams(params)` (a leading `?` is dropped) and each pair is appended. An object `params` is walked with `Object.entries`: for each item of `Array.isArray(v) ? v : [v]`, `undefined` returns `undefined`, `null` is skipped, and anything else is appended as `String(item)`. `null` and any other type add nothing.
   - Join the query as the Decisions state.

   The header comment carries `@docs framework/concepts/data-prototypes` and one paragraph saying the compiled targets inline a copy that a compiler test holds to this function.

2. **`packages/runtime/src/runtime.ts`**:
   - Import `requestUrl` and re-export it (`export { requestUrl } from "./request-url.ts";`, beside the `./css.ts` re-exports).
   - Add two private helpers above `resolvePrototype`. `requestValue(v, state)` returns `resolveRef(v.$ref, state)` for `isRefObj(v)`, `evaluateAttrTemplate(v, state)` for `isTemplateString(v)`, and `v` otherwise. `requestParams(p, state)` returns `resolveRef(p.$ref, state)` for a whole `$ref`, and for a plain object an object mapping each key through `requestValue`.
   - In the `Request` case, replace the `let url` block and its guard with the lines below. Everything after them (the controller, the cleanup, the debounce) is untouched. Every read happens synchronously in the effect before the timer, so each is tracked, and `requestUrl` walks a whole-`$ref` object inside the effect, so a nested change re-fetches too.

     ```ts
     const url = requestUrl(
       isTemplateString(def.url)
         ? evaluateTemplate(def.url, state)
         : isRefObj(def.url)
           ? resolveRef(def.url.$ref, state)
           : def.url,
       def.urlParams === undefined ? null : requestParams(def.urlParams, state),
     );
     if (url === undefined) return;
     ```
3. **`packages/schema/types.ts`**, `JxPrototypeDef`: `url?: Bindable<string>`, and `urlParams?: JxRef | Record<string, JsonValue | JxRef>` with a one-line comment naming both forms. `bun run typecheck` confirms that no consumer read `url` as a bare string. Studio's `SignalDef` is its own type and is unaffected.
4. **`packages/schema/defs/external-class-def.schema.ts`**: add, or append to, `allOf`:

   ```ts
   { if: { properties: { $prototype: { const: "Request" } }, required: ["$prototype"] },
     then: { properties: { urlParams: { anyOf: [
       { $ref: "#/$defs/RefObject" },
       { additionalProperties: { anyOf: [
           { type: ["string", "number", "boolean", "null"] },
           { $ref: "#/$defs/RefObject" },
           { items: { type: ["string", "number", "boolean"] }, type: "array" } ] },
         type: "object" } ],
       description: "Query parameters appended to url: a map of parameter names to literals, $refs or ${} templates, or one $ref to an object or query string." } } } }
   ```

   - `required: ["$prototype"]` keeps the `if` from passing vacuously, for the reason `plan:schema/prototype-property-declarations` gives.
   - If that plan has not landed, this entry creates the `allOf` and brings the comment above it, in the `filter` comment's style: a name only one built-in reads is bound to that prototype here.
   - Then run `bun run schema:sync`. The report should name only `/$defs/ExternalClassDef/allOf/…` pointers in `packages/schema/schema.json` and the 28 committed `document.schema.json` files. Commit what it writes and never hand-edit it.

5. **`packages/compiler/src/shared.ts`**:
   - `export const REQUEST_URL_HELPER = "__jxRequestUrl";` and `export function requestUrlHelperSource(): string`. The source is one plain ES2020 `function __jxRequestUrl(u, p) { … }` that mirrors step 1 branch for branch. Its JSDoc carries the "why inlined" paragraph and points at `attrHelperSource`.
   - `export function requestNeedsUrlHelper(def: JxPrototypeDef): boolean` returns `!def.manual && (def.urlParams !== undefined || isRef(def.url))`. It is the one predicate that both targets and the emitter consult.
   - Three private lowerings, which import `refAccessor` and `objectKey` from `@jxsuite/runtime/pointer`:
     - `refReadExpr(ref, statePrefix)`: `#/state/` and `parent#/` become `refAccessor(statePrefix, rest)`; `window#/` and `document#/` become `refAccessor("window" | "document", rest)`; any other ref becomes `` `(${refAccessor(statePrefix, ref)} ?? null)` ``, which matches `resolveRef`'s `?? null` fallback.
     - `requestValueExpr(v, statePrefix)`: a `$ref` goes through `refReadExpr`. A single-expression template becomes `` `(${withStatePrefix(v, statePrefix).slice(2, -1)})` ``. Any other template becomes a template literal through `withStatePrefix`, as `url` does today. A literal becomes `JSON.stringify(v)`.
     - `requestParamsExpr(p, statePrefix)`: `null` when absent, `refReadExpr` for a whole `$ref`, and otherwise `{ ${objectKey(k)}: ${requestValueExpr(v)}, … }` in key order.
   - `emitRequestFetch`: when `requestNeedsUrlHelper(def)`, replace the `const url` line(s) with the two lines below. `<base>` is the template literal, `refReadExpr(url.$ref)` or `JSON.stringify(url)`. The lines after them are exactly those `plan:spec/compiled-request-fetch` emits, so every read stays before `const _ac`.

     ```js
     const url = __jxRequestUrl(<base>, <requestParamsExpr>);
     if (url === undefined) return;
     ```

     The comment line reads `(dynamic URL)` whenever the helper is used, and the JSDoc gains one sentence: a caller emitting such an entry must emit `requestUrlHelperSource()` once. Any other definition takes the existing path, byte for byte.
6. **`packages/compiler/src/targets/compile-client.ts`**: in the `Request` branch of `compileClient`, set `needsRequestUrl` when `requestNeedsUrlHelper(def)`. `emitClientModule` pushes `requestUrlHelperSource()` directly after `attrHelperSource()` when it is set. The flag joins the trailing options object that `plan:spec/compiled-request-fetch` step 2 and `plan:spec/compiled-cookie-attributes` introduce; if it is still one positional flag, fold it into that object as step 2 says.
7. **`packages/compiler/src/targets/compile-element.ts`**: push `requestUrlHelperSource()` after `attrHelperSource()` in the preamble (line 410–416) when `requestEntries.some(([, d]) => requestNeedsUrlHelper(d as JxPrototypeDef))`. Extend the `requestEntries` comment: the helper, like the import, is emitted only when a `Request` needs it.

**Integration contract.** Once this lands, a plan may rely on the following:

- **The rule.** `@jxsuite/runtime` exports `requestUrl(url, params)`, the one definition of a `Request`'s URL. It returns `undefined` for "do not fetch" and takes `null` params as "none".
- **The compiler exports.** `packages/compiler/src/shared.ts` exports `REQUEST_URL_HELPER`, `requestUrlHelperSource()` and `requestNeedsUrlHelper(def)`. A target that emits a `Request` block for which the predicate holds must emit the helper once in its preamble; the drift test then covers it with no new case.
- **The emitter.** `emitRequestFetch`'s signature is unchanged, and so is the order `plan:spec/compiled-request-fetch` fixed. Every read, `urlParams` included, is on the `const url` line.
- **For `plan:spec/timing-values-in-built-sites`.** A build-time `Request` fetch builds its URL with `requestUrl` over build-time-resolved values, so a `urlParams` entry fetches the same URL at either timing.
- **For `plan:spec/web-api-prototype-parity`.** Its compiled `URLSearchParams` lowering must yield the query string the interpreter's `computed` yields. A whole-`$ref` `urlParams` then reads it in compiled output with no change here.
- **The schema.** `ExternalClassDef` refuses a `Request`'s `urlParams` that is neither a `$ref` nor a map of scalars, scalar arrays and `$ref`s, and it constrains no other prototype's `urlParams`.
- **For `plan:spec/reconcile-built-in-prototypes`.** spec.md §12.1's `Request` row keeps "HTTP fetch with reactive URL params", and its marker no longer mentions URL params.
- **For `plan:schema/generator-inventory`.** schema.md §3.1's `Request` line keeps `urlParams`, and its marker no longer names it.

## Tests

Run `bun test --isolate --coverage` from each of `packages/runtime`, `packages/compiler` and `packages/schema`, then `bun scripts/check-coverage-manifest.ts <workspace>` for each.

**`packages/runtime/tests/request-url.test.ts`** (new; covers the new file)

- "returns url unchanged for null, an empty map and an empty string": `requestUrl("/a", null)`, `("/a", {})`, `("/a", "")` and `("/a", { x: null })` all give `/a`.
- "holds for an unusable url": `undefined`, `""`, `42`, `{}` and `"/u/undefined"` each give `undefined`.
- "holds for undefined params or an undefined value": `undefined`, `{ a: undefined }` and `{ a: ["x", undefined] }`.
- "appends with ?, & or nothing, before a fragment": `/a` gives `/a?k=v`, `/a?x=1` gives `/a?x=1&k=v`, `/a?` gives `/a?k=v`, `/a?x=1&` gives `/a?x=1&k=v`, and `/a#top` gives `/a?k=v#top`.
- "encodes as URLSearchParams does": `{ q: "a b&c=d#e", "ü": "✓" }` gives `q=a+b%26c%3Dd%23e&%C3%BC=%E2%9C%93`.
- "arrays repeat, scalars are their text, key order holds": `{ t: ["a", "b"], n: 0, f: false }` gives `t=a&t=b&n=0&f=false`.
- "a string is a query string, with or without its ?": `"?a=1&b=2"` and `"a=1&b=2"`.
- "a name url already carries is repeated": `("/a?k=1", { k: 2 })` gives `/a?k=1&k=2`.

**`packages/runtime/tests/runtime-gaps.test.ts`**, in "Request prototype gaps" (the file's fetch mock and `wait`)

- "urlParams: a reference, a template and literals build the query, and a change re-fetches". The map `{ id: { $ref: "#/state/userId" }, q: "${state.q}", sort: "date", tag: ["a", "b"] }` fetches `/api/u?id=1&q=x&sort=date&tag=a&tag=b`, and setting `userId` fetches again with `id=2`.
- "an undefined param holds the fetch until it resolves; null drops the param". `urlParams: { id: { $ref: "#/state/later" } }` makes no call. Then `state.later = 3` fetches `?id=3`, and `state.later = null` fetches the bare URL.
- "a whole reference reads an object, nested changes included, and a URLSearchParams entry": a `filters` object entry, then `filters.cat = "b"` re-fetches; a `$ref` to a `URLSearchParams` entry appends its string.
- "a reference url resolves and re-fetches when its entry changes".
- "a urlParams change inside the debounce restarts it": one call, carrying the latest value.
- "a urlParams change aborts the fetch it replaces": the first call's `signal.aborted` is `true`, and only the second body lands.

**`packages/compiler/tests/request-url-helper.test.ts`** (new, the drift test)

The helper is ``new Function(`${requestUrlHelperSource()}\nreturn ${REQUEST_URL_HELPER};`)()``, with the oxlint `no-new-func` disable comment `locale-negotiation.test.ts` uses.

- "the inlined helper agrees with requestUrl": every URL in the set (`/a`, `/a?x=1`, `/a?`, `/a?x=1&`, `/a#h`, `/a?x=1#h`, `""`, `"/undefined"`, `undefined`, `7`) is crossed with every params value in the set (`null`, `undefined`, `{}`, `{ k: "v" }`, `{ k: null }`, `{ k: undefined }`, `{ k: ["a", null, "b"] }`, `{ k: ["a", undefined] }`, `{ n: 0, b: true, "sp ace": "a&b" }`, `"?a=1"`, `""`, `3`). For every pair the helper deep-equals `requestUrl`.
- "the helper is plain ES2020 with no import": the source has no `import`, `require`, `eval` or `new Function`.

**`packages/compiler/tests/prerender-runtime-state.test.ts`**, in the `emitRequestFetch` block

- "lowers each urlParams value inside the url line": the map above gives `const url = __jxRequestUrl("/api/u", { id: state.userId, q: (state.q), sort: "date", tag: ["a","b"] });` and `if (url === undefined) return;`, and its index is below `new AbortController()`'s.
- "rebases urlParams reads onto this.state": `this.state.userId` and `(this.state.q)`, and no bare `state.` read.
- "lowers a mixed template, a quoted key and the other ref schemes": this covers every `refReadExpr` and `requestValueExpr` branch.
  - `"id-${state.x}"` becomes a template literal, and `"page-size"` becomes a quoted key.
  - `parent#/p`, `window#/w`, `document#/d` and a bare `b` become `state.p`, `window.w`, `document.d` and `(state.b ?? null)`.
- "a whole reference urlParams and a reference url lower to accessors": `__jxRequestUrl(state.endpoint, null)` and `__jxRequestUrl("/api", state.filters)`.
- "requestNeedsUrlHelper": true for `urlParams` or a `$ref` `url`, and false for `manual`, a plain `url` or a template `url`. The existing cases pass unchanged, which proves the no-helper path is byte-identical.

**`packages/compiler/tests/request-fetch-agreement.test.ts`** (created by `plan:spec/compiled-request-fetch`)

The compiled tier prepends `requestUrlHelperSource()` to the `new Function` body. New cases assert that `compiled` deep-equals `runtime`:

- "urlParams build the same URL in both tiers";
- "a urlParams change re-fetches and aborts the fetch it replaces";
- "an undefined param holds and a null param is dropped";
- "a nested change under a whole reference re-fetches";
- "debounce applies to a urlParams change";
- "a reference url fetches and re-fetches".

**Target tests**

- `compile-client.test.ts`: "a Request with urlParams carries the url helper once", and "a page whose Requests need no helper carries none".
- `compile-element.test.ts`: the same two cases for the element module.
- `compile-element-render.test.ts`, in the "compiled element: Request fetch" block `plan:spec/compiled-request-fetch` adds:
  - "a urlParams change re-fetches through the inlined helper": `ls-req-params` with `urlParams: { q: "${state.q}", tag: ["x", "y"] }`.
  - This is the case that executes the helper inside a real emitted module.
- `no-eval.test.ts`: add a `Request` with `urlParams` to the fixture, so the helper sits under the §21.1 lock.

**`packages/schema/tests/prototype-config.test.ts`** (created by `plan:schema/prototype-property-declarations`)

If that file does not exist yet, create it with the same module-scope `Ajv2020` compile of `await generateSchema()`.

- "Request urlParams: a map of literals, references, templates and scalar arrays validates".
- "Request urlParams: a whole reference validates".
- "Request urlParams: a nested object value, an array of objects or a non-object is refused at its path": `/state/r/urlParams/id` for `{ id: { a: 1 } }`, `/state/r/urlParams/t/0` for `{ t: [{}] }`, and `/state/r/urlParams` for `"id=1"`.
- "urlParams binds only Request": `{ $prototype: "URLSearchParams", urlParams: "x" }` passes, and so does an extension class with `urlParams: 3`.

**Coverage.** The per-file bars are `packages/runtime` `lines = 0.963, functions = 0.98`, `packages/compiler` `0.982 / 0.98`, and `packages/schema` `0.99 / 0.99`.

- `request-url.ts` is new, and its test takes every branch. Without it the manifest check fails.
- The compiler cases above reach every new branch in `shared.ts`, `compile-client.ts` and `compile-element.ts`.
- Raise a workspace's threshold only if one of these files was its worst and rises.

## Specs & docs

**spec.md**

- **§5.3 4e.**
  - The marker becomes:

    > **Status: Implemented.** A `Request` appends its `urlParams` to `url` as a query string and re-fetches when a value it reads changes (§11.1).

  - In the example, `"url": "/api/users/"` becomes `"url": "/api/users"`, and `"urlParams": { "$ref": "#/state/userId" }` becomes `"urlParams": { "id": { "$ref": "#/state/userId" } }`.
- **§11.1.**
  - The marker becomes:

    > **Status: Implemented.** `$prototype` dispatch ships (`resolvePrototype` in `packages/runtime/src/runtime.ts`). Both tiers build a `Request`'s URL through one rule, `requestUrl` (`packages/runtime/src/request-url.ts`): the runtime calls it, and `emitRequestFetch` (`packages/compiler/src/shared.ts`) emits a call to an inlined copy that a test holds to it.

  - The example changes as in §5.3 4e.
  - After the example, add:

    > A `Request`'s `url` is a string, a `${…}` template or a `$ref`. `urlParams` appends a query string to it, in one of two forms:
    >
    > - **A map** from parameter names to values, each a literal, a `$ref` or a `${…}` template. A template that is one expression end to end keeps its value's type, as an attribute's does (§8.3), so `"${state.q}"` and `{ "$ref": "#/state/q" }` send the same parameter; any other template is text.
    > - **A single `$ref`**, to an object read as a map, or to a query string. A `URLSearchParams` entry (§11.2) is such a string.
    >
    > Parameters are serialized in key order with `URLSearchParams` encoding. An array sends its parameter once per item, `null` leaves the parameter out, and any other value is sent as its text. An `undefined` value, or a whole `$ref` that resolves to `undefined`, holds the fetch, as a `url` that interpolates `undefined` does. The query joins one `url` already carries with `&`, or starts one with `?`, and precedes any `#` fragment; a name `url` already carries is repeated rather than replaced, and an empty query leaves `url` as it is. Every value is read inside the fetch's effect, so a change re-fetches, with the `debounce` and abort §11.2 defines. A `manual` entry never fetches, so it reads neither.
- **§11.2**, in the paragraph `plan:spec/compiled-request-fetch` adds. Its first sentence becomes: "A `Request` entry that is not `manual` fetches inside an effect, so a `${…}` template or a `$ref` in its `url`, or any value its `urlParams` reads (§11.1), re-fetches when the state it reads changes; nothing is fetched while `url` interpolates `undefined` or a `urlParams` value is `undefined`." The rest of the paragraph is unchanged.
- **§12.1 marker.** Delete ", except `Request`'s URL params (§11.1)". The sentence then reads "…resolve in the interpreter; their compiled lowering is §11.2's." The marker stays Partial, and the `Request` row is untouched.
- **Fragment:** `bun run spec:change spec.md minor -m "A Request's urlParams, a map of literals, references and templates or one reference to an object or query string, is appended to its url as a query string in both tiers and re-fetches when a value it reads changes, and url itself may be a reference."`

**schema.md §3.1 marker**, written for either landing order:

- **If `plan:schema/prototype-property-declarations` has not landed**, "declares none of Request `urlParams`, FormData `fields` or Blob `parts` and `type`" becomes "declares none of FormData `fields` or Blob `parts` and `type`".
- **If it has landed**, delete the clause "`ExternalClassDef` does not declare Request `urlParams`, and"; the sentence opens "A computed `state` entry…", and "four statements outrun" becomes "three statements outrun".
- The marker stays Partial.
- **The flat-set bullet.** If it carries that plan's exception sentence, add "and `Request`'s `urlParams`" to the list of names it gives. If it does not, append: "`Request`'s `urlParams` is the exception: only `Request` reads it, so it is declared under an `if`/`then` on `$prototype` and binds no other prototype's parameter of that name."
- The Built-in Prototypes `Request` line already lists `urlParams` and does not change.
- **Fragment:** `bun run spec:change schema.md minor -m "ExternalClassDef declares a Request's urlParams, a map of parameters or one reference, bound to the Request prototype alone."`

**Unchanged specs.** compiler.md is unchanged: §4.1's "a reactive URL re-fetches when its inputs change" already covers the query, and the rule lives in spec.md §11.1.

**Docs pages** (no em dashes)

- **`docs/framework/concepts/data-prototypes.md`** (`spec: spec.md#11`):
  - Add `code: [packages/runtime/src/request-url.ts]` to the frontmatter.
  - Change the opening example as in §5.3 4e.
  - After the example, add: "`urlParams` becomes the request's query string. Each key is a parameter, and its value may be a literal, a `$ref` or a `${…}` template; an array sends the parameter once per item. A `null` value leaves the parameter out, and an `undefined` one (a reference to something not set yet) holds the request until it has a value. `urlParams` may instead be one `$ref` to an object of parameters or to a query string, such as a `URLSearchParams` entry. The request fetches again whenever a value it reads changes, after any `debounce`."
  - In "How it works", replace "Configuration values that are `$ref`s are reactive, so a `Request` whose `urlParams` reference state re-fetches when that state changes." with "A `Request` reads its `url` and `urlParams` inside the fetch, so it fetches again when any state they reference changes."
- **`docs/framework/concepts/reactivity.md`** (`code:` lists `runtime.ts`): the `Request` cell "Reactive URL, debounce, abort" becomes "Reactive URL and query, debounce, abort". Re-pad the table with the formatter.
- **Pages that need no change.** `bun run docs:sync` also names the pages whose `code:` lists `runtime.ts`, `shared.ts`, `compile-client.ts` or `compile-element.ts`: `runtime-host.md`, `docs.md` (contributing), `overlays.md`, `props-and-scope.md`, `styling.md`, `components.md`, `color-schemes.md`, `elements.md`, `functions.md`, `lists.md` and `build.md`. None describes how a `Request` builds its URL, so the pull request states that no update is needed.
- `docs/studio/logic/data-sources.md` is unchanged, because the Data panel is.

**No graduation.** spec.md and schema.md keep other open items. The landing pull request also:

- deletes this file;
- removes `spec/request-url-params` from the `requires` of `plans/spec/reconcile-built-in-prototypes.md` and `plans/schema/generator-inventory.md`;
- rewrites every `plan:spec/request-url-params` mention left in `plans/` (those two files, `plans/schema/prototype-property-declarations.md` if it is still open, and `plans/spec/web-api-prototype-parity.md`);
- re-reads both dependents against the integration contract.

## Acceptance

- `bun test --isolate --coverage` passes at its thresholds in `packages/runtime`, `packages/compiler` and `packages/schema`, and `bun scripts/check-coverage-manifest.ts` passes for each.
- `bun run typecheck`, `bun run lint` and `bun run schema:verify` pass.
- `grep -n "read by nothing\|URL params (§11.1)" specs/spec.md` prints nothing, and `grep -n "urlParams" specs/schema.md` prints only the Built-in Prototypes line (plus the flat-set bullet).
- `bun run plans:status --who-claims spec.md#11.1` and `--who-claims spec.md#4e` report nothing open.
- These all pass: `bun run plans:check --audit spec`, `bun run plans:check --audit schema`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`.
- **No-change proof.** A document with no `urlParams` and no `$ref` `url` compiles to the same module as before this change. The unchanged `emitRequestFetch` cases and "a page whose Requests need no helper carries none" are the proof.
- **By hand.** In a built site page, bind an input to `state.q`, add a `Request` `{ "url": "/api/search", "urlParams": { "q": "${state.q}", "tag": ["a", "b"], "page": null }, "debounce": 300 }`, and type "red shoes".
  - One request per pause goes to `/api/search?q=red+shoes&tag=a&tag=b`, and a superseded one shows as cancelled.
  - The Studio preview of the same page issues the same URLs.
