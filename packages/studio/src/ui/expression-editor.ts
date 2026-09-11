/// <reference lib="dom" />
/**
 * The expression editor — one operator row plus an operand editor per slot, nested to any depth.
 *
 * **This is the flow; `surfaces/expression-editor.json` is the surface.** This module decides what
 * an operator needs, which rung of the value ladder an operand occupies, what a literal's type is,
 * which refs a position may bind, what the live preview says at each node, and what every gesture
 * commits. It draws nothing: {@link flattenExpression} walks the tree once and hands the document a
 * FLAT list of rows that already carry their own indent, and {@link mountExpressionEditor} is the
 * seam between the two.
 *
 * **There is no Monaco here, and never was.** The editor that hosts Monaco is the Logic dock's code
 * surface (`panels/formula-workspace.ts`); this one is a form, and every part of it — the chip
 * strip, the operator picker, the operand ladder, the positional args, the `switch` cases, the live
 * badges — is markup a document can own. So nothing in this conversion is an island, and the four
 * hosts that used to `litRender` into an empty node now mount a document into it instead.
 *
 * **Recursion is a property of the WALK.** An operand may be another expression, an aggregate's
 * per-item body is one, and either may hold more of both — while a document's one repeater is
 * `$prototype: "Array"` over a list. So the walk emits rows in reading order and each says how far
 * in it sits, exactly as `panels/statement-editor.ts` does for the statement tree. A row's key is
 * its node's own path plus the slot it fills, which is unique by construction: two rows of one
 * expression cannot occupy one position in it.
 *
 * **A layout that could not shrink is what sent this editor to a stylesheet, and then to a
 * document.** Every row here used to be an inline `display:flex;…` attribute with a hard
 * `min-width` on the pickers, and no rung of that chain could set `min-width: 0` — so at Inspector
 * width the operand controls refused to shrink and Operator, Target and Value were clipped by the
 * edge of the window. The editor is drawn in the Inspector (~280px), in the Navigator, and in the
 * Bottom dock's Logic tab (very wide), so every row wraps to a stack rather than sizing itself in
 * pixels. The document's `style` block owns that now, and it emits no class at all.
 *
 * @docs studio/logic/formulas
 */
import { PURE_METHOD_OPS } from "@jxsuite/runtime/expression";
import { isJsonObject, isRef } from "@jxsuite/schema/guards";
import { formulaChipStrip } from "./formula-chips";
import { applyCatalogPick, calleeEntry, formulaCatalog } from "./formula-catalog";
import { openFormulaPalette } from "../surfaces/formula-palette";
import { VALUE_SOURCE_LABELS } from "./value-source";
import {
  disposeDetachedExpressionEditors,
  renderExpressionEditorSurface,
} from "../surfaces/expression-editor";

import type {
  ExprOption,
  ExprRowView,
  ExprSelectGroup,
  ExpressionActions,
} from "../surfaces/expression-editor";
import type {
  JxExpressionNode,
  JxExpressionOperand,
  JxStateDefinition,
} from "@jxsuite/schema/types";

// ─── Operator Categories ────────────────────────────────────────────────────

const UNARY_OPS = new Set(["!", "-"]);
const BINARY_OPS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "===",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
  "&&",
  "||",
  "??",
]);
const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/="]);

/**
 * Does this expression node DO something rather than compute something?
 *
 * An assignment writes a target and yields nothing worth reading; a `+` or a `filter` yields a
 * value. The Data panel needs the distinction to know whether a row has a value column at all —
 * labelling `setBeds0` "pending" reads as "still loading" for a thing that will never load.
 */
export function isActionExpression(node: unknown): boolean {
  const op = (node as { operator?: unknown } | null | undefined)?.operator;
  return typeof op === "string" && ASSIGN_OPS.has(op);
}
const NO_ARG_OPS = new Set(["pop", "shift"]);
const ONE_ARG_OPS = new Set(["push", "unshift"]);

const ZERO_ARG_METHOD_OPS = new Set([
  "flat",
  "normalize",
  "toLocaleLowerCase",
  "toLocaleString",
  "toLocaleUpperCase",
  "toLowerCase",
  "toReversed",
  "toSorted",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
]);

const OPERATOR_GROUPS = [
  { label: "Assignment", ops: ["=", "+=", "-=", "*=", "/="] },
  { label: "Unary", ops: ["!", "-"] },
  { label: "Arithmetic", ops: ["+", "-", "*", "/", "%"] },
  { label: "Comparison", ops: ["===", "!==", "<", "<=", ">", ">="] },
  { label: "Logical", ops: ["&&", "||", "??"] },
  { label: "Conditional", ops: ["?:", "switch"] },
  {
    label: "Array methods",
    ops: ["push", "pop", "shift", "unshift", "splice"],
  },
  {
    label: "Pure methods (String)",
    ops: [
      "toUpperCase",
      "toLowerCase",
      "trim",
      "trimStart",
      "trimEnd",
      "split",
      "startsWith",
      "endsWith",
      "padStart",
      "padEnd",
      "replaceAll",
      "repeat",
      "charAt",
      "normalize",
    ],
  },
  {
    label: "Pure methods (Array)",
    ops: [
      "includes",
      "indexOf",
      "lastIndexOf",
      "join",
      "slice",
      "concat",
      "at",
      "flat",
      "toSorted",
      "toReversed",
      "toSpliced",
      "with",
    ],
  },
  { label: "Pure methods (Number)", ops: ["toFixed", "toPrecision", "toLocaleString"] },
  { label: "Aggregate", ops: ["reduce", "map", "filter"] },
  { label: "Function", ops: ["call"] },
];

