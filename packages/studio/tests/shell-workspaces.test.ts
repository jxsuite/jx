/**
 * The workspace half of the shell record — `shell.workspace`, its presets, its per-project
 * persistence, the rail class, and `view.setWorkspace` with its five chords.
 *
 * What the cases defend: entering a workspace lays the frame out by its preset on EVERY entry
 * (`specs/studio.md` §22.3), carrying only the Navigator panel of a workspace that names none;
 * Content draws its Inspector only while an entry is written on the canvas; opening a project
 * applies its workspace's frame, so one project's docks never leak into the next; a stored record
 * from the build that had named layouts (or any other stale id) is dropped silently rather than
 * throwing; the rail is drawn in Design alone; and the verb is a setter, idempotent, reachable by
 * ⌘1–5.
 */
import "./with-dom.js";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import {
  applyDockLayout,
  enterWorkspace,
  persistedWorkspace,
  persistProjectShell,
  presetInspectorOpen,
  RAIL_HIDDEN_CLASS,
  registerShellViewCommands,
  resetProjectShell,
  shell,
  syncProjectWorkspace,
  WORKSPACE_PRESETS,
} from "../src/shell";
import { setWorkspaceProject } from "../src/workspace/workspace";
import { WORKSPACE_IDS } from "../src/workspace/workspace-ids";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonObject } from "@jxsuite/schema/types";
import type { InspectorTabId } from "../src/shell";
import type { WorkspaceId } from "../src/workspace/workspace-ids";

const setInspectorTab = mock((_tab: InspectorTabId) => {});
const deps = { setInspectorTab };

/** The record a project root's workspace is persisted in. */
const recordKey = (root: string) => `jx-studio-project::${root}`;

function stored(root: string): JsonObject {
  const parsed: unknown = JSON.parse(localStorage.getItem(recordKey(root)) ?? "{}");
  return isJsonObject(parsed) ? parsed : {};
}

beforeEach(() => {
  localStorage.clear();
  setInspectorTab.mockClear();
  setWorkspaceProject(null);
  resetProjectShell();
  syncProjectWorkspace(null);
  shell.leftTab = "layers";
  shell.docks.left.collapsed = false;
  shell.docks.right.collapsed = false;
  shell.docks.bottom.collapsed = true;
  document.body.textContent = "";
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
});

afterEach(() => {
  setWorkspaceProject(null);
});

describe("the presets", () => {
  test("there is one per workspace, and only Design draws the rail", () => {
    expect(Object.keys(WORKSPACE_PRESETS).toSorted()).toEqual([...WORKSPACE_IDS].toSorted());
    for (const id of WORKSPACE_IDS) {
      expect(WORKSPACE_PRESETS[id].id).toBe(id);
      expect(WORKSPACE_PRESETS[id].rail).toBe(id === "design");
    }
  });

  test("Content, Media and Publish collapse both side docks; Design and Styles open both", () => {
    for (const id of ["content", "media", "publish"] as const) {
      expect(WORKSPACE_PRESETS[id].navigator.open).toBe(false);
      expect(WORKSPACE_PRESETS[id].inspector.open).toBe(false);
    }
    for (const id of ["design", "styles"] as const) {
      expect(WORKSPACE_PRESETS[id].navigator.open).toBe(true);
      expect(WORKSPACE_PRESETS[id].inspector.open).toBe(true);
    }
    expect(WORKSPACE_PRESETS.styles.navigator.panel).toBe("layers");
    expect(WORKSPACE_PRESETS.styles.inspector.tab).toBe("style");
  });
});

