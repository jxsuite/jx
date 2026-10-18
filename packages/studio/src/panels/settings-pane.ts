/// <reference lib="dom" />
/**
 * The Project Settings editor's flow: the grouped section list, the section body, and the Moved
 * footnote, drawn inside the settings dialog (§17.1).
 *
 * Two columns. The list is the section registry in its three groups (General, Integrations,
 * Advanced), so an extension's section joins the dialog by registering and leaves by going away;
 * the body is whichever section is current, drawn by that section's own renderer.
 *
 * **This file is the FLOW; the markup is a document.** `surfaces/settings-pane.json` owns the two
 * columns, the lists' ARIA and keyboard, and every value in their style;
 * `surfaces/settings-pane.ts` mounts it (studio-ui-guidelines.md §6, §9.3), and
 * `settings/settings-dialog.ts` owns the dialog it is mounted into. What stays here is the part
 * that is a decision: which sections there are, which one is current, which renderer gets the body,
 * and what a renderer's failure says.
 *
 * **It imports the registry, never the sections.** The section RENDERERS are registered by
 * `settings/settings-document.ts`, which the app loads when it registers its commands.
 *
 * Nothing here is stamped with a region of its own. The dialog carries `overlay.dialog:settings`,
 * and the entry rows and entry editor of a map-layout section are stamped by
 * `settings/contributed-section.ts` under it, as `overlay.dialog:settings/entry:<key>` and
 * `overlay.dialog:settings/editor`.
 *
 * @docs studio/projects/settings
 */

import { errorMessage } from "@jxsuite/schema/parse";
import {
  groupedSettingsSections,
  onSettingsDocumentChanged,
  settingsSection,
  settingsDocumentSection,
  setSettingsSection,
} from "../settings/section-registry";
import { mountSettingsPaneSurface } from "../surfaces/settings-pane";
import { workspaceInfo } from "../workspace/workspace-ids";
import type { SettingsPaneHandle, SettingsPaneValues } from "../surfaces/settings-pane";
import type { InspectorTabId } from "../shell";
import type { WorkspaceId } from "../workspace/workspace-ids";
import type { StylesView } from "../style/project-styles";
import type { PublishTab } from "../publish/publish-ids";

/** What the body says when the section that is current is registered by nobody. */
const NO_SECTIONS = "No settings sections.";

/**
 * What left Project Settings for a workspace, in the order the footnote lists it (§17.1).
 *
 * Colors and fonts are the project's design tokens, which the Styles workspace edits beside the
 * elements they style; hosting and the domain are where the site is published, which the Publish
 * workspace owns. Head and SEO defaults did not leave (Advanced › Site head still edits them) but
 * are also on Design's Page tab, which is where an author looks for a page's title. A reader who
 * learned any of them here is told where it is rather than left to search for it. `place` is what
 * the button says when it is not simply the workspace's title, and `inspector` is the Inspector tab
 * that place IS: a button that says "Page tab" and only switches workspace would leave an author
 * already in Design looking at the Element tab, with nothing visibly changed.
 */
const MOVED: readonly {
  what: string;
  workspace: WorkspaceId;
  place?: string;
  inspector?: InspectorTabId;
  /** The Styles view the place IS, for a row that moved into one of them. */
  view?: StylesView;
  /** The Publish sub-tab the place IS: Hosting, for the adapter and the domain. */
  publishTab?: PublishTab;
}[] = [
  /* The design tokens are the Variables view, not whichever Styles view was last open: a button
     that says "Variables" and lands on the element catalogue would have the author hunting. */
  { place: "Styles › Variables", view: "variables", what: "Colors and fonts", workspace: "styles" },
  {
    place: "Publish › Hosting",
    publishTab: "hosting",
    what: "Hosting and domain",
    workspace: "publish",
  },
  { inspector: "page", place: "Page tab", what: "Head and SEO defaults", workspace: "design" },
];

/** What the mounted editor is told to do by things only its host can do. */
export interface SettingsPaneOptions {
  /**
   * A Moved footnote's button: close the dialog and go to the named workspace, and to the named
   * Inspector tab or Styles view there when the row names one.
   */
  openMoved: (
    workspace: WorkspaceId,
    inspector?: InspectorTabId,
    view?: StylesView,
    publishTab?: PublishTab,
  ) => void;
}

/** The mounted editor. */
export interface SettingsPaneMount {
  /** Settles once the columns are mounted and the current section has been drawn once. */
  ready: Promise<void>;
  /** Put the keyboard on the current section's row. */
  focusActive: () => void;
  /** Take the editor down and unsubscribe. Idempotent. */
  dispose: () => void;
}

/** A section row's element id: minted from the key, so the body can name the row that chose it. */
function tabIdFor(key: string): string {
  return `settings-nav-${key}`;
}

/** The footnote row a button's workspace string names, or `null` for one this module never offered. */
function movedRow(value: string): (typeof MOVED)[number] | null {
  return MOVED.find((row) => row.workspace === value) ?? null;
}

/**
 * Everything the document draws, decided here so the document decides nothing.
 *
 * @param {string} failure The current section's failure sentence, or the empty string
 * @returns {SettingsPaneValues}
 */
