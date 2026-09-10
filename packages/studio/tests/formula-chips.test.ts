/**
 * The chip pipeline: target-chain unrolling, live value badges, parenthesized group chips, and
 * click-to-path reporting.
 *
 * **It is two files now**, and the split is the conversion. `src/ui/formula-chips.ts` is the MODEL
 * — {@link formulaChipStrip}, the chips one expression node reads as — because the strip has two
 * surfaces: the Logic dock draws it as a Jx document over the kit (`surfaces/logic-workspace.json`,
 * covered by `formula-workspace.test.ts`) and `src/ui/expression-editor.ts` still draws it in lit
 * over Spectrum. So the drawing asserted below is the LIT one, imported from the editor that owns
 * it; every assertion about what a chip SAYS is made against the model, where it is a comparison
 * rather than a DOM walk.
 */
import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import { render } from "lit-html";
import { chipSummary, formulaChipStrip } from "../src/ui/formula-chips";
import { renderFormulaChips } from "../src/ui/expression-editor";
import type { ChipPreview } from "../src/ui/formula-chips";

function mount(node: unknown, opts: Record<string, unknown> = {}) {
  const picks: (string | number)[][] = [];
  const container = document.createElement("div");
  render(
    renderFormulaChips(node, (p: (string | number)[]) => picks.push(p), opts as never),
    container,
  );
  return { container, picks };
}

/** The model's answer for a node, as `label@path` pairs — the whole strip in one comparison. */
function strip(node: unknown, opts: Record<string, unknown> = {}): string[] {
  return formulaChipStrip(node, opts as never).map((c) => `${c.label}@${c.key}`);
}

function chips(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll(".formula-chip")] as HTMLElement[];
}

function chipLabels(container: HTMLElement): string[] {
  return chips(container).map((c) => (c.querySelector("span") as HTMLElement).textContent!.trim());
}

const CHAIN_NODE = {
  operator: "+",
  target: {
    operator: "*",
    target: { $ref: "#/state/count" },
    value: 2,
  },
  value: 1,
};

// ─── The model ───────────────────────────────────────────────────────────────

describe("formulaChipStrip", () => {
  test("unrolls the target chain deepest-first, keying each chip by its node path", () => {
    expect(strip(CHAIN_NODE)).toEqual(["count@target/target", "*@target", "+@"]);
  });

  test("a base path prefixes every chip's key, and the path it hands back", () => {
    const built = formulaChipStrip(CHAIN_NODE, { path: ["value"] });
    expect(built.map((c) => c.key)).toEqual(["value/target/target", "value/target", "value"]);
    expect(built.map((c) => c.path)).toEqual([
      ["value", "target", "target"],
      ["value", "target"],
      ["value"],
    ]);
  });

  test("a non-target expression operand is a parenthesized GROUP chip, at its own path", () => {
    const built = formulaChipStrip({
      operator: "+",
      target: { $ref: "#/state/count" },
      value: { operator: "*", target: { $ref: "#/state/factor" }, value: 2 },
    });
    expect(built.map((c) => [c.label, c.group])).toEqual([
      ["count", false],
      ["+", false],
      ["(factor › *)", true],
    ]);
  });

  test("group chips reach initial, switch cases, default and each positional arg", () => {
    expect(
      strip({
        cases: { done: { operator: "!", target: { $ref: "#/state/busy" } } },
        default: { operator: "-", target: 1 },
        operator: "switch",
        target: { $ref: "#/state/status" },
      }),
    ).toEqual(["status@target", "switch@", "(busy › !)@cases/done", "(1 › -)@default"]);
    expect(
      strip({
        initial: { operator: "-", target: { $ref: "#/state/n" } },
        operator: "?:",
        target: { $ref: "#/state/flag" },
        value: 1,
      }),
    ).toEqual(["flag@target", "?:@", "(n › -)@initial"]);
    expect(
      strip({
        operator: "call",
        target: { $ref: "#/state/lineTotal" },
        value: [{ operator: "+", target: 1, value: 2 }, 5],
      }),
    ).toEqual(["lineTotal@target", "call@", "(1 › +)@value/0"]);
  });

  test("a badge is the preview's value at that path — and an EMPTY one is still a value", () => {
    const built = formulaChipStrip(CHAIN_NODE, {
      preview: { values: new Map([["target", ""]]) },
    });
    const byKey = new Map(built.map((c) => [c.key, c]));
    // "" is what an empty string evaluates to; reporting it as "no value" is the bug hasBadge
    // Exists to prevent — the chip must draw an empty badge rather than none at all.
    expect(byKey.get("target")).toMatchObject({ badge: "", hasBadge: true });
    expect(byKey.get("")).toMatchObject({ badge: "", hasBadge: false });
  });

  test("anything that is not an expression node is no strip at all", () => {
    expect(formulaChipStrip(null)).toEqual([]);
    expect(formulaChipStrip("text")).toEqual([]);
    expect(formulaChipStrip({ target: 1 })).toEqual([]);
  });
});

