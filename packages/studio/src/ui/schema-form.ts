/// <reference lib="dom" />
/**
 * Schema-form — the reusable JSON-Schema → form engine, and the FLOW half of it.
 *
 * Maps schema property types to controls (enum → select, boolean → checkbox, number/integer →
 * number field, `json-schema` format → JSON editor, array-of-objects → a row per item, other
 * array/object → JSON text, default → text field); hosts commit edits through a single
 * `onChange(patch)` callback; dynamic enum choices resolve through a {@link SchemaFormContext}.
 * Custom controls register by name via {@link registerFormControl} and are consulted first for `ui`
 * overrides.
 *
 * **This module decides; `surfaces/schema-form.json` draws.** Every question with an answer — which
 * control a property gets, what its choices are, which rungs of the value ladder the position
 * permits, what a keystroke is worth and whether a committed value is refused — is answered here
 * and handed over as a list of already-decided rows. The document holds the markup, the ARIA and
 * the style, and holds no schema knowledge at all.
 *
 * **Why a host element and not a template.** A Jx document CLEARS the host it is given, so a
 * document and a lit template can never share a container. {@link mountSchemaForm} therefore hands
 * back the element the form lives in; a caller that is still lit puts that element in its own tree
 * exactly where it used to interpolate a template (studio-ui-guidelines.md §9.3, §9.4). Calling it
 * again with the same `formKey` updates the standing form rather than building a second one, which
 * is what keeps the caret in a field across the repaint a commit provokes.
 *
 * **Binding is the same ladder as everywhere else** (§6.6). A host that names somewhere a value can
 * come from — route params, the document's signals — gets a Value Source chip on every scalar
 * field, named by `ui/value-source.ts` and switched by `ui/dynamic-slot.ts`'s per-field, per-rung
 * memory, which is shared rather than reimplemented: only the DRAWING differs between a form row
 * and an inspector row. A host that names no source — the project settings forms — draws no chip
 * and edits fixed values.
 *
 * **A registered control is MOUNTED into a host, and that is the whole contract now.** It used to
 * be two: a function returning a lit template, and beside it a `mount` for the one built-in that
 * had become a Jx document. The other two followed (`surfaces/secret-field.json`,
 * `surfaces/reference-field.json`), and a contract with no producers is not a contract — so the
 * template half went with them, and with it the last `lit-html` import in the form engine. What a
 * control is handed is the empty `[part="control-host"]` this form's own document already draws for
 * its field, or the `[part="cell-control-host"]` a row cell draws; what it hands back is a standing
 * mount, updated rather than rebuilt on every repaint (specs/extensions.md §9.1).
 */

import {
  isBoolean,
  isJsonObject,
  isNonNullObject,
  isNumber,
  isRef,
  isString,
} from "@jxsuite/schema/guards";
import type { ReadonlyJsonObject } from "@jxsuite/schema/project-schemas";
import type { JsonObject, JsonValue, JxDocumentValue } from "@jxsuite/schema/types";
import { createSchemaFormSurface } from "../surfaces/schema-form";
import { openMenu } from "../surfaces/menu";
import type { MenuHandle } from "../surfaces/menu";
import { cloneValue } from "../tabs/doc-op-apply";
import {
  effectiveSlotMode,
  hasStashedSlotValue,
  slotModeSeed,
  stashSlotValue,
  switchSlotMode,
} from "./dynamic-slot";
import {
  VALUE_SOURCE_HINTS,
  VALUE_SOURCE_LABELS,
  configFieldSchema,
  slotCaps,
} from "./value-source";
import type { SlotMode } from "./value-source";
import type {
  SchemaFormCellView,
  SchemaFormFieldView,
  SchemaFormRowView,
  SchemaFormSurface,
} from "../surfaces/schema-form";
import type { SurfaceOption } from "./surface";

/** A (possibly nested) JSON Schema node, covering both object and property level keys. */
export interface JsonSchema {
  /** One JSON Schema type, or a union of them (`["object", "boolean"]`). */
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  enum?: unknown;
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  examples?: string[];
  name?: string;
  items?: JsonSchema;
  /**
   * A pointer to another schema. `#/content/<type>` is the one this engine acts on: it is how
   * site-architecture.md §6.1 declares a relationship between collections, and it is what the
   * schema-builder writes (`form-controls.ts`'s `onChangeRefTarget`).
   */
  $ref?: string;
}

/**
 * What a form commits: the properties that changed, each with its new value. `undefined` removes
 * the property — a cleared field is absent from the record, not stored as an empty string.
 */
export type SchemaFormPatch = Record<string, JsonValue | undefined>;

/** Host-provided context threaded to every control. */
export interface SchemaFormContext {
  /**
   * Resolve a `#/$context/…` pointer (or legacy sentinel) against the host's project config. A
   * config section is document data, so the answer is whatever the config holds there.
   */
  resolvePointer: (pointer: string, scope?: JsonObject) => JxDocumentValue | JsonValue | undefined;
  /** Route params available for `$ref` bindings (e.g. from the document path). */
  params?: string[] | undefined;
  /**
   * State keys a field may bind to. Together with {@link params} this is the whole answer to "where
   * could this value come from" — and naming none of them is how a host says the form edits fixed
   * values only, which is why the settings forms show no Value Source chip.
   */
  signals?: string[] | undefined;
  /** Unique prefix for the dynamic slot's per-field, per-rung value memory. */
  fieldKeyPrefix?: string | undefined;
  /**
   * Commit hook for the "secret" control: stores the VALUE in the platform's secret store (never
   * project.json) and returns the derived env-var NAME, which the control persists to the field
   * instead of the value.
   */
  commitSecret?: ((key: string, value: string) => string | Promise<string>) | undefined;
}

/** Arguments passed to a registered form control. */
export interface SchemaFormControlArgs {
  key: string;
  schema: JsonSchema;
  value: JsonValue | undefined;
  onChange: (next: JsonValue | undefined) => void;
  ctx: SchemaFormContext;
  /**
   * Ask the HOST to draw the form again, where it offered a way to.
   *
   * No built-in needs it any more, and that is the mount's doing rather than an omission: a control
   * that owns its host draws its own second frame, so the `reference` picker's read landing and its
   * Retry are its own business now. What it is still for is a commit that changes something OUTSIDE
   * this field — a value another row's choices are derived from — which only the host can redraw.
   */
  rerender?: (() => void) | undefined;
}

