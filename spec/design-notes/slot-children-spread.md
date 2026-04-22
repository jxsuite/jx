# Design Analysis: Slots, `children` vs `childNodes`, and `$spread`

**Date:** 2026-04-10
**Context:** Evaluating [site-architecture.md](../site-architecture.md) §5 against existing implementations

---

## 1. Slot Implementation: `<slot>` Element vs `$slot` Directive

### Current Implementation — `tagName: "slot"` (Web Components Standard)

The existing system uses the **HTML `<slot>` element** directly:

```json
{
  "tagName": "card-component",
  "children": [
    {
      "tagName": "header",
      "children": [{ "tagName": "slot", "attributes": { "name": "header" } }]
    },
    { "tagName": "main", "children": [{ "tagName": "slot" }] }
  ]
}
```

**Consumer targeting:**

```json
{ "tagName": "h1", "attributes": { "slot": "header" }, "textContent": "Title" }
```

**Runtime behavior:** `distributeSlots()` captures host children, partitions by `slot` attribute, and distributes to matching `<slot>` elements. Fallback content is preserved when no consumers provide content.

### Proposed — `$slot` / `$slotTarget` Directives

The site-architecture spec proposed a `$slot` directive:

```json
{ "$slot": "default" }
{ "$slot": "sidebar" }
```

With page-side targeting via `$slotTarget`:

```json
{ "$slotTarget": "sidebar", "tagName": "nav", ... }
```

### Comparative Analysis

