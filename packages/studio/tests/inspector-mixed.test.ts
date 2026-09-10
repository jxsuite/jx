/**
 * Mixed values across a multi-selection, in all three inspector tabs (§6.5, P5 item 2).
 *
 * Mixed is a fifth state of the SAME provenance chip workstreams A and C built, not a fifth widget.
 * Two things are asserted everywhere:
 *
 * 1. **A selection of one renders no Mixed state anywhere.** There is no second value to disagree
 *    with, so every row keeps the exact chip it had before the selection became a list.
 * 2. **A commit reaches every selected element, in ONE transaction** — one undo step for one decision,
 *    which is what makes "set padding on six cards" a thing you can take back.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as storeActual from "../src/store";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import type { JxMutableNode } from "@jxsuite/schema/types";

void mock.module("../src/store", () => ({
  ...storeActual,
  debouncedStyleCommit:
    <A extends unknown[]>(_prop: string, _ms: number, fn: (...args: A) => void) =>
    (...args: A) =>
      fn(...args),
}));
void mock.module("../src/panels/stylebook-panel", () => ({ selectStylebookTag: () => {} }));
void mock.module("../src/commands/active-registry", () => ({
  activeRegistry: () => ({ run: () => {} }),
}));

const { bindStyleHost } = await import("../src/panels/style-panel");
const { bindContentHost, renderPropertiesPanel } = await import("../src/panels/properties-panel");
const { bindLogicPanelHost } = await import("../src/panels/events-panel");
const { initCssData } = await import("../src/panels/style-utils");
const { initLayers } = await import("../src/ui/layers");
const { getNodeAtPath } = await import("../src/store");

(globalThis as Record<string, unknown>).requestAnimationFrame ??= (cb: (t: number) => void) =>
  setTimeout(() => cb(0), 0);

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

const A = ["children", 0];
const B = ["children", 1];

/** Two images that disagree twice over: their aspect ratio and their alt text. */
function twoCards(): JxMutableNode {
  return {
    children: [
      { attributes: { alt: "one" }, style: { aspectRatio: "1/1" }, tagName: "img" },
      { attributes: { alt: "two" }, style: { aspectRatio: "16/9" }, tagName: "img" },
    ],
    tagName: "div",
  } as unknown as JxMutableNode;
}

/** The same two, agreeing about everything. */
function twoIdenticalCards(): JxMutableNode {
  return {
    children: [
      { attributes: { alt: "same" }, style: { aspectRatio: "1/1" }, tagName: "img" },
      { attributes: { alt: "same" }, style: { aspectRatio: "1/1" }, tagName: "img" },
    ],
    tagName: "div",
  } as unknown as JxMutableNode;
}

function setup(doc: JxMutableNode, selection: (string | number)[][]) {
  resetStudioState();
  const tab = resetWorkspaceWithTab(doc);
  tab.session.selection = selection;
  return tab;
}

function node(path: (string | number)[]): JxMutableNode {
  return getNodeAtPath(activeTab.value!.doc.document, path);
}

const styleRow = (c: HTMLElement, prop: string) =>
  c.querySelector(`[part="row"][data-prop="${prop}"]`) as HTMLElement | null;
const contentRow = (c: HTMLElement, prop: string) =>
  c.querySelector(`[data-prop="${prop}"]`) as HTMLElement | null;
const chip = (row: HTMLElement | null) => row?.querySelector('[part="chip"]') as HTMLElement | null;

/** The state a chip is in. A document says such things with data, not with a class. */
const chipState = (row: HTMLElement | null) => chip(row)?.dataset.state ?? "";

/** A row's own control — a kit field's native input, wherever the row puts one. */
const control = (row: HTMLElement | null, part = "text") =>
  row?.querySelector(`[part="${part}"] [part="input"]`) as HTMLInputElement;

/**
 * The Style tab is a mounted Jx document too, bound to a host rather than rendered into one, and it
 * keeps itself current — so a test binds once and the effect answers every later change.
 */
let styleHost: HTMLElement | null = null;
async function renderStyle(): Promise<HTMLElement> {
  if (!styleHost) {
    styleHost = document.createElement("div");
    document.body.append(styleHost);
  }
  bindStyleHost(styleHost, { getCanvasMode: () => "edit" });
  await flush(4);
  return styleHost;
}

/**
 * The Content tab is a mounted Jx document, so it is bound to a host rather than rendered into one.
 *
 * Its chip is `[part="chip"]` carrying `data-state`, not `.provenance-chip--mixed`: the state is a
 * fact about the row's value and a document says such things with data. The vocabulary is
 * `panels/provenance.ts`'s either way, which is what the assertions here are about.
 */
