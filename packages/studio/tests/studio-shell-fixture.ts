/**
 * Studio shell boot fixture (C7) — shared by the studio-shell-project-url*.test.ts files.
 *
 * Studio.ts reads location.search once at import time, so each URL scenario needs its own test
 * process (bun test --isolate). This fixture centralizes the global stubs, shell DOM scaffold,
 * leaf-module mocks, and the mocked statusbar message log, then imports src/studio.ts with the
 * requested URL and platform behavior.
 */
import { flush, installMockPlatform } from "./harness";
import { mountShellTree } from "../src/shell/tree";
import { mock } from "bun:test";
import { notifyModule } from "./notify-mock";
import { nothing } from "lit-html";
import type { InstalledMockPlatform } from "./harness";
import type { StudioPlatform } from "../src/types";
import type { initBlockActionBar } from "../src/panels/block-action-bar";
import type { initCanvasRender } from "../src/canvas/canvas-render";
import type { mount } from "../src/surfaces/commandbar";
import type { CommandRegistry } from "../src/commands/registry";
import type { JxPath } from "../src/state";
import type { StageContext } from "../src/editor/shortcuts";
import type { initWelcome } from "../src/surfaces/welcome";

/** Statusbar messages captured by the mocked statusbar module. */
export const statusMessages: string[] = [];

/** The contexts studio.ts hands the mocked surfaces at boot, as each real module declares them. */
export interface CapturedBootContexts {
  toolbarCtx: Parameters<typeof mount>[1] | null;
  welcomeCtx: Parameters<typeof initWelcome>[0] | null;
  blockBarCtx: Parameters<typeof initBlockActionBar>[0] | null;
  canvasRenderCtx: Parameters<typeof initCanvasRender>[0] | null;
  shortcutsGet: StageContext | null;
}

export const captured: CapturedBootContexts = {
  blockBarCtx: null,
  canvasRenderCtx: null,
  shortcutsGet: null,
  toolbarCtx: null,
  welcomeCtx: null,
};

export const scheduleCanvasRenderMock = mock(() => {});

/** Poll until cond() is true (bounded), flushing microtasks between checks. */
export async function waitFor(cond: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries && !cond(); i++) {
    await flush(1);
  }
}

/**
 * Stub globals, scaffold the shell DOM, mock the heavy leaf modules, register an in-memory
 * platform, then import src/studio.ts under the given URL.
 */
