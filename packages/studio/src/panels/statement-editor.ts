/// <reference lib="dom" />
// oxlint-disable unicorn/no-thenable -- `then` is the JSON Schema conditional keyword (spec.md §20), not a promise
/**
 * Statement editor (`spec.md` §20) — the FLOW behind the `statements` surface.
 *
 * A Function entry's `body: JxStatement[]` is edited here as structure rather than as text: bare
 * expression nodes (mutation or `call`), `if`/`then`/`else` branches, `$switch`/`cases` multiway
 * branches, and WHATWG `dispatchEvent` statements. All edits flow through `onChange(next)`
 * immutably — no statement object is mutated in place.
 *
 * **The markup left.** It is `surfaces/statements.json`, mounted by `surfaces/statements.ts`, and
 * what is here is the part that was never markup: which kind a statement is, which lane a card
 * lives in, what a fresh statement is seeded with, how the tree is rewritten around an edit, and
 * how a card is dragged.
 *
 * **The tree is FLATTENED on this side of the seam.** A statement nests to any depth — an `if`
 * holds two lanes, a `$switch` one per case plus a default, and either may hold another of both —
 * while a document's one repeater walks a LIST. So {@link flattenStatements} walks the tree once in
 * reading order and emits rows that carry their own indent, exactly as `panels/data-explorer.ts`
 * does for a value tree. Recursion is a property of the walk; the markup has none.
 *
 * Two things the conversion settled, and each was a defect rather than a translation:
 *
 * - **The drag feedback finally draws.** `dragging`, `drop-above` and `drop-below` were class toggles
 *   with no rule in any stylesheet in the package, so a card being dragged looked exactly like one
 *   that was not. They are `data-dragging` and `data-drop` now, and the surface's own style block
 *   paints them.
 * - **The add-statement control is a menu, not a picker.** It was an `sp-picker` that had to reset
 *   its own value to `""` inside its change handler so the placeholder came back. A document's
 *   binding skips an equal write, so that trick cannot work here — and it should not have to:
 *   `studio-ui-guidelines.md` §12.5 asks for one list of actions, and the kit's menu is it.
 *
 * @docs studio/logic/statements
 */

