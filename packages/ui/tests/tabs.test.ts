import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText, mount } from "@jxsuite/runtime";
import { findA11yDefects } from "@jxsuite/schema/a11y";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";
import stylebookTabs from "../stylebook/jx-tabs.json";
import {
  applySelection,
  focusTab,
  onTabsKeydown,
  onTabsMount,
  onTabsSelect,
  syncTabs,
  tabsOf,
} from "../src/behaviors/tabs.ts";
import type { TabsState } from "../src/behaviors/tabs.ts";

/** Let the runtime's queued `onMount` settle. */
const flush = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type TabsEl = HTMLElement & { selected: string; label: string; activation: string };
type TabEl = HTMLElement & { value: string; label: string; selected: boolean };
type PanelEl = HTMLElement & { active: boolean };

interface TabSpec {
  closable?: boolean;
  dirty?: boolean;
}

function tab(value: string, label: string, spec: TabSpec = {}): JxElement {
  const attributes: Record<string, string> = {
    id: `tab-${value}`,
    value,
    label,
    panel: `p-${value}`,
  };
  if (spec.closable) {
    attributes["closable"] = "";
  }
  if (spec.dirty) {
    attributes["dirty"] = "";
  }
  return { tagName: "jx-tab", attributes } as JxElement;
}

interface StripSpec {
  activation?: string;
  orientation?: string;
  selected?: string;
  label?: string;
  tabs?: JxElement[];
}

function strip(spec: StripSpec = {}): JxDocument {
  const attributes: Record<string, string> = {
    label: spec.label ?? "Inspector sections",
    selected: spec.selected ?? "design",
  };
  if (spec.activation) {
    attributes["activation"] = spec.activation;
  }
  if (spec.orientation) {
    attributes["orientation"] = spec.orientation;
  }
  return {
    tagName: "div",
    children: [
      {
        tagName: "jx-tabs",
        id: "strip",
        attributes,
        children: spec.tabs ?? [
          tab("design", "Design"),
          tab("content", "Content"),
          tab("logic", "Logic"),
        ],
      },
    ],
  } as unknown as JxDocument;
}

let dispose: (() => void) | null = null;

interface Mounted {
  host: HTMLElement;
  tabs: TabsEl;
  rows: TabEl[];
  changes: { detail: string; selected: string }[];
  closes: string[];
  selects: string[];
}

async function render(doc: JxDocument): Promise<Mounted> {
  const host = document.createElement("div");
  document.body.append(host);
  ({ dispose } = await mount(doc, host));
  await flush();
  const tabs = host.querySelector("jx-tabs") as TabsEl;
  const changes: { detail: string; selected: string }[] = [];
  const closes: string[] = [];
  const selects: string[] = [];
  // Both listeners sit on an ANCESTOR of the strip, never on the dispatching element. `change` and
  // `close` are documented as bubbling, and a listener on the target itself cannot tell the
  // Difference. A delegated handler on a panel container is the shape a real host uses.
  host.addEventListener("change", (e) => {
    changes.push({
      detail: String((e as CustomEvent).detail),
      selected: (e.target as TabsEl).selected,
    });
  });
  host.addEventListener("close", (e) => {
    closes.push(String((e as CustomEvent).detail));
  });
  // `select` is the strip's INTERNAL protocol and must stop at the tablist.
  host.addEventListener("select", (e) => {
    selects.push(String((e as CustomEvent).detail));
  });
  return { host, tabs, rows: tabsOf(tabs) as TabEl[], changes, closes, selects };
}

/** Press a key where a keyboard would: at the focused tab, or at `fallback`. */
function key(fallback: Element, name: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  const active = document.activeElement;
  const target = active && fallback.contains(active) ? active : fallback;
  target.dispatchEvent(event);
  return event;
}

/**
 * The emitted stylesheet, by selector with the scope attribute folded back to `&`.
 *
 * Scoped to ONE element's own `data-jx` when given one: every kit element writes an `&[hidden]`
 * rule, so an unscoped map answers with whichever element rendered last and a missing rule reads as
 * a present one.
 */
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

const carets = (rows: TabEl[]) => rows.map((row) => row.getAttribute("tabindex"));

/**
 * What the `sync` computed last wrote, read where it lives: the internal `<slot part="tabs">`.
 *
 * It is on the slot rather than the host on purpose — the host already publishes `selected`, and a
 * second host attribute saying the same thing is public surface a consumer can read and be misled
 * by. Reading it here is how the test proves the effect ran at all.
 */
