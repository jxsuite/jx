/**
 * The Outline panel while the pane is showing Project Styles —
 * `src/panels/stylebook-layers-panel.ts` and the surface it mounts,
 * `src/surfaces/panel-stylebook-layers.{json,ts}`.
 *
 * Everything is addressed by `part` and by `data-path` / `data-kind` / `aria-current`, because the
 * catalogue is a document now: there is no `.layer-row` here any more, and the classes of that name
 * that survive in `styles/panels.css` belong to the Outline's own tree.
 *
 * Two halves, tested as two things. {@link stylebookLayersValues} is a pure function of the open
 * document, the shell and the component registry, and every question about WHAT the catalogue
 * contains is asked of it. The mounted document is asked only what it DRAWS — one control per row,
 * named, reachable, and announcing which one is selected.
 *
 * The mount is asynchronous — the kit has to be defined before a document can render — so every
 * setup awaits it.
 */
import { flush, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  detachStylebookLayers,
  mountStylebookLayersPanel,
  stylebookLayersValues,
} from "../src/panels/stylebook-layers-panel";
import { mountStylebookLayersSurface } from "../src/surfaces/panel-stylebook-layers";
import { componentRegistry } from "../src/files/components";
import { closeAllTabs } from "../src/workspace/workspace";
import { resetProjectShell, shell } from "../src/shell";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { StylebookLayersCtx } from "../src/panels/stylebook-layers-panel";

const meta = {
  $sections: [
    { elements: [{ tag: "h1", text: "Heading" }], label: "Headings" },
    {
      elements: [
        {
          children: [
            { tag: "li", text: "One" },
            { tag: "li", text: "Two" },
          ],
          tag: "ul",
        },
      ],
      label: "List",
    },
  ],
};

const selectStylebookTag = mock(
  (_tag: string, _media?: string | null, _opts?: { panCanvas?: boolean }) => {},
);
const ctx = { selectStylebookTag, stylebookMeta: meta } as StylebookLayersCtx;

let host: HTMLElement;

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

function makeTab(style: Record<string, unknown> = {}) {
  return resetWorkspaceWithTab({
    children: [],
    style,
    tagName: "div",
  } as unknown as JxMutableNode);
}

/** Mount the catalogue into a fresh host and let the document render. */
async function renderCatalogue(localCtx: StylebookLayersCtx = ctx): Promise<HTMLElement> {
  host = makeHost();
  mountStylebookLayersPanel(localCtx, host);
  await flush();
  return host;
}

/** Every row the catalogue drew, in order. */
function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[part="row"]')];
}

