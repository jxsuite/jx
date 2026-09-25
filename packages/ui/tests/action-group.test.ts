import "./with-dom.ts";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildStyleRules } from "@jxsuite/runtime/css";
import { findA11yDefects } from "@jxsuite/schema/a11y";
import { findPopoverDefects } from "@jxsuite/schema/overlays";
import type { JxElement, JxStyle } from "@jxsuite/schema/types";

import {
  focusItem,
  itemsOf,
  onGroupKeydown,
  onGroupReady,
  syncRoving,
} from "../src/behaviors/action-group.ts";
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

type JxActionGroup = HTMLElement & {
  selects: string;
  compact: boolean;
  label: string;
  orientation: string;
};

type JxActionButton = HTMLElement & {
  tabindex: string;
  disabled: boolean;
  selected: boolean;
  checked: string;
};

/** Every rule the element's own style block emits, under a stand-in scope handle. */
const sheet = (): string[] =>
  buildStyleRules(documents["jx-action-group"]!.style as JxStyle, { scope: "S" }).map(
    (rule) => rule.text,
  );

const page = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../stylebook/jx-action-group.json"), "utf8"),
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

/** A fresh child: `"label"`, `"label!"` disabled, `"label*"` selected, `"label#"` checked=true. */
function makeItem(label: string): JxActionButton {
  const button = document.createElement("jx-action-button") as JxActionButton;
  button.setAttribute("label", label.replace(/[!*#]$/u, ""));
  button.setAttribute("icon", "plus");
  if (label.endsWith("!")) {
    button.setAttribute("disabled", "");
  }
  if (label.endsWith("*")) {
    button.setAttribute("selected", "");
  }
  if (label.endsWith("#")) {
    button.setAttribute("checked", "true");
  }
  return button;
}

/** A group whose children are described by {@link makeItem}'s spelling. */
function build(attrs: Record<string, string>, labels: string[]): JxActionGroup {
  const el = document.createElement("jx-action-group") as JxActionGroup;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  for (const label of labels) {
    el.append(makeItem(label));
  }
  return el;
}

async function group(attrs: Record<string, string>, labels: string[]): Promise<JxActionGroup> {
  const el = build(attrs, labels);
  document.body.append(el);
  await tick();
  await tick();
  return el;
}

const buttons = (el: Element) => [...el.querySelectorAll<JxActionButton>("jx-action-button")];
const carets = (el: Element) => buttons(el).map((b) => b.tabindex);
const controlOf = (b: Element) => b.querySelector<HTMLButtonElement>('[part="control"]')!;
/** The label of the child the FOCUS is on, which `carets` cannot see. */
const focused = () =>
  document.activeElement?.closest("jx-action-button")?.getAttribute("label") ?? null;

/** Send a key from whichever inner control currently holds the caret, having focused it first. */
function press(el: JxActionGroup, key: string): void {
  const held = buttons(el).find((b) => b.tabindex === "0") ?? buttons(el)[0]!;
  controlOf(held).focus();
  controlOf(held).dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
  );
}

describe("jx-action-group", () => {
  test("one attribute chooses the whole ARIA pattern, and only a role that allows it is told the axis", async () => {
    /* `aria-orientation` is used in `toolbar` and inherits into `radiogroup`; `group` is in
       NEITHER list, so writing it there is an `aria-allowed-attr` violation in a consumer's own
       axe run — and Chrome drops it anyway (measured: `toolbar` and `radiogroup` carry
       `orientation="horizontal"` in the tree and `group "Visible panels"` does not). The LAYOUT
       therefore keys off `data-orientation`, which every group carries whatever its role. */
    const toolbar = await group({ label: "Tools" }, ["A", "B"]);
    expect(toolbar.getAttribute("role")).toBe("toolbar");
    expect(toolbar.getAttribute("aria-label")).toBe("Tools");
    expect(toolbar.getAttribute("aria-orientation")).toBe("horizontal");
    expect(toolbar.dataset.orientation).toBe("horizontal");
    toolbar.selects = "single";
    await tick();
    expect(toolbar.getAttribute("role")).toBe("radiogroup");
    expect(toolbar.getAttribute("aria-orientation")).toBe("horizontal");
    toolbar.selects = "multiple";
    await tick();
    expect(toolbar.getAttribute("role")).toBe("group");
    expect(toolbar.hasAttribute("aria-orientation")).toBe(false);
    toolbar.orientation = "vertical";
    await tick();
    expect(toolbar.hasAttribute("aria-orientation")).toBe(false);
    expect(toolbar.dataset.orientation).toBe("vertical");
    toolbar.selects = "none";
    await tick();
    expect(toolbar.getAttribute("aria-orientation")).toBe("vertical");
  });

  test("the group is a single tab stop at rest, and the caret starts on the chosen child", async () => {
    /* A native `<button>` is focusable with NO tabindex, so collapsing N children to one tab stop
       is a WRITE the group has to make before the reader's first Tab — not something the first
       arrow key can fix. It is written on the child's own declared prop, never on its internals. */
    const plain = await group({ label: "Tools" }, ["A", "B", "C"]);
    expect(carets(plain)).toEqual(["0", "-1", "-1"]);
    const chosen = await group({ label: "Align", selects: "single" }, ["A", "B#", "C"]);
    expect(carets(chosen)).toEqual(["-1", "0", "-1"]);
    // And it lands on the CONTROL, which is the focusable node.
    expect(controlOf(buttons(chosen)[1]!).getAttribute("tabindex")).toBe("0");
    expect(buttons(chosen)[1]!.hasAttribute("tabindex")).toBe(false);
    // A `multiple` group spells the same thing `selected`, and the caret reads either.
    const toggles = await group({ label: "Panels", selects: "multiple" }, ["A", "B*", "C"]);
    expect(carets(toggles)).toEqual(["-1", "0", "-1"]);
  });

  test("in selects=single the children are RADIOS, which is the host's half of the contract", async () => {
    /* WAI-ARIA: a `radiogroup`'s required owned element is a `radio`, and `jx-action-button`
       becomes one only when `checked` is non-empty. A group whose children carry only `selected`
       renders, in Chrome, as `radiogroup "Align" / button / button / button` — a radio group with
       no checked member at all, and `findA11yDefects` has no required-children rule to say so.
       So the prop description asks for `checked`, and the stylebook is the worked example. */
    const good = await group({ label: "Align", selects: "single" }, ["A#", "B", "C"]);
    expect(controlOf(buttons(good)[0]!).getAttribute("role")).toBe("radio");
    expect(controlOf(buttons(good)[0]!).getAttribute("aria-checked")).toBe("true");
    const bare = await group({ label: "Align", selects: "single" }, ["A*", "B", "C"]);
    expect(controlOf(buttons(bare)[0]!).getAttribute("role")).toBeNull();
    // Every `selects="single"` group the stylebook ships binds `checked` on every child.
    const singles = walk(page).filter(
      (node) => node.tagName === "jx-action-group" && node.$props?.["selects"] === "single",
    );
    expect(singles.length).toBeGreaterThanOrEqual(1);
    for (const node of singles) {
      for (const child of (node.children ?? []) as JxElement[]) {
        expect(child.$props?.["checked"], JSON.stringify(child.$props)).toBeString();
      }
    }
  });

  test("the arrows move the caret AND the focus, skip a disabled child, and wrap", async () => {
    /* Two things happen per key and only one of them is the tabindex: `carets()` reads back the
       property the handler just wrote, so a group that never called `focus()` at all would pass
       every assertion about it while the reader's focus ring and screen-reader cursor stayed on
       the button they started from. */
    const el = await group({ label: "Tools" }, ["A", "B!", "C", "D"]);
    expect(carets(el)).toEqual(["0", "-1", "-1", "-1"]);
    press(el, "ArrowRight");
    // B is disabled, so the caret steps over it.
    expect(carets(el)).toEqual(["-1", "-1", "0", "-1"]);
    expect(focused()).toBe("C");
    press(el, "ArrowRight");
    expect(carets(el)).toEqual(["-1", "-1", "-1", "0"]);
    expect(focused()).toBe("D");
    press(el, "ArrowRight");
    expect(carets(el)).toEqual(["0", "-1", "-1", "-1"]);
    expect(focused()).toBe("A");
    press(el, "ArrowLeft");
    expect(carets(el)).toEqual(["-1", "-1", "-1", "0"]);
    expect(focused()).toBe("D");
    press(el, "End");
    expect(carets(el)).toEqual(["-1", "-1", "-1", "0"]);
    expect(focused()).toBe("D");
    press(el, "Home");
    expect(carets(el)).toEqual(["0", "-1", "-1", "-1"]);
    expect(focused()).toBe("A");
    // A disabled child is still taken OUT of the tab order, which is the other half of one stop.
    expect(buttons(el)[1]!.tabindex).toBe("-1");
  });

  test("a vertical group answers Down and Up, and ignores the horizontal pair", async () => {
    const el = await group({ label: "Panels", orientation: "vertical" }, ["A", "B", "C"]);
    press(el, "ArrowRight");
    expect(carets(el)).toEqual(["0", "-1", "-1"]);
    expect(focused()).toBe("A");
    press(el, "ArrowDown");
    expect(carets(el)).toEqual(["-1", "0", "-1"]);
    expect(focused()).toBe("B");
    press(el, "ArrowUp");
    expect(carets(el)).toEqual(["0", "-1", "-1"]);
    expect(focused()).toBe("A");
  });

  test("the one tab stop SURVIVES children arriving, leaving and being disabled", async () => {
    /* Placing the caret once at mount is not enough, and the failure is not cosmetic. Measured on
       a real group before the observer existed: appending a child gave it no `tabindex` at all —
       a SECOND tab stop in the element whose whole purpose is to have one — while disabling or
       removing the caret-holder left ZERO, so a real Tab went straight past three enabled,
       operable buttons. Both are the ordinary life of a Studio toolbar. */
    const el = await group({ label: "Tools" }, ["A", "B", "C"]);
    expect(carets(el)).toEqual(["0", "-1", "-1"]);
    // Appended to the GROUP: a distributed child is the group's own child, so that is where a
    // Host adding one puts it, and it is what the observer watches.
    el.append(makeItem("D"));
    await settle();
    expect(carets(el)).toEqual(["0", "-1", "-1", "-1"]);
    // Disabling the caret-holder hands the caret on rather than stranding it.
    buttons(el)[0]!.setAttribute("disabled", "");
    await settle();
    expect(carets(el)).toEqual(["-1", "0", "-1", "-1"]);
    // Removing the holder does the same.
    buttons(el)[1]!.remove();
    await settle();
    expect(carets(el)).toEqual(["-1", "0", "-1"]);
    // Exactly one, always: never two, never none.
    expect(carets(el).filter((t) => t === "0")).toHaveLength(1);
    // And a mutation that changes nothing about the answer writes nothing.
    el.append(document.createElement("span"));
    await settle();
    expect(carets(el)).toEqual(["-1", "0", "-1"]);
  });

  test("in selects=single an arrow CLICKS the child it lands on, so the host hears the key", async () => {
    /* The group does not write `checked`: a write would move the selection with nothing
       announcing it, because `jx-action-button` speaks only from inside its own click handler.
       Clicking is the ONE path a pointer and an arrow both take, so the host's handler runs
       exactly once either way. */
    const el = await group({ label: "Align", selects: "single" }, ["A#", "B", "C"]);
    const clicked: string[] = [];
    el.addEventListener("click", (e) => {
      const button = (e.target as Element).closest("jx-action-button");
      clicked.push(button?.getAttribute("label") ?? "?");
    });
    press(el, "ArrowRight");
    expect(clicked).toEqual(["B"]);
    press(el, "ArrowRight");
    expect(clicked).toEqual(["B", "C"]);
  });

  test("in selects=none and multiple an arrow only MOVES", async () => {
    for (const selects of ["none", "multiple"]) {
      const el = await group({ label: "Tools", selects }, ["A", "B"]);
      let clicks = 0;
      el.addEventListener("click", () => {
        clicks += 1;
      });
      press(el, "ArrowRight");
      expect(carets(el), selects).toEqual(["-1", "0"]);
      expect(clicks, selects).toBe(0);
      el.remove();
    }
  });

  test("a key the group does not own is left alone, and one inside a NESTED group is not this one's", async () => {
    const outer = await group({ label: "Outer" }, ["A", "B"]);
    const inner = build({ label: "Inner", orientation: "vertical" }, ["X", "Y"]);
    outer.append(inner);
    await tick();
    await tick();
    expect(itemsOf(outer).map((i) => i.getAttribute("label"))).toEqual(["A", "B"]);
    const own = () => itemsOf(outer).map((i) => i.tabindex);
    const before = own();
    /* The nested group is VERTICAL, so it ignores ArrowRight and does not stop it — the key then
       reaches the outer, horizontal group by bubbling with a target that is not the outer group's
       child at all. Without the ownership test the outer group would move its own caret and yank
       focus out of the group the reader is standing in. */
    const stray = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });
    controlOf(buttons(inner)[0]!).dispatchEvent(stray);
    expect(own()).toEqual(before);
    expect(stray.defaultPrevented).toBe(false);
    // And the nested group answers its own axis, which is the other half of "it is not this one's".
    const mine = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    });
    controlOf(buttons(inner)[0]!).dispatchEvent(mine);
    expect(itemsOf(inner).map((i) => i.tabindex)).toEqual(["-1", "0"]);
    expect(own()).toEqual(before);
    // And a key the contract does not name passes through uncancelled.
    const tab = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    controlOf(buttons(outer)[0]!).dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    const arrow = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Home" });
    controlOf(buttons(outer)[0]!).dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
  });

  test("a group with nothing that can act takes no caret and moves none", async () => {
    const el = await group({ label: "Tools" }, ["A!", "B!"]);
    expect(carets(el)).toEqual(["-1", "-1"]);
    expect(focusItem(el, 0)).toBeNull();
    press(el, "ArrowRight");
    expect(carets(el)).toEqual(["-1", "-1"]);
  });

  test("the caret can be placed before a child has upgraded, from its attributes", async () => {
    /* A slotted child's own `connectedCallback` is async, so the group can legitimately be asked
       to rove either side of that moment. Read from the property where it exists and from the
       attribute where it does not; a detached group is the second case exactly. */
    const el = build({ label: "Align" }, ["A!", "B*", "C"]);
    const kids = buttons(el);
    expect(kids[0]!.disabled).toBeUndefined();
    syncRoving(el);
    expect(kids.map((b) => b.tabindex)).toEqual(["-1", "0", "-1"]);
    // Re-syncing keeps the caret where it is rather than recomputing it.
    syncRoving(el);
    expect(kids.map((b) => b.tabindex)).toEqual(["-1", "0", "-1"]);
    // The other pre-upgrade spelling of "chosen", read off the attribute.
    const checked = build({ label: "Align" }, ["A", "B#", "C"]);
    syncRoving(checked);
    expect(buttons(checked).map((b) => b.tabindex)).toEqual(["-1", "0", "-1"]);
  });

  test("both handlers are safe on an event that names no group, and write nothing", async () => {
    /* They are exported, so a host may bind them itself — and an event that has finished
       dispatching reports a null currentTarget, which is the one shape that would otherwise walk
       a null. Nothing is thrown, and no caret in the page moves. */
    const el = await group({ label: "Tools" }, ["A", "B"]);
    const before = carets(el);
    const settled = new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" });
    expect(settled.currentTarget).toBeNull();
    expect(() => onGroupKeydown({ orientation: "horizontal" }, settled)).not.toThrow();
    expect(() => onGroupReady({}, settled)).not.toThrow();
    const stray = document.createElement("div");
    document.body.append(stray);
    stray.addEventListener("keydown", (e) =>
      onGroupKeydown({ orientation: "horizontal" }, e as KeyboardEvent),
    );
    stray.addEventListener("jx-ready", (e) => onGroupReady({}, e));
    stray.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    stray.dispatchEvent(new CustomEvent("jx-ready", { bubbles: true }));
    expect(carets(el)).toEqual(before);
    // A second readiness event re-syncs but does not start a second observer.
    el.dispatchEvent(new CustomEvent("jx-ready", { bubbles: true }));
    await settle();
    expect(carets(el)).toEqual(before);
  });

  test("the segmented seam is a DIRECT-CHILD rule, and a middle segment really is square", async () => {
    /* The seam used to be written `> [part="items"] > jx-action-button`, reaching THROUGH the
       emulated `<slot>` that stood between the group and its buttons — a workaround for a node
       that no longer exists. A slot is now replaced by the children it matched, so a distributed
       button IS the group's own child and the seam is the plain child rule it always wanted to be.
       The `[part="items"]` form is not merely longer now, it is dead: it names no node, so every
       segment falls back to the button's own `var(--jx-radius-sm)` and the joining silently does
       not happen (measured in Chrome 152 before this: `border-radius: 4px` on the middle segment
       and a 0px seam between neighbours; after: `0px` and a `-1px` overlap). Nothing else asserts
       the specificity either, which is why this reads the COMPUTED value. */
    const el = await group({ label: "Align" }, ["A", "B", "C"]);
    expect(el.dataset.compact).toBe("");
    // No slot stands between them: the group's own children ARE the three buttons.
    expect([...el.children].map((child) => child.localName)).toEqual([
      "jx-action-button",
      "jx-action-button",
      "jx-action-button",
    ]);
    const middle = controlOf(buttons(el)[1]!);
    expect(getComputedStyle(middle).borderRadius).toBe("0px");
    const rules = sheet();
    expect(rules).toContain(
      'S[data-compact] > jx-action-button > [part="control"] { border-radius: 0 }',
    );
    // Every seam rule is that shape: none of them crosses a part that no longer names a node, and
    // None of them is a loose descendant selector either — see the nested-group test below.
    for (const rule of rules) {
      if (rule.includes("jx-action-button")) {
        expect(rule, rule).toContain("S[data-compact]");
        expect(rule, rule).toMatch(/S\[data-compact\](\[[^\]]+\])* > jx-action-button/u);
      }
      expect(rule, rule).not.toContain('[part="items"]');
    }
  });

  test("a NESTED group keeps its own compact, because the seam reaches only direct children", async () => {
    /* Measured in Chrome with the descendant form: an outer compact group welded the buttons of a
       nested `compact="false"` group into its own row — half-rounded corners and a `-1px` seam
       margin on children of a group that says it draws none, while that group kept its own gap,
       so it drew as neither joined nor separate. The sidecar already refuses a nested group's
       children (`itemsOf`); the stylesheet has to refuse them too. Re-measured in Chrome 152 on
       the direct-child form: `4px 0px 0px 4px` on O1, `0px 4px 4px 0px` on O2, a flat `4px` on
       both of the inner group's, and no seam margin on I2. */
    const outer = build({ label: "Outer" }, ["O1"]);
    const inner = build({ label: "Inner", compact: "false" }, ["I1", "I2"]);
    outer.append(inner);
    outer.append(makeItem("O2"));
    document.body.append(outer);
    await tick();
    await tick();
    const style = (label: string) =>
      getComputedStyle(controlOf(buttons(outer).find((b) => b.getAttribute("label") === label)!));
    // The outer group's OWN children are joined: squared off, and the later ones pulled together.
    expect(style("O1").borderRadius).toBe("0px");
    expect(style("O2").borderRadius).toBe("0px");
    // The nested group's are not touched by it — no squaring, and no seam margin either.
    expect(style("I1").borderRadius).not.toBe("0px");
    expect(style("I2").borderRadius).not.toBe("0px");
    expect(style("I2").marginInlineStart).not.toBe("-1px");
  });

  test("a vertical compact group turns the seam through 90 degrees", async () => {
    /* `orientation`'s own description promises this, and three rules implement it — all three of
       which could be deleted while every other test in the file stayed green, because the only
       computed assertion the seam had was on a HORIZONTAL group. */
    const el = await group({ label: "Panels", orientation: "vertical" }, ["A", "B", "C"]);
    const style = (i: number) => getComputedStyle(controlOf(buttons(el)[i]!));
    // The seam runs along the block axis, and the inline pull the horizontal rule made is undone.
    expect(style(1).marginBlockStart).toBe("-1px");
    expect(style(1).marginInlineStart).toBe("0");
    // The rounded corners move to the top of the first segment and the bottom of the last.
    expect(style(0).borderEndStartRadius).toBe("0");
    expect(style(2).borderStartEndRadius).toBe("0");
    // Against the horizontal group, which pulls along the inline axis and rounds the ends.
    const across = await group({ label: "Tools" }, ["A", "B", "C"]);
    const middle = getComputedStyle(controlOf(buttons(across)[1]!));
    expect(middle.marginInlineStart).toBe("-1px");
    expect(middle.marginBlockStart).toBe("");
  });

  test("compact=false leaves the buttons separate and draws no seam", async () => {
    const el = await group({ compact: "false", label: "Align" }, ["A", "B", "C"]);
    expect(el.dataset.compact).toBeUndefined();
    const middle = controlOf(buttons(el)[1]!);
    expect(getComputedStyle(middle).borderRadius).not.toBe("0px");
  });

  test("the container role owns its children directly, with no box of its own between", async () => {
    /* A generic with a box between a container role and the elements it owns is the trap this
       family is most likely to fall into, and it used to be a question about the `<slot>`: does
       the node between the group and its buttons declare a display? There is no such node now — a
       slot is replaced by what it matched — so the trap is answered by the DOM rather than by
       reading the definition. The HOST is the flex row, and the definition still authors exactly
       one internal node with no style of its own, so a second one cannot arrive unnoticed. */
    const style = documents["jx-action-group"]!.style as Record<string, unknown>;
    expect(style["display"]).toBe("inline-flex");
    const el = await group({ label: "Tools" }, ["A", "B"]);
    expect([...el.children].map((child) => child.localName)).toEqual([
      "jx-action-button",
      "jx-action-button",
    ]);
    expect(buttons(el).every((button) => button.parentElement === el)).toBe(true);
    const children = documents["jx-action-group"]!.children as JxElement[];
    expect(children).toHaveLength(1);
    expect(children[0]!.tagName).toBe("slot");
    expect(children[0]!.style).toBeUndefined();
  });

  test("the group owns no selection and emits no event of its own", () => {
    /* Two contracts were possible and only one survives contact with the call sites: every real
       one keeps the selected value in the host. A group-level `change` would be a second,
       disagreeing answer about what just happened. */
    const doc = documents["jx-action-group"]!;
    expect(doc.state?.["selects"]).toBeDefined();
    expect(Object.keys(doc.state ?? {})).not.toContain("selected");
    expect(Object.keys(doc.state ?? {})).not.toContain("value");
    const emitted = JSON.stringify(doc).match(/"dispatchEvent":"[^"]+"/gu) ?? [];
    expect(emitted).toEqual(['"dispatchEvent":"jx-ready"']);
    // And no size, quiet or emphasized: the child owns those, and a second copy would fight it.
    for (const forwarded of ["size", "quiet", "emphasized"]) {
      expect(Object.keys(doc.state ?? {}), forwarded).not.toContain(forwarded);
    }
  });

  test("the label is the group's own responsibility, because no lint can ask for it", async () => {
    /* A BOUND role makes the accessibility lint return "bound" and switch the naming rules off,
       and `toolbar` is in neither named-role set anyway — so an unnamed group of controls passes
       every gate the kit has. This is the gate, and it walks the WHOLE page: a group one wrapper
       deeper than the last one was both uncounted and unchecked while this stayed green. */
    const unnamed = await group({}, ["A", "B"]);
    expect(unnamed.hasAttribute("aria-label")).toBe(false);
    expect(findA11yDefects(documents["jx-action-group"]! as JxElement)).toEqual([]);
    const groups = walk(page).filter((child) => child.tagName === "jx-action-group");
    expect(groups.length).toBeGreaterThanOrEqual(4);
    for (const node of groups) {
      expect(node.$props?.["label"], JSON.stringify(node.$props)).toBeString();
      expect(node.$props?.["label"]).not.toBe("");
    }
  });

  test("a demo handler that reads the event declares NO parameters", () => {
    /* A `$prototype: "Function"` with a `body` AND a non-empty `parameters` is built as a
       CALLABLE — `(...args) => runStatements(body, state, null, { args })` — so the event is
       `null` by construction and every `event#/…` in the body reads `undefined`. It is silent:
       no lint, no typecheck, no schema rule, and a page whose whole point is a live value just
       prints "undefined". This page carried exactly that, and so did two others. */
    for (const [key, entry] of Object.entries((page.state ?? {}) as Record<string, unknown>)) {
      const fn = entry as { $prototype?: string; parameters?: unknown[]; body?: unknown };
      if (fn?.$prototype !== "Function" || !fn.body) {
        continue;
      }
      if (JSON.stringify(fn.body).includes("event#/")) {
        expect(fn.parameters, key).toBeUndefined();
      }
    }
  });

  test("the element and a consumer document both pass the kit's lints", () => {
    const doc = documents["jx-action-group"]! as JxElement;
    const scope = { invokerTags: INVOKER_TAGS, popoverTags: POPOVER_TAGS };
    expect(findA11yDefects(doc)).toEqual([]);
    expect(findPopoverDefects(doc, scope)).toEqual([]);
    expect(findA11yDefects(page)).toEqual([]);
    expect(findPopoverDefects(page, scope)).toEqual([]);
  });
});

