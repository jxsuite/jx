/**
 * The Palette — one omnibox, several modes (plan §5.4).
 *
 * Three things are worth stating about the shape of this file:
 *
 * - The RANKING and the MODE RESOLUTION are pure functions and are tested as such, because they are
 *   the two pieces of behaviour a DOM assertion would describe only indirectly.
 * - Command mode is exercised against the REAL default records over a controllable context, so the
 *   greyed-with-a-reason row and the right-aligned chord are properties of the registry, not of a
 *   fixture invented here.
 * - The file list is fetched ONCE per open with an empty query — `searchFiles`'s glob is a basename
 *   substring, so full-path fuzzy matching has to happen on this side of it.
 */
import { flush, installMockPlatform, resetStudioState, mountOverlayLayers } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { StudioFormat } from "../src/format/format-host";

const openFileInTab = mock((_path: string) => {});
void mock.module("../src/files/files.js", () => ({ openFileInTab }));

const palette = await import("../src/panels/quick-search");
const {
  closeQuickSearch,
  fuzzyScore,
  initQuickSearch,
  getRecentCommands,
  isQuickSearchOpen,
  modeSpec,
  openQuickSearch,
  PALETTE_MODES,
  paletteArgs,
  rankBy,
  resolvePaletteMode,
} = palette;
const { setFormats } = await import("../src/format/format-host");
const { initLayers } = await import("../src/ui/layers");
const { setProjectState } = await import("../src/store");
const { getRecentFiles, trackRecentFile } = await import("../src/recent-projects");
const { createCommandRegistry } = await import("../src/commands/registry");
const { defaultCommands, noopCommandDeps } = await import("../src/commands/defaults");
const { makeContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { closeAllTabs, openTab } = await import("../src/workspace/workspace");

type CommandContext = ReturnType<typeof makeContext>;

const PROJECT_ROOT = "/project";
const RECENT_PROJECTS_KEY = "jx-studio-recent-projects";

// Layer DOM is set up once — getLayerSlot caches its slot element, so the body must not be
// Replaced between tests (the cached slot would keep pointing into a detached subtree).
mountOverlayLayers(document.body);
initLayers();

const MARKDOWN_FORMAT: StudioFormat = {
  capabilities: { parse: { identifier: "parse", timing: ["buildtime"] } },
  documentKinds: ["content"],
  exportTarget: false,
  extensions: [".md"],
  mediaType: "text/markdown",
  name: "Markdown",
  remote: false,
  studio: null,
};

const SEED_FILES = {
  "/project/pages/blog/index.md": "# Blog",
  "/project/pages/doc-a.json": "{}",
  "/project/pages/doc-b.json": "{}",
  "/project/posts/hello.md": "# Hello",
  "/project/raw/blob.xyz": "data",
  "rootfile-doc.json": "{}",
};

let ctx: CommandContext = makeContext();
let ran: string[] = [];

/** A registry over the real defaults plus the one record the node mode invokes. */
function installRegistry() {
  const registry = createCommandRegistry({ getContext: () => ctx, mac: true });
  registry.registerAll(
    defaultCommands({
      ...noopCommandDeps(),
      panelRoster: [],
      saveDocument: () => {
        ran.push("save");
      },
      toggleZen: () => {
        ran.push("zen");
      },
    }),
  );
  registry.register({
    id: "selection.set",
    title: "Select Node",
    category: "Selection",
    level: "selection",
    menus: ["never"],
    args: {
      type: "object",
      properties: { path: { type: "array", items: { type: ["string", "number"] } } },
      required: ["path"],
    },
    run: (_c, args: { path: unknown }) => {
      ran.push(`select:${JSON.stringify(args.path)}`);
    },
  });
  registry.register({
    id: "test.themed",
    title: "Set Palette Theme",
    category: "View",
    level: "application",
    args: {
      type: "object",
      properties: { color: { enum: ["light", "dark"], type: "string" } },
      required: ["color"],
    },
    run: (_c, args: { color: string }) => {
      ran.push(`theme:${args.color}`);
    },
  });
  registry.register({
    id: "test.flag",
    title: "Set A Flag",
    category: "View",
    level: "application",
    args: {
      type: "object",
      properties: { on: { type: "boolean" } },
      required: ["on"],
    },
    run: (_c, args: { on: boolean }) => {
      ran.push(`flag:${String(args.on)}`);
    },
  });
  registry.register({
    id: "test.explodes",
    title: "Explode",
    category: "View",
    level: "application",
    run: () => {
      throw new Error("boom");
    },
  });
  setActiveRegistry(registry);
  return registry;
}

function overlay(): HTMLElement | null {
  return document.querySelector('[part="overlay"]');
}

function input(): HTMLInputElement {
  return document.querySelector('[part="input"]') as HTMLInputElement;
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll('[part="option"]')] as HTMLElement[];
}

