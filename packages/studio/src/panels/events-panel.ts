/// <reference lib="dom" />
/**
 * The Logic tab — everything about how this element BEHAVES. The FLOW behind the `logic-panel`
 * surface.
 *
 * Plan §6.5 re-split the inspector by task rather than by data type, and this is the tab that
 * gained by it. Wiring a `$switch`, wiring a repeater to a collection and wiring a click handler
 * are one job; they were three, split across two tabs, because a `$switch` is stored as a property
 * and a click handler is stored as a property-shaped function, and the old split followed the
 * storage. So Logic is now:
 *
 * - **Repeating list** — the `$prototype: "Array"` node's items / filter / sort, and its template.
 * - **Condition** — the `$switch` expression and its cases.
 * - **Events** — declared events, bindings, inline bodies, expressions.
 * - **Observed Attributes · CSS Properties · CSS Parts** — a custom element's outward contract.
 *
 * **The markup left.** It is `surfaces/logic-panel.json`, mounted by `surfaces/logic-panel.ts`, and
 * what is here is the part that was never markup: what the selection is, which rungs a position
 * permits, what a handler holds, which elements of a multi-selection disagree about a key, and what
 * a gesture writes.
 *
 * **This tab does not go through the Inspector's scheduler.** `panels/panel-scheduler.ts` defers a
 * repaint while focus is inside the dock, because a lit re-render would take the node a reader is
 * typing into. A document does not have that problem — one runtime effect per bound property, and
 * an equal write is skipped — so the tab watches the facts it draws and re-projects, and
 * `right-panel.ts` leaves its container alone exactly as it leaves the assistant's.
 *
 * Three things the conversion settled, and each was a defect rather than a translation:
 *
 * - **A binding had two controls that did the same thing.** The provenance chip cleared the key and
 *   the trash button beside it cleared the same key. §12.5 calls a second list of actions a defect;
 *   there is one control now, and it carries the dot that says whether the selection agrees.
 * - **The sections would not stay shut.** Repeating list, Condition and Events were rendered with a
 *   hard-coded `open`, so collapsing one lasted until the next repaint. They persist through
 *   `inspectorSections` like every other section in the dock.
 * - **The event NAME is free-form without being a bespoke combobox.** It was a `jx-value-selector` —
 *   a LitElement over Spectrum, dual-mode, with its own popover — for a field that needs a short
 *   list of suggestions and the ability to refuse none of them. It is the kit's menu plus the one
 *   prompt dialog Studio already has.
 *
 * @docs studio/logic/events
 */

import { getNodeAtPath, renderOnly } from "../store";
import { activeTab } from "../workspace/workspace";
import { primarySelection, unifyValues } from "../tabs/selection";
import {
  mutateAddDef,
  mutateAddSwitchCase,
  mutateRemoveSwitchCase,
  mutateRenameSwitchCase,
  mutateUpdateProperty,
  transactDoc,
} from "../tabs/transact";
import { clickAnythingTo, openPageAction, staleSelectionMessage } from "./empty-state";
import { mountExpressionEditor } from "../ui/expression-editor";
import { mountStatementEditor } from "./statement-editor";
import { inspectorStatementsRegion } from "../ui/regions";
import { livePreviewExpression } from "../services/live-preview";
import {
  effectiveSlotMode,
  hasStashedSlotValue,
  slotModeSeed,
  stashSlotValue,
  switchSlotMode,
} from "../ui/dynamic-slot";
import { VALUE_SOURCE_LABELS, capsForPosition, slotCaps, slotMode } from "../ui/value-source";
import { cloneValue } from "../tabs/doc-op-apply";
import { openMenu } from "../surfaces/menu";
import { showPromptDialog } from "../ui/layers";
import { effect, effectScope } from "../reactivity";
import {
  bindableSignalNames,
  defaultAsString,
  isInspectorSectionOpen,
  mapSignalsFor,
  setInspectorSection,
} from "./properties-panel";
import { collectCssParts, isCustomElementDoc } from "./signals-panel";
import { openLogicTarget } from "./formula-workspace";
import { emptyLogicView, mountLogicSurface } from "../surfaces/logic-panel";
import {
  getEventBinding,
  isExpressionDef,
  isFunctionDef,
  isJsonObject,
  isRef,
} from "@jxsuite/schema/guards";

import type {
  LogicBindingView,
  LogicBodyKind,
  LogicEmptyAction,
  LogicFieldView,
  LogicOption,
  LogicSurface,
  LogicView,
} from "../surfaces/logic-panel";
import type { JsonValue } from "../types";
import type { EffectScope } from "@vue/reactivity";
import type { SignalOption } from "../ui/dynamic-slot";
import type { SlotCapsSource, SlotMode } from "../ui/value-source";
import type { JxPath } from "../state";
import type {
  CemEvent,
  JxEventBinding,
  JxFunctionDef,
  JxMutableNode,
  JxPrototypeDef,
  JxStatement,
} from "@jxsuite/schema/types";

