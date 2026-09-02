import "./with-dom.ts";

import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { iconPath, registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxIcon = HTMLElement & { name: string; weight: string; label: string; mirror: boolean };

let warn: ReturnType<typeof spyOn>;

beforeAll(async () => {
  await registerUi();
});

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => null);
});

afterEach(() => {
  warn.mockRestore();
  document.body.replaceChildren();
});

async function icon(attrs: Record<string, string>): Promise<JxIcon> {
  const el = document.createElement("jx-icon") as JxIcon;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.body.append(el);
  await tick();
  return el;
}

const pathOf = (el: Element) => el.querySelector("path")?.getAttribute("d") ?? "";

describe("jx-icon", () => {
  test("draws the named glyph and hides itself from assistive technology by default", async () => {
    const el = await icon({ name: "plus" });
    const svg = el.querySelector("svg")!;
    expect(pathOf(el)).toBe(iconPath("plus", "regular"));
    expect(svg.getAttribute("viewBox")).toBe("0 0 256 256");
    expect(svg.getAttribute("part")).toBe("svg");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("aria-label")).toBe("");
  });

  test("a label names it as an image", async () => {
    const el = await icon({ name: "plus", label: "Add" });
    const svg = el.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Add");
    expect(svg.getAttribute("aria-hidden")).toBe("false");
  });

  test("weight selects the drawing, and falls back to regular", async () => {
    const bold = await icon({ name: "plus", weight: "bold" });
    expect(pathOf(bold)).toBe(iconPath("plus", "bold"));
    const missing = await icon({ name: "trash", weight: "bold" });
    expect(pathOf(missing)).toBe(iconPath("trash", "regular"));
  });

  test("an unknown name draws nothing and warns once", async () => {
    const el = await icon({ name: "no-such-glyph" });
    expect(pathOf(el)).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("mirror flips the drawing", async () => {
    const el = await icon({ name: "sidebar-simple", mirror: "" });
    expect(el.querySelector("svg")!.getAttribute("style")).toContain("scale(-1, 1)");
    const plain = await icon({ name: "sidebar-simple" });
    expect(plain.querySelector("svg")!.getAttribute("style")).toContain("none");
  });

  test("name and weight follow property and attribute writes after connection", async () => {
    const el = await icon({ name: "plus" });
    el.name = "x";
    await tick();
    expect(pathOf(el)).toBe(iconPath("x", "regular"));
    el.setAttribute("weight", "bold");
    await tick();
    expect(pathOf(el)).toBe(iconPath("x", "bold"));
  });
});
