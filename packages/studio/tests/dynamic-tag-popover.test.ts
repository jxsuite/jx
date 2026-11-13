/**
 * The tag popover, end to end in the parent realm (src/panels/dynamic-tag.ts,
 * src/surfaces/dynamic-tag.ts, src/panels/tag-popover-door.ts; studio.md §6.9).
 *
 * The real command registry, the real surface document and the real document store. The one double
 * is the canvas frame: `requestTemplateEval` answers from a table here, because the values a
 * popover shows are the frame's and there is no frame in this suite.
 *
 * Every edit is asserted as the exact text the document stores afterwards, and as one history step.
 */
import { flush, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { initLayers } from "../src/ui/layers";
import { getNodeAtPath } from "../src/state";
import {
  mutateRemoveNode,
  mutateUpdateAttribute,
  mutateUpdateProperty,
  undo,
} from "../src/tabs/transact";

import type { CommandRegistry } from "../src/commands/registry";
import type { TemplateResult } from "../src/canvas/iframe-protocol";
import type { Tab } from "../src/tabs/tab";
import type { JxPath } from "../src/state";
import type { JxDocumentValue, JxMutableNode, JxStateDefinition } from "@jxsuite/schema/types";

// ─── Seams (all must precede the modules under test) ─────────────────────────

void mock.module("monaco-editor/editor", () => ({
  MarkerSeverity: { Error: 8, Warning: 4 },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
  editor: { create: () => ({}), createModel: () => ({}), setModelMarkers: () => {} },
}));
void mock.module("../src/canvas/canvas-live-render.js", () => ({
  initCanvasLiveRender: () => {},
  resolveCanvasDocument: () => Promise.resolve(null),
}));

/** One `evalTemplate` the flow asked the frame for. */
interface EvalAsk {
  tabId: string | null;
  path: JxPath | null;
  templates: { id: string; template: string }[];
  formulas?: Readonly<Record<string, JxStateDefinition>>;
}
const asks: EvalAsk[] = [];

/** What the frame answers a template that calls a formula it was never given: its failure. */
function frameFailure(
  template: string,
  sent: Readonly<Record<string, JxStateDefinition>> | undefined,
): Partial<TemplateResult> {
  return unknownFormula(template, sent)
    ? { error: "state.formatDate is not a function", text: "", type: "empty" }
    : {};
}

/** Whether the template calls a state formula the frame has neither drawn nor been handed. */
function unknownFormula(
  template: string,
  sent: Readonly<Record<string, JxStateDefinition>> | undefined,
): boolean {
  const name = /state\.(\w+)\(/u.exec(template)?.[1];
  return name !== undefined && !frameFormulas.has(name) && !(sent !== undefined && name in sent);
}
/** What the frame answers a template with, by the template's text; anything else is its text. */
const answers = new Map<string, Partial<TemplateResult>>();
/** Whether a frame is there to answer at all. */
let frameUp = true;
/** Replies held back: when set, each ask waits for its own release, in the order they were made. */
let holding: (() => void)[] | null = null;
/** The formulas the frame's last render knows, which a template may call without being sent them. */
const frameFormulas = new Set<string>(["formatDate", "capitalize", "initials"]);
let flushes = 0;
let anchor: { left: number; top: number; width: number; height: number } | null = null;

void mock.module("../src/canvas/iframe-host.js", () => ({
  canvasIdleBlockers: () => [],
  canvasPointAt: () => Promise.resolve(null),
  commitActiveEditSession: () => {},
  flushCanvasEdits: () => {
    flushes += 1;
    return Promise.resolve();
  },
  getEditBarAnchorRect: () => anchor,
  getEditSnapshot: () => ({ editing: false, snapshot: null }),
  mountIframeCanvas: () => Promise.resolve(),
  postApplyFormat: () => {},
  postOpenSlash: () => {},
  postRedefineElementToLiveHosts: () => 0,
  postSiteStyleToLiveHosts: () => 0,
  postStyleUpdateToStylebookHosts: () => {},
  releaseCanvasHosts: () => 0,
  requestCanvasEval: () => Promise.resolve(null),
  requestTemplateEval: (tabId: string | null, request: Omit<EvalAsk, "tabId">) => {
    asks.push({ tabId, ...request });
    if (!frameUp) {
      return Promise.resolve(null);
    }
    const reply = {
      results: request.templates.map(({ id, template }) => ({
        id,
        text: `<${template}>`,
        type: "string",
        ...answers.get(template),
        ...frameFailure(template, request.formulas),
      })),
      rows: null,
    };
    if (holding) {
      const queue = holding;
      return new Promise((resolve) => {
        queue.push(() => resolve(reply));
      });
    }
    return Promise.resolve(reply);
  },
  revealCanvasPath: () => Promise.resolve(null),
  setToolbarRefresh: () => {},
}));
void mock.module("../src/surfaces/welcome.js", () => ({
  initWelcome: () => {},
  renderWelcome: () => {},
}));
void mock.module("../src/panels/editors.js", () => ({
  registerFunctionCompletions: () => {},
  renderFunctionEditor: () => {},
}));
void mock.module("../src/panels/formula-workspace.js", () => ({
  closeFormulaWorkspace: () => {},
  formulaRoot: () => null,
  openLogicTarget: () => {},
  renderFormulaWorkspace: () => {},
  revealLogicPanel: () => {},
}));
void mock.module("../src/surfaces/statusbar.js", () => ({
  mountStatusbar: () => {},
  renderStatusbar: () => {},
  unmountStatusbar: () => {},
}));
void mock.module("../src/panels/overlays.js", () => ({
  mount: () => {},
  render: () => {},
  unmount: () => {},
}));
void mock.module("../src/panels/stylebook-panel.js", () => ({
  renderStylebookMode: () => {},
  selectStylebookTag: () => {},
}));
void mock.module("../src/files/file-ops.js", () => ({
  confirmFileDelete: () => Promise.resolve(false),
  parseSourceForPath: () => null,
  renamePromptMessage: () => Promise.resolve(""),
  saveFile: () => Promise.resolve(true),
  serializeDocument: () => "",
}));

const { registerCanvasViewCommands } = await import("../src/canvas/canvas-utils");
const { handleTagClick, initDynamicTag } = await import("../src/panels/dynamic-tag");
const { activateTab, openTab } = await import("../src/workspace/workspace");
const { closeTagPopover, openTagPopover } = await import("../src/panels/tag-popover-door");
const { slotValue } = await import("../src/editor/dynamic-tags");

// ─── The page ────────────────────────────────────────────────────────────────

const EPISODE: JxPath = ["children", 0, "map"];
const TITLE: JxPath = [...EPISODE, "children", 0];
const DATE: JxPath = [...EPISODE, "children", 1];
const IMAGE: JxPath = [...EPISODE, "children", 2];
const CUSTOM: JxPath = [...EPISODE, "children", 3];
const BYLINE: JxPath = [...EPISODE, "children", 4];
const REF: JxPath = ["children", 1];

const CUSTOM_EXPR = "(d) => d ? new Date(d).getFullYear() : ''";

/** The converted site's episode list, in miniature: a repeater whose template binds each way. */
function episodes(): JxMutableNode {
  return {
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/episodes" },
        map: {
          children: [
            { tagName: "h3", textContent: "${$map.item.data.title ?? ''}" },
            {
              tagName: "time",
              textContent: 'Aired ${state.formatDate($map.item.data.date, {"dateStyle":"long"})}.',
            },
            {
              attributes: { alt: "${item.data.title}", src: "${item.data.image}" },
              tagName: "img",
            },
            { tagName: "p", textContent: `\${${CUSTOM_EXPR}}` },
            { children: ["By ", "${item.data.author}", { tagName: "em" }], tagName: "p" },
          ],
          tagName: "article",
        },
      },
      { tagName: "h1", textContent: { $ref: "#/state/heading" } },
    ],
    state: {
      episodes: {
        default: [
          { data: { author: "A", date: "2026-10-29", image: "/a.png", title: "One" } },
          { data: { author: "B", date: "2026-10-22", image: "/b.png", title: "Two" } },
        ],
      },
      heading: "Episodes",
    },
    tagName: "main",
  };
}

