import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { findA11yDefects } from "@jxsuite/schema/a11y";
import { findPopoverDefects } from "@jxsuite/schema/overlays";
import type { JxElement } from "@jxsuite/schema/types";

import {
  cedesKey,
  controlOf,
  focusItem,
  itemsOf,
  onToolbarKeydown,
  onToolbarReady,
  syncRoving,
} from "../src/behaviors/toolbar.ts";
import { documents, INVOKER_TAGS, POPOVER_TAGS } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/** A MutationObserver callback is a microtask; two turns settle the observer AND its writes. */
const settle = async () => {
  await tick();
  await tick();
};

type JxToolbar = HTMLElement & { label: string; orientation: string };

const page = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../stylebook/jx-toolbar.json"), "utf8"),
) as JxElement;

/** Every node in a document tree, so a gate cannot be dodged by nesting one level deeper. */
function walk(node: JxElement): JxElement[] {
  const kids = (node.children ?? []) as JxElement[];
  return [node, ...kids.flatMap((child) => walk(child))];
}

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * One control, from a compact spelling: `"tag:label"`, plus `!` disabled and `~` hidden.
 *
 * `button`, `action`, `field`, `area`, `select`, `number`, `plain` and `divider` are the shapes a
 * real Studio toolbar is made of, and the point of the row below is that they are NOT all the same
 * kind of node: two are kit elements wrapping a `<button>`, one wraps an `<input>`, one is a bare
 * native button, and one is focusable at all only by accident of being a `<select>`.
 */
