---
status: drafted
disposition: implement
claims:
  - jx-markdown.md#6.6
requires: []
workspaces:
  - extensions/parser
size: S
---

# A directive's attributes land where the renderers read them, by one rule for every element, and §6.6 says what that rule is

## Context

`specs/jx-markdown.md` §6.6, line 237:

> **Status: Partial.** `aria-*`, `data-*` and `slot` reach `attributes`, and the example below is what ships, but the rest of the routing diverges from the text. `directiveToJx` (`extensions/parser/src/transpile.ts`) keeps only `style`, `children`, `textContent`, `innerHTML`, `id`, `className`, `hidden`, `tabIndex`, `lang`, `dir`, `$`-keys and `on*` keys at element level on a standard element, and only `style`, `children`, `textContent`, `innerHTML` and `$`-keys on a custom element; every other key (`type`, `placeholder`, `src`, `href`, and so on) becomes an HTML attribute. On a custom element this sends `className` and `on*` keys to `attributes` as well, where neither the runtime's `applyAttributes` nor the compiler's `buildAttrs` maps them back: the class is written as a literal `className` attribute and the handler is never bound.

The item has two halves with one owner, because the text rewrite describes the code after the fix.

**Standard elements: the routing is deliberate, and the sentence "All other attributes become top-level DOM properties" is stale.** The first version did send everything to element level. Commit a71222dc ("fix: assign html-attributes correctly") replaced that with the current list, citing `buildAttrs`, and flipped the test to assert `type`, `value` and `placeholder` under `attributes`. Every other producer of Jx from HTML-shaped input agrees with the code, not the text:

- §9: `mdastNodeToJx` puts a link's `href`/`title`, an image's `src`/`alt`/`title` and a list's `start` in `attributes`.
- `htmlToJx` (`packages/markup/src/html-to-jx.ts`) puts every attribute of raw HTML there.
- Studio's inspector (`attributeRow` in `packages/studio/src/panels/properties-panel.ts`) writes every `html-meta.json` attribute, `value` and `checked` included, through `mutateUpdateAttribute`. Its element rows write only `className`, `hidden`, `textContent` and `$id` as properties, and the events panel writes `on*` keys.

**Custom elements: the branch is a defect.** The runtime renders a custom-element instance's element-level keys exactly as an ordinary element's. `renderCustomElementWithProps` (`packages/runtime/src/runtime.ts`) calls `applyProperties` and says so: "`id`, `hidden`, `className`, an `onselect` — exactly as an ordinary element gets them … only `$props` are the definition's to absorb". Studio writes `className` (properties panel) and every `on*` key (`events-panel.ts`, `mutateUpdateProperty`) at element level on any element. Once the transpiler moves them into `attributes`:

- `applyAttributes` calls `setAttribute("className", …)`, because `canvasAttrName` has no mapping for it.
- A `$ref` handler resolves to a function, which is then stringified into an `onclick` attribute.
- `buildAttrs` writes the name verbatim.

**Measured at 84735a9f** by running `serializeJxMarkdown` and then `transpileJxMarkdown` on small inputs, then `compile` from `packages/compiler/src/compiler.ts` (no test suite run):

- `{ tagName: "my-card", className: "x", id: "c1" }` is written `::my-card{#c1 className="x"}` and comes back as `attributes: { id: "c1", className: "x" }`. Compiled, `::my-card{className="card" id="c1"}` emits `<my-card className="card" id="c1">`, which HTML parses as an unknown `classname` attribute.
- `{ tagName: "my-card", onclick: { $ref: "#/state/go" } }` comes back as `attributes.onclick`.
- `hidden`, `tabIndex`, `lang` and `dir` on a custom element also come back under `attributes`. That is harmless, since `setAttribute` lowercases the name and each attribute reflects its property, but it is a second list that differs from the first for no reason.
- A bare `hidden`, written without a value, reaches the transpiler as `""`. On a custom element it goes to `attributes`, where presence hides the element. On a standard element it stays at element level as `hidden: ""`, which neither renderer hides: the runtime sets `el.hidden = ""` (false), and `buildAttrs` skips a falsy value. A `hidden="${…}"` template resolves to a boolean and works in both places.
- remark-directive's shorthands route through the same code: `#main` gives `id` and `.card` gives `attributes.class`.
- `once="1"` on an `input` is kept at element level, because the handler test is `key.startsWith("on")`. The runtime and compiler use the same test.

