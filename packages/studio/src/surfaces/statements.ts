/// <reference lib="dom" />
/**
 * The statement editor as a mounted document.
 *
 * This is the adapter. `panels/statement-editor.ts` is the flow — it discriminates a statement's
 * kind, addresses the lane a card lives in, seeds a new statement, rewrites the tree immutably and
 * registers the drag adapter — and this module is the seam it draws through. Nothing here knows
 * what a statement IS: the scope is a flat list of rows that already carry their own indent.
 *
 * **Keyed by host, because there are several at once.** The Navigator's State panel opens one
 * editor per expanded Function entry and the Inspector's Logic tab opens one per structured
 * handler, so a repaint of either dock finds the mount already standing in its host and only
 * assigns to its scope. That is what keeps a reader's caret inside an operand while the panel
 * around it repaints, and it is the same bargain `surfaces/panel-data.ts` strikes for its trees.
 *
 * **The region is the HOST's.** A shared control cannot know where it is, so it may not claim to:
 * the id arrives with the rows and is stamped on the host element (`ui/regions.ts` states the rule
 * at {@link import("../ui/regions").inspectorStatementsRegion}).
 *
 * **One island, through `onNodeCreated`** (specs/studio-ui-guidelines.md §9.4). An operand is the
 * expression editor, which is a lit surface of its own and not this conversion's to move: the
 * document renders an empty `[part="control-host"]` for it and the flow fills it. A host is
 * announced as it is CREATED, one reconcile step before it is in the page, so connectedness is
 * deliberately not consulted — checking it is how a control comes out empty on first mount.
 *
 * @docs studio/logic/statements
 */

import { reactive } from "../reactivity";
import { REGION_ATTR } from "../ui/regions";
import { mountSurface, registerSurface } from "../ui/surface";
import statementsDoc from "./statements.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("statements", statementsDoc as unknown as JxDocument);

/** Which control one operand of a statement draws. The flow picks it; the document switches on it. */
export type StatementFieldKind = "control" | "text" | "select" | "flags";

/** A closed list of choices, in the shape the kit's select reads. */
export interface StatementOption {
  value: string;
  label: string;
}

/** One `eventInit` flag of a `dispatchEvent` statement. */
export interface StatementFlagView {
  /** `<row>::<prop>::<flag>` — self-contained, because a third `$map` shadows both above it. */
  key: string;
  label: string;
  checked: boolean;
}

/** One operand of a statement, as the document draws it. */
export interface StatementFieldView {
  /** `<row>::<prop>` — the repeater's key, the control host's id, and what a commit names. */
  key: string;
  /** What `inspector/field:<prop>` addresses. */
  prop: string;
  label: string;
  kind: StatementFieldKind;
  /** What a `text` or `select` control holds. Empty for the other two kinds. */
  value: string;
  placeholder: string;
  options: StatementOption[];
  flags: StatementFlagView[];
}

/** One line of the flattened statement tree. */
export interface StatementRowView {
  /**
   * Unique within one editor, and the repeater's key. A card that survives an edit keeps its node,
   * so typing into one operand does not rebuild the card beside it.
   */
  key: string;
  /** `card`, `lane`, `add` or `action` — which of the four the document draws. */
  kind: "card" | "lane" | "add" | "action";
  /** This line's own indent, as a CSS length. Depth is a property of the row, not of the tree. */
  indent: string;
  /** A card's header text, a lane's name, a button's label. */
  label: string;
  /** The accessible name of the row's icon-only control; a card's is its delete button. */
  title: string;
  /** A card's statement kind, carried onto `data-stmt-kind`. Empty on every other row. */
  stmt: string;
  /** The JSON lane path a card belongs to — the drag adapter's "may I drop here". */
  lane: string;
  /** The card's index within that lane. `0` on every other row. */
  index: number;
  /** A card's operands, in the order they read. */
  fields: StatementFieldView[];
  /** A lane whose name is the `$switch` case value it stands for, and so is editable. */
  editable: boolean;
  /** A lane that may be taken away — an `else`, or one case of a `$switch`. */
  removable: boolean;
}

