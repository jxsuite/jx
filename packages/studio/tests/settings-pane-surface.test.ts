/**
 * `src/surfaces/settings-pane.ts` and its document: the columns of the Project Settings dialog.
 *
 * What `settings-document.test.ts` asserts is what a reader sees once a section has drawn. What is
 * asserted HERE is the seam that made the document possible and the states the flow above cannot
 * reach on purpose: the island the adapter holds rather than queries for, the grouped lists' own
 * tablist contract, the Moved footnote, a failure sentence, and a dispose that lands while the
 * mount is still in flight.
 */
import { flush } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { mountSettingsPaneSurface } from "../src/surfaces/settings-pane";
import { mountsOf, resetSurfaceRegistry } from "../src/services/surface-registry";
import type { SettingsPaneGroup, SettingsPaneValues } from "../src/surfaces/settings-pane";

let host: HTMLElement;
let chosen: string[];
let moved: string[];

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  resetSurfaceRegistry();
  chosen = [];
  moved = [];
});

function group(id: string, label: string, keys: string[], note = ""): SettingsPaneGroup {
  return {
    id,
    label,
    note,
    sections: keys.map((key) => ({ key, label: key, tabId: `settings-nav-${key}` })),
    tabsLabel: note === "" ? label : `${label}, ${note.toLowerCase()}`,
    titleId: `settings-group-${id}`,
  };
}

function values(overrides: Partial<SettingsPaneValues> = {}): SettingsPaneValues {
  return {
    active: "overview",
    activeTabId: "settings-nav-overview",
    empty: "No settings sections.",
    failure: "",
    groups: [
      group("general", "General", ["overview", "locales"]),
      group("advanced", "Advanced", ["contexts"], "For developers"),
    ],
    hasSection: true,
    intro: "",
    moved: [
      {
        linkLabel: "Colors and fonts moved to Styles. Go to Styles",
        place: "Styles",
        what: "Colors and fonts",
        workspace: "styles",
      },
    ],
    ...overrides,
  };
}

function mount(initial: SettingsPaneValues = values()) {
  return mountSettingsPaneSurface(host, initial, {
    openMoved: (workspace) => moved.push(workspace),
    selectSection: (key) => chosen.push(key),
  });
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[part="nav-item"]')];
}

function strips(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[part="group-tabs"]')];
}

