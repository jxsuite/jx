/// <reference lib="dom" />
/**
 * Problems — everything that must be fixed, listed until it is (plan §7.1, §7.2).
 *
 * `services/notify.ts` landed the RECORD in P4 wave A: a failure is a `Notification` with `tier:
 * "problem"`, which means the app promises to keep it until somebody fixes it. This is the surface
 * that keeps the promise. Until it existed, `problems` was a reactive array with a count (the rail
 * badge, the status bar) and no way to read what was in it.
 *
 * A row is the record, rendered:
 *
 * | Field      | Renders as                                                                 |
 * | ---------- | -------------------------------------------------------------------------- |
 * | `severity` | the glyph and the row's colour                                             |
 * | `message`  | the line                                                                   |
 * | `source`   | the group heading — "Save", "Source Control", "Canvas", "Assistant"        |
 * | `path`     | a button that opens the file it names                                      |
 * | `detail`   | a disclosure with the captured log (an Activity failure puts its log here) |
 * | `action`   | a REAL button, built from the command record, not a per-call-site closure  |
 *
 * **The recovery button is the command.** Its label is the command's title, its disabled state is
 * the command's `enablement`, and its tooltip is the command's `requires` sentence — four facts a
 * callback could carry none of, and the reason `NotifyOptions.action` is a command id. A row whose
 * command the registry does not have renders no button at all, rather than a dead one.
 *
 * **The body is a Jx document** (`surfaces/panel-problems.json`, mounted by
 * `surfaces/panel-problems.ts`), so this module no longer draws markup: it projects. Two
 * consequences worth knowing before editing it.
 *
 * The first is that the list keeps ITSELF up to date. A lit body was redrawn because the dock
 * repainted, and the dock repainted on this panel's own badge — a coincidence that happened to
 * cover every change to the list. {@link syncProblemsSurface} owns an `effect()` instead, so a
 * dismissed row, an arriving problem and a registry that has just been published each reach the
 * document whether or not anything else on screen moved.
 *
 * The second is {@link _painted}, and it is the answer to a question the Bottom dock asks of every
 * tab. `panels/bottom-dock.ts` runs EVERY registered panel's `afterRender` against the body it just
 * painted, showing or not — Logic needs that, because a Monaco instance outlives its own markup —
 * so "was I the tab that was drawn?" is a question each surface answers for itself. A lit panel
 * answered it by looking for its own markup in the host. This one has no markup in the host until
 * it mounts, so it answers with the call the dock already made: `render` runs for the active tab
 * only, and `afterRender` consumes what it left.
 *
 * **One record, one host.** Problems lives in the BOTTOM DOCK — plan §7.2's table says so outright
 * ("Problems | Bottom dock ⑪, badge on the rail") and §3.2 ⑪ makes it the dock's first tab. §3.2 ③
 * also lists it among the Navigator's panels; that line loses, because a list open in two docks at
 * once is two hosts for one record, and hosting it in the Navigator spends left-dock width on
 * something that belongs under the pane grid.
 *
 * **And no rail button.** It had one, in the PROJECT group, which meant a control on the far left
 * that opened a dock along the bottom — the rail carried a per-dock branch in three places to keep
 * that one button honest. It also made "things are wrong here" a permanent fixture of the shell,
 * which is a poor first thing to promise someone opening the product. The warning count in the
 * status bar is the standing signal, and it runs `view.setBottomTab { tab: "problems" }` — the same
 * verb Diff, Logic and Activity are reached by.
 */

import { nothing } from "lit-html";
import { effect, effectScope } from "../reactivity";
import { activeRegistry } from "../commands/active-registry";
import { clearProblems, dismiss, problemCount, problems } from "../services/notify";
import { mountProblemsSurface } from "../surfaces/panel-problems";
import { registerPanel } from "./panel-registry";
import type { Notification, Severity } from "../services/notify";
import type {
  ProblemGroupView,
  ProblemRowView,
  ProblemsActions,
  ProblemsSurfaceHandle,
  ProblemsValues,
} from "../surfaces/panel-problems";
import type { EffectScope } from "../reactivity";

/** The severity glyphs — the same four `ui/layers.ts` gives the toasts, for the same reason. */
const SEVERITY_ICON: Readonly<Record<Severity, string>> = {
  error: "✕",
  info: "ℹ",
  success: "✓",
  warn: "!",
};