function names(): (string | undefined)[] {
  return items().map((el) => el.querySelector('[part="label"]')?.textContent ?? undefined);
}

/**
 * The row the caret is on, as the kit's listbox sidecar marks it.
 *
 * The flag is written a microtask after the id moves — the listbox observes its own `data-active`
 * and is the single writer of every row's `selected` — so every assertion about the highlight
 * follows a {@link flush}, while `Enter` and a click still read the index synchronously.
 */
function selected(): HTMLElement | null {
  return document.querySelector('[part="option"][aria-selected="true"]');
}

function keydown(keyName: string) {
  input().dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: keyName }),
  );
}

/** Type into the palette and let the (single, per-open) file fetch settle. */
async function type(query: string) {
  const el = input();
  el.value = query;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

/** One keystroke: append to what the field already holds, the way a keyboard does. */
async function press(ch: string) {
  const el = input();
  el.value += ch;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

async function open(mode: Parameters<typeof openQuickSearch>[0] = "picker") {
  openQuickSearch(mode);
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  openFileInTab.mockClear();
  closeAllTabs();
  ran = [];
  ctx = makeContext();
  initQuickSearch();
  setFormats([MARKDOWN_FORMAT]);
  installMockPlatform({}, SEED_FILES);
  installRegistry();
  resetStudioState({ isSiteProject: true, name: "Test", projectRoot: PROJECT_ROOT });
  closeQuickSearch();
});

// ─── Pure: mode resolution ────────────────────────────────────────────────────

describe("resolvePaletteMode", () => {
  test("a prefix wins over the mode the palette was opened as", () => {
    expect(resolvePaletteMode("files", ">save", true)).toEqual({ mode: "commands", query: "save" });
    expect(resolvePaletteMode("commands", "@h1", true)).toEqual({ mode: "nodes", query: "h1" });
    expect(resolvePaletteMode("files", "?", true)).toEqual({ mode: "picker", query: "" });
  });

  test("the picker lists modes while empty and means files once something is typed", () => {
    expect(resolvePaletteMode("picker", "", true).mode).toBe("picker");
    expect(resolvePaletteMode("picker", "  ", true).mode).toBe("picker");
    expect(resolvePaletteMode("picker", "index", true)).toEqual({
      mode: "files",
      query: "index",
    });
  });

  test("files with no project open is the NAMED Recent Projects mode", () => {
    // The one substitution the predecessor made silently, now stated by the chip.
    expect(resolvePaletteMode("files", "acme", false).mode).toBe("projects");
    expect(resolvePaletteMode("picker", "acme", false).mode).toBe("projects");
    expect(resolvePaletteMode("commands", "save", false).mode).toBe("commands");
  });

  test("every mode is declared once, and modeSpec is total", () => {
    expect(new Set(PALETTE_MODES.map((spec) => spec.mode)).size).toBe(PALETTE_MODES.length);
    for (const spec of PALETTE_MODES) {
      expect(modeSpec(spec.mode)).toBe(spec);
      expect(spec.description).not.toBe("");
    }
    expect(modeSpec("nope" as never)).toBe(PALETTE_MODES[0]!);
  });
});

// ─── Pure: fuzzy ranking ──────────────────────────────────────────────────────

describe("fuzzyScore", () => {
  test("matches a subsequence over the FULL path, and refuses a non-subsequence", () => {
    expect(fuzzyScore("pages/blog/index.md", "pgblog")).not.toBeNull();
    expect(fuzzyScore("pages/blog/index.md", "zz")).toBeNull();
  });

  test("an empty query matches everything at zero", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });

  test("a basename hit outranks the same letters in a directory", () => {
    const inName = fuzzyScore("pages/index.md", "index")!;
    const inDirectory = fuzzyScore("index-partials/a.md", "index")!;
    expect(inName).toBeGreaterThan(inDirectory);
  });

  test("a consecutive run outranks scattered letters", () => {
    expect(fuzzyScore("blog.md", "blog")!).toBeGreaterThan(fuzzyScore("b-l-o-g.md", "blog")!);
  });

  test("case is ignored in both directions", () => {
    expect(fuzzyScore("Pages/Index.MD", "index")).not.toBeNull();
  });

  test("rankBy drops non-matches and orders best-first, stably", () => {
    const paths = ["pages/index.md", "pages/blog/index.md", "components/Card.json"];
    expect(rankBy(paths, "index", (p) => p)).toEqual(["pages/index.md", "pages/blog/index.md"]);
    expect(rankBy(paths, "", (p) => p)).toEqual(paths);
  });
});

