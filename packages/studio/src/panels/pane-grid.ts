/// <reference lib="dom" />
/**
 * The pane grid — `workspace.panes`, given a visual counterpart.
 *
 * `workspace.panes` has been a real data model since P3: an ordered list, a focused id, a split, an
 * unsplit. Nothing drew it. `index.html` declared ONE each of `#tab-strip`, `#jump-bar`,
 * `#pane-chrome` and `#canvas-wrap` as flat siblings in `#app`'s grid — four surfaces that belong
 * to a PANE, laid out as rows and columns of the APPLICATION — so the shell could model two panes
 * and had somewhere to put exactly one. §18.3's stage handover was the workaround: one stage, taken
 * by whichever pane had focus, releasing the loser's artboards on the way past. This module is what
 * that scaffolding was standing in for, and the handover is deleted with it.
 *
 * **The document owns the frame; this module owns the decisions.** `surfaces/pane-grid.json` is the
 * cells, the four boxes inside each one, the splitter between two of them and every rule that lays
 * them out; `surfaces/pane-grid.ts` is the mount. What is left here is the flow: which panes there
 * are, what a cell's stage is furnished with, in what ORDER a departing cell is taken apart, and
 * what the grid's own tracks are. Everything a cell CONTAINS still arrives through the module that
 * owns it — `canvas/canvas-render.ts` is the render root of the stage and this document puts
 * nothing inside it, `panels/jump-bar.ts` and `panels/pane-context.ts` are handed the jump and
 * chrome boxes, and `panels/tab-strip.ts` is handed the strip.
 *
 * **Three properties survived the conversion, and each is structural rather than remembered:**
 *
 * 1. _A pane is complete before it is published._ The runtime builds a `$map` row inside its own
 *    effect scope and inserts it afterwards, so the four `cellPart` calls below — the surface
 *    record, the gestures, the two bars' mounts, the pane-focus listener — all happen while the
 *    cell is still detached. There is no frame in which a cell exists with no stage inside it.
 * 2. _A pane's node is never re-parented._ The repeater is keyed on the pane id and the runtime's
 *    forward-cursor pass only moves rows that are out of place. `workspace.panes[0]` is always the
 *    primary and `MAX_PANES` is 2, so no row ever moves — which matters because re-parenting is not
 *    a move for an `<iframe>`: it reloads, dropping its `iframe-channel` connection, its shadow
 *    document and every `ready` panel with it.
 * 3. _A drag moves a track edge and never a node._ {@link layout} writes ONE inline property on the
 *    HOST, which is outside the document, and the projection is skipped entirely when the pane set
 *    has not changed — so the five `shell.paneSplit` writes a drag makes reach no markup at all.
 *    The predecessor re-ran `cells[1].root.before(splitter)` from here, and `.before()` on an
 *    already-positioned node is a REMOVE plus an insert: Chrome fires `lostpointercapture` on move
 *    #1, the rest of the gesture goes to whatever is under the cursor, and a drag asking for +0.20
 *    lands +0.03.
 *
 * **The splitter is `jx-split` (ui.md §5.5), and the drag left this module with it.** It used to be
 * a bare div carrying `role="separator"` and a `setupHandle` call from here — which meant the one
 * dock-sized thing in Studio that no keyboard could move: no tab stop, no `aria-valuenow`, no
 * arrows, and a double click that reset the split as the only gesture a pointer could reach without
 * dragging. What is left here is the two lines a host actually owns: {@link setPaneSplit} on every
 * move and {@link persistDocks} on every commit. The element measures the grid itself, so the 320px
 * floor is handed over in pixels and converted against the box it is actually dividing — and the
 * `scale`, `min` and `max` closures that read `clientWidth` on every `pointermove` are gone, along
 * with the window-resize staleness they were paying for.
 *
 * The fourth rule of §18.1 — _a pane with nothing in it is a hole in the grid_ — is enforced in
 * `workspace/workspace.ts`, where the tabs are. This module never repairs: repairing inside a
 * reactive effect that writes `workspace.panes` is an effect that triggers itself.
 */

import { effect, effectScope } from "../reactivity";
import {
  DEFAULT_PANE_SPLIT,
  PANE_SPLIT_MAX,
  PANE_SPLIT_MIN,
  persistDocks,
  registerShellSurface,
  setPaneSplit,
  shell,
} from "../shell";
import {
  createPaneSurface,
  disposePaneSurface,
  registerCanvasSurface,
} from "../canvas/canvas-surface";
import { releaseCanvasHosts } from "../canvas/iframe-host";
import { installStageGestures } from "../editor/shortcuts";
import { scheduleCanvasRender } from "../canvas/canvas-render";
import { paneRegion, paneStripRegion } from "../ui/regions";
import { attachJumpBarHost } from "./jump-bar";
import { attachPaneChromeHost } from "./pane-context";
import { focusPane, workspace } from "../workspace/workspace";
import { mountPaneGridSurface } from "../surfaces/pane-grid";
import type { EffectScope } from "@vue/reactivity";
import type { CanvasSurface } from "../canvas/canvas-surface";
import type { PaneCellPart, PaneGridRow, PaneGridSurface } from "../surfaces/pane-grid";

