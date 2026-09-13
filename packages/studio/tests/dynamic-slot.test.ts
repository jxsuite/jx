import "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  effectiveSlotMode,
  resetSlotModeMemory,
  setSlotMode,
  slotCaps,
  slotMode,
  slotModeSeed,
  switchSlotMode,
} from "../src/ui/dynamic-slot";

describe("slotMode", () => {
  test("detects each rung of the ladder", () => {
    expect(slotMode("plain")).toBe("literal");
    expect(slotMode({ $ref: "#/state/x" })).toBe("ref");
    expect(slotMode("${state.x} items")).toBe("template");
    expect(slotMode({ $expression: { operator: "!", target: null } })).toBe("expression");
  });
});

describe("slotCaps", () => {
  test("a named position is derived from the document schema", () => {
    expect(slotCaps("styleProperty")).toEqual(["literal", "ref", "template"]);
    expect(slotCaps("attribute")).toEqual(["literal", "ref", "template"]);
  });

  test("a schema handed in directly is derived the same way", () => {
    expect(slotCaps({ schema: { type: "string" } })).toEqual(["literal", "template"]);
    expect(slotCaps({ schema: { $ref: "#/$defs/RefObject" } })).toEqual(["ref"]);
  });
});

// ─── The seed each rung lands on ─────────────────────────────────────────────

describe("slotModeSeed", () => {
  test("From data… points at the first signal, and falls back to the first extra pointer", () => {
    expect(slotModeSeed("ref", { stateDefs: ["count", "items"] })).toEqual({
      $ref: "#/state/count",
    });
    expect(
      slotModeSeed("ref", { extraSignals: [{ label: "item", value: "$map/item" }], stateDefs: [] }),
    ).toEqual({ $ref: "$map/item" });
  });

  test("a position with nothing to point at still seeds a well-formed ref", () => {
    // An empty `$ref` is a ref the picker can fill; a missing one is a document that fails its
    // Own validator the moment the rung is chosen.
    expect(slotModeSeed("ref", { stateDefs: [] })).toEqual({ $ref: "" });
  });

  test("Mixed text seeds a placeholder around the first signal, or an empty one", () => {
    expect(slotModeSeed("template", { stateDefs: ["count"] })).toBe("${state.count}");
    expect(slotModeSeed("template", { stateDefs: [] })).toBe("${}");
  });

  test("Formula and Inline function seed the scaffold each rung parses", () => {
    expect(slotModeSeed("expression", { stateDefs: [] })).toEqual({
      $expression: { operator: "??", target: null, value: null },
    });
    expect(slotModeSeed("function", { stateDefs: [] })).toEqual({
      $prototype: "Function",
      body: "",
      parameters: [],
    });
  });

  test("Fixed value restores what the position declares, and clears when it declares nothing", () => {
    expect(slotModeSeed("literal", { literalDefault: "declared default", stateDefs: [] })).toBe(
      "declared default",
    );
    expect(slotModeSeed("literal", { stateDefs: [] })).toBeUndefined();
  });
});

// ─── Typing does not swap the widget ─────────────────────────────────────────

describe("effectiveSlotMode", () => {
  beforeEach(() => {
    resetSlotModeMemory();
  });

  test("an untouched field follows the document value", () => {
    expect(effectiveSlotMode("f|1", "plain")).toBe("literal");
    expect(effectiveSlotMode("f|2", "${state.x}")).toBe("template");
    expect(effectiveSlotMode("f|3", { $ref: "#/state/x" })).toBe("ref");
  });

  test("typing ${ into a fixed-value field does not swap it to mixed text", () => {
    expect(effectiveSlotMode("f|typing", "hello")).toBe("literal");
    expect(effectiveSlotMode("f|typing", "hello ${")).toBe("literal");
    expect(effectiveSlotMode("f|typing", "hello ${state.x}")).toBe("literal");
  });

  test("deleting the placeholder does not swap a mixed-text field back either", () => {
    expect(effectiveSlotMode("f|mixed", "${state.x}")).toBe("template");
    expect(effectiveSlotMode("f|mixed", "")).toBe("template");
    expect(effectiveSlotMode("f|mixed", "plain words")).toBe("template");
  });

  test("a structural change — one a keystroke cannot make — still moves the rung", () => {
    expect(effectiveSlotMode("f|struct", "hello")).toBe("literal");
    expect(effectiveSlotMode("f|struct", { $ref: "#/state/x" })).toBe("ref");
    expect(effectiveSlotMode("f|struct", { $expression: { operator: "!", target: null } })).toBe(
      "expression",
    );
    expect(effectiveSlotMode("f|struct", "back to text")).toBe("literal");
  });

  test("an explicit choice wins over the value's own shape", () => {
    expect(effectiveSlotMode("f|chosen", "hello")).toBe("literal");
    setSlotMode("f|chosen", "template");
    expect(effectiveSlotMode("f|chosen", "hello")).toBe("template");
  });
});

// ─── The shared switch, used by the Logic tab too ────────────────────────────

describe("switchSlotMode", () => {
  beforeEach(() => {
    resetSlotModeMemory();
  });

  test("stashes the outgoing representation and returns the seed the first time", () => {
    const seed = { $expression: { operator: "=", target: null } };
    expect(switchSlotMode("ev|onclick", "function", "expression", { body: "x" }, seed)).toBe(seed);
  });

  test("returns the remembered representation on the way back", () => {
    const body = { $prototype: "Function", body: "state.count++", parameters: [] };
    switchSlotMode("ev|onclick", "function", "expression", body, {
      $expression: { operator: "=", target: null },
    });
    const back = switchSlotMode(
      "ev|onclick",
      "expression",
      "function",
      { $expression: { operator: "=", target: null } },
      { $prototype: "Function", body: "", parameters: [] },
    );
    expect(back).toEqual(body);
  });

  test("the stash is a clone, so later edits cannot reach back into it", () => {
    const body = { $prototype: "Function", body: "one", parameters: [] };
    switchSlotMode("ev|onblur", "function", "ref", body, { $ref: "" });
    body.body = "two";
    const back = switchSlotMode("ev|onblur", "ref", "function", { $ref: "" }, null);
    expect((back as { body: string }).body).toBe("one");
  });

  test("it records the rung, so the next render honours the switch", () => {
    switchSlotMode("f|rec", "literal", "template", "hello", "${}");
    expect(effectiveSlotMode("f|rec", "hello")).toBe("template");
  });
});
