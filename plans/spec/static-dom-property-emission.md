---
status: drafted
disposition: implement
claims:
  - spec.md#8.1
requires: []
workspaces:
  - packages/runtime
  - packages/compiler
  - packages/studio
size: M
---

# Every tier writes the DOM properties an element definition sets, and built HTML carries each as the attribute HTML reflects it to

## Context

`specs/spec.md` §8.1, line 679:

> **Status: Partial.** The runtime writes any non-reserved key as a DOM property, and the lit element target binds it. The static emitter does not: `buildAttrs` (`packages/compiler/src/shared.ts`), which `compile-static`, the client prerender and the component prerender share, writes only `id`, `className`, `hidden`, `tabIndex`, `title`, `lang` and `dir`, so `href`, `src`, `alt`, `value`, `placeholder`, `type`, `checked`, `disabled`, `name` and `selected`, all declared on `ElementDef`, are dropped from prerendered HTML.

**Verified.** `buildAttrs` resolves exactly those seven keys, then the inline `style`, then `attributes`, then the `data-jx-*` markers. Its callers are `compileNode` (`compile-static.ts`), `buildClientNode` (`compile-client.ts`), and `renderStaticNode` and `renderComponentInstance` (`shared.ts`, reached from `expandComponents` in `site/site-build.ts`). A scratch `compile()` gives `<a>x</a>` for `{ tagName: "a", href: "/x", textContent: "x" }` and a bare `<input>` for `{ tagName: "input", value, placeholder, type, disabled, name, checked }`. The runtime's `applyProperties`/`bindProperty` (`packages/runtime/src/runtime.ts`) assign every key outside `RESERVED_KEYS`, and `emitLitNode`/`emitMappedArray` (`compile-element.ts`) bind each as `.key=`, literal values included.

**Corrections to the census.**

- `name` is dropped by every tier, not only the static one. It is in `RESERVED_KEYS`, which the runtime, the element target and the client target all skip, because §17 reserves `name` as "Inline function explicit name". `ElementDef` declares it anyway (`packages/schema/defs/element-def.schema.ts`). `runtime.test.ts` pins it as reserved, and `packages/studio/tests/iframe-inline-edit.test.ts` ("a RESERVED top-level key does not block a prop of that name") uses it as its example of a reserved key. No element in any tracked JSON document sets it.
- The client target has a second gap. `emitLitMapTemplate` (`compile-client.ts`) writes the lit templates for repeater rows, switch cases and mixed children, and it writes only `id`, `className`, `$props`, `attributes`, inline `style`, handlers and a special-cased `contentEditable`. A client page whose repeater maps `{ tagName: "option", value: "${$map.item.v}", title: "t", textContent: "${$map.item.l}" }` emits ``html`<option>${item.l}</option>` ``, with no value and no title.
- `hidden: "until-found"` is emitted as a bare `hidden`. The IDL setter writes `hidden="until-found"`.
- `innerText` is declared on `ElementDef` and has no attribute. A `<textarea>`'s `value` has none either: it is the element's text. Nor do `text` on an `<a>`, `<option>` or `<title>` and `defaultValue` on an `<output>`, which set the element's text too. All three static inner builders (`buildInner` and `renderInner` in `shared.ts`, `buildInnerWithIslands` in `compile-static.ts`; `buildInner` has no production caller, only `shared.test.ts`) and `buildClientNode` drop all of them.
- A property and an `attributes` entry for the same attribute both reach the output (`className` with `attributes.class` gives two `class` attributes). The HTML parser keeps the first. The runtime applies `attributes` after properties (`renderNode`), so the later one wins there.
- `transformImgNode` (`packages/compiler/src/site/image-transform.ts`) lifts a node-level `src` into `attributes` because, in its comment's words, "The static emitter only renders a fixed set of node-level DOM properties and `src` is not among them". `image-transform.test.ts` repeats that reason above "normalizes a node-level src into attributes even with optimize off". It lifts nothing else, and when `attributes.src` already exists it leaves the node-level `src` in place. `wrapInPicture` moves only `attributes` and `style` to the inner `<img>` and leaves every other node-level key on the node that becomes the `<picture>`, so once `alt` is emitted from the node it would land on the `<picture>`. A node-level `width` would be written beside the pipeline's `attributes.width`.
- A `<select>`'s `value` works in no tier as a plain binding. The runtime applies properties before children render, so the platform refuses the value while the options do not exist yet. `packages/ui/src/behaviors/select.ts` documents this and re-asserts the value from a `MutationObserver`. Built HTML has no attribute to carry it.