/**
 * The operator picker's rows, in the kit's own `optgroup` shape.
 *
 * Built once: the list is closed, and a delimited run is what the kit draws for it — the label
 * names the group in the accessibility tree and the legend inside it is what a reader sees, which
 * is the pair `<sp-menu-divider>` plus a header span was standing in for.
 */
const OPERATOR_SELECT_GROUPS: ExprSelectGroup[] = OPERATOR_GROUPS.map((group) => ({
  id: group.label,
  label: group.label,
  rows: group.ops.map((op) => ({ label: op, value: op })),
}));

/**
 * The same rows, narrowed to the operators a position's grammar admits, with empty groups dropped.
 *
 * The full table is what it filters, rather than a second list written out per position: an
 * operator that gains a group, or moves between two, keeps its label and its neighbours here
 * without anybody remembering to say so twice.
 */
function restrictGroups(operators: readonly string[]): ExprSelectGroup[] {
  const allowed = new Set(operators);
  return OPERATOR_SELECT_GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => allowed.has(row.value)),
  })).filter((group) => group.rows.length > 0);
}

/** The three rungs of the value ladder, spelled the way `ui/value-source.ts` spells them (§6.3). */
const SOURCE_OPTIONS: ExprOption[] = [
  { label: VALUE_SOURCE_LABELS.literal, value: "literal" },
  { label: VALUE_SOURCE_LABELS.ref, value: "ref" },
  { label: VALUE_SOURCE_LABELS.expression, value: "expression" },
];

/** What a literal may be. Abbreviated because the picker sits beside the value it types. */
const TYPE_OPTIONS: ExprOption[] = [
  { label: "str", value: "string" },
  { label: "num", value: "number" },
  { label: "bool", value: "boolean" },
  { label: "null", value: "null" },
];

/**
 * Which control types a literal of each type.
 *
 * A map rather than a chain of ternaries because the two vocabularies are genuinely different: the
 * type is what the value IS, and the control is what edits it — `null` is a type with no control at
 * all, drawn as an inert word.
 */
const LITERAL_CONTROLS: Record<string, string> = {
  boolean: "bool",
  null: "null",
  number: "number",
  string: "text",
};

/** Where an event handler's operand may bind besides the document's own signals. */
const EVENT_REFS = ["event#/detail", "event#/target/value"];

/** What a slot with nothing to bind to says, in the shell's one empty-state voice. */
const NO_BINDINGS_MESSAGE = "A binding points at a value this page holds.";
const NO_BINDINGS_DETAIL = "Add one in the State panel and it shows up here.";

interface OperatorInfo {
  needsValue: boolean;
  needsInitial: boolean;
  targetMustBeRef: boolean;
  spliceArray: boolean;
  valueIsNode: boolean;
  switchCases: boolean;
  /** `call`: value is a positional-args array; target is the callee pointer. */
  callArgs: boolean;
}

const INFO_DEFAULTS: OperatorInfo = {
  callArgs: false,
  needsInitial: false,
  needsValue: false,
  spliceArray: false,
  switchCases: false,
  targetMustBeRef: false,
  valueIsNode: false,
};

/**
 * @param {string} op
 * @returns {OperatorInfo}
 */
function operatorInfo(op: string): OperatorInfo {
  if (UNARY_OPS.has(op)) {
    return { ...INFO_DEFAULTS };
  }
  if (op === "?:") {
    return { ...INFO_DEFAULTS, needsInitial: true, needsValue: true };
  }
  if (op === "switch") {
    return { ...INFO_DEFAULTS, switchCases: true };
  }
  if (op === "call") {
    return { ...INFO_DEFAULTS, callArgs: true, targetMustBeRef: true };
  }
  if (PURE_METHOD_OPS.has(op)) {
    // Receiver in target (any operand); zero-arg methods render no value row.
    return { ...INFO_DEFAULTS, needsValue: !ZERO_ARG_METHOD_OPS.has(op) };
  }
  if (BINARY_OPS.has(op)) {
    return { ...INFO_DEFAULTS, needsValue: true };
  }
  if (ASSIGN_OPS.has(op)) {
    return { ...INFO_DEFAULTS, needsValue: true, targetMustBeRef: true };
  }
  if (NO_ARG_OPS.has(op)) {
    return { ...INFO_DEFAULTS, targetMustBeRef: true };
  }
  if (ONE_ARG_OPS.has(op)) {
    return { ...INFO_DEFAULTS, needsValue: true, targetMustBeRef: true };
  }
  if (op === "splice") {
    return { ...INFO_DEFAULTS, needsValue: true, spliceArray: true, targetMustBeRef: true };
  }
  if (op === "reduce") {
    return {
      ...INFO_DEFAULTS,
      needsInitial: true,
      needsValue: true,
      targetMustBeRef: true,
      valueIsNode: true,
    };
  }
  if (op === "map" || op === "filter") {
    return { ...INFO_DEFAULTS, needsValue: true, targetMustBeRef: true, valueIsNode: true };
  }
  return { ...INFO_DEFAULTS };
}

