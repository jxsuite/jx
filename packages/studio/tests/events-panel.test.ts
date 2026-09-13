/**
 * Tests for the Inspector's **Logic** tab: `src/panels/events-panel.ts`, the flow, and
 * `src/surfaces/logic-panel.json`, the document it mounts.
 *
 * Events were always here. Repeating list, Condition, Observed Attributes, CSS Properties and CSS
 * Parts arrived from the Content tab in P5 (§6.5): wiring a `$switch` and wiring a click handler
 * are the same task, and they were two tabs apart.
 *
 * Everything is addressed by `part`, by `data-prop`, by `data-section` and by role, because the tab
 * is a document: there is no `sp-picker.event-mode`, no `.provenance-chip` and no `.style-row` to
 * find any more. Every mount is awaited — a document settles when it has rendered, and a kit
 * element's own template is one `connectedCallback` after that.
 *
 * Two seams the conversion moved, both asserted below:
 *
 * - **The tab owns its container.** `right-panel.ts` hands it over once and never renders into it
 *   again, so a test binds the host itself rather than rendering a template.
 * - **`isCustomElementDoc` is not injected any more.** It is `document.tagName.includes("-")` and
 *   nothing else, so a test states it by giving the document a hyphenated tag — one source of truth
 *   instead of a helper a caller could disagree with.
 */
import { answerPromptDialog, flush, installMockPlatform, pointer } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { JxMutableNode } from "@jxsuite/schema/types";

type AnyRec = Record<string, any>;

/**
 * The rung picker, the event-name list and the add-statement list are all the kit's MENU now — one
 * list of actions rather than three private popovers (§12.5). It is a settled surface, so what is
 * asserted here is what it is OFFERED and what a pick commits.
 */
const menus: AnyRec[] = [];
void mock.module("../src/surfaces/menu", () => ({
  openMenu: (options: AnyRec) => {
    menus.push(options);
    return { close: () => {} };
  },
}));

installMockPlatform();

const { activeTab, closeAllTabs } = await import("../src/workspace/workspace");
const { getNodeAtPath } = await import("../src/store");
const { initLayers } = await import("../src/ui/layers");
const { resetSlotModeMemory } = await import("../src/ui/dynamic-slot");
const { resetWorkspaceWithTab } = await import("./harness");
const { EVENT_NAMES, bindLogicPanelHost } = await import("../src/panels/events-panel");

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeDoc(tagName = "div"): JxMutableNode {
  return {
    children: [
      {
        onchange: { $ref: "#/state/handleClick" },
        onclick: { $prototype: "Function", body: "doIt()", parameters: [] },
        onfocus: "not-a-binding",
        oninput: { $expression: { operator: "=", target: null } },
        tagName: "button",
        textContent: "B",
      },
      { tagName: "p", textContent: "plain" },
    ],
    state: {
      handleClick: {
        $prototype: "Function",
        body: "console.log(1)",
        emits: [
          { description: "Save happened", name: "save", type: { text: "CustomEvent" } },
          { name: "" },
        ],
        parameters: [],
      },
      legacyHandler: { $handler: "x" },
    },
    tagName,
  } as unknown as JxMutableNode;
}

// ─── Mounting ────────────────────────────────────────────────────────────────

let host: HTMLElement | null = null;

afterEach(() => {
  bindLogicPanelHost(null);
  host?.remove();
  host = null;
  menus.length = 0;
});

/**
 * Open the tab over a document, into an ATTACHED container of its own.
 *
 * The container is the one `right-panel.ts` builds and hands over once; nothing renders into it
 * again, which is exactly why the tab does not go through the dock's scheduler.
 */
async function logic(
  doc: JxMutableNode,
  selection: (string | number)[][] = [["children", 0]],
): Promise<HTMLElement> {
  const tab = resetWorkspaceWithTab(doc);
  tab.session.selection = selection as never;
  host = document.createElement("div");
  document.body.append(host);
  bindLogicPanelHost(host);
  await flush(6);
  return host;
}

/** Let a commit travel back through the watcher and the document's own bindings. */
const settle = () => flush(4);

function selectedNode(): Record<string, unknown> {
  const tab = activeTab.value!;
  return getNodeAtPath(tab.doc.document, tab.session.selection.at(-1)!) as Record<string, unknown>;
}