let registry: CommandRegistry;
let tab: Tab;
let shows = 0;
let hides = 0;
let returned = 0;
let stop: (() => void) | null = null;

/** The popover's panel, once the surface has mounted. */
function panel(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    '[data-jx-region="overlay.menu:dynamic-tag"] [part="panel"]',
  );
  if (!el) {
    throw new TypeError("the tag popover is not mounted");
  }
  return el;
}

/** One of the panel's parts. */
function part(name: string): HTMLElement | null {
  return panel().querySelector<HTMLElement>(`[part="${name}"]`);
}

/** A kit field's own control: what a reader types into or picks from. */
function controlOf(name: string): HTMLInputElement {
  const host = part(name);
  const el = host?.querySelector('[part="input"]') ?? host?.querySelector('[part="control"]');
  if (!(el instanceof HTMLElement)) {
    throw new TypeError(`the popover draws no ${name} control`);
  }
  // SAFETY: a kit field's control is an input, a textarea or a select, each of which has `value`.
  return el as HTMLInputElement;
}

/** Commit a control the way a pick or a blur does, and let the write land. */
async function commit(name: string, value: string): Promise<void> {
  const el = controlOf(name);
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await flush(8);
}

/** The format rows, by id, with the checked one starred. */
function formats(): string[] {
  /* SAFETY: a format row is a `jx-action-button`, which declares `checked` (a string) as public
     state the kit exposes as a property. */
  const rows = [...panel().querySelectorAll('[part="format"]')] as (HTMLElement & {
    checked: string;
  })[];
  return rows.map((row) => (row.checked === "true" ? "*" : "") + (row.dataset.value ?? ""));
}

/** Press the format row with this id. */
async function pickFormat(id: string): Promise<void> {
  const row = [...panel().querySelectorAll<HTMLElement>('[part="format"]')].find(
    (candidate) => candidate.dataset.value === id,
  );
  const button = row?.querySelector<HTMLElement>('[part="control"]');
  if (!button) {
    throw new TypeError(`no format row ${id} among ${formats().join(" ")}`);
  }
  button.click();
  await flush(8);
}

/** Open a tag by the command a script would run, and let the panel fill. */
async function open(path: JxPath, slot: (string | number)[], index = 0): Promise<void> {
  await registry.run("canvas.setTagPopover", { tag: { index, path, slot } });
  await flush(8);
}

/** What the node at `path` holds under `key`. */
function held(path: JxPath, key: string): JxDocumentValue | undefined {
  return slotValue(getNodeAtPath(tab.doc.document, path), [key]);
}

/** The bound string member of the byline's `children`. */
function slotOf(path: JxPath): JxDocumentValue | undefined {
  return slotValue(getNodeAtPath(tab.doc.document, path), ["children", 1]);
}

/** The panel as the kit's popover holds it: where it is placed. */
type PlacedPanel = HTMLElement & { x: number; y: number };

/** The popover's panel, with the kit's own placement props. */
function placed(): PlacedPanel {
  /* SAFETY: the panel is the document's `jx-popover`, which declares `x` and `y` (numbers) as
     public state the kit exposes as properties (ui/components/jx-popover.json). */
  return panel() as PlacedPanel;
}

/** The Advanced section as the kit's accordion item holds it. */
function advanced(): HTMLElement & { label: string; open: boolean } {
  const el = part("advanced");
  if (!el) {
    throw new TypeError("the popover draws no Advanced section");
  }
  /* SAFETY: `part="advanced"` is a `jx-accordion-item`, which declares `label` (string) and `open`
     (boolean) as public state the kit exposes as properties. */
  return el as HTMLElement & { label: string; open: boolean };
}

