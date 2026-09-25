/**
 * `src/surfaces/settings-pane.ts` and its document — the chrome of the Project Settings editor.
 *
 * What `settings-document.test.ts` asserts is what a reader sees once a section has drawn into the
 * pane. What is asserted HERE is the seam that made the conversion possible and the two states the
 * flow above cannot reach: the island the adapter holds rather than queries for, the list's own
 * tablist contract, and a dispose that lands while the mount is still in flight.
 */
import { flush } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { mountSettingsPaneSurface } from "../src/surfaces/settings-pane";
import { mountsOf, resetSurfaceRegistry } from "../src/services/surface-registry";
import type { SettingsPaneValues } from "../src/surfaces/settings-pane";

let host: HTMLElement;
let chosen: string[];

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  resetSurfaceRegistry();
  chosen = [];
});

function values(overrides: Partial<SettingsPaneValues> = {}): SettingsPaneValues {
  return {
    active: "overview",
    activeTabId: "settings-nav-overview",
    empty: "No settings sections.",
    hasSection: true,
    navLabel: "Project Settings sections",
    sections: [
      { key: "overview", label: "Overview", tabId: "settings-nav-overview" },
      { key: "contexts", label: "Contexts", tabId: "settings-nav-contexts" },
    ],
    ...overrides,
  };
}

function mount(initial: SettingsPaneValues = values()) {
  return mountSettingsPaneSurface(host, initial, {
    selectSection: (key) => chosen.push(key),
  });
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[part="nav-item"]')];
}

describe("the settings pane surface", () => {
  test("draws a vertical tablist whose rows name the panel, and holds the island", async () => {
    const surface = mount();
    await flush(3);

    const nav = host.querySelector('[part="nav"]')!;
    /* A tablist, not a `<nav>` of links: choosing a settings section moves no location, so
       `aria-current="page"` was the wrong word for it — and vertical is what makes ↑/↓ walk the
       column and Home/End reach its ends, which a column of buttons never did. */
    expect(nav.getAttribute("role")).toBe("tablist");
    expect(nav.getAttribute("aria-orientation")).toBe("vertical");
    expect(nav.getAttribute("aria-label")).toBe("Project Settings sections");

    expect(rows().map((r) => r.getAttribute("label"))).toEqual(["Overview", "Contexts"]);
    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    // Both ids are minted from one key, which is the only thing that pairs a tab to its panel.
    expect(rows()[0]!.id).toBe("settings-nav-overview");
    expect(rows().every((r) => r.getAttribute("aria-controls") === "settings-pane-panel")).toBe(
      true,
    );

    const panel = host.querySelector("#settings-pane-panel")!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe("settings-nav-overview");

    /* The island: the adapter HOLDS it as the node is created rather than querying for a node this
       package renders (§9.4), and the document never writes into it — a section renderer does. */
    const island = surface.body()!;
    expect(island).toBe(host.querySelector('[part="body"]') as HTMLElement);
    expect(island.childElementCount).toBe(0);
    expect(panel.contains(island)).toBe(true);

    surface.dispose();
  });

  test("update moves the selection and the panel's name with it", async () => {
    const surface = mount();
    await flush(3);

    surface.update(values({ active: "contexts", activeTabId: "settings-nav-contexts" }));
    await flush(2);

    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(host.querySelector("#settings-pane-panel")!.getAttribute("aria-labelledby")).toBe(
      "settings-nav-contexts",
    );
    // The island is the SAME element: a selection change is an assignment, not a rebuild, which is
    // What lets a section keep the caret in a half-typed field across an idle redraw.
    expect(surface.body()).toBe(host.querySelector('[part="body"]') as HTMLElement);

    surface.dispose();
  });

  test("a row's activation names its section, and nothing else decides which", async () => {
    const surface = mount();
    await flush(3);

    rows()[1]!.click();
    await flush(2);

    // The document reports; the flow decides. Nothing here has written the selection.
    expect(chosen).toEqual(["contexts"]);

    surface.dispose();
  });

  test("with no section registered the document says so, beside an island left empty", async () => {
    const surface = mount(values({ hasSection: false, sections: [] }));
    await flush(3);

    expect(rows()).toHaveLength(0);
    expect(host.querySelector('[part="empty"]')!.textContent).toBe("No settings sections.");
    // The sentence is a SIBLING of the island, never inside it: the island belongs to a renderer.
    expect(surface.body()!.childElementCount).toBe(0);

    surface.update(values());
    await flush(2);
    expect(host.querySelector('[part="empty"]')).toBeNull();

    surface.dispose();
  });

  test("a dispose while the mount is in flight disposes it rather than orphaning it", async () => {
    const surface = mount();
    // Synchronous, so `mountSurface` has not resolved: the branch that has to clean up is the one
    // Inside the mount's own `then`.
    surface.dispose();
    await surface.ready;
    await flush(2);

    expect(mountsOf("settings-pane")).toHaveLength(0);
    expect(surface.body()).toBeNull();
    // Idempotent: a second dispose over a record that has already let go is a no-op.
    expect(() => surface.dispose()).not.toThrow();
  });
});
