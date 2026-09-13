/**
 * Shared test harness for studio tests.
 *
 * Centralizes the DOM bootstrap, lit rendering, project/tab state resets, an in-memory
 * StudioPlatform mock, and happy-dom gap stubs so individual test files don't reinvent them. Import
 * this instead of ./with-dom.js when you need more than the bare DOM:
 *
 * Import { installMockPlatform, renderInto, resetStudioState } from "./harness";
 *
 * Harness rule: treat this file as read-only while a test-writing wave is in flight — extend it
 * between waves, not concurrently from several branches.
 */
import "./with-dom.js";
import { render as litRender, render } from "lit-html";
import type { TemplateResult } from "lit-html";
import { registerPlatform } from "../src/platform";
import { overlayLayers } from "../src/shell/tree";
import { ALL_SETTINGS } from "../src/services/settings/definitions";
import type { SettingDefinition } from "../src/services/settings/definitions";
import { resetSettings, setSettings } from "../src/services/settings/kernel";
import { setProjectState } from "../src/store";
import { resetIgnoreCache } from "../src/files/gitignore";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import {
  allCanvasSurfaces,
  registerCanvasSurface,
  unregisterCanvasSurface,
} from "../src/canvas/surface-registry";
import { REGION_ATTR, paneRegion } from "../src/ui/regions";
import { STAGE_PART } from "../src/surfaces/pane-grid";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { DirEntry, ProjectState, RenameResult, StudioPlatform } from "../src/types";

// ─── Lit rendering ────────────────────────────────────────────────────────────

/** Render a lit template into a detached container and flush microtasks. */
export async function renderInto(
  template: TemplateResult,
  container: HTMLElement = document.createElement("div"),
): Promise<HTMLElement> {
  render(template, container);
  await flush();
  return container;
}

/**
 * Flush pending microtasks (and one macrotask turn) so lit directives and Spectrum components
 * finish their async updates before assertions run.
 */
export async function flush(turns = 2): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

// ─── State resets ─────────────────────────────────────────────────────────────

/**
 * Reset the global project state to a minimal valid shape, with overrides.
 *
 * The `.gitignore` cache goes with it: it is module state keyed by directory, so a suite that
 * seeded ignore rules for `.` would otherwise hand them to the next test in the file, and a tree
 * that hides rows for a reason the test never stated is the hardest kind of failure to read.
 */
export function resetStudioState(overrides: Record<string, unknown> = {}): void {
  resetIgnoreCache();
  setProjectState({
    /* `dirs` is not optional on `ProjectState`, and the default was missing it — which was
       invisible while the Files tree was a lit template the suites mocked, and is a thrown
       `dirs.get of undefined` the moment a suite paints the real panel. Overrides still win. */
    dirs: new Map(),
    expanded: new Set(),
    projectConfig: null,
    ...overrides,
  } as unknown as ProjectState);
}

/**
 * Seed stored settings by key, the way a previous session would have left them.
 *
 * Tests used to write `localStorage.setItem("jx.ai.openaiKey", …)` directly. That stopped working
 * when the settings kernel took ownership: it seeds its Map once at module evaluation, so a later
 * poke at the cache it was built from is invisible. Going through the kernel is also what a test
 * should have been doing — the storage layout is not the contract, the settings are.
 *
 * Unknown keys throw rather than being ignored, so a renamed setting fails the test that seeds it
 * instead of silently seeding nothing.
 */
export function seedSettings(values: Record<string, string>): void {
  const entries = Object.entries(values).map(([settingKey, value]) => {
    const definition = ALL_SETTINGS.find((candidate) => candidate.key === settingKey);
    if (!definition) {
      throw new Error(`seedSettings: no setting is declared with the key "${settingKey}"`);
    }
    return [definition, value] as [SettingDefinition, string];
  });
  setSettings(entries);
}

/** Forget every stored setting. Call between tests that seed. */
export function clearSeededSettings(): void {
  resetSettings();
}