/**
 * A control that OWNS a host element.
 *
 * The registry's whole contract, and the one a Jx document can satisfy: a document clears the host
 * it is given and cannot be interpolated into a lit template (specs/studio-ui-guidelines.md §9.4),
 * so a control is handed the empty host this form already draws for it and keeps the mount for the
 * life of the field. `mount` is called ONCE per host; every later repaint of the form reaches the
 * control through {@link SchemaFormControlHandle.update} instead, which is what keeps the caret in a
 * name the reader is part-way through typing when the value beside it commits.
 */
export interface SchemaFormMountedControl {
  mount: (host: HTMLElement, args: SchemaFormControlArgs) => SchemaFormControlHandle;
}

/** A standing mounted control: brought up to date, and taken down with the form. */
export interface SchemaFormControlHandle {
  update: (args: SchemaFormControlArgs) => void;
  dispose: () => void;
}

/** Options for {@link mountSchemaForm}. */
export interface RenderFormOptions {
  onChange: (patch: SchemaFormPatch) => void;
  context?: SchemaFormContext | undefined;
  /**
   * Per-field overrides from `$studio.settings.entry.ui`: a registered control name, and/or an
   * `enum` source (choice list or `{ "$ref": "#/$context/<pointer>" }`) layered over the field
   * schema — fragments stay valid JSON Schema while descriptors add dynamic choices. `label` is the
   * words the row is titled with in place of the property's key.
   */
  ui?: Record<string, { control?: string; enum?: unknown; label?: string }> | undefined;
  rerender?: (() => void) | undefined;
  /**
   * Externally-produced diagnostics, keyed by property name — §16.1's inline tier, sourced.
   *
   * This is how a validator that runs over the WHOLE document reaches the one field it is about:
   * `jx-validate`'s `project.json` errors, Monaco's markers for the same file open in the code
   * view, and a host's own commit-time rejection.
   *
   * A host message wins over {@link validateFieldValue}'s intrinsic check, because the host knows
   * things the property schema alone does not — that this enum value names a connector that was
   * just deleted, say. An empty string means "no error", so a host can pass a lookup result
   * straight through.
   */
  errors?: Record<string, string> | undefined;
  /** How many times each field has been refused in a row; drives the row's repeat counter. */
  errorCounts?: Record<string, number> | undefined;
  /**
   * Report required-but-empty fields inline. Off by default, and that default is §16.5's rule
   * literally applied: a form the user has not touched yet has not committed anything, so painting
   * every required field red the moment it renders is telling them they got something wrong before
   * they did anything. Required-ness is already shown — the row carries the required mark. A host
   * that validates on submit turns this on for the render that follows the rejected submit.
   */
  showRequired?: boolean | undefined;
}

// ─── Control registry ────────────────────────────────────────────────────────

const controlRegistry = new Map<string, SchemaFormMountedControl>();

/**
 * Register (or replace) a named form control: a {@link SchemaFormMountedControl} that draws into the
 * host it is given.
 *
 * There is no lookup beside this. `getFormControl` existed to hand a TEMPLATE control to a lit
 * caller that would interpolate it, and every such caller is gone — `panels/frontmatter-fields.ts`
 * projects a row rather than borrowing a widget, and both frontmatter surfaces are documents. A
 * control needs a HOST, which only this engine has, so the dispatch below is the only reader.
 */
export function registerFormControl(name: string, control: SchemaFormMountedControl): void {
  controlRegistry.set(name, control);
}

// ─── References between collections ──────────────────────────────────────────

/** `#/content/<type>` — a property whose value is the id of an entry in another collection. */
const CONTENT_REF = /^#\/content\/([^/]+)$/;

/**
 * The collection a property references, or null when it references nothing.
 *
 * Exported because it is the ONE test for "is this field a relationship", and three surfaces have
 * to agree on it: this engine, the frontmatter renderer, and the grid's relationship cell. A fourth
 * reading of `$ref` is how the picker ends up existing three times with three behaviours.
 */
export function referenceTarget(schema: { $ref?: string } | undefined): string | null {
  // The schema is project JSON, so the declared `string` is checked rather than trusted.
  const ref = schema?.$ref;
  const match = isString(ref) ? CONTENT_REF.exec(ref) : null;
  return match ? match[1]! : null;
}

/**
 * Inert context used when a host renders a form without one.
 *
 * Exported because a host with genuinely nowhere to resolve from — the frontmatter renderer, whose
 * one registered control reads FILES — should name this rather than write a second empty closure.
 */
export const NULL_FORM_CONTEXT: SchemaFormContext = {
  resolvePointer: () => {
    // Nothing to resolve against without a host context
  },
};

// ─── Enum resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a schema enum definition to concrete choices. Plain arrays pass through; `$ref` objects
 * and sentinel strings resolve through the context's pointer resolver, applying object →
 * `Object.keys` and string[] → itself.
 *
 * @param {JsonValue | undefined} enumDef
 * @param {SchemaFormContext | undefined} ctx
 * @param {JsonObject} [scope] - Scope for `{@param}` substitution (the form value)
 * @returns {string[] | undefined}
 */
export function resolveFormEnum(
  enumDef: JsonValue | undefined,
  ctx?: SchemaFormContext,
  scope?: JsonObject,
): string[] | undefined {
  if (Array.isArray(enumDef)) {
    /* SAFETY: a form `enum` is a list of string choices — every select this engine draws is fed by
       a settings fragment or collection schema that declares `type: "string"` beside its enum, and
       each choice is only ever interpolated as text (an option label and value), which is what a
       stray number would be read as too. */
    return enumDef as string[];
  }
  let pointer: string | undefined;
  if (isJsonObject(enumDef)) {
    const ref = enumDef.$ref;
    if (isString(ref)) {
      pointer = ref;
    }
  } else if (isString(enumDef)) {
    // Legacy sentinel strings (e.g. "$contentTypes") resolve through the host's pointer resolver
    pointer = enumDef;
  }
  if (pointer === undefined || !ctx) {
    return undefined;
  }
  const resolved = ctx.resolvePointer(pointer, scope);
  if (Array.isArray(resolved)) {
    return resolved.map(String);
  }
  if (isJsonObject(resolved)) {
    return Object.keys(resolved);
  }
  return undefined;
}