describe("enterWorkspace", () => {
  test("lays the frame out by the preset on first entry", () => {
    expect(shell.workspace).toBe("design");
    expect(enterWorkspace("media", deps)).toBe(true);
    expect(shell.workspace).toBe("media");
    expect(shell.docks.left.collapsed).toBe(true);
    expect(shell.docks.right.collapsed).toBe(true);
    // The Bottom dock is no workspace's: it stays as it was left.
    expect(shell.docks.bottom.collapsed).toBe(true);
    expect(setInspectorTab).not.toHaveBeenCalled();
  });

  test("Styles opens the Outline and the Style tab", () => {
    shell.leftTab = "files";
    enterWorkspace("styles", deps);
    expect(shell.leftTab).toBe("layers");
    expect(shell.docks.left.collapsed).toBe(false);
    expect(shell.docks.right.collapsed).toBe(false);
    expect(setInspectorTab).toHaveBeenCalledWith("style");
  });

  test("re-entering the workspace on screen changes nothing — the verb is idempotent", () => {
    enterWorkspace("media", deps);
    // The author opens the Navigator inside Media; entering Media again must not put it back.
    shell.docks.left.collapsed = false;
    expect(enterWorkspace("media", deps)).toBe(false);
    expect(shell.docks.left.collapsed).toBe(false);
  });

  test("every entry applies the preset again; only the Navigator panel is carried", () => {
    shell.leftTab = "data";
    shell.docks.right.collapsed = true;
    enterWorkspace("publish", deps);
    expect(shell.docks.left.collapsed).toBe(true);
    enterWorkspace("design", deps);
    // Design's preset draws both docks, over the Inspector the author had closed before leaving…
    expect(shell.docks.left.collapsed).toBe(false);
    expect(shell.docks.right.collapsed).toBe(false);
    // …and comes back on the panel it was left on.
    expect(shell.leftTab).toBe("data");
  });

  test("a workspace that names its panel is not where Design's panel is remembered from", () => {
    shell.leftTab = "files";
    enterWorkspace("styles", deps);
    expect(shell.leftTab).toBe("layers");
    enterWorkspace("design", deps);
    expect(shell.leftTab).toBe("files");
  });

  test("the dock toggles still work inside a workspace, and the next entry resets them", () => {
    enterWorkspace("content", deps);
    shell.docks.right.collapsed = false;
    expect(shell.docks.right.collapsed).toBe(false);
    enterWorkspace("design", deps);
    enterWorkspace("content", deps);
    expect(shell.docks.right.collapsed).toBe(true);
  });

  test("Content draws its Inspector only while an entry is written on the canvas", () => {
    expect(presetInspectorOpen("content", false)).toBe(false);
    expect(presetInspectorOpen("content", true)).toBe(true);
    expect(presetInspectorOpen("media", true)).toBe(false);
    expect(presetInspectorOpen("design", false)).toBe(true);
    enterWorkspace("content", { ...deps, writingOnCanvas: () => true });
    expect(shell.docks.right.collapsed).toBe(false);
    expect(shell.docks.left.collapsed).toBe(true);
    enterWorkspace("design", deps);
    enterWorkspace("content", { ...deps, writingOnCanvas: () => false });
    expect(shell.docks.right.collapsed).toBe(true);
  });

  test("works with no Inspector writer to hand", () => {
    enterWorkspace("styles");
    expect(shell.workspace).toBe("styles");
  });
});

describe("the rail", () => {
  test("is drawn in Design, and its column is taken out of the grid everywhere else", () => {
    const app = document.querySelector("#app")!;
    applyDockLayout();
    expect(app.classList.contains(RAIL_HIDDEN_CLASS)).toBe(false);
    for (const id of ["content", "media", "styles", "publish"] as const) {
      enterWorkspace(id, deps);
      applyDockLayout();
      expect(app.classList.contains(RAIL_HIDDEN_CLASS)).toBe(true);
    }
    enterWorkspace("design", deps);
    applyDockLayout();
    expect(app.classList.contains(RAIL_HIDDEN_CLASS)).toBe(false);
  });
});

