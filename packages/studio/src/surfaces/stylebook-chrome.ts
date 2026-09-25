/// <reference lib="dom" />
/**
 * The Project Styles chrome bar, as a mounted document.
 *
 * `panels/stylebook-panel.ts` is the flow — it decides which breakpoints the catalogue is drawn at,
 * builds the specimen document and mounts one iframe per panel — and this is the one part of that
 * stage that is chrome rather than canvas.
 *
 * **The host element belongs to this module, not to the stage.** The rest of `renderStylebookMode`
 * is a lit template whose artboards are `TemplateResult`s handed in by `canvas/canvas-render.ts`,
 * so there is no container in the stage to mount into and no way to make one without editing the
 * canvas. So the surface carries its own: one `<div>` per pane, mounted once and handed to lit as a
 * child value. lit inserts a Node it is given rather than cloning it, and re-inserting the same
 * node is a no-op, so the document survives every rebuild of the stage around it — and leaving the
 * mode merely `remove()`s the node, which leaves the document inside it intact for the next entry.
 *
 * The host is `display: contents` because the bar positions itself: the document root carries the
 * `position: absolute` the chrome always had, and a wrapper box would become the stage's flex item
 * in its place.
 *
 * **One record per PANE, keyed by the stage itself.** Two panes can both be showing Project Styles,
 * and a module-level slot would hand the second pane's mount the first pane's host — the defect
 * `scripts/check-pane-singletons.ts` exists for. A `WeakMap` keyed on the `CanvasSurface` also
 * needs no teardown hook: the record goes when the pane does.
 *
 * @docs studio/design/stylebook
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import chromeDoc from "./stylebook-chrome.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("stylebook-chrome", chromeDoc as unknown as JxDocument);

/** What the bar says right now. Every field is the panel's own wording, never a value it derives. */
export interface StylebookChromeView {
  /** The toolbar's accessible name — the surface's title, never the canvas view's wire value. */
  title: string;
  /** What the filter field holds: the reader's own text, not a normalised form of it. */
  filter: string;
  /** The filter field's accessible name. */
  filterLabel: string;
  /** Whether the catalogue is reduced to what this file has already styled. */
  customizedOnly: boolean;
  /** The toggle's visible text and its accessible name — one word, so they are one field. */
  customizedLabel: string;
  /** The toggle's tooltip: what reducing the catalogue actually does. */
  customizedHint: string;
}

/** What the two controls can ask the panel to do. */
export interface StylebookChromeActions {
  /** Called with what the field now holds. */
  setFilter: (value: string) => void;
  toggleCustomized: () => void;
}

export interface StylebookChromeSurface {
  /** The element the document lives in — handed to the stage's lit template as a child value. */
  readonly host: HTMLElement;
  /** Bring the standing surface up to date, remounting only if its root has been taken away. */
  update: (view: StylebookChromeView) => void;
}

interface StylebookChromeScope
  extends Record<string, unknown>, StylebookChromeView, StylebookChromeActions {}

/**
 * Create the bar's surface, mounted into a host of its own.
 *
 * There is no teardown, deliberately: the host is the thing lit takes in and out of the stage, and
 * leaving Project Styles is a `remove()` of that node, which leaves the document inside it intact
 * and ready to be inserted again.
 *
 * @param {StylebookChromeView} view What the bar says to begin with.
 * @param {StylebookChromeActions} actions What the two controls do.
 * @returns {StylebookChromeSurface}
 */
export function createStylebookChromeSurface(
  view: StylebookChromeView,
  actions: StylebookChromeActions,
): StylebookChromeSurface {
  const host = document.createElement("div");
  host.style.display = "contents";
  const scope = reactive({ ...view, ...actions }) as StylebookChromeScope;

  /** `null` while a mount is in flight — which is a standing surface, not a missing one. */
  let handle: SurfaceHandle | null = null;
  let mounting = false;

  function mount(): void {
    mounting = true;
    void mountSurface("stylebook-chrome", scope, host).then((mounted) => {
      mounting = false;
      handle = mounted;
    });
  }

  mount();

  return {
    host,
    update(next) {
      Object.assign(scope, next);
      /* A standing mount is only ASSIGNED to. The stage is rebuilt whenever the filter changes —
         that is what makes the specimen catalogue narrow — so rebuilding the bar on every rebuild
         would take the field out from under the reader on the keystroke that caused it. The
         remount below answers the one case assignment cannot: a host the document has been taken
         out of. It cannot fire while a mount is in flight, because a record with no handle yet IS
         the standing one. */
      if (mounting || (handle !== null && host.contains(handle.root))) {
        return;
      }
      handle?.dispose();
      handle = null;
      host.textContent = "";
      mount();
    },
  };
}
