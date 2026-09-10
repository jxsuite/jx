/// <reference lib="dom" />
/**
 * The Data panel's flow — what a state entry IS, and every transaction that edits one.
 *
 * The markup is `surfaces/panel-signals.json`, mounted by `surfaces/panel-signals.ts`. What is left
 * here is the half a document cannot hold: which category an entry falls in, what its badge and its
 * one-line summary say, WHICH CONTROL each field of a `$prototype` gets, what a commit is worth,
 * what a rename collides with, and the four foreign surfaces that arrive as islands.
 *
 * **The field list is a projection.** A `Request` entry and an `IndexedDB` entry differ only in the
 * rows {@link signalsView} hands over, so a new prototype is a case here and no markup at all —
 * which is why `renderDataSourceFields`, `renderFunctionFields`, `renderParameterEditorTemplate`
 * and `renderEmitsEditorTemplate` are gone rather than moved: each was a template per shape, and
 * there is one shape now.
 *
 * **A control hands back names, and this module looks up what they mean.** Every field is
 * registered as a {@link FieldPlan} under its entry and key while the view is built, so
 * `commitField("$items", "url", "/api")` finds the writer that knows `url` is a `Request`'s URL.
 * Nothing crosses the seam but strings.
 *
 * @docs studio/logic/data
 */

import { displayTagName } from "@jxsuite/schema/guards";
import { dynamicRouteParams } from "../page-params";
import { projectState } from "../state";
import type { JsonValue } from "../types";
import { activeTab } from "../workspace/workspace";
import {
  mutateAddDef,
  mutateRemoveDef,
  mutateRenameDef,
  mutateUpdateDef,
  transactDoc,
} from "../tabs/transact";
import { expressionHint, isActionExpression, mountExpressionEditor } from "../ui/expression-editor";
import {
  dataTypeLabel,
  expandedDataRows,
  isDataRowExpanded,
  paintDataTree,
  setDataRowExpanded,
  unwrapSignal,
} from "./data-explorer";
import { disposeDetachedDataTrees } from "../surfaces/panel-data";
import { openLogicTarget } from "./formula-workspace";
import { bindableSignalNames } from "./properties-panel";
import { mountStatementEditor } from "./statement-editor";
import { NAVIGATOR_STATEMENTS_REGION } from "../ui/regions";
import { livePreviewExpression } from "../services/live-preview";
import { mountMediaPicker } from "../ui/media-picker";
import { renderOnly } from "../store";
import { mountSchemaForm } from "../ui/schema-form";
import { resolveContextPointer } from "../services/context-resolver";
import { mountSignalsSurface } from "../surfaces/panel-signals";
import type { JsonSchema } from "../ui/schema-form";
import type { TabUi } from "../tabs/tab";
import type {
  CemEvent,
  CemParameter,
  JxMutableNode,
  JxStatement,
  JxStateDefinition,
} from "@jxsuite/schema/types";
import { fetchPluginSchema, pluginSchemaCache } from "../services/code-services";
import { getExtensions, loadExtensions } from "../format/format-host";
import { optionalStringArg, stringProperty } from "../commands/command-args";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import { isMediaFormat } from "../utils/studio-utils";
import type {
  SignalCategoryView,
  SignalCellRowView,
  SignalCellView,
  SignalChipView,
  SignalFieldKind,
  SignalFieldView,
  SignalOptionGroup,
  SignalRowView,
  SignalsActions,
  SignalsSurfaceHandle,
  SignalsView,
} from "../surfaces/panel-signals";

interface SignalsPanelState {
  document: JxMutableNode;
  ui?: TabUi | Record<string, unknown>;
  mode?: string;
  selection?: (string | number)[][];
  canvas?: Record<string, unknown> | null;
  _collapsedSignalCats?: Set<string>;
  documentPath?: string | null | undefined;
}

/**
 * What the Data panel's surface needs from its host: a repaint, and the one verb a repaint is not.
 *
 * It carried `renderCanvas` and `updateSession` too, and both are gone for the same reason. The
 * canvas hook lost its last caller when the takeovers went; the session writer lost its two when
 * the Logic buttons started going through `openLogicTarget`, which addresses the focused tab
 * itself. A ctx field with no reader is an invitation to write the wrong thing through it.
 */
interface SignalsPanelCtx {
  renderLeftPanel: () => void;
  /**
   * Re-fire automatic `Request` entries and repaint (the Refresh button).
   *
   * Edit and design suppress automatic fetches — a full render re-resolves every state entry, so
   * authoring would refetch constantly — which is why watching a fetched value needs a verb and not
   * just a repaint.
   */
  refreshData?: () => void;
}

export interface SignalDef {
  $prototype?: string;
  $src?: string;
  $export?: string;
  $compute?: string;
  $deps?: string[];
  $expression?: Record<string, unknown>;
  $handler?: string;
  type?: string;
  default?: unknown;
  body?: string | unknown[];
  parameters?: string[];
  timing?: string;
  description?: string;
  fields?: Record<string, unknown>;
  url?: string;
  method?: string;
  key?: string;
  database?: string;
  store?: string;
  version?: number;
  name?: string;
  attribute?: string;
  reflects?: boolean;
  deprecated?: string | boolean;
  format?: string;
  emits?: CemEvent[];
  [key: string]: unknown;
}

// ─── Module-local state ─────────────────────────────────────────────────────

/**
 * The rename that was refused, and why — cleared by the next accepted one.
 *
 * A collision used to be a silent no-op: the field kept the typed name, the document kept the old
 * one, and nothing said which had won. Plan §11.2 asks for "collision-checked rename with a visible
 * error", and half of that had shipped.
 */
let renameError: { name: string; message: string } | null = null;

/** Track which functions have the advanced param editor open. */
const advancedParamOpen = new Set<string>();

/** Default templates for creating new signal definitions. */
const DEF_TEMPLATES = {
  computed: { $compute: "", $deps: [] },
  cookie: { $prototype: "Cookie", default: "", name: "" },
  expression: { $expression: { operator: "=", target: null } },
  external: { $prototype: "", $src: "" },
  formData: { $prototype: "FormData", fields: {} },
  function: { $prototype: "Function", body: "", parameters: [] },
  indexedDB: { $prototype: "IndexedDB", database: "", store: "", version: 1 },
  localStorage: { $prototype: "LocalStorage", default: null, key: "" },
  map: { $prototype: "Map", default: {} },
  request: { $prototype: "Request", method: "GET", timing: "client", url: "" },
  sessionStorage: { $prototype: "SessionStorage", default: null, key: "" },
  set: { $prototype: "Set", default: [] },
  state: { default: "", type: "string" },
} as Record<string, SignalDef>;

/** Keys handled by the framework — skip when rendering schema fields. */
const STUDIO_RESERVED_KEYS = new Set([
  "$prototype",
  "$src",
  "$export",
  "timing",
  "default",
  "description",
  "body",
  "parameters",
  "name",
  "attribute",
  "reflects",
  "deprecated",
  "emits",
]);

/** How long a typed value waits before it is written, where typing commits at all. */
const DEBOUNCE_MS = 500;

// ─── Signals / defs helpers ──────────────────────────────────────────────────

/**
 * Extension-manifest state classes for the add-state picker: plain `$prototype` targets (no
 * admission blocks) across the enabled extensions, each with its `$studio.stateDefaults` hint
 * (specs/extensions.md §10). Manifest classes need no `$src` — the registry resolves them.
 */
export function extensionStateClasses(): {
  name: string;
  stateDefaults?: Record<string, unknown>;
}[] {
  const out: { name: string; stateDefaults?: Record<string, unknown> }[] = [];
  for (const ext of getExtensions()) {
    for (const cls of ext.classes ?? []) {
      if (cls.state) {
        out.push({
          name: cls.name,
          ...(cls.stateDefaults === undefined ? {} : { stateDefaults: cls.stateDefaults }),
        });
      }
    }
  }
  return out;
}

