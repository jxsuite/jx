import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { findA11yDefects } from "@jxsuite/schema/a11y";
import { isExpandedSignal, isJsonObject, isNodeObject } from "@jxsuite/schema/guards";
import { findPopoverDefects } from "@jxsuite/schema/overlays";
import type { JsonObject, JsonValue, JxDocument, JxElement } from "@jxsuite/schema/types";

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

/** The stylebook page for the element, read off disk as the consumer document it is. */
function loadPage(): JxElement {
  const parsed = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../stylebook/jx-toolbar.json"), "utf8"),
  );
  if (!isNodeObject(parsed)) {
    throw new Error("stylebook/jx-toolbar.json is not a Jx element document");
  }
  return parsed;
}

const page = loadPage();

/** Every node in a document tree, so a gate cannot be dodged by nesting one level deeper. */
function walk(node: JxElement): JxElement[] {
  const kids = Array.isArray(node.children) ? node.children : [];
  return [node, ...kids.flatMap((child) => (isNodeObject(child) ? walk(child) : []))];
}

/** A kit document as the JSON tree it was imported from, for a walker that visits every key. */
function jsonOf(doc: JxDocument): JsonObject {
  if (!isJsonObject(doc)) {
    throw new TypeError(`${doc.tagName}: a Jx document is a JSON object`);
  }
  return doc;
}

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(globalThis, "EyeDropper");
});

/** Stand a screen picker in for the engine's, so a colour field draws its eyedropper button. */
function stubDropper(): void {
  Object.assign(globalThis, {
    EyeDropper: function EyeDropper() {
      return { open: () => Promise.resolve({ sRGBHex: "#000000" }) };
    },
  });
}

/**
 * One control, from a compact spelling: `"tag:label"`, plus `!` disabled and `~` hidden.
 *
 * `button`, `action`, `field`, `area`, `select`, `number`, `plain` and `divider` are the shapes a
 * real Studio toolbar is made of, and the point of the row below is that they are NOT all the same
 * kind of node: two are kit elements wrapping a `<button>`, one wraps an `<input>`, one is a bare
 * native button, and one is focusable at all only by accident of being a `<select>`. `color` is a
 * `jx-color-field`: one element wrapping FOUR focusable controls of its own.
 */
