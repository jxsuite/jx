/// <reference lib="dom" />
/**
 * The diff stage's own chrome: how many changes there are, and how to walk them.
 *
 * **This is the flow; `surfaces/diff-toolbar.json` is the markup.** What the count means for the
 * half that is showing, which step is reachable, whether a comparison has a visual half at all and
 * what a step does to both artboards are decided here; the bar's structure, ARIA, keyboard and
 * style live in the document beside it.
 *
 * **It owns its own reactivity from here**, the way `renderGridMode` does. A step must not go
 * through `renderCanvas(paneId)`: that rebuilds the stage and remounts both artboard iframes, so
 * pressing "next change" would tear down and reload the very documents it is trying to move you
 * through. The toolbar keeps a host element per pane, mounts ONE document into it, and a redraw
 * writes that document's scope.
 *
 * **It is an absolutely-positioned SIBLING of the stage's pan/zoom wrap, never a child and never in
 * flow.** A child would be scaled and panned along with the artboards; a flow sibling would shift
 * the origin `applyTransform` and `centerCanvas` compute against, so entering the mode would centre
 * the boards somewhere other than where the pan maths says they are. That placement belongs to the
 * stage — `surfaces/canvas-stage.json` draws the host — because where a floating bar sits over a
 * pan/zoom surface is a fact about the stage rather than about the bar.
 */

import { argsSchema, enumArg, enumProperty, stringProperty } from "../commands/command-args";
import type { CommandArgValues } from "../commands/command-args";
import type { AnyCommand } from "../commands/registry";
import {
  diffChangeCount,
  diffChangeMapOf,
  diffStepOf,
  diffViewOf,
  setDiffView,
  stepDiff,
} from "./diff-view";
import type { DiffView } from "./diff-view";
import type { ChangeStep } from "./diff-marks";
import { panToParentRect } from "./canvas-utils";
import { surfaceForPane } from "./canvas-surface";
import { announce } from "../services/announce";
import { workspace } from "../workspace/workspace";
import { mountDiffToolbarSurface } from "../surfaces/diff-toolbar";
import type { DiffToolbarSurfaceHandle, DiffToolbarView } from "../surfaces/diff-toolbar";

/**
 * Where each pane's toolbar draws, and the document standing in it.
 *
 * Pane-keyed and module-local, like the rest of the diff state — and the MOUNT is kept beside the
 * host rather than rebuilt per redraw. A step redraws the bar several times a second; remounting a
 * document each time would be the same defect the stage-rebuild note above describes, one level
 * down. A new host means a new stage, so that one is a genuine remount.
 */
const _bars = new Map<string, { host: HTMLElement; surface: DiffToolbarSurfaceHandle | null }>();

/** Record (or forget) the element a pane's toolbar renders into. */
export function setDiffToolbarHost(paneId: string, host: HTMLElement | null): void {
  const standing = _bars.get(paneId);
  if (standing && standing.host !== host) {
    standing.surface?.dispose();
    _bars.delete(paneId);
  }
  if (host && !_bars.has(paneId)) {
    _bars.set(paneId, { host, surface: null });
  }
}

/**
 * How this module asks a pane to redraw, injected by `canvas-render.ts`.
 *
 * **By injection rather than by import**, the same idiom `setSurfaceTeardown` uses and for the same
 * reason: `canvas-render.ts` imports THIS module, so an edge back would close a cycle. A dynamic
 * import would break the cycle too, and it was tried — but a dynamic import of a module that is
 * otherwise statically reachable makes the bundler hoist it into a shared chunk, which moved 664 KB
 * out of `studio.js` and pushed `chunks` past its budget. An injected function costs nothing.
 */
let _repaint: (paneId: string) => void = () => {};

/** Register the repaint. Called once, from `canvas-render.ts`. */
export function setDiffRepaint(repaint: (paneId: string) => void): void {
  _repaint = repaint;
}

/**
 * Rebuild the whole stage, because Visual and Code are different renders rather than different
 * styling: one draws two artboards on a pan/zoom surface, the other one Monaco.
 *
 * `prevCanvasMode` is nulled first — the documented "this stage's structure is stale" signal, the
 * same one `resetCanvasView` ends on. Without it the repaint sees `modeChanged === false` (the
 * canvas mode did not move; only the view within it did) and skips the setup the new branch needs.
 */
function repaintDiffStage(paneId: string): void {
  surfaceForPane(paneId).prevCanvasMode = null;
  _repaint(paneId);
}

/** Redraw one pane's toolbar in place, without touching its artboards. */
export function renderDiffToolbar(paneId: string): void {
  const bar = _bars.get(paneId);
  if (!bar) {
    return;
  }
  const view = diffToolbarView(paneId);
  if (bar.surface) {
    bar.surface.update(view);
    return;
  }
  bar.surface = mountDiffToolbarSurface(bar.host, view, {
    next: () => onStepClick(paneId, 1),
    previous: () => onStepClick(paneId, -1),
    showCode: () => selectDiffView(paneId, "code"),
    showVisual: () => selectDiffView(paneId, "visual"),
  });
}