let contentHost: HTMLElement | null = null;
async function renderContent(): Promise<HTMLElement> {
  if (!contentHost) {
    contentHost = document.createElement("div");
    document.body.append(contentHost);
    bindContentHost(contentHost);
  }
  renderPropertiesPanel();
  await flush(6);
  return contentHost;
}
const contentChip = (c: HTMLElement, prop: string) =>
  contentRow(c, prop)?.querySelector('[part="chip"]') as HTMLElement | null;
/**
 * The Logic tab is a mounted Jx document too, bound to a host the Inspector owns for the life of
 * the window rather than rendered into one.
 *
 * Its Mixed state is `[part="dot"]` carrying `data-state`, not `.provenance-chip--mixed`: the state
 * is a fact about the row's value and a document says such things with data. And there is ONE
 * control that clears a binding now, where there used to be a chip and a trash button doing the
 * same thing beside each other (§12.5).
 */
let logicHost: HTMLElement | null = null;
async function renderLogic(): Promise<HTMLElement> {
  if (!logicHost) {
    logicHost = document.createElement("div");
    document.body.append(logicHost);
  }
  bindLogicPanelHost(logicHost);
  await flush(6);
  return logicHost;
}

/** The binding row for one event key. */
const eventRow = (c: HTMLElement, key: string) =>
  c.querySelector(`[data-event="${key}"][part="binding"]`) as HTMLElement;

/** Its clear control's dot, which is where `set` / `mixed` lands. */
const eventDot = (c: HTMLElement, key: string) =>
  eventRow(c, key).querySelector('[part="event-clear"] [part="dot"]') as HTMLElement;

beforeEach(() => {
  installMockPlatform();
  initCssData({ cssProps: [["aspect-ratio", "auto"]] });
});

afterEach(() => {
  bindContentHost(null);
  contentHost?.remove();
  contentHost = null;
  bindLogicPanelHost(null);
  logicHost?.remove();
  logicHost = null;
  bindStyleHost(null);
  styleHost?.remove();
  styleHost = null;
  closeAllTabs();
});

// ─── Style ───────────────────────────────────────────────────────────────────

describe("Style tab", () => {
  test("one selected element renders the ordinary set chip, never Mixed", async () => {
    setup(twoCards(), [A]);
    const c = await renderStyle();
    expect(chipState(styleRow(c, "aspectRatio"))).toBe("set");
  });

  test("two elements that disagree render Mixed, naming how many", async () => {
    setup(twoCards(), [A, B]);
    const c = await renderStyle();
    const dot = chip(styleRow(c, "aspectRatio"))!;
    expect(dot.dataset.state).toBe("mixed");
    expect(dot.textContent!.trim()).toBe("mixed (2)");
    expect(dot.getAttribute("title")).toContain("different values for aspectRatio");
  });

  test("two elements that agree are not Mixed — they are simply set", async () => {
    setup(twoIdenticalCards(), [A, B]);
    const c = await renderStyle();
    expect(chipState(styleRow(c, "aspectRatio"))).toBe("set");
  });

  test("typing into a Mixed field sets every selected element, in ONE undo step", async () => {
    const tab = setup(twoCards(), [A, B]);
    const before = tab.history.index;
    const c = await renderStyle();
    const field = control(styleRow(c, "aspectRatio"));
    field.value = "4/3";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);
    expect(node(A).style!.aspectRatio).toBe("4/3");
    expect(node(B).style!.aspectRatio).toBe("4/3");
    expect(tab.history.index).toBe(before + 1);
  });

  test("clearing a Mixed field clears it from every selected element, in one step", async () => {
    const tab = setup(twoCards(), [A, B]);
    const before = tab.history.index;
    const c = await renderStyle();
    chip(styleRow(c, "aspectRatio"))!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await flush(2);
    expect(node(A).style?.padding).toBeUndefined();
    expect(node(B).style?.padding).toBeUndefined();
    expect(tab.history.index).toBe(before + 1);
  });
});

// ─── Style: shorthands ───────────────────────────────────────────────────────

/**
 * Shorthands were the one Style row that never learned either half of §6.5.
 *
 * `padding`, `margin` and `border` are `$shorthand: true`, and "you can set padding on six cards in
 * one decision" is the literal sentence the plan makes — with padding as its example. The row wrote
 * to the primary element only, for the header field AND for every longhand child, and drew a plain
 * "Clear padding" dot over a property `mixedStyleProps` had already computed as mixed.
 */
