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
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mountElementsPanel } from "../src/panels/elements-panel";
import { mountElementsSurface } from "../src/surfaces/panel-elements";
import { loadComponentRegistry } from "../src/files/components";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { view } from "../src/view";
import type { ComponentEntry } from "../src/files/components";
import type { ElementsActions, ElementsValues } from "../src/surfaces/panel-elements";
import type { NavigatorPanelContext, NavigatorPanelDeps } from "../src/panels/panel-registry";
import type { StudioPlatform } from "../src/types";
import { isString } from "@jxsuite/schema/guards";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** The part of the bundled `data/webdata.json` the palette reads: category name to its blocks. */
interface WebdataFixture {
  elements: Record<string, { tag: string }[]>;
}

/**
 * The `NavigatorPanelDeps` members the Insert panel reads. The rest belong to other panels, and
 * `webdata` is narrowed to the one key the palette builds from.
 */
type InsertPanelDeps = Pick<
  NavigatorPanelDeps,
  "defaultDef" | "registerComponentsDnD" | "registerElementsDnD"
> & { webdata: WebdataFixture };

const WEBDATA: WebdataFixture = {
  elements: {
    Media: [{ tag: "img" }],
    Text: [{ tag: "h1" }, { tag: "p" }],
  },
};

function defaultDef(tag: string): JxMutableNode {
  return { tagName: tag, textContent: `New ${tag}` };
}

let host: HTMLElement;
let deps: InsertPanelDeps;
/** How many times the panel has (re)registered each drag, counted by the deps above. */
const drags = { components: 0, elements: 0 };

/** The Navigator's context for the Insert panel, carrying only the deps that panel reads. */
function panelContext(insertDeps: InsertPanelDeps): NavigatorPanelContext {
  /* SAFETY: mountElementsPanel reads only `webdata.elements`, `defaultDef`, `registerElementsDnD`
     and `registerComponentsDnD` off its deps (elements-panel.ts's panelValues, afterRender and
     insert action); every other NavigatorPanelDeps member serves another panel and is never read
     here. `webdata` keeps the bundled file's `elements` shape, category name to `{ tag }[]`. */
  const full = insertDeps as NavigatorPanelDeps;
  return { deps: full, doc: null, rerender: () => {} };
}

/** The element `selector` names inside the panel host, which the test is about to click or read. */
function hostElement(selector: string, root: ParentNode = host): HTMLElement {
  const el = root.querySelector(selector);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`no element matching ${selector}`);
  }
  return el;
}

/** The `data-*` value `key` of every element `selector` matches in the host, in document order. */
function dataValues(selector: string, key: string): (string | undefined)[] {
  return [...host.querySelectorAll(selector)].map((el) =>
    el instanceof HTMLElement ? el.dataset[key] : undefined,
  );
}

/** The node children of the active document (or of one of its nodes), which must be an array. */
function childrenOf(node: JxMutableNode | undefined): (JxMutableNode | string)[] {
  const children = node?.children;
  if (!Array.isArray(children)) {
    throw new TypeError("expected an array of children");
  }
  return children;
}

/** The element child at `index`, which must be a node rather than a text string. */
function childAt(node: JxMutableNode | undefined, index: number): JxMutableNode {
  const child = childrenOf(node)[index];
  if (child === undefined || isString(child)) {
    throw new Error(`child ${index} is not an element node`);
  }
  return child;
}

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
async function renderElements(webdata: WebdataFixture = WEBDATA): Promise<HTMLElement> {
  host = makeHost();
  drags.components = 0;
  drags.elements = 0;
  deps = {
    defaultDef,
    registerComponentsDnD: () => {
      drags.components += 1;
    },
    registerElementsDnD: () => {
      drags.elements += 1;
    },
    webdata,
  };
  mountElementsPanel(panelContext(deps), host);
  await flush();
  await flush();
  return host;
}

async function seedRegistry(entries: ComponentEntry[]) {
  /* SAFETY: the registry keeps this answer as `ComponentEntry[]`, and the npm entries here mirror
     the server's real npm discovery (server studio-api.ts), which sends `package`/`modulePath`
     with no string `path` — a shape `ComponentMeta` cannot express but the registry reads. */
  const discoverComponents = (async () => entries) as StudioPlatform["discoverComponents"];
  installMockPlatform({ discoverComponents });
  await loadComponentRegistry();
}

/** The section labelled `name`, as the kit's accordion item. */
function section(name: string): HTMLElement & { open: boolean } {
  const el = host.querySelector(`[data-section="${name}"]`);
  if (!el) {
    throw new Error(`no "${name}" section in the palette`);
  }
  /* SAFETY: every `[data-section]` node is a `jx-accordion-item` (surfaces/panel-elements.json),
     and that component declares `open` as a boolean state exposed as a property
     (ui/components/jx-accordion-item.json). */
  return el as HTMLElement & { open: boolean };
}

/** Every section label in the palette, in the order the accordion draws them. */
function sectionNames(): (string | undefined)[] {
  return dataValues("[data-section]", "section");
}

