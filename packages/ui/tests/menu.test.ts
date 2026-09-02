import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { mount } from "@jxsuite/runtime";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

import { registerUi } from "../src/index.ts";
import { rootMenuOf, rowsOf, submenuOf } from "../src/behaviors/menu.ts";

/** Let the popover shim's queued `toggle` and the runtime's `onMount` settle. */
const flush = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type MenuEl = HTMLElement & { open: boolean; x: number; y: number };
type RowEl = HTMLElement & { expanded: boolean };

interface RowSpec {
  disabled?: boolean;
  destructive?: boolean;
  requires?: string;
  checked?: string;
  chord?: string;
  submenu?: JxElement[];
}

function row(value: string, title: string, spec: RowSpec = {}): JxElement {
  const children: JxElement[] = [{ tagName: "span", textContent: title }];
  if (spec.chord) {
    children.push({ tagName: "kbd", attributes: { slot: "value" }, textContent: spec.chord });
  }
  if (spec.submenu) {
    children.push({
      tagName: "jx-menu",
      attributes: { slot: "submenu" },
      $props: { label: `${title} submenu` },
      children: spec.submenu,
    });
  }
  return {
    tagName: "jx-menu-item",
    $props: {
      value,
      disabled: spec.disabled ?? false,
      destructive: spec.destructive ?? false,
      requires: spec.requires ?? "",
      checked: spec.checked ?? "",
      haspopup: Boolean(spec.submenu),
    },
    children,
  } as JxElement;
}

const DOC: JxDocument = {
  tagName: "div",
  children: [
    {
      tagName: "jx-menu",
      id: "m",
      $props: { label: "Actions", x: 10, y: 20 },
      children: [
        row("copy", "Copy", { chord: "⌘C" }),
        row("paste", "Paste", { disabled: true, requires: "something on the clipboard" }),
        { tagName: "hr" },
        row("grid", "Show grid", { checked: "true" }),
        row("settings", "Settings", {
          submenu: [row("general", "General"), row("media", "Media")],
        }),
        row("delete", "Delete", { destructive: true }),
      ],
    },
  ],
} as unknown as JxDocument;

let dispose: (() => void) | null = null;

async function open(): Promise<{ menu: MenuEl; rows: RowEl[]; selected: string[] }> {
  const host = document.createElement("div");
  document.body.append(host);
  ({ dispose } = await mount(DOC, host));
  await flush();
  const menu = host.querySelector("jx-menu") as MenuEl;
  const selected: string[] = [];
  menu.addEventListener("select", (e) => {
    selected.push(String((e as CustomEvent).detail));
  });
  menu.showPopover();
  await flush();
  return { menu, rows: rowsOf(menu, { includeDisabled: true }) as RowEl[], selected };
}

/**
 * Press a key where a keyboard would: at the focused row, or at `fallback` when nothing inside it
 * has focus.
 */
function key(fallback: Element, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  const active = document.activeElement;
  const target = active && fallback.contains(active) ? active : fallback;
  target.dispatchEvent(event);
  return event;
}

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

