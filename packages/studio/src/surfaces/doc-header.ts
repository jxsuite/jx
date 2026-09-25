/// <reference lib="dom" />
/**
 * The Document Header card, as a Jx document over the kit.
 *
 * This is the adapter. `panels/frontmatter-panel.ts` keeps the card — which document it is drawn
 * for, which rows that document has, what each row commits into and where a media or reference row
 * gets its choices — and hands this module one projection whose every field is already a string.
 * The document draws it and decides nothing.
 *
 * **One row vocabulary, and the discriminant is what a row LOOKS like rather than what it means.**
 * Title, the Layout picker and every schema-driven frontmatter field are the same `row`; they
 * differ in what they write, and what they write is reached by the row's `key` through the flow's
 * own table. That is why {@link DocHeaderRow.key} and {@link DocHeaderRow.prop} are two fields:
 * `key` is the identity the repeater and every action use, `prop` is the name a reader and the
 * inspector see. A collection whose schema declares a `layout` property would otherwise share an
 * identity with the Layout picker.
 *
 * **The card is mounted once per PANE.** Two stages can each be drawing a header, so this module is
 * keyed by nothing at all: it hands back a handle and the flow holds one per pane. A repaint only
 * ASSIGNS to the standing scope — rebuilding the mount would take a field out from under a reader
 * mid-edit, which is the whole reason the lit card needed a focus-aware scheduler and the reason
 * this one does not.
 *
 * @docs studio/editing/frontmatter
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import docHeaderDoc from "./doc-header.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("doc-header", docHeaderDoc as unknown as JxDocument);

/** One choice in a row's picker. The shape `jx-select` reads. */
export interface DocHeaderChoice {
  value: string;
  label: string;
}

/**
 * One row of the card, as the document reads it.
 *
 * Every field is present on every row whatever its `kind`, because a binding renders a value and a
 * `$switch` chooses on one: a row that omitted `options` would leave the picker case reading an
 * absent path.
 */
export interface DocHeaderRow extends Record<string, unknown> {
  /** The row's identity: the repeater's key, and the argument every action is given. */
  key: string;
  /** The name on `data-prop` — what a reader, a screenshot region and the inspector call it. */
  prop: string;
  /** The visible label, already carrying the required marker where the schema asks for one. */
  label: string;
  /** Which control the row draws. */
  kind: "text" | "number" | "boolean" | "select" | "media";
  /** Whether the value is set on this document — §4.2's dot, and the row's only clear affordance. */
  isSet: boolean;
  /** The dot's accessible name and tooltip, e.g. `Clear title`. */
  clearLabel: string;
  /** The text, number or chosen value, always as a string. Empty for a boolean row. */
  value: string;
  /** A boolean row's state. `false` on every other kind. */
  checked: boolean;
  /** A text row's placeholder. Empty draws none. */
  placeholder: string;
  /** A picker's rows, in the order they are offered. Empty on every other kind. */
  options: DocHeaderChoice[];
  /** A sentence under the control — an empty collection, or a listing that failed. */
  note: string;
  /** Whether {@link DocHeaderRow.note} has anything in it; `$switch` is the document's conditional. */
  hasNote: boolean;
  /** A media row's thumbnail source. Empty draws none. */
  thumb: string;
  /** Whether {@link DocHeaderRow.thumb} has anything in it. */
  hasThumb: boolean;
}

/** One `$head` entry the disclosure lists, read-only. */
export interface DocHeaderRawEntry extends Record<string, unknown> {
  /** Unique within one document — the repeater's key. */
  key: string;
  /** The entry as markup, e.g. `<meta name="author">`. */
  label: string;
  /** What it says, shown after the label and as its tooltip. */
  value: string;
}

/** What the card is showing right now. */
export interface DocHeaderView {
  /** The region id the card stamps on itself — `pane.<id>/frontmatter`. */
  region: string;
  /** `in-column` in Edit, `pinned` in Design. The stage decides; the card only draws it. */
  placement: "in-column" | "pinned";
  /** The matched collection's name, or the word `Document` when it belongs to none. */
  collection: string;
  /** This page's route. */
  route: string;
  /** Whether there is a route to state — a component and a bare entry have none. */
  hasRoute: boolean;
  /** Title, Layout and every frontmatter field, in reading order. */
  rows: DocHeaderRow[];
  /** `empty` draws the sentence, `list` draws {@link DocHeaderView.rawEntries}. */
  rawState: "empty" | "list";
  /** The `$head` entries no structured control owns. */
  rawEntries: DocHeaderRawEntry[];
  /** Whether the disclosure is open. Per document, and the flow remembers it. */
  rawOpen: boolean;
}

