/**
 * The Styles panel (`src/panels/styles-panel.ts` over `src/surfaces/styles-panel.{json,ts}`,
 * specs/studio.md §7.1): the Styles workspace's Navigator. Variables first, by real name and
 * grouped; then the element defaults by tag name; then the color schemes.
 *
 * Everything is addressed by `part` and `data-*`, because the panel is a document. `settings.open`
 * is a stand-in record in the active registry, the witness for "Manage color schemes runs that
 * verb"; the views a row leads to are the real `project.json` tab's.
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { registerRenderer, setProjectState } from "../src/store";
import { getPanel, resetPanels } from "../src/panels/panel-registry";
import { closeAllTabs, workspace } from "../src/workspace/workspace";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { argsSchema, stringProperty } from "../src/commands/command-args";
import { resetProjectShell, shell } from "../src/shell";
import { variablesFocus, resetVariablesFocus } from "../src/style/variables-focus";
import { transactDoc } from "../src/tabs/transact";
import {
  STYLES_PANEL_ACTIONS,
  addTargetGroup,
  registerStylesPanel,
  resetStylesPanel,
  stylesConfig,
  stylesPanelValues,
} from "../src/panels/styles-panel";
import { emptyStylesPanelValues, mountStylesPanelSurface } from "../src/surfaces/styles-panel";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { NavigatorPanelDeps } from "../src/panels/panel-registry";
import type { StylesPanelInput } from "../src/panels/styles-panel";
import type { JxStyle } from "@jxsuite/schema/types";

const runs: { id: string; args: unknown }[] = [];
const registry = createCommandRegistry({ getContext: emptyContext });
registry.register({
  args: argsSchema({ section: stringProperty("section") }, []),
  category: "Project",
  id: "settings.open",
  level: "project",
  run: (_ctx, args) => {
    runs.push({ args, id: "settings.open" });
  },
  title: "settings.open",
});

/* SAFETY: the panel's afterRender reads neither `deps` nor `doc`, so an empty object stands in. */
const NO_DEPS = {} as NavigatorPanelDeps;

const STYLE: JxStyle = {
  "--color-accent": "var(--color-brand)",
  "--color-brand": "#2448c9",
  "--font-body": "Inter, sans-serif",
  "--size-gap": "8px",
  h1: { color: "var(--color-accent)" },
  ul: { li: { margin: "0" } },
};

const MEDIA = {
  "--": "1280px",
  "--dark": "(prefers-color-scheme: dark)",
  "--sm": "(max-width: 600px)",
};

let host: HTMLElement;

function project(style: JxStyle = STYLE, media: Record<string, string> = MEDIA): void {
  installMockPlatform();
  setProjectState({
    dirs: new Map(),
    expanded: new Set(),
    isSiteProject: true,
    name: "Blog",
    projectConfig: { $media: media, name: "Blog", style: structuredClone(style) },
    projectDirs: [],
    projectRoot: ".",
    searchQuery: "",
    selectedPath: null,
  });
}

/** Paint the panel the way the Navigator does. */
async function paint(): Promise<void> {
  const record = getPanel("styles")!;
  const draw = () => {
    record.afterRender!({ deps: NO_DEPS, doc: null, rerender: draw }, host);
  };
  registerRenderer("leftPanel", draw);
  draw();
  await flush(10);
}

const parts = (name: string): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>(`[part="${name}"]`),
];
const texts = (name: string): string[] => parts(name).map((el) => el.textContent.trim());

/** The pure projection's input, over a configuration this case names. */
function input(overrides: Partial<StylesPanelInput> = {}): StylesPanelInput {
  return {
    catalogue: {
      $sections: [
        { elements: [{ tag: "h1" }, { tag: "h2" }], label: "Headings" },
        { elements: [{ children: [{ tag: "li" }, { tag: "li" }], tag: "ul" }], label: "List" },
      ],
    },
    components: [],
    config: { $media: MEDIA, style: STYLE },
    selection: null,
    variable: null,
    ...overrides,
  };
}

beforeEach(() => {
  runs.length = 0;
  resetStudioState();
  resetPanels();
  resetStylesPanel();
  resetProjectShell();
  resetVariablesFocus();
  closeAllTabs();
  setActiveRegistry(registry);
  document.body.innerHTML = '<div id="host"><div class="panel-content"></div></div>';
  host = document.querySelector<HTMLElement>(".panel-content")!;
  registerStylesPanel();
  project();
});

