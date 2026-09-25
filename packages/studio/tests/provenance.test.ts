/**
 * Provenance — the vocabulary, not the chip.
 *
 * `renderProvenanceChip` used to live in `src/panels/provenance.ts` and these assertions used to
 * paint it. It is gone: its only caller was `ui/field-row.ts`, whose only caller was
 * `ui/expression-editor.ts`, and all three of the cascades that ask the provenance question — the
 * Style tab, Component Props and the SEO card — are documents that draw their own `[part="chip"]`
 * from the words below.
 *
 * So the assertions moved with the decisions rather than being deleted with the template. The words
 * and the tooltips are still this module's, and are checked here directly; the two SHAPE rules the
 * template carried — `default` draws nothing, and a chip that acts is a real button while one that
 * cannot is a span — are now made in each panel's projection and drawn in its document, and are
 * checked against both.
 */
import { describe, expect, test } from "bun:test";
import {
  countProvenance,
  provenanceSummaryText,
  provenanceText,
  provenanceTitle,
} from "../src/panels/provenance";
import type { ProvenanceState } from "../src/panels/provenance";

describe("what a chip reads", () => {
  test("set says nothing — the dot is the whole statement", () => {
    expect(provenanceText({ state: "set" })).toBe("");
    expect(provenanceTitle("color", { onClick: () => {}, state: "set" })).toBe(
      "Set here — click to clear color",
    );
  });

  test("inherited names the donor, and says the cascade when it has no name for it", () => {
    expect(provenanceText({ donor: "Md", state: "inherited" })).toBe("from Md");
    expect(provenanceTitle("color", { donor: "Md", state: "inherited" })).toBe(
      "Inherited from Md — click to go there",
    );
    expect(provenanceText({ state: "inherited" })).toBe("inherited");
    expect(provenanceTitle("color", { state: "inherited" })).toBe(
      "Inherited from the cascade — click to go there",
    );
  });

  test("bound names the signal, and falls back to the word when it cannot", () => {
    expect(provenanceText({ donor: "brand", state: "bound" })).toBe("brand");
    expect(provenanceTitle("color", { donor: "brand", state: "bound" })).toBe(
      "Bound to brand — click to open it",
    );
    expect(provenanceText({ state: "bound" })).toBe("bound");
    expect(provenanceTitle("color", { state: "bound" })).toBe("Bound");
  });

  test("mixed says how many disagree, so it never means an unknown number of things", () => {
    expect(provenanceText({ donor: "3", state: "mixed" })).toBe("mixed (3)");
    expect(provenanceTitle("color", { donor: "3", state: "mixed" })).toContain(
      "3 selected elements have different values for color",
    );
    expect(provenanceText({ state: "mixed" })).toBe("mixed");
  });

  test("default reads as nothing at all — absence is the ghost", () => {
    expect(provenanceText({ state: "default" })).toBe("");
    expect(provenanceTitle("color", { state: "default" })).toBe(
      "Not set — color falls back to the browser default",
    );
  });

  test("an explicit title wins over the derived one", () => {
    expect(provenanceTitle("color", { state: "set", title: "Say this" })).toBe("Say this");
  });
});

describe("where the chip's shape decisions went", () => {
  /*
   * `.provenance-chip` was a `<button>` when it had somewhere to go and a `<span>` when it did not,
   * because "a control that looks pressable and does nothing is the defect this phase exists to
   * remove". The template that made that choice is gone; the choice is not. It is a `$switch` on a
   * row's `chip` word in each document, and the word is chosen in each panel's projection — so both
   * halves are pinned, and a document that grew a pressable chip for a row with no handler would
   * have to add a case that is not there.
   */
  test("both inspector documents switch the chip on a word, and only draw one when there is one", async () => {
    for (const surface of ["style-panel", "properties-panel"]) {
      const json = await Bun.file(
        new URL(`../src/surfaces/${surface}.json`, import.meta.url),
      ).text();
      const doc = JSON.parse(json) as unknown;
      const slot = findPart(doc, "chip-slot");
      expect(slot, `${surface}.json draws no chip slot`).not.toBeNull();
      const cases = Object.keys((slot as { cases?: Record<string, unknown> }).cases ?? {});
      // A pressable case and a plain one, and NO case for `default`: an unset row draws no chip.
      expect(cases.length).toBeGreaterThan(1);
      expect(cases).not.toContain("default");
      expect(cases).not.toContain("none");
      for (const [name, node] of Object.entries(
        (slot as { cases: Record<string, { tagName: string }> }).cases,
      )) {
        /* `text` is the only case reached with no handler, and it is the only `<span>`. Every
           other case — `button` on the Style tab, `dot` and `press` on Content — is a real
           `<button>`, including the 6px dot, which was a `<span>` under lit and reachable by
           mouse alone. */
        expect(node.tagName, `${surface}.json draws case "${name}" as <${node.tagName}>`).toBe(
          name === "text" ? "span" : "button",
        );
      }
    }
  });

  test("the Style tab's chip is a button exactly when the provenance carries a handler", async () => {
    const json = await Bun.file(new URL("../src/panels/style-panel.ts", import.meta.url)).text();
    // The projection, read as source: the row's word is `button` under `prov.onClick` and `text`
    // Without it, and `default` short-circuits to `none` before either.
    expect(json).toContain('row.chip = "none";');
    expect(json).toContain('row.chip = "button";');
    expect(json).toContain('row.chip = "text";');
  });
});

describe("counting", () => {
  const states: ProvenanceState[] = ["set", "set", "inherited", "default", "bound"];

  test("tallies the three informative states and ignores defaults", () => {
    expect(countProvenance(states)).toEqual({ bound: 1, inherited: 1, mixed: 0, set: 2 });
    // A tally with nothing informative in it says so, which is what the heading it feeds draws
    // Instead of a row of dots. `hasProvenance` used to answer this for a lit helper that no longer
    // Exists: the Style tab's section heading is a document (`surfaces/style-panel.json`) and
    // Projects the marks and the sentence, so the sentence IS the emptiness test.
    expect(provenanceSummaryText(countProvenance(["default", "default"]))).toBe("nothing set");
  });

  test("reads the tally as a sentence", () => {
    expect(provenanceSummaryText(countProvenance(states))).toBe(
      "2 set here · 1 inherited · 1 bound",
    );
    expect(provenanceSummaryText(countProvenance(["default"]))).toBe("nothing set");
  });
});

/** The first node in a document whose `part` attribute is `name`. */
function findPart(node: unknown, name: string): unknown {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findPart(child, name);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof node !== "object" || node === null) {
    return null;
  }
  const record = node as Record<string, unknown>;
  const attributes = record["attributes"] as Record<string, unknown> | undefined;
  if (attributes?.["part"] === name) {
    return record;
  }
  for (const value of Object.values(record)) {
    const found = findPart(value, name);
    if (found) {
      return found;
    }
  }
  return null;
}
