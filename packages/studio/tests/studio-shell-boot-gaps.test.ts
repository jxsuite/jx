/**
 * Studio shell boot gaps — booting with NO pre-registered platform (the dev-server PAL fallback),
 * the idle-time css-props datalist guard when the datalist is gone, and the files tab drawn through
 * the left panel's `renderOnly` wiring. Uses its own boot replica instead of bootStudio because
 * both gaps need control the fixture deliberately hides: a captured (not auto-run)
 * requestIdleCallback queue and an import with no platform installed.
 */
import { flush, installMockPlatform } from "./harness";
import { expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import { nothing } from "lit-html";
import { hasPlatform, getPlatform } from "../src/platform";
import { renderOnly, setProjectState } from "../src/store";
import { shell } from "../src/shell";
import type { PaneContextCtx } from "../src/panels/pane-context";
import type { JxPath } from "../src/state";
import type { Tab } from "../src/tabs/tab";

/* SAFETY: @happy-dom/global-registrator (loaded by ./harness) copies the window's members onto
   globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (url: string) => void };
};
happyDOM.setURL("http://localhost:3000/");

// Captured idle callbacks — NOT auto-run, so the test controls when the datalist filler fires.
// The global registrator points `window` at globalThis, so these land on the globals boot reads.
const idleCallbacks: (() => void)[] = [];
window.requestIdleCallback = (cb) => {
  idleCallbacks.push(() => cb({ didTimeout: false, timeRemaining: () => 50 }));
  return idleCallbacks.length;
};
window.cancelIdleCallback = () => {};

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
/* SAFETY: the only `new EventSource` in src is devserver.ts's subscribeFileEvents (the PAL this boot
   falls back to), which calls addEventListener and close on the instance; the stub carries both as
   no-ops and never dispatches, so the readyState and CONNECTING/OPEN/CLOSED members it lacks are
   never read. */
window.EventSource = StubEventSource as typeof EventSource;
// Keeping Bun's `preconnect` makes the stub a whole `fetch`.
globalThis.fetch = Object.assign(
  mock(async () => new Response("{}", { status: 404 })),
  { preconnect: globalThis.fetch.preconnect },
);

document.body.innerHTML = `
  <div id="app">
    <div id="toolbar"></div>
    <div id="tab-strip"></div>
    <div id="activity-bar"></div>
    <div id="left-panel"></div>
    <div id="resize-left" class="resize-handle"></div>
    <div class="pane-stage" data-jx-region="pane.primary"></div>
    <div id="resize-right" class="resize-handle"></div>
    <div id="right-panel"></div>
    <div id="statusbar"></div>
  </div>
  <div id="layer-popover"></div>
  <div id="layer-modal"></div>
  <div id="layer-dialog"></div>
`;

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

const renderStatusbarMock = mock(() => {});
void mock.module("../src/surfaces/statusbar.ts", () => ({
  mountStatusbar: mock(() => {}),
  renderStatusbar: renderStatusbarMock,
  unmountStatusbar: mock(() => {}),
}));

void mock.module("../src/services/notify.ts", () => notifyModule(() => {}));

void mock.module("../src/surfaces/commandbar.ts", () => ({
  mount: mock(() => {}),
  render: mock(() => {}),
  unmount: mock(() => {}),
}));

void mock.module("../src/surfaces/welcome.ts", () => ({
  initWelcome: mock(() => {}),
  renderWelcome: mock(() => {}),
}));

void mock.module("../src/editor/shortcuts.ts", () => ({
  initShortcuts: mock(() => {}),
  // The grid installs one stage-gesture disposer per cell; without it the boot fails at import.
  installStageGestures: () => () => {},
  registerStudioCommands: mock(() => {}),
}));

// `panels/layers-panel.ts` renders its row verbs from the bar's command records, so this mock has
// To carry them too or the boot fails at import time.
void mock.module("../src/panels/block-action-bar.ts", () => ({
  commandIcon: mock(() => nothing),
  commandTooltip: mock(() => ""),
  dismissBlockActionBar: mock(() => {}),
  dismissLinkPopover: mock(() => {}),
  initBlockActionBar: mock(() => {}),
  // The inline-format family, composed into the app-wide registry by the bootstrap. A mock that
  // Stops at the exports one caller uses fails the boot at IMPORT time.
  formatCommands: mock(() => []),
  isEditChromeTarget: mock(() => false),
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

/* What studio.ts actually hands the bar, which is wider than the bar's own contract: file-ops'
   exportFile is async, and studio's setCanvasMode accepts (and ignores) a null tab. */
interface BootPaneContext extends Omit<PaneContextCtx, "exportFile" | "setCanvasMode"> {
  exportFile: () => Promise<void>;
  setCanvasMode: (tab: Tab | null, mode: string) => void;
}
let paneCtx: BootPaneContext | null = null;
void mock.module("../src/panels/pane-context.ts", () => ({
  // The grid hands every cell its chrome host, so this is on the boot's import graph.
  attachPaneChromeHost: mock(() => {}),
  mount: (_host: HTMLElement, ctx: BootPaneContext) => {
    paneCtx = ctx;
  },
  render: mock(() => {}),
  unmount: mock(() => {}),
}));

void mock.module("../src/canvas/canvas-render.ts", () => ({
  handOverCanvasStage: mock(() => {}),
  initCanvasRender: mock(() => {}),
  redefineElementOnCanvases: mock(() => 0),
  registerSelectionSetCommand: mock(() => {}),
  renderCanvas: mock(() => {}),
  renderOverlays: mock(() => {}),
  scheduleCanvasRender: mock(() => {}),
}));

void mock.module("../src/canvas/canvas-patcher.ts", () => ({
  applyPatchBatch: mock(() => {}),
  classifyOps: mock(() => ({ patchable: false, reason: "mock" })),
  consumePatchedDocument: mock(() => false),
  escalateToFullRender: mock(() => {}),
  initCanvasPatcher: mock(() => {}),
}));

// The gap under test: NO platform is registered before the import, so studio.ts must fall back to
// Registering the dev-server PAL itself.
// Every reader of the slot (hasPlatform, getPlatform) tests it with `!= null`, so clearing it to
// Undefined is the same as deleting it.
globalThis.__jxPlatform = undefined;

await import("../src/studio");
await flush();

const rafTurn = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

test("boot without a platform registers the dev-server PAL", () => {
  expect(hasPlatform()).toBe(true);
  expect(getPlatform().id).toBe("devserver");
});

test("boot builds no datalist, and queues no idle work to fill one", () => {
  /* This asserted that the `#css-props` filler bailed gracefully when its datalist was missing. Its
     subject is gone: BOTH datalists were dead rather than convertible — a datalist is reached only
     through `list="<id>"` on a control, and nothing has carried one since the Inspector's inputs
     became documents, so boot was painting six hundred options into a hidden host for nothing to
     read. The assertion now pins the DELETION, which is the thing a regression would undo: no
     host, and no frame of idle work spent filling one. */
  expect(document.querySelector("#css-props")).toBeNull();
  expect(document.querySelector("#tag-names")).toBeNull();
  expect(idleCallbacks).toHaveLength(0);
});

test("the pane-context bar is wired to the five callbacks it takes", async () => {
  expect(paneCtx).not.toBeNull();
  /* It took four more — `navigateBack`, `navigateToLevel` and the two logic-editor closes — for a
     breadcrumb and a Back this bar no longer draws. `getCanvasMode` is the fifth to go, and it went
     for a different reason: it answered for the FOCUSED pane, and this bar is drawn once per pane.
     What is left is the axes' own wiring, plus the guarded close the Back control of a strip-less
     workspace runs and the hand-off of the keyboard to the home it lands on, and with no active
     tab every one of them is a guarded no-op. */
  expect(Object.keys(paneCtx!).toSorted()).toEqual([
    "closeTab",
    "exportFile",
    "focusHome",
    "parseMediaEntries",
    "setCanvasMode",
  ]);
  // The hand-off with nothing mounted queues for the next mount and throws nothing.
  expect(() => paneCtx!.focusHome?.("primary", "media")).not.toThrow();
  expect(() => paneCtx!.focusHome?.("primary", "publish")).not.toThrow();
  expect(() => paneCtx!.focusHome?.("primary", "styles")).not.toThrow();
  await paneCtx!.exportFile();
  // The write takes its target: no tab, nothing written, and no throw.
  expect(() => paneCtx!.setCanvasMode(null, "edit")).not.toThrow();
});

test("the bootstrap paints the statusbar once, directly", () => {
  // `setStatusbarRenderer` went with `statusMessage`: it existed only so a transient message could
  // Ask the bar to repaint, and the bar's own effect owns that now.
  // One argument-less paint: studio.ts's top-level `renderStatusbar()` is the module's only caller.
  expect(renderStatusbarMock.mock.calls).toEqual([[]]);
});

test("the files tab renders through studio's left-panel wiring", async () => {
  installMockPlatform();
  setProjectState(null);
  shell.leftTab = "files";
  renderOnly("leftPanel");
  await rafTurn();
  await flush();
  const leftPanel = document.querySelector("#left-panel")!;
  expect(leftPanel.textContent).toContain("No project loaded");
});