/**
 * View a state entry through the panel's flattened editing lens. Naked primitive and array entries
 * surface as an empty view — the builders guard every field access.
 *
 * @param {import("@jxsuite/schema/types").JxStateDefinition} def
 * @returns {SignalDef}
 */
function asSignalDef(def: JxStateDefinition): SignalDef {
  return (typeof def === "object" && def !== null && !Array.isArray(def) ? def : {}) as SignalDef;
}

/**
 * Classify a state entry into a category string.
 *
 * @param {SignalDef | unknown} def
 */
export function defCategory(def: SignalDef | unknown) {
  if (!def) {
    return "state";
  }
  const d = def as SignalDef;
  if (d.$expression) {
    return "expression";
  }
  if (d.$handler || d.$prototype === "Function") {
    return "function";
  }
  if (d.$compute) {
    return "computed";
  }
  if (d.$prototype) {
    return "data";
  }
  return "state";
}

/**
 * Badge label for a def category.
 *
 * @param {SignalDef | unknown} def
 */
export function defBadgeLabel(def: SignalDef | unknown) {
  if (!def) {
    return "S";
  }
  const d = def as SignalDef;
  if (d.$expression) {
    return "E";
  }
  if (d.$handler || d.$prototype === "Function") {
    return "F";
  }
  if (d.$compute) {
    return "C";
  }
  if (d.$prototype) {
    return d.$prototype.charAt(0);
  }
  return "S";
}

/**
 * Hint text for a signal row.
 *
 * @param {string} name
 * @param {SignalDef | null | undefined} def
 */
export function defHint(_name: string, def: SignalDef | null | undefined) {
  if (!def) {
    return "";
  }
  if (def.$expression) {
    return expressionHint(def.$expression);
  }
  if (def.$prototype === "Function") {
    if (Array.isArray(def.body)) {
      return `${def.body.length} statement${def.body.length === 1 ? "" : "s"}`;
    }
    if (def.body) {
      return def.body.length > 20 ? `${def.body.slice(0, 20)}...` : def.body;
    }
    if (def.$src) {
      return def.$src;
    }
    return "function";
  }
  if (def.$handler) {
    return "handler (legacy)";
  }
  if (def.$compute) {
    return `=${def.$compute.length > 20 ? `${def.$compute.slice(0, 20)}...` : def.$compute}`;
  }
  if (def.$prototype === "Request") {
    return `${def.method || "GET"} ${(def.url || "").slice(0, 20)}`;
  }
  if (def.$prototype === "LocalStorage" || def.$prototype === "SessionStorage") {
    return def.key || "";
  }
  if (def.$prototype === "IndexedDB") {
    return def.database || "";
  }
  if (def.$prototype === "Cookie") {
    return def.name || "";
  }
  if (def.$prototype) {
    return def.$prototype;
  }
  if (def.attribute) {
    return `[${def.attribute}] ${def.type || ""}`;
  }
  return def.type || "";
}

/**
 * Whether the current document defines a custom element (hyphenated tagName).
 *
 * @param {SignalsPanelState} S
 */
export function isCustomElementDoc(S: SignalsPanelState) {
  return displayTagName(S.document.tagName).includes("-");
}

/**
 * Recursively collect CSS `part` attributes from the document tree.
 *
 * @param {JxMutableNode | null | undefined} node
 * @param {{ name: string; tag: string }[]} [parts]
 */
export function collectCssParts(
  node: JxMutableNode | null | undefined,
  parts: { name: string; tag: string }[] = [],
) {
  const part = node?.attributes?.part;
  if (typeof part === "string" && part) {
    parts.push({ name: part, tag: displayTagName(node?.tagName) || "div" });
  }
  if (Array.isArray(node?.children)) {
    for (const c of node.children) {
      if (typeof c !== "string") {
        collectCssParts(c, parts);
      }
    }
  }
  return parts;
}

/**
 * Resolve a $ref value to a display string using signal defaults. Used by the canvas to show real
 * values instead of raw refs.
 *
 * @param {unknown} value
 * @param {Record<string, SignalDef> | null | undefined} defs
 */
export function resolveDefaultForCanvas(
  value: unknown,
  defs: Record<string, JxStateDefinition> | null | undefined,
) {
  if (!value || typeof value !== "object" || !(value as Record<string, unknown>).$ref) {
    return value;
  }
  const ref = (value as Record<string, unknown>).$ref as string;
  /** @type {string | undefined} */
  let defName;
  if (ref.startsWith("#/state/")) {
    defName = ref.slice(8);
  } else if (ref.startsWith("$")) {
    defName = ref;
  } else {
    return `{${ref}}`;
  }

  const rawDef = defs?.[defName];
  if (!rawDef) {
    return `{${defName}}`;
  }
  const def = asSignalDef(rawDef);

  // State signal → use default
  if (!def.$compute && !def.$prototype) {
    if (def.default !== undefined && def.default !== null) {
      if (typeof def.default === "object") {
        return JSON.stringify(def.default);
      }
      return String(def.default);
    }
    return "";
  }
  // Computed → expression indicator
  if (def.$compute) {
    return `ƒ(${defName})`;
  }
  // Request → URL hint
  if (def.$prototype === "Request") {
    return `⟳ ${def.url || "fetch"}`;
  }
  // Storage → use default or key
  if (def.$prototype === "LocalStorage" || def.$prototype === "SessionStorage") {
    if (def.default !== undefined && def.default !== null) {
      if (typeof def.default === "object") {
        return JSON.stringify(def.default);
      }
      return String(def.default);
    }
    return `[${def.key || "storage"}]`;
  }
  if (def.$prototype) {
    return `{${def.$prototype}}`;
  }
  return `{${defName}}`;
}

/** Normalize a parameter entry to a CEM object. */
export function normParam(p: string | CemParameter): CemParameter {
  return typeof p === "string" ? { name: p } : p;
}

/** Extract the display text from a CEM `{ text }` type value, if present. */
function cemTypeText(type: JsonValue | undefined): string {
  if (typeof type === "object" && type !== null && !Array.isArray(type)) {
    const { text } = type;
    if (typeof text === "string") {
      return text;
    }
  }
  return "";
}

/** A value as a field shows it: JSON for a structure, the string for anything else. */
function asText(value: unknown, indent = false): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    return indent ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  }
  return String(value);
}

// ─── The field plans ─────────────────────────────────────────────────────────

/**
 * What one field of one entry can be asked to do.
 *
 * The document hands back the entry's name and this field's key and nothing else, so this is where
 * `url` becomes "a `Request`'s URL". Rebuilt on every projection, which is what keeps a writer
 * closed over the def that is actually on screen.
 */
interface FieldPlan {
  /** What the projection put in the control — a commit equal to it is nothing happening. */
  value: string;
  /** What a KEYSTROKE is worth here: nothing (commit on leaving), a debounce, or a write. */
  live: "none" | "debounce" | "commit";
  write?: (value: string) => void;
  check?: (checked: boolean) => void;
  press?: (action: string) => void;
  cell?: (row: string, cell: string, value: string) => void;
  cellCheck?: (row: string, cell: string, checked: boolean) => void;
  dropRow?: (row: string) => void;
  addRow?: () => void;
  addChip?: (value: string) => void;
  dropChip?: (chip: string) => void;
}

/** Every field of every entry the last projection drew, by `<entry>` and `<field key>`. */
const plans = new Map<string, FieldPlan>();

/** Every island the last projection drew, by `<entry>/<slot>`. See {@link paintIsland}. */
const islands = new Map<string, (host: HTMLElement) => void>();

/** Debounced writes in flight, by the same key as {@link plans}. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Plugin schemas asked for and not yet answered, by cache key. See {@link externalFields}. */
const schemaRequests = new Set<string>();

