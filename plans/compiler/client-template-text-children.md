---
status: drafted
disposition: implement
claims:
  - compiler.md#2.2
requires: []
workspaces:
  - packages/compiler
size: S
---

# A template string written as a text child is prerendered wherever it can be, and bound on a dynamic page

## Context

`specs/compiler.md` §2.2, line 53 (the section was unmarked before the census):

> **Status: Partial.** All three targets emit bare strings and numbers as text nodes, and the element target binds a template text child reactively (`toLitTextContent` in `compile-element.ts`). The other two do not. The client target's `buildClientNode` (`packages/compiler/src/targets/compile-client.ts`) escapes a child such as `"Hello ${state.name}"` and writes it out verbatim, neither prerendered nor bound, so template text is reactive in that tier only inside a lit-rendered region (a mapped array, or mixed children rendered through `emitChildLit`). The static target does the same (`compileNode` in `compile-static.ts`), and the site build's prerender does not resolve such a child first: `resolveDocTemplates` in `packages/compiler/src/site/site-build.ts` substitutes a template child only when it evaluates to an array. `isDynamic` does not count a template child, so a page whose only template is a text child routes static and ships the literal `${…}`, while a `textContent` template beside it resolves.

Re-read against the tree on 2026-09-27; every claim holds, and three things were found while detailing.

- **Client target.** `buildClientNode`'s `typeof def === "string"` branch returns `escapeHtml(def)`. Compiling `{ children: ["Hello ${state.name}", <button, onclick → #/state/rename>], state: { name: "World", rename: <writes state.name> } }` emits `<div>Hello ${state.name}\n  <button data-bind @click="rename">` and a module with no `Hello` in it. Note the shape: the text and the emitter's separator (`childSeparator`) parse as one `Text` node, so any binding has to delimit the text it owns.
- **Element target.** `emitLitNode` sends a template string child through `toLitTextContent`, a hole in the lit template. Works; unchanged.
- **Prerender.** `resolveDocTemplates` resolves `textContent`, `innerHTML`, style, attribute and `$props` templates, and a template child only when `evaluateStaticTemplate` returns an array (the splice among siblings). `renderStaticNode` in `packages/compiler/src/shared.ts`, the component-instance prerender, already resolves a template text child and falls back to its source text, so only the page tree is missing it.
- **Routing.** `isDynamic` in `shared.ts` returns `false` for every string, so a text child never makes a page dynamic, while `textContent` (not in `RESERVED_KEYS`) does. `compile()` in `packages/compiler/src/compiler.ts` sends a non-dynamic document to `compileStaticPage`.
- **Found: repeaters.** `expandMapTemplate` in `site-build.ts` resolves every key of a build-time-expanded map template through `evaluateMapTemplate` (which binds `item`, `index`, `$map`) except string children, which it returns verbatim. A `"${item.title}"` text child in a repeater over build-time data therefore ships literally too.
- **Found: content is read as templates.** `resolveDocTemplates` recurses into nodes spliced in by a computed-children template (spec.md §8.4) and evaluates their `textContent` and attributes, which reaches parsed Markdown. It is live on jxsuite.com: `docs/start/first-component.md`'s inline code `Clicked ${state.count} times` renders "Clicked undefined times", and `/docs/framework/concepts/security/` ships an `app.js` holding `` _t3: () => `${` ``, a SyntaxError, so its inline-code examples render empty. Not this item; it bears on the one Open decision below.
- **Found: nothing shipped relies on today's literal output.** A scan of every authored JSON document under `sites/`, `examples/`, `packages/starters/` and `docs/`, and of all 301 Markdown files there run through `processMarkdown`, finds no text child containing `${`. Every hit (139) is a `textContent`.

**Related.** compiler.md §2.1 (static detection), §8.1 (which reads are baked), §9.1 (the client target's output), §4.3 (the element target's binding form); spec.md §6 (templates anywhere a string appears) and §8.4 (text node children, computed children).

## Outcome

- compiler.md §2.2 → Implemented: a template text child is baked by the site build when §8.1 lets it be, makes its document dynamic otherwise, and is bound by the client target without a wrapper element. No Future remainder.
- compiler.md §2.1 counts a template text child, and §9.1 names the text binding.

