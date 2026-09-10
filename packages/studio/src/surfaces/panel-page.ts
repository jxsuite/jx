/// <reference lib="dom" />
/**
 * The Navigator's Page panel, as a mounted document.
 *
 * `panels/head-panel.ts` is the flow — what a `$head` entry means, which of them a structured
 * control already owns, what the layout cascade resolves to, which realm a title lives in and what
 * a commit writes — and this is the surface it draws into: the reactive scope the document reads,
 * the flags it discriminates on, and the mount that stays put while the Navigator repaints around
 * it.
 *
 * **The flow tells the surface what a row says, never what it means.** A section arrives as a title
 * and a list of rows whose every field is already a string; a custom tag arrives as the markup it
 * reads as, the text it carries and a key. Nothing here learns that `og:image` is a property rather
 * than a name, that `__none__` means "no layout", or that a `<title>` element in `$head` is
 * discarded. That matters more here than in the settings sections, because the rows are NESTED —
 * inside the per-row map `$map/item` is the row, so a row genuinely cannot reach the section it is
 * under — and a key it can hand straight back is the whole answer.
 *
 * **Keyed by host, not by module.** `afterRender` runs on every Navigator repaint, so the common
 * case is an UPDATE of a standing surface rather than a mount; a module-level handle would also be
 * wrong the moment a second dock draws this panel.
 *
 * @docs studio/editing/frontmatter
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import pagePanelDoc from "./panel-page.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-page", pagePanelDoc as unknown as JxDocument);

/** One choice in a row's picker, or in the add form's tag picker. */
export interface PageChoice {
  value: string;
  label: string;
}

/**
 * One row of one section, as the document reads it.
 *
 * Every field is present on every row whatever its `kind`, because a binding renders a value and a
 * `$switch` chooses on one: a row that omitted `options` would leave the picker case reading an
 * absent path.
 *
 * {@link PageRow.key} and {@link PageRow.prop} are two fields for the reason the Document Header
 * card gives: `key` is the identity the repeater and every action use, `prop` is the name a reader,
 * a screenshot region and `ui/regions.ts`'s `field:<prop>` grammar see. A collection whose schema
 * declares a `layout` property would otherwise share an identity with the Layout picker.
 */
export interface PageRow extends Record<string, unknown> {
  /** The row's identity: the repeater's key, and the argument every action is given. */
  key: string;
  /** The name on `data-prop`. */
  prop: string;
  /** The visible label, already carrying the required marker where a schema asks for one. */
  label: string;
  /** Which control the row draws. `textarea` is a multiline text field, not a second element. */
  kind: "text" | "textarea" | "number" | "boolean" | "select" | "media";
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
  options: PageChoice[];
  /** A sentence under the control — an empty collection, or a listing that failed. */
  note: string;
  /** Whether {@link PageRow.note} has anything in it; `$switch` is the document's conditional. */
  hasNote: boolean;
  /** A media row's thumbnail source. Empty draws none. */
  thumb: string;
  /** Whether {@link PageRow.thumb} has anything in it. */
  hasThumb: boolean;
}

/** One band of the panel: a heading, and the rows under it. */
export interface PageSection extends Record<string, unknown> {
  /** The repeater's key, and the `data-section` a test or a shot addresses the band by. */
  key: string;
  /** The heading, already carrying the collection's name where there is one. */
  title: string;
  /** Whether this band carries the door to Search appearance. Exactly one of them does. */
  hasSeo: boolean;
  rows: PageRow[];
}

/** One `$head` entry no structured control owns, as the list draws it. */
export interface PageTagRow extends Record<string, unknown> {
  /** Unique within one projection — the repeater's key, and what Remove hands back. */
  key: string;
  /** The entry as markup, e.g. `<meta name="author">`. */
  label: string;
  /** What it says, drawn after the label and as its tooltip. */
  value: string;
  /** The remove button's accessible name, which names the tag it would take away. */
  removeLabel: string;
}

/** What the panel says the surface should be showing right now. */
export interface PagePanelView {
  /** Frontmatter, Layout, Page and OpenGraph — whichever of them this document has, in order. */
  sections: PageSection[];
  /** How many custom tags there are, as the text the count draws. */
  customCount: string;
  /** `empty` draws the teaching sentence, `listed` draws {@link PagePanelView.customEntries}. */
  customState: "empty" | "listed";
  customEntries: PageTagRow[];
  /** The add form's three halves, held as state so a repaint cannot take a draft away. */
  addTag: string;
  addAttr: string;
  addValue: string;
  /** The element names the add form offers. */
  tagOptions: PageChoice[];
}

