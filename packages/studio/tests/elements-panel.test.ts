/**
 * The Insert panel — `src/panels/elements-panel.ts` and the surface it mounts,
 * `src/surfaces/panel-elements.{json,ts}`: the category accordion, the filter, insertion by click,
 * and the component section (npm enablement via `$elements`, instances built with `$props`).
 *
 * Everything is addressed by `part` and by `data-section` / `data-block-tag` /
 * `data-component-tag`, because the panel is a document now: `renderElementsTemplate` is gone, the
 * accordion is the kit's and the filter field is a `jx-textfield`. Three class names survive and
 * are asserted here on purpose — `.element-card`, `.element-card-preview` and `.components-section`
 * are what `panels/dnd.ts` addresses by selector to hang a drag on a card and fill its preview, so
 * a conversion that quietly dropped them would take drag-and-drop with it and no other test would
 * notice.
 *
 * The mount is asynchronous — the kit has to be defined before a document can render — so every
 * setup awaits it.
 */
import { flush, installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mountElementsPanel } from "../src/panels/elements-panel";
import { mountElementsSurface } from "../src/surfaces/panel-elements";
import { loadComponentRegistry } from "../src/files/components";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { view } from "../src/view";
import type { ComponentEntry } from "../src/files/components";
import type { ElementsActions, ElementsValues } from "../src/surfaces/panel-elements";
import type { NavigatorPanelContext } from "../src/panels/panel-registry";
import type { StudioPlatform } from "../src/types";
import type { JxMutableNode } from "@jxsuite/schema/types";

const WEBDATA = {
  elements: {
    Media: [{ tag: "img" }],
    Text: [{ tag: "h1" }, { tag: "p" }],
  },
};

function defaultDef(tag: string): JxMutableNode {
  return { tagName: tag, textContent: `New ${tag}` };
}

let host: HTMLElement;
let deps: Record<string, any>;

/** The panel host the Navigator paints: a `.panel-body` with the `.panel-content` lit owns in it. */
function makeHost(): HTMLElement {
  const body = document.createElement("div");
  body.className = "panel-body";
  const content = document.createElement("div");
  content.className = "panel-content";
  body.append(content);
  document.body.append(body);
  return body;
}

/** A projection with nothing in it — enough to mount the surface on its own. */
function blankValues(): ElementsValues {
  return {
    categories: [],
    components: [],
    componentsOpen: true,
    emptyState: "empty",
    filter: "",
    hasComponents: false,
  };
}

/** The surface mounted on its own answers to nobody: none of these is expected to run. */
const NO_ACTIONS: ElementsActions = {
  clearFilter: () => {},
  insertComponent: () => {},
  insertElement: () => {},
  setComponentsOpen: () => {},
  setFilter: () => {},
  setSectionOpen: () => {},
};

/** Mount the panel into a fresh host and let the document render. */
async function renderElements(webdata: unknown = WEBDATA): Promise<HTMLElement> {
  host = makeHost();
  deps = {
    defaultDef,
    registerComponentsDnD: mock(() => {}),
    registerElementsDnD: mock(() => {}),
    webdata,
  };
  mountElementsPanel(
    { deps, doc: null, rerender: () => {} } as unknown as NavigatorPanelContext,
    host,
  );
  await flush();
  await flush();
  return host;
}

async function seedRegistry(entries: ComponentEntry[]) {
  installMockPlatform({
    discoverComponents: (async () => entries) as StudioPlatform["discoverComponents"],
  });
  await loadComponentRegistry();
}

/** The section labelled `name`, as the kit's accordion item. */
function section(name: string): HTMLElement & { open: boolean } {
  const el = host.querySelector(`[data-section="${name}"]`);
  if (!el) {
    throw new Error(`no "${name}" section in the palette`);
  }
  return el as HTMLElement & { open: boolean };
}

/** Every section label in the palette, in the order the accordion draws them. */
function sectionNames(): string[] {
  return [...host.querySelectorAll("[data-section]")].map(
    (el) => (el as HTMLElement).dataset.section as string,
  );
}