## Decisions

- **Decided:** the client target binds a text child between two comments, `<!--jx-text:_tN-->…<!--/jx-text-->`, and `hydrate()` keeps the `Text` node after the opening comment current with an `effect()`, because spec.md §8.4 promises text "without wrapper elements", a child index on the parent breaks on the separator whitespace and on adjacent text children the parser merges, and routing the region through lit (the mixed-array branch) would empty the container's prerender and rebuild its element siblings. The closing comment keeps the separator out of the bound node. It is the same device lit uses for its own child parts.
- **Decided:** in the client target a template text child of `script`, `style`, `textarea` or `title` is a build error naming the element and pointing at `textContent`, because HTML parses those elements' content as text, so the markers would render literally (lit cannot bind there either, which is why the lit-rendered regions are no alternative). The site build bakes a bakeable one first, so only a runtime-only one is refused, and the scan in Context finds none shipped. `textContent` already binds these elements through `:text-content`.
- **Decided:** `isDynamic` counts a template text child, as it counts a template in any property, because §2.2 already promises such text is reactive, which a static route cannot deliver, and because the site build bakes every bakeable one before routing, so only a template that needs the client makes a page dynamic. The static target then never meets one, so `compileNode` in `compile-static.ts` is not changed (the stub's static-target step is dropped). A whole-`children` template string is not a text child and is not counted: spec.md §8.4 makes it build-time only.
- **Decided:** one rule for a text child's value in both prerender passes: a string, number or boolean result is substituted as `String(value)`; `null`, `undefined` or a non-array object keeps the template, as `textContent`'s `??` fallback does; an array keeps the existing splice. A runtime-only read comes back `null` from `evaluateStaticTemplate`, so §8.1's marks decide what bakes with no new logic. In a repeater the value comes from `evaluateMapTemplate`, like every other key `expandMapTemplate` resolves, because `evaluateStaticTemplate` binds `$map` but not `item`: `${item.title}`, the spelling the repeater fixtures use, would otherwise survive the build, make the page dynamic, and throw a ReferenceError at hydration where today it ships literal text.
- **Decided:** the client target binds every template text child it meets and prerenders what `resolveStaticValue` resolves (nothing when it cannot), exactly as its `textContent` binding does, because baking belongs to the site build, which runs first. A stateless document compiled through `compile()` without the site build therefore ships a small module, as a `textContent` template does today.
- **Open:** whether text that reaches the tree as data stays literal: a content entry's `$children` spliced in by a computed-children template, and a baked value that itself contains `${`. Recommendation: not in this plan; a text child gets exactly what `textContent` gets, and the literal-content fix is a separate defect against spec.md §8.4 (whose "recurses into it" is the sentence that would change), covering every position at once and needing its own marker and plan. Because the parser writes one construct in either form (`mdastNodeToJx` and `convertHastNode` turn a lone text child into `textContent`), treating the two differently would make a paragraph's meaning depend on whether it holds an inline element, and the scan above shows parity changes nothing that ships today. The cost of deferring, stated so the call is made knowingly: until that plan lands, a text child spliced in from content (a Markdown paragraph that also holds inline markup) is evaluated like a `textContent` one, so prose `${` on a page that stays dynamic is bound at runtime, and an unbalanced one makes the page's module a SyntaxError, as `/docs/framework/concepts/security/` already shows for inline code.

## Implementation

1. **`packages/compiler/src/shared.ts`**, `isDynamic`: open with `if (typeof def === "string") { return isTemplateString(def); }` ahead of the non-object guard, so the existing `def.children.some((c) => isDynamic(c))` counts a template text child at any depth. The doc comment says so. `isNodeDynamic`, `hasAnyIsland` and `_isStaticNode` are unchanged; the signature is unchanged, so compiler.md §11's entry stays true.
2. **`packages/compiler/src/site/site-build.ts`**:
   - A module-private `textChildValue(value: unknown): string | null`, returning `String(value)` for a string, number or boolean and `null` otherwise.
   - `resolveDocTemplates`, the `children` array loop: after the array splice, `const text = textChildValue(resolved); if (text !== null) { node.children[i] = text; i += 1; continue; }`. Doc comment: text children join the list of resolved positions.
   - `expandMapTemplate`, the `children` branch: a string child that `isTemplateString` is replaced by `textChildValue(evaluateMapTemplate(child, scope)) ?? child`; any other string stays verbatim.
3. **`packages/compiler/src/targets/compile-client.ts`**:
   - Declare the counter once as `interface ClientCounter` (the literal type is repeated in `compileClient`, `buildClientNode`, `emitClientModule` and two JSDoc blocks) and add `textParts: boolean`, initialised `false`.
   - `buildClientNode`, string branch: a plain string still returns `escapeHtml(def)`. A template string takes the next `_t` key from `counter.t` (the counter the `textContent`, attribute and property bindings share), sets `counter.textParts = true`, records its binding exactly as the `textContent` branch does (`bindings.set(key, …)` with the template spliced verbatim into a template literal), and returns the two markers around `escapeHtml(String(value))`, or around nothing when `value` is `null` or `undefined`, where `value = resolveStaticValue(def, context.scope)`.
   - `buildClientNode`, the plain `children` array branch: when `tag` is in a new module constant `RAW_TEXT_TAGS` (`script`, `style`, `textarea`, `title`) and a child is a template string, throw `A template text child of <tag> cannot be bound: HTML reads its content as text. Write it as the element's textContent.`
   - `emitClientModule`, when `counter.textParts`: `hydrate(root)` first collects every comment whose data starts `jx-text:` and whose key is `in bind`, through `document.createTreeWalker(root, 128)` (128 is `NodeFilter.SHOW_COMMENT`, written as a literal so the module needs no further global), before the `[data-bind]` pass, so regions lit has just rendered are never walked. After that pass, for each collected comment: take `nextSibling` when it is a `Text` node (`nodeType === 3`), otherwise insert an empty `Text` node after the comment, and run `effect(() => { text.data = bind[key](); })`. Without text parts the module is byte-identical to today's.
   - The file header's output-pattern paragraph names the text-child markers.

**Integration contract.** Once this lands: `isDynamic(def)` returns `true` for a template string and for any node holding one in a `children` array at any depth, with an unchanged signature; after `resolveDocTemplates` no template text child whose value §8.1 lets bake remains in the page tree, repeater expansions included; a client-target page marks each bound text child as `<!--jx-text:_tN-->…<!--/jx-text-->`, with `_tN` drawn from the counter its other `_t` bindings use, and its `hydrate()` binds them, except inside `script`, `style`, `textarea` or `title`, where one is a build error; the static target never receives a template text child from `compile()`. compiler.md §2.2 is Implemented.

## Tests

`bun test --isolate --coverage` from `packages/compiler`.

**`packages/compiler/tests/shared.test.ts`**, `describe("isDynamic")`:

- `returns true for a template string text child`: `isDynamic("Hi ${state.x}")`, and `{ tagName: "p", children: ["Hello ${state.name}"] }` nested one level under a `div`, are `true`.
- `a plain text child and a whole-children template stay static`: `{ children: ["plain"] }` and `{ children: "${state.items}", tagName: "ul" }` are `false`.

**`packages/compiler/tests/compiler.test.ts`**, `describe("compile — dynamic documents (standard tagName → client target)")`:

- `a document whose only template is a text child routes to the client target`: `compile({ children: ["Year ${1 + 1}"], tagName: "p" })` returns an `app.js` file, and its HTML holds `<!--jx-text:_t0-->Year 2<!--/jx-text-->`.

**`packages/compiler/tests/compile-client.test.ts`**, new `describe("compileClient — template text children (compiler.md §2.2)")`:

- `binds a runtime-only text child between markers and leaves its sibling alone`: the Context example; the HTML holds `<!--jx-text:_t0--><!--/jx-text-->` followed by the button with its own `data-bind @click`, and the module holds `` _t0: () => `Hello ${state.name}` `` and `createTreeWalker`.
- `prerenders a bakeable text child, escaped`: `state: { name: "<World>" }` with no writer gives `<!--jx-text:_t0-->Hello &lt;World&gt;<!--/jx-text-->`.
- `shares the _t counter with textContent bindings`: a `textContent` template before a text child takes `_t0` and the child `_t1`.
- `refuses a runtime-only text child of a raw-text element`: a `textarea` whose child is `"${state.draft}"`, with a handler writing `draft`, throws naming `textarea` and `textContent`; the same element with `textContent: "${state.draft}"` compiles.
- `a plain text child emits no marker and no walker`: the HTML has no `jx-text` and the module has no `createTreeWalker`.

**`packages/compiler/tests/client-text-children.test.ts`** (new; executes the emitted module): write `compileClient`'s module to `tests/__test-client-text__/app.js`, set up a happy-dom `Window` and copy its globals as `branch-subtree-hoisting.test.ts` does, put the compiled `<body>` markup in `document.body`, and `await import()` the module once. The document holds `#live` (`["Hello ${state.name}", <button onclick → rename>]`, `rename` writing `state.name = "Ada"`) and `#baked` (`["Total: ${state.total}", { tagName: "b", textContent: "!" }]`, `total: 3`, never written).

- `a runtime-only text child is filled at hydration and follows state`: `#live`'s text reads `Hello World` after import and `Hello Ada` after a `click` on the button; the button is the same instance throughout, and the separator `Text` node before it survives.
- `a prerendered text node is reused, not duplicated`: the `Text` node after `#baked`'s opening comment, captured before the import, is still the node there afterwards, and `#baked.textContent` holds `Total: 3` once.

The temporary directory sits under `tests/`, which `coveragePathIgnorePatterns` already excludes, and is removed in `afterAll`.

**`packages/compiler/tests/site-build.test.ts`**:

- New `describe("buildSite — template text children")`, one project (`name: "Text Kids"`) with two pages.
  - `pages/index.json`, stateless apart from `stamp: { default: "today", timing: "compiler" }`, title `Home`, children `["Site: ${state.$site.name} / ${state.$page.title}", { tagName: "p", textContent: "T: ${state.$page.title}" }, { tagName: "p", children: ["Built ${state.stamp}", { tagName: "b", textContent: "!" }] }]`. `bakes build-time text children and stays static`: `dist/index.html` holds `Site: Text Kids / Home`, `T: Home` and `Built today`, no `${` and no `jx-text`, and `dist/app.js` does not exist.
  - `pages/live.json`, the Context example. `keeps a runtime-only text child bound`: `dist/live/index.html` holds `<!--jx-text:_t0--><!--/jx-text-->`, and `dist/live/app.js` holds `` `Hello ${state.name}` ``.
- `describe("buildSite — rich map template expansion")`: the map template's `children` gain `"Tag: ${item.id}"`, and the existing case asserts `Tag: 1` and `Tag: 2`.
- The i18n case "gives each route the lang its prefix declares, and dir only when it earns it" builds `pages/index.json` with the text child `"${$page.locale}"` and claims "the resolved locale is readable from a template" with `toContain("en")`, which `lang="en"` satisfies while the page ships the template literally today. It gains `expect(html("index.html")).not.toContain("${$page.locale}")`, which fails before this change and passes after.

`packages/compiler/tests/compile-static.test.ts` is unchanged: the static target is not.

Coverage: `packages/compiler/bunfig.toml` gates every file at lines 0.982 and functions 0.98. The cases above reach every new line in `shared.ts`, `site-build.ts` and `compile-client.ts`, including `textChildValue`'s `null` return (the runtime-only page) and the marker branch of `emitClientModule`. No source file is added, so `bun scripts/check-coverage-manifest.ts packages/compiler` has nothing new to find; raise the threshold only if a touched file becomes the workspace's new minimum above the bar.

## Specs & docs

**compiler.md §2.1**, in place: after "No `${}` template strings in any property value" add the bullet "No `${}` template string among its `children` (a template text child, §2.2)"; the trailing marker's `shared.js` becomes `packages/compiler/src/shared.ts`.

**compiler.md §2.2**, in place: replace the Partial blockquote with

```markdown
> **Status: Implemented.** `isDynamic` in `packages/compiler/src/shared.ts`; `resolveDocTemplates` and `expandMapTemplate` in `packages/compiler/src/site/site-build.ts`; `buildClientNode` and `emitClientModule` in `packages/compiler/src/targets/compile-client.ts`; `packages/compiler/tests/compile-client.test.ts`, `client-text-children.test.ts`, `site-build.test.ts`.
```

and the body paragraph with:

"Bare strings and numbers in `children` arrays compile to text nodes in all three output tiers, with no wrapper element (`compile-element.ts`, `compile-static.ts` and `compile-client.ts` each handle a string child). A template string among them (`"Hello ${state.name}"`) is a template like any other (spec.md §6) and gets what a `textContent` template gets, since the two are one construct written two ways. The site build bakes it when it reads only build-time values, under §8.1's rules, and inside a repeater expanded at build time it resolves per item. One that survives makes its document dynamic (§2.1), so the static target never meets one. The client target emits it between two comments, `<!--jx-text:_tN-->…<!--/jx-text-->`, holding whatever prerender could resolve, and `hydrate()` keeps the text node after the opening comment current with an `effect()`; the comments are what bind a text node without a wrapper and without touching its element siblings. Inside a lit-rendered region (a mapped array, a `$switch` case, or children mixed with a repeater) and in the element target (§4.3) it is a hole in the lit template. The client target refuses one it would have to bind inside `script`, `style`, `textarea` or `title`, whose content HTML reads as text, so no comment can mark it there; `textContent` binds those elements. A whole-`children` template string is not a text child: spec.md §8.4 resolves it once, at build time."

**compiler.md §9.1**, in place: the bullet "`effect()` bindings for reactive properties" becomes "`effect()` bindings for reactive properties and template text children (§2.2)"; the trailing marker's `compile-client.js` becomes `compile-client.ts`.

**Fragment**: `bun run spec:change compiler.md minor -m "§2.2: a template string written as a text child is baked by the site build when it reads only build-time values, makes its page dynamic otherwise (§2.1 now counts it), and is bound by the client target between two comment markers with no wrapper element, or refused where HTML reads an element's content as text; §2.2 is Implemented."`

This plan does not graduate compiler.md: §2, §3, §4.3 and the rest stay open.

**Docs** (no em dashes). No page's `spec:` cites `compiler.md#2.2`. `docs/framework/build.md` cites `compiler.md#2.1` and `#9.1` and lists all three changed files, and changes:

- "Static detection": the second bullet becomes "a `${…}` template string in a property, style, or attribute value, or written as a text child in `children`".
- "What compiles away": after the heading example, add "A template written as a text child compiles away the same way: `"children": ["Welcome to ${state.$site.name}"]` becomes plain text in the HTML."
- "Dynamic pages": "marks bound elements with `data-bind` attributes" becomes "marks bound elements with `data-bind` attributes and each bound text child with a pair of HTML comments (text never gets a wrapper element)".

`bun run docs:sync` also names `docs/framework/concepts/elements.md` (`shared.ts`), whose "Template strings in text nodes are reactive" becomes true in every tier with no edit, and `functions.md`, `styling.md`, `color-schemes.md`, `site/redirects.md`, `site/deployment.md` and `site/seo.md`, which describe behaviour this plan does not touch.

## Acceptance

- `cd packages/compiler && bun test --isolate --coverage`: green, every file at or above lines 0.982 and functions 0.98, the new cases included.
- `bun scripts/check-coverage-manifest.ts packages/compiler`, `bun run typecheck`, `bun run lint`: green.
- A scratch project with the Context's stateless page (`buildSite`): `dist/index.html` holds the resolved site name and page title where it held `${state.$site.name}`, and no `dist/app.js` is written.
- `grep -n "jx-text" packages/compiler/src/targets/compile-client.ts` shows the marker pair in `buildClientNode` and the comment pass in `emitClientModule`; `grep -n "textChildValue" packages/compiler/src/site/site-build.ts` shows it in `resolveDocTemplates` and `expandMapTemplate`.
- `bun run plans:status --spec compiler` no longer lists §2.2.
- `bun run docs:status`, `bun run docs:spec-release` (the fragment is present), `bun run plans:check`, `bun run docs:check`, `bun run docs:prose`, `bun run docs:links`: green.
