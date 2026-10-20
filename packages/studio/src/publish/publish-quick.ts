/// <reference lib="dom" />
/**
 * Quick publish: the dialog behind the chevron beside the Publish workspace tab (studio.md §22.8).
 *
 * The workspace is where a change set is reviewed; this is where it is sent when there is nothing
 * to review. It shows the count, the first few files, the destination, the summary and the checks
 * in one line, and **Publish now** takes EVERY change, not only the included ones, because the
 * dialog lists all of them and has no checkbox to leave one out. **Review all** closes it and opens
 * the workspace on Review changes, where each file can be included or left out.
 *
 * The words are `publish/publish-changes.ts`'s, the same ones Review changes draws, and so is the
 * verb: the dialog and the workspace cannot disagree about what Publish live does.
 *
 * @docs studio/publish
 */

import { effect, effectScope } from "../reactivity";
import { runActiveReported } from "../commands/run-reported";
import { shell } from "../shell";
import { layerHost } from "../ui/layers";
import { openPublishQuickSurface } from "../surfaces/publish-quick";
import {
  checksLine,
  destinationChoices,
  effectiveDestination,
  publishBlocker,
  publishChanges,
  publishChecks,
} from "./publish-changes";
import { isPublishDestination } from "./publish-ids";
import { changeRow, statusTag } from "./source-control";
import type { EffectScope } from "@vue/reactivity";
import type { GitFileStatus } from "../types";
import type {
  PublishQuickSurfaceHandle,
  PublishQuickView,
  QuickChangeRow,
} from "../surfaces/publish-quick";

/** How many files the short list names before it says how many more there are. */
export const QUICK_LIST_LIMIT = 4;

/** One file as the short list draws it: Review changes' own row, with the compact tag. */
function quickRow(file: GitFileStatus): QuickChangeRow {
  const { dir, key, name, path, status } = changeRow(file);
  return { dir, key, name, path, status, tag: statusTag(status) };
}

/** What the dialog draws right now. */
export function quickPublishView(): PublishQuickView {
  const files = shell.git.status?.files ?? [];
  const chosen = shell.publish.destination;
  const destination = effectiveDestination(chosen);
  const checks = publishChecks();
  const open = checks.some((check) => check.state !== "done");
  const blocker = shell.git.error || publishBlocker(destination, true);
  const extra = files.length - QUICK_LIST_LIMIT;
  return {
    blocked: publishBlocker(destination, true) !== "",
    blocker,
    checksIcon: open ? "warning-circle" : "check",
    checksLine: checksLine(checks),
    checksState: open ? "open" : "done",
    countLine:
      files.length === 0
        ? "Nothing to publish"
        : `${files.length} ${files.length === 1 ? "change" : "changes"} ready`,
    destination,
    destinations: destinationChoices(chosen),
    hasBlocker: blocker !== "",
    hasMore: extra > 0,
    listState: files.length > 0 ? "listed" : "empty",
    more: extra > 0 ? `+ ${extra} more` : "",
    rows: files.slice(0, QUICK_LIST_LIMIT).map((file) => quickRow(file)),
    summary: shell.git.commitMessage,
  };
}

interface OpenDialog {
  handle: PublishQuickSurfaceHandle;
  scope: EffectScope;
}

let _open: OpenDialog | null = null;

/** Close the dialog. Idempotent. */
export function closeQuickPublish(): void {
  const open = _open;
  _open = null;
  if (open) {
    open.scope.stop();
    open.handle.close();
  }
}

/**
 * Open the dialog, or leave the one already up alone.
 *
 * @returns The dialog's handle, whose `ready` settles once it is showing.
 */
export function openQuickPublish(): PublishQuickSurfaceHandle {
  if (_open) {
    return _open.handle;
  }
  // A refusal from an earlier attempt is not this dialog's to show.
  shell.git.error = null;
  const handle = openPublishQuickSurface({
    actions: {
      closed: () => {
        if (_open?.handle === handle) {
          _open.scope.stop();
          _open = null;
        }
      },
      confirm: () => {
        void publishChanges(effectiveDestination(shell.publish.destination), {
          includeAll: true,
        }).then((published) => {
          if (published) {
            closeQuickPublish();
          }
        });
      },
      editSummary: (value) => {
        shell.git.commitMessage = value;
      },
      pickDestination: (value) => {
        if (isPublishDestination(value)) {
          shell.publish.destination = value;
        }
      },
      reviewAll: () => {
        closeQuickPublish();
        void runActiveReported("publish.open", { tab: "review" }, "Publish");
      },
    },
    layer: layerHost("dialog"),
    view: quickPublishView(),
  });
  const scope = effectScope();
  scope.run(() => {
    effect(() => {
      handle.update(quickPublishView());
    });
  });
  _open = { handle, scope };
  return handle;
}