function docNow(): Record<string, any> {
  return activeTab.value!.doc.document as unknown as Record<string, any>;
}

/** Press a kit control the way a reader does: the click lands on the button inside it. */
function press(el: Element | null): void {
  expect(el).toBeTruthy();
  pointer(el!.querySelector('[part="control"]') ?? el!, "click");
}

/** Commit a control: the value is set and `change` fires, as a blur or a pick does. */
function commit(el: Element | null, value: string): void {
  const input = el!.querySelector('[part="input"], [part="control"]') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Type into a control: it reports, and the event bubbles to the element that owns the handler. */
function type(el: Element | null, value: string): void {
  const input = el!.querySelector('[part="input"]') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Which half of the body toggle is chosen.
 *
 * The pair is a RADIO group, not two toggles: the representation of a handler's body is a fact
 * about the document, so the buttons draw it and the flow decides it. `aria-checked` is where that
 * lands, and it is also what a screen reader hears.
 */
function checkedState(root: Element, part: string): string | null {
  return root.querySelector(`[part="${part}"] [part="control"]`)!.getAttribute("aria-checked");
}

const section = (root: Element, id: string) =>
  root.querySelector(`[data-section="${id}"]`) as HTMLElement | null;

const binding = (root: Element, key: string) =>
  root.querySelector(`[data-event="${key}"][part="binding"]`) as HTMLElement | null;

const row = (root: Element, prop: string) =>
  root.querySelector(`[data-prop="${prop}"]`) as HTMLElement | null;

/** Open a menu from a chip and run one of its rows. */
async function pick(chip: Element | null, id: string): Promise<void> {
  press(chip);
  menus.at(-1)!.run(id);
  await settle();
}

/** Open a section the way a reader does — through the details element the kit renders. */
async function openSection(item: HTMLElement, open: boolean): Promise<void> {
  const details = item.querySelector('[part="details"]') as HTMLDetailsElement;
  details.open = open;
  details.dispatchEvent(new Event("toggle"));
  await settle();
}

// ─── Empty states ────────────────────────────────────────────────────────────

describe("Logic tab — empty states", () => {
  test("no document open teaches how to get one, and offers it", async () => {
    /* The dock used to draw this itself, into each tab's container. It cannot any more: the
       container belongs to a mounted document. So the tab says its own words, which it should have
       all along, because "open a page" and "click something" are not the same instruction. */
    const c = await logic(makeDoc(), []);
    closeAllTabs();
    await settle();
    expect(c.querySelector('[part="empty-message"]')!.textContent).toContain("Open a page");
    expect(c.querySelector('[part="empty-action"]')!.textContent).toContain("Open a page…");
  });

  test("no selection shows the prompt", async () => {
    const c = await logic(makeDoc(), []);
    expect(c.querySelector('[part="empty-message"]')!.textContent).toContain(
      "Click anything on the canvas to wire it up.",
    );
  });

  test("a selection pointing at a missing node shows not-found", async () => {
    const c = await logic(makeDoc(), [["children", 9]]);
    expect(c.querySelector('[part="empty-message"]')!.textContent).toContain(
      "no longer on the page",
    );
  });
});

// ─── Bindings ────────────────────────────────────────────────────────────────

describe("Logic tab — rendering bindings", () => {
  test("one binding row per on* key with a valid binding", async () => {
    const c = await logic(makeDoc());
    // `onfocus` is a bare string, not a binding — excluded
    expect(c.querySelectorAll('[part="binding"]')).toHaveLength(3);
    expect(c.textContent).toContain("Event Bindings");
  });

  test("an inline function body renders the code field with its text", async () => {
    const c = await logic(makeDoc());
    const field = binding(c, "onclick")!.querySelector('[part="body-field"]')!;
    expect((field.querySelector('[part="input"]') as HTMLInputElement).value).toBe("doIt()");
  });

  test("a formula body is an ISLAND filled with the expression editor", async () => {
    const c = await logic(makeDoc());
    const island = binding(c, "oninput")!.querySelector('[part="expression-host"]') as HTMLElement;
    expect(island).toBeTruthy();
    // The document renders the host node and NOTHING inside it; the flow MOUNTS its own document
    // Into it — the editor is a surface of its own now, not a lit template rendered beside one.
    expect(island.querySelector('[part="expression"]')).toBeTruthy();
  });

  test("a ref body renders the handler select with the current ref and every function def", async () => {
    const c = await logic(makeDoc());
    const select = binding(c, "onchange")!.querySelector('[part="event-handler"]')!;
    expect((select.querySelector('[part="control"]') as HTMLSelectElement).value).toBe(
      "#/state/handleClick",
    );
    const labels = [...select.querySelectorAll('[part="option"] [part="text"]')].map(
      (o) => o.textContent,
    );
    expect(labels).toContain("— none —");
    expect(labels).toContain("handleClick");
    expect(labels).toContain("legacyHandler");
  });

  test("declared events are hidden for a plain document", async () => {
    const c = await logic(makeDoc());
    expect(c.querySelector('[part="declared-row"]')).toBeNull();
  });

  test("declared events are listed for a custom element document", async () => {
    const c = await logic(makeDoc("my-widget"));
    const rows = c.querySelectorAll('[part="declared-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("save");
    expect(rows[0]!.textContent).toContain("← handleClick");
    expect(rows[0]!.textContent).toContain("CustomEvent");
    // The second emit has no name and no type
    expect(rows[1]!.textContent).toContain("(unnamed)");
    expect(rows[1]!.querySelector('[part="event-type"]')!.hasAttribute("hidden")).toBe(true);
  });
});

// ─── Editing bindings ────────────────────────────────────────────────────────

describe("Logic tab — editing bindings", () => {
  test("renaming an event moves the binding to the new key", async () => {
    const c = await logic(makeDoc());
    await pick(binding(c, "onchange")!.querySelector('[part="event-name"]'), "onkeydown");
    expect(selectedNode().onchange).toBeUndefined();
    expect(selectedNode().onkeydown).toEqual({ $ref: "#/state/handleClick" });
  });

  test("renaming to the same key is a no-op", async () => {
    const c = await logic(makeDoc());
    await pick(binding(c, "onchange")!.querySelector('[part="event-name"]'), "onchange");
    expect(selectedNode().onchange).toEqual({ $ref: "#/state/handleClick" });
  });

  test("the name menu suggests this element's own keys and the ten worth offering", async () => {
    const c = await logic(makeDoc());
    press(binding(c, "onchange")!.querySelector('[part="event-name"]'));
    const rows = menus.at(-1)!.rows as AnyRec[];
    // Already bound first, then the suggestions, then the escape hatch — and no duplicates.
    expect(rows.slice(0, 3).map((r) => r.id)).toEqual(["onchange", "onclick", "oninput"]);
    expect(rows.map((r) => r.id)).toContain("onmouseleave");
    expect(rows.at(-1)!.id).toBe("__custom__");
    expect(rows.at(-1)!.dividerAbove).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    // The current key is the checked row.
    expect(rows.find((r) => r.id === "onchange")!.checked).toBe("true");
  });

  test("an event NOT in the suggestion list can still be bound — the point of the field", async () => {
    /* Ten names in a closed picker meant `ondragover`, `onpointerdown`, `onwheel` and every custom
       event a component emits were unbindable from the Inspector. §6.5 asks for a free-form field
       instead of a hard-coded list of ten; the list is a list of SUGGESTIONS, and its last row asks
       for any other name. */
    const c = await logic(makeDoc());
    press(binding(c, "onchange")!.querySelector('[part="event-name"]'));
    (menus.at(-1)!.rows as AnyRec[]).at(-1)!.run();
    await flush(6);
    await answerPromptDialog("onpointerdown");
    await settle();
    expect(selectedNode().onchange).toBeUndefined();
    expect(selectedNode().onpointerdown).toEqual({ $ref: "#/state/handleClick" });
  });

  test("…and a name that is not an event handler is refused", async () => {
    // Free-form is not unchecked: the field states the shape itself rather than writing `class` or
    // `Hello there` onto the element as a binding.
    const c = await logic(makeDoc());
    press(binding(c, "onchange")!.querySelector('[part="event-name"]'));
    (menus.at(-1)!.rows as AnyRec[]).at(-1)!.run();
    await flush(6);
    await answerPromptDialog("class");
    await settle();
    expect(selectedNode().onchange).toEqual({ $ref: "#/state/handleClick" });
    expect(selectedNode().class).toBeUndefined();
  });

  test("the rung picker speaks the one Value Source vocabulary", async () => {
    /* It used to read Inline code / Expression / Existing function — a private dialect for the
       ladder every other row in the inspector names Fixed value / From data… / Formula. */
    const c = await logic(makeDoc());
    press(binding(c, "onchange")!.querySelector('[part="event-source"]'));
    const rows = menus.at(-1)!.rows as AnyRec[];
    expect(rows.map((r) => r.id)).toEqual(["ref", "expression", "function"]);
    expect(rows.map((r) => r.title)).toEqual(["From data…", "Formula", "Inline function"]);
  });

  test("the chip names the rung the handler is on", async () => {
    const c = await logic(makeDoc());
    expect(binding(c, "onchange")!.querySelector('[part="event-source"]')!.textContent).toContain(
      "From data…",
    );
    expect(binding(c, "oninput")!.querySelector('[part="event-source"]')!.textContent).toContain(
      "Formula",
    );
  });

  test("switching to Formula replaces the value with an expression def", async () => {
    const c = await logic(makeDoc());
    await pick(binding(c, "onchange")!.querySelector('[part="event-source"]'), "expression");
    expect(selectedNode().onchange).toEqual({ $expression: { operator: "=", target: null } });
  });

  test("switching to Inline function replaces the value with an empty function def", async () => {
    const c = await logic(makeDoc());
    await pick(binding(c, "oninput")!.querySelector('[part="event-source"]'), "function");
    expect(selectedNode().oninput).toEqual({ $prototype: "Function", body: "", parameters: [] });
  });

  test("switching to From data… uses the first function def", async () => {
    const c = await logic(makeDoc());
    await pick(binding(c, "onclick")!.querySelector('[part="event-source"]'), "ref");
    expect(selectedNode().onclick).toEqual({ $ref: "#/state/handleClick" });
  });

  test("switching a handler away and back restores the body it left", async () => {
    resetSlotModeMemory();
    const c = await logic(makeDoc());
    await pick(binding(c, "onclick")!.querySelector('[part="event-source"]'), "expression");
    expect(selectedNode().onclick).toEqual({ $expression: { operator: "=", target: null } });
    await pick(binding(c, "onclick")!.querySelector('[part="event-source"]'), "function");
    expect((selectedNode().onclick as { body: unknown }).body).toBe("doIt()");
  });

  test("switching to From data… with no function defs uses an empty ref", async () => {
    const c = await logic({
      children: [{ onclick: { $prototype: "Function", body: "x()" }, tagName: "button" }],
      tagName: "div",
    } as unknown as JxMutableNode);
    await pick(binding(c, "onclick")!.querySelector('[part="event-source"]'), "ref");
    expect(selectedNode().onclick).toEqual({ $ref: "" });
  });

  test("ONE control clears a binding, and it carries the dot", async () => {
    /* The provenance chip cleared the key and the trash button beside it cleared the same key —
       two controls for one act, which §12.5 calls a defect. */
    const c = await logic(makeDoc());
    const clear = binding(c, "onchange")!.querySelector('[part="event-clear"]')!;
    expect(clear.querySelector('[part="dot"]')).toBeTruthy();
    expect(binding(c, "onchange")!.querySelectorAll('[part="event-clear"]')).toHaveLength(1);
    press(clear);
    await settle();
    expect(selectedNode().onchange).toBeUndefined();
  });

  test("typing in the inline body updates the function def", async () => {
    const c = await logic(makeDoc());
    type(binding(c, "onclick")!.querySelector('[part="body-field"]'), "save();");
    await settle();
    expect(selectedNode().onclick).toEqual({
      $prototype: "Function",
      body: "save();",
      parameters: [],
    });
  });

  test("open-in-editor sets editingFunction, and the formula body opens the workspace", async () => {
    const c = await logic(makeDoc());
    press(binding(c, "onclick")!.querySelector('[part="open-editor"]'));
    expect(activeTab.value!.session.ui.editingFunction).toEqual({
      eventKey: "onclick",
      path: ["children", 0],
      type: "event",
    });

    press(binding(c, "oninput")!.querySelector('[part="open-editor"]'));
    expect(activeTab.value!.session.ui.editingFormula).toEqual({
      eventKey: "oninput",
      path: ["children", 0],
      type: "event",
    });
  });

  test("the handler select sets a new ref, and its blank row removes the binding", async () => {
    const c = await logic(makeDoc());
    commit(
      binding(c, "onchange")!.querySelector('[part="event-handler"]'),
      "#/state/legacyHandler",
    );
    await settle();
    expect(selectedNode().onchange).toEqual({ $ref: "#/state/legacyHandler" });

    commit(binding(c, "onchange")!.querySelector('[part="event-handler"]'), "");
    await settle();
    expect(selectedNode().onchange).toBeUndefined();
  });

  test("the expression island writes back through $expression", async () => {
    const c = await logic(makeDoc());
    const control = binding(c, "oninput")!.querySelector(
      '[part="expression-host"] [part="operator"] [part="control"]',
    ) as HTMLSelectElement;
    expect(control).toBeTruthy();
    control.value = "push";
    control.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(
      (selectedNode().oninput as { $expression?: { operator?: string } }).$expression?.operator,
    ).toBe("push");
  });
});

// ─── Inline body modes (spec §20) ────────────────────────────────────────────

describe("Logic tab — inline body modes (spec §20)", () => {
  function structuredDoc(body: unknown, extra: Record<string, unknown> = {}): JxMutableNode {
    return {
      children: [
        { onclick: { $prototype: "Function", body, parameters: [], ...extra }, tagName: "button" },
      ],
      tagName: "div",
    } as unknown as JxMutableNode;
  }

  test("a string body is the Code mode: the toggle is there and Code is selected", async () => {
    const c = await logic(makeDoc());
    const b = binding(c, "onclick")!;
    expect(checkedState(b, "body-code")).toBe("true");
    expect(checkedState(b, "body-statements")).toBe("false");
    expect(b.querySelector('[part="body-field"]')).toBeTruthy();
    expect(b.querySelector('[part="statements-host"]')).toBeNull();
  });

  test("switching to Statements replaces the body with an empty array", async () => {
    const c = await logic(makeDoc());
    press(binding(c, "onclick")!.querySelector('[part="body-statements"]'));
    await settle();
    expect(selectedNode().onclick).toEqual({ $prototype: "Function", body: [], parameters: [] });
  });

  test("an array body mounts the statement editor and selects Statements", async () => {
    const c = await logic(structuredDoc([{ dispatchEvent: "ping" }]));
    await flush(4);
    const b = binding(c, "onclick")!;
    expect(checkedState(b, "body-statements")).toBe("true");
    expect(b.querySelector('[part="body-field"]')).toBeNull();
    const island = b.querySelector('[part="statements-host"]') as HTMLElement;
    expect(island).toBeTruthy();
    // The statement editor is a mounted document of its own, named by the handler it edits.
    expect(island.dataset.jxRegion).toBe("inspector/statements:onclick");
    expect(island.querySelector('[part="card"]')).toBeTruthy();
  });

  test("switching back to Code replaces the body with an empty string", async () => {
    const c = await logic(structuredDoc([]));
    press(binding(c, "onclick")!.querySelector('[part="body-code"]'));
    await settle();
    expect(selectedNode().onclick).toEqual({ $prototype: "Function", body: "", parameters: [] });
  });

  test("re-pressing the active mode preserves the existing body", async () => {
    const c = await logic(makeDoc());
    press(binding(c, "onclick")!.querySelector('[part="body-code"]'));
    await settle();
    expect((selectedNode().onclick as { body: string }).body).toBe("doIt()");
  });

  test("statement editor edits write the inline binding through", async () => {
    const c = await logic(structuredDoc([]));
    await flush(4);
    const add = binding(c, "onclick")!.querySelector('[part="add-statement"]')!;
    press(add);
    menus.at(-1)!.run("dispatch");
    await settle();
    expect(selectedNode().onclick).toEqual({
      $prototype: "Function",
      body: [{ dispatchEvent: "" }],
      parameters: [],
    });
  });

  test("dispatch statements offer the inline def's own declared emits", async () => {
    const c = await logic(structuredDoc([{ dispatchEvent: "" }], { emits: [{ name: "saved" }] }));
    await flush(4);
    const select = binding(c, "onclick")!.querySelector(
      '[data-prop="dispatchEvent"] [part="select"]',
    )!;
    expect(select.tagName.toLowerCase()).toBe("jx-select");
    expect(
      [...select.querySelectorAll('[part="option"]')].map((o) => o.getAttribute("value")),
    ).toEqual(["saved"]);
  });
});

// ─── Add event ───────────────────────────────────────────────────────────────

describe("Logic tab — add event", () => {
  test("picks the first unused event name and refs the first function", async () => {
    const c = await logic(makeDoc());
    press(c.querySelector('[part="add-event"]'));
    await settle();
    // Onclick/oninput/onchange taken; onfocus is a plain string (truthy) — onsubmit is next free
    expect(selectedNode().onsubmit).toEqual({ $ref: "#/state/handleClick" });
  });

  test("falls back to onclick + an inline function with no defs", async () => {
    const c = await logic({
      children: [{ tagName: "p", textContent: "x" }],
      tagName: "div",
    } as unknown as JxMutableNode);
    press(c.querySelector('[part="add-event"]'));
    await settle();
    expect(selectedNode().onclick).toEqual({ $prototype: "Function", body: "", parameters: [] });
  });

  test("EVENT_NAMES exposes the standard handler list", () => {
    expect(EVENT_NAMES).toContain("onclick");
    expect(EVENT_NAMES).toContain("onmouseleave");
  });
});

// ─── Repeating list (arrived from Content, §6.5) ─────────────────────────────

function repeaterDoc(extra: Record<string, unknown> = {}) {
  return {
    children: {
      $prototype: "Array",
      items: { $ref: "#/state/posts" },
      map: { tagName: "li" },
      ...extra,
    },
    state: { posts: { default: ["a"] } },
    tagName: "ul",
  } as unknown as JxMutableNode;
}

describe("Logic tab — repeating list", () => {
  beforeEach(() => {
    resetSlotModeMemory();
  });

  test("a map node shows Repeating list and no Events section", async () => {
    const c = await logic(repeaterDoc());
    expect(section(c, "repeater")).not.toBeNull();
    // A repeater has no `on*` position the renderer would ever mount.
    expect(section(c, "events")).toBeNull();
    expect(row(c, "items")).not.toBeNull();
  });

  test("Items is a real field row — a kit field, a source chip and a set dot", async () => {
    const c = await logic(repeaterDoc());
    const items = row(c, "items")!;
    expect(items.tagName.toLowerCase()).toBe("jx-field");
    expect(items.querySelector('[part="label"]')!.textContent).toBe("Items");
    expect(items.querySelector('[part="source"]')).toBeTruthy();
    expect(items.querySelector('[part="set"] [part="dot"]')).toBeTruthy();
  });

  test("Filter and Sort are always rows — no + Add link seeding a binding to nothing", async () => {
    const c = await logic(repeaterDoc());
    expect(row(c, "filter")).not.toBeNull();
    expect(row(c, "sort")).not.toBeNull();
    expect(c.textContent).not.toContain("Add filter");
    expect(c.textContent).not.toContain("Add sort");
    // Unset, so the dot says so.
    expect((row(c, "filter")!.querySelector('[part="dot"]') as HTMLElement).dataset.state).toBe(
      "unset",
    );
  });

  test("typing a filter sets it; emptying it removes the key", async () => {
    const c = await logic(repeaterDoc());
    type(row(c, "filter")!.querySelector('[part="text"]'), "a > 1");
    await settle();
    expect(docNow().children[0].filter).toBe("a > 1");

    type(row(c, "filter")!.querySelector('[part="text"]'), "");
    await settle();
    expect(docNow().children[0].filter).toBeUndefined();
  });

  test("the Filter row's set dot removes the key outright", async () => {
    const c = await logic(repeaterDoc({ filter: "a > 1" }));
    press(row(c, "filter")!.querySelector('[part="set"]'));
    await settle();
    expect(docNow().children[0].filter).toBeUndefined();
  });

  test("Items cannot be cleared: a repeater without a source is not a state to reach", async () => {
    const c = await logic(repeaterDoc());
    const set = row(c, "items")!.querySelector(
      '[part="set"] [part="control"]',
    ) as HTMLButtonElement;
    expect(set.disabled).toBe(true);
  });

  test("Edit template moves the selection into the map node", async () => {
    const c = await logic(repeaterDoc());
    press(c.querySelector('[part="edit-template"]'));
    expect(activeTab.value!.session.selection).toEqual([["children", 0, "map"]]);
  });

  test("dropping Items to a fixed value restores the signal's declared default", async () => {
    const c = await logic(repeaterDoc());
    await pick(row(c, "items")!.querySelector('[part="source"]'), "literal");
    expect(docNow().children[0].items).toBe('["a"]');
  });

  test("handler and Function state entries are excluded from the signal options", async () => {
    const c = await logic({
      children: { $prototype: "Array", items: { $ref: "#/state/posts" }, map: { tagName: "li" } },
      state: {
        fn: { $prototype: "Function", arguments: [], body: "" },
        onClick: { $handler: "x" },
        posts: { default: [] },
      },
      tagName: "ul",
    } as unknown as JxMutableNode);
    const options = [
      ...row(c, "items")!.querySelectorAll('[part="select"] [part="option"] [part="text"]'),
    ].map((o) => o.textContent);
    expect(options).toEqual(["posts"]);
  });
});

// ─── Condition ───────────────────────────────────────────────────────────────

function switchDoc() {
  return {
    children: {
      $prototype: "Array",
      items: [],
      map: {
        $switch: "${item.type}",
        cases: { alpha: { tagName: "div" }, beta: { tagName: "span" } },
        tagName: "li",
      },
    },
    tagName: "ul",
  } as unknown as JxMutableNode;
}

const inMap = [["children", 0, "map"]];

describe("Logic tab — condition", () => {
  beforeEach(() => {
    resetSlotModeMemory();
  });

  test("renders the expression row and one field row per case", async () => {
    const c = await logic(switchDoc(), inMap);
    const sw = section(c, "condition")!;
    expect(sw).not.toBeNull();
    expect(row(sw, "$switch")).not.toBeNull();
    const names = [...sw.querySelectorAll('[part="case-name"] [part="input"]')].map(
      (i) => (i as HTMLInputElement).value,
    );
    expect(names).toEqual(["alpha", "beta"]);
  });

  test("a case row carries the row vocabulary — data-prop and a control that removes it", async () => {
    const c = await logic(switchDoc(), inMap);
    const alpha = row(c, "case:alpha")!;
    expect(alpha.tagName.toLowerCase()).toBe("jx-field");
    const remove = alpha.querySelector('[part="case-remove"]')!;
    expect(remove.querySelector('[part="control"]')!.getAttribute("aria-label")).toBe(
      'Remove case "alpha"',
    );
    press(remove);
    await settle();
    expect(Object.keys(docNow().children[0].map.cases)).toEqual(["beta"]);
  });

  test("the edit arrow navigates the selection into the case", async () => {
    const c = await logic(switchDoc(), inMap);
    press(row(c, "case:alpha")!.querySelector('[part="case-open"]'));
    expect(activeTab.value!.session.selection).toEqual([["children", 0, "map", "cases", "alpha"]]);
  });

  test("Add case appends a numbered one", async () => {
    const c = await logic(switchDoc(), inMap);
    press(c.querySelector('[part="add-case"]'));
    await settle();
    expect(Object.keys(docNow().children[0].map.cases)).toEqual(["alpha", "beta", "case3"]);
  });

  test("renaming a case commits on change — the rename rebuilds the branch under it", async () => {
    /* It used to commit on a 500ms debounce off `input`, because a lit repaint mid-typing took the
       caret with it. A document's binding skips a write that resolved to the value the control
       already holds, so the field can commit when the reader is done with it. */
    const c = await logic(switchDoc(), inMap);
    commit(row(c, "case:alpha")!.querySelector('[part="case-name"]'), "gamma");
    await settle();
    expect(Object.keys(docNow().children[0].map.cases)).toEqual(["beta", "gamma"]);
  });

  test("inside a map template the expression offers the $map signals", async () => {
    const c = await logic(switchDoc(), inMap);
    await pick(row(c, "$switch")!.querySelector('[part="source"]'), "ref");
    expect(docNow().children[0].map.$switch).toEqual({ $ref: "$map/item" });

    const options = [...row(c, "$switch")!.querySelectorAll('[part="select"] [part="option"]')].map(
      (o) => o.getAttribute("value"),
    );
    expect(options).toContain("$map/item");
    expect(options).toContain("$map/index");
  });

  test("the Expression row offers no Fixed value rung — a $switch is inherently dynamic", async () => {
    const c = await logic(switchDoc(), inMap);
    press(row(c, "$switch")!.querySelector('[part="source"]'));
    expect((menus.at(-1)!.rows as AnyRec[]).map((r) => r.id)).not.toContain("literal");
  });
});

// ─── The custom element's outward contract ───────────────────────────────────

function widgetDoc(overrides: Record<string, unknown> = {}) {
  return {
    attributes: { part: "root" },
    children: [{ attributes: { part: "icon" }, tagName: "span" }],
    state: {
      label: { attribute: "label", default: "x", reflects: true, type: "string" },
      plain: { default: 1 },
    },
    style: { "--accent": "red", color: "blue" },
    tagName: "my-widget",
    ...overrides,
  } as unknown as JxMutableNode;
}

describe("Logic tab — the custom element's outward contract", () => {
  test("observed attributes list only state entries with an attribute, one static row each", async () => {
    const c = await logic(widgetDoc(), [[]]);
    const observed = section(c, "observed")!;
    expect(observed).not.toBeNull();
    const kv = observed.querySelector('[part="kv"]')!;
    expect(kv.querySelector('[part="kv-name"]')!.textContent).toBe("label");
    expect(kv.querySelector('[part="kv-detail"]')!.textContent).toBe("→ label");
    expect(kv.querySelector('[part="kv-value"]')!.textContent).toBe("string");
    expect(kv.querySelector('[part="kv-tags"]')!.textContent).toBe("reflects");
    expect(observed.textContent).not.toContain("plain");
  });

  test("no attribute entries → the empty-state hint", async () => {
    const c = await logic(widgetDoc({ state: { plain: { default: 1 } } }), [[]]);
    expect(section(c, "observed")!.textContent).toContain(
      "Attributes let a page set this component from markup",
    );
  });

  test("CSS Properties lists only custom properties", async () => {
    const c = await logic(widgetDoc(), [[]]);
    const cssProps = section(c, "cssprops")!;
    expect(cssProps.textContent).toContain("--accent");
    expect(cssProps.textContent).toContain("red");
    expect(cssProps.textContent).not.toContain("blue");
  });

  test("CSS Properties is omitted without custom properties", async () => {
    const c = await logic(widgetDoc({ style: { color: "blue" } }), [[]]);
    expect(section(c, "cssprops")).toBeNull();
  });

  test("CSS Parts collects part attributes from the tree", async () => {
    const c = await logic(widgetDoc(), [[]]);
    const parts = section(c, "cssparts")!;
    expect(parts.textContent).toContain("root");
    expect(parts.textContent).toContain("icon");
    expect(parts.textContent).toContain("<span>");
  });

  test("CSS Parts is omitted when no parts exist", async () => {
    const c = await logic(widgetDoc({ attributes: {}, children: [{ tagName: "span" }] }), [[]]);
    expect(section(c, "cssparts")).toBeNull();
  });

  test("the contract sections are omitted for a non-root selection", async () => {
    const c = await logic(widgetDoc(), [["children", 0]]);
    expect(section(c, "observed")).toBeNull();
    expect(section(c, "cssprops")).toBeNull();
    expect(section(c, "cssparts")).toBeNull();
  });

  test("a plain document's root grows no contract sections at all", async () => {
    const c = await logic(widgetDoc({ tagName: "div" }), [[]]);
    expect(section(c, "observed")).toBeNull();
    expect(section(c, "cssparts")).toBeNull();
  });

  test.each([
    ["observed", "__observed"],
    ["cssprops", "__cssprops"],
    ["cssparts", "__cssparts"],
  ])("%s remembers being opened, through the inspector's own record", async (id, key) => {
    const c = await logic(widgetDoc(), [[]]);
    await openSection(section(c, id)!, true);
    expect(activeTab.value!.session.ui.inspectorSections[key]).toBe(true);

    await openSection(section(c, id)!, false);
    expect(activeTab.value!.session.ui.inspectorSections[key]).toBe(false);
  });

  test("Repeating list, Condition and Events stay shut when a reader shuts them", async () => {
    /* They were rendered with a hard-coded `open`, so collapsing one lasted until the next repaint
       — which, in a dock that repaints on every selection change, was immediately. */
    const c = await logic(repeaterDoc());
    await openSection(section(c, "repeater")!, false);
    expect(activeTab.value!.session.ui.inspectorSections["__repeater"]).toBe(false);
    expect(
      (section(c, "repeater")!.querySelector('[part="details"]') as HTMLDetailsElement).open,
    ).toBe(false);
  });
});
