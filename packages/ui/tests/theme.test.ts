import "./with-dom.ts";

import { describe, expect, test } from "bun:test";

import {
  installTheme,
  THEME_LAYER,
  themeCSS,
  themeInstalled,
  themeTokenNames,
  themeTokens,
} from "../src/theme.ts";

/** The semantic names Studio's own token layer aliases; they are the kit's public contract. */
const SEMANTIC = [
  "--jx-bg",
  "--jx-bg-panel",
  "--jx-bg-input",
  "--jx-bg-overlay",
  "--jx-border",
  "--jx-border-strong",
  "--jx-fg",
  "--jx-fg-dim",
  "--jx-fg-muted",
  "--jx-accent",
  "--jx-accent-solid",
  "--jx-accent-hover",
  "--jx-accent-fg",
  "--jx-hover-bg",
  "--jx-danger",
  "--jx-success",
  "--jx-warning",
  "--jx-tag",
  "--jx-signal",
  "--jx-handler",
  "--jx-map",
  "--jx-switch-c",
  "--jx-radius-sm",
  "--jx-focus-ring",
  "--jx-font-sans",
  "--jx-font-mono",
];

describe("theme", () => {
  test("is one layered sheet of tokens on :root", () => {
    const css = themeCSS();
    expect(css.startsWith(`@layer ${THEME_LAYER} {`)).toBe(true);
    expect(css).toContain(":root { --jx-gray-50: #f7f7f9;");
    expect(css).toContain("color-scheme: light dark");
    expect(css).toContain(':root[data-theme="light"] { color-scheme: light;');
    expect(css).toContain(':root[data-theme="dark"] { color-scheme: dark }');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("--jx-dur-1: 0ms");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain('@property --jx-accent { syntax: "<color>"; inherits: true;');
  });

  test("declares every semantic token, each colour as a light-dark pair or a token reference", () => {
    const names = themeTokenNames();
    for (const name of SEMANTIC) {
      expect(names, name).toContain(name);
    }
    const colours = SEMANTIC.filter(
      (n) => !/(radius|focus-ring|font|accent-fg|accent-solid)/.test(n),
    );
    for (const name of colours) {
      const value = String(themeTokens[name]);
      expect(
        value.startsWith("light-dark(") ||
          value.startsWith("var(") ||
          value.startsWith("color-mix("),
        `${name}: ${value}`,
      ).toBe(true);
    }
  });

  test("no ramp step is reused as a raw hex outside the ramp", () => {
    // Semantic tokens reference the ramp by name so a re-tuned ramp reaches every surface.
    const ramp = new Set(
      Object.entries(themeTokens)
        .filter(([k]) => /^--jx-(gray|blue|red|green|amber)-\d+$/.test(k))
        .map(([, v]) => String(v).toLowerCase()),
    );
    for (const name of SEMANTIC) {
      const value = String(themeTokens[name]).toLowerCase();
      for (const hex of value.match(/#[0-9a-f]{6}/g) ?? []) {
        expect(ramp.has(hex), `${name} hard-codes ramp colour ${hex}`).toBe(false);
      }
    }
  });

  test("installs once per document, as a constructable sheet", () => {
    const doc = document.implementation.createHTMLDocument("theme");
    expect(themeInstalled(doc)).toBe(false);
    installTheme(doc);
    installTheme(doc);
    expect(themeInstalled(doc)).toBe(true);
    expect(doc.adoptedStyleSheets.length).toBe(1);
    expect(doc.querySelector("style[data-jx-theme]")).toBeNull();
  });

  test("falls back to a style element where constructable sheets are missing", () => {
    const doc = document.implementation.createHTMLDocument("theme-fallback");
    const original = globalThis.CSSStyleSheet;
    // @ts-expect-error — a host without replaceSync is the case under test.
    globalThis.CSSStyleSheet = class {};
    try {
      installTheme(doc);
    } finally {
      globalThis.CSSStyleSheet = original;
    }
    const style = doc.querySelector("style[data-jx-theme]");
    expect(style?.textContent?.startsWith(`@layer ${THEME_LAYER}`)).toBe(true);
    expect(themeInstalled(doc)).toBe(true);
  });
});