**Two things the census did not record**

- No tracked `.md` puts `id`, `className`, `hidden`, `tabIndex`, `lang`, `dir` or an `on*` key on a custom-element directive. The attributes used on custom-element directives across every tracked `.md` are `props.*` (2,015), `style.*`, `children.*`, `type`, `href`, `firstName`, `lastName`, `role`, `title` and one `data-category`. So the fix changes no committed document's JSON.
- The `value`/`checked` question is wider than markdown. In JSON documents a control's state is usually element-level: `value` on an `input` in `examples/components/dynamic-list.json` and `task-manager.json`, and on an `input` and a `select` in `fetch-demo.json`. Studio's inspector writes it under `attributes`, and so does `examples/components/task-item.json` (`"checked": "${state.task.done ? '' : undefined}"`, the presence idiom). HTML treats the content attribute as the control's default only. Once the user edits the field, its dirty-value (or dirty-checkedness) flag is set and later attribute writes stop showing. A `select` and a `textarea` have no `value` attribute at all. So any `attributes` binding of these names behaves this way, in JSON as much as in markdown.

**Related**

- jx-markdown.md §12.8: its marker lists the custom-element loss, and `plan:jx-markdown/roundtrip-lossless` requires this plan.
- spec.md §4.3: an `on*` key is a handler.
- spec.md §8.1: DOM properties; `plan:spec/static-dom-property-emission` owns its static-emitter gap. See Decisions for why that is not an edge.
- spec.md §8.3: the `attributes` object this routing fills.
- jx-markdown.md §6.2–§6.4: key mapping and dot-path expansion, which run before this routing.
- jx-markdown.md §12.5: names `routeAttributes`.

## Outcome

- jx-markdown.md §6.6 → marker removed (unmarked, as before the census). The section states one routing rule for every element, names the element-level set once, and says what `value`, `checked` and `selected` mean as attributes.
- jx-markdown.md §10 gains a fifth limitation for form-control state, if the Open resolves as recommended.
- jx-markdown.md §12.8 stays Partial and stays owned by `plan:jx-markdown/roundtrip-lossless`. Its marker loses the custom-element clause, and the rest of that clause is restated as what the flat attribute list normalizes.

## Decisions

- **Decided:** a directive attribute is an HTML attribute unless its name is in a fixed element-level set; §6.6's "All other attributes become top-level DOM properties" is rewritten to that. The reasons:
  - The §6.1 syntax takes HTML attribute names. `for`, `colspan`, `readonly` and `tabindex` have no property of the same name, so at element level they would become inert expandos.
  - §9, `htmlToJx` and Studio's inspector already write HTML attributes into `attributes`, so markdown agrees with the other three producers.
  - Every reflected attribute (`href`, `src`, `alt`, `title`, `type`, `name`, `placeholder`, `disabled`) means the same under `attributes` in both renderers: `applyAttributes`, and `buildAttrs` with `booleanAttrValue` for booleans.
- **Decided:** one set for every element, and the custom/standard branch in `directiveToJx` goes. The set is:
  - the structural keys `style`, `children`, `textContent` and `innerHTML`;
  - every `$`-key;
  - every key beginning `on`;
  - `id`, `className`, `hidden`, `tabIndex`, `lang` and `dir`.

  The runtime applies these keys to a custom-element instance exactly as to any element, and the compiler reads `className` and `on*` on any element. The four element properties other than `className` behave the same in either place, so moving them costs nothing, and keeping a second list is what let the two diverge. A key outside the set stays an attribute on a custom element (`variant`): `instanceSupplies` reads an attribute at connection, the prerender writes it, and `props.*` is the explicit route into `$props` (§6.4). An `on`-prefixed attribute that is not a handler (`once`) moves to element level on a custom element, as it already does on a standard element. It is written `data-once` instead.