describe("persistence per project root", () => {
  test("the workspace is written to the project's own record, and read back", () => {
    setWorkspaceProject("/acme");
    syncProjectWorkspace("/acme");
    enterWorkspace("media", deps);
    const record = stored("/acme");
    expect(record.workspace).toBe("media");
    // Frames are presets, not records: nothing about the docks is stored per workspace.
    expect(record.frames).toBeUndefined();
    expect(persistedWorkspace("/acme")).toBe("media");
    expect(persistedWorkspace("/nothing-here")).toBe("design");
    expect(persistedWorkspace(null)).toBe("design");
  });

  test("opening a project applies its workspace's frame, so docks never leak between projects", () => {
    setWorkspaceProject("/a");
    syncProjectWorkspace("/a");
    enterWorkspace("media", deps);
    expect(shell.docks.left.collapsed).toBe(true);
    expect(shell.docks.right.collapsed).toBe(true);
    localStorage.setItem(recordKey("/b"), JSON.stringify({ workspace: "design" }));
    resetProjectShell();
    setWorkspaceProject("/b");
    syncProjectWorkspace("/b");
    expect(shell.workspace).toBe("design");
    expect(shell.docks.left.collapsed).toBe(false);
    expect(shell.docks.right.collapsed).toBe(false);
  });

  test("closing to no project leaves the docks alone", () => {
    setWorkspaceProject("/a");
    syncProjectWorkspace("/a");
    enterWorkspace("publish", deps);
    resetProjectShell();
    setWorkspaceProject(null);
    syncProjectWorkspace(null);
    expect(shell.workspace).toBe("design");
    expect(shell.docks.left.collapsed).toBe(true);
  });

  test("a project opens in the workspace it was left in, and another project in its own", () => {
    setWorkspaceProject("/acme");
    syncProjectWorkspace("/acme");
    enterWorkspace("publish", deps);
    resetProjectShell();
    setWorkspaceProject("/other");
    syncProjectWorkspace("/other");
    expect(shell.workspace).toBe("design");
    resetProjectShell();
    setWorkspaceProject("/acme");
    syncProjectWorkspace("/acme");
    expect(shell.workspace).toBe("publish");
  });

  test("loading is idempotent per root, so a re-run does not clobber the live value", () => {
    setWorkspaceProject("/acme");
    syncProjectWorkspace("/acme");
    shell.workspace = "styles";
    syncProjectWorkspace("/acme");
    expect(shell.workspace).toBe("styles");
  });

  test("a record from the build that had named layouts migrates silently to Design", () => {
    localStorage.setItem(
      recordKey("/legacy"),
      JSON.stringify({ activeLayout: "ship", layouts: [{ id: "ship", name: "Ship" }] }),
    );
    expect(() => {
      syncProjectWorkspace("/legacy");
    }).not.toThrow();
    expect(shell.workspace).toBe("design");
    // …and the next write drops the dead keys.
    setWorkspaceProject("/legacy");
    persistProjectShell();
    const record = stored("/legacy");
    expect(record.layouts).toBeUndefined();
    expect(record.activeLayout).toBeUndefined();
    expect(record.workspace).toBe("design");
  });

  test("a stale or hand-edited workspace id, or a corrupt record, never throws", () => {
    for (const [root, raw] of [
      ["/stale", JSON.stringify({ workspace: "write" })],
      ["/number", JSON.stringify({ workspace: 3 })],
      ["/corrupt", "{not json"],
      ["/array", "[]"],
    ] as const) {
      localStorage.setItem(recordKey(root), raw);
      expect(() => {
        syncProjectWorkspace(root);
      }).not.toThrow();
      expect(shell.workspace).toBe("design");
    }
  });

  test("frames stored by an earlier build are ignored, and dropped on the next write", () => {
    localStorage.setItem(
      recordKey("/frames"),
      JSON.stringify({
        frames: { design: { leftOpen: false, leftTab: "data", rightOpen: false } },
        workspace: "media",
      }),
    );
    setWorkspaceProject("/frames");
    syncProjectWorkspace("/frames");
    expect(shell.workspace).toBe("media");
    enterWorkspace("design", deps);
    expect(shell.docks.left.collapsed).toBe(false);
    expect(shell.docks.right.collapsed).toBe(false);
    expect(stored("/frames").frames).toBeUndefined();
  });

  test("a remembered panel id that no longer exists leaves the Navigator panel alone", () => {
    shell.leftTab = "problems";
    enterWorkspace("media", deps);
    shell.leftTab = "files";
    enterWorkspace("design", deps);
    expect(shell.leftTab).toBe("files");
  });
});

describe("view.setWorkspace and ⌘1–5", () => {
  function build(projectOpen = true, showWorkspace?: (id: WorkspaceId) => void) {
    const registry = createCommandRegistry({
      getContext: () => makeContext({ project: { open: projectOpen } }),
      mac: true,
    });
    registerShellViewCommands(registry, {
      inspectorTab: () => "properties",
      setInspectorTab,
      ...(showWorkspace && { showWorkspace }),
    });
    return registry;
  }

  test("is a setter: the same argument twice is the same state", async () => {
    const registry = build();
    await registry.run("view.setWorkspace", { workspace: "media" });
    await registry.run("view.setWorkspace", { workspace: "media" });
    expect(shell.workspace).toBe("media");
  });

  test("refuses an undeclared workspace, naming the declared set", () => {
    const registry = build();
    expect(() => registry.run("view.setWorkspace", { workspace: "ship" })).toThrow(
      /declared: design, content, media, styles, publish/,
    );
    expect(shell.workspace).toBe("design");
  });

  test("hands the switch to the injected flow when there is one", async () => {
    const shown: WorkspaceId[] = [];
    const registry = build(true, (id) => shown.push(id));
    await registry.run("view.setWorkspace", { workspace: "styles" });
    await registry.run("workspace.focus.publish");
    expect(shown).toEqual(["styles", "publish"]);
  });

  test("⌘1–5 are the five workspaces, in top-bar order, each in the palette", async () => {
    const registry = build();
    for (const [index, id] of WORKSPACE_IDS.entries()) {
      const command = registry.keymap.resolveChord(`mod+${index + 1}`, ["global"]);
      expect(command?.commandId).toBe(`workspace.focus.${id}`);
      expect(registry.get(`workspace.focus.${id}`)?.menus).toEqual(["palette"]);
      await registry.run(`workspace.focus.${id}`);
      expect(shell.workspace).toBe(id);
    }
    expect(registry.get("workspace.focus.publish")?.title).toBe("Go to Publish");
    // The setter is the scripted door; the five rows are the palette's.
    expect(registry.get("view.setWorkspace")?.menus).toEqual(["never"]);
  });

  test("needs an open project, and says so", () => {
    const registry = build(false);
    expect(registry.isVisible("view.setWorkspace")).toBe(false);
    expect(registry.isVisible("workspace.focus.design")).toBe(false);
    expect(registry.get("view.setWorkspace")?.requires).toBe("an open project");
  });
});
