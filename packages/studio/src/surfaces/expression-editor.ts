/// <reference lib="dom" />
/**
 * The expression editor as a mounted document.
 *
 * This is the adapter. `ui/expression-editor.ts` is the flow — it decides what an operator needs,
 * which rung an operand occupies, what a literal's type is, which refs may be bound, what the live
 * preview says and what every gesture commits — and this module is the seam it draws through.
 * Nothing here knows what an expression IS: the scope is a flat list of rows that already carry
 * their own indent.
 *
 * **The rows arrive FLAT, and that is the whole conversion.** An expression nests to any depth — an
 * operand may be another expression, a `reduce`'s per-item body is one, and either may hold more of
 * both — while a document's one repeater is `$prototype: "Array"` over a list. So the flow walks
 * the tree once and hands over rows that already say how far in they sit, exactly as
 * `surfaces/statements.ts` does for the statement tree. Recursion is a property of the WALK, never
 * of the document.
 *
 * **Keyed by host, because there are five callers and several at once.** The Inspector's Content
 * and Logic tabs, the Navigator's State panel, the statement editor and the Logic dock each open
 * one per bound slot, so a repaint of any of them finds the mount already standing in its host and
 * only assigns to its scope. That is what keeps a reader's caret inside an operand while the panel
 * around it repaints.
 *
 * **No region is stamped.** Every host this mounts into belongs to another surface which has
 * already said where it is (`inspector/field:<prop>`, `inspector/statements`, the dock's own id); a
 * second id on the same subtree would be a second answer to one question.
 *
 * @docs studio/logic/formulas
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import expressionEditorDoc from "./expression-editor.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("expression-editor", expressionEditorDoc as unknown as JxDocument);

/** A closed list of choices, in the shape the kit's select reads. */
export interface ExprOption {
  value: string;
  label: string;
}

/** A delimited run of choices — the kit's own `optgroup`, which draws both halves of the rule. */
export interface ExprSelectGroup {
  id: string;
  label: string;
  rows: ExprOption[];
}

/** One chip of the pipeline, as the document draws it. */
export interface ExprChipView extends Record<string, unknown> {
  /** The joined node path: the repeater's key, and what a click reports back to the flow. */
  key: string;
  label: string;
  /** The live value at this node. */
  badge: string;
  /** Whether the preview has a value here at all: `""` is a legitimate one. */
  hasBadge: boolean;
  /** `"true"` when this is a parenthesised non-target operand rather than a link of the chain. */
  group: string;
}

/**
 * Which of the six shapes a row takes.
 *
 * They differ in what they COMMIT rather than in what they look like: `operand` is the workhorse
 * and carries the value ladder, `operator` is the one row that picks what the node DOES, and the
 * other four are the strip, the refusal, a section's name and a button that grows the node.
 */
export type ExprRowKind = "chips" | "error" | "operator" | "operand" | "label" | "action";

/** Which rung of the value ladder an `operand` row is showing, and so which control it draws. */
export type ExprSource = "literal" | "ref" | "expression" | "empty";

/** Which leading cell an `operand` row carries before its label. */
export type ExprLead = "none" | "arg" | "case" | "default";

/**
 * One line of the flattened expression, already decided.
 *
 * Every field is a string, a flag or a list: the document asks no question about an expression, and
 * there is no branch in it that the walk has not already taken.
 */
