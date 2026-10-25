/**
 * Diff-gap tests for the settings surfaces and the two services beside them.
 *
 * Each block covers a branch the sibling suites reach around rather than through: a store that is
 * not there, a lazy import that refuses, a control that parked its own failure, the pane host's two
 * draw guards, and the one thing `write_file` cannot pre-validate — the disk saying no.
 *
 * `section-registry` is mocked for one of them, and only one of its exports is replaced:
 * `onSettingsDocumentChanged` hands the listener to the test and returns an unsubscribe that does
 * nothing, so a change notification can be delivered to an editor that has already been disposed.
 * The real unsubscribe makes that state unreachable; the guard in `draw` is what would catch it if
 * it ever became reachable again, and this is the only way to prove it still holds.
 *
 * Everything else is the real module, spread through — the registry's `sections` map is shared, so
 * a section registered here is the section the pane host renders.
 */
import { flush, installMockPlatform, pointer, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { nothing, render } from "lit-html";
import { createToolRegistry } from "@jxsuite/ai";
import { problems, resetNotifications } from "../src/services/notify";
import { fileTurn, resetAiWrites, writesForTurn } from "../src/services/ai-writes";
import { recordingContext } from "./harness/recording-context";
import { clearStudioStorage } from "../src/services/profile";
import { closeAllTabs, setWorkspaceProject } from "../src/workspace/workspace";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";

import type { ProjectToolsCtx } from "../src/services/ai-project-tools";

const registry = await import("../src/settings/section-registry");

/** Every listener the pane host subscribed with, in subscription order. */
const paneListeners: (() => void)[] = [];

void mock.module("../src/settings/section-registry", () => ({
  ...registry,
  onSettingsDocumentChanged: (listener: () => void) => {
    paneListeners.push(listener);
    return () => {};
  },
}));

const { renderCssVarsEditor } = await import("../src/settings/css-vars-editor");
const { contextsError, renderContextsSection } = await import("../src/settings/contexts-section");
const { mountSettingsPane } = await import("../src/panels/settings-pane");
const { registerProjectTools } = await import("../src/services/ai-project-tools");

// ─── services/profile.ts — a profile with no store to clear ──────────────────

describe("clearStudioStorage without a Storage", () => {
  test("reports nothing removed instead of dereferencing an absent store", () => {
    localStorage.setItem("jx-studio-panel-widths", '{"left":400}');
    localStorage.setItem("theme", "dark");

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });
    let removed: string[];
    try {
      removed = clearStudioStorage();
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "localStorage", descriptor);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }

    expect(removed).toEqual([]);
    // Nothing was reached, so nothing was cleared — the guard is a refusal, not a silent success.
    expect(localStorage.getItem("jx-studio-panel-widths")).toBe('{"left":400}');

    // And with the store back, the same call does the job the guard skipped.
    expect(clearStudioStorage()).toEqual(["jx-studio-panel-widths"]);
    expect(localStorage.getItem("jx-studio-panel-widths")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    localStorage.clear();
  });
});

// ─── settings/contexts-section.ts — the parked failure, read back ────────────

describe("contextsError", () => {
  /*
   * The section is a Jx document, so the container has to be IN the page — a kit element renders in
   * `connectedCallback` and a detached one is an empty tag — and the mount has to be awaited before
   * there is a control to refuse anything.
   */
  test("is null until a control refuses, then names the control and the reason", async () => {
    installMockPlatform();
    resetStudioState({ projectConfig: { $media: { "--": "1280px" } } });
    const container = document.createElement("div");
    document.body.append(container);
    renderContextsSection(container);
    await flush(8);

    expect(contextsError(container)).toBeNull();

    const base = container.querySelector('[data-context="base"] [part="input"]');
    if (!(base instanceof HTMLInputElement)) {
      throw new TypeError("the base context row rendered no input");
    }
    base.value = "wide";
    base.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(4);

    expect(contextsError(container)).toEqual({
      message: "Enter a width in pixels, like 1280px.",
      target: "base",
    });
    expect(container.querySelector('[part="row-error"]')?.textContent.trim()).toBe(
      "Enter a width in pixels, like 1280px.",
    );

    // Keyed by container, so a second mount has its own failure state rather than this one.
    const other = document.createElement("div");
    document.body.append(other);
    renderContextsSection(other);
    await flush(8);
    expect(contextsError(other)).toBeNull();

    container.remove();
    other.remove();
  });
});

// ─── settings/css-vars-editor.ts — "Manage contexts…" that cannot navigate ───

