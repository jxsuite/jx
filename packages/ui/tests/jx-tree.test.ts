import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText, mount } from "@jxsuite/runtime";
import { findA11yDefects } from "@jxsuite/schema/a11y";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";
import {
  itemsOf,
  onTreeClick,
  onTreeDblClick,
  onTreeKeydown,
  onTreeMount,
  onTreeToggle,
  syncTree,
} from "../src/behaviors/tree.ts";
import type { TreeState } from "../src/behaviors/tree.ts";

/** Let the runtime's queued `onMount` settle. */
const flush = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type TreeEl = HTMLElement & {
  current: string;
  anchor: string;
  multiple: boolean;
  padtop: number;
  padbottom: number;
};
type ItemEl = HTMLElement & {
  value: string;
  label: string;
  level: number;
  expanded: string;
  selected: boolean;
  disabled: boolean;
  caret: boolean;
};

interface RowSpec {
  value: string;
  label: string;
  level: number;
  posinset?: number;
  setsize?: number;
  /** `""` is a leaf; `"true"`/`"false"` a branch. */
  expanded?: string;
  disabled?: boolean;
  children?: JxElement[];
}

function row(spec: RowSpec): JxElement {
  const attributes: Record<string, string> = {
    value: spec.value,
    label: spec.label,
    level: String(spec.level),
  };
  if (spec.posinset !== undefined) {
    attributes["posinset"] = String(spec.posinset);
  }
  if (spec.setsize !== undefined) {
    attributes["setsize"] = String(spec.setsize);
  }
  if (spec.expanded) {
    attributes["expanded"] = spec.expanded;
  }
  if (spec.disabled) {
    attributes["disabled"] = "";
  }
  const node: Record<string, unknown> = { attributes, tagName: "jx-tree-item" };
  if (spec.children) {
    node["children"] = spec.children;
  }
  return node as unknown as JxElement;
}

/** The outline every keyboard test walks: one open root, an open and a closed branch, two leaves. */
const OUTLINE: RowSpec[] = [
  { expanded: "true", level: 1, label: "body", posinset: 1, setsize: 1, value: "body" },
  { expanded: "false", level: 2, label: "header", posinset: 1, setsize: 3, value: "header" },
  { expanded: "true", level: 2, label: "main", posinset: 2, setsize: 3, value: "main" },
  { level: 3, label: "Hero", posinset: 1, setsize: 2, value: "hero" },
  { level: 3, label: "Prose", posinset: 2, setsize: 2, value: "prose" },
  { level: 2, label: "footer", posinset: 3, setsize: 3, value: "footer" },
];

interface TreeSpec {
  rows?: RowSpec[];
  current?: string;
  multiple?: boolean;
  padtop?: number;
  padbottom?: number;
  label?: string;
}

function treeDoc(spec: TreeSpec = {}): JxDocument {
  const attributes: Record<string, string> = {
    label: spec.label ?? "Document outline",
    current: spec.current ?? "body",
  };
  if (spec.multiple) {
    attributes["multiple"] = "";
  }
  if (spec.padtop !== undefined) {
    attributes["padtop"] = String(spec.padtop);
  }
  if (spec.padbottom !== undefined) {
    attributes["padbottom"] = String(spec.padbottom);
  }
  return {
    tagName: "div",
    children: [
      {
        tagName: "jx-tree",
        id: "tree",
        attributes,
        children: (spec.rows ?? OUTLINE).map((one) => row(one)),
      },
    ],
  } as unknown as JxDocument;
}

let dispose: (() => void) | null = null;

interface Mounted {
  host: HTMLElement;
  tree: TreeEl;
  rows: ItemEl[];
  changes: { detail: string; current: string }[];
  selects: { value: string; mode: string; anchor: string }[];
  moves: { from: string; key: string }[];
  seeks: { from: string; char: string }[];
  expands: { value: string; expanded: boolean }[];
  activates: string[];
  toggles: string[];
}

