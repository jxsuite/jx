/// <reference lib="dom" />
/**
 * The Navigator's Data panel, as a mounted document.
 *
 * `panels/signals-panel.ts` is the flow — what category an entry falls in, what its badge and its
 * summary say, which control each field of a `$prototype` gets, what a commit is worth, what a
 * rename collides with, and every transaction that follows — and this is the surface it draws into:
 * the reactive scope the document reads, and the mount that stays put while the Navigator repaints
 * around it.
 *
 * **The field list is a projection, not a shape per category.** A `Request` entry and an
 * `IndexedDB` entry differ only in the rows the flow hands over, so a new `$prototype` is a case in
 * TypeScript and no markup at all. Nothing in the document knows what `LocalStorage` is.
 *
 * **Every control hands back the names that place it.** The maps nest four deep — category, entry,
 * field, and a table field's rows and cells — and inside the innermost one `$map/item` is the cell,
 * so a control genuinely cannot see the entry it belongs to. Each record therefore carries the
 * entry name, the field key and (for a cell) its row and column, which the flow looks straight back
 * up. That is the same answer `surfaces/git-panel.json` gives for its nested file rows.
 *
 * **Five islands, all through `onNodeCreated`** (specs/studio-ui-guidelines.md §9.4). The
 * expression editor, the statement-card editor and the media picker are lit surfaces of their own
 * that other panels embed; the shared schema form hands back a HOST rather than a template; and the
 * resolved-value tree is a document of its own (`surfaces/panel-data.ts`). The document renders an
 * empty host for each and the flow fills it.
 *
 * **The container is not cleared**, for the reason `surfaces/git-panel.ts` states: a panel body is
 * a node lit renders into and its comment markers are how lit finds its own content again. So the
 * document is APPENDED, and {@link SignalsSurfaceHandle.attached} is how the panel finds out that
 * the Navigator has since painted another panel over the top of it.
 *
 * @docs studio/logic/data
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import signalsDoc from "./panel-signals.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-signals", signalsDoc as unknown as JxDocument);

/** One row of a picker, as `jx-select` reads it. */
export interface SignalOption {
  value: string;
  label: string;
}

/** A named run of picker rows. `jx-select` draws both halves of a group's delimiter. */
export interface SignalOptionGroup {
  id: string;
  label: string;
  rows: SignalOption[];
}

/** One chip of the basic parameter editor. */
export interface SignalChipView {
  key: string;
  label: string;
  /** The entry this chip belongs to, because inside the chip map nothing else can see it. */
  signal: string;
  /** The field key — `parameters`. */
  field: string;
  removeLabel: string;
}

/** One cell of a table field: one column of one row. */
export interface SignalCellView {
  key: string;
  kind: "text" | "checkbox";
  label: string;
  value: string;
  placeholder: string;
  checked: boolean;
  /** This column's share of the row, written as a custom property the one shared rule reads. */
  grow: string;
  signal: string;
  field: string;
  row: string;
}

/** One row of a table field — a CEM parameter, or an emitted event. */
export interface SignalCellRowView {
  key: string;
  cells: SignalCellView[];
  removeLabel: string;
  signal: string;
  field: string;
}

/** One segment of a `bar` field's mode switch. */
export interface SignalSegmentView {
  key: string;
  label: string;
  selected: boolean;
  signal: string;
  field: string;
}

/** One icon button on a `bar` field. */
export interface SignalBarButtonView {
  key: string;
  icon: string;
  label: string;
  signal: string;
  field: string;
}

/**
 * Which control a field is drawn as.
 *
 * Three pairs are the same thing in two dresses, and each pair is a real distinction rather than a
 * convenience: `slot` and `slot-field` are an island full width or inside a labelled row (the media
 * picker is one control among several, the expression editor owns its row); `multiline` and `code`
 * are a labelled text box and a bare one, because a function body already has the `bar` above it
 * saying "Body" and a labelled field would print the word twice; `note` and `hint` are a fact
 * beside a label and a sentence about the whole entry, which has no value to name.
 */
export type SignalFieldKind =
  | "text"
  | "multiline"
  | "code"
  | "select"
  | "checkbox"
  | "note"
  | "hint"
  | "slot"
  | "slot-field"
  | "bar"
  | "chips"
  | "rows";