**What is missing**: a reflection table (property to content attribute, per element, with the setter's conversion), used by `buildAttrs`; the content properties in the inner builders; property bindings in the client target's lit templates; the image lift widened; and a decision on `name` and on `<select>`.

**Related, no edge.** `plan:spec/style-handle-assignment` owns how the compiler's style handle and an author's `class` combine, so this plan leaves the `id` and `class` emission alone. `plan:jx-markdown/directive-attribute-routing` checked an edge to this plan and declined it; its Open asks whether this plan should also make an `attributes` binding of `value`, `checked` or `selected` write the live property (Open C below). `plan:_shared/compiled-prop-bridge` decides reflected names at run time and needs no table. `plan:site-architecture/head-and-layout-shape-root-title` removes a page's `title` from its root, which `buildAttrs` already writes.

## Outcome

- `spec.md` §8.1 → Implemented. The runtime, both lit targets and the static emitter write every property an element definition sets. Built HTML carries each one as the content attribute HTML reflects it to, or as the element's text for the content properties. The section states which properties have no HTML form, and what a `<select>`'s `value` does.
- `spec.md` §17: the `name` row is scoped to function definitions (Open A as recommended).
- `spec.md` §18: the WHATWG HTML row binds §8.1.

## Decisions

- **Decided:** the table lives in `@jxsuite/runtime`, as a new subpath `@jxsuite/runtime/dom-properties` (`packages/runtime/src/dom-properties.ts`), because the other two rules about what an element key writes live there (`RESERVED_KEYS`, `booleanAttrValue`) and the compiler already imports both. A browser-side consumer cannot import `@jxsuite/compiler`, whose graph carries sharp and esbuild (`packages/studio/src/page-params.ts` says so). A subpath keeps it out of the interpreter's main entry, which never needs it, because the runtime assigns properties and the platform reflects them.
- **Decided:** it is an allowlist keyed by tag and property, not a "lowercase the key" rule. A key the element does not reflect is an expando or live-only state in the runtime: `indeterminate`, `valueAsNumber`, `href` on a `div`, a custom element's own property. Written as an attribute, it would give the static page something the hydrated page lacks. A custom or unknown tag gets only the global rows, those hosted by `Element`, `HTMLElement` or a mixin they include. A custom element's own properties are props (§13.2).
- **Decided:** the rows are every writable member of `html.idl`, `dom.idl` and `wai-aria.idl` that carries a `[Reflect…]` extended attribute and has a string, boolean or numeric type (191 rows at `@webref/idl` 3.84.0, 54 of them global), plus the members HTML says reflect in prose (listed under Implementation). The attribute name comes from `[Reflect="…"]` or is the lowercased property. Tags come from the `html` entry of `@webref/elements`' `listAll()` (SVG2's `a`, `script`, `style` and `title` carry SVG interfaces and are not HTML's), each tag's interface resolved through its `inheritance` chain and every mixin an `includes` statement adds, so `muted` and `preload` on `HTMLMediaElement` reach `audio` and `video`. Obsolete presentational rows stay: browsers still reflect them, so keeping them keeps the tiers in agreement. Element-typed, `DOMTokenList`-typed and `FrozenArray`-typed members are out, because a document writes a scalar. `nonce` is out too, because its setter hides the value instead of reflecting it.
- **Decided:** the literal is derived once, in the implementing pull request, and committed. A test checks that every row is valid against `@webref/idl` and `@webref/elements`, which become runtime devDependencies. It does not assert completeness. `@webref/*` updates arrive in the `bun` Dependabot group, which auto-merges on green (CLAUDE.md, Dependency Autopilot). A completeness assertion would turn every new HTML attribute into a stalled update with nobody on the branch. A missing row means built HTML lacks an attribute the runtime writes, which is the state today for every row.
- **Decided:** a value is converted the way the property's setter converts it. `null` and `undefined` write nothing, and so does a value that is not a string, number or boolean. A text row writes `String(value)`, the empty string included (`alt=""` and `value=""` mean something). A boolean row applies ToBoolean and then `booleanAttrValue` for its attribute, or its keyword pair (`translate` is `yes`/`no`, `autocorrect` is `on`/`off`). `hidden` writes `until-found` for that keyword (ASCII case-insensitive) and otherwise follows truthiness. `id` and `className` keep their current rule and are skipped when empty.
- **Decided:** existing output stays byte-identical, with one exception. `id`, `class`, `hidden`, `tabindex`, `title`, `lang` and `dir` keep their positions and order. The new properties follow in the definition's key order, before `style`. `site-build`, `compile-static` and `shared` tests compare HTML text. The exception: `title`, `lang` or `dir` set to the empty string is written as the empty attribute, where today it is skipped, because the setter writes it (`title=""` is an empty tooltip, `lang=""` an unknown language). No tracked JSON document sets one of the three to a literal empty string.
- **Decided:** each attribute name is written once. Where a property and an `attributes` entry write the same attribute (names compared ASCII case-insensitively, as `setAttribute` lowercases them on an HTML element), built HTML writes what the runtime leaves in effect: the `attributes` entry, which `renderNode` applies after `applyProperties`, including an entry that resolves to `null` and removes the attribute. The exception is the live-state rows (`value` on `<input>`, `checked`, `selected`, `muted`): a later attribute write does not move a state the property set. `id` and `class` are excluded, and both are still written, because the static style handle is written into `className`, and letting `attributes.class` replace it would unstyle any styled element whose class came from `attributes`, which is how `htmlToJx` writes one. That emission belongs to `plan:spec/style-handle-assignment`, and `buildAttrs` keeps whatever `id` and `class` handling it has when this plan lands.
- **Decided:** `innerText` (any element), `value` and `defaultValue` on `<textarea>` and `<output>`, and `text` on `<a>`, `<option>` and `<title>` are content, not attributes: each setter replaces the element's text. `text` on `<script>` is left out, because the inner builders escape text and a script's body is not parsed for entities. The static inner builders write them as escaped text, after `textContent` and `innerHTML` and before `children`. `innerText` line breaks become `<br>`, as its setter does. The first content source present wins. A document with two has contradicted itself.
- **Decided:** `emitLitMapTemplate` binds every non-reserved, non-structural property as `.key=`, using `emitLitNode`'s filter and three branches (`$ref`, template, literal). Its `contentEditable` special case goes. The client target's rows then behave like the element target's and the runtime's.
- **Decided:** `transformImgNode` lifts every node-level key that `reflectedAttribute("img", key)` names, except `id` and `className`, into `attributes` under its attribute name, and deletes the node-level key whether or not it lifted it. An existing `attributes` entry wins. A literal is lifted as `propertyAttrText` converts it (so `translate: false` lifts as `"no"`, and a value it converts to `null` is not lifted); a `$ref` or template is lifted as written, for `buildAttrs` to resolve. The pipeline reads and writes `attributes` only, and `wrapInPicture` moves `attributes` onto the inner `<img>`, so `alt`, `width` and `role` land on the image, nothing is written twice, and nothing is left on the node for the `<picture>` to carry. The comment is rewritten to give that reason.
- **Decided:** namespaces are not tracked. The static walkers do not know one, and the runtime's property writes to SVG's animated properties throw. An SVG or MathML element's attributes go under `attributes`, and §8.1 says so.
- **Decided:** a property with no HTML form is dropped from built HTML silently and documented, not reported. A report needs a drained build-warning channel, which `plan:spec/report-dropped-reactive-styles` builds for styles. §8.1 does not ask for one.
- **Open (A):** is `name` an element property? Recommendation: yes. Remove it from `RESERVED_KEYS` and scope §17's row to function definitions. `name` is the form-control attribute, `ElementDef` declares it, §8.1 promises DOM properties, and it is the one declared property no tier writes. §17 already lists `value`, which is an element property everywhere outside an `$expression`. A function definition is never rendered, so the reservation keeps its meaning where it has one, and no element in any tracked JSON document sets `name` today. The runtime, the element target and the client target then write it with no further change, because all three read `RESERVED_KEYS`. Two other readers change with it: Studio's inline-edit bridge (`packages/studio/src/canvas/iframe-inline-edit.ts`) then treats a top-level `name` on an instance as a second source for a `name` prop, as it already does for `title`, and `docs/framework/concepts/documents.md` stops listing `name` as reserved. The alternative keeps it reserved, drops `name` from `elementDefSchema.properties`, runs `bun run schema:sync`, adds `packages/schema` to `workspaces`, and has §8.1 direct authors to `attributes.name`.
- **Open (B):** should a `<select>`'s `value` work? Recommendation: no. §8.1 states the limit and points authors at `selected` on the chosen `<option>`, or at re-asserting the value once the options exist, as `jx-select` does. Making it work needs three changes: an ordering change in `renderNode`, the same in both lit targets (where a repeated option list commits after the select's property part), and option marking threaded through three static walkers. The one component that binds it already carries a measured workaround (`packages/ui/src/behaviors/select.ts`). If the answer is yes, it needs a Partial marker and a plan of its own, not a larger version of this one.
- **Open (C):** should an `attributes` binding of `value`, `checked` or `selected` also write the live property, as `plan:jx-markdown/directive-attribute-routing` suggests? Recommendation: not here. It changes §8.3, which is Implemented and not claimed, and it touches `applyAttributes` and the inlined `attrHelperSource()` helper in both generated-module targets. It would need its own marker and release. The `live` flag this plan adds is the list such a change would read.

