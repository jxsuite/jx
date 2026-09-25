/// <reference lib="dom" />
/**
 * The Inspector dock's chrome as a mounted document.
 *
 * `panels/right-panel.ts` is the flow — which tab is selected (per document, or detached when
 * nothing is open), what the selection is called, and which of the four seams a body host is handed
 * to — and this is the surface it draws into.
 *
 * **The four bodies are islands, and they are created once.** `inspector-dock.json` keys its tab
 * panels on the tab id, and that list is `INSPECTOR_TABS`: a constant. A keyed `$map` over a
 * constant list creates every row on the first render and never tears one down, so the empty
 * `[part="panel-body"]` inside each panel is exactly the permanent container the old module built
 * by hand — without a second module having to promise it will not rebuild them. Each is announced
 * through `onNodeCreated` as it is CREATED, one reconcile step before it is in the page, so
 * connectedness is deliberately not consulted here (studio-ui-guidelines.md §9.4).
 *
 * **No scheduler.** `panels/panel-scheduler.ts` withheld a repaint while a text field in the dock
 * had focus, because a lit repaint replaces the node the caret is in. This document paints a title,
 * a target and a tab selection, and the runtime skips a binding whose value did not move — so there
 * is no repaint to withhold, and the tab bodies were already mounted documents that never went
 * through it.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import inspectorDockDoc from "./inspector-dock.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("inspector-dock", inspectorDockDoc as unknown as JxDocument);

/** One tab of the dock, as the document draws it. Every field is a value. */
export interface InspectorTabView {
  /** The tab id — the row's identity, the strip's `selected` value, and `data-tab`. */
  key: string;
  title: string;
  /** The tab element's own id, which is also its panel's `aria-labelledby`. */
  tabId: string;
  /** The tab panel element's own id, which is also the tab's `aria-controls`. */
  panelId: string;
  /** `inspector/tab:<id>` — stamped on the body host the screenshot pipeline crops. */
  region: string;
  /** Whether this is the tab on screen. Exactly one is true. */
  active: boolean;
}

/** What the dock says right now. */
export interface InspectorDockValues {
  /** The selected tab's title, drawn in the header. */
  title: string;
  /** What the tab is pointed at, in the fewest words that are true. */
  target: string;
  /** The selected tab id — what `jx-tabs` compares each tab's `value` against. */
  tab: string;
  tabs: InspectorTabView[];
}

export interface InspectorDockActions {
  /** A tab was activated. The flow decides whether that is a per-document or a detached write. */
  selectTab: (id: string) => void;
}

export interface InspectorDockOptions {
  /**
   * One tab's body host, announced once, as it is created.
   *
   * @param tabId The tab the host belongs to
   * @param host The empty `[part="panel-body"]`
   */
  onBody: (tabId: string, host: HTMLElement) => void;
}

export interface InspectorDockHandle {
  /** Bring the mounted document up to date with a whole projection. */
  update: (values: InspectorDockValues) => void;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads. */
interface InspectorDockScope extends Record<string, unknown>, InspectorDockValues {
  selectTab: (id: string) => void;
}

/** Write a projection in, assignment by assignment, so an unchanged field is inert. */
function project(scope: InspectorDockScope, values: InspectorDockValues): void {
  scope.title = values.title;
  scope.target = values.target;
  scope.tab = values.tab;
  scope.tabs = values.tabs;
}

/** The `part` a node was declared with, or the empty string. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/** The `$map` item a node was rendered inside, if it was rendered inside one. */
function mapItem(state: JxScope | undefined): Record<string, unknown> | null {
  const map = state?.["$map"] as { item?: unknown } | undefined;
  const item = map?.item;
  return item !== null && typeof item === "object" ? (item as Record<string, unknown>) : null;
}

/**
 * Mount the Inspector dock into `container`, which is the shell's `#right-panel` cell.
 *
 * The container is CLEARED first, unlike a Navigator panel's: this dock owns its cell outright and
 * nothing else ever paints there, so a remount that appended would leave two docks and every
 * `querySelector` would silently pick the stale one.
 */
export function mountInspectorDock(
  container: HTMLElement,
  values: InspectorDockValues,
  actions: InspectorDockActions,
  options: InspectorDockOptions,
): InspectorDockHandle {
  const scope = reactive<InspectorDockScope>({
    ...values,
    selectTab: actions.selectTab,
  }) as InspectorDockScope;

  container.textContent = "";
  // @ts-expect-error -- _$litPart$ is lit's private render-part marker, not in the DOM types
  delete container["_$litPart$"];

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("inspector-dock", scope, container, {
    onNodeCreated: (element, _path, def, state) => {
      if (!(element instanceof HTMLElement) || partOf(def) !== "panel-body") {
        return;
      }
      const key = mapItem(state)?.["key"];
      if (typeof key === "string" && key !== "") {
        options.onBody(key, element);
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
