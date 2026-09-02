/**
 * The Spectrum brand fragment and the kit's ramp agree stop for stop.
 *
 * Until the last lit surface migrates, a Spectrum control and a kit element share a screen; the
 * fragment (`src/ui/jx-theme.ts`) is re-valued from the kit's tokens so the two paint one palette.
 * This is the table that says which Spectrum stop is which kit step, in both themes, and the test
 * that fails when either side moves alone.
 */
import "./with-dom.js";

import { describe, expect, test } from "bun:test";
import { themeTokens } from "@jxsuite/ui";

const { jxTheme } = await import("../src/ui/jx-theme");

/** Spectrum stop → kit token, dark ramp. */
const DARK: Record<string, string> = {
  "gray-50": "--jx-gray-975",
  "gray-75": "--jx-gray-950",
  "gray-100": "--jx-gray-925",
  "gray-200": "--jx-gray-900",
  "gray-300": "--jx-gray-850",
  "gray-400": "--jx-gray-800",
  "gray-500": "--jx-gray-700",
  "gray-600": "--jx-gray-500",
  "gray-700": "--jx-gray-400",
  "gray-800": "--jx-gray-200",
  "gray-900": "--jx-gray-100",
  "blue-100": "--jx-blue-950",
  "blue-200": "--jx-blue-900",
  "blue-300": "--jx-blue-800",
  "blue-400": "--jx-blue-700",
  "blue-500": "--jx-blue-600",
  "blue-700": "--jx-blue-500",
  "blue-800": "--jx-blue-400",
  "blue-900": "--jx-blue-300",
  "blue-1000": "--jx-blue-200",
  "blue-1100": "--jx-blue-100",
  "blue-1200": "--jx-blue-50",
};

/** Spectrum stop → kit token, light ramp. */
const LIGHT: Record<string, string> = {
  "gray-75": "--jx-gray-50",
  "gray-100": "--jx-gray-100",
  "gray-200": "--jx-gray-200",
  "gray-300": "--jx-gray-300",
  "gray-400": "--jx-gray-400",
  "gray-500": "--jx-gray-500",
  "gray-600": "--jx-gray-600",
  "gray-700": "--jx-gray-700",
  "gray-800": "--jx-gray-900",
  "gray-900": "--jx-gray-975",
  "blue-100": "--jx-blue-50",
  "blue-200": "--jx-blue-100",
  "blue-300": "--jx-blue-200",
  "blue-400": "--jx-blue-300",
  "blue-500": "--jx-blue-400",
  "blue-600": "--jx-blue-500",
  "blue-700": "--jx-blue-600",
  "blue-800": "--jx-blue-700",
  "blue-900": "--jx-blue-800",
  "blue-1000": "--jx-blue-900",
  "blue-1100": "--jx-blue-950",
};

function triplet(hex: string): string {
  const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  return `${channel(1)}, ${channel(3)}, ${channel(5)}`;
}

const css = jxTheme.cssText;
const lightStart = css.indexOf(':host([color="light"])');
const dark = css.slice(0, lightStart);
const light = css.slice(lightStart);

describe("the brand fragment follows the kit ramp", () => {
  for (const [stop, token] of Object.entries(DARK)) {
    test(`dark ${stop} is ${token}`, () => {
      const hex = String(themeTokens[token]);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark).toContain(`--spectrum-${stop}-rgb: ${triplet(hex)};`);
    });
  }
  for (const [stop, token] of Object.entries(LIGHT)) {
    test(`light ${stop} is ${token}`, () => {
      const hex = String(themeTokens[token]);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(light).toContain(`--spectrum-${stop}-rgb: ${triplet(hex)};`);
    });
  }

  test("the sans stack is the kit's", () => {
    const stack = String(themeTokens["--jx-font-sans"]).replaceAll(/\s+/g, " ");
    expect(dark.replaceAll(/\s+/g, " ")).toContain(`--spectrum-sans-font-family-stack: ${stack};`);
  });
});