/** What a row may ask the flow to do. Every one of them names a row (or field) by its key. */
export interface StatementActions {
  /** Delete a card, an `else` lane, or one case of a `$switch`. */
  remove: (key: string) => void;
  /** Open the add-statement menu for a lane, anchored on the button that asked. */
  add: (key: string, anchor: HTMLElement) => void;
  /** Run an `+ Add else` / `+ Add case` row. */
  act: (key: string) => void;
  /** Commit a `text` or `select` operand. */
  setField: (key: string, value: string) => void;
  /** Commit one `eventInit` flag. */
  setFlag: (key: string, checked: boolean) => void;
  /** Rename a `$switch` case from its lane header. */
  rename: (key: string, value: string) => void;
}

/** Where the flow's one island lands. */
export interface StatementIslands {
  /** An operand's control host, announced as the runtime creates it. */
  controlSlot: (id: string, host: HTMLElement) => void;
}

interface StatementScope extends Record<string, unknown>, StatementActions {
  rows: StatementRowView[];
}

interface Mounted {
  scope: StatementScope;
  /** `null` while the mount is still in flight — which is a standing surface, not a missing one. */
  handle: SurfaceHandle | null;
  /** Set when the host was given up, so a mount that settles afterwards takes itself down. */
  disposed: boolean;
}

/**
 * Every standing editor, by the host it was mounted into.
 *
 * A strong `Map` rather than a `WeakMap`, for the reason `surfaces/panel-data.ts` gives: the mount
 * registry holds each host by reference, so an editor whose entry was collapsed has to be DISPOSED
 * rather than merely forgotten, and {@link disposeDetachedStatementEditors} is what finds them.
 */
const mounts = new Map<HTMLElement, Mounted>();

/**
 * Draw one statement editor into `host`, or bring the one already there up to date.
 *
 * @param {HTMLElement} host The element the panel left for this editor.
 * @param {StatementRowView[]} rows The flattened tree, in the order it is read.
 * @param {string} region The host's region id — supplied by the host, never invented here.
 * @param {StatementActions} actions What a row may do; read once, when the surface is mounted.
 * @param {StatementIslands} islands Where the operand editors land.
 */
export function renderStatementsSurface(
  host: HTMLElement,
  rows: StatementRowView[],
  region: string,
  actions: StatementActions,
  islands: StatementIslands,
): void {
  const existing = mounts.get(host);
  if (
    existing &&
    !existing.disposed &&
    (existing.handle === null || existing.handle.root.isConnected)
  ) {
    existing.scope.rows = rows;
    return;
  }
  takeDown(host, existing);
  host.textContent = "";
  /* Stamped here rather than only by `mountSurface`, which stamps it after awaiting the kit. The
     region is a fact about the HOST — who is drawing this editor — not about the document inside
     it, so it should be true the moment the host is claimed rather than a frame later. */
  host.setAttribute(REGION_ATTR, region);
  const scope = reactive({ ...actions, rows }) as StatementScope;
  const record: Mounted = { disposed: false, handle: null, scope };
  mounts.set(host, record);
  /* No race to arbitrate: a repaint arriving while this is in flight takes the branch above — a
     record with no handle yet IS the standing one — so a second mount into the same host cannot
     start before this settles. A host given up in the meantime is what `disposed` answers. */
  void mountSurface("statements", scope, host, {
    onNodeCreated: (element, _path, def, state) => {
      if (!(element instanceof HTMLElement) || partOf(def) !== "control-host") {
        return;
      }
      /* Read out of the node's own `$map` scope rather than off the element. A node is announced
         when it is BUILT, one append before its attributes are settled, so `dataset.field` answers
         "" for exactly the host that needs filling — which is how the operand came out empty on
         first mount. `ui/schema-form.ts` records the same finding at its own control host. */
      islands.controlSlot(itemKey(state), element);
    },
    region,
  }).then((handle) => {
    if (record.disposed) {
      handle.dispose();
      return;
    }
    record.handle = handle;
  });
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
 * Take down every editor whose host has left the document.
 *
 * An entry the reader collapsed, or a handler they unbound, takes its host with it — and nothing
 * else in the chain hears about that, because the panel around it simply renders something else.
 */
export function disposeDetachedStatementEditors(): void {
  for (const [host, record] of mounts) {
    if (!host.isConnected) {
      takeDown(host, record);
    }
  }
}

/** Give up a host: stop its mount (or the one still arriving) and forget it. */
function takeDown(host: HTMLElement, record: Mounted | undefined): void {
  if (!record) {
    return;
  }
  record.disposed = true;
  record.handle?.dispose();
  record.handle = null;
  mounts.delete(host);
}