function twoSections(styles: [JxMutableNode["style"], JxMutableNode["style"]]): JxMutableNode {
  return {
    children: [
      { style: styles[0], tagName: "section" },
      { style: styles[1], tagName: "section" },
    ],
    tagName: "div",
  } as unknown as JxMutableNode;
}

const shorthandField = (c: HTMLElement, prop: string) => control(styleRow(c, prop));

describe("Style tab — shorthand rows", () => {
  test("typing a shorthand writes it to EVERY selected element, in ONE undo step", async () => {
    const tab = setup(twoSections([{ padding: "4px" }, { padding: "20px" }]), [A, B]);
    const before = tab.history.index;
    const c = await renderStyle();
    const field = shorthandField(c, "padding");
    field.value = "12px";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(2);
    expect(node(A).style!.padding).toBe("12px");
    expect(node(B).style!.padding).toBe("12px");
    expect(tab.history.index).toBe(before + 1);
  });

  test("a shorthand the selection disagrees about says Mixed, not 'clear'", async () => {
    setup(twoSections([{ padding: "4px" }, { padding: "20px" }]), [A, B]);
    const c = await renderStyle();
    const dot = chip(styleRow(c, "padding"))!;
    expect(dot.dataset.state).toBe("mixed");
    expect(dot.textContent!.trim()).toBe("mixed (2)");
    // The plain clear dot is what the row used to offer INSTEAD of saying so.
    expect(dot.dataset.state).not.toBe("set");
  });

  test("a shorthand is Mixed when the selection disagrees about one of its longhands", async () => {
    setup(twoSections([{ paddingTop: "4px" }, { paddingTop: "9px" }]), [A, B]);
    const c = await renderStyle();
    expect(chip(styleRow(c, "padding"))!.textContent!.trim()).toBe("mixed (2)");
    // And so is the child row the disagreement is actually about.
    expect(chip(styleRow(c, "paddingTop"))!.textContent!.trim()).toBe("mixed (2)");
  });

  test("a shorthand the selection agrees about is simply set", async () => {
    setup(twoSections([{ padding: "4px" }, { padding: "4px" }]), [A, B]);
    const c = await renderStyle();
    expect(chipState(styleRow(c, "padding"))).toBe("set");
  });

  // The rows show the PRIMARY element's values — `primarySelection` is the last path selected — so
  // The four child rows are filled by B's shorthand, and the edit lands on both elements.
  test("editing a longhand child recompresses the shorthand on every element", async () => {
    const tab = setup(twoSections([{ padding: "9px" }, { padding: "1px 2px 3px 4px" }]), [A, B]);
    tab.session.ui.styleShorthands = { padding: true };
    const before = tab.history.index;
    const c = await renderStyle();
    const child = control(styleRow(c, "paddingTop"));
    child.value = "7px";
    child.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);
    expect(node(A).style!.padding).toBe("7px 2px 3px 4px");
    expect(node(B).style!.padding).toBe("7px 2px 3px 4px");
    expect(tab.history.index).toBe(before + 1);
  });

  test("clearing a Mixed shorthand clears it, and its longhands, everywhere", async () => {
    const tab = setup(twoSections([{ padding: "4px" }, { paddingLeft: "20px" }]), [A, B]);
    const before = tab.history.index;
    const c = await renderStyle();
    chip(styleRow(c, "padding"))!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await flush(2);
    expect(node(A).style).toBeUndefined();
    expect(node(B).style).toBeUndefined();
    expect(tab.history.index).toBe(before + 1);
  });

  test("a section's clear-all dot clears the section on every selected element", async () => {
    const tab = setup(twoSections([{ padding: "4px" }, { padding: "4px" }]), [A, B]);
    const before = tab.history.index;
    const c = await renderStyle();
    c.querySelector(
      '[part="section"][data-section="spacing"] [part="dot"][data-clear="spacing"]',
    )!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush(2);
    expect(node(A).style).toBeUndefined();
    expect(node(B).style).toBeUndefined();
    expect(tab.history.index).toBe(before + 1);
  });

  test("renaming a custom property renames it on every element, keeping each value", async () => {
    const tab = setup(twoSections([{ "--brand": "red" }, { "--brand": "blue" }]), [A, B]);
    const before = tab.history.index;
    const c = await renderStyle();
    const key = control(styleRow(c, "--brand"), "kv-key");
    key.value = "--accent";
    key.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);
    expect(node(A).style).toEqual({ "--accent": "red" });
    expect(node(B).style).toEqual({ "--accent": "blue" });
    expect(tab.history.index).toBe(before + 1);
  });
});

