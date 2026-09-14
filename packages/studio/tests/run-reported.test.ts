/**
 * `commands/run-reported.ts` — the one place a surface's `registry.run` refusal goes.
 *
 * Two halves. The first is the helper against a FAKE registry: both refusal shapes (a synchronous
 * throw, which is what a coercion refusal or a closed gate is since #323, and a rejection) land in
 * Problems, a success settles quietly, and the returned promise never rejects. The second is one
 * call site per DISTINCT shape issue 333 names — a notice's recovery action in Problems, a
 * keybinding, a surface button — each proving that a refusal reaches Problems rather than the
 * console or the keydown listener. `tests/commandbar.test.ts` is another workstream's file this
 * wave, so the surface-button shape is the status bar's.
 *
 * Every call-site registry declares a record whose `args` schema REQUIRES a key the surface cannot
 * supply — a chord runs with `{}`, a status-bar item with its declared args, a notice with whatever
 * `actionArgs` it was filed with — so the refusal is `coerceArgs`'s own sentence, thrown before
 * `run` is entered. That is the shape a `.catch` on the promise never saw.
 *
 * A third half, the sweep: `packages/studio/src` is walked for any `.run(` on a registry that is
 * not one of the two helper spellings, so the drift the issue names cannot grow back in a new
 * surface. The two callers that own their refusal are named, and the `?.run(` spelling the issue
 * did not list is a ratchet — each file named still holds a bare call, and drops out when it
 * stops.
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runActiveReported, runReported } from "../src/commands/run-reported";
import { createCommandRegistry } from "../src/commands/registry";
import { argsSchema, stringProperty } from "../src/commands/command-args";
import { makeContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { notify, problems, resetNotifications, toasts } from "../src/services/notify";
import { getPanel, resetPanels } from "../src/panels/panel-registry";
import { registerProblemsPanel } from "../src/panels/problems-panel";
import { initShellRefs, setProjectState, statusbarEl } from "../src/store";
import { mountStatusbar, renderStatusbar, unmountStatusbar } from "../src/surfaces/statusbar";
import { resetProjectShell } from "../src/shell";
import { closeAllTabs } from "../src/workspace/workspace";
import type { CommandContext } from "../src/commands/context";
import type { AnyCommand, CommandRegistry } from "../src/commands/registry";
import type { NavigatorPanelContext } from "../src/panels/panel-registry";

/* The file opener, doubled, for the same reason `tests/problems-panel.test.ts` doubles it: a path
   button hands off to `files/files.ts` through a lazy import, and the real module would reach the
   platform and file a Problem of its own into whichever test is running by then. */
void mock.module("../src/files/files.js", () => ({
  openFileInTab: () => Promise.resolve(),
}));

/** A registry the helper can be handed: only `run` is read, so only `run` is real. */
function fakeRegistry(run: CommandRegistry["run"]): CommandRegistry {
  return { run } as CommandRegistry;
}

/** `[source, message]` per Problems row, in filing order. */
const filed = () => problems.map((record) => [record.source, record.message]);

beforeEach(() => {
  resetNotifications();
});

// ─── The helper ───────────────────────────────────────────────────────────────

