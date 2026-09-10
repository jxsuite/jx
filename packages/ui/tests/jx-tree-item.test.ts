import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText, mount } from "@jxsuite/runtime";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";

/** Let the runtime's queued `onMount` settle. */
const flush = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type ItemEl = HTMLElement & {
  value: string;
  label: string;
  level: number;
  posinset: number;
  setsize: number;
  expanded: string;
  selected: boolean;
  disabled: boolean;
  cut: boolean;
  grip: boolean;
  caret: boolean;
};

let dispose: (() => void) | null = null;

/** One row, standing alone: everything below is about the ROW rather than about the tree. */
async function render(
  attributes: Record<string, string>,
  children: JxElement[] = [],
): Promise<{ host: HTMLElement; item: ItemEl }> {
  const host = document.createElement("div");
  document.body.append(host);
  const doc = {
    tagName: "div",
    children: [{ attributes, children, tagName: "jx-tree-item" }],
  } as unknown as JxDocument;
  ({ dispose } = await mount(doc, host));
  await flush();
  return { host, item: host.querySelector("jx-tree-item") as ItemEl };
}

/** The emitted stylesheet for one element, by selector, with its scope folded back to `&`. */
function rules(el?: HTMLElement): Map<string, string> {
  const scope = el?.dataset["jx"];
  const out = new Map<string, string>();
  for (const line of documentStyleText().split("\n")) {
    const match = /^(.*?) \{ (.*) \}$/.exec(line);
    if (!match) {
      continue;
    }
    if (scope !== undefined && !match[1]!.includes(`[data-jx="${scope}"]`)) {
      continue;
    }
    out.set(match[1]!.replaceAll(/\[data-jx="[^"]+"\]/g, "&"), match[2]!);
  }
  return out;
}

beforeAll(async () => {
  await registerUi({ theme: false });
});

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

describe("jx-tree-item", () => {
  test("the row IS the treeitem, and every count on it came from the host", async () => {
    const { item } = await render({
      value: "src/index.page.json",
      label: "index.page.json",
      level: "3",
      posinset: "7",
      setsize: "812",
    });
    expect(item.getAttribute("role")).toBe("treeitem");
    expect(item.getAttribute("aria-level")).toBe("3");
    expect(item.getAttribute("aria-posinset")).toBe("7");
    expect(item.getAttribute("aria-setsize")).toBe("812");
    expect(item.getAttribute("aria-label")).toBe("index.page.json");
    expect(item.querySelector('[part="label"]')!.textContent).toBe("index.page.json");
    // The drag island's handle on the row: an attribute, because a property is not a selector.
    expect(item.dataset["value"]).toBe("src/index.page.json");
  });

  test("a count of zero writes NO attribute, which is how a small tree says ask the DOM", async () => {
    /* The pair exists for windowing, and a tree that draws every row it has must not be forced to
       restate what the DOM already says — a hand-written `aria-setsize` that drifts from the row
       count is worse than none. */
    const { item } = await render({ value: "a", label: "a", level: "1" });
    expect(item.getAttribute("aria-posinset")).toBeNull();
    expect(item.getAttribute("aria-setsize")).toBeNull();
    expect(item.getAttribute("aria-level")).toBe("1");
  });

  test("aria-selected is written only when the row IS selected", async () => {
    /* A `false` on every row is what tells assistive technology a tree supports MULTIPLE selection.
       The row cannot see whether its tree does, so it says nothing and `aria-multiselectable` on
       `jx-tree` carries that answer instead. */
    const { item } = await render({ value: "a", label: "a", level: "1" });
    expect(item.getAttribute("aria-selected")).toBeNull();
    item.selected = true;
    expect(item.getAttribute("aria-selected")).toBe("true");
    item.selected = false;
    expect(item.getAttribute("aria-selected")).toBeNull();
  });

  test("a leaf owns no aria-expanded and draws no chevron, and still keeps its box", async () => {
    const { item } = await render({ value: "a", label: "Hero", level: "2" });
    expect(item.getAttribute("aria-expanded")).toBeNull();
    const twisty = item.querySelector('[part="twisty"]')!;
    // The box is there and empty: it is what lines every name in the tree up.
    expect(twisty).not.toBeNull();
    expect(twisty.querySelector("jx-icon")).toBeNull();
    expect(rules(item).get('& [part="twisty"]')).toContain("inline-size: 14px");
  });

  test("a branch says which way it is, and draws the matching caret", async () => {
    const { item } = await render({ value: "a", label: "main", level: "1", expanded: "false" });
    /* Read as a PROPERTY: the caret is given to `jx-icon` through `$props`, and the runtime does not
       reflect a property write back to an attribute. */
    const glyph = () =>
      (item.querySelector("jx-icon") as unknown as { name?: string } | null)?.name;
    expect(item.getAttribute("aria-expanded")).toBe("false");
    expect(glyph()).toBe("caret-right");

    item.expanded = "true";
    await flush();
    expect(item.getAttribute("aria-expanded")).toBe("true");
    expect(glyph()).toBe("caret-down");
  });

  test("disabled and cut are drawn, and only one of them is announced", async () => {
    const { item } = await render({
      value: "a",
      label: "a",
      level: "1",
      disabled: "",
      cut: "",
    });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    /* `cut` is deliberately invisible to assistive technology: cut and paste are host commands and
       the host announces the move through its own live region, so a reader is told what happened by
       the page rather than by an opacity. */
    expect(item.dataset["cut"]).toBe("");
    expect(item.getAttribute("aria-description")).toBeNull();
    const style = rules(item);
    expect(style.get("&[data-cut]")).toContain("opacity: 0.5");
    expect(style.get('&[aria-disabled="true"]')).toContain("opacity: 0.5");
  });

  test("the caret is a PROP, so a repaint restores the tab stop instead of losing it", async () => {
    const { item } = await render({ value: "a", label: "a", level: "1" });
    expect(item.getAttribute("tabindex")).toBe("-1");
    item.caret = true;
    expect(item.getAttribute("tabindex")).toBe("0");
    item.caret = false;
    expect(item.getAttribute("tabindex")).toBe("-1");
    // And nothing in the DOCUMENT writes a tabindex, so the sidecar and the binding cannot fight.
    const doc = documents["jx-tree-item"]!;
    expect(doc.attributes!["tabindex"]).toBe("${state.caret ? '0' : '-1'}");
  });

  test("the indent is the level, in declarations rather than in a host's arithmetic", async () => {
    const { item } = await render({ value: "a", label: "a", level: "4" });
    /* A declaration that reads state is interned as a per-instance custom property and referenced
       from the shared rule, so the arithmetic lands on the ELEMENT and the rule stays one rule for
       every row — which is the whole reason the indent is a declaration rather than a `padding-left`
       a host composes per row. */
    const base = rules(item).get("&")!;
    expect(base).toMatch(/padding-inline: var\(--jx-r\d+-\d+\)/);
    // Level 4 is three indents in.
    expect(item.getAttribute("style")).toContain("var(--jx-tree-indent, 16px) * 3");
    // And the row's HEIGHT is untouched by its depth, which is what keeps a windowed scrollbar
    // Honest: a window reserves scroll for rows it did not draw at one known height.
    expect(base).toContain("block-size: var(--jx-control-h)");
  });

  test("the four consumer zones generate no box, and take what is slotted into them", async () => {
    const { item } = await render({ value: "a", label: "Hero", level: "1", grip: "" }, [
      { tagName: "span", attributes: { slot: "icon" }, textContent: "section" },
      { tagName: "span", attributes: { slot: "status" }, textContent: "draft" },
      {
        tagName: "button",
        attributes: { slot: "actions", type: "button" },
        textContent: "Pin",
      },
    ] as unknown as JxElement[]);
    const style = rules(item);
    expect(
      style.get('& [part="icon"], & [part="status"], & [part="actions"], & [part="grip-slot"]'),
    ).toContain("display: contents");
    expect(item.textContent).toContain("section");
    expect(item.textContent).toContain("draft");
    expect(item.querySelector("button")!.textContent).toBe("Pin");
    /* A slotted control cannot reach the row's NAME, which is the whole reason `label` is written to
       `aria-label`: without it a row whose content is a badge and a pin button is announced
       "section Hero Pin". */
    expect(item.getAttribute("aria-label")).toBe("Hero");
  });

  test("the grip is drawn only when asked for, and says nothing to a reader", async () => {
    const { item } = await render({ value: "a", label: "a", level: "1" });
    expect(item.querySelector('[part="grip"]')).toBeNull();

    item.grip = true;
    await flush();
    const grip = item.querySelector('[part="grip"]')!;
    /* A span rather than a control: it is the grab affordance for a pointer drag the island owns,
       and a focusable handle with no keyboard operation of its own would be an SC 2.1.1 failure
       dressed as an affordance. The keyboard path is cut and paste. */
    expect(grip.getAttribute("aria-hidden")).toBe("true");
    expect(grip.localName).toBe("span");
    expect(grip.querySelector("button")).toBeNull();
  });

  test("a click in actions stops at the container; a click on a mark does not", async () => {
    const { host, item } = await render({ value: "a", label: "a", level: "1" }, [
      { tagName: "span", attributes: { slot: "status" }, textContent: "draft" },
      {
        tagName: "button",
        attributes: { slot: "actions", type: "button" },
        textContent: "Pin",
      },
    ] as unknown as JxElement[]);
    const seen: string[] = [];
    host.addEventListener("click", (e) => {
      seen.push((e.target as Element).localName);
    });
    const pressed: string[] = [];
    item.querySelector("button")!.addEventListener("click", () => {
      pressed.push("pin");
    });

    item.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // The control's OWN handler ran — `stopPropagation` halts an event after the node it is called
    // On, never the listeners already run below it — and the row's ancestor heard nothing.
    expect(pressed).toEqual(["pin"]);
    expect(seen).toEqual([]);

    item
      .querySelector('[part="status"] , [slot="status"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen).toHaveLength(1);
  });

  test("the drag island's two attributes are styled here and bound NOWHERE", async () => {
    /* Pragmatic-drag-and-drop attaches through the host and writes them for the length of a
       gesture. A prop mirroring either would be a second writer, and the repaint that cleared it
       mid-drag is exactly the stale affordance a cancelled drag used to leave on screen. */
    const { item } = await render({ value: "a", label: "a", level: "1" });
    const style = rules(item);
    expect(style.get("&[data-dragging]")).toContain("opacity: 0.4");
    expect(style.get("&[data-drop]")).toContain("dashed");

    const doc = documents["jx-tree-item"]!;
    const written = Object.keys(doc.attributes ?? {});
    expect(written).not.toContain("data-dragging");
    expect(written).not.toContain("data-drop");
    expect(Object.keys(doc.state ?? {})).not.toContain("dragging");
  });

  test("says what hidden means to it", async () => {
    const { item } = await render({ value: "a", label: "a", level: "1" });
    expect(rules(item).get("&[hidden]")).toContain("display: none");
  });
});
