/// <reference lib="dom" />
/**
 * ⑪ · Logic — the flow behind the Bottom dock's Logic tab.
 *
 * **What changed, and why it is the whole point.** Both of these surfaces used to TAKE OVER the
 * canvas: `TabUi.editingFormula` (this file) and `TabUi.editingFunction` (`panels/editors.ts`) each
 * cleared `canvasWrap`, dropped every canvas panel and drew themselves over the stage. So the one
 * artefact whose values you are authoring — the page — was the one thing you could not see while
 * authoring them, and the workspace's own data rail existed to paper over it: a frozen snapshot of
 * a scope, shown because the live thing had just been unmounted. Plan §12 P8.5: "no editor hides
 * the page it computes." They are a **tab of the Bottom dock** now (§3.2 ⑪), which sits under the
 * pane grid, so the page renders beside the formula and keeps rendering while you edit it.
 *
 * **A dock tab is not a reparented takeover.** The surface has to work at dock height, so the
 * header is one row, the chip pipeline and the result are single lines, and the data rail is a
 * narrow column that scrolls rather than a 280px slab. Every one of those measurements is in
 * `surfaces/logic-workspace.json`'s own style block now — the tab is a **Jx document over the UI
 * kit**, and this module is its flow: it decides which surface is open, what the expression at that
 * document position is, which sub-node the chips have selected, what the live preview says, and
 * what a commit writes. It draws nothing.
 *
 * **One target, two surfaces, one tab.** {@link logicTarget} is the single reader of the two
 * `TabUi` fields, and the function editor wins when both are set — the precedence `tabs/tab.ts` has
 * always documented, now stated in exactly one place. The tab's `when` is that same predicate, so
 * Logic exists only while something is open in it, and `panels/bottom-dock.ts` reveals the dock on
 * that tab when a target appears.
 *
 * **Three islands, and none of them is this module's markup** (studio-ui-guidelines.md §9.4). The
 * document draws an empty host for each and announces it; Monaco fills `[part="code-host"]`, the
 * still-lit expression editor fills `[part="editor-host"]`, and one mounted value-tree document
 * fills each `[part="tree-host"]`. The rail's trees had been EMPTY since that tree became a
 * document — the takeover rendered a host and nothing ever ran the pass that fills one — so
 * announcing them is not a port, it is the repair.
 *
 * **The close is real.** Both surfaces carry one, and closing is the only thing that clears the
 * target — leaving the dock, switching tabs and collapsing the dock all keep your place, because
 * the editor no longer owns a screen it would otherwise be stranded on.
 *
 * Every edit immutably replaces the selected sub-node within the root and writes the WHOLE root
 * node back through `transactDoc` — undo/redo and the canvas patch come free, and because the
 * canvas is still mounted the patch lands in a page you can watch.
 */

import { nothing } from "lit-html";
import { getEventBinding, isExpressionDef, isJsonObject } from "@jxsuite/schema/guards";

import { effect, effectScope, shallowRef } from "../reactivity";
import { getNodeAtPath, updateUi } from "../store";
import { activeTab } from "../workspace/workspace";
import { mutateAddDef, mutateUpdateDef, mutateUpdateProperty, transactDoc } from "../tabs/transact";
import { setBottomTab } from "../shell";
import { bottomPanelRegion, REGION_ATTR } from "../ui/regions";
import { chipSummary, formulaChipStrip } from "../ui/formula-chips";
import { mountExpressionEditor } from "../ui/expression-editor";
import { applyCatalogPick, formulaCatalog } from "../ui/formula-catalog";
import { openFormulaPalette } from "../surfaces/formula-palette";
import { livePreviewExpression } from "../services/live-preview";
import { closeFunctionEditor, syncFunctionEditor } from "./editors";
import { registerPanel } from "./panel-registry";
import { dataTypeLabel, paintDataTree, unwrapSignal } from "./data-explorer";
import { disposeDetachedDataTrees } from "../surfaces/panel-data";
import { emptyLogicWorkspaceView, mountLogicWorkspace } from "../surfaces/logic-workspace";

import {
  argsSchema,
  pathArg,
  pathProperty,
  stringArg,
  stringProperty,
} from "../commands/command-args";

