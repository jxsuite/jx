/**
 * Studio's token layer and the kit's theme agree — the aliases in `styles/tokens.css` name tokens
 * the kit really declares, and the colours among them really change with the theme.
 *
 * This file used to hold the other half of that agreement: a stop-for-stop table binding the
 * Spectrum brand fragment (`src/ui/jx-theme.ts`) to the kit's ramp, so a Spectrum control and a kit
 * element on one screen painted one palette. Spectrum is gone and so is the fragment, but the
 * failure mode it existed for is not, because the seam simply moved. Studio does not use kit tokens
 * directly: every name in `tokens.css` is an ALIAS — `--bg: var(--jx-bg, #111114)` — and an alias
 * whose kit token does not exist is not an error. It silently resolves to the hex fallback, which
 * is the DARK value, so the chrome keeps painting and stops following the theme. That is the same
 * shape of silence, one indirection along, and these are the assertions that see it.
 */
import "./with-dom.js";

import { describe, expect, test } from "bun:test";
import { themeTokens } from "@jxsuite/ui";
import { join } from "node:path";

const tokensCss = await Bun.file(join(import.meta.dir, "..", "styles", "tokens.css")).text();

/** Every alias in `tokens.css`, as `--studio-name` → the `--jx-*` token it defers to. */
function aliases(): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tokensCss.matchAll(/(--[a-z0-9-]+):\s*var\(\s*(--jx-[a-z0-9-]+)\s*[,)]/g)) {
    found.set(match[1] as string, match[2] as string);
  }
  return found;
}

/** The kit tokens whose value is a `light-dark()` pair rather than one colour. */
function isThemed(token: string): boolean {
  return String(themeTokens[token] ?? "").startsWith("light-dark(");
}

const ALIASES = aliases();

describe("every alias names a token the kit declares", () => {
  /* The negative control: a table that parsed to nothing would pass every assertion below it, and
     the whole file would be green over a stylesheet it never read. */
  test("the stylesheet parses to a real table", () => {
    expect(ALIASES.size).toBeGreaterThan(15);
    expect(ALIASES.get("--bg")).toBe("--jx-bg");
  });

  for (const [studio, kit] of ALIASES) {
    test(`${studio} defers to ${kit}`, () => {
      expect(Object.hasOwn(themeTokens, kit), `${kit} is not declared by the kit's theme`).toBe(
        true,
      );
    });
  }
});

describe("the colours among them follow the theme", () => {
  /**
   * The seven the chrome is drawn out of. A single-valued kit token behind one of these is the
   * defect this file is for: the light theme would paint the dark value and no test of the stamp,
   * the setting or the stylesheet would notice, because every one of them still works.
   */
  const CHROME_COLOURS = [
    "--bg",
    "--bg-panel",
    "--bg-input",
    "--border",
    "--fg",
    "--fg-dim",
    "--accent",
  ];

  for (const studio of CHROME_COLOURS) {
    test(`${studio} resolves to a light-dark() pair`, () => {
      const kit = ALIASES.get(studio);
      expect(kit, `${studio} is not an alias in tokens.css`).toBeDefined();
      expect(isThemed(kit as string), `${kit} is one colour, so ${studio} cannot move`).toBe(true);
    });
  }

  test("at least one alias is deliberately NOT themed, so the rule above is a choice", () => {
    /* `--accent-fg` is white on both themes because it is the text on a saturated accent fill, and
       `--font-mono` is a font stack. If every token were a pair this test would be the one saying
       so; it fails if somebody makes the list above universal by making everything a pair. */
    expect(isThemed(ALIASES.get("--font-mono") as string)).toBe(false);
  });
});