/** One field of one entry's editor. Every value is a value: no records, no closures. */
export interface SignalFieldView {
  /** Unique within the entry, the repeater's key, and the name the flow looks its writer up by. */
  key: string;
  /**
   * What `data-prop` says — the id the region grammar reads (`ui/regions.ts`). It is the label for
   * every row that had one, because that is what `ui/field-row.ts` was passed.
   */
  prop: string;
  kind: SignalFieldKind;
  /** The entry this field edits. */
  signal: string;
  label: string;
  /** Whether the row collapses to one column: a wide control reads better with its label above it. */
  span: boolean;
  value: string;
  placeholder: string;
  mono: boolean;
  /** How many lines a multiline field is tall before it grows. */
  rows: string;
  error: string;
  hasError: boolean;
  checked: boolean;
  options: SignalOption[];
  /** Which island this host is for — `expression`, `statements`, `media` or `schema`. */
  slot: string;
  chips: SignalChipView[];
  cellRows: SignalCellRowView[];
  addLabel: string;
  segments: SignalSegmentView[];
  buttons: SignalBarButtonView[];
  /** The basic/advanced switch's label, or `""` for a field that has no second view. */
  footer: string;
  hasFooter: boolean;
}

/** One state entry, as the row list draws it. */
export interface SignalRowView {
  /** The entry's name, which is also its reconcile key and what every control hands back. */
  key: string;
  name: string;
  badge: string;
  /** `state`, `computed`, `data`, `expression` or `function` — the badge's tint, and its tooltip. */
  category: string;
  categoryLabel: string;
  expanded: boolean;
  /** The one summary slot: the definition hint, or what the canvas resolved the entry to. */
  summary: string;
  summaryTitle: string;
  /** `hint`, `value` or `pending` — only the last is dimmed, and only it pulses on a refresh. */
  summaryTone: string;
  deleteLabel: string;
  liveLabel: string;
  fields: SignalFieldView[];
}

/** One category section. Which sections are collapsed is the panel's record, not the document's. */
export interface SignalCategoryView {
  key: string;
  /** "State (3)" — the count is part of the heading, not a badge of its own. */
  label: string;
  open: boolean;
  rows: SignalRowView[];
}

/** Everything the panel says the surface should be showing right now. */
export interface SignalsView {
  /** `none` while there is nothing to refresh, `idle` for the button, `busy` while one is out. */
  refreshState: "none" | "idle" | "busy";
  /** Whether a refresh is in flight — the one moment a pending value pulses rather than resting. */
  refreshing: boolean;
  listState: "listed" | "empty";
  emptyMessage: string;
  categories: SignalCategoryView[];
  addOptions: SignalOption[];
  addGroups: SignalOptionGroup[];
  /** What the add picker holds. Always `""` at rest — see {@link SignalsActions.addSignal}. */
  addValue: string;
}

/** What a control can ask the panel to do. Every one of them is a decision the flow owns. */
export interface SignalsActions {
  toggleCategory: (key: string, open: boolean) => void;
  toggleRow: (name: string) => void;
  dropSignal: (name: string) => void;
  refresh: () => void;
  /**
   * Add an entry of the picked kind.
   *
   * The picker never rests on what was picked, so the flow announces the pick on the scope and then
   * the empty string: a controlled input is authoritative only while the scope value MOVES
   * (studio-ui-guidelines.md §9.3), and writing `""` over `""` is a no-op the binding skips.
   */
  addSignal: (type: string) => void;
  /** The reader typed. What that is worth — nothing, a debounce, a commit — is the field's own. */
  inputField: (signal: string, field: string, value: string) => void;
  /** The reader left the control, or pressed Enter in it. Always a commit. */
  commitField: (signal: string, field: string, value: string) => void;
  checkField: (signal: string, field: string, checked: boolean) => void;
  /** A segment, an icon button or the basic/advanced switch was pressed. */
  pressField: (signal: string, field: string, action: string) => void;
  editCell: (signal: string, field: string, row: string, cell: string, value: string) => void;
  checkCell: (signal: string, field: string, row: string, cell: string, checked: boolean) => void;
  dropRow: (signal: string, field: string, row: string) => void;
  addRow: (signal: string, field: string) => void;
  addChip: (signal: string, field: string, value: string) => void;
  dropChip: (signal: string, field: string, chip: string) => void;
}

/**
 * Fill one island the document has drawn an empty host for.
 *
 * @param {HTMLElement} host The empty node the document created.
 * @param {string} signal The entry it belongs to.
 * @param {string} slot Which island it is: `expression`, `statements`, `media`, `schema`, `tree`.
 */
export type SignalIslandPainter = (host: HTMLElement, signal: string, slot: string) => void;

