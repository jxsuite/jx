/**
 * The Inspector's **Content** tab — `src/panels/properties-panel.ts`, the flow, and
 * `src/surfaces/properties-panel.json`, the document it mounts.
 *
 * Everything is addressed by `part`, by `data-prop` and by `data-section`, because the tab is a
 * document: there is no `sp-textfield`, no `sp-picker`, no `.style-row` and no `.provenance-chip`
 * to find any more. `data-prop` is the one selector that did NOT move — `ui/regions.ts` resolves
 * `inspector/field:<prop>` through it and the screenshot manifest addresses the `href` row that way
 * — so every row still carries it.
 *
 * The tab is bound to a host ONCE per test and updated in place afterwards, which is the behaviour
 * under test as much as any assertion here: a repaint that rebuilt the rows would take the caret
 * out of the field a reader is typing in, and that is what the lit panel needed the dock's focus
 * guard for.
 *
 * Repeater, Switch and the custom-element contract sections moved to the Logic tab in P5
 * (`tests/events-panel.test.ts`); the Page section moved to the Document Header card
 * (`tests/head-panel.test.ts`). What is tested here is what Content still draws.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import { capsForPosition } from "../src/ui/value-source";
import {
  bindContentHost,
  invalidatePageRouteCache,
  renderPropertiesPanel,
} from "../src/panels/properties-panel";
import { componentRegistry } from "../src/files/components";
import { resetSlotModeMemory } from "../src/ui/dynamic-slot";
import { view } from "../src/view";
import { shell } from "../src/shell";
import { setActiveRegistry } from "../src/commands/active-registry";
import type { CommandRegistry } from "../src/commands/registry";
import {
  PRIMARY_PANE,
  SECONDARY_PANE,
  activeTab,
  closeAllTabs,
  focusPane,
  workspace,
} from "../src/workspace/workspace";
import type { JxMutableNode } from "@jxsuite/schema/types";

installMockPlatform();

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

// ─── Local helpers ────────────────────────────────────────────────────────────

const navCalls: string[] = [];
const ctx = { navigateToComponent: (p: string) => navCalls.push(p) };

let host: HTMLElement | null = null;

/**
 * Mount the tab (the first time) and bring it up to date (every time).
 *
 * The pulse is bumped explicitly because two of the facts the projection reads are NOT reactive
 * stores — the component registry and the usage cache — which is exactly why the flow exports a
 * repaint signal at all.
 */
async function renderPanel(): Promise<HTMLElement> {
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
    bindContentHost(host, ctx);
  }
  renderPropertiesPanel();
  await flush(6);
  return host;
}

function openDoc(doc: Record<string, unknown>, selection: (string | number)[] | null = []) {
  const tab = resetWorkspaceWithTab(doc as JxMutableNode);
  tab.session.selection = selection ? [selection] : [];
  return tab;
}

function docNow(): JxMutableNode {
  return activeTab.value!.doc.document as JxMutableNode;
}

/** One row, by the thing it edits. */
function row(root: Element, prop: string): HTMLElement {
  const el = root.querySelector(`[data-prop="${prop}"]`);
  if (!el) {
    throw new Error(`no row for "${prop}"`);
  }
  return el as HTMLElement;
}

/** An accordion section as the kit's element holds it: its heading, and its disclosure. */
type SectionEl = HTMLElement & { label: string; open: boolean };

/** One accordion section, by the key `inspector.setSection` addresses it with. */
function section(root: Element, key: string): SectionEl | null {
  return root.querySelector(`[data-section="${key}"]`) as SectionEl | null;
}

/** Every section label the accordion draws, in order. */
function sectionLabels(root: Element): string[] {
  return [...root.querySelectorAll("[data-section]")].map((el) => (el as SectionEl).label ?? "");
}

/** The section whose visible heading reads `label`. */
function sectionNamed(root: Element, label: string): SectionEl | null {
  const all = [...root.querySelectorAll("[data-section]")] as SectionEl[];
  return all.find((el) => el.label === label) ?? null;
}

/**
 * The native control a kit field is made of.
 *
 * `[part="input"]` is asked for FIRST rather than in one selector list: a `jx-checkbox` draws a
 * `<label part="control">` around its own `<input part="input">`, so a combined selector returns
 * the label — the earlier node in document order — and every assertion about the control's type or
 * its checked state reads the wrapper instead.
 */
function control<T extends Element>(root: Element, prop: string, part = "widget"): T {
  const scope = row(root, prop).querySelector(`[part="${part}"]`);
  const el = scope?.querySelector('[part="input"]') ?? scope?.querySelector('[part="control"]');
  if (!el) {
    throw new Error(`no control in [part="${part}"] of row "${prop}"`);
  }
  return el as unknown as T;
}