/** Close all tabs and open a fresh one so activeTab.value is populated. */
export function resetWorkspaceWithTab(
  doc?: JxMutableNode,
  opts: { id?: string; documentPath?: string } = {},
) {
  closeAllTabs();
  const document = doc ?? {
    children: [{ tagName: "p", textContent: "Hello" }],
    tagName: "div",
  };
  return openTab({
    document,
    documentPath: opts.documentPath ?? "/project/index.json",
    id: opts.id ?? "test-tab",
  });
}

// ─── Platform mock ────────────────────────────────────────────────────────────

export interface MockPlatformState {
  /** In-memory filesystem: absolute path → file contents. */
  files: Map<string, string>;
  /** Ordered log of platform calls for assertions: [method, ...args]. */
  calls: unknown[][];
}

function dirEntriesFor(files: Map<string, string>, dir: string): DirEntry[] {
  // Root ("" or ".") maps to an empty prefix, matching the real backends (a root listing returns
  // Top-level entries, not a synthetic "/" prefix). Non-root dirs get a trailing-slash prefix.
  const prefix = dir === "" || dir === "." ? "" : dir.endsWith("/") ? dir : `${dir}/`;
  const seen = new Map<string, DirEntry>();
  for (const path of files.keys()) {
    if (!path.startsWith(prefix)) {
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
    } satisfies DirEntry);
  }
  return [...seen.values()];
}

/**
 * Build and register an in-memory StudioPlatform. Every method is overridable; unset git/ai methods
 * resolve with inert defaults. Returns the platform plus its backing state for direct manipulation
 * and call assertions.
 */
export function installMockPlatform(
  overrides: Partial<StudioPlatform> = {},
  seedFiles: Record<string, string> = {},
): { platform: StudioPlatform; state: MockPlatformState } {
  const state: MockPlatformState = {
    calls: [],
    files: new Map(Object.entries(seedFiles)),
  };
  const log =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      state.calls.push([name, ...args]);
      return fn(...args);
    };

  const platform: StudioPlatform = {
    activate: log("activate", async () => {}),
    addPackage: log("addPackage", async () => ({})),
    aiChatUrl: log("aiChatUrl", () => "/__mock/ai/chat"),
    codeService: log("codeService", async () => null),
    createDestination: "path",
    createDirectory: log("createDirectory", async () => {}),
    createProject: log("createProject", async (opts) => ({
      config: { name: opts.name },
      root:
        opts.destination.kind === "path"
          ? `${opts.destination.parent}/${opts.directory}`
          : `${opts.destination.owner}/${opts.destination.repo}`,
    })),
    deleteFile: log("deleteFile", async (path) => {
      state.files.delete(path);
    }),
    discoverComponents: log("discoverComponents", async () => []),
    fetchPluginSchema: log("fetchPluginSchema", async () => null),
    gitAddRemote: log("gitAddRemote", async () => {}),
    gitBranches: log("gitBranches", async () => ({ branches: [], current: "main" }) as never),
    gitCheckout: log("gitCheckout", async () => {}),
    gitCommit: log("gitCommit", async () => {}),
    gitCreateBranch: log("gitCreateBranch", async () => {}),
    gitDiff: log("gitDiff", async () => ""),
    gitDiscard: log("gitDiscard", async () => {}),
    gitFetch: log("gitFetch", async () => {}),
    gitInit: log("gitInit", async () => {}),
    gitLog: log("gitLog", async () => []),
    gitPull: log("gitPull", async () => {}),
    gitPush: log("gitPush", async () => {}),
    gitShow: log("gitShow", async () => ""),
    gitStage: log("gitStage", async () => {}),
    gitStatus: log("gitStatus", async () => ({ files: [] }) as never),
    gitUnstage: log("gitUnstage", async () => {}),
    id: "mock",
    listDirectory: log("listDirectory", async (dir) => dirEntriesFor(state.files, dir)),
    listExtensionCatalog: log("listExtensionCatalog", async () => []),
    listPackages: log("listPackages", async () => []),
    locateFile: log("locateFile", async (name) => {
      for (const path of state.files.keys()) {
        if (path.endsWith(`/${name}`) || path === name) {
          return path;
        }
      }
      return null;
    }),
    openProject: log("openProject", async () => null),
    probeRootProject: log("probeRootProject", async () => null),
    projectRoot: "/project",
    readFile: log("readFile", async (path) => {
      const content = state.files.get(path);
      if (content === undefined) {
        throw new Error(`mock platform: no such file: ${path}`);
      }
      return content;
    }),
    removePackage: log("removePackage", async () => ({})),
    renameFile: log("renameFile", async (from, to): Promise<RenameResult> => {
      const content = state.files.get(from);
      if (content !== undefined) {
        state.files.delete(from);
        state.files.set(to, content);
      }
      return { from, ok: true, to };
    }),
    resolveSiteContext: log("resolveSiteContext", async () => ({ sitePath: null })),
    searchFiles: log("searchFiles", async (query) =>
      [...state.files.keys()]
        .filter((path) => path.includes(query))
        .map((path) => ({ name: path.split("/").pop()!, path, type: "file" }) satisfies DirEntry),
    ),
    uploadFile: log("uploadFile", async (path: string) => ({ path })),
    writeFile: log("writeFile", async (path, content) => {
      state.files.set(path, content);
    }),
    ...overrides,
  };

  registerPlatform(platform);
  return { platform, state };
}

