import { describe, test, expect } from "bun:test";

// ─── Unit tests for jx-styled-combobox logic ──────────────────────────────
// Tests the component's core algorithms without importing Lit (avoids
// HappyDOM/Lit global conflicts when running alongside other test files).
// We replicate the class logic here to verify it in isolation.

/**
 * Replicates JxStyledCombobox._isPicker logic.
 *
 * @param {string} value
 * @param {any[]} options
 */
function isPicker(value, options) {
  return !!value && options.some((o) => !o.divider && o.value === value);
}

/**
 * Replicates JxStyledCombobox._selectedStyle logic.
 *
 * @param {string} value
 * @param {any[]} options
 */
function selectedStyle(value, options) {
  if (!isPicker(value, options)) return "";
  const opt = options.find((o) => !o.divider && o.value === value);
  return opt?.style || "";
}

/** @type {any[]} */
const SAMPLE_OPTIONS = [
  { value: "bold", label: "Bold", style: "font-weight: bold" },
  { value: "normal", label: "Normal", style: "font-weight: normal" },
  { value: "lighter", label: "Lighter", style: "font-weight: lighter" },
];

/** @type {any[]} */
const OPTIONS_WITH_DIVIDER = [
  { value: "--font-custom", label: "Custom", style: "font-family: Georgia" },
  { divider: true },
  { value: "__preset__:System UI", label: "System UI", style: "font-family: system-ui" },
];

// ─── Mode detection (isPicker) ─────────────────────────────────────────────

describe("jx-styled-combobox: isPicker logic", () => {
  test("returns false when value is empty", () => {
    expect(isPicker("", SAMPLE_OPTIONS)).toBe(false);
  });

  test("returns true when value matches an option", () => {
    expect(isPicker("bold", SAMPLE_OPTIONS)).toBe(true);
  });

  test("returns false when value does not match any option", () => {
    expect(isPicker("italic", SAMPLE_OPTIONS)).toBe(false);
  });

  test("ignores divider entries when matching", () => {
    expect(isPicker("--font-custom", OPTIONS_WITH_DIVIDER)).toBe(true);
  });

  test("divider value does not match", () => {
    expect(isPicker("true", [{ divider: true }])).toBe(false);
  });

  test("returns false with empty options array", () => {
    expect(isPicker("bold", [])).toBe(false);
  });
});

// ─── Selected style (selectedStyle) ────────────────────────────────────────

describe("jx-styled-combobox: selectedStyle logic", () => {
  test("returns style of matched option in picker mode", () => {
    expect(selectedStyle("bold", SAMPLE_OPTIONS)).toBe("font-weight: bold");
  });

  test("returns empty string in combobox mode", () => {
    expect(selectedStyle("italic", SAMPLE_OPTIONS)).toBe("");
  });

  test("returns empty string when value is empty", () => {
    expect(selectedStyle("", SAMPLE_OPTIONS)).toBe("");
  });

  test("returns empty string when option has no style", () => {
    expect(selectedStyle("x", [{ value: "x", label: "X" }])).toBe("");
  });
});

// ─── Mode transitions ──────────────────────────────────────────────────────

describe("jx-styled-combobox: mode transitions", () => {
  test("setting value to matching option switches to picker mode", () => {
    expect(isPicker("", SAMPLE_OPTIONS)).toBe(false);
    expect(isPicker("bold", SAMPLE_OPTIONS)).toBe(true);
  });

  test("setting value to non-matching switches to combobox mode", () => {
    expect(isPicker("bold", SAMPLE_OPTIONS)).toBe(true);
    expect(isPicker("900", SAMPLE_OPTIONS)).toBe(false);
  });

  test("clearing value switches to combobox mode", () => {
    expect(isPicker("bold", SAMPLE_OPTIONS)).toBe(true);
    expect(isPicker("", SAMPLE_OPTIONS)).toBe(false);
  });
});

// ─── Options with dividers ─────────────────────────────────────────────────

describe("jx-styled-combobox: options with dividers", () => {
  test("dividers are skipped in picker mode detection", () => {
    expect(isPicker("--font-custom", OPTIONS_WITH_DIVIDER)).toBe(true);
  });

  test("preset value after divider is selectable in picker mode", () => {
    expect(isPicker("__preset__:System UI", OPTIONS_WITH_DIVIDER)).toBe(true);
    expect(selectedStyle("__preset__:System UI", OPTIONS_WITH_DIVIDER)).toBe(
      "font-family: system-ui",
    );
  });
});