import type { JxNodeValue } from "../tabs/transact";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import type { PanelBody } from "./panel-registry";
import type { ExpressionPreview } from "../services/preview-eval";
import type { FormulaEditDef, FunctionEditDef, JsonValue } from "../types";
import type { Tab } from "../tabs/tab";
import type { JxStateDefinition } from "@jxsuite/schema/types";
import type { EffectScope } from "@vue/reactivity";
import type {
  LogicChipView,
  LogicScopeEntryView,
  LogicWorkspaceActions,
  LogicWorkspaceIslands,
  LogicWorkspaceSurface,
  LogicWorkspaceView,
} from "../surfaces/logic-workspace";

type NodePath = (string | number)[];

/** What the Logic tab is showing: the Monaco function body, or the structured `$expression`. */
export type LogicTarget =
  | { surface: "function"; editing: FunctionEditDef }
  | { surface: "formula"; editing: FormulaEditDef };

/** The sentence the tab shows with nothing open in it — what the region is FOR (§11.1). */
const NOTHING_OPEN = "Open a formula or a function to edit it here, beside the page it computes.";

/** The target names a document position that holds no expression: say so, keep the header. */
const NO_EXPRESSION = "No expression found at this document position.";

/** The rail with no canvas snapshot behind it. */
const NO_SNAPSHOT = "The values this formula can read appear here once the canvas has rendered.";

/** The result line with nothing to report yet — an absence of data, not an absence of value. */
const NO_PREVIEW = "Preview unavailable — the canvas has not posted a data snapshot yet";

/**
 * The Logic tab's target, or `null` when nothing is open in it.
 *
 * The ONE reader of `TabUi.editingFunction` / `TabUi.editingFormula`, and therefore the one place
 * their precedence is decided. Two surfaces used to answer that question separately — the canvas
 * render pipeline by branch order, the pane context bar by an `||` — which is two definition sites
 * for a rule neither of them stated.
 *
 * @param {Tab | null} [tab] The tab to read; defaults to the focused one.
 * @returns {LogicTarget | null}
 */
export function logicTarget(tab: Tab | null = activeTab.value): LogicTarget | null {
  const ui = tab?.session.ui;
  if (!ui) {
    return null;
  }
  if (ui.editingFunction) {
    return { editing: ui.editingFunction as FunctionEditDef, surface: "function" };
  }
  if (ui.editingFormula) {
    return { editing: ui.editingFormula as FormulaEditDef, surface: "formula" };
  }
  return null;
}

/**
 * Put the Logic tab on screen. Idempotent.
 *
 * `setBottomTab` is the shell's own "reveal" — it selects the tab AND opens the dock, for the same
 * reason `setActivityTab` does: "show me the formula" means the formula is on screen when the call
 * returns, not that a tab is selected inside a closed dock.
 */
export function revealLogicPanel(): void {
  setBottomTab("logic");
}

/**
 * Open something in the Logic tab and put it on screen. The one WRITER of the two `TabUi` fields
 * {@link logicTarget} reads, as that is its one reader.
 *
 * **One tab holds one target, so opening either surface clears the other.** `logicTarget` gives the
 * function editor precedence when both are set, which is the right tie-break for a state that
 * should never occur — and every opener used to create it. Four buttons and two commands each set
 * their own field and left the other alone, so "Open in formula workspace" on an `$expression`
 * while a Function body was open was a dead click: the dock went on showing the function, and the
 * target key had not changed so nothing revealed either. Writing both fields here means the fifth
 * opener inherits the rule instead of re-deciding it.
 *
 * **The reveal is the OTHER half, and it is a different event from the dock's.**
 * `panels/bottom-dock.ts` reveals when a target APPEARS or CHANGES, at most once per target — that
 * is what lets you close the dock over an open formula and have it stay closed (§16.3). Neither
 * half can do the other's job: an effect on the target cannot see "the user pressed the button
 * again" (same target, no change, no reveal — the dock stayed shut and the button did nothing), and
 * a gesture cannot cover a target that appears without one. So the gesture says so explicitly, and
 * this is what makes a call to it a gesture.
 *
 * @param {LogicTarget} target The surface to show and what it should be pointed at.
 */
export function openLogicTarget(target: LogicTarget): void {
  updateUi(
    activeTab.value,
    "editingFunction",
    target.surface === "function" ? target.editing : null,
  );
  updateUi(activeTab.value, "editingFormula", target.surface === "formula" ? target.editing : null);
  revealLogicPanel();
}

