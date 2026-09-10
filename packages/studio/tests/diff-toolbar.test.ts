/**
 * The diff stage's toolbar: what it says, and what its stepper does.
 *
 * The toolbar renders per pane and re-renders itself, never through `renderCanvas` — a step that
 * rebuilt the stage would remount both artboard iframes, tearing down the documents it is trying to
 * move you through. These tests drive the mounted surface and the store directly; the measure and
 * the pan are `iframe-host`'s and `canvas-utils`'s, mocked because happy-dom has no layout.
 */

import "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChangeMap } from "../src/canvas/diff-marks";

/** Rects the next measures answer with, in call order. `null` means "no stamped element". */
let measureQueue: ({ top: number; height: number } | null)[] = [];
const measured: unknown[][] = [];
const panned: { top: number; height: number }[] = [];
const announced: string[] = [];
/** Whether `hostForCanvas` finds an artboard host; the reveal only runs when it does. */
let hostResult: unknown = null;
/** Make the next measure blow up, to exercise the click handler's failure path. */
let measureThrows = false;
const revealed: unknown[] = [];

void mock.module("../src/canvas/iframe-host.js", () => ({
  hostForCanvas: () => hostResult,
  measureInCanvas: (canvas: unknown, path: unknown) => {
    if (measureThrows) {
      throw new Error("measure exploded");
    }
    measured.push([canvas, path]);
    return Promise.resolve(measureQueue.shift() ?? null);
  },
  revealCanvasPathIn: (host: unknown, path: unknown) => {
    revealed.push([host, path]);
    return Promise.resolve(null);
  },
}));

void mock.module("../src/canvas/canvas-utils.js", () => ({
  panToParentRect: (rect: { top: number; height: number }) => panned.push(rect),
}));

// Both artboards exist as far as the stepper is concerned; only their rects are stubbed.
const surfaces = new Map<string, { panels: unknown[]; prevCanvasMode: string | null }>();
void mock.module("../src/canvas/canvas-surface.js", () => ({
  surfaceForPane: (paneId: string) => {
    const existing = surfaces.get(paneId);
    if (existing) {
      return existing;
    }
    const fresh = {
      panels: [{ canvas: { id: "original" } }, { canvas: { id: "current" } }],
      prevCanvasMode: "git-diff" as string | null,
    };
    surfaces.set(paneId, fresh);
    return fresh;
  },
}));

/* Switching Visual/Code rebuilds the STAGE, not just the toolbar — the two are different renders.
   The repaint is INJECTED (`canvas-render.ts` imports this module, so it cannot be imported back),
   which makes it a spy rather than a module mock. */
const repainted: string[] = [];

void mock.module("../src/services/announce.js", () => ({
  announce: (message: string) => announced.push(message),
}));

const { renderDiffToolbar, setDiffRepaint, setDiffToolbarHost, stepDiffAndReveal } =
  await import("../src/canvas/diff-toolbar");
setDiffRepaint((paneId: string) => repainted.push(paneId));
const { diffStepOf, diffViewOf, resetDiffViews, setDiffChangeMap, setDiffView } =
  await import("../src/canvas/diff-view");
const { flush } = await import("./harness");

const mapOf = (steps: ChangeMap["steps"], extra: Partial<ChangeMap> = {}): ChangeMap => ({
  current: [],
  degraded: false,
  original: [],
  rootKeys: [],
  steps,
  ...extra,
});

const modified = (i: number) => ({
  currentPath: ["children", i],
  kind: "modified" as const,
  originalPath: ["children", i],
});

/**
 * The bar draws into a host the stage gives it, and keeps ONE mounted document there — so this
 * hands a pane the same host every time, exactly as a stage that is not being rebuilt does.
 */
const hosts = new Map<string, HTMLElement>();
async function draw(paneId: string): Promise<HTMLElement> {
  let host = hosts.get(paneId);
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
    hosts.set(paneId, host);
    setDiffToolbarHost(paneId, host);
  }
  renderDiffToolbar(paneId);
  await flush();
  return host;
}