/** The panel state and host hooks the last render was given — what an action acts against. */
let panelState: SignalsPanelState | null = null;
let panelCtx: SignalsPanelCtx | null = null;

/** One field's identity, as both maps key it. A state entry's name cannot contain a newline. */
function planKey(signal: string, fieldKey: string): string {
  return `${signal}\n${fieldKey}`;
}

/** Register what a field's controls do, and return the field the document draws. */
function field(
  spec: Partial<SignalFieldView> & { key: string; kind: SignalFieldKind; signal: string },
  plan?: FieldPlan,
): SignalFieldView {
  const view: SignalFieldView = {
    addLabel: "",
    buttons: [],
    cellRows: [],
    checked: false,
    chips: [],
    error: "",
    footer: "",
    hasError: false,
    hasFooter: false,
    label: "",
    mono: false,
    options: [],
    placeholder: "",
    prop: spec.prop ?? spec.label ?? spec.key,
    rows: "",
    segments: [],
    slot: "",
    span: false,
    value: "",
    ...spec,
  };
  plans.set(planKey(spec.signal, spec.key), {
    ...(plan ?? { live: "none", value: "" }),
    value: view.value,
  });
  return view;
}

/** A text row committed when the reader leaves it — the shape every `signalFieldRow` had. */
function textField(
  signal: string,
  key: string,
  label: string,
  value: string,
  write: (value: string) => void,
  extra: Partial<SignalFieldView> = {},
): SignalFieldView {
  return field(
    { key, kind: "text", label, signal, value, ...extra },
    { live: "none", value, write },
  );
}

/** A closed set of values, committed on the pick. */
function selectField(
  signal: string,
  key: string,
  label: string,
  values: string[],
  value: string,
  write: (value: string) => void,
): SignalFieldView {
  return field(
    {
      key,
      kind: "select",
      label,
      options: values.map((v) => ({ label: v, value: v })),
      signal,
      value,
    },
    { live: "none", value, write },
  );
}

// ─── The editor, field by field ──────────────────────────────────────────────

/** The rename field, which every category starts with. */
function nameField(S: SignalsPanelState, name: string): SignalFieldView {
  const message = renameError?.name === name ? renameError.message : "";
  return field(
    {
      error: message,
      hasError: message !== "",
      key: "name",
      kind: "text",
      label: "Name",
      prop: "Name",
      signal: name,
      value: name,
    },
    {
      live: "none",
      value: name,
      /*
       * Every refusal SAYS SO. A collision silently kept the old name while the field showed the
       * new one, so the panel and the document disagreed and only the canvas could tell you which
       * had won — and an empty name did the same. The expansion follows the rename so the editor
       * you are typing in is still the one on screen afterwards.
       */
      write: (v: string) => {
        const next = v.trim();
        if (next === name) {
          renameError = null;
          return;
        }
        if (!next) {
          renameError = { message: "A name is required.", name };
        } else if (S.document.state?.[next]) {
          renameError = { message: `"${next}" is already defined by this document.`, name };
        } else {
          renameError = null;
          setDataRowExpanded(name, false);
          setDataRowExpanded(next, true);
          transactDoc(activeTab.value, (t) => mutateRenameDef(t, name, next));
        }
        repaint();
      },
    },
  );
}

/** A plain value entry: its type, its default, and the CEM facts a custom element adds. */
function stateFields(S: SignalsPanelState, name: string, def: SignalDef): SignalFieldView[] {
  const patch = (value: Record<string, JsonValue | undefined>): void => {
    transactDoc(activeTab.value, (t) => mutateUpdateDef(t, name, value));
  };
  const defaultVal = asText(def.default);
  const out: SignalFieldView[] = [
    selectField(
      name,
      "type",
      "Type",
      ["string", "integer", "number", "boolean", "array", "object"],
      def.type || "string",
      (v) => patch({ type: v }),
    ),
  ];
  if (def.type === "string" || !def.type) {
    out.push(
      selectField(name, "format", "Format", ["", "image", "date", "color"], def.format || "", (v) =>
        patch({ format: v || undefined }),
      ),
    );
  }
  if (isMediaFormat(def.format)) {
    out.push(
      field({
        key: "default",
        kind: "slot-field",
        label: "Default",
        prop: "Default",
        signal: name,
        slot: "media",
      }),
    );
    islands.set(`${name}/media`, (host) => {
      mountMediaPicker(host, "default", defaultVal, (v: string) =>
        patch({ default: v || undefined }),
      );
    });
  } else {
    out.push(
      textField(name, "default", "Default", defaultVal, (v: string) => {
        let parsed: unknown = v;
        if (def.type === "integer") {
          parsed = Math.trunc(Number(v)) || 0;
        } else if (def.type === "number") {
          parsed = Number(v) || 0;
        } else if (def.type === "boolean") {
          parsed = v === "true";
        } else if (def.type === "array" || def.type === "object") {
          try {
            parsed = JSON.parse(v);
          } catch {
            parsed = v;
          }
        }
        patch({ default: parsed as JsonValue });
      }),
    );
  }
  out.push(
    textField(name, "description", "Description", def.description || "", (v) =>
      patch({ description: v || undefined }),
    ),
  );
  if (isCustomElementDoc(S)) {
    out.push(
      textField(name, "attribute", "Attribute", def.attribute || "", (v) =>
        patch({ attribute: v || undefined }),
      ),
      field(
        {
          checked: Boolean(def.reflects),
          key: "reflects",
          kind: "checkbox",
          label: "Reflects",
          prop: "reflects",
          signal: name,
        },
        {
          check: (checked) => patch({ reflects: checked || undefined }),
          live: "none",
          value: "",
        },
      ),
      textField(
        name,
        "deprecated",
        "Deprecated",
        typeof def.deprecated === "string" ? def.deprecated : "",
        (v) => patch({ deprecated: v || undefined }),
      ),
    );
  }
  return out;
}

/** A derived value: the expression, and the dependencies it was read out of. */
function computedFields(name: string, def: SignalDef): SignalFieldView[] {
  const expression = def.$compute || "";
  const out: SignalFieldView[] = [
    field(
      {
        key: "expression",
        kind: "multiline",
        label: "Expression",
        prop: "expression",
        rows: "2",
        signal: name,
        value: expression,
      },
      {
        live: "debounce",
        value: expression,
        write: (expr: string) => {
          const depMatches = expr.match(/\$[a-zA-Z_]\w*/g) || [];
          const deps = [...new Set(depMatches)].map((d) => `#/state/${d}`);
          transactDoc(activeTab.value, (t) =>
            mutateUpdateDef(t, name, { $compute: expr, $deps: deps }),
          );
        },
      },
    ),
  ];
  if (def.$deps && def.$deps.length > 0) {
    out.push(
      field({
        key: "dependencies",
        kind: "note",
        label: "Dependencies",
        prop: "dependencies",
        signal: name,
        value: def.$deps.map((d: string) => d.replace("#/state/", "")).join(", "),
      }),
    );
  }
  return out;
}