/** The filter field's own control — a native input, drawn by `jx-textfield`. */
function filterInput(): HTMLInputElement {
  const el = host.querySelector('[part="filter"] [part="input"]');
  if (!(el instanceof HTMLInputElement)) {
    throw new Error("no control in the palette's filter field");
  }
  return el;
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
    details.open = open;
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
    const tags = dataValues(".element-card", "blockTag");
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
    hostElement('[data-block-tag="h1"]').click();
    const children = childrenOf(activeTab.value?.doc.document);
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
    hostElement('[data-block-tag="img"]').click();
    const parent = childAt(activeTab.value?.doc.document, 0);
    expect(childrenOf(parent).length).toBe(2);
    expect(childAt(parent, 1).tagName).toBe("img");
  });

  test("a click with no open document inserts nothing rather than throwing", async () => {
    await renderElements();
    closeAllTabs();
    hostElement('[data-block-tag="p"]').click();
    expect(activeTab.value).toBeNull();
  });
});

describe("Insert panel — components", () => {
  const projectComp: ComponentEntry = {
    path: "components/my-card.json",
    props: [{ name: "title" }],
    source: "project",
    tagName: "my-card",
  };
  const npmModuleComp: ComponentEntry = {
    modulePath: "dist/fancy-button.js",
    package: "@acme/widgets",
    props: [{ default: "go", name: "label" }],
    source: "npm",
    tagName: "fancy-button",
  };
  const npmPkgComp: ComponentEntry = {
    package: "@acme/extras",
    props: [],
    source: "npm",
    tagName: "extra-thing",
  };

  /** The tag of every component card on screen. */
  function componentTags(): (string | undefined)[] {
    return dataValues("[data-component-tag]", "componentTag");
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
    });
    await renderElements();
    const tags = componentTags();
    expect(tags).toContain("fancy-button");
    expect(tags).not.toContain("extra-thing");
    const card = hostElement('[data-component-tag="fancy-button"]');
    expect(card.getAttribute("title")).toBe("@acme/widgets: <fancy-button>");
    expect(card.querySelector('[part="component-tag"]')?.textContent).toBe("<fancy-button>");
  });

  test("a bare package entry enables every component from that package", async () => {
    await seedRegistry([npmPkgComp, npmModuleComp]);
    resetWorkspaceWithTab({
      $elements: ["@acme/extras"],
      children: [],
      tagName: "div",
    });
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
    });
    await renderElements();
    hostElement('[data-component-tag="fancy-button"]').click();
    const children = childrenOf(activeTab.value?.doc.document);
    expect(children).toEqual([{ $props: { label: "go" }, tagName: "fancy-button" }]);
  });

  test("component props with no default become empty strings", async () => {
    await seedRegistry([projectComp]);
    await renderElements();
    hostElement('[data-component-tag="my-card"]').click();
    const children = childrenOf(activeTab.value?.doc.document);
    expect(children[0]).toEqual({ $props: { title: "" }, tagName: "my-card" });
  });

  test("a click imports the component, exactly as a drop of the same card does (§5.7)", async () => {
    await seedRegistry([projectComp]);
    resetWorkspaceWithTab({ children: [], tagName: "div" }, { documentPath: "pages/index.json" });
    await renderElements();
    hostElement('[data-component-tag="my-card"]').click();
    expect(activeTab.value?.doc.document.$elements).toEqual([
      { $ref: "../components/my-card.json" },
    ]);
    // A second click inserts a second instance and imports nothing twice.
    hostElement('[data-component-tag="my-card"]').click();
    expect(childrenOf(activeTab.value?.doc.document)).toHaveLength(2);
    expect(activeTab.value?.doc.document.$elements).toHaveLength(1);
  });

  test("an HTML element click imports nothing", async () => {
    await seedRegistry([projectComp]);
    resetWorkspaceWithTab({ children: [], tagName: "div" }, { documentPath: "pages/index.json" });
    await renderElements();
    hostElement('[data-block-tag="h1"]').click();
    expect(activeTab.value?.doc.document.$elements).toBeUndefined();
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
    hostElement('[part="clear-filter"]').click();
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
    expect(drags.elements).toBeGreaterThan(0);
    expect(drags.components).toBeGreaterThan(0);
    const before = drags.elements;
    await typeFilter("img");
    expect(drags.elements).toBeGreaterThan(before);
  });

  test("a repaint updates the standing document rather than mounting a second one", async () => {
    await renderElements();
    const first = host.querySelector('[part="palette"]');
    mountElementsPanel(panelContext(deps), host);
    await flush();
    expect(host.querySelectorAll('[part="palette"]').length).toBe(1);
    expect(host.querySelector('[part="palette"]')).toBe(first);
  });

  test("a host lit has cleared is mounted into again", async () => {
    await renderElements();
    const content = hostElement(".panel-content");
    content.replaceChildren();
    mountElementsPanel(panelContext(deps), host);
    await flush();
    await flush();
    expect(content.querySelectorAll('[part="palette"]').length).toBe(1);
  });

  test("a surface disposed while its mount is in flight never lands", async () => {
    const content = hostElement(".panel-content", makeHost());
    const handle = mountElementsSurface(content, blankValues(), NO_ACTIONS);
    handle.dispose();
    await handle.ready;
    await flush();
    expect(content.childNodes.length).toBe(0);
    expect(handle.connected()).toBe(false);
  });
});
