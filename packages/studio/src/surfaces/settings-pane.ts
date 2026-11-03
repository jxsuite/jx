/// <reference lib="dom" />
/**
 * The Project Settings workspace's home as a mounted document: its heading and Back control over
 * the two columns. The mount seam, and nothing else.
 *
 * `panels/settings-pane.ts` is the flow: which sections are registered, which group lists each,
 * which one is current, what a nav click does, and which renderer draws the body. This is the
 * surface it draws into, and `settings/settings-workspace.ts` mounts it into a pane's stage.
 *
 * **One island, and the sections are why.** A settings section is handed a container and renders
 * into it (some of them still with lit, some by mounting a document of their own) so the body
 * cannot be part of this document's subtree. It draws an empty `[part="section-host"]`, announces
 * it through `onNodeCreated` as it is created, and the flow renders into it: the island seam of
 * studio-ui-guidelines.md §9.4. Nothing here queries for it by a selector this package also
 * renders.
 *
 * @docs studio/projects/settings
 */

import { isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import settingsPaneDoc from "./settings-pane.json";
import type { JxElement } from "@jxsuite/schema/types";
import type { SurfaceHandle, SurfaceTab } from "../ui/surface";

registerSurface("settings-pane", settingsPaneDoc);

/** One nav group, as the document draws it. */
export interface SettingsPaneGroup {
  id: string;
  label: string;
  /** The qualifier beside the heading ("For developers"), or the empty string for none. */
  note: string;
  /** The heading's element id. */
  titleId: string;
  /** The group's tablist name: the heading, with its qualifier when it has one. */
  tabsLabel: string;
  sections: SurfaceTab[];
}

/** One row of the Moved footnote: something that left Project Settings, and where it went. */
export interface SettingsPaneMovedRow {
  /** What moved, as the reader knew it in Settings ("Colors and fonts"). */
  what: string;
  /** Where it is now: the workspace's title, which is the button's text. */
  place: string;
  /** The workspace id the button switches to. */
  workspace: string;
  /** The button's accessible name, which says the whole sentence the row draws in two parts. */
  linkLabel: string;
}

/** What the home says right now. */
export interface SettingsPaneValues {
  /** `pane.<id>/settings`: the pane this home stands in names it, as Publish's does. */
  region: string;
  /** The heading, which is also the region's name: the workspace's title. */
  heading: string;
  /** The Back control's text, naming where it goes ("Back to Design"). */
  backLabel: string;
  /** The current section's key. */
  active: string;
  /** The current section's row id, so the body is named by the row that chose it. */
  activeTabId: string;
  groups: SettingsPaneGroup[];
  moved: SettingsPaneMovedRow[];
  /**
   * Whether a renderer will draw into the island.
   *
   * The flow's own question (`settingsSection(active)`) rather than "are there any sections": the
   * body is empty exactly when the ACTIVE key is registered by nobody, and a second spelling of
   * that would be a second thing to get wrong.
   */
  hasSection: boolean;
  /** What the body says instead, when it will not be drawn into. */
  empty: string;
  /** The current section's group intro, drawn above the section, or the empty string for none. */
  intro: string;
  /** The sentence a failed section renderer left, or the empty string while nothing failed. */
  failure: string;
}

export interface SettingsPaneActions {
  /** A row was activated. */
  selectSection: (key: string) => void;
  /** A Moved footnote's button was activated, naming the workspace it goes to. */
  openMoved: (workspace: string) => void;
  /** The Back control was activated: leave Settings for the workspace it was opened from. */
  back: () => void;
}

export interface SettingsPaneHandle {
  /** Bring the standing document up to date. An assignment; the mount is never rebuilt. */
  update: (values: SettingsPaneValues) => void;
  /**
   * The empty `[part="section-host"]` island, once it exists: the one element a section needs.
   *
   * It is HELD rather than re-found, exactly as `surfaces/tab-strip.ts` holds its `jx-tabs`: it
   * arrives through `onNodeCreated` as the node is created, so nothing in this package queries for
   * a node this package renders (studio-ui-guidelines.md §9.4).
   */
  body: () => HTMLElement | null;
  /** Settles once the document is mounted, or the surface was disposed first. */
  ready: Promise<void>;
  /**
   * Whether the document still stands in the container it was mounted into: true while the mount is
   * in flight, false once disposed or once something else replaced the container's children.
   */
  attached: () => boolean;
  /**
   * Put the keyboard on the current section's row.
   *
   * Opening Settings on Advanced › Raw JSON has to put the ring on Raw JSON, not on the first
   * group's tab stop, or the selection is three rows down a different list from the keyboard. The
   * row is found by the section key the document was handed (`active`), not by `aria-selected`: the
   * strip writes that a turn after the row is created, and a home opened by a command asks for the
   * keyboard as soon as it has drawn. A row is focusable once its strip has given it a tab stop, so
   * a row whose strip has not synced yet is focused when the strip says it is ready.
   *
   * @returns {Promise<void>} Settles once the keyboard has moved, or at once when there is no row
   */
  focusActive: () => Promise<void>;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

interface SettingsPaneScope extends SettingsPaneValues, SettingsPaneActions {
  /** `failed` while {@link SettingsPaneValues.failure} holds a sentence, `ok` otherwise. */
  failureState: string;
}

/** The `part` a node was declared with, or the empty string. */
function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/** The case name the failure switch discriminates on, derived so the flow states only the fact. */
function failureStateOf(failure: string): string {
  return failure === "" ? "ok" : "failed";
}

/**
 * Mount the home into `container`, a pane's stage.
 *
 * The container is cleared first, lit's render marker included, so a host handed back after some
 * other renderer used it cannot make the next lit render throw on a part whose nodes have gone.
 *
 * @param {HTMLElement} container The pane's stage
 * @param {SettingsPaneValues} values What to say on the first paint
 * @param {SettingsPaneActions} actions What a row and a Moved button do. Read once.
 * @returns {SettingsPaneHandle}
 */
export function mountSettingsPaneSurface(
  container: HTMLElement,
  values: SettingsPaneValues,
  actions: SettingsPaneActions,
): SettingsPaneHandle {
  const scope: SettingsPaneScope = reactive<SettingsPaneScope>({
    ...values,
    ...actions,
    failureState: failureStateOf(values.failure),
  });

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
      if (!disposed && element instanceof HTMLElement && partOf(def) === "section-host") {
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
    attached: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      return root === undefined ? true : root instanceof HTMLElement && container.contains(root);
    },
    body: () => body,
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
      body = null;
    },
    async focusActive() {
      const root = mounted?.root;
      const row =
        root instanceof HTMLElement
          ? [...root.querySelectorAll<HTMLElement>('[part="nav-item"]')].find(
              (candidate) => candidate.dataset["section"] === scope.active,
            )
          : undefined;
      if (!row) {
        return;
      }
      const strip = row.closest("jx-tabs");
      // `aria-selected` is what the strip writes when it syncs, and the sync is what gives a tab stop.
      if (strip && row.getAttribute("aria-selected") !== "true") {
        await new Promise<void>((resolve) => {
          strip.addEventListener(
            "jx-ready",
            () => {
              resolve();
            },
            { once: true },
          );
        });
      }
      if (!disposed) {
        row.focus();
      }
    },
    ready,
    update(next) {
      /* Field by field, so an unchanged one is inert, and `active` LAST, because it is what each
         strip's selection is compared against: writing it before the rows it names have arrived
         would make `jx-tabs` sync a selection onto a column that does not hold that tab yet. */
      scope.region = next.region;
      scope.heading = next.heading;
      scope.backLabel = next.backLabel;
      scope.groups = next.groups;
      scope.moved = next.moved;
      scope.activeTabId = next.activeTabId;
      scope.empty = next.empty;
      scope.intro = next.intro;
      scope.hasSection = next.hasSection;
      scope.failure = next.failure;
      scope.failureState = failureStateOf(next.failure);
      scope.active = next.active;
    },
  };
}
