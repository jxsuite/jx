/**
 * The menu surface adapter on its own: what `openMenu()` owes a caller — a mounted `jx-menu` in a
 * popover layer slot that carries the region, `run` before close on select, one `onClosed` however
 * the menu went, a close that lands before the mount does, and the keyboard handed back.
 */
import "./with-dom";

import { afterEach, describe, expect, test } from "bun:test";

import { flush } from "./harness";
import { initLayers } from "../src/ui/layers";

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  const el = document.createElement("div");
  el.id = id;
  document.body.append(el);
}
initLayers();

const { openMenu } = await import("../src/surfaces/menu");

type MenuEl = HTMLElement & { open: boolean; x: number; y: number };

const ROWS = [
  { destructive: false, disabled: false, dividerAbove: false, id: "a", title: "Alpha" },
  {
    chord: "⌘B",
    destructive: true,
    disabled: false,
    dividerAbove: true,
    id: "b",
    title: "Beta",
  },
  {
    destructive: false,
    disabled: true,
    dividerAbove: false,
    id: "c",
    requires: "a selection",
    title: "Gamma",
  },
];

function menuIn(host: HTMLElement): MenuEl | null {
  return host.querySelector("jx-menu");
}

let open: ReturnType<typeof openMenu> | null = null;

afterEach(() => {
  open?.close();
  open = null;
});

describe("openMenu", () => {
  test("mounts a jx-menu into the popover slot that carries the region, and shows it", async () => {
    const ran: string[] = [];
    open = openMenu({
      label: "Things",
      origin: { x: 40, y: 50 },
      region: "test",
      rows: ROWS,
      run: (id) => ran.push(id),
    });
    expect(open.host.dataset.jxRegion).toBe("overlay.menu:test");
    await open.ready;
    const menu = menuIn(open.host)!;
    expect(menu.getAttribute("aria-label")).toBe("Things");
    expect(menu.x).toBe(40);
    expect(menu.y).toBe(50);
    await flush();
    expect(menu.open).toBe(true);
    const rows = [...menu.querySelectorAll<HTMLElement>("jx-menu-item")];
    expect(rows.map((row) => row.dataset.commandId)).toEqual(["a", "b", "c"]);
    expect(menu.querySelectorAll("hr")).toHaveLength(1);
    expect(rows[1]!.querySelector("kbd")!.textContent).toBe("⌘B");
    expect(rows[2]!.getAttribute("aria-disabled")).toBe("true");
    expect(rows[2]!.getAttribute("title")).toBe("a selection");
    expect(rows[2]!.querySelector('[slot="description"]')!.textContent).toBe("Needs a selection");
    expect(ran).toEqual([]);
  });

  test("a row's select runs the command before the menu closes, and onClosed fires once", async () => {
    const events: string[] = [];
    let handleSeen: unknown = null;
    open = openMenu({
      label: "Things",
      onClosed: (handle) => {
        events.push("closed");
        handleSeen = handle;
      },
      origin: { x: 0, y: 0 },
      region: "test",
      rows: ROWS,
      run: (id) => {
        // The menu is still up when the command runs.
        events.push(`run:${id}`, menuIn(open!.host) ? "up" : "gone");
      },
    });
    await open.ready;
    await flush();
    menuIn(open.host)!.querySelector<HTMLElement>('[data-command-id="b"]')!.click();
    await flush();
    expect(events).toEqual(["run:b", "up", "closed"]);
    expect(handleSeen).toBe(open);
    expect(menuIn(open.host)).toBeNull();
    // A second close is a no-op: nothing fires twice.
    open.close();
    await flush();
    expect(events).toEqual(["run:b", "up", "closed"]);
  });

  test("closing before the mount has finished leaves nothing behind", async () => {
    let closed = 0;
    open = openMenu({
      label: "Things",
      onClosed: () => {
        closed += 1;
      },
      origin: { x: 0, y: 0 },
      region: "test",
      rows: ROWS,
      run: () => {},
    });
    const { host } = open;
    open.close();
    open = null;
    await flush();
    expect(closed).toBe(1);
    expect(host.isConnected).toBe(false);
    expect(document.querySelector("#layer-popover jx-menu")).toBeNull();
  });

  test("a light dismissal hands the keyboard back to the opener", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    open = openMenu({
      label: "Things",
      opener,
      origin: { x: 0, y: 0 },
      region: "test",
      rows: ROWS,
      run: () => {},
    });
    await open.ready;
    await flush();
    expect(document.activeElement).not.toBe(opener);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(menuIn(open.host)).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
