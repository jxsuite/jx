import { flush, installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { activePane, closeAllTabs, workspace } from "../src/workspace/workspace";

void mock.module("tabulator-tables", () => ({}));
void mock.module("tabulator-tables/dist/css/tabulator.min.css", () => ({}));
void mock.module("../src/format/format-host.js", () => ({
  formatForPath: (path: string | null) =>
    path?.endsWith(".csv") ? { extensions: [".csv"], name: "Csv" } : null,
  loadFormats: async () => {},
}));

const { getGridController } = await import("../src/grid/grid-controller");
const {
  openCollectionGrid,
  openConnectorGrid,
  openCsvGridTab,
  openGridSourcePicker,
  openPagesGrid,
} = await import("../src/grid/grid-open");
const { initLayers } = await import("../src/ui/layers");

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

beforeEach(() => {
  resetStudioState();
  closeAllTabs();
});

describe("openCsvGridTab", () => {
  test("opens a real file tab defaulting to grid mode with a source alternate", async () => {
    installMockPlatform({}, { "data/products.csv": "sku,name\nw-1,Widget\n" });
    const tab = await openCsvGridTab("data/products.csv");

    expect(tab.id).toBe("data/products.csv");
    expect(tab.documentPath).toBe("data/products.csv");
    expect(tab.capabilities.modes).toEqual(["grid", "source"]);
    expect(tab.session.ui.canvasMode).toBe("grid");
    expect(tab.doc.sourceFormat).toBe("Csv");
    expect(workspace.activeTabId).toBe(tab.id);

    const controller = getGridController(tab)!;
    expect(controller).not.toBeNull();
    // Give the fired load() a tick and confirm rows arrived.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(controller.state.total).toBe(1);
  });

  test("re-opening the same path activates the existing tab", async () => {
    installMockPlatform({}, { "a.csv": "x\n1\n" });
    const first = await openCsvGridTab("a.csv");
    activePane().activeTabId = null;
    const second = await openCsvGridTab("a.csv");
    // Workspace hands back the reactive proxy of the same tab — compare identity via ids.
    expect(second.id).toBe(first.id);
    expect(workspace.tabs.size).toBe(1);
    expect(workspace.activeTabId as string | null).toBe("a.csv");
  });

  test("openCollectionGrid opens a deduped virtual tab bound to the collection source", async () => {
    installMockPlatform({}, { "content/posts/a.md": "---\ntitle: A\n---\n" });
    resetStudioState({
      projectConfig: {
        content: { posts: { format: "Markdown", schema: {}, source: "./content/posts/" } },
      },
    });
    const tab = openCollectionGrid("posts");
    expect(tab.id).toBe("grid://collection/posts");
    expect(tab.documentPath).toBeNull();
    expect(tab.capabilities.modes).toEqual(["grid"]);
    expect(tab.session.ui.canvasMode).toBe("grid");
    expect(getGridController(tab)).not.toBeNull();

    activePane().activeTabId = null;
    const again = openCollectionGrid("posts");
    expect(again.id).toBe(tab.id);
    expect(workspace.tabs.size).toBe(1);
    expect(workspace.activeTabId as string | null).toBe(tab.id);
  });

  test("tolerates an unavailable format registry", async () => {
    void mock.module("../src/format/format-host.js", () => ({
      formatForPath: () => null,
      loadFormats: async () => {
        throw new Error("no server");
      },
    }));
    installMockPlatform({}, { "b.csv": "x\n1\n" });
    const tab = await openCsvGridTab("b.csv");
    expect(tab.doc.sourceFormat).toBeNull();
    expect(tab.session.ui.canvasMode).toBe("grid");
  });
});

describe("virtual grid openers", () => {
  test("openPagesGrid and openConnectorGrid open deduped virtual tabs", () => {
    installMockPlatform();
    resetStudioState({ projectConfig: { content: {} } });
    const pages = openPagesGrid();
    expect(pages.id).toBe("grid://pages");
    expect(getGridController(pages)).not.toBeNull();
    expect(openPagesGrid().id).toBe(pages.id);
    expect(workspace.tabs.size).toBe(1);

    const data = openConnectorGrid("main", "users");
    expect(data.id).toBe("grid://data/main/users");
    expect(data.capabilities.modes).toEqual(["grid"]);
    expect(workspace.tabs.size).toBe(2);
  });

  /* The picker is a document (`surfaces/grid-open.json`) inside the confirm dialog `ui/layers.ts`
     already owns, so there is no `.jx-grid-picker` and no `sp-menu-item` to find. A row is
     `[part="source"]`, and its `data-source` is the grid tab id it opens — which is what makes each
     row addressable by what it does rather than by the label somebody typed. */
  const rows = () => [...document.querySelectorAll<HTMLElement>('#layer-dialog [part="source"]')];
  /* Labels, never the elements themselves: `toEqual` over a happy-dom node walks its whole parent
     chain and never comes back, which reads as a hung suite rather than a failing assertion. */
  const rowLabels = () => rows().map((el) => el.textContent?.trim());
  const openDialog = () =>
    [...document.querySelectorAll<HTMLElement>("#layer-dialog jx-dialog")].at(-1) ?? null;
  const dismiss = async () => {
    openDialog()?.dispatchEvent(new Event("cancel"));
    await flush(2);
  };
  const row = (id: string) =>
    document.querySelector<HTMLElement>(`#layer-dialog [part="source"][data-source="${id}"]`)!;
  const groupTitles = () =>
    [...document.querySelectorAll('#layer-dialog [part="group-title"]')].map((el) =>
      el.textContent?.trim(),
    );

  test("the source picker groups pages, collections and connector tables", async () => {
    installMockPlatform({
      dataConnections: async () => ({
        connections: [
          {
            configured: true,
            isDefault: true,
            missingSecrets: [],
            name: "main",
            provider: "sqlite",
            settings: {},
            tables: ["users"],
          },
        ],
      }),
      dataRows: async () => ({ columns: [], rows: [], total: 0 }),
    });
    resetStudioState({
      projectConfig: {
        content: { posts: { format: "Markdown", schema: {}, source: "./content/posts/" } },
      },
    });
    await openGridSourcePicker();
    await flush(3);
    expect(groupTitles()).toEqual(["Project", "Data · main"]);
    expect(rowLabels()).toEqual(["Pages", "Collection: posts", "users"]);
    // The dialog names itself, so the picker inherits a headline and a cancel it does not draw.
    expect(document.querySelector("#layer-dialog jx-dialog")?.getAttribute("headline")).toBe(
      "Open Grid",
    );

    // Picking a row closes the dialog and opens (deduped) tabs.
    row("grid://data/main/users").click();
    await flush(2);
    expect(workspace.tabs.has("grid://data/main/users")).toBeTrue();
    expect(rows()).toHaveLength(0);

    await openGridSourcePicker();
    await flush(3);
    row("grid://pages").click();
    await flush(2);
    expect(workspace.tabs.has("grid://pages")).toBeTrue();

    await openGridSourcePicker();
    await flush(3);
    row("grid://collection/posts").click();
    await flush(2);
    expect(workspace.tabs.has("grid://collection/posts")).toBeTrue();

    // Re-picking activates the existing tabs instead of duplicating them.
    const before = workspace.tabs.size;
    openConnectorGrid("main", "users");
    openPagesGrid();
    expect(workspace.tabs.size).toBe(before);
  });

  test("a connection with no tables says why instead of drawing an empty group", async () => {
    installMockPlatform({
      dataConnections: async () => ({
        connections: [
          {
            configured: true,
            isDefault: true,
            missingSecrets: [],
            name: "blank",
            provider: "sqlite",
            settings: {},
            tables: [],
          },
        ],
      }),
      dataRows: async () => ({ columns: [], rows: [], total: 0 }),
    });
    resetStudioState({ projectConfig: { content: {} } });
    await openGridSourcePicker();
    await flush(3);
    expect(document.querySelector('#layer-dialog [part="group-empty"]')?.textContent).toContain(
      "push a schema first",
    );
    expect(rows().map((el) => el.dataset["source"])).toEqual(["grid://pages"]);
    await dismiss();
  });

  test("the picker goes down with the dialog it lives in", async () => {
    installMockPlatform({ dataRows: async () => ({ columns: [], rows: [], total: 0 }) });
    resetStudioState({ projectConfig: { content: {} } });
    await openGridSourcePicker();
    await flush(3);
    expect(openDialog()).not.toBeNull();
    expect(rows()).toHaveLength(1);
    await dismiss();
    expect(rows()).toHaveLength(0);
  });

  test("a failing connections fetch degrades to no connector groups", async () => {
    installMockPlatform({
      dataConnections: async () => {
        throw new Error("data surface down");
      },
      dataRows: async () => ({ columns: [], rows: [], total: 0 }),
    });
    resetStudioState({ projectConfig: { content: {} } });
    await openGridSourcePicker();
    await flush(3);
    expect(groupTitles()).toEqual(["Project"]);
    expect(rowLabels()).toEqual(["Pages"]);
    await dismiss();
  });
});
