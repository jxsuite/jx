/// <reference lib="dom" />
/**
 * The Deploy surface: Project Settings' one row over `build.adapter`, as a Jx document.
 *
 * This is the adapter. `settings/project-sections.ts` keeps the section — what an adapter name
 * means, what reaches `project.json` and what a failed write says — and hands this module a
 * projection: the chosen adapter, the enumeration it is chosen from, and the ONE failure the
 * section is currently showing. The document renders that.
 *
 * **A control the reader has moved is not the scope's**, and that is why `update` takes a patch
 * rather than a whole projection. The section echoes what the picker now holds before it decides
 * what to do with it, so that a rejected write is a real change to the scope and the runtime puts
 * the old adapter back — `live()` did this for the lit template, and a binding that never moved
 * would otherwise leave the picker claiming a platform the file does not name.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import deployDoc from "./settings-deploy.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("settings-deploy", deployDoc as unknown as JxDocument);

/** One row of the adapter picker. */
export interface DeployChoice {
  value: string;
  label: string;
}

/** What the section says the surface should be showing right now. */
export interface DeployValues {
  /** The adapter the project is built with. */
  adapter: string;
  /** Every adapter it may be. */
  adapters: DeployChoice[];
  /** What the last write failed with, or `""`. */
  error: string;
}

/** What the reader can do here. The one thing they can, and it is a write the section decides. */
export interface DeployActions {
  setAdapter: (value: string) => void;
}

export interface DeploySurfaceHandle {
  /** Bring the mounted document up to date. A key left out is left alone. */
  update: (patch: Partial<DeployValues>) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/**
 * The scope the document reads. `hasError` is derived here: `$switch` is a document's only
 * conditional.
 */
interface DeployScope extends Record<string, unknown> {
  adapter: string;
  adapters: DeployChoice[];
  error: string;
  hasError: boolean;
  setAdapter: (value: string) => void;
}

/** Write a patch into the scope. */
function project(scope: DeployScope, patch: Partial<DeployValues>): void {
  if (patch.adapter !== undefined) {
    scope.adapter = patch.adapter;
  }
  if (patch.adapters !== undefined) {
    scope.adapters = patch.adapters;
  }
  if (patch.error !== undefined) {
    scope.error = patch.error;
    scope.hasError = patch.error !== "";
  }
}

/**
 * Mount the Deploy document into `container`.
 *
 * The container is cleared first: a settings section is handed the pane's content area, and
 * whatever the last section drew into it is not this one's to keep.
 */
export function mountDeploySurface(
  container: HTMLElement,
  values: DeployValues,
  actions: DeployActions,
): DeploySurfaceHandle {
  const scope = reactive<DeployScope>({
    adapter: "",
    adapters: [],
    error: "",
    hasError: false,
    setAdapter: actions.setAdapter,
  }) as DeployScope;
  project(scope, values);

  container.replaceChildren();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on the element, so the mount is all this has to wait for: the DOCUMENT is
     what this surface renders, and `jx-field` and `jx-select` settle their own templates one
     `connectedCallback` later without anybody here asking them to (§1.1, "await the element"). */
  void mountSurface("settings-deploy", scope, container).then((surface) => {
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