function isExprNode(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value) && typeof value.operator === "string";
}

// ─── Document access ─────────────────────────────────────────────────────────

/** Read the workspace target's current root expression node from the document. */
export function formulaRoot(tab: Tab, editing: FormulaEditDef): Record<string, unknown> | null {
  const { document } = tab.doc;
  if (editing.type === "def" && editing.defName) {
    const def = document?.state?.[editing.defName];
    return isExpressionDef(def) ? (def.$expression as unknown as Record<string, unknown>) : null;
  }
  if (editing.type === "event" && editing.path && editing.eventKey) {
    const node = getNodeAtPath(document, editing.path);
    const binding = node ? getEventBinding(node, editing.eventKey) : undefined;
    return isExpressionDef(binding)
      ? (binding.$expression as unknown as Record<string, unknown>)
      : null;
  }
  return null;
}

/**
 * Resolve a chip selection to its editable node: the deepest expression-node prefix of `path` (head
 * chips target ref/literal operands; stale paths fall back toward the root).
 */
function resolveSelection(
  root: Record<string, unknown>,
  path: NodePath,
): { node: Record<string, unknown>; path: NodePath } {
  let current: unknown = root;
  let node: Record<string, unknown> = root;
  let nodePath: NodePath = [];
  for (const [i, seg] of path.entries()) {
    if (!current || typeof current !== "object") {
      break;
    }
    current = (current as Record<string, unknown>)[seg as keyof typeof current];
    if (isExprNode(current)) {
      node = current;
      nodePath = path.slice(0, i + 1);
    }
  }
  return { node, path: nodePath };
}

/** Immutably replace the value at `path` within `node` (object keys / array indexes). */
function replaceAtPath(node: unknown, path: NodePath, value: unknown): unknown {
  if (path.length === 0) {
    return value;
  }
  const [head, ...rest] = path as [string | number, ...NodePath];
  if (Array.isArray(node)) {
    const copy = [...(node as unknown[])];
    copy[Number(head)] = replaceAtPath(copy[Number(head)], rest, value);
    return copy;
  }
  const base: Record<string, unknown> = isJsonObject(node) ? node : {};
  return { ...base, [head]: replaceAtPath(base[head as string], rest, value) };
}

/** Write the whole updated root node back to the document position (one undo step). */
function writeRoot(tab: Tab, editing: FormulaEditDef, newRoot: unknown) {
  if (editing.type === "def" && editing.defName) {
    const { defName } = editing;
    transactDoc(tab, (t) => mutateUpdateDef(t, defName, { $expression: newRoot as JsonValue }));
  } else if (editing.type === "event" && editing.path && editing.eventKey) {
    const { eventKey, path } = editing;
    transactDoc(tab, (t) =>
      mutateUpdateProperty(t, path, eventKey, { $expression: newRoot } as JxNodeValue),
    );
  }
}

/** Close the workspace — clears `editingFormula`; the Logic tab leaves the strip with it. */
export function closeFormulaWorkspace() {
  updateUi(activeTab.value, "editingFormula", null);
}

// ─── The chip selection ──────────────────────────────────────────────────────

/**
 * The chip selection, keyed by the target it belongs to.
 *
 * Keyed rather than reset, because the reset used to happen INSIDE the render — and a render that
 * writes the state it reads is a reactive loop the moment the surface becomes an effect, which is
 * exactly what hosting it in the dock makes it. A selection whose key no longer matches simply does
 * not apply, so retargeting starts at the root with nothing written.
 */
const _selection = shallowRef<{ tab: Tab | null; key: string; path: NodePath }>({
  key: "",
  path: [],
  tab: null,
});

/**
 * The document position a selection belongs to. Paired with the tab OBJECT, never its id: a tab
 * that was closed and reopened at the same path is a different document, and inheriting a chip
 * selection into it is how you edit the wrong sub-node of a formula that merely looks the same.
 */
function selectionKey(editing: FormulaEditDef): string {
  return JSON.stringify(editing);
}

// ─── What the last projection resolved ───────────────────────────────────────