## Implementation

1. **`packages/runtime/src/dom-properties.ts`** (new, `@docs framework/concepts/elements`):
   - `export interface Reflection { readonly attribute: string; readonly kind: "text" | "boolean" | "hidden"; readonly keywords?: readonly [string, string]; readonly live?: boolean }`.
   - Two literals: `GLOBAL_ROWS` (property to `Reflection`) and `ELEMENT_ROWS` (`[property, tags, Reflection]` tuples), indexed into `Map`s on first use. Use `Map`, not object lookup, so `constructor`, `toString` and `__proto__` are never rows.
   - The derived rows as the third Decided describes. Derive them with a scratch script over `(await idl.listAll()).html.parse()` (and `dom`, `wai-aria`) and `listAll()` from `@webref/elements`. Do not commit the script: the test below walks the same IDL.
   - The prose rows, with attribute and kind:
     - global: `id`; `className` → `class`; `slot`; `dir`; `hidden` (kind `hidden`); `translate` (boolean, `yes`/`no`); `autocorrect` (boolean, `on`/`off`); `draggable` and `spellcheck` (boolean, which `booleanAttrValue` writes as words); `popover`; `contentEditable` → `contenteditable`; `enterKeyHint` → `enterkeyhint`; `inputMode` → `inputmode`.
     - per element: `type` on `input`; `value` on `input` (live); `checked` on `input` (boolean, live); `selected` on `option` (boolean, live); `muted` on `audio`/`video` (boolean, live); `async` on `script` (boolean); `crossOrigin`, `referrerPolicy`, `loading`, `decoding` and `fetchPriority` on the elements whose interfaces declare them; `as` (`link`); `kind` (`track`); `preload` (`audio`, `video`); `method`, `enctype`, `encoding` → `enctype` and `autocomplete` (`form`); `formMethod` and `formEnctype` (`input`, `button`); `scope` (`th`, `td`); `shadowRootMode` and `shadowRootSlotAssignment` (`template`); `popoverTargetAction` (`button`, `input`); `srcdoc` (`iframe`); `colorSpace` (`input`); `width` and `height` on `canvas`.
   - `export function reflectedAttribute(tagName: string, property: string): Reflection | null`. It lowercases `tagName`, checks the global rows, then the element rows for that tag.
   - `export function isContentProperty(tagName: string, property: string): boolean`: `innerText` anywhere, `value` and `defaultValue` on `textarea`/`output`, `text` on `a`/`option`/`title`.
   - `packages/runtime/package.json`: add `"./dom-properties": "./src/dom-properties.ts"` to `exports`, and add `@webref/idl` and `@webref/elements` to `devDependencies` at `packages/schema`'s ranges. `bun.lock` must stay `lockfileVersion: 1`, which `scripts/dependabot-config.test.ts` asserts.
   - **`types.d.ts`** (repository root), whose ambient declarations are the only types these two packages have. The test cannot typecheck against them as they stand: `@webref/idl`'s `listAll` returns `Record<string, unknown>`, and `@webref/elements`' element has no `interface`. Widen them additively: `listAll` returns `Record<string, { parse: () => Promise<IdlDefinition[]> }>`; `IdlMember` gains `readonly?: boolean` and `extAttrs?: { name: string; rhs?: { value: unknown } }[]`; `IdlDefinition` gains `inheritance?: string | null`, `target?: string` and `includes?: string`; `WebrefElement` gains `interface?: string`. `packages/schema/src/schema.ts` reads only fields that stay.