/** Type into a control the way a reader does: it reports, and the event bubbles. */
function type(el: Element, value: string): void {
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Commit a control: the value is set and `change` fires, as a blur or a pick does. */
function commit(el: Element, value: string): void {
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Toggle a checkbox the way a reader does. */
function check(el: Element, next: boolean): void {
  (el as HTMLInputElement).checked = next;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The values a select offers, in order — the stand-in row for an unlisted value included. */
function options(el: Element): (string | null)[] {
  return [...el.querySelectorAll("option")].map((o) => o.getAttribute("value"));
}

/** The provenance chip on a row, or null where §6.2 says a row draws none. */
function chip(root: Element, prop: string): HTMLElement | null {
  return row(root, prop).querySelector('[part="chip"]');
}

/** An `action` row — "+ Add attribute", "→ Edit definition", "Open Layout →", "Retry". */
function action(root: Element, text: string): HTMLElement | undefined {
  return [...root.querySelectorAll('[part="action"]')].find((el) =>
    el.textContent?.includes(text),
  ) as HTMLElement | undefined;
}

/** Open one row's Value Source picker and hand back the kit menu it opened. */
async function openSourceMenu(root: Element, prop: string): Promise<HTMLElement> {
  const el = row(root, prop).querySelector('[part="source"] [part="control"]');
  if (!el) {
    throw new Error(`no value-source chip in row "${prop}"`);
  }
  pointer(el, "click");
  await flush(6);
  const menu = document.querySelector('[data-jx-region="overlay.menu:value-source"] jx-menu');
  if (!menu) {
    throw new Error(`the value-source menu did not open for "${prop}"`);
  }
  return menu as HTMLElement;
}

/**
 * Pick a rung on a row's Value Source control (§6.3's ladder).
 *
 * The chip opens a picker rather than cycling, so a test names the rung it wants instead of
 * counting clicks — which is the behaviour change that made "$ref → literal must pass through ${}"
 * untrue.
 */
async function chooseValueSource(
  root: Element,
  prop: string,
  mode: "literal" | "ref" | "template" | "expression",
): Promise<void> {
  const menu = await openSourceMenu(root, prop);
  const rung = menu.querySelector<HTMLElement>(`[data-command-id="${mode}"]`);
  if (!rung) {
    throw new Error(`the ladder for "${prop}" does not offer "${mode}"`);
  }
  rung.click();
  await flush(4);
}

/** The rungs a row's picker offers, in ladder order. */
async function offeredRungs(root: Element, prop: string): Promise<string[]> {
  const menu = await openSourceMenu(root, prop);
  return [...menu.querySelectorAll<HTMLElement>("jx-menu-item")].map(
    (el) => el.dataset["commandId"] ?? "",
  );
}

/** The rung a row is currently at, in the ladder's own words. */
function sourceLabel(root: Element, prop: string): string {
  return row(root, prop).querySelector('[part="source"]')!.textContent!.trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

beforeEach(() => {
  navCalls.length = 0;
  shell.layoutSelection = null;
  view.showAddBreakpointForm = false;
  view.addBreakpointPreview = "";
  componentRegistry.length = 0;
  invalidatePageRouteCache();
  resetSlotModeMemory();
  resetStudioState();
  installMockPlatform();
});

afterEach(() => {
  bindContentHost(null);
  host?.remove();
  host = null;
  for (const menu of document.querySelectorAll('[data-jx-region^="overlay.menu"]')) {
    menu.replaceChildren();
  }
});

// ─── Drafts ───────────────────────────────────────────────────────────────────

describe("drafts belong to a node, not to a field name", () => {
  /*
   * `ui/field-input.ts`'s draft map is module-global and these three rows keyed it by field name
   * alone (`"prop:className"`), so every element shared one slot per field. Type a class name,
   * click a sibling before blurring, and the sibling's Class row showed your text — and blurring it
   * there committed to the WRONG element. Plan §11.4: "drafts keyed by node path (today all
   * elements share one draft slot per field)".
   */
  test("a draft on one element does not appear on the next", async () => {
    const tab = openDoc(
      {
        children: [
          { className: "first", tagName: "p" },
          { className: "second", tagName: "p" },
        ],
        tagName: "div",
      },
      ["children", 0],
    );
    const c = await renderPanel();

    // Type into the first element's Class row WITHOUT blurring — a live draft.
    type(control(c, "className"), "half-typed");
    await flush();

    tab.session.selection = [["children", 1]];
    await renderPanel();
    expect(control<HTMLInputElement>(c, "className").value).toBe("second");
    // …and the first element is untouched on disk.
    expect((docNow().children as Record<string, unknown>[])[0]!.className).toBe("first");
  });
});

// ─── Empty states ─────────────────────────────────────────────────────────────

describe("empty states", () => {
  test("no tab open → teaches what the inspector needs, with the action that supplies it", async () => {
    closeAllTabs();
    const c = await renderPanel();
    expect(c.textContent).toContain("Open a page to inspect and style what you click.");
    expect(c.querySelector('[part="empty-action"]')!.textContent!.trim()).toBe("Open a page…");
  });

  test("tab open without selection → the one shared canvas verb", async () => {
    openDoc({ children: [], tagName: "div" }, null);
    const c = await renderPanel();
    expect(c.textContent).toContain("Click anything on the canvas to edit its content.");
  });

  test("selection pointing at a missing node → says it is gone, then repeats the verb", async () => {
    openDoc({ children: [{ tagName: "p" }], tagName: "div" }, ["children", 9, "children", 0]);
    const c = await renderPanel();
    expect(c.textContent).toContain("no longer on the page");
    expect(c.textContent).toContain("Click anything on the canvas");
  });
});

// ─── Layout selection panel ───────────────────────────────────────────────────

describe("layout selection panel", () => {
  const headerHit = {
    className: "site-header",
    layoutFile: "layouts/base.json",
    layoutPath: ["children", 0, "children", 0],
    rect: { height: 40, width: 800, x: 0, y: 0 },
    tagName: "header",
  };

  test("shows tag, class, and the layout file the element came from", async () => {
    openDoc({ children: [], tagName: "div" });
    shell.layoutSelection = headerHit;

    const c = await renderPanel();
    expect(section(c, "__layout")!.label).toBe("Layout Element");
    expect(c.textContent).toContain("header");
    expect(c.textContent).toContain("site-header");
    expect(c.textContent).toContain("layouts/base.json");
  });

  test("a layout selection wins over the document selection (a layout node is not in this doc)", async () => {
    openDoc({ children: [{ tagName: "p" }], tagName: "div" }, ["children", 0]);
    shell.layoutSelection = headerHit;
    const c = await renderPanel();
    expect(section(c, "__layout")).not.toBeNull();
    expect(section(c, "__element")).toBeNull();
  });

  test("Open Layout → runs ONE command and does not clear the layout selection", async () => {
    /* Four assertions INVERTED, and each inversion is the point of the change.
       `openLayoutAtNode` used to navigate, `setLayoutSelection(null)`, re-select against
       `activeTab` and `renderOnly("rightPanel")`. It opened the layout OVER the page it was
       teaching about, and clearing the selection is precisely what killed the follow on its first
       frame — `shell.layoutSelection` is what the layout companion follows the NODE through. The
       chip is a control now: it runs `pane.derive { preset: "layout" }` and decides nothing. */
    openDoc({ children: [], tagName: "div" });
    shell.layoutSelection = headerHit;
    const ran: { id: string; args: unknown }[] = [];
    setActiveRegistry({
      run: (id: string, args: unknown) => {
        ran.push({ args, id });
        return Promise.resolve();
      },
    } as unknown as CommandRegistry);

    const c = await renderPanel();
    action(c, "Open Layout")!.click();
    await flush();

    expect(ran).toEqual([{ args: { preset: "layout" }, id: "pane.derive" }]);
    // No `navigate` call of its own — the chip does not know what opening a layout means.
    expect(navCalls).toEqual([]);
    // And the layout selection SURVIVES: it is the node the following pane keeps highlighting.
    expect(shell.layoutSelection).toEqual(headerHit);
    setActiveRegistry(null);
  });

  /* FINDING 8. `canvas/iframe-host.ts`'s `layoutHit` handler calls `focusHostPane(state)`, which
     moves the keyboard into the pane the click landed in — including a LENS, which draws layout
     chrome because it draws the same document. From there `pane.derive` can only refuse: its
     enablement is `deriveRefusal(activePane().id)`, and a derived pane cannot derive again. The
     chip was drawn anyway and its handler is `void activeRegistry()?.run(…)`, so the throw went
     into a `void` and the author pressed a control that did nothing at all. */
  test("Open Layout → is not drawn in a shell whose focused pane is itself derived", async () => {
    openDoc({ children: [], tagName: "div" });
    shell.layoutSelection = headerHit;
    expect(action(await renderPanel(), "Open Layout")).toBeDefined();

    // A lens beside the page, with the keyboard in it — which is where a click on layout chrome
    // Drawn by that lens leaves it.
    workspace.panes.push({ activeTabId: null, derived: null, id: SECONDARY_PANE, tabOrder: [] });
    workspace.panes[1]!.derived = {
      diff: null,
      kind: "lens",
      media: null,
      mode: "design",
      preset: "breakpoint",
      reason: "",
      sourcePaneId: PRIMARY_PANE,
      status: "ready",
      zoom: 1,
    };
    focusPane(SECONDARY_PANE);

    const c = await renderPanel();
    /* By LABEL rather than by element: `expect(<happy-dom element>).toBeUndefined()` prints the
       element, and a happy-dom element's inspection reaches its `window` — sixty thousand lines of
       class table for one wrong chip, which is what a reviewer would have to read past. */
    expect(
      [...c.querySelectorAll('[part="action"]')].map((el) => el.textContent?.trim()),
    ).not.toContain("Open Layout →");
    // The sentence explaining where the element comes from stays — that is the panel's job, and it
    // Is true wherever the keyboard is.
    expect(c.textContent).toContain("layouts/base.json");
    focusPane(PRIMARY_PANE);
  });

  test("falls back to generic labels when the hit names no tag, class, or file", async () => {
    openDoc({ children: [], tagName: "div" });
    shell.layoutSelection = {
      className: "",
      layoutFile: "",
      layoutPath: [],
      rect: { height: 0, width: 0, x: 0, y: 0 },
      tagName: "",
    };

    const c = await renderPanel();
    expect(c.textContent).toContain("<element>");
    expect(c.textContent).toContain("which wraps every page that uses it");
    // No class row rendered
    expect(c.querySelector('[data-prop="className"]')).toBeNull();
  });
});

// ─── Element section ──────────────────────────────────────────────────────────

describe("element section", () => {
  test("renders tag, id, class, text content, and hidden rows for a leaf node", async () => {
    openDoc({ children: [{ tagName: "p", textContent: "Hello" }], tagName: "div" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    const elem = section(c, "__element")!;
    expect(elem.label).toBe("Element");
    // Not auto-opened: the disclosure is false until the user (or the command) opens it.
    expect(elem.open).toBe(false);
    expect(control<HTMLInputElement>(elem, "tagName").value).toBe("p");
    expect(elem.querySelector('[data-prop="$id"]')).not.toBeNull();
    expect(elem.querySelector('[data-prop="className"]')).not.toBeNull();
    expect(elem.querySelector('[data-prop="textContent"] textarea')).not.toBeNull();
    expect(control<HTMLInputElement>(elem, "hidden").getAttribute("type")).toBe("checkbox");
  });

  test("nodes with element children get no text content row", async () => {
    openDoc({ children: [{ children: [{ tagName: "p" }], tagName: "section" }], tagName: "div" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    expect(c.querySelector('[data-prop="textContent"]')).toBeNull();
  });

  test("set-dots clear $id, class, text, and hidden", async () => {
    openDoc(
      {
        children: [
          { $id: "hero", className: "big", hidden: true, tagName: "p", textContent: "Hello" },
        ],
        tagName: "div",
      },
      ["children", 0],
    );
    const c = await renderPanel();
    for (const [prop, title] of [
      ["$id", "Clear ID"],
      ["className", "Clear class"],
      ["textContent", "Clear text"],
      ["hidden", "Clear hidden"],
    ] as const) {
      const dot = chip(c, prop)!;
      expect(dot.getAttribute("title")).toBe(title);
      expect(dot.dataset.state).toBe("set");
      dot.click();
      await renderPanel();
    }
    const node = (docNow().children as JxMutableNode[])[0]!;
    expect(node.$id).toBeUndefined();
    expect(node.className).toBeUndefined();
    expect(node.textContent).toBeUndefined();
    expect(node.hidden).toBeUndefined();
  });

  test("editing the ID field commits on change", async () => {
    openDoc({ children: [{ tagName: "p" }], tagName: "div" }, ["children", 0]);
    const c = await renderPanel();
    commit(control(c, "$id"), "headline");
    expect((docNow().children as JxMutableNode[])[0]!.$id).toBe("headline");
  });

  test("class and text content fields commit on change", async () => {
    openDoc({ children: [{ tagName: "p" }], tagName: "div" }, ["children", 0]);
    const c = await renderPanel();
    commit(control(c, "className"), "lede");
    expect((docNow().children as JxMutableNode[])[0]!.className).toBe("lede");

    await renderPanel();
    commit(control(c, "textContent"), "Body copy");
    expect((docNow().children as JxMutableNode[])[0]!.textContent).toBe("Body copy");
  });

  test("hidden checkbox toggles the hidden property", async () => {
    openDoc({ children: [{ tagName: "p" }], tagName: "div" }, ["children", 0]);
    const c = await renderPanel();
    check(control(c, "hidden"), true);
    expect((docNow().children as JxMutableNode[])[0]!.hidden).toBe(true);

    await renderPanel();
    check(control(c, "hidden"), false);
    expect((docNow().children as JxMutableNode[])[0]!.hidden).toBeUndefined();
  });

  test("the accordion's own toggle flips the section state in session ui", async () => {
    const tab = openDoc({ children: [{ tagName: "p" }], tagName: "div" }, ["children", 0]);
    const c = await renderPanel();
    const item = section(c, "__element")!;
    const details = item.querySelector("details") as HTMLDetailsElement;

    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await flush();
    expect(tab.session.ui.inspectorSections.__element).toBe(true);

    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    await flush();
    expect(tab.session.ui.inspectorSections.__element).toBe(false);

    await renderPanel();
    expect(section(c, "__element")!.open).toBe(false);
  });
});

// ─── Component props section ──────────────────────────────────────────────────

function registerCard(overrides: Record<string, unknown> = {}) {
  componentRegistry.push({
    path: "components/my-card.json",
    props: [
      { name: "title", type: "string" },
      { description: "Show ribbon", name: "featured", type: "boolean" },
      { name: "count", type: "number" },
      { name: "variant", type: "'plain' | 'fancy'" },
      { format: "image", name: "image", type: "string" },
      { format: "color", name: "tint", type: "string" },
      { format: "date", name: "published", type: "string" },
    ],
    source: "local",
    tagName: "my-card",
    ...overrides,
  } as never);
}

function cardDoc($props: Record<string, unknown> = {}) {
  return {
    children: [{ $props, tagName: "my-card" }],
    state: { username: { default: "kevin" } },
    tagName: "div",
  };
}

describe("component props section", () => {
  test("unknown component → says the library does not have it", async () => {
    openDoc(cardDoc(), ["children", 0]);
    const c = await renderPanel();
    expect(section(c, "__props")!.textContent).toContain("not in the project's library");
  });

  test("empty props list → says there is nothing to fill in", async () => {
    componentRegistry.push({
      path: "components/empty.json",
      props: [],
      source: "local",
      tagName: "my-card",
    } as never);
    openDoc(cardDoc(), ["children", 0]);
    const c = await renderPanel();
    expect(section(c, "__props")!.textContent).toContain(
      "This component has no settings to fill in yet.",
    );
  });

  test("renders one widget per prop with the right control types", async () => {
    registerCard();
    openDoc(cardDoc({ title: "Hi" }), ["children", 0]);
    const c = await renderPanel();
    const sec = section(c, "__props")!;
    expect(sec.querySelector('[data-prop="title"] jx-textfield')).not.toBeNull();
    expect(sec.querySelector('[data-prop="featured"] jx-checkbox')).not.toBeNull();
    expect(sec.querySelector('[data-prop="count"] jx-number-field')).not.toBeNull();
    expect(sec.querySelector('[data-prop="variant"] jx-select')).not.toBeNull();
    // The media picker is a document mounted into an announced host, the colour selector still lit.
    expect(sec.querySelector('[data-prop="image"] [part="media-field"]')).not.toBeNull();
    expect(sec.querySelector('[data-prop="tint"] [part="control-host"]')).not.toBeNull();
    expect(control(sec, "published").getAttribute("placeholder")).toBe("YYYY-MM-DD");
  });

  test("a media picker whose row goes away is taken down with it", async () => {
    registerCard();
    openDoc(cardDoc({ title: "Hi" }), ["children", 0]);
    const c = await renderPanel();
    const box = c.querySelector('[data-prop="image"] [part="control-host"]') as HTMLElement;
    expect(box.querySelector('[part="media-field"]')).not.toBeNull();

    /* Select the root instead: `my-card`'s props are gone, so the plan the picker's host belonged
       to is gone, and `paintControls` drops the host. The picker in it is a MOUNTED document and the
       surface registry holds that host, so nothing would ever collect it if the panel merely forgot
       the box. */
    activeTab.value!.session.selection = [[]];
    await renderPanel();
    expect(box.querySelector('[part="media-field"]')).toBeNull();
  });

  test("text prop commits into $props on change; clear dot removes it", async () => {
    registerCard();
    openDoc(cardDoc({ title: "Hi" }), ["children", 0]);
    const c = await renderPanel();
    commit(control(c, "title"), "Updated");
    expect((docNow().children as JxMutableNode[])[0]!.$props!.title).toBe("Updated");

    await renderPanel();
    chip(c, "title")!.click();
    expect((docNow().children as JxMutableNode[])[0]!.$props).toBeUndefined();
  });

  test("boolean prop checkbox sets true and clears on uncheck", async () => {
    registerCard();
    openDoc(cardDoc({ featured: true }), ["children", 0]);
    const c = await renderPanel();
    check(control(c, "featured"), false);
    expect((docNow().children as JxMutableNode[])[0]!.$props).toBeUndefined();

    await renderPanel();
    check(control(c, "featured"), true);
    expect((docNow().children as JxMutableNode[])[0]!.$props!.featured).toBe(true);
  });

  /*
   * A CEM union type is a CLOSED list, so it is the kit's select rather than the typeable combobox
   * the lit panel drew: the empty row is what clears it, which a picker with no empty row could
   * never do.
   */
  test("enum prop commits the picked option, and the empty row clears it", async () => {
    registerCard();
    openDoc(cardDoc(), ["children", 0]);
    const c = await renderPanel();
    expect(options(control(c, "variant"))).toEqual(["", "plain", "fancy"]);
    commit(control(c, "variant"), "fancy");
    expect((docNow().children as JxMutableNode[])[0]!.$props!.variant).toBe("fancy");

    await renderPanel();
    commit(control(c, "variant"), "");
    expect((docNow().children as JxMutableNode[])[0]!.$props).toBeUndefined();
  });

  test("date prop commits via its text field", async () => {
    registerCard();
    openDoc(cardDoc(), ["children", 0]);
    const c = await renderPanel();
    commit(control(c, "published"), "2026-06-12");
    expect((docNow().children as JxMutableNode[])[0]!.$props!.published).toBe("2026-06-12");
  });

  test("the value source picker moves a prop between rungs and remembers the literal", async () => {
    registerCard();
    openDoc(cardDoc({ title: "Hi" }), ["children", 0]);
    const c = await renderPanel();
    await chooseValueSource(c, "title", "ref");
    expect((docNow().children as JxMutableNode[])[0]!.$props!.title).toEqual({
      $ref: "#/state/username",
    });

    await renderPanel();
    expect(sourceLabel(c, "title")).toBe("From data…");
    await chooseValueSource(c, "title", "template");
    expect((docNow().children as JxMutableNode[])[0]!.$props!.title).toBe("${state.username}");

    await renderPanel();
    await chooseValueSource(c, "title", "literal");
    expect((docNow().children as JxMutableNode[])[0]!.$props!.title).toBe("Hi");
  });

  test("a prop opened already-bound drops to the signal's declared default", async () => {
    registerCard();
    openDoc(cardDoc({ title: { $ref: "#/state/username" } }), ["children", 0]);
    const c = await renderPanel();
    await chooseValueSource(c, "title", "literal");
    expect((docNow().children as JxMutableNode[])[0]!.$props!.title).toBe("kevin");
  });

  test("bound prop renders a signal picker that rebinds or clears", async () => {
    registerCard();
    openDoc(cardDoc({ title: { $ref: "#/state/username" } }), ["children", 0]);
    const c = await renderPanel();
    const picker = () => control<HTMLSelectElement>(c, "title");
    expect(options(picker())).toEqual(["", "#/state/username"]);
    commit(picker(), "#/state/username");
    expect((docNow().children as JxMutableNode[])[0]!.$props!.title).toEqual({
      $ref: "#/state/username",
    });

    await renderPanel();
    commit(picker(), "");
    expect((docNow().children as JxMutableNode[])[0]!.$props).toBeUndefined();
  });

  test("npm components write props into attributes instead of $props", async () => {
    componentRegistry.push({
      props: [{ name: "label", type: "string" }],
      source: "npm",
      tagName: "sl-button",
    } as never);
    openDoc({ children: [{ attributes: { label: "Hi" }, tagName: "sl-button" }], tagName: "div" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    commit(control(c, "label"), "Click me");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.label).toBe("Click me");

    // Empty value removes the attribute
    await renderPanel();
    commit(control(c, "label"), "");
    expect((docNow().children as JxMutableNode[])[0]!.attributes?.label).toBeUndefined();

    // Npm comp without a path → no Edit definition link
    await renderPanel();
    expect(action(section(c, "__props")!, "Edit definition")).toBeUndefined();
  });

  test("npm prop cycled to ref stores a real $ref object in attributes", async () => {
    componentRegistry.push({
      props: [{ name: "label", type: "string" }],
      source: "npm",
      tagName: "sl-button",
    } as never);
    openDoc(
      {
        children: [{ attributes: { label: "Hi" }, tagName: "sl-button" }],
        state: { username: { default: "kevin" } },
        tagName: "div",
      },
      ["children", 0],
    );
    const c = await renderPanel();
    await chooseValueSource(c, "label", "ref");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.label).toEqual({
      $ref: "#/state/username",
    });
  });

  /*
   * The lit picker drew a divider between the document's own signals and a repeater's two. The kit
   * select has no divider and the contract never was the rule: it is that a position inside a `$map`
   * can bind to `$map/item` and `$map/index` even where the document declares no state at all.
   */
  test("inside a map template, props bind to $map signals when no state defs exist", async () => {
    registerCard();
    openDoc(
      { children: { $prototype: "Array", items: [], map: { tagName: "my-card" } }, tagName: "div" },
      ["children", 0, "map"],
    );
    const c = await renderPanel();
    await chooseValueSource(c, "title", "ref");
    expect((docNow().children as JxMutableNode[])[0]!.map!.$props!.title).toEqual({
      $ref: "$map/item",
    });

    await renderPanel();
    expect(options(control(c, "title"))).toEqual(["", "$map/item", "$map/index"]);
  });

  test("Edit definition link navigates to the component file", async () => {
    registerCard();
    openDoc(cardDoc(), ["children", 0]);
    const c = await renderPanel();
    action(section(c, "__props")!, "Edit definition")!.click();
    expect(navCalls).toEqual(["components/my-card.json"]);
  });
});

// ─── The tab re-split (§6.5) ──────────────────────────────────────────────────

describe("what Content no longer draws", () => {
  test("a repeating list says where its wiring lives and offers the tab that has it", async () => {
    openDoc(
      { children: { $prototype: "Array", items: [], map: { tagName: "li" } }, tagName: "ul" },
      ["children", 0],
    );
    const c = await renderPanel();
    expect(c.textContent).toContain("A repeating list has no content of its own.");
    expect(c.textContent).toContain("live in Logic");
    expect(c.querySelector('[part="empty-action"]')!.textContent!.trim()).toBe("Open Logic");
    // And it draws none of the sections it used to.
    expect(section(c, "__element")).toBeNull();
  });

  test("the Open Logic button actually selects the Logic tab", async () => {
    const tab = openDoc(
      { children: { $prototype: "Array", items: [], map: { tagName: "li" } }, tagName: "ul" },
      ["children", 0],
    );
    const c = await renderPanel();
    (c.querySelector('[part="empty-action"]') as HTMLElement).click();
    // The dock is reached through a lazy import (Content must not statically depend on its host),
    // So the tab lands a few turns later.
    for (let i = 0; i < 20 && tab.session.ui.rightTab !== "events"; i++) {
      await flush(1);
    }
    expect(tab.session.ui.rightTab).toBe("events");
  });

  test("a $switch node keeps its Content rows and grows no Condition section", async () => {
    openDoc({ children: [{ $switch: "${x}", cases: {}, tagName: "li" }], tagName: "ul" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    expect(sectionLabels(c)).not.toContain("Condition");
    expect(section(c, "__element")).not.toBeNull();
  });

  test("a custom-element root keeps Content rows and loses the outward-contract sections", async () => {
    openDoc(
      {
        attributes: { part: "root" },
        state: { label: { attribute: "label", default: "x" } },
        style: { "--accent": "red" },
        tagName: "my-widget",
      },
      [],
    );
    const c = await renderPanel();
    const labels = sectionLabels(c);
    expect(labels).not.toContain("Observed Attributes");
    expect(labels).not.toContain("CSS Properties");
    expect(labels).not.toContain("CSS Parts");
    expect(section(c, "__element")).not.toBeNull();
  });

  test("no Page section survives, on a site page or anywhere else", async () => {
    resetStudioState({
      isSiteProject: true,
      projectConfig: { defaults: { layout: "./layouts/base.json" } },
    });
    installMockPlatform();
    const tab = resetWorkspaceWithTab({ children: [], tagName: "div" } as never);
    tab.documentPath = "pages/index.json";
    tab.session.selection = [[]] as never;
    const c = await renderPanel();
    expect(sectionLabels(c)).not.toContain("Page");
    expect(c.querySelector('[data-prop="$layout"]')).toBeNull();
  });
});

// ─── Provenance chips on component props (§6.2) ───────────────────────────────

describe("component prop provenance", () => {
  function registerDefaulted() {
    componentRegistry.push({
      path: "components/my-card.json",
      props: [
        { default: "Untitled", name: "title", type: "string" },
        { name: "subtitle", type: "string" },
      ],
      source: "local",
      tagName: "my-card",
    } as never);
  }

  test("a value set on the instance is the accent dot, and clicking it clears", async () => {
    registerDefaulted();
    openDoc(cardDoc({ title: "Mine" }), ["children", 0]);
    const c = await renderPanel();
    const dot = chip(c, "title")!;
    expect(dot.dataset.state).toBe("set");
    expect(dot.tagName.toLowerCase()).toBe("button");
    dot.click();
    expect((docNow().children as JxMutableNode[])[0]!.$props).toBeUndefined();
  });

  test("an unset prop with a component default names the donor and jumps to it", async () => {
    registerDefaulted();
    openDoc(cardDoc(), ["children", 0]);
    const c = await renderPanel();
    const inherited = chip(c, "title")!;
    expect(inherited.dataset.state).toBe("inherited");
    expect(inherited.textContent!.trim()).toBe("from the component default");
    expect(inherited.getAttribute("title")).toContain("Untitled");
    inherited.click();
    expect(navCalls).toEqual(["components/my-card.json"]);
  });

  test("an unset prop with NO component default draws no chip at all", async () => {
    registerDefaulted();
    openDoc(cardDoc(), ["children", 0]);
    const c = await renderPanel();
    expect(chip(c, "subtitle")).toBeNull();
  });

  test("a bound prop is violet and names the signal, not the pointer", async () => {
    registerDefaulted();
    openDoc(cardDoc({ title: { $ref: "#/state/username" } }), ["children", 0]);
    const c = await renderPanel();
    const bound = chip(c, "title")!;
    expect(bound.dataset.state).toBe("bound");
    expect(bound.textContent!.trim()).toBe("username");
  });

  test("…and the chip OPENS it — §6.2 says a bound chip's click opens the source", async () => {
    /*
     * The Style tab's bound chip has jumped to the Data panel since P5. The Content tab's two bound
     * branches returned a `donor` and a `title` and no `onClick`, so the chip was a handler-less
     * span: the same promise, in the same table, kept on one tab and printed on the other.
     */
    const tab = openDoc(cardDoc({ title: { $ref: "#/state/username" } }), ["children", 0]);
    registerDefaulted();
    (tab.doc.document as unknown as Record<string, unknown>).state = { username: { default: "" } };
    const ran: { id: string; args: unknown }[] = [];
    setActiveRegistry({
      run: (id: string, args: unknown) => {
        ran.push({ args, id });
        return Promise.resolve();
      },
    } as unknown as CommandRegistry);

    chip(await renderPanel(), "title")!.click();
    await flush();
    expect(ran).toEqual([
      { args: { tab: "data" }, id: "view.setActivity" },
      { args: { name: "username" }, id: "data.expandRow" },
    ]);
    setActiveRegistry(null);
  });

  test("a chip whose donor this document does not define does not pretend to jump", async () => {
    // A `$ref` left over from a rename points at nothing. A chip that opened the Data panel and
    // Expanded a row that is not there would be a worse answer than one that only names it.
    registerDefaulted();
    openDoc(cardDoc({ title: { $ref: "#/state/ghost" } }), ["children", 0]);
    const bound = chip(await renderPanel(), "title")!;
    expect(bound.dataset.state).toBe("bound");
    expect(bound.tagName.toLowerCase()).toBe("span");
  });

  test("a $ref that points nowhere says so rather than naming an empty pointer", async () => {
    registerDefaulted();
    openDoc(cardDoc({ title: { $ref: "" } }), ["children", 0]);
    const c = await renderPanel();
    expect(chip(c, "title")!.textContent!.trim()).toBe("nothing yet");
  });

  test("dropping a prop bound to a def with no declared default just clears it", async () => {
    registerDefaulted();
    const tab = openDoc(cardDoc({ subtitle: { $ref: "#/state/username" } }), ["children", 0]);
    (tab.doc.document as unknown as Record<string, unknown>).state = { username: {} };
    const c = await renderPanel();
    await chooseValueSource(c, "subtitle", "literal");
    expect((docNow().children as JxMutableNode[])[0]!.$props?.subtitle).toBeUndefined();
  });

  test("an expression-valued prop reads as bound to a formula", async () => {
    registerDefaulted();
    openDoc(cardDoc({ title: { $expression: { operator: "=", target: null } } }), ["children", 0]);
    const c = await renderPanel();
    expect(chip(c, "title")!.textContent!.trim()).toBe("a formula");
  });

  test("a template-valued prop reads as bound to a template", async () => {
    registerDefaulted();
    openDoc(cardDoc({ title: "${state.username}" }), ["children", 0]);
    const c = await renderPanel();
    expect(chip(c, "title")!.textContent!.trim()).toBe("a template");
  });

  test("a bound HTML attribute names its signal too", async () => {
    openDoc(
      {
        children: [{ attributes: { href: { $ref: "#/state/url" } }, tagName: "link" }],
        state: { url: { default: "/x" } },
        tagName: "div",
      },
      ["children", 0],
    );
    const c = await renderPanel();
    const bound = chip(c, "href")!;
    expect(bound.dataset.state).toBe("bound");
    expect(bound.textContent!.trim()).toBe("url");
  });
});

// ─── HTML attribute sections ──────────────────────────────────────────────────

describe("html attribute sections", () => {
  test("only sections applicable to the tag are rendered", async () => {
    openDoc({ children: [{ tagName: "p" }], tagName: "div" }, ["children", 0]);
    const c = await renderPanel();
    const labels = sectionLabels(c);
    expect(labels).toContain("Identity");
    expect(labels).toContain("Accessibility");
    expect(labels).not.toContain("Link");
    expect(labels).not.toContain("Table");
  });

  test("a set attribute auto-opens its section and marks it with a dot", async () => {
    openDoc({ children: [{ attributes: { href: "/x" }, tagName: "a" }], tagName: "div" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    const link = sectionNamed(c, "Link")!;
    expect(link).not.toBeNull();
    expect(link.open).toBe(true);
    expect(link.querySelector('[part="section-dot"]')).not.toBeNull();
  });

  test("the section dot states a count and no longer pretends to be a control", async () => {
    openDoc(
      {
        children: [{ attributes: { href: "/x", target: "_blank" }, tagName: "a" }],
        tagName: "div",
      },
      ["children", 0],
    );
    const c = await renderPanel();
    const dot = sectionNamed(c, "Link")!.querySelector('[part="section-dot"]')!;
    expect(dot.getAttribute("title")).toBe("2 values set in this section");
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    // It was a <span class="set-dot"> with a pointer cursor, a danger hover and no handler at all.
    expect(dot.tagName.toLowerCase()).toBe("span");
  });

  test("a section with nothing set draws no dot", async () => {
    openDoc({ children: [{ tagName: "a" }], tagName: "div" }, ["children", 0]);
    const c = await renderPanel();
    expect(sectionNamed(c, "Link")!.querySelector('[part="section-dot"]')).toBeNull();
  });

  test("text attribute commits after its debounce and clears via the set-dot", async () => {
    // <link> carries href in html-meta but is NOT an anchor, so it keeps the raw text widget
    // (the Link-target composite is scoped to a/area only).
    openDoc({ children: [{ attributes: { href: "/x" }, tagName: "link" }], tagName: "div" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    type(control(c, "href"), "/about");
    await sleep(460);
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toBe("/about");

    await renderPanel();
    const dot = chip(c, "href")!;
    expect(dot.getAttribute("title")).toBe("Clear href");
    dot.click();
    expect((docNow().children as JxMutableNode[])[0]!.attributes?.href).toBeUndefined();
  });

  test("boolean attribute renders a checkbox and clears via the set-dot", async () => {
    openDoc(
      { children: [{ attributes: { required: "required" }, tagName: "input" }], tagName: "div" },
      ["children", 0],
    );
    const c = await renderPanel();
    expect(control(c, "required").getAttribute("type")).toBe("checkbox");

    // Unchecking removes the attribute
    check(control(c, "required"), false);
    expect((docNow().children as JxMutableNode[])[0]!.attributes?.required).toBeUndefined();

    // Set it again and clear via the dot
    openDoc(
      { children: [{ attributes: { required: "required" }, tagName: "input" }], tagName: "div" },
      ["children", 0],
    );
    await renderPanel();
    chip(c, "required")!.click();
    expect((docNow().children as JxMutableNode[])[0]!.attributes?.required).toBeUndefined();
  });
});

// ─── Attribute dynamic slots (the value ladder) ───────────────────────────────

describe("attribute dynamic slots", () => {
  function linkDoc(href: unknown = "/x") {
    return {
      children: [{ attributes: { href }, tagName: "link" }],
      state: { alt: { default: "/alt" }, url: { default: "/x" } },
      tagName: "div",
    };
  }

  test("attribute rows carry a mode chip beside the label", async () => {
    openDoc(linkDoc(), ["children", 0]);
    const c = await renderPanel();
    const mode = row(c, "href").querySelector('[part="source"]')!;
    expect(mode.textContent!.trim()).toBe("Fixed value");
    expect(mode.querySelector('[part="control"]')!.getAttribute("title")).toBe(
      "Value source: Fixed value — click to change",
    );
  });

  test("switching to ref mode binds the first signal; the picker rebinds", async () => {
    openDoc(linkDoc(), ["children", 0]);
    const c = await renderPanel();
    await chooseValueSource(c, "href", "ref");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toEqual({
      $ref: "#/state/alt",
    });

    await renderPanel();
    commit(control(c, "href"), "#/state/url");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toEqual({
      $ref: "#/state/url",
    });
  });

  test("a bound attribute drops to a fixed value in ONE action", async () => {
    openDoc(linkDoc({ $ref: "#/state/url" }), ["children", 0]);
    const c = await renderPanel();
    await chooseValueSource(c, "href", "template");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toBe("${state.alt}");
  });

  test("leaving and re-entering Fixed value restores the attribute's former literal", async () => {
    openDoc(linkDoc(), ["children", 0]);
    const c = await renderPanel();
    await chooseValueSource(c, "href", "ref");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toEqual({
      $ref: "#/state/alt",
    });

    await renderPanel();
    await chooseValueSource(c, "href", "literal");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toBe("/x");
  });

  test("template-valued attribute renders the template field and commits edits", async () => {
    openDoc(linkDoc("${state.url}/feed"), ["children", 0]);
    const c = await renderPanel();
    expect(sourceLabel(c, "href")).toBe("Mixed text");
    const tf = control<HTMLInputElement>(c, "href");
    expect(tf.value).toBe("${state.url}/feed");
    commit(tf, "${state.alt}/feed");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toBe("${state.alt}/feed");
  });

  test("boolean attribute rows carry the mode chip and bind via ref", async () => {
    openDoc(
      {
        children: [{ attributes: { required: "required" }, tagName: "input" }],
        state: { mandatory: { default: true } },
        tagName: "div",
      },
      ["children", 0],
    );
    const c = await renderPanel();
    expect(row(c, "required").querySelector('[part="source"]')).not.toBeNull();
    await chooseValueSource(c, "required", "ref");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.required).toEqual({
      $ref: "#/state/mandatory",
    });
  });

  test("textContent row binds via ref mode and renders templates", async () => {
    openDoc(
      {
        children: [{ tagName: "p", textContent: "Hello" }],
        state: { msg: { default: "hi" } },
        tagName: "div",
      },
      ["children", 0],
    );
    const c = await renderPanel();
    expect(row(c, "textContent").querySelector('[part="source"]')).not.toBeNull();
    await chooseValueSource(c, "textContent", "ref");
    expect((docNow().children as JxMutableNode[])[0]!.textContent).toEqual({ $ref: "#/state/msg" });

    // Template-valued text content renders the raw ${} field
    openDoc({ children: [{ tagName: "p", textContent: "${state.msg}!" }], tagName: "div" }, [
      "children",
      0,
    ]);
    await renderPanel();
    expect(control<HTMLInputElement>(c, "textContent").value).toBe("${state.msg}!");
  });
});

// ─── Link-target control (anchor href / target) ───────────────────────────────

function pageRoutesSetup() {
  resetStudioState({ isSiteProject: true, projectConfig: null });
  installMockPlatform({
    listDirectory: (async (dir: string) => {
      if (dir === "pages") {
        return [
          { name: "index.json", path: "pages/index.json", type: "file" },
          { name: "about.json", path: "pages/about.json", type: "file" },
          { name: "notes.txt", path: "pages/notes.txt", type: "file" },
          { name: "blog", path: "pages/blog", type: "directory" },
        ];
      }
      if (dir === "pages/blog") {
        return [
          { name: "index.json", path: "pages/blog/index.json", type: "file" },
          { name: "[slug].json", path: "pages/blog/[slug].json", type: "file" },
        ];
      }
      return [];
    }) as never,
  });
}

function anchorDoc(attrs: Record<string, unknown>) {
  return { children: [{ attributes: attrs, tagName: "a" }], tagName: "div" };
}

function linkField(root: Element): HTMLElement | null {
  return root.querySelector('[data-prop="href"] [part="link-field"]');
}

describe("link-target control", () => {
  test("selected <a> renders the composite kind selector + value input", async () => {
    openDoc(anchorDoc({ href: "/about/" }), ["children", 0]);
    const c = await renderPanel();
    const field = linkField(c)!;
    expect(field).not.toBeNull();
    const kind = control<HTMLSelectElement>(c, "href", "link-kind");
    expect(kind.value).toBe("internal");
    expect(options(kind)).toEqual(["internal", "external", "anchor", "mailto", "tel"]);
    // Internal kind → route picker (a select, not a field)
    expect(field.querySelector('[part="link-value"]')!.tagName.toLowerCase()).toBe("jx-select");
  });

  test("changing kind to Email recomposes the href with the mailto scheme", async () => {
    openDoc(anchorDoc({ href: "a@b.com" }), ["children", 0]);
    const c = await renderPanel();
    commit(control(c, "href", "link-kind"), "mailto");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toBe("mailto:a@b.com");
  });

  test("entering an external URL composes and commits the href", async () => {
    openDoc(anchorDoc({ href: "https://old.com" }), ["children", 0]);
    const c = await renderPanel();
    expect(control<HTMLSelectElement>(c, "href", "link-kind").value).toBe("external");
    type(control(c, "href", "link-value"), "https://new.com");
    await sleep(460);
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toBe("https://new.com");
  });

  test("an anchor input target composes a #fragment href", async () => {
    openDoc(anchorDoc({ href: "#top" }), ["children", 0]);
    const c = await renderPanel();
    const input = control<HTMLInputElement>(c, "href", "link-value");
    expect(input.value).toBe("top");
    type(input, "footer");
    await sleep(460);
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toBe("#footer");
  });

  test("clearing the value via the set-dot removes the href attribute", async () => {
    openDoc(anchorDoc({ href: "https://x.com" }), ["children", 0]);
    const c = await renderPanel();
    chip(c, "href")!.click();
    expect((docNow().children as JxMutableNode[])[0]!.attributes?.href).toBeUndefined();
  });

  test("Internal picker lists routes derived from the pages/ tree", async () => {
    pageRoutesSetup();
    const tab = resetWorkspaceWithTab(anchorDoc({ href: "/about/" }) as JxMutableNode, {
      documentPath: "pages/index.json",
    });
    tab.session.selection = [["children", 0]] as never;

    // First pass kicks off the async recursive walk; the routes land a turn or two later.
    await renderPanel();
    await flush(6);
    const c = await renderPanel();
    const routes = options(control(c, "href", "link-value"));
    expect(routes).toContain("/");
    expect(routes).toContain("/about/");
    expect(routes).toContain("/blog/");
    expect(routes).toContain("/blog/:slug");
    // .txt files are not routes
    expect(routes).not.toContain("/notes/");
  });

  test("choosing a route from the Internal picker commits it as the href", async () => {
    pageRoutesSetup();
    const tab = resetWorkspaceWithTab(anchorDoc({ href: "/about/" }) as JxMutableNode, {
      documentPath: "pages/index.json",
    });
    tab.session.selection = [["children", 0]] as never;
    await renderPanel();
    await flush(6);
    const c = await renderPanel();
    commit(control(c, "href", "link-value"), "/blog/");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.href).toBe("/blog/");
  });

  test("a bound href ($ref) falls back to the raw widget, not the Link-target control", async () => {
    openDoc(anchorDoc({ href: { $ref: "#/state/url" } }), ["children", 0]);
    const c = await renderPanel();
    expect(linkField(c)).toBeNull();
    // The raw widget path renders inside the href row
    expect(c.querySelector('[data-prop="href"]')).not.toBeNull();
  });

  test("a template-string href (${…}) falls back to the raw widget", async () => {
    openDoc(anchorDoc({ href: "${item.url}" }), ["children", 0]);
    const c = await renderPanel();
    expect(linkField(c)).toBeNull();
    expect(c.querySelector('[data-prop="href"] jx-textfield')).not.toBeNull();
  });

  test("the target attribute is a real enum picker with all four keywords", async () => {
    openDoc(anchorDoc({ href: "/x", target: "_blank" }), ["children", 0]);
    const c = await renderPanel();
    const picker = control<HTMLSelectElement>(c, "target");
    expect(picker.value).toBe("_blank");
    expect(options(picker)).toEqual(["", "_self", "_blank", "_parent", "_top"]);
  });

  test("target picker change commits; the empty row clears the attribute", async () => {
    openDoc(anchorDoc({ href: "/x", target: "_blank" }), ["children", 0]);
    const c = await renderPanel();
    commit(control(c, "target"), "_self");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.target).toBe("_self");

    await renderPanel();
    commit(control(c, "target"), "");
    expect((docNow().children as JxMutableNode[])[0]!.attributes?.target).toBeUndefined();
  });

  test("a listing failure degrades the route picker to the value it already holds", async () => {
    resetStudioState({ isSiteProject: true, projectConfig: null });
    installMockPlatform({
      listDirectory: (async () => {
        throw new Error("nope");
      }) as never,
    });
    const tab = resetWorkspaceWithTab(anchorDoc({ href: "/about/" }) as JxMutableNode, {
      documentPath: "pages/index.json",
    });
    tab.session.selection = [["children", 0]] as never;
    await renderPanel();
    await flush(6);
    const c = await renderPanel();
    // Only the stand-in row for the current href survives; no enumerated routes. The kit's select
    // Synthesises it rather than letting the control lie about what it holds.
    expect(options(control(c, "href", "link-value"))).toEqual(["/about/"]);
  });
});

// ─── Custom attributes section ────────────────────────────────────────────────

describe("custom attributes section", () => {
  const kvKeys = (root: Element) =>
    [...root.querySelectorAll('[part="kv-key"] [part="input"]')].map(
      (el) => (el as HTMLInputElement).value,
    );

  test("unknown attributes land in the auto-opened Custom section", async () => {
    openDoc(
      { children: [{ attributes: { "data-x": "1", id: "foo" }, tagName: "div" }], tagName: "div" },
      ["children", 0],
    );
    const c = await renderPanel();
    const custom = section(c, "__custom")!;
    expect(custom).not.toBeNull();
    expect(custom.open).toBe(true);
    expect(custom.querySelector('[part="section-dot"]')).not.toBeNull();
    // Only data-x is custom; id is a known html attribute
    expect(kvKeys(custom)).toEqual(["data-x"]);
  });

  test("component prop names are excluded from custom attributes", async () => {
    registerCard();
    openDoc({ children: [{ attributes: { title2: "x" }, tagName: "my-card" }], tagName: "div" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    expect(kvKeys(section(c, "__custom")!)).toEqual(["title2"]);
  });

  test("the remove button takes the attribute away immediately", async () => {
    openDoc({ children: [{ attributes: { "data-x": "1" }, tagName: "div" }], tagName: "div" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    const remove = section(c, "__custom")!.querySelector(
      '[part="kv-remove"] [part="control"]',
    ) as HTMLElement;
    expect(remove.getAttribute("aria-label")).toBe("Remove data-x");
    remove.click();
    expect((docNow().children as JxMutableNode[])[0]!.attributes?.["data-x"]).toBeUndefined();
  });

  test("+ Add attribute runs without mutating (an empty value is a delete)", async () => {
    openDoc({ children: [{ attributes: { "data-x": "1" }, tagName: "div" }], tagName: "div" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    action(section(c, "__custom")!, "+ Add attribute")!.click();
    expect(Object.keys((docNow().children as JxMutableNode[])[0]!.attributes!)).toEqual(["data-x"]);
  });
});

// ─── Debounced edits (real timers, consolidated) ──────────────────────────────

describe("debounced edits", () => {
  test("tag rename and custom attr rename commit after their debounce", async () => {
    openDoc(
      { attributes: { "data-keep": "old", "data-x": "1" }, children: [], tagName: "div" },
      [],
    );
    const c = await renderPanel();

    // Tag rename
    type(control(c, "tagName"), "section");

    // Custom attribute rename + value, on the same row: both cells land together.
    const xRow = row(section(c, "__custom")!, "data-x");
    type(xRow.querySelector('[part="kv-key"] [part="input"]')!, "data-y");
    type(xRow.querySelector('[part="kv-val"] [part="input"]')!, "2");

    // Same-key value-only edit on data-keep
    const keepRow = row(section(c, "__custom")!, "data-keep");
    type(keepRow.querySelector('[part="kv-val"] [part="input"]')!, "new");

    await sleep(700);

    const doc = docNow() as unknown as { tagName: string; attributes: Record<string, unknown> };
    expect(doc.tagName).toBe("section");
    expect(doc.attributes["data-x"]).toBeUndefined();
    expect(doc.attributes["data-y"]).toBe("2");
    expect(doc.attributes["data-keep"]).toBe("new");
  });

  test("number prop commits after the number-field debounce", async () => {
    registerCard();
    openDoc(cardDoc(), ["children", 0]);
    const c = await renderPanel();
    type(control(c, "count"), "5");
    await sleep(460);
    expect((docNow().children as JxMutableNode[])[0]!.$props!.count).toBe("5");
  });
});

// ─── The Tag row ──────────────────────────────────────────────────────────────

describe("the Tag row is a bindable slot like any other", () => {
  /*
   * `tagName` may be a literal name or a `TagExpression` choosing between names. It was one
   * hardcoded textfield, which for a choice rendered `[object Object]` and let the first keystroke
   * replace the whole expression with whatever was typed. It is now the shared Value Source slot —
   * the same chip and the same expression editor as `href`, a style declaration or a handler.
   */
  const chosen = {
    $expression: {
      initial: "div",
      operator: "?:" as const,
      target: { $ref: "#/state/href" },
      value: "a",
    },
  };

  test("a fixed tag shows Fixed value and a typeable field", async () => {
    openDoc({ children: [{ children: [], tagName: "section" }], tagName: "x-card" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    expect(sourceLabel(c, "tagName")).toBe("Fixed value");
    expect(control<HTMLInputElement>(c, "tagName").value).toBe("section");
  });

  test("a chosen tag shows Formula, and never renders the object into a field", async () => {
    openDoc({ children: [{ children: [], tagName: chosen }], tagName: "x-card" }, ["children", 0]);
    const c = await renderPanel();
    expect(sourceLabel(c, "tagName")).toBe("Formula");
    expect(row(c, "tagName").textContent).not.toContain("[object Object]");
    expect(row(c, "tagName").querySelector('[part="control-host"]')).not.toBeNull();
  });

  test("the rungs are the two the schema permits — no template rung", async () => {
    // Derived from `SLOT_POSITION_SCHEMAS.elementTag`, not hand-listed. A `${…}` in tag position is
    // What the `TagName` pattern exists to reject, so the rung is correctly absent.
    expect(capsForPosition("elementTag")).toEqual(["literal", "expression"]);
    openDoc({ children: [{ children: [], tagName: "section" }], tagName: "x-card" }, [
      "children",
      0,
    ]);
    const c = await renderPanel();
    expect(await offeredRungs(c, "tagName")).toEqual(["literal", "expression"]);
  });
});

// ─── Definition vs instance ───────────────────────────────────────────────────

describe("editing a component definition is not editing an instance of it", () => {
  /*
   * A component's own root tag has a hyphen, so the old test — "the tag contains a dash" — said
   * yes to both. Open the component itself and the panel drew the INSTANCE form over the
   * definition: fields writing `$props` onto the definition's own root, and a "from the component"
   * badge whose click opened the document already in front of you.
   *
   * The distinguishing fact is whose document this is.
   */
  function openAs(documentPath: string) {
    componentRegistry.length = 0;
    componentRegistry.push({
      path: "components/my-card.json",
      props: [{ default: "Untitled", name: "title", type: "string" }],
      source: "project",
      tagName: "my-card",
    } as never);
    const tab = resetWorkspaceWithTab({
      children: [],
      state: { title: { default: "Untitled", type: "string" } },
      tagName: "my-card",
    } as never);
    tab.documentPath = documentPath;
    tab.session.selection = [[]] as never;
    return tab;
  }

  test("the definition shows DEFAULTS, and offers no jump to itself", async () => {
    openAs("components/my-card.json");
    const c = await renderPanel();
    expect(section(c, "__props")!.label).toBe("Component Defaults");
    // "→ Edit definition" from inside the definition is a link to here.
    expect(c.textContent).not.toContain("Edit definition");
    // …and the donor badge cannot say "from the component" when it IS the component.
    expect(c.textContent).not.toContain("the component default");
  });

  test("an instance keeps the settings form, the donor and the jump", async () => {
    componentRegistry.length = 0;
    componentRegistry.push({
      path: "components/my-card.json",
      props: [{ default: "Untitled", name: "title", type: "string" }],
      source: "project",
      tagName: "my-card",
    } as never);
    const tab = resetWorkspaceWithTab({
      children: [{ children: [], tagName: "my-card" }],
      tagName: "div",
    } as never);
    tab.documentPath = "pages/index.json";
    tab.session.selection = [["children", 0]] as never;
    const c = await renderPanel();
    expect(section(c, "__props")!.label).toBe("Component Settings");
    expect(c.textContent).toContain("Edit definition");
  });

  test("a default typed in the definition lands on the state entry, not on $props", async () => {
    const tab = openAs("components/my-card.json");
    const c = await renderPanel();
    type(control(c, "title"), "A card");
    await sleep(450);
    const doc = tab.doc.document as JxMutableNode & {
      state?: Record<string, { default?: unknown }>;
      $props?: Record<string, unknown>;
    };
    expect(doc.state?.title?.default).toBe("A card");
    expect(doc.$props).toBeUndefined();
  });
});

// ─── popovertarget ────────────────────────────────────────────────────────────

describe("popovertarget control", () => {
  /** A trigger and two panels, so the picker has real ids to offer. */
  function popoverDoc(triggerAttrs: Record<string, unknown> = {}) {
    return {
      children: [
        { attributes: { ...triggerAttrs }, tagName: "button" },
        { attributes: { id: "site-menu", popover: "auto" }, tagName: "nav" },
        { attributes: { id: "search", popover: "auto" }, tagName: "div" },
        { attributes: { id: "not-a-popover" }, tagName: "section" },
      ],
      tagName: "div",
    };
  }

  test("a <button> gets a picker over the document's popovers, not a text field", async () => {
    openDoc(popoverDoc({ popovertarget: "site-menu" }), ["children", 0]);
    const c = await renderPanel();
    const picker = control<HTMLSelectElement>(c, "popovertarget");
    // The ids that carry `popover`, and nothing else — `#not-a-popover` is absent, which is the
    // Whole point: a free-text field is what let six invokers name the wrong panel.
    expect(options(picker)).toEqual(["", "site-menu", "search", "jx:other"]);
    expect(picker.value).toBe("site-menu");
  });

  test("choosing an id commits it", async () => {
    openDoc(popoverDoc({ popovertarget: "site-menu" }), ["children", 0]);
    const c = await renderPanel();
    commit(control(c, "popovertarget"), "search");
    expect((docNow().children as JxMutableNode[])[0]!.attributes!.popovertarget).toBe("search");
  });

  test("an id from another file stays selected and offered — the list cannot be complete", async () => {
    // A popovertarget resolves in the RENDERED DOM, and a page composes components whose internals
    // This document cannot see. So the picker offers what it can prove and refuses nothing.
    openDoc(popoverDoc({ popovertarget: "in-a-component" }), ["children", 0]);
    const c = await renderPanel();
    const picker = control<HTMLSelectElement>(c, "popovertarget");
    expect(options(picker)).toEqual(["in-a-component", "", "site-menu", "search", "jx:other"]);
    expect(picker.value).toBe("in-a-component");
  });

  test("a bound value falls through to the raw widget so it stays an expression", async () => {
    openDoc(popoverDoc({ popovertarget: "${state.which}" }), ["children", 0]);
    const c = await renderPanel();
    expect(row(c, "popovertarget").querySelector("jx-select")).toBeNull();
    expect(row(c, "popovertarget").querySelector("jx-textfield")).not.toBeNull();
  });

  test("a non-invoker element is never offered the attribute at all", async () => {
    // `popovertarget` is declared `$elements: ["button", "input"]`, because the IDL mixin that
    // Defines it is included into exactly those two interfaces.
    openDoc(popoverDoc(), ["children", 3]);
    const c = await renderPanel();
    expect(c.querySelector('[data-prop="popovertarget"]')).toBeNull();
  });
});
