/// <reference lib="dom" />
/**
 * The Variables view surface: the frame the Styles workspace draws around the CSS Variables editor,
 * as a Jx document over the kit.
 *
 * This is the adapter. `style/variables-view.ts` keeps the flow (which pane holds the view, what
 * the editor island is handed, when the view follows an edit made elsewhere) and hands this module
 * one projection: the heading, the sentences and the region. The document renders that and decides
 * nothing.
 *
 * **The editor is an ISLAND.** The CSS Variables editor is a surface of its own
 * (`surfaces/settings-css-vars.json`), mounted into a container it is handed, so this document
 * renders an empty `editor` node and announces it through `onNodeCreated`, the one seam for an
 * island (studio-ui-guidelines.md §9.4). Nothing here knows what a token is.
 *
 * **The container is CLEARED, because this is a pane and not a panel**, for the reason
 * `surfaces/media-pane.ts` gives: the canvas stage is handed to whichever mode owns it whole.
 *
 * @docs studio/design/tokens
 */

import { isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import variablesDoc from "./styles-variables.json";
import type { JxElement } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("styles-variables", variablesDoc);

/** What the view draws, with every word already decided. */
export interface VariablesView {
  /** The pane region the view answers to (`pane.primary/variables`). */
  region: string;
  title: string;
  /** What these are: the project's CSS custom properties. */
  lede: string;
  /** When an edit reaches the file. */
  saving: string;
  /** Where colour schemes and breakpoints are declared. */
  schemes: string;
  /** The button that goes there. */
  manageLabel: string;
}

/** What the view's own control does. */
export interface VariablesActions {
  /** Open Project Settings on Contexts. */
  manageContexts: () => void;
}

/** Where the CSS Variables editor lands. */
export interface VariablesIslands {
  /** Called with the `editor` node every time the document creates one. */
  editorSlot: (host: HTMLElement) => void;
}

/**
 * A mounted view: whether it still stands, and a way to take it down. There is no update: every
 * word the view draws is a constant, and the editor island redraws itself.
 */
export interface VariablesSurfaceHandle {
  /** Whether the mount is still in the host it was given (a mount still in flight counts). */
  attached: () => boolean;
  dispose: () => void;
  /** Settles once the document is in the host. */
  ready: Promise<void>;
}

interface VariablesScope extends VariablesView, VariablesActions {
  headingId: string;
}

/** The view as the document reads it. */
function project(scope: VariablesScope, view: VariablesView): void {
  Object.assign(scope, view);
  scope.headingId = `styles-variables-${view.region.replaceAll(/[^\w-]/g, "-")}`;
}

/** The `part` a node was authored with, or `""`: the only thing this adapter asks about a node. */
function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/**
 * Mount the Variables view into `host`, the pane's canvas stage.
 *
 * @param {HTMLElement} host The pane's canvas stage, emptied first.
 * @param {VariablesView} view What to draw right now.
 * @param {VariablesActions} actions What the view's control does.
 * @param {VariablesIslands} islands Where the editor lands.
 * @returns {VariablesSurfaceHandle}
 */
export function mountVariablesSurface(
  host: HTMLElement,
  view: VariablesView,
  actions: VariablesActions,
  islands: VariablesIslands,
): VariablesSurfaceHandle {
  host.replaceChildren();
  const scope: VariablesScope = reactive<VariablesScope>({
    headingId: "",
    lede: "",
    manageContexts: actions.manageContexts,
    manageLabel: "",
    region: "",
    saving: "",
    schemes: "",
    title: "",
  });
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("styles-variables", scope, host, {
    onNodeCreated: (element, _path, def) => {
      if (element instanceof HTMLElement && partOf(def) === "editor") {
        islands.editorSlot(element);
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
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
  };
}