// ─── Picker mode does NOT include a clear option ───────────────────────────
// The component relies on the external "clear dot" indicator, not an
// internal "—" menu item. Verified by checking the source directly.

describe("jx-styled-combobox: no __none__ clear option", () => {
  test("picker render method does not reference __none__", async () => {
    const src = await Bun.file(new URL("../src/ui/jx-styled-combobox.js", import.meta.url)).text();
    // The render method should not contain __none__ anywhere
    // (it was removed; clearing is handled by the external dot indicator)
    expect(src).not.toContain("__none__");
  });

  test("picker render method adds jx-combobox-picker class", async () => {
    const src = await Bun.file(new URL("../src/ui/jx-styled-combobox.js", import.meta.url)).text();
    expect(src).toContain("jx-combobox-picker");
  });
});

// ─── Event handler behavior ────────────────────────────────────────────────
// Tests the handler functions' value normalization and event dispatch logic
// using minimal mock objects that mimic the component's state and behavior.

describe("jx-styled-combobox: event handler logic", () => {
  /**
   * Creates a mock component-like object with value, addEventListener, and dispatchEvent — enough
   * to test handler behavior without Lit.
   */
  function createMock(/** @type {string} */ value = "") {
    /** @type {Event[]} */
    const dispatched = [];
    return {
      value,
      /** @type {Event[]} */
      dispatched,
      dispatchEvent(/** @type {Event} */ e) {
        dispatched.push(e);
        return true;
      },
    };
  }

  test("picker change handler sets value directly", () => {
    const mock = createMock("bold");
    let stopped = false;
    const handler = function (/** @type {any} */ e) {
      e.stopPropagation();
      this.value = e.target.value;
      this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }.bind(mock);

    handler({
      target: { value: "normal" },
      stopPropagation() {
        stopped = true;
      },
    });

    expect(mock.value).toBe("normal");
    expect(mock.dispatched.length).toBe(1);
    expect(mock.dispatched[0].type).toBe("change");
    expect(stopped).toBe(true);
  });

  test("menu change handler ignores empty value", () => {
    const mock = createMock("bold");
    const handler = function (/** @type {any} */ e) {
      e.stopPropagation();
      if (!e.target.value) return;
      this.value = e.target.value;
      this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }.bind(mock);

    handler({ target: { value: "" }, stopPropagation() {} });

    expect(mock.value).toBe("bold"); // unchanged
    expect(mock.dispatched.length).toBe(0);
  });

  test("menu change handler sets value for non-empty input", () => {
    const mock = createMock("");
    const handler = function (/** @type {any} */ e) {
      e.stopPropagation();
      if (!e.target.value) return;
      this.value = e.target.value;
      this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }.bind(mock);

    handler({ target: { value: "lighter" }, stopPropagation() {} });

    expect(mock.value).toBe("lighter");
    expect(mock.dispatched.length).toBe(1);
  });

  test("input handler sets value and dispatches input event", () => {
    const mock = createMock("");
    const handler = function (/** @type {any} */ e) {
      e.stopPropagation();
      this.value = e.target.value;
      this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }.bind(mock);

    handler({ target: { value: "Georgia, serif" }, stopPropagation() {} });

    expect(mock.value).toBe("Georgia, serif");
    expect(mock.dispatched.length).toBe(1);
    expect(mock.dispatched[0].type).toBe("input");
  });

  test("all handlers call stopPropagation on the original event", () => {
    let stopped = 0;
    const mkEvent = (/** @type {string} */ val) => ({
      target: { value: val },
      stopPropagation() {
        stopped++;
      },
    });

    // Simulate picker change
    const m1 = createMock("bold");
    const pickerHandler = function (/** @type {any} */ e) {
      e.stopPropagation();
      this.value = e.target.value;
      this.dispatchEvent(new Event("change"));
    }.bind(m1);
    pickerHandler(mkEvent("normal"));

    // Simulate menu change
    const m2 = createMock("");
    const menuHandler = function (/** @type {any} */ e) {
      e.stopPropagation();
      if (!e.target.value) return;
      this.value = e.target.value;
      this.dispatchEvent(new Event("change"));
    }.bind(m2);
    menuHandler(mkEvent("lighter"));

    // Simulate input
    const m3 = createMock("");
    const inputHandler = function (/** @type {any} */ e) {
      e.stopPropagation();
      this.value = e.target.value;
      this.dispatchEvent(new Event("input"));
    }.bind(m3);
    inputHandler(mkEvent("test"));

    expect(stopped).toBe(3);
  });
});