function values(failure: string): SettingsPaneValues {
  const active = settingsDocumentSection();
  const grouped = groupedSettingsSections();
  return {
    active,
    activeTabId: tabIdFor(active),
    empty: NO_SECTIONS,
    failure,
    groups: grouped.map((group) => ({
      id: group.id,
      label: group.label,
      note: group.note,
      sections: group.sections.map((section) => ({
        key: section.key,
        label: section.label,
        tabId: tabIdFor(section.key),
      })),
      tabsLabel: group.note === "" ? group.label : `${group.label}, ${group.note.toLowerCase()}`,
      titleId: `settings-group-${group.id}`,
    })),
    hasSection: settingsSection(active) !== undefined,
    // The section's own sentence when it has one, its group's otherwise.
    intro:
      settingsSection(active)?.intro ||
      (grouped.find((group) => group.sections.some((section) => section.key === active))?.intro ??
        ""),
    moved: MOVED.map((row) => {
      const { title } = workspaceInfo(row.workspace);
      const place = row.place ?? title;
      return {
        linkLabel: `${row.what}: ${place}. Go to ${title}`,
        place,
        what: row.what,
        workspace: row.workspace,
      };
    }),
  };
}

/**
 * Mount the editor into `host`, the settings dialog's pane slot, and keep it current.
 *
 * It subscribes to the section registry and to the chosen section, so an extension's section
 * appearing a tick later redraws the nav, and a deep link to an entry inside the section already on
 * screen redraws its body, without the host doing anything.
 *
 * @param {HTMLElement} host
 * @param {SettingsPaneOptions} options
 * @returns {SettingsPaneMount}
 */
export function mountSettingsPane(
  host: HTMLElement,
  options: SettingsPaneOptions,
): SettingsPaneMount {
  let disposed = false;
  /** The island as {@link draw} last read it off the surface. */
  let body: HTMLElement | null = null;
  /**
   * The element the ACTIVE section was drawn into, inside {@link body}.
   *
   * Sections do not share one container, and they cannot: a converted section mounts a document and
   * clears what it is given, which destroys lit's `_$litPart$` markers, so the next lit section
   * rendering into that same element throws on a part whose markers have left the document. A fresh
   * host per section is what makes the two kinds coexist.
   */
  let sectionHost: HTMLElement | null = null;
  /** The section the body currently holds. */
  let rendered: string | null = null;
  /** The current section's failure sentence; cleared whenever it is drawn again. */
  let failure = "";
  /** Counts renders, so a late rejection from a superseded one cannot overwrite a newer answer. */
  let generation = 0;

  const surface: SettingsPaneHandle = mountSettingsPaneSurface(host, values(failure), {
    openMoved: (workspace: string) => {
      const target = movedRow(workspace);
      if (target !== null) {
        options.openMoved(target.workspace, target.inspector, target.view, target.publishTab);
      }
    },
    selectSection: (key: string) => {
      setSettingsSection(key);
    },
  });

  /** Say a section failed, where the section would have been. */
  function fail(key: string, reason: string, at: number): void {
    if (disposed || at !== generation) {
      return;
    }
    const label = settingsSection(key)?.label ?? key;
    failure = `Could not show ${label}: ${reason}`;
    surface.update(values(failure));
  }

  /**
   * Update the nav, then the body.
   *
   * @param {boolean} force Re-run the section renderer even when the section has not changed: true
   *   for a real state change (a nav click, a section registering, an entry selected by command).
   */
  function draw(force: boolean): void {
    if (disposed) {
      return;
    }
    const active = settingsDocumentSection();
    const island = surface.body();
    if (island !== body) {
      body = island;
      rendered = null;
    }
    if (!island || (!force && rendered === active)) {
      surface.update(values(failure));
      return;
    }
    /* Read BEFORE the write: whether the section is changing is what decides the host, and
       `rendered` is about to stop saying so. */
    const changed = rendered !== active;
    rendered = active;
    failure = "";
    surface.update(values(failure));
    const section = settingsSection(active);
    if (!section) {
      /* Every section unregistered at once: a project closing while the dialog is open. The
         document says so itself (`hasSection`), and the island is emptied so a renderer's leftovers
         do not sit under the sentence explaining that there is nothing to draw. */
      sectionHost = null;
      island.replaceChildren();
      return;
    }
    /* A FRESH host whenever the section changes, and the same one for a forced redraw of the
       section already showing: remounting that one would take the caret out of whatever field the
       reader is typing in. */
    if (changed || !sectionHost || sectionHost.parentElement !== island) {
      sectionHost = document.createElement("div");
      island.replaceChildren(sectionHost);
    }
    generation += 1;
    const at = generation;
    try {
      const result = section.render(sectionHost);
      if (result instanceof Promise) {
        result.catch((error) => {
          fail(active, errorMessage(error), at);
        });
      }
    } catch (error) {
      fail(active, errorMessage(error), at);
    }
  }

  const off = onSettingsDocumentChanged(() => {
    draw(true);
  });
  /* The island does not exist until the mount lands, so the first pass that reaches a section
     renderer is this one. */
  const ready = surface.ready.then(() => {
    draw(true);
  });

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      off();
      surface.dispose();
    },
    focusActive: () => {
      surface.focusActive();
    },
    ready,
  };
}
