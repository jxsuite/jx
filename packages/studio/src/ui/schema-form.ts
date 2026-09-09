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
 * **The one thing still drawn in lit is a registered control.** The registry's contract
 * (specs/extensions.md §9.1) is a function returning a lit template, and an extension's control is
 * its own surface rather than part of this one — so the document draws an empty host for it and
 * this module renders into that host, which is the same seam a lit caller uses to embed the form.
 */

import { render as litRender } from "lit-html";
import { isRef } from "@jxsuite/schema/guards";
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
import { rectOf } from "../utils/geometry";
import type { TemplateResult } from "lit-html";
import type { SlotMode } from "./value-source";
import type { SignalOption } from "./dynamic-slot";
import type { JsonValue } from "../types";
import type {
  SchemaFormCellView,
  SchemaFormFieldView,
  SchemaFormOption,
  SchemaFormRowView,
  SchemaFormSurface,
} from "../surfaces/schema-form";

/** A (possibly nested) JSON Schema node, covering both object and property level keys. */
export interface JsonSchema {
  type?: string;
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

/** Host-provided context threaded to every control. */
export interface SchemaFormContext {
  /** Resolve a `#/$context/…` pointer (or legacy sentinel) against the host's project config. */
  resolvePointer: (pointer: string, scope?: Record<string, unknown>) => unknown;
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
  value: unknown;
  onChange: (next: unknown) => void;
  ctx: SchemaFormContext;
  rerender?: (() => void) | undefined;
}

export type SchemaFormControl = (args: SchemaFormControlArgs) => TemplateResult;

/** Options for {@link mountSchemaForm}. */
export interface RenderFormOptions {
  onChange: (patch: Record<string, unknown>) => void;
  context?: SchemaFormContext | undefined;
  /**
   * Per-field overrides from `$studio.settings.entry.ui`: a registered control name, and/or an
   * `enum` source (choice list or `{ "$ref": "#/$context/<pointer>" }`) layered over the field
   * schema — fragments stay valid JSON Schema while descriptors add dynamic choices.
   */
  ui?: Record<string, { control?: string; enum?: unknown }> | undefined;
  rerender?: (() => void) | undefined;
  /**
   * Externally-produced diagnostics, keyed by property name — §7.1's inline tier, sourced.
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
   * Report required-but-empty fields inline. Off by default, and that default is §7.1's rule
   * literally applied: a form the user has not touched yet has not committed anything, so painting
   * every required field red the moment it renders is telling them they got something wrong before
   * they did anything. Required-ness is already shown — the row carries the required mark. A host
   * that validates on submit turns this on for the render that follows the rejected submit.
   */
  showRequired?: boolean | undefined;
}

// ─── Control registry ────────────────────────────────────────────────────────

const controlRegistry = new Map<string, SchemaFormControl>();

/** Register (or replace) a named form control. */
export function registerFormControl(name: string, control: SchemaFormControl): void {
  controlRegistry.set(name, control);
}

/** Look up a registered form control by name. */
export function getFormControl(name: string): SchemaFormControl | undefined {
  return controlRegistry.get(name);
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
  const match = typeof schema?.$ref === "string" ? CONTENT_REF.exec(schema.$ref) : null;
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
 * @param {unknown} enumDef
 * @param {SchemaFormContext | undefined} ctx
 * @param {Record<string, unknown>} [scope] - Scope for `{@param}` substitution (the form value)
 * @returns {string[] | undefined}
 */
export function resolveFormEnum(
  enumDef: unknown,
  ctx?: SchemaFormContext,
  scope?: Record<string, unknown>,
): string[] | undefined {
  if (Array.isArray(enumDef)) {
    return enumDef as string[];
  }
  let pointer: string | undefined;
  if (enumDef && typeof enumDef === "object") {
    const ref = (enumDef as Record<string, unknown>).$ref;
    if (typeof ref === "string") {
      pointer = ref;
    }
  } else if (typeof enumDef === "string") {
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
  if (resolved && typeof resolved === "object") {
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
function refSourcesFor(ctx: SchemaFormContext): SignalOption[] {
  return [
    ...(ctx.signals ?? []).map((name) => ({ label: name, value: `#/state/${name}` })),
    ...(ctx.params ?? []).map((name) => ({ label: `$params/${name}`, value: `#/$params/${name}` })),
  ];
}

/** The empty row's value in a select — an option list cannot offer "absent" as a value. */
const NONE = "__none__";

/** A value as a control reads it: a string, and never `"[object Object]"`. */
function asText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

// ─── Field validation (§7.1, inline tier) ────────────────────────────────────

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
 * @param {unknown} value
 * @param {boolean} isRequired
 * @returns {string}
 */
export function validateFieldValue(
  schema: JsonSchema,
  value: unknown,
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
    const n = typeof value === "number" ? value : Number(value);
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
  if (schema.type === "boolean" && typeof value !== "boolean") {
    return "Must be true or false.";
  }
  if (schema.type === "array" && !Array.isArray(value)) {
    return "Must be a list.";
  }
  if (schema.type === "object" && (typeof value !== "object" || Array.isArray(value))) {
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
  rows?: Record<string, unknown>[] | undefined;
  /** The ladder, when this position offers one. */
  ladder?: { fieldKey: string; mode: SlotMode; offered: SlotMode[]; sources: SignalOption[] };
  /** A registered control owns the whole field; args are rebuilt for it on every repaint. */
  control?: SchemaFormControl | undefined;
  /** Registered controls owning one cell, keyed by the cell's host id. */
  cellControls?: Map<
    string,
    { control: SchemaFormControl; schema: JsonSchema; row: string; key: string }
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
  readonly update: (
    schema: JsonSchema,
    value: Record<string, unknown>,
    opts: RenderFormOptions,
  ) => void;
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
 * @param {Record<string, unknown>} value The record being edited
 * @param {RenderFormOptions} opts
 * @returns {HTMLElement} The form's own host, for a lit caller to place in its tree
 */
export function mountSchemaForm(
  formKey: string,
  schema: JsonSchema,
  value: Record<string, unknown>,
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
  let value: Record<string, unknown> = {};
  let opts: RenderFormOptions = { onChange: () => {} };
  let ctx: SchemaFormContext = NULL_FORM_CONTEXT;
  const plans = new Map<string, FieldPlan>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const controlHosts = new Map<string, HTMLElement>();
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

  const patch = (prop: string, next: unknown): void => {
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
          patch(plan.prop, JSON.parse(raw) as unknown);
        } catch {
          /* A half-typed object is not a refusal: the last parsable text is what the document
             keeps, and the field goes on showing what is actually in it. */
        }
        return;
      }
      default: {
        patch(plan.prop, raw || undefined);
      }
    }
  };

  /** The field's items, each shallow-copied so a cell edit never writes through to the document. */
  const cellRows = (plan: FieldPlan): Record<string, unknown>[] => {
    const copies: Record<string, unknown>[] = [];
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
      const seed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(plan.itemProps)) {
        if (v.default !== undefined) {
          seed[k] = v.default;
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

  function writeCell(field: string, row: string, cell: string, next: unknown): void {
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
    rows[idx] = {
      ...target,
      [cell]: coerceCell(cellSchema, next, plan.refCells?.has(`${field}/${row}/${cell}`) ?? false),
    };
    patch(field, rows);
  }

  /** A cell's committed string, as the item property's declared type. */
  function coerceCell(
    cellSchema: JsonSchema | undefined,
    next: unknown,
    isPointer: boolean,
  ): unknown {
    if (typeof next === "boolean") {
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

  /** The rung picker: every source this position permits, one action away (§6.3). */
  function openSourceMenu(key: string, anchor: HTMLElement): void {
    const plan = plans.get(key);
    if (!plan?.ladder) {
      return;
    }
    const { fieldKey, mode, offered, sources } = plan.ladder;
    const box = rectOf(anchor);
    sourceMenu?.close();
    sourceMenu = openMenu({
      label: "Value source",
      onClosed: () => {
        sourceMenu = null;
      },
      opener: anchor,
      origin: { x: box.left, y: box.bottom },
      region: "value-source",
      rows: offered.map((rung) => ({
        checked: (rung === mode ? "true" : "false") as "true" | "false",
        destructive: false,
        disabled: false,
        dividerAbove: false,
        id: rung,
        title: VALUE_SOURCE_LABELS[rung],
      })),
      run: (id) => {
        const next = id as SlotMode;
        if (next === mode) {
          return;
        }
        /* Leaving From data… seeds an empty Fixed value stash with the property's declared default,
           so unbind-restores-default survives a detour through Mixed text. */
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
            cloneValue(value[plan.prop] as JsonValue | undefined),
            slotModeSeed(next, { extraSignals: sources, literalDefault, stateDefs: [] }),
          ),
        );
      },
    });
  }

  /**
   * Draw one registered control into the host the document announced for it.
   *
   * Connectedness is deliberately NOT consulted. A host is announced as it is CREATED, which is one
   * reconcile step before it is in the page — so "is it connected" answers no for exactly the node
   * that needs drawing, and a check there is how the control came out empty on first mount.
   */
  function paintControl(id: string, host: HTMLElement): void {
    const plan = plans.get(id);
    if (plan?.control) {
      litRender(
        plan.control({
          ctx,
          key: plan.prop,
          onChange: (next) => patch(plan.prop, next),
          rerender: opts.rerender,
          schema: plan.schema,
          value: value[plan.prop],
        }),
        host,
      );
      return;
    }
    const cell = cellControlFor(id);
    if (cell) {
      litRender(cell, host);
    }
  }

  /** Redraw every control this form has been handed a host for. */
  function paintControls(): void {
    for (const [id, host] of controlHosts) {
      paintControl(id, host);
    }
  }

  /** The template for a cell-level registered control, or undefined when the id names none. */
  function cellControlFor(id: string): TemplateResult | undefined {
    for (const plan of plans.values()) {
      const entry = plan.cellControls?.get(id);
      if (!entry) {
        continue;
      }
      const rows = plan.rows ?? [];
      const row = rows[Number(entry.row)] ?? {};
      return entry.control({
        ctx,
        key: entry.key,
        onChange: (next) => writeCell(plan.prop, entry.row, entry.key, next),
        rerender: opts.rerender,
        schema: entry.schema,
        value: row[entry.key],
      });
    }
    return undefined;
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
  value: Record<string, unknown>,
  opts: RenderFormOptions,
  ctx: SchemaFormContext,
  plans: Map<string, FieldPlan>,
): SchemaFormFieldView[] {
  const required = new Set(schema.required);
  const sources = refSourcesFor(ctx);
  return Object.entries(schema.properties ?? {}).map(([prop, ps]) =>
    deriveField(prop, ps, {
      ctx,
      opts,
      plans,
      required: required.has(prop),
      sources,
      value,
    }),
  );
}

interface DeriveArgs {
  ctx: SchemaFormContext;
  opts: RenderFormOptions;
  plans: Map<string, FieldPlan>;
  required: boolean;
  sources: SignalOption[];
  value: Record<string, unknown>;
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
    label: prop,
    max: "",
    min: "",
    mono: false,
    multiline: false,
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
    const offered = slotCaps({ schema: configFieldSchema(ps) });
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
     control, wherever the form is drawn — §9.2's "one picker" is this dispatch plus the single
     `registerFormControl("reference", …)` in `ui/form-controls.ts`. It is deliberately NOT an enum:
     the choices are entry files on disk, so they are read asynchronously and can be stale, and a
     schema `enum` is a closed set the document itself declares. When the control is not registered
     (a bare-Bun import of this engine), the field falls through to the plain text control below. */
  if (referenceTarget(ps) !== null) {
    const reference = controlRegistry.get("reference");
    if (reference) {
      plan.commit = "none";
      plan.control = reference;
      row.kind = "control";
      return row;
    }
  }

  const enumValues = resolveFormEnum(opts.ui?.[prop]?.enum ?? ps.enum, ctx, value);
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
    row.chips = shapeChips(current);
    row.hasChips = row.chips.length > 0;
    return row;
  }
  if (ps.type === "array" && ps.items?.type === "object" && ps.items.properties) {
    return arrayOfObjects(prop, ps.items.properties, args, plan, row);
  }
  if (ps.type === "array" || ps.type === "object") {
    plan.commit = "json";
    row.kind = "json";
    row.value = current !== undefined ? JSON.stringify(current, null, 2) : "";
    row.placeholder = ps.default !== undefined ? JSON.stringify(ps.default) : "";
    return row;
  }

  row.kind = "text";
  row.value = asText(current);
  row.placeholder = ps.default !== undefined ? String(ps.default) : (ps.examples?.[0] ?? "");
  return row;
}

/** The property chips above a JSON-Schema field: what shape is in there right now. */
function shapeChips(current: unknown): { key: string; label: string }[] {
  if (!current || typeof current !== "object") {
    return [];
  }
  const held = current as Record<string, unknown>;
  if (held.$ref || typeof held.properties !== "object" || held.properties === null) {
    return [];
  }
  return Object.entries(held.properties as Record<string, Record<string, unknown>>).map(
    ([key, spec]) => ({ key, label: `${key}: ${String(spec.type ?? "any")}` }),
  );
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
  const rows = Array.isArray(held) ? (held as Record<string, unknown>[]) : [];
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
  item: Record<string, unknown>,
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
  held: unknown,
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
  const enumValues = resolveFormEnum(cellSchema.enum, args.ctx, args.value);
  if (enumValues) {
    cell.kind = "select";
    cell.value = held !== undefined ? String(held) : NONE;
    cell.options = [
      { label: "—", value: NONE },
      ...enumValues.map((v: string): SchemaFormOption => ({ label: v, value: v })),
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