describe("the settings pane surface", () => {
  test("draws one vertical tablist per group, each named by its heading", async () => {
    const surface = mount();
    await flush(3);

    /* A tablist may own only tabs, so a heading between two runs of rows has to END one list: three
       groups are three lists, each one tab stop, each named by the heading above it. */
    expect(strips().map((strip) => strip.getAttribute("role"))).toEqual(["tablist", "tablist"]);
    expect(strips().map((strip) => strip.getAttribute("aria-orientation"))).toEqual([
      "vertical",
      "vertical",
    ]);
    expect(strips().map((strip) => strip.getAttribute("aria-label"))).toEqual([
      "General",
      "Advanced, for developers",
    ]);
    const titles = [...host.querySelectorAll('[part="group-title"]')];
    expect(titles.map((title) => title.textContent)).toEqual(["General", "AdvancedFor developers"]);
    expect(host.querySelector('[part="group-note"]')?.textContent).toBe("");

    expect(rows().map((r) => r.getAttribute("label"))).toEqual(["overview", "locales", "contexts"]);
    // One selection across all three lists: only the active row's list has a selected tab.
    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(rows().every((r) => r.getAttribute("aria-controls") === "settings-pane-panel")).toBe(
      true,
    );

    const panel = host.querySelector("#settings-pane-panel")!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe("settings-nav-overview");

    /* The island: the adapter HOLDS it as the node is created rather than querying for a node this
       package renders (studio-ui-guidelines.md §9.4), and the document never writes into it. It is
       not named `body`, because the dialog it sits in draws a `[part="body"]` of its own. */
    const island = surface.body()!;
    expect(host.querySelector('[part="section-host"]')).toBe(island);
    expect(host.querySelector('[part="body"]')).toBeNull();
    expect(island.childElementCount).toBe(0);
    expect(panel.contains(island)).toBe(true);

    surface.dispose();
  });

  test("the group intro opens the body above the island, and an empty one draws nothing", async () => {
    const surface = mount();
    await flush(3);

    const intro = host.querySelector<HTMLElement>('[part="group-intro"]')!;
    expect(intro.textContent).toBe("");
    // Above the island, inside the panel the active row names.
    expect(intro.nextElementSibling).toBe(surface.body());

    surface.update(
      values({
        active: "contexts",
        activeTabId: "settings-nav-contexts",
        intro: "Changes here affect every page. Most sites never need them.",
      }),
    );
    await flush(2);
    expect(host.querySelector('[part="group-intro"]')!.textContent).toBe(
      "Changes here affect every page. Most sites never need them.",
    );

    surface.dispose();
  });

  test("update moves the selection into another group, and the panel's name with it", async () => {
    const surface = mount();
    await flush(3);

    surface.update(values({ active: "contexts", activeTabId: "settings-nav-contexts" }));
    await flush(2);

    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    expect(host.querySelector("#settings-pane-panel")!.getAttribute("aria-labelledby")).toBe(
      "settings-nav-contexts",
    );
    // The island is the SAME element: a selection change is an assignment, not a rebuild.
    expect(host.querySelector('[part="section-host"]')).toBe(surface.body());

    surface.dispose();
  });

  test("a row's activation names its section, and nothing else decides which", async () => {
    const surface = mount();
    await flush(3);

    rows()[2]!.click();
    await flush(2);

    expect(chosen).toEqual(["contexts"]);
    surface.dispose();
  });

  test("the Moved footnote names where each thing went, and its button names the workspace", async () => {
    const surface = mount();
    await flush(3);

    const row = host.querySelector<HTMLElement>('[part="moved-row"][data-moved="styles"]')!;
    expect(row.textContent).toContain("Colors and fonts →");
    const link = row.querySelector<HTMLElement>('[part="moved-link"]')!;
    expect(link.textContent).toContain("Styles");
    link.click();
    await flush();
    expect(moved).toEqual(["styles"]);

    surface.dispose();
  });

  test("a failure is said in the body, as an alert, and goes when it is cleared", async () => {
    const surface = mount(values({ failure: "Could not show Overview: boom" }));
    await flush(3);

    const failure = host.querySelector('[part="failure"]')!;
    expect(failure.textContent).toBe("Could not show Overview: boom");
    expect(failure.getAttribute("role")).toBe("alert");

    surface.update(values());
    await flush(2);
    expect(host.querySelector('[part="failure"]')).toBeNull();

    surface.dispose();
  });

  test("focusActive puts the keyboard on the selected row, and is a no-op before the mount", async () => {
    const surface = mount(values({ active: "contexts", activeTabId: "settings-nav-contexts" }));
    // Before the mount has landed there is no row to focus, and asking is not an error.
    expect(() => surface.focusActive()).not.toThrow();
    await flush(3);
    surface.focusActive();
    const active = document.activeElement;
    expect(active instanceof HTMLElement ? active.dataset["section"] : "").toBe("contexts");
    surface.dispose();
  });

  test("with no section registered the document says so, beside an island left empty", async () => {
    const surface = mount(values({ groups: [], hasSection: false }));
    await flush(3);

    expect(rows()).toHaveLength(0);
    expect(host.querySelector('[part="empty"]')!.textContent).toBe("No settings sections.");
    expect(surface.body()!.childElementCount).toBe(0);

    surface.update(values());
    await flush(2);
    expect(host.querySelector('[part="empty"]')).toBeNull();

    surface.dispose();
  });

  test("a dispose while the mount is in flight disposes it rather than orphaning it", async () => {
    const surface = mount();
    surface.dispose();
    await surface.ready;
    await flush(2);

    expect(mountsOf("settings-pane")).toHaveLength(0);
    expect(surface.body()).toBeNull();
    expect(() => surface.dispose()).not.toThrow();
  });
});
