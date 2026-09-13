/// <reference lib="dom" />
/**
 * One pane's tab strip, as a mounted document — the mount seam, and nothing else.
 *
 * `tab-strip.json` is the markup, the ARIA, the keyboard and the style; `panels/tab-strip.ts` is
 * the flow — which pane a host is drawing, what each tab is called, what its tooltip says, whether
 * closing it needs a prompt, and what the two menus offer. This module is the seam between them:
 * one scope per HOST, one document mounted into it, and an `update()` that ASSIGNS rather than
 * re-mounts.
 *
 * **One mount per host, not one per pane.** Two panes can resolve to the same strip host while the
 * shell has a single one, and the FOCUSED pane wins the tie (`panels/tab-strip.ts`'s `render`).
 * Keying the mount by pane would then mount twice into one div; keying it by the host is what makes
 * the hand-over an assignment — the same document keeps standing and starts saying the other pane's
 * tabs, which is also what keeps the reader's scroll offset.
 *
 * **The host's region id is NOT stamped here.** `panels/pane-grid.ts` writes `pane.<id>/tabs` on
 * the cell as the cell is built, and that is the one writer: a host can change which pane it draws
 * (the shell's single strip goes to whichever pane has the stage), so a region stamped at MOUNT
 * would be a second answer that never moved again — and `pane.primary/tabs` would resolve to
 * nothing the first time the side pane claimed the strip.
 *
 * **The strip element is HELD, not re-found.** Overflow is a measurement — `scrollWidth` against
 * `clientWidth`, and each chip's `offsetLeft` against the scroll viewport — and a measurement needs
 * the element. It arrives through `onNodeCreated` as the `jx-tabs` is created, so nothing in this
 * package queries the strip by a class it also renders (studio-ui-guidelines.md §9.4).
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import tabStripDoc from "./tab-strip.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("tab-strip", tabStripDoc as unknown as JxDocument);

/**
 * One chip, as the document draws it. Every field is a value: the document asks no question about a
 * tab, and there is no branch in it that a projection has not already decided.
 */
export interface TabChipView extends Record<string, unknown> {
  /** The tab id: the repeater's key, the tab's `value`, and what every action is addressed with. */
  key: string;
  /** The shortest suffix that tells this document apart, or a page's route. */
  label: string;
  /** The full path, the document it was drilled in from, and whether it is a preview. */
  title: string;
  dirty: boolean;
  pinned: boolean;
  preview: boolean;
  dragging: boolean;
  /** Whether to draw the drill-in marker. */
  origin: boolean;
  /** "Pin" or "Unpin" — the pin button's whole accessible name. */
  pinTitle: string;
  pinGlyph: string;
  /** The draft pill's word, or the empty string when this document has no draft axis. */
  pill: string;
  pillTitle: string;
  draft: boolean;
  /** "0" while this is the pane's current tab, "-1" otherwise. The pin's roving stop. */
  tabindex: string;
  /** This chip's slot in the pane's order, which is the drop target index. */
  index: number;
}

/** What one strip says right now. */
export interface TabStripValues {
  /**
   * `tabs`, `derivation`, or `empty`.
   *
   * The `$switch` branches on it and the row's own `hidden` reads it, so a pane with nothing to say
   * is hidden outright rather than left as an empty band. One field rather than a `mode` and a
   * `blank` beside it: two names for one fact are two things that can disagree, and the row that
   * says nothing and the row that draws no branch are the same row.
   */
  mode: "tabs" | "derivation" | "empty";
  /** Whether this pane holds the keyboard. */
  focused: boolean;
  /** The tablist's accessible name. A tablist takes no name from its tabs. */
  stripLabel: string;
  /** The active tab id — what `jx-tabs` compares each tab's `value` against. */
  active: string;
  tabs: TabChipView[];
  /** The derivation chip's preset phrase, finished. */
  preset: string;
  /** What the derivation is a projection OF, or "no document". */
  subject: string;
  chipTitle: string;
  /** Whether the trailing button is on screen at all. */
  trailing: boolean;
  trailingTitle: string;
  trailingGlyph: string;
}

