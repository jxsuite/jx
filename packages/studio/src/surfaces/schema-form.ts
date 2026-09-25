/// <reference lib="dom" />
/**
 * The shared schema→form engine as a mounted document.
 *
 * `ui/schema-form.ts` is the flow — it reads the JSON Schema, decides which control each property
 * gets, resolves enum choices through the host's context, works out which rungs of the value ladder
 * the position permits, validates a committed value and turns every gesture into a single-key patch
 * — and this is the surface it draws into. Nothing here knows what a schema is: the scope is a list
 * of already-decided rows.
 *
 * **The host element belongs to this module, not to the caller.** Every caller is still a lit
 * template that interpolates the form into a pane of its own (Project Settings' editor column, the
 * Entry editor's field list, the Signals panel's config block), so there is no container in the
 * host to mount into. The surface therefore carries its own: one `<div>` per controller, mounted
 * once and handed to lit as a child value. lit inserts a Node it is given rather than cloning it,
 * and re-inserting the same node is a no-op, so the document survives every repaint of the pane
 * around it — which is the whole point here, because these are fields a reader is typing into and a
 * repaint that rebuilt them would take the caret with it.
 *
 * The host is `display: contents` for the reason `surfaces/ai-credentials-form.ts` gives: the panes
 * lay their children out themselves, and a wrapper box would become the flex or grid item in the
 * form's place.
 *
 * **Control hosts are announced, never queried.** A property a registered control owns is drawn as
 * an empty `[part="control-host"]`, and the runtime reports it through `onNodeCreated` as it is
 * created — so the flow holds the element rather than re-finding it by selector on every repaint,
 * and a host that the reconciler replaces announces its replacement.
 *
 * @docs extending/ui-kit
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import schemaFormDoc from "./schema-form.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

registerSurface("schema-form", schemaFormDoc as unknown as JxDocument);

/** Which of the nine controls a row draws. The flow picks it; the document switches on it. */
export type SchemaFormFieldKind =
  | "text"
  | "template"
  | "pointer"
  | "select"
  | "checkbox"
  | "number"
  | "json"
  | "rows"
  | "control";

/** A control a row offers as a closed list, in the shape the kit's select reads. */
export interface SchemaFormOption {
  value: string;
  label: string;
}

/** One cell of an array-of-objects row: a single declared property of one item. */
export interface SchemaFormCellView {
  /** `${field}/${row}/${key}` — the cell's reconcile identity, and a control host's id. */
  id: string;
  /** The owning field's key, carried on the cell because a nested `$map` shadows `$map.item`. */
  field: string;
  /** The owning row's key, carried for the same reason. */
  row: string;
  /** The item property this cell edits. */
  key: string;
  label: string;
  kind: "text" | "select" | "checkbox" | "number" | "control";
  value: string;
  checked: boolean;
  options: SchemaFormOption[];
}

/** One item of an array-of-objects field. */
export interface SchemaFormRowView {
  /** Stable across a repaint, so typing in one row does not rebuild the others. */
  key: string;
  /** The owning field's key — see {@link SchemaFormCellView.field}. */
  field: string;
  /** The remove button's accessible name; it is icon-only. */
  removeLabel: string;
  cells: SchemaFormCellView[];
}

/** A read of the shape a JSON field currently holds: `title: string`. */
export interface SchemaFormChipView {
  key: string;
  label: string;
}

/** One property of the schema, as the document draws it. Every field is already decided. */
export interface SchemaFormFieldView {
  /** The schema property key: this row's reconcile identity, and what every callback names. */
  key: string;
  /** What the row is addressed by — `ps.name` when the schema renames it, else the key. */
  prop: string;
  label: string;
  /** The sentence under the row. Empty draws no help line. */
  description: string;
  required: boolean;
  kind: SchemaFormFieldKind;
  /** The value as the control reads it — a string for every kind but `checkbox` and `rows`. */
  value: string;
  checked: boolean;
  placeholder: string;
  /** Choices for `select`, suggestions for `pointer`. */
  options: SchemaFormOption[];
  /** Whether the pointer rung has anything to suggest; with none it is a field alone. */
  hasOptions: boolean;
  /** Bounds off the property schema, so the control refuses out-of-range input itself. */
  min: string;
  max: string;
  step: string;
  /** Draw the text control monospaced — a pointer or a code-ish value. */
  mono: boolean;
  /** Draw the text control as a text area. */
  multiline: boolean;
  /** Why this value is refused (§7.1's inline tier). Empty draws nothing. */
  error: string;
  /** Whether there is a refusal to announce. A document branches on a flag, never on a length. */
  hasError: boolean;
  /** The row's value is refused: the kit shades the label and the help sentence. */
  invalid: boolean;
  /** `×3` from three refusals up; empty below two. */
  errorCount: string;
  hasCount: boolean;
  /** Whether the value ladder is on offer here at all. */
  hasChip: boolean;
  /** The rung's name in the ladder's own vocabulary — "Fixed value", "From data…". */
  sourceLabel: string;
  /** The chip's accessible name and its tooltip. */
  sourceName: string;
  sourceHint: string;
  /** `"bound"` once the value is produced from something else; `"fixed"` while it is typed. */
  source: string;
  /** The position permits exactly one rung, so the chip states it and refuses to open. */
  sourceLocked: boolean;
  /** The chips above a JSON field, naming the shape it holds. */
  chips: SchemaFormChipView[];
  hasChips: boolean;
  rows: SchemaFormRowView[];
  /** The add button's accessible name on an array-of-objects field. */
  addLabel: string;
}

