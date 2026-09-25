/// <reference lib="dom" />
/**
 * Activity — where a long operation lives while it runs, and what it leaves behind (plan §7.3).
 *
 * What this replaces: `ui/progress-modal.ts` was **the only surface in Studio with a real error
 * view** — a red headline, the captured log in a `<pre>`, an explicit Close — and it had four call
 * sites, all package operations. It blocked the whole app, offered no cancel, and vanished
 * completely on success, so a `bun install` that hung had no exit and one that failed had a log you
 * could read exactly once. Every OTHER long operation — git clone, publish, media upload, site
 * import, project open — got a three-second grey line or nothing at all.
 *
 * An activity is a **record**, like a notification and a command:
 *
 * - It is **persistent** — a finished operation stays on the list, with its log, until the list is
 *   cleared, so "what did the import actually do?" is answerable after the fact;
 * - It is **inspectable** — the log is the same captured output the modal used to show, and it is
 *   attached to the entry rather than to a modal that is about to close;
 * - It can be **cancelled** — an operation that hands over a `cancel` callback gets a Cancel button
 *   on its row, which is the affordance a hung install has never had;
 * - And it **fails into Problems** — {@link ActivityHandle.fail} raises a `notify.error` carrying the
 *   log as its `detail`, so the failure outlives the run and carries a Retry command. That is
 *   §7.3's "the progress modal's error view is promoted into Problems", in one function.
 *
 * **Nothing here blocks.** `showProgressModal` still exists for the four dependency-install sites
 * §7.3 keeps blocking, and it is now a thin front end over {@link beginActivity} — so even the
 * blocking case leaves an inspectable entry behind, and closing the modal no longer loses it.
 *
 * `services/idle.ts` reads {@link activityIdleBlockers}: an open operation means the app is not
 * settled, which is the §13.6 S4 obligation every phase's checklist carries.
 *
 * **The feed itself is a Jx document** (`surfaces/panel-activity.json`, mounted by
 * `surfaces/panel-activity.ts`). What stays here is the record and the vocabulary a row is written
 * in — the state glyphs, the duration, and {@link activityView}, which flattens the store into the
 * booleans a document can switch on. The tab's `render` paints two empty containers — one for the
 * deploy checklist, one for the feed — and its `afterRender` hands each to the module that owns it;
 * nothing in this file draws a row any more.
 */

import { html } from "lit-html";
import { syncDeployChecklist } from "../publish/deploy-checklist";
import { disposeActivitySurface, mountActivitySurface } from "../surfaces/panel-activity";
import { reactive } from "../reactivity";
import { now } from "../services/clock";
import { notify } from "../services/notify";
import { registerPanel } from "./panel-registry";
import type { PanelBody } from "./panel-registry";
import type {
  ActivityRowView,
  ActivityStepView,
  ActivitySurfaceDeps,
  ActivityView,
} from "../surfaces/panel-activity";

/** How an operation ended, or that it has not. */
export const ACTIVITY_STATES = ["running", "done", "failed", "cancelled"] as const;

export type ActivityState = (typeof ACTIVITY_STATES)[number];

/** One named phase of an operation — "Install dependencies", "Sync with the remote". */
export interface ActivityStep {
  label: string;
  state: "pending" | "running" | "done" | "failed";
}

/**
 * One operation, as recorded.
 *
 * Mutable and reactive on purpose: an activity is the one record in the app that CHANGES while you
 * watch it, which is the whole difference between it and a
 * {@link import("../services/notify") .Notification}. A host repaints by reading it.
 */
export interface ActivityEntry {
  readonly id: string;
  readonly title: string;
  /** The line under the title — what the operation is doing right now. */
  status: string;
  state: ActivityState;
  /** The captured output, one entry per chunk. Rendered in the expanded row. */
  log: string[];
  steps: ActivityStep[];
  /** Epoch ms from {@link now}, so a pinned clock pins the duration a row prints. */
  readonly startedAt: number;
  endedAt: number | null;
  /** Who is running it: "Packages", "Source Control", "Publish". Printed beside the title. */
  readonly source?: string;
  /** Whether a `cancel` callback was handed over — the row draws Cancel iff this is true. */
  cancellable: boolean;
  /** Whether this row's log is unfolded. A view flag, on the record, so a repaint keeps it. */
  expanded: boolean;
}

/**
 * Every operation this session, oldest first — running and finished alike.
 *
 * Exported as the array rather than behind a getter for the same reason `notify`'s stores are: that
 * is what makes it trackable, so a lit render effect that reads it re-runs when an operation
 * starts, logs a line or ends, with no subscription to remember to release.
 */
export const activities: ActivityEntry[] = reactive([]);