describe("jx-menu", () => {
  test("is a native auto popover with the menu role and the given name and position", async () => {
    const { menu } = await open();
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("popover")).toBe("auto");
    expect(menu.getAttribute("aria-label")).toBe("Actions");
    // A bound style value is carried by an inline `--jx-r…` custom property the rule reads.
    expect(menu.getAttribute("style")).toContain("10px");
    expect(menu.getAttribute("style")).toContain("20px");
    expect(menu.x).toBe(10);
    expect(menu.open).toBe(true);
    expect(menu.dataset.popoverOpen !== undefined).toBe(true);
  });

  test("announces jx-ready once it has rendered", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const seen: string[] = [];
    host.addEventListener("jx-ready", (e) => {
      seen.push((e.target as Element).localName);
    });
    ({ dispose } = await mount(DOC, host));
    await flush();
    expect(seen).toContain("jx-menu");
  });

  test("rows carry the menuitem contract from their props", async () => {
    const { rows } = await open();
    const [copy, paste, grid, settings, del] = rows;
    expect(copy!.getAttribute("role")).toBe("menuitem");
    expect(copy!.getAttribute("tabindex")).toBe("0");
    expect(copy!.getAttribute("aria-disabled")).toBe("false");
    expect(copy!.hasAttribute("aria-haspopup")).toBe(false);
    expect(copy!.hasAttribute("aria-checked")).toBe(false);
    expect(copy!.hasAttribute("title")).toBe(false);
    expect(copy!.querySelector("[part='value'] kbd")!.textContent).toBe("⌘C");

    expect(paste!.getAttribute("aria-disabled")).toBe("true");
    expect(paste!.getAttribute("title")).toBe("something on the clipboard");

    expect(grid!.getAttribute("role")).toBe("menuitemcheckbox");
    expect(grid!.getAttribute("aria-checked")).toBe("true");

    expect(settings!.getAttribute("aria-haspopup")).toBe("menu");
    expect(settings!.getAttribute("aria-expanded")).toBe("false");
    expect(settings!.querySelector("[part='chevron']")!.hasAttribute("hidden")).toBe(false);
    expect(copy!.querySelector("[part='chevron']")!.hasAttribute("hidden")).toBe(true);

    expect(del!.getAttribute("style")).toContain("var(--jx-danger)");
    expect(copy!.getAttribute("style")).toContain("inherit");
  });

  test("showing moves the caret to the first row", async () => {
    const { rows } = await open();
    expect(document.activeElement).toBe(rows[0]!);
  });

  test("Arrow keys, Home and End move the caret and skip disabled rows, wrapping", async () => {
    const { menu, rows } = await open();
    const [copy, , grid, settings, del] = rows;
    key(menu, "ArrowDown");
    expect(document.activeElement).toBe(grid!);
    key(menu, "ArrowUp");
    expect(document.activeElement).toBe(copy!);
    key(menu, "ArrowUp");
    expect(document.activeElement).toBe(del!);
    key(menu, "ArrowDown");
    expect(document.activeElement).toBe(copy!);
    key(menu, "End");
    expect(document.activeElement).toBe(del!);
    key(menu, "Home");
    expect(document.activeElement).toBe(copy!);
    key(menu, "s");
    expect(document.activeElement).toBe(grid!);
    key(menu, "s");
    expect(document.activeElement).toBe(settings!);
    key(menu, "s");
    expect(document.activeElement).toBe(grid!);
    expect(grid!.tabIndex).toBe(0);
    expect(copy!.tabIndex).toBe(-1);
  });

  test("a key the menu does not own is left for the host", async () => {
    const { menu } = await open();
    expect(key(menu, "F5").defaultPrevented).toBe(false);
    expect(key(menu, "ArrowDown").defaultPrevented).toBe(true);
    expect(key(menu, "z").defaultPrevented).toBe(false);
  });

  test("Enter, Space and a click select the row; a disabled row selects nothing", async () => {
    const { menu, rows, selected } = await open();
    key(menu, "Enter");
    key(menu, "ArrowDown");
    key(menu, " ");
    rows[4]!.click();
    rows[1]!.click();
    expect(selected).toEqual(["copy", "grid", "delete"]);
  });

  test("Escape hides the menu and clears open", async () => {
    const { menu } = await open();
    key(menu, "Escape");
    await flush();
    expect(menu.open).toBe(false);
    expect(menu.dataset.popoverOpen !== undefined).toBe(false);
  });

  test("a mousedown outside light-dismisses it", async () => {
    const { menu } = await open();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(menu.open).toBe(false);
  });

  test("ArrowRight opens the row's submenu beside it and moves the caret in; ArrowLeft comes back", async () => {
    const { menu, rows } = await open();
    const settings = rows[3]!;
    const sub = submenuOf(settings) as MenuEl;
    expect(sub).not.toBeNull();
    expect(rootMenuOf(sub)).toBe(menu);
    key(menu, "ArrowDown");
    key(menu, "ArrowDown");
    expect(document.activeElement).toBe(settings);
    key(menu, "ArrowRight");
    await flush();
    expect(sub.open).toBe(true);
    expect(settings.getAttribute("aria-expanded")).toBe("true");
    const subRows = rowsOf(sub);
    expect(subRows.map((r) => r.textContent?.trim())).toEqual(["General", "Media"]);
    expect(document.activeElement).toBe(subRows[0]!);
    expect(menu.open).toBe(true);

    key(subRows[0]!, "ArrowDown");
    expect(document.activeElement).toBe(subRows[1]!);

    key(subRows[1]!, "ArrowLeft");
    await flush();
    expect(sub.open).toBe(false);
    expect(settings.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(settings);
    expect(menu.open).toBe(true);
  });

  test("a submenu row selects through the root menu", async () => {
    const { menu, rows, selected } = await open();
    const sub = submenuOf(rows[3]!) as MenuEl;
    key(menu, "ArrowDown");
    key(menu, "ArrowDown");
    key(menu, "ArrowRight");
    await flush();
    key(rowsOf(sub)[1]!, "Enter");
    expect(selected).toEqual(["media"]);
  });

  test("Escape in a submenu closes one level; Tab closes the whole stack", async () => {
    const { menu, rows } = await open();
    const sub = submenuOf(rows[3]!) as MenuEl;
    key(menu, "ArrowDown");
    key(menu, "ArrowDown");
    key(menu, "ArrowRight");
    await flush();
    key(rowsOf(sub)[0]!, "Escape");
    await flush();
    expect(sub.open).toBe(false);
    expect(menu.open).toBe(true);
    expect(document.activeElement).toBe(rows[3]!);

    key(menu, "ArrowRight");
    await flush();
    expect(sub.open).toBe(true);
    key(rowsOf(sub)[0]!, "Tab");
    await flush();
    expect(sub.open).toBe(false);
    expect(menu.open).toBe(false);
  });

  test("hovering a row opens its submenu and hovering another closes it", async () => {
    const { rows } = await open();
    const settings = rows[3]!;
    const sub = submenuOf(settings) as MenuEl;
    settings.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await flush();
    expect(sub.open).toBe(true);
    expect(settings.expanded).toBe(true);
    rows[0]!.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await flush();
    expect(sub.open).toBe(false);
    expect(settings.expanded).toBe(false);
  });

  test("hiding the root hides an open submenu with it", async () => {
    const { menu, rows } = await open();
    const sub = submenuOf(rows[3]!) as MenuEl;
    key(menu, "ArrowDown");
    key(menu, "ArrowDown");
    key(menu, "ArrowRight");
    await flush();
    menu.hidePopover();
    await flush();
    expect(sub.open).toBe(false);
    expect(menu.open).toBe(false);
  });

  test("disposing the mount takes the menu with it", async () => {
    const { menu } = await open();
    dispose!();
    dispose = null;
    expect(menu.isConnected).toBe(false);
  });
});
