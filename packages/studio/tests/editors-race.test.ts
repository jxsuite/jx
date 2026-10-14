/**
 * The Bottom dock's Logic tab — what happens INSIDE the Monaco load.
 *
 * `tests/editors.test.ts` drives the code surface the way the dock does and awaits `loadMonaco()`
 * before it asserts, which is right for every question it asks and blind to the only question this
 * file asks: what if the user acts while the load is still in flight? Monaco is 12.6 MB behind a
 * cold dynamic import — hundreds of milliseconds during which Close, a retarget and a second dock
 * repaint are all ordinary things to do — and coverage cannot see an interleaving, so that window
 * read as 100% covered while leaking a live editor on three separate paths.
 *
 * So `loadMonaco` is mocked with a GATE this file opens by hand. Every test starts a mount, does
 * something to the surface while it is suspended, and then lets the import land.
 */
import { flush, installMockPlatform, resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { FunctionEditDef } from "../src/types";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** The one creation option the double reads; the mount passes Monaco's full option bag. */
interface FakeEditorOptions {
  value?: string;
}

/** Stands in for Monaco's text model, which the double only ever hands back. */
interface FakeModel {
  id: string;
}

class FakeEditor {
  value: string;
  options: FakeEditorOptions;
  disposed = false;
  model: FakeModel | null = { id: "fake-model" };
  _ignoreNextChange?: boolean;
  _editingTarget?: string | null;
  dom: HTMLElement | null = null;
  el: HTMLElement;

  constructor(el: HTMLElement, options: FakeEditorOptions) {
    this.el = el;
    this.value = options.value ?? "";
    this.options = options;
  }
  /**
   * Mirrors Monaco, INCLUDING after a dispose: `getValue()` is `if (!this._modelData) return "";`
   * and `dispose()` detaches the model, so a dead editor answers the empty string rather than the
   * buffer it held. A double that kept answering with the buffer hid a debounce writing `""` into
   * the document on four separate teardown paths.
   */
  getValue() {
    return this.disposed ? "" : this.value;
  }
  setValue(v: string) {
    if (this.disposed) {
      return;
    }
    this.value = v;
  }
  dispose() {
    this.disposed = true;
    this.model = null;
  }
  /** The mount registers a change listener; nothing here fires one. */
  onDidChangeModelContent() {
    void this.model;
    return { dispose: () => {} };
  }
  getModel() {
    return this.model;
  }
  /** Nothing in this file types; the buffer-staleness rule still asks, so the double answers. */
  focused = false;
  hasTextFocus() {
    return this.focused;
  }
  /** Monaco appends its own root to the container it was created in. */
  getDomNode() {
    if (!this.dom) {
      this.dom = this.el.ownerDocument.createElement("div");
      this.el.append(this.dom);
    }
    return this.dom;
  }
}

const created: FakeEditor[] = [];

const fakeMonaco = {
  MarkerSeverity: { Error: 8, Warning: 4 },
  Uri: { parse: (u: string) => ({ target: u, toString: () => u }) },
  editor: {
    create: (el: HTMLElement, options: FakeEditorOptions) => {
      const ed = new FakeEditor(el, options);
      created.push(ed);
      return ed;
    },
    setModelMarkers: () => {},
  },
  languages: {
    CompletionItemKind: { Function: 1, Property: 9, Variable: 4 },
    registerCompletionItemProvider: () => ({ dispose: () => {} }),
  },
};

/** Open once the test says the import may land. Replaced per test. */
let gate: Promise<void> = Promise.resolve();
let openGate: () => void = () => {};

function shutGate() {
  gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
}

void mock.module("../src/services/monaco-lazy", () => ({
  isMonacoLoaded: () => true,
  loadedMonaco: () => fakeMonaco,
  loadMonaco: async () => {
    await gate;
    return fakeMonaco;
  },
  resetMonacoLazy: () => {},
  setProjectSchemasForMonaco: () => {},
}));

const { closeFunctionEditor, syncFunctionEditor } = await import("../src/panels/editors");
const { html, render: litRender } = await import("lit-html");

/**
 * The container the Logic tab draws for Monaco.
 *
 * `surfaces/logic-workspace.json` renders `[part="code-host"]` and nothing inside it — the island
 * contract of studio-ui-guidelines.md §9.4 — so this stands in for the one node of that document
 * this module is answerable for, painted with lit because these tests exercise the repaint.
 */
function functionEditorTemplate() {
  return html`<div part="code-host"></div>`;
}
const { view } = await import("../src/view");
const { activeTab } = await import("../src/workspace/workspace");

/**
 * Stands in for the dock's `.bd-body`, and it is rebuilt per test on purpose: one test removes the
 * container out from under lit, which leaves lit's part pointing at nodes that are no longer in the
 * tree — a reused host would silently render nothing for every test after it.
 */
let dock: HTMLElement;

function docFixture(): JxMutableNode {
  return {
    children: [],
    state: {
      greet: { $prototype: "Function", body: "return 1;", parameters: [{ name: "state" }] },
      wave: { $prototype: "Function", body: "return 2;", parameters: [{ name: "state" }] },
    },
    tagName: "div",
  };
}

function setEditing(editing: FunctionEditDef | null) {
  activeTab.value!.session.ui.editingFunction = editing;
}

/**
 * One dock repaint, WITHOUT waiting for the load — the whole point of this file.
 *
 * Returns the container it painted, and throws when there is none, so every test that expects
 * NOTHING to be created has first proved the mount had somewhere to start: a mount that never
 * started would satisfy those expectations for the wrong reason.
 */
function paintLogic(): HTMLElement {
  litRender(functionEditorTemplate(), dock);
  syncFunctionEditor(dock);
  const container = dock.querySelector('[part="code-host"]');
  if (!(container instanceof HTMLElement)) {
    throw new TypeError("the Logic tab painted no code host");
  }
  return container;
}

beforeEach(() => {
  dock = document.createElement("div");
  dock.id = "logic";
  document.body.replaceChildren(dock);
  created.length = 0;
  view.functionEditor = null;
  view._completionRegistered = false;
  installMockPlatform({ codeService: async () => null });
  resetWorkspaceWithTab(docFixture(), { documentPath: "/project/pages/index.json" });
  shutGate();
});

describe("a mount suspended inside the Monaco import", () => {
  test("creates nothing when the surface is closed before the import lands", async () => {
    setEditing({ defName: "greet", type: "def" });
    paintLogic();
    await flush();
    // The import has not resolved, so there is no editor yet — which is exactly why the Close
    // Cannot dispose one, and why the disposal `resetCanvasView` used to perform was never the
    // Thing that covered this.
    expect(created).toHaveLength(0);
    expect(view.functionEditor).toBeNull();

    await closeFunctionEditor();
    expect(activeTab.value!.session.ui.editingFunction).toBeNull();

    openGate();
    await flush(4);

    // Before the re-check: a live Monaco — text model, listeners, an `automaticLayout`
    // ResizeObserver — in a container nothing is showing, parked on `view.functionEditor` where
    // The next sync overwrites the handle instead of disposing it.
    expect(created).toHaveLength(0);
    expect(view.functionEditor).toBeNull();
  });

  test("creates nothing when the target changed while the import was in flight", async () => {
    setEditing({ defName: "greet", type: "def" });
    paintLogic();
    await flush();
    setEditing({ defName: "wave", type: "def" });

    openGate();
    await flush(4);

    expect(created).toHaveLength(0);
    expect(view.functionEditor).toBeNull();
  });

  test("creates nothing when lit has replaced the container underneath it", async () => {
    setEditing({ defName: "greet", type: "def" });
    const container = paintLogic();
    await flush();
    container.remove();

    openGate();
    await flush(4);

    expect(created).toHaveLength(0);
    expect(view.functionEditor).toBeNull();
  });

  test("two repaints racing the same load produce ONE editor, not two", async () => {
    setEditing({ defName: "greet", type: "def" });
    paintLogic();
    await flush();
    // A second `afterRender` while the first mount is suspended sees a null `view.functionEditor`
    // And starts its own. Whichever resolved second used to clobber the first's handle.
    syncFunctionEditor(dock);
    await flush();

    openGate();
    await flush(4);

    expect(created).toHaveLength(1);
    // Identity across the double's type and Monaco's: the handle IS the one editor created.
    expect(Object.is(view.functionEditor, created[0])).toBe(true);
    expect(created[0]!.disposed).toBe(false);
  });

  test("the ordinary case still mounts once the import lands", async () => {
    setEditing({ defName: "greet", type: "def" });
    paintLogic();
    openGate();
    await flush(4);

    expect(created).toHaveLength(1);
    expect(created[0]!.value).toBe("return 1;");
    expect(view.functionEditor!._editingTarget).toBe(
      JSON.stringify({ defName: "greet", type: "def" }),
    );
  });
});
