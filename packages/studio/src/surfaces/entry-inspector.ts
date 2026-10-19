/// <reference lib="dom" />
/**
 * The Inspector's Entry tab surface: one collection entry's status, fields, page URL and file
 * (`specs/studio.md` §6, §22.5).
 *
 * This is the adapter. `content/entry-inspector.ts` decides everything and hands this module one
 * projection; the field form is an island the document renders empty (`part="fields"`) and the flow
 * fills through `onNodeCreated`, because `ui/schema-form.ts` hands back a host element.
 *
 * @docs studio/projects/content-types
 */

import { isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import entryInspectorDoc from "./entry-inspector.json";
import type { JxElement } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("entry-inspector", entryInspectorDoc);

/** Everything the document draws. Every field is a value. */
export interface EntryInspectorView {
  /** The region id stamped on the root. */
  region: string;
  /** What the entry is, said in the singular: "Post". */
  kind: string;
  /** "Draft", "Published", or "" for a collection with no draft workflow. */
  status: string;
  /** Whether the collection has a draft workflow at all. */
  draftAxis: "hidden" | "shown";
  draft: boolean;
  draftHint: string;
  /** `form` draws the field form's host; `none` says the collection declares no fields. */
  fieldsState: "form" | "none";
  /**
   * `shown` draws the URL; `none` says the collection has no page; `unlisted` that its page lists
   * the entries it publishes and this is not one; `loading` while the pages are read.
   */
  urlState: "shown" | "none" | "unlisted" | "loading";
  url: string;
  /** The file the entry is stored in. */
  path: string;
  /** What the file holds: ". Fields are its frontmatter, and the body is its Markdown." */
  storage: string;
}

/** What the tab's controls do. */
export interface EntryInspectorActions {
  /** The draft switch moved. A setter, never a toggle. */
  setDraft: (draft: boolean) => void;
  /** **Edit** opens Project Settings › Content types on this collection. */
  openFields: () => void;
  /** **Search appearance…** runs `document.openSeo` over this entry, as the Page tab's does. */
  openSeo: () => void;
}

/** The node the document renders empty for the flow to fill. */
export interface EntryInspectorIslands {
  /** The field form's host, whenever the document has just created one. */
  fieldsSlot: (host: HTMLElement) => void;
}

export interface EntryInspectorHandle {
  readonly ready: Promise<unknown>;
  /** Whether what was mounted is still inside the host. */
  attached: () => boolean;
  update: (view: EntryInspectorView) => void;
  dispose: () => void;
}

interface EntryInspectorScope extends EntryInspectorView, EntryInspectorActions {}

/** Write a view into the scope, field by field. */
function project(scope: EntryInspectorScope, view: EntryInspectorView): void {
  scope.region = view.region;
  scope.kind = view.kind;
  scope.status = view.status;
  scope.draftAxis = view.draftAxis;
  scope.draft = view.draft;
  scope.draftHint = view.draftHint;
  scope.fieldsState = view.fieldsState;
  scope.urlState = view.urlState;
  scope.url = view.url;
  scope.path = view.path;
  scope.storage = view.storage;
}

/** The `part` a node was authored with, or `""`. */
function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/**
 * Mount the Entry tab into `host`, the Inspector's Page body.
 *
 * @param host The body host.
 * @param view What to draw.
 * @param actions What the controls do.
 * @param islands Where the field form goes.
 */
export function mountEntryInspectorSurface(
  host: HTMLElement,
  view: EntryInspectorView,
  actions: EntryInspectorActions,
  islands: EntryInspectorIslands,
): EntryInspectorHandle {
  host.replaceChildren();
  const scope: EntryInspectorScope = reactive<EntryInspectorScope>({ ...view, ...actions });
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("entry-inspector", scope, host, {
    onNodeCreated: (element, _path, def) => {
      if (!disposed && element instanceof HTMLElement && partOf(def) === "fields") {
        islands.fieldsSlot(element);
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
    } else {
      mounted = surface;
    }
    return surface;
  });
  return {
    attached: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      return root === undefined ? true : host.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => project(scope, next),
  };
}
