/// <reference lib="dom" />
/**
 * The Inspector's Style tab, as a Jx document over the kit.
 *
 * This is the adapter. `panels/style-panel.ts` keeps every decision — which compound coordinate the
 * tab is editing, what css-meta says a property is, where a value came from, what a commit writes
 * and into how many elements — and hands this module one projection whose every field is already a
 * string, a boolean or a list of them. The document draws it and decides nothing.
 *
 * **One seam, and it is announced rather than queried** (specs/studio-ui-guidelines.md §9.4). The
 * Target Line is its own document and cannot share a container with this one, so the tab draws an
 * empty `[part="target-host"]` and the runtime reports it through `onNodeCreated` as it is made.
 * There was a second: a colour row drew an empty `[part="control-host"]` a lit island filled,
 * because the kit's colour elements were `ui.md` §5.6 and §5.6 was Pending. It landed, the row is a
 * `jx-color-field` in the document beside every other control, and the sink that carried it is gone
 * with it.
 *
 * **The mount is only ever ASSIGNED to.** A repaint that rebuilt it would take the field a reader
 * is typing into out from under them, which is the whole reason the lit panel needed
 * `panels/panel-scheduler.ts`'s focus guard and the reason this one is not allowed near it.
 *
 * @docs studio/design/style-inspector
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import stylePanelDoc from "./style-panel.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("style-panel", stylePanelDoc as unknown as JxDocument);

// ─── The projection ──────────────────────────────────────────────────────────

/** Which control a row draws. The flow picks it; the document switches on it. */
export type StyleWidgetKind =
  | "text"
  | "number"
  | "group"
  | "buttons"
  | "color"
  | "shorthand"
  | "kv"
  | "kvadd"
  | "nested"
  | "nestedadd";

/** What a row IS, independently of what it draws — the identity a screenshot region reads. */
export type StyleRowKind =
  | "field"
  | "shorthand"
  | "custom"
  | "custom-add"
  | "nested"
  | "nested-add";

/** How the provenance chip is drawn: not at all, as a control, or as a statement. */
export type StyleChipControl = "none" | "button" | "text";

/**
 * One colour the project has named, as the row's palette draws it.
 *
 * `value` is the reference and `color` is the literal behind it, and they are two fields because
 * they are two things: choosing a swatch commits `var(--color-accent)`, while the chip is only how
 * that reads on screen. `label` is what a reader hears — a swatch is never named by its hex.
 */
export interface StyleTokenView extends Record<string, unknown> {
  value: string;
  color: string;
  label: string;
}

/** One value of a button-group row. */
export interface StyleButtonView extends Record<string, unknown> {
  /** The owning row's key — a nested `$map` shadows `$map.item`, so the row carries it here. */
  row: string;
  /** The CSS value this button commits, and the button's identity in the repeater. */
  value: string;
  /** The accessible name and tooltip. */
  title: string;
  /** A kit glyph name, or the empty string where the kit has none for this value. */
  icon: string;
  /** The abbreviation drawn when there is no glyph. Empty when there is one. */
  text: string;
  selected: boolean;
}

/**
 * One row of the tab, as the document reads it.
 *
 * Every field is present on every row whatever its `widget`, because a binding renders a value and
 * a `$switch` chooses on one: a row that omitted `buttons` would leave that case reading an absent
 * path. `key` is the identity — the repeater's key and the argument every action is given — and
 * `prop` is the name a reader, the region grammar and the inspector see. The two are different on
 * purpose: one coordinate's `color` and another's are two rows with one name.
 */
export interface StyleRowView extends Record<string, unknown> {
  key: string;
  prop: string;
  label: string;
  kind: StyleRowKind;
  widget: StyleWidgetKind;
  /** A longhand under an expanded shorthand — indented, and it carries no Value Source chip. */
  child: boolean;
  /** A value whose `$show` condition no longer passes: it is set, and it cannot apply. */
  warning: boolean;
  /** Span both columns of a grid section. */
  span: boolean;
  /** Whether the row draws a label line at all — the add-a-property field does not. */
  hasLabel: boolean;
  chip: StyleChipControl;
  chipState: string;
  chipText: string;
  chipTitle: string;
  /** The Value Source chip (§6.3). Absent on a child, a custom pair and a nested rule. */
  hasSource: boolean;
  sourceState: string;
  sourceLabel: string;
  sourceHint: string;
  /** The control's value, always as a string. */
  value: string;
  placeholder: string;
  mono: boolean;
  min: string;
  max: string;
  step: string;
  /** Whether the row offers a list beside its field — units, keywords, or a button overflow. */
  hasChoices: boolean;
  /** The chooser's own label: the current unit, a chevron, or the overflow glyph's name. */
  choicesLabel: string;
  choicesHint: string;
  buttons: StyleButtonView[];
  /** The palette a colour row offers inside its picker, and whether it has one to offer. */
  tokens: StyleTokenView[];
  hasTokens: boolean;
  overflowSelected: boolean;
  expanded: boolean;
  expandIcon: string;
  expandLabel: string;
  /** A custom pair's key cell, or a nested rule's selector. */
  name: string;
  removeLabel: string;
  openTitle: string;
}