/** One drawn pane: its root and the four surfaces inside it. */
export interface PaneCell {
  paneId: string;
  root: HTMLElement;
  strip: HTMLElement;
  jump: HTMLElement;
  chrome: HTMLElement;
  stage: HTMLElement;
  surface: CanvasSurface;
}

/** A cell's record, plus the disposer its stage gestures live behind. */
interface CellState extends PaneCell {
  /** Stage-gesture disposer, live between the stage's creation and the cell's disposal. */
  releaseGestures: (() => void) | null;
}

const _cells = new Map<string, CellState>();

let _grid: HTMLElement | null = null;

let _surface: PaneGridSurface | null = null;

let _ready: Promise<void> | null = null;

/** The pane ids the document has been asked to draw. The projection's dirty check. */
let _drawn: string[] = [];

let _scope: EffectScope | null = null;

/** The cell a pane is drawn in, or null. Test-visible, and the bootstrap's handle on the primary. */
export function cellForPane(paneId: string): PaneCell | null {
  return _cells.get(paneId) ?? null;
}

/**
 * Settles once the first projection is in the document.
 *
 * The mount is asynchronous — the runtime waits for the kit to be defined and renders one microtask
 * after that — so `mountShell()` starting the grid is not the same event as the grid existing. The
 * bootstrap reads the primary cell's four boxes on the line after it, exactly as `mountShellTree()`
 * made every caller await the frame for the same reason.
 */
export function paneGridReady(): Promise<void> {
  return _ready ?? Promise.resolve();
}

/**
 * The record for a pane, created when its cell's outermost box is, and reused for the life of the
 * cell.
 *
 * Every element field is typed non-null and starts null, the same bargain `CanvasSurface` makes:
 * the runtime creates a row's nodes depth-first inside one synchronous render pass, so the record
 * is complete before anything outside that pass can hold it.
 */
function cellState(paneId: string): CellState {
  const existing = _cells.get(paneId);
  if (existing) {
    return existing;
  }
  const cell: CellState = {
    chrome: null as unknown as HTMLElement,
    jump: null as unknown as HTMLElement,
    paneId,
    releaseGestures: null,
    root: null as unknown as HTMLElement,
    stage: null as unknown as HTMLElement,
    strip: null as unknown as HTMLElement,
    surface: null as unknown as CanvasSurface,
  };
  _cells.set(paneId, cell);
  return cell;
}

/**
 * **A pointer landing anywhere in this cell puts the keyboard in this pane.**
 *
 * Before this, `panels/tab-strip.ts`'s strip row was the ONLY thing in the app that moved
 * `workspace.activePaneId` by pointer, so a click on the side pane's canvas, its context bar, its
 * Library, its Code editor or its entry form selected and edited that pane's document while every
 * keyboard command, the Inspector, the block action bar and the overlay effect went on answering
 * for the other one.
 *
 * ONE listener, on the cell, because the cell is the only thing that knows which pane a click is
 * IN. The alternative — a `focusPane` call in each of the seven surfaces a pane can contain — is a
 * list that a new surface joins by being remembered.
 *
 * Three properties it needs, and where each comes from:
 *
 * 1. _It must not disturb a control mid-interaction._ It moves the pane focus, never the DOM focus, so
 *    a text field in the context bar keeps its caret and its selection; and it fires on
 *    `pointerdown`, before any gesture has begun. The pane SPLITTER is a sibling of the cells
 *    rather than a child of one, so a splitter drag never reaches this at all.
 * 2. _It must reach clicks inside the canvas._ It cannot: those land in a cross-origin iframe and
 *    never surface as a parent-realm pointer event. `canvas/iframe-host.ts`'s `hit` / `layoutHit`
 *    handlers are that seam and call {@link focusPane} themselves, from the pane that mounted the
 *    artboard.
 * 3. _It must cost nothing when the pane is already focused._ {@link focusPane} returns early in that
 *    case — the guard is in the module that owns focus, because a function handed a `paneId` may
 *    not read the focus (`scripts/check-pane-singletons.ts` rule 4).
 *
 * CAPTURE phase, so a surface inside the cell that stops propagation cannot silently take the
 * pane's focus with it. `studio.ts`'s commit-on-parent-click listener is on `document`, so it still
 * runs first and the outgoing inline-edit session is committed before focus moves.
 *
 * **It is attached here rather than declared in the document** because a document's `on*` key binds
 * through `addEventListener` with no options, so capture cannot be expressed in a Jx document at
 * all. The node's lifetime is the row's, so there is nothing to remove: the listener goes when the
 * repeater drops the node.
 */