beforeAll(() => {
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
  initLayers();
  const show = HTMLElement.prototype.showPopover;
  const hide = HTMLElement.prototype.hidePopover;
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement, ...args) {
    shows += 1;
    show.apply(this, args);
    this.dispatchEvent(Object.assign(new Event("toggle"), { newState: "open" }));
  };
  HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) {
    hides += 1;
    hide.apply(this);
    this.dispatchEvent(Object.assign(new Event("toggle"), { newState: "closed" }));
  };
});

beforeEach(async () => {
  resetStudioState();
  tab = resetWorkspaceWithTab(episodes(), { documentPath: "pages/episodes.json" });
  registry = createCommandRegistry({ getContext: () => makeContext({ document: { open: true } }) });
  registerCanvasViewCommands(registry, {
    getCanvasMode: () => "edit",
    renderPane: () => {},
    setCanvasMode: () => {},
    setOpenDialog: () => {},
    setOpenPopover: () => {},
    setResolvingOpen: () => {},
  });
  setActiveRegistry(registry);
  asks.length = 0;
  answers.clear();
  frameUp = true;
  holding = null;
  flushes = 0;
  anchor = null;
  returned = 0;
  stop = initDynamicTag(() => {
    returned += 1;
  });
  await flush(4);
  shows = 0;
  hides = 0;
});

afterEach(async () => {
  tab.session.ui.tagPopover = null;
  await flush(4);
  stop?.();
  stop = null;
  setActiveRegistry(null);
});

describe("opening and closing", () => {
  test("the command opens one tag's popover and null closes it", async () => {
    await open(TITLE, ["textContent"]);
    expect(shows).toBe(1);
    expect(part("title")?.textContent).toBe("Title");
    expect(part("kind")?.textContent).toBe("Text");
    await registry.run("canvas.setTagPopover", { tag: null });
    await flush(6);
    expect(hides).toBe(1);
    // The keyboard goes back to the canvas: no door said where else it came from.
    expect(returned).toBe(1);
  });

  test("another tag is the same panel, shown once more", async () => {
    await open(TITLE, ["textContent"]);
    await open(IMAGE, ["attributes", "src"]);
    expect(part("title")?.textContent).toBe("Image");
    expect(part("kind")?.textContent).toBe("Image");
    expect(
      document.querySelectorAll('[data-jx-region="overlay.menu:dynamic-tag"] [part="panel"]'),
    ).toHaveLength(1);
    expect(hides).toBe(0);
  });

  test("a close the platform made (Escape, a press outside) closes the tab's tag too", async () => {
    await open(TITLE, ["textContent"]);
    panel().hidePopover();
    await flush(6);
    expect(tab.session.ui.tagPopover).toBeNull();
    expect(returned).toBe(1);
  });

  test("a toggle that is not the panel's own does not close it", async () => {
    await open(TITLE, ["textContent"]);
    // The Advanced section is a disclosure inside the panel, and its toggle bubbles to it.
    const inner = part("advanced");
    inner?.dispatchEvent(new Event("toggle", { bubbles: true }));
    await flush(4);
    expect(tab.session.ui.tagPopover).not.toBeNull();
  });

  test("a chip pressed in a block already chosen opens that chip, and a first press does not", async () => {
    const click = {
      chosen: false,
      occurrence: 0,
      path: BYLINE,
      rect: { height: 20, left: 300, top: 400, width: 80 },
      ref: null,
      source: "${item.data.author}",
      tab,
    };
    handleTagClick(click);
    await flush(6);
    expect(tab.session.ui.tagPopover).toBeNull();
    handleTagClick({ ...click, chosen: true });
    await flush(6);
    // A string member of `children` is addressed as that member.
    expect(tab.session.ui.tagPopover).toEqual({ index: 0, path: BYLINE, slot: ["children", 1] });
    expect(part("title")?.textContent).toBe("Author");
    // Under the chip: its bottom edge, plus the gap.
    expect([placed().x, placed().y]).toEqual([300, 426]);
  });

  test("a chip the document no longer holds, and one of another tab, open nothing", async () => {
    handleTagClick({
      chosen: true,
      occurrence: 0,
      path: BYLINE,
      rect: { height: 1, left: 0, top: 0, width: 1 },
      ref: null,
      source: "${item.data.gone}",
      tab,
    });
    const other = { ...tab, id: "another" };
    handleTagClick({
      chosen: true,
      occurrence: 0,
      path: TITLE,
      rect: { height: 1, left: 0, top: 0, width: 1 },
      ref: null,
      source: "${$map.item.data.title ?? ''}",
      // SAFETY: a second tab object; only its identity is read.
      tab: other as Tab,
    });
    await flush(6);
    expect(tab.session.ui.tagPopover).toBeNull();
  });

  test("a { $ref } chip opens its property", async () => {
    handleTagClick({
      chosen: true,
      occurrence: 0,
      path: REF,
      rect: { height: 10, left: 10, top: 10, width: 10 },
      ref: "#/state/heading",
      source: '${state?.["heading"]}',
      tab,
    });
    await flush(6);
    expect(tab.session.ui.tagPopover).toEqual({ index: 0, path: REF, slot: ["textContent"] });
    expect(part("title")?.textContent).toBe("Heading");
  });

  test("a door hands focus back to what was pressed, and pressing the same tag again places it again", async () => {
    const pill = document.createElement("button");
    document.body.append(pill);
    openTagPopover(
      { index: 0, path: TITLE, slot: ["textContent"] },
      { at: { x: 40, y: 50 }, returnFocus: pill },
    );
    await flush(6);
    expect(shows).toBe(1);
    expect(placed().x).toBe(40);
    openTagPopover(
      { index: 0, path: TITLE, slot: ["textContent"] },
      { at: { x: 90, y: 60 }, returnFocus: pill },
    );
    await flush(6);
    expect(placed().x).toBe(90);
    closeTagPopover();
    await flush(6);
    expect(document.activeElement).toBe(pill);
    expect(returned).toBe(0);
    // A kit button is a host around its control, and the control is what takes the focus.
    const kit = document.createElement("span");
    const inner = document.createElement("button");
    kit.append(inner);
    document.body.append(kit);
    openTagPopover({ index: 0, path: TITLE, slot: ["textContent"] }, { returnFocus: kit });
    await flush(6);
    closeTagPopover();
    await flush(6);
    expect(document.activeElement).toBe(inner);
    kit.remove();
    // Nothing open: closing again is nothing.
    closeTagPopover();
    await flush(2);
    pill.remove();
  });

  test("with no door, the panel goes under the selected block, or near the top of the window", async () => {
    anchor = { height: 30, left: 120, top: 200, width: 400 };
    await open(TITLE, ["textContent"]);
    expect([placed().x, placed().y]).toEqual([120, 236]);
    await registry.run("canvas.setTagPopover", { tag: null });
    anchor = null;
    await open(DATE, ["textContent"]);
    expect(placed().y).toBe(96);
  });

  test("a tag that leaves the document closes its popover", async () => {
    await open(TITLE, ["textContent"]);
    getNodeAtPath(tab.doc.document, TITLE)!.textContent = "Plain";
    await flush(6);
    expect(tab.session.ui.tagPopover).toBeNull();
  });
});