/**
 * The events worth SUGGESTING — not the events an element may have.
 *
 * These ten were a closed `sp-picker`, so `ondragover`, `onpointerdown`, `onwheel`, `onpaste` and
 * every custom event a component emits were unbindable from the Inspector: the plan's §6.5 asks for
 * "a free-form combobox instead of a hard-coded list of ten". The list is still ten, and it is a
 * list of SUGGESTIONS now — the menu's last row asks for any other name.
 */
export const EVENT_NAMES = [
  "onclick",
  "oninput",
  "onchange",
  "onsubmit",
  "onkeydown",
  "onkeyup",
  "onfocus",
  "onblur",
  "onmouseenter",
  "onmouseleave",
];

/** A name this element may bind. Anything matching is accepted; the menu only suggests. */
const EVENT_NAME_PATTERN = /^on[a-z][\da-z-]*$/i;

/**
 * The rungs an `on*` handler permits, derived from the schema (`RefObject | ExpressionEntry |
 * FunctionDef`) rather than listed here.
 *
 * This picker used to read Inline code / Expression / Existing function — a fourth private dialect
 * for the one ladder §6.6 collapses, so a user who learned "Formula" on a property row met
 * "Expression" here and had no reason to think they were the same thing.
 */
const HANDLER_MODES: SlotMode[] = capsForPosition("eventHandler");

/** The value a handler starts at on each rung, when the user has never been on that rung before. */
function seedForHandlerMode(mode: SlotMode, functionDefs: [string, unknown][]): JsonValue {
  if (mode === "function") {
    return { $prototype: "Function", body: "", parameters: [] };
  }
  if (mode === "expression") {
    return { $expression: { operator: "=", target: null } };
  }
  const [firstFn] = functionDefs;
  return firstFn ? { $ref: `#/state/${firstFn[0]}` } : { $ref: "" };
}

// ─── The Mixed contract ──────────────────────────────────────────────────────

/**
 * The Logic tab's Mixed contract (§6.5), stated once because it is a judgement, not a mechanism.
 *
 * Wiring splits in two, and a multi-selection treats the halves differently:
 *
 * - **Which events exist, and how each is produced** — the event key, its Value Source rung, and its
 *   removal — is a property of the BATCH. Binding one handler to six buttons, or clearing it off
 *   all six, is a single decision, so those three controls write to every selected element inside
 *   one transaction and one undo step.
 * - **What a handler CONTAINS** — a function body, an expression's operands, a repeater's source and
 *   template — is the PRIMARY's. Six elements do not share one handler body; broadcasting a
 *   keystroke into six different bodies would destroy five of them, and showing one body while
 *   claiming to edit six is the lie the Mixed chip exists to prevent.
 *
 * So the row's dot reads `mixed` when the selected elements disagree about a key — including when
 * some of them do not bind it at all — and the body below it stays what it always was: the
 * primary's, edited alone.
 *
 * @param {readonly JxPath[]} targets
 * @param {string} key
 * @param {JsonValue} [value] — omitted deletes the key.
 */
function commitToTargets(targets: readonly JxPath[], key: string, value?: JsonValue): void {
  transactDoc(activeTab.value, (t) => {
    for (const target of targets) {
      mutateUpdateProperty(t, target, key, value);
    }
  });
}

/**
 * How many selected elements disagree about one event key — 0 when they agree or there is one.
 *
 * @param {JxMutableNode} doc
 * @param {readonly JxPath[]} targets
 * @param {string} evKey
 * @returns {number}
 */
function mixedEventCount(doc: JxMutableNode, targets: readonly JxPath[], evKey: string): number {
  if (targets.length < 2) {
    return 0;
  }
  const values = targets.map((path) => {
    const n = getNodeAtPath(doc, path) as JxMutableNode | undefined;
    return n ? (getEventBinding(n, evKey) ?? null) : null;
  });
  return unifyValues(values).mixed ? targets.length : 0;
}

// ─── The projection's plans ──────────────────────────────────────────────────

/** Everything a bindable row needs, on the flow's side of the seam. */
interface FieldPlan {
  label: string;
  caps: SlotCapsSource;
  value: unknown;
  mode: SlotMode;
  offered: SlotMode[];
  onChange: (v?: JsonValue) => void;
  onClear?: (() => void) | undefined;
  extraSignals: SignalOption[] | null;
  literalDefault: JsonValue | undefined;
  stateDefs: readonly string[];
  /** Fills the row's control host when the active rung is a formula. */
  paint?: (host: HTMLElement) => void;
}

/** Everything an event binding needs. */
interface BindingPlan {
  key: string;
  value: unknown;
  mode: SlotMode;
  fn: JxFunctionDef | null;
  body: LogicBodyKind;
  paint?: (host: HTMLElement) => void;
  mountStatements?: (host: HTMLElement) => void;
}

