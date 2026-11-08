/// <reference lib="dom" />
/**
 * Quick publish, as a mounted popover (studio.md §22.8).
 *
 * This is the adapter: the reactive scope `publish-quick.json` reads, and the panel that hangs from
 * the chevron beside the Publish workspace tab until the flow (`publish/publish-quick.ts`) takes it
 * down. The panel is a `jx-popover` shown from that chevron (`ui/popover-surface.ts`), so the
 * platform owns light dismissal, Escape, focus restoration and placement against the chevron;
 * nothing here draws a backdrop or measures a position.
 *
 * @docs studio/publish
 */

import { reactive } from "../reactivity";
import { openPopoverSurface } from "../ui/popover-surface";
import { registerSurface } from "../ui/surface";
import publishQuickDoc from "./publish-quick.json";
import type { DestinationChoice } from "../publish/publish-changes";
import type { PublishDestination } from "../publish/publish-ids";
import type { ReviewTag } from "../publish/review-changes";

registerSurface("publish-quick", publishQuickDoc);

/** One change in the short list, named as Review changes names it. */
export interface QuickChangeRow {
  key: string;
  /** The file, which is the row's tooltip: what is committed, one hover away. */
  path: string;
  /** NEW, EDIT, DELETE, RENAME: a word, not git's letter. */
  tag: string;
  /** What the tag means, which colours it. */
  tagKind: ReviewTag;
  /** What the site calls it: "Pricing", "Base template". */
  label: string;
  /** What else it changes, "affects 4 pages", or "" for a change that touches only itself. */
  note: string;
}

/** Everything the dialog draws. */
export interface PublishQuickView {
  /** "5 changes ready". */
  countLine: string;
  listState: "listed" | "empty";
  rows: QuickChangeRow[];
  hasMore: boolean;
  /** "+ 2 more". */
  more: string;
  destination: PublishDestination;
  destinations: DestinationChoice[];
  summary: string;
  /** `done` when every check passed, `open` while any is not. */
  checksState: "done" | "open";
  /**
   * The kit icon beside the checks line: `check` when every check passed, `warning-circle` while
   * any is open.
   */
  checksIcon: string;
  checksLine: string;
  blocked: boolean;
  hasBlocker: boolean;
  blocker: string;
}

/** What a control asks the flow to do. */
export interface PublishQuickActions {
  confirm: () => void;
  reviewAll: () => void;
  pickDestination: (value: string) => void;
  editSummary: (value: string) => void;
  /** The panel closed, for any reason the platform owns as well as the flow's own `close`. */
  closed: () => void;
}

export interface PublishQuickSurfaceOptions {
  /** The chevron it hangs from, or null when the command ran from somewhere with none showing. */
  anchor: HTMLElement | null;
  view: PublishQuickView;
  actions: PublishQuickActions;
}

export interface PublishQuickSurfaceHandle {
  host: HTMLElement;
  /** Settles once the panel is showing, or it was closed first. */
  ready: Promise<void>;
  update: (view: PublishQuickView) => void;
  /** Close the panel (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

type PublishQuickScope = PublishQuickView & PublishQuickActions;

/** Open the panel. The handle's `ready` settles once it is showing. */
export function openPublishQuickSurface(
  options: PublishQuickSurfaceOptions,
): PublishQuickSurfaceHandle {
  let closed = false;
  /** Say it is over, once: the platform's own dismissal and `close()` may each be first. */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.actions.closed();
  };
  const { actions } = options;
  const scope = reactive<PublishQuickScope>({
    ...options.view,
    closed: finish,
    confirm: actions.confirm,
    editSummary: (value: string) => {
      /* What the control holds, first and unconditionally: a binding only writes when the scope
         CHANGES (`studio-ui-guidelines.md` §9.3). */
      scope.summary = value;
      actions.editSummary(value);
    },
    pickDestination: actions.pickDestination,
    reviewAll: actions.reviewAll,
  });
  const panel = openPopoverSurface({
    anchor: options.anchor,
    name: "publish-quick",
    onDismissed: finish,
    scope,
    slot: "publish-quick",
  });
  return {
    close() {
      panel.close();
      finish();
    },
    host: panel.host,
    ready: panel.ready,
    update(view) {
      Object.assign(scope, view);
    },
  };
}