describe("what the popover says", () => {
  test("a structured tag shows its source, its fallback and its value from the frame", async () => {
    answers.set("${$map.item.data.title ?? ''}", { text: "One" });
    await open(TITLE, ["textContent"]);
    expect(controlOf("source").value).toBe("item.data.title");
    expect(controlOf("fallback-when").value).toBe("??");
    expect(controlOf("fallback-text").value).toBe("");
    expect(controlOf("show").value).toBe("0");
    expect(part("now-value")?.textContent).toBe("One");
    expect(part("now")?.dataset.state).toBe("value");
    // The frame was asked in the scope of the tag's own node, on its template path.
    expect(asks[0]?.tabId).toBe(tab.id);
    expect(asks[0]?.path).toEqual(TITLE);
    expect(asks[0]?.templates.slice(0, 2)).toEqual([
      { id: "now", template: "${$map.item.data.title ?? ''}" },
      { id: "plain", template: "${$map.item.data.title}" },
    ]);
  });

  test("each format is drawn with the value, and one that cannot read it is not offered", async () => {
    answers.set("${$map.item.data.date}", { text: "2026-10-29" });
    answers.set('${state.formatDate($map.item.data.date, {"dateStyle":"long"})}', {
      text: "October 29, 2026",
    });
    answers.set("${state.formatNumber($map.item.data.date)}", { text: "NaN" });
    answers.set("${state.capitalize($map.item.data.date)}", { error: "boom", text: "" });
    await open(DATE, ["textContent"]);
    const rows = formats();
    expect(rows[0]).toBe("");
    expect(rows).toContain('*formatDate:{"dateStyle":"long"}');
    expect(rows).toContain('formatDate:{"dateStyle":"short"}');
    expect(rows).not.toContain("formatNumber:");
    expect(rows).not.toContain("capitalize:");
    // `relativeTime` declares it takes a number, and the value is text.
    expect(rows.some((row) => row.includes("relativeTime"))).toBe(false);
    const long = [...panel().querySelectorAll<HTMLElement>('[part="format"]')].find(
      (row) => row.dataset.value === 'formatDate:{"dateStyle":"long"}',
    );
    expect(long?.querySelector('[part="format-sample"]')?.textContent).toBe("October 29, 2026");
    expect(long?.querySelector('[part="format-label"]')?.textContent).toBe("Format date: long");
    // The formulas the document does not hold were sent for the evaluation alone.
    expect(Object.keys(asks[0]?.formulas ?? {})).toContain("formatDate");
    expect(tab.doc.document.state?.["formatDate"]).toBeUndefined();
  });

  test("the format's own parameters are fields", async () => {
    await open(DATE, ["textContent"]);
    const fields = [...panel().querySelectorAll<HTMLElement>('[part="param-row"]')].map(
      (row) => row.dataset.key,
    );
    expect(fields).toEqual(["1.dateStyle", "1.timeStyle"]);
  });

  test("a failure, an empty value and no frame each say so", async () => {
    answers.set("${$map.item.data.title ?? ''}", { error: "item is undefined", text: "" });
    await open(TITLE, ["textContent"]);
    expect(part("now")?.dataset.state).toBe("failed");
    expect(part("now-value")?.textContent).toBe("item is undefined");
    await registry.run("canvas.setTagPopover", { tag: null });

    answers.clear();
    answers.set("${item.data.image}", { text: "", type: "empty" });
    await open(IMAGE, ["attributes", "src"]);
    expect(part("now")?.dataset.state).toBe("empty");
    expect(part("now-value")?.textContent).toBe("Empty");
    await registry.run("canvas.setTagPopover", { tag: null });

    frameUp = false;
    await open(IMAGE, ["attributes", "alt"]);
    expect(part("now")?.dataset.state).toBe("pending");
    expect(part("now-value")?.textContent).toBe("Not drawn");
    // With no values there is nothing to pick a format by: only what the tag is on.
    expect(formats()).toEqual(["*"]);
  });

  test("the binding's own state on the canvas wins over a value", async () => {
    tab.session.canvas.bindings = {
      bindings: [
        { error: "404", path: TITLE, source: "${$map.item.data.title ?? ''}", status: "failed" },
        { path: IMAGE, source: "${item.data.image}", status: "pending" },
        { path: IMAGE, source: "${item.data.title}", status: "not-run" },
      ],
      entries: {},
    };
    await open(TITLE, ["textContent"]);
    expect(part("now-value")?.textContent).toBe("Could not load: 404");
    expect(part("now")?.dataset.state).toBe("failed");
    await open(IMAGE, ["attributes", "src"]);
    expect(part("now-value")?.textContent).toBe("Loading");
    await open(IMAGE, ["attributes", "alt"]);
    expect(part("now-value")?.textContent).toBe("Runs on the live page");
  });
});

