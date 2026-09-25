/**
 * Right panel — the Inspector dock: four text-labelled tabs, one dock, one column.
 *
 * The dock is `src/surfaces/inspector-dock.json` now, so everything here is addressed by ROLE, by
 * `part` or by the region grammar: there is no `sp-tabs`, no `sp-tab` and no `.panel-body` to find.
 * That is not a translation of the old selectors — the strip is a real `tablist` with real
 * `tabpanel`s on the other end, which it never was, and the pairing between the two is what several
 * of these tests assert.
 *
 * Every draw is awaited: `mountSurface` is asynchronous and each kit element settles its own
 * template one `connectedCallback` after that.
 */
import { flush, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { initShellRefs, rightPanel, updateUi } from "../src/store";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { INSPECTOR_TAB_IDS, setLayoutSelection, shell } from "../src/shell";
import { INSPECTOR_TABS } from "../src/commands/defaults";

const { inspectorTab, mount, render, setInspectorTab, unmount } =
  await import("../src/panels/right-panel");

const mountAssistant = mock((_host: HTMLElement) => {});

function makeCtx() {
  return {
    getCanvasMode: mock(() => "design"),
    mountAssistant,
    navigateToComponent: mock(() => {}),
    renderCanvas: mock(() => {}),
  };
}

/** The strip. */
function tablist(): HTMLElement | null {
  return rightPanel.querySelector<HTMLElement>('[role="tablist"]');
}

/** The tabs, in strip order. */
function tabs(): HTMLElement[] {
  return [...rightPanel.querySelectorAll<HTMLElement>('[role="tab"]')];
}

/** The tab panels, in document order. */
function panels(): HTMLElement[] {
  return [...rightPanel.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
}

/** The tab bodies that are showing. Exactly one, always. */
function visibleBodies(): HTMLElement[] {
  const bodies: HTMLElement[] = [];
  for (const panel of rightPanel.querySelectorAll<HTMLElement>('[role="tabpanel"]:not([hidden])')) {
    bodies.push(...panel.querySelectorAll<HTMLElement>('[part="panel-body"]'));
  }
  return bodies;
}

/** The header's two spans. */
function headerTitle(): string {
  return rightPanel.querySelector('[part="header-title"]')?.textContent ?? "";
}

function headerTarget(): string {
  return rightPanel.querySelector('[part="header-target"]')?.textContent?.trim() ?? "";
}

/** Activate a tab the way a pointer does — the tab dispatches `select`, the strip answers. */
function clickTab(value: string): void {
  const tab = tabs().find((el) => el.getAttribute("value") === value);
  tab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = `<div id="app">
    <div id="toolbar"></div><div id="activity-bar"></div><div id="left-panel"></div>
    <div id="canvas-wrap"></div><div id="right-panel"></div>
    <div id="statusbar"></div>
  </div>`;
  initShellRefs();
  resetStudioState();
  mountAssistant.mockClear();
});

afterEach(() => {
  unmount();
  closeAllTabs();
  shell.layoutSelection = null;
});

describe("the four tabs", () => {
  test("mount + render shows four text-labelled tabs and the Content body", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    expect(tablist()).not.toBeNull();
    expect(tabs().map((el) => el.getAttribute("label"))).toEqual([
      "Content",
      "Style",
      "Logic",
      "Assistant",
    ]);
    expect(visibleBodies().length).toBe(1);
  });

  test("the strip is a named tablist and each tab is paired with a panel", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    /* The whole point of the conversion: `sp-tabs` announced a selected tab that controlled
       nothing, because the four bodies were anonymous divs. Every tab now names a panel and every
       panel names the tab back, so the two ids have to resolve to each other — a pairing minted
       from one key in the projection, and asserted here because nothing else can check it. */
    expect(tablist()?.getAttribute("aria-label")).toBe("Inspector");
    expect(tabs()).toHaveLength(4);
    for (const tab of tabs()) {
      const panelId = tab.getAttribute("aria-controls") ?? "";
      const panel = rightPanel.querySelector(`#${panelId}`);
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(tab.id).not.toBe("");
    }
  });

  test("exactly one panel is showing, and it is the one whose tab is selected", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    const showing = panels().filter((panel) => !panel.hasAttribute("hidden"));
    expect(showing).toHaveLength(1);
    const selected = tabs().filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(showing[0]?.id).toBe(selected[0]?.getAttribute("aria-controls") ?? "");

    setInspectorTab("style");
    await flush(4);
    const afterSwitch = panels().filter((panel) => !panel.hasAttribute("hidden"));
    expect(afterSwitch).toHaveLength(1);
    expect(afterSwitch[0]?.dataset.tab).toBe("style");
  });

  test("the tab ids and the tab titles are the same list, in the same order", () => {
    // Two declarations, deliberately: `shell.ts` owns the enum `view.setRightTab` validates
    // Against, and `commands/defaults.ts` owns the titles ⌘⇧1–4 and the chrome budget read —
    // Because that module has to load in a bare Bun process. This is the guard against drift, the
    // Same one `tests/navigator-panels.test.ts` runs for the rail.
    expect(INSPECTOR_TABS.map((tab) => tab.id)).toEqual([...INSPECTOR_TAB_IDS]);
  });

  test("every tab body is addressable as `inspector/tab:<id>`", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    const regions = [...rightPanel.querySelectorAll<HTMLElement>('[part="panel-body"]')].map(
      (el) => el.dataset.jxRegion,
    );
    expect(regions).toEqual(INSPECTOR_TAB_IDS.map((id) => `inspector/tab:${id}`));
  });

  test("the Assistant tab's body is handed to its owner exactly once", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    render();
    setInspectorTab("assistant");
    setInspectorTab("properties");
    await flush(4);
    expect(mountAssistant).toHaveBeenCalledTimes(1);
    const [host] = mountAssistant.mock.calls[0] as [HTMLElement];
    expect(host.dataset.jxRegion).toBe("inspector/tab:assistant");
  });

  test("a body host survives every repaint of the dock", async () => {
    /* The four containers were hand-built once and remembered in a module Map, because rebuilding
       them drops the Assistant's transcript and the Content tab's mounted document. They are rows
       of a keyed `$map` over a constant list now, so this asserts the property rather than the
       mechanism: the same element, before and after a projection that changes every other thing
       the dock draws. */
    const tab = resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    const before = rightPanel.querySelector('[data-jx-region="inspector/tab:assistant"]');
    const marker = document.createElement("span");
    before!.append(marker);
    setInspectorTab("style");
    tab.session.selection = [["children", 0]];
    await flush(4);
    const after = rightPanel.querySelector('[data-jx-region="inspector/tab:assistant"]');
    expect(after).toBe(before);
    expect(marker.isConnected).toBe(true);
  });

  test("routes to Logic and Style", async () => {
    resetWorkspaceWithTab();
    const ctx = makeCtx();
    mount(ctx as never);
    for (const tabName of ["events", "style"]) {
      updateUi(activeTab.value, "rightTab", tabName);
      render();
      await flush(4);
      expect(visibleBodies().length).toBe(1);
    }
    expect(ctx.getCanvasMode).toHaveBeenCalled();
  });

  test("an undeclared stored tab coerces to Content", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    updateUi(activeTab.value, "rightTab", "content");
    render();
    await flush(4);
    expect(inspectorTab()).toBe("properties");
    expect(tablist()?.getAttribute("selected")).toBe("properties");
  });

  test("activating a tab switches the dock, and re-activating it says nothing", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    clickTab("style");
    await flush(4);
    expect(activeTab.value?.session.ui.rightTab).toBe("style");
    // The tab that is already current dispatches no `change` at all, so the write never repeats.
    updateUi(activeTab.value, "rightTab", "style");
    clickTab("style");
    await flush(2);
    expect(activeTab.value?.session.ui.rightTab).toBe("style");
  });

  test("an id the enum does not declare cannot select anything", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    /* The strip states a value and the flow decides what it means. Dispatched at the strip rather
       than clicked, because no tab in this document carries an undeclared value — which is the
       point: the refusal has to hold for a `change` that arrives from anywhere. */
    tablist()?.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: "nonsense" }));
    await flush(2);
    expect(inspectorTab()).toBe("properties");
  });
});

