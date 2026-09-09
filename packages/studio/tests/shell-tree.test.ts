/**
 * The shell's mount tree (src/shell/tree.ts) — the one definition of the application frame.
 *
 * It was index.html's body, and, in drifted copies, the body of two dozen test fixtures. The copy
 * in `studio-shell-fixture.ts` had lost `#resize-bottom`, `#bottom-dock` and `#layer-toast`, so
 * every shell-boot test sharing it ran against a shell with no bottom dock and no toast host — and
 * no test could report that, because the fixture WAS the thing under test. These assertions are the
 * ones that could not exist while the frame was markup two dozen files each described for
 * themselves.
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import { mountShellTree, overlayLayers } from "../src/shell/tree";
import { render } from "lit-html";
import shellDoc from "../src/surfaces/shell.json";

async function frame(): Promise<HTMLElement> {
  const host = document.createElement("div");
  await mountShellTree(host);
  return host;
}

/** Every host the application adopts by id, and who adopts it. */
const HOSTS: [id: string, adopter: string][] = [
  ["app", "shell.ts projects the dock record onto this grid"],
  ["toolbar", "surfaces/commandbar.ts mounts into it"],
  ["pane-grid", "panels/pane-grid.ts reconciles a cell per pane"],
  ["activity-bar", "panels/activity-bar.ts renders into it"],
  ["left-panel", "panels/left-panel.ts renders into it"],
  ["resize-left", "ui/panel-resize.ts binds the navigator splitter"],
  ["resize-bottom", "ui/panel-resize.ts binds the dock splitter"],
  ["bottom-dock", "panels/bottom-dock.ts renders into it"],
  ["resize-right", "ui/panel-resize.ts binds the inspector splitter"],
  ["right-panel", "panels/right-panel.ts renders into it"],
  ["statusbar", "surfaces/statusbar.ts renders into it"],
  ["layer-popover", "ui/layers.ts appends popover slots"],
  ["layer-modal", "ui/layers.ts appends modal slots"],
  ["layer-dialog", "ui/layers.ts appends dialog slots"],
  ["layer-toast", "services/notify.ts raises toasts into it"],
];

