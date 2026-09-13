/**
 * Coverage for src/files/files.ts — the Navigator's Files tree as a Jx document.
 *
 * Everything is addressed by ROLE and by `part`, because the tree is `surfaces/files-panel.json`:
 * there is no `.file-tree`, `.file-tree-item` or `.file-tree-name` to find any more, and the four
 * facts a row used to carry as classes — selected, dragging, under a drop, holding the tab stop —
 * are `data-` attributes bound against one scope field each.
 *
 * Three seams changed with the markup, and the cases below are what hold them to account:
 *
 * 1. **The panel seam.** The record's `render` returns `nothing` and its `afterRender` mounts the
 *    document into the box the Navigator painted, so every case here mounts through
 *    {@link mountFilesPanel} and repaints through the same `rerender` the Navigator hands it.
 * 2. **Drag and drop is an ISLAND adopted per node.** Registration follows `onNodeCreated` rather than
 *    a `requestAnimationFrame` pass that re-found the rows by class, so a node the document did not
 *    create is never registered and a row that leaves the window gives its registration back.
 * 3. **The menu is the kit's.** Rows are read out of `#layer-popover` and addressed by the id they
 *    run, never by their label — which is also what makes the declared `context/file` rows and the
 *    tree's own verbs distinguishable in the same list.
 */
import {
  answerPromptDialog,
  dragEvent,
  flush,
  installMockPlatform,
  key,
  pointer,
  promptFormatOptions,
  testFile,
  topDialog,
} from "./harness";
import type { MockPlatformState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { requireProjectState, setProjectState } from "../src/store";
import { closeAllTabs, openTab, workspace } from "../src/workspace/workspace";
import { initLayers } from "../src/ui/layers";
import { setFormats } from "../src/format/format-host";
import { registerFileFormatCommands } from "../src/format/convert-file";
import { problems, resetNotifications, toasts } from "../src/services/notify";
import { loadUsages, peekUsages } from "../src/services/references";
import { MARKDOWN_FORMAT, mockFormatAction, seedMarkdownFormat } from "./format-fixture";
import type { DirEntry, ReferencesResult, RenameResult, StudioPlatform } from "../src/types";

// ─── Mock the DnD adapter (registrations recorded, callbacks driveable) ───────

interface DndRegistry {
  draggables: any[];
  dropTargets: any[];
  monitors: any[];
  cleanups: string[];
}
const dnd: DndRegistry = { cleanups: [], draggables: [], dropTargets: [], monitors: [] };

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: (opts: unknown) => {
    dnd.draggables.push(opts);
    return () => dnd.cleanups.push("draggable");
  },
  dropTargetForElements: (opts: unknown) => {
    dnd.dropTargets.push(opts);
    return () => dnd.cleanups.push("dropTarget");
  },
  monitorForElements: (opts: unknown) => {
    dnd.monitors.push(opts);
    return () => dnd.cleanups.push("monitor");
  },
}));

const { loadDirectory, mountFilesPanel, setShowIgnoredFiles, unmountFilesPanel } =
  await import("../src/files/files");
const { resetIgnoreCache } = await import("../src/files/gitignore");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { gridCommands } = await import("../src/grid/grid-open");
const { registerContentCommands } = await import("../src/content/entry-commands");

// ─── Local helpers ────────────────────────────────────────────────────────────

function dirEntriesOf(files: Map<string, string>, dir: string): DirEntry[] {
  const prefix = dir === "." || dir === "" ? "" : dir.endsWith("/") ? dir : `${dir}/`;
  const seen = new Map<string, DirEntry>();
  for (const path of files.keys()) {
    if (prefix && !path.startsWith(prefix)) {
      continue;
    }
    const rest = path.slice(prefix.length);
    const [head] = rest.split("/");
    if (!head || seen.has(head)) {
      continue;
    }
    seen.set(head, {
      name: head,
      path: prefix + head,
      type: rest.includes("/") ? "directory" : "file",
    });
  }
  return [...seen.values()];
}

function installFsPlatform(
  seed: Record<string, string> = {},
  overrides: Partial<StudioPlatform> = {},
): { platform: StudioPlatform; state: MockPlatformState } {
  const handle = installMockPlatform(
    {
      formatAction: mockFormatAction,
      listFormats: async () => [MARKDOWN_FORMAT],
      ...overrides,
    } as Partial<StudioPlatform>,
    seed,
  );
  if (!overrides.listDirectory) {
    handle.platform.listDirectory = async (dir: string) => {
      handle.state.calls.push(["listDirectory", dir]);
      return dirEntriesOf(handle.state.files, dir);
    };
  }
  return handle;
}

function siteState(overrides: Record<string, unknown> = {}) {
  setProjectState({
    dirs: new Map<string, DirEntry[]>(),
    expanded: new Set<string>(),
    isSiteProject: true,
    name: "Demo",
    projectConfig: { name: "Demo" },
    projectDirs: [],
    projectRoot: ".",
    searchQuery: "",
    selectedPath: null,
    ...overrides,
  } as never);
}

/** Standard fixture: root with two dirs + assorted files, "pages" pre-expanded. */
function seedTreeState(): void {
  const st = requireProjectState();
  st.dirs.set(".", [
    { name: "zeta.json", path: "zeta.json", type: "file" },
    { name: "pages", path: "pages", type: "directory" },
    { name: "beta.md", path: "beta.md", type: "file" },
    { name: "assets", path: "assets", type: "directory" },
    { name: "gamma.png", path: "gamma.png", type: "file" },
    { name: "delta.css", path: "delta.css", type: "file" },
    { name: "epsilon.ts", path: "epsilon.ts", type: "file" },
    { name: "omega.js", path: "omega.js", type: "file" },
    { name: "license", path: "license", type: "file" },
  ]);
  st.dirs.set("pages", [{ name: "index.json", path: "pages/index.json", type: "file" }]);
  st.expanded.add("pages");
}

// ─── The panel seam ──────────────────────────────────────────────────────────

/** The content box `left-panel.ts` hands a panel's `afterRender`. */
let host: HTMLElement;
/** How many times the surface has asked the Navigator to repaint since the mount settled. */
let renders = 0;

/** The Navigator's repaint: draw the panel again, which re-projects into the mounted document. */
function repaint(): void {
  renders += 1;
  mountFilesPanel(host, repaint);
}

/**
 * Mount the Files document and let it settle.
 *
 * A mounted document needs more than one turn — the surface waits for the kit, then renders, then
 * its islands announce themselves — which is why `flush(3)` rather than the default two.
 */
async function mountTree(): Promise<HTMLElement> {
  mountFilesPanel(host, repaint);
  await flush(3);
  // The repaint counter means "since the tree was on screen": a background listing provoked by the
  // First projection is the mount finishing, not a surface asking for anything.
  renders = 0;
  return host;
}

function treeEl(): HTMLElement {
  return host.querySelector<HTMLElement>('[part="tree"]')!;
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[part="row"][role="treeitem"]')];
}

function names(): (string | null)[] {
  return [...host.querySelectorAll<HTMLElement>('[part="row"] [part="label"]')].map(
    (el) => el.textContent,
  );
}

/* `data-value` rather than `data-path`: `jx-tree-item` mirrors its own `value` there, and it is
   what the drag island addresses a row by, so a second `data-path` saying the same thing would be
   two answers to "which row is this". */
function rowFor(path: string, expected = true): HTMLElement {
  const row = host.querySelector<HTMLElement>(`[part="row"][data-value="${path}"]`);
  if (expected) {
    expect(row).not.toBeNull();
  }
  return row as HTMLElement;
}

function glyph(row: HTMLElement): string {
  const icon = row.querySelector('[part="row-icon"]') as (HTMLElement & { name: string }) | null;
  return icon?.name ?? "none";
}

function part(name: string): HTMLElement {
  return host.querySelector<HTMLElement>(`[part="${name}"]`)!;
}

/**
 * A kit element's own state, which the document sets as a PROPERTY rather than an attribute.
 *
 * `$props` writes the element's state directly — that is what makes a binding that resolves to the
 * value the control already holds a no-op — so a test that asked for the attribute would be asking
 * the wrong object, and would pass on a control the document never wrote to.
 */
function propOf<T>(name: string, field: string): T {
  return (part(name) as unknown as Record<string, T>)[field]!;
}

// ─── The kit menu ────────────────────────────────────────────────────────────

function menuElement(): (HTMLElement & { x: number; y: number }) | null {
  return document.querySelector("#layer-popover jx-menu");
}

/** The rows of whichever menu the tree has up, addressed by the id each runs. */
function menuIds(): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>("#layer-popover jx-menu-item[data-command-id]"),
  ].map((el) => el.dataset.commandId!);
}

function menuRow(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `#layer-popover jx-menu-item[data-command-id="${id}"]`,
  );
  if (!found) {
    throw new Error(`no menu row: ${id} (have: ${menuIds().join(", ")})`);
  }
  return found;
}

/** Right-click a row and let the menu mount. */
async function openMenuOn(path: string, at: MouseEventInit = {}): Promise<void> {
  pointer(rowFor(path), "contextmenu", at);
  await flush(3);
}

async function clickMenuRow(id: string): Promise<void> {
  menuRow(id).click();
  await flush();
}

function dialogWrapper(): HTMLElement | null {
  return topDialog();
}

function dialogField(): HTMLInputElement {
  return dialogWrapper()!.querySelector('jx-textfield [part="input"]') as HTMLInputElement;
}

beforeEach(() => {
  closeAllTabs();
  setProjectState(null);
  seedMarkdownFormat();
  renders = 0;
  dnd.draggables = [];
  dnd.dropTargets = [];
  dnd.monitors = [];
  dnd.cleanups = [];
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    let layer = document.querySelector(`#${id}`);
    if (!layer) {
      layer = document.createElement("div");
      layer.id = id;
      document.body.append(layer);
    }
    layer.innerHTML = "";
  }
  initLayers();
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  // Takes the document, the menu, the drag registrations and the row handles with it — all module
  // State that would otherwise reach the next case.
  unmountFilesPanel();
  await flush();
  host.remove();
  // The tree's context menu renders `forPlacement("context/file")`; a registry left published
  // Would leak declared rows into every later case.
  setActiveRegistry(null);
});

// ─── The three things the panel can be ────────────────────────────────────────