/**
 * Choose which half of a comparison is showing.
 *
 * Idempotent, and for the same reason `diff.setView` is: re-selecting the half already on screen
 * must rebuild nothing, because the rebuild remounts both artboard iframes.
 */
function selectDiffView(paneId: string, view: DiffView): void {
  if (diffViewOf(paneId) === view) {
    return;
  }
  setDiffView(paneId, view);
  repaintDiffStage(paneId);
}

/** How a change reads aloud, for the step announcement. */
function describeStep(step: ChangeStep, index: number, total: number): string {
  const kind = step.kind === "modified" ? "changed" : step.kind;
  return `Change ${index + 1} of ${total}, ${kind}.`;
}

/**
 * A stepper button's click.
 *
 * One handler for both directions, so the failure path is written once. A rejection here is not an
 * outcome to raise: the cursor has already moved and the toolbar has already redrawn to say where
 * it is, so a reveal that could not measure leaves a correct toolbar over an unmoved canvas.
 */
function onStepClick(paneId: string, delta: 1 | -1): void {
  stepDiffAndReveal(paneId, delta).catch((error: unknown) => {
    console.warn("stepDiffAndReveal:", error);
  });
}

/**
 * Move to the next or previous change and bring it on screen on BOTH artboards.
 *
 * The two boards share one `.panzoom-wrap` and therefore one vertical offset, so this pans to the
 * UNION of the two rects rather than centring either: a node that sits at a different height on the
 * two sides is only fully readable if the move accounts for both. A change that exists on one side
 * only — a removal has no counterpart to the right of it, an addition none to the left — pans to
 * the one rect there is, so the step never becomes a no-op just because it is one-sided.
 */
export async function stepDiffAndReveal(paneId: string, delta: 1 | -1): Promise<void> {
  const landed = stepDiff(paneId, delta);
  if (landed === null) {
    return;
  }
  renderDiffToolbar(paneId);
  const step = diffChangeMapOf(paneId)?.steps[landed];
  const { panels } = surfaceForPane(paneId);
  const original = panels[0]?.canvas as HTMLElement | undefined;
  const current = panels[1]?.canvas as HTMLElement | undefined;
  if (!step) {
    return;
  }
  /* DYNAMICALLY, and not for size. `iframe-host.ts` is one of the most-mocked modules in the
     suite — a dozen files replace it with a partial stub — and a partial mock of a module the
     static graph reaches is a LOAD error, not a missing stub at call time. A static import here
     would have made every one of those files grow three exports it never calls. The step is
     already async, so this costs nothing, and it is the same idiom `canvas-render.ts` uses for
     the collab binding. */
  const { hostForCanvas, measureInCanvas, revealCanvasPathIn } = await import("./iframe-host");
  const measured = await Promise.all([
    step.originalPath && original ? measureInCanvas(original, step.originalPath) : null,
    step.currentPath && current ? measureInCanvas(current, step.currentPath) : null,
  ]);
  const rects = measured.filter((rect) => rect !== null);
  const sentence = describeStep(step, landed, diffChangeCount(paneId));
  if (rects.length === 0) {
    // The node is real but unstamped — a component's internals, or a repeater row past the first.
    // The count still names it, and the Code view still shows it; there is simply nowhere to pan.
    announce(`${sentence} Not shown on the canvas.`);
    return;
  }
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  /* Pan only. The two artboards sit side by side at a fixed 800px each and `fitOnCanvasEntry`
     framed both horizontally on arrival; moving X per step would read as the canvas being dragged
     sideways under the reader. */
  panToParentRect({ height: bottom - top, top }, surfaceForPane(paneId));
  // Re-measure through the reveal so the ring (and any caller acting on the point) sees where the
  // Node ended up, not where it was before the move — `revealCanvasPath`'s own rule.
  const host = step.currentPath && current ? hostForCanvas(current) : null;
  if (host && step.currentPath) {
    await revealCanvasPathIn(host, step.currentPath);
  }
  announce(sentence);
}

/**
 * What the toolbar says, as one value.
 *
 * The counter is text rather than a button because it has no verb — `.pc-zoom-label` is a button
 * only because clicking it resets the zoom. Before the first step it reads "12 changes" rather than
 * "0 of 12", because the author is not on a change yet.
 *
 * @param {string} paneId
 * @returns {DiffToolbarView}
 */
