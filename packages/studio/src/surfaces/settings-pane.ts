/// <reference lib="dom" />
/**
 * The Project Settings dialog's two columns as a mounted document: the mount seam, and nothing
 * else.
 *
 * `panels/settings-pane.ts` is the flow: which sections are registered, which group lists each,
 * which one is current, what a nav click does, and which renderer draws the body. This is the
 * surface it draws into, and `surfaces/settings-dialog.ts` is the dialog it sits in.
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

/** What the dialog's columns say right now. */
export interface SettingsPaneValues {
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
   * Put the keyboard on the current section's row.
   *
   * `showModal()` focuses the dialog's first focusable descendant, which is always the first
   * group's tab stop, so a dialog opened on Advanced › Raw JSON would put the ring on Overview
   * while the selection was three rows down a different list. Read off `aria-selected`, which the
   * strip writes, because that attribute is the one record of which row is current.
   */
  focusActive: () => void;
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
 * Mount the columns into `container`, which is the settings dialog's island.
 *
 * The container is cleared first, lit's render marker included, so a host handed back after some
 * other renderer used it cannot make the next lit render throw on a part whose nodes have gone.
 *
 * @param {HTMLElement} container The dialog's pane slot
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
    body: () => body,
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
      body = null;
    },
    focusActive() {
      const root = mounted?.root;
      if (root instanceof HTMLElement) {
        root.querySelector<HTMLElement>('[part="nav-item"][aria-selected="true"]')?.focus();
      }
    },
    ready,
    update(next) {
      /* Field by field, so an unchanged one is inert, and `active` LAST, because it is what each
         strip's selection is compared against: writing it before the rows it names have arrived
         would make `jx-tabs` sync a selection onto a column that does not hold that tab yet. */
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
