/// <reference lib="dom" />
/**
 * The Navigator dock's panel host as a mounted document.
 *
 * `panels/left-panel.ts` is the flow — which record `shell.leftTab` names, whether the context
 * admits it, whether it needs a document it has not got, and what its `afterRender` is handed — and
 * this is the box it draws into.
 *
 * **One island per panel, and the key is the panel.** A Navigator panel's body is a lit template
 * (that is what a `PanelRecord` is), so the content box stays empty here and the flow paints it
 * (studio-ui-guidelines.md §9.4). It is a keyed `$map` row rather than a fixed element because four
 * panels append a mounted document of their own PAST lit's range inside that box: a host that
 * survived a panel switch would leave the Outline standing underneath the file tree, which is
 * exactly what the old template avoided by rebuilding its own markup. Here the key says it.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import navigatorDockDoc from "./navigator-dock.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("navigator-dock", navigatorDockDoc as unknown as JxDocument);

/** The panel showing, as the document draws it. */
export interface NavigatorPanelView {
  /** The panel id. The row's identity — a change here rebuilds the body and its content island. */
  key: string;
  title: string;
  /** The containment level, `project` or `document`. */
  level: string;
  /** Whether there is a header at all: an id the registry does not declare has none. */
  hasHeader: boolean;
  /** `navigator/panel:<id>`, or empty for a panel the registry does not declare. */
  region: string;
}

export interface NavigatorDockValues {
  /**
   * The panel showing, as a list of exactly one.
   *
   * A list because it is the document's keyed `$map`, and the key is what makes a panel switch
   * destroy the previous panel's content box; `shell.leftTab` always names something, so it is
   * never empty.
   */
  panels: NavigatorPanelView[];
}

export interface NavigatorDockOptions {
  /**
   * A panel's content box, announced once per panel as it is created.
   *
   * @param panelId The panel the box belongs to
   * @param host The empty `[part="content"]`
   */
  onContent: (panelId: string, host: HTMLElement) => void;
}

export interface NavigatorDockHandle {
  update: (values: NavigatorDockValues) => void;
  /** Take the document down and remove it from its container. Idempotent. */
  dispose: () => void;
}

interface NavigatorDockScope extends Record<string, unknown>, NavigatorDockValues {}

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
 * Mount the Navigator dock into `container`, which is the shell's `#left-panel` cell.
 *
 * The cell is cleared first: the Navigator owns it outright, so a remount that appended would leave
 * two panel bodies and every `querySelector` would silently pick the stale one.
 */
export function mountNavigatorDock(
  container: HTMLElement,
  values: NavigatorDockValues,
  options: NavigatorDockOptions,
): NavigatorDockHandle {
  const scope = reactive<NavigatorDockScope>({ panels: values.panels }) as NavigatorDockScope;

  container.textContent = "";
  // @ts-expect-error -- _$litPart$ is lit's private render-part marker, not in the DOM types
  delete container["_$litPart$"];

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("navigator-dock", scope, container, {
    onNodeCreated: (element, _path, def, state) => {
      if (!(element instanceof HTMLElement) || partOf(def) !== "content") {
        return;
      }
      const key = mapItem(state)?.["key"];
      if (typeof key === "string") {
        options.onContent(key, element);
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
      scope.panels = next.panels;
    },
  };
}