/* By ELEMENT, not by `[role='radio']`. The role is the KIT's now — `jx-action-group selects=single`
   is the radiogroup and `checked` is what makes each button a radio — and it lands on the control
   inside each button rather than on the host, which is exactly why the old spelling could not
   survive: the template wrote `role="radio"` on `sp-action-button` and Spectrum overwrote it with
   `role="button"` plus `aria-pressed` the moment the element upgraded. */
const radios = (el: HTMLElement) =>
  [...el.querySelectorAll('[part="view"] jx-action-button')] as HTMLElement[];

/** What a radio announces, read where the kit writes it: the control inside the button. */
const checked = (button: HTMLElement) =>
  button.querySelector('[part="control"]')?.getAttribute("aria-checked") ?? null;

/** One stepper button, by the `part` the document draws it with. */
const stepper = (el: HTMLElement, which: "previous" | "next") =>
  el.querySelector(`[part="${which}"]`) as HTMLElement | null;

beforeEach(() => {
  resetDiffViews();
  measured.length = 0;
  panned.length = 0;
  announced.length = 0;
  revealed.length = 0;
  hostResult = null;
  measureThrows = false;
  measureQueue = [];
  repainted.length = 0;
  surfaces.clear();
  for (const [paneId, host] of hosts) {
    setDiffToolbarHost(paneId, null);
    host.remove();
  }
  hosts.clear();
});

describe("what the toolbar says", () => {
  test("names the count before the first step, not a position", async () => {
    setDiffChangeMap("primary", mapOf([modified(0), modified(1), modified(2)]));
    const el = await draw("primary");
    expect(el.textContent).toContain("3 changes");
  });

  test("counts one change in the singular", async () => {
    setDiffChangeMap("primary", mapOf([modified(0)]));
    const el = await draw("primary");
    expect(el.textContent).toContain("1 change");
    expect(el.textContent).not.toContain("1 changes");
  });

  test("switches to a position once stepping", async () => {
    setDiffChangeMap("primary", mapOf([modified(0), modified(1)]));
    measureQueue = [null, null];
    await stepDiffAndReveal("primary", 1);
    const el = await draw("primary");
    expect(el.textContent).toContain("1 of 2");
  });

  test("says so when there is nothing to compare, and draws no stepper", async () => {
    setDiffChangeMap("primary", mapOf([]));
    const el = await draw("primary");
    expect(el.textContent).toContain("No changes");
    expect(el.querySelector('[part="count"]')).not.toBeNull();
    // No stepper at all — the count stands alone rather than between two dead buttons.
    expect(stepper(el, "previous")).toBeNull();
    expect(stepper(el, "next")).toBeNull();
  });

  test("reports a degraded alignment rather than hiding it", async () => {
    setDiffChangeMap("primary", mapOf([modified(0)], { degraded: true }));
    const el = await draw("primary");
    expect(el.textContent).toContain("some shown as add/remove");
  });

  test("states root-key changes in words, since they are never tinted", async () => {
    setDiffChangeMap("primary", mapOf([], { rootKeys: ["state"] }));
    const el = await draw("primary");
    expect(el.textContent).toContain("document settings changed");
  });

  test("offers Visual and Code when there is a visual half", async () => {
    setDiffChangeMap("primary", mapOf([modified(0)]));
    const el = await draw("primary");
    expect(radios(el).map((b) => b.textContent?.trim())).toEqual(["Visual", "Code"]);
  });

  test("draws Code as static text when the comparison has no visual half", async () => {
    // A file the canvas cannot render reaches the toolbar with a null map. The Visual button is
    // Never drawn disabled — that is the rule a one-value axis follows everywhere else.
    setDiffChangeMap("primary", null);
    const el = await draw("primary");
    expect(el.querySelector('[part="view-static"]')?.textContent).toBe("Code");
    expect(radios(el)).toHaveLength(0);
    expect(el.textContent).toContain("Changed lines are marked");
  });

  test("the Code button switches the view and rebuilds the stage", async () => {
    setDiffChangeMap("primary", mapOf([modified(0)]));
    const el = await draw("primary");
    radios(el)[1]!.click();
    await flush();
    expect(diffViewOf("primary")).toBe("code");
    expect(repainted).toEqual(["primary"]);
    // The documented "this stage's structure is stale" signal, without which the repaint sees
    // `modeChanged === false` and skips the setup the other branch needs.
    expect(surfaces.get("primary")?.prevCanvasMode).toBeNull();
  });

  test("re-selecting the view already shown rebuilds nothing", async () => {
    setDiffChangeMap("primary", mapOf([modified(0)]));
    const el = await draw("primary");
    radios(el)[0]!.click();
    await flush();
    expect(repainted).toEqual([]);
  });

  test("the view choice survives a redraw", async () => {
    setDiffChangeMap("primary", mapOf([modified(0)]));
    setDiffView("primary", "code");
    const el = await draw("primary");
    expect(radios(el).map((button) => checked(button))).toEqual(["false", "true"]);
  });
});