// ─── Operand Mode Detection ─────────────────────────────────────────────────

/**
 * Which rung of the value ladder an operand occupies. The three answers are the same three the
 * Properties, Style and Logic tabs give, and they are spelled the same way — `ui/value-source.ts`
 * owns the words, so `lit / $ref / expr` is gone from the operand picker (plan §6.3).
 *
 * @param {unknown} operand
 * @returns {"ref" | "expression" | "literal"}
 */
function operandMode(operand: unknown) {
  if (operand && typeof operand === "object") {
    if ("$ref" in operand) {
      return "ref";
    }
    if ("operator" in operand) {
      return "expression";
    }
  }
  return "literal";
}

/** Positional-arg labels for a `call` node, from the callee's catalog entry when resolvable. */
function calleeParamLabels(
  target: unknown,
  state?: Record<string, JxStateDefinition> | null,
): string[] {
  const ref = isRef(target) ? target.$ref : "";
  const entry = ref ? calleeEntry(ref, state) : undefined;
  return entry?.kind === "formula" ? entry.parameters.map((p) => p.name) : [];
}

/**
 * @param {string} mode
 * @returns {JxExpressionOperand}
 */
function defaultForMode(mode: string): JxExpressionOperand {
  if (mode === "ref") {
    return { $ref: "" };
  }
  if (mode === "expression") {
    return { operator: "!", target: null };
  }
  return null;
}

// ─── Literal Type Detection ─────────────────────────────────────────────────

/**
 * @param {unknown} val
 * @returns {"string" | "number" | "boolean" | "null"}
 */
function literalType(val: unknown) {
  if (val === null || val === undefined) {
    return "null";
  }
  if (typeof val === "boolean") {
    return "boolean";
  }
  if (typeof val === "number") {
    return "number";
  }
  return "string";
}

/**
 * @param {string} type
 * @returns {JxExpressionOperand}
 */
function defaultForLiteralType(type: string): JxExpressionOperand {
  if (type === "number") {
    return 0;
  }
  if (type === "boolean") {
    return false;
  }
  if (type === "null") {
    return null;
  }
  return "";
}

// ─── Hint (one-line summary for signal rows) ────────────────────────────────

/**
 * @param {unknown} node
 * @returns {string}
 */
export function expressionHint(node: unknown) {
  if (!isJsonObject(node) || typeof node.operator !== "string") {
    return "$expression";
  }
  const expr = node as unknown as JxExpressionNode;
  const op = expr.operator;
  const { target } = expr;
  const targetLabel = isRef(target)
    ? target.$ref.replace("#/state/", "")
    : isJsonObject(target) && typeof target.operator === "string"
      ? `(${target.operator}…)`
      : String(target ?? "?");

  if (ASSIGN_OPS.has(op) || ONE_ARG_OPS.has(op)) {
    return `${op} ${targetLabel}`;
  }
  if (NO_ARG_OPS.has(op)) {
    return `${op}(${targetLabel})`;
  }
  if (op === "splice") {
    return `splice(${targetLabel})`;
  }
  if (op === "call") {
    return `${targetLabel.replace("window#/", "").replaceAll("/", ".")}(…)`;
  }
  if (op === "reduce" || op === "map" || op === "filter" || PURE_METHOD_OPS.has(op)) {
    return `${op}(${targetLabel})`;
  }
  if (op === "?:") {
    return `${targetLabel} ? … : …`;
  }
  if (op === "switch") {
    return `switch(${targetLabel})`;
  }
  if (UNARY_OPS.has(op)) {
    return `${op}${targetLabel}`;
  }
  return `${targetLabel} ${op} …`;
}

// ─── What the editor is handed ──────────────────────────────────────────────

/** Preview data computed by services/preview-eval.ts — display strings keyed by node path. */
export interface EditorPreview {
  values: Map<string, string>;
  error: string | null;
  mutating: boolean;
}