interface Plans {
  fields: Map<string, FieldPlan>;
  bindings: Map<string, BindingPlan>;
  cases: Set<string>;
  /** The whole selection this projection commits to. */
  targets: JxPath[];
  /** The primary selection — the one whose bodies are edited. */
  selection: JxPath | null;
  functionDefs: [string, unknown][];
}

let plans: Plans = {
  bindings: new Map(),
  cases: new Set(),
  fields: new Map(),
  functionDefs: [],
  selection: null,
  targets: [],
};

// ─── Building the view ───────────────────────────────────────────────────────

/**
 * Whether a position has anywhere else to go.
 *
 * Not `offered.length > 1`. A `$switch` discriminant permits exactly one rung — it is a `$ref` and
 * nothing else — and a document that holds a `${…}` template there is on a rung the schema does not
 * permit, which is precisely when the reader needs the chip to work. The question is whether the
 * ladder offers a rung this value is not already on.
 */
function canMove(mode: SlotMode, offered: readonly SlotMode[]): boolean {
  return offered.some((rung) => rung !== mode);
}

/** The Value Source chip's accessible name — and whether the position offers a choice at all. */
function sourceHint(mode: SlotMode, offered: readonly SlotMode[]): string {
  const label = VALUE_SOURCE_LABELS[mode];
  return canMove(mode, offered)
    ? `Value source: ${label} — click to change`
    : `Value source: ${label} (no other source available here)`;
}

/** Every pointer the From data… rung offers on a bindable position. */
function refOptions(plan: FieldPlan): LogicOption[] {
  return [
    ...plan.stateDefs.map((name) => ({ label: name, value: `#/state/${name}` })),
    ...(plan.extraSignals ?? []),
  ];
}

/**
 * One bindable row, as the document draws it.
 *
 * Every position it serves is a single-line expression, so it draws one widget rather than
 * dispatching over a widget type — the textarea and checkbox arms the lit version carried had no
 * caller in either tab.
 */
function fieldView(key: string, prop: string, plan: FieldPlan): LogicFieldView {
  const set = plan.value !== undefined && plan.value !== "";
  const literal = plan.mode === "literal" || plan.mode === "function";
  return {
    clearLocked: !plan.onClear,
    clearTitle: plan.onClear ? `Clear ${plan.label}` : `${plan.label} cannot be cleared`,
    dotState: set ? "set" : "unset",
    key,
    kind: plan.mode === "expression" ? "control" : plan.mode === "ref" ? "select" : "text",
    label: plan.label,
    mono: plan.mode === "template",
    options: plan.mode === "ref" ? refOptions(plan) : [],
    placeholder: plan.mode === "template" ? "${state.…}" : "",
    prop,
    source: plan.mode,
    sourceHint: sourceHint(plan.mode, plan.offered),
    sourceLabel: VALUE_SOURCE_LABELS[plan.mode],
    sourceLocked: !canMove(plan.mode, plan.offered),
    tone: "",
    value: literal
      ? String(plan.value ?? "")
      : plan.mode === "ref"
        ? isRef(plan.value)
          ? plan.value.$ref
          : ""
        : String(plan.value ?? ""),
  };
}

/** Register a bindable row and return the view the document draws for it. */
function addField(
  fields: Map<string, FieldPlan>,
  key: string,
  prop: string,
  spec: Omit<FieldPlan, "mode" | "offered">,
): LogicFieldView {
  const offered = slotCaps(spec.caps);
  const mode = effectiveSlotMode(key, spec.value);
  const plan: FieldPlan = { ...spec, mode, offered };
  if (mode === "expression") {
    const node = (spec.value as { $expression?: unknown } | undefined)?.$expression;
    plan.paint = (host) =>
      mountExpressionEditor(
        host,
        node,
        (next) => spec.onChange({ $expression: next } as JsonValue),
        {
          allowEventRef: false,
          stateDefs: [...spec.stateDefs],
          stateEntries: null,
        },
      );
  }
  fields.set(key, plan);
  return fieldView(key, prop, plan);
}

/**
 * Build the whole projection, and the plans every key in it addresses.
 *
 * Exported for its own test: the projection IS the tab now, so what it contains and what a key
 * addresses are the contract, not an implementation detail of a template.
 *
 * @returns {LogicView}
 */