const mirror = (tabs: TabsEl) =>
  tabs.querySelector<HTMLElement>('slot[part="tabs"]')!.dataset["selection"];

/** Put the keyboard where a Tab press would: on the one tab holding the caret. */
function enter(rows: TabEl[]): TabEl {
  const row = rows.find((one) => one.getAttribute("tabindex") === "0") ?? rows[0]!;
  row.focus();
  return row;
}
const selections = (rows: TabEl[]) => rows.map((row) => row.getAttribute("aria-selected"));

beforeAll(async () => {
  await registerUi({ theme: false });
});

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

describe("jx-tabs", () => {
  test("the host IS the tablist, and the slot between it and its tabs declares no display", async () => {
    const { tabs } = await render(strip());
    expect(tabs.getAttribute("role")).toBe("tablist");
    expect(tabs.getAttribute("aria-label")).toBe("Inspector sections");
    expect(tabs.getAttribute("aria-orientation")).toBe("horizontal");
    expect(tabs.getAttribute("tabindex")).toBe("-1");

    // A generic box between a container role and its owned elements is the trap: the tabs must be
    // The tablist's own children in the accessibility tree, so the flex row is the HOST's.
    const slot = tabs.querySelector('slot[part="tabs"]');
    expect(slot).not.toBeNull();
    expect(slot!.parentElement).toBe(tabs);
    expect(tabsOf(tabs).every((row) => row.parentElement === slot)).toBe(true);
    const doc = documents["jx-tabs"]!;
    const slotDef = (doc.children as JxElement[])[0]!;
    expect(slotDef.tagName).toBe("slot");
    expect(slotDef.style).toBeUndefined();
    for (const [selector, body] of rules(tabs)) {
      if (selector.includes('[part="tabs"]')) {
        expect(`${selector} { ${body} }`).not.toContain("display");
      }
    }
    expect(rules(tabs).get("&")).toContain("display: flex");
  });

  test("nothing lints a missing label, so the element is what asserts it", () => {
    // A BOUND role makes `roleOf` return "bound" and switches the naming rules off, and `tablist`
    // Is in neither named-role set anyway — so an unnamed strip is a silent defect everywhere but
    // Here.
    const unnamed = {
      tagName: "div",
      children: [{ tagName: "div", attributes: { role: "tablist" } }],
    } as unknown as JxDocument;
    expect(findA11yDefects(unnamed)).toEqual([]);

    const doc = documents["jx-tabs"]!;
    expect(doc.attributes!["aria-label"]).toBe("${state.label}");
    expect((doc.state!["label"] as { default: string }).default).toBe("Tabs");
  });

  test("exactly one tab holds the caret at rest, and the arrows move it with wrap", async () => {
    const { tabs, rows } = await render(strip({ activation: "manual" }));
    expect(carets(rows)).toEqual(["0", "-1", "-1"]);
    expect(enter(rows)).toBe(rows[0]!);

    key(tabs, "ArrowRight");
    expect(carets(rows)).toEqual(["-1", "0", "-1"]);
    key(tabs, "ArrowRight");
    key(tabs, "ArrowRight");
    expect(carets(rows)).toEqual(["0", "-1", "-1"]);
    key(tabs, "ArrowLeft");
    expect(carets(rows)).toEqual(["-1", "-1", "0"]);
    key(tabs, "Home");
    expect(carets(rows)).toEqual(["0", "-1", "-1"]);
    key(tabs, "End");
    expect(carets(rows)).toEqual(["-1", "-1", "0"]);
  });

  test("a vertical strip moves on Down and Up, and says so", async () => {
    const { tabs, rows } = await render(strip({ activation: "manual", orientation: "vertical" }));
    expect(tabs.getAttribute("aria-orientation")).toBe("vertical");
    enter(rows);
    key(tabs, "ArrowRight");
    expect(carets(rows)).toEqual(["0", "-1", "-1"]);
    key(tabs, "ArrowDown");
    expect(carets(rows)).toEqual(["-1", "0", "-1"]);
    key(tabs, "ArrowUp");
    expect(carets(rows)).toEqual(["0", "-1", "-1"]);
  });

  test("activation=auto selects as the caret lands, and dispatches one change", async () => {
    const { tabs, rows, changes } = await render(strip());
    enter(rows);
    key(tabs, "ArrowRight");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.detail).toBe("content");
    expect(tabs.selected).toBe("content");
    expect(selections(rows)).toEqual(["false", "true", "false"]);
  });

  test("activation=manual moves without selecting until Enter or Space", async () => {
    const { tabs, rows, changes } = await render(strip({ activation: "manual" }));
    enter(rows);
    key(tabs, "ArrowRight");
    expect(changes).toEqual([]);
    expect(tabs.selected).toBe("design");
    expect(selections(rows)).toEqual(["true", "false", "false"]);

    key(tabs, "Enter");
    expect(changes.map((c) => c.detail)).toEqual(["content"]);
    expect(selections(rows)).toEqual(["false", "true", "false"]);

    key(tabs, "ArrowRight");
    key(tabs, " ");
    expect(changes.map((c) => c.detail)).toEqual(["content", "logic"]);
  });

  test("selected is written BEFORE change is dispatched", async () => {
    const { rows, changes } = await render(strip());
    rows[2]!.click();
    expect(changes).toEqual([{ detail: "logic", selected: "logic" }]);
  });

  test("a host write of el.selected re-syncs the tabs with no method call, twice over", async () => {
    const { tabs, rows } = await render(strip());
    expect(selections(rows)).toEqual(["true", "false", "false"]);

    tabs.selected = "logic";
    expect(selections(rows)).toEqual(["false", "false", "true"]);
    expect(carets(rows)).toEqual(["-1", "-1", "0"]);
    expect(mirror(tabs)).toBe("logic");

    // The effect runs during render and must be idempotent: the second application changes nothing.
    const before = [...selections(rows), ...carets(rows)];
    syncTabs(tabs);
    expect([...selections(rows), ...carets(rows)]).toEqual(before);
  });

  test("a selection no tab answers to leaves every tab unselected and the caret at the first", async () => {
    const { tabs, rows } = await render(strip({ selected: "" }));
    expect(selections(rows)).toEqual(["false", "false", "false"]);
    expect(carets(rows)).toEqual(["0", "-1", "-1"]);
    tabs.selected = "nothing-here";
    expect(selections(rows)).toEqual(["false", "false", "false"]);
    expect(carets(rows)).toEqual(["0", "-1", "-1"]);
  });

  test("Delete closes a closable focused tab, through the pointer's own path", async () => {
    const { tabs, rows, closes, changes } = await render(
      strip({
        activation: "manual",
        tabs: [
          tab("index", "index.page.json", { closable: true }),
          tab("about", "about.page.json"),
        ],
      }),
    );
    enter(rows);
    key(tabs, "Delete");
    expect(closes).toEqual(["index"]);
    expect(changes).toEqual([]);

    key(tabs, "ArrowRight");
    key(tabs, "Delete");
    expect(closes).toEqual(["index"]);
    expect(rows[1]!.querySelector('[part="close"]')).toBeNull();
  });

  test("a key that rose out of a nested strip is not the outer strip's to answer", async () => {
    const doc = {
      tagName: "div",
      children: [
        {
          tagName: "jx-tabs",
          id: "strip",
          attributes: { label: "Inspector sections", selected: "design" },
          children: [
            tab("design", "Design"),
            tab("content", "Content"),
            { tagName: "jx-tabs", attributes: { label: "Nested", selected: "" } },
          ],
        },
      ],
    } as unknown as JxDocument;
    const { tabs, rows } = await render(doc);
    const inner = document.querySelectorAll("jx-tabs")[1] as TabsEl;

    // The outer strip owns exactly its own tabs, and the nested one is not one of them.
    expect(rows).toHaveLength(2);
    expect(tabs.contains(inner)).toBe(true);

    enter(rows);
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    inner.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(carets(rows)).toEqual(["0", "-1"]);
  });

  test("a strip with no tabs answers no key at all", async () => {
    const { tabs } = await render(strip({ tabs: [] }));
    const event = key(tabs, "ArrowRight");
    expect(event.defaultPrevented).toBe(false);
    expect(mirror(tabs)).toBe("design");
  });

  test("a key the strip does not own is left to the page", async () => {
    const { tabs } = await render(strip());
    const event = key(tabs, "PageDown");
    expect(event.defaultPrevented).toBe(false);
  });

  test("ArrowLeft from outside any tab wraps to the last, and Enter from there is the page's", async () => {
    const { tabs, rows, changes } = await render(strip({ activation: "manual" }));
    // Nothing is focused, so no tab is under the caret and there is nothing to activate. The strip
    // Did nothing, so it must not claim the key either.
    const commit = key(tabs, "Enter");
    expect(commit.defaultPrevented).toBe(false);
    expect(changes).toEqual([]);
    tabs.blur();
    for (const row of rows) {
      row.blur();
    }
    tabs.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(carets(rows)).toEqual(["-1", "-1", "0"]);
  });

  test("the handlers ignore an event whose currentTarget is not a strip", () => {
    const scope: TabsState = { selected: "design" };
    const other = document.createElement("div");
    document.body.append(other);
    let seen = 0;
    other.addEventListener("change", () => {
      seen += 1;
    });
    other.addEventListener("keydown", (e) => {
      onTabsKeydown(scope, e as KeyboardEvent);
    });
    other.addEventListener("select", (e) => {
      onTabsSelect(scope, e);
    });
    other.addEventListener("jx-ready", (e) => {
      onTabsMount(scope, e);
    });
    other.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    other.dispatchEvent(new CustomEvent("select", { detail: "logic" }));
    other.dispatchEvent(new CustomEvent("jx-ready"));
    expect(scope.selected).toBe("design");
    expect(seen).toBe(0);
    expect(applySelection(scope)).toBe("design");
  });

  test("the shipped stylebook page selects on a click, and its panels follow", async () => {
    // The kit's own demonstration, mounted. A stylebook page is schema-validated and linted by
    // Conformance and MOUNTED BY NOTHING, so a handler shaped in a way the runtime hands its
    // Positional arguments to — a `parameters`-declaring `$prototype: "Function"` in `state` —
    // Writes `undefined` back into `selected` and blanks every panel on the first click, with
    // Every gate green. This is what mounts it.
    const host = document.createElement("div");
    document.body.append(host);
    ({ dispose } = await mount(stylebookTabs as unknown as JxDocument, host, {
      base: "jx-ui:/stylebook/",
    } as never));
    await flush();
    const auto = host.querySelector("jx-tabs") as TabsEl;
    const rows = tabsOf(auto) as TabEl[];
    rows[1]!.click();
    await flush();
    expect(auto.selected).toBe("content");
    expect(auto.getAttribute("selected")).toBe("content");
    expect(selections(rows)).toEqual(["false", "true", "false"]);
    // The three panels of the automatic strip: exactly one is showing.
    const panels = [...host.querySelectorAll("jx-tab-panel")] as PanelEl[];
    expect(panels.map((panel) => panel.hasAttribute("hidden"))).toEqual([true, false, true]);
  });

  test("closing the current tab leaves the strip in the tab order", async () => {
    const { tabs, rows } = await render(strip({ selected: "content", activation: "manual" }));
    expect(carets(rows)).toEqual(["-1", "0", "-1"]);

    // Closing a tab is the one thing `closable` exists for, and the `sync` computed cannot see it:
    // It re-runs when `selected` CHANGES VALUE, and the tab set moved instead. Without a watcher
    // The strip is left with no `tabindex="0"` at all, and the host is `tabindex="-1"` — the whole
    // Tablist drops out of the tab order and no host write repairs it.
    rows[1]!.remove();
    await flush();
    const left = tabsOf(tabs) as TabEl[];
    expect(carets(left)).toEqual(["0", "-1"]);
    expect(selections(left)).toEqual(["false", "false"]);
  });

  test("a tab that arrives after mount takes the caret its strip was already pointing at", async () => {
    const { tabs, rows } = await render(
      strip({ selected: "logic", tabs: [tab("design", "Design")] }),
    );
    expect(carets(rows)).toEqual(["0"]);

    const late = document.createElement("jx-tab");
    late.setAttribute("value", "logic");
    late.setAttribute("label", "Logic");
    tabs.querySelector('slot[part="tabs"]')!.append(late);
    await flush();
    const now = tabsOf(tabs) as TabEl[];
    expect(now).toHaveLength(2);
    expect(carets(now)).toEqual(["-1", "0"]);
    expect(selections(now)).toEqual(["false", "true"]);
  });

  test("re-activating the tab that is already current says nothing", async () => {
    const { tabs, rows, changes } = await render(strip({ activation: "manual" }));
    // `change` means THE SELECTION MOVED. A second click on the current tab, or End pressed twice
    // From the last tab, moves nothing and must not tell a host that it did.
    rows[0]!.click();
    expect(changes).toEqual([]);
    expect(tabs.selected).toBe("design");

    enter(rows);
    key(tabs, "End");
    key(tabs, "Enter");
    key(tabs, "End");
    key(tabs, "Enter");
    expect(changes.map((c) => c.detail)).toEqual(["logic"]);
  });

  test("select is the strip's own protocol and never leaves the tablist", async () => {
    const { rows, changes, selects } = await render(strip());
    rows[1]!.click();
    expect(changes.map((c) => c.detail)).toEqual(["content"]);
    // A tab dispatches `select` and the strip answers with `change`. A host must see exactly one
    // Of those two, or a delegated listener counts every selection twice.
    expect(selects).toEqual([]);
  });

  test("a vertical strip moves the selected tab's mark to the inline edge too", async () => {
    const { tabs, rows } = await render(strip({ orientation: "vertical" }));
    const own = rules(rows[0]!);
    // The tab draws its own mark on the block edge and CANNOT see the strip's orientation from its
    // Own sheet, so the strip is what corrects it — the descendant form, which crosses the emulated
    // Slot, and at a specificity that beats the tab's own rule.
    expect(own.get("&")).toContain("border-block-end: 2px solid transparent");
    expect(own.get('&[aria-selected="true"]')).toContain("border-block-end-color");

    const strip_ = rules(tabs);
    expect(strip_.get('&[aria-orientation="vertical"]')).toContain("flex-direction: column");
    expect(strip_.get('&[aria-orientation="vertical"]')).toContain("border-inline-end: 1px solid");
    expect(strip_.get('&[aria-orientation="vertical"] jx-tab')).toContain(
      "border-inline-end: 2px solid transparent",
    );
    expect(strip_.get('&[aria-orientation="vertical"] jx-tab')).toContain("border-block-end: 0");
    expect(strip_.get('&[aria-orientation="vertical"] jx-tab[aria-selected="true"]')).toContain(
      "border-inline-end-color: var(--jx-accent-solid)",
    );
  });

  test("focusTab and syncTabs on an empty strip are no-ops", async () => {
    const { tabs } = await render(strip({ tabs: [] }));
    expect(focusTab([], 0)).toBeNull();
    expect(() => {
      syncTabs(tabs);
    }).not.toThrow();
  });
});

