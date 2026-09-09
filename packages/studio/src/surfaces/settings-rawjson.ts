/// <reference lib="dom" />
/**
 * The Raw JSON surface: `project.json` as it is written, and the way through to editing it as text.
 *
 * This is the adapter. `settings/project-sections.ts` keeps the section — it asks the save
 * chokepoint to serialise the configuration, so what is drawn is what a save writes, and it owns
 * what "Edit as code" does to the tab. The document renders one string and one button.
 *
 * There is nothing to echo here, which is the whole difference from the sibling surfaces: this
 * section holds no value the reader can move, so the scope can only ever be behind the file rather
 * than ahead of it, and a redraw is the only thing that changes what it says.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import rawJsonDoc from "./settings-rawjson.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("settings-rawjson", rawJsonDoc as unknown as JxDocument);

/** What the section says the surface should be showing right now. */
export interface RawJsonValues {
  /** The whole file, serialised by the chokepoint that writes it. */
  json: string;
}

/** What the reader can do here. */
export interface RawJsonActions {
  /** Open the same document in the Code editor, over the same tab. */
  editAsCode: () => void;
}

export interface RawJsonSurfaceHandle {
  /** Bring the mounted document up to date. A key left out is left alone. */
  update: (patch: Partial<RawJsonValues>) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads. */
interface RawJsonScope extends Record<string, unknown> {
  json: string;
  editAsCode: () => void;
}

/** Write a patch into the scope. */
function project(scope: RawJsonScope, patch: Partial<RawJsonValues>): void {
  if (patch.json !== undefined) {
    scope.json = patch.json;
  }
}

/**
 * Mount the Raw JSON document into `container`.
 *
 * The container is cleared first: a settings section is handed the pane's content area, and
 * whatever the last section drew into it is not this one's to keep.
 */
export function mountRawJsonSurface(
  container: HTMLElement,
  values: RawJsonValues,
  actions: RawJsonActions,
): RawJsonSurfaceHandle {
  const scope = reactive<RawJsonScope>({
    editAsCode: actions.editAsCode,
    json: "",
  }) as RawJsonScope;
  project(scope, values);

  container.replaceChildren();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on the element, so the mount is all this has to wait for: the DOCUMENT is
     what this surface renders, and `jx-button` settles its own template one `connectedCallback`
     later without anybody here asking it to (§1.1, "await the element"). */
  void mountSurface("settings-rawjson", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    /* While the mount is still in flight this surface owns the container only for as long as the
       container is still the empty one it was handed: a settings section is drawn into the pane's
       content area, and if something else has claimed it in the meantime the document must not
       land on top of that. Once mounted, the question is simply whether the root is still there —
       a section that was switched away from had its root taken out from under it. */
    connected: () =>
      !disposed &&
      (mounted === null
        ? container.childNodes.length === 0
        : (mounted.root as Node).parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update: (patch) => project(scope, patch),
  };
}