// ─── Field helpers ───────────────────────────────────────────────────────────

/** Parse a numeric field value, returning NaN for blank input (so callers can treat it as unset). */
export function parseNumericField(raw: string, integer: boolean): number {
  if (raw.trim() === "") {
    return Number.NaN;
  }
  return integer ? Math.trunc(Number(raw)) : Number(raw);
}

/**
 * Whether a property is edited as a single value at all. The three that are not — a nested JSON
 * Schema, an object and an array — are edited as raw JSON or as a row per item, and a chip offering
 * to replace that editor with a signal pointer would be offering to delete the user's work.
 */
function isBindableField(ps: JsonSchema): boolean {
  return ps.format !== "json-schema" && ps.type !== "object" && ps.type !== "array";
}

/** Every pointer this form's host says a value may come from. */
function refSourcesFor(ctx: SchemaFormContext): SurfaceOption[] {
  return [
    ...(ctx.signals ?? []).map((name) => ({ label: name, value: `#/state/${name}` })),
    ...(ctx.params ?? []).map((name) => ({ label: `$params/${name}`, value: `#/$params/${name}` })),
  ];
}

/** The empty row's value in a select — an option list cannot offer "absent" as a value. */
const NONE = "__none__";

/** A value as a control reads it: a string, and never `"[object Object]"`. */
function asText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  return isNonNullObject(value) ? JSON.stringify(value, null, 2) : String(value);
}

// ─── Field validation (§16.1, inline tier) ───────────────────────────────────

/**
 * Why this value is not acceptable for this property schema, or `""` when it is.
 *
 * Deliberately narrow: the checks a _property_ schema can make on its own, at the moment the value
 * is committed. Anything cross-field, cross-document or extension-defined belongs to whoever ran
 * the real validator and arrives through {@link RenderFormOptions.errors} — a form control is not a
 * second implementation of JSON Schema, it is the place a verdict gets rendered.
 *
 * A `$ref` binding is never judged here. Its value is resolved at render time from state the form
 * cannot see, so type-checking the reference itself would refuse every correct binding.
 *
 * @param {JsonSchema} schema
 * @param {JsonValue | undefined} value
 * @param {boolean} isRequired
 * @returns {string}
 */
export function validateFieldValue(
  schema: JsonSchema,
  value: JsonValue | undefined,
  isRequired: boolean,
): string {
  if (isRef(value)) {
    return "";
  }
  const empty = value === undefined || value === null || value === "";
  if (empty) {
    return isRequired ? "Required." : "";
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `Choose one of: ${schema.enum.map(String).join(", ")}.`;
  }
  if (schema.type === "number" || schema.type === "integer") {
    const n = isNumber(value) ? value : Number(value);
    if (!Number.isFinite(n)) {
      return "Enter a number.";
    }
    if (schema.type === "integer" && !Number.isInteger(n)) {
      return "Enter a whole number.";
    }
    if (schema.minimum !== undefined && n < schema.minimum) {
      return `Must be ${schema.minimum} or more.`;
    }
    if (schema.maximum !== undefined && n > schema.maximum) {
      return `Must be ${schema.maximum} or less.`;
    }
    return "";
  }
  if (schema.type === "boolean" && !isBoolean(value)) {
    return "Must be true or false.";
  }
  if (schema.type === "array" && !Array.isArray(value)) {
    return "Must be a list.";
  }
  // `null` is "empty" and answered above, so only a primitive or an array can fail here.
  if (schema.type === "object" && !isJsonObject(value)) {
    return "Must be an object.";
  }
  return "";
}

// ─── What one property turned out to be ──────────────────────────────────────

/**
 * How this module reads a gesture back. The document reports `commit("port", "8080")` and nothing
 * else; everything needed to turn that into a patch was decided when the row was derived, so the
 * plan is where it is kept rather than re-derived from the schema on every keystroke.
 */
interface FieldPlan {
  prop: string;
  schema: JsonSchema;
  /** How a committed string becomes a document value. */
  commit: "text" | "ref" | "template" | "select" | "number" | "json" | "none";
  /** Commit a keystroke after this long; `0` means only on change. */
  debounceMs: number;
  /** Item-property schemas, for an array-of-objects field. */
  itemProps?: Record<string, JsonSchema> | undefined;
  /** The rows currently held, so a cell edit can rebuild the array. */
  rows?: JsonObject[] | undefined;
  /** The ladder, when this position offers one. */
  ladder?: { fieldKey: string; mode: SlotMode; offered: SlotMode[]; sources: SurfaceOption[] };
  /** A registered control owns the whole field; args are rebuilt for it on every repaint. */
  control?: SchemaFormMountedControl | undefined;
  /**
   * The member of the property's OBJECT this row edits, when the row is one part of an object
   * field: an image object's `alt` is a text row of its own, and its commit writes the whole object
   * back with that one member changed.
   */
  member?: string | undefined;
  /**
   * Registered controls owning one cell, keyed by the cell's host id.
   *
   * The same kind of entry a field's own control is, and reached by the same dispatch: a cell host
   * is a host like any other. The one control a cell is ever given is `reference` (see
   * {@link deriveCell}).
   */
  cellControls?: Map<
    string,
    { control: SchemaFormMountedControl; schema: JsonSchema; row: string; key: string }
  >;
  /**
   * Cells that currently hold a pointer, by cell id.
   *
   * A cell edits the pointer STRING it is showing, so what it commits has to go back as `{ $ref }`
   * — which the item property's declared type cannot say, because the property is typed as what the
   * pointer resolves to.
   */
  refCells?: Set<string>;
}

/** The debounce a JSON editor gets: long, because a half-typed object is not a refusal. */
const JSON_COMMIT_MS = 500;
/** The debounce a scalar gets, so the canvas follows a value being typed. */
const TEXT_COMMIT_MS = 400;