// ─── Event helpers ────────────────────────────────────────────────────────────

/** Dispatch a bubbling pointer/mouse event of the given type. */
export function pointer(el: Element, type: string, opts: MouseEventInit = {}): void {
  el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, ...opts }),
  );
}

/**
 * Dispatch a drag event carrying `files`, and report what the handler did with it.
 *
 * Happy-dom has no usable `DataTransfer`, so one is stubbed: `types` drives the `includes("Files")`
 * guard every external-drop handler opens with, and `dropEffect` is writable so a test can assert
 * the copy cursor was requested. Pass `files: []` to simulate an in-app drag (no `Files` type).
 */
export function dragEvent(
  el: Element,
  type: string,
  files: File[] = [],
  init: MouseEventInit & { relatedTarget?: EventTarget | null } = {},
): { event: Event; dataTransfer: { dropEffect: string; files: File[]; types: string[] } } {
  const dataTransfer = {
    dropEffect: "none",
    files,
    types: files.length > 0 ? ["Files"] : [],
  };
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  if ("relatedTarget" in init) {
    Object.defineProperty(event, "relatedTarget", { value: init.relatedTarget ?? null });
  }
  el.dispatchEvent(event);
  return { dataTransfer, event };
}

/** A `File` with real bytes, for upload-path tests. */
export function testFile(name: string, type = "image/png", body = "x"): File {
  return new File([body], name, { type });
}

/** Dispatch a bubbling keyboard event (keydown by default). */
export function key(
  el: Element,
  keyName: string,
  opts: KeyboardEventInit & { type?: string } = {},
): void {
  const { type = "keydown", ...init } = opts;
  el.dispatchEvent(
    new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: keyName,
      ...init,
    }),
  );
}

// ─── Caret helpers ────────────────────────────────────────────────────────────
//
// The canvas is a single `contenteditable` root, so putting the caret somewhere IS how editing
// Starts — there is no gesture to simulate. Happy-dom implements Range/Selection but does not
// Dispatch `selectionchange` when a script moves the selection, so these helpers fire it, matching
// What a real click or arrow key produces.

/**
 * Place a collapsed caret at `offset` within `node`, then notify listeners.
 *
 * Moves the selection ATOMICALLY (`collapse`, not `removeAllRanges` + `addRange`): happy-dom fires
 * `selectionchange` on every selection mutation, so the two-step form would emit a spurious
 * empty-selection event that no real click produces.
 */
