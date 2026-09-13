/**
 * Tests for the Packages panel — `src/panels/imports-panel.ts`, the flow, and
 * `src/surfaces/panel-imports.json`, the document it mounts.
 *
 * Everything is addressed by `part`, because the panel is a document: there is no `sp-checkbox`,
 * `sp-picker` or `.import-row` to find any more. A row carries the thing it draws (`data-import`,
 * `data-ref`, `data-component`, `data-package`) so a query says which row it is acting on rather
 * than counting siblings, and a checkbox is toggled through its own `<input>` because that is what
 * the reader clicks and what the document's handler reads.
 *
 * Every render is awaited. `mountSurface` is asynchronous and each kit element settles its own
 * template one `connectedCallback` after that, so the synchronous `render(); assert;` these tests
 * used to do would now assert against an empty container.
 */
import { flush, installMockPlatform, pointer, resetStudioState, topDialog } from "./harness";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { nothing } from "lit-html";
import { renderImportsPanel, renderImportsTemplate } from "../src/panels/imports-panel";
import { componentRegistry, loadComponentRegistry } from "../src/files/components";
import { initLayers } from "../src/ui/layers";
import { requireProjectState } from "../src/store";

import type { ElementsEntry, ImportsContext } from "../src/panels/imports-panel";
import type { ComponentEntry } from "../src/files/components";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { StudioPlatform } from "../src/types";

const REGISTRY: ComponentEntry[] = [
  { modulePath: "button.js", package: "@acme/kit", source: "npm", tagName: "x-button" },
  { modulePath: "card.js", package: "@acme/kit", source: "npm", tagName: "x-card" },
  { modulePath: "thing.js", package: "legacy-pkg", source: "npm", tagName: "y-thing" },
  // Missing modulePath — skipped by groupByPackage
  { package: "badpkg", source: "npm", tagName: "z-bad" },
  { path: "components/card.json", source: "project", tagName: "my-card" },
  { path: "components/hero.json", source: "project", tagName: "my-hero" },
];

let platform: StudioPlatform;
let renders = 0;
const renderLeftPanel = () => {
  renders += 1;
};
let calls: unknown[][];
let discoverCount = 0;

beforeAll(() => {
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    if (!document.querySelector(`#${id}`)) {
      const div = document.createElement("div");
      div.id = id;
      document.body.append(div);
    }
  }
  initLayers();
});

beforeEach(async () => {
  discoverCount = 0;
  const installed = installMockPlatform({
    discoverComponents: async () => {
      discoverCount += 1;
      return structuredClone(REGISTRY) as never;
    },
  });
  ({ platform } = installed);
  ({ calls } = installed.state);
  renders = 0;
  resetStudioState({
    projectConfig: {
      $elements: ["@acme/kit/button.js", "legacy-pkg"],
      imports: { Foo: "./foo.js" },
      name: "test",
    },
  });
  await loadComponentRegistry();
  for (const stale of document.querySelectorAll("body > div:not([id])")) {
    stale.remove();
  }
  (document.querySelector("#layer-modal") as HTMLElement).innerHTML = "";
});

function lastWrittenConfig(): Record<string, unknown> {
  const writes = calls.filter((c) => c[0] === "writeFile" && c[1] === "project.json");
  expect(writes.length).toBeGreaterThan(0);
  return JSON.parse(writes.at(-1)![2] as string);
}

/**
 * Draw the panel into a fresh container and let the document mount.
 *
 * A fresh host is also a fresh draft — the panel drops a half-typed pair when its content area is
 * replaced — so each test starts with empty fields without reaching into module state.
 */
async function draw(ctx: ImportsContext): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  renderImportsPanel(host, ctx);
  await flush(4);
  return host;
}

function siteCtx(): ImportsContext {
  return {
    applyMutation: () => {},
    documentElements: [] as ElementsEntry[],
    documentPath: "project.json",
    renderLeftPanel,
  };
}