describe("the record", () => {
  test("is a project-level Navigator panel with no rail button", () => {
    const record = getPanel("styles")!;
    expect([record.level, record.dock, record.rail, record.title, record.icon]).toEqual([
      "project",
      "navigator",
      false,
      "Styles",
      "paint-brush",
    ]);
  });
});

describe("what the panel lists", () => {
  test("every custom property by its real name, grouped, counted, colours swatched", () => {
    const values = stylesPanelValues(input());
    expect(values.body).toBe("styles");
    expect(values.variableCount).toBe("4");
    expect(values.groups.map((g) => [g.id, g.title, g.count])).toEqual([
      ["color", "Colors", "2"],
      ["font", "Fonts", "1"],
      ["size", "Sizes & Spacing", "1"],
    ]);
    const [colors] = values.groups;
    expect(colors?.countLabel).toBe("2 variables");
    // The swatch is what the colour RESOLVES to, through the `var()` it follows.
    expect(colors?.variables.map((v) => [v.name, v.value, v.swatch])).toEqual([
      ["--color-accent", "var(--color-brand)", "#2448c9"],
      ["--color-brand", "#2448c9", "#2448c9"],
    ]);
    expect(values.groups[1]?.variables[0]?.swatchState).toBe("none");
  });

  test("Other is listed only when something is in it, and the current property is marked", () => {
    const values = stylesPanelValues(
      input({ config: { style: { "--z-modal": "50" } }, variable: "--z-modal" }),
    );
    expect(values.groups.map((g) => g.id)).toEqual(["color", "font", "size", "other"]);
    expect(values.groups[3]?.countLabel).toBe("1 variable");
    expect(values.groups[3]?.variables[0]?.selected).toBe(true);
  });

  test("the element defaults by tag name, styled tags dotted, the selected leaf marked", () => {
    const values = stylesPanelValues(input({ selection: "ul li" }));
    expect(values.elementGroups.map((g) => g.label)).toEqual(["Headings", "List"]);
    const rows = values.elementGroups.flatMap((g) => g.rows);
    // A specimen's repeated children are one row: the row selects a TAG.
    expect(rows.map((r) => [r.key, r.tag, r.indent])).toEqual([
      ["h1", "h1", "8px"],
      ["h2", "h2", "8px"],
      ["ul", "ul", "8px"],
      ["ul li", "li", "24px"],
    ]);
    // `ul` carries a nested `li` rule, so it is styled too.
    expect(rows.filter((r) => r.customized).map((r) => r.key)).toEqual(["h1", "ul", "ul li"]);
    expect(rows.filter((r) => r.selected).map((r) => r.key)).toEqual(["ul li"]);
    expect(values.customizedCount).toBe("3 styled");
    expect(values.customizedLabel).toBe("3 tags styled");
  });

  test("the project's components follow the catalogue, by their tag names", () => {
    const values = stylesPanelValues(
      input({ components: [{ tagName: "site-card" }], selection: "site-card" }),
    );
    const components = values.elementGroups.at(-1);
    expect(components?.label).toBe("Components");
    expect(components?.rows.map((r) => [r.key, r.selected])).toEqual([["site-card", true]]);
  });

  test("the color schemes $media declares, with the query that selects each", () => {
    const values = stylesPanelValues(input());
    expect(values.schemesState).toBe("listed");
    expect(values.schemes).toEqual([
      { key: "--dark", label: "Dark", query: "(prefers-color-scheme: dark)" },
    ]);
    expect(stylesPanelValues(input({ config: { style: {} } })).schemesState).toBe("empty");
  });

  test("no project, and a project with no variables", () => {
    expect(stylesPanelValues(input({ config: null })).body).toBe("none");
    const bare = stylesPanelValues(input({ config: {} }));
    expect(bare.variablesState).toBe("empty");
    expect(bare.variableCount).toBe("0");
  });

  test("reads the open project.json tab before the configuration it was opened with", () => {
    expect(stylesConfig()?.style).toEqual(STYLE);
    STYLES_PANEL_ACTIONS.selectVariable("--size-gap");
    const tab = workspace.tabs.get("project.json")!;
    transactDoc(tab, (t) => {
      const { style } = t.doc.document;
      if (isJsonObject(style)) {
        style["--size-pad"] = "4px";
      }
    });
    expect(stylesConfig()?.style?.["--size-pad"]).toBe("4px");
  });
});

