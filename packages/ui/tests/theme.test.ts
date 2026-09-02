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
  "--jx-switch-track",
  "--jx-switch-thumb",
  "--jx-radius-sm",
  "--jx-focus-ring",
  "--jx-font-sans",
  "--jx-font-mono",
];

/** One scheme's value of a token: `light-dark(a, b)` picks a side, `var(--x)` follows the name. */
function resolve(token: string, scheme: 0 | 1): string {
  let value = String(themeTokens[token] ?? token);
  for (let hops = 0; hops < 8; hops += 1) {
    const pair = /^light-dark\((.+),\s*(.+)\)$/.exec(value.trim());
    if (pair) {
      value = (scheme === 0 ? pair[1] : pair[2])!.trim();
      continue;
    }
    const ref = /^var\((--[\w-]+)\)$/.exec(value.trim());
    if (ref) {
      value = String(themeTokens[ref[1]!] ?? "");
      continue;
    }
    break;
  }
  return value.trim();
}

/** WCAG relative luminance of a `#rrggbb`. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

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

  test("ships every recipe class, which no document gate can see", () => {
    // A recipe is a rule on a native element, so conformance.test.ts — which walks documents and
    // Stylebook pages — never reads one. This is the only gate a recipe has.
    const css = themeCSS();
    for (const cls of [
      "jx-field-row",
      "jx-field-label",
      "jx-help-text",
      "jx-help-text--error",
      "jx-divider",
      "jx-table",
      "jx-kbd",
      "jx-badge",
      "jx-dot",
    ]) {
      expect(css, cls).toContain(`.${cls}`);
    }
    expect(css).toContain(":root .jx-field-row { display: grid;");
    // The required mark is drawn, never appended to the label's text, so it stays out of the name.
    expect(css).toContain('.jx-field-label[data-required]::after { content: "*" / ""');
  });

  test("the switch track keeps 3:1 against the page and against its own thumb, in both schemes", () => {
    // WCAG 1.4.11. A switch's state is read from where the thumb sits in the track, so the track
    // Against the page and the thumb against the track are both "visual information required to
    // Identify a component's state". The off state is where a switch spends most of its life and
    // Is the pair that fails first: a track one step too light is invisible on a light page and
    // Carries a white thumb that cannot be seen either.
    const pairs: [string, string][] = [
      ["--jx-switch-track", "--jx-bg"],
      ["--jx-switch-track", "--jx-switch-thumb"],
    ];
    for (const [a, b] of pairs) {
      for (const scheme of [0, 1] as const) {
        const ratio = contrast(resolve(a, scheme), resolve(b, scheme));
        expect(
          ratio,
          `${a} vs ${b} (${scheme === 0 ? "light" : "dark"}): ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("--jx-switch-c is the $switch KEYWORD colour, not this kit's switch control", () => {
    // It sits in the syntax run beside --jx-tag, --jx-signal, --jx-handler and --jx-map, and the
    // Canvas and code views paint the `$switch` keyword with it. Reading the name as "the switch
    // Element's token" and repointing it turns every `$switch` in the editor a different colour
    // While every test stays green, which is why the value is pinned here rather than the name.
    expect(themeTokens["--jx-switch-c"]).toBe("var(--jx-danger)");
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