describe("runReported", () => {
  test("a synchronous refusal is filed in Problems, and does not throw", async () => {
    const registry = fakeRegistry(() => {
      throw new RangeError(
        'command "x.y" argument "name": expected a non-empty string, got missing',
      );
    });
    let settled = false;
    const promise = runReported(registry, "x.y", {}, "Palette");
    // The refusal is filed BEFORE the promise is even awaited — it happened synchronously.
    expect(filed()).toEqual([
      ["Palette", 'command "x.y" argument "name": expected a non-empty string, got missing'],
    ]);
    await promise.then(() => {
      settled = true;
    });
    expect(settled).toBe(true);
    expect(toasts).toHaveLength(0);
  });

  test("a rejection is filed in Problems, and the promise resolves", async () => {
    const registry = fakeRegistry(() =>
      Promise.reject(new Error("pages/fr/a.json already exists")),
    );
    const outcome = await runReported(registry, "i18n.createTranslation", {}, "Languages").then(
      () => "resolved",
      () => "rejected",
    );
    expect(outcome).toBe("resolved");
    expect(filed()).toEqual([["Languages", "pages/fr/a.json already exists"]]);
  });

  test("a success settles with nothing filed, whether run is sync or async", async () => {
    const calls: [string, unknown][] = [];
    const sync = fakeRegistry((id, args) => {
      calls.push([id, args]);
    });
    const async_ = fakeRegistry((id, args) => {
      calls.push([id, args]);
      return Promise.resolve();
    });
    await runReported(sync, "a.b", { n: 1 });
    await runReported(async_, "c.d");
    expect(calls).toEqual([
      ["a.b", { n: 1 }],
      ["c.d", undefined],
    ]);
    expect(problems).toHaveLength(0);
  });

  test("the row is keyed by the command, so a refusal repeated is one problem", async () => {
    const registry = fakeRegistry(() => {
      throw new RangeError("no");
    });
    await runReported(registry, "x.y", {}, "Keyboard");
    await runReported(registry, "x.y", {}, "Keyboard");
    await runReported(registry, "x.z", {}, "Keyboard");
    expect(problems.map((record) => record.key)).toEqual(["command.run:x.y", "command.run:x.z"]);
  });

  test("the source defaults to the command id — what the Settings menu filed under", async () => {
    const registry = fakeRegistry(() => {
      throw new RangeError("closed");
    });
    await runReported(registry, "settings.open");
    expect(filed()).toEqual([["settings.open", "closed"]]);
  });

  test("a refusal is quiet on the console; a crash keeps its stack there as well", async () => {
    const seen: unknown[][] = [];
    const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      seen.push(args);
    });
    try {
      // The two refusal shapes: `coerceArgs`'s RangeError, and the gate's CommandUnavailableError
      // (by the name its constructor sets, which is how the helper tells it apart).
      const gate = new Error("closed");
      gate.name = "CommandUnavailableError";
      await runReported(
        fakeRegistry(() => {
          throw new RangeError("no");
        }),
        "a.b",
      );
      await runReported(
        fakeRegistry(() => {
          throw gate;
        }),
        "c.d",
      );
      expect(seen).toEqual([]);
      // A bug in a `run` body: the row still names it, and the error object reaches the console.
      const bug = new TypeError("Cannot read properties of null");
      await runReported(
        fakeRegistry(() => Promise.reject(bug)),
        "e.f",
        undefined,
        "Palette",
      );
      expect(seen).toEqual([['Palette: command "e.f" failed', bug]]);
      expect(filed()).toEqual([
        ["a.b", "no"],
        ["c.d", "closed"],
        ["Palette", "Cannot read properties of null"],
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("runActiveReported", () => {
  afterEach(() => {
    setActiveRegistry(null);
  });

  test("resolves silently before a registry is published, as the `?.` did", async () => {
    setActiveRegistry(null);
    const outcome = await runActiveReported("x.y", { n: 1 }, "Tabs").then(() => "resolved");
    expect(outcome).toBe("resolved");
    expect(problems).toHaveLength(0);
  });

  test("runs the published registry, and files its refusal under the given source", async () => {
    const registry = createCommandRegistry({ getContext: () => makeContext() });
    registry.register(requiresName("x.y"));
    setActiveRegistry(registry);
    await runActiveReported("x.y", {}, "Tabs");
    expect(filed()).toEqual([
      ["Tabs", 'command "x.y" argument "name": expected a non-empty string, got missing'],
    ]);
  });
});

// ─── The sweep ────────────────────────────────────────────────────────────────

/**
 * The two callers that read the refusal themselves: the automation harness hands it to the script,
 * the tool loop hands it to the model. Neither is a surface, so neither files it.
 */
const OWNS_ITS_REFUSAL = new Set([
  "commands/run-reported.ts",
  "services/ai-command-tools.ts",
  "services/automation.ts",
]);

/**
 * Files still spelling a run bare — the `activeRegistry()?.run(id, args)` and `registry?.run` forms
 * issue 333 did not list, and the context menu's own registry. A RATCHET: an entry is asserted to
 * still hold a bare call, so converting a file means removing its line here, and a file not named
 * cannot take the spelling up.
 */
const NOT_YET_CONVERTED = new Set([
  "canvas/canvas-render.ts",
  "canvas/iframe-host.ts",
  "content/entry-editor.ts",
  "editor/context-menu.ts",
  "panels/frontmatter-panel.ts",
  "panels/head-panel.ts",
  "panels/pane-context.ts",
  "panels/properties-panel.ts",
  "panels/seo-modal.ts",
  "panels/style-panel.ts",
  "publish/deploy-checklist.ts",
  "publish/publish-panel.ts",
  "settings/general-settings.ts",
]);

/** `registry.run(`, `registry?.run(`, `activeRegistry()?.run(`, `contextMenuRegistry().run(`. */
const BARE_RUN = /\b\w*[rR]egistry(?:\(\))?\??\.run\(/;

/** The source with its comments blanked, so a sentence quoting the spelling is not a hit. */
function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

describe("no surface runs a command bare", () => {
  const srcDir = join(import.meta.dir, "..", "src");
  const bare = new Set<string>();
  for (const rel of new Bun.Glob("**/*.ts").scanSync({ cwd: srcDir, dot: false })) {
    const source = readFileSync(join(srcDir, rel), "utf8");
    if (BARE_RUN.test(withoutComments(source))) {
      bare.add(rel);
    }
  }

  test("every bare `.run(` on a registry is an owner of its refusal, or on the ratchet", () => {
    const unexplained = [...bare].filter(
      (rel) => !OWNS_ITS_REFUSAL.has(rel) && !NOT_YET_CONVERTED.has(rel),
    );
    expect(unexplained).toEqual([]);
  });

  test("the ratchet names only files that still spell it bare, and the owners do too", () => {
    const stale = [...NOT_YET_CONVERTED, ...OWNS_ITS_REFUSAL].filter((rel) => !bare.has(rel));
    expect(stale).toEqual([]);
  });
});

// ─── A keybinding ─────────────────────────────────────────────────────────────

/** A record whose schema requires `name`, so a chord's `{}` is refused before `run`. */
function requiresName(id: string, extra: Partial<AnyCommand> = {}): AnyCommand {
  return {
    args: argsSchema({ name: stringProperty("A name.") }),
    category: "File",
    id,
    level: "application",
    run: () => {},
    title: "Needs a name",
    ...extra,
  } as AnyCommand;
}

describe("a keybinding whose record refuses its arguments", () => {
  test("handleKeyEvent claims the chord, files the refusal, and throws nothing", () => {
    const registry = createCommandRegistry({ getContext: () => makeContext(), mac: true });
    registry.register(requiresName("file.needsName", { keybinding: "mod+s" }));
    const press = { altKey: false, ctrlKey: false, key: "s", metaKey: true, shiftKey: false };
    expect(registry.handleKeyEvent(press, ["global"])).toBe("file.needsName");
    expect(filed()).toEqual([
      [
        "Keyboard",
        'command "file.needsName" argument "name": expected a non-empty string, got missing',
      ],
    ]);
  });

  test("a rejection out of a keybound run is filed too, rather than left unhandled", async () => {
    const registry = createCommandRegistry({ getContext: () => makeContext(), mac: true });
    registry.register({
      category: "File",
      id: "file.rejects",
      keybinding: "mod+s",
      level: "application",
      run: () => Promise.reject(new Error("the disk said no")),
      title: "Rejects",
    } as AnyCommand);
    const press = { altKey: false, ctrlKey: false, key: "s", metaKey: true, shiftKey: false };
    expect(registry.handleKeyEvent(press, ["global"])).toBe("file.rejects");
    await flush();
    expect(filed()).toEqual([["Keyboard", "the disk said no"]]);
  });
});

// ─── A notice's recovery action, from Problems ────────────────────────────────

/** What the Bottom dock hands a tab: no deps, no document — Problems is a project-level list. */
const PANEL_CTX: NavigatorPanelContext = {
  deps: {} as never,
  doc: null,
  rerender: () => {},
};

describe("a notice's recovery action, clicked in Problems", () => {
  let host: HTMLElement;
  let ctx: CommandContext;

  beforeEach(() => {
    installMockPlatform();
    resetPanels();
    ctx = makeContext({ document: { open: true } });
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.register(requiresName("file.save", { title: "Save" }));
    setActiveRegistry(registry);
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(async () => {
    // Twice, as `tests/problems-panel.test.ts` explains: the first consumes the "dock drew me" mark,
    // The second is the take-down.
    const panel = getPanel("problems");
    panel?.afterRender?.(PANEL_CTX, host);
    panel?.afterRender?.(PANEL_CTX, host);
    await flush(2);
    host.remove();
    resetPanels();
    setActiveRegistry(null);
  });

  test("the refusal is a new row in the same list, not an exception out of the button", async () => {
    // Filed with `actionArgs` the record's schema does not admit — the drift #323 fixed at two
    // Sources, and the shape any future notify site can reproduce.
    notify.error("Save failed", { action: "file.save", actionArgs: { path: "a.md" } });
    registerProblemsPanel();
    const panel = getPanel("problems")!;
    panel.render(PANEL_CTX);
    panel.afterRender?.(PANEL_CTX, host);
    await flush(4);
    const control = host.querySelector('[part="action"] [part="control"]') as HTMLElement;
    expect(control).not.toBeNull();
    expect(() => control.click()).not.toThrow();
    await flush();
    expect(filed()).toEqual([
      [undefined, "Save failed"],
      ["Problems", 'command "file.save" argument "path": not declared — declared: name'],
    ]);
  });
});

// ─── A surface button ─────────────────────────────────────────────────────────

describe("a surface button whose record refuses its arguments", () => {
  beforeAll(() => {
    const bar = document.createElement("div");
    bar.id = "statusbar";
    document.body.append(bar);
    initShellRefs();
  });

  beforeEach(() => {
    closeAllTabs();
    setProjectState(null as never);
    resetProjectShell();
  });

  afterEach(async () => {
    unmountStatusbar();
    setActiveRegistry(null);
    await flush();
  });

  test("the status bar's project name files the refusal under its own name", async () => {
    const registry = createCommandRegistry({ getContext: () => makeContext() });
    // The item runs `project.openRecent` with `{}`; a schema that requires `name` refuses that.
    registry.register(requiresName("project.openRecent", { level: "project" }));
    setActiveRegistry(registry);
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    mountStatusbar();
    renderStatusbar();
    await flush(2);
    const button = statusbarEl
      .querySelector('[data-jx-region="statusbar/project"]')
      ?.querySelector("button") as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe("My Site");
    expect(() => button.click()).not.toThrow();
    await flush();
    expect(filed()).toEqual([
      [
        "Status Bar",
        'command "project.openRecent" argument "name": expected a non-empty string, got missing',
      ],
    ]);
  });
});