export function caretAt(node: Node, offset = 0): void {
  window.getSelection()!.collapse(node, offset);
  document.dispatchEvent(new Event("selectionchange"));
}

/**
 * Put the caret inside `el`'s text at `offset` characters, then notify. The common way to say "the
 * user clicked here" — resolves through the element's first text node when it has one.
 */
export function caretInto(el: HTMLElement, offset = 0): void {
  const text = el.firstChild;
  if (text && text.nodeType === Node.TEXT_NODE) {
    caretAt(text, Math.min(offset, text.textContent?.length ?? 0));
    return;
  }
  caretAt(el, 0);
}

/** Select from one DOM position to another (possibly across blocks), then notify. */
export function selectAcross(
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): void {
  window.getSelection()!.setBaseAndExtent(startNode, startOffset, endNode, endOffset);
  document.dispatchEvent(new Event("selectionchange"));
}

/**
 * Dispatch a `beforeinput` on `el`. Returns whether the default was prevented — i.e. whether the
 * editing host claimed the edit as structural rather than letting the browser apply it.
 *
 * Happy-dom has no `getTargetRanges`, so the host falls back to the live selection: place the caret
 * with {@link caretInto} / {@link selectAcross} first.
 */
export function beforeInput(el: Element, inputType: string, data = ""): boolean {
  const event = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    data,
    inputType,
  });
  el.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Dispatch an input + change pair after setting a form control's value. */
export function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// ─── Dialog helpers ───────────────────────────────────────────────────────────

/**
 * The topmost `jx-dialog` mounted in the #layer-dialog layer, if any.
 *
 * It also matched `sp-dialog-wrapper`, for the bespoke bodies that were still lit. Spectrum is
 * removed, so that half matched nothing before it was deleted — and a selector that can never match
 * reads like a substrate still in play, which is the one thing a test harness must not imply.
 */
export function topDialog(): HTMLElement | null {
  const dialogs = [...document.querySelectorAll("#layer-dialog jx-dialog")];
  return (dialogs.at(-1) as HTMLElement | undefined) ?? null;
}

/** The prompt's field control — the native input the kit's field draws inside itself. */
function promptField(dialog: HTMLElement): HTMLInputElement | null {
  return dialog.querySelector<HTMLInputElement>('jx-textfield [part="input"]');
}

/**
 * Answer the topmost prompt dialog: `null` cancels; a string is typed into the field (after an
 * optional format pick) and confirmed. Both flows dispatch the same `confirm`/`cancel` names on the
 * dialog element, so the helper does not care which substrate it is.
 */