describe("a compact group draws the segmented control itself", () => {
  /* Every seam rule acts on a member's border, and a member is quiet by default: a transparent
     border and fill. So a compact group of default members drew as a gap-less row of bare words,
     the kit's own first stylebook specimen included, and every Studio switch converted from
     Spectrum (whose action button was not quiet by default) lost its frame. The group now draws
     each member's frame, fill and selected state whatever its quiet says.

     happy-dom leaves a `var()` it cannot resolve EMPTY, and the theme's colours are `light-dark()`
     and `color-mix()`, which it cannot parse, so the theme alone would make every colour below
     read as the member's `transparent`. Each token the rules read is therefore stood in by a
     sentinel of its own for the length of this block: the cascade still decides which rule wins,
     and the sentinel says which token it drew. */
  const TOKENS = {
    "--jx-bg-input": "rgb(1, 1, 1)",
    "--jx-border-strong": "rgb(2, 2, 2)",
    "--jx-fg": "rgb(3, 3, 3)",
    "--jx-fg-dim": "rgb(4, 4, 4)",
    "--jx-accent": "rgb(5, 5, 5)",
    "--jx-accent-15": "rgb(6, 6, 6)",
    "--jx-accent-20": "rgb(7, 7, 7)",
    "--jx-accent-solid": "rgb(8, 8, 8)",
    "--jx-accent-fg": "rgb(9, 9, 9)",
    "--jx-space-1": "2px",
    "--jx-space-2": "4px",
  } as const;
  let stand: HTMLStyleElement;

  beforeAll(() => {
    stand = document.createElement("style");
    stand.textContent = `:root { ${Object.entries(TOKENS)
      .map(([name, value]) => `${name}: ${value}`)
      .join("; ")} }`;
    document.head.append(stand);
  });

  afterAll(() => {
    stand.remove();
  });

  /** A small TEXT member, the shape Studio's switches take: no glyph, a span for the words. */
  function textItem(label: string, attrs: Record<string, string> = {}): JxActionButton {
    const button = document.createElement("jx-action-button") as JxActionButton;
    button.setAttribute("label", label);
    button.setAttribute("size", "sm");
    for (const [k, v] of Object.entries(attrs)) {
      button.setAttribute(k, v);
    }
    const words = document.createElement("span");
    words.textContent = label;
    button.append(words);
    return button;
  }

  async function mount(el: JxActionGroup, members: JxActionButton[]): Promise<JxActionGroup> {
    el.append(...members);
    document.body.append(el);
    await settle();
    return el;
  }

  const freshGroup = (attrs: Record<string, string>): JxActionGroup => {
    const el = document.createElement("jx-action-group") as JxActionGroup;
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    return el;
  };

  const look = (b: Element) => {
    const style = getComputedStyle(controlOf(b));
    return {
      background: style.backgroundColor,
      border: style.borderTopColor,
      color: style.color,
    };
  };

  test("whatever the members' quiet says, the frame and the fill are the group's", async () => {
    const el = await group({ label: "Align" }, ["A", "B*"]);
    const [plain] = buttons(el);
    // The members ARE quiet: nothing about them asked for a frame.
    expect(buttons(el).every((b) => b.dataset.quiet === "")).toBe(true);
    expect(look(plain!)).toEqual({
      background: TOKENS["--jx-bg-input"],
      border: TOKENS["--jx-border-strong"],
      color: TOKENS["--jx-fg-dim"],
    });
    expect(sheet()).toContain(
      'S[data-compact] > jx-action-button:not([data-selected]) > [part="control"] { border-color: var(--jx-border-strong); background: var(--jx-bg-input); color: var(--jx-fg-dim) }',
    );
  });

  test("compact=false leaves quiet members frameless, which is how a row of quiet tools is spelled", async () => {
    const el = await group({ compact: "false", label: "Tools" }, ["A", "B"]);
    for (const member of buttons(el)) {
      expect(look(member).background).toBe("transparent");
      expect(look(member).border).toBe("transparent");
    }
  });

  test("the selected segment outranks the member's own quiet and selected rules, and emphasized keeps its solid", async () => {
    /* The member's selected state is a 15% tint and nothing else; the group's is a stronger tint
       with an accent EDGE, raised over both neighbours so the edge shows through the -1px overlap.
       The two rules and the unselected one are mutually exclusive, so none of them leans on sheet
       order against the member's own. */
    const el = await group({ label: "Align" }, ["A", "B*"]);
    const [plain, chosen] = buttons(el);
    expect(look(chosen!)).toEqual({
      background: TOKENS["--jx-accent-20"],
      border: TOKENS["--jx-accent"],
      color: TOKENS["--jx-fg"],
    });
    expect(getComputedStyle(controlOf(chosen!)).zIndex).toBe("1");
    expect(getComputedStyle(controlOf(plain!)).zIndex).toBe("");

    chosen!.setAttribute("emphasized", "");
    await settle();
    expect(look(chosen!)).toEqual({
      background: TOKENS["--jx-accent-solid"],
      border: TOKENS["--jx-accent-solid"],
      color: TOKENS["--jx-accent-fg"],
    });

    // A radio segment is selected by `checked` alone, and draws the same.
    const radios = await group({ label: "Mode", selects: "single" }, ["Edit#", "Design"]);
    expect(look(buttons(radios)[0]!).border).toBe(TOKENS["--jx-accent"]);
    expect(look(buttons(radios)[1]!).border).toBe(TOKENS["--jx-border-strong"]);
  });

  test("the hover wash is layered over the fill, and a disabled segment takes none", () => {
    /* `:hover` cannot be driven in happy-dom, so this reads the rule; the declarations are the
       claim. The wash is an IMAGE over the input fill, because `--jx-hover-bg` alone is 6% over
       transparent and on the zoom pod's darkest background came out a shade from the resting
       fill. `:not(:disabled)` is the other half of the resting rule's ink: the member's own hover
       is not gated, and it may not brighten a segment that cannot act. */
    expect(sheet()).toContain(
      'S[data-compact] > jx-action-button:not([data-selected]) > [part="control"]:hover:not(:disabled) { background-color: var(--jx-bg-input); background-image: linear-gradient(var(--jx-hover-bg), var(--jx-hover-bg)); color: var(--jx-fg) }',
    );
  });

  test("a text-only small segment gets --jx-space-2 of inline padding, and a glyph segment does not", async () => {
    /* The DOM double does not map `padding-inline` onto the physical sides, so the logical
       property is read directly: set to the token on a text segment, absent on a glyph one, which
       keeps the small size's own 2px (`padding: 0 var(--jx-space-1)`). */
    const el = freshGroup({ label: "Display" });
    const glyph = document.createElement("jx-action-button") as JxActionButton;
    glyph.setAttribute("label", "Row");
    glyph.setAttribute("icon", "plus");
    glyph.setAttribute("size", "sm");
    await mount(el, [textItem("flex"), textItem("grid", { selected: "" }), glyph]);
    const [flex, grid, row] = buttons(el).map((b) => getComputedStyle(controlOf(b)));
    expect(flex!.getPropertyValue("padding-inline")).toBe("4px");
    expect(grid!.getPropertyValue("padding-inline")).toBe("4px");
    expect(row!.getPropertyValue("padding-inline")).toBe("");
    expect(row!.paddingLeft).toBe("2px");
    // The padding is the group's: the same text member outside a compact group keeps 2px.
    const loose = await mount(freshGroup({ compact: "false", label: "Loose" }), [textItem("flex")]);
    const [alone] = buttons(loose);
    expect(getComputedStyle(controlOf(alone!)).getPropertyValue("padding-inline")).toBe("");
  });

  test("a focus ring paints over the selected segment's raised edge", () => {
    const rules = sheet();
    const z = (selector: string) => {
      const found = rules.find((rule) => rule.startsWith(`${selector} {`)) ?? "";
      return Number(/z-index: (\d+)/u.exec(found)?.[1]);
    };
    expect(z('S[data-compact] > jx-action-button[data-selected] > [part="control"]')).toBe(1);
    expect(z('S[data-compact] > jx-action-button > [part="control"]:focus-visible')).toBe(2);
  });

  test("in forced colours the chosen segment is the system's selection pair", () => {
    /* Forced colours replace the accent tint and the accent edge alike, so without this the
       segmented control would say nothing about which segment is on. */
    const forced = sheet().find((rule) => rule.startsWith("@media (forced-colors: active)"));
    expect(forced).toBeDefined();
    expect(forced).toContain(
      'S[data-compact] > jx-action-button[data-selected] > [part="control"]',
    );
    expect(forced).toContain("forced-color-adjust: none");
    expect(forced).toContain("background: Highlight");
    expect(forced).toContain("border-color: Highlight");
    expect(forced).toContain("color: HighlightText");
  });

  test("the stylebook's compact specimens lean on the group, and its quiet row is compact=false", () => {
    /* The page used to pass `quiet: false` to every member of a compact group, which is what made
       it the only place a segmented control ever looked segmented. The specimens now take the
       member default, so the page draws what a consumer gets, and the one row of quiet tools says
       compact=false. */
    const groups = walk(page).filter((node) => node.tagName === "jx-action-group");
    for (const node of groups) {
      if (node.$props?.["compact"] === false) {
        continue;
      }
      for (const member of walk(node).filter((child) => child.tagName === "jx-action-button")) {
        expect(member.$props?.["quiet"], JSON.stringify(member.$props)).toBeUndefined();
      }
    }
    const quietRow = groups.find((node) => node.$props?.["label"] === "File actions");
    expect(quietRow?.$props?.["compact"]).toBe(false);
    const textRow = groups.find((node) => node.$props?.["label"] === "Canvas mode");
    const words = walk(textRow!).filter((child) => child.tagName === "jx-action-button");
    expect(words.map((member) => member.$props?.["size"])).toEqual(["sm", "sm", "sm"]);
    expect(words.every((member) => member.$props?.["icon"] === undefined)).toBe(true);
  });
});
