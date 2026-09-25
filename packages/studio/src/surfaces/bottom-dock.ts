/// <reference lib="dom" />
/**
 * The Bottom dock's chrome as a mounted document.
 *
 * `panels/bottom-dock.ts` is the flow — which records the dock has, which of them a context admits,
 * what each tab's badge says, when Logic reveals itself, and what every tab's `afterRender` is
 * handed — and this is the surface it draws into.
 *
 * **One island, and the dock's tabs are why.** Every tab here is a `PanelRecord` whose `render`
 * returns a lit template, so the body cannot be a document: this draws an empty
 * `[part="dock-body"]`, announces it through `onNodeCreated` as it is created, and the flow renders
 * into it (studio-ui-guidelines.md §9.4). That is also the seam a tab uses to answer "am I still on
 * screen?" — the flow blanks this element and runs every tab's hook against it.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import bottomDockDoc from "./bottom-dock.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("bottom-dock", bottomDockDoc as unknown as JxDocument);

/** One tab of the strip, as the document draws it. */
export interface BottomTabView {
  /** The panel id — the row's identity, the strip's `selected` value, and `data-tab`. */
  key: string;
  /** The record's title with its badge already appended ("Problems 2"). */
  label: string;
  /** The tab element's own id, which the one panel names as its `aria-labelledby`. */
  tabId: string;
}

/** What the dock says right now. */
export interface BottomDockValues {
  /** The selected panel id — what each tab's `value` is compared against. */
  tab: string;
  /** The selected tab's element id, so the panel is named by the tab that controls it. */
  tabId: string;
  /** `dock.bottom/panel:<id>`, or empty when no tab is showing and the body has no identity. */
  bodyRegion: string;
  tabs: BottomTabView[];
}

export interface BottomDockActions {
  /** A tab was activated. */
  selectTab: (id: string) => void;
  /** The × — the dock's own exit. */
  closeDock: () => void;
}

export interface BottomDockOptions {
  /** The empty `[part="dock-body"]`, announced once as it is created. */
  onBody: (host: HTMLElement) => void;
}

export interface BottomDockHandle {
  update: (values: BottomDockValues) => void;
  /** Take the document down and remove it from its container. Idempotent. */
  dispose: () => void;
}

interface BottomDockScope extends Record<string, unknown>, BottomDockValues, BottomDockActions {}

function project(scope: BottomDockScope, values: BottomDockValues): void {
  scope.tab = values.tab;
  scope.tabId = values.tabId;
  scope.bodyRegion = values.bodyRegion;
  scope.tabs = values.tabs;
}

/** The `part` a node was declared with, or the empty string. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * Mount the Bottom dock's chrome into `container`, which is the shell's `#bottom-dock` cell.
 *
 * The cell is cleared first: the dock owns it outright, and `#bottom-dock:empty` is how a dock with
 * nothing mounted in it stays out of the grid — so a remount that appended would leave two strips
 * and a cell that can never be empty again.
 */
export function mountBottomDockSurface(
  container: HTMLElement,
  values: BottomDockValues,
  actions: BottomDockActions,
  options: BottomDockOptions,
): BottomDockHandle {
  const scope = reactive<BottomDockScope>({ ...values, ...actions }) as BottomDockScope;

  container.textContent = "";
  // @ts-expect-error -- _$litPart$ is lit's private render-part marker, not in the DOM types
  delete container["_$litPart$"];

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("bottom-dock", scope, container, {
    onNodeCreated: (element, _path, def) => {
      if (element instanceof HTMLElement && partOf(def) === "dock-body") {
        options.onBody(element);
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
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update: (next) => {
      project(scope, next);
    },
  };
}
