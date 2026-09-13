/// <reference lib="dom" />
/**
 * The Inspector's Logic tab as a mounted document.
 *
 * This is the adapter. `panels/events-panel.ts` is the flow — it reads the selection, works out
 * which rungs a position permits, decides what a handler currently holds, counts which elements of
 * a multi-selection disagree about a key, and turns every gesture into a transaction — and this is
 * the surface it draws into. Nothing here reads the document.
 *
 * **Two islands, both through `onNodeCreated`** (specs/studio-ui-guidelines.md §9.4).
 * `[part="control-host"]` and `[part="expression-host"]` receive the expression editor, which is a
 * lit surface of its own and another conversion's to move; `[part="statements-host"]` receives the
 * `statements` surface, which is a mounted document of its own. Both are announced as they are
 * CREATED, one reconcile step before they are in the page — so connectedness is deliberately not
 * consulted, because "is it connected" answers no for exactly the node that needs filling.
 *
 * **A host is held, never re-found.** A keyed row keeps its node across an update, so a control
 * host whose statement moved under it would still be showing the previous one's editor; the flow
 * repaints the hosts it holds after every projection rather than querying the tab for them.
 *
 * @docs studio/logic/events
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import logicPanelDoc from "./logic-panel.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("logic-panel", logicPanelDoc as unknown as JxDocument);

/** A closed list of choices, in the shape the kit's select reads. */
export interface LogicOption {
  value: string;
  label: string;
}

/** Which control a bindable row draws. The flow picks it; the document switches on it. */
export type LogicFieldKind = "control" | "text" | "select";

/**
 * A bindable value as a first-class field row: a collection, a filter, a sort key, a `$switch`.
 *
 * These were the last second-class rows in the inspector (§12 P5 item 6) — a bare label and a
 * widget, with no set dot, no clear affordance and no error slot. Every field the tab has is one of
 * these now.
 */
export interface LogicFieldView {
  /** The slot's field key: the repeater's key, and what every callback names. */
  key: string;
  /** What `inspector/field:<prop>` addresses. */
  prop: string;
  label: string;
  kind: LogicFieldKind;
  /** What a `text` or `select` control holds. Empty for a control host. */
  value: string;
  placeholder: string;
  options: LogicOption[];
  /** Draw the text control monospaced — a pointer or a template string. */
  mono: boolean;
  /** The rung's own id, for `data-source`. */
  source: string;
  /** The rung's name, in the four words every bindable position in Studio uses. */
  sourceLabel: string;
  /** The chip's accessible name, which says whether another rung is even on offer. */
  sourceHint: string;
  /** This position permits exactly one rung, so the chip is a label rather than a control. */
  sourceLocked: boolean;
  /** `set`, `mixed` or `unset` — what the dot reports. */
  dotState: string;
  /** The dot's colour: `warning` where the selection disagrees, neutral otherwise. */
  tone: string;
  /** The clear button's accessible name. */
  clearTitle: string;
  /** The position is mandatory and cannot be cleared. */
  clearLocked: boolean;
}

/** One case of a `$switch`, as a row of the Condition section. */
export interface LogicCaseView {
  /** The case name; its own identity, and what every callback names. */
  key: string;
  /** `case:<name>` — what `inspector/field:case:<name>` addresses. */
  prop: string;
  name: string;
  openTitle: string;
  removeTitle: string;
}

/** One event a component's own functions declare they emit. */
export interface LogicDeclaredView {
  /** `<fn>:<name>` — unique even when two functions emit the same event. */
  key: string;
  name: string;
  /** `← handleSave`. */
  source: string;
  /** The event's TypeScript type, when the manifest gives one. Empty draws nothing. */
  type: string;
  title: string;
}

/** Which of the four things a handler's body is. */
export type LogicBodyKind = "statements" | "code" | "expression" | "ref";