export interface ExpressionEditorOpts {
  stateDefs: string[];
  allowEventRef: boolean;
  depth?: number;
  preview?: EditorPreview | null;
  path?: (string | number)[];
  /** Full state defs map — resolves named-formula catalog entries (call labels, palette). */
  stateEntries?: Record<string, JxStateDefinition> | null;
  /** Chip-strip click hook (depth 0). No-op when absent. */
  onChipSelect?: (path: (string | number)[]) => void;
  /** Vendors a packaged formula's state entry into the document on catalog pick. */
  onInsertDef?: (name: string, def: JxStateDefinition) => void;
  /**
   * The operators the POSITION's own grammar admits, when it admits fewer than all of them.
   *
   * Most positions take an `ExpressionEntry`, whose grammar is the whole operator table, and leave
   * this absent. An element's `tagName` does not: `defs/tag-expression.schema.ts` admits `?:` and
   * `switch` and nothing else, because every branch there must resolve to a literal tag the
   * pipeline can enumerate without evaluating. The panel used to seed that shape correctly and then
   * hand it to this editor unrestricted — so the next click could reoperate it to `capitalize`, or
   * pick `toUpperCase` out of the formula catalog, and write a document its own validator rejects.
   * A whole-document projection then read `cases` off a node that had none.
   *
   * **Depth 0 only.** The restriction is the position's, and a tag choice's `target` is an ordinary
   * `ExpressionOperand` — the discriminant may be any expression at all. Restricting the nested
   * walk too would have taken that away.
   */
  operators?: readonly string[];
}

/** Everything one gesture on one row may ask for. Each row registers only what it offers. */
interface RowPlan {
  setOperator?: (value: string) => void;
  browse?: (anchor: HTMLElement) => void;
  setSource?: (value: string) => void;
  setLiteralType?: (value: string) => void;
  setText?: (value: string) => void;
  setNumber?: (value: string) => void;
  setBool?: (checked: boolean) => void;
  setRef?: (value: string) => void;
  renameCase?: (value: string) => void;
  remove?: () => void;
  act?: () => void;
}

/**
 * The whole projection: what the document draws, and what each key in it commits.
 *
 * Exported for its own test — the projection IS the editor now, so what it contains and what a key
 * addresses are the contract rather than an implementation detail of a template.
 */
export interface ExpressionProjection {
  rows: ExprRowView[];
  plans: Map<string, RowPlan>;
  /** A chip's joined path back to the path it stands for. */
  chipPaths: Map<string, (string | number)[]>;
}

/** The walk's own state: the options it was given, plus what it has emitted so far. */
interface Walk {
  opts: ExpressionEditorOpts;
  preview: EditorPreview | null;
  rows: ExprRowView[];
  plans: Map<string, RowPlan>;
  chipPaths: Map<string, (string | number)[]>;
}

/**
 * A row under construction: every field optional, and an explicit `undefined` allowed.
 *
 * `Partial<ExprRowView>` cannot be it. `exactOptionalPropertyTypes` is on, so a spread of one is
 * typed `string | undefined` at a key the target declares as `string` — which is a real distinction
 * everywhere a key means "absent", and a false one here, where every default is supplied below.
 */
type RowPatch = { [K in keyof ExprRowView]?: ExprRowView[K] | undefined };

/**
 * A row with every field answered.
 *
 * The document asks no question an answer is missing for: a `$switch` on an absent field resolves
 * to no case at all, so a partial row is a row that silently draws nothing.
 */
function blankRow(row: RowPatch & { key: string; kind: ExprRowView["kind"] }) {
  return {
    badge: "",
    catalog: false,
    checked: false,
    chips: [],
    chooser: false,
    emptyDetail: "",
    emptyMessage: "",
    groups: [],
    hasBadge: false,
    indent: "0",
    label: "",
    lead: "none",
    leadLabel: "",
    leadValue: "",
    literal: "",
    literalType: "",
    nested: "false",
    prop: "",
    refGroups: [],
    refOptions: [],
    removable: false,
    source: "literal",
    sourceOptions: [],
    title: "",
    typeOptions: [],
    value: "",
    ...row,
  } as ExprRowView;
}

/** The indent one depth reads as. `.expression-editor--nested`'s 4px margin, said per row. */
function indentAt(depth: number): string {
  return `${depth * 4}px`;
}

/** The live value at a node path, and whether the preview holds one at all. */
function badgeAt(walk: Walk, key: string): { badge: string; hasBadge: boolean } {
  const text = walk.preview?.values.get(key);
  return { badge: text ?? "", hasBadge: text !== undefined };
}

// ─── The walk ───────────────────────────────────────────────────────────────

/** Everything one operand slot needs to know about itself before its rung is decided. */
interface OperandSlot {
  /** The row's own key, unique within the editor. */
  key: string;
  /** The row's visible label, and what `inspector/field:<prop>` addresses. */
  label: string;
  prop: string;
  depth: number;
  path: (string | number)[];
  /** The position admits a pointer and nothing else — an assignment target, a callee. */
  mustBeRef: boolean;
  /** The node path whose live value annotates this row. Empty asks for no badge. */
  badgeKey: string;
  lead?: ExprRowView["lead"];
  leadLabel?: string;
  leadValue?: string;
  removable?: boolean;
  title?: string;
  /** Renaming a `switch` case: the key IS the matched value. */
  renameCase?: (value: string) => void;
  remove?: () => void;
}

