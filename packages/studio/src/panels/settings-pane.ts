/// <reference lib="dom" />
/**
 * The Project Settings editor, drawn inside the pane — the stage, not an overlay.
 *
 * Two columns: the section list (inner nav) and the section body. It is deliberately the same
 * two-column shape the modal had, because the modal's IA was never the problem — its MODALITY was.
 * Moving the identical layout into `#canvas-wrap` is what makes the seven screenshot crops change
 * frame (`overlay.dialog:settings` → `pane.primary`) without one manifest STEP changing, which is
 * §13.7's proof that the command boundary was drawn in the right place.
 *
 * **This file is the FLOW; the markup is a document.** `surfaces/settings-pane.json` owns the two
 * columns, the list's ARIA and keyboard, and every value in their style;
 * `surfaces/settings-pane.ts` mounts one per pane (studio-ui-guidelines.md §6, §9.3). What stays
 * here is the part that is a decision: which sections there are, which one is current, and which
 * renderer gets the body.
 *
 * Mounting follows `grid/grid-panel.ts`: `canvas/canvas-render.ts` calls {@link renderSettingsPane}
 * when the tab enters this mode, and this module owns its reactivity from there — a subscription to
 * the section registry and to the chosen section, so an extension's section appearing a tick later
 * redraws the nav without the canvas being re-rendered.
 *
 * **It imports the registry, never the sections.** `canvas-render.ts` reaches this module, so
 * anything it imports joins the canvas's import graph; the section RENDERERS are registered by
 * `settings/settings-document.ts`, which the app loads when it registers its commands.
 *
 * Nothing here is stamped with a region of its own. `#canvas-wrap` already carries `pane.primary`
 * (the frame, `shell/tree.ts`), the entry rows and the entry editor are stamped by
 * `settings/contributed-section.ts` as `pane.primary/entry:<key>` and `pane.primary/editor`, and a
 * third id for "the settings body" would be a hand-stamped region with nothing to say.
 *
 * @docs studio/projects/settings
 */

import {
  onSettingsDocumentChanged,
  settingsSection,
  settingsDocumentSection,
  setSettingsSection,
  sortedSettingsSections,
} from "../settings/section-registry";
import { mountSettingsPaneSurface } from "../surfaces/settings-pane";
import type { SettingsPaneHandle } from "../surfaces/settings-pane";
import type { CanvasSurface } from "../canvas/canvas-surface";

/** What the body says when the section that is current is registered by nobody. */
const NO_SECTIONS = "No settings sections.";

/**
 * One mounted editor per PANE.
 *
 * `config` is a kind the side pane may host, so the previous single `_host` had both panes' stages
 * competing for it: `settingsPaneMounted` answered false for whichever host lost, and that pane's
 * fast path rebuilt the whole section body on every render — throwing away an open inline form
 * mid-keystroke, which is the exact failure the idempotence was written to prevent.
 */
interface ActiveSettingsPane {
  host: HTMLElement;
  /** The mounted chrome. */
  surface: SettingsPaneHandle;
  /**
   * The document's `[part="body"]` island, as {@link draw} last read it off the surface.
   *
   * Held here as well so a CHANGE of element can reset {@link ActiveSettingsPane.rendered}: the body
   * is what a section was drawn into, and a body that has been replaced holds nothing. A mount is
   * asynchronous, so it is null for the first tick and `draw` returns at that —
   * {@link renderSettingsPane} redraws once the mount settles.
   */
  body: HTMLElement | null;
  /**
   * The element the ACTIVE section was drawn into, inside {@link ActiveSettingsPane.body}.
   *
   * Sections no longer share one container, and they cannot: a converted section mounts a document
   * and clears what it is given, which destroys lit's `_$litPart$` markers — so the next lit
   * section rendering into that same element throws on a part whose markers have left the document.
   * It fails the other way too: lit renders BESIDE foreign nodes rather than replacing them, so a
   * lit section drawn after a document one left both on screen at once. A fresh host per section is
   * what makes the two kinds coexist, which is the whole of §9.3's surface-level rule applied to
   * one dispatcher.
   */
  sectionHost: HTMLElement | null;
  /** The section the body currently holds, so an idle re-render does not rebuild it. */
  rendered: string | null;
  /** Unsubscribe from the document's change notifications. */
  off: (() => void) | null;
}

const _active = new Map<string, ActiveSettingsPane>();