describe("the panel's three states", () => {
  test("a panel taken down before its mount lands leaves nothing behind", async () => {
    installFsPlatform();
    siteState();
    seedTreeState();
    // The Navigator can paint a second panel over this one inside the same turn — `mountSurface`
    // Is asynchronous, so the document would otherwise arrive in a box nobody is looking at and
    // Stay there, holding drag registrations against rows no reader can reach.
    mountFilesPanel(host, repaint);
    unmountFilesPanel();
    await flush(3);

    expect(host.querySelector('[role="tree"]')).toBeNull();
    expect(host.querySelector('[part="files"]')).toBeNull();
    expect(dnd.draggables).toHaveLength(0);
  });

  test("no project — the placeholder, and no tree at all", async () => {
    await mountTree();
    expect(host.textContent).toContain("No project loaded");
    expect(host.querySelector('[role="tree"]')).toBeNull();
  });

  test("a monorepo root offers the DECLARED project.open command", async () => {
    installFsPlatform();
    siteState({ isSiteProject: false, projectConfig: null });
    const ran: string[] = [];
    const registry = createCommandRegistry({
      getContext: () => ({ ...emptyContext(), project: { open: true } }) as never,
    });
    registry.register({
      category: "Project",
      id: "project.open",
      level: "project",
      menus: ["palette"],
      run: () => {
        ran.push("project.open");
      },
      title: "Open Project…",
    });
    setActiveRegistry(registry);
    await mountTree();

    expect(host.textContent).toContain("Open a project folder");
    part("open-project").click();
    await flush();
    // The button runs the command the ⌘O chord and the status bar already run — not an opener of
    // This surface's own (§12.5).
    expect(ran).toEqual(["project.open"]);
  });

  test("site header prefers projectConfig name, falls back to project name", async () => {
    installFsPlatform();
    siteState({ projectConfig: { name: "Config Name" } });
    seedTreeState();
    await mountTree();
    expect(part("project-name").textContent).toBe("Config Name");

    requireProjectState().projectConfig = null;
    repaint();
    await flush();
    expect(part("project-name").textContent).toBe("Demo");
  });

  test("an unlisted directory draws a placeholder that is NOT a treeitem, and asks for it", async () => {
    installFsPlatform({ "pages/index.json": "{}" });
    siteState();
    // A counting repaint rather than a redrawing one: the point is the row that stands in the
    // Document while the listing is in flight, which a real repaint would replace.
    mountFilesPanel(host, () => {
      renders += 1;
    });
    await flush(3);

    expect(host.textContent).toContain("Loading…");
    expect(host.querySelector('[part="loading-row"]')).not.toBeNull();
    expect(rows()).toHaveLength(0);
    expect(requireProjectState().dirs.get(".")).toBeDefined();
    expect(renders).toBeGreaterThan(0);
  });
});

// ─── The rows ─────────────────────────────────────────────────────────────────

describe("file tree listing", () => {
  test("sorts directories first, then files alphabetically; nested rows are flat", async () => {
    installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    expect(names()).toEqual([
      "assets",
      "pages",
      "index.json", // Expanded "pages" contributes its child immediately after its own row
      "beta.md",
      "delta.css",
      "epsilon.ts",
      "gamma.png",
      "license",
      "omega.js",
      "zeta.json",
    ]);
    // The tree is FLAT — one windowed row list, not a `role="group"` per level (R5). A child of an
    // Expanded directory says where it sits with aria-level/posinset/setsize instead, which is the
    // Only account that stays true when the tree draws a window rather than all of itself.
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(rowFor("pages/index.json").getAttribute("aria-level")).toBe("2");
    expect(rowFor("pages/index.json").getAttribute("aria-posinset")).toBe("1");
    expect(rowFor("pages/index.json").getAttribute("aria-setsize")).toBe("1");
    expect(rowFor("pages").getAttribute("aria-level")).toBe("1");
    expect(rowFor("pages").getAttribute("aria-posinset")).toBe("2");
    expect(rowFor("pages").getAttribute("aria-setsize")).toBe("9");
    expect(rowFor("pages").getAttribute("aria-expanded")).toBe("true");
    expect(rowFor("assets").getAttribute("aria-expanded")).toBe("false");
    // A FILE has nothing to expand, so it carries no `aria-expanded` at all — `"false"` there
    // Would announce a closed disclosure that does not exist.
    expect(rowFor("beta.md").hasAttribute("aria-expanded")).toBe(false);
  });

  test("a row's depth is one number, and the element draws the indent from it", async () => {
    installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    /* `level` and nothing else. It used to be said twice — `aria-level` for the reader and a
       `--depth` custom property for the stylesheet — and `jx-tree-item` derives both from this one
       prop, so the announced depth and the drawn indent can no longer disagree. */
    expect(rowFor("pages").getAttribute("level")).toBe("1");
    expect(rowFor("pages").getAttribute("aria-level")).toBe("1");
    expect(rowFor("pages").getAttribute("style")).not.toContain("--depth");
    expect(rowFor("pages/index.json").getAttribute("level")).toBe("2");
    expect(rowFor("pages/index.json").getAttribute("aria-level")).toBe("2");
  });

  test("file-type icons match extensions; folder icons track expansion", async () => {
    installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    expect(glyph(rowFor("zeta.json"))).toBe("file-code");
    expect(glyph(rowFor("epsilon.ts"))).toBe("file-code");
    expect(glyph(rowFor("omega.js"))).toBe("file-code");
    expect(glyph(rowFor("delta.css"))).toBe("file-code");
    expect(glyph(rowFor("beta.md"))).toBe("file-text");
    expect(glyph(rowFor("gamma.png"))).toBe("image");
    expect(glyph(rowFor("license"))).toBe("file");
    expect(glyph(rowFor("assets"))).toBe("folder");
    expect(glyph(rowFor("pages"))).toBe("folder-open");
    // The twisty is drawn for a directory and left empty for a file, which is what lines every
    // Name in the tree up whether or not its row can be opened.
    expect(rowFor("pages").querySelector('[part="twisty"] jx-icon')).not.toBeNull();
    expect(rowFor("beta.md").querySelector('[part="twisty"] jx-icon')).toBeNull();
  });

  test("the selected row says so, and only that row", async () => {
    installFsPlatform();
    siteState({ selectedPath: "beta.md" });
    seedTreeState();
    await mountTree();

    /* `aria-selected`, written by the element from the row's `selected` prop, and it is the ONLY
       writer of the selected drawing now — which is what stops the wash and the announcement
       disagreeing. A `data-selected` beside it was the class this replaced wearing an attribute's
       clothes. */
    expect(rowFor("beta.md").getAttribute("aria-selected")).toBe("true");
    expect(rowFor("zeta.json").hasAttribute("aria-selected")).toBe(false);
  });

  test("moving the selection redraws one attribute and keeps every row NODE", async () => {
    installFsPlatform();
    siteState({ selectedPath: "beta.md" });
    seedTreeState();
    await mountTree();
    const before = rows();

    requireProjectState().selectedPath = "zeta.json";
    repaint();
    await flush();

    // Keyed rows, and selection is one scope field the document compares against each row's path:
    // The nodes survive, so nothing the reader is on — a caret, a focus ring — is taken away.
    expect(rows()).toEqual(before);
    expect(rowFor("zeta.json").getAttribute("aria-selected")).toBe("true");
    expect(rowFor("beta.md").hasAttribute("aria-selected")).toBe(false);
  });

  test("search query filters files but keeps directories", async () => {
    installFsPlatform();
    siteState({ searchQuery: "beta" });
    seedTreeState();
    await mountTree();

    expect(names()).toContain("beta.md");
    expect(names()).toContain("assets");
    expect(names()).toContain("pages");
    expect(names()).not.toContain("zeta.json");
  });

  test("a language is a CHIP on the row, never a term the search matches", async () => {
    installFsPlatform();
    siteState({
      projectConfig: { i18n: { defaultLocale: "en", locales: ["en", "fr"] }, name: "Demo" },
    });
    const st = requireProjectState();
    st.dirs.set(".", [{ name: "pages", path: "pages", type: "directory" }]);
    st.dirs.set("pages", [
      { name: "fr", path: "pages/fr", type: "directory" },
      { name: "index.json", path: "pages/index.json", type: "file" },
    ]);
    st.dirs.set("pages/fr", [{ name: "about.json", path: "pages/fr/about.json", type: "file" }]);
    st.expanded.add("pages");
    st.expanded.add("pages/fr");
    await mountTree();

    // The chip is drawn — and the query that matches it exactly still matches no FILE, because the
    // Filter reads `entry.name` alone. A search that silently also matched a language would make
    // "why is this file here" unanswerable from what is on screen.
    expect(rowFor("pages/fr/about.json").querySelector('[part="locale"]')?.textContent).toBe(
      "français",
    );
    expect(rowFor("pages/index.json").querySelector('[part="locale"]')).toBeNull();

    requireProjectState().searchQuery = "français";
    repaint();
    await flush();
    expect(rowFor("pages/fr/about.json", false)).toBeNull();
  });

  test("typing in the filter updates the query and repaints — with nothing to submit", async () => {
    installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    const input = part("search").querySelector("input")!;
    input.value = "gamma";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(requireProjectState().searchQuery).toBe("gamma");
    expect(renders).toBe(1);
    /* The filter used to be an `sp-search`, which renders a `<form>` and needed a `@submit` guard
       so Enter did not navigate away from the studio. `jx-textfield` is a bare `<input>` with no
       form around it, so the navigation this guarded against cannot happen — asserted here rather
       than dropped, because "Enter does not leave the app" is the contract, not the handler. */
    expect(input.form).toBeNull();
    expect(part("search").closest("form")).toBeNull();
  });

  test("clicking a file opens it; clicking a directory toggles expansion", async () => {
    installFsPlatform({ "assets/logo.png": "binary", "beta.md": "# b" });
    siteState();
    seedTreeState();
    await mountTree();

    pointer(rowFor("beta.md"), "click");
    await flush(3);
    expect(requireProjectState().selectedPath).toBe("beta.md");

    pointer(rowFor("assets"), "click");
    await flush(3);
    expect(requireProjectState().expanded.has("assets")).toBe(true);
    expect(
      requireProjectState()
        .dirs.get("assets")
        ?.map((e) => e.path),
    ).toEqual(["assets/logo.png"]);
    expect(renders).toBeGreaterThan(0);

    pointer(rowFor("assets"), "click");
    await flush(3);
    expect(requireProjectState().expanded.has("assets")).toBe(false);
  });

  test("refresh button reloads root and expanded directories", async () => {
    const { state } = installFsPlatform({
      "pages/index.json": "{}",
      "project.json": "{}",
    });
    siteState();
    seedTreeState();
    requireProjectState().dirs.set("stale", []);
    await mountTree();

    part("refresh").click();
    await flush(3);

    const st = requireProjectState();
    expect(st.dirs.has("stale")).toBe(false);
    expect(st.dirs.has(".")).toBe(true);
    expect(st.dirs.has("pages")).toBe(true);
    expect(state.calls).toContainEqual(["listDirectory", "pages"]);
    expect(renders).toBe(1);
  });
});

