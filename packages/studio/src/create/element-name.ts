/**
 * What makes a component's tag name usable, decided once.
 *
 * Two rules used to answer this and they disagreed: Convert to Component accepted
 * `/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/`, which refused `x-card.v2` and `my_el-x`, and the Library's
 * component seed accepted `/^[a-z][\d.a-z]*-[\d.a-z-]*$/`, which allowed a trailing hyphen the
 * first refused. Neither was the rule the browser applies, which is the only one that matters: a
 * definition whose tag `customElements.define` rejects is a component nothing can register. So this
 * module states HTML's own production — the [valid custom element
 * name](https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name) —
 * and every creation flow asks it: Add new (`create/add-new.ts`) and Convert to Component
 * (`editor/convert-to-component.ts`).
 *
 * The DERIVER is the other half. A name the reader typed as a title ("Pricing table") becomes a tag
 * (`pricing-table`), and a name with no hyphen gains a `site-` prefix rather than being refused,
 * because "Hero" is a perfectly good thing to call a component and a refusal there teaches nothing
 * but the syntax of a rule the app can satisfy itself (`specs/studio.md` §9.1.1).
 *
 * DOM-free, so the command records and the pure derivation can import it in a bare Bun process.
 *
 * @docs studio/design/components
 */

import { slugify } from "../files/new-file-name";

/** The prefix a hyphenless slug gains, so the derived tag is a valid custom element name. */
export const TAG_PREFIX = "site-";

/**
 * Names HTML reserves: they match the production but are SVG and MathML elements that predate it,
 * so `customElements.define` refuses each one.
 */
export const RESERVED_ELEMENT_NAMES: ReadonlySet<string> = new Set([
  "annotation-xml",
  "color-profile",
  "font-face",
  "font-face-format",
  "font-face-name",
  "font-face-src",
  "font-face-uri",
  "missing-glyph",
]);

/**
 * HTML's `PCENChar`: the characters a potential custom element name may hold after its first
 * letter. ASCII upper case is deliberately absent, which is why a tag name is lower case.
 */
const PCEN_RANGES: readonly (readonly [number, number])[] = [
  [0xb7, 0xb7],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x3_7d],
  [0x3_7f, 0x1f_ff],
  [0x20_0c, 0x20_0d],
  [0x20_3f, 0x20_40],
  [0x20_70, 0x21_8f],
  [0x2c_00, 0x2f_ef],
  [0x30_01, 0xd7_ff],
  [0xf9_00, 0xfd_cf],
  [0xfd_f0, 0xff_fd],
  [0x1_00_00, 0xe_ff_ff],
];

/** A code point as a `u`-flag regular expression escape, so no invisible character is in source. */
function escapeCodePoint(cp: number): string {
  return `${String.fromCodePoint(92)}u{${cp.toString(16)}}`;
}

/** The whole class body: ASCII first, then each range by its escaped ends. */
const PCEN_CHAR = [
  String.raw`\-.0-9_a-z`,
  ...PCEN_RANGES.map(([from, to]) => `${escapeCodePoint(from)}-${escapeCodePoint(to)}`),
].join("");

/** One character that may appear after the first letter. */
const ONE_PCEN_CHAR = new RegExp(`^[${PCEN_CHAR}]$`, "u");

/**
 * The sentence a tag name earns, or `""` when it is valid.
 *
 * Each sentence names the one thing to change, in the order a reader fixes them: say something,
 * start with a letter, lose the character the browser refuses, add the hyphen, avoid a reserved
 * name.
 */
export function customElementNameProblem(name: string): string {
  if (name === "") {
    return "Enter a tag name.";
  }
  if (!/^[a-z]/.test(name)) {
    return "A tag name starts with a lower-case letter.";
  }
  for (const char of name.slice(1)) {
    if (!ONE_PCEN_CHAR.test(char)) {
      return /[A-Z]/.test(char)
        ? "A tag name is lower case."
        : `“${char}” cannot appear in a tag name.`;
    }
  }
  if (!name.includes("-")) {
    return "A tag name needs a hyphen, such as my-card.";
  }
  if (RESERVED_ELEMENT_NAMES.has(name)) {
    return `<${name}> is reserved by HTML.`;
  }
  return "";
}

/**
 * The tag a display name derives to: slugified, its hyphens tidied, and prefixed with
 * {@link TAG_PREFIX} when it would otherwise have no hyphen or would start with a digit.
 *
 * `"Pricing table"` → `pricing-table`, `"Hero"` → `site-hero`, `"2 columns"` → `site-2-columns`,
 * and a name with nothing usable in it → `""`, which {@link customElementNameProblem} refuses.
 */
export function deriveTagName(input: string): string {
  const slug = slugify(input).replaceAll(/-+/g, "-").replaceAll(/^-|-$/g, "");
  if (slug === "") {
    return "";
  }
  return /^[a-z]/.test(slug) && slug.includes("-") ? slug : `${TAG_PREFIX}${slug}`;
}