describe("the header names its target", () => {
  test("with a selection it names the node", async () => {
    const tab = resetWorkspaceWithTab();
    tab.session.selection = [["children", 0]];
    mount(makeCtx() as never);
    render();
    await flush(4);
    expect(headerTitle()).toBe("Content");
    expect(headerTarget()).toBeTruthy();
  });

  test("with no selection it names the document, and with no document says so", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    expect(headerTarget()).not.toBe("no document");

    closeAllTabs();
    render();
    await flush(4);
    expect(headerTarget()).toBe("no document");
  });

  test("the header follows the selected tab's name", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    expect(headerTitle()).toBe("Content");
    setInspectorTab("assistant");
    await flush(4);
    expect(headerTitle()).toBe("Assistant");
  });
});

describe("the layout selection", () => {
  const headerHit = {
    className: "site-header",
    layoutFile: "layouts/base.json",
    layoutPath: ["children", 0, "children", 0],
    rect: { height: 40, width: 800, x: 0, y: 0 },
    tagName: "header",
  };

  test("clicking layout chrome repaints the dock on its own, and Content answers", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);

    // No renderOnly, no selection change — only the shell record the canvas host writes.
    setLayoutSelection(headerHit as never);
    await flush(4);

    const body = visibleBodies()[0]!;
    /* The Content tab is a document now, so its sections are `jx-accordion-item`s addressed by the
       key `inspector.setSection` uses — `label` is a property on the kit element rather than an
       attribute a selector can match, which is why this reads the section by key and then its
       heading. */
    const layout = body.querySelector('[data-section="__layout"]') as
      | (HTMLElement & { label?: string })
      | null;
    expect(layout).not.toBeNull();
    expect(layout!.label).toBe("Layout Element");
    expect(body.textContent).toContain("<header>");
    expect(body.textContent).toContain("layouts/base.json");
  });

  test("the header names the layout element AND the file it came from", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    setLayoutSelection(headerHit as never);
    await flush(4);
    expect(headerTarget()).toBe("<header> in layouts/base.json");
  });

  test("the inspector header names the BATCH when several elements are selected (§6.5)", async () => {
    const tab = resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    tab.session.selection = [["children", 0]];
    await flush(4);
    expect(headerTarget()).not.toBe("2 elements");
    tab.session.selection = [["children", 0], []];
    await flush(4);
    expect(headerTarget()).toBe("2 elements");
  });

  test("releasing it puts the dock back on the document", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    setLayoutSelection(headerHit as never);
    await flush(4);
    setLayoutSelection(null);
    await flush(4);
    expect(visibleBodies()[0]!.querySelector('[data-section="__layout"]')).toBeNull();
  });
});