/** The filter field's own control — a native input, drawn by `jx-textfield`. */
function filterInput(): HTMLInputElement {
  const el = host.querySelector('[part="filter"] [part="input"]');
  if (!el) {
    throw new Error("no control in the palette's filter field");
  }
  return el as HTMLInputElement;
}

/** Type into the filter, the way a reader does: the control's value, then `input`. */
async function typeFilter(text: string): Promise<void> {
  const input = filterInput();
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

/** Open or close a section through the kit's own `toggle`, the way the platform announces one. */
async function toggleSection(name: string, open: boolean): Promise<void> {
  const item = section(name);
  const details = item.querySelector("details");
  if (details) {
    (details as HTMLDetailsElement).open = open;
    details.dispatchEvent(new Event("toggle"));
  } else {
    item.dispatchEvent(new CustomEvent("toggle", { bubbles: true, detail: open }));
  }
  await flush();
}

beforeEach(async () => {
  document.body.innerHTML = "";
  view.elementsFilter = "";
  view.elementsCollapsed = new Set();
  resetStudioState();
  resetWorkspaceWithTab({ children: [], tagName: "div" });
  await seedRegistry([]);
});

afterEach(() => {
  closeAllTabs();
  document.body.innerHTML = "";
});

describe("Insert panel — categories and filter", () => {
  test("renders one accordion section per category, with a card per element", async () => {
    await renderElements();
    expect(sectionNames()).toEqual(["Media", "Text"]);
    const tags = [...host.querySelectorAll(".element-card")].map(
      (card) => (card as HTMLElement).dataset.blockTag,
    );
    expect(tags).toEqual(["img", "h1", "p"]);
    expect(host.querySelector('[part="empty"]')).toBeNull();
  });

  test("an element card's preview is left empty for dnd.ts to fill", async () => {
    await renderElements();
    const preview = host.querySelector('[data-block-tag="p"] .element-card-preview');
    expect(preview).not.toBeNull();
    expect(preview!.firstChild).toBeNull();
    expect(host.querySelector('[data-block-tag="p"] .element-card-label')?.textContent).toBe("<p>");
  });

  test("a filter set before the mount hides non-matching elements and empty categories", async () => {
    view.elementsFilter = "h1";
    await renderElements();
    expect(sectionNames()).toEqual(["Text"]);
    expect(host.querySelectorAll(".element-card").length).toBe(1);
  });

  test("typing in the filter narrows the palette without a repaint", async () => {
    await renderElements();
    await typeFilter("IMG");
    expect(view.elementsFilter).toBe("IMG");
    expect(sectionNames()).toEqual(["Media"]);
    // The echo: the field keeps what was typed, case and all — the scope is never a normalised
    // Copy of it, which is what would put the caret back mid-word.
    expect(filterInput().value).toBe("IMG");
  });

  test("clearing the filter brings the whole palette back", async () => {
    await renderElements();
    await typeFilter("img");
    expect(sectionNames()).toEqual(["Media"]);
    await typeFilter("");
    expect(sectionNames()).toEqual(["Media", "Text"]);
  });

  test("a collapsed category is drawn closed", async () => {
    view.elementsCollapsed.add("Text");
    await renderElements();
    expect(section("Text").open).toBe(false);
    expect(section("Media").open).toBe(true);
  });

  test("toggling a section records the disclosure both ways", async () => {
    await renderElements();
    await toggleSection("Media", false);
    expect(view.elementsCollapsed.has("Media")).toBe(true);
    await toggleSection("Media", true);
    expect(view.elementsCollapsed.has("Media")).toBe(false);
  });
});

describe("Insert panel — element insertion", () => {
  test("clicking a card inserts the default def at the selection", async () => {
    await renderElements();
    const card = host.querySelector('[data-block-tag="h1"]') as HTMLElement;
    card.click();
    const children = activeTab.value!.doc.document.children as JxMutableNode[];
    expect(children.length).toBe(1);
    expect(children[0]).toEqual({ tagName: "h1", textContent: "New h1" });
  });

  test("inserts into the selected parent node", async () => {
    resetWorkspaceWithTab({
      children: [{ children: [{ tagName: "p", textContent: "x" }], tagName: "section" }],
      tagName: "div",
    });
    activeTab.value!.session.selection = [["children", 0]];
    await renderElements();
    (host.querySelector('[data-block-tag="img"]') as HTMLElement).click();
    const parent = (activeTab.value!.doc.document.children as JxMutableNode[])[0]!;
    const kids = parent.children as JxMutableNode[];
    expect(kids.length).toBe(2);
    expect(kids[1]!.tagName).toBe("img");
  });

  test("a click with no open document inserts nothing rather than throwing", async () => {
    await renderElements();
    closeAllTabs();
    (host.querySelector('[data-block-tag="p"]') as HTMLElement).click();
    expect(activeTab.value).toBeNull();
  });
});

describe("Insert panel — components", () => {
  const projectComp: ComponentEntry = {
    path: "components/my-card.json",
    props: [{ name: "title" }],
    source: "project",
    tagName: "my-card",
  } as ComponentEntry;
  const npmModuleComp: ComponentEntry = {
    modulePath: "dist/fancy-button.js",
    package: "@acme/widgets",
    props: [{ default: "go", name: "label" }],
    source: "npm",
    tagName: "fancy-button",
  } as ComponentEntry;
  const npmPkgComp: ComponentEntry = {
    package: "@acme/extras",
    props: [],
    source: "npm",
    tagName: "extra-thing",
  } as ComponentEntry;

  /** The tag of every component card on screen. */
  function componentTags(): (string | undefined)[] {
    return [...host.querySelectorAll("[data-component-tag]")].map(
      (card) => (card as HTMLElement).dataset.componentTag,
    );
  }

  test("no components section when the registry is empty", async () => {
    await renderElements();
    expect(host.querySelector(".components-section")).toBeNull();
    expect(sectionNames()).not.toContain("components");
    /* Hidden rather than merely empty: `jx-accordion` gives a top border to every child that
       follows a VISIBLE one, so a slot left visible would rule a line above the first category. */
    expect(host.querySelector('[part="components-slot"]')?.hasAttribute("hidden")).toBe(true);
  });

  test("npm components stay hidden unless the document enables them", async () => {
    await seedRegistry([projectComp, npmModuleComp, npmPkgComp]);
    await renderElements();
    expect(componentTags()).toEqual(["my-card"]);
    expect(host.querySelector('[part="components-slot"]')?.hasAttribute("hidden")).toBe(false);
    // The components section is drawn first, and dnd.ts finds its rows by this container.
    expect(host.querySelector(".components-section [data-component-tag]")).not.toBeNull();
    expect(sectionNames()[0]).toBe("components");
  });

  test("an $elements entry naming package/modulePath enables that one component", async () => {
    await seedRegistry([projectComp, npmModuleComp, npmPkgComp]);
    resetWorkspaceWithTab({
      $elements: ["@acme/widgets/dist/fancy-button.js"],
      children: [],
      tagName: "div",
    } as unknown as JxMutableNode);
    await renderElements();
    expect(componentTags()).toContain("fancy-button");
    expect(componentTags()).not.toContain("extra-thing");
    const card = host.querySelector('[data-component-tag="fancy-button"]') as HTMLElement;
    expect(card.getAttribute("title")).toBe("@acme/widgets: <fancy-button>");
    expect(card.querySelector('[part="component-tag"]')?.textContent).toBe("<fancy-button>");
  });

  test("a bare package entry enables every component from that package", async () => {
    await seedRegistry([npmPkgComp, npmModuleComp]);
    resetWorkspaceWithTab({
      $elements: ["@acme/extras"],
      children: [],
      tagName: "div",
    } as unknown as JxMutableNode);
    await renderElements();
    expect(componentTags()).toEqual(["extra-thing"]);
  });

  test("the filter applies to component tag names", async () => {
    await seedRegistry([projectComp]);
    await renderElements();
    await typeFilter("zzz");
    expect(host.querySelector(".components-section")).toBeNull();
    await typeFilter("card");
    expect(host.querySelector('[data-component-tag="my-card"]')).not.toBeNull();
  });

  test("clicking a component card inserts an instance carrying its prop defaults", async () => {
    await seedRegistry([npmModuleComp]);
    resetWorkspaceWithTab({
      $elements: ["@acme/widgets/dist/fancy-button.js"],
      children: [],
      tagName: "div",
    } as unknown as JxMutableNode);
    await renderElements();
    (host.querySelector('[data-component-tag="fancy-button"]') as HTMLElement).click();
    const children = activeTab.value!.doc.document.children as JxMutableNode[];
    expect(children).toEqual([{ $props: { label: "go" }, tagName: "fancy-button" }]);
  });

  test("component props with no default become empty strings", async () => {
    await seedRegistry([projectComp]);
    await renderElements();
    (host.querySelector('[data-component-tag="my-card"]') as HTMLElement).click();
    const children = activeTab.value!.doc.document.children as JxMutableNode[];
    expect(children[0]).toEqual({ $props: { title: "" }, tagName: "my-card" });
  });

  test("toggling the components section records the disclosure", async () => {
    await seedRegistry([projectComp]);
    await renderElements();
    await toggleSection("components", false);
    expect(view.elementsCollapsed.has("Components")).toBe(true);
    await toggleSection("components", true);
    expect(view.elementsCollapsed.has("Components")).toBe(false);
  });
});

describe("Insert panel — empty states", () => {
  test("a filter that matches nothing says so and offers to clear itself", async () => {
    await renderElements();
    await typeFilter("zzz");
    expect(host.querySelector('[part="empty-message"]')?.textContent).toBe(
      "Nothing here matches “zzz”.",
    );
    (host.querySelector('[part="clear-filter"]') as HTMLElement).click();
    await flush();
    expect(view.elementsFilter).toBe("");
    expect(host.querySelector('[part="empty"]')).toBeNull();
    expect(sectionNames()).toEqual(["Media", "Text"]);
  });

  test("an empty palette teaches what the region is for, with no action to offer", async () => {
    await renderElements({ elements: {} });
    expect(host.querySelector('[part="empty-message"]')?.textContent).toContain(
      "Elements you can drop onto the page live here",
    );
    expect(host.querySelector('[part="clear-filter"]')).toBeNull();
  });
});

describe("Insert panel — the mount", () => {
  test("the drags are registered once the cards are painted, and again after a filter change", async () => {
    await renderElements();
    expect(deps.registerElementsDnD).toHaveBeenCalled();
    expect(deps.registerComponentsDnD).toHaveBeenCalled();
    const before = deps.registerElementsDnD.mock.calls.length;
    await typeFilter("img");
    expect(deps.registerElementsDnD.mock.calls.length).toBeGreaterThan(before);
  });

  test("a repaint updates the standing document rather than mounting a second one", async () => {
    await renderElements();
    const first = host.querySelector('[part="palette"]');
    mountElementsPanel(
      { deps, doc: null, rerender: () => {} } as unknown as NavigatorPanelContext,
      host,
    );
    await flush();
    expect(host.querySelectorAll('[part="palette"]').length).toBe(1);
    expect(host.querySelector('[part="palette"]')).toBe(first);
  });

  test("a host lit has cleared is mounted into again", async () => {
    await renderElements();
    const content = host.querySelector(".panel-content") as HTMLElement;
    content.replaceChildren();
    mountElementsPanel(
      { deps, doc: null, rerender: () => {} } as unknown as NavigatorPanelContext,
      host,
    );
    await flush();
    await flush();
    expect(content.querySelectorAll('[part="palette"]').length).toBe(1);
  });

  test("a surface disposed while its mount is in flight never lands", async () => {
    const content = makeHost().querySelector(".panel-content") as HTMLElement;
    const handle = mountElementsSurface(content, blankValues(), NO_ACTIONS);
    handle.dispose();
    await handle.ready;
    await flush();
    expect(content.childNodes.length).toBe(0);
    expect(handle.connected()).toBe(false);
  });
});