describe("stepping", () => {
  test("pans to the UNION of the two sides' rects", async () => {
    /* The two artboards share one panzoom wrap and therefore one vertical offset, so a change
       sitting at a different height on each side is only fully readable if the move spans both. */
    setDiffChangeMap("primary", mapOf([modified(0)]));
    measureQueue = [
      { height: 40, top: 100 },
      { height: 40, top: 300 },
    ];
    await stepDiffAndReveal("primary", 1);
    expect(panned.at(-1)).toEqual({ height: 240, top: 100 });
  });

  test("a one-sided change measures only the side that has it", async () => {
    setDiffChangeMap(
      "primary",
      mapOf([{ currentPath: null, kind: "removed", originalPath: ["children", 0] }]),
    );
    measureQueue = [{ height: 20, top: 50 }];
    await stepDiffAndReveal("primary", 1);
    expect(diffStepOf("primary")).toBe(0);
    expect(measured).toHaveLength(1);
    expect(panned.at(-1)).toEqual({ height: 20, top: 50 });
  });

  test("a change whose node is unstamped advances the cursor and says so", async () => {
    // Component internals and repeater rows past the first resolve to no element. The count still
    // Names the change and the Code view still shows it; there is simply nowhere to pan.
    setDiffChangeMap("primary", mapOf([modified(0), modified(1)]));
    measureQueue = [null, null];
    await stepDiffAndReveal("primary", 1);
    expect(diffStepOf("primary")).toBe(0);
    expect(panned).toHaveLength(0);
    expect(announced.at(-1)).toContain("Not shown on the canvas");
  });

  test("announces where it landed, naming the kind in words", async () => {
    setDiffChangeMap("primary", mapOf([modified(0), modified(1)]));
    measureQueue = [{ height: 10, top: 10 }, null];
    await stepDiffAndReveal("primary", 1);
    expect(announced.at(-1)).toBe("Change 1 of 2, changed.");
  });

  test("refuses at the end without moving the cursor", async () => {
    setDiffChangeMap("primary", mapOf([modified(0)]));
    measureQueue = [null, null];
    await stepDiffAndReveal("primary", 1);
    panned.length = 0;
    await stepDiffAndReveal("primary", 1);
    expect(diffStepOf("primary")).toBe(0);
    expect(panned).toHaveLength(0);
  });
});