describe("each control rewrites the tag exactly, as one undo step", () => {
  test("Source: another field and back restores the expression as written", async () => {
    await open(TITLE, ["textContent"]);
    await commit("source", "item.data.date");
    expect(held(TITLE, "textContent")).toBe("${$map.item.data.date ?? ''}");
    expect(tab.history.index).toBe(1);
    await commit("source", "item.data.title");
    expect(held(TITLE, "textContent")).toBe("${$map.item.data.title ?? ''}");
    expect(tab.history.index).toBe(2);
    // The popover stays on the tag it was editing.
    expect(tab.session.ui.tagPopover).toEqual({ index: 0, path: TITLE, slot: ["textContent"] });
    // What the caret had typed was committed before each write.
    expect(flushes).toBe(2);
  });

  test("Source: a value that is no path writes nothing", async () => {
    await open(TITLE, ["textContent"]);
    await commit("source", "");
    expect(tab.history.index).toBe(0);
    expect(tab.doc.dirty).toBe(false);
  });

  test("Format: a preset writes a formula call with its object-literal argument, and copies the formula in, in one step", async () => {
    await open(TITLE, ["textContent"]);
    await commit("source", "item.data.date");
    await pickFormat('formatDate:{"dateStyle":"long"}');
    expect(held(TITLE, "textContent")).toBe(
      '${state.formatDate($map.item.data.date, {"dateStyle":"long"}) ?? \'\'}',
    );
    expect(tab.doc.document.state?.["formatDate"]).toBeDefined();
    expect(tab.history.index).toBe(2);
    // One step back takes the format AND the formula it brought.
    undo(tab);
    expect(held(TITLE, "textContent")).toBe("${$map.item.data.date ?? ''}");
    expect(tab.doc.document.state?.["formatDate"]).toBeUndefined();
  });

  test("Format: the row the tag is on writes nothing, and As stored takes the call away", async () => {
    await open(DATE, ["textContent"]);
    await pickFormat('formatDate:{"dateStyle":"long"}');
    expect(tab.history.index).toBe(0);
    await pickFormat("");
    expect(held(DATE, "textContent")).toBe("Aired ${$map.item.data.date}.");
    expect(tab.history.index).toBe(1);
  });

  test("Format: another preset keeps the text around the tag", async () => {
    await open(DATE, ["textContent"]);
    await pickFormat('formatDate:{"dateStyle":"short"}');
    expect(held(DATE, "textContent")).toBe(
      'Aired ${state.formatDate($map.item.data.date, {"dateStyle":"short"})}.',
    );
    expect(formats()).toContain('*formatDate:{"dateStyle":"short"}');
  });

  test("a parameter field rewrites its argument alone", async () => {
    await open(DATE, ["textContent"]);
    const field = panel().querySelector<HTMLElement>('[part="param-row"][data-key="1.timeStyle"]');
    const control = field?.querySelector<HTMLSelectElement>('[part="param"] [part="control"]');
    control!.value = "short";
    control!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(8);
    expect(held(DATE, "textContent")).toBe(
      'Aired ${state.formatDate($map.item.data.date, {"dateStyle":"long","timeStyle":"short"})}.',
    );
    expect(tab.history.index).toBe(1);
  });

  test("Fallback: both forms, the text, and none", async () => {
    await open(BYLINE, ["children", 1]);
    expect(part("fallback-text")).toBeNull();
    await commit("fallback-when", "||");
    expect(getNodeAtPath(tab.doc.document, BYLINE)?.children).toEqual([
      "By ",
      "${item.data.author || ''}",
      { tagName: "em" },
    ]);
    await commit("fallback-text", "Staff");
    expect(slotOf(BYLINE)).toBe("${item.data.author || 'Staff'}");
    await commit("fallback-when", "??");
    expect(slotOf(BYLINE)).toBe("${item.data.author ?? 'Staff'}");
    await commit("fallback-when", "");
    expect(slotOf(BYLINE)).toBe("${item.data.author}");
    expect(tab.history.index).toBe(4);
  });

  test("Show: the ! forms", async () => {
    await open(IMAGE, ["attributes", "src"]);
    await commit("show", "2");
    expect(getNodeAtPath(tab.doc.document, IMAGE)?.attributes?.["src"]).toBe(
      "${!!item.data.image}",
    );
    await commit("show", "1");
    expect(getNodeAtPath(tab.doc.document, IMAGE)?.attributes?.["src"]).toBe("${!item.data.image}");
    await commit("show", "0");
    expect(getNodeAtPath(tab.doc.document, IMAGE)?.attributes?.["src"]).toBe("${item.data.image}");
    // The other attribute of the same node was never touched.
    expect(getNodeAtPath(tab.doc.document, IMAGE)?.attributes?.["alt"]).toBe("${item.data.title}");
    expect(tab.history.index).toBe(3);
  });

  test("a { $ref } stays a reference for another plain read, and becomes a template for a fallback", async () => {
    await open(REF, ["textContent"]);
    expect(controlOf("source").value).toBe("state.heading");
    await commit("source", "state.episodes");
    expect(held(REF, "textContent")).toEqual({ $ref: "#/state/episodes" });
    await commit("fallback-when", "||");
    // Optional steps, as a pointer reads: a pointer into nothing is nothing, not a throw.
    expect(held(REF, "textContent")).toBe("${state?.episodes || ''}");
    expect(tab.history.index).toBe(2);
  });

  test("an edit made from a later active row lands on the template", async () => {
    tab.session.ui.activeRows = { [JSON.stringify(["children", 0])]: 1 };
    await open(TITLE, ["textContent"]);
    await commit("fallback-text", "Untitled");
    // The template, not a row: every row draws it.
    expect(held(TITLE, "textContent")).toBe("${$map.item.data.title ?? 'Untitled'}");
    expect(JSON.stringify(tab.doc.document.state?.["episodes"])).toContain('"title":"Two"');
  });
});