/**
 * Emit one operand row, and — when it holds an expression — the rows of that expression under it.
 *
 * @param walk The walk in progress.
 * @param operand What the slot currently holds.
 * @param commit What replacing it means.
 * @param slot Everything about the slot itself.
 */
function walkOperand(
  walk: Walk,
  operand: unknown,
  commit: (next: unknown) => void,
  slot: OperandSlot,
): void {
  const { allowEventRef, stateDefs } = walk.opts;
  const stateRefs = (stateDefs || []).map((k) => `#/state/${k}`);
  const refValue = ((operand as Record<string, unknown> | null)?.$ref as string) ?? "";
  const plan: RowPlan = {
    setRef: (value) => commit({ $ref: value }),
  };
  if (slot.renameCase) {
    plan.renameCase = slot.renameCase;
  }
  if (slot.remove) {
    plan.remove = slot.remove;
  }

  const base = {
    ...badgeAt(walk, slot.badgeKey),
    indent: indentAt(slot.depth),
    label: slot.label,
    lead: slot.lead ?? "none",
    leadLabel: slot.leadLabel ?? "",
    leadValue: slot.leadValue ?? "",
    nested: slot.depth > 0 ? "true" : "false",
    prop: slot.prop,
    refGroups: allowEventRef
      ? [{ id: "event", label: "Event", rows: EVENT_REFS.map((r) => ({ label: r, value: r })) }]
      : [],
    refOptions: stateRefs.map((r) => ({ label: r.replace("#/state/", ""), value: r })),
    removable: Boolean(slot.removable),
    title: slot.title ?? "",
    value: refValue,
  };

  /* Nothing to pick and nothing already picked: a picker whose only entry is a disabled "No state
     defined" is a dead end. Say what a binding IS instead, in the shell's one empty-state voice. */
  const nothingToBind = stateRefs.length === 0 && !allowEventRef && !refValue;

  if (slot.mustBeRef) {
    walk.plans.set(slot.key, plan);
    walk.rows.push(
      blankRow({
        ...base,
        emptyDetail: nothingToBind ? NO_BINDINGS_DETAIL : "",
        emptyMessage: nothingToBind ? NO_BINDINGS_MESSAGE : "",
        key: slot.key,
        kind: "operand",
        source: nothingToBind ? "empty" : "ref",
      }),
    );
    return;
  }

  const mode = operandMode(operand);
  plan.setSource = (value) => commit(defaultForMode(value));
  if (mode === "literal") {
    const type = literalType(operand);
    const asNumber = Number(operand ?? 0);
    plan.setLiteralType = (value) => commit(defaultForLiteralType(value));
    plan.setText = (value) => commit(value);
    plan.setNumber = (value) => commit(Number(value));
    plan.setBool = (checked) => commit(checked);
    walk.plans.set(slot.key, plan);
    walk.rows.push(
      blankRow({
        ...base,
        checked: Boolean(operand),
        chooser: true,
        key: slot.key,
        kind: "operand",
        literal: LITERAL_CONTROLS[type],
        literalType: type,
        source: "literal",
        sourceOptions: SOURCE_OPTIONS,
        typeOptions: TYPE_OPTIONS,
        value: type === "number" ? String(asNumber) : String(operand ?? ""),
      }),
    );
    return;
  }

  walk.plans.set(slot.key, plan);
  walk.rows.push(
    blankRow({
      ...base,
      chooser: true,
      emptyDetail: mode === "ref" && nothingToBind ? NO_BINDINGS_DETAIL : "",
      emptyMessage: mode === "ref" && nothingToBind ? NO_BINDINGS_MESSAGE : "",
      key: slot.key,
      kind: "operand",
      source: mode === "ref" && nothingToBind ? "empty" : mode,
      sourceOptions: SOURCE_OPTIONS,
    }),
  );
  if (mode === "expression") {
    walkExpression(walk, operand, commit, slot.depth + 1, slot.path);
  }
}

/** The rows of a positional-args list (`splice`, `call`), plus the row that grows it. */
function walkArgs(
  walk: Walk,
  args: unknown,
  commit: (next: unknown[]) => void,
  depth: number,
  path: (string | number)[],
  naming: { labels: string[]; fallbackLabel: string },
): void {
  /* `Array.isArray` narrows an `unknown` to `any[]`, so every spread of it reads as unsafe to
     the type-aware lint. The elements ARE unknown — each is an operand this walk discriminates
     — so saying so restores the check rather than silencing it. */
  const safeArgs: unknown[] = Array.isArray(args) ? args : [];
  for (const [idx, arg] of safeArgs.entries()) {
    const argPath = [...path, "value", idx];
    const label = naming.labels[idx] ?? naming.fallbackLabel;
    walkOperand(
      walk,
      arg,
      (next) => {
        const updated = [...safeArgs];
        updated[idx] = next;
        commit(updated);
      },
      {
        badgeKey: "",
        depth,
        key: argPath.join("/"),
        label,
        leadLabel: label,
        lead: "arg",
        mustBeRef: false,
        path: argPath,
        prop: "value",
        remove: () => {
          const updated = safeArgs.filter((_, i) => i !== idx);
          commit(updated.length > 0 ? updated : [null]);
        },
        removable: true,
        title: `Remove ${label}`,
      },
    );
  }
  const addKey = `${path.join("/")}::add-arg`;
  walk.plans.set(addKey, { act: () => commit([...safeArgs, null]) });
  walk.rows.push(
    blankRow({
      indent: indentAt(depth),
      key: addKey,
      kind: "action",
      label: "+ Add arg",
      nested: depth > 0 ? "true" : "false",
    }),
  );
}