export function projectLogicPanel(): LogicView {
  const fields = new Map<string, FieldPlan>();
  const bindings = new Map<string, BindingPlan>();
  const cases = new Set<string>();
  const view = emptyLogicView();
  const tab = activeTab.value;
  const selection = primarySelection(tab?.session.selection);
  const doc = tab?.doc.document;
  const nothingToWire = (message: string, actions: LogicEmptyAction[] = []): LogicView => {
    plans = { bindings, cases, fields, functionDefs: [], selection: null, targets: [] };
    view.emptyActions = actions;
    view.emptyMessage = message;
    view.hasEmptyActions = actions.length > 0;
    return view;
  };
  /* Three states, three sentences. The dock used to draw one of them itself — a no-document state
     rendered INTO each tab's container — and it cannot any more: the container is a mounted
     document's, and painting over it would take the field a reader is typing into. So the tab says
     its own words, which it should have all along: "open a page" and "click something" are not the
     same instruction. */
  if (!tab || !doc) {
    return nothingToWire("Open a page to inspect and wire what you click.", [
      { id: "open-page", label: "Open a page…" },
    ]);
  }
  if (!selection) {
    return nothingToWire(clickAnythingTo("wire it up"));
  }
  const node = getNodeAtPath(doc, selection) as JxMutableNode | undefined;
  if (!node) {
    return nothingToWire(staleSelectionMessage());
  }

  view.state = "ready";
  const defs = doc.state || {};
  const functionDefs = Object.entries(defs).filter(
    ([, d]) =>
      (d as JxPrototypeDef)?.$prototype === "Function" || (d as Record<string, unknown>)?.$handler,
  );
  // The whole selection the Logic tab wires. `[selection]` when one element is selected — which is
  // Every existing call site's behaviour, unchanged.
  const targets: JxPath[] = tab.session.selection.length > 0 ? tab.session.selection : [selection];
  plans = { bindings, cases, fields, functionDefs, selection, targets };

  const isMapNode = node.$prototype === "Array";
  const isSwitchNode = Boolean(node.$switch);
  const isRoot = selection.length === 0;
  const isCustomElement = isCustomElementDoc({
    document: doc,
    mode: tab.doc.mode,
    selection: tab.session.selection,
    ui: tab.session.ui,
  });
  const stateDefs = bindableSignalNames(doc);
  const key = selection.join("/");
  /* De-escalating to Fixed value restores the bound signal's declared default — the old unbind
     behaviour, and the reason the ladder has to be told what a position's default IS. */
  const literalDefaultOf = (raw: unknown): JsonValue | undefined => {
    const bound = isRef(raw) ? raw.$ref : null;
    if (!bound) {
      return undefined;
    }
    return (
      defaultAsString(defs[bound.startsWith("#/state/") ? bound.slice(8) : bound]) || undefined
    );
  };

  // ── Repeating list ────────────────────────────────────────────────────────
  if (isMapNode) {
    view.hasRepeater = true;
    view.repeaterOpen = isInspectorSectionOpen("__repeater", true);
    const commit = (name: string) => (v?: JsonValue) =>
      transactDoc(activeTab.value, (t) => mutateUpdateProperty(t, selection, name, v || undefined));
    const optional = (name: "filter" | "sort", label: string) =>
      addField(fields, `prop|${key}|${name}`, name, {
        caps: name === "filter" ? "repeaterFilter" : "repeaterSort",
        extraSignals: null,
        label,
        literalDefault: literalDefaultOf(node[name]),
        onChange: commit(name),
        onClear: () =>
          transactDoc(activeTab.value, (t) => mutateUpdateProperty(t, selection, name)),
        stateDefs,
        value: node[name],
      });
    view.repeaterFields = [
      addField(fields, `prop|${key}|items`, "items", {
        caps: "repeaterItems",
        extraSignals: null,
        label: "Items",
        literalDefault: literalDefaultOf(node.items),
        onChange: (v?: JsonValue) =>
          transactDoc(activeTab.value, (t) => mutateUpdateProperty(t, selection, "items", v)),
        stateDefs,
        value: node.items,
      }),
      optional("filter", "Filter"),
      optional("sort", "Sort"),
    ];
    view.hasTemplate = Boolean(node.map);
  }

  // ── Condition ─────────────────────────────────────────────────────────────
  if (isSwitchNode) {
    view.hasCondition = true;
    view.conditionOpen = isInspectorSectionOpen("__condition", true);
    view.conditionFields = [
      addField(fields, `prop|${key}|$switch`, "$switch", {
        // `SwitchDef` is a $ref and nothing else, so From data… is the only rung — a $switch is
        // Inherently dynamic, and de-escalating it would delete the key and demote the node.
        caps: "switchDiscriminant",
        extraSignals: mapSignalsFor(selection),
        label: "Expression",
        literalDefault: literalDefaultOf(node.$switch),
        onChange: (v?: JsonValue) =>
          transactDoc(activeTab.value, (t) => mutateUpdateProperty(t, selection, "$switch", v)),
        stateDefs,
        value: node.$switch,
      }),
    ];
    view.cases = Object.keys(node.cases || {}).map((caseName) => {
      cases.add(caseName);
      return {
        key: caseName,
        name: caseName,
        openTitle: `Edit case "${caseName}"`,
        prop: `case:${caseName}`,
        removeTitle: `Remove case "${caseName}"`,
      };
    });
  }

  // ── Events ────────────────────────────────────────────────────────────────
  // A repeater is not an element: it has no `on*` position to bind, and offering "Add Event" on one
  // Writes a handler onto a node the renderer never mounts.
  if (!isMapNode) {
    view.hasEvents = true;
    view.eventsOpen = isInspectorSectionOpen("__events", true);
    if (isCustomElement) {
      const declared: LogicView["declared"] = [];
      for (const [fnName, d] of Object.entries(defs)) {
        if (isFunctionDef(d) && Array.isArray(d.emits)) {
          for (const [i, ev] of (d.emits as CemEvent[]).entries()) {
            declared.push({
              key: `${fnName}:${ev.name || i}`,
              name: ev.name || "(unnamed)",
              source: `← ${fnName}`,
              title: ev.description || "",
              type: isJsonObject(ev.type) && typeof ev.type.text === "string" ? ev.type.text : "",
            });
          }
        }
      }
      view.declared = declared;
      view.hasDeclared = declared.length > 0;
    }

    /* Resolved once, as pairs: asking `getEventBinding` for the key and then again for the value
       left an `if (!evVal) return nothing` arm nothing could ever reach. */
    const entries = Object.keys(node)
      .filter((k) => k.startsWith("on"))
      .map((k) => [k, getEventBinding(node, k)] as const)
      .filter((pair): pair is [string, JxEventBinding] => pair[1] !== undefined);
    view.bindings = entries.map(([evKey, evVal]) => bindingView(bindings, evKey, evVal, defs));
    view.hasBindings = entries.length > 0;
  }

  // ── The custom element's outward contract ────────────────────────────────
  if (isCustomElement && isRoot) {
    const observed = Object.entries(defs).filter(
      ([, d]) => (d as Record<string, unknown>).attribute,
    );
    view.hasObserved = true;
    view.observedOpen = isInspectorSectionOpen("__observed", false);
    view.observedEmpty = observed.length === 0;
    view.observed = observed.map(([name, d]) => {
      const def = d as Record<string, unknown>;
      return {
        detail: `→ ${name}`,
        key: name,
        name: String(def.attribute),
        prop: `attribute:${name}`,
        tags: def.reflects ? "reflects" : "",
        value: def.type ? String(def.type) : "",
      };
    });

    const cssProps = Object.entries(node.style || {}).filter(([k]) => k.startsWith("--"));
    view.hasCssProps = cssProps.length > 0;
    view.cssPropsOpen = isInspectorSectionOpen("__cssprops", false);
    view.cssProps = cssProps.map(([name, value]) => ({
      detail: "",
      key: name,
      name,
      prop: `cssprop:${name}`,
      tags: "",
      value: String(value),
    }));

    const parts = collectCssParts(doc);
    view.hasCssParts = parts.length > 0;
    view.cssPartsOpen = isInspectorSectionOpen("__cssparts", false);
    view.cssParts = parts.map((p) => ({
      detail: `<${p.tag}>`,
      key: `${p.tag}:${p.name}`,
      name: p.name,
      prop: `csspart:${p.name}`,
      tags: "",
      value: "",
    }));
  }

  return view;
}

