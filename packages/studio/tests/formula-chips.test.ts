/**
 * The chip pipeline: target-chain unrolling, live value badges, parenthesized group chips, and
 * click-to-path reporting.
 *
 * **It is two files, and the split is the conversion.** `src/ui/formula-chips.ts` is the MODEL —
 * {@link formulaChipStrip}, the chips one expression node reads as — because the strip has two
 * surfaces: the Logic dock draws it as a Jx document (`surfaces/logic-workspace.json`, covered by
 * `formula-workspace.test.ts`) and the expression editor draws it as another
 * (`surfaces/expression-editor.json`). Neither drawing is lit any more, so the strip's own module
 * draws nothing at all — every assertion about what a chip SAYS is made against the model, where it
 * is a comparison rather than a DOM walk, and the drawing asserted below is the editor's document.
 */
import { flush, pointer } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { chipSummary, formulaChipStrip } from "../src/ui/formula-chips";
import { mountExpressionEditor } from "../src/ui/expression-editor";

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

interface MountedStrip {
  container: HTMLElement;
  picks: (string | number)[][];
}

/**
 * Mount the editor over a node and hand back its host.
 *
 * The strip is the editor's depth-0 header, so the whole editor is what draws it — which is also
 * what makes these tests the drawing's real contract rather than a helper's.
 */
async function mount(node: unknown, opts: Record<string, unknown> = {}): Promise<MountedStrip> {
  const picks: (string | number)[][] = [];
  const container = document.createElement("div");
  document.body.append(container);
  hosts.push(container);
  mountExpressionEditor(container, node, () => {}, {
    allowEventRef: false,
    onChipSelect: (p: (string | number)[]) => picks.push(p),
    stateDefs: ["count", "factor", "status", "busy", "flag", "n", "lineTotal"],
    ...opts,
  } as never);
  await flush(6);
  return { container, picks };
}

/** The model's answer for a node, as `label@path` pairs — the whole strip in one comparison. */
function strip(node: unknown, opts: Record<string, unknown> = {}): string[] {
  return formulaChipStrip(node, opts as never).map((c) => `${c.label}@${c.key}`);
}

function chips(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll('[part="chip"]')] as HTMLElement[];
}

function chipLabels(container: HTMLElement): string[] {
  return chips(container).map(
    (c) => (c.querySelector('[part="chip-label"]') as HTMLElement).textContent!,
  );
}

/** The one chip drawn as a branch off the chain rather than a link of it. */
function groupChip(container: HTMLElement): HTMLElement {
  return container.querySelector('[part="chip"][data-group="true"]') as HTMLElement;
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

describe("the document drawing — chain unrolling", () => {
  test("unrolls the target chain deepest-first: head operand, then operators outward", async () => {
    const { container } = await mount(CHAIN_NODE);
    expect(chipLabels(container)).toEqual(["count", "*", "+"]);
    expect(chips(container).map((c) => c.dataset["path"])).toEqual(["target/target", "target", ""]);
  });

  test("a base path prefixes every chip path", async () => {
    const { container } = await mount(CHAIN_NODE, { path: ["value"] });
    expect(chips(container).map((c) => c.dataset["path"])).toEqual([
      "value/target/target",
      "value/target",
      "value",
    ]);
  });

  test("literal and null head operands render as chips too", async () => {
    const { container } = await mount({ operator: "!", target: null });
    expect(chipLabels(container)).toEqual(["null", "!"]);
    const { container: c2 } = await mount({ operator: "+", target: "hi", value: 1 });
    expect(chipLabels(c2)).toEqual(['"hi"', "+"]);
  });

  test("call chips show the callee ref as the head chip", async () => {
    const { container } = await mount({
      operator: "call",
      target: { $ref: "window#/Math/max" },
      value: [1, 2],
    });
    expect(chipLabels(container)).toEqual(["Math.max", "call"]);
  });

  test("a non-node input draws the strip of the default the editor substituted", async () => {
    // The model answers "no strip" for a non-node (asserted above); the DOCUMENT never sees one,
    // Because the editor substitutes `= null` for anything it cannot read. So the strip a reader
    // Gets is that node's, which is the same answer said about the thing actually on screen.
    const { container } = await mount(null);
    expect(chipLabels(container)).toEqual(["null", "="]);
    const { container: c2 } = await mount("text");
    expect(chipLabels(c2)).toEqual(["null", "="]);
  });
});

describe("the document drawing — badges", () => {
  test("shows live value badges from the preview keyed by chip path", async () => {
    const preview = {
      error: null,
      mutating: false,
      values: new Map([
        ["", "7"],
        ["target", "6"],
        ["target/target", "3"],
      ]),
    };
    const { container } = await mount(CHAIN_NODE, { preview });
    const badgeByPath = new Map(
      chips(container).map((c) => [
        c.dataset["path"],
        c.querySelector('[part="badge"]')?.textContent ?? null,
      ]),
    );
    expect(badgeByPath.get("target/target")).toBe("3");
    expect(badgeByPath.get("target")).toBe("6");
    expect(badgeByPath.get("")).toBe("7");
  });

  test("renders no badges without a preview", async () => {
    const { container } = await mount(CHAIN_NODE);
    expect(container.querySelector('[part="chip"] [part="badge"]')).toBeNull();
  });
});

describe("the document drawing — group chips", () => {
  test("nested non-target value operand renders a parenthesized group chip", async () => {
    const { container } = await mount({
      operator: "+",
      target: { $ref: "#/state/count" },
      value: { operator: "*", target: { $ref: "#/state/factor" }, value: 2 },
    });
    const group = groupChip(container);
    expect(group).not.toBeNull();
    expect(group.dataset["path"]).toBe("value");
    expect(group.querySelector('[part="chip-label"]')!.textContent).toBe("(factor › *)");
    expect(chipLabels(container)).toEqual(["count", "+", "(factor › *)"]);
  });

  test("nested initial and switch case operands render group chips", async () => {
    const { container } = await mount({
      cases: { done: { operator: "!", target: { $ref: "#/state/busy" } } },
      default: null,
      operator: "switch",
      target: { $ref: "#/state/status" },
    });
    expect(groupChip(container).dataset["path"]).toBe("cases/done");

    const { container: c2 } = await mount({
      initial: { operator: "-", target: { $ref: "#/state/n" } },
      operator: "?:",
      target: { $ref: "#/state/flag" },
      value: 1,
    });
    expect(groupChip(c2).dataset["path"]).toBe("initial");
  });

  test("expression nodes inside an args array render indexed group chips", async () => {
    const { container } = await mount({
      operator: "call",
      target: { $ref: "#/state/lineTotal" },
      value: [{ operator: "+", target: 1, value: 2 }, 5],
    });
    expect(groupChip(container).dataset["path"]).toBe("value/0");
  });
});

describe("the document drawing — selection", () => {
  test("clicking a chip reports its node path", async () => {
    const { container, picks } = await mount(CHAIN_NODE);
    for (const chip of chips(container)) {
      pointer(chip, "click");
    }
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