describe("Advanced, and a Custom expression", () => {
  test("a tag outside the grammar opens to Advanced, named for what it is, with no fields", async () => {
    await open(CUSTOM, ["textContent"]);
    expect(part("title")?.textContent).toBe("Custom expression");
    expect(part("fields")).toBeNull();
    expect(advanced().label).toBe("Custom expression");
    expect(advanced().open).toBe(true);
    expect(controlOf("expression").value).toBe(CUSTOM_EXPR);
    // Only its value was asked for: there is nothing to format.
    expect(asks[0]?.templates).toEqual([{ id: "now", template: `\${${CUSTOM_EXPR}}` }]);
  });

  test("opening and closing a Custom expression writes nothing", async () => {
    const before = JSON.stringify(tab.doc.document);
    await open(CUSTOM, ["textContent"]);
    await registry.run("canvas.setTagPopover", { tag: null });
    await flush(6);
    expect(JSON.stringify(tab.doc.document)).toBe(before);
    expect(tab.doc.dirty).toBe(false);
    expect(tab.history.index).toBe(0);
    expect(flushes).toBe(0);
  });

  test("a structured tag whose spacing is not canonical is not respaced by looking, nor by Apply", async () => {
    getNodeAtPath(tab.doc.document, TITLE)!.textContent = "${ $map.item.data.title  ??  '' }";
    tab.doc.dirty = false;
    await open(TITLE, ["textContent"]);
    expect(controlOf("source").value).toBe("item.data.title");
    part("apply")?.querySelector<HTMLElement>('[part="control"]')?.click();
    await flush(8);
    await registry.run("canvas.setTagPopover", { tag: null });
    await flush(6);
    expect(held(TITLE, "textContent")).toBe("${ $map.item.data.title  ??  '' }");
    expect(tab.history.index).toBe(0);
  });

  test("the expression is edited as code, and applied as one step", async () => {
    await open(CUSTOM, ["textContent"]);
    const field = controlOf("expression");
    field.value = "$map.item.data.date";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(4);
    expect(part("advanced-note")?.textContent).toBe("");
    part("apply")?.querySelector<HTMLElement>('[part="control"]')?.click();
    await flush(8);
    expect(held(CUSTOM, "textContent")).toBe("${$map.item.data.date}");
    expect(tab.history.index).toBe(1);
    // It is a structured tag now, so it has fields.
    expect(part("fields")).not.toBeNull();
    expect(part("title")?.textContent).toBe("Date");
  });

  test("an edit that leaves the grammar is kept as a Custom expression, and says so first", async () => {
    await open(TITLE, ["textContent"]);
    const field = controlOf("expression");
    field.value = "$map.item.data.title.toUpperCase()";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(4);
    expect(part("advanced-note")?.textContent).toBe("Kept as a custom expression.");
    // ⌘ or Ctrl with Enter applies; Enter alone is a new line.
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await flush(4);
    expect(tab.history.index).toBe(0);
    field.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "Enter" }),
    );
    await flush(8);
    expect(held(TITLE, "textContent")).toBe("${$map.item.data.title.toUpperCase()}");
    expect(part("title")?.textContent).toBe("Custom expression");
  });

  test("an empty expression is refused", async () => {
    await open(TITLE, ["textContent"]);
    const field = controlOf("expression");
    field.value = "   ";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(4);
    expect(part("advanced-note")?.textContent).toBe("An expression is needed.");
    part("apply")?.querySelector<HTMLElement>('[part="control"]')?.click();
    await flush(8);
    expect(held(TITLE, "textContent")).toBe("${$map.item.data.title ?? ''}");
    expect(tab.history.index).toBe(0);
  });
});

// ─── Review findings ─────────────────────────────────────────────────────────

/** Replace the frame's last report, as a render of the canvas does. */
function frameRendered(): void {
  tab.session.canvas.bindings = { bindings: [], entries: {} };
  tab.session.canvas.scope = {};
}

/** The text of the Now line. */
function nowText(): string {
  return part("now-value")?.textContent.trim() ?? "";
}

/** Type into Advanced without applying. */
async function typeDraft(text: string): Promise<void> {
  const field = controlOf("expression");
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await flush(6);
}

/** Press Apply under Advanced. */
async function apply(): Promise<void> {
  part("apply")?.querySelector<HTMLElement>('[part="control"]')?.click();
  await flush(10);
}