function watchPaneFocus(paneId: string, root: HTMLElement): void {
  root.addEventListener(
    "pointerdown",
    () => {
      focusPane(paneId);
    },
    { capture: true },
  );
}

/**
 * Furnish a pane's stage: its surface record, its host registration and its gestures.
 *
 * Runs while the cell is still inside the runtime's render pass (§18.1 rule 1). The render is
 * SCHEDULED here rather than by the caller because nothing else is keyed on a pane appearing — both
 * canvas effects key on the active TAB, which a split does not change — and by the time the frame
 * runs, the cell is in the document.
 */
function attachStage(cell: CellState, stage: HTMLElement): void {
  cell.stage = stage;
  cell.surface = createPaneSurface(cell.paneId);
  registerCanvasSurface(cell.paneId, stage);
  cell.releaseGestures = installStageGestures(cell.surface);
  scheduleCanvasRender(cell.paneId);
}

/**
 * One of a cell's five boxes has been created. Fill the record in, and wire what belongs to it.
 *
 * The two bars are HANDED their host rather than resolving a region, the same way
 * `panels/frontmatter-panel.ts` is handed the stage. They cannot resolve one the way the tab strip
 * does: the strip's host carries `pane.<id>/tabs` and nothing inside it re-stamps that id, while
 * the jump bar and the context bar both stamp `pane.<id>/jump` and `pane.<id>/context` on markup
 * they render INSIDE their two boxes — so a region on the wrapper as well would put the same id on
 * two nested elements, and `resolveRegion` takes the LAST match. Sixty shots crop
 * `pane.primary/context`; a second, larger element carrying it is a silently widened crop.
 */
function cellPart(paneId: string, part: PaneCellPart, element: HTMLElement): void {
  const cell = cellState(paneId);
  if (part === "pane") {
    cell.root = element;
    watchPaneFocus(paneId, element);
    return;
  }
  if (part === "strip") {
    cell.strip = element;
    return;
  }
  if (part === "jump") {
    cell.jump = element;
    attachJumpBarHost(paneId, element);
    return;
  }
  if (part === "chrome") {
    cell.chrome = element;
    attachPaneChromeHost(paneId, element);
    return;
  }
  attachStage(cell, element);
}

/**
 * Take a pane's cell apart, in the one order that works, BEFORE the repeater removes it.
 *
 * The lit predecessor got this ordering from a framework: a part is notified of its disconnection
 * and only then are its nodes removed, so a `ref` detach ran while the stage still had its children
 * in it. A document has no detach counterpart to `onNodeCreated`, so the order is stated here
 * instead — which is the stronger arrangement, because it no longer depends on when a renderer
 * chooses to tell anybody.
 *
 * The order is the document's own, and each step needs the one before it:
 *
 * - The two bars go first, each disposing a mount whose DOM is inside this cell — the runtime that
 *   owns it is about to be unreachable.
 * - `releaseCanvasHosts` goes before `disposePaneSurface` and while `stage` still CONTAINS its
 *   frames, which is the whole reason it can find them. A frame released later is noticed only by
 *   whichever lazy `liveHosts` walk runs next, so its channel's `window` "message" listener and its
 *   overlay would outlive the pane.
 * - `disposePaneSurface` comes last, because it is what stops the artboards' render scopes and clears
 *   the record the hosts resolve through.
 */
function disposeCell(cell: CellState): void {
  attachJumpBarHost(cell.paneId, null);
  attachPaneChromeHost(cell.paneId, null);
  cell.releaseGestures?.();
  cell.releaseGestures = null;
  if (cell.stage) {
    releaseCanvasHosts(cell.stage);
  }
  disposePaneSurface(cell.paneId);
  /* Every element field is left alone. A caller holding the record when its pane goes away —
     `studio.ts`'s primary cell, three tests — asks it what the cell WAS, and `root.isConnected ===
     false` is the honest answer to that where `root === null` is a `TypeError`. `_cells` forgetting
     the pane is what makes the cell gone. */
  _cells.delete(cell.paneId);
}