/** A fetched, stored or constructed value — one case per `$prototype`. */
function dataFields(S: SignalsPanelState, name: string, def: SignalDef): SignalFieldView[] {
  const patch = (value: Record<string, JsonValue | undefined>): void => {
    transactDoc(activeTab.value, (t) => mutateUpdateDef(t, name, value));
  };
  const proto = def.$prototype;

  if (proto === "Request") {
    return [
      textField(name, "url", "URL", def.url || "", (v) => patch({ url: v })),
      selectField(
        name,
        "method",
        "Method",
        ["GET", "POST", "PUT", "DELETE", "PATCH"],
        def.method || "GET",
        (v) => patch({ method: v }),
      ),
      selectField(name, "timing", "Timing", ["client", "server"], def.timing || "client", (v) =>
        patch({ timing: v }),
      ),
    ];
  }
  if (proto === "LocalStorage" || proto === "SessionStorage") {
    const stored = asText(def.default, true);
    return [
      textField(name, "key", "Key", def.key || "", (v) => patch({ key: v })),
      field(
        {
          key: "default",
          kind: "multiline",
          label: "Default",
          prop: "Default",
          rows: "3",
          signal: name,
          value: stored,
        },
        {
          live: "debounce",
          value: stored,
          write: (v: string) => {
            try {
              // `JSON.parse` answers `any`; the value written is a document default, which is a
              // `JsonValue` by construction — naming it keeps the assignment checked.
              patch({ default: JSON.parse(v) as JsonValue });
            } catch {
              patch({ default: v });
            }
          },
        },
      ),
    ];
  }
  if (proto === "IndexedDB") {
    return [
      textField(name, "database", "Database", def.database || "", (v) => patch({ database: v })),
      textField(name, "store", "Store", def.store || "", (v) => patch({ store: v })),
      textField(name, "version", "Version", String(def.version || 1), (v) =>
        patch({ version: Math.trunc(Number(v)) || 1 }),
      ),
    ];
  }
  if (proto === "Cookie") {
    return [
      textField(name, "cookie", "Cookie", def.name || "", (v) => patch({ name: v })),
      textField(name, "default", "Default", String(def.default || ""), (v) =>
        patch({ default: v }),
      ),
    ];
  }
  if (proto === "Set" || proto === "Map" || proto === "FormData") {
    const isForm = proto === "FormData";
    const key = isForm ? "fields" : "default";
    const label = isForm ? "Fields" : "Default";
    const text =
      def.default !== undefined && def.default !== null
        ? JSON.stringify(def.default, null, 2)
        : isForm
          ? JSON.stringify(def.fields || {}, null, 2)
          : "";
    return [
      field(
        { key, kind: "multiline", label, prop: label, rows: "3", signal: name, value: text },
        {
          live: "debounce",
          value: text,
          write: (v: string) => {
            try {
              patch({ [key]: JSON.parse(v) as JsonValue });
            } catch {}
          },
        },
      ),
    ];
  }
  return externalFields(S, name, def);
}

/**
 * An external `$prototype` — its source, and the config form its own schema describes.
 *
 * The schema arrives asynchronously and is cached, so the field list says "Loading schema…" once
 * and the fetch's resolution is what repaints the panel with the form in it.
 */
function externalFields(S: SignalsPanelState, name: string, def: SignalDef): SignalFieldView[] {
  const patch = (value: Record<string, JsonValue | undefined>): void => {
    transactDoc(activeTab.value, (t) => mutateUpdateDef(t, name, value));
  };
  const importedPath = def.$prototype
    ? projectState?.projectConfig?.imports?.[def.$prototype]
    : null;
  const out: SignalFieldView[] = [];

  if (importedPath) {
    out.push(field({ key: "prototype", kind: "hint", signal: name, value: def.$prototype || "" }));
  } else {
    out.push(
      textField(name, "src", "Source", def.$src || "", (v) => {
        patch({ $src: v || undefined });
        pluginSchemaCache.delete(`${v}::${def.$prototype}`);
      }),
      textField(name, "kind", "Kind", def.$prototype || "", (v) => {
        patch({ $prototype: v || undefined });
        pluginSchemaCache.delete(`${def.$src}::${v}`);
      }),
    );
  }
  if (def.$export) {
    out.push(
      textField(name, "export", "Export", def.$export || "", (v) =>
        patch({ $export: v || undefined }),
      ),
    );
  }

  const resolvedSrc = def.$src || importedPath;
  if (!resolvedSrc || !def.$prototype) {
    return out;
  }
  const cacheKey = `${resolvedSrc}::${def.$prototype}`;
  if (!pluginSchemaCache.has(cacheKey)) {
    out.push(
      field({ key: "schema-loading", kind: "hint", signal: name, value: "Loading schema…" }),
    );
    /* ONE request per schema, not one per repaint. `fetchPluginSchema` caches what it got but has
       nothing in flight to answer with, so two projections between the ask and the reply sent the
       same request twice — and the Navigator repaints on every document change. */
    if (!schemaRequests.has(cacheKey)) {
      schemaRequests.add(cacheKey);
      void fetchPluginSchema(def, {
        ...(S.documentPath != null && { documentPath: S.documentPath }),
      })
        .then((schema) => {
          if (schema) {
            repaint();
          }
        })
        .finally(() => schemaRequests.delete(cacheKey));
    }
    return out;
  }
  const schema = pluginSchemaCache.get(cacheKey);
  if (!schema) {
    return out;
  }
  if (schema.description) {
    out.push(field({ key: "schema-note", kind: "hint", signal: name, value: schema.description }));
  }
  out.push(field({ key: "schema", kind: "slot", signal: name, slot: "schema" }));
  islands.set(`${name}/schema`, (host) => {
    placeSchemaForm(host, schema as JsonSchema, def, name, S);
  });
  return out;
}

/** Write one of the three CEM text columns, dropping the key when the value is emptied. */
function writeCemField<T extends CemParameter | CemEvent>(
  entry: T,
  column: string,
  value: string,
): T {
  if (column === "name") {
    return { ...entry, name: value };
  }
  if (column === "type") {
    const { type: _type, ...rest } = entry;
    return (value ? { ...rest, type: { text: value } } : rest) as T;
  }
  const { description: _description, ...rest } = entry;
  return (value ? { ...rest, description: value } : rest) as T;
}

/** One text column of a CEM table. */
function cemCell(
  key: string,
  placeholder: string,
  value: string,
  grow: string,
): Omit<SignalCellView, "field" | "row" | "signal"> {
  return { checked: false, grow, key, kind: "text", label: placeholder, placeholder, value };
}

/** One row of a CEM table, with the identity every cell in it has to carry. */
function cemRow(
  signal: string,
  fieldKey: string,
  key: string,
  label: string,
  cells: Omit<SignalCellView, "field" | "row" | "signal">[],
): SignalCellRowView {
  return {
    cells: cells.map((cell) => ({ ...cell, field: fieldKey, row: key, signal })),
    field: fieldKey,
    key,
    removeLabel: `Remove ${label}`,
    signal,
  };
}

/** The CEM parameter editor, in whichever of its two views is open. */
function parameterField(name: string, def: SignalDef): SignalFieldView {
  const params = (def.parameters || []).map((p) => normParam(p));
  const advanced = advancedParamOpen.has(name);
  const write = (next: CemParameter[]): void => {
    transactDoc(activeTab.value, (t) =>
      mutateUpdateDef(t, name, { parameters: next.length > 0 ? next : undefined }),
    );
  };
  const plan: FieldPlan = {
    addChip: (value: string) => {
      const trimmed = value.trim();
      if (trimmed) {
        write([...params, { name: trimmed }]);
      }
    },
    addRow: () => {
      transactDoc(activeTab.value, (t) =>
        mutateUpdateDef(t, name, { parameters: [...params, { name: "" }] }),
      );
    },
    cell: (row: string, cell: string, value: string) => {
      const next = [...params];
      const current = next[Number(row)];
      if (!current) {
        return;
      }
      next[Number(row)] = writeCemField(current, cell, value);
      write(next);
    },
    cellCheck: (row: string, _cell: string, checked: boolean) => {
      const next = [...params];
      const current = next[Number(row)];
      if (!current) {
        return;
      }
      const { optional: _optional, ...rest } = current;
      next[Number(row)] = checked ? { ...rest, optional: true } : rest;
      write(next);
    },
    dropChip: (chip: string) => write(params.filter((_, j) => j !== Number(chip))),
    dropRow: (row: string) => write(params.filter((_, j) => j !== Number(row))),
    live: "none",
    press: (action: string) => {
      if (action !== "footer") {
        return;
      }
      if (advanced) {
        advancedParamOpen.delete(name);
      } else {
        advancedParamOpen.add(name);
      }
      repaint();
    },
    value: "",
  };

  if (!advanced) {
    const chips: SignalChipView[] = params.map((p, i) => ({
      field: "parameters",
      key: String(i),
      label: p.name || "?",
      removeLabel: `Remove ${p.name || "parameter"}`,
      signal: name,
    }));
    return field(
      {
        addLabel: "Add a parameter",
        chips,
        footer: "▸ Advanced",
        hasFooter: true,
        key: "parameters",
        kind: "chips",
        label: "Parameters",
        prop: "parameters",
        signal: name,
      },
      plan,
    );
  }
  return field(
    {
      addLabel: "Add parameter",
      cellRows: params.map((p, i) =>
        cemRow(name, "parameters", String(i), p.name || "parameter", [
          cemCell("name", "name", p.name || "", "1"),
          cemCell("type", "type", cemTypeText(p.type), "1"),
          cemCell("description", "desc", p.description || "", "2"),
          {
            checked: Boolean(p.optional),
            grow: "0",
            key: "optional",
            kind: "checkbox",
            label: "Optional",
            placeholder: "",
            value: "",
          },
        ]),
      ),
      footer: "▾ Basic",
      hasFooter: true,
      key: "parameters",
      kind: "rows",
      label: "Parameters",
      prop: "parameters",
      signal: name,
      span: true,
    },
    plan,
  );
}