/**
 * How many FINISHED entries are kept. Running ones are never retired — an operation the app is
 * still doing is not history, and dropping it would take its Cancel button with it.
 */
export const MAX_FINISHED_ACTIVITIES = 20;

/**
 * Entry id → the callback that stops it.
 *
 * Held beside the record rather than on it: a closure inside a reactive proxy is a value effects
 * would track and nothing would ever compare, and the record is otherwise plain data. The record
 * carries `cancellable` so a renderer never needs this map.
 */
const _cancels = new Map<string, () => void>();

let _seq = 0;

/** Monotonic within a page load, and stable enough to be a lit `repeat` key. */
function nextId(): string {
  _seq += 1;
  return `a${_seq}`;
}

/** Whether an entry has stopped. */
export function isFinished(entry: ActivityEntry): boolean {
  return entry.state !== "running";
}

/** Drop the oldest finished entries once there are more than {@link MAX_FINISHED_ACTIVITIES}. */
function retireOldest(): void {
  let excess = activities.filter((entry) => isFinished(entry)).length - MAX_FINISHED_ACTIVITIES;
  while (excess > 0) {
    const at = activities.findIndex((entry) => isFinished(entry));
    if (at === -1) {
      return;
    }
    _cancels.delete(activities[at]!.id);
    activities.splice(at, 1);
    excess -= 1;
  }
}

/** What {@link beginActivity} is told about an operation up front. */
export interface ActivityOptions {
  /** What the operation IS — "Open project", "Update dependencies". Never changes. */
  title: string;
  /** What it is doing right now. Changes as it goes. */
  status?: string;
  /** Who is running it — "Packages", "Source Control". Groups nothing yet; printed on the row. */
  source?: string;
  /** The plan, declared up front so the row shows how far along it is. */
  steps?: readonly string[];
  /**
   * Stop the operation.
   *
   * Its presence is what draws the Cancel button, so an operation that cannot honestly be stopped
   * must not pass one — a Cancel that does nothing is the failure §7 exists to end, restated as a
   * button.
   */
  cancel?: () => void;
}

/** The live handle an operation drives its own entry through. */
export interface ActivityHandle {
  readonly id: string;
  /** The record itself, for a caller that wants to read its own log back. */
  readonly entry: ActivityEntry;
  /** Replace the line under the title. */
  setStatus: (text: string) => void;
  /** Append captured output. Blank chunks are dropped, so a trailing newline is not a log line. */
  log: (chunk: string) => void;
  /** Mark `label` as the running step; every step before it is done. Appends an unplanned one. */
  step: (label: string) => void;
  /** Finish successfully. */
  done: (status?: string) => void;
  /**
   * Finish with a failure — and raise the Problem that outlives it.
   *
   * The log goes into the notification's `detail`, so the persistent, inspectable error view §7.3
   * asks for is the Problems row, not a modal that has to stay open to be read.
   */
  fail: (message: string, opts?: { action?: string; path?: string }) => void;
}

/**
 * Start recording an operation.
 *
 * @param {ActivityOptions} options
 * @returns {ActivityHandle}
 */
export function beginActivity(options: ActivityOptions): ActivityHandle {
  const entry: ActivityEntry = {
    cancellable: options.cancel !== undefined,
    endedAt: null,
    expanded: false,
    id: nextId(),
    log: [],
    startedAt: now(),
    state: "running",
    status: options.status ?? "",
    steps: (options.steps ?? []).map((label) => ({ label, state: "pending" as const })),
    title: options.title,
    ...(options.source === undefined ? {} : { source: options.source }),
  };
  if (options.cancel) {
    _cancels.set(entry.id, options.cancel);
  }
  activities.push(entry);
  // The PROXY, not the literal: writing through the raw object a `reactive()` array was handed
  // Skips every effect depending on it, which is the one bug that would make a running operation
  // Look frozen. Read back before anything is retired, so the reference is unambiguous.
  const live = activities.at(-1) as ActivityEntry;
  retireOldest();

  const finish = (state: ActivityState, status?: string) => {
    if (isFinished(live)) {
      return;
    }
    live.state = state;
    live.endedAt = now();
    if (status !== undefined) {
      live.status = status;
    }
    for (const step of live.steps) {
      step.state = step.state === "done" ? "done" : state === "done" ? "done" : "failed";
    }
    live.cancellable = false;
    _cancels.delete(live.id);
    retireOldest();
  };

  return {
    done(status?: string) {
      finish("done", status);
    },
    entry: live,
    fail(message: string, opts: { action?: string; path?: string } = {}) {
      // An operation that has already ended does not get to raise a Problem: the first outcome is
      // The one that happened, and a late `fail()` after a successful `done()` would put a failure
      // On a list whose whole promise is that everything on it still needs fixing.
      if (isFinished(live)) {
        return;
      }
      const detail = live.log.join("\n");
      finish("failed", message);
      notify.error(message, {
        source: live.source ?? live.title,
        ...(detail === "" ? {} : { detail }),
        ...(opts.action === undefined ? {} : { action: opts.action }),
        ...(opts.path === undefined ? {} : { path: opts.path }),
      });
    },
    id: live.id,
    log(chunk: string) {
      const text = chunk.replace(/\s+$/, "");
      if (text !== "") {
        live.log.push(text);
      }
    },
    setStatus(text: string) {
      if (!isFinished(live)) {
        live.status = text;
      }
    },
    step(label: string) {
      let at = live.steps.findIndex((step) => step.label === label);
      if (at === -1) {
        live.steps.push({ label, state: "pending" });
        at = live.steps.length - 1;
      }
      for (const [index, step] of live.steps.entries()) {
        step.state = index < at ? "done" : index === at ? "running" : step.state;
      }
      live.status = label;
    },
  };
}

