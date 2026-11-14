import "./with-dom.js";

import { describe, expect, test } from "bun:test";
import { preloadModule, resolve } from "@jxsuite/runtime";
import { getNestedStyle } from "@jxsuite/schema/guards";
import { KIT_LOADERS } from "@jxsuite/ui/loaders";
import { themeTokens } from "@jxsuite/ui/theme";

import {
  HELD_ATTR,
  chromeTheme,
  defineKitFor,
  loadSpecimen,
  prepareSpecimen,
  showRootOverlay,
} from "../src/canvas/iframe-specimen";

// The frame answers the kit's behaviour specifiers from its loaders (`iframe-entry.ts`).
for (const [specifier, load] of Object.entries(KIT_LOADERS)) {
  preloadModule(specifier, load);
}

const tick = (): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, 0);
  });

describe("loadSpecimen", () => {
  test("resolves a surface's specimen, and null for a name the table lacks", async () => {
    const statusbar = await loadSpecimen("statusbar");
    expect(statusbar?.variants).toEqual(["no-document"]);
    expect(await loadSpecimen("nope")).toBeNull();
    expect(await loadSpecimen("constructor")).toBeNull();
  });
});

describe("defineKitFor", () => {
  test("defines the kit elements a document draws, and the ones those draw", async () => {
    expect(customElements.get("jx-button")).toBeUndefined();
    await defineKitFor({
      children: [{ tagName: "jx-button" }, { tagName: "x-not-the-kits" }, "text"],
      tagName: "div",
    });
    // The button was named; the icon, the spinner and the tooltip are what the button draws.
    for (const tag of ["jx-button", "jx-icon", "jx-spinner", "jx-tooltip"]) {
      expect(customElements.get(tag), tag).toBeDefined();
    }
    expect(customElements.get("jx-dialog")).toBeUndefined();
    expect(customElements.get("x-not-the-kits")).toBeUndefined();
    // Preloaded under the URL a sibling `$ref` resolves to, so nothing is fetched for it.
    const icon = await resolve("jx-ui:/components/jx-icon.json");
    expect(icon.tagName).toBe("jx-icon");
  });

  test("a second call defines what is new and leaves the rest standing", async () => {
    const button = customElements.get("jx-button");
    await defineKitFor({ children: [{ tagName: "jx-button" }, { tagName: "jx-menu" }] });
    expect(customElements.get("jx-button")).toBe(button);
    expect(customElements.get("jx-menu")).toBeDefined();
    // A kit document reached only through an `$elements` import is defined too.
    await defineKitFor({ $elements: [{ $ref: "../components/jx-kbd.json" }], tagName: "div" });
    expect(customElements.get("jx-kbd")).toBeDefined();
  });
});

describe("chromeTheme", () => {
  test("is the kit's tokens in their layer, Studio's aliases, and the root's text and ground", () => {
    const theme = chromeTheme();
    expect(getNestedStyle(theme, "@layer jx-ui")).toBe(themeTokens);
    expect(theme["--fg"]).toContain("--jx-fg");
    expect(theme["--border"]).toContain("--jx-border");
    expect(theme["color"]).toBe("var(--fg)");
    expect(String(theme["font-family"])).toContain("--jx-font-sans");
    // The application window's own layout is not a page's.
    for (const key of ["height", "overflow", "user-select", "margin", "box-sizing"]) {
      expect(key in theme, key).toBe(false);
    }
  });
});

describe("prepareSpecimen", () => {
  test("makes the scope of the variant named, and the default for any other", async () => {
    const doc = { tagName: "div" };
    const shown = await prepareSpecimen({ name: "statusbar", variant: null }, doc);
    expect(shown?.scope["hasDocument"]).toBe(true);
    expect(Object.keys(shown?.theme ?? {})).toContain("@layer jx-ui");
    const bare = await prepareSpecimen({ name: "statusbar", variant: "no-document" }, doc);
    expect(bare?.scope["hasDocument"]).toBe(false);
    const unknown = await prepareSpecimen({ name: "statusbar", variant: "no-such" }, doc);
    expect(unknown?.scope["hasDocument"]).toBe(true);
  });

  test("is null for a surface the frame has no specimen of", async () => {
    expect(await prepareSpecimen({ name: "shell", variant: null }, { tagName: "div" })).toBeNull();
  });
});

describe("showRootOverlay", () => {
  test("a root that is a de-linked popover is drawn open and held", () => {
    const root = document.createElement("div");
    root.dataset.jxPopover = "auto";
    showRootOverlay(root);
    expect(root.dataset.jxPopoverOpen).toBe("");
    expect(root.hasAttribute(HELD_ATTR)).toBe(true);
  });

  test("a root that holds a dialog as its own child has that dialog drawn open and held", () => {
    const root = document.createElement("div");
    const dialog = document.createElement("dialog");
    const inner = document.createElement("dialog");
    dialog.append(inner);
    root.append(dialog);
    showRootOverlay(root);
    expect(dialog.dataset.jxDialogOpen).toBe("");
    expect(dialog.hasAttribute(HELD_ATTR)).toBe(true);
    // A dialog further down is the document's own, opened by the tab's state like any other.
    expect(inner.dataset.jxDialogOpen).toBeUndefined();
  });

  test("a plain root and a text root are left alone", async () => {
    const root = document.createElement("section");
    showRootOverlay(root);
    showRootOverlay(document.createTextNode("text"));
    root.dataset.jxPopover = "auto";
    await tick();
    // Nothing watches a root no element class will write to.
    expect(root.dataset.jxPopoverOpen).toBeUndefined();
  });

  test("a kit root is watched until it writes its popover or draws its dialog", async () => {
    const menu = document.createElement("x-late-menu");
    document.body.append(menu);
    showRootOverlay(menu);
    expect(menu.dataset.jxPopoverOpen).toBeUndefined();
    menu.append(document.createElement("slot"));
    await tick();
    expect(menu.dataset.jxPopoverOpen).toBeUndefined();
    menu.dataset.jxPopover = "auto";
    await tick();
    expect(menu.dataset.jxPopoverOpen).toBe("");

    const host = document.createElement("x-late-dialog");
    document.body.append(host);
    showRootOverlay(host);
    const dialog = document.createElement("dialog");
    host.append(dialog);
    await tick();
    expect(dialog.dataset.jxDialogOpen).toBe("");
    // The watch ended with the first overlay found: a second dialog is not this render's.
    const second = document.createElement("dialog");
    host.prepend(second);
    await tick();
    expect(second.dataset.jxDialogOpen).toBeUndefined();
    menu.remove();
    host.remove();
  });
});