// ─── New file ─────────────────────────────────────────────────────────────────

describe("createNewFile (toolbar + context menu)", () => {
  /** Open the New File dialog from the toolbar and answer it (null cancels). */
  async function clickNewFile(answer: string | null, pick?: string) {
    part("new-file").click();
    await flush();
    await answerPromptDialog(answer, pick);
  }

  test("opens the prompt dialog rather than a native prompt", async () => {
    installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    part("new-file").click();
    await flush();

    const wrapper = dialogWrapper();
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute("headline")).toBe("New File");
    expect(wrapper!.getAttribute("confirm-label")).toBe("Create");
    // A NAME, not a file name: the picker beside it owns the extension.
    expect(dialogField().value).toBe("untitled");
    expect(promptFormatOptions()).toEqual([
      [".json", "JSON (.json)"],
      [".md", "Markdown (.md)"],
      ["__other__", "Other…"],
    ]);

    await answerPromptDialog(null);
  });

  test("cancelled dialog writes nothing", async () => {
    const { state } = installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    await clickNewFile(null);

    expect(state.calls.filter(([name]) => name === "writeFile")).toHaveLength(0);
    await flush();
    expect(dialogWrapper()).toBeNull();
  });

  test("a blank name keeps the dialog open and writes nothing", async () => {
    const { state } = installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    await clickNewFile("   ");

    expect(state.calls.filter(([name]) => name === "writeFile")).toHaveLength(0);
    await flush();
    expect(dialogWrapper()).not.toBeNull();
    expect(dialogWrapper()!.querySelector('jx-textfield [part="error"]')?.textContent).toContain(
      "Enter a file name.",
    );

    await answerPromptDialog(null);
  });

  test("unknown extension gets the default JSON scaffold", async () => {
    setFormats([]);
    const { state } = installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    await clickNewFile("untitled", ".json");

    expect(JSON.parse(state.files.get("untitled.json")!)).toEqual({
      children: [{ children: [], tagName: "p" }],
      tagName: "div",
    });
    expect(renders).toBe(1);
  });

  test("format extension uses the format's newFileTemplate", async () => {
    const { state } = installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    await clickNewFile("note", ".md");

    expect(state.files.get("note.md")).toBe("---\ntitle: Untitled\n---\n\n");
  });

  test("the entered name is trimmed before it becomes a path", async () => {
    const { state } = installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    await clickNewFile("  spaced  ", ".md");

    expect(state.files.has("spaced.md")).toBe(true);
  });

  test("format without a template creates an empty file", async () => {
    setFormats([{ ...MARKDOWN_FORMAT, studio: null }]);
    const { state } = installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    await clickNewFile("bare", ".md");

    expect(state.files.get("bare.md")).toBe("");
  });

  test("write failure is reported, not thrown", async () => {
    const { state } = installFsPlatform(
      {},
      {
        writeFile: async () => {
          throw new Error("quota exceeded");
        },
      },
    );
    siteState();
    seedTreeState();
    await mountTree();

    await clickNewFile("fail", ".json");

    expect(state.files.has("fail.json")).toBe(false);
    expect(renders).toBe(0);
  });

  test("context-menu New File scopes the path to the directory", async () => {
    const { state } = installFsPlatform();
    siteState();
    seedTreeState();
    await mountTree();

    await openMenuOn("pages");
    await clickMenuRow("files.newFile");
    await flush();

    expect(dialogWrapper()?.textContent).toContain("Creating in pages/");
    await answerPromptDialog("inner", ".md");

    expect(state.files.get("pages/inner.md")).toBe("---\ntitle: Untitled\n---\n\n");
  });
});

/**
 * What `New File…` becomes, per destination.
 *
 * The four answers are feature 3: a collection's own source root routes to the seeded New Entry
 * flow, a subdirectory or a schema-less collection is CONSTRAINED but not rerouted, an unresolvable
 * format is reported and left unconstrained, and everywhere else offers the full picker. Each is a
 * different wrong answer if it fires in the wrong place, and none of them is visible in the menu —
 * the row is `files.newFile` in every case, which is asserted below.
 */
describe("New File asks the destination what it is", () => {
  /** Mount a tree over a project whose `content` section is `content`. */
  async function treeFor(content: Record<string, unknown>, seed: Record<string, string> = {}) {
    const handle = installFsPlatform(seed);
    siteState({ projectConfig: { content, name: "Demo" } });
    seedTreeState();
    const state = requireProjectState();
    for (const dir of ["posts", "posts/2026", "notes", "loose"]) {
      state.dirs.set(dir, []);
      state.expanded.add(dir);
    }
    state.dirs
      .get(".")!
      .push(
        { name: "posts", path: "posts", type: "directory" },
        { name: "notes", path: "notes", type: "directory" },
        { name: "loose", path: "loose", type: "directory" },
      );
    state.dirs.get("posts")!.push({ name: "2026", path: "posts/2026", type: "directory" });
    await mountTree();
    return { handle };
  }

  /** Right-click a directory and take New File…, returning what the dialog shows. */
  async function newFileIn(path: string) {
    await openMenuOn(path);
    const ids = menuIds();
    await clickMenuRow("files.newFile");
    await flush();
    await flush();
    const dialog = dialogWrapper();
    return {
      headline: dialog?.getAttribute("headline") ?? null,
      ids,
      message: dialog?.querySelector("p")?.textContent?.trim() ?? "",
      rows: promptFormatOptions(),
    };
  }

  const MARKDOWN_POSTS = {
    posts: { format: "Markdown", schema: { properties: {} }, source: "./posts/" },
  };

  test("a collection's source root routes to the SEEDED New Entry flow", async () => {
    await treeFor(MARKDOWN_POSTS);
    const shown = await newFileIn("posts");
    expect(shown.headline).toBe("New posts entry");
    // No picker: the collection's extension is not a choice, it is the collection's.
    expect(shown.rows).toEqual([]);
    // …and the row that opened it is still the tree's own generic one.
    expect(shown.ids).toContain("files.newFile");
    await answerPromptDialog(null);
  });

  test("a SUBDIRECTORY is constrained, not rerouted", async () => {
    await treeFor(MARKDOWN_POSTS);
    const shown = await newFileIn("posts/2026");
    // Rerouting would silently relocate the file: New Entry writes to one directory, and
    // Co-located media lives here too (site-architecture.md §6.5).
    expect(shown.headline).toBe("New File");
    expect(shown.message).toContain("Creating in posts/2026/");
    expect(shown.rows).toEqual([
      [".md", "Markdown (.md)"],
      ["__other__", "Other…"],
    ]);
    await answerPromptDialog(null);
  });

  test("a collection with NO schema is constrained, not rerouted either", async () => {
    // There is no shape to seed and no form to draw, so the entry flow would produce an empty file
    // And an editor with nothing in it.
    await treeFor({ posts: { format: "Markdown", source: "./posts/" } });
    const shown = await newFileIn("posts");
    expect(shown.headline).toBe("New File");
    expect(shown.rows.map(([value]) => value)).toEqual([".md", "__other__"]);
    await answerPromptDialog(null);
  });

  test("an unresolvable format is REPORTED, and leaves the picker unconstrained", async () => {
    // Locking to a guessed extension would be a stated lie plus an enforced refusal, which is
    // Worse than not constraining at all.
    await treeFor({ notes: { format: "Toml", schema: {}, source: "./notes/" } });
    const shown = await newFileIn("notes");
    expect(shown.headline).toBe("New File");
    expect(shown.rows.map(([value]) => value)).toEqual([".json", ".md", "__other__"]);
    const problem = problems.at(-1)!;
    expect(problem.message).toContain("cannot be constrained");
    expect(problem.detail).toContain("Toml");
    expect(problem.path).toBe("notes");
    await answerPromptDialog(null);
  });

  test("a directory belonging to no collection gets the full picker", async () => {
    await treeFor(MARKDOWN_POSTS);
    const shown = await newFileIn("loose");
    expect(shown.headline).toBe("New File");
    expect(shown.rows.map(([value]) => value)).toEqual([".json", ".md", "__other__"]);
    await answerPromptDialog(null);
  });
});

// ─── Context menu ─────────────────────────────────────────────────────────────