import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { disableNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview";
import {
  attachInstruction,
  extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { isJsonObject, isNumber, isString } from "@jxsuite/schema/guards";
import { mountExpressionEditor, mountOperandEditor } from "../ui/expression-editor";
import { openMenu } from "../surfaces/menu";
import { disposeDetachedStatementEditors, renderStatementsSurface } from "../surfaces/statements";

import type {
  CemEvent,
  JxDispatchStatement,
  JxDocumentValue,
  JxIfStatement,
  JxStatement,
  JxStateDefinition,
  JxSwitchStatement,
} from "@jxsuite/schema/types";
import type { StatementFieldView, StatementRowView } from "../surfaces/statements";
import type { SurfaceOption } from "../ui/surface";

// ─── Options ─────────────────────────────────────────────────────────────────

export interface StatementEditorOpts {
  stateDefs: string[];
  stateEntries?: Record<string, JxStateDefinition> | null;
  allowEventRef: boolean;
  /** The entry's declared CEM events — offered as dispatchEvent name completions. */
  emits?: CemEvent[];
  /**
   * The region id of THIS editor, supplied by the surface that is drawing it.
   *
   * Required, and required of every host, which is the point. The editor used to hard-stamp
   * `navigator/statements` on itself, and it has two hosts that can be open at the same time — the
   * Navigator's State panel (`signals-panel.ts`) and the INSPECTOR's Logic tab (`events-panel.ts`).
   * `resolveRegion` takes the last match in document order and `#right-panel` follows
   * `#left-panel`, so the id resolved to the Inspector's editor while saying Navigator, and the
   * shot that crops it cropped the wrong control.
   *
   * A shared control cannot know where it is, so it may not claim to. This is the same verdict
   * `ui/regions.ts`'s `DERIVED_RESOLVERS` records for the media picker's Browse button — an
   * `inspector/…` id on an element outside the Inspector is not a pane-scoping problem, it is a
   * wrong id — reached the other way round: the picker's id is derived from the Inspector because
   * nothing addresses the card's copies, whereas both statement editors are real surfaces that
   * deserve names, so the HOST names them.
   */
  region: string;
}

/**
 * A lane address inside the statement tree: alternating [index, branchKey] steps, where a `cases`
 * step consumes three entries ([index, "cases", caseKey]). The empty path is the top-level
 * statement list.
 */
type LanePath = (string | number)[];

// ─── Statement Kind Detection ────────────────────────────────────────────────

/**
 * Discriminate a statement's kind, mirroring the runtime's detection order (`spec.md` §20.2).
 *
 * Takes any document value, not only a well-formed statement: a body is read from a document, and
 * whatever an entry holds falls back to `"expression"` rather than throwing.
 */
export function statementKind(
  stmt: JxDocumentValue | undefined,
): "expression" | "if" | "switch" | "dispatch" {
  if (isJsonObject(stmt)) {
    if ("operator" in stmt) {
      return "expression";
    }
    if ("if" in stmt) {
      return "if";
    }
    if ("$switch" in stmt) {
      return "switch";
    }
    if ("dispatchEvent" in stmt) {
      return "dispatch";
    }
  }
  return "expression";
}

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/="]);

/** A statement {@link statementKind} reads as an `if`/`then`/`else` branch. */
function isIfStatement(stmt: JxStatement): stmt is JxIfStatement {
  return statementKind(stmt) === "if";
}

/** A statement {@link statementKind} reads as a `$switch`/`cases` multiway branch. */
function isSwitchStatement(stmt: JxStatement): stmt is JxSwitchStatement {
  return statementKind(stmt) === "switch";
}

/** A statement {@link statementKind} reads as a WHATWG `dispatchEvent`. */
function isDispatchStatement(stmt: JxStatement): stmt is JxDispatchStatement {
  return statementKind(stmt) === "dispatch";
}

/** Card header label — ECMA/WHATWG naming (`spec.md` §20.2). */
function kindLabel(stmt: JxStatement): string {
  switch (statementKind(stmt)) {
    case "if": {
      return "If / Else";
    }
    case "switch": {
      return "Switch";
    }
    case "dispatch": {
      return "Dispatch event";
    }
    default: {
      const op = isJsonObject(stmt) ? String(stmt.operator ?? "") : "";
      if (ASSIGN_OPS.has(op)) {
        return "Set state";
      }
      if (op === "call") {
        return "Call";
      }
      return "Expression";
    }
  }
}

// ─── Add-statement Seeds (spec.md §20 shapes) ────────────────────────────────

const STATEMENT_SEEDS = new Map<string, () => JxStatement>([
  ["call", () => ({ operator: "call", target: { $ref: "" }, value: [] })],
  ["dispatch", () => ({ dispatchEvent: "" })],
  [
    "if",
    () => ({
      if: { operator: "===", target: { $ref: "" }, value: null },
      then: [],
    }),
  ],
  ["set", () => ({ operator: "=", target: { $ref: "" }, value: null })],
  ["switch", () => ({ $switch: { $ref: "" }, cases: {} })],
]);

/**
 * The add-statement menu, in the order the rows read. One list, and this is it
 * (`studio-ui-guidelines.md` §12.5).
 */
const STATEMENT_CHOICES: readonly SurfaceOption[] = [
  { label: "Set state", value: "set" },
  { label: "Call function", value: "call" },
  { label: "If / Else", value: "if" },
  { label: "Switch", value: "switch" },
  { label: "Dispatch event", value: "dispatch" },
];

// ─── Lane Addressing (immutable read/write through nested statement lists) ───

/**
 * The lane one statement holds under a lane-path step: `then`/`else` on an `if`, a named case or
 * `default` on a `$switch`. Undefined for any other step, which is how a stale path reads.
 */
function laneUnder(
  stmt: JxStatement,
  key: string | number | undefined,
  caseKey: string | number | undefined,
): JxStatement[] | undefined {
  if (isIfStatement(stmt)) {
    if (key === "then") {
      return stmt.then;
    }
    if (key === "else") {
      return stmt.else;
    }
  }
  if (isSwitchStatement(stmt)) {
    if (key === "default") {
      return stmt.default;
    }
    if (key === "cases" && isString(caseKey) && isJsonObject(stmt.cases)) {
      return stmt.cases[caseKey];
    }
  }
  return undefined;
}

/** How many entries a lane path's first step consumes: three for a case, two otherwise. */
function stepLength(key: string | number | undefined): number {
  return key === "cases" ? 3 : 2;
}

/** Resolve the statement list a lane path points at; null when the path is stale. */
export function laneListAt(list: JxStatement[], path: LanePath): JxStatement[] | null {
  if (path.length === 0) {
    return list;
  }
  const [idx, key, caseKey] = path;
  const stmt = isNumber(idx) ? list[idx] : undefined;
  if (stmt === undefined) {
    return null;
  }
  /* A lane is document data, so the array check stays: a `then` the document holds as anything
     else is a stale path here, not a list to walk. */
  const lane = laneUnder(stmt, key, caseKey);
  return Array.isArray(lane) ? laneListAt(lane, path.slice(stepLength(key))) : null;
}

/**
 * The statement with the lane at one lane-path step rewritten, or null when the statement holds no
 * lane there. The step's key stays where it was in the statement, or is appended when new.
 */
function withLaneUnder(
  stmt: JxStatement,
  key: string | number | undefined,
  caseKey: string | number | undefined,
  rewrite: (lane: JxStatement[]) => JxStatement[],
): JxStatement | null {
  if (isIfStatement(stmt)) {
    if (key === "then") {
      return { ...stmt, then: rewrite(Array.isArray(stmt.then) ? stmt.then : []) };
    }
    if (key === "else") {
      return { ...stmt, else: rewrite(stmt.else ?? []) };
    }
  }
  if (isSwitchStatement(stmt)) {
    if (key === "default") {
      return { ...stmt, default: rewrite(stmt.default ?? []) };
    }
    if (key === "cases" && isString(caseKey)) {
      const cases = { ...stmt.cases };
      cases[caseKey] = rewrite(cases[caseKey] ?? []);
      return { ...stmt, cases };
    }
  }
  return null;
}

/** Rebuild the statement tree with the lane at `path` replaced by `next` — fully immutable. */
export function withLaneList(
  list: JxStatement[],
  path: LanePath,
  next: JxStatement[],
): JxStatement[] {
  if (path.length === 0) {
    return next;
  }
  const [idx, key, caseKey] = path;
  const stmt = isNumber(idx) ? list[idx] : undefined;
  const updated =
    stmt === undefined
      ? null
      : withLaneUnder(stmt, key, caseKey, (lane) =>
          withLaneList(lane, path.slice(stepLength(key)), next),
        );
  if (updated === null) {
    throw new RangeError(`No statement lane at ${JSON.stringify(path)}`);
  }
  return list.map((s, i) => (i === idx ? updated : s));
}

// ─── The plan: what every key in the projection addresses ────────────────────

/** One card of the projection, and everything an edit to it needs. */
interface CardPlan {
  stmt: JxStatement;
  /** Replace this statement in its own lane. */
  commit: (next: JxStatement) => void;
  /** Replace the whole lane this statement is in — a delete, or a reorder. */
  commitLane: (next: JxStatement[]) => void;
  list: JxStatement[];
  index: number;
}

/** One lane of the projection: a `then`, an `else`, a case, or a `default`. */
interface LanePlan {
  path: LanePath;
  list: JxStatement[];
  /** Commit a new list into this lane. */
  commit: (next: JxStatement[]) => void;
  /** Take this lane away entirely; absent on a lane that is not optional. */
  remove?: () => void;
  /** Rename this lane's `$switch` case; absent on every other lane. */
  rename?: (value: string) => void;
}

/** An `+ Add else` / `+ Add case` row. */
type ActionPlan = () => void;

/** One operand's island painter, or the commit behind a text/select operand. */
interface FieldPlan {
  paint?: (host: HTMLElement) => void;
  set?: (value: string) => void;
  flag?: (name: string, checked: boolean) => void;
}

interface Projection {
  rows: StatementRowView[];
  cards: Map<string, CardPlan>;
  lanes: Map<string, LanePlan>;
  adds: Map<string, LanePlan>;
  actions: Map<string, ActionPlan>;
  fields: Map<string, FieldPlan>;
}

function operandOpts(opts: StatementEditorOpts) {
  return {
    allowEventRef: opts.allowEventRef,
    depth: 0,
    stateDefs: opts.stateDefs,
    stateEntries: opts.stateEntries ?? null,
  };
}

/** A row's own indent. Depth is a property of the row, not of the tree (`panel-data.json`). */
function indentOf(depth: number): string {
  return depth === 0 ? "0" : `calc(var(--jx-space-3) * ${depth})`;
}

function emptyField(over: Partial<StatementFieldView>): StatementFieldView {
  return {
    flags: [],
    key: "",
    kind: "control",
    label: "",
    options: [],
    placeholder: "",
    prop: "",
    value: "",
    ...over,
  };
}

/**
 * Walk the statement tree once and emit the flat rows the document draws, together with the plans
 * every key in them addresses.
 *
 * Exported for its own test: the walk IS the editor now, so the order of the rows and the identity
 * of their keys are the contract, not an implementation detail of a template.
 *
 * @param {JxStatement[]} statements The body being edited.
 * @param {(next: JxStatement[]) => void} onChange Receives a fresh array on every edit.
 * @param {StatementEditorOpts} opts
 * @returns {Projection}
 */
export function flattenStatements(
  statements: JxStatement[],
  onChange: (next: JxStatement[]) => void,
  opts: StatementEditorOpts,
): Projection {
  const rows: StatementRowView[] = [];
  const cards = new Map<string, CardPlan>();
  const lanes = new Map<string, LanePlan>();
  const adds = new Map<string, LanePlan>();
  const actions = new Map<string, ActionPlan>();
  const fields = new Map<string, FieldPlan>();
  const emitNames = (opts.emits ?? [])
    .map((e) => e.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  const laneId = (path: LanePath) => JSON.stringify(path);

  function lanePlan(path: LanePath, list: JxStatement[]): LanePlan {
    return {
      commit: (next) => onChange(withLaneList(statements, path, next)),
      list,
      path,
    };
  }

  function addRow(plan: LanePlan, depth: number): void {
    const key = `add:${laneId(plan.path)}`;
    adds.set(key, plan);
    rows.push({
      editable: false,
      fields: [],
      index: 0,
      indent: indentOf(depth),
      key,
      kind: "add",
      label: "Add statement",
      lane: laneId(plan.path),
      removable: false,
      stmt: "",
      title: "Add statement",
    });
  }

  function laneRow(
    plan: LanePlan,
    depth: number,
    label: string,
    extras: { editable?: boolean; title?: string } = {},
  ): void {
    const key = `lane:${laneId(plan.path)}`;
    lanes.set(key, plan);
    rows.push({
      editable: extras.editable ?? false,
      fields: [],
      index: 0,
      indent: indentOf(depth),
      key,
      kind: "lane",
      label,
      lane: laneId(plan.path),
      removable: Boolean(plan.remove),
      stmt: "",
      title: extras.title ?? `Remove ${label}`,
    });
  }

  function actionRow(key: string, depth: number, label: string, run: ActionPlan): void {
    actions.set(key, run);
    rows.push({
      editable: false,
      fields: [],
      index: 0,
      indent: indentOf(depth),
      key,
      kind: "action",
      label,
      lane: "",
      removable: false,
      stmt: "",
      title: label,
    });
  }

  /** The operands of one card, and the plans that commit them. */
  function fieldsOf(cardKey: string, plan: CardPlan): StatementFieldView[] {
    const { commit, stmt } = plan;
    const field = (prop: string) => `${cardKey}::${prop}`;
    /* Every operand editor below reports what its own controls built — a `{ $ref }`, a JSON literal
       or an expression node, the `JxExpressionOperand` members an operand admits — so each
       assertion back to a statement only restores the operand type `mountOperandEditor` erases. */
    if (isIfStatement(stmt)) {
      fields.set(field("if"), {
        paint: (host) =>
          mountOperandEditor(
            host,
            stmt.if,
            // SAFETY: `v` is an operand the operand editor built (see above), so this is an `if`.
            (v) => commit({ ...stmt, if: v } as JxIfStatement),
            {
              ...operandOpts(opts),
              label: "If",
              prop: "if",
            },
          ),
      });
      return [emptyField({ key: field("if"), kind: "control", label: "If", prop: "if" })];
    }
    if (isSwitchStatement(stmt)) {
      fields.set(field("$switch"), {
        paint: (host) =>
          mountOperandEditor(
            host,
            stmt.$switch,
            // SAFETY: `v` is an operand the operand editor built (see above), so this is a `$switch`.
            (v) => commit({ ...stmt, $switch: v } as JxSwitchStatement),
            {
              ...operandOpts(opts),
              label: "Switch on",
              prop: "$switch",
            },
          ),
      });
      return [
        emptyField({ key: field("$switch"), kind: "control", label: "Switch on", prop: "$switch" }),
      ];
    }
    if (isDispatchStatement(stmt)) {
      fields.set(field("dispatchEvent"), {
        set: (value) => commit({ ...stmt, dispatchEvent: value }),
      });
      fields.set(field("detail"), {
        paint: (host) =>
          mountOperandEditor(
            host,
            stmt.detail ?? null,
            // SAFETY: `v` is an operand the operand editor built (see above), a valid `detail`.
            (v) => commit({ ...stmt, detail: v } as JxDispatchStatement),
            {
              ...operandOpts(opts),
              label: "Detail",
              prop: "detail",
            },
          ),
      });
      fields.set(field("eventInit"), {
        flag: (name, checked) => {
          // The two CustomEventInit members the Options row draws, and nothing else.
          if (name === "bubbles" || name === "composed") {
            // Removed, then re-added, so a checked flag lands last, where it always has.
            const next: JxDispatchStatement = { ...stmt };
            delete next[name];
            if (checked) {
              next[name] = true;
            }
            commit(next);
          }
        },
      });
      return [
        emptyField({
          key: field("dispatchEvent"),
          kind: emitNames.length > 0 ? "select" : "text",
          label: "Event",
          options: emitNames.map((n) => ({ label: n, value: n })),
          placeholder: "event-name",
          prop: "dispatchEvent",
          // The document may hold anything under the key `statementKind` found; only a string shows.
          value: isString(stmt.dispatchEvent) ? stmt.dispatchEvent : "",
        }),
        emptyField({ key: field("detail"), kind: "control", label: "Detail", prop: "detail" }),
        emptyField({
          flags: [
            {
              checked: Boolean(stmt.bubbles),
              key: `${field("eventInit")}::bubbles`,
              label: "Bubbles",
            },
            {
              checked: Boolean(stmt.composed),
              key: `${field("eventInit")}::composed`,
              label: "Composed",
            },
          ],
          key: field("eventInit"),
          kind: "flags",
          label: "Options",
          prop: "eventInit",
        }),
      ];
    }
    fields.set(field("expression"), {
      paint: (host) =>
        mountExpressionEditor(
          host,
          stmt,
          /* SAFETY: the expression editor reports the node it was handed with one operand or its
             operator replaced, so the expression statement it was given comes back as one. */
          (n) => commit(n as JxStatement),
          {
            allowEventRef: opts.allowEventRef,
            stateDefs: opts.stateDefs,
            stateEntries: opts.stateEntries ?? null,
          },
        ),
    });
    /* No label: the card header already names the statement, and the expression editor draws its
       own Operator / Target / Value rows underneath. The surface hides an empty label node. */
    return [emptyField({ key: field("expression"), kind: "control", prop: "expression" })];
  }

  /**
   * One lane, in reading order: its cards, each card's own lanes beneath it, and the add row that
   * ends it.
   *
   * `commitLane` is the LANE'S, never recomputed from the path. A `$switch`'s `default` is the case
   * that proves it: emptying that lane must delete the key rather than leave `default: []` behind,
   * and a card's delete button commits through the lane it is in — so a generic `withLaneList` here
   * would write the empty array and the key would survive its last statement.
   */
  function walk(
    list: JxStatement[],
    path: LanePath,
    depth: number,
    commitLane: (next: JxStatement[]) => void = (next) =>
      onChange(withLaneList(statements, path, next)),
  ): void {
    for (const [index, stmt] of list.entries()) {
      const cardKey = `${laneId(path)}#${index}`;
      const commit = (next: JxStatement) =>
        commitLane(list.map((s, i) => (i === index ? next : s)));
      const plan: CardPlan = { commit, commitLane, index, list, stmt };
      cards.set(cardKey, plan);
      rows.push({
        editable: false,
        fields: fieldsOf(cardKey, plan),
        index,
        indent: indentOf(depth),
        key: cardKey,
        kind: "card",
        label: kindLabel(stmt),
        lane: laneId(path),
        removable: false,
        stmt: statementKind(stmt),
        title: "Delete statement",
      });

      if (isIfStatement(stmt)) {
        const thenPath = [...path, index, "then"];
        // A document's `then` is whatever it holds; anything but a list draws as an empty lane.
        const thenList = Array.isArray(stmt.then) ? stmt.then : [];
        const thenPlan = lanePlan(thenPath, thenList);
        laneRow(thenPlan, depth + 1, "Then");
        walk(thenList, thenPath, depth + 1, thenPlan.commit);
        if (Array.isArray(stmt.else)) {
          const elsePath = [...path, index, "else"];
          const elsePlan: LanePlan = {
            ...lanePlan(elsePath, stmt.else),
            remove: () => {
              const { else: _else, ...rest } = stmt;
              commit(rest);
            },
          };
          laneRow(elsePlan, depth + 1, "Else", { title: "Remove branch" });
          walk(stmt.else, elsePath, depth + 1, elsePlan.commit);
        } else {
          actionRow(`act:${cardKey}:else`, depth + 1, "Add else", () =>
            commit({ ...stmt, else: [] }),
          );
        }
      } else if (isSwitchStatement(stmt)) {
        const cases: Record<string, JxStatement[]> = isJsonObject(stmt.cases) ? stmt.cases : {};
        const entries = Object.entries(cases);
        const setCases = (next: Record<string, JxStatement[]>) => commit({ ...stmt, cases: next });
        for (const [caseKey, caseList] of entries) {
          const casePath = [...path, index, "cases", caseKey];
          const list_ = Array.isArray(caseList) ? caseList : [];
          const casePlan: LanePlan = {
            ...lanePlan(casePath, list_),
            remove: () => {
              const next = { ...cases };
              delete next[caseKey];
              setCases(next);
            },
            rename: (value) => {
              if (value === caseKey) {
                return;
              }
              const next: Record<string, JxStatement[]> = {};
              for (const [k, v] of entries) {
                next[k === caseKey ? value : k] = v;
              }
              setCases(next);
            },
          };
          laneRow(casePlan, depth + 1, caseKey, { editable: true, title: "Remove branch" });
          walk(list_, casePath, depth + 1, casePlan.commit);
        }
        const defaultPath = [...path, index, "default"];
        const defaultList = Array.isArray(stmt.default) ? stmt.default : [];
        const defaultPlan: LanePlan = {
          ...lanePlan(defaultPath, defaultList),
          commit: (next) => {
            /* The key goes with its last statement. A `default: []` left behind is a branch the
               runtime still matches, so an emptied lane has to delete the key rather than clear it. */
            if (next.length === 0) {
              const { default: _default, ...rest } = stmt;
              commit(rest);
              return;
            }
            commit({ ...stmt, default: next });
          },
        };
        laneRow(defaultPlan, depth + 1, "Default");
        walk(defaultList, defaultPath, depth + 1, defaultPlan.commit);
        actionRow(`act:${cardKey}:case`, depth + 1, "Add case", () => {
          let n = entries.length + 1;
          let key = `case ${n}`;
          while (Object.hasOwn(cases, key)) {
            n += 1;
            key = `case ${n}`;
          }
          setCases({ ...cases, [key]: [] });
        });
      }
    }
    addRow(lanePlan(path, list), depth);
  }

  walk(statements, [], 0);
  return { actions, adds, cards, fields, lanes, rows };
}

// ─── Drag-reorder (pragmatic-drag-and-drop, per-lane) ────────────────────────

/** Active DnD registration cleanup per editor host — replaced on every projection. */
const dndRegistrations = new WeakMap<HTMLElement, () => void>();

/**
 * Register drag-reorder on all statement rows under `root`.
 *
 * Rows may only reorder within their own lane — the source's lane id must match the target's — and
 * the flat projection is what makes that a plain sibling comparison rather than a tree walk. This
 * is an ISLAND (studio-ui-guidelines.md §9.4): the drag adapter measures and decorates real nodes,
 * so it reads them from the mounted document rather than being handed them.
 */
function registerStatementsDnD(
  root: HTMLElement,
  statements: JxStatement[],
  onChange: (next: JxStatement[]) => void,
) {
  requestAnimationFrame(async () => {
    // Deferred adapter import — keeps this panel's import graph adapter-free at module load.
    const { draggable, dropTargetForElements } =
      await import("@atlaskit/pragmatic-drag-and-drop/element/adapter");
    dndRegistrations.get(root)?.();
    const cleanups: (() => void)[] = [];

    for (const row of root.querySelectorAll<HTMLElement>("[data-stmt-row]")) {
      const laneId = row.dataset.stmtLane ?? "[]";
      const index = Math.trunc(Number(row.dataset.stmtIndex)) || 0;
      const handle = row.querySelector('[part="drag"]');
      const dragArgs: Parameters<typeof draggable>[0] = {
        element: row,
        getInitialData() {
          return { index, lane: laneId, type: "statement" };
        },
        onGenerateDragPreview({ nativeSetDragImage }) {
          disableNativeDragPreview({ nativeSetDragImage });
        },
        onDragStart() {
          row.dataset.dragging = "";
        },
        onDrop() {
          delete row.dataset.dragging;
        },
      };
      if (handle) {
        dragArgs.dragHandle = handle;
      }

      cleanups.push(
        combine(
          draggable(dragArgs),
          dropTargetForElements({
            element: row,
            canDrop({ source }) {
              return source.data.type === "statement" && source.data.lane === laneId;
            },
            getData({ input, element }) {
              return attachInstruction(
                { index },
                {
                  block: ["make-child"],
                  currentLevel: 0,
                  element,
                  indentPerLevel: 16,
                  input,
                  mode: "standard",
                },
              );
            },
            onDrag({ self }) {
              const instruction = extractInstruction(self.data);
              markDrop(row, instruction?.type);
            },
            onDragLeave() {
              markDrop(row);
            },
            onDrop({ self, source }) {
              markDrop(row);
              const instruction = extractInstruction(self.data);
              if (
                !instruction ||
                (instruction.type !== "reorder-above" && instruction.type !== "reorder-below")
              ) {
                return;
              }
              // `canDrop` admitted only this lane's statement rows, whose data carries a number.
              const from = source.data.index;
              /* SAFETY: `laneId` is this row's `data-stmt-lane`, which the surface writes from the
                 row's `lane`: `JSON.stringify` of a LanePath in flattenStatements, or the "[]"
                 fallback above. */
              const lanePath = JSON.parse(laneId) as LanePath;
              const lane = laneListAt(statements, lanePath);
              if (!lane || !isNumber(from) || from === index) {
                return;
              }
              let insertAt = instruction.type === "reorder-above" ? index : index + 1;
              if (from < insertAt) {
                insertAt -= 1;
              }
              if (insertAt === from) {
                return;
              }
              const nextLane = lane.filter((_, i) => i !== from);
              nextLane.splice(insertAt, 0, lane[from]!);
              onChange(withLaneList(statements, lanePath, nextLane));
            },
          }),
        ),
      );
    }

    dndRegistrations.set(root, () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    });
  });
}

/** Where a drop would land, as data the surface's style block paints. */
function markDrop(row: HTMLElement, type?: string): void {
  if (type === "reorder-above") {
    row.dataset.drop = "above";
  } else if (type === "reorder-below") {
    row.dataset.drop = "below";
  } else {
    delete row.dataset.drop;
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

/** Every operand host a standing editor has been handed, so an update can repaint it. */
const islandHosts = new WeakMap<HTMLElement, Map<string, HTMLElement>>();

/**
 * Draw a structured function body (`spec.md` §20) into `host`, or bring the one already there up to
 * date. `onChange` receives a fresh statement array on every edit; the input array is never
 * mutated.
 *
 * The host belongs to the CALLER — a lit template renders an empty element for it, or another
 * document renders `[part="statements-host"]` — because a document clears the host it is given and
 * lit renders beside foreign nodes, so the two can never share a container.
 *
 * @param {HTMLElement} host
 * @param {JxStatement[]} statements
 * @param {(next: JxStatement[]) => void} onChange
 * @param {StatementEditorOpts} opts
 */
export function mountStatementEditor(
  host: HTMLElement,
  statements: JxStatement[],
  onChange: (next: JxStatement[]) => void,
  opts: StatementEditorOpts,
): void {
  /* An entry the reader collapsed, or a handler they unbound, takes its host out of the page and
     nothing else in the chain hears about it — the panel around it simply renders something else.
     Sweeping here is the one moment this module is guaranteed to run. */
  disposeDetachedStatementEditors();
  const safe = Array.isArray(statements) ? statements : [];
  const projection = flattenStatements(safe, onChange, opts);
  let hosts = islandHosts.get(host);
  if (!hosts) {
    hosts = new Map<string, HTMLElement>();
    islandHosts.set(host, hosts);
  }
  const held = hosts;

  const paint = (id: string, slot: HTMLElement): void => {
    projection.fields.get(id)?.paint?.(slot);
  };

  renderStatementsSurface(
    host,
    projection.rows,
    opts.region,
    {
      act: (key) => projection.actions.get(key)?.(),
      add: (key, anchor) => {
        const plan = projection.adds.get(key);
        if (!plan) {
          return;
        }
        openMenu({
          label: "Add statement",
          opener: anchor,
          region: "statement-add",
          rows: STATEMENT_CHOICES.map((choice) => ({
            destructive: false,
            disabled: false,
            dividerAbove: false,
            id: choice.value,
            title: choice.label,
          })),
          run: (id) => {
            const seed = STATEMENT_SEEDS.get(id);
            if (seed) {
              plan.commit([...plan.list, seed()]);
            }
          },
        });
      },
      remove: (key) => {
        const lane = projection.lanes.get(key);
        if (lane) {
          lane.remove?.();
          return;
        }
        const card = projection.cards.get(key);
        card?.commitLane(card.list.filter((_, i) => i !== card.index));
      },
      rename: (key, value) => projection.lanes.get(key)?.rename?.(value),
      setField: (key, value) => projection.fields.get(key)?.set?.(value),
      setFlag: (key, checked) => {
        const at = key.lastIndexOf("::");
        projection.fields.get(key.slice(0, at))?.flag?.(key.slice(at + 2), checked);
      },
    },
    {
      controlSlot: (id, slot) => {
        held.set(id, slot);
        paint(id, slot);
      },
    },
  );

  /* Repaint the hosts that were already standing. `onNodeCreated` fires once per node and a keyed
     row keeps its own, so an operand whose statement changed under it would otherwise still be
     showing the previous one's editor. A host whose field is gone is dropped rather than repainted. */
  for (const [id, slot] of held) {
    if (!projection.fields.has(id)) {
      held.delete(id);
      continue;
    }
    paint(id, slot);
  }

  registerStatementsDnD(host, safe, onChange);
}