/** What the reader can do. Every one of these is a decision the flow makes. */
export interface SchemaFormActions {
  /** A keystroke in a text control: the flow debounces and commits. */
  edit: (key: string, value: string) => void;
  /** A committed scalar — a change event, a picked option, a typed pointer. */
  commit: (key: string, value: string) => void;
  commitChecked: (key: string, checked: boolean) => void;
  /** A keystroke in a JSON control: parsed on a debounce, kept when it parses. */
  editJson: (key: string, text: string) => void;
  /** Open the value-source picker over the chip that was clicked. */
  pickSource: (key: string, anchor: HTMLElement) => void;
  editCell: (field: string, row: string, cell: string, value: string) => void;
  editCellChecked: (field: string, row: string, cell: string, checked: boolean) => void;
  removeRow: (field: string, row: string) => void;
  addRow: (field: string) => void;
}

/** Everything the document reads that is not a row. */
export interface SchemaFormView {
  fields: SchemaFormFieldView[];
}

export interface SchemaFormSurface {
  /** The element the document lives in — handed to a caller's lit template as a child value. */
  readonly host: HTMLElement;
  /** Bring the standing surface up to date, remounting only if its root has been taken away. */
  readonly update: (view: SchemaFormView) => void;
  /** Take the document down; the host is left empty for its caller to drop. */
  readonly dispose: () => void;
}

/** A control host the document drew, reported as the runtime created it. */
export type ControlHostSink = (id: string, host: HTMLElement) => void;

interface SchemaFormScope extends Record<string, unknown>, SchemaFormView, SchemaFormActions {
  /** The Mixed text placeholder, held in state because the literal is itself a template. */
  templatePlaceholder: string;
}

/**
 * The id a control host announces itself under: a field host is its property, a cell host is its
 * `field/row/property` triple.
 *
 * Read out of the node's own `$map` scope rather than off the element, because `onNodeCreated`
 * fires BEFORE the runtime applies attributes — so an element that has just been created carries
 * neither its `part` nor its `data-control` yet, and a check on either answers no for exactly the
 * node that needs filling.
 */
function controlIdOf(part: string, state: JxScope | undefined): string {
  const item = (state?.["$map"] as { item?: Record<string, unknown> } | undefined)?.item;
  const id =
    part === "control-host"
      ? item?.["key"]
      : part === "cell-control-host"
        ? item?.["id"]
        : undefined;
  return typeof id === "string" ? id : "";
}

/** A node definition's `part`, as written in the document. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * Create the form's surface, mounted into a host of its own.
 *
 * @param {SchemaFormView} view The rows to begin with.
 * @param {SchemaFormActions} actions What each control does.
 * @param {ControlHostSink} onControlHost Called for every registered-control host the document
 *   draws, as it is drawn, with the id the flow put on it.
 * @returns {SchemaFormSurface}
 */
export function createSchemaFormSurface(
  view: SchemaFormView,
  actions: SchemaFormActions,
  onControlHost: ControlHostSink,
): SchemaFormSurface {
  const host = document.createElement("div");
  host.style.display = "contents";
  const scope = reactive({
    ...view,
    ...actions,
    templatePlaceholder: "${state.…}",
  }) as SchemaFormScope;

  /** `null` while a mount is in flight — which is a standing surface, not a missing one. */
  let handle: SurfaceHandle | null = null;
  let mounting = false;
  let disposed = false;

  function mount(): void {
    mounting = true;
    void mountSurface("schema-form", scope, host, {
      onNodeCreated: (element, _path, def, state) => {
        if (!(element instanceof HTMLElement)) {
          return;
        }
        const id = controlIdOf(partOf(def), state);
        if (id !== "") {
          onControlHost(id, element);
        }
      },
    }).then((mounted) => {
      mounting = false;
      if (disposed) {
        mounted.dispose();
        return;
      }
      handle = mounted;
    });
  }

  mount();

  return {
    dispose() {
      disposed = true;
      handle?.dispose();
      handle = null;
      host.textContent = "";
    },
    host,
    update(next) {
      scope.fields = next.fields;
      /* A standing mount is only ASSIGNED to: rebuilding it on every repaint of the pane around it
         would empty the field the reader is typing in. The remount below answers the one case
         assignment cannot — a host the document has been taken out of — and it cannot fire while a
         mount is in flight, because a record with no handle yet IS the standing one. */
      if (disposed || mounting || (handle !== null && host.contains(handle.root))) {
        return;
      }
      handle?.dispose();
      handle = null;
      host.textContent = "";
      mount();
    },
  };
}