/** The section titles the panel draws, in order. */
function titles(host: HTMLElement): (string | null)[] {
  return [...host.querySelectorAll('[part="title"]')].map((t) => t.textContent);
}

/** The `<input>` inside one of the panel's fields, which is what a reader types into. */
function field(host: HTMLElement, name: string): HTMLInputElement {
  return host.querySelector(
    `[part="field"][data-field="${name}"] [part="input"]`,
  ) as HTMLInputElement;
}

/** Type into a field the way the reader does: the control moves, then it says so. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Every component checkbox, by the label it draws. */
function boxes(host: HTMLElement): Map<string, HTMLInputElement> {
  const out = new Map<string, HTMLInputElement>();
  for (const row of host.querySelectorAll('[part="row"][data-component]')) {
    const label = row.querySelector('[part="component-label"]')?.textContent?.trim() ?? "";
    out.set(label, row.querySelector('[part="input"]') as HTMLInputElement);
  }
  return out;
}

/** Tick or clear one component box, and say so the way the platform does. */
function toggle(box: HTMLInputElement, checked: boolean): void {
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("the Navigator seam", () => {
  test("the injected lit renderer draws nothing", () => {
    /* The panel is a document mounted in `afterRender`; the renderer `NavigatorPanelDeps` still
       declares and `studio.ts` still passes is a stub, and both go in the change that deletes the
       declaration. Asserted so the stub cannot quietly grow a template again. */
    expect(renderImportsTemplate(siteCtx())).toBe(nothing);
  });
});

describe("site-level imports (project.json)", () => {
  test("lists imported modules with a count, and one section per package", async () => {
    const host = await draw(siteCtx());
    expect(host.querySelector('[part="count"]')?.textContent).toBe("1");
    const row = host.querySelector('[part="row"][data-import="Foo"]')!;
    expect(row.querySelector('[part="name"]')?.textContent).toBe("Foo");
    expect(row.querySelector('[part="path"]')?.textContent).toBe("./foo.js");

    const named = titles(host);
    expect(named).toContain("@acme/kit");
    expect(named).toContain("legacy-pkg");
    // No modulePath, so nothing to cherry-pick — the package is not a section.
    expect(named).not.toContain("badpkg");
    expect(named).toContain("Add Dependency");
  });

  test("with no imported modules it teaches what an import buys", async () => {
    resetStudioState({ projectConfig: { name: "t" } });
    const host = await draw(siteCtx());
    expect(host.querySelector('[part="empty"]')?.textContent).toContain(
      "Imported modules give this project extra kinds of data",
    );
  });

  test("checkbox state reflects cherry-picked and legacy imports", async () => {
    const host = await draw(siteCtx());
    const byLabel = boxes(host);
    expect(byLabel.get("<x-button>")?.checked).toBe(true); // Cherry-picked specifier
    expect(byLabel.get("<x-card>")?.checked).toBe(false);
    expect(byLabel.get("<y-thing>")?.checked).toBe(true); // Legacy full-package import
  });

  test("removing an imported module updates site config", async () => {
    const host = await draw(siteCtx());
    pointer(host.querySelector('[part="row"][data-import="Foo"] [part="remove"]')!, "click");
    await flush(4);
    expect(lastWrittenConfig().imports).toEqual({});
    expect(renders).toBe(1);
    expect(requireProjectState().projectConfig?.imports).toEqual({});
  });

  test("adding an import writes the name/path pair and clears both fields", async () => {
    const host = await draw(siteCtx());
    const name = field(host, "name");
    const path = field(host, "path");
    type(name, "Bar");
    type(path, "./bar.js");
    await flush(2);
    pointer(host.querySelector('[part="add-button"][data-add="import"]')!, "click");
    await flush(4);
    expect(lastWrittenConfig().imports).toEqual({ Bar: "./bar.js", Foo: "./foo.js" });
    /* The echo, asserted rather than assumed: the flow empties both drafts and redraws, and that
       write only reaches the controls because each keystroke was stated to the scope first. */
    expect(name.value).toBe("");
    expect(path.value).toBe("");
  });

  test("adding an import with only one half of the pair is a no-op", async () => {
    const host = await draw(siteCtx());
    type(field(host, "name"), "OnlyName");
    await flush(2);
    pointer(host.querySelector('[part="add-button"][data-add="import"]')!, "click");
    await flush(4);
    expect(calls.filter((c) => c[0] === "writeFile").length).toBe(0);
    expect(renders).toBe(0);
    // And the half that was typed is still there to finish.
    expect(field(host, "name").value).toBe("OnlyName");
  });

  test("ticking a component cherry-picks it and drops the legacy package import", async () => {
    const host = await draw(siteCtx());
    toggle(boxes(host).get("<y-thing>")!, true);
    await flush(4);
    expect(lastWrittenConfig().$elements).toEqual(["@acme/kit/button.js", "legacy-pkg/thing.js"]);
  });

  test("ticking an already-enabled component does not duplicate the entry", async () => {
    const host = await draw(siteCtx());
    toggle(boxes(host).get("<x-button>")!, true);
    await flush(4);
    expect(lastWrittenConfig().$elements).toEqual(["@acme/kit/button.js", "legacy-pkg"]);
  });

  test("clearing a component removes its specifier", async () => {
    const host = await draw(siteCtx());
    toggle(boxes(host).get("<x-button>")!, false);
    await flush(4);
    expect(lastWrittenConfig().$elements).toEqual(["legacy-pkg"]);
  });

  test("removing a package confirms, removes its elements and reloads the registry", async () => {
    const host = await draw(siteCtx());
    pointer(
      host.querySelector('[part="section"][data-package="@acme/kit"] [part="remove-package"]')!,
      "click",
    );
    await flush();
    const dialog = topDialog()!;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("headline")).toBe("Remove Package");
    dialog.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(calls.some((c) => c[0] === "removePackage" && c[1] === "@acme/kit")).toBe(true);
    // Cherry-picked @acme/kit elements stripped; legacy-pkg untouched
    expect(lastWrittenConfig().$elements).toEqual(["legacy-pkg"]);
    expect(discoverCount).toBeGreaterThan(1);
    expect(renders).toBe(1);
  });

  test("cancelling package removal leaves everything untouched", async () => {
    const host = await draw(siteCtx());
    pointer(
      host.querySelector('[part="section"][data-package="@acme/kit"] [part="remove-package"]')!,
      "click",
    );
    await flush();
    topDialog()!.dispatchEvent(new Event("cancel"));
    await flush(4);
    expect(calls.some((c) => c[0] === "removePackage")).toBe(false);
    expect(renders).toBe(0);
  });

  test("package removal failure is caught and does not re-render", async () => {
    platform.removePackage = async () => {
      throw new Error("nope");
    };
    const host = await draw(siteCtx());
    pointer(
      host.querySelector('[part="section"][data-package="@acme/kit"] [part="remove-package"]')!,
      "click",
    );
    await flush();
    topDialog()!.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(renders).toBe(0);
  });

  test("pressing Enter in the add-dependency field installs the package", async () => {
    const host = await draw(siteCtx());
    const input = field(host, "package");
    type(input, "new-pkg");
    await flush(2);
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await flush(4);
    expect(calls.some((c) => c[0] === "addPackage" && c[1] === "new-pkg")).toBe(true);
    expect(input.value).toBe("");
    expect(renders).toBe(1);
  });

  test("non-Enter keys and blank names install nothing", async () => {
    const host = await draw(siteCtx());
    const input = field(host, "package");
    type(input, "new-pkg");
    await flush(2);
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    type(input, "   ");
    await flush(2);
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await flush(4);
    expect(calls.some((c) => c[0] === "addPackage")).toBe(false);
  });

  test("the add-package button installs the typed package", async () => {
    const host = await draw(siteCtx());
    const input = field(host, "package");
    type(input, "btn-pkg");
    await flush(2);
    pointer(host.querySelector('[part="add-button"][data-add="package"]')!, "click");
    await flush(4);
    expect(calls.some((c) => c[0] === "addPackage" && c[1] === "btn-pkg")).toBe(true);
    expect(input.value).toBe("");
    expect(renders).toBe(1);
  });

  test("the add-package button with an empty field is a no-op", async () => {
    const host = await draw(siteCtx());
    pointer(host.querySelector('[part="add-button"][data-add="package"]')!, "click");
    await flush(4);
    expect(calls.some((c) => c[0] === "addPackage")).toBe(false);
  });

  test("add-package failure is caught", async () => {
    platform.addPackage = async () => {
      throw new Error("registry down");
    };
    const host = await draw(siteCtx());
    type(field(host, "package"), "broken");
    await flush(2);
    pointer(host.querySelector('[part="add-button"][data-add="package"]')!, "click");
    await flush(4);
    expect(renders).toBe(0);
  });
});

