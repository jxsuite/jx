---
status: stub
disposition: reconcile
claims:
  - site-architecture.md#10.7
  - site-architecture.md#14.1
  - site-architecture.md#14.2
size: S
---

# The build-output prose names the component CSS and redirect files the build writes

## Context

`specs/site-architecture.md` §10.7, line 1446:

> **Status: Partial.** The order ships (`packages/site/src/site-style.ts`, `packages/compiler/src/shared.ts`, and `injectComponentScripts` in `packages/compiler/src/site/site-build.ts`, which emits component CSS last in `<head>`). Item 6 does not hold as written: components render into light DOM by default, but a component may opt into a shadow root (`$shadow`, or `defaults.shadow` for a project; `packages/compiler/src/shadow.ts`, `spec.md` §16.6), and a shadow component's stylesheet is linked inside its declarative shadow root rather than joining this cascade.

§14.1, line 1886:

> **Status: Partial.** The four adapters and their worker output ship as §14.1.1 records. The table's `_redirects` entries do not match: the build writes `dist/_redirects` whenever `redirects` is non-empty, under every adapter and with none (`generateRedirects` in `packages/compiler/src/site/site-build.ts`), not only for the two Cloudflare adapters.

§14.2, line 1936:

> **Status: Partial.** The artifacts in the tree ship (`buildSite` in `packages/compiler/src/site/site-build.ts`). Two statements do not match: `_redirects` is written under every adapter whenever `redirects` is non-empty rather than being platform-specific (§14.1), and pages do not link component stylesheets: light-DOM component CSS is inlined into one `<style>` block at the end of `<head>` (`injectComponentScripts`), and `/components/<tag>.css` is linked only from inside a shadow component's declarative shadow root (§10.7).

All three sections were unmarked before the census, and the first audit listed them as verified; a review found the stale sentences. They are one plan because §14.2 carries both halves: the component-CSS delivery that §10.7 also describes, and the `_redirects` placement that §14.1's table also describes. An anchor has one owner, so the two decisions share it.

Disposition `reconcile`: both behaviours are deliberate and recorded in the code. `injectComponentScripts` explains the inlining ("a render-blocking request per component", measured on jxsuite.com's home page), and shadow mode is specified in spec.md §16.6. `generateRedirects` writes `_redirects` plus an HTML fallback for every host because the fallback is what a host that ignores `_redirects` serves (§11.3).

**What exists**

- `injectComponentScripts` in `packages/compiler/src/site/site-build.ts` (the inlined `<style>` block) and the declarative shadow root it builds with the component `<link>`; `packages/compiler/src/shadow.ts` and `packages/compiler/tests/shadow-dom.test.ts`.
- `generateRedirects` and `REDIRECT_HTML_POLICY` in `packages/compiler/src/site/site-build.ts`, gated on `redirects` alone, with `packages/compiler/tests/site-build.test.ts`.

**What is missing**

- §10.7 item 6 rewritten: light DOM by default and scoped by tag-name prefix and generated classes; a `$shadow` component's sheet is scoped to its shadow root and sits outside this cascade.
- §14.2's closing paragraph rewritten to the inlined `<style>` block and the in-shadow-root link, and its tree's `_redirects` annotation corrected.
- §14.1's table: `_redirects` moved out of the two Cloudflare rows into a note that it is written for every adapter whenever `redirects` is set.

**Related**

- site-architecture.md §11.1 and site-architecture.md §11.3 (redirect output and its HTML fallback), site-architecture.md §12.4 (the asset pipeline, which already states the inlining).
- spec.md §16.6 (light DOM rendering and the shadow opt-in).