// ─── Pure: argument prompts ───────────────────────────────────────────────────

describe("paletteArgs", () => {
  const base = { category: "View", id: "x.y", level: "application", run: () => {}, title: "X" };

  test("no schema means the command runs straight away", () => {
    expect(paletteArgs(base as never)).toEqual({ kind: "none" });
    expect(paletteArgs({ ...base, args: { type: "object" } } as never)).toEqual({ kind: "none" });
  });

  test("one enum property becomes a list of choices", () => {
    const args = paletteArgs({
      ...base,
      args: { properties: { mode: { enum: ["edit", "design"] } } },
    } as never);
    expect(args).toEqual({
      kind: "choice",
      name: "mode",
      choices: [
        { label: "edit", value: "edit" },
        { label: "design", value: "design" },
      ],
    });
  });

  test("one boolean property becomes on/off", () => {
    const args = paletteArgs({
      ...base,
      args: { properties: { open: { type: "boolean" } } },
    } as never);
    expect(args).toEqual({
      kind: "choice",
      name: "open",
      choices: [
        { label: "on", value: true },
        { label: "off", value: false },
      ],
    });
  });

  test("an open value space, or more than one property, is unsupported", () => {
    // A palette is a LIST. `canvas.setZoom { zoom: number }` has no list to show, so command mode
    // Does not render a row that cannot be completed.
    expect(
      paletteArgs({ ...base, args: { properties: { zoom: { type: "number" } } } } as never).kind,
    ).toBe("unsupported");
    expect(
      paletteArgs({
        ...base,
        args: { properties: { a: { type: "boolean" }, b: { type: "boolean" } } },
      } as never).kind,
    ).toBe("unsupported");
  });
});

// ─── Open / close ─────────────────────────────────────────────────────────────