describe("css vars — Manage contexts when Settings refuses to open", () => {
  test("files a Problem naming the failure instead of dropping it", async () => {
    installMockPlatform();
    /* The link runs `settings.open { section: "contexts" }` through the registry, because the
       editor is hosted outside Settings; a record that throws is what a broken command looks like
       to it, and the refusal is filed under the editor's surface name. */
    const commands = createCommandRegistry({ getContext: emptyContext });
    const asked: unknown[] = [];
    commands.registerAll([
      {
        category: "Project",
        id: "settings.open",
        level: "application",
        menus: ["palette"],
        run: (_ctx, args) => {
          asked.push(args);
          throw new RangeError("chunk load failed");
        },
        title: "Open Project Settings",
      },
    ]);
    setActiveRegistry(commands);
    resetStudioState({
      projectConfig: {
        $media: { "--sm": "(max-width: 600px)" },
        style: { "--color-primary": "#007acc" },
      },
    });
    resetNotifications();

    const container = document.createElement("div");
    renderCssVarsEditor(container);
    // A document now, so its content lands a turn later; the footer link is `[part="manage"]`.
    await flush(2);
    const link = container.querySelector('[part="manage"]');
    expect(link).not.toBeNull();

    pointer(link!, "click");
    await flush(4);

    expect(asked).toEqual([{ section: "contexts" }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toBe("chunk load failed");
    // Filed under the workspace the editor lives in, as the Variables view's own button files it.
    expect(problems[0]!.source).toBe("Styles");
    expect(problems[0]!.severity).toBe("error");
    resetNotifications();
    setActiveRegistry(null);
  });
});

// ─── panels/settings-pane.ts — the guards in draw() ──────────────────────────

describe("the settings editor's draw guards", () => {
  let host: HTMLElement;
  let renders = 0;
  let pane: { dispose: () => void } | null = null;

  beforeEach(() => {
    installMockPlatform();
    resetStudioState({ projectConfig: {} });
    paneListeners.length = 0;
    renders = 0;
    registry.resetSettingsDocumentState();
    registry.registerSettingsSection({
      key: "gapsOnly",
      label: "Gaps Only",
      order: 10,
      render: (el) => {
        renders += 1;
        el.textContent = `render ${renders}`;
      },
    });
    host = document.createElement("div");
  });

  afterEach(() => {
    pane?.dispose();
    pane = null;
    registry.unregisterSettingsSection("gapsOnly");
    registry.resetSettingsDocumentState();
  });

  /**
   * Mount the editor and let its chrome land.
   *
   * The chrome is a document (`surfaces/settings-pane.json`), so the island a section renders into
   * does not exist until the mount settles: the pass that reaches a section renderer is the one the
   * mount's own `ready` schedules.
   */
  async function mount(): Promise<void> {
    pane = mountSettingsPane(host, { openMoved: () => {} });
    await flush(3);
  }

  /** The island a section is drawn into, addressed by `part` rather than by a class. */
  function body(): HTMLElement | null {
    return host.querySelector('[part="section-host"]');
  }

  test("a change notification for a disposed editor is a no-op, not a null dereference", async () => {
    await mount();
    expect(renders).toBe(1);

    pane!.dispose();
    /* The unsubscribe is stubbed in this file, so the listener outlives its panel — the state the
       guard exists for. It must draw nothing rather than reach through the missing record. */
    paneListeners[0]!();
    await flush();

    expect(renders).toBe(1);
  });

  test("a change redraws the section into the SAME host, so a half-typed field keeps its caret", async () => {
    await mount();
    expect(renders).toBe(1);
    const sectionHost = body()!.firstElementChild;

    /* The registry announcing a change draws with `force`; the section is the same one, so its
       renderer runs again into the element it drew into last time rather than a fresh one. */
    paneListeners[0]!();
    await flush();

    expect(renders).toBe(2);
    expect(body()?.textContent).toBe("render 2");
    expect(body()!.firstElementChild).toBe(sectionHost);
  });

  test("disposing takes the chrome down, and the editor re-mounts cleanly afterwards", async () => {
    await mount();
    expect(renders).toBe(1);

    /* What closing the dialog does: dispose the editor, then the dialog removes the slot that held
       it. Nothing of the old editor survives to be re-used. */
    pane!.dispose();
    render(nothing, host);
    await flush();

    expect(body()).toBeNull();
    expect(renders).toBe(1);

    // Re-mountable afterwards, which is what "tore down cleanly" has to mean.
    await mount();
    expect(renders).toBe(2);
    expect(body()?.textContent).toBe("render 2");
  });
});

// ─── services/ai-project-tools.ts — the disk refusing the write ──────────────

describe("ai-project-tools — write_file when the disk refuses", () => {
  function harness(writeFile: (path: string, content: string) => Promise<void>) {
    installMockPlatform({ writeFile });
    const tools = createToolRegistry();
    const ctx: ProjectToolsCtx = {
      adoptProject: async () => {},
      findOpenTab: () => null,
      reloadTab: async () => {},
      validate: async () => [],
    };
    registerProjectTools(tools, ctx);
    return tools;
  }

  beforeEach(() => {
    closeAllTabs();
    setWorkspaceProject(null);
    resetAiWrites();
  });

  test("reports the path and the reason, and records a failed disk write in the ledger", async () => {
    const tools = harness(() => Promise.reject(new Error("EACCES: permission denied")));
    const turn1Call = recordingContext();

    const res = await tools.execute(
      "write_file",
      { content: "hello", path: "data/notes.txt" },
      turn1Call,
    );
    const recorded = fileTurn("msg-1", turn1Call.ledger.writes);

    expect(res.success).toBe(false);
    expect(res.error).toBe('Failed to write "data/notes.txt": EACCES: permission denied');
    expect(res.summary).toBeUndefined();
    /* The panel renders the ledger, not the model-facing prose (ai.md §3.2) — so a write that
       failed is a listed attempt that changed nothing, with the reason attached. */
    expect(recorded).toEqual([
      {
        disk: true,
        error: "EACCES: permission denied",
        ok: false,
        path: "data/notes.txt",
        tool: "write_file",
      },
    ]);
    expect(writesForTurn("msg-1")).toEqual(recorded);
  });

  test("a rejection that is not an Error is stringified rather than reported as an object", async () => {
    // A platform adapter can reject with anything; a bare string is the shape this case is about.
    const notAnError = "quota exceeded";
    const tools = harness(() => Promise.reject(notAnError));
    const turn2Call = recordingContext();

    const res = await tools.execute(
      "write_file",
      { content: "hello", path: "data/other.txt" },
      turn2Call,
    );
    const recorded = fileTurn("msg-2", turn2Call.ledger.writes);

    expect(res.error).toBe('Failed to write "data/other.txt": quota exceeded');
    expect(recorded[0]?.error).toBe("quota exceeded");
  });
});
