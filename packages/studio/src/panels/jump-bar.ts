/// <reference lib="dom" />
/**
 * The jump bar — the focused pane's address, as a breadcrumb trail along the foot of the window.
 *
 * **Where it lives, and why it moved.** The trail is the status bar's DOCUMENT field: the file,
 * then every ancestor of the selected element, leaf last, each one a button that selects it. That
 * is the pattern the Gutenberg block editor taught a generation of authors, and it is where they
 * look for it. It used to be a 10px row across the top of every pane, between the tab strip and the
 * context bar, and in that position it read as part of the tab strip rather than as a control: the
 * address was on screen and authors reported it missing. It also cost every pane 24px of stage
 * height. At the foot it costs nothing, because the status bar's row is already there, and the
 * field it replaced (the file path, a view name the context bar already prints, and a save word the
 * tab strip's dirty marker and the Command Bar's Save button already state) was the bar's least
 * useful content.
 *
 * **One bar, for the focused pane.** The status bar is one row for the whole window, so the trail
 * addresses the pane that has focus, which is the pane the Inspector, the Outline and the keyboard
 * already address. Clicking into the other pane re-points it.
 *
 * **The two half-breadcrumbs this replaced.** Studio grew two trails, neither of which could say
 * where you were:
 *
 * 1. `panels/pane-context.ts`'s `navTpl()` (the old `#tab-bar` breadcrumb, `tab-bar.ts:129-185`) — a
 *    `Back` button plus one span per `session.documentStack` frame. It appeared ONLY while you were
 *    inside a sub-document and knew nothing about the selection below it. It is deleted, and so is
 *    the stack it walked: nothing ever pushed a frame, so it could only ever draw its empty
 *    branch.
 * 2. `surfaces/statusbar.ts`'s selection field — a clickable ancestor trail that appeared ONLY while
 *    something was selected and knew nothing about the document it was inside.
 *
 * This bar is the whole chain, always:
 *
 * ```text
 * Jx Suite ⑂ main ‖ pages/blog/[slug].json › article › header › h1 ⌃ ‖ 3 selected
 * PROJECT field     ‖ this bar: file, then the selection's ancestors    ‖ SELECTION field
 * ```
 *
 * The project is not a step of the trail: the PROJECT field directly to its left already names it,
 * with the same `project.openRecent` command, and two adjacent buttons saying one thing is the
 * duplication studio-ui-guidelines.md §12.2's chrome budget forbids. `statusbar/selection` keeps
 * the two facts a trail cannot state: HOW MANY things are selected (a count is not a path) and
 * which Stylebook rule the Style panel is editing (a selector is not a node).
 *
 * **Every interactive item is a command, resolved from the registry.** There is no click handler in
 * this file that names behaviour: a segment names a command id and its args, and the registry
 * supplies the title, the chord, the enablement and the run. Two ids carry the whole bar —
 * `palette.openFiles` (or `pane.pin` in a derived pane) and `selection.set` — and this file
 * declares none of them.
 *
 * **A segment whose command the registry does not have becomes a readout, it does not disappear.**
 * That is the one place this bar deliberately differs from the status bar's own items, where an
 * unavailable item vanishes. An address with a hole in it is a lie about containment; a readout is
 * merely a step you cannot take.
 *
 * **This file is the FLOW; the markup is a document.** `surfaces/jump-bar.json` owns the bar's
 * structure, its ARIA and every value in its style, and `surfaces/jump-bar.ts` mounts it into the
 * host the status bar's document leaves for it (studio-ui-guidelines.md §6, §9.3). What stays here
 * is the part that is a decision: which pane this bar is about, what its address is, which of its
 * steps the registry can run, and what a chevron opens — and the chevron opens the KIT MENU,
 * `surfaces/menu.ts`, because a list of commands is what that surface already is
 * (studio-ui-guidelines.md §12.5).
 *
 * @docs studio/interface
 */