/** One `on*` key, and the plan behind it. */
function bindingView(
  bindings: Map<string, BindingPlan>,
  evKey: string,
  evVal: JxEventBinding,
  defs: Record<string, unknown>,
): LogicBindingView {
  const { functionDefs, selection, targets } = plans;
  const tab = activeTab.value!;
  const fn: JxFunctionDef | null = isFunctionDef(evVal) ? evVal : null;
  const expression = isExpressionDef(evVal) ? evVal.$expression : null;
  const mode = slotMode(evVal);
  const structured = Boolean(fn && Array.isArray(fn.body));
  const body: LogicBodyKind = fn
    ? structured
      ? "statements"
      : "code"
    : expression
      ? "expression"
      : "ref";
  const mixed = mixedEventCount(tab.doc.document, targets, evKey) > 0;
  const plan: BindingPlan = { body, fn, key: evKey, mode, value: evVal };

  if (fn && structured && selection) {
    plan.mountStatements = (host) =>
      mountStatementEditor(
        host,
        fn.body as JxStatement[],
        (next) =>
          transactDoc(activeTab.value, (t) =>
            mutateUpdateProperty(t, selection, evKey, {
              ...fn,
              body: next as unknown as JsonValue,
            }),
          ),
        {
          allowEventRef: true,
          emits: fn.emits ?? [],
          /* The Inspector's copy, named by the handler it edits. It answered to
             `navigator/statements` until the docks were split, and then to a bare
             `inspector/statements` — which the binding list stamps once per structured handler, so
             two handlers on a node made two elements answer to it and `resolveRegion` took the
             second. */
          region: inspectorStatementsRegion(evKey),
          stateDefs: Object.keys(defs),
          stateEntries: defs as never,
        },
      );
  }
  if (expression && selection) {
    /* Live-context evaluation in the canvas iframe, snapshot fallback (M6). The selection path is
       the context, so a binding inside a repeater template previews with the first item's $map
       scope. */
    const preview = livePreviewExpression(
      tab,
      `event:${JSON.stringify(selection)}:${evKey}`,
      expression,
      selection,
      () => renderOnly("rightPanel"),
    );
    const commitExpression = (newNode: unknown) =>
      transactDoc(activeTab.value, (t) =>
        mutateUpdateProperty(t, selection, evKey, { $expression: newNode as JsonValue }),
      );
    const insertDef = (defName: string, def: unknown) =>
      transactDoc(activeTab.value, (t) =>
        mutateAddDef(t, defName, def as Record<string, JsonValue>),
      );
    plan.paint = (host) =>
      mountExpressionEditor(host, expression, commitExpression, {
        allowEventRef: true,
        onInsertDef: insertDef,
        preview,
        stateDefs: Object.keys(defs),
        stateEntries: defs as never,
      });
  }
  bindings.set(evKey, plan);

  return {
    body,
    clearTitle: mixed
      ? `${targets.length} selected elements bind ${evKey} differently — clearing removes it from all of them`
      : `Clear ${evKey}`,
    code: fn && !structured && typeof fn.body === "string" ? fn.body : "",
    codeChecked: body === "code" ? "true" : "false",
    dotState: mixed ? "mixed" : "set",
    key: evKey,
    name: evKey,
    nameTitle: `Event: ${evKey} — click to change`,
    openTitle: body === "expression" ? "Open in formula workspace" : "Open in editor",
    refOptions: [
      { label: "— none —", value: "" },
      ...functionDefs.map(([fName]) => ({ label: fName, value: `#/state/${fName}` })),
    ],
    refValue: isRef(evVal) ? evVal.$ref : "",
    showToggle: Boolean(fn),
    source: mode,
    sourceHint: sourceHint(mode, HANDLER_MODES),
    sourceLabel: VALUE_SOURCE_LABELS[mode],
    statementsChecked: body === "statements" ? "true" : "false",
    tone: mixed ? "warning" : "",
  };
}