describe("the drawn panel", () => {
  test("draws the three sections, variables first", async () => {
    await paint();
    expect(texts("section-title")).toEqual(["Variables", "Elements", "Color schemes"]);
    expect(parts("variable-row").map((row) => row.dataset["token"])).toEqual([
      "--color-accent",
      "--color-brand",
      "--font-body",
      "--size-gap",
    ]);
    expect(texts("row-label").slice(0, 3)).toEqual(["Colors", "Fonts", "Sizes & Spacing"]);
    expect(parts("swatch")).toHaveLength(2);
    expect(parts("element-row").length).toBeGreaterThan(10);
    expect(texts("scheme-query")).toEqual(["(prefers-color-scheme: dark)"]);
    expect(texts("add-variable")[0]).toStartWith("Add variable");
    expect(texts("manage-schemes")[0]).toStartWith("Manage color schemes…");
  });

  test("says so when there are no variables and no schemes", async () => {
    project({}, { "--": "1280px" });
    await paint();
    expect(texts("note")).toHaveLength(2);
    expect(parts("variable-row")).toHaveLength(0);
  });

  test("follows a variable edited on the tab, which the Navigator's repaint would not see", async () => {
    await paint();
    STYLES_PANEL_ACTIONS.selectVariable("--color-brand");
    await flush(4);
    const tab = workspace.tabs.get("project.json")!;
    transactDoc(tab, (t) => {
      const { style } = t.doc.document;
      if (isJsonObject(style)) {
        style["--color-brand"] = "#ff0000";
      }
    });
    await flush(6);
    const row = parts("variable-row").find((r) => r.dataset["token"] === "--color-brand");
    expect(row?.querySelector('[part="var-value"]')?.textContent).toBe("#ff0000");
    expect(row?.getAttribute("aria-current")).toBe("true");
  });

  test("a mount disposed before it lands leaves nothing behind", async () => {
    const box = document.createElement("div");
    const handle = mountStylesPanelSurface(box, emptyStylesPanelValues(), STYLES_PANEL_ACTIONS);
    expect(handle.connected()).toBe(true);
    handle.dispose();
    await handle.ready;
    await flush();
    expect(box.childElementCount).toBe(0);
    expect(handle.connected()).toBe(false);
  });
});

describe("what a row does", () => {
  test("a variable row shows the Variables view, pointed at that property", async () => {
    await paint();
    parts("variable-row")
      .find((r) => r.dataset["token"] === "--font-body")!
      .click();
    const tab = workspace.tabs.get("project.json");
    expect(tab?.session.ui.canvasMode).toBe("tokens");
    expect(shell.stylebook.variable).toBe("--font-body");
    expect(variablesFocus.value.focus).toEqual({ kind: "variable", name: "--font-body" });
    expect(variablesFocus.value.served).toBe(false);
  });

  test("a group heading shows the Variables view at that group", async () => {
    await paint();
    parts("group-row")[2]!.click();
    expect(workspace.tabs.get("project.json")?.session.ui.canvasMode).toBe("tokens");
    expect(variablesFocus.value.focus).toEqual({ add: false, group: "size", kind: "group" });
  });

  test("Add variable focuses the add row of the current property's group, or Colors", async () => {
    expect(addTargetGroup(null)).toBe("color");
    expect(addTargetGroup("--font-body")).toBe("font");
    await paint();
    parts("add-variable")[0]!.click();
    expect(variablesFocus.value.focus).toEqual({ add: true, group: "color", kind: "group" });
    shell.stylebook.variable = "--size-gap";
    parts("add-variable")[0]!.click();
    expect(variablesFocus.value.focus).toEqual({ add: true, group: "size", kind: "group" });
  });

  test("an element row shows the Elements view with the tag selected and the Inspector on Style", async () => {
    shell.docks.right.collapsed = true;
    await paint();
    parts("element-row")
      .find((r) => r.dataset["path"] === "h2")!
      .click();
    const tab = workspace.tabs.get("project.json");
    expect(tab?.session.ui.canvasMode).toBe("stylebook");
    expect(shell.stylebook.selection).toBe("h2");
    expect(tab?.session.ui.rightTab).toBe("style");
    expect(shell.docks.right.collapsed).toBe(false);
  });

  test("Manage color schemes opens Project Settings on Contexts", async () => {
    await paint();
    parts("manage-schemes")[0]!.click();
    await flush();
    expect(runs).toEqual([{ args: { section: "contexts" }, id: "settings.open" }]);
  });

  test("an undeclared group asks for nothing", () => {
    STYLES_PANEL_ACTIONS.showGroup("spacing");
    expect(variablesFocus.value.focus).toBeNull();
    expect(workspace.tabs.has("project.json")).toBe(false);
  });
});