export interface ExprRowView extends Record<string, unknown> {
  /**
   * Unique within one editor, and the repeater's key. It is the node's own path plus the slot it
   * fills, so a row that survives an edit keeps its node — which is what stops a keystroke in one
   * operand from rebuilding the operand beside it.
   */
  key: string;
  kind: ExprRowKind;
  /** This line's own indent, as a CSS length. Depth is a property of the row, not of the tree. */
  indent: string;
  /**
   * Whether this line belongs to a NESTED expression rather than to the root one — `"true"` or
   * `"false"`, as a WORD.
   *
   * It draws the connector rule on the leading edge, and it is written into `data-nested`: an
   * interpolated boolean is the platform's boolean-attribute convention (`true` is a present
   * attribute with an empty value, `false` is no attribute at all), which cannot carry a value a
   * selector matches on. The `$switch` discriminants beside it stay booleans, because a case name
   * IS the stringified value there.
   */
  nested: string;
  /** A field's label, a section's name, a button's verb, or the preview's refusal. */
  label: string;
  /** What `inspector/field:<prop>` addresses. Empty on rows that are not a field. */
  prop: string;
  /** The accessible name of the row's icon-only control. */
  title: string;
  /** An `operator` row's grouped operator list. */
  groups: ExprSelectGroup[];
  /** An `operator` row offers the catalog beside its picker; a nested one does not. */
  catalog: boolean;
  /** Which rung an `operand` row shows. */
  source: ExprSource;
  /** The rungs on offer. Empty means the slot admits one shape, so there is nothing to choose. */
  sourceOptions: ExprOption[];
  /** Whether the rung picker is drawn at all — `sourceOptions` non-empty, said as a flag. */
  chooser: boolean;
  /** `string`, `number`, `boolean` or `null` — what the literal type picker holds. */
  literalType: string;
  /** The literal types on offer. A separate list from {@link sourceOptions}: two questions. */
  typeOptions: ExprOption[];
  /** Which literal control follows the type picker: `text`, `number`, `bool` or `null`. */
  literal: string;
  /** What a text literal, a number literal or a ref picker holds. */
  value: string;
  /** What a boolean literal holds. */
  checked: boolean;
  /** The signals this slot may bind to. */
  refOptions: ExprOption[];
  /** The event refs, as their own named run. Empty where the position admits none. */
  refGroups: ExprSelectGroup[];
  /** Which leading cell the row carries. */
  lead: ExprLead;
  /** An arg's positional name, or the `default` case's word. */
  leadLabel: string;
  /** A `switch` case's matched value, which is editable because the key IS the value. */
  leadValue: string;
  /** Whether the row may be taken away — an argument, or one case of a `switch`. */
  removable: boolean;
  /** The live value at this row's node. */
  badge: string;
  /** Whether the preview has a value here at all. */
  hasBadge: boolean;
  /** What a slot with nothing to bind to says instead of offering an empty picker. */
  emptyMessage: string;
  emptyDetail: string;
  /** A `chips` row's strip, in reading order. */
  chips: ExprChipView[];
}

/** What a gesture on a row asks of the flow. Every one of them names a row by its key. */
export interface ExpressionActions {
  /** The operator picker. */
  setOperator: (key: string, value: string) => void;
  /** The catalog button, anchored on the button that asked. */
  browse: (key: string, anchor: HTMLElement) => void;
  /** The value-source picker: which rung this operand should occupy. */
  setSource: (key: string, value: string) => void;
  /** The literal type picker. */
  setLiteralType: (key: string, value: string) => void;
  /** A keystroke in a string literal. */
  setText: (key: string, value: string) => void;
  /** A committed number literal. */
  setNumber: (key: string, value: string) => void;
  /** A boolean literal. */
  setBool: (key: string, checked: boolean) => void;
  /** A picked ref. */
  setRef: (key: string, value: string) => void;
  /** A `switch` case renamed from its own key cell. */
  renameCase: (key: string, value: string) => void;
  /** Take away an argument or a case. */
  remove: (key: string) => void;
  /** Run an `+ Add arg` / `+ Add case` row. */
  act: (key: string) => void;
  /** A chip was clicked: it names a node, and the flow decides what that means. */
  pickChip: (key: string) => void;
}

interface ExpressionScope extends Record<string, unknown>, ExpressionActions {
  rows: ExprRowView[];
}

interface Mounted {
  scope: ExpressionScope;
  /** `null` while the mount is still in flight — which is a standing surface, not a missing one. */
  handle: SurfaceHandle | null;
  /** Set when the host was given up, so a mount that settles afterwards takes itself down. */
  disposed: boolean;
}

/**
 * Every standing editor, by the host it was mounted into.
 *
 * A strong `Map` rather than a `WeakMap`, for the reason `surfaces/statements.ts` gives: the mount
 * registry holds each host by reference, so an editor whose row was unbound has to be DISPOSED
 * rather than merely forgotten, and {@link disposeDetachedExpressionEditors} is what finds them.
 */
const mounts = new Map<HTMLElement, Mounted>();

/**
 * Draw one expression editor into `host`, or bring the one already there up to date.
 *
 * @param {HTMLElement} host The element the caller left for this editor.
 * @param {ExprRowView[]} rows The flattened expression, in the order it is read.
 * @param {ExpressionActions} actions What a row may do; read once, when the surface is mounted.
 */
export function renderExpressionEditorSurface(
  host: HTMLElement,
  rows: ExprRowView[],
  actions: ExpressionActions,
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
  const scope = reactive({ ...actions, rows }) as ExpressionScope;
  const record: Mounted = { disposed: false, handle: null, scope };
  mounts.set(host, record);
  /* No race to arbitrate: a repaint arriving while this is in flight takes the branch above — a
     record with no handle yet IS the standing one — so a second mount into the same host cannot
     start before this settles. A host given up in the meantime is what `disposed` answers. */
  void mountSurface("expression-editor", scope, host).then((handle) => {
    if (record.disposed) {
      handle.dispose();
      return;
    }
    record.handle = handle;
  });
}

/**
 * Take down every editor whose host has left the document.
 *
 * A slot the reader unbound, or a statement they deleted, takes its host with it — and nothing else
 * in the chain hears about that, because the panel around it simply renders something else.
 */
export function disposeDetachedExpressionEditors(): void {
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
