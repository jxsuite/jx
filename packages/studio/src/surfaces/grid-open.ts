/// <reference lib="dom" />
/**
 * The Open Grid source list, as a mounted document.
 *
 * This is the adapter. `grid/grid-open.ts` is the flow — which collections a project declares,
 * whether the platform serves the data routes, what each row opens — and this is the list it
 * draws.
 *
 * **It is an island inside the confirm dialog, not a dialog of its own.** `ui/layers.ts` owns the
 * headline, the cancel button, modality, focus and Escape; a second answer to "what is a dialog" is
 * a defect (specs/studio-ui-guidelines.md §12.5). What is here is the part that is genuinely this
 * surface's: sources grouped by where they come from, with a heading per group — which is also why
 * it is not the kit menu, whose rows can carry a divider above them and cannot carry a name for the
 * run they open.
 *
 * @docs studio/data/grid
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import gridOpenDoc from "./grid-open.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("grid-open", gridOpenDoc as unknown as JxDocument);

/** One openable source. The id is opaque here: only the flow knows what it names. */
export interface GridSourceRow {
  id: string;
  label: string;
}

/** One origin of sources — the project itself, or one connection. */
export interface GridSourceGroup {
  /** The group's identity across repaints. */
  key: string;
  title: string;
  state: "listed" | "empty";
  rows: GridSourceRow[];
  /** Why the group is empty, in a sentence. Empty when it is not. */
  emptyMessage: string;
}

export interface GridOpenSurfaceHandle {
  /** Resolves with the list's root once it has rendered. */
  ready: Promise<HTMLElement>;
  dispose: () => void;
}

interface GridOpenScope extends Record<string, unknown> {
  groups: GridSourceGroup[];
  open: (id: string) => void;
}

/**
 * Mount the source list into `host`.
 *
 * @param {HTMLElement} host - The dialog's island node
 * @param {GridSourceGroup[]} groups - What to list
 * @param {(id: string) => void} open - What a row does
 * @returns {GridOpenSurfaceHandle}
 */
export function mountGridOpenSurface(
  host: HTMLElement,
  groups: GridSourceGroup[],
  open: (id: string) => void,
): GridOpenSurfaceHandle {
  const scope = reactive<GridOpenScope>({ groups, open }) as GridOpenScope;
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("grid-open", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
      return surface.root as HTMLElement;
    }
    mounted = surface;
    return surface.root as HTMLElement;
  });
  return {
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
  };
}