2. **`packages/runtime/src/runtime.ts`** (Open A as recommended): remove `"name"` from `RESERVED_KEYS`. One comment line explains that `name` is reserved only inside a function definition (spec.md §17), which is never rendered.
3. **`packages/compiler/src/shared.ts`**:
   - `export function propertyAttrText(reflection: Reflection, value: unknown): string | null`, the conversion Decided above. It sits beside `buildAttrs` and uses `booleanAttrValue`.
   - `buildAttrs(def, scope, hostStyle)` keeps its signature (its five call sites and the `prerender-nested-components` tests pass no tag): resolve the tag once with `resolveStaticTagName(def.tagName, scope)`, then:
     - Write `id` and `class` exactly as today, as a prefix.
     - Build `props: Map<string, string>`. `hidden`, `tabIndex`, `title`, `lang` and `dir` go first, then the rest of the definition's own keys in order. Skip `RESERVED_KEYS`, `$`- and `on`-prefixed keys, `id`, `className`, `style`, `attributes` and content properties. Each key is looked up with `reflectedAttribute(tag, key)`, its value resolved with `resolveStaticValue`, and its text computed with `propertyAttrText`. The map holds each attribute's serialized form: ` name` for a `boolean` or `hidden` row whose text is `""`, and ` name="…"` (through `escapeHtml`) for anything else, the empty text of a `text` row included (`alt=""`). Record the attribute names of `live` rows.
     - Write `style` as today.
     - Resolve each `attributes` entry with today's logic. A name the properties wrote (matched ASCII case-insensitively) is replaced in place, or deleted when the entry is `null` or a boolean that `booleanAttrValue` omits, unless it is live, in which case the entry is dropped. Any other name is appended.
     - Serialize props, then style, then the remaining attributes, then `data-jx-static`/`data-jx-prerendered`. An `attributes` entry keeps today's form: bare only when it resolved to a boolean that `booleanAttrValue` writes as `""`, so `attributes: { "data-x": "" }` stays ` data-x=""`.
   - `export function contentPropertyText(source, tag, scope): string | undefined` returns the escaped text of the first content property present (by `isContentProperty`, in the definition's key order), with `innerText` breaks as `<br>`. Call it after the `textContent`/`innerHTML` checks and before `children` in `buildInner` and `renderInner`.
4. **`packages/compiler/src/targets/compile-static.ts`**: `buildInnerWithIslands` calls `contentPropertyText` at the same point. `compileNode` needs nothing else.
5. **`packages/compiler/src/targets/compile-client.ts`**:
   - `buildClientNode`: the inner-content chain gains the `contentPropertyText` branch after `innerHTML`. The dynamic `:prop` loop is unchanged.
   - `emitLitMapTemplate`: after the `attributes` block, add a loop over the definition's keys. Skip `RESERVED_KEYS`, `$`/`on` prefixes, `tagName`, `id`, `className`, `style`, `children`, `textContent`, `innerHTML` and `attributes`. Emit `.key="${…}"`: `mapRefToClientExpr` for a `$ref`, `mapRefsToLit` for a template, `JSON.stringify` for a literal. Delete the `contentEditable` block.
6. **`packages/compiler/src/site/image-transform.ts`**, `transformImgNode`: replace the `src` lift with the table-driven lift the Decided above describes (`reflectedAttribute("img", key)`, excluding `id`/`className`, an existing `attributes` entry winning, the node-level key always deleted, a literal converted with `propertyAttrText` imported from `../shared.ts`), and rewrite the comment. Rewrite the same stale reason in the comment above "normalizes a node-level src into attributes even with optimize off" in `image-transform.test.ts`.
7. **Open A's other readers** (drop this step if Open A resolves the other way): in `packages/studio/tests/iframe-inline-edit.test.ts`, "a RESERVED top-level key does not block a prop of that name" switches its example from `name` to `description`, which stays reserved, and its comment says so. No Studio source changes: `iframe-inline-edit.ts` reads `RESERVED_KEYS`.

**Integration contract.** Once this lands, a dependent may rely on the following:

- `@jxsuite/runtime/dom-properties` exports `reflectedAttribute(tagName, property)` and `isContentProperty(tagName, property)`. The first returns `{ attribute, kind, keywords?, live? }` or `null`, and a custom or unknown tag reaches only the global rows.
- `propertyAttrText` in `@jxsuite/compiler`'s `shared.ts` is the static conversion.
- `buildAttrs` writes each attribute name at most once, `id` and `class` aside.
- Both lit targets bind every non-reserved property.
- §8.1 is the contract text.
- Under Open A, `name` is no longer in `RESERVED_KEYS`.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime`, `packages/compiler` and (under Open A) `packages/studio`, then `bun scripts/check-coverage-manifest.ts packages/runtime` and `bun scripts/check-coverage-manifest.ts packages/compiler`.

**`packages/runtime/tests/dom-properties.test.ts`** (new):

- "a reflected property names its attribute": `("a","href")` → `href`/text; `("label","htmlFor")` → `for`; `("td","colSpan")` → `colspan`; `("div","ariaLabel")` → `aria-label`; `("div","className")` → `class`; `("input","readOnly")` → `readonly`.
- "boolean rows are kind boolean": `("input","disabled")`, `("details","open")`, `("div","draggable")`; `("div","translate")` carries `["yes","no"]`.
- "hidden is its own kind".
- "the live rows": `("input","value")`, `("input","checked")`, `("option","selected")` and `("video","muted")` are live; `("option","value")` is not.
- "a property the element lacks is null": `("div","href")`, `("my-card","href")`, `("my-card","disabled")`.
- "a custom element gets the global rows": `("my-card","title")`, `("my-card","role")`, `("my-card","ariaLabel")`.
- "a property with no attribute is null": `indeterminate`, `valueAsNumber`, `scrollTop`, `innerText`, `textContent`.
- "prototype keys are not rows": `constructor`, `toString`, `__proto__`.
- "content properties": `("textarea","value")`, `("output","value")`, `("option","text")` and `("p","innerText")` are true; `("input","value")` and `("script","text")` are false.
- "every row is an IDL attribute of the element it names": each row's property is a writable attribute of the interface of every tag it lists, or of an interface that interface inherits or includes (for a global row, of `Element`, `HTMLElement` or a mixin they include), found through `@webref/idl` (`html`, `dom`, `wai-aria` only, parsed once with `listAll()` and each file's `parse()`, not `parseAll()`) and the `html` entry of `@webref/elements`. The row is kind `boolean` exactly when the IDL type is `boolean`. It fails on a mistyped tag or property, so it would fail against a table that put `muted` on `HTMLVideoElement` without walking `inheritance`.

**`packages/runtime/tests/runtime.test.ts`** (Open A): move `"name"` from `required` to a `does NOT contain` case, and add "an element's name is written": `renderNode({ tagName: "input", name: "q" }, …).name === "q"`.

**`packages/studio/tests/iframe-inline-edit.test.ts`** (Open A): "a RESERVED top-level key does not block a prop of that name" uses `description` in place of `name`. Unchanged, it fails once `name` leaves `RESERVED_KEYS`, because the bridge then reads a top-level `name` as a second source and refuses the edit.

**`packages/compiler/tests/shared.test.ts`**, `describe("buildAttrs")`:

- "a reflected property is written as its attribute", and "renamed to its content attribute" for `htmlFor`, `colSpan`, `ariaLabel` and `readOnly`.
- "a boolean property is written by presence": `disabled: true` is bare, `false` is absent, and `"false"` is present (ToBoolean).
- "an enumerated or keyword boolean writes its word": `draggable: false` gives `draggable="false"`, and `translate: false` gives `translate="no"`.
- "hidden keeps until-found".
- "an empty string is written": `alt: ""` and `value: ""` on an option give `alt=""` and `value=""`, and `title: ""` gives `title=""` (the one change to existing output). `attributes: { "data-x": "" }` still gives `data-x=""`.
- "null, undefined and objects write nothing".
- "a property the element lacks is not written": `{ tagName: "div", href }` gives `""`, and `{ tagName: "my-card", disabled: true, title: "t" }` gives ` title="t"`.
- "a property with no attribute is not written": `indeterminate`.
- "the seven keep their order and new properties follow in key order": `{ alt, className, id, src, tagName: "img", title }` gives ` id class title alt src`.
- "an attributes entry replaces the property's attribute": `href` with `attributes.href` gives one `href`, the entry's, `attributes: { href: null }` removes it, and `readOnly: true` with `attributes: { READONLY: false }` writes no `readonly`.
- "a control's live state is the property's": `value` beats `attributes.value` on an input, and `checked: false` beats `attributes: { checked: true }`.
- "id and className keep their emission": pins today's two `class` attributes, with a comment citing spec.md §9.2. If `plan:spec/style-handle-assignment` has landed first, pin its single `class` instead; whichever of the two lands second reconciles this case.
- "handlers, $-keys and reserved keys are never attributes".
- "a resolved template property is written".

In `describe("buildInner")`: "innerText is the element's text, its line breaks br", "a textarea's value is its text" and "an option's text is its text".

Other compiler suites:

- **`compile-static.test.ts`**: "a static page carries the properties it sets". The body contains `<a href="/x">` and `<textarea>hi</textarea>`, and its `<input>` carries `value="v"`, `placeholder="p"` and a bare `disabled`, whatever the key order.
- **`prerender-nested-components.test.ts`**: "a nested definition's element keeps its href", and "an instance host writes only global properties".
- **`compile-client.test.ts`**: "a repeater row binds its properties" (`.value=` and `.title=` in `app.js`), "a literal row property is bound" (`.disabled="${true}"`), and "a static element keeps its href in the prerendered HTML". "contentEditable on mapped array item" asserts `contenteditable="true"` today; it asserts `.contentEditable=` instead.
- **`image-transform.test.ts`**, through `transformImageNodes` as the existing cases are: "a node-level src and alt land on the picture's img", "a node-level width is lifted, so the dimensions are written once", "an attributes entry beats the node-level property, and the node-level key is not left on the picture" (`alt` beside `attributes.alt`: the `<picture>` node has no `alt` afterwards), and "a keyword boolean is lifted as its word" (`translate: false` gives `attributes.translate === "no"`). The existing "an img with no attributes object is given one" and "normalizes a node-level src into attributes even with optimize off" cases stay.
- **`packages/compiler/tests/static-property-parity.test.ts`** (new): register `@happy-dom/global-registrator`, then import `renderNode` from `@jxsuite/runtime` and `renderStaticNode` from `../src/shared.ts`. For each case, render the definition both ways, parse the static HTML through a `<template>`, and assert that the two elements answer the same property. Cases: `a.getAttribute("href")`, `img.alt`, `input.placeholder`/`disabled`/`value`/`checked`, `option.value`/`selected`, `td.colSpan`, `label.htmlFor`, `textarea.value`, `div.hidden`, `div.tabIndex`, and `input.name` (Open A). This is §8.3's "does not change meaning as it hydrates" as a test. It covers only properties happy-dom reflects, so `type` stays a `buildAttrs` unit case.

**Coverage.** Per-file thresholds are `packages/runtime/bunfig.toml` (`lines = 0.963, functions = 0.98`) and `packages/compiler/bunfig.toml` (`lines = 0.982, functions = 0.98`). `dom-properties.ts` is a new source file: its test ships in the same pull request, or the manifest check fails. Ratchet a workspace's threshold if its worst file rises. `packages/studio` gains no source change, so its thresholds do not move.

## Specs & docs

**`specs/spec.md` §8.1**, edited in place:

- Replace the Partial marker with:

  > **Status: Implemented.** The runtime assigns each property to the live element, the element target and the client target's lit templates bind it (`.key=`), and the static emitter (`buildAttrs` in `packages/compiler/src/shared.ts`, shared by `compile-static`, the client prerender and the component prerender) writes it as the content attribute HTML reflects it to, from one table: `reflectedAttribute` in `@jxsuite/runtime/dom-properties`.

- After the example, add:

  > Keys are DOM property names (`className`, `htmlFor`, `tabIndex`, `ariaLabel`), not HTML attribute names, and the runtime assigns each one to the element.
  >
  > **Built HTML writes a property as the attribute it reflects.** A prerendered element carries each property as the content attribute HTML reflects it to (`htmlFor` as `for`, `colSpan` as `colspan`, `ariaLabel` as `aria-label`), converted as the property's setter converts it: a boolean property by §8.3's rule for its attribute (`translate` writes `yes` or `no`), a string or number as its text, the empty string included, and `hidden` as `until-found` when given that keyword. `null` and `undefined` write nothing. On a form control, `value`, `checked` and `selected` are written as the attribute that sets the control's starting state, which is what the property shows until someone edits it. `innerText`, `text` on an `<a>`, `<option>` or `<title>`, and `value` on a `<textarea>` or `<output>`, are the element's text.
  >
  > A property HTML reflects to no attribute (`indeterminate`, `valueAsNumber`, `scrollTop`) has no HTML form and takes effect only where the runtime renders the element. So does a property the element does not have: a custom element is written only its global properties (`title`, `hidden`, `lang`, `role`, the `aria*` family), because its own properties are props (§13.2). An SVG or MathML element's attributes are written under `attributes`.
  >
  > Where a property and `attributes` (§8.3) name the same attribute, built HTML writes the value the runtime leaves in effect: the `attributes` entry, which is applied after the properties, except for `value` on an `<input>`, `checked`, `selected` and `muted`, whose live state a later attribute does not move. `id` and `className` stay outside this rule, because the compiler's style handle is written through them (§9.2).
  >
  > A `<select>`'s `value` selects nothing when it is assigned before the options exist, and properties are applied before children render. Mark the chosen `<option>` `selected`, or re-assert the value once the options exist, as `jx-select` does.
  >
  > `name` is an element property like any other. It is reserved only inside a function definition (§17).

  Drop the last paragraph if Open A resolves the other way, and replace the `<select>` paragraph if Open B does. If `plan:spec/style-handle-assignment` lands first, the `id` and `className` sentence names what it leaves: `class` then follows its one-`class` rule, and only `id` stays outside.

- **§17**: the `name` row becomes "Inline function explicit name, inside a function definition; on an element it is the DOM property (§8.1)" (Open A).
- **§18**: in the WHATWG HTML row, `Binds` becomes `§8.1, §8.7, §16.6`. `Evidence` gains `packages/runtime/src/dom-properties.ts, packages/runtime/tests/dom-properties.test.ts`. `Note` gains: "Element properties are HTML's IDL attributes, and built HTML writes each one as the content attribute HTML reflects it to (§8.1)."
- Fragment: `bun run spec:change spec.md minor -m "Built HTML writes each element property HTML reflects as its content attribute and a textarea value as its text, and name is an element property outside a function definition"`. Drop the `name` clause if Open A resolves the other way.
- This does not graduate `spec.md`. Other §-items stay open, so there is no `spec:bump`, and `plans/spec/` stays.

**Docs pages**:

- `docs/framework/concepts/elements.md` has `spec: spec.md#8` and `code:` listing `shared.ts` and `runtime.ts`.
  - Add `packages/runtime/src/dom-properties.ts` to `code:`.
  - Under "DOM properties", add a subsection "In a built page" in these words:

    > A page the build prerenders is HTML, which has attributes rather than properties, so the build writes each property as the attribute the browser reflects it to: `href`, `src`, `alt`, `placeholder` and `type` under their own names, `htmlFor` as `for`, `colSpan` as `colspan`, `ariaLabel` as `aria-label`. A boolean property such as `disabled` follows the [boolean rule](#boolean-values). On a form control, `value`, `checked` and `selected` set the starting value, which is what the property shows until someone edits it. `innerText`, the `text` of an `<option>` and the `value` of a `<textarea>` become the element's text.
    >
    > Some properties have no attribute at all, such as `indeterminate` on a checkbox or `scrollTop`. The build cannot write those, so they take effect only where the runtime renders the element. A custom element's own properties are the same: pass them as [props](/docs/framework/concepts/props-and-scope). Write an SVG element's attributes under `attributes`.
    >
    > Set each attribute one way. If a property and `attributes` both set one, `attributes` wins, except for a form control's live value, `checked` and `selected`.
    >
    > A `<select>` gets its `value` before its options exist, so the value selects nothing. Put `selected` on the chosen `<option>` instead.
- `docs/framework/site/images.md` lists `image-transform.ts`. After the "Per-image overrides" example, add: "`src`, `alt` and the other image attributes may also be written as element properties (`"alt": "Hero image"`), and the build treats both spellings the same."
- `docs/framework/concepts/documents.md` (Open A; `docs:sync` does not name it, because its `spec:` is §1 to §3 and it has no `code:`): its Rules list drops `name` from the reserved keywords and adds "and `name` inside a function definition".
- `bun run docs:sync` also names every page whose `code:` lists `shared.ts`, `runtime.ts` or `compile-client.ts`:
  - `reactivity`, `styling`, `components`, `color-schemes`, `props-and-scope`, `overlays`, `functions`
  - `docs/framework/build.md`, `docs/extending/embedding/runtime-host.md`, `docs/extending/contributing/docs.md`

  None of them needs a change: none describes which element keys reach built HTML.

- No page may carry an em dash, which `docs:prose` enforces. The text above has none.

## Acceptance

- `bun run plans:check --audit spec` reports nothing for this file. After the landing pull request, `bun run plans:status --who-claims spec.md#8.1` names no plan.
- From `packages/runtime`, `packages/compiler` and `packages/studio`, `bun test --isolate --coverage` is green with no file under its bar. `bun run typecheck` is green over the new test and the widened `types.d.ts`. `bun scripts/check-coverage-manifest.ts packages/runtime` and `bun scripts/check-coverage-manifest.ts packages/compiler` pass.
- A scratch `compile()` in `packages/compiler` gives `<a href="/x">x</a>` for `{ tagName: "a", href: "/x", textContent: "x" }`, `<input value="v" placeholder="p" type="text" disabled name="q">` for `{ tagName: "input", value: "v", placeholder: "p", type: "text", disabled: true, name: "q" }` (Open A), and `<textarea>hi</textarea>` for `{ tagName: "textarea", value: "hi" }`. Before the change it gives `<a>x</a>`, `<input>` and `<textarea></textarea>`.
- A client page whose repeater maps `{ tagName: "option", value: "${$map.item.v}" }` emits `.value=` in `app.js`.
- `bun run docs:status`, `bun run docs:check`, `bun run docs:standards`, `bun run docs:prose`, `bun run docs:links` and `bun run docs:spec-release` are green, and `specs/changes/` holds the fragment.
- Optional: run `bun run --cwd sites/jxsuite.com build` on `main` and on the branch. `diff -r` of the two `dist` directories shows only attributes the old emitter dropped.