describe("file context menu", () => {
  async function seededTree(seed: Record<string, string> = {}) {
    const handle = installFsPlatform(seed);
    siteState();
    seedTreeState();
    await mountTree();
    return { handle };
  }

  test("file rows offer Open / Rename / Delete, with a divider before the destructive pair", async () => {
    await seededTree({ "beta.md": "# b" });

    await openMenuOn("beta.md");

    expect(menuIds()).toEqual(["files.open", "files.rename", "files.delete"]);
    // The `"—"` sentinel row is gone: the boundary is `dividerAbove` on Rename, which the kit
    // Draws as an `<hr>` inside the menu it owns.
    expect(document.querySelector("#layer-popover jx-menu hr")).not.toBeNull();

    await clickMenuRow("files.open");
    await flush(3);
    expect([...workspace.tabs.values()].some((t) => t.documentPath === "beta.md")).toBe(true);
  });

  test("directory rows offer New File and Upload Files instead of Open", async () => {
    await seededTree();

    await openMenuOn("assets");

    expect(menuIds()).toEqual(["files.newFile", "files.upload", "files.rename", "files.delete"]);
  });

  test("the menu opens at the pointer; where it is CLAMPED is the kit's question", async () => {
    await seededTree();

    await openMenuOn("beta.md", { clientX: 120, clientY: 240 });

    /* The hand-written clamp went with the `sp-popover`: a `ref` that measured the panel a frame
       after it opened and pushed it back inside the viewport. The kit does that for every menu, so
       what this surface still owns — and all it owns — is the origin it names. */
    const menu = menuElement()!;
    expect(menu.x).toBe(120);
    expect(menu.y).toBe(240);
  });

  /**
   * The tree with a project that declares a `posts` collection, and the app registry published.
   *
   * The registry is the point of these cases. `context/file` is a DECLARED placement, and until now
   * the tree drew a hand-built list beside it — so `content.openEntry` shipped with a menu entry no
   * surface rendered, and "Edit Collection in Grid" existed twice: once as `collection.editInGrid`
   * and once as a literal string here. Every row below comes out of `forPlacement`.
   */
  async function treeWithRegistry() {
    const handle = installFsPlatform({
      "pages/home.json": '{"tagName":"div"}',
      "posts/first.md": "---\ntitle: First\n---\n",
      "styles/site.css": "body{}",
    });
    siteState({
      projectConfig: {
        content: {
          posts: {
            format: "Markdown",
            schema: { properties: { title: { type: "string" } } },
            source: "./posts/",
          },
        },
        name: "Demo",
      },
    });
    seedTreeState();
    requireProjectState()
      .dirs.get(".")!
      .push(
        { name: "posts", path: "posts", type: "directory" },
        { name: "styles", path: "styles", type: "directory" },
      );
    requireProjectState().dirs.set("posts", [
      { name: "first.md", path: "posts/first.md", type: "file" },
    ]);
    requireProjectState().dirs.set("styles", [
      { name: "site.css", path: "styles/site.css", type: "file" },
    ]);
    requireProjectState().dirs.set("pages", [
      { name: "home.json", path: "pages/home.json", type: "file" },
    ]);
    requireProjectState().expanded.add("pages");
    requireProjectState().expanded.add("posts");
    requireProjectState().expanded.add("styles");

    const registry = createCommandRegistry({
      getContext: () => ({ ...emptyContext(), project: { open: true } }) as never,
    });
    registry.registerAll(gridCommands());
    registerContentCommands(registry);
    registerFileFormatCommands(registry);
    setActiveRegistry(registry);

    await mountTree();
    return { handle, registry };
  }

  test("a collection directory offers the DECLARED collection.editInGrid row", async () => {
    await treeWithRegistry();

    await openMenuOn("posts");
    expect(menuIds()).toContain("collection.editInGrid");
    await clickMenuRow("collection.editInGrid");
    await flush();
    expect(workspace.tabs.has("grid://collection/posts")).toBeTrue();
  });

  /**
   * `source` and `path` are DIFFERENT facts, and the row states each only where it is true.
   *
   * Both name a file, so it would be easy to answer them with one key — and then "Open Entry Form"
   * would appear on every convertible page, and "Convert Format…" on every collection entry. The
   * two lists below are the same three rows asked two ways, and they disagree on purpose.
   */
  test("a convertible page offers file.convertFormat; an entry and a stylesheet do not", async () => {
    setFormats([MARKDOWN_FORMAT]);
    await treeWithRegistry();

    await openMenuOn("pages/home.json");
    expect(menuIds()).toContain("file.convertFormat");
    expect(menuIds()).not.toContain("content.openEntry");

    // An entry is its collection's, in either direction: converting it would drop it out of the
    // Collection's discovery glob.
    await openMenuOn("posts/first.md");
    expect(menuIds()).toContain("content.openEntry");
    expect(menuIds()).not.toContain("file.convertFormat");

    await openMenuOn("styles/site.css");
    expect(menuIds()).not.toContain("file.convertFormat");
  });

  test("a content entry offers Open Entry Form; a file in no collection does not", async () => {
    await treeWithRegistry();

    await openMenuOn("posts/first.md");
    expect(menuIds()).toContain("content.openEntry");

    // `styles/site.css` states no `path` fact, because it is an entry of no collection — so the
    // Command that requires one is not offered rather than being offered and refusing.
    await openMenuOn("styles/site.css");
    expect(menuIds()).not.toContain("content.openEntry");
  });

  test("Open Entry Form opens the tab in entry mode — the route the palette could not offer", async () => {
    await treeWithRegistry();

    await openMenuOn("posts/first.md");
    await clickMenuRow("content.openEntry");
    await flush();
    await flush();

    const tab = [...workspace.tabs.values()].find((t) => t.documentPath === "posts/first.md")!;
    expect(tab).toBeDefined();
    expect(tab.session.ui.canvasMode).toBe("entry");
  });

  test("the declared rows come from the registry — with none published, they are absent", async () => {
    await treeWithRegistry();
    setActiveRegistry(null);

    await openMenuOn("posts");
    expect(menuIds()).not.toContain("collection.editInGrid");
    // The tree's own verbs are unaffected: they are what the TREE does, not what a command does.
    expect(menuIds()).toEqual(["files.newFile", "files.upload", "files.rename", "files.delete"]);
  });

  test("the pages directory keeps its hand-built grid row — no command declares one", async () => {
    await treeWithRegistry();

    await openMenuOn("pages");
    expect(menuIds()).toContain("files.pagesGrid");
    await clickMenuRow("files.pagesGrid");
    await flush();
    expect(workspace.tabs.has("grid://pages")).toBeTrue();
  });

  test("a declared row whose command is disabled is shown, greyed, with its reason", async () => {
    await treeWithRegistry();
    const registry = createCommandRegistry({
      getContext: () => ({ ...emptyContext(), project: { open: true } }) as never,
    });
    registry.register({
      args: {
        additionalProperties: false,
        properties: { path: { type: "string" } },
        required: ["path"],
        type: "object",
      },
      category: "File",
      enablement: () => false,
      id: "content.demoDisabled",
      level: "project",
      menus: ["context/file"],
      requires: "a reason the author can act on",
      run: () => {},
      title: "Demo Disabled",
      when: () => true,
    });
    setActiveRegistry(registry);

    await openMenuOn("posts/first.md");
    const item = menuRow("content.demoDisabled");
    expect(item.textContent).toContain("Demo Disabled");
    expect((item as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    expect(item.textContent).toContain("a reason the author can act on");

    // Clicking it does nothing AND does not close the menu — a row that explains itself has to
    // Stay on screen long enough to be read.
    item.click();
    await flush();
    expect(menuElement()).not.toBeNull();
  });

  test("opening a second menu dismisses the first", async () => {
    await seededTree();

    await openMenuOn("beta.md");
    await openMenuOn("zeta.json");

    expect(document.querySelectorAll("#layer-popover jx-menu")).toHaveLength(1);
  });
});

// ─── Rename dialog ────────────────────────────────────────────────────────────

describe("rename flow", () => {
  async function openRenameDialog(path: string) {
    await openMenuOn(path);
    await clickMenuRow("files.rename");
    await flush();
    const wrapper = dialogWrapper();
    expect(wrapper).not.toBeNull();
    return { field: dialogField(), wrapper: wrapper! };
  }

  async function seededTree(seed: Record<string, string>) {
    const handle = installFsPlatform(seed);
    siteState();
    seedTreeState();
    await mountTree();
    return { handle };
  }

  test("renames a nested file, updating selection and the open tab", async () => {
    const { handle } = await seededTree({ "pages/index.json": "{}" });
    requireProjectState().selectedPath = "pages/index.json";
    openTab({
      document: { tagName: "div" },
      documentPath: "pages/index.json",
      id: "pages/index.json",
    });

    const { field, wrapper } = await openRenameDialog("pages/index.json");
    field.value = "home.json";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    wrapper.dispatchEvent(new Event("confirm"));
    await flush();

    expect(handle.state.files.has("pages/home.json")).toBe(true);
    expect(handle.state.files.has("pages/index.json")).toBe(false);
    expect(requireProjectState().selectedPath).toBe("pages/home.json");
    expect(workspace.tabs.has("pages/home.json")).toBe(true);
    expect(workspace.tabs.get("pages/home.json")?.documentPath).toBe("pages/home.json");
    expect(renders).toBe(1);
  });

  test("renames a root-level file via the Enter key", async () => {
    const { handle } = await seededTree({ "beta.md": "# b" });

    const { field } = await openRenameDialog("beta.md");
    field.value = "renamed.md";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    key(field, "Enter");
    await flush();

    expect(handle.state.files.has("renamed.md")).toBe(true);
    expect(handle.state.files.has("beta.md")).toBe(false);
  });

  test("cancel leaves everything untouched", async () => {
    const { handle } = await seededTree({ "beta.md": "# b" });

    const { wrapper } = await openRenameDialog("beta.md");
    wrapper.dispatchEvent(new Event("cancel"));
    await flush();

    expect(handle.state.calls.filter(([name]) => name === "renameFile")).toHaveLength(0);
    expect(handle.state.files.has("beta.md")).toBe(true);
  });

  test("unchanged name is a no-op", async () => {
    const { handle } = await seededTree({ "beta.md": "# b" });

    const { wrapper } = await openRenameDialog("beta.md");
    wrapper.dispatchEvent(new Event("confirm"));
    await flush();

    expect(handle.state.calls.filter(([name]) => name === "renameFile")).toHaveLength(0);
  });

  test("blank name keeps the dialog open until cancelled", async () => {
    const { handle } = await seededTree({ "beta.md": "# b" });

    const { field, wrapper } = await openRenameDialog("beta.md");
    field.value = "   ";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    wrapper.dispatchEvent(new Event("confirm"));
    await flush();

    expect(dialogWrapper()).not.toBeNull();
    wrapper.dispatchEvent(new Event("close"));
    await flush();

    expect(dialogWrapper()).toBeNull();
    expect(handle.state.calls.filter(([name]) => name === "renameFile")).toHaveLength(0);
  });

  test("platform rename failure surfaces gracefully", async () => {
    const handle = installFsPlatform(
      { "beta.md": "# b" },
      {
        renameFile: async () => {
          throw new Error("locked");
        },
      },
    );
    siteState();
    seedTreeState();
    await mountTree();

    const { field, wrapper } = await openRenameDialog("beta.md");
    field.value = "other.md";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    wrapper.dispatchEvent(new Event("confirm"));
    await flush();

    expect(handle.state.files.has("beta.md")).toBe(true);
  });
});

// ─── Delete dialog ────────────────────────────────────────────────────────────

describe("delete flow", () => {
  async function seededTree(seed: Record<string, string>, overrides = {}) {
    const handle = installFsPlatform(seed, overrides);
    siteState();
    seedTreeState();
    await mountTree();
    return { handle };
  }

  async function openDeleteDialog(path: string) {
    await openMenuOn(path);
    await clickMenuRow("files.delete");
    await flush();
    const wrapper = dialogWrapper();
    expect(wrapper).not.toBeNull();
    return wrapper!;
  }

  test("confirm deletes the file and clears matching selection", async () => {
    const { handle } = await seededTree({ "beta.md": "# b" });
    requireProjectState().selectedPath = "beta.md";

    const wrapper = await openDeleteDialog("beta.md");
    /* The name is a SENTENCE now rather than emphasised markup: the dialog is a document, and a
       `TemplateResult` reaches it only through the island seam. The consequence line joins the
       question in the same paragraph — see tests/destructive-confirmations.test.ts for it. */
    expect(wrapper.textContent).toContain("Delete beta.md?");
    wrapper.dispatchEvent(new Event("confirm"));
    await flush();

    expect(handle.state.files.has("beta.md")).toBe(false);
    expect(requireProjectState().selectedPath).toBeNull();
    expect(renders).toBe(1);
  });

  test("cancel deletes nothing", async () => {
    const { handle } = await seededTree({ "beta.md": "# b" });

    const wrapper = await openDeleteDialog("beta.md");
    wrapper.dispatchEvent(new Event("cancel"));
    await flush();

    expect(handle.state.files.has("beta.md")).toBe(true);
    expect(handle.state.calls.filter(([name]) => name === "deleteFile")).toHaveLength(0);
  });

  test("nested file delete reloads the parent directory and keeps other selection", async () => {
    const { handle } = await seededTree({ "pages/index.json": "{}" });
    requireProjectState().selectedPath = "other.json";

    const wrapper = await openDeleteDialog("pages/index.json");
    wrapper.dispatchEvent(new Event("confirm"));
    await flush();

    expect(handle.state.files.has("pages/index.json")).toBe(false);
    expect(requireProjectState().selectedPath).toBe("other.json");
    expect(handle.state.calls).toContainEqual(["listDirectory", "pages"]);
  });

  test("platform delete failure surfaces gracefully", async () => {
    await seededTree(
      { "beta.md": "# b" },
      {
        deleteFile: async () => {
          throw new Error("in use");
        },
      },
    );

    const wrapper = await openDeleteDialog("beta.md");
    wrapper.dispatchEvent(new Event("confirm"));
    await flush();
    // No crash; dialog resolved
    await flush();
    expect(dialogWrapper()).toBeNull();
  });
});

// ─── Keyboard navigation ──────────────────────────────────────────────────────

describe("the tree's keyboard", () => {
  /**
   * The keyboard is driven against the REAL rendered tree, not a hand-built one.
   *
   * `jx-tree` owns the whole contract now, and it owns it from ONE listener on the tree — where
   * every key used to be a `$switch` case under every row, and the same eight cases were written
   * out again in `panel-outline.json` with nothing keeping the two in agreement. ↑/↓ step the drawn
   * rows and hand the model steps back to `files.ts` as `move`, which is why the fixture has to go
   * through the real projection.
   */
  async function keyboardTree(seed: Record<string, string> = {}) {
    const handle = installFsPlatform(seed);
    siteState();
    const st = requireProjectState();
    st.dirs.set(".", [
      { name: "pages", path: "pages", type: "directory" },
      { name: "a.json", path: "a.json", type: "file" },
      { name: "b.json", path: "b.json", type: "file" },
    ]);
    st.dirs.set("pages", [{ name: "index.json", path: "pages/index.json", type: "file" }]);
    await mountTree();
    return { handle, items: rows() };
  }

  test("the first row is the tab stop, and the selected row takes it over", async () => {
    const { items } = await keyboardTree();
    expect(items[0]!.getAttribute("tabindex")).toBe("0");
    expect(items[1]!.getAttribute("tabindex")).toBe("-1");

    requireProjectState().selectedPath = "b.json";
    repaint();
    await flush();
    expect(rowFor("b.json").getAttribute("tabindex")).toBe("0");
    expect(rowFor("pages").getAttribute("tabindex")).toBe("-1");
  });

  test("ArrowDown / ArrowUp move focus and clamp at the edges", async () => {
    const { items } = await keyboardTree();
    items[0]!.focus();

    key(items[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]!);
    key(items[1]!, "ArrowDown");
    key(items[2]!, "ArrowDown"); // Already at the last item
    expect(document.activeElement).toBe(items[2]!);

    key(items[2]!, "ArrowUp");
    key(items[1]!, "ArrowUp");
    key(items[0]!, "ArrowUp"); // Already at the first item
    expect(document.activeElement).toBe(items[0]!);
  });

  test("Enter does what a click does; unhandled keys are not prevented", async () => {
    const { items } = await keyboardTree();
    items[0]!.focus();

    // The directory row: Enter expands it, exactly as a click would — one verb, one flow.
    key(items[0]!, "Enter");
    await flush(3);
    expect(requireProjectState().expanded.has("pages")).toBe(true);

    const passthrough = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "x",
    });
    const notPrevented = items[1]!.dispatchEvent(passthrough);
    expect(notPrevented).toBe(true);

    const handled = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowUp",
    });
    items[1]!.dispatchEvent(handled);
    expect(handled.defaultPrevented).toBe(true);
  });

  test("the TREE owns the keyboard, and a key that reaches it lands on a row", async () => {
    const { items } = await keyboardTree();
    // Nothing focused, and the key arrives at the tree itself, which is what a click on the tree's
    // Own background followed by ↓ is. It lands on the first drawn row rather than doing nothing,
    // So the first key press always goes somewhere.
    key(treeEl(), "ArrowDown");
    expect(document.activeElement).toBe(items[0]!);
  });

  test("walking the rows moves the selection and opens nothing", async () => {
    const { items } = await keyboardTree();
    items[1]!.focus();

    // Onto the DIRECTORY row, which is the one whose activation is observable from here.
    key(items[1]!, "ArrowUp");
    await flush(3);

    /* A click on a row OPENS it and an arrow key must not, and both reach this tree as the same
       `select` intent — so a tree that answered `select` by opening would unfold every directory
       and open every file the reader arrowed past. The row is selected and it is still closed. */
    expect(document.activeElement).toBe(rowFor("pages"));
    expect(rowFor("pages").getAttribute("aria-selected")).toBe("true");
    expect(requireProjectState().expanded.has("pages")).toBe(false);
    expect(rowFor("pages").getAttribute("aria-expanded")).toBe("false");
  });

  test("clicking a folder moves the caret onto it, as well as opening it", async () => {
    const { items } = await keyboardTree();

    items[0]!.click();
    await flush(3);

    /* Two things, and the row's own handler is only one of them: it opens the folder, and the
       TREE's delegated click moves the caret and the selection onto the row. A `stopPropagation`
       in the row's handler takes the second away, and a reader who clicked a folder is then left
       with the tab stop on whatever they last had open. */
    expect(requireProjectState().expanded.has("pages")).toBe(true);
    expect(rowFor("pages").getAttribute("aria-selected")).toBe("true");
    expect(rowFor("pages").getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(rowFor("pages"));
  });

  test("Ctrl+↓ moves the caret alone, and the next repaint keeps it there", async () => {
    const { items } = await keyboardTree();
    items[0]!.focus();
    key(items[0]!, "ArrowDown");
    await flush(2);
    expect(requireProjectState().selectedPath).toBe("a.json");

    const held = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "ArrowDown",
    });
    rowFor("a.json").dispatchEvent(held);
    await flush(2);

    /* The one gesture that moves the caret WITHOUT the selection, and the reason the flow keeps no
       caret of its own: `jx-tree` owns it and holds it across a repaint that does not change
       `current`, so the reader stays where they stepped to. The tab stop this replaced was
       recomputed from `selectedPath` on every paint and would have pulled them back. */
    expect(document.activeElement).toBe(rowFor("b.json"));
    expect(requireProjectState().selectedPath).toBe("a.json");
    repaint();
    await flush();
    expect(rowFor("b.json").getAttribute("tabindex")).toBe("0");
    expect(rowFor("a.json").getAttribute("tabindex")).toBe("-1");
  });

  test("a click on a file's empty twisty expands nothing", async () => {
    const { items } = await keyboardTree();
    const twisty = rowFor("a.json").querySelector('[part="twisty"]') as HTMLElement;
    expect(twisty.children).toHaveLength(0);

    twisty.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush(3);

    /* A leaf's twisty box is drawn empty and still answers a click, and the element reads a leaf's
       expansion as "open me" — so a FILE arrives at the flow asking to be expanded and has to be
       told nothing happens. The click also stops at the twisty, so it does not open the file
       either. */
    expect(requireProjectState().expanded.size).toBe(0);
    expect(workspace.tabs.size).toBe(0);
    expect(items).toHaveLength(3);
  });

  test("Home and End reach the ends of the tree", async () => {
    const { items } = await keyboardTree();
    items[1]!.focus();

    key(items[1]!, "End");
    await flush();
    expect(document.activeElement).toBe(rowFor("b.json"));

    key(rowFor("b.json"), "Home");
    await flush();
    expect(document.activeElement).toBe(rowFor("pages"));
  });

  test("typing a letter jumps to the next row whose name starts with it", async () => {
    const { items } = await keyboardTree();
    items[0]!.focus();

    key(items[0]!, "b");
    await flush();

    // Neither tree had typeahead before the element did; a 300-file directory was ↓ three hundred
    // Times.
    expect(document.activeElement).toBe(rowFor("b.json"));
  });

  /* One step per keystroke, however many times the panel repaints. The predecessor's `afterRender`
     called a bare `addEventListener` on a re-used element, so three repaints walked three rows for
     one Down; the binding lives in the document now and the keyed rows keep their nodes, so there
     is nothing to stack. */
  test("one step per keystroke, however many times the panel repaints", async () => {
    await keyboardTree();
    for (let i = 0; i < 3; i++) {
      repaint();
      await flush();
    }
    const items = rows();
    items[0]!.focus();
    key(items[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]!);
  });

  test("ArrowRight expands a collapsed directory and repaints the panel", async () => {
    const { handle } = await keyboardTree({ "pages/index.json": "{}" });
    requireProjectState().dirs.delete("pages");
    const before = renders;

    key(rowFor("pages"), "ArrowRight");
    await flush(3);

    expect(requireProjectState().expanded.has("pages")).toBe(true);
    expect(handle.state.calls).toContainEqual(["listDirectory", "pages"]);
    // The repaint used to be a synthesised click on the focused row, which ran that row's own
    // Toggle a second time; the panel is asked directly now.
    expect(renders).toBeGreaterThan(before);
  });

  test("ArrowRight on an expanded directory does not reload", async () => {
    const { handle } = await keyboardTree({ "pages/index.json": "{}" });
    requireProjectState().expanded.add("pages");
    repaint();
    await flush(3);
    handle.state.calls.length = 0;

    key(rowFor("pages"), "ArrowRight");
    await flush(3);

    expect(handle.state.calls.filter(([name]) => name === "listDirectory")).toHaveLength(0);
  });

  test("ArrowLeft collapses an expanded directory, repaints, and ignores files", async () => {
    await keyboardTree();
    requireProjectState().expanded.add("pages");
    repaint();
    await flush(3);
    const before = renders;

    key(rowFor("pages"), "ArrowLeft");
    expect(requireProjectState().expanded.has("pages")).toBe(false);
    // It used to change the state and leave the children on screen — the collapse was invisible
    // Until something else happened to redraw the panel.
    expect(renders).toBeGreaterThan(before);

    await flush(3);
    key(rowFor("a.json"), "ArrowLeft"); // File row — nothing to collapse
    expect(requireProjectState().expanded.has("pages")).toBe(false);
  });
});