export interface SignalsSurfaceHandle {
  /** Bring the mounted document up to date with a whole projection. */
  update: (view: SignalsView) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  attached: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

interface SignalsScope extends Record<string, unknown>, SignalsView, SignalsActions {}

/** One island's host, and what it is a host for. */
interface IslandRecord {
  host: HTMLElement;
  signal: string;
  slot: string;
}

/** The `part` a node was authored with, or `""` — the only thing this adapter asks about a node. */
function partOf(def: unknown): string {
  const attributes = (def as { attributes?: Record<string, unknown> } | null)?.attributes;
  const part = attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/** The `$map` item a node was rendered inside, if it was rendered inside one. */
function mapItem(state: JxScope | undefined): Record<string, unknown> | null {
  const map = state?.["$map"] as { item?: unknown } | undefined;
  const item = map?.item;
  return item !== null && typeof item === "object" ? (item as Record<string, unknown>) : null;
}

/** A string field off a `$map` item, or `""`. */
function itemString(item: Record<string, unknown> | null, field: string): string {
  const value = item?.[field];
  return typeof value === "string" ? value : "";
}

/** The scope's starting shape, before the first projection lands on it. */
function emptyView(): SignalsView {
  return {
    addGroups: [],
    addOptions: [],
    addValue: "",
    categories: [],
    emptyMessage: "",
    listState: "empty",
    refreshState: "none",
    refreshing: false,
  };
}

/** Write a projection into the scope. Assignment by assignment, so an unchanged field is inert. */
function project(scope: SignalsScope, view: SignalsView): void {
  scope.refreshState = view.refreshState;
  scope.refreshing = view.refreshing;
  scope.listState = view.listState;
  scope.emptyMessage = view.emptyMessage;
  scope.categories = view.categories;
  scope.addOptions = view.addOptions;
  scope.addGroups = view.addGroups;
  scope.addValue = view.addValue;
}

/**
 * Mount the Data document into `container`, which is the `.panel-content` the Navigator painted.
 *
 * @param {HTMLElement} container The panel body's content node.
 * @param {SignalsView} view What to draw first.
 * @param {SignalsActions} actions What each control does.
 * @param {SignalIslandPainter} paint Fills one island — see {@link SignalIslandPainter}.
 * @returns {SignalsSurfaceHandle}
 */
export function mountSignalsSurface(
  container: HTMLElement,
  view: SignalsView,
  actions: SignalsActions,
  paint: SignalIslandPainter,
): SignalsSurfaceHandle {
  const scope = reactive<SignalsScope>({
    ...emptyView(),
    ...actions,
    /* The picker never rests on what was picked. A controlled input is authoritative only while
       the scope value MOVES (studio-ui-guidelines.md §9.3), and the projection that follows a pick
       carries the same empty string it already had — so the raw pick is announced first, and the
       empty string after it is a change the binding writes back. This is the surface's business
       rather than the flow's: what the flow is being asked is "add one of these", and the control's
       resting state is not part of that question. */
    addSignal: (type: string) => {
      scope.addValue = type;
      actions.addSignal(type);
      scope.addValue = "";
    },
  }) as SignalsScope;
  project(scope, view);

  /**
   * Every island host the document has announced, by the entry and field it belongs to.
   *
   * Keyed rather than listed, so a host rebuilt for the same field replaces its predecessor instead
   * of accumulating beside it — which is what a `$switch` case does every time a row is reopened.
   */
  const islands = new Map<string, IslandRecord>();
  let painting = false;

  /**
   * Fill every standing island, once, after the DOM has settled.
   *
   * A microtask rather than a synchronous pass, because a `$map`'s re-render is COALESCED into one
   * (`runtime.ts`: the first render is synchronous, every re-render is one microtask), so a host
   * created by a projection does not exist yet when the projection returns. By the time this runs
   * it does — and it is in the page, which is what makes `isConnected` a truthful answer to "has
   * this row been collapsed?" rather than "was this node built a moment ago?".
   */
  const repaint = (): void => {
    if (painting) {
      return;
    }
    painting = true;
    queueMicrotask(() => {
      painting = false;
      for (const [key, record] of islands) {
        if (record.host.isConnected) {
          paint(record.host, record.signal, record.slot);
        } else {
          islands.delete(key);
        }
      }
    });
  };

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("panel-signals", scope, container, {
    onNodeCreated: (element, _path, def, state) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const part = partOf(def);
      if (part !== "slot-host" && part !== "tree-host") {
        return;
      }
      const item = mapItem(state);
      /* The tree host is drawn inside the ENTRY map rather than the field map, so its item is the
         row and the entry's name is that row's own key. */
      const tree = part === "tree-host";
      const signal = tree ? itemString(item, "key") : itemString(item, "signal");
      const slot = tree ? "tree" : itemString(item, "slot");
      if (!signal || !slot) {
        return;
      }
      /* Keyed by the entry and the SLOT rather than by the field, which is also how the flow looks
         a painter up: an entry has at most one of each island, and two records under one key would
         be two hosts for one painter — the first of them orphaned and never filled. */
      islands.set(`${signal}/${slot}`, { host: element, signal, slot });
      repaint();
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
    repaint();
  });

  return {
    /* While the mount is in flight there is nothing in the container to ask about, so the answer is
       whether this handle is still wanted — answering no would start a second mount racing the
       first. Once mounted, the question is whether the root is still where it was put: a Navigator
       that painted another panel cleared this document out from under it. */
    attached: () =>
      !disposed && (mounted === null || (mounted.root as Node).parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
      islands.clear();
    },
    update(next) {
      project(scope, next);
      repaint();
    },
  };
}