/** One `on*` key and whatever produces it. */
export interface LogicBindingView {
  /** The event key; the repeater's identity, and what every callback names. */
  key: string;
  name: string;
  nameTitle: string;
  source: string;
  sourceLabel: string;
  sourceHint: string;
  /** `set` or `mixed` — whether the selected elements agree about this key. */
  dotState: string;
  tone: string;
  clearTitle: string;
  body: LogicBodyKind;
  /** An inline function may be written as statements or as code, so it gets the toggle. */
  showToggle: boolean;
  /**
   * `"true"` / `"false"` — the segmented control's two halves are RADIOS, not toggles.
   *
   * The kit's action button flips its own `selected` on activation when `toggles` is on, which is a
   * second writer for a state this flow owns: the body's representation is a fact about the
   * document, so the button may draw it and must not decide it. `checked` is the channel that says
   * exactly that, and it is what makes the pair announce itself as one choice of two.
   */
  statementsChecked: string;
  codeChecked: string;
  /** The code body's text. Empty for every other body. */
  code: string;
  refValue: string;
  refOptions: LogicOption[];
  /** The escape hatch's accessible name — the code editor, or the formula workspace. */
  openTitle: string;
}

/** A read-only name and what it maps to: an observed attribute, a custom property, a part. */
export interface LogicKvView {
  key: string;
  prop: string;
  name: string;
  /** `→ label` or `<jx-card>`. Empty draws nothing. */
  detail: string;
  /** The value or type beside the name. Empty draws nothing. */
  value: string;
  /** `reflects`, and whatever joins it. Empty draws nothing. */
  tags: string;
}

/** One button of an empty state — an id the flow knows, and the words on it. */
export interface LogicEmptyAction {
  id: string;
  label: string;
}

/** Everything the Logic tab shows, already decided. */
export interface LogicView {
  /** `empty` or `ready` — no document, no selection and a stale one are all the first. */
  state: string;
  emptyMessage: string;
  /** What the reader can do about it. An empty state that teaches nothing offers none (§11.1). */
  emptyActions: LogicEmptyAction[];
  hasEmptyActions: boolean;

  hasRepeater: boolean;
  repeaterOpen: boolean;
  repeaterFields: LogicFieldView[];
  hasTemplate: boolean;

  hasCondition: boolean;
  conditionOpen: boolean;
  conditionFields: LogicFieldView[];
  cases: LogicCaseView[];

  hasEvents: boolean;
  eventsOpen: boolean;
  hasDeclared: boolean;
  declared: LogicDeclaredView[];
  hasBindings: boolean;
  bindings: LogicBindingView[];

  hasObserved: boolean;
  observedOpen: boolean;
  observedEmpty: boolean;
  observed: LogicKvView[];

  hasCssProps: boolean;
  cssPropsOpen: boolean;
  cssProps: LogicKvView[];

  hasCssParts: boolean;
  cssPartsOpen: boolean;
  cssParts: LogicKvView[];
}

/** What the tab may ask the flow to do. Every one of them names a row by its key. */
export interface LogicActions {
  /** Open the Value Source ladder for a bindable row, anchored on the chip that asked. */
  pickSource: (key: string, anchor: HTMLElement) => void;
  setField: (key: string, value: string) => void;
  clearField: (key: string) => void;
  editTemplate: () => void;
  openCase: (key: string) => void;
  removeCase: (key: string) => void;
  renameCase: (key: string, value: string) => void;
  addCase: () => void;
  /** Open the event-name menu — this element's own keys, the ten worth suggesting, and Other…. */
  pickEventName: (key: string, anchor: HTMLElement) => void;
  /** Open the handler's Value Source ladder. */
  pickHandler: (key: string, anchor: HTMLElement) => void;
  clearEvent: (key: string) => void;
  setBodyMode: (key: string, mode: string) => void;
  setCode: (key: string, value: string) => void;
  setHandlerRef: (key: string, value: string) => void;
  openEditor: (key: string) => void;
  addEvent: () => void;
  setSection: (id: string, open: boolean) => void;
  runEmptyAction: (id: string) => void;
}