describe("the commands", () => {
  const byId = async (id: string) => {
    const { diffCommands } = await import("../src/canvas/diff-toolbar");
    return diffCommands().find((command) => command.id === id)!;
  };
  const ctx = (kind: string) => ({ editor: { kind } }) as never;

  test("declare the GLOBAL key scope, not canvas", async () => {
    /* Not a preference. `keyScopeStack` switches on `ctx.editor.kind` and "diff" falls through to
       the default arm — its own docstring names the diff view as one of the surfaces that "get the
       bare global stack". A chord declared in the canvas scope would never fire here. */
    const next = await byId("diff.nextChange");
    expect(next.keyScope).toBe("global");
    expect(next.keybinding).toBe("f7");
    const previous = await byId("diff.previousChange");
    expect(previous.keybinding).toBe("shift+f7");
  });

  test("show only on a diff editor", async () => {
    const next = await byId("diff.nextChange");
    expect(next.when?.(ctx("diff"))).toBe(true);
    expect(next.when?.(ctx("canvas"))).toBe(false);
  });

  test("are disabled when the focused pane has no changes", async () => {
    const { workspace } = await import("../src/workspace/workspace");
    const next = await byId("diff.nextChange");
    expect(next.enablement?.(ctx("diff"))).toBe(false);
    setDiffChangeMap(workspace.activePaneId, mapOf([modified(0)]));
    expect(next.enablement?.(ctx("diff"))).toBe(true);
  });

  test("diff.nextChange steps the pane it is given", async () => {
    setDiffChangeMap("secondary", mapOf([modified(0), modified(1)]));
    measureQueue = [null, null];
    const next = await byId("diff.nextChange");
    await next.run(ctx("diff"), { pane: "secondary" } as never);
    expect(diffStepOf("secondary")).toBe(0);
  });

  test("diff.previousChange steps backwards", async () => {
    setDiffChangeMap("secondary", mapOf([modified(0), modified(1)]));
    measureQueue = [null, null, null, null];
    const previous = await byId("diff.previousChange");
    await previous.run(ctx("diff"), { pane: "secondary" } as never);
    expect(diffStepOf("secondary")).toBe(1);
  });

  test("with no pane argument they act on the focused one", async () => {
    const { workspace } = await import("../src/workspace/workspace");
    setDiffChangeMap(workspace.activePaneId, mapOf([modified(0)]));
    measureQueue = [null, null];
    const next = await byId("diff.nextChange");
    await next.run(ctx("diff"), {} as never);
    expect(diffStepOf(workspace.activePaneId)).toBe(0);
  });

  test("diff.setView is an idempotent setter, never a toggle", async () => {
    // The screenshot contract refuses a `toggle*` id: a verb whose result depends on the state it
    // Is called in cannot be driven, or photographed, honestly.
    const setView = await byId("diff.setView");
    setDiffChangeMap("secondary", mapOf([modified(0)]));
    await setView.run(ctx("diff"), { pane: "secondary", view: "code" } as never);
    expect(diffViewOf("secondary")).toBe("code");
    // Called again with the same value it is a no-op, which is what "idempotent" has to mean for a
    // Verb a screenshot step or the assistant may repeat.
    await setView.run(ctx("diff"), { pane: "secondary", view: "code" } as never);
    expect(diffViewOf("secondary")).toBe("code");
    expect(repainted).toEqual(["secondary"]);
    await setView.run(ctx("diff"), { pane: "secondary", view: "visual" } as never);
    expect(diffViewOf("secondary")).toBe("visual");
  });

  test("diff.setView refuses a view it does not offer", async () => {
    const setView = await byId("diff.setView");
    expect(() => setView.run(ctx("diff"), { view: "sideways" } as never)).toThrow();
  });
});

describe("the toolbar's host", () => {
  test("renders into the element the stage handed it, and forgets it on teardown", async () => {
    setDiffChangeMap("primary", mapOf([modified(0), modified(1)]));
    const host = document.createElement("div");
    document.body.append(host);
    setDiffToolbarHost("primary", host);
    renderDiffToolbar("primary");
    await flush();
    expect(host.textContent).toContain("2 changes");

    // The stage's teardown passes null. A later redraw must be a no-op, not a throw.
    setDiffToolbarHost("primary", null);
    host.textContent = "";
    renderDiffToolbar("primary");
    await flush();
    expect(host.textContent).toBe("");
    host.remove();
  });

  test("a new host is a new mount; the old document does not keep drawing", async () => {
    /* A stage rebuild hands the bar a different box. The mount is kept across a REDRAW — that is
       what stops a step from remounting a document several times a second — so the one thing that
       must still end it is the host changing underneath it. */
    setDiffChangeMap("primary", mapOf([modified(0), modified(1)]));
    const first = document.createElement("div");
    document.body.append(first);
    setDiffToolbarHost("primary", first);
    renderDiffToolbar("primary");
    await flush();
    expect(first.textContent).toContain("2 changes");

    const second = document.createElement("div");
    document.body.append(second);
    setDiffToolbarHost("primary", second);
    renderDiffToolbar("primary");
    await flush();
    expect(second.textContent).toContain("2 changes");
    expect(first.textContent).toBe("");
    first.remove();
    second.remove();
  });

  test("a host dropped inside the mount's own await leaves nothing behind", async () => {
    /* A mode transition can land between the redraw and the document standing up — `kitReady()` is
       a promise chain — and a bar that then attached would be drawing into a box the stage has
       already thrown away. */
    setDiffChangeMap("primary", mapOf([modified(0)]));
    const into = document.createElement("div");
    document.body.append(into);
    setDiffToolbarHost("primary", into);
    renderDiffToolbar("primary");
    setDiffToolbarHost("primary", null);
    await flush();
    expect(into.childElementCount).toBe(0);
    into.remove();
  });

  test("a redraw for a pane that never had a host does nothing", () => {
    expect(() => renderDiffToolbar("never-drawn")).not.toThrow();
  });
});