/**
 * Everything an ACTION needs that the view does not carry.
 *
 * The document reports a chip by its key and a button by nothing at all, so the objects behind them
 * — the tab, the target, the root node, the sub-node a commit replaces — live here, rewritten by
 * every projection. Held rather than recomputed at click time for the reason `panels/git-panel.ts`
 * states about its own seat: a callback captured at mount would reach the FIRST projection's
 * document for the rest of the window.
 */
interface Resolved {
  tab: Tab;
  editing: FormulaEditDef;
  root: Record<string, unknown>;
  selected: Record<string, unknown>;
  selectedPath: NodePath;
  stateEntries: Record<string, JxStateDefinition>;
  preview: ExpressionPreview | null;
  allowEventRef: boolean;
  /** Chip key → node path, so a chip click needs no path parsing (a `switch` case may hold "/"). */
  chipPaths: Map<string, NodePath>;
  /** Rail entry name → the value its tree draws. */
  scopeValues: Map<string, unknown>;
}

let _resolved: Resolved | null = null;

/** Replace the selected sub-node inside the root and write the whole root back. */
function writeSelected(next: unknown): void {
  const held = _resolved;
  if (!held) {
    return;
  }
  writeRoot(held.tab, held.editing, replaceAtPath(held.root, held.selectedPath, next));
}

// ─── The projection ──────────────────────────────────────────────────────────

/** The header fields both surfaces wear: what is open, what kind it is, and where it lives. */
function headerOf(
  glyph: string,
  name: string,
  kind: string,
  titleHint: string,
): Pick<LogicWorkspaceView, "glyph" | "kind" | "name" | "titleHint"> {
  return { glyph, kind, name, titleHint };
}

/** The result line: the evaluation error, the root value, or the honest "nothing has run this". */
function resultOf(
  preview: ExpressionPreview | null,
): Pick<LogicWorkspaceView, "hasResultNote" | "resultNote" | "resultText" | "resultTone"> {
  if (preview?.error) {
    return {
      hasResultNote: false,
      resultNote: "",
      resultText: preview.error,
      resultTone: "error",
    };
  }
  if (preview) {
    return {
      hasResultNote: preview.mutating,
      resultNote: preview.mutating ? "(mutates target)" : "",
      resultText: `= ${preview.values.get("") ?? "undefined"}`,
      resultTone: "value",
    };
  }
  return { hasResultNote: false, resultNote: "", resultText: NO_PREVIEW, resultTone: "pending" };
}

/** The live data context — a SECOND opinion now that the page itself is on screen, not the only one. */
function railOf(scope: Record<string, unknown> | null | undefined): {
  entries: LogicScopeEntryView[];
  values: Map<string, unknown>;
} {
  const entries: LogicScopeEntryView[] = [];
  const values = new Map<string, unknown>();
  for (const [name, value] of Object.entries(scope ?? {})) {
    entries.push({ key: name, name, type: dataTypeLabel(value) });
    values.set(name, unwrapSignal(value));
  }
  return { entries, values };
}

/**
 * What the Logic tab shows, and what every action it offers acts on.
 *
 * Writes {@link _resolved} as its one side effect: the projection is the only place that knows
 * which document position, which sub-node and which values the surface is currently drawing, and an
 * action that recomputed any of them would be a second answer to the same question.
 *
 * @returns {LogicWorkspaceView}
 */