describe("the lit drawing — chain unrolling", () => {
  test("unrolls the target chain deepest-first: head operand, then operators outward", () => {
    const { container } = mount(CHAIN_NODE);
    expect(chipLabels(container)).toEqual(["count", "*", "+"]);
    const paths = chips(container).map((c) => c.dataset.path);
    expect(paths).toEqual(["target/target", "target", ""]);
  });

  test("a base path prefixes every chip path", () => {
    const { container } = mount(CHAIN_NODE, { path: ["value"] });
    const paths = chips(container).map((c) => c.dataset.path);
    expect(paths).toEqual(["value/target/target", "value/target", "value"]);
  });

  test("literal and null head operands render as chips too", () => {
    const { container } = mount({ operator: "!", target: null });
    expect(chipLabels(container)).toEqual(["null", "!"]);
    const { container: c2 } = mount({ operator: "+", target: "hi", value: 1 });
    expect(chipLabels(c2)).toEqual(['"hi"', "+"]);
  });

  test("call chips show the callee ref as the head chip", () => {
    const { container } = mount({
      operator: "call",
      target: { $ref: "window#/Math/max" },
      value: [1, 2],
    });
    expect(chipLabels(container)).toEqual(["Math.max", "call"]);
  });

  test("non-node input renders nothing", () => {
    const { container } = mount(null);
    expect(chips(container).length).toBe(0);
    const { container: c2 } = mount("text");
    expect(chips(c2).length).toBe(0);
  });
});

describe("the lit drawing — badges", () => {
  test("shows live value badges from the preview keyed by chip path", () => {
    const preview: ChipPreview = {
      values: new Map([
        ["", "7"],
        ["target", "6"],
        ["target/target", "3"],
      ]),
    };
    const { container } = mount(CHAIN_NODE, { preview });
    const badgeByPath = new Map(
      chips(container).map((c) => [
        c.dataset.path,
        c.querySelector(".expr-live-badge")?.textContent ?? null,
      ]),
    );
    expect(badgeByPath.get("target/target")).toBe("3");
    expect(badgeByPath.get("target")).toBe("6");
    expect(badgeByPath.get("")).toBe("7");
  });

  test("renders no badges without a preview", () => {
    const { container } = mount(CHAIN_NODE);
    expect(container.querySelector(".expr-live-badge")).toBeNull();
  });
});

describe("the lit drawing — group chips", () => {
  test("nested non-target value operand renders a parenthesized group chip", () => {
    const { container } = mount({
      operator: "+",
      target: { $ref: "#/state/count" },
      value: { operator: "*", target: { $ref: "#/state/factor" }, value: 2 },
    });
    const group = container.querySelector(".formula-chip--group") as HTMLElement;
    expect(group).not.toBeNull();
    expect(group.dataset.path).toBe("value");
    expect(group.querySelector("span")!.textContent).toBe("(factor › *)");
    expect(chipLabels(container)).toEqual(["count", "+", "(factor › *)"]);
  });

  test("nested initial and switch case operands render group chips", () => {
    const { container } = mount({
      cases: { done: { operator: "!", target: { $ref: "#/state/busy" } } },
      default: null,
      operator: "switch",
      target: { $ref: "#/state/status" },
    });
    const group = container.querySelector(".formula-chip--group") as HTMLElement;
    expect(group.dataset.path).toBe("cases/done");

    const { container: c2 } = mount({
      initial: { operator: "-", target: { $ref: "#/state/n" } },
      operator: "?:",
      target: { $ref: "#/state/flag" },
      value: 1,
    });
    const group2 = c2.querySelector(".formula-chip--group") as HTMLElement;
    expect(group2.dataset.path).toBe("initial");
  });

  test("expression nodes inside an args array render indexed group chips", () => {
    const { container } = mount({
      operator: "call",
      target: { $ref: "#/state/lineTotal" },
      value: [{ operator: "+", target: 1, value: 2 }, 5],
    });
    const group = container.querySelector(".formula-chip--group") as HTMLElement;
    expect(group.dataset.path).toBe("value/0");
  });
});

describe("the lit drawing — selection", () => {
  test("clicking a chip reports its node path", () => {
    const { container, picks } = mount(CHAIN_NODE);
    const [head, mul, plus] = chips(container);
    head!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    mul!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    plus!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(picks).toEqual([["target", "target"], ["target"], []]);
  });
});

describe("chipSummary", () => {
  test("summarizes the chain left to right", () => {
    expect(chipSummary(CHAIN_NODE)).toBe("count › * › +");
    expect(chipSummary({ operator: "!", target: { $ref: "#/state/flag" } })).toBe("flag › !");
    expect(chipSummary({ operator: "call", target: { $ref: "window#/Math/max" }, value: [] })).toBe(
      "Math.max › call",
    );
  });

  test("non-node values summarize as operand labels", () => {
    expect(chipSummary({ $ref: "#/state/count" })).toBe("count");
    expect(chipSummary("hi")).toBe('"hi"');
    expect(chipSummary(5)).toBe("5");
    expect(chipSummary(null)).toBe("null");
  });
});