describe("the stepper buttons", () => {
  test("drive the same step the commands do", async () => {
    setDiffChangeMap("primary", mapOf([modified(0), modified(1)]));
    measureQueue = [null, null, null, null];
    const el = await draw("primary");
    stepper(el, "next")!.click();
    await flush();
    expect(diffStepOf("primary")).toBe(0);

    stepper(el, "previous")!.click();
    await flush();
    // Already at the first change, so the step refuses and the cursor holds.
    expect(diffStepOf("primary")).toBe(0);
  });
});

describe("the reveal", () => {
  test("re-measures through the host once the pan has landed", async () => {
    /* The point BEFORE the move is not the point a caller can act on — `revealCanvasPath`'s own
       rule, and why the step does not stop at the pan. */
    setDiffChangeMap("primary", mapOf([modified(0)]));
    hostResult = { id: "current-host" };
    measureQueue = [
      { height: 10, top: 10 },
      { height: 10, top: 10 },
    ];
    await stepDiffAndReveal("primary", 1);
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toEqual([{ id: "current-host" }, ["children", 0]]);
  });

  test("is skipped for a removal, which has no current side to reveal", async () => {
    setDiffChangeMap(
      "primary",
      mapOf([{ currentPath: null, kind: "removed", originalPath: ["children", 0] }]),
    );
    hostResult = { id: "current-host" };
    measureQueue = [{ height: 10, top: 10 }];
    await stepDiffAndReveal("primary", 1);
    expect(revealed).toHaveLength(0);
  });
});

describe("a failing reveal", () => {
  test("does not escape the click handler, and leaves the cursor where it moved to", async () => {
    /* The cursor moves and the toolbar redraws BEFORE the measure, so a reveal that throws leaves
       a correct toolbar over a canvas that did not move — which is worth nothing more than a
       console warning. An unhandled rejection out of a lit event handler would be. */
    setDiffChangeMap("primary", mapOf([modified(0), modified(1)]));
    measureThrows = true;
    const el = await draw("primary");
    const next = stepper(el, "next")!;
    expect(() => next.click()).not.toThrow();
    await flush();
    expect(diffStepOf("primary")).toBe(0);
  });
});

describe("every diff command's predicates", () => {
  test("all three show only on a diff editor and gate on there being changes", async () => {
    const { diffCommands } = await import("../src/canvas/diff-toolbar");
    const { workspace } = await import("../src/workspace/workspace");
    const commands = diffCommands();
    expect(commands.map((command) => command.id)).toEqual([
      "diff.nextChange",
      "diff.previousChange",
      "diff.setView",
    ]);
    for (const command of commands) {
      expect(command.when?.({ editor: { kind: "diff" } } as never)).toBe(true);
      expect(command.when?.({ editor: { kind: "canvas" } } as never)).toBe(false);
      expect(command.level).toBe("document");
      expect(command.category).toBe("View");
    }
    // The steppers gate on there being somewhere to step; setting the view does not.
    const [next, previous, setView] = commands;
    expect(next!.enablement?.({} as never)).toBe(false);
    expect(previous!.enablement?.({} as never)).toBe(false);
    expect(setView!.enablement).toBeUndefined();
    setDiffChangeMap(workspace.activePaneId, mapOf([modified(0)]));
    expect(next!.enablement?.({} as never)).toBe(true);
    expect(previous!.enablement?.({} as never)).toBe(true);
  });
});