/** Problems with no `source` are grouped under this heading rather than under an empty one. */
export const UNGROUPED_SOURCE = "Elsewhere";

/** One heading and the rows under it, in first-seen order. */
export interface ProblemGroup {
  source: string;
  records: Notification[];
}

/**
 * Group the list by `source`, keeping first-seen order.
 *
 * Grouped rather than sorted by severity: a reader who has just saved wants the save's failures
 * together, and the severity is already the glyph on every row. First-seen order also means a new
 * problem never reorders the rows above it, which is what makes the list readable while it grows.
 */
export function groupProblems(records: readonly Notification[] = problems): ProblemGroup[] {
  const groups: ProblemGroup[] = [];
  for (const record of records) {
    const source = record.source ?? UNGROUPED_SOURCE;
    const group = groups.find((candidate) => candidate.source === source);
    if (group) {
      group.records.push(record);
    } else {
      groups.push({ records: [record], source });
    }
  }
  return groups;
}

/**
 * Open the file a problem names.
 *
 * Lazily imported for the reason `panels/properties-panel.ts` and `panels/empty-state.ts` already
 * are: this module is on `shell.ts`'s static import path (the Bottom dock is mounted from there),
 * and a static edge would drag the file browser and the format host into the shell's own graph.
 */
function openProblemPath(path: string): void {
  void import("../files/files.js").then((m) => m.openFileInTab(path));
}

/**
 * Project one record for the document.
 *
 * The recovery button is a COMMAND, so its label, its gate and its reason all come off the registry
 * — an unregistered or hidden command projects `hasAction: false`, which is what lets a call site
 * name a capability that lands next phase without shipping a dead control meanwhile.
 */
function projectRow(record: Notification): ProblemRowView {
  const id = record.action;
  // `get` before `isVisible`: an id the registry has never seen is a button that never was, not a
  // Question it can answer.
  const registry = id === undefined ? null : activeRegistry();
  const known = registry && id !== undefined ? registry.get(id) : undefined;
  const command = known && id !== undefined && registry!.isVisible(id) ? known : null;
  const reason = command && id !== undefined ? registry!.disabledReason(id) : undefined;
  return {
    actionDisabled: reason !== undefined,
    actionLabel: command?.title ?? "",
    actionTitle:
      command === null
        ? ""
        : reason === undefined
          ? command.title
          : `${command.title} — requires ${reason}`,
    detail: record.detail ?? "",
    dismissLabel: `Dismiss: ${record.message}`,
    hasAction: command !== null,
    hasDetail: Boolean(record.detail),
    hasPath: Boolean(record.path),
    icon: SEVERITY_ICON[record.severity],
    id: record.id,
    message: record.message,
    path: record.path ?? "",
    pathTitle: `Open ${record.path ?? ""}`,
    severity: record.severity,
  };
}

/**
 * The whole list, as the document reads it.
 *
 * Read inside {@link syncProblemsSurface}'s effect, so every reactive read it makes — the store,
 * each record, the published registry — is a reason for the surface to be brought up to date.
 */
export function projectProblems(): ProblemsValues {
  const groups: ProblemGroupView[] = groupProblems().map((group) => ({
    rows: group.records.map((record) => projectRow(record)),
    source: group.source,
  }));
  return { clearLabel: `Clear ${problemCount()}`, groups, hasProblems: groups.length > 0 };
}

/** What a row can ask for. Each one is a decision this module owns; the document only names it. */
const ACTIONS: ProblemsActions = {
  clearAll: () => {
    clearProblems();
  },
  dismissRow: (id) => {
    dismiss(id);
  },
  openPath: (path) => {
    openProblemPath(path);
  },
  /* By id, because a document can only hand back a value: the record and the registry are both
     looked up at the moment of the click, which is also the moment the gate was last checked. */
  runAction: (id) => {
    const record = problems.find((candidate) => candidate.id === id);
    const registry = activeRegistry();
    if (record?.action === undefined || !registry) {
      return;
    }
    void registry.run(record.action, record.actionArgs);
  },
};

/** A mounted document, the body it is standing in, and the effect feeding it. */
interface Standing {
  host: HTMLElement;
  handle: ProblemsSurfaceHandle;
  scope: EffectScope;
}

