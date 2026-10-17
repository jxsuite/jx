/// <reference lib="dom" />
/**
 * The workspace home surface: the tab a workspace opens on when none of its own tabs is open.
 *
 * This is the adapter. `workspace/workspace-home.ts` keeps the flow (which pane holds which home,
 * when one is torn down) and hands this module one projection: the workspace's glyph, its title and
 * what it is for. The document renders that and decides nothing.
 *
 * **The container is CLEARED, because this is a pane and not a panel**, for the reason
 * `surfaces/media-pane.ts` gives: the canvas stage is handed to whichever mode owns it whole, and a
 * home mounted over a stage that still held the previous mode's nodes would draw beside them.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import homeDoc from "./workspace-home.json";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("workspace-home", homeDoc);

/** What the home draws, with every branch already decided. */
export interface WorkspaceHomeView {
  /** The workspace id, stamped as `data-workspace`. */
  workspace: string;
  /** A key into the kit's glyph manifest. */
  icon: string;
  title: string;
  /** One sentence: what the workspace is for. */
  purpose: string;
  /** An optional second sentence; empty for none. */
  detail: string;
  /** The pane region the home answers to (`pane.primary/home`). */
  region: string;
}

/** The scope `workspace-home.json` reads. */
interface WorkspaceHomeScope extends WorkspaceHomeView {
  hasDetail: boolean;
  headingId: string;
}

/** A mounted home: what a caller needs to tell whether it is still standing, and to take it down. */
export interface WorkspaceHomeHandle {
  /** Whether the mount is still in the host it was given (a mount still in flight counts). */
  attached: () => boolean;
  dispose: () => void;
  /** Settles with the mounted root, once it is in the document. */
  ready: Promise<HTMLElement>;
}

/** The view as the document reads it. */
function project(scope: WorkspaceHomeScope, view: WorkspaceHomeView): void {
  Object.assign(scope, view);
  scope.hasDetail = view.detail !== "";
  scope.headingId = `workspace-home-${view.region.replaceAll(/[^\w-]/g, "-")}`;
}

/**
 * Mount the home document into `host`.
 *
 * @param {HTMLElement} host - The pane's canvas stage
 * @param {WorkspaceHomeView} view - What to draw
 * @returns {WorkspaceHomeHandle}
 */
export function mountWorkspaceHomeSurface(
  host: HTMLElement,
  view: WorkspaceHomeView,
): WorkspaceHomeHandle {
  host.replaceChildren();
  const scope = reactive<WorkspaceHomeScope>({
    detail: "",
    hasDetail: false,
    headingId: "",
    icon: "",
    purpose: "",
    region: "",
    title: "",
    workspace: "",
  });
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("workspace-home", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
    } else {
      mounted = surface;
    }
    /* SAFETY: `workspace-home.json`'s root definition is a `section` element, so the runtime
       mounts an HTMLElement; a `Text` root only comes from a document whose root is a string. */
    return surface.root as HTMLElement;
  });

  return {
    attached: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      return root === undefined ? true : root instanceof HTMLElement && host.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
  };
}
