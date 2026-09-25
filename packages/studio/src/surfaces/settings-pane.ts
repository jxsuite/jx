/// <reference lib="dom" />
/**
 * The Project Settings editor's chrome as a mounted document — the mount seam, and nothing else.
 *
 * `panels/settings-pane.ts` is the flow: which sections are registered, which of them is current,
 * what a nav click does, and which renderer draws the body. This is the surface it draws into.
 *
 * **One island, and the sections are why.** A settings section is handed a container and renders
 * into it — some of them still with lit, some by mounting a document of their own — so the body
 * cannot be part of this document's subtree. It draws an empty `[part="body"]`, announces it
 * through `onNodeCreated` as it is created, and the flow renders into it (studio-ui-guidelines.md
 * §9.4). Nothing here queries for it by a selector this package also renders.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import settingsPaneDoc from "./settings-pane.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("settings-pane", settingsPaneDoc as unknown as JxDocument);

/** One row of the section list, as the document draws it. */
export interface SettingsNavView {
  /** The section key — the row's identity, its `value`, and what the strip compares `selected` to. */
  key: string;
  label: string;
  /** The row's own element id, which the one panel names as its `aria-labelledby`. */
  tabId: string;
}

/** What the editor says right now. */
export interface SettingsPaneValues {
  /** The list's accessible name. A tablist takes no name from its tabs. */
  navLabel: string;
  /** The current section's key. */
  active: string;
  /** The current section's row id, so the body is named by the row that chose it. */
  activeTabId: string;
  sections: SettingsNavView[];
  /**
   * Whether a renderer will draw into the island.
   *
   * The flow's own question — `settingsSection(active)` — rather than "are there any sections": the
   * body is empty exactly when the ACTIVE key is registered by nobody, and a second spelling of
   * that would be a second thing to get wrong.
   */
  hasSection: boolean;
  /** What the body says instead, when it will not be drawn into. */
  empty: string;
}

export interface SettingsPaneActions {
  /** A row was activated. */
  selectSection: (key: string) => void;
}

export interface SettingsPaneHandle {
  /** Bring the standing document up to date. An assignment; the mount is never rebuilt. */
  update: (values: SettingsPaneValues) => void;
  /**
   * The empty `[part="body"]` island, once it exists — the one element a section renderer needs.
   *
   * It is HELD rather than re-found, exactly as `surfaces/tab-strip.ts` holds its `jx-tabs`: it
   * arrives through `onNodeCreated` as the node is created, so nothing in this package queries for
   * a node this package renders (studio-ui-guidelines.md §9.4).
   */
  body: () => HTMLElement | null;
  /** Settles once the document is mounted, or the surface was disposed first. */
  ready: Promise<void>;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

interface SettingsPaneScope
  extends Record<string, unknown>, SettingsPaneValues, SettingsPaneActions {}

/** The `part` a node was declared with, or the empty string. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * Mount the editor's chrome into `container`, which is the pane's stage.
 *
 * The container is cleared first, lit's render marker included: the stage is shared with every
 * other canvas mode, and a marker left behind by whatever drew there last would make the next lit
 * render throw on a part whose nodes have gone.
 *
 * @param {HTMLElement} container The pane's `#canvas-wrap`
 * @param {SettingsPaneValues} values What to say on the first paint
 * @param {SettingsPaneActions} actions What a nav row does. Read once, when the scope is made.
 * @returns {SettingsPaneHandle}
 */
export function mountSettingsPaneSurface(
  container: HTMLElement,
  values: SettingsPaneValues,
  actions: SettingsPaneActions,
): SettingsPaneHandle {
  const scope = reactive<SettingsPaneScope>({ ...values, ...actions }) as SettingsPaneScope;

  container.textContent = "";
  // @ts-expect-error -- _$litPart$ is lit's private render-part marker, not in the DOM types
  delete container["_$litPart$"];

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  let body: HTMLElement | null = null;
  const ready = mountSurface("settings-pane", scope, container, {
    onNodeCreated: (element, _path, def) => {
      /* `disposed` and not just the part: a mount that is still in flight goes on building its
         nodes after the handle has let go, and holding one of them would answer `body()` with an
         element belonging to a document nobody is standing behind any more. */
      if (!disposed && element instanceof HTMLElement && partOf(def) === "body") {
        body = element;
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
    body: () => body,
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
      body = null;
    },
    ready,
    update(next) {
      /* Field by field, so an unchanged one is inert — and `active` LAST, because it is what the
         strip's selection is compared against: writing it before the rows it names have arrived
         would make `jx-tabs` sync a selection onto a column that does not hold that tab yet. */
      scope.navLabel = next.navLabel;
      scope.sections = next.sections;
      scope.activeTabId = next.activeTabId;
      scope.empty = next.empty;
      scope.hasSection = next.hasSection;
      scope.active = next.active;
    },
  };
}
