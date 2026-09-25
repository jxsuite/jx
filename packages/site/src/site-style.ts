/// <reference lib="dom" />
/**
 * Site-style stylesheet builder — `project.json`'s `style` as a real stylesheet.
 *
 * A host emits the project's `style` as a stylesheet rather than as inline properties on the root
 * element: inline custom properties would defeat the forced-scheme override selectors
 * (`:root[data-color-scheme]`, spec §9.5), and object-valued `@--name` blocks used to be dropped
 * entirely. Scheme-query blocks dual-emit through the runtime's schemeSelectors so a host honors
 * both the OS preference and its own forced-scheme toggle.
 *
 * Two hosts share it, which is why it is here rather than in either of them: the studio canvas,
 * which passes a transposer rewriting viewport units to container units, and the live preview
 * origin, which passes identity because a browser tab IS the viewport.
 *
 * The nesting inside a block is NOT this module's own recursion any more: it delegates to
 * `buildStyleRules`, which the runtime and the compiler also use, so all three agree about what an
 * `@media` inside a selector inside an `@supports` means.
 *
 * The sheet is the build's. `compileStyles` (`@jxsuite/compiler`, `src/shared.ts`) writes the same
 * project block into every built page's `<style>`, and it does so BY CALLING THIS BUILDER — the
 * compiler depends on the site package, so its project half is this function with an identity
 * transposer and a resolver that records what a static build drops. A host that shows a page is
 * showing what the build will ship because the two are one emitter, not because a test says so;
 * `site-style.test.ts` still holds them byte-for-byte, as the guard that keeps the delegation from
 * being undone. It used to be a second copy of the `:root` / `body` / selector / `@`-block split,
 * and the copies disagreed twice: the compiler passed a top-level `&[...]` key through as a raw `&`
 * selector, which no engine matches, and routed a top-level `colorScheme` to `body`, where
 * `light-dark()` on the root cannot see it (#329). The one place the two were DELIBERATELY allowed
 * to differ was a nested element key, on the belief that "the document's own style pass covers page
 * content": nothing else reads `project.json#/style`, so the canvas simply dropped a site's
 * typography and link rules while the build kept them (#296).
 */

import {
  COLOR_SCHEME_ATTR,
  buildStyleRules,
  isDeclarationAtRule,
  isKeyframesAtRule,
  isNestedSelectorKey,
  pureSchemeOf,
} from "@jxsuite/runtime/css";
import type { JxRef, JxStyle } from "@jxsuite/schema/types";

/** Id of the injected site-style tag (replace-in-place, never accumulate). */
export const SITE_STYLE_ID = "jx-site-style";

/**
 * Resolve a reactive declaration — a `${…}` template or a `{ $ref }` — to what the sheet should
 * say, or `null` to emit no declaration. `selector` is the rule it would have landed on (`:root`,
 * `body`, a selector key, or `null` for an unscoped at-rule), which is what a report of a dropped
 * declaration needs to name.
 *
 * The hosts omit it: a canvas or a preview tab has no scope to evaluate a project-level template
 * against, so a reactive project declaration is dropped. The compiler passes a recorder so the same
 * drop is REPORTED by the build (`takeDroppedReactiveStyles`) rather than silent.
 */
export type SiteStyleValueResolver = (
  property: string,
  value: string | JxRef,
  selector: string | null,
) => string | null;

/**
 * Build the site-style sheet text: custom properties on `:root`, plain properties on `body`,
 * selector-keyed blocks (`"h1, h2"`, `a`, `.card`) as rules of their own, `&`-keyed blocks as
 * states of `:root`, conditional `@`-blocks resolved against `mediaQueries` (scheme queries
 * dual-emitted per the forced-scheme contract), and the `color-scheme` hint triplet declared when a
 * scheme query exists and the author has not set `colorScheme` (spec.md §9.5).
 *
 * The `:root` / `body` split is the one decision this builder owns; everything after it is handed
 * to `buildStyleRules`, which is the single definition of what a Jx style object means as CSS. That
 * is what makes a nested selector inside a conditional block compose rather than flatten to one
 * level, and what makes a host and the compiled page agree about a `@supports` block.
 *
 * A selector-keyed block is emitted UNSCOPED, exactly as the build emits it into a page: the
 * project's `style` is the page's stylesheet, so `"h1, h2"` styles every `h1` and `h2` the page
 * holds, not `:root h1`. That is the right answer for both hosts too — the canvas iframe and the
 * live-preview tab each ARE the page, with the project's `$head` in their head and the rendered
 * document as their body — so no host-side prefix is added, and nothing has to know one.
 *
 * @param {Record<string, unknown>} siteStyle
 * @param {Record<string, string>} mediaQueries
 * @param {(value: string) => string} transpose - Unit transposer (canvas vh→cqh etc.)
 * @param {SiteStyleValueResolver} [resolveValue] - What a reactive declaration becomes; absent, it
 *   is dropped, which is what every host does
 * @returns {string}
 * @docs studio/interface/canvas
 */