/** The case rows of a `switch` node: matched value → result operand, the default, and `+ Add case`. */
function walkSwitchCases(
  walk: Walk,
  safeNode: Record<string, unknown>,
  onChange: (node: unknown) => void,
  depth: number,
  path: (string | number)[],
): void {
  const cases = isJsonObject(safeNode.cases)
    ? (safeNode.cases as Record<string, unknown>)
    : ({} as Record<string, unknown>);
  const entries = Object.entries(cases);
  const setCases = (next: Record<string, unknown>) => onChange({ ...safeNode, cases: next });

  for (const [caseKey, operand] of entries) {
    const casePath = [...path, "cases", caseKey];
    walkOperand(walk, operand, (v) => setCases({ ...cases, [caseKey]: v }), {
      badgeKey: casePath.join("/"),
      depth,
      key: casePath.join("/"),
      label: `Case ${caseKey}`,
      lead: "case",
      leadValue: caseKey,
      mustBeRef: false,
      path: casePath,
      prop: "cases",
      remove: () => {
        const next = { ...cases };
        delete next[caseKey];
        setCases(next);
      },
      removable: true,
      renameCase: (newKey) => {
        if (newKey === caseKey) {
          return;
        }
        const next: Record<string, unknown> = {};
        for (const [k, v] of entries) {
          next[k === caseKey ? newKey : k] = v;
        }
        setCases(next);
      },
      title: `Remove case ${caseKey}`,
    });
  }

  const defaultPath = [...path, "default"];
  walkOperand(walk, safeNode.default, (v) => onChange({ ...safeNode, default: v }), {
    badgeKey: defaultPath.join("/"),
    depth,
    key: defaultPath.join("/"),
    label: "Default",
    lead: "default",
    leadLabel: "default",
    mustBeRef: false,
    path: defaultPath,
    prop: "default",
  });

  const addKey = `${path.join("/")}::add-case`;
  walk.plans.set(addKey, {
    act: () => {
      let n = entries.length + 1;
      let key = `case ${n}`;
      while (Object.hasOwn(cases, key)) {
        n += 1;
        key = `case ${n}`;
      }
      setCases({ ...cases, [key]: null });
    },
  });
  walk.rows.push(
    blankRow({
      indent: indentAt(depth),
      key: addKey,
      kind: "action",
      label: "+ Add case",
      nested: depth > 0 ? "true" : "false",
    }),
  );
}

/** What replacing the operator means for the rest of the node. */
function reoperate(safeNode: Record<string, unknown>, newOp: string): Record<string, unknown> {
  const newInfo = operatorInfo(newOp);
  const updated: Record<string, unknown> = { operator: newOp, target: safeNode.target };
  if (newInfo.targetMustBeRef && operandMode(safeNode.target) !== "ref") {
    updated.target = { $ref: "" };
  }
  if (newInfo.needsValue) {
    if (newInfo.valueIsNode) {
      const val = safeNode.value as Record<string, unknown> | null;
      updated.value = val?.operator ? safeNode.value : { operator: "!", target: null };
    } else if (newInfo.spliceArray) {
      updated.value = Array.isArray(safeNode.value) ? safeNode.value : [null];
    } else {
      updated.value = safeNode.value ?? null;
    }
  }
  if (newInfo.needsInitial) {
    updated.initial = safeNode.initial ?? (newOp === "?:" ? null : 0);
  }
  if (newInfo.switchCases) {
    updated.cases = isJsonObject(safeNode.cases) ? safeNode.cases : {};
    if ("default" in safeNode) {
      updated.default = safeNode.default;
    }
  }
  if (newInfo.callArgs) {
    updated.value = Array.isArray(safeNode.value) ? safeNode.value : [];
  }
  return updated;
}