/** `workspace.panes`, as the rows the document draws. */
function rows(): PaneGridRow[] {
  return workspace.panes.map((pane, index) => ({
    id: pane.id,
    region: paneRegion(pane.id),
    split: index > 0 ? "shown" : "hidden",
    stripRegion: paneStripRegion(pane.id),
  }));
}

/** Whether two id lists name the same panes in the same order. */
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * The floor: a pane, not a sliver.
 *
 * 320px is the narrowest an Inspector-less editor is usable at, and the same number on both sides
 * is what makes a drag symmetrical. It is handed to `jx-split` in PIXELS and converted there
 * against the track the element measures for itself, which is the whole reason nothing in this
 * module has to notice a window resize: a fractional floor computed from a width here would be
 * wrong the moment the width changed, and wrong in the direction that lets a pane go below it.
 */
const MIN_PANE_PX = 320;

/**
 * Bring the drawn cells into line with `workspace.panes`. Idempotent by construction.
 *
 * The pane set is compared before anything is written, and that dirty check is load-bearing rather
 * than thrifty: the effect below re-runs on every `shell.paneSplit` write — which is every
 * `pointermove` of a splitter drag — and a projection that reached the document on each of them
 * would re-commit every binding in every row mid-gesture.
 *
 * Exported for the tests, which need to drive it without a reactive tick.
 */
export function reconcile(): void {
  const grid = _grid;
  if (!grid || !_surface) {
    return;
  }
  const next = rows();
  const ids = next.map((row) => row.id);
  if (!sameOrder(ids, _drawn)) {
    /* BEFORE the projection, so the teardown runs while the cell is still standing. See
       {@link disposeCell}: the repeater removes a departed row's node without telling anybody, so
       the order the frames come down in is this module's to state. */
    for (const paneId of _drawn) {
      if (!ids.includes(paneId)) {
        const cell = _cells.get(paneId);
        if (cell) {
          disposeCell(cell);
        }
      }
    }
    _drawn = ids;
    _surface.update(next, shell.paneSplit);
  }
  layout(grid);
}

/**
 * Write the grid's own tracks.
 *
 * The TRACK COUNT lives here rather than in `shell.ts`'s layout effect because it depends on
 * `workspace.panes.length`, and the shell effect must not read the workspace — a dock resize would
 * then re-run on every tab change. The shell owns `--pane-split`; the grid owns what it means.
 *
 * It writes ONE style property, on the HOST rather than on anything the document drew, and touches
 * no child: a `pointermove` that lands here can move a track edge but can never move a node. It
 * counts PANES rather than drawn cells, because the document's rows land one microtask after the
 * model does and a track count that lagged them would flash a full-width primary on every split.
 *
 * The host is a PARAMETER rather than a module read, because {@link reconcile} has already answered
 * "is there a grid" and a second null check here is a branch nothing can reach.
 */
function layout(grid: HTMLElement): void {
  if (workspace.panes.length < 2) {
    grid.style.gridTemplateColumns = "minmax(0, 1fr)";
    return;
  }
  const split = shell.paneSplit;
  grid.style.gridTemplateColumns = `minmax(0, ${split}fr) 5px minmax(0, ${1 - split}fr)`;
}

/** Mount the grid. Called by `shell.ts`'s `mountShell()`, like every other shell surface. */
export function mount(): void {
  if (_scope) {
    return;
  }
  _grid = document.querySelector<HTMLElement>("#pane-grid");
  if (!_grid) {
    return;
  }
  const first = rows();
  _drawn = first.map((row) => row.id);
  _surface = mountPaneGridSurface(
    _grid,
    first,
    {
      collapse: DEFAULT_PANE_SPLIT,
      gap: MIN_PANE_PX,
      max: PANE_SPLIT_MAX,
      min: PANE_SPLIT_MIN,
      value: shell.paneSplit,
    },
    { cellPart, move: setPaneSplit, settle: persistDocks },
  );
  _ready = _surface.ready;
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      // The one dependency: the pane list itself, by identity and by member id.
      for (const pane of workspace.panes) {
        void pane.id;
      }
      void shell.paneSplit;
      reconcile();
    });
  });
}

export function unmount(): void {
  _scope?.stop();
  _scope = null;
  /* Every cell is taken apart by the same ordered teardown a departing one gets, and BEFORE the
     document goes: doing it afterwards would hand `releaseCanvasHosts` a stage whose frames the
     runtime had already dropped. */
  const standing = [..._cells.values()];
  for (const cell of standing) {
    disposeCell(cell);
  }
  _surface?.dispose();
  _surface = null;
  _ready = null;
  _drawn = [];
  _cells.clear();
  _grid = null;
}

registerShellSurface({ mount, unmount });