describe("the frame", () => {
  for (const [id, adopter] of HOSTS) {
    test(`has #${id} — ${adopter}`, async () => {
      const built = await frame();
      expect(built.querySelector(`#${id}`)).not.toBeNull();
    });
  }

  /* The three the drifted fixture had lost, called out as a group: two dozen files agreeing on a
     frame is exactly what nobody was doing, and these are what it cost. */
  test("has the three hosts the old hand-written fixture had silently dropped", async () => {
    const f = await frame();
    for (const id of ["resize-bottom", "bottom-dock", "layer-toast"]) {
      expect(f.querySelector(`#${id}`), `#${id} is missing from the frame`).not.toBeNull();
    }
  });

  test("every id is unique — an adopter that finds two hosts has found the wrong one", async () => {
    const built = await frame();
    const ids = [...built.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  /* Spectrum's theming reaches its descendants through sp-theme, and the whole chrome stylesheet is
     written against a light tree beneath it. A frame rendered outside it is unstyled. */
  test("renders inside the Spectrum theme host", async () => {
    const built = await frame();
    const theme = built.querySelector("sp-theme");
    expect(theme).not.toBeNull();
    expect(theme!.querySelector("#app")).not.toBeNull();
    expect(theme!.getAttribute("system")).toBe("spectrum");
  });

  test("mounting twice reuses the one theme host rather than nesting another", async () => {
    /* The `#app` half is the one the document mount added: a runtime mount APPENDS, so without the
       clear a remount leaves two frames and every `querySelector` silently picks the stale one. */
    const host = document.createElement("div");
    await mountShellTree(host);
    await mountShellTree(host);
    expect(host.querySelectorAll("sp-theme")).toHaveLength(1);
    expect(host.querySelectorAll("#app")).toHaveLength(1);
    expect(host.querySelectorAll("#layer-toast")).toHaveLength(1);
  });

  /* `textContent = ""` strips lit's comment markers but leaves its private part reference behind, so
     the next render reuses a part whose markers are detached. Fixtures clear the body constantly. */
  test("mounting survives a host that was emptied since the last mount", async () => {
    const host = document.createElement("div");
    await mountShellTree(host);
    host.textContent = "";
    await mountShellTree(host);
    expect(host.querySelector("#pane-grid")).not.toBeNull();
    expect(host.querySelector("#layer-toast")).not.toBeNull();
  });
});

describe("regions", () => {
  /* Stamped by the template. They used to live in a selector-to-id map in ui/regions.ts, whose own
     comment gave the reason — these were bare divs in index.html, "so it cannot stamp itself". */
  const REGIONS: [id: string, region: string][] = [
    ["toolbar", "commandbar"],
    ["activity-bar", "rail"],
    ["left-panel", "navigator"],
    ["right-panel", "inspector"],
    ["statusbar", "statusbar"],
    ["layer-toast", "overlay.toasts"],
  ];

  for (const [id, region] of REGIONS) {
    test(`#${id} carries data-jx-region="${region}"`, async () => {
      const built = await frame();
      expect(built.querySelector<HTMLElement>(`#${id}`)!.dataset.jxRegion).toBe(region);
    });
  }
});

describe("the overlay layers", () => {
  function layers(): HTMLElement {
    const host = document.createElement("div");
    render(overlayLayers(), host);
    return host;
  }

  test("are the same four the frame carries, in the same order", async () => {
    const alone = [...layers().querySelectorAll("[id]")].map((el) => el.id);
    const built = await frame();
    const inFrame = [...built.querySelectorAll('[id^="layer-"]')].map((el) => el.id);
    expect(alone).toEqual(["layer-popover", "layer-modal", "layer-dialog", "layer-toast"]);
    expect(inFrame).toEqual(alone);
  });

  /* The ordering the whole overlay system rests on, and the reason it is CSS rather than four
     inline style attributes: check-styles.ts's stacking rule can see a stylesheet. */
  test("stack by class, not by inline style", () => {
    for (const el of layers().querySelectorAll("[id]")) {
      expect(el.getAttribute("style")).toBeNull();
      expect(el.className).toContain("jx-layer");
    }
  });

  /* A live region has to exist before the first thing it announces. */
  test("the toast host is a live region before any toast is raised", () => {
    const toast = layers().querySelector("#layer-toast")!;
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
  });
});

describe("index.html", () => {
  /* The frame is code now. If a copy of it reappears in the document, there are two definitions
     again and this is the test that says so. */
  test("carries no frame of its own", async () => {
    const markup = await Bun.file(new URL("../index.html", import.meta.url)).text();
    for (const [id] of HOSTS) {
      expect(markup, `index.html has grown its own #${id}`).not.toContain(`id="${id}"`);
    }
  });

  test("still loads the entry and the chrome stylesheet", async () => {
    const markup = await Bun.file(new URL("../index.html", import.meta.url)).text();
    expect(markup).toContain('src="./dist/studio.js"');
    expect(markup).toContain('href="./dist/studio.css"');
  });
});

describe("the frame is a document", () => {
  test("mounts anywhere, without a document body", async () => {
    const host = document.createElement("section");
    await mountShellTree(host);
    expect(host.querySelector("#app")).not.toBeNull();
  });

  test("its cells are the document's, not a template's", () => {
    /* The frame is `src/surfaces/shell.json` — a Jx document the runtime renders — so the ids the
       application adopts are readable from the JSON itself rather than only from a rendered tree.
       That is the point of the migration: Studio can open its own frame. */
    const { children } = shellDoc as { children: { attributes: { id: string } }[] };
    expect(children.map((child) => child.attributes.id)).toEqual([
      "toolbar",
      "pane-grid",
      "activity-bar",
      "left-panel",
      "resize-left",
      "resize-bottom",
      "bottom-dock",
      "resize-right",
      "right-panel",
      "statusbar",
    ]);
    expect((shellDoc as { attributes: { id: string } }).attributes.id).toBe("app");
  });

  test("carries no style of its own, because the frame must be laid out by the first paint", () => {
    // Its rules are the generated styles/shell-frame.css (studio-ui-guidelines.md §1.1).
    expect("style" in (shellDoc as Record<string, unknown>)).toBe(false);
  });
});