import { displayTagName } from "@jxsuite/schema/guards";
import { childList, getNodeAtPath, nodeLabel, pathsEqual, projectState } from "../store";
import { effect, effectScope } from "../reactivity";
import { activePane, workspace } from "../workspace/workspace";
import { derivationOfPane, tabOfPane } from "../canvas/canvas-surface";
import { primarySelection } from "../tabs/selection";
import { activeRegistry } from "../commands/active-registry";
import { runReported } from "../commands/run-reported";
import { openMenu } from "../surfaces/menu";
import { rectOf } from "../utils/geometry";
import { mountJumpBarSurface } from "../surfaces/jump-bar";
import type { CommandArgs, CommandRegistry } from "../commands/registry";
import type { FormulaEditDef, FunctionEditDef } from "../types";
import type { JxPath } from "../state";
import type { MenuHandle, MenuRowProjection } from "../surfaces/menu";
import type { JumpBarSurface, ProjectedStep } from "../surfaces/jump-bar";
import type { Tab } from "../tabs/tab";
import type { PaneDerivation } from "../workspace/workspace";
import type { EffectScope } from "@vue/reactivity";

/**
 * The region the trail stamps on itself. It is the status bar's DOCUMENT field: the document, and
 * where in it you are.
 */
export const JUMP_BAR_REGION = "statusbar/document";

/**
 * How a segment's alternatives hang from its chevron: ABOVE it, leading edges aligned. The bar sits
 * on the window's floor, so the kit menu's default (below the opener) would open off screen.
 */
const ABOVE_OPENER = "block-start span-inline-end";

// ─── The model ───────────────────────────────────────────────────────────────

/**
 * What a segment addresses. The kind is stamped on the element so a test — and a shot — can name a
 * step of the address without matching its rendered text, which is derived (the shot contract's R1,
 * `scripts/screenshots/README.md`).
 */
export type JumpSegmentKind = "file" | "editor" | "node";

/** One alternative in a segment's dropdown. Each is a command, exactly like the segment itself. */
export interface JumpChoice {
  label: string;
  command: string;
  args?: CommandArgs;
  /** The choice you are already on. Marked, never hidden — a menu that omits it loses its place. */
  current?: boolean;
}

/** One step of the address. */
export interface JumpSegment {
  kind: JumpSegmentKind;
  label: string;
  /** Extra tooltip context. The command's own title and chord are appended to it. */
  title?: string;
  /** The command that MOVES you here, or `null` when you are already here. */
  command: string | null;
  args?: CommandArgs;
  /** Where else this step could go. Fewer than two is not a choice, and renders no control. */
  choices: readonly JumpChoice[];
}

// ─── Labels ──────────────────────────────────────────────────────────────────

/**
 * The document's path with the project root taken off — the root is the PROJECT field to its left.
 *
 * Lives here rather than in `statusbar.ts`, where it started: the jump bar is the surface whose
 * whole job is naming the containment chain. Having the reader own it also keeps
 * `mock.module("surfaces/statusbar")` — which six bootstrap tests do — from deciding whether the
 * jump bar can name a file.
 */