async function render(doc: JxDocument): Promise<Mounted> {
  const host = document.createElement("div");
  document.body.append(host);
  ({ dispose } = await mount(doc, host));
  await flush();
  const tree = host.querySelector("jx-tree") as TreeEl;
  const changes: { detail: string; current: string }[] = [];
  const selects: { value: string; mode: string; anchor: string }[] = [];
  const moves: { from: string; key: string }[] = [];
  const seeks: { from: string; char: string }[] = [];
  const expands: { value: string; expanded: boolean }[] = [];
  const activates: string[] = [];
  const toggles: string[] = [];
  /* Every listener sits on an ANCESTOR of the tree, never on the dispatching element: each of these
     is documented as bubbling, and a listener on the target itself cannot tell the difference. */
  host.addEventListener("change", (e) => {
    changes.push({
      current: (e.target as TreeEl).current,
      detail: String((e as CustomEvent).detail),
    });
  });
  host.addEventListener("select", (e) => {
    selects.push((e as CustomEvent).detail as { value: string; mode: string; anchor: string });
  });
  host.addEventListener("move", (e) => {
    moves.push((e as CustomEvent).detail as { from: string; key: string });
  });
  host.addEventListener("typeahead", (e) => {
    seeks.push((e as CustomEvent).detail as { from: string; char: string });
  });
  host.addEventListener("expand", (e) => {
    expands.push((e as CustomEvent).detail as { value: string; expanded: boolean });
  });
  host.addEventListener("activate", (e) => {
    activates.push(String((e as CustomEvent).detail));
  });
  // The row's INTERNAL protocol, which must stop at the tree.
  host.addEventListener("toggle", (e) => {
    // `toggle` is typed as the platform's ToggleEvent; the row's is a CustomEvent of its value.
    toggles.push(String((e as unknown as CustomEvent).detail));
  });
  return {
    activates,
    changes,
    expands,
    host,
    moves,
    rows: itemsOf(tree) as ItemEl[],
    seeks,
    selects,
    toggles,
    tree,
  };
}

interface Mods {
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

/** Press a key where a keyboard would: at the focused row, or at `fallback`. */
function key(fallback: Element, name: string, mods: Mods = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.ctrl === true,
    key: name,
    metaKey: mods.meta === true,
    shiftKey: mods.shift === true,
  });
  const active = document.activeElement;
  const target = active && fallback.contains(active) ? active : fallback;
  target.dispatchEvent(event);
  return event;
}

/** Click where a pointer would, carrying the modifiers a real one would carry. */
function click(el: Element, mods: Mods = {}, type = "click"): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.ctrl === true,
    metaKey: mods.meta === true,
    shiftKey: mods.shift === true,
  });
  el.dispatchEvent(event);
  return event;
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

const carets = (rows: ItemEl[]) => rows.map((one) => one.getAttribute("tabindex"));

/** Put the keyboard where a Tab press would: on the one row holding the caret. */
function enter(rows: ItemEl[]): ItemEl {
  const one = rows.find((each) => each.getAttribute("tabindex") === "0") ?? rows[0]!;
  one.focus();
  return one;
}

/** What the `sync` computed last wrote, read where it lives: the HOST's own `data-current`. */
const mirror = (tree: TreeEl) => tree.dataset["current"];

beforeAll(async () => {
  await registerUi({ theme: false });
});

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

