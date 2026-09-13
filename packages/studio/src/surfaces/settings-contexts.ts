/// <reference lib="dom" />
/**
 * The Contexts surface: Project Settings › Contexts, as a Jx document over the kit.
 *
 * The adapter owns the MOUNT and the scope; `settings/contexts-section.ts` owns the decisions —
 * what a context is, what refuses one, and what reaches `project.json`. The split is the one
 * `surfaces/about.ts` draws: a reactive record of exactly what the document renders, and a handle
 * whose `update` writes a fresh projection into it. Nothing repaints; the row whose message changed
 * is the row that changes.
 *
 * **Re-entrancy is the section's, not the host's.** A settings section is handed a container by
 * `panels/settings-pane.ts`, which may hand it the SAME container again (a nav click, an extension
 * registering, a command selecting an entry) and may in between give that container to a different
 * section, whose `litRender` replaces everything in it. So the handle can say whether what it
 * mounted is still there ({@link ContextsSurfaceHandle.attached}), which is what lets the section
 * re-use one mount for the ordinary case and rebuild only when it has actually been evicted.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import contextsDoc from "./settings-contexts.json";

import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("settings-contexts", contextsDoc as unknown as JxDocument);

/** One `$media` row, as the document draws it. */
export interface ContextRowView {
  /** The `$media` key, e.g. `--sm`. The row's identity, and its `data-context`. */
  key: string;
  /** The key without its leading dashes — what the name field holds. */
  name: string;
  query: string;
  /** `light` or `dark`, for a scheme row's select. */
  scheme: string;
  /**
   * Which control the value cell holds: a media query, or a colour scheme.
   *
   * A `$switch` discriminant rather than the row's `kind`, because a size row and a feature row are
   * different KINDS of context that take the same control — deriving the branch from the kind would
   * make the document repeat that fact in a third place.
   */
  control: "query" | "scheme";
  /**
   * This row is where the current refusal belongs.
   *
   * One flag, not two: both fields draw invalid AND the message line exists exactly when the
   * refusal is this row's, so a separate "has an error" discriminant would be a second spelling of
   * the same fact for the document to disagree with.
   */
  invalid: boolean;
  error: string;
  nameLabel: string;
  valueLabel: string;
  removeLabel: string;
}

/** One group of rows — a kind of context, its sentence, and its add button. */
export interface ContextGroupView {
  kind: string;
  label: string;
  desc: string;
  addLabel: string;
  /** What the group says instead of rows when it has none. */
  empty: string;
  hasRows: boolean;
  rows: ContextRowView[];
}

/** Everything the document draws, as one value. */
export interface ContextsView {
  base: string;
  baseInvalid: boolean;
  baseError: string;
  /** A whole-file write failure, which belongs to no single control. */
  sectionError: string;
  /** Schema problems `project.json` already had — a warning about the file, not a refusal. */
  notice: string;
  /** What an empty media-query field suggests. */
  queryPlaceholder: string;
  groups: ContextGroupView[];
}

/** What the reader can do here. Every one of them is a write the section decides on. */
export interface ContextsActions {
  setBase: (value: string) => void;
  rename: (key: string, value: string) => void;
  setQuery: (key: string, value: string) => void;
  setScheme: (key: string, value: string) => void;
  remove: (key: string) => void;
  add: (kind: string) => void;
}

export interface ContextsSurfaceHandle {
  /** The container the document was mounted into. */
  host: HTMLElement;
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  /** Whether what was mounted is still inside the host — see this module's header. */
  attached: () => boolean;
  update: (view: ContextsView) => void;
  dispose: () => void;
}

/**
 * The two `$switch` discriminants with no flag of their own are derived here rather than passed in:
 * "there is a message" is a restatement of the message, and a view that had to keep the two in step
 * would be a second place to get it wrong. The refusal lines need none — `invalid` already says
 * which control the message belongs to.
 */
interface ContextsScope extends Record<string, unknown>, ContextsView, ContextsActions {
  hasSectionError: boolean;
  hasNotice: boolean;
}

/** The view a freshly mounted surface starts on: nothing yet, and no complaint about it. */
function emptyView(): ContextsView {
  return {
    base: "",
    baseError: "",
    baseInvalid: false,
    groups: [],
    notice: "",
    queryPlaceholder: "",
    sectionError: "",
  };
}

/**
 * Mount the Contexts document into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The settings pane's section body
 * @param {ContextsActions} actions - What each control does
 * @returns {ContextsSurfaceHandle}
 */
export function mountContextsSurface(
  host: HTMLElement,
  actions: ContextsActions,
): ContextsSurfaceHandle {
  host.textContent = "";
  const scope = reactive<ContextsScope>({
    ...emptyView(),
    add: actions.add,
    hasNotice: false,
    hasSectionError: false,
    remove: actions.remove,
    rename: actions.rename,
    setBase: actions.setBase,
    setQuery: actions.setQuery,
    setScheme: actions.setScheme,
  }) as ContextsScope;

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("settings-contexts", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
      return surface.root as HTMLElement;
    }
    mounted = surface;
    return surface.root as HTMLElement;
  });

  return {
    attached: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      /* A mount still in flight has nothing in the host yet, and answering "no" to that would make
         a second synchronous render tear down the mount it is waiting for and start another. */
      return root === undefined ? true : root instanceof HTMLElement && host.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    host,
    ready,
    update(view) {
      scope.base = view.base;
      scope.baseError = view.baseError;
      scope.baseInvalid = view.baseInvalid;
      scope.groups = view.groups;
      scope.notice = view.notice;
      scope.queryPlaceholder = view.queryPlaceholder;
      scope.sectionError = view.sectionError;
      scope.hasNotice = view.notice !== "";
      scope.hasSectionError = view.sectionError !== "";
    },
  };
}
