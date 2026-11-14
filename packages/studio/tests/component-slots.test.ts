import { describe, expect, test } from "bun:test";
import { validateComponentSlots } from "../src/services/component-slots";

describe("validateComponentSlots", () => {
  test("no slots is valid", () => {
    expect(validateComponentSlots({ children: [{ tagName: "div" }], tagName: "my-card" })).toBe(
      null,
    );
  });

  test("one unnamed slot is valid", () => {
    expect(validateComponentSlots({ children: [{ tagName: "slot" }], tagName: "my-card" })).toBe(
      null,
    );
  });

  test("unnamed plus named slots is valid", () => {
    const doc = {
      children: [{ tagName: "slot" }, { attributes: { name: "header" }, tagName: "slot" }],
      tagName: "my-card",
    };
    expect(validateComponentSlots(doc)).toBe(null);
  });

  test("two unnamed slots is invalid", () => {
    const doc = {
      children: [{ tagName: "slot" }, { tagName: "slot" }],
      tagName: "my-card",
    };
    expect(validateComponentSlots(doc)).toMatch(/unnamed/);
  });

  test("whitespace-only name counts as unnamed", () => {
    const doc = {
      children: [{ tagName: "slot" }, { attributes: { name: "  " }, tagName: "slot" }],
      tagName: "my-card",
    };
    expect(validateComponentSlots(doc)).toMatch(/unnamed/);
  });

  test("duplicate named slots is invalid", () => {
    const doc = {
      children: [
        { attributes: { name: "header" }, tagName: "slot" },
        { attributes: { name: "header" }, tagName: "slot" },
      ],
      tagName: "my-card",
    };
    expect(validateComponentSlots(doc)).toMatch(/Duplicate slot name "header"/);
  });

  test("distinct named slots are valid", () => {
    const doc = {
      children: [
        { attributes: { name: "header" }, tagName: "slot" },
        { attributes: { name: "footer" }, tagName: "slot" },
      ],
      tagName: "my-card",
    };
    expect(validateComponentSlots(doc)).toBe(null);
  });

  test("counts nested slots", () => {
    const doc = {
      children: [
        { children: [{ tagName: "slot" }], tagName: "main" },
        { children: [{ tagName: "slot" }], tagName: "aside" },
      ],
      tagName: "my-card",
    };
    expect(validateComponentSlots(doc)).toMatch(/2 unnamed/);
  });
});
