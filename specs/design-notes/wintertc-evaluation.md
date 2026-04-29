# WinterTC (TC55) Evaluation for Jx Site Architecture

**Date:** 2025-07-18
**Context:** Evaluating the WinterTC [Minimum Common API](https://min-common-api.proposal.wintertc.org/) as a standards source for Jx's server-side/build-time site-definition schema conventions.

---

## 1. What Is WinterTC?

WinterTC (formally TC55) is an Ecma International technical committee whose mission is to promote **server-side JavaScript runtime interoperability**. Its participants include Cloudflare, Deno, Node.js, Vercel, Netlify, Bun, and others.

Its primary output is the **Minimum Common API** — a curated subset of Web Platform APIs that all conforming server-side runtimes must implement. The goal: code written against these APIs runs identically in Node.js, Deno, Bun, Cloudflare Workers, and edge runtimes.

## 2. Why It Matters to Jx

Jx's `$prototype` system already maps JSON declarations to Web API constructors (`Request`, `URLSearchParams`, `FormData`, `ReadableStream`, `Blob`). The site-architecture spec introduces build-time and server-side concerns (routing, redirects, server functions) that execute outside the browser.

**The WinterTC common API defines the exact set of Web APIs that Jx can safely assume exist in any server-side/build-time runtime.** This means:

1. Any `$prototype` value in the common API is portable across all runtimes
2. Build-time compilation can rely on these APIs without polyfills
3. Server functions (`timing: "server"`) have a guaranteed API surface

## 3. Overlap Analysis

### 3.1 Already Aligned (Jx ↔ WinterTC)

| Jx `$prototype`   | WinterTC API                                                        | Notes                                                                                             |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Request`         | Fetch API (`Request`, `Response`, `Headers`)                        | Jx already implements reactive Request. Response/Headers are implicit in server function returns. |
| `URLSearchParams` | URL API (`URL`, `URLSearchParams`)                                  | Direct match. Jx implements computed `.toString()`.                                               |
| `FormData`        | Fetch API (`FormData`)                                              | Direct match.                                                                                     |
| `Blob`            | File API (`Blob`, `File`)                                           | Jx implements `Blob`. `File` extends `Blob` — could be added.                                     |
| `ReadableStream`  | Streams API (`ReadableStream`, `WritableStream`, `TransformStream`) | Jx has a stub. WinterTC mandates full Streams.                                                    |

**Conclusion:** Jx's existing `$prototype` namespace is already well-aligned with WinterTC. No changes needed for current prototypes.

### 3.2 New Opportunities

| WinterTC API                      | Relevance to Jx                                            | Recommendation                                                                |
| --------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **`URLPattern`**                  | ★★★ **Critical** — Route matching + redirect patterns      | **Adopt** (see §4)                                                            |
| `URL`                             | ★★☆ — Useful for canonical URL construction in SEO/sitemap | Consider as `$prototype`                                                      |
| `AbortController` / `AbortSignal` | ★★☆ — Build pipeline cancellation, request cancellation    | Already implicit in reactive data sources; no schema change needed            |
| `EventTarget` / `CustomEvent`     | ★☆☆ — Component event dispatch                             | Jx uses DOM events natively in custom elements; no schema-level action needed |
| `TextEncoder` / `TextDecoder`     | ★☆☆ — Build internals only                                 | Implementation detail, not schema-relevant                                    |
| `CompressionStream`               | ★☆☆ — Asset pipeline optimization                          | Build tool concern, not schema                                                |
| `Crypto` / `SubtleCrypto`         | ☆☆☆ — No direct schema relevance                           | Not applicable                                                                |
| `Performance`                     | ☆☆☆ — Profiling only                                       | Not applicable                                                                |

### 3.3 Not Applicable

These WinterTC APIs have no bearing on Jx's declarative schema model:

- **WebAssembly** — binary execution model
- **Sockets API** (in progress) — TCP connections
- **CLI API** (in progress) — argv/env access
- **Web Crypto Streams** — streaming encryption

## 4. URLPattern — The Key Finding

### 4.1 What URLPattern Is

[URLPattern](https://urlpattern.spec.whatwg.org/) is a WHATWG Living Standard that provides a **standardized URL matching API** using a pattern syntax derived from [path-to-regexp](https://github.com/pillarjs/path-to-regexp) (the same library behind Express.js routing).

**It is included in WinterTC's Minimum Common API**, meaning it is available in Node.js, Deno, Bun, and Cloudflare Workers.

### 4.2 Pattern Syntax Comparison

The site-architecture spec currently uses `:param` and `*` wildcard syntax inherited from Astro/Next.js conventions. URLPattern uses the **same foundational syntax** because both derive from path-to-regexp:

| Feature              | Current site-architecture.md | URLPattern Standard |
| -------------------- | ---------------------------- | ------------------- |
| Named parameter      | `/blog/:slug`                | `/blog/:slug`       |
| Multiple params      | `/blog/:year/:slug`          | `/blog/:year/:slug` |
| Wildcard (catch-all) | `/docs/*`                    | `/docs/*`           |
| Optional segment     | Not specified                | `/products/:id?`    |
| Regexp constraint    | Not specified                | `/blog/:id(\\d+)`   |
| Optional group       | Not specified                | `/products/{:id}?`  |

**The syntax is identical for all patterns currently in site-architecture.md.** URLPattern is a strict superset — it adds optional segments, regexp constraints, and explicit grouping that the current spec doesn't use but could benefit from.

### 4.3 URLPattern in JSON Data Formats

Section 4.2 of the URLPattern spec explicitly defines how to **[integrate with JSON data formats](https://urlpattern.spec.whatwg.org/#other-specs-json)** — precisely Jx's use case. It specifies:

- Accept patterns as strings (constructor string syntax) or as `URLPatternInit` objects
- Resolve relative patterns against a base URL
- The `build a URL pattern from an Infra value` algorithm for processing JSON-sourced patterns

This means our redirect/routing syntax is **already compatible** with the URLPattern standard.

### 4.4 Recommendation

**Formally reference URLPattern as the pattern syntax standard for all route matching and redirect rules in Jx.**

This requires no syntax changes to site-architecture.md — the `:param` and `*` patterns already conform. What it does is:

1. **Legitimize the syntax** by grounding it in a WHATWG standard rather than framework convention
2. **Unlock future capabilities** — optional params (`?`), regexp constraints, component-level matching
3. **Enable runtime validation** — the compiler can `new URLPattern(pattern)` to validate redirect rules at build time
4. **Align with ecosystem** — HTML Speculation Rules already use URLPattern for prefetch matching

**Concrete changes:**

- Add a normative reference to URLPattern in site-architecture.md §4 and §11
- Note that redirect pattern strings conform to URLPattern pathname syntax
- Consider adding `URLPattern` to the `$prototype` supported list for advanced matching use cases

### 4.5 URLPattern as `$prototype`

For advanced routing or redirect scenarios, Jx could support:

```json
{
  "state": {
    "blogRoute": {
      "$prototype": "URLPattern",
      "pathname": "/blog/:slug"
    }
  }
}
```

This would compile to `new URLPattern({ pathname: "/blog/:slug" })` — useful for `$switch`-based client-side routing. **Defer this to a future iteration** since it requires runtime support, but it's a natural extension.

## 5. Server Function Interface

### 5.1 Current State

Jx server functions (`timing: "server"`) are compiled to Hono route handlers. The spec doesn't constrain the function signature.

### 5.2 WinterTC Alignment

WinterTC's Minimum Common API mandates the Fetch API (`Request` → `Response`). The idiomatic server-side pattern across all WinterTC-conforming runtimes is:

```js
async function handler(request: Request): Promise<Response> { ... }
```

This is already how Hono handlers work, and how Jx's `$prototype: "Request"` maps. **No changes needed** — Jx is already aligned here.

### 5.3 Recommendation

Document in the server spec that server functions compiled by Jx should conform to the `Request → Response` interface as defined by the Fetch Standard (a WinterTC common API).

## 6. Summary of Recommendations

| Area                             | Action                                                       | Priority                                    |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| **URLPattern**                   | Add normative reference in §4 (routing) and §11 (redirects)  | **High** — standards alignment at zero cost |
| **URLPattern syntax**            | No syntax changes needed — current patterns already conform  | **None** — already compatible               |
| **`URLPattern` as `$prototype`** | Defer — add when client-side routing needs it                | **Low** — future iteration                  |
| **`URL` as `$prototype`**        | Consider adding for canonical URL construction               | **Low** — nice to have                      |
| **Fetch interface**              | Document `Request → Response` as server function convention  | **Medium** — clarifies server.md            |
| **AbortController**              | Already implicit in reactive data sources — no schema change | **None**                                    |
| **EventTarget**                  | No schema-level action — handled by DOM custom elements      | **None**                                    |
| **Other WinterTC APIs**          | Not applicable to schema layer                               | **None**                                    |

## 7. What WinterTC Does NOT Cover

WinterTC standardizes runtime APIs, not:

- File-based routing conventions (no standard — Astro/Next.js are de facto)
- Content collection schemas (no standard — this is Jx's contribution)
- Layout/slot projection (covered by HTML `<slot>` which Jx already uses)
- Build pipeline orchestration (no standard)
- SEO/sitemap generation (no standard)
- i18n conventions (various standards, none for build-time SSG)

These areas remain framework-defined conventions where Jx's Astro-inspired approach is as good as any.

---

**Bottom line:** WinterTC validates Jx's existing `$prototype` design and provides one high-value addition — formally referencing URLPattern as the pattern syntax standard for routing and redirects. The current site-architecture.md syntax is already compliant; the only change is adding the normative reference.