describe("document-level imports", () => {
  let doc: JxMutableNode;

  function docCtx(overrides: Partial<ImportsContext> = {}): ImportsContext {
    return {
      applyMutation: (fn: (d: JxMutableNode) => void) => fn(doc),
      documentElements: (doc.$elements || []) as ElementsEntry[],
      documentPath: "pages/index.json",
      renderLeftPanel,
      ...overrides,
    };
  }

  /** The picker's `<select>`, or `null` when there is nothing left to offer. */
  function picker(host: HTMLElement): (HTMLSelectElement & { value: string }) | null {
    return host.querySelector('[part="picker"] [part="control"]');
  }

  /** Choose a component the way the reader does. */
  function choose(host: HTMLElement, value: string): void {
    const control = picker(host)!;
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  beforeEach(() => {
    doc = {
      $elements: [{ $ref: "./components/hero.json" }, "@acme/kit/button.js", "legacy-pkg"],
      tagName: "div",
    } as unknown as JxMutableNode;
  });

  test("lists $ref imports and offers only un-imported project components", async () => {
    const host = await draw(docCtx());
    expect(host.querySelector('[part="count"]')?.textContent).toBe("1");
    expect(
      host.querySelector('[part="row"][data-ref="./components/hero.json"] [part="path"]')
        ?.textContent,
    ).toBe("./components/hero.json");
    const options = [...picker(host)!.querySelectorAll("option")].map((o) => o.textContent?.trim());
    // The picker's own empty row is a row: a select always holds one of its options.
    expect(options).toEqual(["Add component…", "<my-card>"]);
  });

  test("with no component imports it teaches what they buy, and names the picker below", async () => {
    doc.$elements = ["@acme/kit/button.js"];
    const host = await draw(docCtx());
    expect(host.querySelector('[part="empty"]')?.textContent).toBe(
      "Components you add here can be dropped onto this page. Pick one below.",
    );
  });

  test("with no project components at all it says where components come from", async () => {
    doc.$elements = [];
    componentRegistry.length = 0;
    const host = await draw(docCtx());
    expect(host.querySelector('[part="empty"]')?.textContent).toContain(
      "This project has none yet",
    );
  });

  test("removing a $ref import filters it out of $elements", async () => {
    const host = await draw(docCtx());
    pointer(
      host.querySelector('[part="row"][data-ref="./components/hero.json"] [part="remove"]')!,
      "click",
    );
    await flush(2);
    expect(doc.$elements).toEqual(["@acme/kit/button.js", "legacy-pkg"]);
    expect(renders).toBe(1);
  });

  test("picking a component adds a relative $ref and resets the picker", async () => {
    const host = await draw(docCtx());
    choose(host, "my-card");
    await flush(2);
    expect(doc.$elements).toContainEqual({ $ref: "../components/card.json" });
    /* The picker resets to its own empty row. The scope is told the pick BEFORE it is told the
       reset, so the second write is a real change — without the echo, choosing the same component
       twice would leave it showing in a control the scope never moved off "". */
    expect(picker(host)!.value).toBe("");
    expect(renders).toBe(1);
  });

  test("picking a component initializes $elements when missing", async () => {
    doc = { tagName: "div" } as unknown as JxMutableNode;
    const host = await draw(docCtx());
    choose(host, "my-hero");
    await flush(2);
    expect(doc.$elements).toEqual([{ $ref: "../components/hero.json" }]);
  });

  test("the picker ignores its empty row and components without a path", async () => {
    const host = await draw(docCtx());
    choose(host, "");
    // X-button is an npm component without a project path, so it is not an option — but a value
    // Arriving from anywhere else must still be refused rather than written as a broken $ref.
    const control = picker(host)!;
    control.value = "x-button";
    control.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);
    expect(doc.$elements).toEqual([
      { $ref: "./components/hero.json" },
      "@acme/kit/button.js",
      "legacy-pkg",
    ]);
    expect(renders).toBe(0);
  });

  test("documentPath null produces ./-relative refs", async () => {
    doc = { tagName: "div" } as unknown as JxMutableNode;
    const host = await draw(docCtx({ documentPath: null }));
    choose(host, "my-card");
    await flush(2);
    expect(doc.$elements).toEqual([{ $ref: "./components/card.json" }]);
  });

  test("npm checkboxes mirror enabled state from string entries", async () => {
    const host = await draw(docCtx());
    const byLabel = boxes(host);
    expect(byLabel.get("<x-button>")?.checked).toBe(true);
    expect(byLabel.get("<x-card>")?.checked).toBe(false);
    expect(byLabel.get("<y-thing>")?.checked).toBe(true);
  });

  test("a package section here offers no way to uninstall the package", async () => {
    const host = await draw(docCtx());
    expect(host.querySelector('[part="remove-package"]')).toBeNull();
  });

  test("ticking an npm component pushes its specifier and drops the legacy entry", async () => {
    const host = await draw(docCtx());
    toggle(boxes(host).get("<y-thing>")!, true);
    await flush(2);
    expect(doc.$elements).toEqual([
      { $ref: "./components/hero.json" },
      "@acme/kit/button.js",
      "legacy-pkg/thing.js",
    ]);
    expect(renders).toBe(1);
  });

  test("clearing an npm component removes its specifier", async () => {
    const host = await draw(docCtx());
    toggle(boxes(host).get("<x-button>")!, false);
    await flush(2);
    expect(doc.$elements).toEqual([{ $ref: "./components/hero.json" }, "legacy-pkg"]);
  });

  test("ticking a component initializes $elements when missing", async () => {
    doc = { tagName: "div" } as unknown as JxMutableNode;
    const host = await draw(docCtx());
    toggle(boxes(host).get("<x-card>")!, true);
    await flush(2);
    expect(doc.$elements).toEqual(["@acme/kit/card.js"]);
  });

  test("ticking an already-listed specifier does not duplicate it", async () => {
    const host = await draw(docCtx());
    toggle(boxes(host).get("<x-button>")!, true);
    await flush(2);
    expect(
      (doc.$elements as ElementsEntry[]).filter((e) => e === "@acme/kit/button.js").length,
    ).toBe(1);
  });

  test("no $ref imports and no available components renders neither list nor picker", async () => {
    doc = {
      $elements: [{ $ref: "./components/hero.json" }, { $ref: "./components/card.json" }],
      tagName: "div",
    } as unknown as JxMutableNode;
    const host = await draw(docCtx());
    expect(picker(host)).toBeNull();

    doc = { $elements: [], tagName: "div" } as unknown as JxMutableNode;
    const host2 = await draw(docCtx());
    expect(host2.querySelector('[part="row"][data-ref]')).toBeNull();
    expect(host2.querySelector('[part="empty"]')).not.toBeNull();
  });
});
