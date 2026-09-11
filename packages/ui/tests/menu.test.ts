import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText, mount } from "@jxsuite/runtime";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

import { registerUi } from "../src/index.ts";
import {
  ensureCaret,
  onMenuBeforeToggle,
  onMenuKeydown,
  onMenuPointerOver,
  onMenuToggle,
  rootMenuOf,
  rowsOf,
  SUBMENU_PLACEMENT,
  submenuOf,
} from "../src/behaviors/menu.ts";
import type { MenuState } from "../src/behaviors/menu.ts";

/** Let the popover shim's queued `toggle` and the runtime's `onMount` settle. */
const flush = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type MenuEl = HTMLElement & {
  open: boolean;
  x: number;
  y: number;
  floor: number;
  placement: string;
  anchored: boolean;
  area: string;
};

/** Pretend the engine does, or does not, position by anchor; returns the undo. */
function withAnchorSupport(answer: boolean): () => void {
  /* The DOM shim exposes `CSS` through a read-only accessor, so it is replaced by redefinition. */
  const before = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { supports: () => answer },
  });
  return () => {
    if (before) {
      Object.defineProperty(globalThis, "CSS", before);
    } else {
      delete (globalThis as { CSS?: unknown }).CSS;
    }
  };
}
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

  test("a row's five slots leave no node, and the parts its rules key on still do", async () => {
    /* Five `-slot` parts on jx-menu-item, and every one of them is a real `<slot>`, so after
       distribution none of them names a node. Nothing is lost, because no rule ever keyed on one:
       The rules key on the WRAPPERS — `& > [part="text"] > [part="label"]` and its siblings — and
       those are ordinary spans that still stand exactly where they stood, now with the projected
       content as their own direct children rather than behind a slot. Measured in Chrome 152: a
       row is 171x28 with its label and its "⌘C" both inside it. */
    const { rows } = await open();
    const copy = rows[0]!;
    const settings = rows[3]!;
    expect(copy.querySelectorAll("slot").length).toBe(0);
    for (const name of [
      "icon-slot",
      "label-slot",
      "description-slot",
      "value-slot",
      "submenu-slot",
    ]) {
      expect(copy.querySelector(`[part="${name}"]`), name).toBeNull();
    }
    // The label's text is a child of `[part="label"]`, which is a child of `[part="text"]` — the
    // Exact two-hop shape `& > [part="text"] > [part="label"]` addresses.
    const label = copy.querySelector('[part="label"]')!;
    expect(label.parentElement?.getAttribute("part")).toBe("text");
    expect(label.parentElement?.parentElement).toBe(copy);
    expect(label.textContent).toBe("Copy");
    expect(label.firstElementChild?.localName).toBe("span");
    // And the chord lands in `[part="value"]`, whose `& > [part="value"] kbd` rule is a descendant
    // Selector and so survived the slot either way.
    const value = copy.querySelector('[part="value"]')!;
    expect(value.firstElementChild?.localName).toBe("kbd");
    expect(value.parentElement).toBe(copy);
    /* The submenu is the one whose disappearance is load-bearing: `submenuOf` walks descendants,
       but the platform's popover hierarchy is a DOM-ancestor relation, so the submenu must remain
       inside the row it belongs to. It now hangs directly off it. */
    const sub = submenuOf(settings)!;
    expect(sub.parentElement).toBe(settings);
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

  /** Give an element a box, since happy-dom lays nothing out. */
  function stubRect(
    el: Element,
    rect: { left: number; top: number; width: number; height: number },
  ) {
    el.getBoundingClientRect = () =>
      ({
        ...rect,
        bottom: rect.top + rect.height,
        right: rect.left + rect.width,
        x: rect.left,
        y: rect.top,
        toJSON: () => rect,
      }) as DOMRect;
  }

  async function frame(): Promise<void> {
    await new Promise((r) => {
      requestAnimationFrame(() => r(null));
    });
  }

  test("a submenu that would leave the viewport on the right flips to its parent's left", async () => {
    /* The FALLBACK: on an engine without anchor positioning the clamp computes the flip. */
    const restore = withAnchorSupport(false);
    try {
      const { menu, rows } = await open();
      const settings = rows[3]!;
      const sub = submenuOf(settings) as MenuEl;
      stubRect(menu, { height: 200, left: window.innerWidth - 220, top: 100, width: 200 });
      stubRect(settings, { height: 24, left: window.innerWidth - 220, top: 160, width: 200 });
      key(menu, "ArrowDown");
      key(menu, "ArrowDown");
      key(menu, "ArrowRight");
      // Placed beside the row first…
      expect(sub.x).toBe(window.innerWidth - 20 - 2);
      stubRect(sub, { height: 80, left: sub.x, top: sub.y, width: 180 });
      await flush();
      await frame();
      // …then flipped to the parent menu's left once measured to overflow.
      expect(sub.x).toBe(window.innerWidth - 220 - 180 + 2);
      /* Anchored in the state all the same — the document's `@supports` block is what does not
         apply here — with the submenu's own area. */
      expect(sub.anchored).toBe(true);
      expect(sub.area).toBe(SUBMENU_PLACEMENT);
    } finally {
      restore();
    }
  });

  test("a submenu is anchored beside its row and left to the platform where it positions by anchor", async () => {
    const restore = withAnchorSupport(true);
    try {
      const { menu, rows } = await open();
      const settings = rows[3]!;
      const sub = submenuOf(settings) as MenuEl;
      stubRect(menu, { height: 200, left: window.innerWidth - 220, top: 100, width: 200 });
      stubRect(settings, { height: 24, left: window.innerWidth - 220, top: 160, width: 200 });
      key(menu, "ArrowDown");
      key(menu, "ArrowDown");
      key(menu, "ArrowRight");
      const placed = sub.x;
      stubRect(sub, { height: 80, left: sub.x, top: sub.y, width: 180 });
      await flush();
      await frame();
      /* No clamp ran: the coordinate is exactly what the opener wrote, and the box that "overflowed"
         is the platform's to flip with `position-try-fallbacks`. */
      expect(sub.x).toBe(placed);
      expect(sub.anchored).toBe(true);
      expect(sub.dataset["anchored"]).toBe("");
      expect(sub.area).toBe(SUBMENU_PLACEMENT);
      const sheet = documentStyleText();
      expect(sheet).toContain("@supports (position-area: block-end)");
      expect(sheet).toContain(
        "position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline",
      );
      /* The root was shown from nothing with no placement: at its coordinates, not anchored. */
      expect(menu.anchored).toBe(false);
      expect(menu.area).toBe("");
    } finally {
      restore();
    }
  });

  test("a root menu is anchored only when it has a placement, a source, and no floor", async () => {
    const restore = withAnchorSupport(true);
    try {
      const { menu } = await open();
      const button = document.createElement("button");
      document.body.append(button);
      /* No placement: a context menu at a pointer keeps its coordinates even with a source. */
      menu.hidePopover();
      await flush();
      menu.showPopover({ source: button });
      await flush();
      expect(menu.anchored).toBe(false);
      /* A placement makes the source its anchor. */
      menu.hidePopover();
      await flush();
      menu.placement = "block-end span-inline-end";
      menu.showPopover({ source: button });
      await flush();
      expect(menu.anchored).toBe(true);
      expect(menu.area).toBe("block-end span-inline-end");
      /* A floor takes it back to the clamp, whatever the placement says. */
      menu.hidePopover();
      await flush();
      expect(menu.anchored).toBe(false);
      menu.floor = 500;
      menu.showPopover({ source: button });
      await flush();
      expect(menu.anchored).toBe(false);
    } finally {
      restore();
    }
  });

  test("onMenuBeforeToggle reached from outside a menu does nothing", () => {
    const state: MenuState = {};
    onMenuBeforeToggle(state, new Event("beforetoggle"));
    expect(state.anchored).toBeUndefined();
    expect(state.area).toBeUndefined();
  });

  test("a root menu that overflows the right edge slides in; one below the floor moves up", async () => {
    const { menu } = await open();
    menu.floor = 500;
    menu.hidePopover();
    await flush();
    stubRect(menu, { height: 300, left: window.innerWidth - 50, top: 400, width: 200 });
    menu.showPopover();
    await flush();
    await frame();
    expect(menu.x).toBe(window.innerWidth - 200 - 4);
    expect(menu.y).toBe(500 - 300);
  });

  test("ensureCaret puts the caret back on a row after the focused one went away", async () => {
    const { menu, rows } = await open();
    key(menu, "ArrowDown"); // Paste is disabled, so the caret lands on Show grid
    const grid = rows[2]!;
    expect(document.activeElement === grid).toBe(true);
    grid.remove();
    ensureCaret(menu);
    expect(document.activeElement === rows[0]).toBe(true);
    // Inside an open submenu the caret lands on its first row…
    key(menu, "ArrowDown"); // → Settings, now that Show grid is gone
    expect(document.activeElement === rows[3]).toBe(true);
    key(menu, "ArrowRight");
    await flush();
    const sub = submenuOf(rows[3]!) as MenuEl;
    expect(sub.open).toBe(true);
    (document.activeElement as HTMLElement).blur();
    expect(menu.contains(document.activeElement)).toBe(false);
    ensureCaret(menu);
    expect(document.activeElement === rowsOf(sub)[0]).toBe(true);
    // …and a submenu emptied under it closes, its parent row taking the caret.
    for (const child of rowsOf(sub)) {
      child.remove();
    }
    ensureCaret(menu);
    await flush();
    expect(sub.open).toBe(false);
    expect(document.activeElement === rows[3]).toBe(true);
  });

  test("a key, a toggle or a hover that did not come from a menu is left alone", () => {
    /* Every handler is bound by a document, and a host may bind one somewhere else — an adapter
       delegating from a wrapper, a surface reusing the module. Each answers by doing nothing,
       rather than by treating the stray element as a menu with no rows. */
    const stray = document.createElement("div");
    document.body.append(stray);
    const state: MenuState = {};
    let prevented = false;
    onMenuKeydown(state, {
      currentTarget: stray,
      key: "ArrowDown",
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {},
      target: stray,
    } as unknown as KeyboardEvent);
    expect(prevented).toBe(false);
    onMenuToggle(state, { currentTarget: stray, newState: "open" } as unknown as Event);
    expect(state.open).toBeUndefined();
    onMenuPointerOver(state, { currentTarget: stray, target: stray } as unknown as Event);
    expect(stray.childElementCount).toBe(0);
  });

  test("ArrowRight on a row with no submenu, and ArrowLeft in a root menu, do nothing", async () => {
    const { menu, rows } = await open();
    // Both are left UNCANCELLED, so a host that binds its own meaning to them still gets the key.
    expect(key(menu, "ArrowRight").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(rows[0]!);
    expect(key(menu, "ArrowLeft").defaultPrevented).toBe(false);
    expect(menu.open).toBe(true);
    expect(document.activeElement).toBe(rows[0]!);
  });

  test("ensureCaret leaves a caret that is already inside the menu where it is", async () => {
    const { menu, rows } = await open();
    key(menu, "End");
    expect(document.activeElement).toBe(rows[5]!);
    ensureCaret(menu);
    // Only a caret that has GONE is put back; moving a live one would yank focus off the row the
    // Reader is on every time the rows re-render under them.
    expect(document.activeElement).toBe(rows[5]!);
  });

  test("a submenu is shown FROM its row, so a mousedown on that row does not dismiss it", async () => {
    /* HTML restores focus relative to a popover's INVOKER, established by `popovertarget` or by
       `showPopover({ source })`. The shipped sidecar called a bare `showPopover()`, so a submenu
       had no invoker at all: the row it hangs off counted as "outside" and pressing it closed the
       submenu it had just opened. */
    const { menu, rows } = await open();
    const settings = rows[3]!;
    const sub = submenuOf(settings) as MenuEl;
    key(menu, "ArrowDown");
    key(menu, "ArrowDown");
    key(menu, "ArrowRight");
    await flush();
    expect(sub.open).toBe(true);
    settings.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(sub.open).toBe(true);
    expect(menu.open).toBe(true);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(sub.open).toBe(false);
  });

  test("a menu hidden by its host stays hidden even while the platform has it open", async () => {
    /* `:popover-open` beats the UA's `[hidden] { display: none }`, so a menu given `hidden` while
       showing kept drawing. One rule that is strictly more specific and later is the repair. */
    const { menu } = await open();
    /* Scoped to THIS element. `documentStyleText()` is the whole page and the normalisation below
       erases the scope id, so a map built over all of it answers `&[hidden]` with jx-menu-item's
       rule and stays green with the menu's own deleted. */
    const scope = `[data-jx="${menu.dataset["jx"]}"]`;
    const rules = new Map<string, string>();
    for (const line of documentStyleText().split("\n")) {
      const match = /^(.*?) \{ (.*) \}$/.exec(line);
      if (match && match[1]!.includes(scope)) {
        rules.set(match[1]!.replaceAll(/\[data-jx="[^"]+"\]/g, "&"), match[2]!);
      }
    }
    expect(rules.get("&:popover-open")).toContain("display: flex");
    expect(rules.get("&[hidden]:popover-open")).toContain("display: none");
    expect(rules.get("&[hidden]")).toContain("display: none");
  });

  test("declares display: revert-layer in its base rule, so a closed menu is not laid out", async () => {
    /* `declaresDisplay` reads the BASE BLOCK alone, so a panel that declares its display only in
       `:popover-open` has `display: block` written into its own rule — an author value, which
       beats the UA's `[popover]:not(:popover-open) { display: none }` at any specificity, so the
       menu is laid out on every page whether it is open or not. `revert` reverts TO that rule
       rather than beating it. Measured in Chrome 152 on the emitted sheet: closed computes `none`
       at 0x0 and open computes `flex` at 180x67; the same rule carrying `display: block` measures
       the CLOSED menu at 180x65. */
    const { menu } = await open();
    const scope = `[data-jx="${menu.dataset["jx"]}"]`;
    const base = documentStyleText()
      .split("\n")
      .find((line) => line.startsWith(`${scope} {`))!;
    expect(base).toContain("display: revert-layer");
    expect(base.match(/display:/g)).toHaveLength(1);
    for (const value of ["block", "flex", "grid", "inline", "contents"]) {
      expect(base, value).not.toContain(`display: ${value}`);
    }
  });

  test("puts the rows straight into the panel, with no slot node between", async () => {
    /* A `<slot>` leaves NO NODE: distribution replaces it with its matches. That matters here more
       than anywhere else in the kit, because the panel IS the flex column — with a slot in the way
       the rows were its grandchildren, laid out by a `display: contents` box rather than by
       `flex-direction: column` and `gap`. Measured in Chrome 152: two rows, each 171x28 inside a
       180x67 panel. */
    const { menu, rows } = await open();
    expect(menu.querySelectorAll("slot").length).toBe(0);
    expect(menu.querySelector('[part="items-slot"]')).toBeNull();
    for (const item of rows) {
      expect(item.parentElement).toBe(menu);
    }
    // The separator too: `& hr` is a descendant selector, but the row order the keyboard walks is
    // The panel's own child order.
    expect(menu.querySelector("hr")?.parentElement).toBe(menu);
    expect([...menu.children].map((child) => child.localName)).toEqual([
      "jx-menu-item",
      "jx-menu-item",
      "hr",
      "jx-menu-item",
      "jx-menu-item",
      "jx-menu-item",
    ]);
  });

  test("a mousedown on the invoker a menu was shown from does not light-dismiss it", async () => {
    const { menu } = await open();
    menu.hidePopover();
    await flush();
    const button = document.createElement("button");
    document.body.append(button);
    menu.showPopover({ source: button });
    await flush();
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(menu.open).toBe(true);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(menu.open).toBe(false);
    button.remove();
  });
});