/** The CEM emits editor — the same table shape, over `emits`. */
function emitsField(name: string, def: SignalDef): SignalFieldView {
  const emits = def.emits || ([] as CemEvent[]);
  const write = (next: CemEvent[]): void => {
    transactDoc(activeTab.value, (t) =>
      mutateUpdateDef(t, name, { emits: next.length > 0 ? next : undefined }),
    );
  };
  return field(
    {
      addLabel: "Add event",
      cellRows: emits.map((e, i) =>
        cemRow(name, "emits", String(i), e.name || "event", [
          cemCell("name", "event name", e.name || "", "1"),
          cemCell("type", "type", cemTypeText(e.type), "1"),
          cemCell("description", "description", e.description || "", "2"),
        ]),
      ),
      key: "emits",
      kind: "rows",
      label: "Emits",
      prop: "emits",
      signal: name,
      span: true,
    },
    {
      addRow: () => {
        transactDoc(activeTab.value, (t) =>
          mutateUpdateDef(t, name, { emits: [...emits, { name: "" }] }),
        );
      },
      cell: (row: string, cell: string, value: string) => {
        const next = [...emits];
        const current = next[Number(row)];
        if (!current) {
          return;
        }
        next[Number(row)] = writeCemField(current, cell, value);
        write(next);
      },
      dropRow: (row: string) => write(emits.filter((_, j) => j !== Number(row))),
      live: "none",
      value: "",
    },
  );
}

/**
 * A function: what it is for, what it takes, what it emits, and its body.
 *
 * Structured bodies (spec §20) are a body MODE rather than a new entity: "Statements" is the
 * statement-card editor over `body: JxStatement[]`, "Code" is the text path over `body: string`.
 * Switching modes replaces the body with the other representation's empty seed — an explicit mode
 * change, nothing is converted.
 */
function functionFields(S: SignalsPanelState, name: string, def: SignalDef): SignalFieldView[] {
  const patch = (value: Record<string, JsonValue | undefined>): void => {
    transactDoc(activeTab.value, (t) => mutateUpdateDef(t, name, value));
  };
  const out: SignalFieldView[] = [
    textField(name, "description", "Description", def.description || "", (v) =>
      patch({ description: v || undefined }),
    ),
    parameterField(name, def),
  ];
  if (isCustomElementDoc(S)) {
    out.push(emitsField(name, def));
  }

  if (def.$src) {
    out.push(
      textField(name, "src", "Source", def.$src || "", (v) => patch({ $src: v || undefined })),
      textField(name, "export", "Export", def.$export || "", (v) =>
        patch({ $export: v || undefined }),
      ),
    );
    return out;
  }

  const statements = Array.isArray(def.body);
  out.push(
    field(
      {
        buttons: statements
          ? []
          : [
              {
                field: "body",
                icon: "code",
                key: "editor",
                label: "Open in code editor",
                signal: name,
              },
            ],
        key: "body",
        kind: "bar",
        label: "Body",
        prop: "Body",
        segments: [
          {
            field: "body",
            key: "statements",
            label: "Statements",
            selected: statements,
            signal: name,
          },
          { field: "body", key: "code", label: "Code", selected: !statements, signal: name },
        ],
        signal: name,
      },
      {
        live: "none",
        press: (action: string) => {
          if (action === "statements" && !statements) {
            patch({ body: [] });
            repaint();
          } else if (action === "code" && statements) {
            patch({ body: "" });
            repaint();
          } else if (action === "editor") {
            // Target AND reveal, in one call. See the formula button below.
            openLogicTarget({ editing: { defName: name, type: "def" }, surface: "function" });
          }
        },
        value: "",
      },
    ),
  );

  if (statements) {
    out.push(field({ key: "statements", kind: "slot", signal: name, slot: "statements" }));
    islands.set(`${name}/statements`, (host) => {
      mountStatementEditor(
        host,
        def.body as JxStatement[],
        (next) => {
          patch({ body: next as unknown as JsonValue });
          repaint();
        },
        {
          allowEventRef: true,
          emits: def.emits ?? [],
          // This editor is in the Navigator's Data panel; the Events tab's is not.
          region: NAVIGATOR_STATEMENTS_REGION,
          stateDefs: Object.keys(S.document.state || {}),
          stateEntries: S.document.state || {},
        },
      );
    });
    return out;
  }
  const source = typeof def.body === "string" ? def.body : "";
  out.push(
    field(
      {
        key: "code",
        kind: "code",
        label: "Body",
        prop: "Body",
        rows: "3",
        signal: name,
        value: source,
      },
      { live: "commit", value: source, write: (v: string) => patch({ body: v }) },
    ),
  );
  return out;
}

/** An assignment or a call the page performs — edited as a formula tree. */
function expressionFields(S: SignalsPanelState, name: string, def: SignalDef): SignalFieldView[] {
  const exprNode = def.$expression || { operator: "=", target: null };
  const out: SignalFieldView[] = [
    field(
      {
        buttons: [
          {
            field: "expression",
            icon: "align-bottom",
            key: "formula",
            label: "Open in formula workspace",
            signal: name,
          },
        ],
        key: "expression",
        kind: "bar",
        label: "Expression",
        prop: "Expression",
        signal: name,
      },
      {
        live: "none",
        /* One call, because a click is BOTH events: it names the target and it asks for the
           surface. Setting the field alone leaned on the dock's reveal effect, which fires at most
           once per target — so clicking this again after closing the dock was a dead click. It also
           left `editingFunction` set, and that one wins the tie. */
        press: () =>
          openLogicTarget({ editing: { defName: name, type: "def" }, surface: "formula" }),
        value: "",
      },
    ),
    field({ key: "editor", kind: "slot", signal: name, slot: "expression" }),
  ];
  islands.set(`${name}/expression`, (host) => {
    mountExpressionEditor(
      host,
      exprNode,
      (newNode: unknown) =>
        transactDoc(activeTab.value, (t) =>
          // Expression editors emit JSON expression nodes.
          mutateUpdateDef(t, name, { $expression: newNode as JsonValue }),
        ),
      {
        allowEventRef: false,
        // Live-context evaluation in the canvas iframe, snapshot fallback (M6). The panel lives
        // In the Navigator — re-render it when a fresh live result lands.
        preview: livePreviewExpression(activeTab.value, `def:${name}`, exprNode, null, () =>
          renderOnly("leftPanel"),
        ),
        onInsertDef: (defName, vendored) =>
          transactDoc(activeTab.value, (t) =>
            mutateAddDef(t, defName, vendored as Record<string, JsonValue>),
          ),
        stateDefs: Object.keys(S.document.state || {}),
        stateEntries: S.document.state || {},
      },
    );
  });
  return out;
}