export async function bootStudio(opts: {
  url: string;
  overrides?: Partial<StudioPlatform>;
  seedFiles?: Record<string, string>;
}): Promise<InstalledMockPlatform> {
  /* SAFETY: @happy-dom/global-registrator (loaded by ./harness) copies the window's members onto
     globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
  const { happyDOM } = globalThis as typeof globalThis & {
    happyDOM: { setURL: (url: string) => void };
  };
  happyDOM.setURL(opts.url);

  // The global registrator points `window` at globalThis, so these land on the globals boot reads.
  window.requestIdleCallback = (cb) =>
    window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
  window.cancelIdleCallback = (id) => window.clearTimeout(id);

  const noop = () => {
    /* Stub */
  };
  class StubEventSource {
    url: string;
    onmessage: EventSource["onmessage"] = null;
    onerror: EventSource["onerror"] = null;
    addEventListener: EventTarget["addEventListener"] = noop;
    removeEventListener: EventTarget["removeEventListener"] = noop;
    close = noop;
    constructor(url: string) {
      this.url = url;
    }
  }
  /* SAFETY: the only `new EventSource` in src is devserver.ts's subscribeFileEvents, which calls
     addEventListener and close on the instance; the stub carries both as no-ops and never dispatches,
     so the readyState and CONNECTING/OPEN/CLOSED members it lacks are never read. */
  window.EventSource = StubEventSource as typeof EventSource;
  // Keeping Bun's `preconnect` makes the stub a whole `fetch`.
  globalThis.fetch = Object.assign(
    mock(async () => new Response("{}", { status: 404 })),
    { preconnect: globalThis.fetch.preconnect },
  );

  /* The real frame, not a description of one. This fixture used to paste its own copy, and that
     copy had lost `#resize-bottom`, `#bottom-dock` and `#layer-toast` — so every shell-boot test
     that shares this file ran against a shell with no bottom dock and no toast host, and no test
     could report it because the fixture WAS the thing under test.
     src/studio.ts mounts the frame itself at boot, so this is belt and braces for the assertions
     that run before the import; both go through the one definition. */
  await mountShellTree();

  void mock.module("../src/services/monaco-setup.js", () => ({}));

  void mock.module("monaco-editor/editor", () => ({
    KeyCode: {},
    KeyMod: {},
    MarkerSeverity: { Error: 8, Warning: 4 },
    Uri: { parse: (u: string) => ({ toString: () => u }) },
    editor: { setModelMarkers: mock(() => {}) },
    languages: {
      CompletionItemKind: { Function: 1, Property: 9, Variable: 4 },
      registerCompletionItemProvider: mock(() => ({ dispose: noop })),
    },
  }));

  void mock.module("../src/surfaces/statusbar.ts", () => ({
    mountStatusbar: mock(() => {}),
    renderStatusbar: mock(() => {}),
    unmountStatusbar: mock(() => {}),
  }));

  // Outcomes reach `notify` now; the fixture collects the SENTENCE each one reports.
  void mock.module("../src/services/notify.ts", () =>
    notifyModule((call) => statusMessages.push(call.message)),
  );

  void mock.module("../src/surfaces/commandbar.ts", () => ({
    mount: (_el: HTMLElement, ctx: CapturedBootContexts["toolbarCtx"]) => {
      captured.toolbarCtx = ctx;
    },
    render: mock(() => {}),
    unmount: mock(() => {}),
  }));

  void mock.module("../src/surfaces/welcome.ts", () => ({
    initWelcome: (ctx: CapturedBootContexts["welcomeCtx"]) => {
      captured.welcomeCtx = ctx;
    },
    renderWelcome: mock(() => {}),
  }));

  void mock.module("../src/editor/shortcuts.ts", () => ({
    // The registry is the first argument now; the STAGE-context reader is the second — it takes a
    // Surface, because a wheel belongs to the stage the pointer is over rather than to the pane
    // The keyboard is in.
    initShortcuts: (_registry: CommandRegistry, get: StageContext) => {
      captured.shortcutsGet = get;
    },
    // `panels/pane-grid.ts` installs one disposer per cell it builds, so the mock has to carry it
    // Or the boot fails at import time.
    installStageGestures: () => () => {},
    registerStudioCommands: mock(() => {}),
  }));

  void mock.module("../src/panels/block-action-bar.ts", () => ({
    // The bar owns the selection command records, so `panels/layers-panel.ts` imports its verb
    // Rendering from here too: a mock that stops at the bar's own five exports fails the boot at
    // Import time ("Export named 'commandIcon' not found"). The registry stub places nothing, so
    // The row-rendering helpers below are never reached — they exist to satisfy the import.
    commandIcon: mock(() => nothing),
    commandTooltip: mock(() => ""),
    dismissBlockActionBar: mock(() => {}),
    dismissLinkPopover: mock(() => {}),
    initBlockActionBar: (ctx: CapturedBootContexts["blockBarCtx"]) => {
      captured.blockBarCtx = ctx;
    },
    // The inline-format family. The bootstrap composes it into the app-wide registry beside the
    // Structural verbs below — a mock without it fails the boot at import time, which is the same
    // Lesson the `commandIcon` note above records: this stub tracks the module's EXPORTS, not the
    // Subset one caller happens to use.
    formatCommands: mock(() => []),
    isEditChromeTarget: mock(() => false),
    // The bootstrap composes the bar's structural selection verbs into the app-wide registry so
    // The palette, the keyboard and `__jxAutomation` can reach them (§13.5).
    registerSelectionCommands: mock(() => {}),
    releaseBlockActionBar: mock(() => {}),
    renderBlockActionBar: mock(() => {}),
    runCommand: mock(() => {}),
    selectionCommandRegistry: () => ({
      disabledReason: () => {},
      forPlacement: () => [],
      keymap: { formatBinding: () => {} },
    }),
    showCommandOverflow: mock(() => {}),
    suppressBlockActionBar: mock(() => {}),
    withCommandTarget: <T>(_path: JxPath, fn: () => T) => fn(),
  }));

  void mock.module("../src/canvas/canvas-render.ts", () => ({
    handOverCanvasStage: mock(() => {}),
    initCanvasRender: (ctx: CapturedBootContexts["canvasRenderCtx"]) => {
      captured.canvasRenderCtx = ctx;
    },
    redefineElementOnCanvases: mock(() => 0),
    registerSelectionSetCommand: mock(() => {}),
    renderCanvas: mock(() => {}),
    renderOverlays: mock(() => {}),
    scheduleCanvasRender: scheduleCanvasRenderMock,
  }));

  void mock.module("../src/canvas/canvas-patcher.ts", () => ({
    applyPatchBatch: mock(() => {}),
    classifyOps: mock(() => ({ patchable: false, reason: "mock" })),
    consumePatchedDocument: mock(() => false),
    escalateToFullRender: mock(() => {}),
    initCanvasPatcher: mock(() => {}),
  }));

  const { platform, state } = installMockPlatform(opts.overrides ?? {}, opts.seedFiles ?? {});

  await import("../src/studio");
  await flush();

  return { platform, state };
}
