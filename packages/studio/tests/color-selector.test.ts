/**
 * `ui/color-selector.ts` — the project's colour tokens, as a projection.
 *
 * The module used to be a control: a swatch, a text field and an `sp-overlay` of Spectrum's colour
 * area, slider and swatch group, rendered into an announced `[part="control-host"]` by the Style
 * tab and the Content tab. Every test of that markup is gone with it — `ui.md` §5.6 landed, the row
 * is a `jx-color-field` inside each tab's own document, and `tests/style-panel.test.ts` and
 * `tests/properties-panel.test.ts` cover what a reader can now do to a colour.
 *
 * What is left is the one question no kit element can answer: which colours THIS project has given
 * a name to. Three things are asserted about the answer, and each is a decision rather than a
 * detail — the reference is what a swatch commits, the literal is only how it looks, and a name is
 * neither.
 */
import { resetStudioState, resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import type { JxMutableNode } from "@jxsuite/schema/types";

const { colorTokens, resolvedColor } = await import("../src/ui/color-selector");

const COLOR_DOC = {
  children: [{ tagName: "p" }],
  style: {
    "--color-accent": "#ff0000",
    "--color-bad": { nested: true },
    "--color-num": 42,
    "--color-primary-blue": "#0000ff",
    "--font-body": "Inter, sans-serif",
  },
  tagName: "div",
} as unknown as JxMutableNode;

beforeEach(() => {
  resetStudioState();
  resetWorkspaceWithTab(COLOR_DOC);
});

describe("colorTokens", () => {
  test("a token is the reference, the literal and the name, and they are three things", () => {
    expect(colorTokens()).toEqual([
      { color: "#ff0000", label: "Accent", value: "var(--color-accent)" },
      { color: "42", label: "Num", value: "var(--color-num)" },
      { color: "#0000ff", label: "Primary Blue", value: "var(--color-primary-blue)" },
    ]);
  });

  test("only `--color*` scalars are colours", () => {
    const names = colorTokens().map((t) => t.value);
    // A custom property that is not a colour is not a swatch…
    expect(names).not.toContain("var(--font-body)");
    // …and neither is a nested rule, which would draw a chip of nothing under a real name.
    expect(names).not.toContain("var(--color-bad)");
  });

  test("a token named `--color` alone falls back to its own name rather than to silence", () => {
    resetWorkspaceWithTab({
      style: { "--color": "#123456" },
      tagName: "div",
    } as unknown as JxMutableNode);
    /* `jx-swatch` announces its label, so the empty string here would be a swatch that reads out
       its hex one character at a time. */
    expect(colorTokens()).toEqual([{ color: "#123456", label: "--color", value: "var(--color)" }]);
  });

  test("a document with no style of its own has no palette", () => {
    resetWorkspaceWithTab({ tagName: "div" } as unknown as JxMutableNode);
    expect(colorTokens()).toEqual([]);
  });
});

describe("resolvedColor", () => {
  test("a literal draws itself, so there is nothing to resolve", () => {
    expect(resolvedColor("#ff0000")).toBe("");
    expect(resolvedColor("")).toBe("");
  });

  test("a reference is followed through the effective style to the colour at its end", () => {
    /* The site's block under the document's: a token the site declares and the document aliases
       lands on the site's literal, which is the chip the canvas would draw. */
    resetStudioState({ projectConfig: { style: { "--color-brand": "#0d9488" } } });
    resetWorkspaceWithTab({
      style: { "--color-accent": "var(--color-brand)", "--color-ink": "#0000ff" },
      tagName: "div",
    } as unknown as JxMutableNode);
    expect(resolvedColor("var(--color-ink)")).toBe("#0000ff");
    expect(resolvedColor("var(--color-accent)")).toBe("#0d9488");
    expect(resolvedColor("var(--color-brand)")).toBe("#0d9488");
  });

  test("a reference the style cannot follow resolves to nothing rather than to a guess", () => {
    resetWorkspaceWithTab({
      style: { "--color-loop": "var(--color-loop)" },
      tagName: "div",
    } as unknown as JxMutableNode);
    /* A token a stylesheet defines, and an alias that loops: the field's own fallback — drawing
       the reference and letting the browser try — is the right answer for both. */
    expect(resolvedColor("var(--color-elsewhere)")).toBe("");
    expect(resolvedColor("var(--color-loop)")).toBe("");
  });
});