export async function answerPromptDialog(
  value: string | null,
  pick?: string,
): Promise<HTMLElement | null> {
  const dialog = topDialog();
  if (!dialog) {
    return null;
  }
  if (value === null) {
    dialog.dispatchEvent(new Event("cancel"));
  } else {
    if (pick !== undefined) {
      await pickPromptFormat(pick);
    }
    const field = promptField(topDialog() ?? dialog);
    if (field) {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    (topDialog() ?? dialog).dispatchEvent(new Event("confirm"));
  }
  await flush();
  return topDialog() ?? dialog;
}

/**
 * Pick a format in the topmost prompt dialog's choice: the kit's `jx-select`, or the Spectrum
 * picker.
 *
 * The write goes to the NATIVE control inside the element, and the event is dispatched from there,
 * because that is what a reader's pick is: `jx-select` hears its own control's `change`, writes the
 * value into its state, and lets the event bubble on to the host. Setting the element's `value`
 * property instead would move the control without ever telling the surface anything, which is a
 * pick no reader can perform.
 */
export async function pickPromptFormat(value: string): Promise<void> {
  const dialog = topDialog();
  const picker = dialog?.querySelector<HTMLSelectElement>('[part="choice"] select');
  if (!picker) {
    return;
  }
  picker.value = value;
  picker.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
}

/** The `[value, label]` pairs the topmost prompt dialog's choice offers. */
export function promptFormatOptions(): [string, string][] {
  const dialog = topDialog();
  /* `[part="choice"] option`, not `select[part="choice"] option`: the part is on the `jx-select`
     element and the `<select>` inside it carries `part="control"`. Rows the element stands in for a
     value no list holds are excluded — they are the element saying it holds something unlisted,
     never an offer. */
  return [...(dialog?.querySelectorAll<HTMLOptionElement>('[part="choice"] option') ?? [])]
    .filter((el) => el.getAttribute("part") !== "unlisted")
    .map((el) => [el.value, el.textContent?.trim() ?? ""]);
}

// ─── New Project wizard field accessors ──────────────────────────────────────
/* The second step renders a destination block between the name and the note whose shape depends on
   the platform's `createDestination` (specs/desktop.md §4.5), so positional indexing into the field
   list is not stable. Address each field by its `part` — the wizard is a document now
   (`src/surfaces/new-project.json`), so it lives in the dialog layer and emits no classes at all,
   and what a test reaches for is the native control the kit's field draws inside itself. */

/** A New Project second-step control by the `part` of the kit field around it. */
function npField(part: string): HTMLInputElement {
  return document.querySelector(
    `#layer-dialog [part="${part}"] [part="input"], #layer-dialog [part="${part}"] [part="control"]`,
  ) as HTMLInputElement;
}

/** The Project Name textfield. */
export const npName = () => npField("name");
/** The Location textfield (`createDestination: "path"` platforms). */
export const npLocation = () => npField("location");
/** The Directory / Repository textfield — one slug shared by both destination shapes. */
export const npSlug = () => npField("slug");
/** The Owner field (`createDestination: "repo"` platforms; a picker once owners have loaded). */
export const npOwner = () => npField("owner");

/** The resolved-destination preview line under the fields. */
export function npPreview(): string {
  return (
    document
      .querySelector('#layer-dialog [part="destination-preview"]')
      ?.textContent?.trim()
      .replaceAll(/\s+/g, " ") ?? ""
  );
}

/** Set a New Project field's value and fire the input event the wizard listens for. */
export function npType(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Fill the Location field so a create can proceed. Every filesystem-platform create needs one — the
 * modal blocks submit without it and the backend refuses it.
 */
export function npFillLocation(parent = "/home/dev/Sites"): void {
  npType(npLocation(), parent);
}

/** One node of the wizard's document, addressed by `part`. */
export function npPart<T extends Element = HTMLElement>(part: string): T | null {
  return document.querySelector(`#layer-dialog [part="${part}"]`) as T | null;
}

/** Every node of the wizard's document carrying a `part`. */
export function npParts<T extends Element = HTMLElement>(part: string): T[] {
  return [...document.querySelectorAll(`#layer-dialog [part="${part}"]`)] as T[];
}

/** The wizard's dialog element, or null when it is not up. */
export function npDialog(): HTMLElement | null {
  return document.querySelector('#layer-dialog jx-dialog[part="new-project"]');
}

/** The dialog's headline, which is also its accessible name. */
export function npHeadline(): string {
  return npPart("headline")?.textContent?.trim() ?? "";
}

/**
 * The footer's answers, in the order the kit draws them: Back, Cancel, then the primary. Absent
 * labels are absent buttons — `jx-dialog` draws a button only for a label it was given.
 */
export function npFooter(): string[] {
  return ["secondary-label", "cancel-label", "confirm-label"]
    .map((part) => npPart(part)?.textContent?.trim() ?? "")
    .filter((label) => label !== "");
}

/** Press one of the footer's answers, from the native control the kit's button draws. */
export function npPress(label: "Back" | "Cancel" | "Confirm"): void {
  const part = label === "Back" ? "secondary" : label === "Cancel" ? "cancel" : "confirm";
  npPart(`${part}`)
    ?.querySelector('[part="control"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The starter gallery's cards, in order. */
export function npCards(): HTMLElement[] {
  return npParts("card");
}

/** The source tabs' values, in strip order. */
export function npTabValues(): string[] {
  return npParts("tab").map((tab) => tab.getAttribute("value") ?? "");
}

/** Choose a source tab the way a reader does: a click on the tab itself. */
export function npPickTab(value: string): void {
  document
    .querySelector(`#layer-dialog jx-tab[value="${value}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/**
 * Dismiss the wizard the way a reader does: the platform's `cancel`, which is what Escape raises on
 * a modal `<dialog>` and what the kit's Cancel button dispatches. A no-op with nothing up.
 */
export function npDismiss(): void {
  npDialog()?.dispatchEvent(new Event("cancel", { bubbles: true }));
}

// ─── Pane stages ──────────────────────────────────────────────────────────────

/**
 * Stand a pane's cell up in the current document and hand back its surface.
 *
 * ONE spelling, because there were about to be twenty-four. Twenty-three test files hand-wrote
 * `<div id="canvas-wrap">` — the shell's single stage — and every one of them meant "the primary
 * pane has somewhere to draw". A stage belongs to a pane now (`canvas/surface-registry.ts`), so the
 * fixture is a registered surface rather than a div with a well-known id.
 *
 * Deliberately NOT `pane-grid.ts`'s own reconciler: a unit test for the Library should not have to
 * boot the shell, install stage gestures or own a `#pane-grid`. It builds the same shape the
 * reconciler builds — `part="stage"`, stamped, registered — and nothing else.
 *
 * @param {string} [paneId]
 * @param {ParentNode} [parent] Where to attach. Defaults to `document.body`.
 * @returns {CanvasSurface}
 */
export function standUpPaneGrid(paneId = "primary", parent: ParentNode = document.body) {
  const stage = document.createElement("div");
  stage.setAttribute("part", STAGE_PART);
  stage.setAttribute(REGION_ATTR, paneRegion(paneId));
  parent.append(stage);
  return registerCanvasSurface(paneId, stage);
}

/**
 * Treat an element a test already built as the primary pane's stage, and hand back its surface.
 *
 * The adapter for the twenty-three test files that hand-wrote a stage div of their own. They pass
 * the element to a renderer that now takes a surface; this is the one-line conversion, and it
 * registers rather than fabricating so `stageContaining`, `panelHostingCanvas` and the release path
 * all see the same record the app would.
 *
 * @param {HTMLElement} el
 * @param {string} [paneId]
 * @returns {CanvasSurface}
 */
export function surfaceOf(el: HTMLElement, paneId = "primary") {
  return registerCanvasSurface(paneId, el);
}

/**
 * Adopt whatever stage a fixture's own `innerHTML` already built, creating one if it built none.
 *
 * The third spelling because it answers a third question. {@link standUpPaneGrid} makes a stage;
 * {@link surfaceOf} adopts an element the caller is holding; this one adopts THE stage of a document
 * a fixture wrote as a template literal, which is what a dozen suites do at module scope.
 * `initShellRefs()` used to do exactly this from `#canvas-wrap`, and it stopped because a stage
 * belongs to a pane rather than to the shell — so the fixture has to say which element it is.
 *
 * Idempotent: `resetStudioState` drops every surface record between tests, and calling this again
 * re-registers the same element.
 *
 * @param {string} [paneId]
 * @returns {CanvasSurface}
 */
export function registerPrimaryStage(paneId = "primary") {
  /* Found by its REGION, not by a class. A pane's stage is `surfaces/pane-grid.json`'s
     `[part="stage"]` and carries no class at all, while the fixtures this adopts were written when
     it did — so the id both spellings agree on is the one the shots crop. */
  const stage =
    document.querySelector<HTMLElement>(`[${REGION_ATTR}="${paneRegion(paneId)}"]`) ??
    document.createElement("div");
  stage.setAttribute("part", STAGE_PART);
  stage.setAttribute(REGION_ATTR, paneRegion(paneId));
  if (!stage.isConnected) {
    (document.querySelector("#app") ?? document.body).append(stage);
  }
  return registerCanvasSurface(paneId, stage);
}

/** Forget every surface a test stood up. Called from {@link resetStudioState}. */
export function tearDownPaneGrids(): void {
  for (const surface of allCanvasSurfaces()) {
    unregisterCanvasSurface(surface.paneId);
  }
}

// ─── happy-dom gap stubs ──────────────────────────────────────────────────────

/**
 * Happy-dom performs no layout, so getBoundingClientRect() returns zeros. Stub a fixed rect on an
 * element for code that branches on geometry.
 */
export function stubRect(el: Element, rect: Partial<DOMRect>): void {
  const full = {
    bottom: (rect.top ?? 0) + (rect.height ?? 0),
    height: 0,
    left: 0,
    right: (rect.left ?? 0) + (rect.width ?? 0),
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    ...rect,
  } as DOMRect;
  (el as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => full;
}

/** A `ResizeObserver` a test delivers by hand — see {@link installResizeObserver}. */
export interface FakeResizeObservers {
  /** Whether any live observer currently holds `target`. */
  observes: (target: Element) => boolean;
  /** Deliver a resize of `target`. Nothing happens for an element nobody observed. */
  resize: (target: Element) => void;
  /** Put the environment's own `ResizeObserver` back. Call from a `finally`. */
  restore: () => void;
}

/**
 * Happy-dom's `ResizeObserver` exists and never fires, because nothing there has a box to change.
 * Replace it with one a test can fire for a named element, so code that re-measures on a resize can
 * be shown to do so — and shown NOT to for an element it never observed, which is the half a real
 * observer enforces and a stub that fires everything would wave through.
 */
export function installResizeObserver(): FakeResizeObservers {
  const original = globalThis.ResizeObserver;
  const observers: { cb: () => void; targets: Element[] }[] = [];
  function FakeResizeObserver(this: Record<string, unknown>, cb: () => void) {
    const record = { cb, targets: [] as Element[] };
    observers.push(record);
    this.observe = (target: Element) => {
      if (!record.targets.includes(target)) {
        record.targets.push(target);
      }
    };
    this.unobserve = (target: Element) => {
      record.targets = record.targets.filter((el) => el !== target);
    };
    this.disconnect = () => {
      record.targets = [];
    };
  }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  return {
    observes: (target) => observers.some((o) => o.targets.includes(target)),
    resize(target) {
      for (const o of observers) {
        if (o.targets.includes(target)) {
          o.cb();
        }
      }
    },
    restore: () => {
      globalThis.ResizeObserver = original;
    },
  };
}

/**
 * Render the shell's four overlay layers into `host`.
 *
 * The frame's overlay half, for a fixture that wants it without the rest. Twenty test files used to
 * describe this set by hand and had stopped agreeing — most carried three layers, one carried four
 * — so whether a toast host existed depended on which file you were in. The template is
 * `src/shell/tree.ts`'s; only the mounting is a test convenience, which is why it lives here rather
 * than shipping in the bundle.
 */
export function mountOverlayLayers(host: ParentNode = document.body): void {
  /* Same clear-and-eject as src/shell/tree.ts's mountInto, for the same two reasons: a fixture that
     empties the body leaves lit's part marker pointing at comment nodes that are gone, and ejecting
     without clearing makes a second mount paint a second copy beside the first. */
  (host as HTMLElement).textContent = "";
  // @ts-expect-error -- _$litPart$ is lit's private render-part marker, not in the DOM types
  delete (host as HTMLElement)["_$litPart$"];
  litRender(overlayLayers(), host as HTMLElement);
}