describe("open and close", () => {
  test("a bare open is the files mode — the gesture an empty state's Open a page… offers", async () => {
    openQuickSearch();
    await flush();
    expect(document.querySelector('[part="chip"]')?.textContent?.trim()).toContain("Files");
  });

  test("⌘K opens the mode picker, which enumerates the namespace", async () => {
    await open();
    expect(isQuickSearchOpen()).toBe(true);
    expect(names()).toEqual(["Files", "Commands", "Symbols", "Recent Projects"]);
    // `?` lists the modes and is therefore not one of the rows it lists.
    expect(names()).not.toContain("Modes");
  });

  test("clicking a mode row enters that mode", async () => {
    await open();
    items()[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector('[part="chip"]')?.textContent?.trim()).toContain("Commands");
  });

  test("the backdrop closes; a click inside the panel does not", async () => {
    await open();
    const panel = document.querySelector('[part="panel"]') as HTMLElement;
    panel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(overlay()).toBeTruthy();
    overlay()!.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    expect(overlay()).toBeNull();
    expect(isQuickSearchOpen()).toBe(false);
  });

  test("Escape closes, and an unhandled key changes nothing", async () => {
    await open("commands");
    keydown("x");
    expect(overlay()).toBeTruthy();
    keydown("Escape");
    expect(overlay()).toBeNull();
  });

  test("the footer teaches the palette's own prefixes", async () => {
    await open();
    expect(document.querySelector('[part="hint"]')?.textContent).toContain("modes");
  });
});

// ─── Files ────────────────────────────────────────────────────────────────────

describe("files mode", () => {
  test("the document set is fetched ONCE, with an empty query, then ranked locally", async () => {
    const { state } = installMockPlatform({}, SEED_FILES);
    await open("files");
    await type("pgblog");
    const searches = state.calls.filter(([name]) => name === "searchFiles");
    expect(searches).toEqual([["searchFiles", "", [".md"]]]);
    // A basename substring backend could never have answered "pgblog".
    expect(names()).toEqual(["index.md"]);
    expect(items()[0]!.querySelector('[part="description"]')?.textContent).toBe(
      "/project/pages/blog",
    );
  });

  test("Enter opens the ranked row and tracks it as recent", async () => {
    await open("files");
    await type("doc");
    expect(names()).toContain("doc-a.json");
    keydown("ArrowDown");
    keydown("Enter");
    expect(overlay()).toBeNull();
    expect(openFileInTab).toHaveBeenCalledTimes(1);
    expect(getRecentFiles()).toHaveLength(1);
  });

  test("an empty query lists this project's recents, badged", async () => {
    trackRecentFile({ name: "old.md", path: "/project/posts/old.md", root: PROJECT_ROOT });
    trackRecentFile({ name: "fresh.json", path: "/project/pages/fresh.json", root: PROJECT_ROOT });
    await open("files");
    expect(document.querySelector('[part="group-heading"]')?.textContent).toBe("Recently opened");
    expect(names()).toEqual(["fresh.json", "old.md"]);
    expect(items()[0]!.querySelector('[part="badge"]')?.textContent).toBe("recent");
    items()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(openFileInTab).toHaveBeenCalledWith("/project/pages/fresh.json");
  });

  test("file icons follow the extension", async () => {
    await open("files");
    await type("doc-a");
    expect((items()[0]!.querySelector("jx-icon") as HTMLElement & { name: string }).name).toBe(
      "file-code",
    );
    await type("hello");
    expect((items()[0]!.querySelector("jx-icon") as HTMLElement & { name: string }).name).toBe(
      "file-text",
    );
    await type("blob");
    expect((items()[0]!.querySelector("jx-icon") as HTMLElement & { name: string }).name).toBe(
      "file",
    );
  });

  test("a file at the search root has an empty directory subtitle", async () => {
    await open("files");
    await type("rootfile");
    expect(items()[0]!.querySelector('[part="description"]')?.textContent).toBe("");
  });

  test("a failing backend leaves the mode usable and says No results", async () => {
    installMockPlatform({
      searchFiles: (async () => {
        throw new Error("search backend down");
      }) as never,
    });
    await open("files");
    await type("doc");
    expect(items()).toHaveLength(0);
    expect(document.querySelector('[part="empty"]')?.textContent).toBe("No results");
  });

  test("mouseenter moves the selection", async () => {
    await open("files");
    await type("doc");
    items()[1]!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    await flush();
    expect(selected()).toBe(items()[1]!);
  });

  test("arrow keys clamp at both ends", async () => {
    await open("files");
    await type("doc");
    expect(selected()).toBe(items()[0]!);
    for (let i = 0; i < 6; i++) {
      keydown("ArrowDown");
    }
    await flush();
    expect(selected()).toBe(items().at(-1)!);
    for (let i = 0; i < 6; i++) {
      keydown("ArrowUp");
    }
    await flush();
    expect(selected()).toBe(items()[0]!);
  });

  test("Enter with no rows is a no-op", async () => {
    await open("files");
    await type("zzz-nothing");
    keydown("Enter");
    expect(overlay()).toBeTruthy();
    expect(openFileInTab).not.toHaveBeenCalled();
  });
});