// ─── The surface ─────────────────────────────────────────────────────────────

let surface: LogicSurface | null = null;
let watcher: EffectScope | null = null;
/** Every island host the tab has been handed, so a re-projection can repaint it. */
const controlHosts = new Map<string, HTMLElement>();
const expressionHosts = new Map<string, HTMLElement>();
const statementHosts = new Map<string, HTMLElement>();

/** The section ids the document names, and the keys `inspectorSections` stores them under. */
const SECTION_KEYS: Record<string, string> = {
  condition: "__condition",
  cssparts: "__cssparts",
  cssprops: "__cssprops",
  events: "__events",
  observed: "__observed",
  repeater: "__repeater",
};

/**
 * Mount the Logic tab into the container the Inspector owns, and subscribe to what it draws.
 *
 * `null` unbinds. Called once from the right panel's container setup — the same seam
 * `panels/ai-panel.ts` uses, for the same reason: the container is built once for the life of the
 * window, and the dock must not render over a mounted document.
 *
 * @param {HTMLElement | null} el
 */
export function bindLogicPanelHost(el: HTMLElement | null): void {
  watcher?.stop();
  watcher = null;
  surface?.dispose();
  surface = null;
  controlHosts.clear();
  expressionHosts.clear();
  statementHosts.clear();
  if (!el) {
    return;
  }
  surface = mountLogicSurface(
    el,
    projectLogicPanel(),
    {
      addCase: () => {
        const { selection } = plans;
        if (selection) {
          transactDoc(activeTab.value, (t) =>
            mutateAddSwitchCase(t, selection, `case${plans.cases.size + 1}`),
          );
        }
      },
      addEvent: addEventBinding,
      clearEvent: (key) => commitToTargets(plans.targets, key),
      clearField: (key) => plans.fields.get(key)?.onClear?.(),
      editTemplate: () => {
        const { selection } = plans;
        if (selection && activeTab.value) {
          activeTab.value.session.selection = [[...selection, "map"]];
        }
      },
      openCase: (key) => {
        const { selection } = plans;
        if (selection && activeTab.value) {
          activeTab.value.session.selection = [[...selection, "cases", key]];
        }
      },
      openEditor: (key) => {
        const { selection } = plans;
        const plan = plans.bindings.get(key);
        if (selection && plan) {
          openLogicTarget({
            editing: { eventKey: key, path: selection, type: "event" },
            surface: plan.body === "expression" ? "formula" : "function",
          });
        }
      },
      pickEventName: openEventNameMenu,
      pickHandler: openHandlerMenu,
      pickSource: openSourceMenu,
      runEmptyAction: (id) => {
        if (id === "open-page") {
          openPageAction().run();
        }
      },
      removeCase: (key) => {
        const { selection } = plans;
        if (selection) {
          transactDoc(activeTab.value, (t) => mutateRemoveSwitchCase(t, selection, key));
        }
      },
      renameCase: (key, value) => {
        const { selection } = plans;
        if (selection && value && value !== key) {
          transactDoc(activeTab.value, (t) => mutateRenameSwitchCase(t, selection, key, value));
        }
      },
      setBodyMode: setHandlerBodyMode,
      setCode: (key, value) => {
        const { selection } = plans;
        const plan = plans.bindings.get(key);
        if (selection && plan?.fn) {
          transactDoc(activeTab.value, (t) =>
            mutateUpdateProperty(t, selection, key, {
              $prototype: "Function",
              body: value,
              parameters: (plan.fn?.parameters as JsonValue) || [],
            }),
          );
        }
      },
      setField: (key, value) => {
        const plan = plans.fields.get(key);
        if (!plan) {
          return;
        }
        if (plan.mode === "ref") {
          plan.onChange(value ? ({ $ref: value } as JsonValue) : undefined);
          return;
        }
        plan.onChange(value);
      },
      setHandlerRef: (key, value) => {
        const { selection } = plans;
        if (!selection) {
          return;
        }
        transactDoc(activeTab.value, (t) =>
          mutateUpdateProperty(t, selection, key, value ? { $ref: value } : undefined),
        );
      },
      setSection: (id, open) => {
        const stored = SECTION_KEYS[id];
        if (stored) {
          setInspectorSection(stored, open);
        }
      },
    },
    {
      controlSlot: (key, host) => {
        controlHosts.set(key, host);
        plans.fields.get(key)?.paint?.(host);
      },
      expressionSlot: (key, host) => {
        expressionHosts.set(key, host);
        plans.bindings.get(key)?.paint?.(host);
      },
      statementsSlot: (key, host) => {
        statementHosts.set(key, host);
        plans.bindings.get(key)?.mountStatements?.(host);
      },
    },
  );
  watch();
}