| Criterion                  | `tagName: "slot"`                                                                                           | `$slot` / `$slotTarget`                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Standards alignment**    | Exact match to [HTML `<slot>` spec](https://html.spec.whatwg.org/multipage/scripting.html#the-slot-element) | Novel invention                              |
| **Runtime support**        | Implemented (`distributeSlots()`)                                                                           | Not implemented                              |
| **Compiler support**       | Passthrough (compiled like any element)                                                                     | Not implemented                              |
| **Scope**                  | Custom elements only (shadow DOM boundary)                                                                  | Layout → page composition (build-time)       |
| **Fallback content**       | `<slot>` children serve as fallback                                                                         | Not specified                                |
| **Named slots**            | `attributes.name` / `attributes.slot` (standard)                                                            | `$slot` / `$slotTarget` (novel)              |
| **Render timing**          | Runtime (DOM manipulation)                                                                                  | Build-time (compiler resolves before output) |
| **Multiple default slots** | No (standard: one unnamed slot)                                                                             | No (same rule)                               |

### Recommendation: **Unify on `tagName: "slot"`**

The `<slot>` element is a W3C standard. Jx's philosophy is DOM-first — property names mirror the DOM API. Using `{ "tagName": "slot" }` for **both** custom element slots and layout injection points is the right call.

**The key insight:** Layouts are just "custom elements that wrap pages." The same slot distribution mechanism should apply.

#### Unified Approach

**Layout** (declares slots via standard `<slot>` elements):

```json
{
  "tagName": "html",
  "children": [
    {
      "tagName": "head",
      "children": [
        { "tagName": "meta", "charset": "utf-8" },
        { "tagName": "title", "textContent": "${$page.title ?? $site.name}" }
      ]
    },
    {
      "tagName": "body",
      "children": [
        { "$ref": "../components/header.json" },
        {
          "tagName": "aside",
          "children": [{ "tagName": "slot", "attributes": { "name": "sidebar" } }]
        },
        {
          "tagName": "main",
          "children": [{ "tagName": "slot" }]
        },
        { "$ref": "../components/footer.json" }
      ]
    }
  ]
}
```

**Page** (targets slots via standard `slot` attribute):

```json
{
  "$layout": "../layouts/docs.json",
  "children": [
    {
      "tagName": "nav",
      "attributes": { "slot": "sidebar" },
      "children": [{ "tagName": "a", "href": "/docs/intro", "textContent": "Intro" }]
    },
    {
      "tagName": "article",
      "children": [{ "tagName": "h1", "textContent": "Documentation" }]
    }
  ]
}
```

**What changes:**

- `$slot` directive → replaced by `{ "tagName": "slot" }` (existing)
- `$slotTarget` directive → replaced by `attributes.slot` (existing)
- Two keywords eliminated. Zero new keywords for slots.
- Fallback content works for free (slot children = fallback, per the standard)
- Named slots work for free (`attributes.name` on the slot, `attributes.slot` on the consumer)

**At build time:** The compiler performs the same `distributeSlots()` logic the runtime already does — just at compile time instead of DOM time. The algorithm is identical. This is the same pattern as Astro's `<slot />` and `<slot name="sidebar" />`, which are also standard HTML slot elements resolved at build time.

**What we lose:** Nothing. The `$slot`/`$slotTarget` proposal was a reinvention of an existing standard that Jx already implements.

---

## 2. `children` vs `childNodes` — Technical Analysis

### The DOM API Distinction

In the browser DOM, these are two different properties:

| Property           | Type             | Contents                                                                     |
| ------------------ | ---------------- | ---------------------------------------------------------------------------- |
| `Node.childNodes`  | `NodeList`       | **All** child nodes: elements, text nodes, comments, processing instructions |
| `Element.children` | `HTMLCollection` | **Only** child elements (excludes text, comments)                            |

This distinction is meaningful in the DOM because text like `"Hello "` between tags becomes a `Text` node — a child node but not a child element.

### In Jx, the Distinction Doesn't Apply

Jx documents are JSON. There is no interleaving of text and element nodes at the same structural level. A Jx child is always an object with a `tagName` (an element definition). Text is a property (`textContent`) of an element, not a sibling node.

```json
{
  "tagName": "div",
  "children": [
    { "tagName": "span", "textContent": "Hello" },
    { "tagName": "span", "textContent": "World" }
  ]
}
```

There's no `Text` node sitting as a peer of those spans. The Jx model is element-only at the child array level. Therefore, `children` (element-only) is the **technically correct** mapping.

### Current Codebase Usage

| Context                      | `children`                          | `childNodes`         |
| ---------------------------- | ----------------------------------- | -------------------- |
| Main spec (`spec/spec.md`)   | **13 occurrences**                  | **0**                |
| Runtime (`runtime.js`)       | **15 occurrences** (as Jx property) | **1** (DOM API only) |
| Compiler (all `*.js`)        | **42 occurrences**                  | **0**                |
| All examples (`.json` files) | **Exclusive**                       | **0**                |
| Tests                        | **Exclusive**                       | **0**                |
| `RESERVED_KEYS` set          | **Yes** (`"children"`)              | **No**               |
| Site-architecture spec       | **0**                               | **20 occurrences**   |

The site-architecture spec is the **only** place in the entire codebase using `childNodes`. Everything else — spec, runtime, compiler, examples, tests, reserved keys — uses `children`.

### Arguments For Each

#### Case for `childNodes`

- Sounds more "complete" — includes the notion of all nodes
- `childNodes` is the more fundamental DOM property (`Node` level vs `Element` level)
- Visually longer, arguably more explicit

#### Case for `children`

- **Already canonical.** Used in the spec, runtime, compiler, every example, and every test. Changing would require modifying 170+ occurrences across the entire codebase.
- **Technically accurate.** Jx child arrays contain only element definitions, not text/comment nodes. `children` (element-only) is the correct DOM API counterpart.
- **Shorter.** JSON is already verbose; brevity helps. `"children"` saves 4 chars per occurrence × hundreds of occurrences across a project.
- **Already in `RESERVED_KEYS`.** The runtime explicitly reserves `"children"` — adding `"childNodes"` as an alias creates ambiguity.
- **Established convention.** React uses `children`, Vue uses default slot children, Preact uses `children`. The web component ecosystem standardized on this term for "the stuff inside."

### Recommendation: **Keep `children`**

`children` is technically correct (Jx arrays are element-only), is already the universal term across the codebase, and changing to `childNodes` would require rewriting the spec, runtime, compiler, every example, and every test for a property name that implies a capability (mixed node types) that Jx doesn't have.

The site-architecture spec should be updated to use `children` consistently.

---

## 3. `$spread` Operator — Consistency Analysis

### Existing `$`-Prefix Patterns

The `$` prefix in Jx follows the JSON Schema 2020-12 convention where `$`-prefixed keywords have special structural meaning. Jx's existing `$`-keywords fall into clear categories:

#### Category A: JSON Schema Standard Keywords

| Keyword   | Standard                       | Purpose                |
| --------- | ------------------------------ | ---------------------- |
| `$schema` | JSON Schema 2020-12            | Dialect identifier     |
| `$id`     | JSON Schema 2020-12            | Component identifier   |
| `$defs`   | JSON Schema 2020-12            | Type definitions       |
| `$ref`    | JSON Schema 2020-12 / RFC 6901 | JSON Pointer reference |

#### Category B: Jx Structural Directives

| Keyword      | Purpose                      | Position               |
| ------------ | ---------------------------- | ---------------------- |
| `$prototype` | Type/class discriminator     | Inside a `state` entry |
| `$src`       | External module path         | Inside a `state` entry |
| `$export`    | Named export identifier      | Inside a `state` entry |
| `$props`     | Cross-component bindings     | Root level             |
| `$elements`  | Custom element registrations | Root level             |
| `$switch`    | Conditional rendering        | Child position         |
| `$media`     | Named media breakpoints      | Root level             |
| `$map`       | Map iteration context        | Reference path segment |

#### Category C: Site-Architecture Proposed

| Keyword       | Purpose                   | Position        |
| ------------- | ------------------------- | --------------- |
| `$layout`     | Layout document reference | Root level      |
| `$head`       | Head element declarations | Root/page level |
| `$paths`      | Dynamic route generation  | Root level      |
| `$slot`       | Content injection point   | Child position  |
| `$slotTarget` | Slot targeting directive  | Child element   |
| `$spread`     | Inline array expansion    | Child position  |

### Evaluating `$spread`

**What `$spread` does in the spec:**

```json
{
  "tagName": "head",
  "children": [
    { "tagName": "meta", "charset": "utf-8" },
    { "$spread": "$page.$head" },
    { "$spread": "$site.$head" }
  ]
}
```

It takes an array of elements and "splices" them inline into the `children` array at that position.

**Pattern consistency check:**

1. **`$` prefix** — Consistent. All structural directives use `$`.
2. **Object-as-directive** — The `{ "$spread": "..." }` form is an object in a `children` array that isn't an element definition. This is the same pattern as `$switch`:
   ```json
   { "$switch": { "$ref": "#/state/route" }, "cases": { ... } }
   ```
   Both are "special objects" in child position that resolve to element(s) at compile/render time.
3. **Value is a reference expression** — `"$page.$head"` uses dot notation. This is inconsistent with the existing `$ref` pointer syntax which uses JSON Pointer (`"#/state/foo"`).

### Alternative: Use `$ref` with Spread Semantics

Actually, we may not need `$spread` at all. Consider: what `$spread` does is resolve a reference to an array and inline its members. This is arguably just a `$ref` that resolves to an array:

```json
{
  "tagName": "head",
  "children": [
    { "tagName": "meta", "charset": "utf-8" },
    { "$ref": "#/$page/$head" },
    { "$ref": "#/$site/$head" }
  ]
}
```

If `$ref` in a child position resolves to an array, the runtime/compiler could flatten it automatically. This is consistent with how `$ref` already works — it resolves a reference and injects the result. If the result is an array of elements, they spread naturally.

However, there's a semantic question: `$ref` currently always resolves to a single value. Overloading it to sometimes return "many things that get spliced in" could surprise users.

### Alternative: Compiler-Only Resolution

Since `$head` merging is purely a build-time concern (the compiler assembles `<head>` content), `$spread` might not need to be a general-purpose runtime operator at all. The compiler could handle `$head` merging as a special pass without introducing `$spread` to the language.

### Recommendation: **`$spread` is valid but may be premature**

If we accept `$spread` as a general operator, it is consistent with the existing pattern (object-in-child-position, `$`-prefixed directive, resolves at build time).

However:

1. The value syntax (`"$page.$head"`) should use JSON Pointer for consistency: `{ "$spread": { "$ref": "#/$page/$head" } }` — or better yet, keep it simple and just use the dotted form if we establish that as a context-specific convention for the site-architecture layer.
2. `$spread` could be deferred — `$head` merging can be implemented as a compiler pass that doesn't require a user-facing operator in the spec. The layout doesn't need to explicitly `$spread` — the compiler knows to merge heads by convention.

**If we keep `$spread`, the cleanest form would be:**

```json
{ "$spread": { "$ref": "#/$page/$head" } }
```

This composes the existing `$ref` mechanism (which the runtime already resolves) with a new "inline the results" directive, rather than inventing a second reference syntax.

---

## 4. Standards Alignment Opportunities

Beyond Astro conventions, these established standards could inform the site-level architecture:

### Web Standards

| Standard                                  | Relevance                                              | Current Use                                                                                               |
| ----------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **HTML `<slot>`**                         | Content projection in layouts and custom elements      | Already implemented; should unify layout slots                                                            |
| **JSON Schema 2020-12**                   | Collection schemas, site config validation             | Already used for `$defs`; natural for `project.json `collections``                                        |
| **JSON Pointer (RFC 6901)**               | All `$ref` values                                      | Already used                                                                                              |
| **URI Reference (RFC 3986)**              | `$layout`, `$src`, media paths                         | Already used for `$src` and `$ref`                                                                        |
| **HTTP `Link` header / `<link>` element** | `$head` entries for SEO, preload, icons                | Proposed in site-architecture                                                                             |
| **Schema.org / JSON-LD**                  | Structured data in `$head`                             | Proposed in site-architecture §8.5                                                                        |
| **WHATWG URLPattern**                     | Route matching syntax for redirects and dynamic routes | Adopted — `:param` and `*` syntax already conforms (see [wintertc-evaluation.md](wintertc-evaluation.md)) |
| **Sitemap Protocol**                      | `sitemap.xml` generation                               | Proposed in site-architecture                                                                             |
| **`robots.txt` standard**                 | SEO                                                    | Convention (in `public/`)                                                                                 |

### Emerging / Adjacent Standards

| Standard                        | Relevance                                                    | Recommendation                                                                               |
| ------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Import Maps**                 | Module resolution — could map component aliases              | Consider for `$elements` resolution                                                          |
| **Web App Manifest**            | PWA support, `manifest.webmanifest`                          | Could be generated from `project.json`                                                       |
| **Open Graph Protocol**         | Social media metadata                                        | Already in `$head` proposal                                                                  |
| **RSS 2.0 / Atom**              | Feed generation from content collections                     | Worth adding to build pipeline                                                               |
| **HTTP Redirects (301/302)**    | Redirect semantics                                           | Already in `project.json` proposal                                                           |
| **WinterTC Minimum Common API** | Server-side runtime API surface for `$prototype` portability | Validated — existing prototypes align (see [wintertc-evaluation.md](wintertc-evaluation.md)) |

### Key Principle

The site-architecture layer introduces concepts that don't have direct DOM API equivalents (routing, layouts, content collections). Where no web standard exists, Astro conventions serve as reasonable prior art. Where web standards **do** exist (HTML `<slot>`, JSON Schema, JSON Pointer, URI Reference, URLPattern), they should take absolute precedence.

The `<slot>` unification and URLPattern adoption are the two biggest wins — `<slot>` eliminates two novel keywords in favor of a W3C standard, and URLPattern grounds the redirect/routing syntax in a WHATWG standard at zero migration cost.