export function documentLabel(path: string | null): string {
  if (!path) {
    return "Untitled";
  }
  const root = projectState?.projectRoot;
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

// ─── The selection trail (moved here from statusbar.ts) ──────────────────────

/** One crumb of the ancestor trail: what to call the node, and the path that selects it. */
export interface SelectionCrumb {
  label: string;
  path: JxPath;
}

/**
 * Walk the selection path one STRUCTURAL step at a time.
 *
 * Most steps are `["children", index]` or `["cases", name]` pairs, but a repeater template is
 * reached by a lone `"map"` segment — so the step width varies. Emitting a crumb per node keeps the
 * array pseudo-element ("Repeater") and its template both visible instead of collapsing the array
 * into a bare `[index]`.
 */
export function selectionCrumbs(document: unknown, selection: JxPath): SelectionCrumb[] {
  const crumbs: SelectionCrumb[] = [];
  for (let i = 0; i < selection.length;) {
    const seg = selection[i];
    const step = seg === "map" ? 1 : 2;
    const path = selection.slice(0, i + step) as JxPath;
    const node = getNodeAtPath(document as never, path);
    const fallbackTag = node?.tag;
    const label =
      node?.$prototype === "Array"
        ? "Repeater"
        : displayTagName(node?.tagName) ||
          (typeof fallbackTag === "string" ? fallbackTag : "") ||
          (seg === "cases" ? String(selection[i + 1]) : `[${selection[i + 1]}]`);
    crumbs.push({ label, path });
    i += step;
  }
  return crumbs;
}

/**
 * The siblings of one crumb, as choices — the dropdown that makes a segment a way to MOVE.
 *
 * Labels are `nodeLabel()`, the SAME strings the Outline prints, because a menu of alternatives is
 * a list of rows and the reader has already learned those words there. The crumb itself keeps its
 * compact tag label: a crumb is an address, a row is a choice.
 *
 * A `map` step has no siblings (a repeater holds exactly one template), and a text child is not
 * addressable, so both drop out and the segment renders no control at all.
 */
export function crumbSiblings(
  document: unknown,
  crumbs: readonly SelectionCrumb[],
  index: number,
): JumpChoice[] {
  const crumb = crumbs[index];
  if (!crumb) {
    return [];
  }
  const parentPath = (index === 0 ? [] : crumbs[index - 1]!.path) as JxPath;
  const parent = getNodeAtPath(document as never, parentPath);
  const key = crumb.path.at(-2);
  const own = crumb.path;
  if (key === "cases") {
    const cases = parent?.cases;
    if (!cases || typeof cases !== "object") {
      return [];
    }
    return Object.keys(cases).map((name) => {
      const path = [...parentPath, "cases", name] as JxPath;
      return choiceFor(document, path, name, own);
    });
  }
  if (key !== "children") {
    return [];
  }
  const choices: JumpChoice[] = [];
  for (const [i, child] of childList(parent).entries()) {
    if (typeof child === "string") {
      continue;
    }
    const path = [...parentPath, "children", i] as JxPath;
    choices.push(choiceFor(document, path, nodeLabel(child), own));
  }
  return choices;
}

function choiceFor(document: unknown, path: JxPath, fallback: string, own: JxPath): JumpChoice {
  const node = getNodeAtPath(document as never, path);
  const label = node ? nodeLabel(node) : fallback;
  const choice: JumpChoice = { args: { path }, command: "selection.set", label };
  // `pathsEqual`, not a joined key: a separator is a guess about what a segment cannot contain,
  // And the one this reached for was a literal NUL byte that made the whole file read as binary.
  return pathsEqual(path, own) ? { ...choice, current: true } : choice;
}

// ─── Building the address ────────────────────────────────────────────────────

/**
 * The whole address, as data. Pure: no registry, no DOM — the projection decides what is
 * renderable.
 *
 * Order is containment order, outermost first, which is the same left-to-right order the status bar
 * puts its three fields in. Nothing here reads the registry, so a segment is produced whether or
 * not its command happens to be registered; {@link projectStep} is where that difference shows.
 */
export function jumpSegments(
  tab: Tab | null,
  derived: PaneDerivation | null = null,
): JumpSegment[] {
  if (!tab) {
    return [];
  }
  // ONE document per tab, and no project segment before it: the status bar's PROJECT field sits
  // Directly to the left of this trail and already names the project, with the same
  // `project.openRecent` command. The document segment used to follow a `subdocument` segment per
  // `session.documentStack` frame, each one a `document.setStackLevel` you could click back to —
  // But nothing in `src/` ever pushed a frame. A tab holds a document; drilling in opens another
  // Tab.
  /* In a DERIVED pane the leading verb is Keep, not Open.
     The address is still the document — a lens draws the source pane's, a companion its own — but
     the question an author has about a pane that is following something is "can I stop it
     following and just keep this open". `pane.pin` answers it, and answers it with a REFUSAL for a
     lens: `projectStep` already renders a step whose command is disabled as a disabled button with
     `disabledReason` in the tooltip, so the sentence explaining why Code, Diff and breakpoint views
     cannot be pinned arrives for free. */
  const segments: JumpSegment[] = [
    {
      choices: [],
      command: derived ? "pane.pin" : "palette.openFiles",
      kind: "file",
      label: documentLabel(tab.documentPath),
      title: tab.documentPath ?? "Not saved to disk yet",
    },
  ];

  // A logic editor is the leaf of the address, and it has no selection under it: the Monaco buffer
  // And the formula workspace are editing a definition, not a node of the document tree.
  const editingFunction = tab.session.ui.editingFunction as FunctionEditDef | null;
  const editingFormula = tab.session.ui.editingFormula as FormulaEditDef | null;
  if (editingFunction) {
    segments.push(editorSegment("ƒ", editingFunction));
    return segments;
  }
  if (editingFormula) {
    segments.push(editorSegment("fx", editingFormula));
    return segments;
  }

  const selection = primarySelection(tab.session.selection);
  if (selection && selection.length > 0) {
    const crumbs = selectionCrumbs(tab.doc.document, selection);
    for (const [i, crumb] of crumbs.entries()) {
      const node = getNodeAtPath(tab.doc.document, crumb.path);
      segments.push({
        args: { path: crumb.path },
        choices: crumbSiblings(tab.doc.document, crumbs, i),
        // The leaf prints the Outline's label — the `$title` / `$id` an author gave the node — and
        // An ancestor prints its compact tag, so a deep address stays readable at 24px.
        command: "selection.set",
        kind: "node",
        label: i === crumbs.length - 1 && node ? nodeLabel(node) : crumb.label,
        title: crumb.path.join(" / "),
      });
    }
  }
  return segments;
}

function editorSegment(sigil: string, def: FunctionEditDef | FormulaEditDef): JumpSegment {
  return {
    choices: [],
    // No command, and none is missing: the Logic tab's own header carries the Close (§16.3), which
    // Is where a reader looking at the editor already is. A second exit up here would be a button
    // Beside the address that means "stop being at this address" — and the pane context bar drew
    // Exactly that, a Back of its own, until this excision removed it.
    command: null,
    kind: "editor",
    label: `${sigil} ${def.defName ?? def.eventKey ?? "editor"}`,
  };
}

// ─── The projection ──────────────────────────────────────────────────────────

/**
 * A step's identity across repaints — the repeater's key, and what `run` and `choose` are given.
 *
 * A NODE step is named by its path, so moving the selection one level up keeps every ancestor's
 * node (and the chevron the reader is aiming at) exactly where it was. Every other kind is a
 * singleton in the address, so its kind is name enough.
 */
function stepKey(segment: JumpSegment): string {
  const path = segment.args?.path;
  return segment.kind === "node" && Array.isArray(path)
    ? `node:${(path as JxPath).join("/")}`
    : segment.kind;
}

/** Whether the registry can actually run this id right now. */
function runnable(registry: CommandRegistry | null, id: string | null): id is string {
  return id !== null && Boolean(registry?.get(id)) && registry!.isVisible(id);
}

/** The tooltip: the segment's own context, then the command's title and chord. */
function segmentTitle(registry: CommandRegistry, segment: JumpSegment, id: string): string {
  const command = registry.get(id)!;
  const reason = registry.disabledReason(id);
  const chord = registry.keymap.formatBinding(id);
  const suffix = reason
    ? `${command.title} — requires ${reason}`
    : chord
      ? `${command.title} (${chord})`
      : command.title;
  return segment.title ? `${segment.title} · ${suffix}` : suffix;
}

/**
 * One step, as the document reads it.
 *
 * An unregistered or invisible command makes the step a READOUT rather than removing it, and more
 * than one alternative is what earns a chevron: one is not a choice, and a control that cannot move
 * is chrome (studio-ui-guidelines.md §12.2).
 */
function projectStep(
  registry: CommandRegistry | null,
  segment: JumpSegment,
  first: boolean,
  last: boolean,
): ProjectedStep {
  const id = segment.command;
  const live = runnable(registry, id);
  return {
    altsLabel: `Siblings of ${segment.label}`,
    control: live ? "button" : "readout",
    current: last,
    disabled: live && registry!.disabledReason(id!) !== undefined,
    hasChoices: registry !== null && segment.choices.length > 1,
    key: stepKey(segment),
    kind: segment.kind,
    label: segment.label,
    leading: first,
    title: live ? segmentTitle(registry!, segment, id!) : (segment.title ?? segment.label),
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/** The bar: the document mounted in the status bar's slot, and the address it last drew. */
interface Bar {
  host: HTMLElement;
  surface: JumpBarSurface;
  /** The segments behind the projection, by key — what `run` and `choose` resolve against. */
  segments: Map<string, JumpSegment>;
}

/**
 * Where the bar is mounted, once the status bar has a slot for it.
 *
 * ONE bar, not one per pane: the status bar is one row for the window, so the trail addresses the
 * focused pane. `surfaces/statusbar.ts` attaches its `trail` slot when its document mounts and
 * detaches it when it is disposed.
 */
let _bar: Bar | null = null;

let _scope: EffectScope | null = null;

let _menu: MenuHandle | null = null;

/** Close the open segment menu, if any. Idempotent. */
export function dismissJumpMenu(): void {
  const menu = _menu;
  _menu = null;
  menu?.close();
}

/**
 * Open a segment's alternatives, as the kit menu.
 *
 * The rows are built from the segment's choices, and every row runs a command — the same command
 * the segment itself names, with a different path. Nothing here decides what selecting means, and
 * nothing here draws a panel: `surfaces/menu.ts` owns the roving caret, typeahead, Escape and light
 * dismissal, because a list of commands is what that surface already is: a second one is the defect
 * studio-ui-guidelines.md §12.5 names.
 *
 * The menu hangs ABOVE the chevron. The bar is the window's floor, so there is nothing below it;
 * `place` is the same answer in coordinates, for an engine that cannot anchor a popover.
 */
function openChoices(segment: JumpSegment, anchor: HTMLElement | null): void {
  const registry = activeRegistry();
  if (!registry) {
    return;
  }
  dismissJumpMenu();
  const rows: MenuRowProjection[] = segment.choices.map((choice, i) => ({
    // The choice you are already on is MARKED rather than removed: a menu that omits your place
    // Loses it. `checked` is the element's own spelling of that, so the row announces itself.
    checked: choice.current === true ? "true" : "false",
    destructive: false,
    disabled: false,
    dividerAbove: false,
    id: String(i),
    run: () => {
      void runReported(registry, choice.command, choice.args, "Jump Bar");
    },
    title: choice.label,
  }));
  const handle = openMenu({
    label: `Go to a sibling of ${segment.label}`,
    onClosed: (closed) => {
      if (_menu === closed) {
        _menu = null;
      }
    },
    opener: anchor,
    placement: ABOVE_OPENER,
    ...(anchor ? { place: (box: DOMRect) => aboveOpener(anchor, box) } : {}),
    region: "jump-bar",
    rows,
  });
  _menu = handle;
}

/**
 * The menu's corner when it hangs above `anchor`: its bottom on the anchor's top, leading edges
 * aligned.
 */
export function aboveOpener(anchor: HTMLElement, box: DOMRect): { x: number; y: number } {
  const rect = rectOf(anchor);
  return { x: Math.round(rect.left), y: Math.max(0, Math.round(rect.top - box.height)) };
}

/** The address of the focused pane, and the segments behind it. */
function projectFocused(): { steps: ProjectedStep[]; segments: JumpSegment[] } {
  const paneId = activePane().id;
  const segments = jumpSegments(tabOfPane(paneId), derivationOfPane(paneId));
  const registry = activeRegistry();
  return {
    segments,
    steps: segments.map((segment, i) =>
      projectStep(registry, segment, i === 0, i === segments.length - 1),
    ),
  };
}

/** Paint the bar. Exported because the bootstrap paints once before mounting the effect. */
export function renderJumpBar(): void {
  if (!_bar) {
    return;
  }
  // The address changed, so an open menu is describing a place that may no longer be on the bar.
  // Repaints happen only when tracked state moves, so this cannot close a menu you are reading.
  dismissJumpMenu();
  const { segments, steps } = projectFocused();
  _bar.segments = new Map(steps.map((step, i) => [step.key, segments[i]!]));
  _bar.surface.update(steps);
}

/**
 * Give the bar somewhere to paint, or take it away.
 *
 * Called by `surfaces/statusbar.ts` as its document mounts and as it is disposed. Detaching
 * disposes the mount first: the slot being removed still has this bar's document in it, and the
 * runtime that owns that DOM is about to be unreachable.
 *
 * @param {HTMLElement | null} host
 */
export function attachJumpBarHost(host: HTMLElement | null): void {
  if (_bar?.host === host) {
    return;
  }
  if (_bar) {
    dismissJumpMenu();
    _bar.surface.dispose();
    _bar = null;
  }
  if (!host) {
    return;
  }
  _bar = {
    host,
    segments: new Map(),
    surface: mountJumpBarSurface(host, JUMP_BAR_REGION, {
      choose: (key, anchor) => {
        const segment = _bar?.segments.get(key);
        if (segment) {
          openChoices(segment, anchor);
        }
      },
      run: (key) => {
        const segment = _bar?.segments.get(key);
        const registry = activeRegistry();
        if (segment?.command && registry) {
          void runReported(registry, segment.command, segment.args, "Jump Bar");
        }
      },
    }),
  };
  renderJumpBar();
}

/**
 * Subscribe the bar to the state it renders. Idempotent: a second call replaces the effect.
 *
 * Called by `surfaces/statusbar.ts`'s `mountStatusbar`, which owns the bar's lifecycle because the
 * trail is its DOCUMENT field. The host arrives separately ({@link attachJumpBarHost}), and either
 * may come first: the effect paints whatever host is attached, and attaching paints at once.
 */
export function mountJumpBar(): void {
  _scope?.stop();
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      // The registry is composed AFTER the bootstrap mounts this, and it is a reactive holder —
      // Reading it here is what repaints the bar from a skeleton into the real thing.
      void activeRegistry();
      void projectState?.name;
      // The FOCUSED pane's tab: clicking into the other pane re-points the trail.
      void workspace.activePaneId;
      void workspace.panes.length;
      const tab = tabOfPane(activePane().id);
      if (tab) {
        void tab.doc.document;
        void tab.documentPath;
        void tab.session.selection.map((path) => path.join("/")).join("|");
        void tab.session.ui.editingFormula;
        void tab.session.ui.editingFunction;
      }
      renderJumpBar();
    });
  });
}

/** Stop the effect and take the bar down. */
export function unmountJumpBar(): void {
  dismissJumpMenu();
  _scope?.stop();
  _scope = null;
  attachJumpBarHost(null);
}

// ─── This bar contributes no commands ────────────────────────────────────────
// It declared one, `document.setStackLevel` — "leave a sub-document by naming the level you want to
// Be at". Its `enablement` read `session.documentStack.length > 0`, a stack nothing could ever push
// To, so the command was permanently disabled and its palette entry permanently unreachable. Every
// Id the bar renders now belongs to the surface that owns the behaviour: `palette.openFiles`,
// `pane.pin`, `selection.set`.