// ─── Drag and drop ────────────────────────────────────────────────────────────

describe("the drag island", () => {
  async function seededTree(seed: Record<string, string> = {}) {
    const handle = installFsPlatform(seed);
    siteState();
    seedTreeState();
    await mountTree();
    return { handle };
  }

  /** The in-app drop target registered against one row — by ELEMENT, since its data now varies. */
  function rowTarget(path: string) {
    const el = rowFor(path);
    const target = dnd.dropTargets.find((t) => t.element === el);
    expect(target).toBeDefined();
    return target;
  }

  /** The tree background's target — the project root. */
  function rootTarget() {
    const target = dnd.dropTargets.find((t) => t.element === treeEl());
    expect(target).toBeDefined();
    return target;
  }

  /** A pragmatic-dnd feedback payload for a tree drag of `path`. */
  function from(path: string, type = "file-tree") {
    return { source: { data: { path, type } } };
  }

  test("adopts every drawn row, the two directories and the root, and one monitor", async () => {
    const { handle } = await seededTree();

    // 10 visible rows (2 dirs, 7 root files, 1 nested file)
    expect(dnd.draggables).toHaveLength(10);
    // Every row plus the tree: a file row that registered NOTHING was a row whose drop fell
    // Through to the tree, which is the project root.
    expect(dnd.dropTargets).toHaveLength(11);
    expect(dnd.monitors).toHaveLength(1);
    expect(handle.state.calls.filter(([name]) => name === "renameFile")).toHaveLength(0);
  });

  test("a node the document did not create is never adopted", async () => {
    await seededTree();
    const before = dnd.draggables.length;

    // The registration follows `onNodeCreated`, so a row appended from outside — which the
    // Predecessor's `querySelectorAll(".file-tree-item")` pass would have picked up and handed a
    // Drag source to — is simply not one of the document's rows.
    const foreign = document.createElement("div");
    foreign.setAttribute("part", "row");
    foreign.dataset.path = "smuggled.json";
    treeEl().append(foreign);
    repaint();
    await flush(3);

    expect(dnd.draggables).toHaveLength(before);
    expect(dnd.draggables.some((d) => d.element === foreign)).toBe(false);
  });

  test("the placeholder for an unlisted directory is not a drag source", async () => {
    installFsPlatform({ "pages/index.json": "{}" });
    siteState();
    mountFilesPanel(host, () => {
      renders += 1;
    });
    await flush(3);

    expect(host.querySelector('[part="loading-row"]')).not.toBeNull();
    // There is no file there yet: a registration against a node the listing is about to replace is
    // One nothing could take back.
    expect(dnd.draggables).toHaveLength(0);
  });

  test("no project means no tree, and therefore no registrations at all", async () => {
    installFsPlatform();
    await mountTree();

    expect(host.querySelector('[role="tree"]')).toBeNull();
    expect(dnd.draggables).toHaveLength(0);
    expect(dnd.dropTargets).toHaveLength(0);
    expect(dnd.monitors).toHaveLength(0);
  });

  test("taking the panel down gives every registration back", async () => {
    await seededTree();

    unmountFilesPanel();

    expect(dnd.cleanups).toContain("draggable");
    expect(dnd.cleanups).toContain("dropTarget");
    expect(dnd.cleanups).toContain("monitor");
  });

  test("draggable rows expose file-tree data, and the dragged row says so as STATE", async () => {
    await seededTree();

    const drag = dnd.draggables.find((d) => d.element?.dataset?.value === "beta.md");
    expect(drag.getInitialData()).toEqual({
      entryType: "file",
      path: "beta.md",
      type: "file-tree",
    });

    drag.onDragStart();
    await flush();
    expect(rowFor("beta.md").dataset.dragging).toBe("");
    drag.onDrop();
    await flush();
    // A state the flow holds, not a class the handler adds and the next handler has to remember to
    // Take off — which is what left a cancelled drag's highlight on screen.
    expect(rowFor("beta.md").dataset.dragging).toBeUndefined();
  });

  test("directory drop target accept/reject logic", async () => {
    await seededTree();
    const target = rowTarget("assets");

    // `canDrop` is now about PARTICIPATION — every tree drag, so the row occludes the tree — and
    // The verdict rides in the data. A refusal that answered `false` here was a refusal the drop
    // Fell straight through.
    expect(target.canDrop(from("x", "canvas"))).toBe(false);
    expect(target.canDrop(from("assets"))).toBe(true);

    const refused = { type: "file-tree-refused" };
    expect(target.getData(from("assets"))).toEqual(refused);
    expect(target.getData(from("assets/logo.png"))).toEqual(refused);
    expect(target.getData(from(String.raw`assets\logo.png`))).toEqual(refused);
    expect(target.getData(from("beta.md"))).toEqual({
      targetDir: "assets",
      type: "file-tree-target",
    });
    expect(target.getData(from("pages/index.json"))).toEqual({
      targetDir: "assets",
      type: "file-tree-target",
    });
  });

  test("a file row is a target that refuses, because the alternative is the project root", async () => {
    await seededTree();
    const target = rowTarget("beta.md");

    // A file has no inside to move something into — but it must SAY so from where it stands, or
    // Pragmatic-dnd hands the drop to the next target up, which is the tree.
    expect(target.canDrop(from("pages/index.json"))).toBe(true);
    expect(target.getData(from("pages/index.json"))).toEqual({ type: "file-tree-refused" });

    target.onDragEnter(from("pages/index.json"));
    await flush();
    expect(rowFor("beta.md").dataset.drop).toBeUndefined();
  });

  test("a directory under a drag says so, and stops when the drag leaves", async () => {
    await seededTree();
    const target = rowTarget("assets");
    const drag = from("beta.md");

    target.onDragEnter(drag);
    await flush();
    expect(rowFor("assets").dataset.drop).toBe("");
    target.onDragLeave();
    await flush();
    expect(rowFor("assets").dataset.drop).toBeUndefined();
    target.onDrag(drag);
    target.onDrag(drag); // Idempotent — the second is a no-op, not a second projection
    await flush();
    expect(rowFor("assets").dataset.drop).toBe("");
    target.onDrop();
    await flush();
    expect(rowFor("assets").dataset.drop).toBeUndefined();
  });

  test("a directory that refuses the drag shows no affordance for it", async () => {
    await seededTree();
    const target = rowTarget("assets");

    target.onDragEnter(from("assets/logo.png"));
    await flush();
    // Nothing is going to happen, so nothing says it will.
    expect(rowFor("assets").dataset.drop).toBeUndefined();
  });

  test("root drop target accepts only entries not already at the root", async () => {
    await seededTree();
    const root = rootTarget();

    expect(root.canDrop(from("beta.md"))).toBe(false);
    expect(root.canDrop(from("pages/index.json"))).toBe(true);
    expect(root.canDrop(from("x", "canvas"))).toBe(false);
    expect(root.getData()).toEqual({ targetDir: ".", type: "file-tree-target" });

    root.onDragEnter();
    await flush();
    expect(treeEl().dataset.drop).toBe("true");
    root.onDragLeave();
    await flush();
    expect(treeEl().dataset.drop).toBeUndefined();
    root.onDrop();
  });

  test("the background stops claiming the drop while a row is under the pointer", async () => {
    await seededTree();
    const root = rootTarget();
    const refusing = rowTarget("assets");

    // The tree contains every row, so it is still under the drag while a row is — and it used to
    // Go on saying the project root would take it, which is exactly the move a refused row made.
    root.onDragEnter();
    await flush();
    expect(treeEl().dataset.drop).toBe("true");

    refusing.onDragEnter(from("assets/logo.png"));
    await flush();
    expect(treeEl().dataset.drop).toBeUndefined();
    expect(rowFor("assets").dataset.drop).toBeUndefined();

    refusing.onDragLeave();
    await flush();
    expect(treeEl().dataset.drop).toBe("true");
  });

  test("a window that slid mid-drag would drop the sources, so it does not slide", async () => {
    await seededTree();
    const drag = dnd.draggables.find((d) => d.element?.dataset?.value === "beta.md");
    drag.onDragStart();
    await flush();
    const before = renders;

    // The scroll watch's repaint is what would rebuild the rows pragmatic-dnd is holding. `_dragPath`
    // Is what says a drag is in flight, where the predecessor asked the DOM for a `.dragging` class.
    treeEl().dispatchEvent(new Event("scroll"));
    await flush(2);
    expect(renders).toBe(before);

    drag.onDrop();
  });

  test("monitor ignores drops without a target or with foreign data", async () => {
    const { handle } = await seededTree();
    const [monitor] = dnd.monitors;

    monitor.onDrop({
      location: { current: { dropTargets: [] } },
      source: { data: { path: "beta.md", type: "file-tree" } },
    });
    monitor.onDrop({
      location: {
        current: { dropTargets: [{ data: { targetDir: ".", type: "file-tree-target" } }] },
      },
      source: { data: { path: "x", type: "canvas" } },
    });
    monitor.onDrop({
      location: { current: { dropTargets: [{ data: { type: "canvas-target" } }] } },
      source: { data: { path: "beta.md", type: "file-tree" } },
    });
    // Same resulting path — no move
    monitor.onDrop({
      location: {
        current: { dropTargets: [{ data: { targetDir: ".", type: "file-tree-target" } }] },
      },
      source: { data: { path: "beta.md", type: "file-tree" } },
    });
    await flush();

    expect(handle.state.calls.filter(([name]) => name === "renameFile")).toHaveLength(0);
  });

  test("a refused innermost target ends the drop; it is not handed to the root behind it", async () => {
    const { handle } = await seededTree({ "assets/logo.png": "x" });
    const [monitor] = dnd.monitors;

    // What pragmatic-dnd actually hands over: a bubble-ordered stack whose innermost entry is the
    // Row that said no, with the tree's own root target still standing behind it. Reading past the
    // First entry is how dropping `assets/logo.png` on `assets` moved it to the project root.
    monitor.onDrop({
      location: {
        current: {
          dropTargets: [
            { data: { type: "file-tree-refused" } },
            { data: { targetDir: ".", type: "file-tree-target" } },
          ],
        },
      },
      source: { data: { path: "assets/logo.png", type: "file-tree" } },
    });
    // And the same stack with the refusal spelled as a directory that will not take it.
    monitor.onDrop({
      location: {
        current: {
          dropTargets: [
            { data: { targetDir: "assets", type: "file-tree-target" } },
            { data: { targetDir: ".", type: "file-tree-target" } },
          ],
        },
      },
      source: { data: { path: "assets/logo.png", type: "file-tree" } },
    });
    await flush();

    expect(handle.state.calls.filter(([name]) => name === "renameFile")).toHaveLength(0);
    expect(handle.state.files.has("assets/logo.png")).toBe(true);
    expect(handle.state.files.has("logo.png")).toBe(false);
  });

  test("a directory is never moved inside its own descendant", async () => {
    const { handle } = await seededTree({ "assets/nested/logo.png": "x" });
    const [monitor] = dnd.monitors;

    // A rename onto a path underneath the thing being renamed. The tree offered it and the server
    // Answered 500; the predicate is where it stops being offered.
    monitor.onDrop({
      location: {
        current: {
          dropTargets: [{ data: { targetDir: "assets/nested", type: "file-tree-target" } }],
        },
      },
      source: { data: { entryType: "directory", path: "assets", type: "file-tree" } },
    });
    await flush();

    expect(handle.state.calls.filter(([name]) => name === "renameFile")).toHaveLength(0);
  });

  test("dropping a file on the root moves it and renames its open tab", async () => {
    const { handle } = await seededTree({ "pages/index.json": "{}" });
    openTab({
      document: { tagName: "div" },
      documentPath: "pages/index.json",
      id: "pages/index.json",
    });
    const [monitor] = dnd.monitors;

    monitor.onDrop({
      location: {
        current: { dropTargets: [{ data: { targetDir: ".", type: "file-tree-target" } }] },
      },
      source: { data: { path: "pages/index.json", type: "file-tree" } },
    });
    await flush();

    expect(handle.state.calls).toContainEqual(["renameFile", "pages/index.json", "index.json"]);
    expect(handle.state.files.has("index.json")).toBe(true);
    expect(workspace.tabs.has("index.json")).toBe(true);
    expect(workspace.tabs.get("index.json")?.documentPath).toBe("index.json");
    expect(requireProjectState().expanded.has(".")).toBe(false);
    expect(renders).toBe(1);
  });

  test("dropping a directory into another moves nested tabs and expands the target", async () => {
    const { handle } = await seededTree({
      "assets/logo.png": "x",
      "pages/index.json": "{}",
    });
    openTab({
      document: { tagName: "div" },
      documentPath: "pages/index.json",
      id: "pages/index.json",
    });
    const [monitor] = dnd.monitors;

    monitor.onDrop({
      location: {
        current: { dropTargets: [{ data: { targetDir: "assets", type: "file-tree-target" } }] },
      },
      source: { data: { entryType: "directory", path: "pages", type: "file-tree" } },
    });
    await flush();

    expect(handle.state.calls).toContainEqual(["renameFile", "pages", "assets/pages"]);
    expect(workspace.tabs.has("assets/pages/index.json")).toBe(true);
    expect(requireProjectState().expanded.has("assets")).toBe(true);
  });

  test("rename failure during a drop is reported, not thrown", async () => {
    const handle = installFsPlatform(
      { "pages/index.json": "{}" },
      {
        renameFile: async () => {
          throw new Error("EBUSY");
        },
      },
    );
    siteState();
    seedTreeState();
    await mountTree();
    const [monitor] = dnd.monitors;

    monitor.onDrop({
      location: {
        current: { dropTargets: [{ data: { targetDir: ".", type: "file-tree-target" } }] },
      },
      source: { data: { path: "pages/index.json", type: "file-tree" } },
    });
    await flush();

    expect(handle.state.files.has("pages/index.json")).toBe(true);
  });
});