export function workspaceView(): LogicWorkspaceView {
  const empty = emptyLogicWorkspaceView();
  const tab = activeTab.value;
  const target = logicTarget(tab);
  if (!tab || !target) {
    _resolved = null;
    return { ...empty, emptyMessage: NOTHING_OPEN, state: "empty" };
  }

  if (target.surface === "function") {
    _resolved = null;
    const { editing } = target;
    const name = editing.defName ?? editing.eventKey ?? "?";
    return {
      ...empty,
      ...headerOf(
        "ƒ",
        name,
        editing.type === "def" ? "function body" : "event handler",
        editing.type === "def" ? `state/${name}` : name,
      ),
      state: "ready",
      surface: "code",
    };
  }

  const { editing } = target;
  const name = (editing.type === "def" ? editing.defName : editing.eventKey) ?? "?";
  const header = headerOf(
    "fx",
    name,
    editing.type === "def" ? "state expression" : "event expression",
    editing.type === "def" ? `state/${name}` : name,
  );
  const root = formulaRoot(tab, editing);
  if (!root) {
    _resolved = null;
    return {
      ...empty,
      ...header,
      missingMessage: NO_EXPRESSION,
      state: "ready",
      surface: "missing",
    };
  }

  const stateEntries = (tab.doc.document?.state ?? {}) as Record<string, JxStateDefinition>;
  /* Live-context evaluation in the canvas iframe with snapshot fallback (M6). The canvas is no
     longer unmounted while this surface is open — that is the entire point of the move — so the
     live path is the ORDINARY case now rather than the one that never happened. An event target's
     element path is the context, so repeater-template formulas bind the first item's $map scope. */
  const preview = livePreviewExpression(
    tab,
    `formula:${JSON.stringify(editing)}`,
    root,
    editing.type === "event" ? (editing.path ?? null) : null,
    syncLogicView,
  );
  const stored = _selection.value;
  const key = selectionKey(editing);
  const { node: selected, path: selectedPath } = resolveSelection(
    root,
    stored.tab === tab && stored.key === key ? stored.path : [],
  );
  const strip = formulaChipStrip(root, { preview });
  const chips: LogicChipView[] = strip.map((chip) => ({
    badge: chip.badge,
    hasBadge: chip.hasBadge,
    key: chip.key,
    label: chip.label,
  }));
  const chipPaths = new Map(strip.map((chip) => [chip.key, chip.path] as const));
  const rail = railOf(tab.session.canvas.scope);

  _resolved = {
    allowEventRef: editing.type === "event",
    chipPaths,
    editing,
    preview,
    root,
    scopeValues: rail.values,
    selected,
    selectedPath,
    stateEntries,
    tab,
  };

  return {
    ...empty,
    ...header,
    ...resultOf(preview),
    chips,
    hasCatalog: true,
    hasScope: rail.entries.length > 0,
    scopeEmptyMessage: NO_SNAPSHOT,
    scopeEntries: rail.entries,
    selectedSummary: selectedPath.length === 0 ? "root" : chipSummary(selected),
    state: "ready",
    surface: "formula",
  };
}

// ─── The islands ─────────────────────────────────────────────────────────────

let _editorHost: HTMLElement | null = null;
const _treeHosts = new Map<string, HTMLElement>();

/**
 * Draw the expression editor into the host the document made for it.
 *
 * The editor is a MOUNTED DOCUMENT of its own now (`ui/expression-editor.ts` is its flow), so this
 * is one document's surface standing inside a node another document owns — the same hand-over the
 * statement editor makes at `[part="control-host"]`. Calling it again ASSIGNS to the standing
 * mount, which is what keeps a picker the reader has open from being taken away by a projection.
 *
 * Nothing resolved means nothing to edit: the host is emptied, which also takes down the mount on
 * the next sweep because the document it held is no longer in the page.
 */
function paintEditor(): void {
  const host = _editorHost;
  if (!host) {
    return;
  }
  const held = _resolved;
  if (!held) {
    host.textContent = "";
    return;
  }
  mountExpressionEditor(host, held.selected, writeSelected, {
    allowEventRef: held.allowEventRef,
    depth: 1,
    onInsertDef: insertDef,
    path: held.selectedPath,
    preview: held.preview,
    stateDefs: Object.keys(held.stateEntries),
    stateEntries: held.stateEntries,
  });
}

/** Draw one rail entry's value tree. Idempotent: a host that holds its document is assigned to. */
function paintTree(key: string, host: HTMLElement): void {
  const value = _resolved?.scopeValues.get(key);
  paintDataTree(host, value, key, syncLogicView, 4);
}

/** Repaint every rail tree the current projection still has an entry for, and drop the rest. */
function paintTrees(): void {
  const held = _resolved;
  // Deleting the current entry mid-iteration is defined for a Map, so no copy is taken.
  for (const [key, host] of _treeHosts) {
    if (!held?.scopeValues.has(key)) {
      _treeHosts.delete(key);
      continue;
    }
    paintTree(key, host);
  }
  disposeDetachedDataTrees();
}

// ─── The standing mount ──────────────────────────────────────────────────────

interface Standing {
  host: HTMLElement;
  handle: LogicWorkspaceSurface;
  scope: EffectScope;
}

let _standing: Standing | null = null;

/**
 * Push a fresh projection at the standing document, now.
 *
 * The effect covers every reactive input; this covers the two that are not — a live preview landing
 * from the canvas iframe, and a raised limit inside a value tree — each of which is a callback
 * rather than a signal.
 */