describe("jx-tab", () => {
  test("a tab names itself once, so the close button's own name cannot double it", async () => {
    const { rows } = await render(
      strip({ tabs: [tab("index", "index.page.json", { closable: true })] }),
    );
    const row = rows[0]!;
    expect(row.getAttribute("role")).toBe("tab");
    expect(row.getAttribute("aria-selected")).toBe("false");
    expect(row.getAttribute("aria-controls")).toBe("p-index");
    expect(row.querySelector('[part="label"]')!.textContent).toBe("index.page.json");

    // A `tab` takes its name FROM CONTENT, and the accessible name of every descendant is part of
    // That content — so the close button's own `aria-label` joins the tab's name and a reader hears
    // The file name twice ("index.page.json Close index.page.json", measured in Chrome). The tab
    // Therefore names itself explicitly, with exactly the string it draws.
    expect(row.getAttribute("aria-label")).toBe("index.page.json");
    expect(row.querySelector('[part="close"]')!.getAttribute("aria-label")).toBe(
      "Close index.page.json",
    );

    // An unlabelled tab claims no empty name.
    const { rows: bare } = await render(strip({ tabs: [{ tagName: "jx-tab" } as JxElement] }));
    expect(bare[0]!.hasAttribute("aria-label")).toBe(false);
  });

  test("label written as a PROPERTY does not move the attribute selectors read", async () => {
    const { rows } = await render(strip());
    const row = rows[0]!;
    row.label = "Design 2";
    expect(row.querySelector('[part="label"]')!.textContent).toBe("Design 2");
    // The runtime does not reflect a property write back to an attribute, so a host that writes
    // `el.label` silently breaks every `getAttribute("label")` selector while looking correct.
    expect(row.getAttribute("label")).toBe("Design");
    row.setAttribute("label", "Design 3");
    expect(row.getAttribute("label")).toBe("Design 3");
    expect(row.querySelector('[part="label"]')!.textContent).toBe("Design 3");
  });

  test("the close affordance is a plain button with a jx-icon in it, and no slot anywhere", async () => {
    const { rows } = await render(
      strip({ tabs: [tab("index", "index.page.json", { closable: true, dirty: true })] }),
    );
    const row = rows[0]!;
    const close = row.querySelector('[part="close"]') as HTMLButtonElement;
    expect(close.localName).toBe("button");
    expect(close.getAttribute("type")).toBe("button");
    expect(close.getAttribute("aria-label")).toBe("Close index.page.json");
    expect(close.querySelector("jx-icon")).not.toBeNull();
    // A nested defined element that ships a default `<slot>` would capture the host's slot
    // Distribution, because `distributeSlots` is a plain `querySelectorAll("slot")` walk.
    expect(close.querySelector("slot")).toBeNull();
    expect(row.querySelectorAll("slot")).toHaveLength(0);
    expect(row.querySelector('[part="dirty"]')).not.toBeNull();

    // The close target draws 16px and MUST be reachable at 24 (SC 2.5.8): the tab it sits in is a
    // Target too, so the spacing exception cannot rescue an undersized one. The pseudo-element
    // Grows the hit area without moving a pixel of the layout.
    const own = rules(row);
    expect(own.get('& [part="close"]')).toContain("width: 16px");
    expect(own.get('& [part="close"]')).toContain("position: relative");
    expect(own.get('& [part="close"]::before')).toContain("inset-block: -4px");
    expect(own.get('& [part="close"]::before')).toContain("inset-inline: -4px");
  });

  test("a plain tab draws no dot, no close button, and pays nothing for their absence", async () => {
    const { rows } = await render(strip());
    const row = rows[0]!;
    // The `dirty` prop's whole reason for existing is that a clean tab has no mark. Nothing else
    // Says so: the dot is inside a `$switch`, and a switch with a second branch would put one on
    // Every tab in the strip.
    expect(row.querySelector('[part="dirty"]')).toBeNull();
    expect(row.querySelector('[part="close"]')).toBeNull();

    // Both `$switch` wrappers stay in the tree, empty. As flex items they would each take a gap —
    // 8px of dead trailing space on every plain tab, measured in Chrome, with the label visibly
    // Off-centre. `display: contents` means an empty one generates no box at all.
    const wrappers = ['[part="dirty-slot"]', '[part="close-slot"]'].map((part) =>
      row.querySelector(part)!,
    );
    expect(wrappers.every((one) => one.childNodes.length === 0)).toBe(true);
    expect(rules(row).get('& [part="dirty-slot"], & [part="close-slot"]')).toContain(
      "display: contents",
    );
  });

  test("Enter and Space on the close button belong to the button", async () => {
    const { tabs, rows, changes, closes } = await render(
      strip({
        selected: "index",
        tabs: [
          tab("index", "index.page.json", { closable: true }),
          tab("about", "about.page.json", { closable: true }),
        ],
      }),
    );
    const close = rows[0]!.querySelector('[part="close"]') as HTMLButtonElement;
    // The close button is a tab stop whenever its tab is current, so a keyboard reaches it in one
    // Press. If the strip answers Enter and Space there — selecting the tab and cancelling the
    // Default — the button is a focusable control no keyboard can operate, which is the whole of
    // WCAG 2.1.1. The strip must step aside and let the platform's own button activation run.
    close.focus();
    expect(document.activeElement).toBe(close);
    for (const name of ["Enter", " "]) {
      const event = key(tabs, name);
      expect(event.target, name).toBe(close);
      expect(event.defaultPrevented, name).toBe(false);
    }
    expect(changes).toEqual([]);
    expect(closes).toEqual([]);

    // And the pointer's path still closes, from the same button.
    close.click();
    expect(closes).toEqual(["index"]);
  });

  test("an arrow pressed inside a tab moves on from THAT tab", async () => {
    const { tabs, rows } = await render(
      strip({
        activation: "manual",
        selected: "content",
        tabs: [
          tab("design", "Design"),
          tab("content", "Content", { closable: true }),
          tab("logic", "Logic"),
        ],
      }),
    );
    const close = rows[1]!.querySelector('[part="close"]') as HTMLButtonElement;
    close.focus();
    // Focus genuinely reaches a tab's descendant, so the active tab is the one that CONTAINS the
    // Key's target. Resolving only exact targets would send the caret back to the first tab.
    key(tabs, "ArrowRight");
    expect(carets(rows)).toEqual(["-1", "-1", "0"]);
  });

  test("a consumer child written into a tab is not swallowed into the close button", async () => {
    const doc = {
      tagName: "div",
      children: [
        {
          tagName: "jx-tabs",
          attributes: { label: "Docs", selected: "index" },
          children: [
            {
              tagName: "jx-tab",
              attributes: { value: "index", label: "index.page.json", closable: "" },
              children: [{ tagName: "b", textContent: "stray" }],
            },
          ],
        },
      ],
    } as unknown as JxDocument;
    const { rows } = await render(doc);
    const close = rows[0]!.querySelector('[part="close"]')!;
    expect(close.querySelector("b")).toBeNull();
    expect(rows[0]!.querySelector('[part="label"]')!.textContent).toBe("index.page.json");
  });

  test("clicking close dispatches close and does NOT select the tab", async () => {
    const { rows, closes, changes, tabs } = await render(
      strip({
        selected: "about",
        tabs: [
          tab("index", "index.page.json", { closable: true }),
          tab("about", "about.page.json"),
        ],
      }),
    );
    const close = rows[0]!.querySelector('[part="close"]') as HTMLButtonElement;
    close.click();
    expect(closes).toEqual(["index"]);
    expect(changes).toEqual([]);
    expect(tabs.selected).toBe("about");
    // The button is out of the tab order until its own tab is the current one.
    expect(close.getAttribute("tabindex")).toBe("-1");
    tabs.selected = "index";
    expect(close.getAttribute("tabindex")).toBe("0");
  });
});