- **Decided:** a bare `hidden` (`""`) is routed as `true`. Moving `hidden` to element level would otherwise stop `::my-card{hidden}` hiding its element, and the same fix makes `::div{hidden}` hide, as it does in HTML. `hidden` is the only boolean property in the set, so the rule is one key, not a typing scheme. Every other value keeps §6.1's string.
- **Decided:** the handler test is `key.startsWith("on")`, the test `applyProperties`/`bindHandler` (runtime), `compile-client.ts` and `compile-element.ts` all use, so the parser and both renderers agree on what a handler key is.
- **Decided:** the set is hand-kept in `transpile.ts` and derived neither from `buildAttrs` nor from the property table `plan:spec/static-dom-property-emission` will build, because it answers a different question. That table maps a property to the attribute it writes. This set names the directive keys that are not plain HTML attributes. `@jxsuite/parser` depends on neither the runtime nor the compiler (its `package.json` lists `@jxsuite/markup` and `@jxsuite/schema`), and its browser-safe `transpile` entry must stay that way. The critic's suggested edge was checked against both plans and is not taken. Under the recommendation below, every key this plan routes to element level is one `buildAttrs` already writes (`id`, `className`, `hidden`, `tabIndex`, `lang`, `dir`) or a handler, so nothing here waits on the static emitter.
- **Open:** where do `value`, `checked` and `selected` land? Recommendation: in `attributes`, bound or literal, as today, with §6.6 and §10 saying that on a form control they set the default. The reasons:
  - Studio's inspector writes them there, including a bound Value or Checked row, so a Studio edit survives a save and reopen of a `.md` exactly.
  - §9 and `htmlToJx` do the same.
  - The default-versus-live difference belongs to every `attributes` binding of these names, in JSON (`task-item.json`) as much as in markdown, so it should be fixed once, in the renderers, not by moving keys in one producer. The fix would be a spec.md §8.3 rule: a `value`, `checked` or `selected` binding under `attributes` also writes the live property, with `booleanAttrValue`'s presence reading for the last two. It fits the "one table, shared with the runtime" that `plan:spec/static-dom-property-emission` builds. The reviewer should ask that plan to take it, since no spec marker names it today.

  The alternative keeps a `${…}` or `.ref` value of the three at element level (live) and leaves a literal in `attributes`. It matches spec.md §8.1 and the JSON examples, and a JSON element-level binding would then round-trip exactly. It costs three things:
  - It requires `plan:spec/static-dom-property-emission` first, because `buildAttrs` drops an element-level `value`, `checked` or `selected` from prerendered HTML today but writes the `attributes` form.
  - A Studio-bound Value row reopens at element level, where the inspector (which reads `node.attributes`) does not show it. The next inspector edit then writes a second `value`, which `collectDirectiveAttrs` lets overwrite the binding on the following save. So `packages/studio` joins the plan and it grows to M.
  - A presence-idiom template (`'' : undefined`) inverts when it is read as a property.

## Implementation

1. **`extensions/parser/src/transpile.ts`**, in the transpiler section:
   - Replace `HTML_ATTR_PATTERN` with `const ELEMENT_LEVEL_KEYS = new Set(["style", "children", "textContent", "innerHTML", "id", "className", "hidden", "tabIndex", "lang", "dir"]);`.
   - Add `export function isElementLevelKey(key: string): boolean`, returning `ELEMENT_LEVEL_KEYS.has(key) || key.startsWith("$") || key.startsWith("on")`. Its JSDoc cites jx-markdown.md §6.6 and gives one line of reason per group: structural keys, `$` keywords, handlers "tested as the renderers test them (spec.md §4.3)", and element properties "whose attribute is spelt differently or that both renderers already write".
   - Rewrite `routeAttributes(attrs)` to do the whole routing. After `expandDotPaths` and the `applyStyleKeyMapping` step, split `expanded` by `isElementLevelKey` into `{ props, attributes }`, writing `props.hidden = true` when the expanded `hidden` is `""`. Type `attributes` as `Record<string, JxAttributeValue>`, because a `.ref` dot-path yields `{ $ref }`. JSDoc: "The whole §6.6 rule, identical for every element."
   - In `directiveToJx`:
     - delete the `isCustomElement` branch, the standard-element loop and their comments;
     - replace them with `Object.assign(el, props)`, then `if (Object.keys(attributes).length > 0) el.attributes = attributes;`;
     - keep the note that a bare or dotted `props` is already `$props` by this point.

   The serializer needs no change: `collectDirectiveAttrs` (`serialize.ts`) already flattens element-level keys and then `attributes` into one attribute list.

