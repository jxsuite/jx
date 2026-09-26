---
status: stub
disposition: implement
claims:
  - jx-markdown.md#6.6
size: S
workspaces:
  - extensions/parser
---

# A directive's attributes land where the renderers read them, and §6.6 says where that is

## Context

`specs/jx-markdown.md` §6.6, line 237:

> **Status: Partial.** `aria-*`, `data-*` and `slot` reach `attributes`, and the example below is what ships, but the rest of the routing diverges from the text. `directiveToJx` (`extensions/parser/src/transpile.ts`) keeps only `style`, `children`, `textContent`, `innerHTML`, `id`, `className`, `hidden`, `tabIndex`, `lang`, `dir`, `$`-keys and `on*` keys at element level on a standard element, and only `style`, `children`, `textContent`, `innerHTML` and `$`-keys on a custom element; every other key (`type`, `placeholder`, `src`, `href`, and so on) becomes an HTML attribute. On a custom element this sends `className` and `on*` keys to `attributes` as well, where neither the runtime's `applyAttributes` nor the compiler's `buildAttrs` maps them back: the class is written as a literal `className` attribute and the handler is never bound.

The section was unmarked before the census. The item has two halves with one owner, because the text rewrite has to describe the code after the fix:

- **Standard elements: the routing is deliberate and the text is stale.** The code comment names `buildAttrs` as the reason, and `extensions/parser/tests/jx-markdown.test.ts` asserts `type`, `value` and `placeholder` land in `attributes`. Sending `href` or `src` to `attributes` is what keeps them in prerendered HTML, because the static emitter writes only a handful of DOM properties (spec.md §8.1). "All other attributes become top-level DOM properties" is the stale sentence.
- **Custom elements: the branch is a defect.** `className` and `on*` are universal element properties, and routed to `attributes` neither renderer can use them. `buildAttrs` (`packages/compiler/src/shared.ts`) writes `className="x"` into the tag verbatim, which HTML reads as an unknown `classname` attribute; `applyAttributes` (`packages/runtime/src/runtime.ts`, through `canvasAttrName`, which has no `className` mapping) calls `setAttribute("className", …)`; an `on*` value likewise becomes an attribute, not a listener. The only custom-element test (`extensions/parser/tests/transpile.test.ts`, "custom element: structural keys element-level, unknown keys become attributes") uses an unknown key, `variant`, so nothing pins `className`, `id` or `on*`.

Hence `implement`: the custom-element branch changes, and the §6.6 rewrite rides with it.

**What exists**

- `HTML_ATTR_PATTERN` (`/^(?:aria-|data-|slot$)/`) and `routeAttributes` in `extensions/parser/src/transpile.ts`: the first split, into `props` and `attributes`.
- `directiveToJx` in the same file: the second split, by element kind, with the two key lists the marker names.
- Tests: "maps directive attributes to HTML attributes for standard elements" and "routes aria-\* and data-\* to attributes sub-object" in `extensions/parser/tests/jx-markdown.test.ts`; the `variant` test above.
- Measured at b900b326, with `serializeJxMarkdown` then `transpileJxMarkdown`: `{ tagName: "my-card", className: "x", id: "c1" }` is written as `::my-card{#c1 className="x"}` and comes back as `attributes: { id: "c1", className: "x" }`; `{ tagName: "my-card", onclick: { $ref: "#/state/go" } }` comes back as `attributes.onclick`. Every Studio save of a `.md` component with a classed custom element does this (jx-markdown.md §12.8).

**What is missing**

- The custom-element branch keeps `className`, `id` and `on*` at element level, as the standard branch does, with tests for all three through `transpileJxMarkdown` and through a `serializeJxMarkdown` → `transpileJxMarkdown` string round trip.
- §6.6 rewritten to the two-stage rule, per element kind, with the property lists named once.
- The one real decision: whether the standard-element list tracks `buildAttrs` (`packages/compiler/src/shared.ts`) by construction or stays a second hand-kept copy; the two differ on `title` today. The same decision settles `value` and `checked`: routed to `attributes`, a bound value sets the control's default, which stops tracking once the user edits the control, so a Jx `value` or `checked` property that goes through a markdown round trip changes meaning.
- docs/framework/site/jx-markdown.md repeats "everything else becomes a top-level DOM property" and changes with the spec.

**Related**

- jx-markdown.md §12.8 (roundtrip losslessness; its marker lists the custom-element loss, and the plan that owns it requires this one).
- spec.md §8.1 (DOM property mapping, and the static emitter's short property list), spec.md §8.3 (custom attributes, the `attributes` object this routing fills).
- jx-markdown.md §6.1 and §6.2 (the attribute syntax and `$`-keyword mapping ahead of this routing), jx-markdown.md §12.5 (names `routeAttributes`).
- parser.md §7 (the directive mapping, summarised).
