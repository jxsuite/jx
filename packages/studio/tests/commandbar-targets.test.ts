/**
 * The Command Bar's controls draw at the kit's full control height (`studio-ui-guidelines.md`
 * §3.1).
 *
 * They are the buttons a reader presses all day, so they draw `md` (24px, the WCAG 2.2 SC 2.5.8
 * target) rather than `sm`, whose 20px box only reaches 24px through an invisible hit area. The bar
 * is 36px tall, so `md` costs it nothing. The one exception is the window controls, which draw the
 * host platform's own look.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";

const KIT_BUTTONS = new Set(["jx-button", "jx-action-button"]);

/** Every kit button in the document, with whether it sits inside the window controls. */
function buttons(node: JsonValue, inWindow = false): { size: JsonValue; inWindow: boolean }[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => buttons(child, inWindow));
  }
  if (!isJsonObject(node)) {
    return [];
  }
  const attributes = isJsonObject(node["attributes"]) ? node["attributes"] : {};
  const here = inWindow || attributes["part"] === "window-controls";
  const props = isJsonObject(node["$props"]) ? node["$props"] : {};
  const own =
    isString(node["tagName"]) && KIT_BUTTONS.has(node["tagName"])
      ? [{ size: props["size"] ?? null, inWindow: here }]
      : [];
  return [
    ...own,
    ...Object.entries(node)
      .filter(([key]) => key !== "style")
      .flatMap(([, value]) => buttons(value, here)),
  ];
}

describe("the Command Bar's targets", () => {
  const doc: JsonValue = JSON.parse(
    readFileSync(new URL("../src/surfaces/commandbar.json", import.meta.url), "utf8"),
  );
  const all = buttons(doc);

  test("every control outside the window controls draws md", () => {
    const app = all.filter((b) => !b.inWindow);
    expect(app.length).toBeGreaterThanOrEqual(5);
    expect(app.map((b) => b.size)).toEqual(app.map(() => "md"));
  });

  test("the window controls keep the platform's small size", () => {
    const win = all.filter((b) => b.inWindow);
    expect(win.length).toBeGreaterThan(0);
    expect(win.map((b) => b.size)).toEqual(win.map(() => "sm"));
  });
});
