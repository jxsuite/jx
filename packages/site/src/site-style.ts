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
 */

import {
  buildStyleRules,
  isDeclarationAtRule,
  isKeyframesAtRule,
  isNestedSelectorKey,
  pureSchemeOf,
} from "@jxsuite/runtime/css";
import type { JxStyle } from "@jxsuite/schema/types";

/** Id of the injected site-style tag (replace-in-place, never accumulate). */
export const SITE_STYLE_ID = "jx-site-style";

/**
 * Build the site-style sheet text: custom properties on `:root`, plain properties on `body`,
 * conditional `@`-blocks resolved against `mediaQueries` (scheme queries dual-emitted per the
 * forced-scheme contract), and `color-scheme: light dark` declared when a scheme query exists.
 *
 * The `:root` / `body` split is the one decision this builder owns; everything after it is handed
 * to `buildStyleRules`, which is the single definition of what a Jx style object means as CSS. That
 * is what makes a nested selector inside a conditional block compose rather than flatten to one
 * level, and what makes a host and the compiled page agree about a `@supports` block.
 *
 * @param {Record<string, unknown>} siteStyle
 * @param {Record<string, string>} mediaQueries
 * @param {(value: string) => string} transpose - Unit transposer (canvas vh→cqh etc.)
 * @returns {string}
 */
export function buildSiteStyleCSS(
  siteStyle: Record<string, unknown>,
  mediaQueries: Record<string, string>,
  transpose: (value: string) => string,
): string {
  const rules: string[] = [];
  const push = (style: JxStyle, selector: string | null) => {
    for (const rule of buildStyleRules(style, {
      mediaQueries,
      scope: selector,
      transposeValue: transpose,
    })) {
      rules.push(rule.text);
    }
  };

  const rootProps: JxStyle = {};
  const bodyProps: JxStyle = {};
  const condBlocks: [string, JxStyle][] = [];
  const rootBlocks: [string, JxStyle][] = [];

  for (const [key, value] of Object.entries(siteStyle)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (key.startsWith("@")) {
        condBlocks.push([key, value as JxStyle]);
      } else if (key.startsWith("&")) {
        /* A `&`-prefixed key is a STATE OF THE ROOT, not page content: `&[data-theme="light"]`
           means `:root[data-theme="light"]`, which is how a project forces a scheme. It used to
           fall into the skip below with every other nested selector and was dropped in silence, so
           a site declaring a forced-theme override got a sheet without one. A bare element or
           class key IS page content and is still the resolved document's own business. */
        rootBlocks.push([key, value as JxStyle]);
      }
      // A nested ELEMENT selector is page-content styling — the resolved doc's own style pass
      // Covers those; the site sheet handles tokens and root-level conditional overrides.
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

  push(rootProps, ":root");
  push(bodyProps, "body");

  for (const [key, block] of rootBlocks) {
    push({ [key]: block } as JxStyle, ":root");
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

  if (Object.values(mediaQueries).some((q) => pureSchemeOf(q) !== null)) {
    rules.push(":root { color-scheme: light dark }");
  }

  return rules.join("\n");
}
