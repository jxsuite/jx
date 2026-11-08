/// <reference lib="dom" />
/**
 * Quick publish: the popover behind the chevron beside the Publish workspace tab (studio.md §22.8).
 *
 * The workspace is where a change set is reviewed; this is where it is sent when there is nothing
 * to review. It shows the count, the first few changes as the site names them (a page, a post, a
 * template, with what else a template changes), the rest summed up by kind, the destination, the
 * summary and the checks in one line, and **Publish now** takes EVERY change, not only the included
 * ones, because the panel lists all of them and has no checkbox to leave one out. **Review all**
 * closes it and opens the workspace on Review changes, where each change can be included or left
 * out.
 *
 * The words are Review changes' own (`publish/review-changes.ts` names the changes,
 * `publish/publish-changes.ts` the destinations and checks), and so is the verb: the panel and the
 * workspace cannot disagree about what a change is or what Publish live does.
 *
 * @docs studio/publish
 */

import { effect, effectScope, reactive } from "../reactivity";
import { runActiveReported } from "../commands/run-reported";
import { shell } from "../shell";
import { openPublishQuickSurface } from "../surfaces/publish-quick";
import { pagesDrawnIn } from "../content/collection-pages";
import { resolveLayoutDoc } from "../site-context";
import { reviewItems } from "./review-changes";
import {
  checksLine,
  destinationChoices,
  effectiveDestination,
  publishBlocker,
  publishChanges,
  publishChecks,
} from "./publish-changes";
import { isPublishDestination } from "./publish-ids";
import type { EffectScope } from "@vue/reactivity";
import type { ReviewItem } from "./review-changes";
import type {
  PublishQuickSurfaceHandle,
  PublishQuickView,
  QuickChangeRow,
} from "../surfaces/publish-quick";

/** How many files the short list names before it says how many more there are. */
export const QUICK_LIST_LIMIT = 4;

/** How many pages each changed template is drawn on, by path, once the panel has read them. */
const _reach = reactive<Record<string, number>>({});

/** What else a change touches, as its row says it: "affects 4 pages", or "" for none known. */
function reachNote(item: ReviewItem): string {
  const pages = _reach[item.path];
  if (pages === undefined || pages === 0 || item.tag === "delete") {
    return "";
  }
  return `affects ${pages} ${pages === 1 ? "page" : "pages"}`;
}

/** One change as the short list draws it: Review changes' own name and tag. */
function quickRow(item: ReviewItem): QuickChangeRow {
  return {
    key: item.path,
    label: item.label,
    note: reachNote(item),
    path: item.path,
    tag: item.tagLabel,
    tagKind: item.tag,
  };
}

/** The changes past the short list, summed up by kind: "+ 1 post, 2 images". */
export function moreLine(rest: readonly ReviewItem[]): string {
  const counts = new Map<string, { count: number; one: string; many: string }>();
  for (const item of rest) {
    const entry = counts.get(item.noun) ?? { count: 0, many: item.nounPlural, one: item.noun };
    entry.count += 1;
    counts.set(item.noun, entry);
  }
  const parts = [...counts.values()].map(
    ({ count, many, one }) => `${count} ${count === 1 ? one : many}`,
  );
  return parts.length === 0 ? "" : `+ ${parts.join(", ")}`;
}

/** A layout's own `$layout`: the one it is drawn in, as the build chains them. */
async function parentLayoutOf(path: string): Promise<string | false | undefined> {
  const doc = await resolveLayoutDoc(path);
  return doc?.$layout;
}

/** Read how many pages each changed template is drawn on, for the rows that name one. */
function readReach(items: readonly ReviewItem[]): void {
  for (const item of items) {
    if (item.noun === "template" && item.tag !== "delete" && !(item.path in _reach)) {
      void pagesDrawnIn(item.path, parentLayoutOf).then((pages) => {
        _reach[item.path] = pages;
      });
    }
  }
}

/** What the dialog draws right now. */
export function quickPublishView(): PublishQuickView {
  const files = shell.git.status?.files ?? [];
  const items = reviewItems(files);
  const chosen = shell.publish.destination;
  const destination = effectiveDestination(chosen);
  const checks = publishChecks();
  const open = checks.some((check) => check.state !== "done");
  const blocker = shell.git.error || publishBlocker(destination, true);
  const shown = items.slice(0, QUICK_LIST_LIMIT);
  const rest = items.slice(QUICK_LIST_LIMIT);
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
    hasMore: rest.length > 0,
    listState: files.length > 0 ? "listed" : "empty",
    more: moreLine(rest),
    rows: shown.map((item) => quickRow(item)),
    summary: shell.git.commitMessage,
  };
}

interface OpenDialog {
  handle: PublishQuickSurfaceHandle;
  scope: EffectScope;
}

let _open: OpenDialog | null = null;

/** Close the panel. Idempotent. */
export function closeQuickPublish(): void {
  const open = _open;
  _open = null;
  if (open) {
    open.scope.stop();
    open.handle.close();
  }
}

/**
 * Open the panel, or leave the one already up alone.
 *
 * @returns The panel's handle, whose `ready` settles once it is showing.
 */
export function openQuickPublish(): PublishQuickSurfaceHandle {
  if (_open) {
    return _open.handle;
  }
  // A refusal from an earlier attempt is not this panel's to show.
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
    /* The chevron it hangs from, by the command it runs: the panel is that command's, wherever it
       was run from, and the platform places it against the chevron. */
    anchor: document.querySelector<HTMLElement>('[data-command="publish.quick"]'),
    view: quickPublishView(),
  });
  readReach(reviewItems(shell.git.status?.files ?? []).slice(0, QUICK_LIST_LIMIT));
  const scope = effectScope();
  scope.run(() => {
    effect(() => {
      handle.update(quickPublishView());
    });
  });
  _open = { handle, scope };
  return handle;
}