// ─── Content ─────────────────────────────────────────────────────────────────

describe("Content tab", () => {
  test("one selected element renders the ordinary set chip on an attribute row", async () => {
    setup(twoCards(), [A]);
    const c = await renderContent();
    expect(contentChip(c, "alt")?.dataset.state).toBe("set");
  });

  test("two elements with different alt text render Mixed", async () => {
    setup(twoCards(), [A, B]);
    const c = await renderContent();
    const dot = contentChip(c, "alt")!;
    expect(dot.dataset.state).toBe("mixed");
    expect(dot.textContent!.trim()).toBe("mixed (2)");
  });

  test("two elements with the same alt text are not Mixed", async () => {
    setup(twoIdenticalCards(), [A, B]);
    const c = await renderContent();
    expect(contentChip(c, "alt")!.dataset.state).not.toBe("mixed");
  });

  test("clearing a Mixed attribute clears it everywhere, in ONE undo step", async () => {
    const tab = setup(twoCards(), [A, B]);
    const before = tab.history.index;
    const c = await renderContent();
    contentChip(c, "alt")!.click();
    await flush();
    expect(node(A).attributes?.alt).toBeUndefined();
    expect(node(B).attributes?.alt).toBeUndefined();
    expect(tab.history.index).toBe(before + 1);
  });
});

// ─── Logic ───────────────────────────────────────────────────────────────────

/** Two buttons whose click handlers differ, so the event row has something to disagree about. */
function twoButtons(sameHandler: boolean): JxMutableNode {
  return {
    children: [
      { onclick: { $ref: "#/state/go" }, tagName: "button" },
      { onclick: { $ref: sameHandler ? "#/state/go" : "#/state/stop" }, tagName: "button" },
    ],
    state: {
      go: { $prototype: "Function", body: "", parameters: [] },
      stop: { $prototype: "Function", body: "", parameters: [] },
    },
    tagName: "div",
  } as unknown as JxMutableNode;
}

describe("Logic tab", () => {
  test("one selected element renders the ordinary set dot on its event row", async () => {
    setup(twoButtons(false), [A]);
    const c = await renderLogic();
    expect(eventDot(c, "onclick").dataset.state).toBe("set");
    expect(eventDot(c, "onclick").getAttribute("tone")).toBeNull();
  });

  test("two elements bound to different handlers render Mixed on that event", async () => {
    setup(twoButtons(false), [A, B]);
    const c = await renderLogic();
    expect(eventDot(c, "onclick").dataset.state).toBe("mixed");
    expect(
      eventRow(c, "onclick")
        .querySelector('[part="event-clear"] [part="control"]')!
        .getAttribute("aria-label"),
    ).toContain("bind onclick differently");
  });

  test("two elements bound to the same handler are not Mixed", async () => {
    setup(twoButtons(true), [A, B]);
    const c = await renderLogic();
    expect(eventDot(c, "onclick").dataset.state).toBe("set");
  });

  test("clearing an event removes it from every selected element, in ONE undo step", async () => {
    const tab = setup(twoButtons(false), [A, B]);
    const before = tab.history.index;
    const c = await renderLogic();
    pointer(
      eventRow(c, "onclick").querySelector('[part="event-clear"] [part="control"]')!,
      "click",
    );
    await flush(4);
    expect(node(A).onclick).toBeUndefined();
    expect(node(B).onclick).toBeUndefined();
    expect(tab.history.index).toBe(before + 1);
  });

  test("changing the Value Source rung rewires every selected element in one step", async () => {
    const tab = setup(twoButtons(false), [A, B]);
    const before = tab.history.index;
    const c = await renderLogic();
    pointer(
      eventRow(c, "onclick").querySelector('[part="event-source"] [part="control"]')!,
      "click",
    );
    await flush(6);
    const menu = document.querySelector('[data-jx-region="overlay.menu:value-source"] jx-menu')!;
    menu.querySelector<HTMLElement>('[data-command-id="function"]')!.click();
    await flush(4);
    expect((node(A).onclick as Record<string, unknown>).$prototype).toBe("Function");
    expect((node(B).onclick as Record<string, unknown>).$prototype).toBe("Function");
    expect(tab.history.index).toBe(before + 1);
  });
});