/** One entry by id, or `undefined`. */
export function activityById(id: string): ActivityEntry | undefined {
  return activities.find((entry) => entry.id === id);
}

/** Everything still running, oldest first — what the badge counts and idle waits on. */
export function runningActivities(): ActivityEntry[] {
  return activities.filter((entry) => !isFinished(entry));
}

/**
 * Stop an operation: run its callback, mark it cancelled. Returns whether anything was stopped.
 *
 * The callback runs BEFORE the state changes, so an implementation that throws leaves the entry
 * honestly still running rather than claiming a cancellation that did not happen.
 */
export function cancelActivity(id: string): boolean {
  const entry = activityById(id);
  const stop = _cancels.get(id);
  if (!entry || !stop || isFinished(entry)) {
    return false;
  }
  stop();
  _cancels.delete(id);
  entry.state = "cancelled";
  entry.endedAt = now();
  entry.cancellable = false;
  entry.status = "Cancelled";
  return true;
}

/** Drop every finished entry. Returns how many went. Running operations are kept. */
export function clearFinishedActivities(): number {
  const kept = activities.filter((entry) => !isFinished(entry));
  const removed = activities.length - kept.length;
  activities.splice(0, activities.length, ...kept);
  return removed;
}

/** Clear the whole list — tests, and the "close project" path. */
export function resetActivities(): void {
  activities.splice(0);
  _cancels.clear();
}

/**
 * What is still running, as `services/idle.ts` phrases it.
 *
 * §13.6 S4 puts this on every phase's checklist: an app with an operation in flight has not
 * finished reacting, so a screenshot taken now photographs a half-done import. A FINISHED entry is
 * not a blocker — the list stays on screen forever and waiting for it to empty would never settle.
 */
export function activityIdleBlockers(): readonly string[] {
  return runningActivities().map(
    (entry) => `activity: ${entry.title} — ${entry.status || "running"}`,
  );
}

// ─── The surface ──────────────────────────────────────────────────────────────

/** The state glyphs. One character each: the row's job is a line of text, not an illustration. */
const STATE_ICON: Readonly<Record<ActivityState, string>> = {
  cancelled: "⊘",
  done: "✓",
  failed: "✕",
  running: "⋯",
};

const STEP_ICON: Readonly<Record<ActivityStep["state"], string>> = {
  done: "✓",
  failed: "✕",
  pending: "·",
  running: "⋯",
};

