/**
 * The canvas stage, as a mounted document (`src/surfaces/canvas-stage.ts` + `.json`).
 *
 * `canvas-render.ts`'s own suite drives this through a real render; these tests drive the ADAPTER,
 * which is where the three things a render cannot easily provoke live: a mount torn down before it
 * resolved, a breakpoint that stops being declared, and the translation from a bound `part` to the
 * name the flow asked for.
 */

import "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { mountCanvasStage } from "../src/surfaces/canvas-stage";
import type { CanvasStagePanelItem, CanvasStageView } from "../src/surfaces/canvas-stage";

/** One board, as the document reads it. */
function board(key: string, over: Partial<CanvasStagePanelItem> = {}): CanvasStagePanelItem {
  return {
    fullWidth: false,
    header: "shown",
    key,
    label: `${key} (768px)`,
    mediaAttr: key,
    widthVars: "--panel-viewport-w:768px;--panel-canvas-w:768px",
    ...over,
  };
}

/** A pan/zoom stage over the given boards. */
function boardsView(keys: string[], over: Partial<CanvasStageView> = {}): CanvasStageView {
  return {
    columnHeader: "hidden",
    frame: "boards",
    framePart: "panzoom",
    frameVars: "",
    handles: "hidden",
    hug: false,
    innerPart: "boards",
    lead: "none",
    panels: keys.map((key) => board(key)),
    ...over,
  };
}

/** Every host the stage announced, in call order. */
let announced: { part: string; detail: string }[] = [];
/** Every breakpoint a header click asked for. */
let picked: string[] = [];

const actions = {
  host: (part: string, _element: HTMLElement, detail: string) => announced.push({ detail, part }),
  pickPanel: (key: string) => picked.push(key),
};

function host(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

beforeEach(() => {
  announced = [];
  picked = [];
  document.body.innerHTML = "";
});

describe("the frame's bound parts", () => {
  test("a host is announced under the name the VIEW chose, not the one written in the document", async () => {
    /* The frame and its inner box carry a `part` the view picks, because Preview's column, the
       pan/zoom surface and Edit's column are one shape with three names. A node is announced as it
       is BUILT — before its attributes are settled — so the announcement cannot read the resolved
       name off the element, and reading the raw template text off the definition would announce
       every stage's frame as the literal `${state.framePart}`. */
    const stage = mountCanvasStage(
      host(),
      boardsView(["base"], { framePart: "edit-canvas", innerPart: "edit-column" }),
      actions,
    );
    await stage.ready;
    const names = announced.map((a) => a.part);
    expect(names).toContain("edit-canvas");
    expect(names).toContain("edit-column");
    expect(names.some((name) => name.includes("${"))).toBe(false);
    stage.dispose();
  });

  test("the handles are announced with the side they are on", async () => {
    const stage = mountCanvasStage(
      host(),
      boardsView(["base"], {
        framePart: "edit-canvas",
        handles: "shown",
        innerPart: "edit-column",
      }),
      actions,
    );
    await stage.ready;
    const handles = announced.filter((a) => a.part === "edit-handle").map((a) => a.detail);
    expect(handles).toEqual(["start", "end"]);
    stage.dispose();
  });

  test("the Document Header host is announced with its placement", async () => {
    const stage = mountCanvasStage(host(), boardsView(["base"], { lead: "header" }), actions);
    await stage.ready;
    expect(announced.find((a) => a.part === "doc-header")?.detail).toBe("pinned");
    stage.dispose();
  });

  test("the two Monaco frames hold no boards at all", async () => {
    // An empty `$map` inside an editor's host would leave nodes in a box Monaco is about to take
    // Over, which is why those two frames are cases of their own rather than a boards frame.
    const stage = mountCanvasStage(
      host(),
      { ...boardsView([]), frame: "code", lead: "toolbar" },
      actions,
    );
    await stage.ready;
    const names = announced.map((a) => a.part);
    expect(names).toContain("diff-code-editor");
    expect(names).toContain("diff-toolbar");
    expect(stage.panelNode("base", "panel")).toBeNull();
    stage.dispose();
  });
});

describe("the boards a repaint keeps", () => {
  test("a board that survives a repaint keeps its node — that is the iframe not reloading", async () => {
    const stage = mountCanvasStage(host(), boardsView(["base", "md"]), actions);
    await stage.ready;
    const first = stage.panelNode("md", "panel-canvas");
    expect(first).not.toBeNull();

    await stage.update(boardsView(["base", "md", "lg"]));
    expect(stage.panelNode("md", "panel-canvas")).toBe(first);
    expect(stage.panelNode("lg", "panel-canvas")).not.toBeNull();
    stage.dispose();
  });

  test("a breakpoint the document stops declaring cannot hand its old node back later", async () => {
    /* The name is the key, so a project that drops `md` and later declares it again would otherwise
       be handed the nodes of a board that has been gone for two renders — a record pointing at
       detached DOM, which reads as an artboard that renders nothing. */
    const stage = mountCanvasStage(host(), boardsView(["base", "md"]), actions);
    await stage.ready;
    const stale = stage.panelNode("md", "panel");

    await stage.update(boardsView(["base"]));
    expect(stage.panelNode("md", "panel")).toBeNull();

    await stage.update(boardsView(["base", "md"]));
    expect(stage.panelNode("md", "panel")).not.toBe(stale);
    stage.dispose();
  });

  test("a board with no label draws no header, and one with a label draws a click target", async () => {
    const stage = mountCanvasStage(
      host(),
      boardsView([], {
        panels: [board("base"), board("solo", { header: "hidden", label: "" })],
      }),
      actions,
    );
    await stage.ready;
    expect(stage.panelNode("solo", "panel")!.querySelector('[part="panel-header"]')).toBeNull();
    const header = stage.panelNode("base", "panel")!.querySelector('[part="panel-header"]');
    (header as HTMLElement).click();
    expect(picked).toEqual(["base"]);
    stage.dispose();
  });
});

describe("a stage that is torn down before it stands up", () => {
  test("disposing before the mount resolves leaves nothing in the host", async () => {
    /* A mode transition can land inside the mount's own await — `kitReady()` is a promise chain —
       and a stage that then attached would be a document drawing into a pane that has already
       handed its cell to grid mode. */
    const into = host();
    const stage = mountCanvasStage(into, boardsView(["base"]), actions);
    stage.dispose();
    await stage.ready;
    expect(into.childElementCount).toBe(0);
    expect(stage.panelNode("base", "panel")).toBeNull();
  });

  test("disposing twice is a no-op rather than a throw", async () => {
    const stage = mountCanvasStage(host(), boardsView(["base"]), actions);
    await stage.ready;
    stage.dispose();
    expect(() => stage.dispose()).not.toThrow();
  });
});
