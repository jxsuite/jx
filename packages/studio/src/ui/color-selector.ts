/**
 * The project's colour tokens, as a projection.
 *
 * This module used to be a CONTROL — a swatch, a text field and an `sp-overlay` holding an
 * `sp-color-area`, an `sp-color-slider` and an `sp-swatch-group` — because `specs/ui.md` §5.6 was
 * Pending and there was no colour element in the kit to draw a colour row with. It was the last
 * Spectrum surface in Studio, and the island `studio-ui-guidelines.md` §9.4 describes: the Style
 * tab and the Content tab each drew an empty `[part="control-host"]` and this filled it with lit.
 *
 * §5.6 landed, so the control is `jx-color-field` and both tabs draw it inline in their own
 * documents. What no kit element can answer is what is LEFT here: which colours this project has
 * given a name to. That is a question about the document being edited — the `--color-*` custom
 * properties of the effective style, site and document together — and it is Studio's to answer.
 *
 * A token is projected as three separate things on purpose, because they are three:
 *
 * - `value` is what choosing it COMMITS, and it is the reference (`var(--color-accent)`) rather than
 *   the colour behind it. Committing the literal would resolve the token at the moment of the click
 *   and quietly opt that one declaration out of the palette for ever.
 * - `color` is how the chip LOOKS, which is the literal, and is not what the swatch means.
 * - `label` is the word a reader would use. A colour is not a name: `jx-swatch` announces its own
 *   `value` when it is given no label, and "var(--color-primary-blue)" read one character at a time
 *   is a name in the same sense that a licence plate is.
 *
 * @docs studio/design/style-inspector
 */

import { activeTab } from "../workspace/workspace";
import { getEffectiveStyle } from "../site-context";
import { kebabToLabel } from "../utils/studio-utils";

/**
 * One colour the project has named, as a swatch reads it.
 *
 * `Record<string, unknown>` because it is a `$map` item: a repeater's scope is a record, and a
 * shape that is not one cannot be read through `$map/item/...`.
 */
export interface ColorTokenView extends Record<string, unknown> {
  /** What choosing this swatch commits — the reference, never the literal behind it. */
  value: string;
  /** The chip's colour: how the token looks, which is not what it means. */
  color: string;
  /** The token's name, title-cased — "Primary Blue" — and the swatch's accessible name. */
  label: string;
}

/**
 * Convert a colour variable's name to a title-case label.
 *
 * Strips the `--color-` prefix and converts kebab to title case, so `--color-primary-blue` becomes
 * "Primary Blue". A token named `--color` alone has nothing left after the prefix, and falls back
 * to its own name rather than announcing itself as the empty string.
 *
 * @param {string} name The custom property's name, with its leading dashes.
 * @returns {string}
 */
function varToLabel(name: string): string {
  return kebabToLabel(name.replace(/^--color-?/, "")) || name;
}

/**
 * The `--color-*` custom properties of the effective (site + document) style, in the order they are
 * written.
 *
 * Only scalars are taken. A custom property whose value is an object is a nested rule rather than a
 * colour, and a swatch drawn from one would be a chip of nothing labelled with a name that commits
 * a reference to something that is not a colour.
 *
 * @returns {ColorTokenView[]} The palette, empty when the document defines no colours.
 */
export function colorTokens(): ColorTokenView[] {
  /* `getEffectiveStyle` answers with an object whatever it is given — the site's, the document's,
     the two merged, or an empty one — so there is no absent case to guard, and the guard that used
     to stand here was a branch no test could reach because nothing could produce it. */
  const style = getEffectiveStyle(activeTab.value?.doc.document?.style);
  const tokens: ColorTokenView[] = [];
  for (const [name, value] of Object.entries(style)) {
    if (name.startsWith("--color") && (typeof value === "string" || typeof value === "number")) {
      tokens.push({ color: String(value), label: varToLabel(name), value: `var(${name})` });
    }
  }
  return tokens;
}