describe("opening one tag after another", () => {
  const TWO = "${state.heading} and ${state.episodes}";

  test("the command moves to the next tag of one slot, of another node, and of another slot", async () => {
    mutateUpdateProperty(tab, CUSTOM, "textContent", TWO);
    await open(CUSTOM, ["textContent"], 0);
    expect(controlOf("source").value).toBe("state.heading");
    await open(CUSTOM, ["textContent"], 1);
    expect(tab.session.ui.tagPopover).toEqual({ index: 1, path: CUSTOM, slot: ["textContent"] });
    expect(controlOf("source").value).toBe("state.episodes");
    // Same slot and index, another node.
    await open(CUSTOM, ["textContent"], 0);
    await open(TITLE, ["textContent"], 0);
    expect(tab.session.ui.tagPopover?.path).toEqual(TITLE);
    // Same node and index, another slot.
    await open(IMAGE, ["attributes", "src"]);
    await open(IMAGE, ["attributes", "alt"]);
    expect(tab.session.ui.tagPopover?.slot).toEqual(["attributes", "alt"]);
  });

  test("a door does the same, and the same tag pressed again is not a move", async () => {
    mutateUpdateProperty(tab, CUSTOM, "textContent", TWO);
    openTagPopover({ index: 0, path: CUSTOM, slot: ["textContent"] });
    await flush(8);
    openTagPopover({ index: 1, path: CUSTOM, slot: ["textContent"] });
    await flush(8);
    expect(tab.session.ui.tagPopover?.index).toBe(1);
    openTagPopover({ index: 0, path: CUSTOM, slot: ["textContent"] });
    await flush(8);
    openTagPopover({ index: 0, path: TITLE, slot: ["textContent"] });
    await flush(8);
    expect(tab.session.ui.tagPopover?.path).toEqual(TITLE);
    openTagPopover({ index: 0, path: IMAGE, slot: ["attributes", "src"] });
    await flush(8);
    openTagPopover({ index: 0, path: IMAGE, slot: ["attributes", "alt"] });
    await flush(8);
    expect(tab.session.ui.tagPopover?.slot).toEqual(["attributes", "alt"]);
  });
});

describe("what a write keeps", () => {
  test("a { $ref } attribute stays a reference when its source is changed", async () => {
    mutateUpdateAttribute(tab, IMAGE, "href", { $ref: "#/state/heading" });
    await open(IMAGE, ["attributes", "href"]);
    await commit("source", "state.episodes");
    expect(getNodeAtPath(tab.doc.document, IMAGE)?.attributes?.["href"]).toEqual({
      $ref: "#/state/episodes",
    });
  });

  test("a { $ref } style value stays a reference when its source is changed", async () => {
    const node = getNodeAtPath(tab.doc.document, TITLE);
    if (node) {
      node.style = { color: "${state.heading}", width: { $ref: "#/state/heading" } };
    }
    await open(TITLE, ["style", "width"]);
    await commit("source", "state.episodes");
    expect(getNodeAtPath(tab.doc.document, TITLE)?.style?.["width"]).toEqual({
      $ref: "#/state/episodes",
    });
    expect(getNodeAtPath(tab.doc.document, TITLE)?.style?.["color"]).toBe("${state.heading}");
    undo(tab);
    expect(getNodeAtPath(tab.doc.document, TITLE)?.style?.["width"]).toEqual({
      $ref: "#/state/heading",
    });
  });

  test("a source that is the pointer already stored writes nothing", async () => {
    await open(REF, ["textContent"]);
    await commit("source", "state.heading");
    expect(tab.history.index).toBe(0);
  });

  test("the Show field reads the stored ! form", async () => {
    mutateUpdateAttribute(tab, IMAGE, "src", "${!item.data.image}");
    await open(IMAGE, ["attributes", "src"]);
    expect(controlOf("show").value).toBe("1");
    mutateUpdateAttribute(tab, IMAGE, "src", "${!!item.data.image}");
    await flush(8);
    expect(controlOf("show").value).toBe("2");
  });

  test("Source away and back stores the optional steps the author began with", async () => {
    mutateUpdateProperty(tab, TITLE, "textContent", "${$map.item?.data?.title ?? ''}");
    await open(TITLE, ["textContent"]);
    expect(controlOf("source").value).toBe("item.data.title");
    await commit("source", "item.data.date");
    await commit("source", "item.data.title");
    expect(held(TITLE, "textContent")).toBe("${$map.item?.data?.title ?? ''}");
  });

  test("a pointer made a template by a fallback keeps its optional steps on the next source", async () => {
    await open(REF, ["textContent"]);
    await commit("fallback-when", "||");
    expect(held(REF, "textContent")).toBe("${state?.heading || ''}");
    await commit("source", "state.episodes");
    expect(held(REF, "textContent")).toBe("${state?.episodes || ''}");
  });
});

