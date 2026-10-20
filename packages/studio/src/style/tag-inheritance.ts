/**
 * What a Project Styles tag rule inherits, and from where.
 *
 * `project.json`'s style compiles its flat properties to `body` and each bare tag key to a global
 * rule (`compileStyles`, via `site/site-build.ts`), so an `h1` with no `fontFamily` of its own is
 * set in whatever `body` says, and a `th` under `table` takes `table`'s colour first. The Style
 * panel's own walk (`computeInheritedSources`) only follows ONE coordinate across contexts, which
 * is right for a page element (its ancestors are other nodes, edited elsewhere) and wrong here:
 * every ancestor of a tag rule is in this same file. Without this, an unset inherited row showed
 * the CSS initial value as its placeholder, so Font Family on `h1` read "depends on user agent"
 * while the specimen beside it was drawn in the project's body font.
 *
 * Only properties CSS inherits are walked ({@link INHERITED_PROPERTIES}); `margin` on `body` is not
 * a value an `h1` has.
 *
 * @docs studio/design/stylebook
 */

import { getNestedStyle, isNumber, isString } from "@jxsuite/schema/guards";
import type { JxStyle } from "@jxsuite/schema/types";

/**
 * The properties the Style panel draws (`data/css-meta.json`) that CSS defines as inherited.
 *
 * A list rather than a lookup because the panel bundle carries no CSS property database: the test
 * beside this module holds it to `@webref/css` in both directions, so a property is here exactly
 * when the panel draws it and the specification says `Inherited: yes`.
 */
export const INHERITED_PROPERTIES: ReadonlySet<string> = new Set([
  "color",
  "cursor",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "listStyleType",
  "pointerEvents",
  "textAlign",
  "textShadow",
  "textTransform",
  "visibility",
  "wordBreak",
  "wordSpacing",
]);

/** One inherited value and the rule that supplies it: `body`, or an ancestor tag in the path. */
export interface TagAncestorSource {
  value: string | number;
  donor: string;
}

/** The declarations of `block` that CSS inherits, layered over `into` as coming from `donor`. */
function layerInherited(
  into: Map<string, TagAncestorSource>,
  block: JxStyle | undefined,
  donor: string,
): void {
  for (const [prop, value] of Object.entries(block ?? {})) {
    if (INHERITED_PROPERTIES.has(prop) && (isString(value) || isNumber(value))) {
      into.set(prop, { donor, value });
    }
  }
}

/** The style a tag path addresses (`table th` → `style.table.th`), or undefined when absent. */
function tagBlock(style: JxStyle | undefined, path: readonly string[]): JxStyle | undefined {
  let block = style;
  for (const tag of path) {
    block = getNestedStyle(block, tag);
  }
  return block;
}

/**
 * What the tag at `tagPath` inherits from the rules above it, nearest donor winning: `body` (the
 * flat properties), then each ancestor tag in the path. In a context (`media`, a breakpoint or a
 * scheme block's name without its `@`), each donor's block in that context is layered over its
 * base, which is the order the compiled stylesheet applies them in.
 */
export function tagAncestorSources(
  style: JxStyle,
  tagPath: string,
  media: string | null,
): Record<string, TagAncestorSource> {
  const path = tagPath.split(" ").filter(Boolean);
  const contextStyle = media ? getNestedStyle(style, `@${media}`) : undefined;
  const sources = new Map<string, TagAncestorSource>();
  /* `body` is spelled two ways and both compile to the one rule: the flat properties, and a `body`
     tag key. The tag key is later in the sheet, so it is layered second. */
  const ancestors: string[][] = [[], ...(path[0] === "body" ? [] : [["body"]])];
  for (let depth = 1; depth < path.length; depth += 1) {
    ancestors.push(path.slice(0, depth));
  }
  for (const ancestor of ancestors) {
    const donor = ancestor.at(-1) ?? "body";
    layerInherited(sources, tagBlock(style, ancestor), donor);
    if (contextStyle) {
      layerInherited(sources, tagBlock(contextStyle, ancestor), donor);
    }
  }
  return Object.fromEntries(sources);
}