/** One row by the path it selects. */
function row(path: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[part="row"][data-path="${path}"]`);
  if (!found) {
    throw new Error(`no catalogue row for "${path}"`);
  }
  return found;
}

/** What a row says: its badge, then its name. */
function textOf(el: HTMLElement, part: string): string {
  return el.querySelector(`[part="${part}"]`)?.textContent?.trim() ?? "";
}

beforeEach(() => {
  resetStudioState();
  resetProjectShell();
  selectStylebookTag.mockClear();
  componentRegistry.length = 0;
});

afterEach(() => {
  detachStylebookLayers();
  closeAllTabs();
  document.body.innerHTML = "";
});

// ─── The projection ───────────────────────────────────────────────────────────

describe("stylebookLayersValues", () => {
  test("flattens the catalogue, deduplicating children by tag", () => {
    makeTab();
    const values = stylebookLayersValues(ctx);
    // H1, ul, one deduped li (two li children share the tag).
    expect(values.rows.map((r) => r.key)).toEqual(["h1", "ul", "ul li"]);
    expect(values.rows.map((r) => r.tag)).toEqual(["h1", "ul", "li"]);
    expect(values.tab).toBe("elements");
  });

  test("a child's indent is one step deeper than its parent's", () => {
    makeTab();
    const values = stylebookLayersValues(ctx);
    expect(values.rows.map((r) => r.indent)).toEqual(["8px", "8px", "24px"]);
  });

  test("falls back to <tag> when an entry carries no text", () => {
    makeTab();
    const values = stylebookLayersValues({
      selectStylebookTag,
      stylebookMeta: { $sections: [{ elements: [{ tag: "hr" }], label: "Rule" }] },
    } as StylebookLayersCtx);
    expect(values.rows[0]!.label).toBe("<hr>");
  });

  test("marks the selected LEAF, so a compound selection still finds its row", () => {
    makeTab();
    shell.stylebook.selection = "ul li";
    const selected = stylebookLayersValues(ctx).rows.filter((r) => r.selected);
    expect(selected.map((r) => r.key)).toEqual(["ul li"]);
  });

  test("a '& tag' key with something in it customizes the row; an empty one does not", () => {
    makeTab({ "& h1": { color: "red" }, "& ul": {} });
    const values = stylebookLayersValues(ctx);
    expect(values.rows.map((r) => r.customized)).toEqual([true, false, false]);
  });

  test("component rows carry the glyph, the tag as their name, and select by tag", () => {
    makeTab();
    componentRegistry.push({ tagName: "x-card" } as never, { tagName: "x-nav" } as never);
    shell.stylebook.selection = "x-nav";
    const comps = stylebookLayersValues(ctx).rows.filter((r) => r.kind === "component");
    expect(comps.map((r) => r.key)).toEqual(["x-card", "x-nav"]);
    expect(comps.map((r) => r.label)).toEqual(["x-card", "x-nav"]);
    expect(comps.map((r) => r.selected)).toEqual([false, true]);
  });

  test("variables are the document's own custom properties, and nothing else", () => {
    makeTab({ "--accent": "#f00", "--gap": "8px", h1: { color: "red" } });
    const values = stylebookLayersValues(ctx);
    expect(values.hasVariables).toBe(true);
    expect(values.variables).toEqual([
      { key: "--accent", name: "--accent", value: "#f00" },
      { key: "--gap", name: "--gap", value: "8px" },
    ]);
  });

  test("a document with no style block has no variables", () => {
    resetWorkspaceWithTab({ children: [], tagName: "div" } as unknown as JxMutableNode);
    expect(stylebookLayersValues(ctx).hasVariables).toBe(false);
  });
});

// ─── The document ─────────────────────────────────────────────────────────────

describe("the catalogue surface", () => {
  test("draws one named control per row, badge and label apart", async () => {
    makeTab();
    await renderCatalogue();
    expect(rows()).toHaveLength(3);
    for (const el of rows()) {
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("type")).toBe("button");
    }
    const first = row("h1");
    expect(textOf(first, "badge")).toBe("h1");
    expect(textOf(first, "label")).toBe("Heading");
  });

  test("a child row selects its compound path, a top-level row its bare tag", async () => {
    makeTab();
    await renderCatalogue();
    row("ul li").click();
    expect(selectStylebookTag).toHaveBeenCalledWith("ul li", undefined, { panCanvas: true });
    row("h1").click();
    expect(selectStylebookTag).toHaveBeenLastCalledWith("h1", undefined, { panCanvas: true });
  });

  test("the selected row announces itself, and it is the only one", async () => {
    makeTab();
    shell.stylebook.selection = "ul li";
    await renderCatalogue();
    const current = rows().filter((el) => el.getAttribute("aria-current") === "true");
    expect(current.map((el) => el.dataset.path)).toEqual(["ul li"]);
  });

  test("a styled tag carries the dot, and the dot says what it means", async () => {
    makeTab({ "& h1": { color: "red" } });
    await renderCatalogue();
    const dot = row("h1").querySelector('[part="dot"]');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute("aria-label")).toBe("Styled in this file");
    expect(row("ul").querySelector('[part="dot"]')).toBeNull();
  });

  test("a component row is drawn as one, and clicking it selects the tag", async () => {
    makeTab();
    componentRegistry.push({ tagName: "x-card" } as never);
    await renderCatalogue();
    const comp = row("x-card");
    expect(comp.dataset.kind).toBe("component");
    expect(textOf(comp, "label")).toBe("x-card");
    comp.click();
    expect(selectStylebookTag).toHaveBeenCalledWith("x-card", undefined, { panCanvas: true });
  });

  test("the variables tab lists each property beside its value", async () => {
    makeTab({ "--accent": "#f00", "--gap": "8px", h1: { color: "red" } });
    shell.stylebook.tab = "variables";
    await renderCatalogue();
    const listed = rows();
    expect(listed).toHaveLength(2);
    expect(listed.map((el) => textOf(el, "label"))).toEqual(["--accent", "--gap"]);
    expect(listed.map((el) => textOf(el, "value"))).toEqual(["#f00", "8px"]);
    expect(host.textContent).not.toContain("h1");
  });

  test("no variables teaches what the tab is for", async () => {
    makeTab({ h1: { color: "red" } });
    shell.stylebook.tab = "variables";
    await renderCatalogue();
    expect(rows()).toHaveLength(0);
    expect(host.querySelector('[part="empty-message"]')?.textContent).toContain(
      "No variables defined",
    );
    expect(host.querySelector('[part="empty-detail"]')?.textContent).toBeTruthy();
  });

  test("emits no class of its own — the document styles through `part`", async () => {
    makeTab({ "& h1": { color: "red" } });
    await renderCatalogue();
    const classed = [...host.querySelectorAll("[class]")].filter(
      (el) => !el.classList.contains("panel-body") && !el.classList.contains("panel-content"),
    );
    expect(classed).toEqual([]);
  });

  test("a repaint updates the standing document rather than rebuilding it", async () => {
    makeTab();
    await renderCatalogue();
    const before = row("h1");
    shell.stylebook.selection = "h1";
    mountStylebookLayersPanel(ctx, host);
    await flush();
    expect(row("h1")).toBe(before);
    expect(before.getAttribute("aria-current")).toBe("true");
  });

  test("a mount into another host disposes the one that was standing", async () => {
    /* There is one Navigator, so a mount into a DIFFERENT node is the old one being replaced —
       holding both would leave the first one's effects running against a scope nobody writes. */
    makeTab();
    const first = await renderCatalogue();
    expect(first.querySelectorAll('[part="row"]').length).toBeGreaterThan(0);
    await renderCatalogue();
    await flush();
    expect(first.querySelectorAll('[part="row"]')).toHaveLength(0);
    expect(rows().length).toBeGreaterThan(0);
  });

  test("disposing while the mount is in flight leaves nothing in the container", async () => {
    makeTab();
    const container = document.createElement("div");
    document.body.append(container);
    const handle = mountStylebookLayersSurface(container, stylebookLayersValues(ctx), {
      selectRow: () => {},
    });
    handle.dispose();
    await flush();
    expect(container.querySelectorAll('[part="row"]')).toHaveLength(0);
    expect(handle.connected()).toBe(false);
  });

  test("detaching takes the document back out, so lit's own branch owns the body again", async () => {
    makeTab();
    await renderCatalogue();
    expect(rows().length).toBeGreaterThan(0);
    detachStylebookLayers();
    await flush();
    expect(rows()).toHaveLength(0);
  });
});