export function syncLogicView(): void {
  if (!_standing) {
    return;
  }
  _standing.handle.update(workspaceView());
  paintEditor();
  paintTrees();
}

const ACTIONS: LogicWorkspaceActions = {
  browseCatalog(anchor) {
    const held = _resolved;
    if (!held) {
      return;
    }
    openFormulaPalette({
      anchor,
      entries: formulaCatalog(held.stateEntries),
      onPick: (entry) =>
        applyCatalogPick(entry, writeSelected, {
          onInsertDef: insertDef,
          stateEntries: held.stateEntries,
        }),
    });
  },
  close() {
    if (logicTarget()?.surface === "function") {
      void closeFunctionEditor();
      return;
    }
    closeFormulaWorkspace();
  },
  selectChip(key) {
    const held = _resolved;
    const path = held?.chipPaths.get(key);
    if (!held || !path) {
      return;
    }
    _selection.value = { key: selectionKey(held.editing), path, tab: held.tab };
  },
};

/** Vendor a packaged formula's state entry into the document, as one undo step. */
function insertDef(defName: string, def: unknown): void {
  transactDoc(activeTab.value, (t) => mutateAddDef(t, defName, def as Record<string, JsonValue>));
}

const ISLANDS: LogicWorkspaceIslands = {
  codeSlot(_host) {
    /* The host is announced but not USED, and that is the point. Monaco MEASURES its container, so
       it may not be mounted into a node that is one reconcile step short of being in the page —
       which is exactly what an announced node is. So the announcement is only a signal that the
       code surface now exists; a microtask puts the mount after the append, and
       `syncFunctionEditor` finds the container in the dock body for itself. Idempotent either way:
       it asks whether the editor it holds is still inside the container it was just handed, and
       rebuilds only when the answer is no. */
    queueMicrotask(() => {
      if (_standing) {
        syncFunctionEditor(_standing.host);
      }
    });
  },
  editorSlot(host) {
    _editorHost = host;
    paintEditor();
  },
  treeSlot(key, host) {
    _treeHosts.set(key, host);
    paintTree(key, host);
  },
};

/** Drop the standing document, its effect and everything it was holding. */
function unmountStanding(): void {
  if (!_standing) {
    return;
  }
  _standing.scope.stop();
  _standing.handle.dispose();
  _standing = null;
  _editorHost = null;
  _treeHosts.clear();
  _resolved = null;
  disposeDetachedDataTrees();
}

/** Mount the document into the dock body and arm the effect that keeps it current. */
function mountStanding(host: HTMLElement): void {
  _editorHost = null;
  _treeHosts.clear();
  const handle = mountLogicWorkspace(host, workspaceView(), ACTIONS, ISLANDS);
  const scope = effectScope();
  _standing = { handle, host, scope };
  scope.run(() => {
    effect(() => {
      handle.update(workspaceView());
      /* After the projection, never before: the hosts that survived it are showing the PREVIOUS
         node until they are repainted, and a host created BY it announces itself and paints
         itself. Both orders end in the same place, which is what makes the pair idempotent. */
      paintEditor();
      paintTrees();
    });
  });
}

/**
 * Draw the Logic tab against whatever the Bottom dock has just painted.
 *
 * The dock runs EVERY tab's `afterRender` with the same element, showing or not, because Logic is
 * the one tab that owns something outliving its own markup (a live Monaco instance). So the first
 * question is whose body this is: the dock stamps the active tab's region on it, and a collapsed
 * dock stamps nothing at all — which is what makes "is this mine?" answerable without asking the
 * dock, and therefore without an import cycle back through it.
 *
 * The mount does NOT clear the host. `render` returns `nothing`, so what is in there is lit's own
 * comment markers, and taking them away would break the dock's next paint of another tab.
 *
 * @param {HTMLElement} host The dock body (or, collapsed, the dock host itself).
 */
export function syncLogicPanel(host: HTMLElement): void {
  if (host.getAttribute(REGION_ATTR) === bottomPanelRegion("logic")) {
    if (_standing && (_standing.host !== host || !_standing.handle.connected())) {
      unmountStanding();
    }
    if (!_standing) {
      mountStanding(host);
    }
  } else {
    unmountStanding();
  }
  /* Unconditional, and it is the teardown as much as the mount: with another tab showing there is
     no `[part="code-host"]` under this element, which is how a Monaco instance left attached to
     DOM nobody can see is disposed. */
  syncFunctionEditor(host);
}