/**
 * The one surface this panel has out, if any.
 *
 * One, and not a `WeakMap` keyed by host, because the HOST is what goes away: a collapsing dock
 * paints `nothing` over its whole body and then runs `afterRender` against the DOCK, so a map keyed
 * by the body that just left would never be asked about it again — and the effect inside it would
 * go on projecting into a document nobody can see, once per open-and-close. "One record, one host"
 * is this panel's own doctrine (see above); this is the same sentence, in state.
 */
let _standing: Standing | null = null;

/**
 * Whether the dock drew THIS tab in the pass whose `afterRender` is about to run.
 *
 * Set by `render` — which the dock calls for the active tab only — and consumed by `afterRender`,
 * which the dock calls for every tab. See the module docstring: it is the "am I on screen?" answer
 * for a panel whose body is a document rather than markup in the host.
 */
let _painted = false;

/** Take the document down and stop the effect feeding it. Safe to call when there is none. */
function unmountStanding(): void {
  if (!_standing) {
    return;
  }
  _standing.scope.stop();
  _standing.handle.dispose();
  _standing = null;
}

/**
 * Mount, update or take down the Problems document for the body the dock just painted.
 *
 * Idempotent by construction: the standing surface is kept while it is still in the host it was
 * given, and the effect beside it is what keeps it current, so a repaint with this tab showing does
 * nothing at all.
 *
 * @param {HTMLElement} host The panel body the dock painted, whichever tab it painted into it.
 */
export function syncProblemsSurface(host: HTMLElement): void {
  const painted = _painted;
  _painted = false;
  if (!painted) {
    // Another tab is showing, or the dock is collapsed. Either way this document is standing in
    // Somebody else's body, or in one nobody can see.
    unmountStanding();
    return;
  }
  if (_standing?.host === host && _standing.handle.connected()) {
    return;
  }
  unmountStanding();
  const handle = mountProblemsSurface(host, projectProblems(), ACTIONS);
  const scope = effectScope();
  scope.run(() => {
    effect(() => {
      // Tracked whether or not a row names a command: publishing a registry is what turns every
      // Recovery button on, and a list drawn before the bootstrap composed one has none.
      void activeRegistry();
      handle.update(projectProblems());
    });
  });
  _standing = { handle, host, scope };
}

/**
 * Define the Problems panel — the P3 placeholder, built.
 *
 * P3 registered this id with `when: () => false` and a `render` that threw: "declared in the design
 * and not yet in the app", holding the rail slot §3.2 ② had already spent so the budget counted it
 * from the day it was named. This is the edit that phase described — the predicate is gone, the
 * body is real, and the badge is live.
 *
 * One caller: `panels/bottom-dock.ts`'s {@link import("./bottom-dock").registerBottomPanels}, which
 * is the module that owns the dock this record is drawn in. `registerPanel` throws on a duplicate
 * id and there is no guard here, because a second call IS a second definition site.
 */
export function registerProblemsPanel(): void {
  registerPanel({
    id: "problems",
    title: "Problems",
    level: "project",
    dock: "bottom",
    // OFF THE RAIL, and the argument is the rail's own meaning rather than taste. Every other rail
    // Button opens a panel at the SIDE; this one opened a dock at the BOTTOM, so the rail had to
    // Grow a per-dock branch in three places to keep one button honest. It also made "Problems" a
    // Standing, first-class element of the shell's furniture — a product whose permanent navigation
    // Advertises a place to find things wrong with it. The count still reaches the user the moment
    // There is one, from the status bar (`surfaces/statusbar.ts`), which is where ambient project
    // State already lives beside the branch and the deploy step.
    rail: false,
    // Inert, like every other `rail: false` panel's: `PanelRecord.icon` is required and the manifest
    // Is only ever called by a rail button. The row that used to resolve it is gone from
    // `activity-bar.ts`, and `check-icons.ts` is what refuses to let the two drift apart.
    icon: "warning-circle",
    badge: () => problemCount() || null,
    // The body is a document, so there is nothing for lit to draw. What this call DOES is leave a
    // Mark saying the dock chose this tab — the whole of the seam, and the reason the record is
    // Still the one place the panel is defined.
    render: () => {
      _painted = true;
      return nothing;
    },
    afterRender: (_ctx, host) => {
      syncProblemsSurface(host);
    },
  });
}
