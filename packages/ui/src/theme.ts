/**
 * The kit's theme: one stylesheet of design tokens, built from the kit's own `project.json`.
 *
 * The tokens live in the project's `style` block, exactly where a site keeps its design tokens
 * (site-architecture.md §10.2), so opening the kit as a project in Studio shows the same values the
 * shell runs on. This module turns that block into CSS with the runtime's own style builder and
 * wraps it in `@layer jx-ui`, so any unlayered author rule — a site's override, Studio's chrome —
 * wins over a token by cascade order rather than by specificity.
 *
 * @docs extending/ui-kit
 */
import { buildStyleRules } from "@jxsuite/runtime/css";
import type { JxStyle } from "@jxsuite/schema/types";
import project from "../project.json";

/** The cascade layer every kit stylesheet lives in. */
export const THEME_LAYER = "jx-ui";

/** The `style` block as authored: one key, the cascade layer, holding every declaration. */
const themeStyle = project.style as JxStyle;

/**
 * The tokens themselves, from inside the layer.
 *
 * Every caller wants the declarations, never the wrapper — so this names them and `themeStyle`
 * stays private. Pointing it at the raw block instead would hand each caller one key called `@layer
 * jx-ui` and let it look up a token that is one level down, which returns `undefined` rather than
 * failing.
 */
export const themeTokens = (themeStyle[`@layer ${THEME_LAYER}`] ?? {}) as JxStyle;

/**
 * The theme as CSS text: every token on `:root`, inside `@layer jx-ui`.
 *
 * Not one character of this is written here. The layer used to be a template literal wrapped around
 * the builder's output, which made this module a THIRD reader of the same `style` block — beside
 * the runtime and the site builder — and the three could disagree about what the block meant. The
 * layer is now an authored `"@layer jx-ui"` key, so the builder emits it like any other at-rule and
 * this function is the builder and nothing else.
 */
export function themeCSS(): string {
  return `${buildStyleRules(themeStyle, { scope: ":root" })
    .map((rule) => rule.text)
    .join("\n")}\n`;
}

/**
 * The custom-property names the theme declares at the root, in declaration order.
 *
 * Read from inside the layer, like every other token access — a filter over the raw `style` block
 * would return an empty array rather than fail, which is the shape of silence this slice is about.
 */
export function themeTokenNames(): string[] {
  return Object.keys(themeTokens).filter((key) => key.startsWith("--"));
}

const installed = new WeakMap<Document, CSSStyleSheet | HTMLStyleElement>();

/**
 * Adopt the theme into a document, once. A constructable sheet where the host has one, a `<style>`
 * element otherwise; calling it again for the same document is a no-op.
 *
 * @param {Document} [doc] Default is the global document
 */
export function installTheme(doc: Document = document): void {
  if (installed.has(doc)) {
    return;
  }
  const css = themeCSS();
  if (typeof CSSStyleSheet === "function" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    installed.set(doc, sheet);
    return;
  }
  const style = doc.createElement("style");
  style.dataset.jxTheme = THEME_LAYER;
  style.textContent = css;
  doc.head.append(style);
  installed.set(doc, style);
}

/** Whether {@link installTheme} has run for a document. */
export function themeInstalled(doc: Document = document): boolean {
  return installed.has(doc);
}