export function diffToolbarView(paneId: string): DiffToolbarView {
  const map = diffChangeMapOf(paneId);
  /* THE COUNT BELONGS TO THE VIEW THAT IS SHOWING, and the two views count different things. The
     change map counts NODES, which is the right answer for the artboards and the wrong one for a
     text comparison: a `package.json` whose dependency versions moved has no node change at all —
     its keys are the ROOT's, and a root key is reported in words rather than tinted — so the Code
     view sat over a screenful of red and green saying "No changes, document settings changed".
     Monaco owns the line diff and its own navigation there, so the toolbar states what it is
     showing and steps out of the way. */
  const code = diffViewOf(paneId) === "code" || map === null;
  const total = code ? 0 : diffChangeCount(paneId);
  const index = code ? -1 : diffStepOf(paneId);
  const countLabel = code
    ? "Changed lines are marked"
    : total === 0
      ? "No changes"
      : index < 0
        ? `${total} ${total === 1 ? "change" : "changes"}`
        : `${index + 1} of ${total}`;
  const showing = diffViewOf(paneId);
  return {
    codeChecked: showing === "code" ? "true" : "false",
    countLabel,
    degraded: !code && map?.degraded ? "shown" : "hidden",
    nextDisabled: index >= total - 1,
    prevDisabled: index <= 0,
    rootKeys: !code && map?.rootKeys.length ? "shown" : "hidden",
    rootKeysTitle: `Changed: ${map?.rootKeys.join(", ") ?? ""}`,
    stepper: total === 0 ? "hidden" : "shown",
    // A file the canvas cannot render arrives with a null map: there is no visual half to offer.
    viewMode: map === null ? "static" : "choice",
    visualChecked: showing === "visual" ? "true" : "false",
  };
}

/** The pane a diff verb addresses: named, or the focused one. */
function paneOfArgs(args: CommandArgValues): string {
  const { pane } = args as { pane?: unknown };
  return typeof pane === "string" ? pane : workspace.activePaneId;
}

const paneProperty = stringProperty("Which pane to act on. Defaults to the focused one.");

/**
 * Walking a comparison, and choosing which half of it to read.
 *
 * **`keyScope` is `global`, not `canvas`**, and that is not a preference. `keyScopeStack` switches
 * on `ctx.editor.kind`, and `diff` falls through to the default arm — its own docstring says so:
 * "Preview and the non-editing surfaces (the diff view, the media library, the stylebook) get the
 * bare `global` stack." A chord declared in the canvas scope would never fire here.
 *
 * `f7` / `shift+f7` are VSCode's own next/previous-difference chords and are free in this keymap
 * (`f6` / `shift+f6` are region cycling).
 */
export function diffCommands(): AnyCommand[] {
  const onDiff = (paneId: string) => diffChangeCount(paneId) > 0;
  return [
    {
      args: argsSchema({ pane: paneProperty }),
      category: "View",
      group: "3_canvas",
      id: "diff.nextChange",
      keybinding: "f7",
      keyScope: "global",
      level: "document",
      menus: ["palette"],
      requires: "a pane showing a comparison with changes",
      title: "Next Change",
      undo: "none",
      when: (ctx) => ctx.editor.kind === "diff",
      // The FOCUSED pane, because that is what a command's subject is. The toolbar's own buttons
      // Call `stepDiffAndReveal(paneId, …)` with the pane they were drawn for instead — one
      // Implementation, two subjects, which is the split `check-pane-singletons.ts` looks for.
      enablement: () => onDiff(workspace.activePaneId),
      run: (_ctx, args) => stepDiffAndReveal(paneOfArgs(args), 1),
    },
    {
      args: argsSchema({ pane: paneProperty }),
      category: "View",
      group: "3_canvas",
      id: "diff.previousChange",
      keybinding: "shift+f7",
      keyScope: "global",
      level: "document",
      menus: ["palette"],
      requires: "a pane showing a comparison with changes",
      title: "Previous Change",
      undo: "none",
      when: (ctx) => ctx.editor.kind === "diff",
      // The FOCUSED pane, because that is what a command's subject is. The toolbar's own buttons
      // Call `stepDiffAndReveal(paneId, …)` with the pane they were drawn for instead — one
      // Implementation, two subjects, which is the split `check-pane-singletons.ts` looks for.
      enablement: () => onDiff(workspace.activePaneId),
      run: (_ctx, args) => stepDiffAndReveal(paneOfArgs(args), -1),
    },
    {
      args: argsSchema(
        {
          pane: paneProperty,
          view: enumProperty(["visual", "code"], "Which half of the comparison to show."),
        },
        ["view"],
      ),
      category: "View",
      group: "3_canvas",
      id: "diff.setView",
      level: "document",
      menus: ["palette"],
      requires: "a pane showing a comparison",
      title: "Set Diff View",
      undo: "none",
      when: (ctx) => ctx.editor.kind === "diff",
      aiTool: {
        description:
          "Show a comparison as the rendered page (visual) or as its file text (code). Idempotent.",
        name: "set_diff_view",
      },
      run: (_ctx, args) => {
        // An idempotent SETTER, never a toggle: the screenshot contract refuses a `toggle*` id, and
        // A verb whose result depends on the state it is called in cannot be photographed honestly.
        const view = enumArg("diff.setView", args, "view", ["visual", "code"] as const);
        const paneId = paneOfArgs(args);
        if (diffViewOf(paneId) === view) {
          return;
        }
        setDiffView(paneId, view);
        repaintDiffStage(paneId);
      },
    },
  ];
}
