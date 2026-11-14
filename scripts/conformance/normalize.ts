/**
 * What two conforming builds are allowed to disagree about (scripts/conformance/README.md).
 *
 * A capture is raw: it records what the browser saw. Comparison first rewrites both sides with the
 * rules below, so each rule is a statement that some difference is NOT a difference in behaviour.
 * That makes this file the harness's whole tolerance, in one place, and every rule owes a reason: a
 * rule added to make a comparison pass is a rule that hides the next real regression of the same
 * shape.
 *
 * Rules are applied at comparison time, never at capture time, so a capture taken before a rule
 * existed can be compared again under it.
 */

/** One tolerated difference: what it rewrites, and why that is not behaviour. */
export interface Rule {
  name: string;
  why: string;
  apply: (text: string) => string;
}

/**
 * A class the compiler mints as a style handle: `jx-N` in a page's sheet, `jxs-N` in the block a
 * page collects from slotted content, and `<component-tag>-N` in a component's sheet. A custom
 * element's tag always holds a hyphen, so the third form is a hyphenated name and a number. An
 * author's class of that shape (`col-md-6`) leaves the comparison with it, on both sides alike, and
 * what it does is still compared as computed style and geometry.
 */
const STYLE_HANDLE = /^(?:jxs?|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)-\d+$/u;

export const RULES: readonly Rule[] = [
  {
    apply: (text) => text.replaceAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/gu, ""),
    name: "origin",
    why: "Each capture serves its build on a port the operating system picks.",
  },
  {
    apply: (text) =>
      text.replaceAll(/(\/images\/_optimized\/[^\s"',]*?-\d+)-[0-9a-f]{8}(\.[a-z0-9]+)/gu, "$1$2"),
    name: "variant-hash",
    why: "A variant's name carries a hash of its source and of the pipeline that encoded it (compiler.md §7.2); the picture it names is compared as pixels.",
  },
  {
    apply: (text) => text.replaceAll(/([?&]v=)[0-9a-f]{8}\b/gu, "$1#"),
    name: "cache-buster",
    why: "A `?v=` content hash names bytes, not behaviour.",
  },
  {
    apply: (text) =>
      text.replaceAll(/ class="([^"]*)"/gu, (_whole, list: string) => {
        const kept = list
          .split(/\s+/u)
          .filter((token) => token !== "" && !STYLE_HANDLE.test(token));
        return kept.length > 0 ? ` class="${kept.join(" ")}"` : "";
      }),
    name: "style-handle",
    why: "`jx-N`, `jxs-N` and `<component-tag>-N` are classes the compiler mints to carry an element's own style, named for the sheet that holds its rules (`collectStyles` in packages/compiler/src/shared.ts, spec.md §9.2). Which elements carry one and what number each takes is the compiler's business: every element with a style object has one, so an `id` or a class added to an element renumbers the rest. Its effect is compared as computed style and geometry.",
  },
  {
    apply: (text) => text.replaceAll(/\bjx-island-\d+\b/gu, "jx-island"),
    name: "island-ordinal",
    why: "An island's tag name numbers it in document order (packages/compiler/src/targets/compile-static.ts); which subtree is an island is compared as the DOM under it.",
  },
];

/** Rewrite a recorded line with every rule, or with the rules whose names are given. */
export function normalize(text: string, rules: readonly Rule[] = RULES): string {
  let result = text;
  for (const rule of rules) {
    result = rule.apply(result);
  }
  return result;
}
