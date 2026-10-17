/**
 * Studio shell (C7): `window.__jxAutomation` as a PROJECTION of the composed registry.
 *
 * The four files beside this one boot studio to assert what a URL does. This one boots it with
 * `?automation=1` to assert the thing §13.5's projection rule actually promises — that `run(id,
 * args)` reaches the records defined in the modules that implement them, not a parallel action
 * table. Every other test in this workstream builds its own registry; only this one proves the
 * BOOTSTRAP wires them, which is the failure mode a per-module test cannot see.
 *
 * It is also the test that catches a duplicate id or a chord conflict introduced by a later
 * contribution point: `register()` throws at composition time, so a broken wiring fails here as a
 * boot error rather than as a blank Studio in someone's browser.
 */
import { flush, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { beforeAll, describe, expect, test } from "bun:test";
import { bootStudio } from "./studio-shell-fixture";
import { activeTab, workspace } from "../src/workspace/workspace";
import { getPlatform } from "../src/platform";
import { shell } from "../src/shell";
import { isJsonObject } from "@jxsuite/schema/guards";
import { workspaceHomeTabId } from "../src/workspace/workspace-ids";
import { PROJECT_CONFIG_PATH } from "../src/tabs/tab";
import type { AutomationApi } from "../src/services/automation";
import type { CommandArgValues } from "../src/commands/command-args";

await bootStudio({ url: "http://localhost/?automation=1" });

function api(): AutomationApi {
  const hook = globalThis.__jxAutomation;
  if (!hook) {
    throw new Error("__jxAutomation was not installed");
  }
  return hook;
}

/** Run through the hook expecting a refusal, and return the message it refused with. */
async function refusal(id: string, args?: CommandArgValues): Promise<string> {
  try {
    await api().run(id, args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`__jxAutomation.run("${id}") did not refuse`);
}

beforeAll(() => {
  // The URL fixture boots with no project and no tab, so every project- and document-level record
  // Is correctly gated OFF. Give the app the state a real session has, or the assertions below
  // Would be reading refusals instead of behaviour.
  resetStudioState({ dirs: new Map() });
  const tab = resetWorkspaceWithTab();
  // A selection too: `probe.commands()` is `registry.visible()`, so the selection-level records
  // Are correctly absent until something is selected — which is the projection working, not a gap.
  tab.session.selection = [["children", 0]];
});

describe("the hook installed, over the composed registry", () => {
  test("the projection carries this workstream's records", () => {
    const ids = new Set(
      api()
        .probe.commands()
        .map((c) => c.id),
    );
    for (const id of [
      "canvas.setMode",
      "canvas.setZoom",
      "collection.editInGrid",
      "data.expandRow",
      "data.openGrid",
      "formula.editDef",
      "inspector.setSection",
      "content.showCollection",
      "project.new",
      "settings.open",
      "style.setSelector",
      "view.setActivity",
      "view.setNavigator",
      "view.setRightTab",
    ]) {
      expect([id, ids.has(id)]).toEqual([id, true]);
    }
  });

  test("the two stubbed contribution points are absent, and that is the FIXTURE, not a gap", () => {
    // `studio-shell-fixture.ts` mocks `canvas/canvas-render.ts` and `panels/block-action-bar.ts`
    // Down to stubs (both pull the iframe host and Monaco into a boot that wants neither), so their
    // `registerX` entry points are no-ops here. `tests/canvas-view-commands.test.ts` and
    // `tests/app-commands.test.ts` cover those records; this assertion exists so a reader who
    // Notices them missing finds the reason instead of filing the bug.
    const ids = new Set(
      api()
        .probe.commands()
        .map((c) => c.id),
    );
    expect(ids.has("selection.set")).toBe(false);
    expect(ids.has("selection.convertToComponent")).toBe(false);
  });

  test("`view.setActivity` arrives with its enum, so a script can read the declared panels", () => {
    const record = api()
      .probe.commands()
      .find((c) => c.id === "view.setActivity");
    const schema = record?.args;
    const properties = isJsonObject(schema) ? schema["properties"] : undefined;
    const tab = isJsonObject(properties) ? properties["tab"] : undefined;
    const tabEnum = isJsonObject(tab) ? tab["enum"] : undefined;
    expect(tabEnum).toContain("layers");
    // The three ids this phase renamed are gone from the enum, which is what turns a stale
    // Manifest step red in the PR that renamed them.
    expect(tabEnum).not.toContain("head");
  });
});

describe("run() reaches the implementations", () => {
  test("view.setActivity moves the Navigator", async () => {
    await api().run("view.setActivity", { tab: "files" });
    expect(shell.leftTab).toBe("files");
    expect(shell.docks.left.collapsed).toBe(false);
  });

  test("view.setNavigator closes it, idempotently", async () => {
    await api().run("view.setNavigator", { open: false });
    expect(shell.docks.left.collapsed).toBe(true);
    await api().run("view.setNavigator", { open: false });
    expect(shell.docks.left.collapsed).toBe(true);
    await api().run("view.setNavigator", { open: true });
    expect(shell.docks.left.collapsed).toBe(false);
  });

  test("view.setAssistant selects the Inspector's Assistant tab", async () => {
    // Not a dock any more: the assistant is the Inspector's fourth tab, so "open" means selected
    // With the dock that hosts it open, and "closed" means stepped off it.
    shell.docks.right.collapsed = true;
    await api().run("view.setAssistant", { open: true });
    expect(shell.docks.right.collapsed).toBe(false);
    expect(activeTab.value?.session.ui.rightTab).toBe("assistant");
    await api().run("view.setAssistant", { open: false });
    // The fixture has a node selected, so closing steps onto the tab the strip rests on with a
    // Selection: Element, on its last leaf (Content by default), not the document's Page (§6).
    expect(activeTab.value?.session.ui.rightTab).toBe("properties");
    activeTab.value!.session.selection = [];
    await api().run("view.setAssistant", { open: true });
    await api().run("view.setAssistant", { open: false });
    // With nothing selected it rests on Page.
    expect(activeTab.value?.session.ui.rightTab).toBe("page");
    expect(shell.docks.right.collapsed).toBe(false);
  });

  test("view.setRightTab writes the active tab's Inspector tab", async () => {
    // The bootstrap's `setInspectorTab` closure is the seam under test: it is the one line of
    // Implementation `shell.ts` takes by injection, because `shell` is workspace state and
    // `ui.rightTab` is per-document session state.
    expect(activeTab.value).not.toBeNull();
    await api().run("view.setRightTab", { tab: "style" });
    expect(activeTab.value?.session.ui.rightTab).toBe("style");
    await api().run("view.setRightTab", { tab: "events" });
    expect(activeTab.value?.session.ui.rightTab).toBe("events");
  });

  test("view.setTheme paints the chrome", async () => {
    await api().run("view.setTheme", { color: "light" });
    expect(shell.theme).toBe("light");
    await api().run("view.setTheme", { color: "dark" });
    expect(shell.theme).toBe("dark");
  });

  test("an undeclared panel id refuses through the hook, naming the declared set", async () => {
    expect(await refusal("view.setActivity", { tab: "head" })).toContain(
      "is not declared — declared: site, collections, files, search, git, i18n, layers, data, packages, insert",
    );
  });

  test("an id §13.5 refuses still refuses with the refusal's own note", async () => {
    expect(await refusal("view.setStatus")).toContain("is refused by spec §13.5");
  });
});

describe("the Data panel the commands drive", () => {
  test("view.setActivity data renders the definitions, the values and Refresh", async () => {
    activeTab.value!.doc.document.state = { count: { default: 0, type: "number" } };
    await api().run("view.setActivity", { tab: "data" });
    await flush();
    // ONE panel: the definition row, and what the canvas resolved it to. `state` and `data` were
    // Two tabs listing the same names, and the one holding the editor had no rail button.
    // The panel is a document (`surfaces/panel-signals.json`), so it is addressed by `part`.
    const row = document.querySelector<HTMLElement>('#left-panel [part="entry"]');
    expect(row?.dataset["signal"]).toBe("count");
    expect(row?.querySelector('[part="name"]')?.textContent).toBe("count");
    // No canvas has rendered in this fixture, so the row shows how the entry is DEFINED. It starts
    // Showing what the entry became the moment a scope arrives — one slot, and the value wins it.
    const summary = row?.querySelector<HTMLElement>('[part="summary"]');
    expect(summary?.dataset["tone"]).toBe("hint");
    expect(summary?.textContent).toBe("number");
    const refresh = document.querySelector<HTMLElement>(
      '#left-panel [part="refresh"] [part="control"]',
    );
    expect(refresh).not.toBeNull();
    // `refreshData` is the one bootstrap callback the Data panel owns: a canvas re-render that
    // ALSO lets automatic `Request` state entries fetch. Reaching it through the rendered button
    // Is the only honest way — `left-panel.ts` keeps its ctx module-private, by design.
    refresh?.click();
    await flush();
    expect(shell.leftTab).toBe("data");
  });
});

describe("view.setWorkspace reaches the bootstrap's homes", () => {
  /* The switch takes its homes by injection (`workspaceDeps` in studio.ts), because the Library and
     the configuration document belong to other modules. A per-module test hands in its own doubles,
     so only a boot can prove the bootstrap hands in the REAL openers, and that the follow it
     installs and the command it registers share them. */
  test("each workspace with no tab of its own opens its home, and Design returns to the page", async () => {
    const page = activeTab.value;
    expect(page).not.toBeNull();
    expect(shell.workspace).toBe("design");

    await api().run("view.setWorkspace", { workspace: "media" });
    expect(shell.workspace).toBe("media");
    expect(activeTab.value?.id).toBe(workspaceHomeTabId("media"));

    await api().run("view.setWorkspace", { workspace: "publish" });
    expect(shell.workspace).toBe("publish");
    expect(activeTab.value?.id).toBe(workspaceHomeTabId("publish"));

    await api().run("view.setWorkspace", { workspace: "content" });
    expect(shell.workspace).toBe("content");
    expect(activeTab.value?.id).toBe(workspaceHomeTabId("content"));

    // Styles' home is `project.json` in its stylebook editor, and its preset selects the
    // Inspector's Style tab ON that document, through the bootstrap's `setInspectorTab`.
    await api().run("view.setWorkspace", { workspace: "styles" });
    expect(shell.workspace).toBe("styles");
    expect(activeTab.value?.id).toBe(PROJECT_CONFIG_PATH);
    expect(activeTab.value?.session.ui.canvasMode).toBe("stylebook");
    expect(activeTab.value?.session.ui.rightTab).toBe("style");

    await api().run("view.setWorkspace", { workspace: "design" });
    expect(shell.workspace).toBe("design");
    expect(activeTab.value?.id).toBe(page?.id);
  });

  /* `pane.compareWith` reads into the other pane without moving the keyboard. The bootstrap wraps
     its opener so a compared document of ANOTHER workspace is revealed (entering that workspace)
     rather than left hidden by that pane's strip. */
  test("comparing with another workspace's document enters that workspace", async () => {
    await getPlatform().writeFile(PROJECT_CONFIG_PATH, JSON.stringify({ name: "x" }));
    expect(shell.workspace).toBe("design");
    await api().run("pane.compareWith", { path: PROJECT_CONFIG_PATH });
    await flush();
    const compared = [...workspace.tabs.values()].find(
      (tab) => tab.documentPath === PROJECT_CONFIG_PATH,
    );
    expect(compared).toBeDefined();
    expect(shell.workspace).toBe("styles");
    expect(activeTab.value?.documentPath).toBe(PROJECT_CONFIG_PATH);
  });
});