/** Every field of one entry's editor, in the order they are read. */
function editorFields(S: SignalsPanelState, name: string, def: SignalDef): SignalFieldView[] {
  const head = nameField(S, name);
  switch (defCategory(def)) {
    case "state": {
      return [head, ...stateFields(S, name, def)];
    }
    case "computed": {
      return [head, ...computedFields(name, def)];
    }
    case "data": {
      return [head, ...dataFields(S, name, def)];
    }
    case "function": {
      return [head, ...functionFields(S, name, def)];
    }
    case "expression": {
      return [head, ...expressionFields(S, name, def)];
    }
    default: {
      return [head];
    }
  }
}

// ─── Plugin schema-driven form ───────────────────────────────────────────────

/**
 * Resolve a schema context pointer for signal config forms — a thin wrapper over the generic
 * `resolveContextPointer` making the content-type roots always-present (a missing section resolves
 * to `{}` → empty choices rather than a plain textfield): the parser's real descriptors point at
 * the `#/$context/content` root, while the deprecated `"$contentTypes"` string sentinel and the
 * legacy `#/$context/contentTypes` root keep resolving bit-for-bit for old class descriptors.
 *
 * @param {string} pointer
 * @param {Record<string, unknown>} [scope] - Parent def for `{@param}` substitution
 * @returns {unknown}
 */
function resolveSignalsContextPointer(pointer: string, scope?: Record<string, unknown>): unknown {
  if (pointer === "#/$context/content") {
    return projectState?.projectConfig?.content ?? {};
  }
  if (pointer === "$contentTypes" || pointer === "#/$context/contentTypes") {
    return projectState?.projectConfig?.contentTypes ?? {};
  }
  return resolveContextPointer(pointer, {
    projectConfig: (projectState?.projectConfig ?? {}) as Record<string, unknown>,
    ...(scope !== undefined && { scope }),
  });
}

/**
 * Put the shared schema form into the node the document made for it.
 *
 * `ui/schema-form.ts` is a document too, and a document CLEARS the host it is given — so what comes
 * back is the form's own host element rather than a template, and this function's whole job is to
 * place it. Calling `mountSchemaForm` again with the same key updates the standing form in place,
 * which is what keeps the caret in a field across the repaint a commit provokes.
 *
 * @param {HTMLElement} host - The empty node the document drew
 * @param {JsonSchema} schema - The plugin's own schema
 * @param {SignalDef} def - The entry being configured
 * @param {string} name - The entry's name
 * @param {SignalsPanelState} S - The focused document
 */
function placeSchemaForm(
  host: HTMLElement,
  schema: JsonSchema,
  def: SignalDef,
  name: string,
  S: SignalsPanelState,
): void {
  if (!schema.properties) {
    host.replaceChildren();
    return;
  }
  const properties = Object.fromEntries(
    Object.entries(schema.properties).filter(([prop]) => !STUDIO_RESERVED_KEYS.has(prop)),
  );
  const form = mountSchemaForm(
    `signal:${name}`,
    { ...schema, properties },
    def as Record<string, unknown>,
    {
      context: {
        fieldKeyPrefix: name,
        params: dynamicRouteParams(S.documentPath),
        resolvePointer: resolveSignalsContextPointer,
        // A config value may point at any signal but this one — a def that reads itself is a cycle.
        signals: bindableSignalNames(S.document).filter((signal) => signal !== name),
      },
      onChange: (patch) => transactDoc(activeTab.value, (t) => mutateUpdateDef(t, name, patch)),
      rerender: repaint,
    },
  );
  if (form.parentNode !== host) {
    host.replaceChildren(form);
  }
}

// ─── The projection ──────────────────────────────────────────────────────────

/**
 * ONE summary slot per row, and the resolved value wins it as soon as there is one.
 *
 * The row wants to say four things about an entry — its category, its name, how it is defined and
 * what it became — and a 240px Navigator fits three. Eliding both summaries to make room produced
 * "recentproje… C… Array(3)": two truncated descriptions and a truncated identity. So the
 * definition hint holds the slot until the canvas resolves a value and then steps aside for it, and
 * the full definition is one click down in fields — which is what the hint was abbreviating.
 *
 * The switch is whether the canvas has reported a scope AT ALL, not whether this entry appears in
 * it. An entry the canvas ran and did not produce is "pending", which is a fact about the value; a
 * panel opened before the canvas has rendered knows nothing about any of them, and guessing
 * "pending" for the whole list there would be a fact about the panel dressed up as one about data.
 *
 * ENTRIES THAT CANNOT HOLD A VALUE never get the column. A function and an assignment expression
 * are things the page DOES, not things it knows, and they are absent from the resolved scope for
 * exactly that reason — so the value column called all eight of a component's `setFilter` handlers
 * "pending", which reads as "still loading" for something that will never load.
 */
function summary(
  name: string,
  def: SignalDef,
  live: unknown,
  resolved: boolean,
): { summary: string; summaryTitle: string; summaryTone: string } {
  const holdsNoValue =
    defCategory(def) === "function" ||
    (def.$expression != null && isActionExpression(def.$expression));
  if (!resolved || holdsNoValue) {
    const hint = defHint(name, def);
    return { summary: hint, summaryTitle: hint, summaryTone: "hint" };
  }
  return {
    summary: dataTypeLabel(live),
    summaryTitle: "What this resolved to on the canvas",
    summaryTone: unwrapSignal(live) === null ? "pending" : "value",
  };
}

/** The five categories, in the order the panel lists them. */
const CATEGORY_LABELS: readonly { key: string; label: string }[] = [
  { key: "state", label: "State" },
  { key: "computed", label: "Computed" },
  { key: "data", label: "Data" },
  { key: "expression", label: "Expressions" },
  { key: "function", label: "Functions" },
];

/**
 * The picker's fixed rows.
 *
 * GROUPED rather than divided: `jx-select` draws both halves of a group's delimiter, so the three
 * unlabelled `sp-menu-divider`s this replaces are named runs a reader can aim at.
 */
const ADD_GROUPS: readonly SignalOptionGroup[] = [
  {
    id: "values",
    label: "Values",
    rows: [
      { label: "Value", value: "state" },
      { label: "Computed", value: "computed" },
    ],
  },
  {
    id: "sources",
    label: "Data sources",
    rows: [
      { label: "Fetch from a URL", value: "request" },
      { label: "LocalStorage", value: "localStorage" },
      { label: "SessionStorage", value: "sessionStorage" },
      { label: "IndexedDB", value: "indexedDB" },
      { label: "Cookie", value: "cookie" },
      { label: "Set", value: "set" },
      { label: "Map", value: "map" },
      { label: "FormData", value: "formData" },
      { label: "From a module…", value: "external" },
    ],
  },
  {
    id: "logic",
    label: "Logic",
    rows: [
      { label: "Expression", value: "expression" },
      { label: "Function", value: "function" },
    ],
  },
];