describe("the Now line", () => {
  test("a resolved binding shows the frame's value, and one reported for another node is not this tag's", async () => {
    answers.set("${$map.item.data.title ?? ''}", { text: "One" });
    tab.session.canvas.bindings = {
      bindings: [
        {
          error: "404",
          path: IMAGE,
          source: "${$map.item.data.title ?? ''}",
          status: "failed",
        },
        { path: TITLE, source: "${$map.item.data.title ?? ''}", status: "resolved" },
      ],
      entries: {},
    };
    await open(TITLE, ["textContent"]);
    expect(nowText()).toBe("One");
    expect(part("now")?.dataset.state).toBe("value");
  });

  test("a tag opened again after the canvas changed asks again", async () => {
    answers.set("${$map.item.data.title ?? ''}", { text: "One" });
    await open(TITLE, ["textContent"]);
    expect(nowText()).toBe("One");
    await registry.run("canvas.setTagPopover", { tag: null });
    await flush(6);
    answers.set("${$map.item.data.title ?? ''}", { text: "Two" });
    await open(TITLE, ["textContent"]);
    expect(nowText()).toBe("Two");
  });

  test("a reply that arrives after another tag was opened is not shown for it", async () => {
    answers.set("${$map.item.data.title ?? ''}", { text: "One" });
    answers.set("${item.data.image}", { text: "Picture" });
    holding = [];
    await open(TITLE, ["textContent"]);
    await open(IMAGE, ["attributes", "src"]);
    expect(holding).toHaveLength(2);
    // The second reply first, then the first one, late.
    holding[1]?.();
    await flush(6);
    holding[0]?.();
    await flush(6);
    expect(nowText()).toBe("Picture");
  });

  test("it follows the active row", async () => {
    answers.set("${$map.item.data.title ?? ''}", { text: "One" });
    await open(TITLE, ["textContent"]);
    expect(nowText()).toBe("One");
    answers.set("${$map.item.data.title ?? ''}", { text: "Two" });
    tab.session.ui.activeRows = { [JSON.stringify(["children", 0])]: 1 };
    await flush(8);
    expect(nowText()).toBe("Two");
  });

  test("it follows a state value set for the canvas, and a render that reports new bindings", async () => {
    answers.set("${$map.item.data.title ?? ''}", { text: "One" });
    await open(TITLE, ["textContent"]);
    answers.set("${$map.item.data.title ?? ''}", { text: "Two" });
    tab.session.ui.stateValues = { heading: "Other" };
    await flush(8);
    expect(nowText()).toBe("Two");
    answers.set("${$map.item.data.title ?? ''}", { text: "Three" });
    frameRendered();
    await flush(8);
    expect(nowText()).toBe("Three");
  });

  test("a packaged format used for the first time is asked again once the frame has drawn it", async () => {
    frameFormulas.delete("formatDate");
    try {
      mutateUpdateProperty(tab, DATE, "textContent", "${item.data.date}");
      await open(DATE, ["textContent"]);
      answers.set("${item.data.date}", { text: "2026-10-29", type: "string" });
      await pickFormat('formatDate:{"dateStyle":"long"}');
      expect(String(held(DATE, "textContent"))).toContain("state.formatDate(");
      // The frame has not drawn the copied formula yet: the answer is its failure.
      expect(nowText()).toContain("is not a function");
      // It draws, and reports: the same tag is asked again and the answer is a value.
      frameFormulas.add("formatDate");
      frameRendered();
      await flush(10);
      expect(nowText()).not.toContain("is not a function");
      expect(formats().length).toBeGreaterThan(1);
    } finally {
      frameFormulas.add("formatDate");
    }
  });

  test("no frame at the time is asked again at the next report", async () => {
    frameUp = false;
    await open(TITLE, ["textContent"]);
    expect(nowText()).toBe("Not drawn");
    frameUp = true;
    answers.set("${$map.item.data.title ?? ''}", { text: "One" });
    frameRendered();
    await flush(8);
    expect(nowText()).toBe("One");
  });
});

describe("a tag that is not the one that was opened", () => {
  test("a tag whose node was removed does not hand its popover to the node that took its place", async () => {
    await open(TITLE, ["textContent"]);
    mutateRemoveNode(tab, TITLE);
    await flush(12);
    expect(tab.session.ui.tagPopover).toBeNull();
    const before = tab.history.index;
    await flush(4);
    expect(tab.history.index).toBe(before);
  });

  test("a tag whose neighbour left the string does not hand its popover to the next", async () => {
    mutateUpdateProperty(tab, CUSTOM, "textContent", "${state.heading} and ${state.episodes}");
    await open(CUSTOM, ["textContent"], 1);
    mutateUpdateProperty(tab, CUSTOM, "textContent", "${state.episodes}");
    await flush(10);
    expect(tab.session.ui.tagPopover).toBeNull();
  });

  test("an edit made to the open tag itself does not close it", async () => {
    await open(TITLE, ["textContent"]);
    await commit("fallback-text", "Untitled");
    expect(tab.session.ui.tagPopover).not.toBeNull();
    undo(tab);
    await flush(8);
    expect(tab.session.ui.tagPopover).not.toBeNull();
  });

  test("leaving the tab closes its popover, and coming back does not reopen it", async () => {
    await open(TITLE, ["textContent"]);
    const first = tab;
    openTab({ document: { tagName: "div" }, documentPath: "pages/other.json", id: "other-tab" });
    await flush(8);
    expect(first.session.ui.tagPopover).toBeNull();
    activateTab(first.id);
    await flush(8);
    expect(panel().matches(":popover-open")).toBe(false);
  });
});

describe("Advanced", () => {
  test("a draft abandoned for one tag is not shown for, or applied to, another with the same expression", async () => {
    mutateUpdateProperty(tab, DATE, "textContent", `\${${CUSTOM_EXPR}}`);
    await open(CUSTOM, ["textContent"]);
    await typeDraft("state.heading + ' DRAFT'");
    await registry.run("canvas.setTagPopover", { tag: null });
    await flush(8);
    const before = tab.history.index;
    await open(DATE, ["textContent"]);
    expect(controlOf("expression").value).toBe(CUSTOM_EXPR);
    await apply();
    expect(held(DATE, "textContent")).toBe(`\${${CUSTOM_EXPR}}`);
    expect(tab.history.index).toBe(before);
  });

  test("a draft for the first of two identical tags is not carried to the second", async () => {
    mutateUpdateProperty(tab, CUSTOM, "textContent", "${state.heading} and ${state.heading}");
    await open(CUSTOM, ["textContent"], 0);
    await typeDraft("state.heading ?? 'DRAFT'");
    await open(CUSTOM, ["textContent"], 1);
    expect(controlOf("expression").value).toBe("state.heading");
  });

  test("a draft that would unbalance the template is refused and says why", async () => {
    const text = "A ${state.heading} B ${state.heading} C";
    for (const draft of ["state.heading ? {", "state.heading }", "`${"]) {
      mutateUpdateProperty(tab, CUSTOM, "textContent", text);
      await flush(4);
      const before = tab.history.index;
      await open(CUSTOM, ["textContent"], 0);
      await typeDraft(draft);
      expect(part("advanced-note")?.textContent.trim()).not.toBe("Kept as a custom expression.");
      expect(part("advanced-note")?.textContent.trim()).not.toBe("");
      await apply();
      expect(held(CUSTOM, "textContent")).toBe(text);
      expect(tab.history.index).toBe(before);
      await registry.run("canvas.setTagPopover", { tag: null });
      await flush(6);
    }
  });
});
