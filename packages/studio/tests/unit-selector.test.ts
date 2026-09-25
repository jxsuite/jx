/**
 * The CSS length grammar the Style tab parses a typed value with.
 *
 * What this file used to test as well — the display value, the placeholder, the unit menu and the
 * two commit paths — is the Style tab's own now: the control is `surfaces/style-panel.json`'s
 * `group` widget over the kit, so those contracts are asserted in `style-panel.test.ts` against the
 * row that draws them. What is left here is the grammar itself, which is a decision rather than a
 * rendering and is read three times over by the panel.
 */
import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import { UNIT_RE } from "../src/ui/unit-selector";

// ─── UNIT_RE ─────────────────────────────────────────────────────────────────

describe("UNIT_RE", () => {
  test("matches integer + unit", () => {
    const m = "500px".match(UNIT_RE)!;
    expect(m[1]).toBe("500");
    expect(m[2]).toBe("px");
  });

  test("matches decimal + unit", () => {
    const m = "1.5rem".match(UNIT_RE)!;
    expect(m[1]).toBe("1.5");
    expect(m[2]).toBe("rem");
  });

  test("matches percent", () => {
    const m = "100%".match(UNIT_RE)!;
    expect(m[1]).toBe("100");
    expect(m[2]).toBe("%");
  });

  test("matches unitless number (optional unit group is undefined)", () => {
    const m = "0".match(UNIT_RE)!;
    expect(m[1]).toBe("0");
    expect(m[2]).toBeUndefined();
  });

  test("matches negative value", () => {
    const m = "-10px".match(UNIT_RE)!;
    expect(m[1]).toBe("-10");
    expect(m[2]).toBe("px");
  });

  test("does not match keyword", () => {
    expect("auto".match(UNIT_RE)).toBeNull();
  });

  test("does not match value with space before unit", () => {
    expect("500 px".match(UNIT_RE)).toBeNull();
  });

  test("does not match unknown unit", () => {
    expect("500abc".match(UNIT_RE)).toBeNull();
  });
});