/**
 * What the reader can do here. Every one of them is given the row's `key`, never its `prop`: the
 * flow decides what a key commits into, and two rows may legitimately share a name.
 */
export interface DocHeaderActions {
  /** Delete the row's value from the document. */
  clear: (key: string) => void;
  /** The reader is typing: commit after a pause, so the canvas follows without a write per key. */
  editText: (key: string, value: string) => void;
  /** The reader left the field or pressed Enter: commit now, cancelling any pending write. */
  commitText: (key: string, value: string) => void;
  /** A numeric field settled on a value. Arrives as text, because an empty field means empty. */
  setNumber: (key: string, value: string) => void;
  /** A checkbox moved. */
  setBoolean: (key: string, checked: boolean) => void;
  /** A picker settled on a row. */
  setChoice: (key: string, value: string) => void;
  /** Open the OS file picker for a media row and assign what comes back. */
  upload: (key: string) => void;
  /** Open the media browser under the button that was pressed. */
  browse: (key: string, anchor: unknown) => void;
  /** Run the `document.openSeo` command — the door to Search appearance. */
  openSeo: () => void;
  /** Remember that the Raw head tags disclosure was opened or closed. */
  setRawOpen: (open: boolean) => void;
}

export interface DocHeaderSurface {
  /** Bring the standing document up to date. */
  update: (view: DocHeaderView) => void;
  /** Whether the document this mounted is still standing in the host it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads: the view plus the actions, flat. */
interface DocHeaderScope extends Record<string, unknown>, DocHeaderView, DocHeaderActions {}

/** Write a whole view into the scope. Assignment only — the mount is never rebuilt for a repaint. */
function project(scope: DocHeaderScope, view: DocHeaderView): void {
  scope.region = view.region;
  scope.placement = view.placement;
  scope.collection = view.collection;
  scope.route = view.route;
  scope.hasRoute = view.hasRoute;
  scope.rows = view.rows;
  scope.rawState = view.rawState;
  scope.rawEntries = view.rawEntries;
  scope.rawOpen = view.rawOpen;
}

/**
 * Mount the card into `host` — the node the stage made for it.
 *
 * The host is CLEARED first: the stage hands the card a slot of its own, and whatever was in it
 * belongs to a document this card is no longer drawing.
 *
 * @param {HTMLElement} host The stage's slot for the card.
 * @param {DocHeaderView} view What the card says to begin with.
 * @param {DocHeaderActions} actions What each control does. Read once, when the scope is made.
 * @returns {DocHeaderSurface}
 */
export function mountDocHeaderSurface(
  host: HTMLElement,
  view: DocHeaderView,
  actions: DocHeaderActions,
): DocHeaderSurface {
  const scope = reactive<DocHeaderScope>({
    ...actions,
    collection: "Document",
    hasRoute: false,
    placement: "in-column",
    rawEntries: [],
    rawOpen: false,
    rawState: "empty",
    region: "",
    route: "",
    rows: [],
  }) as DocHeaderScope;
  project(scope, view);

  host.replaceChildren();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on an element here, so the mount is all there is to wait for: `jx-textfield`,
     `jx-select` and `jx-accordion-item` settle their own templates one `connectedCallback` later
     without anybody asking them to (specs/studio-ui-guidelines.md §1.1, "await the element"). */
  void mountSurface("doc-header", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    /* While the mount is in flight the card owns the host only for as long as the host is still the
       empty one it was handed; once mounted, the question is whether the root is still in it — a
       stage that redrew took the card's root away without telling anyone. */
    connected: () =>
      !disposed &&
      (mounted === null
        ? host.childNodes.length === 0
        : (mounted.root as Node).parentNode === host),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update: (next) => project(scope, next),
  };
}