/** Everything the surface should be showing, from the panel state it was last handed. */
export function signalsView(S: SignalsPanelState, ctx: SignalsPanelCtx): SignalsView {
  plans.clear();
  islands.clear();

  const defs = S.document.state || {};
  const entries = Object.entries(defs);
  /* What the canvas actually resolved these to. `S.canvas` is the session's canvas record, so this
     costs a property read — the panel already had the scope in hand. */
  const liveScope = (S.canvas?.scope ?? null) as Record<string, unknown> | null;
  const scope = liveScope ?? {};
  /* A Refresh is out and the canvas has not answered. Read off the tab, so it survives the repaints
     between the press and the `dataScope` that ends it. */
  const refreshing = S.canvas?.refreshing === true;

  /* Warm the extensions payload so manifest state classes appear in the add picker (the panel
     re-renders constantly; loadExtensions memoizes, so this is a one-time fetch per project). */
  void loadExtensions();

  const grouped = new Map<string, [string, SignalDef][]>(
    CATEGORY_LABELS.map(({ key }) => [key, []]),
  );
  for (const [name, raw] of entries) {
    grouped.get(defCategory(raw))?.push([name, asSignalDef(raw)]);
  }

  S._collapsedSignalCats ||= new Set();
  const collapsed = S._collapsedSignalCats;

  const categories: SignalCategoryView[] = [];
  for (const { key, label } of CATEGORY_LABELS) {
    const items = grouped.get(key) ?? [];
    if (items.length === 0) {
      continue;
    }
    const rows: SignalRowView[] = items.map(([name, def]) => {
      const expanded = isDataRowExpanded(name);
      const live = scope[name];
      if (expanded) {
        islands.set(`${name}/tree`, (host) => {
          paintDataTree(host, unwrapSignal(live), name, repaint);
        });
      }
      return {
        badge: defBadgeLabel(def),
        category: defCategory(def),
        categoryLabel: label,
        deleteLabel: `Delete ${name}`,
        expanded,
        fields: expanded ? editorFields(S, name, def) : [],
        key: name,
        liveLabel: "Resolved to",
        name,
        ...summary(name, def, live, liveScope !== null),
      };
    });
    categories.push({ key, label: `${label} (${items.length})`, open: !collapsed.has(key), rows });
  }

  const groups = [...ADD_GROUPS];
  const imports = projectState?.projectConfig?.imports;
  if (imports) {
    groups.splice(2, 0, {
      id: "imports",
      label: "Project imports",
      rows: Object.keys(imports).map((k) => ({ label: k, value: `import:${k}` })),
    });
  }
  const classes = extensionStateClasses();
  if (classes.length > 0) {
    groups.splice(imports ? 3 : 2, 0, {
      id: "extensions",
      label: "Extensions",
      rows: classes.map((cls) => ({ label: cls.name, value: `ext:${cls.name}` })),
    });
  }

  return {
    addGroups: groups,
    addOptions: [{ label: "+ Add…", value: "" }],
    addValue: "",
    categories,
    emptyMessage:
      "Data lives here — values this page can read, compute or fetch, " +
      "ready to bind to any element.",
    listState: entries.length === 0 ? "empty" : "listed",
    refreshState: ctx.refreshData && entries.length > 0 ? (refreshing ? "busy" : "idle") : "none",
    refreshing,
  };
}

// ─── Adding an entry ─────────────────────────────────────────────────────────

/** The first free name of the form `<base>`, `<base>1`, `<base>2`… */
function freeName(S: SignalsPanelState, base: string): string {
  let candidate = base;
  let i = 1;
  while (S.document.state && S.document.state[candidate]) {
    candidate = base + i;
    i += 1;
  }
  return candidate;
}

/**
 * Add a def from one of the built-in templates under a free name, and expand it for editing. Shared
 * by the "+ Add…" picker and the panel's empty state, so both create the same thing.
 */
function addTemplateDef(type: string, S: SignalsPanelState): void {
  const template = DEF_TEMPLATES[type];
  if (!template) {
    return;
  }
  const name = freeName(S, type === "function" ? "newFunction" : "$newSignal");
  transactDoc(activeTab.value, (t) =>
    mutateAddDef(t, name, structuredClone(template) as Record<string, JsonValue>),
  );
  setDataRowExpanded(name, true);
  repaint();
}

/** The name a prototype-backed entry is created under: `$contentCollection` for `ContentCollection`. */
function prototypeName(S: SignalsPanelState, proto: string): string {
  return freeName(S, `$${proto.charAt(0).toLowerCase()}${proto.slice(1)}`);
}

/** Create the entry the picker names — a template, an extension class, or a project import. */
function addSignalOfType(type: string): void {
  const S = panelState;
  if (!S || !type) {
    return;
  }
  /* Extension-manifest state classes ("ext:Session"): no $src needed — the registry resolves them;
     the descriptor's stateDefaults seed the def (e.g. timing "client"). */
  if (type.startsWith("ext:")) {
    const proto = type.slice(4);
    const cls = extensionStateClasses().find((c) => c.name === proto);
    const name = prototypeName(S, proto);
    transactDoc(activeTab.value, (t) =>
      mutateAddDef(t, name, {
        $prototype: proto,
        ...cls?.stateDefaults,
      } as Record<string, JsonValue>),
    );
    setDataRowExpanded(name, true);
    repaint();
    return;
  }
  /* A project import ("import:ContentCollection") is the prototype name and nothing else — the
     registry resolves the path. The schema is NOT fetched here: the entry is opened, and an open
     entry's field list is what asks for it (see {@link externalFields}), which repaints when it
     lands. Fetching in both places sent the same request twice. */
  if (type.startsWith("import:")) {
    const proto = type.slice(7);
    const name = prototypeName(S, proto);
    transactDoc(activeTab.value, (t) =>
      mutateAddDef(t, name, { $prototype: proto } as Record<string, JsonValue>),
    );
    setDataRowExpanded(name, true);
    repaint();
    return;
  }
  addTemplateDef(type, S);
}

// ─── The panel ───────────────────────────────────────────────────────────────

/** Ask the Navigator to paint again. Every action ends here or in a transaction. */
function repaint(): void {
  panelCtx?.renderLeftPanel();
}

/** The plan a control names, or `undefined` if the projection has moved on without it. */
function planFor(signal: string, fieldKey: string): FieldPlan | undefined {
  return plans.get(planKey(signal, fieldKey));
}

/** Write a value now, cancelling any debounce that was waiting to write the same field. */
function commitNow(signal: string, fieldKey: string, value: string): void {
  const key = planKey(signal, fieldKey);
  clearTimeout(timers.get(key));
  timers.delete(key);
  const plan = plans.get(key);
  if (!plan?.write || value === plan.value) {
    return;
  }
  plan.write(value);
}

/** Everything a control in the document may ask for. */
const ACTIONS: SignalsActions = {
  addChip: (signal, fieldKey, value) => planFor(signal, fieldKey)?.addChip?.(value),
  addRow: (signal, fieldKey) => planFor(signal, fieldKey)?.addRow?.(),
  addSignal: (type) => addSignalOfType(type),
  checkCell: (signal, fieldKey, row, cell, checked) =>
    planFor(signal, fieldKey)?.cellCheck?.(row, cell, checked),
  checkField: (signal, fieldKey, checked) => planFor(signal, fieldKey)?.check?.(checked),
  commitField: (signal, fieldKey, value) => commitNow(signal, fieldKey, value),
  dropChip: (signal, fieldKey, chip) => planFor(signal, fieldKey)?.dropChip?.(chip),
  dropRow: (signal, fieldKey, row) => planFor(signal, fieldKey)?.dropRow?.(row),
  dropSignal: (name) => transactDoc(activeTab.value, (t) => mutateRemoveDef(t, name)),
  editCell: (signal, fieldKey, row, cell, value) =>
    planFor(signal, fieldKey)?.cell?.(row, cell, value),
  /*
   * What a KEYSTROKE is worth is the field's own answer, which is why the document asks the same
   * question of every control and this decides. A rename committed per keystroke would rename the
   * entry eight times on the way to a nine-letter name.
   */
  inputField: (signal, fieldKey, value) => {
    const key = planKey(signal, fieldKey);
    const plan = plans.get(key);
    if (!plan?.write || plan.live === "none") {
      return;
    }
    if (plan.live === "commit") {
      plan.write(value);
      return;
    }
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        plans.get(key)?.write?.(value);
      }, DEBOUNCE_MS),
    );
  },
  pressField: (signal, fieldKey, action) => planFor(signal, fieldKey)?.press?.(action),
  refresh: () => {
    panelCtx?.refreshData?.();
    repaint();
  },
  toggleCategory: (key, open) => {
    const collapsed = panelState?._collapsedSignalCats;
    if (!collapsed) {
      return;
    }
    if (open) {
      collapsed.delete(key);
    } else {
      collapsed.add(key);
    }
    repaint();
  },
  toggleRow: (name) => {
    setDataRowExpanded(name, !isDataRowExpanded(name));
    repaint();
  },
};