/** How long it took, in the coarsest unit that is still true. */
export function activityDuration(entry: ActivityEntry, at: number = now()): string {
  const ms = Math.max(0, (entry.endedAt ?? at) - entry.startedAt);
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** One step, as the document reads it. */
function stepView(step: ActivityStep, index: number): ActivityStepView {
  return {
    icon: STEP_ICON[step.state],
    // The label alone is not unique — an operation may append an unplanned step it already ran —
    // So the position is what keeps a key stable across a re-projection.
    key: `${index}:${step.label}`,
    label: step.label,
    state: step.state,
  };
}

/** One operation, as the document reads it. */
function rowView(entry: ActivityEntry): ActivityRowView {
  const lines = entry.log.length;
  return {
    cancellable: entry.cancellable,
    duration: activityDuration(entry),
    expanded: entry.expanded,
    hasLog: lines > 0,
    hasSource: (entry.source ?? "") !== "",
    hasStatus: entry.status !== "",
    hasSteps: entry.steps.length > 0,
    icon: STATE_ICON[entry.state],
    id: entry.id,
    logLabel: entry.expanded ? "Hide log" : `Show log (${lines} line(s))`,
    logText: entry.log.join("\n"),
    showLog: entry.expanded && lines > 0,
    source: entry.source ?? "",
    state: entry.state,
    status: entry.status,
    steps: entry.steps.map((step, index) => stepView(step, index)),
    title: entry.title,
  };
}

/**
 * What the Activity surface shows right now.
 *
 * Newest LAST, like a log and unlike a menu: an operation that starts while you are reading one
 * that is already running must not push it off the top.
 *
 * Read from inside the surface's own effect, which is what makes every field here live: the array,
 * each entry's state and status, its steps and the length of its log are all tracked on the way
 * through, so a chunk appended to an open row updates that row's `<pre>` and nothing else.
 *
 * @returns {ActivityView}
 */
export function activityView(): ActivityView {
  const finished = activities.filter((entry) => isFinished(entry)).length;
  return {
    clearLabel: `Clear ${finished} finished`,
    hasFinished: finished > 0,
    hasRows: activities.length > 0,
    rows: activities.map((entry) => rowView(entry)),
  };
}

/**
 * The three decisions a click on the feed can ask for, beside the projection it reads.
 *
 * Every one of them is the panel's: the surface knows an entry's id and nothing else about it, so
 * "what does Cancel do to a running install" is answered here and cannot drift into markup.
 */
const ACTIVITY_SURFACE: ActivitySurfaceDeps = {
  cancel: (id: string) => {
    cancelActivity(id);
  },
  clearFinished: () => {
    clearFinishedActivities();
  },
  project: activityView,
  toggleLog: (id: string) => {
    const entry = activityById(id);
    if (entry) {
      // Through the reactive proxy `activityById` returns, so the effect that projects the feed
      // Re-runs and the row's `<pre>` appears without anything repainting the panel.
      entry.expanded = !entry.expanded;
    }
  },
};

/**
 * The Activity tab's body: a container for the deploy checklist, then one for the feed.
 *
 * Two documents, two hosts, and that is the seam rather than a layout: a document CLEARS the host
 * it is given and lit renders BESIDE foreign nodes, so a document and a lit template can never
 * share a container. The checklist belongs to `publish/deploy-checklist.ts` — a deploy is a long
 * operation with a log, which is why P4 folded it in here rather than giving it a fifth dock tab —
 * and it sits above the feed because its whole job is to say what is missing BEFORE you begin.
 *
 * **`data-deploy-checklist` and `data-activity-surface` are the markers, and they are attributes
 * rather than classes for two reasons.** Nothing styles them, and a class no stylesheet defines is
 * an orphan the styling gate is right to refuse. And the dock runs EVERY tab's `afterRender`
 * against the same painted body whether or not that tab is showing (`panels/bottom-dock.ts`), so a
 * marker lit paints only for this tab is also the answer to "am I on screen?" — which is the
 * question the Logic tab settles the same way, with its own empty `[part="code-host"]` container.
 *
 * @returns {PanelBody}
 */
export function renderActivityBody(): PanelBody {
  return html`<div data-deploy-checklist></div>
    <div data-activity-surface></div>`;
}

/**
 * Bring the feed up to date with what has just been painted.
 *
 * The panel's `afterRender`, so it runs against the DOM lit has committed — and it runs on every
 * paint of the dock, including the ones where another tab is showing. No container means this tab
 * is not on screen, and the document standing in DOM that lit has already thrown away is disposed
 * rather than left holding an effect.
 *
 * @param {HTMLElement} host The dock body element the tab was rendered into.
 */
export function syncActivitySurface(host: HTMLElement): void {
  const container = host.querySelector<HTMLElement>("[data-activity-surface]");
  if (!container) {
    disposeActivitySurface();
    return;
  }
  mountActivitySurface(container, ACTIVITY_SURFACE);
}

/**
 * Define the Activity panel. Called by `panels/bottom-dock.ts`, beside the state it writes.
 *
 * `level: "project"` because an operation is a thing done TO a project — an install, a clone, a
 * publish — and the list must not empty itself when the last document closes, which is the same
 * rule that hoisted source control off `TabUi`.
 */
export function registerActivityPanel(): void {
  registerPanel({
    id: "activity",
    title: "Activity",
    level: "project",
    dock: "bottom",
    icon: "clock-counter-clockwise",
    // No rail button: the Bottom dock's tabs are reached by ⌘J and `view.setBottomTab`, and a
    // Fifth rail slot for a surface with no steady state would spend chrome §2 principle 9 caps.
    rail: false,
    badge: () => (runningActivities().length > 0 ? runningActivities().length : null),
    render: () => renderActivityBody(),
    afterRender: (_ctx, host) => {
      /* Two surfaces, each told about the same painted body and each finding its own container in
         it — or not finding it, which is how either one learns the tab is off screen. */
      syncDeployChecklist(host);
      syncActivitySurface(host);
    },
  });
}