// ─── What a move reports when the refactor pass could not finish ──────────────

/**
 * The half of `applyRename`'s report that reaches a person.
 *
 * The engine already names the documents it could not rewrite in `report.errors` — a `.csv`
 * collection has a parser and deliberately no serializer, and a document that fails to parse cannot
 * be written back either. Nothing read that list, so both gestures said "Renamed to x" / "Moved to
 * x" whatever happened, and the rename dialog had just promised in a modal the user accepted that N
 * references "will be updated automatically. Nothing else changes."
 *
 * Asserted through the REAL notification store, not a mocked module: which tier a severity lands in
 * is part of what a warning here means, and `warn` is a toast.
 */
describe("a move reports the references it could not rewrite", () => {
  /** What `applyRename` hands back for a file it named rather than dropped. */
  const STUCK: { path: string; error: string }[] = [
    { error: "no serializer for .csv", path: "content/posts.csv" },
    { error: "Unexpected token } at 3:1", path: "pages/broken.json" },
  ];

  beforeEach(() => {
    resetNotifications();
  });

  /** A backend whose rename succeeds and answers with `report` — the refactor result under test. */
  async function seededTree(seed: Record<string, string>, report: Partial<RenameResult>) {
    const handle = installFsPlatform(seed, {
      renameFile: async (from: string, to: string): Promise<RenameResult> => ({
        from,
        ok: true,
        to,
        ...report,
      }),
    });
    siteState();
    seedTreeState();
    await mountTree();
    return { handle };
  }

  /** The context-menu gesture, all the way through the dialog it puts in front of the rename. */
  async function renameThroughMenu(path: string, newName: string): Promise<void> {
    await openMenuOn(path);
    await clickMenuRow("files.rename");
    await flush();
    const wrapper = dialogWrapper();
    expect(wrapper).not.toBeNull();
    const field = dialogField();
    field.value = newName;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    wrapper!.dispatchEvent(new Event("confirm"));
    await flush();
  }

  /** The drag gesture: a row dropped on the tree background, which is the project root. */
  async function dropOnRoot(srcPath: string): Promise<void> {
    const [monitor] = dnd.monitors;
    monitor.onDrop({
      location: {
        current: { dropTargets: [{ data: { targetDir: ".", type: "file-tree-target" } }] },
      },
      source: { data: { path: srcPath, type: "file-tree" } },
    });
    await flush();
  }

  test("a rename whose report names unwritable files warns instead of reporting success", async () => {
    await seededTree({ "pages/index.json": "{}" }, { errors: STUCK });

    await renameThroughMenu("pages/index.json", "home.json");

    expect(toasts).toHaveLength(1);
    const [reported] = toasts;
    expect(reported!.severity).toBe("warn");
    expect(reported!.message).toBe(
      "Renamed to home.json — references in 2 files could not be updated",
    );
    /* Every named file with the engine's own reason for it. The headline is a count; this is the
       part an author can act on, and Problems is the surface that renders it. */
    expect(reported!.detail).toBe(
      "content/posts.csv: no serializer for .csv\npages/broken.json: Unexpected token } at 3:1",
    );
    expect(reported!.path).toBe("pages/home.json");
    expect(reported!.source).toBe("Files");
  });

  test("an empty errors array is still the plain success, with the rename's own status text", async () => {
    await seededTree(
      { "pages/index.json": "{}" },
      {
        errors: [],
        references: {
          files: [{ count: 3, path: "pages/about.json" }],
          filesChanged: 1,
          refsUpdated: 3,
        },
      },
    );

    await renameThroughMenu("pages/index.json", "home.json");

    /* An empty list is not a failure. A report present but empty is exactly what a successful
       refactor pass looks like, so `renameStatus`'s sentence has to survive the new helper
       untouched — the counts in it are the only place the rewrite is ever reported. */
    expect(toasts).toHaveLength(1);
    const [reported] = toasts;
    expect(reported!.severity).toBe("success");
    expect(reported!.message).toBe("Renamed to home.json; updated 3 reference(s) in 1 file(s)");
    expect(reported!.detail).toBeUndefined();
  });

  test("a drag-move warns too — the gesture that never had a dialog to promise anything", async () => {
    await seededTree({ "pages/index.json": "{}" }, { errors: [STUCK[0]!] });

    await dropOnRoot("pages/index.json");

    expect(toasts).toHaveLength(1);
    const [reported] = toasts;
    expect(reported!.severity).toBe("warn");
    // "1 file", not "1 files": the count is read by whoever is about to go and fix them.
    expect(reported!.message).toBe(
      "Moved to index.json — references in 1 file could not be updated",
    );
    expect(reported!.detail).toBe("content/posts.csv: no serializer for .csv");
    expect(reported!.path).toBe("index.json");
    expect(reported!.source).toBe("Files");
  });

  test("a drag-move drops the usage cache, so no count still answers about the old path", async () => {
    const handle = installFsPlatform(
      { "pages/index.json": "{}" },
      {
        findReferences: async (target: {
          path?: string;
          tagName?: string;
        }): Promise<ReferencesResult> => ({
          errors: [],
          files: [
            {
              count: 2,
              path: "pages/about.json",
              refs: [{ count: 2, ref: "./pages/index.json", refType: "$ref" }],
            },
          ],
          filesReferencing: 1,
          path: target.path ?? null,
          refsTotal: 2,
          tagName: null,
        }),
      },
    );
    siteState();
    seedTreeState();
    await mountTree();
    const seeded = await loadUsages({ path: "pages/index.json" });
    expect(seeded.status).toBe("ready");

    await dropOnRoot("pages/index.json");

    expect(handle.state.calls).toContainEqual(["renameFile", "pages/index.json", "index.json"]);
    /* `markLocalMutation` suppresses the watcher echo that would otherwise clear this, so the move
       has to say so itself. Without it every usage count in the session — the inspector's "Used on
       N pages", Find Usages, and the next delete confirmation — goes on answering about a path
       that no longer exists. */
    expect(peekUsages({ path: "pages/index.json" })).toBeNull();
  });
});