/**
 * Fill one island: the four foreign surfaces an entry's editor embeds, plus its value tree.
 *
 * The painters are closures the projection built, so each is already holding the def that is on
 * screen; a host whose entry has since gone finds nothing and is emptied rather than being painted
 * from a stale closure.
 *
 * @param {HTMLElement} host - The empty node the document drew
 * @param {string} signal - The entry it belongs to
 * @param {string} slot - `expression`, `statements`, `media`, `schema` or `tree`
 */
function paintIsland(host: HTMLElement, signal: string, slot: string): void {
  const painter = islands.get(`${signal}/${slot}`);
  if (painter) {
    painter(host);
    return;
  }
  host.replaceChildren();
}

/** The mounted surface, and the container it is standing in. */
let standing: { handle: SignalsSurfaceHandle; host: HTMLElement } | null = null;

/**
 * Draw the Data panel — mounting the document the first time, and projecting into it every time
 * after.
 *
 * The document goes into `.panel-content`, not into the `.panel-body` this is handed, for the
 * reason `panels/git-panel.ts` states: only one of them is the node lit renders this panel's body
 * into, and appending to the other would leave the panel drawn under whatever the Navigator paints
 * next.
 *
 * A container that has CHANGED means the Navigator rebuilt the panel, so the panel-local record of
 * which parameter editor is in its advanced view — and which rename was refused — starts over with
 * it. Neither belongs to the document, and neither should outlive the panel that was showing it.
 *
 * @param {HTMLElement} host - The painted `.panel-body`
 * @param {SignalsPanelState} S - The focused document, as the Navigator reads it
 * @param {SignalsPanelCtx} ctx - The repaint, and the Refresh verb
 */
export function mountSignalsPanel(
  host: HTMLElement,
  S: SignalsPanelState,
  ctx: SignalsPanelCtx,
): void {
  const container = host.querySelector<HTMLElement>(".panel-content") ?? host;
  panelState = S;
  panelCtx = ctx;
  /* A row the reader collapsed took its tree's host out of the page, and the tree registry holds a
     host by reference — this is the one moment a closed tree can be taken down. */
  disposeDetachedDataTrees();
  if (standing && (standing.host !== container || !standing.handle.attached())) {
    standing.handle.dispose();
    standing = null;
    advancedParamOpen.clear();
    schemaRequests.clear();
    renameError = null;
  }
  const view = signalsView(S, ctx);
  if (standing) {
    standing.handle.update(view);
    return;
  }
  standing = {
    handle: mountSignalsSurface(container, view, ACTIONS, paintIsland),
    host: container,
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/* THE ROW VERB IS `data.expandRow` — one gesture, one command.
   `state.selectSignal` opened exactly one editor and `data.expandRow` opened any number of value
   trees, on the same rows, from two panels. Merging the panels merged the verbs, and the survivor
   is the one that names the state it ends in (`{expanded: false}` collapses, running it twice
   photographs the same picture) rather than the one whose only argument was a new selection. */

/** The state entries the open document defines. */
function definedSignalNames(): string[] {
  return Object.keys(activeTab.value?.doc.document?.state ?? {});
}

/* THE VERB NEEDS NOTHING FROM ITS HOST ANY MORE.
   `SignalsCommandDeps` carried `renderLeftPanel` for `state.selectSignal`, which is gone; the one
   verb left reveals its own surface through `openLogicTarget`. A dep with no reader is an
   invitation to write the wrong thing through it, which is why the parameter went with it. */

/**
 * Open a state entry's formula in the Bottom dock.
 *
 * It used to be an XPath press matching the row's RENDERED NAME, which plan §13's R1 forbids
 * outright: a panel that starts eliding long names, or grouping differently, breaks a shot by
 * improving the app. The document defines these names, so the document is what validates them.
 *
 * It defaults its target to the one open Data row — the button it replaces is rendered inside that
 * entry's own editor, so "the one that is open" is what a reader means, and with several open it
 * asks rather than guesses. It REFUSES a signal with no `$expression`: the workspace edits an
 * expression tree, and opening it over a plain state entry used to paint an empty canvas takeover.
 *
 * It goes through `openLogicTarget` rather than the canvas repaint it used to fire, for the same
 * reason the panel BUTTONS do. A command is the palette's and the automation's door:
 * `formula.editDef` and `formula.editEvent` both leave the surface on screen when they return, and
 * a verb that merely arms a dock the user has collapsed would report success while showing nothing.
 * The reveal is idempotent.
 *
 * @returns {AnyCommand[]}
 */
export function signalsCommands(): AnyCommand[] {
  /** The named entry, or a refusal listing what the document does define. */
  function requireDef(commandId: string, name: string): SignalDef {
    const defs = (activeTab.value?.doc.document?.state ?? {}) as Record<string, SignalDef>;
    const def = defs[name];
    if (!def) {
      const defined = definedSignalNames();
      throw new RangeError(
        `command "${commandId}" argument "name": "${name}" is not a state entry this document ` +
          `defines — it defines: ${defined.length > 0 ? defined.join(", ") : "nothing"}`,
      );
    }
    return def;
  }

  return [
    {
      args: {
        additionalProperties: false,
        properties: {
          defName: stringProperty(
            "The state entry whose $expression to edit. Defaults to the selected one.",
          ),
        },
        required: [],
        type: "object",
      },
      category: "Document",
      id: "formula.openWorkspace",
      level: "document",
      menus: ["palette"],
      group: "5_data",
      requires: "a selected state entry that holds a formula",
      when: (ctx) => ctx.document.open,
      run: (_commandCtx, args) => {
        const named = optionalStringArg("formula.openWorkspace", args, "defName");
        // With no argument the target is the one open row — and only if there is exactly one.
        // Multiple rows open is now the normal state of this panel, so "the selected one" has to
        // Refuse an ambiguous answer rather than pick the first key it happens to enumerate.
        const open = expandedDataRows();
        const defName = named ?? (open.length === 1 ? open[0]! : null);
        if (defName === null) {
          throw new RangeError(
            open.length > 1
              ? `command "formula.openWorkspace" needs a target: ${open.length} Data rows are ` +
                  `open (${open.join(", ")}), so pass "defName"`
              : `command "formula.openWorkspace" needs a target: pass "defName", or open a state ` +
                  `entry's row first with data.expandRow`,
          );
        }
        const def = requireDef("formula.openWorkspace", defName);
        if (!def.$expression) {
          throw new RangeError(
            `command "formula.openWorkspace" argument "defName": "${defName}" holds no ` +
              `$expression — the workspace edits formulas, and this entry is not one`,
          );
        }
        // The workspace reads its target off the tab; the Bottom dock's Logic tab is where it
        // Draws. Nothing on the canvas depends on this field any more.
        openLogicTarget({ editing: { defName, type: "def" }, surface: "formula" });
      },
      title: "Open Formula Workspace",
    },
  ];
}

/**
 * Register the State panel's verbs.
 *
 * @param {CommandRegistry} registry
 */
export function registerSignalsCommands(registry: CommandRegistry): void {
  registry.registerAll(signalsCommands());
}

/* THE STATE PANEL IS GONE, AND ITS EDITOR IS IN DATA — `panels/data-explorer.ts`.
   It was registered here `rail: false`, waiting for plan §11.2's merge into Data, and the merge did
   not follow: the button was removed and the editor was left reachable only by typing "State" into
   the palette. Declaring a state variable — or a component property, which is a state entry with a
   default — is not an advanced move to hide behind a search box, so the entry list is now the Data
   panel's own document and there is no second record. A stored `leftTab: "state"` migrates to
   `data` in `shell.ts`. */