/** Where the flow's islands land. Each is announced with the key of the row it belongs to. */
export interface LogicIslands {
  /** A bindable row's expression editor. */
  controlSlot: (key: string, host: HTMLElement) => void;
  /** A handler whose body is a formula. */
  expressionSlot: (key: string, host: HTMLElement) => void;
  /** A handler whose body is structured — the `statements` surface's own host. */
  statementsSlot: (key: string, host: HTMLElement) => void;
}

interface LogicScope extends Record<string, unknown>, LogicView, LogicActions {}

export interface LogicSurface {
  /** Re-project. The document's bindings skip every value that did not move. */
  update: (view: LogicView) => void;
  /** Whether the mounted root is still where it was put. */
  connected: () => boolean;
  dispose: () => void;
}

/** The tab with nothing selected — the state it opens in, and the one it returns to. */
export function emptyLogicView(): LogicView {
  return {
    bindings: [],
    cases: [],
    conditionFields: [],
    conditionOpen: true,
    cssParts: [],
    cssPartsOpen: false,
    cssProps: [],
    cssPropsOpen: false,
    declared: [],
    emptyActions: [],
    emptyMessage: "",
    eventsOpen: true,
    hasBindings: false,
    hasCondition: false,
    hasCssParts: false,
    hasCssProps: false,
    hasDeclared: false,
    hasEmptyActions: false,
    hasEvents: false,
    hasObserved: false,
    hasRepeater: false,
    hasTemplate: false,
    observed: [],
    observedEmpty: false,
    observedOpen: false,
    repeaterFields: [],
    repeaterOpen: true,
    state: "empty",
  };
}

/** Assign the projection field by field: the runtime writes only the bindings that moved. */
function project(scope: LogicScope, view: LogicView): void {
  for (const [key, value] of Object.entries(view)) {
    (scope as Record<string, unknown>)[key] = value;
  }
}

/** The `part` a node was rendered with, or "". */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/** The `key` of the `$map` item a node was rendered inside, or "". */
function itemKey(state: JxScope | undefined): string {
  const item = (state?.["$map"] as { item?: unknown } | undefined)?.item;
  const key =
    item !== null && typeof item === "object" ? (item as Record<string, unknown>).key : "";
  return typeof key === "string" ? key : "";
}

/**
 * Mount the Logic tab into `host` — the container the Inspector owns for the life of the window.
 *
 * The host is CLEARED first: this document is the whole of what the tab shows, and whatever was in
 * the container belongs to a render that is over.
 *
 * @param {HTMLElement} host The Inspector's `events` tab container.
 * @param {LogicView} view The first projection.
 * @param {LogicActions} actions What a control does; read once, when the surface is mounted.
 * @param {LogicIslands} islands Where the expression editors and statement editors land.
 * @returns {LogicSurface}
 */
export function mountLogicSurface(
  host: HTMLElement,
  view: LogicView,
  actions: LogicActions,
  islands: LogicIslands,
): LogicSurface {
  const scope = reactive<LogicScope>({
    ...emptyLogicView(),
    ...actions,
  } as LogicScope) as LogicScope;
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  host.replaceChildren();
  void mountSurface("logic-panel", scope, host, {
    onNodeCreated: (element, _path, def, state) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const part = partOf(def);
      if (part !== "control-host" && part !== "expression-host" && part !== "statements-host") {
        return;
      }
      /* Read out of the node's own `$map` scope rather than off the element. A node is announced
         when it is BUILT, one append before its attributes are settled, so `dataset` answers ""
         for exactly the host that needs filling. */
      const key = itemKey(state);
      if (part === "control-host") {
        islands.controlSlot(key, element);
      } else if (part === "expression-host") {
        islands.expressionSlot(key, element);
      } else {
        islands.statementsSlot(key, element);
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
    connected: () => {
      const root = mounted?.root;
      return root instanceof HTMLElement ? root.isConnected : !disposed;
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update(next) {
      project(scope, next);
    },
  };
}