describe("jx-tree", () => {
  test("the host IS the tree, and the tree owns its rows DIRECTLY", async () => {
    const { tree, rows } = await render(treeDoc());
    expect(tree.getAttribute("role")).toBe("tree");
    expect(tree.getAttribute("aria-label")).toBe("Document outline");
    expect(tree.getAttribute("tabindex")).toBe("-1");
    expect(tree.getAttribute("aria-multiselectable")).toBeNull();
    expect(rows).toHaveLength(6);
    expect(rows.every((one) => one.parentElement === tree)).toBe(true);
    /* Between the two spacers there is nothing but the rows: a slot is REPLACED by what it matched,
       so the treeitems are the tree's own children in the accessibility tree as well as this one. */
    expect([...tree.children].map((child) => child.localName)).toEqual([
      "div",
      ...Array.from({ length: 6 }, () => "jx-tree-item"),
      "div",
    ]);
    expect(rules(tree).get("&")).toContain("display: block");
  });

  test("the two spacers are the height of what was left out, and are not tree items", async () => {
    const { tree } = await render(treeDoc({ padbottom: 18_480, padtop: 960 }));
    const pads = [...tree.querySelectorAll<HTMLElement>('[part="pad-top"], [part="pad-bottom"]')];
    expect(pads).toHaveLength(2);
    expect(pads.map((pad) => pad.getAttribute("aria-hidden"))).toEqual(["true", "true"]);
    expect(pads.map((pad) => pad.getAttribute("role"))).toEqual([null, null]);
    expect(pads[0]!.getAttribute("style")).toContain("960px");
    expect(pads[1]!.getAttribute("style")).toContain("18480px");
  });

  test("nothing lints a missing label, so the element is what asserts it", () => {
    // A bare `role="tree"` with no name is a silent defect everywhere but here.
    const unnamed = {
      tagName: "div",
      children: [{ tagName: "div", attributes: { role: "tree" } }],
    } as unknown as JxDocument;
    expect(findA11yDefects(unnamed)).toEqual([]);

    const doc = documents["jx-tree"]!;
    expect(doc.attributes!["aria-label"]).toBe("${state.label}");
    expect((doc.state!["label"] as { default: string }).default).toBe("Tree");
  });

  test("exactly one row holds the caret at rest, and a host write of .current re-syncs it", async () => {
    const { tree, rows } = await render(treeDoc());
    expect(carets(rows)).toEqual(["0", "-1", "-1", "-1", "-1", "-1"]);
    expect(mirror(tree)).toBe("body");

    tree.current = "prose";
    expect(carets(rows)).toEqual(["-1", "-1", "-1", "-1", "0", "-1"]);
    expect(mirror(tree)).toBe("prose");

    // The effect runs during render and must be idempotent: a second pass changes nothing.
    const before = carets(rows);
    syncTree(tree);
    expect(carets(rows)).toEqual(before);
  });

  test("the arrows walk the rows and DO NOT wrap, which is the tree's deviation from the menu", async () => {
    const { tree, rows, changes, moves } = await render(treeDoc());
    enter(rows);
    key(tree, "ArrowDown");
    expect(tree.current).toBe("header");
    key(tree, "ArrowUp");
    expect(tree.current).toBe("body");

    // Off the top of a tree with no pad: nothing happens, and nothing is asked of the host.
    const before = changes.length;
    key(tree, "ArrowUp");
    expect(tree.current).toBe("body");
    expect(changes).toHaveLength(before);
    expect(moves).toEqual([]);

    key(tree, "End");
    expect(tree.current).toBe("footer");
    key(tree, "ArrowDown");
    expect(tree.current).toBe("footer");
    expect(moves).toEqual([]);
    key(tree, "Home");
    expect(tree.current).toBe("body");
  });

  test("current is written BEFORE change is dispatched", async () => {
    const { tree, rows, changes } = await render(treeDoc());
    enter(rows);
    key(tree, "ArrowDown");
    expect(changes).toEqual([{ current: "header", detail: "header" }]);
  });

  test("ArrowRight opens a closed row and steps into an open one; ArrowLeft closes and steps out", async () => {
    const { tree, rows, expands } = await render(treeDoc({ current: "header" }));
    enter(rows);
    // "header" is closed: Right asks for it to be OPENED and moves nothing.
    key(tree, "ArrowRight");
    expect(expands).toEqual([{ expanded: true, value: "header" }]);
    expect(tree.current).toBe("header");

    // "main" is open: Right steps into its first drawn child, which is the next DEEPER row.
    tree.current = "main";
    enter(rows);
    key(tree, "ArrowRight");
    expect(tree.current).toBe("hero");
    expect(expands).toHaveLength(1);

    // A leaf answers to neither.
    key(tree, "ArrowRight");
    expect(tree.current).toBe("hero");
    expect(expands).toHaveLength(1);

    // Left on a leaf steps OUT to the PARENT, which is the nearest row above at a shallower level
    // And not simply the row above: from the second leaf it walks past the first.
    tree.current = "prose";
    enter(rows);
    key(tree, "ArrowLeft");
    expect(tree.current).toBe("main");
    tree.current = "hero";
    enter(rows);
    key(tree, "ArrowLeft");
    expect(tree.current).toBe("main");
    // And Left on an open row closes it rather than moving.
    key(tree, "ArrowLeft");
    expect(expands).toEqual([
      { expanded: true, value: "header" },
      { expanded: false, value: "main" },
    ]);
    expect(tree.current).toBe("main");
  });

  test("typeahead moves to the next row whose label starts with the character", async () => {
    const { tree, rows } = await render(treeDoc());
    enter(rows);
    key(tree, "h");
    expect(tree.current).toBe("header");
    // The NEXT one after the caret, so a second press cycles rather than sticking.
    key(tree, "h");
    expect(tree.current).toBe("hero");
    key(tree, "p");
    expect(tree.current).toBe("prose");
    // It wraps, and a character nothing starts with moves nothing at all.
    key(tree, "b");
    expect(tree.current).toBe("body");
    key(tree, "z");
    expect(tree.current).toBe("body");
  });

  test("a windowed tree asks the HOST for the letter, and answers none of them itself", async () => {
    /*
     * The gap this closed. `typeaheadHit` searches the drawn rows and wraps INSIDE them, so over a
     * five-thousand-row model `h` reached whichever of the six painted rows started with `h` and
     * called that the tree's next match. Unlike a move that runs off the end of the slice, the
     * element cannot DISCOVER that: the search always answers, and the answer is simply the wrong
     * row. So the pad is consulted before the rows — the order Home and End already use — and every
     * printable character is dispatched.
     */
    const { tree, rows, seeks, changes } = await render(
      treeDoc({ current: "footer", padbottom: 18_480, padtop: 960 }),
    );
    enter(rows);
    const before = changes.length;

    // `h` names TWO drawn rows. The element still refuses to pick one.
    key(tree, "h");
    expect(seeks).toEqual([{ char: "h", from: "footer" }]);
    expect(tree.current).toBe("footer");
    expect(changes).toHaveLength(before);

    // Including a letter no drawn row starts with, and including a capital, lowercased.
    key(tree, "z");
    expect(seeks.at(-1)).toEqual({ char: "z", from: "footer" });
    key(tree, "P", { shift: true });
    expect(seeks.at(-1)).toEqual({ char: "p", from: "footer" });
    expect(tree.current).toBe("footer");

    // The host answers by writing `current`, exactly as it answers `move`.
    tree.current = "prose";
    await flush();
    key(tree, "b");
    expect(seeks.at(-1)).toEqual({ char: "b", from: "prose" });
  });

  test("ONE pad is enough: a tree scrolled to either end is still windowed", async () => {
    /* The state a tree spends most of its life in. At the top `padtop` is zero and the model still
       continues below; at the bottom the reverse. Reading "windowed" as both pads at once would let
       the letter be resolved over the slice in exactly the two positions a reader reaches first. */
    const top = await render(treeDoc({ current: "body", padbottom: 18_480 }));
    key(top.tree, "h");
    expect(top.seeks).toEqual([{ char: "h", from: "body" }]);
    expect(top.tree.current).toBe("body");
    dispose?.();

    const bottom = await render(treeDoc({ current: "footer", padtop: 18_480 }));
    key(bottom.tree, "h");
    expect(bottom.seeks).toEqual([{ char: "h", from: "footer" }]);
    expect(bottom.tree.current).toBe("footer");
  });

  test("with no pad the same letter is resolved here, and the host is asked nothing", async () => {
    // The slice IS the model, so the element's own search is the right answer rather than a guess.
    const { tree, rows, seeks } = await render(treeDoc());
    enter(rows);
    key(tree, "h");
    expect(tree.current).toBe("header");
    expect(seeks).toEqual([]);
  });

  test("a chord is never a typeahead letter, windowed or not", async () => {
    // The WCAG 2.5.7 pass-through, checked on the branch that now dispatches: `Ctrl`+`X` must
    // Neither move the caret nor be announced to the host as the letter `x`.
    const { tree, rows, seeks } = await render(
      treeDoc({ current: "footer", padbottom: 18_480, padtop: 960 }),
    );
    enter(rows);
    const event = key(tree, "x", { ctrl: true });
    expect(seeks).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  test("selection follows the caret, and the modifiers say what the reader meant", async () => {
    const { tree, rows, selects } = await render(treeDoc({ multiple: true }));
    expect(tree.getAttribute("aria-multiselectable")).toBe("true");
    enter(rows);

    key(tree, "ArrowDown");
    expect(selects.at(-1)).toEqual({ anchor: "header", mode: "replace", value: "header" });

    // Shift extends FROM the anchor the last plain move set.
    key(tree, "ArrowDown", { shift: true });
    expect(selects.at(-1)).toEqual({ anchor: "header", mode: "range", value: "main" });
    key(tree, "ArrowDown", { shift: true });
    expect(selects.at(-1)).toEqual({ anchor: "header", mode: "range", value: "hero" });

    // Ctrl moves the caret ALONE: no select at all.
    const before = selects.length;
    key(tree, "ArrowDown", { ctrl: true });
    expect(tree.current).toBe("prose");
    expect(selects).toHaveLength(before);

    // Space toggles this row into the set without moving or activating.
    key(tree, " ");
    expect(selects.at(-1)).toEqual({ anchor: "prose", mode: "toggle", value: "prose" });
    expect(tree.current).toBe("prose");
  });

  test("with multiple off, a modifier cannot produce anything but a replace", async () => {
    const { tree, rows, selects } = await render(treeDoc());
    enter(rows);
    key(tree, "ArrowDown", { shift: true });
    expect(selects.at(-1)).toEqual({ anchor: "header", mode: "replace", value: "header" });
    click(rows[3]!, { ctrl: true });
    expect(selects.at(-1)).toEqual({ anchor: "hero", mode: "replace", value: "hero" });
    key(tree, " ");
    expect(selects.at(-1)).toEqual({ anchor: "hero", mode: "replace", value: "hero" });
  });

  test("a pointer moves the caret and carries its own modifiers", async () => {
    const { tree, rows, selects, changes } = await render(treeDoc({ multiple: true }));
    click(rows[1]!);
    expect(tree.current).toBe("header");
    expect(changes.at(-1)).toEqual({ current: "header", detail: "header" });
    expect(selects.at(-1)).toEqual({ anchor: "header", mode: "replace", value: "header" });

    click(rows[4]!, { shift: true });
    expect(selects.at(-1)).toEqual({ anchor: "header", mode: "range", value: "prose" });
    click(rows[5]!, { meta: true });
    expect(selects.at(-1)).toEqual({ anchor: "footer", mode: "toggle", value: "footer" });
  });

  test("the twisty expands and does not select; the actions slot selects nothing either", async () => {
    const rows: RowSpec[] = [
      {
        children: [
          {
            tagName: "button",
            attributes: { slot: "actions", type: "button" },
            textContent: "Pin",
          } as unknown as JxElement,
        ],
        expanded: "false",
        label: "header",
        level: 1,
        value: "header",
      },
    ];
    const { tree, expands, selects, toggles } = await render(treeDoc({ rows }));
    const item = tree.querySelector("jx-tree-item")!;

    click(item.querySelector('[part="twisty"]')!);
    expect(expands).toEqual([{ expanded: true, value: "header" }]);
    expect(selects).toEqual([]);
    // The row's `toggle` is the tree's INTERNAL protocol and must not escape it.
    expect(toggles).toEqual([]);

    click(item.querySelector("button")!);
    expect(selects).toEqual([]);
    expect(tree.current).toBe("body");
  });

  test("Enter and a double click are the same verb, and Space is never one", async () => {
    const { tree, rows, activates, selects } = await render(treeDoc({ multiple: true }));
    enter(rows);
    key(tree, "Enter");
    expect(activates).toEqual(["body"]);
    click(rows[2]!, {}, "dblclick");
    expect(activates).toEqual(["body", "main"]);
    const before = activates.length;
    key(tree, " ");
    expect(activates).toHaveLength(before);
    expect(selects.at(-1)!.mode).toBe("toggle");
  });

  test("the counts describe the FULL set, never the drawn slice", async () => {
    /* Four rows drawn out of eight hundred and twelve. If either count were derived from the DOM a
       reader would be told this directory holds three files. */
    const rows: RowSpec[] = [
      { expanded: "true", level: 1, label: "src", posinset: 41, setsize: 4096, value: "src" },
      { level: 2, label: "a.json", posinset: 1, setsize: 812, value: "a" },
      { level: 2, label: "b.json", posinset: 2, setsize: 812, value: "b" },
      { level: 2, label: "c.json", posinset: 3, setsize: 812, value: "c" },
    ];
    const { rows: drawn } = await render(treeDoc({ padbottom: 19_400, padtop: 960, rows }));
    expect(drawn).toHaveLength(4);
    expect(drawn.map((one) => one.getAttribute("aria-setsize"))).toEqual([
      "4096",
      "812",
      "812",
      "812",
    ]);
    expect(drawn.map((one) => one.getAttribute("aria-posinset"))).toEqual(["41", "1", "2", "3"]);
    expect(drawn.map((one) => one.getAttribute("aria-level"))).toEqual(["1", "2", "2", "2"]);
  });

  test("a move off the drawn slice is dispatched rather than performed", async () => {
    const { tree, rows, moves, changes } = await render(
      treeDoc({ current: "footer", padbottom: 18_480, padtop: 960 }),
    );
    enter(rows);
    const before = changes.length;

    key(tree, "ArrowDown");
    expect(moves).toEqual([{ from: "footer", key: "ArrowDown" }]);
    // Nothing moved: the row it must reach has no element, so the host scrolls and writes `current`.
    expect(tree.current).toBe("footer");
    expect(changes).toHaveLength(before);

    key(tree, "End");
    expect(moves.at(-1)).toEqual({ from: "footer", key: "End" });

    tree.current = "body";
    enter(rows);
    key(tree, "ArrowUp");
    expect(moves.at(-1)).toEqual({ from: "body", key: "ArrowUp" });
    key(tree, "Home");
    expect(moves.at(-1)).toEqual({ from: "body", key: "Home" });
    expect(tree.current).toBe("body");
  });

  test("the same move with no pad clamps, and asks the host for nothing", async () => {
    const { tree, rows, moves } = await render(treeDoc({ current: "footer" }));
    enter(rows);
    key(tree, "ArrowDown");
    key(tree, "End");
    expect(moves).toEqual([]);
    expect(tree.current).toBe("footer");
  });

  test("a caret the slice does not hold falls back to a drawn row, and leaves current alone", async () => {
    const { tree, rows } = await render(treeDoc({ current: "scrolled-past", padtop: 960 }));
    expect(carets(rows)).toEqual(["0", "-1", "-1", "-1", "-1", "-1"]);
    // The tab STOP moved so the tree stays reachable; the host's model did not.
    expect(tree.current).toBe("scrolled-past");
    expect(mirror(tree)).toBe("scrolled-past");
  });

  test("every chord the tree does not own reaches the host untouched", async () => {
    /* The WCAG 2.5.7 alternative to the drag island is cut, select, paste, and all three are HOST
       commands with chords. A tree that swallowed them would take the only pointer-free way to move
       a node with it. */
    const { tree, rows, changes, selects, activates } = await render(treeDoc({ multiple: true }));
    enter(rows);
    key(tree, "ArrowDown");
    const before = {
      activates: activates.length,
      changes: changes.length,
      current: tree.current,
      selects: selects.length,
    };
    for (const [name, mods] of [
      ["x", { ctrl: true }],
      ["v", { ctrl: true }],
      ["c", { meta: true }],
      ["a", { ctrl: true }],
      ["Delete", {}],
      ["F2", {}],
      ["Tab", {}],
      ["Escape", {}],
    ] as [string, Mods][]) {
      const event = key(tree, name, mods);
      expect(event.defaultPrevented, `${name} must not be prevented`).toBe(false);
    }
    expect(tree.current).toBe(before.current);
    expect(changes).toHaveLength(before.changes);
    expect(selects).toHaveLength(before.selects);
    expect(activates).toHaveLength(before.activates);
  });

  test("a disabled row is stepped over, takes no tab stop, and answers no click", async () => {
    const rows: RowSpec[] = [
      { level: 1, label: "one", value: "one" },
      { disabled: true, level: 1, label: "two", value: "two" },
      { level: 1, label: "three", value: "three" },
    ];
    const { tree, selects } = await render(treeDoc({ current: "one", rows }));
    const all = [...tree.querySelectorAll<ItemEl>("jx-tree-item")];
    expect(all.map((one) => one.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    enter(all);
    key(tree, "ArrowDown");
    expect(tree.current).toBe("three");

    const before = selects.length;
    click(all[1]!);
    expect(selects).toHaveLength(before);
    expect(tree.current).toBe("three");
  });

  test("the row set moves too, and the one tab stop survives it", async () => {
    /* A scroll replaces the whole slice. Without the observer the tree would keep the caret on a
       row that is gone, and no row would carry tabindex="0" at all — the tree drops out of the tab
       order, with nothing on screen saying so. */
    const { tree } = await render(treeDoc({ current: "body" }));
    tree.querySelector('jx-tree-item[value="body"]')!.remove();
    await flush();
    const left = [...tree.querySelectorAll<ItemEl>("jx-tree-item")];
    expect(left.map((one) => one.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1", "-1"]);
    expect(tree.current).toBe("body");
  });
});

describe("jx-tree, where there is nothing to do", () => {
  test("an empty tree has no caret, and answers a key with nothing at all", async () => {
    const { tree } = await render(treeDoc({ rows: [] }));
    expect(itemsOf(tree)).toEqual([]);
    // Not a crash and not a guess: syncTree writes no caret onto a set it has none of.
    syncTree(tree);
    const event = key(tree, "ArrowDown");
    expect(event.defaultPrevented).toBe(false);
    expect(tree.current).toBe("body");
  });

  test("a key pressed with the caret nowhere moves nothing", async () => {
    /* Focus on the TREE itself rather than on a row — where a click on the padding leaves it. The
       arrows still have an end to start from, but the keys that act on a row have no row. */
    const { tree, activates, selects, expands } = await render(treeDoc({ multiple: true }));
    tree.focus();
    for (const name of ["ArrowRight", "ArrowLeft", "Enter", " "]) {
      key(tree, name);
    }
    expect(activates).toEqual([]);
    expect(selects).toEqual([]);
    expect(expands).toEqual([]);
    expect(tree.current).toBe("body");
  });

  test("ArrowLeft on a top-level row has nowhere to step out to", async () => {
    const rows: RowSpec[] = [{ level: 1, label: "only", value: "only" }];
    const { tree, moves, changes } = await render(treeDoc({ current: "only", rows }));
    enter([...tree.querySelectorAll<ItemEl>("jx-tree-item")]);
    const before = changes.length;
    key(tree, "ArrowLeft");
    expect(tree.current).toBe("only");
    expect(changes).toHaveLength(before);
    // And it asks the host for nothing: a top-level row has no parent, drawn or otherwise.
    expect(moves).toEqual([]);
  });

  test("ArrowRight on an open row whose children are not drawn steps nowhere", async () => {
    /* An expanded directory whose contents sit outside the window. The next drawn row is its
       SIBLING, so stepping onto it would announce a sibling as a child. */
    const rows: RowSpec[] = [
      { expanded: "true", level: 1, label: "src", value: "src" },
      { expanded: "false", level: 1, label: "docs", value: "docs" },
    ];
    const { tree, changes } = await render(treeDoc({ current: "src", rows }));
    enter([...tree.querySelectorAll<ItemEl>("jx-tree-item")]);
    const before = changes.length;
    key(tree, "ArrowRight");
    expect(tree.current).toBe("src");
    expect(changes).toHaveLength(before);
  });

  test("a double click that lands on no row, or on a disabled one, activates nothing", async () => {
    const rows: RowSpec[] = [
      { level: 1, label: "one", value: "one" },
      { disabled: true, level: 1, label: "two", value: "two" },
    ];
    const { tree, activates } = await render(treeDoc({ current: "one", rows }));
    click(tree.querySelector('[part="pad-top"]')!, {}, "dblclick");
    click(tree.querySelectorAll("jx-tree-item")[1]!, {}, "dblclick");
    expect(activates).toEqual([]);
  });

  test("a handler bound to something that is not a tree does nothing to it", async () => {
    /* Every entry point reads its element from `event.currentTarget` and refuses anything that is
       not a `jx-tree`. That is what keeps a surface that delegates its own listeners from making
       the sidecar act on a panel. */
    const scope: TreeState = { current: "body", multiple: true };
    const stranger = document.createElement("div");
    document.body.append(stranger);
    stranger.append(document.createElement("jx-tree-item"));
    const seen: string[] = [];
    for (const [name, handler] of [
      ["keydown", onTreeKeydown],
      ["click", onTreeClick],
      ["dblclick", onTreeDblClick],
      ["toggle", onTreeToggle],
      ["jx-ready", onTreeMount],
    ] as [string, (state: TreeState, event: never) => void][]) {
      stranger.addEventListener(name, (e) => {
        handler(scope, e as never);
      });
      stranger.addEventListener(name, () => {
        seen.push(name);
      });
    }
    stranger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    stranger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    stranger.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    stranger.dispatchEvent(new CustomEvent("toggle", { bubbles: true, detail: "x" }));
    stranger.dispatchEvent(new CustomEvent("jx-ready", { bubbles: true }));
    // The listeners ran; the sidecar declined every one of them.
    expect(seen).toHaveLength(5);
    expect(scope.current).toBe("body");
    stranger.remove();
  });

  test("a re-mount re-syncs from the ELEMENT, and leaves exactly one watch behind", async () => {
    const { tree } = await render(treeDoc());
    /* The HOST is the truth. `syncTree` derives every caret from the element's own `current`, so a
       scope handed a different value cannot move the tab stop behind the host's back — which is
       what lets the sync computed, the mount and the observer all be the same call. */
    const scope: TreeState = { current: "main" };
    const relearn = () => {
      tree.addEventListener("jx-ready", function once(e) {
        tree.removeEventListener("jx-ready", once);
        onTreeMount(scope, e);
      });
      tree.dispatchEvent(new CustomEvent("jx-ready"));
    };
    relearn();
    relearn();
    expect(carets(itemsOf(tree) as ItemEl[])).toEqual(["0", "-1", "-1", "-1", "-1", "-1"]);

    // And one watch, not two: the row set still repairs itself exactly once after a second mount.
    tree.querySelector('jx-tree-item[value="body"]')!.remove();
    await flush();
    const left = [...tree.querySelectorAll<ItemEl>("jx-tree-item")];
    expect(left.filter((one) => one.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  test("typeahead reads a name a consumer SLOTTED rather than named", async () => {
    /* A row with no `label` writes no `aria-label`, so accname falls back to name-from-content and
       the reader is announced its text. Typeahead matches the SAME two things in the same order, so
       a letter that moves the caret is always a letter the row said. */
    const rows: RowSpec[] = [
      { level: 1, label: "alpha", value: "a" },
      {
        children: [
          { tagName: "span", attributes: { slot: "status" }, textContent: "beta" },
        ] as unknown as JxElement[],
        label: "",
        level: 1,
        value: "b",
      },
    ];
    const { tree } = await render(treeDoc({ current: "a", rows }));
    enter([...tree.querySelectorAll<ItemEl>("jx-tree-item")]);
    key(tree, "b");
    expect(tree.current).toBe("b");
  });
});