// ─── Commands ─────────────────────────────────────────────────────────────────

describe("command mode", () => {
  test("rows print Category: Title with the chord right-aligned", async () => {
    ctx = makeContext({ document: { open: true, canUndo: true } });
    await open("commands");
    await type("save");
    expect(names()[0]).toBe("File: Save");
    expect(items()[0]!.querySelector('[part="chord"]')?.textContent).toBe("⌘S");
  });

  test("an unavailable command is GREYED with its requires sentence, not hidden", async () => {
    ctx = makeContext({ document: { open: true, canUndo: false } });
    await open("commands");
    await type("undo");
    const row = items()[0]!;
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.querySelector('[part="description"]')?.textContent).toBe("a change to undo");

    // Enter on a greyed row does nothing AND leaves the palette open with its reason on screen.
    keydown("Enter");
    expect(overlay()).toBeTruthy();
    expect(ran).toEqual([]);

    // Nor does a click: a disabled `jx-option` dispatches no `select` at all, so the refusal is the
    // Kit's now rather than a second guard on this side of the event.
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(overlay()).toBeTruthy();
    expect(ran).toEqual([]);
  });

  test("a command whose `when` is false is absent entirely", async () => {
    ctx = makeContext();
    await open("commands");
    await type("save");
    expect(names()).not.toContain("File: Save");
  });

  test("running a command closes the palette and pins it as recent", async () => {
    await open("commands");
    await type("zen");
    keydown("Enter");
    expect(overlay()).toBeNull();
    expect(ran).toEqual(["zen"]);
    expect(getRecentCommands()).toEqual(["view.zen"]);

    // Recents pin above the rest on the next empty-query open.
    await open("commands");
    expect(document.querySelector('[part="group-heading"]')?.textContent).toBe("Recently used");
    expect(names()[0]).toBe("View: Zen Mode");
    expect(items()[0]!.querySelector('[part="chord"]')?.textContent).toBe("⌘.");
  });

  test("a command the palette cannot prompt for is not offered", async () => {
    // `selection.set` takes a JxPath — an open value space with no list to show.
    await open("commands");
    await type("Select Node");
    expect(names()).not.toContain("Selection: Select Node");
  });

  test("a command that declares no palette placement is not offered", async () => {
    await open("commands");
    await type("Select Node");
    expect(names()).toEqual([]);
  });

  test("an enum argument becomes a second step, then runs with the chosen value", async () => {
    await open("commands");
    await type("Palette Theme");
    keydown("Enter");
    await flush();
    expect(document.querySelector('[part="chip"]')?.textContent).toContain("Set Palette Theme");
    expect(names()).toEqual(["light", "dark"]);
    expect(items()[0]!.querySelector('[part="description"]')?.textContent).toBe(
      "Set Palette Theme → color",
    );

    keydown("ArrowDown");
    keydown("Enter");
    expect(ran).toEqual(["theme:dark"]);
    expect(overlay()).toBeNull();
  });

  test("a boolean argument offers on and off", async () => {
    await open("commands");
    await type("A Flag");
    keydown("Enter");
    await flush();
    expect(names()).toEqual(["on", "off"]);
    keydown("Enter");
    expect(ran).toEqual(["flag:true"]);
  });

  test("the argument step is filterable, and Backspace backs out of it", async () => {
    await open("commands");
    await type("Palette Theme");
    keydown("Enter");
    await flush();
    await type("dar");
    expect(names()).toEqual(["dark"]);

    await type("");
    keydown("Backspace");
    await flush();
    expect(document.querySelector('[part="chip"]')).toBeNull();
    expect(ran).toEqual([]);
  });

  test("a command that throws is reported, not swallowed into a broken overlay", async () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await open("commands");
      await type("Explode");
      keydown("Enter");
      await flush();
      expect(overlay()).toBeNull();
      expect(errors.some(([first]) => String(first).includes("test.explodes"))).toBe(true);
    } finally {
      console.error = originalError;
    }
  });

  test("with no registry published, command mode is empty rather than broken", async () => {
    setActiveRegistry(null);
    await open("commands");
    expect(items()).toHaveLength(0);
    expect(document.querySelector('[part="empty"]')?.textContent).toBe(
      "Type to find any command in Studio",
    );
    installRegistry();
  });

  test("a recent command with no chord is badged instead", async () => {
    initQuickSearch({ openRecentProject: mock((_root: string) => {}) });
    await open("commands");
    await type("Open Recent");
    keydown("Enter");
    await flush();

    await open("commands");
    expect(names()[0]).toBe("Project: Open Recent…");
    expect(items()[0]!.querySelector('[part="chord"]')).toBeNull();
    expect(items()[0]!.querySelector('[part="badge"]')?.textContent).toBe("recent");
  });

  test("an argument step whose registry vanished mid-prompt is inert", async () => {
    await open("commands");
    await type("Palette Theme");
    keydown("Enter");
    await flush();
    setActiveRegistry(null);
    keydown("Enter");
    expect(ran).toEqual([]);
    installRegistry();
  });

  test("a corrupt or non-array recents store degrades to none", () => {
    localStorage.setItem("jx-studio-recent-commands", "{not json");
    expect(getRecentCommands()).toEqual([]);
    localStorage.setItem("jx-studio-recent-commands", '{"a":1}');
    expect(getRecentCommands()).toEqual([]);
    localStorage.setItem("jx-studio-recent-commands", '["a", 3]');
    expect(getRecentCommands()).toEqual(["a"]);
  });
});