/**
 * What a control can ask the panel to do. Every one of them is given the row's `key`, never its
 * `prop`: the flow decides what a key commits into, and two rows may legitimately share a name.
 */
export interface PagePanelActions {
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
  /** Take one custom `$head` entry away. */
  removeEntry: (key: string) => void;
  /** State what the add form's tag picker now holds, before anything is decided about it. */
  editTag: (value: string) => void;
  /** State what the attribute field now holds. */
  editAttr: (value: string) => void;
  /** State what the value field now holds. */
  editValue: (value: string) => void;
  /** Add the drafted tag to `$head`. */
  addEntry: () => void;
}

/** The scope the document reads: the projection, plus everything a control can ask for. */
interface PagePanelScope extends Record<string, unknown>, PagePanelView, PagePanelActions {}

/** Write a projection into the scope. Assignment by assignment, so an unchanged field is inert. */
function project(scope: PagePanelScope, view: PagePanelView): void {
  scope.sections = view.sections;
  scope.customCount = view.customCount;
  scope.customState = view.customState;
  scope.customEntries = view.customEntries;
  scope.addTag = view.addTag;
  scope.addAttr = view.addAttr;
  scope.addValue = view.addValue;
  scope.tagOptions = view.tagOptions;
}

/** The scope's starting shape, before the first projection lands on it. */
function emptyView(): PagePanelView {
  return {
    addAttr: "",
    addTag: "",
    addValue: "",
    customCount: "0",
    customEntries: [],
    customState: "empty",
    sections: [],
    tagOptions: [],
  };
}

interface Mounted {
  scope: PagePanelScope;
  /** `null` while the mount is still in flight — which is a standing surface, not a missing one. */
  handle: SurfaceHandle | null;
}

const mounts = new WeakMap<HTMLElement, Mounted>();

/**
 * Draw the panel into `host`, or bring the one already there up to date.
 *
 * A mount whose root has left the document is remade; one still standing is only assigned to. That
 * is what keeps the Navigator's repaint — which runs on every document edit, and calls this every
 * time — from rebuilding the field list under the reader and taking the caret out of the box they
 * are typing into. It is also why the Page panel must not go through `panels/panel-scheduler.ts`:
 * the focus guard exists because a lit repaint rebuilds every control, and a document binds each
 * value on its own effect and skips a write equal to what the control already holds
 * (specs/studio-ui-guidelines.md §9.3). There is no window left to withhold.
 *
 * @param {HTMLElement} host The panel's content area.
 * @param {PagePanelView} view What to show.
 * @param {PagePanelActions} actions What the reader may do — read once, when the surface is
 *   mounted.
 */
export function renderPagePanelSurface(
  host: HTMLElement,
  view: PagePanelView,
  actions: PagePanelActions,
): void {
  const existing = mounts.get(host);
  if (existing && (existing.handle === null || existing.handle.root.isConnected)) {
    project(existing.scope, view);
    return;
  }
  existing?.handle?.dispose();
  host.textContent = "";
  const scope = reactive({ ...emptyView(), ...actions }) as PagePanelScope;
  project(scope, view);
  const record: Mounted = { handle: null, scope };
  mounts.set(host, record);
  /* No race to arbitrate: a redraw arriving while this is in flight takes the branch above — a
     record with no handle yet IS the standing one — so a second mount into the same host cannot
     start before this settles. And nothing is called on the element either, so the mount is all
     there is to wait for: the DOCUMENT is what this surface renders, and the kit elements inside it
     settle their own templates one `connectedCallback` later without anybody here asking them to
     (specs/studio-ui-guidelines.md §1.1, "await the element"). What a panel adds over a settings
     section is that its host can also be emptied by the DOCK — lit clears the content area when
     another panel draws into it — and that needs no arbitration either: the root goes with it, so
     the next `afterRender` sees a disconnected handle and remakes the surface through the branch
     above. */
  void mountSurface("panel-page", scope, host).then((handle) => {
    record.handle = handle;
  });
}