2. **`extensions/parser/src/serialize.ts`**, `mdastToJx`/`convertDirective`: untouched. It copies attributes raw and is on no production path. `plan:jx-markdown/roundtrip-lossless` decides its fate.
3. Spec and docs edits (below).
4. On landing, delete this file and remove `jx-markdown/directive-attribute-routing` from `plan:jx-markdown/roundtrip-lossless`'s `requires`. Update that plan's quoted §12.8 marker to the new text.

**Integration contract.** Once this lands, other plans may rely on the following.

- `@jxsuite/parser/transpile` exports `isElementLevelKey(key): boolean`. `routeAttributes` applies it to every directive, after §6.2–§6.4 expansion, whatever the element. A key that passes lands on the element definition. A key that fails lands in `attributes` with its expanded value. A bare `hidden` is `true`; every other value is the string written (§6.1) or its dot-path expansion.
- For `plan:jx-markdown/roundtrip-lossless`, an element whose element-level keys all pass the predicate and whose `attributes` keys all fail it re-parses with every key in place. The only placement normalizations are:
  - an element-level key that fails the predicate comes back under `attributes`, which renders the same for a reflected attribute (`href`, `title`, `src`) and, under the recommended Open, turns a `value`, `checked` or `selected` binding into the control's default;
  - an `attributes` key that passes it comes back at element level (`attributes.id`, `attributes.onclick`).

  §12.8 names these or refuses them. Scalar typing is outside this plan: directive values are strings (§6.1), so `hidden: false` comes back as `"false"`, which hides the element, and a numeric `$props` value comes back as a string. That belongs to §12.8.

- Studio's saved `.md` files keep a custom element's Class, ID and event bindings across a reopen.

## Tests

Run `bun test --isolate --coverage` from `extensions/parser`. There is no new source file, so the manifest check sees nothing new. The per-file `coverageThreshold` stays at `lines = 0.987, functions = 0.975` (`extensions/parser/bunfig.toml`). The change removes a branch from `transpile.ts` and adds one tested export. Ratchet if the workspace's worst file rises.