// ─── The mode chip ────────────────────────────────────────────────────────────

describe("the mode chip", () => {
  test("typing a prefix moves it out of the query and into the chip", async () => {
    await open();
    await type(">zen");
    expect(document.querySelector('[part="chip"]')?.textContent?.trim()).toContain("Commands");
    expect(input().value).toBe("zen");
  });

  test("the chip's × drops the mode and returns to the picker", async () => {
    await open("commands");
    expect(document.querySelector('[part="chip"]')).not.toBeNull();
    (document.querySelector('[part="chip-remove"] [part="control"]') as HTMLElement).click();
    await flush();
    expect(document.querySelector('[part="chip"]')).toBeNull();
    expect(names()).toEqual(["Files", "Commands", "Symbols", "Recent Projects"]);
  });

  test("Backspace at position zero is the same gesture as the ×", async () => {
    await open("nodes");
    keydown("Backspace");
    await flush();
    expect(document.querySelector('[part="chip"]')).toBeNull();
  });

  test("Backspace with text typed deletes text, not the chip", async () => {
    await open("commands");
    await type("ze");
    keydown("Backspace");
    await flush();
    expect(document.querySelector('[part="chip"]')).not.toBeNull();
  });

  test("the picker shows no chip", async () => {
    await open();
    expect(document.querySelector('[part="chip"]')).toBeNull();
  });

  test("a bare prefix leaves the field empty, not holding the character the chip took", async () => {
    await open();
    await press(">");
    expect(document.querySelector('[part="chip"]')?.textContent?.trim()).toContain("Commands");
    expect(input().value).toBe("");
  });

  test("Backspace out of a mode leaves no prefix behind to re-enter it", async () => {
    await open();
    await press(">");
    keydown("Backspace");
    await flush();
    expect(document.querySelector('[part="chip"]')).toBeNull();
    await press("z");
    expect(input().value).toBe("z");
    expect(document.querySelector('[part="chip"]')?.textContent?.trim()).not.toContain("Commands");
  });
});

