/**
 * The tab strip draws the workspace on screen's tabs, and no other's.
 *
 * Every tab belongs to one workspace (`workspace/tab-workspace.ts`), and a pane keeps all of its
 * tabs in its order whichever workspace is showing: what the workspace changes is which of them the
 * strip DRAWS. The cases open tabs of two workspaces into one pane and switch `shell.workspace`
 * underneath the mounted strip.
 */
import { flush, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setFormats } from "../src/format/format-host";
import { MARKDOWN_FORMAT } from "./format-fixture";
import { hiddenTabIds, mount, unmount } from "../src/panels/tab-strip";
import { closeAllTabs, moveTabToPane, openTab, workspace } from "../src/workspace/workspace";
import { initLayers } from "../src/ui/layers";
import { shell } from "../src/shell";
import { workspaceHomeTabId } from "../src/workspace/workspace-ids";

let host: HTMLElement;

function open(id: string, documentPath: string | null = id, mode?: string) {
  const tab = openTab({
    document: { children: [], tagName: "div" },
    documentPath,
    id,
    ...(mode !== undefined && { capabilities: { modes: [mode] } }),
  });
  if (mode !== undefined) {
    tab.session.ui.canvasMode = mode;
  }
  return tab;
}

const labels = () =>
  [...host.querySelectorAll<HTMLElement>('[part="tab"]')].map(
    (el) => el.querySelector('[part="label"]')?.textContent,
  );

beforeEach(() => {
  setFormats([MARKDOWN_FORMAT]);
  resetStudioState({
    projectConfig: { content: { posts: { format: "Markdown", source: "./content/posts/" } } },
  });
  document.body.innerHTML = `
    <div id="tab-strip"></div>
    <div id="layer-popover"></div>
    <div id="layer-modal"></div>
    <div id="layer-dialog"></div>
  `;
  initLayers();
  host = document.querySelector<HTMLElement>("#tab-strip")!;
  closeAllTabs();
  shell.workspace = "design";
  mount(host);
});

afterEach(() => {
  unmount();
  closeAllTabs();
  shell.workspace = "design";
  document.body.innerHTML = "";
});

describe("the strip follows the workspace", () => {
  test("it draws only the workspace's tabs, in the pane's order", async () => {
    open("pages/index.json");
    open("content/posts/hello.md");
    open("pages/about.json");
    shell.workspace = "design";
    await flush();
    expect(labels()).toEqual(["/", "/about"]);
    shell.workspace = "content";
    await flush();
    expect(labels()).toEqual(["hello.md"]);
    // The pane still holds all three.
    expect(workspace.panes[0]!.tabOrder).toHaveLength(3);
  });

  test("a chip's drop index is its slot in the pane's full order", async () => {
    open("pages/index.json");
    open("content/posts/hello.md");
    open("pages/about.json");
    shell.workspace = "design";
    await flush();
    const chips = [...host.querySelectorAll<HTMLElement>('[part="tab"]')];
    expect(chips.map((chip) => chip.getAttribute("value"))).toEqual([
      "pages/index.json",
      "pages/about.json",
    ]);
  });

  test("a pane whose every tab is another workspace's draws no strip", async () => {
    open("content/posts/hello.md");
    shell.workspace = "media";
    await flush();
    expect(host.querySelector('[part="tabs"]')).toBeNull();
  });

  test("a tab whose editor moves it to another workspace leaves this strip", async () => {
    // An entry form is Content's whatever document it is over (`workspace/tab-workspace.ts`).
    const about = open("pages/about.json", "pages/about.json", "edit");
    open("pages/index.json");
    shell.workspace = "design";
    await flush();
    expect(labels()).toEqual(["/about", "/"]);
    about.session.ui.canvasMode = "entry";
    await flush();
    expect(labels()).toEqual(["/"]);
  });

  test("a workspace home's chip reads the workspace's title", async () => {
    open(workspaceHomeTabId("media"), null, "media-home");
    shell.workspace = "media";
    await flush();
    expect(labels()).toEqual(["Media"]);
  });

  test("the overflow list and the hidden-tab read stay inside the workspace", async () => {
    open("pages/index.json");
    open("content/posts/hello.md");
    shell.workspace = "content";
    await flush();
    // Happy-dom measures nothing as hidden, so the read is empty and the menu lists the strip.
    expect(hiddenTabIds()).toEqual([]);
  });

  test("moving a tab into a pane keeps working with the filter on", async () => {
    open("pages/index.json");
    open("pages/about.json");
    const [pane] = workspace.panes;
    moveTabToPane("pages/about.json", pane!.id, 0);
    await flush();
    expect(labels()).toEqual(["/about", "/"]);
  });
});