/** Whether a projection is already queued for the end of this tick. */
let queued = false;

/**
 * Re-project; the surface follows.
 *
 * Coalesced on a microtask for the reason `panels/ai-panel.ts` gives: a transaction writes several
 * reactive facts in one tick and the projection walks the whole selection, so running it per write
 * would rebuild the same view three times for one edit.
 */
export function renderLogicPanel(): void {
  if (queued || !surface) {
    return;
  }
  queued = true;
  queueMicrotask(() => {
    queued = false;
    if (!surface) {
      return;
    }
    surface.update(projectLogicPanel());
    /* The document's own bindings settle on a microtask, so the islands are brought up on the next
       one — after the rows the runtime is about to reconcile exist. A host whose row is gone is
       dropped rather than repainted. */
    queueMicrotask(repaintIslands);
  });
}

/** Fill every island the tab still has, and forget the ones whose row went away. */
function repaintIslands(): void {
  for (const [key, host] of controlHosts) {
    const plan = plans.fields.get(key);
    if (!plan || !host.isConnected) {
      controlHosts.delete(key);
      continue;
    }
    plan.paint?.(host);
  }
  for (const [key, host] of expressionHosts) {
    const plan = plans.bindings.get(key);
    if (!plan || !host.isConnected) {
      expressionHosts.delete(key);
      continue;
    }
    plan.paint?.(host);
  }
  for (const [key, host] of statementHosts) {
    const plan = plans.bindings.get(key);
    if (!plan || !host.isConnected) {
      statementHosts.delete(key);
      continue;
    }
    plan.mountStatements?.(host);
  }
}

/**
 * Re-project on the facts the tab draws.
 *
 * The Inspector's own scheduler is deliberately not in this path: its focus guard exists because a
 * lit repaint takes the node a reader is typing into, and a document's binding skips a write that
 * resolved to the value the control already holds.
 */
function watch(): void {
  watcher?.stop();
  watcher = effectScope();
  watcher.run(() => {
    effect(() => {
      const tab = activeTab.value;
      if (tab) {
        void tab.doc.document;
        void tab.doc.mode;
        // The whole SET, joined — a bare property read would not re-trigger when the selection
        // Changes WITHIN the array.
        void tab.session.selection.map((path) => path.join("/")).join("|");
        void tab.session.ui.inspectorSections;
      }
      renderLogicPanel();
    });
  });
}

// ─── The menus ───────────────────────────────────────────────────────────────

/** The rung picker for a bindable row: every source this position permits, one action away (§6.3). */
function openSourceMenu(key: string, anchor: HTMLElement): void {
  const plan = plans.fields.get(key);
  if (!plan || !canMove(plan.mode, plan.offered)) {
    return;
  }
  openMenu({
    label: "Value source",
    opener: anchor,
    region: "value-source",
    rows: plan.offered.map((rung) => ({
      checked: (rung === plan.mode ? "true" : "false") as "true" | "false",
      destructive: false,
      disabled: false,
      dividerAbove: false,
      id: rung,
      title: VALUE_SOURCE_LABELS[rung],
    })),
    run: (id) => {
      const next = id as SlotMode;
      if (next === plan.mode) {
        return;
      }
      /* Leaving From data… seeds an empty Fixed value stash with the signal's declared default, so
         unbind-restores-default survives a detour (ref → mixed text → fixed value). */
      if (
        plan.mode === "ref" &&
        plan.literalDefault !== undefined &&
        !hasStashedSlotValue(key, "literal")
      ) {
        stashSlotValue(key, "literal", plan.literalDefault);
      }
      plan.onChange(
        switchSlotMode(
          key,
          plan.mode,
          next,
          cloneValue(plan.value as JsonValue | undefined),
          slotModeSeed(next, {
            extraSignals: plan.extraSignals,
            literalDefault: plan.literalDefault,
            stateDefs: plan.stateDefs,
          }),
        ),
      );
    },
  });
}