// ─── Symbols (@) ──────────────────────────────────────────────────────────────

describe("node mode", () => {
  test("lists the document's nodes by their Outline label and selects one", async () => {
    closeAllTabs();
    openTab({
      document: {
        children: [{ children: ["Hello"], tagName: "h1" }, { tagName: "p" }],
        tagName: "div",
      },
      documentPath: "/project/pages/index.json",
      id: "node-tab",
    });
    await open("nodes");
    expect(names()).toContain("h1");
    await type("h1");
    expect(names()[0]).toBe("h1");
    expect((items()[0]!.querySelector("jx-icon") as HTMLElement & { name: string }).name).toBe(
      "stack",
    );

    keydown("Enter");
    expect(overlay()).toBeNull();
    expect(ran).toEqual([`select:${JSON.stringify(["children", 0])}`]);
  });

  test("text nodes are listed by their own content, truncated", async () => {
    closeAllTabs();
    openTab({
      document: { children: [{ children: ["a".repeat(90)], tagName: "p" }], tagName: "div" },
      documentPath: "/project/pages/long.json",
      id: "long-tab",
    });
    await open("nodes");
    const text = names().find((name) => name?.startsWith("aaa"));
    expect(text).toHaveLength(60);
  });

  test("with no document open, the mode teaches instead of showing an empty box", async () => {
    closeAllTabs();
    await open("nodes");
    expect(items()).toHaveLength(0);
    expect(document.querySelector('[part="empty"]')?.textContent).toBe(
      "Open a document to jump to its elements",
    );
  });
});

// ─── Recent projects ──────────────────────────────────────────────────────────

describe("projects mode", () => {
  function seedProjects() {
    localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify([
        { name: "Alpha", root: "/home/u/alpha", timestamp: 2 },
        { name: "Beta", root: "/srv/beta", timestamp: 1 },
      ]),
    );
  }

  test("works WITH a project open — the named Project: Open Recent… mode", async () => {
    seedProjects();
    const openRecentProject = mock((_root: string) => {});
    initQuickSearch({ openRecentProject });
    await open("projects");
    expect(document.querySelector('[part="chip"]')?.textContent).toContain("Recent Projects");
    expect(names()).toEqual(["Alpha", "Beta"]);
    expect(items()[0]!.querySelector('[part="description"]')?.textContent?.trim()).toBe("~/alpha");
    expect((items()[0]!.querySelector("jx-icon") as HTMLElement & { name: string }).name).toBe(
      "folder-open",
    );

    keydown("Enter");
    expect(openRecentProject).toHaveBeenCalledWith("/home/u/alpha");
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
  });

  test("with no project open, plain typing lands here and the chip says so", async () => {
    seedProjects();
    setProjectState(null);
    initQuickSearch({ openRecentProject: mock((_root: string) => {}) });
    const { state } = installMockPlatform({}, SEED_FILES);
    await open("files");
    await type("beta");
    expect(document.querySelector('[part="chip"]')?.textContent).toContain("Recent Projects");
    expect(names()).toEqual(["Beta"]);
    // No backend round trip: there is no project to list files from.
    expect(state.calls.some(([name]) => name === "searchFiles")).toBe(false);
  });

  test("no recents at all teaches what to do", async () => {
    setProjectState(null);
    initQuickSearch({ openRecentProject: mock((_root: string) => {}) });
    await open("files");
    expect(document.querySelector('[part="empty"]')?.textContent).toContain("No recent projects");
  });

  test("selecting a project with no init context is inert rather than a crash", async () => {
    seedProjects();
    initQuickSearch();
    await open("projects");
    keydown("Enter");
    expect(overlay()).toBeNull();
  });
});