/** A section row's element id — minted from the key, so the panel can name the row that chose it. */
function tabIdFor(key: string): string {
  return `settings-nav-${key}`;
}

/**
 * Mount (or refresh) the settings editor inside the pane.
 *
 * Idempotent for the same host: canvas-render calls this on every render for this mode, and
 * rebuilding the section body on each one would throw away an open inline form mid-keystroke.
 *
 * @param {CanvasSurface} surface - The pane whose stage hosts the editor
 */
export function renderSettingsPane(surface: CanvasSurface): void {
  const { paneId, wrap: host } = surface;
  if (_active.get(paneId)?.host !== host) {
    detachSettingsPane(paneId);
    const record: ActiveSettingsPane = {
      body: null,
      host,
      off: onSettingsDocumentChanged(() => draw(paneId, true)),
      rendered: null,
      sectionHost: null,
      surface: mountSettingsPaneSurface(host, values(), {
        selectSection: (key: string) => {
          setSettingsSection(key);
        },
      }),
    };
    _active.set(paneId, record);
    /* A mount is asynchronous and the island does not exist until it lands, so the `draw` below
       returns at `!panel.body`. THIS is the pass that first reaches a section renderer — and it
       only runs while this record is still the pane's, because a mode change can detach it while
       the mount is in flight. */
    void record.surface.ready.then(() => {
      if (_active.get(paneId) === record) {
        draw(paneId, true);
      }
    });
  }
  draw(paneId, false);
}

/** Tear one pane's editor down — the mode-change and project-close path. */
export function detachSettingsPane(paneId: string): void {
  const panel = _active.get(paneId);
  if (!panel) {
    return;
  }
  panel.off?.();
  panel.surface.dispose();
  _active.delete(paneId);
}

/**
 * Whether the editor is mounted on this pane's stage — canvas-render's "did I already build this".
 *
 * @param {CanvasSurface} surface
 * @returns {boolean}
 */
export function settingsPaneMounted(surface: CanvasSurface): boolean {
  return _active.get(surface.paneId)?.host === surface.wrap;
}

/** Everything the document draws, decided here so the document decides nothing. */
function values() {
  const active = settingsDocumentSection();
  return {
    active,
    activeTabId: tabIdFor(active),
    empty: NO_SECTIONS,
    hasSection: settingsSection(active) !== undefined,
    navLabel: "Project Settings sections",
    sections: sortedSettingsSections().map((section) => ({
      key: section.key,
      label: section.label,
      tabId: tabIdFor(section.key),
    })),
  };
}

/**
 * Update the nav, then the body.
 *
 * @param {boolean} force - Re-run the section renderer even when the section has not changed. True
 *   for a real state change (a nav click, a section registering, an entry being selected by
 *   command); false for canvas-render's idempotent remount.
 */
function draw(paneId: string, force: boolean): void {
  const panel = _active.get(paneId);
  if (!panel) {
    return;
  }
  const active = settingsDocumentSection();
  panel.surface.update(values());

  /* The island the document is holding right now. A body that has been REPLACED holds nothing, so
     the section it was said to be showing has to be re-drawn — which is the one thing the lit
     `ref` this replaced was ever really tracking. */
  const body = panel.surface.body();
  if (body !== panel.body) {
    panel.body = body;
    panel.rendered = null;
  }
  if (!body || (!force && panel.rendered === active)) {
    return;
  }
  /* Read BEFORE the write: whether the section is changing is what decides the host, and
     `panel.rendered` is about to stop saying so. */
  const changed = panel.rendered !== active;
  panel.rendered = active;
  const section = settingsSection(active);
  if (!section) {
    /* Every section unregistered at once — a project closing while the editor is open. The
       document says so itself (`hasSection`), and the island is emptied so a renderer's leftovers
       do not sit under the sentence explaining that there is nothing to draw. */
    panel.sectionHost = null;
    body.replaceChildren();
    return;
  }
  /* A FRESH host whenever the section changes, and the same one for a forced redraw of the section
     already showing — remounting that one would take the caret out of whatever field the reader is
     typing in. The freshness is what lets the two kinds coexist: a lit section left its render part
     on the element it drew into, and a document section clears the element it is given, so handing
     either one the other's element is a throw or a double render. */
  if (changed || !panel.sectionHost || panel.sectionHost.parentElement !== body) {
    panel.sectionHost = document.createElement("div");
    body.replaceChildren(panel.sectionHost);
  }
  section.render(panel.sectionHost);
}