/**
 * Register the Bottom dock's Logic tab.
 *
 * Defined here and registered from `panels/bottom-dock.ts`, the same way Problems is defined beside
 * its notification store: the dock owns the strip, the surface owns the record.
 */
export function registerLogicPanel(): void {
  registerPanel({
    id: "logic",
    title: "Logic",
    level: "document",
    dock: "bottom",
    icon: "lightning",
    // No rail button: Logic has no steady state to badge. It exists while a formula or a function
    // Is open and leaves the strip when you close it, which is what `when` says below.
    rail: false,
    when: () => logicTarget() !== null,
    // The body is a document, so lit draws nothing and the mount happens against the painted DOM.
    // `afterRender` runs on every repaint of the dock; {@link syncLogicPanel} is idempotent.
    render: (): PanelBody => nothing,
    afterRender: (_ctx, host) => {
      syncLogicPanel(host);
    },
  });
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * The formula/function EDITOR verbs — open a state entry's body or an event binding in Logic.
 *
 * They live here rather than beside `panels/editors.ts`'s renderer because this module already owns
 * the other half of the same idea: `editingFormula` (the structured workspace) and
 * `editingFunction` (the code editor) are two surfaces of ONE dock tab, addressing the same two
 * document positions — a state entry by `defName`, or an element event binding by `path` +
 * `eventKey`.
 *
 * Both REFUSE a target the document does not hold. The predecessors wrote `ui.editingFunction`
 * straight from the automation hook with no check at all, so a renamed def opened an editor over
 * nothing and the shot photographed an empty takeover.
 *
 * @returns {AnyCommand[]}
 */
export function formulaEditorCommands(): AnyCommand[] {
  return [
    {
      args: argsSchema({
        defName: stringProperty("The state entry whose body to open in the code editor."),
      }),
      category: "Document",
      id: "formula.editDef",
      level: "document",
      menus: ["palette"],
      group: "5_data",
      requires: "an open document that defines state",
      when: (ctx) => ctx.document.open,
      run: (_commandCtx, args) => {
        const defName = stringArg("formula.editDef", args, "defName");
        const tab = activeTab.value;
        if (!tab) {
          throw new RangeError(`command "formula.editDef" needs an open document`);
        }
        const defs = tab.doc.document?.state ?? {};
        if (!(defName in defs)) {
          const defined = Object.keys(defs);
          throw new RangeError(
            `command "formula.editDef" argument "defName": "${defName}" is not a state entry ` +
              `this document defines — it defines: ` +
              `${defined.length > 0 ? defined.join(", ") : "nothing"}`,
          );
        }
        openLogicTarget({ editing: { defName, type: "def" }, surface: "function" });
      },
      title: "Edit Function",
    },
    {
      args: argsSchema({
        eventKey: stringProperty('The event binding, e.g. "onclick".'),
        path: pathProperty("The document path of the element that carries the binding."),
      }),
      category: "Document",
      id: "formula.editEvent",
      level: "document",
      menus: ["palette"],
      group: "5_data",
      requires: "an open document",
      when: (ctx) => ctx.document.open,
      run: (_commandCtx, args) => {
        const eventKey = stringArg("formula.editEvent", args, "eventKey");
        const path = pathArg("formula.editEvent", args, "path");
        const tab = activeTab.value;
        if (!tab) {
          throw new RangeError(`command "formula.editEvent" needs an open document`);
        }
        if (!getNodeAtPath(tab.doc.document, path)) {
          throw new RangeError(
            `command "formula.editEvent" argument "path": [${path.join(", ")}] addresses no ` +
              `node in ${tab.documentPath ?? "the open document"}`,
          );
        }
        openLogicTarget({ editing: { eventKey, path, type: "event" }, surface: "function" });
      },
      title: "Edit Event Handler",
    },
  ];
}

/**
 * Register the formula/function editor verbs.
 *
 * @param {CommandRegistry} registry
 */
export function registerFormulaEditorCommands(registry: CommandRegistry): void {
  registry.registerAll(formulaEditorCommands());
}