New file `extensions/parser/tests/attribute-routing.test.ts` (string-level, per the audit's spec-wide decision). It imports `transpileJxMarkdown` and `isElementLevelKey` from `../src/transpile` and `serializeJxMarkdown` from `../src/serialize`.

- `describe("isElementLevelKey (jx-markdown.md §6.6)")`
  - "keeps structural keys, keyword keys, handlers and the six element properties": `true` for `style`, `children`, `textContent`, `innerHTML`, `$ref`, `$props`, `$title`, `onclick`, `oninput`, `id`, `className`, `hidden`, `tabIndex`, `lang` and `dir`.
  - "sends every other name to attributes": `false` for `href`, `src`, `alt`, `title`, `type`, `placeholder`, `value`, `checked`, `selected`, `class`, `for`, `tabindex`, `aria-label`, `data-x`, `slot` and `variant`.
- `describe("one rule on every element")`
  - "a custom element keeps its class, id, handlers and element properties on the element". Transpile `::my-card{#c1 className="card" hidden tabIndex="0" lang="fr" dir="rtl" onclick.ref="#/state/open" variant="compact" data-x="1" aria-label="Card" slot="s" title="T"}` and `toEqual` the exact object: `id`, `className`, `hidden: true`, `tabIndex`, `lang`, `dir` and `onclick: { $ref }` at element level, the other five under `attributes`.
  - "a bare hidden hides on every element": `::div{hidden}` and `::my-card{hidden}` both give `hidden: true`, `hidden="${state.off}"` keeps the template string, and `hidden="false"` keeps `"false"` (which hides, as the attribute does in HTML).
  - "a standard and a custom element route the same attribute list identically": the same attribute string on `::div{…}` and `::my-card{…}`, compared with `tagName` removed.
  - "the §6.6 examples transpile to the JSON the spec shows": both examples below, verbatim.
  - "shorthands follow the rule": `::div{#main .card}` gives `id: "main"` and `attributes: { class: "card" }`.
  - "value, checked and selected are attributes, bound or literal": `::input{value.ref="#/state/v" checked="${state.done}"}` and `::option{selected}` put all three under `attributes`. This pins the Open; invert it if the Open resolves the other way.
- `describe("save and reopen (serializeJxMarkdown → transpileJxMarkdown)")`. Each case serializes `{ tagName: "my-page", children: [el] }` and expects `children[0]` back `toEqual(el)`. Fixtures use string scalars, because typing is §12.8's.
  - "a custom element's class, id, element properties and handler survive": `{ tagName: "my-card", id: "c1", className: "card", lang: "fr", dir: "rtl", onclick: { $ref: "#/state/open" }, attributes: { variant: "compact", "data-x": "1", slot: "s", title: "T" } }`.
  - "a standard element's handler and attributes survive": `{ tagName: "a", className: "k", onclick: { $ref: "#/state/go" }, attributes: { href: "/x", title: "t" }, textContent: "go" }`.
  - "an element-level reflected property comes back under attributes": `{ tagName: "a", href: "/x", textContent: "go" }` returns `attributes: { href: "/x" }`. This pins the normalization §6.6 states, for `plan:jx-markdown/roundtrip-lossless` to cite.

Existing tests stay green unchanged:

- `extensions/parser/tests/transpile.test.ts`: "custom element: structural keys element-level, unknown keys become attributes" (its keys are `ref`, `style.*`, `textContent` and `variant`) and "standard element: DOM props stay element-level, rest become attributes".
- `extensions/parser/tests/jx-markdown.test.ts`: "maps directive attributes to HTML attributes for standard elements" and "routes aria-\* and data-\* to attributes sub-object".

## Specs & docs

- **jx-markdown.md §6.6**: delete the Partial marker and replace the section body (the heading stays) with:
  - "A directive attribute is an HTML attribute unless Jx gives its name a meaning of its own. After the key mapping and dot-path expansion of §6.2–§6.4, `routeAttributes` (`extensions/parser/src/transpile.ts`) sends each key to one of two places, by the same rule on every element, standard or custom:"
  - "- **The element definition** (spec.md §8.1): the structural keys `style`, `children`, `textContent` and `innerHTML`; every `$`-key (§6.2, §6.3); every key beginning `on`, which both renderers bind as an event handler (spec.md §4.3); and the element properties `id`, `className`, `hidden`, `tabIndex`, `lang` and `dir`."
  - "- **The `attributes` object** (spec.md §8.3): every other key. That includes `aria-*`, `data-*` and `slot`, the attributes a property reflects (`href`, `src`, `alt`, `title`, `type`, `name`, `placeholder`, `disabled`), and any attribute a custom element reads (`variant`). A value meant for a component's state is written `props.*` instead (§6.4)."
  - "A name is written as HTML spells it (`for`, `colspan`, `readonly`) and reaches the page as written: the runtime sets it with `setAttribute`, and the static emitter writes it into the tag. remark-directive's shorthands follow the same rule, so `#main` gives the element-level `id` and `.card` gives `attributes.class`. A bare `hidden`, written without a value, is `true`, as the attribute is in HTML; every other value is the string written (§6.1)."
  - "`value`, `checked` and `selected` are attributes too, so on a form control they set its default, as they do in HTML. A bound `value` stops updating a text field once the user has typed in it, and a `select` has no `value` attribute at all (§10)." Replace this paragraph with the element-level rule if the Open resolves the other way.
  - Keep the existing `::div{…}` example and its JSON, then add: "A custom element routes the same way:", with `::my-card{#featured className="card" onclick.ref="#/state/open" variant="compact"}` producing `{ "tagName": "my-card", "id": "featured", "className": "card", "onclick": { "$ref": "#/state/open" }, "attributes": { "variant": "compact" } }`.
  - Close with: "The flat attribute list does not record which of the two places a key came from. An element definition that sets a reflected property at element level (`"href": "/about"`) therefore comes back from a markdown round trip under `attributes`, where it renders the same, except for `value`, `checked` and `selected` (above; §12.8)."
- **jx-markdown.md §10** (recommended Open only): add "5. **Form-control state** — a directive's `value`, `checked` and `selected` are the control's default (§6.6); a field that must keep following a binding after the user edits it belongs in a JSON component (§11)".
- **jx-markdown.md §12.8 marker**: replace "A custom element's `className` and `on*`, and a standard element's `href`, `title` or `value`, come back under `attributes` (§6.6)." with "An element-level `href`, `title` or `value` comes back under `attributes` (§6.6). The first two render the same, but a bound `value`, `checked` or `selected` becomes the control's default." The marker stays a leading Partial.
- **jx-markdown.md §12.5**: unchanged. "Used internally by `routeAttributes()`" stays true.
- **Fragment**: `bun run spec:change jx-markdown.md minor -m "Directive attributes route by one rule on every element: structural keys, keyword keys, on-handlers and the id, className, hidden, tabIndex, lang and dir properties stay on the element, a bare hidden is true, and every other name, value and checked included, is an HTML attribute"`. The level is minor because this is an implement, and the replaced sentence never shipped (a71222dc), so no author relied on it.
- **Docs**: `docs/framework/site/jx-markdown.md` cites `jx-markdown.md` and lists `extensions/parser/src/transpile.ts` in `code:`, so `docs:sync` names it. In its "Attributes" section, replace the paragraph "DOM properties like `src`, `id`, and `export` are not mapped; they pass through as-is. Attributes matching …" with: "Every other key keeps its name. A few land on the element itself, the same way on every element, HTML or custom: `style`, `children`, `textContent`, `innerHTML`, the `$` keywords, event handlers (any key starting with `on`, such as `onclick.ref="#/state/open"`), and `id`, `className`, `hidden`, `tabIndex`, `lang` and `dir`. A bare `hidden` hides the element, as it does in HTML. Everything else is an HTML attribute and goes into the element's `attributes` object: `href`, `src`, `alt`, `title`, `aria-*`, `data-*`, `slot`, and any attribute a custom element reads. Write each name the way HTML spells it (`for`, `colspan`). On a form control, `value`, `checked` and `selected` set the starting value, as they do in HTML, so a binding stops updating a text field once someone types in it. Keep a live form field in a JSON component." It contains no em dashes. Drop the last two sentences if the Open resolves the other way.
- **`extensions/parser/README.md`** (a shipped README, so `docs:prose` reads it): change "with its attributes routed to the right Jx locations (props, `$`-annotations, styles)" to "with its attributes routed as jx-markdown.md §6.6 describes: element properties and handlers on the element, HTML attributes in `attributes`, `props.*` into `$props`, annotations and styles".
- `docs/extending/reference/standards.md` is generated, and §13 binds §9, not §6.6, so nothing there changes. `docs/framework/agents/authoring-rules.md` describes JSON authoring, not markdown routing, and does not change.

The spec does not graduate: §3.1, §6.5, §7.3, §9 and §12.8 stay open.

## Acceptance

- `cd extensions/parser && bun test --isolate --coverage` passes at its thresholds, and `bun scripts/check-coverage-manifest.ts extensions/parser` passes.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass. `bun run plans:status --spec jx-markdown` no longer lists §6.6.
- `grep -n "isCustomElement\|HTML_ATTR_PATTERN" extensions/parser/src/transpile.ts` finds nothing.
- Observable, from the repository root, with a short Bun script:
  - `transpileJxMarkdown` of `::my-card{className="card" id="c1" onclick.ref="#/state/go"}`, under a `tagName: div` frontmatter, gives a child with `className`, `id` and `onclick` at element level and no `attributes`;
  - passing the transpiled `::my-card{className="card" id="c1"}` to `compile` (`packages/compiler/src/compiler.ts`) emits `<my-card id="c1" class="card">`, where today it emits `<my-card className="card" id="c1">`.
- In Studio, following the `packages/studio:verify` recipe: in a `.md` page, give a custom element a Class and a click handler, save, close and reopen. The Class row still shows the class, the event is still listed, and the canvas element carries the class.