/** Emit every row one expression node reads as, deepest last. */
function walkExpression(
  walk: Walk,
  node: unknown,
  onChange: (node: unknown) => void,
  depth: number,
  path: (string | number)[],
): void {
  const safeNode: Record<string, unknown> =
    node && typeof node === "object"
      ? (node as Record<string, unknown>)
      : { operator: "=", target: null };
  const op = (safeNode.operator as string) || "=";
  const info = operatorInfo(op);
  const pathKey = path.join("/");
  const sub = (...segs: (string | number)[]) => [...path, ...segs].join("/");
  const { opts, preview } = walk;

  if (depth === 0) {
    const chips = formulaChipStrip(safeNode, { path, preview });
    if (chips.length > 0) {
      for (const chip of chips) {
        walk.chipPaths.set(chip.key, chip.path);
      }
      walk.rows.push(
        blankRow({
          chips: chips.map((chip) => ({
            badge: chip.badge,
            group: chip.group ? "true" : "false",
            hasBadge: chip.hasBadge,
            key: chip.key,
            label: chip.label,
          })),
          key: "::chips",
          kind: "chips",
        }),
      );
    }
    if (preview?.error) {
      walk.rows.push(blankRow({ key: "::error", kind: "error", label: preview.error }));
    }
  }

  // The root badge: pure roots show their result; mutating roots' effect shows on target/value.
  const rootBadge =
    depth === 0 && preview && !preview.mutating
      ? badgeAt(walk, pathKey)
      : { badge: "", hasBadge: false };

  /* The position's own grammar, and only at its own root — see `ExpressionEditorOpts.operators`.
     The catalog goes with it: every entry in it inserts a whole node, so a palette offered here
     would be a second door onto the operators the select has just stopped offering. */
  const grammar = depth === 0 ? opts.operators : undefined;
  const operatorKey = `${pathKey}::operator`;
  walk.plans.set(operatorKey, {
    ...(grammar
      ? {}
      : {
          browse: (anchor: HTMLElement) =>
            openFormulaPalette({
              anchor,
              entries: formulaCatalog(opts.stateEntries),
              onPick: (entry) =>
                applyCatalogPick(entry, onChange, {
                  onInsertDef: opts.onInsertDef,
                  stateEntries: opts.stateEntries,
                }),
            }),
        }),
    setOperator: (newOp) => onChange(reoperate(safeNode, newOp)),
  });
  walk.rows.push(
    blankRow({
      ...rootBadge,
      catalog: grammar === undefined,
      groups: grammar ? restrictGroups(grammar) : OPERATOR_SELECT_GROUPS,
      indent: indentAt(depth),
      key: operatorKey,
      kind: "operator",
      label: "Operator",
      nested: depth > 0 ? "true" : "false",
      prop: "operator",
      title: "Browse catalog",
      value: op,
    }),
  );

  walkOperand(walk, safeNode.target, (t) => onChange({ ...safeNode, target: t }), {
    badgeKey: sub("target"),
    depth,
    key: `${pathKey}::target`,
    label: op === "?:" ? "If" : op === "switch" ? "On" : op === "call" ? "Callee" : "Target",
    mustBeRef: info.targetMustBeRef,
    path: [...path, "target"],
    prop: "target",
  });

  if (info.needsValue && !info.valueIsNode && !info.spliceArray) {
    walkOperand(walk, safeNode.value, (v) => onChange({ ...safeNode, value: v }), {
      badgeKey: sub("value"),
      depth,
      key: `${pathKey}::value`,
      label: op === "?:" ? "Then" : "Value",
      mustBeRef: false,
      path: [...path, "value"],
      prop: "value",
    });
  }

  if (info.needsValue && info.valueIsNode) {
    walk.rows.push(
      blankRow({
        indent: indentAt(depth),
        key: `${pathKey}::per-item`,
        kind: "label",
        label: "Per-item",
        nested: depth > 0 ? "true" : "false",
        prop: "value",
      }),
    );
    walkExpression(
      walk,
      (safeNode.value as Record<string, unknown> | null)?.operator
        ? safeNode.value
        : { operator: "!", target: null },
      (v) => onChange({ ...safeNode, value: v }),
      depth + 1,
      [...path, "value"],
    );
  }

  if (info.spliceArray || info.callArgs) {
    walk.rows.push(
      blankRow({
        indent: indentAt(depth),
        key: `${pathKey}::args`,
        kind: "label",
        label: "Args",
        nested: depth > 0 ? "true" : "false",
        prop: "value",
      }),
    );
    walkArgs(
      walk,
      safeNode.value,
      (v) => onChange({ ...safeNode, value: v }),
      depth,
      path,
      info.callArgs
        ? {
            fallbackLabel: "arg",
            labels: calleeParamLabels(safeNode.target, opts.stateEntries),
          }
        : { fallbackLabel: "item", labels: ["start", "del", "item"] },
    );
  }

  if (info.switchCases) {
    walkSwitchCases(walk, safeNode, onChange, depth, path);
  }

  if (info.needsInitial) {
    walkOperand(walk, safeNode.initial, (v) => onChange({ ...safeNode, initial: v }), {
      badgeKey: sub("initial"),
      depth,
      key: `${pathKey}::initial`,
      label: op === "?:" ? "Else" : "Initial",
      mustBeRef: false,
      path: [...path, "initial"],
      prop: "initial",
    });
  }
}

/** Start a walk with nothing emitted yet. */
function newWalk(opts: ExpressionEditorOpts): Walk {
  return {
    chipPaths: new Map(),
    opts,
    plans: new Map(),
    preview: opts.preview ?? null,
    rows: [],
  };
}