/** The handler's rung picker — the same ladder, remembering the representation it left. */
function openHandlerMenu(key: string, anchor: HTMLElement): void {
  const plan = plans.bindings.get(key);
  if (!plan) {
    return;
  }
  openMenu({
    label: "Value source",
    opener: anchor,
    region: "value-source",
    rows: HANDLER_MODES.map((rung) => ({
      checked: (rung === plan.mode ? "true" : "false") as "true" | "false",
      destructive: false,
      disabled: false,
      dividerAbove: false,
      id: rung,
      title: VALUE_SOURCE_LABELS[rung],
    })),
    run: (id) => {
      const next = id as SlotMode;
      if (next === plan.mode) {
        return;
      }
      const seed = seedForHandlerMode(next, plans.functionDefs);
      commitToTargets(
        plans.targets,
        key,
        switchSlotMode(
          `event|${plans.selection?.join("/") ?? ""}|${key}`,
          plan.mode,
          next,
          plan.value as JsonValue,
          seed,
        ) ?? seed,
      );
    },
  });
}

/**
 * The event NAME menu: what this element already binds, the ten worth suggesting, and Other….
 *
 * A NAME, not a menu choice — the field refuses what it cannot bind rather than trusting a list it
 * does not constrain, which is why the pattern is checked on the way out of the prompt as well.
 */
function openEventNameMenu(key: string, anchor: HTMLElement): void {
  const bound = [...plans.bindings.keys()];
  const suggestions = [...new Set([...bound, ...EVENT_NAMES])];
  openMenu({
    label: "Event name",
    opener: anchor,
    region: "event-name",
    rows: [
      ...suggestions.map((name) => ({
        checked: (name === key ? "true" : "false") as "true" | "false",
        destructive: false,
        disabled: false,
        dividerAbove: false,
        id: name,
        title: name,
      })),
      {
        destructive: false,
        disabled: false,
        dividerAbove: true,
        id: "__custom__",
        run: () => {
          void showPromptDialog("Event name", {
            message: "Any DOM or custom event this element emits — onpointerdown, ondragover.",
            placeholder: "onpointerdown",
            validate: (value) =>
              EVENT_NAME_PATTERN.test(value.trim())
                ? ""
                : "An event key starts with “on” and continues in letters, digits or hyphens.",
            value: key,
          }).then((name) => {
            if (name) {
              renameEvent(key, name.trim());
            }
          });
        },
        title: "Other name…",
      },
    ],
    run: (id) => renameEvent(key, id),
  });
}

/** Move a binding onto a different key, on every selected element, in one step. */
function renameEvent(evKey: string, newKey: string): void {
  if (!newKey || newKey === evKey || !EVENT_NAME_PATTERN.test(newKey)) {
    return;
  }
  transactDoc(activeTab.value, (t) => {
    for (const target of plans.targets) {
      const existing = getEventBinding(
        getNodeAtPath(t.doc.document, target) as JxMutableNode,
        evKey,
      );
      if (existing === undefined) {
        continue;
      }
      mutateUpdateProperty(t, target, evKey);
      mutateUpdateProperty(t, target, newKey, existing as JsonValue);
    }
  });
}

/**
 * Switch an inline handler between a structured body and a code body.
 *
 * A change of REPRESENTATION, not of view: a `JxStatement[]` and a string are two different values
 * in the document, so the toggle rewrites the entry rather than choosing a renderer.
 */
function setHandlerBodyMode(key: string, mode: string): void {
  const { selection } = plans;
  const plan = plans.bindings.get(key);
  const fn = plan?.fn;
  if (!selection || !fn) {
    return;
  }
  const structured = Array.isArray(fn.body);
  if ((mode === "statements") === structured) {
    return;
  }
  transactDoc(activeTab.value, (t) =>
    mutateUpdateProperty(t, selection, key, {
      ...fn,
      body: (mode === "statements" ? [] : "") as JsonValue,
    }),
  );
}

/** Add a binding on the first unbound suggestion, pointed at the first function this document has. */
function addEventBinding(): void {
  const { functionDefs, selection } = plans;
  const tab = activeTab.value;
  if (!selection || !tab) {
    return;
  }
  const node = getNodeAtPath(tab.doc.document, selection) as JxMutableNode | undefined;
  let evName = "onclick";
  for (const name of EVENT_NAMES) {
    if (!node?.[name]) {
      evName = name;
      break;
    }
  }
  transactDoc(activeTab.value, (t) =>
    mutateUpdateProperty(
      t,
      selection,
      evName,
      functionDefs.length > 0
        ? { $ref: `#/state/${functionDefs[0]![0]}` }
        : { $prototype: "Function", body: "", parameters: [] },
    ),
  );
}