// ─── The controller ──────────────────────────────────────────────────────────

interface FormController {
  readonly host: HTMLElement;
  readonly update: (schema: JsonSchema, value: JsonObject, opts: RenderFormOptions) => void;
  readonly dispose: () => void;
}

/** Every standing form, by the key its caller named it with. */
const forms = new Map<string, FormController>();

/** Test hook: take every standing form down, so one test's mount never outlives it. */
export function resetSchemaForms(): void {
  for (const controller of forms.values()) {
    controller.dispose();
  }
  forms.clear();
}

/**
 * Mount (or update) a schema-driven form and hand back the element it lives in.
 *
 * @param {string} formKey Stable identity for this form — the same key updates the standing mount
 *   instead of building a second one, which is what keeps the caret in a field across a repaint.
 * @param {JsonSchema} schema
 * @param {JsonObject} value The record being edited
 * @param {RenderFormOptions} opts
 * @returns {HTMLElement} The form's own host, for a lit caller to place in its tree
 */
export function mountSchemaForm(
  formKey: string,
  schema: JsonSchema,
  value: JsonObject,
  opts: RenderFormOptions,
): HTMLElement {
  sweep(formKey);
  let controller = forms.get(formKey);
  if (!controller) {
    controller = createController();
    forms.set(formKey, controller);
  }
  controller.update(schema, value, opts);
  return controller.host;
}

/**
 * Drop forms whose host has been taken out of the page.
 *
 * A host is created here and inserted by its caller one lit render later, so "not connected" is the
 * normal state of the form being mounted right now — which is why the key being asked for is exempt
 * rather than the sweep being conditional on a count.
 */
function sweep(exceptKey: string): void {
  for (const [key, controller] of forms) {
    if (key !== exceptKey && !controller.host.isConnected) {
      controller.dispose();
      forms.delete(key);
    }
  }
}

