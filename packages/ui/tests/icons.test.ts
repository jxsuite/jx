import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { hasIcon, ICON_NAMES, iconPath, iconViewBox } from "../src/icons.ts";
import { ICON_VIEW_BOX } from "../src/icons-build.ts";

let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => null);
});

afterEach(() => {
  warn.mockRestore();
});

describe("icon lookup", () => {
  test("names are sorted and the viewBox is the manifest's", () => {
    expect(ICON_NAMES).toEqual([...ICON_NAMES].toSorted());
    expect(ICON_NAMES).toContain("plus");
    expect(iconViewBox).toBe(ICON_VIEW_BOX);
  });

  test("hasIcon answers per name and per weight", () => {
    expect(hasIcon("plus")).toBe(true);
    expect(hasIcon("plus", "bold")).toBe(true);
    expect(hasIcon("trash", "bold")).toBe(false);
    expect(hasIcon("no-such-icon")).toBe(false);
  });

  test("a weight the manifest lacks falls back to regular", () => {
    expect(iconPath("trash", "bold")).toBe(iconPath("trash", "regular"));
    expect(iconPath("plus", "bold")).not.toBe(iconPath("plus", "regular"));
    expect(iconPath("plus", "nonsense")).toBe(iconPath("plus", "regular"));
  });

  test("an unknown name draws nothing and warns once", () => {
    expect(iconPath("no-such-icon", "regular")).toBe("");
    expect(iconPath("no-such-icon", "regular")).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("no-such-icon");
  });

  test("a missing or non-string name draws nothing silently", () => {
    expect(iconPath("", "regular")).toBe("");
    expect(iconPath(undefined, "regular")).toBe("");
    expect(iconPath(42, "regular")).toBe("");
    expect(warn).not.toHaveBeenCalled();
  });
});