describe("with no document open", () => {
  test("the strip stays, and the selected tab teaches what IT needs", async () => {
    closeAllTabs();
    mount(makeCtx() as never);
    render();
    await flush(4);
    // The strip does NOT vanish: the Assistant works with no document, so the dock has to stay
    // Navigable — which is why the containers are permanent now rather than rebuilt per render.
    expect(tablist()).not.toBeNull();
    /* The dock's own "Open a page to inspect and style what you click" is gone with the last tab
       body it rendered: all four tabs are mounted documents that keep themselves current, so each
       draws the no-document state in ITS own words. That is the same contract stated one level
       down — a dock with no file still says what to do — and it is asserted at the tab that says
       it, which is what the Style tab's `[part="empty-message"]` is. */
    setInspectorTab("style");
    await flush(4);
    // Scoped to the tab's own container: every tab's document is in the DOM at once (they are
    // Shown and hidden rather than rebuilt), so an unscoped query finds whichever teaches first.
    const styleBody = rightPanel.querySelector('[data-jx-region="inspector/tab:style"]')!;
    expect(styleBody.querySelector('[part="empty-message"]')?.textContent).toBe(
      "Open a page to style what you click.",
    );
  });

  test("the selection falls back to the module's own field, and survives a tab opening", async () => {
    closeAllTabs();
    mount(makeCtx() as never);
    setInspectorTab("assistant");
    await flush(4);
    expect(inspectorTab()).toBe("assistant");
    expect(tablist()?.getAttribute("selected")).toBe("assistant");
    // A document brings its OWN remembered tab — the detached one was never the document's.
    resetWorkspaceWithTab();
    render();
    await flush(4);
    expect(inspectorTab()).toBe("properties");
  });

  test("the no-document state is replaced when a tab opens", async () => {
    closeAllTabs();
    mount(makeCtx() as never);
    render();
    await flush(4);
    resetWorkspaceWithTab();
    render();
    await flush(4);
    expect(rightPanel.textContent).not.toContain("Open a page to inspect");
    expect(tablist()).not.toBeNull();
  });
});

describe("lifecycle", () => {
  test("unmount takes the document down; render after unmount is a no-op", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    await flush(4);
    expect(tablist()).not.toBeNull();
    unmount();
    await flush(2);
    expect(tablist()).toBeNull();
    expect(() => render()).not.toThrow();
    await flush(2);
    expect(tablist()).toBeNull();
  });

  test("render before mount is a no-op", () => {
    expect(() => render()).not.toThrow();
  });

  test("a remount leaves ONE dock, not two", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    await flush(4);
    unmount();
    mount(makeCtx() as never);
    await flush(4);
    // The document mount APPENDS, so the cell is cleared first — without that, every query below
    // Would silently pick whichever dock happened to be first.
    expect(rightPanel.querySelectorAll('[role="tablist"]')).toHaveLength(1);
    expect(rightPanel.querySelectorAll('[part="panel-body"]')).toHaveLength(4);
  });
});