/** The projection one expression reads as: the rows, and what each key commits. */
export function flattenExpression(
  node: unknown,
  onChange: (node: unknown) => void,
  opts: ExpressionEditorOpts,
): ExpressionProjection {
  const walk = newWalk(opts);
  walkExpression(walk, node, onChange, opts.depth ?? 0, opts.path ?? []);
  return { chipPaths: walk.chipPaths, plans: walk.plans, rows: walk.rows };
}

/**
 * The projection ONE operand slot reads as — a statement's `if` test, a `$switch` discriminant, a
 * `dispatchEvent` detail (spec §20). The same rows, with no operator row above them.
 */
export function flattenOperand(
  operand: unknown,
  onChange: (next: unknown) => void,
  opts: ExpressionEditorOpts & { label?: string; prop?: string },
): ExpressionProjection {
  const walk = newWalk(opts);
  const path = opts.path ?? [];
  walkOperand(walk, operand, onChange, {
    badgeKey: path.join("/"),
    depth: opts.depth ?? 0,
    key: `${path.join("/")}::operand`,
    label: opts.label ?? "Value",
    mustBeRef: false,
    path,
    prop: opts.prop ?? "operand",
  });
  return { chipPaths: walk.chipPaths, plans: walk.plans, rows: walk.rows };
}

// ─── The mount seam ─────────────────────────────────────────────────────────

/** What one standing editor is currently showing, and what its keys currently commit. */
interface Held {
  projection: ExpressionProjection;
  opts: ExpressionEditorOpts;
}

/**
 * The latest projection per host — the indirection that keeps a gesture honest.
 *
 * A mount reads its actions ONCE (`surfaces/expression-editor.ts` assigns rows on a repaint and
 * never rebuilds the scope, which is what keeps a reader's caret in a field). So an action that
 * closed over the projection it was built beside would go on committing the tree that projection
 * was walked from, and every edit after the first would be written against a stale node: the Logic
 * dock selects a sub-node, re-projects, and the operator picker then rewrites the node that used to
 * be selected. Closing over the HOST instead and reading this map at call time is what makes "which
 * node does this row address" a question answered when the row is used.
 */
const held = new Map<HTMLElement, Held>();

/** The actions for a host, resolved through whatever that host is showing right now. */
function actionsFor(host: HTMLElement): ExpressionActions {
  const plan = (key: string) => held.get(host)?.projection.plans.get(key);
  return {
    act: (key) => plan(key)?.act?.(),
    browse: (key, anchor) => plan(key)?.browse?.(anchor),
    pickChip: (key) => {
      const current = held.get(host);
      const path = current?.projection.chipPaths.get(key);
      if (path) {
        current?.opts.onChipSelect?.(path);
      }
    },
    remove: (key) => plan(key)?.remove?.(),
    renameCase: (key, value) => plan(key)?.renameCase?.(value),
    setBool: (key, checked) => plan(key)?.setBool?.(checked),
    setLiteralType: (key, value) => plan(key)?.setLiteralType?.(value),
    setNumber: (key, value) => plan(key)?.setNumber?.(value),
    setOperator: (key, value) => plan(key)?.setOperator?.(value),
    setRef: (key, value) => plan(key)?.setRef?.(value),
    setSource: (key, value) => plan(key)?.setSource?.(value),
    setText: (key, value) => plan(key)?.setText?.(value),
  };
}

/**
 * Hand a fresh projection to `host` — mounting the document the first time, assigning after that.
 *
 * A slot the reader unbound takes its host out of the page and nothing else in the chain hears
 * about it, because the panel around it simply renders something else. Sweeping here is the one
 * moment this module is guaranteed to run.
 */
function paint(host: HTMLElement, projection: ExpressionProjection, opts: ExpressionEditorOpts) {
  for (const other of held.keys()) {
    if (!other.isConnected) {
      held.delete(other);
    }
  }
  disposeDetachedExpressionEditors();
  held.set(host, { opts, projection });
  renderExpressionEditorSurface(host, projection.rows, actionsFor(host));
}

/**
 * Draw one expression editor into `host`, or bring the one already there up to date.
 *
 * This is the seam every caller uses. The document CLEARS its host, so the host must be one the
 * caller left empty — which is what all five of them already drew for the lit version.
 */
export function mountExpressionEditor(
  host: HTMLElement,
  node: unknown,
  onChange: (node: unknown) => void,
  opts: ExpressionEditorOpts,
): void {
  paint(host, flattenExpression(node, onChange, opts), opts);
}

/**
 * Draw ONE operand slot into `host` — statement position, where there is no operator to pick.
 *
 * @param opts The editor's options, plus what to call the slot in its own label.
 */
export function mountOperandEditor(
  host: HTMLElement,
  operand: unknown,
  onChange: (next: unknown) => void,
  opts: ExpressionEditorOpts & { label?: string; prop?: string },
): void {
  paint(host, flattenOperand(operand, onChange, opts), opts);
}