// ─── External (OS) file drops ─────────────────────────────────────────────────

describe("file tree external file drops", () => {
  async function seededTree(seed: Record<string, string> = {}) {
    const handle = installFsPlatform(seed);
    siteState();
    seedTreeState();
    await mountTree();
    return { handle };
  }

  const uploadPaths = (handle: { state: MockPlatformState }) =>
    handle.state.calls.filter((c) => c[0] === "uploadFile").map((c) => c[1]);

  test("a directory row accepts files and uploads into itself", async () => {
    const { handle } = await seededTree();

    const over = dragEvent(rowFor("assets"), "dragover", [testFile("hero.png")]);
    expect(over.event.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    await flush();
    expect(rowFor("assets").dataset.drop).toBe("");

    dragEvent(rowFor("assets"), "drop", [testFile("hero.png")]);
    await flush(3);

    expect(uploadPaths(handle)).toEqual(["assets/hero.png"]);
    expect(rowFor("assets").dataset.drop).toBeUndefined();
    // The target expands so the new file is visible without a manual disclosure click.
    expect(requireProjectState().expanded.has("assets")).toBe(true);
  });

  test("a file row uploads beside itself, into its parent directory", async () => {
    const handle = installFsPlatform({ "assets/note.txt": "x" });
    siteState();
    seedTreeState();
    const st = requireProjectState();
    st.dirs.set("assets", [{ name: "note.txt", path: "assets/note.txt", type: "file" }]);
    st.expanded.add("assets");
    await mountTree();

    dragEvent(rowFor("assets/note.txt"), "drop", [testFile("hero.png")]);
    await flush(3);

    expect(uploadPaths(handle)).toEqual(["assets/hero.png"]);
  });

  test("the tree background uploads to the project root", async () => {
    const { handle } = await seededTree();

    dragEvent(treeEl(), "drop", [testFile("hero.png")]);
    await flush(3);

    // "." contributes no prefix — the file lands at the root, not under "./".
    expect(uploadPaths(handle)).toEqual(["hero.png"]);
  });

  test("an in-app pragmatic drag is ignored (no Files type, no preventDefault)", async () => {
    const { handle } = await seededTree();

    const over = dragEvent(rowFor("assets"), "dragover", []);
    expect(over.event.defaultPrevented).toBe(false);
    await flush();
    expect(rowFor("assets").dataset.drop).toBeUndefined();

    dragEvent(rowFor("assets"), "drop", []);
    await flush();
    expect(uploadPaths(handle)).toEqual([]);
  });

  test("dragleave clears the highlight without uploading", async () => {
    const { handle } = await seededTree();

    dragEvent(rowFor("assets"), "dragover", [testFile("hero.png")]);
    await flush();
    dragEvent(rowFor("assets"), "dragleave", [testFile("hero.png")]);
    await flush();

    expect(rowFor("assets").dataset.drop).toBeUndefined();
    expect(uploadPaths(handle)).toEqual([]);
  });

  test("a row drop does not also fire the tree-background handler", async () => {
    const { handle } = await seededTree();

    dragEvent(rowFor("assets"), "drop", [testFile("hero.png")]);
    await flush(3);

    // One upload, into the row's directory — not a second one at the root.
    expect(uploadPaths(handle)).toEqual(["assets/hero.png"]);
  });
});

// ─── .gitignore-aware rows ────────────────────────────────────────────────────

/**
 * The Files sidebar hides what `.gitignore` masks.
 *
 * These cases go through `loadDirectory` rather than `seedTreeState`, and that is the whole
 * difference between them and every case above: seeding `projectState.dirs` by hand loads no ignore
 * layers, so nothing is hidden and the older fixtures keep meaning what they always meant. A real
 * listing fetches the rules alongside the entries, which is what makes a row disappear.
 *
 * The mock backend lists dotfiles that the dev server and the desktop session both drop, so the
 * `.gitignore` itself draws a row here. Left as it is on purpose: a fixture that quietly filtered
 * more than the code under test would make the row counts below unreadable.
 */
describe("the file tree and .gitignore", () => {
  beforeEach(() => {
    /* Both are module state that outlives a test: the compiled layers, and the roaming setting
       behind the toolbar toggle. A tree that hides rows for a reason the case never stated is the
       hardest kind of failure to read. */
    resetIgnoreCache();
    setShowIgnoredFiles(false);
  });

  /** Seed a backend, load the root (plus any directories to expand), and mount the tree. */
  async function ignoreTree(
    seed: Record<string, string>,
    opts: { expand?: string[]; searchQuery?: string } = {},
  ) {
    const handle = installFsPlatform(seed);
    siteState({ searchQuery: opts.searchQuery ?? "" });
    await loadDirectory(".");
    for (const dir of opts.expand ?? []) {
      requireProjectState().expanded.add(dir);
      await loadDirectory(dir);
    }
    await mountTree();
    return { handle };
  }

  /** The standard noisy project: a tool-written directory and a tool-written file. */
  const NOISY_ROOT = {
    ".gitignore": "node_modules/\n*.log\n",
    "beta.md": "# b",
    "build.log": "compiled at…",
    "node_modules/left-pad/index.js": "module.exports = () => {};",
    "pages/index.json": "{}",
  };

  test("an ignored directory and an ignored file draw no row; the rest still do", async () => {
    await ignoreTree(NOISY_ROOT);

    expect(rowFor("node_modules", false)).toBeNull();
    expect(rowFor("build.log", false)).toBeNull();
    expect(rowFor("beta.md")).not.toBeNull();
    expect(rowFor("pages")).not.toBeNull();
  });

  test("the cache still mirrors the filesystem — hiding is a repaint, not a refetch", async () => {
    await ignoreTree(NOISY_ROOT);

    /* Filtering happens where rows are BUILT, so everything else that reads `dirs` — the fs-event
       reducer, the reference index, a later toggle — goes on seeing the real directory. Drop the
       entries at the listing instead and showing them again costs a round trip. */
    const paths = requireProjectState()
      .dirs.get(".")!
      .map((e) => e.path);
    expect(paths).toContain("node_modules");
    expect(paths).toContain("build.log");
  });

  test("the toolbar toggle draws the ignored rows, and takes them away again", async () => {
    const { handle } = await ignoreTree(NOISY_ROOT);
    expect(rowFor("node_modules", false)).toBeNull();
    expect(propOf<string>("show-ignored", "label")).toBe("Show ignored files");
    handle.state.calls.length = 0;

    part("show-ignored").click();
    await flush(3);
    /* The button asks the panel to repaint and nothing else — the entries were never dropped from
       the cache, so nothing has to be fetched back. */
    expect(renders).toBe(1);
    expect(handle.state.calls.filter(([name]) => name === "listDirectory")).toHaveLength(0);

    expect(rowFor("node_modules")).not.toBeNull();
    expect(rowFor("build.log")).not.toBeNull();
    expect(propOf<string>("show-ignored", "label")).toBe("Hide ignored files");
    expect(propOf<string>("show-ignored", "icon")).toBe("eye");
    expect(propOf<boolean>("show-ignored", "selected")).toBe(true);

    part("show-ignored").click();
    await flush(3);
    expect(rowFor("node_modules", false)).toBeNull();
    expect(rowFor("beta.md")).not.toBeNull();
  });

  test("the search filter runs on what is visible and cannot resurrect an ignored file", async () => {
    // "catalog.md" and "build.log" both match the query; only one of them is the author's.
    const seed = {
      ".gitignore": "*.log\n",
      "build.log": "compiled at…",
      "catalog.md": "# c",
      "other.md": "# o",
    };
    await ignoreTree(seed, { searchQuery: "log" });

    expect(rowFor("catalog.md")).not.toBeNull();
    expect(rowFor("build.log", false)).toBeNull();
    expect(rowFor("other.md", false)).toBeNull();

    /* The ignore filter runs BEFORE the query, so the toggle is the only thing that brings the
       masked match back — a search that reached past `.gitignore` would make the toggle a lie. */
    setShowIgnoredFiles(true);
    repaint();
    await flush(3);
    expect(rowFor("build.log")).not.toBeNull();
  });

  test("a nested .gitignore hides only inside its own directory", async () => {
    await ignoreTree(
      {
        "root.tmp": "kept",
        "src/.gitignore": "*.tmp\n",
        "src/main.ts": "export {};",
        "src/scratch.tmp": "dropped",
      },
      { expand: ["src"] },
    );

    expect(rowFor("src/scratch.tmp", false)).toBeNull();
    expect(rowFor("src/main.ts")).not.toBeNull();
    /* The same name at the root is untouched: `src/.gitignore` is relative to `src/`, and a rule
       the author wrote one level down must not reach back up. */
    expect(rowFor("root.tmp")).not.toBeNull();
  });

  test("aria-setsize / aria-posinset count the rows that are drawn", async () => {
    const seed = {
      ".gitignore": "node_modules/\ndist/\n",
      "alpha.md": "# a",
      "beta.md": "# b",
      "dist/bundle.js": "x",
      "node_modules/left-pad/index.js": "x",
    };
    await ignoreTree(seed);

    /* Five entries in the directory, three rows on screen. A hidden row that still inflated the
       set would have a screen reader announce "2 of 5" over a list of three — the count has to
       describe what is drawn, not what was listed. */
    expect(rowFor("alpha.md").getAttribute("aria-posinset")).toBe("2");
    expect(rowFor("alpha.md").getAttribute("aria-setsize")).toBe("3");
    expect(rowFor("beta.md").getAttribute("aria-posinset")).toBe("3");
    expect(rowFor("beta.md").getAttribute("aria-setsize")).toBe("3");

    setShowIgnoredFiles(true);
    repaint();
    await flush(3);
    expect(rows()).toHaveLength(5);
    expect(rowFor("beta.md").getAttribute("aria-setsize")).toBe("5");
  });

  test("Refresh re-reads the .gitignore, not just the listing", async () => {
    const { handle } = await ignoreTree(NOISY_ROOT);
    expect(handle.state.calls).toContainEqual(["readFile", ".gitignore"]);
    handle.state.calls.length = 0;

    part("refresh").click();
    await flush(3);

    /* Refresh is what an author reaches for after editing a `.gitignore` by hand. The rules are
       cached per directory, so without the reset the second listing would be filtered by the first
       run's rules and the button would look broken. */
    expect(handle.state.calls).toContainEqual(["listDirectory", "."]);
    expect(handle.state.calls).toContainEqual(["readFile", ".gitignore"]);
  });
});