/** What a gesture on the strip asks of the flow. Read once, when the scope is made. */
export interface TabStripActions {
  focusPane: () => void;
  activate: (id: string) => void;
  closeTab: (id: string) => void;
  /** A double click: a preview tab becomes permanent. */
  promote: (id: string) => void;
  togglePin: (id: string) => void;
  context: (id: string, x: number, y: number) => void;
  /** The chevron, or a derived pane's ✕. The anchor is the button that was pressed. */
  openTrailing: (anchor: HTMLElement | null) => void;
  /** A drag left this chip. The `DataTransfer` is the platform's and may be absent. */
  dragStart: (id: string, transfer: DataTransfer | null) => void;
  dragEnd: () => void;
  /** A drop landed on the chip at `index`. */
  drop: (index: number, transfer: DataTransfer | null) => void;
  /** A wheel over the strip. A host function in handler position, so it takes the event. */
  wheel: (scope: unknown, event: WheelEvent) => void;
}

export interface TabStripSurface {
  /** Bring the standing document up to date. An assignment; the mount is never rebuilt. */
  update: (values: TabStripValues) => void;
  /** The `jx-tabs` element, once it exists — the one thing a measurement needs. */
  strip: () => HTMLElement | null;
  /** Take the document down and give the host back empty. Idempotent. */
  dispose: () => void;
}

/** The scope `tab-strip.json` reads. */
interface TabStripScope extends Record<string, unknown>, TabStripValues, TabStripActions {}

/**
 * Mount one strip into `host`.
 *
 * The host is CLEARED first: a pane cell hands the strip a div of its own, and whatever is in it
 * belongs to a pane this strip is no longer drawing.
 *
 * @param {HTMLElement} host The pane cell's strip slot.
 * @param {TabStripValues} values What to say on the first paint.
 * @param {TabStripActions} actions What a gesture does. Read once, when the scope is made.
 * @returns {TabStripSurface}
 */
export function mountTabStripSurface(
  host: HTMLElement,
  values: TabStripValues,
  actions: TabStripActions,
): TabStripSurface {
  const scope = reactive<TabStripScope>({ ...values, ...actions }) as TabStripScope;

  host.replaceChildren();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  let strip: HTMLElement | null = null;
  void mountSurface("tab-strip", scope, host, {
    onNodeCreated: (element, _path, def) => {
      const part = typeof def === "string" ? undefined : def.attributes?.["part"];
      if (part === "tabs" && element instanceof HTMLElement) {
        strip = element;
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
      strip = null;
      host.replaceChildren();
    },
    strip: () => strip,
    update(next) {
      /* Field by field, so an unchanged one is inert. A whole-object assignment would re-run every
         binding in the row on every workspace tick, which is what a keyed `$map` exists to avoid.

         `mode` IS ASSIGNED LAST, and that is an ordering rather than a style. It is what the
         `$switch` branches on, so writing it first builds the new branch against the data the OLD
         one was showing — a strip whose tabs arrive one assignment later, into a `jx-tabs` that has
         already connected and distributed its slot around nothing. Measured: a derived pane whose
         one tab comes back drew an EMPTY tablist, and the chip the flow then went looking for to
         scroll into view was not there. Every value the new shape needs is in place before the
         shape changes. */
      scope.focused = next.focused;
      scope.stripLabel = next.stripLabel;
      scope.active = next.active;
      scope.tabs = next.tabs;
      scope.preset = next.preset;
      scope.subject = next.subject;
      scope.chipTitle = next.chipTitle;
      scope.trailing = next.trailing;
      scope.trailingTitle = next.trailingTitle;
      scope.trailingGlyph = next.trailingGlyph;
      scope.mode = next.mode;
    },
  };
}
