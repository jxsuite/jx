/// <reference lib="dom" />
/**
 * The one surface in Studio that still BLOCKS while it works — and now the only one (plan §7.3).
 *
 * What changed. This modal used to be four things at once: the running state, the error view, the
 * log and the operation's entire memory. It blocked the whole app, offered no way out, and took all
 * four with it when it closed — so a failed `bun install` could be read exactly once, and a hung
 * one could not be escaped at all. §7.3 splits those apart:
 *
 * - The **record** moves to `panels/activity-panel.ts`, which keeps the entry, its steps and its log
 *   after the modal is gone;
 * - The **error view** is promoted into Problems — {@link ProgressModalHandle.fail} raises a
 *   `notify.error` carrying the captured log as its `detail`, so the failure persists, is grouped
 *   by source, and carries a Retry built from a command record;
 * - And the **exit** arrives twice: `Run in the background` hands the app back while the operation
 *   keeps going in Activity, and an operation that passed a `cancel` gets a real Cancel button.
 *
 * What did NOT change is which operations block. §7.3 keeps blocking for dependency install and
 * nothing else, and this module's four call sites are exactly that — `packages/ensure-deps.ts`,
 * `packages/pull-package-sync.ts`, `packages/jxsuite-update.ts` and
 * `settings/dependencies-editor.ts`. Every other long operation calls `beginActivity` directly and
 * blocks nobody.
 *
 * The surface itself is `surfaces/progress-modal.json`, a `jx-dialog`; this module is the flow
 * around it and owns nothing that is drawn.
 */

import { beginActivity } from "../panels/activity-panel";
import { setBottomTab } from "../shell";
import { layerHost } from "./layers";
import { openProgressSurface } from "../surfaces/progress-modal";
import type { ActivityHandle } from "../panels/activity-panel";

export interface ProgressModalHandle {
  /** Update the status line shown under the title. Also the Activity entry's status. */
  setStatus: (text: string) => void;
  /** Append captured output. It is the Activity entry's log and a failure's `detail`. */
  log: (chunk: string) => void;
  /** Record the failure as a Problem (message + captured log) and close the modal. */
  fail: (message: string) => void;
  /** Close the modal and mark the operation done (success path). */
  done: () => void;
  /** The Activity entry this operation is recorded in, which outlives the modal. */
  activity: ActivityHandle;
}

export interface ProgressModalOptions {
  title: string;
  status?: string;
  /** Who is running it — "Packages" for all four of today's call sites. */
  source?: string;
  /**
   * Stop the operation. Draws Cancel, here and on the Activity row.
   *
   * Absent means the operation genuinely cannot be stopped, and no button claims otherwise — but
   * `Run in the background` is offered regardless, because "let me use the app" is a promise this
   * module can always keep.
   */
  cancel?: () => void;
}

/**
 * Show a blocking progress modal, and record the operation in Activity either way.
 *
 * @param {ProgressModalOptions} opts
 * @returns {ProgressModalHandle}
 */
export function showProgressModal(opts: ProgressModalOptions): ProgressModalHandle {
  let closed = false;

  const activity = beginActivity({
    title: opts.title,
    ...(opts.status === undefined ? {} : { status: opts.status }),
    ...(opts.source === undefined ? {} : { source: opts.source }),
    ...(opts.cancel === undefined ? {} : { cancel: opts.cancel }),
  });

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    surface.close();
  };

  /** Hand the app back and put the operation where it can be watched. */
  const background = () => {
    close();
    setBottomTab("activity");
  };

  const surface = openProgressSurface({
    cancellable: opts.cancel !== undefined,
    layer: layerHost("modal"),
    // Escape means the same thing the confirm button does: stop BLOCKING, not stop working. The
    // Operation owned the modal outright before, and swallowing Escape was the only honest thing a
    // Surface with nowhere to put a running operation could do.
    onBackground: background,
    onCancel: () => {
      close();
      opts.cancel?.();
    },
    // The platform's own close, whatever reached it: the document goes with the dialog.
    onClosed: close,
    status: opts.status ?? "",
    title: opts.title,
  });

  return {
    activity,
    done() {
      activity.done();
      close();
    },
    fail(message: string) {
      // The error view is not rendered here any more: it is the Problems row, with the log as its
      // `detail`, and it is still on screen tomorrow. Three of the four call sites hand over a
      // CAPTURED LOG as their message — `result.log ?? "bun install failed"` — so a multi-line one
      // Is split the way the old view split it: "<title> failed" as the headline, the whole text
      // As the detail. A Problems list whose first row is 400 lines of `bun` output is not a list.
      const text = (message ?? "").trim();
      if (text === "" || text.includes("\n")) {
        activity.log(text);
        activity.fail(`${opts.title} failed`);
      } else {
        activity.fail(text);
      }
      close();
    },
    log(chunk: string) {
      activity.log(chunk);
    },
    setStatus(text: string) {
      activity.setStatus(text);
      if (!closed) {
        surface.setStatus(text);
      }
    },
  };
}