function createController(): FormController {
  let schema: JsonSchema = {};
  let value: JsonObject = {};
  let opts: RenderFormOptions = { onChange: () => {} };
  let ctx: SchemaFormContext = NULL_FORM_CONTEXT;
  const plans = new Map<string, FieldPlan>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const controlHosts = new Map<string, HTMLElement>();
  /** Standing mounted controls, by host id, with the element each was mounted into. */
  const mountedControls = new Map<string, { host: HTMLElement; handle: SchemaFormControlHandle }>();
  /** The rung picker, while one is up. One at a time, and it goes down with the form. */
  let sourceMenu: MenuHandle | null = null;

  const later = (key: string, ms: number, run: () => void): void => {
    clearTimeout(timers.get(key));
    if (ms <= 0) {
      run();
      return;
    }
    timers.set(key, setTimeout(run, ms));
  };
  const now = (key: string, run: () => void): void => {
    clearTimeout(timers.get(key));
    timers.delete(key);
    run();
  };

  const patch = (prop: string, next: JsonValue | undefined): void => {
    opts.onChange({ [prop]: next });
  };

  /** Turn a committed string into the document value this plan says it is. */
  const write = (plan: FieldPlan, raw: string): void => {
    if (plan.commit === "none") {
      // The value is not a string this module writes: a control or a row editor owns it.
      return;
    }
    switch (plan.commit) {
      case "ref": {
        const trimmed = raw.trim();
        patch(plan.prop, trimmed ? { $ref: trimmed } : undefined);
        return;
      }
      case "template": {
        patch(plan.prop, raw);
        return;
      }
      case "select": {
        patch(plan.prop, raw === NONE ? undefined : raw);
        return;
      }
      case "number": {
        const parsed = parseNumericField(raw, plan.schema.type === "integer");
        patch(plan.prop, Number.isNaN(parsed) ? undefined : parsed);
        return;
      }
      case "json": {
        try {
          // SAFETY: `JSON.parse` with no reviver yields only JSON values, which is all a JsonValue is.
          patch(plan.prop, JSON.parse(raw) as JsonValue);
        } catch {
          /* A half-typed object is not a refusal: the last parsable text is what the document
             keeps, and the field goes on showing what is actually in it. */
        }
        return;
      }
      default: {
        if (plan.member !== undefined) {
          // One member of an object: the object goes back whole, with that member set or removed.
          const held = value[plan.prop];
          const base: JsonObject = isJsonObject(held) ? { ...held } : {};
          if (raw) {
            base[plan.member] = raw;
          } else {
            delete base[plan.member];
          }
          patch(plan.prop, Object.keys(base).length > 0 ? base : undefined);
          return;
        }
        patch(plan.prop, raw || undefined);
      }
    }
  };

  /** The field's items, each shallow-copied so a cell edit never writes through to the document. */
  const cellRows = (plan: FieldPlan): JsonObject[] => {
    const copies: JsonObject[] = [];
    for (const item of plan.rows ?? []) {
      copies.push({ ...item });
    }
    return copies;
  };

  const actions = {
    addRow: (field: string) => {
      const plan = plans.get(field);
      if (!plan?.itemProps) {
        return;
      }
      const seed: JsonObject = {};
      for (const [k, v] of Object.entries(plan.itemProps)) {
        if (v.default !== undefined) {
          /* SAFETY: an item schema is read from a JSON schema document, so the `default` it
             declares is a JSON value. */
          seed[k] = v.default as JsonValue;
        }
      }
      patch(field, [...cellRows(plan), seed]);
      opts.rerender?.();
    },
    commit: (key: string, raw: string) => {
      const plan = plans.get(key);
      if (plan) {
        now(key, () => write(plan, raw));
      }
    },
    commitChecked: (key: string, checked: boolean) => {
      const plan = plans.get(key);
      if (plan) {
        patch(plan.prop, checked);
      }
    },
    edit: (key: string, raw: string) => {
      const plan = plans.get(key);
      if (plan && plan.debounceMs > 0) {
        later(key, plan.debounceMs, () => write(plan, raw));
      }
    },
    editCell: (field: string, row: string, cell: string, raw: string) => {
      writeCell(field, row, cell, raw);
    },
    editCellChecked: (field: string, row: string, cell: string, checked: boolean) => {
      writeCell(field, row, cell, checked);
    },
    editJson: (key: string, raw: string) => {
      const plan = plans.get(key);
      if (plan) {
        later(key, JSON_COMMIT_MS, () => write(plan, raw));
      }
    },
    pickSource: (key: string, anchor: HTMLElement) => {
      openSourceMenu(key, anchor);
    },
    removeRow: (field: string, row: string) => {
      const plan = plans.get(field);
      if (!plan) {
        return;
      }
      const idx = Number(row);
      const kept = cellRows(plan).filter((_, i) => i !== idx);
      patch(field, kept.length > 0 ? kept : undefined);
      opts.rerender?.();
    },
  };

  function writeCell(field: string, row: string, cell: string, next: JsonValue | undefined): void {
    const plan = plans.get(field);
    if (!plan?.itemProps) {
      return;
    }
    const idx = Number(row);
    const rows = cellRows(plan);
    const target = rows[idx];
    if (!target) {
      return;
    }
    const cellSchema = plan.itemProps[cell];
    /* SAFETY: the one non-JSON member this row can gain is an `undefined` for a cleared cell, and
       every host's `onChange` persists the patch as JSON (the entry, the def and the project config
       are all serialized), where an undefined member is simply omitted. */
    rows[idx] = {
      ...target,
      [cell]: coerceCell(cellSchema, next, plan.refCells?.has(`${field}/${row}/${cell}`) ?? false),
    } as JsonObject;
    patch(field, rows);
  }

  /** A cell's committed string, as the item property's declared type. */
  function coerceCell(
    cellSchema: JsonSchema | undefined,
    next: JsonValue | undefined,
    isPointer: boolean,
  ): JsonValue | undefined {
    if (isBoolean(next)) {
      return next;
    }
    const raw = String(next);
    if (isPointer) {
      const trimmed = raw.trim();
      return trimmed ? { $ref: trimmed } : undefined;
    }
    if (cellSchema?.type === "integer" || cellSchema?.type === "number") {
      const parsed = parseNumericField(raw, cellSchema.type === "integer");
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    if (raw === NONE || raw === "") {
      return undefined;
    }
    return raw;
  }

  /** The rung picker: every source this position permits, one action away (§6.6). */
  function openSourceMenu(key: string, anchor: HTMLElement): void {
    const plan = plans.get(key);
    if (!plan?.ladder) {
      return;
    }
    const { fieldKey, mode, offered, sources } = plan.ladder;
    sourceMenu?.close();
    sourceMenu = openMenu({
      label: "Value source",
      onClosed: () => {
        sourceMenu = null;
      },
      opener: anchor,
      region: "value-source",
      rows: offered.map((rung) => ({
        checked: rung === mode ? ("true" as const) : ("false" as const),
        destructive: false,
        disabled: false,
        dividerAbove: false,
        id: rung,
        title: VALUE_SOURCE_LABELS[rung],
      })),
      run: (id) => {
        // The menu's rows are `offered`, so an id is always one of its rungs.
        const next = offered.find((rung) => rung === id);
        if (next === undefined || next === mode) {
          return;
        }
        /* Leaving From data… seeds an empty Fixed value stash with the property's declared default,
           so unbind-restores-default survives a detour through Mixed text. */
        // SAFETY: the field schema is read from JSON, so the `default` it declares is a JSON value.
        const literalDefault = plan.schema.default as JsonValue | undefined;
        if (
          mode === "ref" &&
          literalDefault !== undefined &&
          !hasStashedSlotValue(fieldKey, "literal")
        ) {
          stashSlotValue(fieldKey, "literal", literalDefault);
        }
        patch(
          plan.prop,
          switchSlotMode(
            fieldKey,
            mode,
            next,
            cloneValue(value[plan.prop]),
            slotModeSeed(next, { extraSignals: sources, literalDefault, stateDefs: [] }),
          ),
        );
      },
    });
  }

  /**
   * The control a host id names, and the arguments it is drawn from right now.
   *
   * One answer for both kinds of host, because a cell host is a host: a field's id is its property
   * and a cell's is its `field/row/property` triple, and what differs between them is only where
   * the value comes from and where a commit goes.
   */
  function controlFor(
    id: string,
  ): { control: SchemaFormMountedControl; args: SchemaFormControlArgs } | undefined {
    const plan = plans.get(id);
    if (plan?.control) {
      return {
        args: {
          ctx,
          key: plan.prop,
          onChange: (next) => patch(plan.prop, next),
          rerender: opts.rerender,
          schema: plan.schema,
          value: value[plan.prop],
        },
        control: plan.control,
      };
    }
    for (const owner of plans.values()) {
      const entry = owner.cellControls?.get(id);
      if (!entry) {
        continue;
      }
      const row = (owner.rows ?? [])[Number(entry.row)] ?? {};
      return {
        args: {
          ctx,
          key: entry.key,
          onChange: (next) => writeCell(owner.prop, entry.row, entry.key, next),
          rerender: opts.rerender,
          schema: entry.schema,
          value: row[entry.key],
        },
        control: entry.control,
      };
    }
    return undefined;
  }

  /**
   * Draw one registered control into the host the document announced for it.
   *
   * Connectedness is deliberately NOT consulted. A host is announced as it is CREATED, which is one
   * reconcile step before it is in the page — so "is it connected" answers no for exactly the node
   * that needs drawing, and a check there is how the control came out empty on first mount.
   */
  function paintControl(id: string, host: HTMLElement): void {
    const found = controlFor(id);
    if (!found) {
      return;
    }
    /* A control is built once per host and updated after that. The host element is what identifies
       it: the reconciler may replace the node, and a handle left pointing at the old one would go
       on updating a document nobody can see. */
    const standing = mountedControls.get(id);
    if (standing?.host === host) {
      standing.handle.update(found.args);
      return;
    }
    standing?.handle.dispose();
    mountedControls.set(id, { handle: found.control.mount(host, found.args), host });
  }

  /** Take down a mounted control whose field is no longer one — or is no longer here at all. */
  function sweepMountedControls(): void {
    for (const [id, standing] of mountedControls) {
      if (!controlFor(id)) {
        standing.handle.dispose();
        mountedControls.delete(id);
      }
    }
  }

  /** Redraw every control this form has been handed a host for. */
  function paintControls(): void {
    sweepMountedControls();
    for (const [id, host] of controlHosts) {
      paintControl(id, host);
    }
  }

  const surface: SchemaFormSurface = createSchemaFormSurface(
    { fields: [] },
    actions,
    (id, host) => {
      controlHosts.set(id, host);
      paintControl(id, host);
    },
  );

  return {
    dispose() {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      sourceMenu?.close();
      sourceMenu = null;
      for (const standing of mountedControls.values()) {
        standing.handle.dispose();
      }
      mountedControls.clear();
      controlHosts.clear();
      plans.clear();
      surface.dispose();
    },
    host: surface.host,
    update(nextSchema, nextValue, nextOpts) {
      schema = nextSchema;
      value = nextValue;
      opts = nextOpts;
      ctx = nextOpts.context ?? NULL_FORM_CONTEXT;
      plans.clear();
      surface.update({ fields: deriveFields(schema, value, opts, ctx, plans) });
      paintControls();
    },
  };
}

// ─── Derivation: one schema property becomes one already-decided row ─────────

/** Every row the document draws, and the plan that reads each one's gestures back. */
function deriveFields(
  schema: JsonSchema,
  value: JsonObject,
  opts: RenderFormOptions,
  ctx: SchemaFormContext,
  plans: Map<string, FieldPlan>,
): SchemaFormFieldView[] {
  const required = new Set(schema.required);
  const sources = refSourcesFor(ctx);
  return Object.entries(schema.properties ?? {}).flatMap(([prop, ps]) => {
    const args = { ctx, opts, plans, required: required.has(prop), sources, value };
    const field = deriveField(prop, ps, args);
    // An image object's alt text is a row of its own, under the picture it describes.
    return field.kind === "control" && isImageObjectSchema(ps) && ps.properties?.["alt"]
      ? [field, imageAltRow(prop, args)]
      : [field];
  });
}

/** The members an image object may have beside its `src`: what an `<img>` says about itself. */
const IMAGE_OBJECT_MEMBERS: ReadonlySet<string> = new Set([
  "src",
  "alt",
  "width",
  "height",
  "title",
]);

/**
 * Whether a property is an image OBJECT: `{ src, alt?, width?, height?, title? }`, the shape a site
 * imported from a CMS keeps a picture in (`featuredImage: { src, width, height, alt }`). Such a
 * field is a picture to pick, not a record to type JSON into.
 */
export function isImageObjectSchema(ps: JsonSchema): boolean {
  const properties = ps.properties ?? {};
  return (
    ps.type === "object" &&
    properties["src"]?.type === "string" &&
    Object.keys(properties).every((name) => IMAGE_OBJECT_MEMBERS.has(name))
  );
}

/** The media control over an image object's `src`, writing the object back around it. */
function imageObjectControl(media: SchemaFormMountedControl): SchemaFormMountedControl {
  /** The args the media control sees: the `src`, and a commit that rebuilds the object. */
  const srcArgs = (args: SchemaFormControlArgs): SchemaFormControlArgs => {
    const held = isJsonObject(args.value) ? args.value : {};
    const { src } = held;
    return {
      ...args,
      onChange: (next) => {
        if (next === src) {
          return;
        }
        /* A different picture: its alt text and title still describe what the author meant, but the
           old picture's width and height would be a lie about the new one, so they go. A cleared
           field clears the whole object: an image with no picture is no image. */
        const { height: _height, width: _width, ...kept } = held;
        let rebuilt: JsonValue | undefined;
        if (next !== undefined && next !== "") {
          rebuilt = { ...kept, src: next };
        }
        args.onChange(rebuilt);
      },
      value: isString(src) ? src : undefined,
    };
  };
  return {
    mount(host, args) {
      const handle = media.mount(host, srcArgs(args));
      return {
        dispose: () => handle.dispose(),
        update: (next) => handle.update(srcArgs(next)),
      };
    },
  };
}

/** The text row an image object's `alt` is edited in. */
function imageAltRow(prop: string, args: DeriveArgs): SchemaFormFieldView {
  const key = `${prop}/alt`;
  const held = args.value[prop];
  const alt = isJsonObject(held) ? held["alt"] : undefined;
  const row = deriveField(key, { type: "string" }, { ...args, required: false });
  const plan = args.plans.get(key);
  if (plan) {
    plan.prop = prop;
    plan.member = "alt";
  }
  return {
    ...row,
    label: `${args.opts.ui?.[prop]?.label ?? prop} alt text`,
    value: isString(alt) ? alt : "",
  };
}

interface DeriveArgs {
  ctx: SchemaFormContext;
  opts: RenderFormOptions;
  plans: Map<string, FieldPlan>;
  required: boolean;
  sources: SurfaceOption[];
  value: JsonObject;
}

function deriveField(prop: string, ps: JsonSchema, args: DeriveArgs): SchemaFormFieldView {
  const { ctx, opts, plans, required, sources, value } = args;
  const current = value[prop];
  const plan: FieldPlan = { commit: "text", debounceMs: TEXT_COMMIT_MS, prop, schema: ps };
  plans.set(prop, plan);

  // Host diagnostics win over the intrinsic check — see RenderFormOptions.errors.
  const error =
    opts.errors?.[prop] || validateFieldValue(ps, current, Boolean(opts.showRequired) && required);
  const count = opts.errorCounts?.[prop];

  /* A `ui.control` override owns its whole field — the secret control writes an env-var NAME rather
     than the value it was handed, so a rung switch above it would be editing a different thing than
     the one on screen. */
  const overrideName = opts.ui?.[prop]?.control;
  const override = overrideName ? controlRegistry.get(overrideName) : undefined;
  const laddered = sources.length > 0 && isBindableField(ps) && !overrideName;

  const row: SchemaFormFieldView = {
    addLabel: `Add ${prop}`,
    checked: false,
    chips: [],
    description: ps.description ?? "",
    error,
    errorCount: count !== undefined && count > 1 ? `×${count}` : "",
    hasChip: false,
    hasChips: false,
    hasCount: count !== undefined && count > 1,
    hasError: error !== "",
    hasOptions: false,
    invalid: error !== "",
    key: prop,
    kind: "text",
    label: opts.ui?.[prop]?.label ?? prop,
    max: "",
    min: "",
    mono: false,
    multiline: false,
    inputType: "text",
    options: [],
    placeholder: "",
    prop: ps.name || prop,
    required,
    rows: [],
    source: "fixed",
    sourceHint: "",
    sourceLabel: "",
    sourceLocked: false,
    sourceName: "",
    step: "",
    value: "",
  };

  if (laddered) {
    const fieldKey = `${ctx.fieldKeyPrefix ?? ""}.${prop}`;
    const mode = effectiveSlotMode(fieldKey, current);
    /* A From data… rung with nothing to point at is a dead end — but this engine only ladders a
       field once the host has named a source, so the rung always has something in it. */
    /* SAFETY: `JsonSchema` names only the keywords this engine acts on; the node itself is a schema
       read from JSON (a settings fragment, a collection or plugin schema), so it and every keyword
       it carries beyond the named ones are JSON, which is all the ladder's walk reads it as. */
    const offered = slotCaps({ schema: configFieldSchema(ps as ReadonlyJsonObject) });
    plan.ladder = { fieldKey, mode, offered, sources };
    row.hasChip = true;
    row.sourceLabel = VALUE_SOURCE_LABELS[mode];
    row.sourceHint = VALUE_SOURCE_HINTS[mode];
    row.source = mode === "literal" ? "fixed" : "bound";
    row.sourceLocked = !offered.some((m) => m !== mode);
    row.sourceName = row.sourceLocked
      ? `Value source: ${row.sourceLabel} (no other source available here)`
      : `Value source: ${row.sourceLabel} — click to change`;
    if (mode === "ref") {
      plan.commit = "ref";
      plan.debounceMs = 0;
      row.kind = "pointer";
      row.value = isRef(current) ? current.$ref : "";
      row.options = sources.map((s) => ({ label: s.label, value: s.value }));
      row.hasOptions = row.options.length > 0;
      return row;
    }
    if (mode === "template") {
      plan.commit = "template";
      plan.debounceMs = 0;
      row.kind = "template";
      row.value = String(current ?? "");
      return row;
    }
  }

  if (override) {
    plan.commit = "none";
    plan.control = override;
    row.kind = "control";
    return row;
  }

  /* A ref left in a form whose host named nowhere to bind: no ladder is drawn, so the pointer is
     edited as the string it is rather than rendered as "[object Object]" in a typed widget. */
  if (isRef(current) && isBindableField(ps)) {
    plan.commit = "ref";
    plan.debounceMs = 0;
    row.kind = "text";
    row.mono = true;
    row.value = current.$ref;
    row.placeholder = prop;
    return row;
  }

  /* A relationship to another collection (`$ref: "#/content/<type>"`) is the registered `reference`
     control, wherever the form is drawn — site-architecture.md §7.4's one entry picker is this
     dispatch plus the single `registerFormControl("reference", …)` in `ui/form-controls.ts`. It is
     deliberately NOT an enum: the choices are entry files on disk, so they are read asynchronously
     and can be stale, and a schema `enum` is a closed set the document itself declares. When the
     control is not registered (a bare-Bun import of this engine), the field falls through to the
     plain text control below. */
  if (referenceTarget(ps) !== null) {
    const reference = controlRegistry.get("reference");
    if (reference) {
      plan.commit = "none";
      plan.control = reference;
      row.kind = "control";
      return row;
    }
  }

  /* An image field (`format: "image"`) is the registered `media` control: the same field, Upload and
     Browse the page's Icon and OG Image rows draw (`surfaces/media-field.json`), so a collection
     entry's picture is picked from the project's media rather than typed as a path. Unregistered
     (a bare-Bun import of this engine), it falls through to the text control below. */
  if (ps.format === "image") {
    const media = controlRegistry.get("media");
    if (media) {
      plan.commit = "none";
      plan.control = media;
      row.kind = "control";
      return row;
    }
  }
  /* An image OBJECT (`{ src, alt, width, height }`) is the same media field over its `src`; its
     `alt` is a text row of its own (`deriveFields`). Unregistered, it falls through to JSON. */
  const imageMedia = isImageObjectSchema(ps) ? controlRegistry.get("media") : undefined;
  if (imageMedia) {
    plan.commit = "none";
    plan.control = imageObjectControl(imageMedia);
    row.kind = "control";
    return row;
  }

  /* SAFETY: both sources are read from JSON — the descriptor's `$studio.settings.entry.ui` and the
     field schema — so whichever `enum` is present is a JSON value. */
  const enumSource = (opts.ui?.[prop]?.enum ?? ps.enum) as JsonValue | undefined;
  const enumValues = resolveFormEnum(enumSource, ctx, value);
  if (enumValues) {
    plan.commit = "select";
    plan.debounceMs = 0;
    row.kind = "select";
    row.value =
      current !== undefined
        ? String(current)
        : ps.default !== undefined
          ? String(ps.default)
          : NONE;
    row.options = [
      ...(required ? [] : [{ label: "—", value: NONE }]),
      ...enumValues.map((v) => ({ label: v, value: v })),
    ];
    return row;
  }
  if (ps.type === "boolean") {
    plan.commit = "none";
    row.kind = "checkbox";
    row.checked = Boolean(current ?? ps.default ?? false);
    return row;
  }
  if (ps.type === "integer" || ps.type === "number") {
    plan.commit = "number";
    plan.debounceMs = 0;
    row.kind = "number";
    row.value = current !== undefined ? String(current) : "";
    row.placeholder = ps.default != null ? String(ps.default) : "";
    row.min = ps.minimum !== undefined ? String(ps.minimum) : "";
    row.max = ps.maximum !== undefined ? String(ps.maximum) : "";
    row.step = ps.type === "integer" ? "1" : "";
    return row;
  }
  if (ps.format === "json-schema") {
    plan.commit = "json";
    row.kind = "json";
    row.value = current !== undefined ? JSON.stringify(current, null, 2) : "";
    row.placeholder = ps.description ?? "JSON Schema defining the data shape…";
    row.chips = schemaPropertyChips(current);
    row.hasChips = row.chips.length > 0;
    return row;
  }
  if (ps.type === "array" && ps.items?.type === "object" && ps.items.properties) {
    return arrayOfObjects(prop, ps.items.properties, args, plan, row);
  }
  /* A union with an object or a list in it (`alerts` is an object of types or `false`) is JSON too:
     a text box would store what is typed as a string, which is none of the members. */
  const types = Array.isArray(ps.type) ? ps.type : [ps.type];
  if (types.includes("array") || types.includes("object")) {
    plan.commit = "json";
    row.kind = "json";
    row.value = current !== undefined ? JSON.stringify(current, null, 2) : "";
    row.placeholder = ps.default !== undefined ? JSON.stringify(ps.default) : "";
    return row;
  }

  row.kind = "text";
  row.value = asText(current);
  row.placeholder = ps.default !== undefined ? String(ps.default) : (ps.examples?.[0] ?? "");
  row.inputType = TEXT_INPUT_TYPES.get(ps.format ?? "") ?? "text";
  /* A date input shows nothing for a value it cannot read, so a timestamp is shown as its day. YAML
     reads an unquoted date as a Date, which reaches here as its quoted JSON. */
  const day = /^"?(\d{4}-\d{2}-\d{2})/.exec(row.value);
  if (row.inputType === "date" && day) {
    row.value = day[1] ?? row.value;
  }
  return row;
}

/**
 * The native input a string format is typed in. `date` is the one that changes what can be typed: a
 * date picker, and a value that is always `YYYY-MM-DD`, the `full-date` JSON Schema's `date` names.
 * `email` and `uri` only change the keyboard a phone shows, and the value stays the text typed.
 */
const TEXT_INPUT_TYPES: ReadonlyMap<string, string> = new Map([
  ["date", "date"],
  ["email", "email"],
  ["uri", "url"],
]);

/** The property chips above a JSON-Schema field: what shape is in there right now. */
function schemaPropertyChips(current: JsonValue | undefined): { key: string; label: string }[] {
  // An array names no `properties`, so it has no chips either.
  if (!isJsonObject(current)) {
    return [];
  }
  const { properties } = current;
  if (current.$ref || properties === null || !isNonNullObject(properties)) {
    return [];
  }
  return Object.entries(properties).map(([key, spec]) => ({
    key,
    label: `${key}: ${String((isJsonObject(spec) ? spec.type : undefined) ?? "any")}`,
  }));
}

/** An array whose items have a declared shape: one row per item, one cell per property. */
function arrayOfObjects(
  prop: string,
  itemProps: Record<string, JsonSchema>,
  args: DeriveArgs,
  plan: FieldPlan,
  row: SchemaFormFieldView,
): SchemaFormFieldView {
  const held = args.value[prop];
  /* SAFETY: the caller dispatches here only for a property whose schema declares
     `items.type: "object"`, so a conforming record holds an object per item; a malformed item is
     still drawn as the row it should be, as it always was, rather than silently dropped. */
  const rows = Array.isArray(held) ? (held as JsonObject[]) : [];
  plan.commit = "none";
  plan.itemProps = itemProps;
  plan.rows = rows;
  plan.cellControls = new Map();
  plan.refCells = new Set();
  row.kind = "rows";
  row.rows = rows.map((item, idx) => deriveRow(prop, String(idx), item, itemProps, args, plan));
  return row;
}

function deriveRow(
  prop: string,
  key: string,
  item: JsonObject,
  itemProps: Record<string, JsonSchema>,
  args: DeriveArgs,
  plan: FieldPlan,
): SchemaFormRowView {
  return {
    cells: Object.entries(itemProps).map(([cellKey, cellSchema]) =>
      deriveCell(prop, key, cellKey, cellSchema, item[cellKey], args, plan),
    ),
    field: prop,
    key,
    removeLabel: `Remove ${prop} ${Number(key) + 1}`,
  };
}

function deriveCell(
  prop: string,
  rowKey: string,
  cellKey: string,
  cellSchema: JsonSchema,
  held: JsonValue | undefined,
  args: DeriveArgs,
  plan: FieldPlan,
): SchemaFormCellView {
  const id = `${prop}/${rowKey}/${cellKey}`;
  const cell: SchemaFormCellView = {
    checked: false,
    field: prop,
    id,
    key: cellKey,
    kind: "text",
    label: cellKey,
    options: [],
    row: rowKey,
    value: "",
  };
  if (isRef(held)) {
    cell.value = held.$ref;
    plan.refCells?.add(id);
    return cell;
  }
  if (referenceTarget(cellSchema) !== null) {
    /* A CELL's control is mounted into a host of the cell's own, exactly as a field's is: the one
       control a cell is ever given is the reference picker, and that is a document now
       (`surfaces/reference-field.json`). What the cell host must never become is a second writer of
       a node the document already owns. */
    const reference = controlRegistry.get("reference");
    if (reference) {
      cell.kind = "control";
      plan.cellControls?.set(id, {
        control: reference,
        key: cellKey,
        row: rowKey,
        schema: cellSchema,
      });
      return cell;
    }
  }
  // SAFETY: an item property's schema is read from JSON, so its `enum` is a JSON value.
  const enumValues = resolveFormEnum(
    cellSchema.enum as JsonValue | undefined,
    args.ctx,
    args.value,
  );
  if (enumValues) {
    cell.kind = "select";
    cell.value = held !== undefined ? String(held) : NONE;
    cell.options = [
      { label: "—", value: NONE },
      ...enumValues.map((v: string): SurfaceOption => ({ label: v, value: v })),
    ];
    return cell;
  }
  if (cellSchema.type === "boolean") {
    cell.kind = "checkbox";
    cell.checked = Boolean(held);
    return cell;
  }
  if (cellSchema.type === "integer" || cellSchema.type === "number") {
    cell.kind = "number";
    cell.value = held !== undefined ? String(held) : "";
    return cell;
  }
  cell.value = asText(held);
  return cell;
}