// ─── The combobox relationship ───────────────────────────────────────────────

describe("quick search announces its results", () => {
  test("the input points at the listbox and at the highlighted row", async () => {
    /*
     * `role="combobox"` alone described nothing: there was no `aria-controls`, so a screen reader
     * could not find the popup, and no `aria-activedescendant`, so arrowing through the results
     * moved a visual highlight and said nothing at all.
     */
    await open("commands");
    await type("a");
    expect(items().length).toBeGreaterThan(0);
    const el = input();
    const list = document.querySelector('[part="results"]')!;

    expect(el.getAttribute("aria-controls")).toBe(list.id);
    expect(list.id).not.toBe("");
    expect(el.getAttribute("aria-autocomplete")).toBe("list");

    const active = el.getAttribute("aria-activedescendant");
    expect(active).not.toBeNull();
    expect(document.querySelector(`#${active}`)?.getAttribute("aria-selected")).toBe("true");
  });

  test("the highlight is ONE id: the field, the list and the row all name it", async () => {
    /*
     * The duplication this closed. Every row used to carry
     * `aria-selected="${$map.index === state.selectedIndex ? 'true' : 'false'}"` AND a
     * `data-selected` beside it, in three palettes, with nothing keeping the pair in agreement.
     * Now the surface writes one string: `active` reaches the kit's listbox, the same string
     * reaches the field as `aria-activedescendant`, and the listbox's sidecar is the only thing
     * that writes a row's flag.
     */
    await open("commands");
    await type("a");
    keydown("ArrowDown");
    await flush();

    const list = document.querySelector('[part="results"]') as HTMLElement;
    const active = input().getAttribute("aria-activedescendant");

    expect(active).toBe("quick-search-option-1");
    expect(list.dataset.active).toBe(active!);
    expect(list.getAttribute("aria-label")).toBe("Results");
    expect(selected()!.id).toBe(active!);
    expect(document.querySelectorAll("[data-selected]")).toHaveLength(0);
  });

  test("a key moves the caret without re-ranking the rows", async () => {
    /*
     * The property `rows` and `activeId` are separate fields FOR, and the one thing about this
     * surface a kit element could have taken away. `commandRows` asks the registry for its visible
     * records once per projection, so counting that counts projections — and an arrow key must
     * cost none. Typing does, which is what proves the counter is wired to anything.
     */
    const registry = installRegistry();
    let projections = 0;
    const visible = registry.visible.bind(registry);
    registry.visible = () => {
      projections += 1;
      return visible();
    };

    await open("commands");
    const projected = projections;
    expect(projected).toBeGreaterThan(0);

    keydown("ArrowDown");
    keydown("ArrowDown");
    await flush();
    expect(projections).toBe(projected);
    expect(selected()!.id).toBe("quick-search-option-2");

    await type("save");
    expect(projections).toBeGreaterThan(projected);
  });

  test("with nothing to show, the field points at no row at all", async () => {
    await open("commands");
    await type("zzzzz-no-such-command-zzzzz");
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    expect((document.querySelector('[part="results"]') as HTMLElement).dataset.active).toBe("");

    // And an arrow key over nothing moves nothing: clamping an empty list lands on index 0, which
    // Would name a row that is not there now that the id IS the highlight.
    keydown("ArrowDown");
    await flush();
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    expect((document.querySelector('[part="results"]') as HTMLElement).dataset.active).toBe("");
  });

  test("aria-expanded is honest about whether a popup is showing", async () => {
    // It was the literal string "true", which claims a popup even when nothing matched.
    await open("commands");
    await type("zzzzz-no-such-command-zzzzz");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
  });
});