export function buildSiteStyleCSS(
  siteStyle: Record<string, unknown>,
  mediaQueries: Record<string, string>,
  transpose: (value: string) => string,
  resolveValue?: SiteStyleValueResolver,
): string {
  const rules: string[] = [];
  const push = (style: JxStyle, selector: string | null) => {
    for (const rule of buildStyleRules(style, {
      mediaQueries,
      scope: selector,
      transposeValue: transpose,
      /* The selector is closed over here rather than threaded through `buildStyleRules`, whose own
         hook sees a rule TARGET (self / descendant / unscoped) and not the selector it hangs off;
         the compiler's report names the selector, so this is where it is known. Conditionally
         spread: `exactOptionalPropertyTypes` refuses an explicit `undefined` for an optional hook. */
      ...(resolveValue
        ? { resolveValue: (property, value) => resolveValue(property, value, selector) }
        : {}),
    })) {
      rules.push(rule.text);
    }
  };

  const rootProps: JxStyle = {};
  const bodyProps: JxStyle = {};
  const condBlocks: [string, JxStyle][] = [];
  /* Every block keyed by a selector, in authored order — `&`-keyed root states and element, class
     and attribute selectors alike. ONE list rather than one per kind because the build keeps them
     in one list, and source order is what decides between two rules of equal specificity: a site
     that writes `a { … }` and then `&[data-theme="dark"] a { … }` has said which wins. */
  const selectorBlocks: [string, JxStyle][] = [];

  for (const [key, value] of Object.entries(siteStyle)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (key.startsWith("@")) {
        condBlocks.push([key, value as JxStyle]);
      } else if (!key.startsWith("--")) {
        /* A selector-keyed block is a rule of the page's stylesheet, and this is where the canvas
           used to lose it. `&`-keyed blocks were rescued first — `&[data-theme="light"]` is a STATE
           OF THE ROOT, how a project forces a scheme, and it was dropped in silence — while a bare
           element or class key was still skipped on the stated belief that the resolved document's
           own style pass covered page content. It never did: nothing but this builder and the
           compiler reads `project.json#/style`, and the compiler emits these rules into every
           page. So a site's `"h1, h2"` and `a` rules were in the built output and missing from the
           canvas, which showed headings in the fallback face and links underlined (#296). A block
           under a `--name` key is not a rule at all — a custom property has no block value — and
           is skipped the way the compiler skips it. */
        selectorBlocks.push([key, value as JxStyle]);
      }
      continue;
    }
    if (isNestedSelectorKey(key) || key.startsWith("@")) {
      continue;
    }
    /* Custom properties go to `:root`; so does `color-scheme`, which is the one non-custom
       property that has to. Every semantic token is a `light-dark()` pair, and `light-dark()`
       resolves against the element carrying `color-scheme` — so a scheme declared on `body` leaves
       every token on `:root` resolving against the wrong element, and the site builder disagreeing
       with `installTheme`, which puts the same authored block on `:root`. */
    if (key.startsWith("--") || key === "colorScheme" || key === "color-scheme") {
      rootProps[key] = value as string;
    } else {
      bodyProps[key] = value as string;
    }
  }

  // Base rules precede conditional blocks so equal-specificity overrides win by source order.
  push(rootProps, ":root");
  push(bodyProps, "body");

  for (const [key, block] of selectorBlocks) {
    if (key.startsWith("&")) {
      /* `&` is spliced onto `:root`, so `&[data-theme="light"]` emits `:root[data-theme="light"]`.
         The runtime resolves `&` against a scope and a project block has none but the root. */
      push({ [key]: block } as JxStyle, ":root");
    } else {
      // A top-level selector key IS the selector — `.card` styles `.card`, not `:root .card`.
      push(block, key);
    }
  }

  for (const [atKey, block] of condBlocks) {
    /* An unscoped at-rule has no selector to split across, and the name it declares is
       document-global — one block, not one per target. A split `@keyframes` is the costly case:
       each half is valid CSS, and the last definition of a name replaces every earlier one, so the
       animation silently keeps only the stop that was emitted last. */
    if (isDeclarationAtRule(atKey) || isKeyframesAtRule(atKey)) {
      push({ [atKey]: block }, null);
      continue;
    }
    const condRoot: JxStyle = {};
    const condBody: JxStyle = {};
    const condSubs: [string, JxStyle][] = [];
    for (const [k, v] of Object.entries(block)) {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        if (!k.startsWith("@")) {
          condSubs.push([k, v as JxStyle]);
        }
        continue;
      }
      if (k.startsWith("--")) {
        condRoot[k] = v;
      } else {
        condBody[k] = v;
      }
    }
    push({ [atKey]: condRoot }, ":root");
    push({ [atKey]: condBody }, "body");
    for (const [sel, sub] of condSubs) {
      push({ [atKey]: sub }, sel);
    }
  }

  /* The forced-scheme UA hint, and the same three lines the compiler writes: native widgets,
     scrollbars and form controls follow `color-scheme`, not the author's `light-dark()` tokens, so
     the root attribute has to re-point it as well. An authored `colorScheme` suppresses all three
     (spec.md §9.5). This builder used to emit the first line unconditionally, AFTER the `:root`
     rule that carried the author's own value — same selector, same specificity, later in source —
     so a project declaring `colorScheme: "light"` under a scheme query got `light dark` in every
     host and its own value in the build. */
  if (
    Object.values(mediaQueries).some((q) => pureSchemeOf(q) !== null) &&
    !("colorScheme" in siteStyle)
  ) {
    rules.push(
      ":root { color-scheme: light dark }",
      `:root:where([${COLOR_SCHEME_ATTR}="light"]) { color-scheme: light }`,
      `:root:where([${COLOR_SCHEME_ATTR}="dark"]) { color-scheme: dark }`,
    );
  }

  return rules.join("\n");
}
