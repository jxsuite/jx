/**
 * Parent-realm adapters for canvas-iframe-originated UI: the slash-menu bridge handler
 * (src/editor/canvas-slash-bridge.ts) and the context-menu handler
 * (src/editor/canvas-context-menu.ts). Both are the DI implementations studio.ts registers with the
 * iframe host; exercised here against the real slash/context menus.
 */
import { flush, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { canvasSlashHandler } from "../src/editor/canvas-slash-bridge";
import { makeCanvasContextMenuHandler } from "../src/editor/canvas-context-menu";
import { dismissSlashMenu, isSlashMenuOpen } from "../src/editor/slash-menu";
import { dismissContextMenu } from "../src/editor/context-menu";
import { componentRegistry } from "../src/files/components";
import { initLayers } from "../src/ui/layers";
import { activeTab } from "../src/workspace/workspace";
import type { SlashCommand } from "../src/editor/inline-edit";

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

const RECT = { bottom: 60, height: 20, left: 30, top: 40, width: 120 };

/** The slash menu's rows. It is a listbox, not a menu — see `surfaces/slash-menu.json`. */
const slashRows = () => [
  ...document.querySelectorAll<HTMLElement>('#layer-popover [part="option"]'),
];

/** Which slash row is active, as an index; the panel marks it rather than focusing it. */
const activeSlashRow = () =>
  slashRows().findIndex((el) => el.getAttribute("aria-selected") === "true");

beforeEach(() => {
  resetWorkspaceWithTab({
    children: [
      { children: [{ tagName: "strong", textContent: "bold" }], tagName: "p" },
      { tagName: "x-widget" },
    ],
    tagName: "div",
  });
});

afterEach(async () => {
  dismissSlashMenu();
  dismissContextMenu();
  componentRegistry.length = 0;
  await flush();
});

describe("canvasSlashHandler", () => {
  test("show opens the real slash menu at the given rect; select round-trips the command", async () => {
    const picked: SlashCommand[] = [];
    let dismissed = 0;
    canvasSlashHandler.show({
      filter: "",
      onDismiss: () => {
        dismissed += 1;
      },
      onSelect: (cmd) => picked.push(cmd),
      rect: RECT,
    });
    await flush(3);
    expect(isSlashMenuOpen()).toBe(true);
    // The panel is placed by coordinate, not by a style string a test has to parse: the gap
    // Between the anchor and the panel is the `--jx-popover-offset` token the element applies.
    const popover = document.querySelector("#layer-popover jx-popover") as HTMLElement & {
      x: number;
      y: number;
    };
    expect(popover.x).toBe(RECT.left);
    expect(popover.y).toBe(RECT.bottom);

    // Enter selects the focused (first) item — dismiss (→ onDismiss) fires BEFORE onSelect.
    canvasSlashHandler.nav("Enter");
    expect(picked).toHaveLength(1);
    expect(dismissed).toBe(1);
    expect(isSlashMenuOpen()).toBe(false);
  });

  test("nav ArrowDown/ArrowUp moves the focused item; Escape dismisses with onDismiss", async () => {
    let dismissed = 0;
    canvasSlashHandler.show({
      filter: "",
      onDismiss: () => {
        dismissed += 1;
      },
      onSelect: () => {},
      rect: RECT,
    });
    await flush(3);
    canvasSlashHandler.nav("ArrowDown");
    await flush(2);
    expect(activeSlashRow()).toBe(1);
    canvasSlashHandler.nav("ArrowUp");
    await flush(2);
    expect(activeSlashRow()).toBe(0);
    canvasSlashHandler.nav("Escape");
    expect(isSlashMenuOpen()).toBe(false);
    expect(dismissed).toBe(1);
  });

  test("a filter with no matches never opens (immediate dismiss)", () => {
    let dismissed = 0;
    canvasSlashHandler.show({
      filter: "zzzz-no-such",
      onDismiss: () => {
        dismissed += 1;
      },
      onSelect: () => {},
      rect: RECT,
    });
    expect(isSlashMenuOpen()).toBe(false);
    // The no-match path dismisses before the menu ever registered as open — no callback leak.
    expect(dismissed).toBe(0);
  });

  test("dismiss closes an open menu", async () => {
    canvasSlashHandler.show({
      filter: "",
      onDismiss: () => {},
      onSelect: () => {},
      rect: RECT,
    });
    await flush();
    canvasSlashHandler.dismiss();
    expect(isSlashMenuOpen()).toBe(false);
  });
});

describe("makeCanvasContextMenuHandler", () => {
  test("show bubbles an inline path to its block and opens the menu at the coords", async () => {
    const handler = makeCanvasContextMenuHandler();
    // Right-click resolved to the <strong> INSIDE the <p> — the menu must act on the <p>.
    handler.show({ clientX: 77, clientY: 88, path: ["children", 0, "children", 0] });
    await flush();
    expect(activeTab.value!.session.selection).toEqual([["children", 0]]);
    const menu = document.querySelector("#layer-popover jx-menu") as HTMLElement & {
      x: number;
      y: number;
    };
    expect(menu).toBeTruthy();
    expect(menu.x).toBe(77);
    expect(menu.y).toBe(88);
  });

  test("a null path (empty canvas area) is a no-op", async () => {
    const handler = makeCanvasContextMenuHandler();
    handler.show({ clientX: 5, clientY: 5, path: null });
    await flush();
    expect(document.querySelector("#layer-popover jx-menu")).toBeNull();
  });

  test("dismiss closes the menu", async () => {
    // "Edit Component" used to be routed through a `navigateToComponent` dep this factory took and
    // Threaded in as a per-target hook. The verb is `panels/block-action-bar.ts`'s single record
    // Now, navigating through the same function studio.ts was passing to both hosts, so there is no
    // Dep here to assert — and no way for a host to forget it and lose the row.
    const handler = makeCanvasContextMenuHandler();
    handler.show({ clientX: 10, clientY: 10, path: ["children", 0] });
    await flush();
    expect(document.querySelector("#layer-popover jx-menu")).toBeTruthy();
    handler.dismiss();
    expect(document.querySelector("#layer-popover jx-menu")).toBeNull();
  });
});