describe("jx-tab-panel", () => {
  test("hidden is declared in attributes, and actually hides the panel", async () => {
    const doc = {
      tagName: "div",
      children: [
        {
          tagName: "jx-tab-panel",
          attributes: { id: "p-design", labelledby: "tab-design", active: "${true}" },
          children: [{ tagName: "p", textContent: "Design" }],
        },
        {
          tagName: "jx-tab-panel",
          attributes: { id: "p-content", labelledby: "tab-content" },
          children: [{ tagName: "p", textContent: "Content" }],
        },
      ],
    } as unknown as JxDocument;
    const host = document.createElement("div");
    document.body.append(host);
    ({ dispose } = await mount(doc, host));
    await flush();
    const [shown, gone] = [...host.querySelectorAll("jx-tab-panel")] as PanelEl[];
    expect(shown!.getAttribute("role")).toBe("tabpanel");
    expect(shown!.getAttribute("tabindex")).toBe("0");
    expect(shown!.getAttribute("aria-labelledby")).toBe("tab-design");
    expect(shown!.hasAttribute("hidden")).toBe(false);
    expect(gone!.hasAttribute("hidden")).toBe(true);

    // A root-level `hidden` key is silently ignored — `defineElement` never runs `applyProperties`
    // On the host — so the binding must live in `attributes`, and this is what says it does.
    const def = documents["jx-tab-panel"]!;
    expect(def.attributes!["hidden"]).toEqual({ $ref: "#/state/notActive" });
    expect((def as { hidden?: unknown }).hidden).toBeUndefined();

    gone!.active = true;
    expect(gone!.hasAttribute("hidden")).toBe(false);
    shown!.active = false;
    expect(shown!.hasAttribute("hidden")).toBe(true);
  });

  test("a panel with no tab to name it carries no aria-labelledby at all", async () => {
    const doc = {
      tagName: "div",
      children: [{ tagName: "jx-tab-panel", attributes: { active: "${true}" } }],
    } as unknown as JxDocument;
    const host = document.createElement("div");
    document.body.append(host);
    ({ dispose } = await mount(doc, host));
    await flush();
    // An empty `aria-labelledby` is an empty IDREF list, not an absent one: it says "named by
    // These elements" and then names none, which is worse than saying nothing.
    const panel = host.querySelector("jx-tab-panel")!;
    expect(panel.hasAttribute("aria-labelledby")).toBe(false);
    expect(panel.getAttribute("role")).toBe("tabpanel");
  });

  test("the panel declares its own display, so it also says what hidden means to it", async () => {
    const doc = {
      tagName: "div",
      children: [{ tagName: "jx-tab-panel", attributes: { active: "${true}" } }],
    } as unknown as JxDocument;
    const host = document.createElement("div");
    document.body.append(host);
    ({ dispose } = await mount(doc, host));
    await flush();
    const emitted = rules(host.querySelector<HTMLElement>("jx-tab-panel")!);
    expect(emitted.get("&")).toContain("display: block");
    expect(emitted.get("&[hidden]")).toContain("display: none");
  });
});