function makeControl(spec: string): HTMLElement {
  const [flags] = /[!~]*$/u.exec(spec)!;
  const [kind, label] = spec.slice(0, spec.length - flags.length).split(":") as [string, string];
  let el: HTMLElement;
  switch (kind) {
    case "action": {
      el = document.createElement("jx-action-button");
      el.setAttribute("label", label);
      el.setAttribute("icon", "plus");
      break;
    }
    case "button": {
      el = document.createElement("jx-button");
      el.setAttribute("label", label);
      break;
    }
    case "field": {
      el = document.createElement("jx-textfield");
      el.setAttribute("label", label);
      el.setAttribute("type", "search");
      break;
    }
    case "area": {
      el = document.createElement("jx-textfield");
      el.setAttribute("label", label);
      el.setAttribute("multiline", "");
      break;
    }
    case "check": {
      el = document.createElement("jx-checkbox");
      el.setAttribute("label", label);
      break;
    }
    case "toggle": {
      el = document.createElement("jx-switch");
      el.setAttribute("label", label);
      break;
    }
    case "combo": {
      el = document.createElement("jx-combobox");
      el.setAttribute("label", label);
      break;
    }
    case "select": {
      el = document.createElement("select");
      el.setAttribute("aria-label", label);
      for (const value of ["a", "b"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        el.append(option);
      }
      break;
    }
    case "number": {
      el = document.createElement("jx-number-field");
      el.setAttribute("label", label);
      break;
    }
    case "divider": {
      el = document.createElement("jx-divider");
      el.setAttribute("orientation", "vertical");
      break;
    }
    default: {
      el = document.createElement("button");
      el.textContent = label;
      break;
    }
  }
  if (flags.includes("!")) {
    el.setAttribute("disabled", "");
  }
  if (flags.includes("~")) {
    el.setAttribute("hidden", "");
  }
  return el;
}

/** A toolbar whose children are described by {@link makeControl}'s spelling. */
function build(attrs: Record<string, string>, specs: string[]): JxToolbar {
  const el = document.createElement("jx-toolbar") as JxToolbar;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  for (const spec of specs) {
    el.append(makeControl(spec));
  }
  return el;
}

async function bar(attrs: Record<string, string>, specs: string[]): Promise<JxToolbar> {
  const el = build(attrs, specs);
  document.body.append(el);
  await tick();
  await tick();
  return el;
}

/** The label of each roved item, in order — the toolbar's own answer to "what is in this row". */
const names = (el: HTMLElement) =>
  itemsOf(el).map((item) => item.getAttribute("label") ?? item.textContent ?? "?");

/** The roving `tabindex` on each item's own CONTROL, which is the node a reader Tabs to. */
const carets = (el: HTMLElement) =>
  itemsOf(el).map((item) => controlOf(item).getAttribute("tabindex"));

/** The accessible name of whatever the focus is on. */
const focused = () => {
  const active = document.activeElement as HTMLElement | null;
  const host = active?.closest(
    "jx-action-button, jx-button, jx-textfield, jx-number-field, jx-checkbox, jx-switch",
  );
  return (
    host?.getAttribute("label") ?? active?.getAttribute("aria-label") ?? active?.textContent ?? null
  );
};

/** Send a key from the node that currently holds the caret, having focused it first. */
function press(el: HTMLElement, key: string): KeyboardEvent {
  const held =
    itemsOf(el).find((item) => controlOf(item).getAttribute("tabindex") === "0") ?? itemsOf(el)[0]!;
  const node = document.activeElement === controlOf(held) ? controlOf(held) : controlOf(held);
  node.focus();
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
  node.dispatchEvent(event);
  return event;
}

/** Send a key from a specific node, whatever the caret says. */
function pressOn(node: HTMLElement, key: string): KeyboardEvent {
  node.focus();
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
  node.dispatchEvent(event);
  return event;
}

describe("jx-toolbar", () => {
  test("it declares the toolbar role, its name and its axis, and the axis needs no second attribute", async () => {
    /* `jx-action-group` carries `data-orientation` as well, because the `group` role it can resolve
       to supports neither `aria-orientation` nor its inheritance. A toolbar is always a toolbar, so
       there is exactly one attribute and the sheet keys the layout on it. */
    const el = await bar({ label: "Grid actions" }, ["action:A", "action:B"]);
    expect(el.getAttribute("role")).toBe("toolbar");
    expect(el.getAttribute("aria-label")).toBe("Grid actions");
    expect(el.getAttribute("aria-orientation")).toBe("horizontal");
    expect(el.dataset["orientation"]).toBeUndefined();
    el.orientation = "vertical";
    await tick();
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    const style = documents["jx-toolbar"]!.style as Record<string, unknown>;
    expect(style['&[aria-orientation="vertical"]']).toBeDefined();
  });

  test("a MIXED row is one tab stop, and this is the row jx-action-group cannot hold", async () => {
    /* The whole case for the element. `jx-action-group` roves `jx-action-button` and nothing else —
       its `itemsOf` is a query for that one tag — so in this row it would find two of the five
       controls and leave the Save button, the filter field and the bare button as three more tab
       stops each. Every item here is a different KIND of node, and each has its caret written
       through its own declared prop rather than by anyone reaching into its internals. */
    const el = await bar({ label: "Grid actions" }, [
      "button:Save",
      "action:Refresh",
      "divider:",
      "field:Filter",
      "plain:More",
    ]);
    expect(names(el)).toEqual(["Save", "Refresh", "Filter", "More"]);
    expect(carets(el)).toEqual(["0", "-1", "-1", "-1"]);
    // On the CONTROL, never on the host: a host carrying tabindex is a second tab stop of its own.
    for (const item of itemsOf(el)) {
      if (item.localName.includes("-")) {
        expect(item.hasAttribute("tabindex"), item.localName).toBe(false);
      }
    }
    // The divider is not focusable and is therefore not in the row at all.
    expect(names(el)).not.toContain("");
  });

  test("the arrows move between controls of different kinds, skip what cannot act, and wrap", async () => {
    const el = await bar({ label: "Tools" }, [
      "button:Save",
      "action:Refresh!",
      "action:Hidden~",
      "field:Filter",
      "plain:More",
    ]);
    expect(carets(el)).toEqual(["0", "-1", "-1", "-1", "-1"]);
    press(el, "ArrowRight");
    // Refresh is disabled and Hidden is hidden, so the caret steps over both.
    expect(focused()).toBe("Filter");
    press(el, "ArrowRight");
    expect(focused()).toBe("More");
    press(el, "ArrowRight");
    expect(focused()).toBe("Save");
    press(el, "ArrowLeft");
    expect(focused()).toBe("More");
    press(el, "Home");
    expect(focused()).toBe("Save");
    press(el, "End");
    expect(focused()).toBe("More");
    // And a control that cannot act is still taken OUT of the tab order, which is the other half.
    expect(carets(el)).toEqual(["-1", "-1", "-1", "-1", "0"]);
  });

  test("a vertical toolbar answers Down and Up, and ignores the horizontal pair", async () => {
    const el = await bar({ label: "Node", orientation: "vertical" }, [
      "action:Up",
      "action:Down",
      "action:Copy",
    ]);
    const stray = press(el, "ArrowRight");
    expect(stray.defaultPrevented).toBe(false);
    expect(carets(el)).toEqual(["0", "-1", "-1"]);
    press(el, "ArrowDown");
    expect(focused()).toBe("Down");
    press(el, "ArrowUp");
    expect(focused()).toBe("Up");
  });

  // ─── the rule the whole element exists for ────────────────────────────────

  test("a text field keeps the toolbar's arrows while its caret has text to walk, and hands them back at the edge", async () => {
    /* The APG's own note says a toolbar holding a control that uses the arrow keys needs an answer
       and does not give one. This is the answer, and it is why a text field can be a toolbar ITEM
       rather than a second tab stop: the field keeps the key while the caret can still move that
       way, and the toolbar takes it at the boundary. So the reader arrows in, types, and arrows out
       with the same key — no gesture is lost in either direction. */
    const el = await bar({ label: "Tools" }, ["action:Save", "field:Filter", "action:More"]);
    const input = el.querySelector<HTMLInputElement>('jx-textfield [part="input"]')!;
    input.value = "abc";
    input.setSelectionRange(1, 1);
    // Mid-text: the field's own caret move, untouched by the toolbar.
    const mid = pressOn(input, "ArrowRight");
    expect(mid.defaultPrevented).toBe(false);
    expect(focused()).toBe("Filter");
    // At the end of the text, the same key leaves the field.
    input.setSelectionRange(3, 3);
    const out = pressOn(input, "ArrowRight");
    expect(out.defaultPrevented).toBe(true);
    expect(focused()).toBe("More");
    // And backwards, at offset 0.
    input.setSelectionRange(0, 0);
    const back = pressOn(input, "ArrowLeft");
    expect(back.defaultPrevented).toBe(true);
    expect(focused()).toBe("Save");
    // An empty field is at both edges at once, so it never holds the row up.
    input.value = "";
    input.setSelectionRange(0, 0);
    expect(pressOn(input, "ArrowRight").defaultPrevented).toBe(true);
  });

  test("a live selection is a gesture in progress, and Home and End are the field's unconditionally", async () => {
    /* A non-collapsed selection means the reader is mid-gesture and the arrow that collapses it is
       theirs. Home and End inside text mean the ends of the LINE; a toolbar that stole them to
       reach its own ends would break editing to save a keystroke, so it never does — the ends of
       the row are reached with the arrows instead. */
    const el = await bar({ label: "Tools" }, ["action:Save", "field:Filter", "action:More"]);
    const input = el.querySelector<HTMLInputElement>('jx-textfield [part="input"]')!;
    input.value = "abc";
    input.setSelectionRange(0, 3);
    expect(pressOn(input, "ArrowRight").defaultPrevented).toBe(false);
    input.setSelectionRange(3, 3);
    expect(pressOn(input, "End").defaultPrevented).toBe(false);
    expect(pressOn(input, "Home").defaultPrevented).toBe(false);
    expect(focused()).toBe("Filter");
    // A textarea is the same control by another tag, and answers the same way.
    const tall = await bar({ label: "Notes" }, ["action:Save", "area:Note"]);
    const area = tall.querySelector<HTMLTextAreaElement>('jx-textfield [part="input"]')!;
    area.value = "hello";
    area.setSelectionRange(2, 2);
    expect(pressOn(area, "ArrowRight").defaultPrevented).toBe(false);
    area.setSelectionRange(5, 5);
    expect(pressOn(area, "ArrowRight").defaultPrevented).toBe(true);
  });

  test("a control whose selection cannot be read gives the key up, because a trap is the worse failure", () => {
    /* Chrome refuses `selectionStart` on `type="email"` and happy-dom answers null for the types it
       does not model. Ceding a key the toolbar cannot reason about would leave the reader inside a
       control with no arrow key out of it, which is SC 2.1.2; taking it costs a caret move they can
       still make with Home and End. */
    const email = document.createElement("input");
    email.type = "email";
    email.value = "someone@example.com";
    document.body.append(email);
    expect(email.selectionStart).toBeNull();
    expect(cedesKey(email, "ArrowRight", "ArrowRight")).toBe(false);
    expect(cedesKey(email, "End", "ArrowRight")).toBe(true);
    // And a node that is not a text control at all never cedes anything.
    const button = document.createElement("button");
    expect(cedesKey(button, "ArrowRight", "ArrowRight")).toBe(false);
    expect(cedesKey(null, "ArrowRight", "ArrowRight")).toBe(false);
  });

  // ─── what is not an item, and why ─────────────────────────────────────────

  test("a control whose arrows change its VALUE is not an item: walking past it would rewrite it", async () => {
    /* A `<select>` and a spin button step their own value on every arrow press, so a caret walking
       the row past one would change what somebody chose, once per press. An extra tab stop is an
       inconvenience; silently rewriting a value is a defect, so these keep their own tab stop and
       the toolbar's arrows never reach them. A text field is the opposite case and IS an item,
       because walking off the end of its text costs nothing. */
    const el = await bar({ label: "Tools" }, [
      "action:Save",
      "select:Mode",
      "number:Size",
      "action:More",
    ]);
    expect(names(el)).toEqual(["Save", "More"]);
    press(el, "ArrowRight");
    expect(focused()).toBe("More");
    press(el, "ArrowRight");
    expect(focused()).toBe("Save");
    // The select keeps the platform's own tab stop rather than being parked at -1 by the toolbar.
    const select = el.querySelector("select")!;
    expect(select.hasAttribute("tabindex")).toBe(false);
  });

  test('a checkbox and a switch are roved on their INPUT, not on the label wearing part="control"', async () => {
    /* Found by auditing the kit rather than by a failing test, which is why it is pinned here.
       `[part="control"]` is the kit's usual name for "this element's own control" and on
       `jx-checkbox` and `jx-switch` it is the `<label>` WRAPPING the input. Taking the named node on
       trust focused a label — which focuses nothing at all — and, because neither element declared
       the `tabindex` prop, the caret write silently did nothing either, so a checkbox in a toolbar
       stayed a second tab stop with the row believing it had one. Both halves are fixed: the focus
       target is the first NAMED part that is actually focusable, and both elements declare the
       prop. */
    const el = await bar({ label: "Tools" }, ["action:Save", "check:Wrap", "toggle:Live"]);
    expect(names(el)).toEqual(["Save", "Wrap", "Live"]);
    expect(controlOf(itemsOf(el)[1]!).localName).toBe("input");
    expect(controlOf(itemsOf(el)[2]!).localName).toBe("input");
    expect(carets(el)).toEqual(["0", "-1", "-1"]);
    press(el, "ArrowRight");
    expect(focused()).toBe("Wrap");
    expect(document.activeElement?.localName).toBe("input");
    press(el, "ArrowRight");
    expect(focused()).toBe("Live");
    // And neither host is a tab stop of its own.
    expect(itemsOf(el).every((item) => !item.hasAttribute("tabindex"))).toBe(true);
  });

  test("a combobox drives its own list with the arrows, so it is not an item either", async () => {
    /* Its ArrowDown opens the popup and walks the options: the same reason a `<select>` and a spin
       button are left alone, one step further along. Nothing about it would be rewritten by a
       caret walking past, but the widget would stop working, which is the same failure. */
    const el = await bar({ label: "Tools" }, ["action:Save", "combo:Where", "action:More"]);
    expect(names(el)).toEqual(["Save", "More"]);
  });

  test("every kit control a toolbar could hold declares the caret prop, and the gap is NAMED", () => {
    /* The gate that would have caught the label defect above. A kit element holding a focusable node
       it is not, which is neither a nested composite's own child nor a control that owns its arrow
       keys, has to declare `tabindex` — otherwise a toolbar can focus it and cannot park it, which
       is the one tab stop this element exists for, silently absent. One element is knowingly short
       of it and is written down rather than left to be discovered. */
    const KNOWN_GAPS: readonly string[] = [
      // A composed control: its focusable nodes are a nested `jx-swatch`'s button and the hidden
      // System `<input type="color">`, so which node the prop lands on is the colour family's
      // Question rather than the toolbar's. Until it declares one, a colour well in a toolbar is a
      // Tab stop of its own.
      "jx-color-field",
    ];
    // Only ever legal inside their own composite, which owns their caret already.
    const OWNED_BY_A_COMPOSITE = new Set(["jx-tab", "jx-menu-item", "jx-tree-item"]);
    const OWN_ARROWS = new Set(["range", "number", "color"]);
    const missing: string[] = [];
    for (const [tag, doc] of Object.entries(documents)) {
      if (OWNED_BY_A_COMPOSITE.has(tag)) {
        continue;
      }
      const focusables: { tagName: string; type: string; role: string }[] = [];
      const visit = (node: unknown): void => {
        if (Array.isArray(node)) {
          for (const item of node) {
            visit(item);
          }
          return;
        }
        if (!node || typeof node !== "object") {
          return;
        }
        const el = node as JxElement;
        const attrs = (el.attributes ?? {}) as Record<string, string>;
        if (["button", "input", "select", "textarea"].includes(String(el.tagName))) {
          focusables.push({
            tagName: String(el.tagName),
            type: String(attrs["type"] ?? ""),
            role: String(attrs["role"] ?? ""),
          });
        }
        for (const value of Object.values(node as Record<string, unknown>)) {
          visit(value);
        }
      };
      visit(doc.children);
      if (focusables.length === 0) {
        continue;
      }
      /* The FIRST focusable in document order is what `controlOf` lands on, so it is the one that
         decides. A `tabindex="-1"` helper further down — a clear button, a stepper — is never the
         focus target and never the question. */
      const first = focusables[0]!;
      if (first.tagName === "select" || OWN_ARROWS.has(first.type) || first.role === "combobox") {
        continue;
      }
      if (!("tabindex" in ((doc.state ?? {}) as Record<string, unknown>))) {
        missing.push(tag);
      }
    }
    expect(missing).toEqual([...KNOWN_GAPS]);
  });

  test("a nested jx-action-group is left alone: two roving carets over one row is two writers", async () => {
    /* The group's own sidecar is the single writer of its children's `tabindex`, and a toolbar that
       also roved them would park the row's caret on one child while the group parked its own on
       another — they disagree, and the loser is whichever wrote last. So a composite is not a
       toolbar item at all: it keeps its own single tab stop and the toolbar's arrows do not reach
       into it. Stated as a limit in ui.md §5.5 rather than engineered around, because nothing in
       Studio nests one and the alternative is a second caret protocol between two elements. */
    const el = await bar({ label: "Tools" }, ["action:Save", "action:More"]);
    const group = document.createElement("jx-action-group");
    group.setAttribute("label", "Text style");
    for (const label of ["Bold", "Italic"]) {
      const button = document.createElement("jx-action-button");
      button.setAttribute("label", label);
      button.setAttribute("icon", "plus");
      group.append(button);
    }
    el.lastElementChild!.before(group);
    await settle();
    // The group's buttons are the GROUP's items, never the toolbar's.
    expect(names(el)).toEqual(["Save", "More"]);
    // And the group still has its own one stop, untouched by the toolbar's sync.
    const inside = [...group.querySelectorAll<HTMLElement>('jx-action-button [part="control"]')];
    expect(inside.map((c) => c.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    // An arrow inside the group is answered by the group and never reaches the toolbar.
    const before = carets(el);
    pressOn(inside[0]!, "ArrowRight");
    expect(carets(el)).toEqual(before);
    expect(inside.map((c) => c.getAttribute("tabindex"))).toEqual(["-1", "0"]);
  });

  test("a key inside a NESTED toolbar is that one's, and a key the contract does not name passes through", async () => {
    const outer = await bar({ label: "Outer" }, ["action:A", "action:B"]);
    const inner = build({ label: "Inner", orientation: "vertical" }, ["action:X", "action:Y"]);
    outer.append(inner);
    await settle();
    expect(names(outer)).toEqual(["A", "B"]);
    expect(names(inner)).toEqual(["X", "Y"]);
    const before = carets(outer);
    /* The nested toolbar is VERTICAL, so it ignores ArrowRight and does not stop it — the key then
       reaches the outer, horizontal one by bubbling with a target that is not its child at all.
       Without the ownership test the outer bar would move its own caret and yank focus out of the
       row the reader is standing in. */
    const stray = pressOn(controlOf(itemsOf(inner)[0]!), "ArrowRight");
    expect(carets(outer)).toEqual(before);
    expect(stray.defaultPrevented).toBe(false);
    // The nested bar answers its own axis, which is the other half of "it is not this one's".
    pressOn(controlOf(itemsOf(inner)[0]!), "ArrowDown");
    expect(carets(inner)).toEqual(["-1", "0"]);
    expect(carets(outer)).toEqual(before);
    // And a key nobody claims is left uncancelled.
    expect(press(outer, "Tab").defaultPrevented).toBe(false);
    expect(press(outer, "Home").defaultPrevented).toBe(true);
  });

  // ─── the invariant over time ──────────────────────────────────────────────

  test("the one tab stop SURVIVES controls arriving, leaving, being disabled and being hidden", async () => {
    /* A Studio toolbar is not a fixed row: the grid's Add Row and Delete Rows appear with the
       source's capabilities, its pager appears with a second page, and every button enables and
       disables with the selection. A control appended afterwards arrives with no `tabindex` at all,
       which is a SECOND tab stop in an element whose whole purpose is to have one; removing or
       disabling the caret-holder leaves ZERO, so a row of operable controls cannot be Tabbed to. */
    const el = await bar({ label: "Tools" }, ["action:A", "action:B", "field:C"]);
    expect(carets(el)).toEqual(["0", "-1", "-1"]);
    el.append(makeControl("action:D"));
    await settle();
    expect(carets(el)).toEqual(["0", "-1", "-1", "-1"]);
    itemsOf(el)[0]!.setAttribute("disabled", "");
    await settle();
    expect(carets(el)).toEqual(["-1", "0", "-1", "-1"]);
    itemsOf(el)[1]!.remove();
    await settle();
    expect(carets(el)).toEqual(["-1", "0", "-1"]);
    // `hidden` is watched beside `disabled`, because isOut reads both.
    itemsOf(el)[1]!.setAttribute("hidden", "");
    await settle();
    expect(carets(el)).toEqual(["-1", "-1", "0"]);
    // Exactly one, always: never two, never none.
    expect(carets(el).filter((t) => t === "0")).toHaveLength(1);
    // And a mutation that changes nothing about the answer writes nothing.
    el.append(document.createElement("span"));
    await settle();
    expect(carets(el)).toEqual(["-1", "-1", "0"]);
  });

  test("a toolbar with nothing that can act takes no caret and moves none", async () => {
    const el = await bar({ label: "Tools" }, ["action:A!", "action:B!"]);
    expect(carets(el)).toEqual(["-1", "-1"]);
    expect(focusItem(el, 0)).toBeNull();
    press(el, "ArrowRight");
    expect(carets(el)).toEqual(["-1", "-1"]);
  });

  test("both handlers are safe on an event that names no toolbar, and write nothing", async () => {
    /* They are exported, so a host may bind them itself — and an event that has finished
       dispatching reports a null currentTarget, which is the one shape that would otherwise walk a
       null. Nothing is thrown, and no caret in the page moves. */
    const el = await bar({ label: "Tools" }, ["action:A", "action:B"]);
    const before = carets(el);
    const settled = new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" });
    expect(settled.currentTarget).toBeNull();
    expect(() => onToolbarKeydown({ orientation: "horizontal" }, settled)).not.toThrow();
    expect(() => onToolbarReady({}, settled)).not.toThrow();
    const stray = document.createElement("div");
    document.body.append(stray);
    stray.addEventListener("keydown", (e) =>
      onToolbarKeydown({ orientation: "horizontal" }, e as KeyboardEvent),
    );
    stray.addEventListener("jx-ready", (e) => onToolbarReady({}, e));
    stray.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    stray.dispatchEvent(new CustomEvent("jx-ready", { bubbles: true }));
    expect(carets(el)).toEqual(before);
    // A second readiness event re-syncs but does not start a second observer.
    el.dispatchEvent(new CustomEvent("jx-ready", { bubbles: true }));
    await settle();
    expect(carets(el)).toEqual(before);
  });

  test("the row is discovered from the CONTROLS, and the observer is what closes the gap", async () => {
    /* `jx-action-group` finds its members by TAG, so it can rove a detached row. This one finds
       them by the focusable node each holds, which is the only question that has one answer across
       a `jx-button`, a `jx-textfield` and a bare `<button>` — and the cost is that a kit control
       which has not rendered its own control yet is not yet an item. That is not a race the caret
       loses: the child's render is a childList mutation inside the toolbar, so the observer
       {@link onToolbarReady} installs re-syncs the moment the row is really there. Measured here
       both ways, because a sync that only ever ran at mount would leave the late arrival as a
       second tab stop with nothing to notice it. */
    const el = build({ label: "Tools" }, ["plain:C"]);
    const late = makeControl("action:A");
    el.firstElementChild!.before(late);
    expect(names(el)).toEqual(["C"]);
    syncRoving(el);
    expect(carets(el)).toEqual(["0"]);
    document.body.append(el);
    await settle();
    expect(names(el)).toEqual(["A", "C"]);
    /* One stop, and it did not MOVE: the control that already held the caret keeps it, so a row
       that grows a control at its head does not yank the reader's Tab target backwards. */
    expect(carets(el)).toEqual(["-1", "0"]);
  });

  // ─── the widening the element needed ──────────────────────────────────────

  test("jx-button and jx-textfield forward a tabindex prop, which is what lets a toolbar hold them", async () => {
    /* `jx-action-button` and `jx-swatch` already declared this prop and say why: the focusable node
       is the control INSIDE, so a roving container writes a declared prop rather than reaching into
       another element's internals. A toolbar's row is the first thing that needed the same door on
       a plain button and a text field, and without it those two stay in the tab order however
       carefully the row is roved — three tab stops in the grid toolbar, not one. */
    for (const tag of ["jx-button", "jx-textfield", "jx-action-button", "jx-swatch"]) {
      const entry = (documents[tag]!.state as Record<string, { default?: unknown }>)["tabindex"];
      expect(entry, tag).toBeDefined();
      expect(entry!.default, tag).toBe("");
      // Property only: an observed attribute would land on the HOST and make a second tab stop.
      expect((entry as { attribute?: string }).attribute, tag).toBeUndefined();
    }
    const el = await bar({ label: "Tools" }, ["button:Save", "field:Filter"]);
    expect(controlOf(itemsOf(el)[0]!).localName).toBe("button");
    expect(controlOf(itemsOf(el)[1]!).localName).toBe("input");
    expect(carets(el)).toEqual(["0", "-1"]);
    // The host itself never carries one.
    expect(itemsOf(el).every((i) => !i.hasAttribute("tabindex"))).toBe(true);
  });

  // ─── the contract in the document ─────────────────────────────────────────

  test("it owns no selection, emits nothing of its own, and has no overflow menu", () => {
    /* Overflow is deliberately NOT here (§5.5). `surfaces/tab-strip.json` already answers it — the
       HOST measures, projects the list and opens `surfaces/menu.ts` — and a second answer in the
       kit could not build the rows anyway: an overflow menu is a list of COMMANDS, and §2 principle
       4 makes the host the only thing that may say what one is called or whether it can act. */
    const doc = documents["jx-toolbar"]!;
    expect(Object.keys(doc.state ?? {})).toEqual([
      "label",
      "orientation",
      "onKeydown",
      "onReady",
      "onMount",
    ]);
    const emitted = JSON.stringify(doc).match(/"dispatchEvent":"[^"]+"/gu) ?? [];
    expect(emitted).toEqual(['"dispatchEvent":"jx-ready"']);
    expect(JSON.stringify(doc)).not.toContain("overflow");
    // One internal node, and it is the slot: no box stands between the role and the controls it owns.
    const children = doc.children as JxElement[];
    expect(children).toHaveLength(1);
    expect(children[0]!.tagName).toBe("slot");
  });

  test("the label is the toolbar's own responsibility, because no lint can ask for it", async () => {
    /* `toolbar` is in neither of the accessibility lint's named-role sets, so an unnamed container
       of controls passes every gate the kit has. This is the gate, and it walks the WHOLE page. */
    const unnamed = await bar({}, ["action:A", "action:B"]);
    expect(unnamed.hasAttribute("aria-label")).toBe(false);
    expect(findA11yDefects(documents["jx-toolbar"]! as JxElement)).toEqual([]);
    const bars = walk(page).filter((child) => child.tagName === "jx-toolbar");
    expect(bars.length).toBeGreaterThanOrEqual(2);
    for (const node of bars) {
      expect(node.$props?.["label"], JSON.stringify(node.$props)).toBeString();
      expect(node.$props?.["label"]).not.toBe("");
    }
  });

  test('nothing in the kit writes role="toolbar" by hand any more, and this is what keeps it that way', () => {
    /* The element is only worth having if it is the one answer. Two stylebook pages drew a
       `role="toolbar"` on a plain `<div>` because there was nothing else to draw — a container role
       with no tab-order collapse and no arrow keys under it, which is the exact shape `jx-toolbar`
       replaces. They are `jx-toolbar`s now, and so is every Studio surface that had one. A ratchet
       rather than a note: the next hand-rolled row reddens here instead of shipping. */
    const dir = resolve(import.meta.dir, "../stylebook");
    const offenders: string[] = [];
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".json"))) {
      const text = readFileSync(resolve(dir, name), "utf8");
      if (/"role":\s*"toolbar"/u.test(text)) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
    // The one place the role IS written is the element itself, and it is written literally.
    expect((documents["jx-toolbar"]!.attributes as Record<string, string>)["role"]).toBe("toolbar");
    for (const [tag, doc] of Object.entries(documents)) {
      if (tag === "jx-toolbar") {
        continue;
      }
      expect(JSON.stringify(doc), tag).not.toContain('"role":"toolbar"');
    }
  });

  test("the element and a consumer document both pass the kit's lints", () => {
    const doc = documents["jx-toolbar"]! as JxElement;
    const scope = { invokerTags: INVOKER_TAGS, popoverTags: POPOVER_TAGS };
    expect(findA11yDefects(doc)).toEqual([]);
    expect(findPopoverDefects(doc, scope)).toEqual([]);
    expect(findA11yDefects(page)).toEqual([]);
    expect(findPopoverDefects(page, scope)).toEqual([]);
  });
});