function makeControl(spec: string): HTMLElement {
  const [flags] = /[!~]*$/u.exec(spec)!;
  const [kind, label = ""] = spec.slice(0, spec.length - flags.length).split(":");
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
    case "color": {
      el = document.createElement("jx-color-field");
      el.setAttribute("label", label);
      el.setAttribute("value", "#3b82f6");
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
  /* SAFETY: `registerUi()` in `beforeAll` defined `jx-toolbar` from its document before any test
     runs, so `createElement` constructs that class synchronously, and jx-toolbar.json declares
     `label` and `orientation` as state props the class exposes as properties. */
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
  itemsOf(el).map((item) => item.getAttribute("label") ?? item.textContent);

/** The roving `tabindex` on each item's own CONTROL, which is the node a reader Tabs to. */
const carets = (el: HTMLElement) =>
  itemsOf(el).map((item) => controlOf(item).getAttribute("tabindex"));

/** The accessible name of whatever the focus is on. */
const focused = () => {
  const active = document.activeElement;
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

type JxGroup = HTMLElement & { tabindex: string };
type JxStrip = HTMLElement & { tabindex: string; selected: string };

/** A `jx-action-group` of labelled buttons: `"label!"` is disabled, and `chosen` is checked. */
function makeGroup(label: string, labels: string[], chosen = ""): JxGroup {
  /* SAFETY: `registerUi()` in `beforeAll` defined `jx-action-group` from its document before any
     test runs, so `createElement` constructs that class synchronously, and jx-action-group.json
     declares `tabindex` as a state prop the class exposes as a property. */
  const group = document.createElement("jx-action-group") as JxGroup;
  group.setAttribute("label", label);
  for (const spec of labels) {
    const name = spec.replace(/!$/u, "");
    const button = document.createElement("jx-action-button");
    button.setAttribute("label", name);
    button.setAttribute("icon", "plus");
    if (spec.endsWith("!")) {
      button.setAttribute("disabled", "");
    }
    if (chosen !== "") {
      button.setAttribute("checked", name === chosen ? "true" : "false");
    }
    group.append(button);
  }
  return group;
}

/** A `jx-tabs` strip with one tab per value, optionally closable. */
function makeStrip(values: string[], selected: string, closable = false): JxStrip {
  /* SAFETY: `registerUi()` in `beforeAll` defined `jx-tabs` from its document before any test runs,
     so `createElement` constructs that class synchronously, and jx-tabs.json declares `tabindex`
     and `selected` as state props the class exposes as properties. */
  const strip = document.createElement("jx-tabs") as JxStrip;
  strip.setAttribute("label", "Views");
  strip.setAttribute("selected", selected);
  for (const value of values) {
    const tab = document.createElement("jx-tab");
    tab.setAttribute("value", value);
    tab.setAttribute("label", value);
    if (closable) {
      tab.setAttribute("closable", "");
    }
    strip.append(tab);
  }
  return strip;
}

/** The roving `tabindex` on each of a group's own buttons. */
const stopsOf = (group: HTMLElement) =>
  [...group.querySelectorAll<HTMLElement>('jx-action-button > [part="control"]')].map((control) =>
    control.getAttribute("tabindex"),
  );

/** The name of every node in a toolbar that Tab would stop on. */
const stopsIn = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>("button, input, [role='tab']")].flatMap((node) =>
    node.getAttribute("tabindex") === "-1"
      ? []
      : [node.getAttribute("aria-label") ?? node.getAttribute("label") ?? node.textContent],
  );

/** The node that holds focus, which every key in these tests is sent from. */
function activeNode(): HTMLElement {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    throw new TypeError("nothing holds focus");
  }
  return active;
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
    const { style } = documents["jx-toolbar"];
    expect(style?.['&[aria-orientation="vertical"]']).toBeDefined();
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

  test("a control whose selection THROWS is the same case, on the engine happy-dom does not model", () => {
    /* Happy-dom answers null for this; a real engine refusing `selectionStart` on some input type
       throws instead, which is the case the `try`/`catch` in `atEdge` is actually for. Both answer
       the question the same way: the toolbar takes the key rather than trapping the reader inside
       a control with no arrow key out of it. */
    const input = document.createElement("input");
    input.value = "text";
    document.body.append(input);
    Object.defineProperty(input, "selectionStart", {
      get() {
        throw new DOMException("The input element's type does not support selection.");
      },
    });
    expect(cedesKey(input, "ArrowRight", "ArrowRight")).toBe(false);
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

  test("every kit control a toolbar could hold declares the caret prop", () => {
    /* The gate that would have caught the label defect above. A kit element holding a focusable node
       it is not, which is neither a nested composite's own child nor a control that owns its arrow
       keys, has to declare `tabindex` — otherwise a toolbar can focus it and cannot park it, which
       is the one tab stop this element exists for, silently absent. The list of known gaps that
       used to stand here held one name, `jx-color-field`, until the colour family decided which of
       its four controls the prop lands on (ui.md §5.6); an element that is knowingly short of the
       prop is written down HERE rather than left to be discovered, and today none is. */
    // Only ever legal inside their own composite, which owns their caret already.
    const OWNED_BY_A_COMPOSITE = new Set(["jx-tab", "jx-menu-item", "jx-tree-item"]);
    const OWN_ARROWS = new Set(["range", "number", "color"]);
    const missing: string[] = [];
    for (const [tag, doc] of Object.entries(documents)) {
      if (OWNED_BY_A_COMPOSITE.has(tag)) {
        continue;
      }
      const focusables: { tagName: string; type: string; role: string }[] = [];
      /* Every value in the document's JSON, not just its `children`: a focusable node can sit in a
         mapped array's template or a `$switch` case's `cases`, and the gate must see it there. */
      const visit = (node: JsonValue | undefined): void => {
        if (Array.isArray(node)) {
          for (const item of node) {
            visit(item);
          }
          return;
        }
        if (!isJsonObject(node)) {
          return;
        }
        const attrs = isJsonObject(node["attributes"]) ? node["attributes"] : {};
        if (["button", "input", "select", "textarea"].includes(String(node["tagName"]))) {
          focusables.push({
            tagName: String(node["tagName"]),
            type: String(attrs["type"] ?? ""),
            role: String(attrs["role"] ?? ""),
          });
        }
        for (const value of Object.values(node)) {
          visit(value);
        }
      };
      visit(jsonOf(doc)["children"]);
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
      if (!("tabindex" in (doc.state ?? {}))) {
        missing.push(tag);
      }
    }
    expect(missing).toEqual([]);
  });

  test("a colour field is ONE stop, the stop is its swatch, and the three controls beside it park", async () => {
    /* The composed control the gate above used to exempt. A `jx-color-field` is four focusable
       controls in a row — the swatch that opens the picker, a text field, the eyedropper and the
       system's own colour well — and before it declared the prop a toolbar could FIND it (the
       outermost custom element is the item) and focus it, but its caret write landed on nothing,
       so every one of the four stayed a tab stop of its own. The colour family's answer is the
       swatch: it is the opener, so Enter from it reaches the whole picker; it is the one control the
       element always draws; and it is first in the row. The other three step out of the tab order
       while the field is roved, because a container told this element is one stop must find one. */
    stubDropper();
    const el = await bar({ label: "Tools" }, ["action:Save", "color:Fill", "action:More"]);
    expect(names(el)).toEqual(["Save", "Fill", "More"]);
    const field = itemsOf(el)[1]!;
    expect(field.localName).toBe("jx-color-field");
    // The node the toolbar focuses is the swatch, found by the kit's own name for a control.
    const control = controlOf(field);
    expect(control.localName).toBe("button");
    expect(control.getAttribute("part")).toBe("control");
    expect(control.getAttribute("aria-label")).toBe("Pick Fill");
    expect(control.getAttribute("aria-haspopup")).toBe("dialog");
    expect(carets(el)).toEqual(["0", "-1", "-1"]);
    // The row has exactly one tab stop, and the three controls beside the swatch are parked.
    const row = field.querySelector<HTMLElement>('[part="row"]')!;
    const text = row.querySelector<HTMLElement>('jx-textfield [part="input"]')!;
    const dropper = row.querySelector<HTMLElement>('[part="dropper"] [part="control"]')!;
    const system = row.querySelector<HTMLElement>('[part="system"]')!;
    expect(text.getAttribute("tabindex")).toBe("-1");
    expect(dropper.getAttribute("tabindex")).toBe("-1");
    expect(system.getAttribute("tabindex")).toBe("-1");
    const stops = () =>
      [...el.querySelectorAll<HTMLElement>("button, input")].flatMap((node) =>
        !node.closest('[part="picker"]') && node.getAttribute("tabindex") !== "-1"
          ? [node.getAttribute("aria-label") ?? node.getAttribute("label")]
          : [],
      );
    expect(stops()).toEqual(["Save"]);
    // Property only: the host carries no tabindex, or it would be a second stop by itself.
    expect(field.hasAttribute("tabindex")).toBe(false);
    // And the arrows reach the well, and leave it again, by the same key.
    press(el, "ArrowRight");
    expect(focused()).toBe("Pick Fill");
    expect(document.activeElement?.closest("jx-color-field")?.getAttribute("label")).toBe("Fill");
    expect(carets(el)).toEqual(["-1", "0", "-1"]);
    expect(stops()).toEqual(["Pick Fill"]);
    press(el, "ArrowRight");
    expect(focused()).toBe("More");
    press(el, "ArrowLeft");
    expect(focused()).toBe("Pick Fill");
    press(el, "End");
    expect(focused()).toBe("More");
    press(el, "Home");
    expect(focused()).toBe("Save");
  });

  test("a nested jx-action-group is ONE item: the toolbar writes one prop and the group forwards it", async () => {
    /* The group's own sidecar is the single writer of its children's `tabindex`, and a toolbar that
       also roved them would park the row's caret on one child while the group parked its own on
       another. So the toolbar never writes a group's children. It writes the GROUP's property-only
       `tabindex`, the door every leaf control opens, and the group forwards it to the child holding
       its caret (ui.md §5.5). Before the group declared the prop it was a second tab stop in the
       row, which is the deviation this closes. */
    const el = await bar({ label: "Tools" }, ["action:Save", "action:More"]);
    const group = makeGroup("Text style", ["Bold", "Italic", "Underline"]);
    el.lastElementChild!.before(group);
    await settle();
    expect(names(el)).toEqual(["Save", "Text style", "More"]);
    // The row has exactly one stop, and it is not in the group: every child is parked.
    expect(stopsIn(el)).toEqual(["Save"]);
    expect(stopsOf(group)).toEqual(["-1", "-1", "-1"]);
    expect(group.dataset["roved"]).toBe("-1");
    // Property only: the host carries no tabindex, or it would be a stop of its own.
    expect(group.hasAttribute("tabindex")).toBe(false);
    // The toolbar's arrow enters the group at the child holding the group's caret.
    press(el, "ArrowRight");
    expect(focused()).toBe("Bold");
    expect(stopsIn(el)).toEqual(["Bold"]);
    expect(group.dataset["roved"]).toBe("0");
    // Inside, the arrow is the group's, and it walks the children.
    const walked = pressOn(activeNode(), "ArrowRight");
    expect(focused()).toBe("Italic");
    expect(walked.defaultPrevented).toBe(true);
    expect(stopsIn(el)).toEqual(["Italic"]);
    pressOn(activeNode(), "ArrowRight");
    expect(focused()).toBe("Underline");
    // At the end the group does not wrap: the key is the toolbar's, and the row's caret moves on.
    pressOn(activeNode(), "ArrowRight");
    expect(focused()).toBe("More");
    expect(stopsIn(el)).toEqual(["More"]);
    expect(stopsOf(group)).toEqual(["-1", "-1", "-1"]);
    // Straight back in lands where the caret left, so the walk reads as one row both ways.
    pressOn(activeNode(), "ArrowLeft");
    expect(focused()).toBe("Underline");
    pressOn(activeNode(), "ArrowLeft");
    pressOn(activeNode(), "ArrowLeft");
    expect(focused()).toBe("Bold");
    pressOn(activeNode(), "ArrowLeft");
    expect(focused()).toBe("Save");
    // The row wraps; the group never does while it is held.
    pressOn(activeNode(), "ArrowLeft");
    expect(focused()).toBe("More");
    expect(stopsIn(el)).toEqual(["More"]);
  });

  test("Home and End inside a held group are the group's own ends, as they are a text field's", async () => {
    const el = await bar({ label: "Tools" }, ["action:Save", "action:More"]);
    const group = makeGroup("Text style", ["Bold", "Italic", "Underline"]);
    el.lastElementChild!.before(group);
    await settle();
    press(el, "ArrowRight");
    const end = pressOn(activeNode(), "End");
    expect(focused()).toBe("Underline");
    expect(end.defaultPrevented).toBe(true);
    pressOn(activeNode(), "Home");
    expect(focused()).toBe("Bold");
    expect(stopsIn(el)).toEqual(["Bold"]);
  });

  test("walking a held radiogroup does not change which choice is chosen; Space does", async () => {
    /* The APG's rule for a radio group in a toolbar. Standing alone, `selects="single"` clicks the
       child an arrow lands on, because selection follows focus in a radio group. In a toolbar the
       arrows are how a reader gets PAST the group, and a walk that rewrote the alignment on the way
       to the button after it would be the data loss the select and the spin button are excluded
       for. So the arrows only move, and the child's own button answers Space and Enter. */
    const el = await bar({ label: "Tools" }, ["action:Save", "action:More"]);
    const group = makeGroup("Align", ["Left", "Centre", "Right"], "Centre");
    group.setAttribute("selects", "single");
    el.lastElementChild!.before(group);
    await settle();
    const clicks: string[] = [];
    group.addEventListener("click", (event) => {
      const host =
        event.target instanceof Element ? event.target.closest("jx-action-button") : null;
      clicks.push(host?.getAttribute("label") ?? "");
    });
    // Arriving lands on the chosen child, which is where Tab alone would land in a radiogroup.
    press(el, "ArrowRight");
    expect(focused()).toBe("Centre");
    pressOn(activeNode(), "ArrowRight");
    expect(focused()).toBe("Right");
    pressOn(activeNode(), "ArrowLeft");
    pressOn(activeNode(), "ArrowLeft");
    expect(focused()).toBe("Left");
    expect(clicks).toEqual([]);
    // Standing alone the same key clicks, which is the contract a toolbar suspends.
    const alone = makeGroup("Align", ["Left", "Centre"], "Left");
    alone.setAttribute("selects", "single");
    document.body.append(alone);
    await settle();
    const heard: string[] = [];
    alone.addEventListener("click", (event) => {
      const host =
        event.target instanceof Element ? event.target.closest("jx-action-button") : null;
      heard.push(host?.getAttribute("label") ?? "");
    });
    pressOn(alone.querySelector<HTMLElement>('[part="control"]')!, "ArrowRight");
    expect(heard).toEqual(["Centre"]);
  });

  test("a vertical group in a horizontal toolbar keeps its own axis and gives the row's away", async () => {
    /* The cross axis is the composite's and the row's own axis is the row's: Down and Up walk the
       group, and Right leaves it for the next control from wherever the caret stands. */
    const el = await bar({ label: "Tools" }, ["action:Save", "action:More"]);
    const group = makeGroup("Layers", ["Front", "Back"]);
    group.setAttribute("orientation", "vertical");
    el.lastElementChild!.before(group);
    await settle();
    press(el, "ArrowRight");
    expect(focused()).toBe("Front");
    pressOn(activeNode(), "ArrowDown");
    expect(focused()).toBe("Back");
    // No wrap while held, and the toolbar does not own Down, so the key goes unanswered.
    const down = pressOn(activeNode(), "ArrowDown");
    expect(focused()).toBe("Back");
    expect(down.defaultPrevented).toBe(false);
    const up = pressOn(group.querySelector<HTMLElement>('[part="control"]')!, "ArrowUp");
    expect(up.defaultPrevented).toBe(false);
    pressOn(activeNode(), "ArrowRight");
    expect(focused()).toBe("More");
  });

  test("a held group whose children cannot act is not an item, and one that empties gives the caret up", async () => {
    const el = await bar({ label: "Tools" }, ["action:Save"]);
    const group = makeGroup("Text style", ["Bold!", "Italic!"]);
    el.append(group);
    await settle();
    expect(names(el)).toEqual(["Save", "Text style"]);
    press(el, "ArrowRight");
    // Nothing in the group can take focus, so the row wraps past it.
    expect(focused()).toBe("Save");
    expect(stopsIn(el)).toEqual(["Save"]);
    // A parked group answers for itself with the first control that could act, and an empty one
    // With nothing but itself.
    const parked = makeGroup("Layers", ["Front", "Back"]);
    const empty = makeGroup("None", []);
    el.append(parked, empty);
    await settle();
    expect(stopsOf(parked)).toEqual(["-1", "-1"]);
    expect(controlOf(parked).getAttribute("aria-label")).toBe("Front");
    expect(controlOf(empty)).toBe(empty);
    expect(names(el)).toEqual(["Save", "Text style", "Layers", "None"]);
    press(el, "End");
    expect(focused()).toBe("Front");
  });

  test("a group removed from the toolbar gets its own tab stop back when the prop is cleared", async () => {
    /* The prop is the whole protocol, so clearing it is how a host that moves a group out of a row
       hands the stop back. The group remembers nothing about toolbars. */
    const group = makeGroup("Text style", ["Bold", "Italic"]);
    document.body.append(group);
    await settle();
    expect(stopsOf(group)).toEqual(["0", "-1"]);
    group.tabindex = "-1";
    expect(stopsOf(group)).toEqual(["-1", "-1"]);
    group.tabindex = "0";
    expect(stopsOf(group)).toEqual(["0", "-1"]);
    group.tabindex = "";
    await tick();
    expect(stopsOf(group)).toEqual(["0", "-1"]);
    expect(group.dataset["roved"]).toBeUndefined();
    // Alone again, the arrows wrap as they always did.
    const controls = [...group.querySelectorAll<HTMLElement>('[part="control"]')];
    pressOn(controls[0]!, "ArrowLeft");
    expect(focused()).toBe("Italic");
  });

  test("a nested jx-tabs is ONE item: the strip forwards the stop, and a walk does not activate", async () => {
    /* A strip holds no native control at all: its tabs are focusable HOSTS. So the toolbar finds
       the strip by its tag, and before the strip declared the prop the toolbar did not see it and
       the strip was a silent second stop. Held, the arrows walk the tabs without selecting one,
       whatever `activation` says, and Enter selects. */
    const el = await bar({ label: "Tools" }, ["action:Save", "action:More"]);
    const strip = makeStrip(["one", "two", "three"], "two");
    el.lastElementChild!.before(strip);
    await settle();
    expect(itemsOf(el).map((item) => item.localName)).toEqual([
      "jx-action-button",
      "jx-tabs",
      "jx-action-button",
    ]);
    const tabs = [...strip.querySelectorAll<HTMLElement>("jx-tab")];
    const stops = () => tabs.map((tab) => tab.getAttribute("tabindex"));
    expect(stops()).toEqual(["-1", "-1", "-1"]);
    expect(strip.getAttribute("tabindex")).toBe("-1");
    const changes: string[] = [];
    strip.addEventListener("change", (event) => {
      changes.push(event instanceof CustomEvent ? String(event.detail) : "");
    });
    // Arriving lands on the tab that is showing.
    press(el, "ArrowRight");
    expect(document.activeElement).toBe(tabs[1]!);
    expect(stops()).toEqual(["-1", "0", "-1"]);
    pressOn(tabs[1]!, "ArrowRight");
    expect(document.activeElement).toBe(tabs[2]!);
    expect(changes).toEqual([]);
    expect(strip.selected).toBe("two");
    // Leaving parks every tab, and coming straight back finds the caret where it left.
    pressOn(tabs[2]!, "ArrowRight");
    expect(focused()).toBe("More");
    expect(stops()).toEqual(["-1", "-1", "-1"]);
    pressOn(activeNode(), "ArrowLeft");
    expect(document.activeElement).toBe(tabs[2]!);
    // Enter activates, and the caret follows the selection it made.
    pressOn(tabs[2]!, "Enter");
    expect(changes).toEqual(["three"]);
    expect(stops()).toEqual(["-1", "-1", "0"]);
    // Home is the strip's own first tab, and the back arrow from there is the toolbar's.
    pressOn(tabs[2]!, "Home");
    expect(document.activeElement).toBe(tabs[0]!);
    expect(changes).toEqual(["three"]);
    pressOn(tabs[0]!, "ArrowLeft");
    expect(focused()).toBe("Save");
    // A selection the host moves while the strip is parked outranks the remembered caret.
    strip.selected = "two";
    await tick();
    press(el, "ArrowRight");
    expect(document.activeElement).toBe(tabs[1]!);
  });

  test("a held strip's close button leaves the tab order, and Delete still closes", async () => {
    /* A selected closable tab is two stops standing alone: the tab and its close button. A
       container told the strip is one stop must find exactly one, so the strip tells each tab it is
       `roved` and the close button parks, as a colour field's text field does (ui.md §5.6). */
    const el = await bar({ label: "Tools" }, ["action:Save"]);
    const strip = makeStrip(["one", "two"], "one", true);
    el.append(strip);
    await settle();
    const tabs = [...strip.querySelectorAll<HTMLElement>("jx-tab")];
    const closes = () =>
      tabs.map((tab) => tab.querySelector('[part="close"]')?.getAttribute("tabindex"));
    expect(closes()).toEqual(["-1", "-1"]);
    press(el, "ArrowRight");
    expect(document.activeElement).toBe(tabs[0]!);
    expect(closes()).toEqual(["-1", "-1"]);
    const closed: string[] = [];
    strip.addEventListener("close", (event) => {
      closed.push(event instanceof CustomEvent ? String(event.detail) : "");
    });
    pressOn(tabs[0]!, "Delete");
    expect(closed).toEqual(["one"]);
    // Standing alone the selected tab's close button is a stop again.
    strip.tabindex = "";
    await tick();
    expect(closes()).toEqual(["0", "-1"]);
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1"]);
  });

  test("the composites a toolbar holds are exactly the ones that declare the caret prop", async () => {
    /* The toolbar names them by TAG, because it roves either side of a child's upgrade and an
       element that has not upgraded has no accessor to test for. This is what keeps that list and
       the documents in agreement: a composite that declares `tabindex` and is not held would be a
       second stop again, and one that is held without declaring it would be a caret write that
       lands on nothing. The others stay out for the reasons ui.md §5.5 gives. */
    const COMPOSITES = [
      "jx-action-group",
      "jx-tabs",
      "jx-tree",
      "jx-swatch-group",
      "jx-listbox",
      "jx-menu",
    ] as const;
    const held: string[] = [];
    for (const tag of COMPOSITES) {
      const el = build({ label: "Tools" }, ["plain:A"]);
      const composite = document.createElement(tag);
      composite.append(document.createElement("button"));
      el.append(composite);
      if (itemsOf(el).includes(composite)) {
        held.push(tag);
      }
      expect(
        itemsOf(el).some((item) => item.localName === "button" && item.textContent === ""),
      ).toBe(false);
    }
    const declared = COMPOSITES.filter((tag) => "tabindex" in (documents[tag].state ?? {}));
    expect(held).toEqual([...declared]);
    expect(held).toEqual(["jx-action-group", "jx-tabs"]);
    for (const tag of declared) {
      const entry = documents[tag].state?.["tabindex"];
      if (!isExpandedSignal(entry)) {
        throw new Error(`${tag} declares no tabindex prop with a default`);
      }
      expect(entry.default, tag).toBe("");
      expect(entry.attribute, tag).toBeUndefined();
    }
  });

  test("a group inside another composite is that one's, and the toolbar holds neither", async () => {
    const el = build({ label: "Tools" }, ["plain:A"]);
    const tree = document.createElement("jx-tree");
    const group = makeGroup("Text style", ["Bold"]);
    tree.append(group);
    el.append(tree);
    expect(itemsOf(el).map((item) => item.textContent)).toEqual(["A"]);
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
    stray.addEventListener("keydown", (e) => onToolbarKeydown({ orientation: "horizontal" }, e));
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
    for (const tag of ["jx-button", "jx-textfield", "jx-action-button", "jx-swatch"] as const) {
      const entry = documents[tag].state?.["tabindex"];
      if (!isExpandedSignal(entry)) {
        throw new Error(`${tag} declares no tabindex prop with a default`);
      }
      expect(entry.default, tag).toBe("");
      // Property only: an observed attribute would land on the HOST and make a second tab stop.
      expect(entry.attribute, tag).toBeUndefined();
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
    const doc = documents["jx-toolbar"];
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
    expect(doc.children).toEqual([{ tagName: "slot" }]);
  });

  test("the label is the toolbar's own responsibility, because no lint can ask for it", async () => {
    /* `toolbar` is in neither of the accessibility lint's named-role sets, so an unnamed container
       of controls passes every gate the kit has. This is the gate, and it walks the WHOLE page. */
    const unnamed = await bar({}, ["action:A", "action:B"]);
    expect(unnamed.hasAttribute("aria-label")).toBe(false);
    expect(findA11yDefects(documents["jx-toolbar"])).toEqual([]);
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
    expect(documents["jx-toolbar"].attributes?.["role"]).toBe("toolbar");
    for (const [tag, doc] of Object.entries(documents)) {
      if (tag === "jx-toolbar") {
        continue;
      }
      expect(JSON.stringify(doc), tag).not.toContain('"role":"toolbar"');
    }
  });

  test("the stylebook page shows a composite held in a row, of each kind the toolbar holds", () => {
    /* The specimen a reader checks the keyboard against: a radiogroup and a tab strip, each inside
       a toolbar with a control either side, so both ends of the hand-over can be walked. */
    const held = walk(page)
      .filter((node) => node.tagName === "jx-toolbar")
      .flatMap((node) => walk(node).slice(1))
      .map((node) => node.tagName);
    expect(held).toContain("jx-action-group");
    expect(held).toContain("jx-tabs");
    // And the composite that is NOT held stands outside every toolbar on the page.
    expect(held).not.toContain("jx-swatch-group");
    expect(walk(page).some((node) => node.tagName === "jx-swatch-group")).toBe(true);
  });

  test("the element and a consumer document both pass the kit's lints", () => {
    const doc = documents["jx-toolbar"];
    const scope = { invokerTags: INVOKER_TAGS, popoverTags: POPOVER_TAGS };
    expect(findA11yDefects(doc)).toEqual([]);
    expect(findPopoverDefects(doc, scope)).toEqual([]);
    expect(findA11yDefects(page)).toEqual([]);
    expect(findPopoverDefects(page, scope)).toEqual([]);
  });
});