/** One accordion section. */
export interface StyleSectionView extends Record<string, unknown> {
  key: string;
  label: string;
  open: boolean;
  /** `grid` lays the rows in two columns — the Size section, and nothing else. */
  layout: string;
  /** The inert half of the heading tally: one mark per informative state present. */
  marks: { state: string }[];
  /** Whether {@link StyleSectionView.marks} has anything in it — an empty tally draws nothing. */
  hasMarks: boolean;
  /** "3 set here · 2 inherited" — the sentence the retired Active toggle used to answer by hiding. */
  tally: string;
  /** Whether anything in the section can be cleared, which is what makes the accent dot a control. */
  canClear: boolean;
  clearTitle: string;
  rows: StyleRowView[];
}

/** What the tab is showing right now. */
export interface StylePanelView {
  /** `empty` draws a teaching state; `editor` draws the Target Line, the filter and the sections. */
  view: "empty" | "editor";
  emptyMessage: string;
  hasEmptyAction: boolean;
  emptyActionLabel: string;
  filter: string;
  sections: StyleSectionView[];
}

/**
 * What the reader can do here. Every one of them names a row by its `key`, never by its `prop`: the
 * flow decides what a key commits into, and two rows may legitimately share a name.
 */
export interface StylePanelActions {
  /** The empty state's one button. */
  runEmptyAction: () => void;
  setFilter: (value: string) => void;
  toggleSection: (key: string, open: boolean) => void;
  clearSection: (key: string) => void;
  /** The reader is typing: commit after a pause, so the canvas follows without a write per key. */
  editText: (key: string, value: string) => void;
  /** The reader left the field or pressed Enter: commit now, cancelling any pending write. */
  commitText: (key: string, value: string) => void;
  /** The provenance chip, a custom pair's remove and a nested rule's remove are one verb. */
  chipClick: (key: string) => void;
  /** Open the Value Source picker under the chip that was pressed. */
  pickSource: (key: string, anchor: unknown) => void;
  /** Open the row's list of offerable values under the button that was pressed. */
  pickChoice: (key: string, anchor: unknown) => void;
  pressButton: (key: string, value: string) => void;
  toggleShorthand: (key: string) => void;
  renameCustom: (key: string, name: string) => void;
  /** Enter in the add-a-property field. Given the field too, because it is emptied on success. */
  addCustom: (key: string, field: unknown) => void;
  openNested: (key: string) => void;
  addNested: () => void;
}

/** Where the one announced host belongs. */
export interface StyleHostSink {
  /** The Target Line's container, as it is created — and `null` when the document is taken down. */
  target: (host: HTMLElement | null) => void;
}

export interface StylePanelSurface {
  /** Bring the standing document up to date. */
  update: (view: StylePanelView) => void;
  /** Whether the document this mounted is still standing in the host it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads: the view plus the actions, flat. */
interface StylePanelScope extends Record<string, unknown>, StylePanelView, StylePanelActions {}

/** A node definition's `part`, as written in the document. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/** Write a whole view into the scope. Assignment only — the mount is never rebuilt for a repaint. */
function project(scope: StylePanelScope, view: StylePanelView): void {
  scope.view = view.view;
  scope.emptyMessage = view.emptyMessage;
  scope.hasEmptyAction = view.hasEmptyAction;
  scope.emptyActionLabel = view.emptyActionLabel;
  scope.filter = view.filter;
  scope.sections = view.sections;
}

/**
 * Mount the tab into `host` — the Inspector's own body for the Style tab.
 *
 * The host is CLEARED first: a document owns the node it is given, and whatever the dock painted
 * there belongs to a state this tab is no longer in.
 *
 * @param {HTMLElement} host The Inspector's Style tab body.
 * @param {StylePanelView} view What the tab says to begin with.
 * @param {StylePanelActions} actions What each control does. Read once, when the scope is made.
 * @param {StyleHostSink} hosts Where the announced Target Line host is handed to.
 * @returns {StylePanelSurface}
 */
export function mountStylePanelSurface(
  host: HTMLElement,
  view: StylePanelView,
  actions: StylePanelActions,
  hosts: StyleHostSink,
): StylePanelSurface {
  const scope = reactive<StylePanelScope>({
    ...actions,
    emptyActionLabel: "",
    emptyMessage: "",
    filter: "",
    hasEmptyAction: false,
    sections: [],
    view: "empty",
  }) as StylePanelScope;
  project(scope, view);

  host.replaceChildren();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("style-panel", scope, host, {
    onNodeCreated: (element, _path, def) => {
      if (element instanceof HTMLElement && partOf(def) === "target-host") {
        hosts.target(element);
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
    /* While the mount is in flight the tab owns the host only for as long as the host is still the
       empty one it was handed; once mounted, the question is whether the root is still in it — a
       dock that redrew took the tab's root away without telling anyone. */
    connected: () =>
      !disposed &&
      (mounted === null
        ? host.childNodes.length === 0
        : (mounted.root as Node).parentNode === host),
    dispose() {
      disposed = true;
      hosts.target(null);
      mounted?.dispose();
      mounted = null;
    },
    update: (next) => project(scope, next),
  };
}
