/// <reference lib="dom" />
// ─── Data Explorer ──────────────────────────────────────────────────────────

import { html } from "lit-html";
import type { TemplateResult } from "lit-html";
import { activeTab } from "../workspace/workspace";
import { booleanArg, stringArg, stringProperty } from "../commands/command-args";
import { disposeDetachedDataTrees, renderDataTreeSurface } from "../surfaces/panel-data";
import { registerPanel } from "./panel-registry";
import type { DataTreeRow } from "../surfaces/panel-data";
import type { AnyCommand, CommandRegistry } from "../commands/registry";

/**
 * The focused tab's expansion record, created on first write.
 *
 * `ui.dataRows` rather than a module Set: expansion is a property of the document you are reading,
 * and a module-global one followed you to the next tab and showed rows open that that document does
 * not define.
 */
function rowsUi(): Record<string, boolean> | null {
  const ui = activeTab.value?.session.ui;
  if (!ui) {
    return null;
  }
  return (ui.dataRows ??= {});
}

/*
 * ── The truncation markers, which are now BUTTONS ────────────────────────────
 *
 * The tree caps arrays at 20, objects at 30 and depth at 5, and printed "… 5 more" as inert text.
 * That is the panel telling you it has the answer and will not show it — the exact case a user
 * opens this panel for is the fetch that returned something unexpected at item 40. Plan §11.2:
 * "truncation markers gain real expand actions."
 *
 * Raising a limit is remembered per marker rather than globally, so opening one long array does not
 * re-render every other one at full length, and it never lowers: a step is a step.
 */
const MORE_STEP = 50;

/** The focused tab's raised-limit record, created on first write. */
function limitsUi(): Record<string, number> | null {
  const ui = activeTab.value?.session.ui;
  if (!ui) {
    return null;
  }
  return (ui.dataLimits ??= {});
}

/** The cap for one marker: the default, plus whatever the reader has asked for. */
function capFor(path: string, kind: "items" | "keys" | "depth", base: number): number {
  return base + (limitsUi()?.[`${path}\u0000${kind}`] ?? 0);
}

/** Raise one marker's limit by a step. Exported for the tests. */
export function raiseDataLimit(path: string, kind: "items" | "keys" | "depth"): void {
  const limits = limitsUi();
  if (!limits) {
    return;
  }
  const key = `${path}\u0000${kind}`;
  limits[key] = (limits[key] ?? 0) + MORE_STEP;
}

/**
 * One truncation marker: a row the document draws as a button that shows more of what is in hand.
 *
 * It carries the subtree and the limit it raises rather than a callback. The press arrives back
 * here through the surface's one action, so a pure formatter stays pure and there is a single
 * repaint to reason about instead of one threaded through every caller.
 */
function moreRow(
  path: string,
  limit: "items" | "keys" | "depth",
  indent: string,
  text: string,
  title = `Show ${MORE_STEP} more`,
): DataTreeRow {
  return {
    indent,
    key: `${path}\u0000${limit}`,
    kind: "more",
    label: "",
    limit,
    path,
    text,
    title,
    tone: "marker",
  };
}

/** A value as the tree prints it, capped at `max` characters. `undefined` prints as nothing. */
function valueText(value: unknown, max: number): string {
  if (typeof value === "string" && value.length > max) {
    return `"${value.slice(0, max)}…"`;
  }
  return JSON.stringify(value) ?? "";
}

/** Which colour a value takes. `null` and a summary label are the two the tree actually paints. */
function toneOf(value: unknown): string {
  return value === null ? "null" : typeof value;
}

/** `Array(3)` or `{2}` — what a value you can open says while it is closed. */
function summaryLabel(value: object): string {
  return Array.isArray(value) ? `Array(${value.length})` : `{${Object.keys(value).length}}`;
}

/** Unwrap a Vue ref (has .value and .__v_isRef) to get the underlying value. */
export function unwrapSignal(value: unknown) {
  if (value && typeof value === "object" && (value as Record<string, unknown>).__v_isRef) {
    return (value as Record<string, unknown>).value;
  }
  return value;
}

/** Type label for a signal value in the data explorer. */
export function dataTypeLabel(value: unknown) {
  const v = unwrapSignal(value);
  if (v === null) {
    return "null";
  }
  if (v === undefined) {
    return "pending";
  }
  if (Array.isArray(v)) {
    return `Array(${v.length})`;
  }
  if (typeof v === "object") {
    return `{${Object.keys(v).length}}`;
  }
  return typeof v;
}

/* THE VALUE LIST IS GONE, AND ITS ROWS ARE THE DEFINITION ROWS — `panels/signals-panel.ts`.
   It listed every state entry with its badge and what it resolved to, one rail tab away from a
   panel listing every state entry with its badge and how it is defined: the same names twice, and
   you read one to understand the other. Plan §11.2 asks for "definitions + live values in one row",
   so the definition row now carries the resolved type and expands to the value tree, and what is
   left here is the tree WALK, the type label and the row-expansion record the merged rows read. */

/**
 * Flatten a JSON value into the lines the Data surface draws (`surfaces/panel-data.{json,ts}`).
 *
 * The tree used to BE a lit template, one recursive call per level. It is a document now, and a
 * document's one repeater walks a LIST — so the recursion moved here and comes out as rows that
 * each carry their own indent. Nothing else changed: the caps are the same caps, the text is
 * truncated at the same lengths, and a capped list still ends in a marker.
 *
 * @param {unknown} value The resolved value to read.
 * @param {number} depth How deep this call already is; the indent is derived from it.
 * @param {number} [maxDepth] The default depth cap, before whatever the reader has raised.
 * @param {string} path This subtree's path, which is what a raised limit is remembered against.
 * @returns {DataTreeRow[]}
 */
export function dataTreeRows(
  value: unknown,
  depth: number,
  maxDepth = 5,
  path = "",
): DataTreeRow[] {
  const indent = `${(depth + 1) * 12}px`;
  const row = (label: string, text: string, tone: string, key: string): DataTreeRow => ({
    indent,
    key,
    kind: "row",
    label,
    limit: "",
    path: "",
    text,
    title: "",
    tone,
  });

  if (depth > capFor(path, "depth", maxDepth)) {
    return [moreRow(path, "depth", indent, "…", `Show ${MORE_STEP} more levels`)];
  }
  /* The one line a value with nothing under it renders as, keyed by the subtree's own path. That
     is unique by construction: a descent only ever happens into an object or an array, so this
     row exists only at the top of a tree, where it has no siblings to collide with. */
  if (value === null || value === undefined) {
    return [row("", String(value), "null", path)];
  }
  if (typeof value !== "object") {
    return [row("", valueText(value, 200), toneOf(value), path)];
  }

  const array = Array.isArray(value);
  const entries: [string, string, unknown][] = array
    ? value.map((item, i) => [`${i}`, `[${i}] `, item])
    : Object.keys(value).map((key) => [key, `${key}: `, (value as Record<string, unknown>)[key]]);
  const limit = array ? "items" : "keys";
  const cap = capFor(path, limit, array ? 20 : 30);

  const rows: DataTreeRow[] = [];
  for (const [segment, label, item] of entries.slice(0, cap)) {
    const childPath = `${path}/${segment}`;
    if (item === null || item === undefined || typeof item !== "object") {
      rows.push(row(label, valueText(item, 80), toneOf(item), childPath));
      continue;
    }
    rows.push(
      row(label, summaryLabel(item), "object", childPath),
      ...dataTreeRows(item, depth + 1, maxDepth, childPath),
    );
  }
  if (entries.length > cap) {
    rows.push(moreRow(path, limit, indent, `… ${entries.length - cap} more`));
  }
  return rows;
}

/**
 * What one host in the panel's markup is waiting to have drawn into it.
 *
 * The value travels as a lit PROPERTY rather than through module state: lit writes it on every
 * render, so a host and the value it stands for can never disagree, and the post-render pass has
 * only to read what the render left.
 */
interface DataTreeRequest {
  value: unknown;
  depth: number;
  maxDepth: number;
  path: string;
}

/** A host element carrying its request. */
interface DataTreeHost extends HTMLElement {
  jxDataTree?: DataTreeRequest;
}

/**
 * The host one value tree is drawn into, and the value it is to draw.
 *
 * It renders no tree of its own. The tree is a Jx document and a document is not a
 * `TemplateResult`, so what a lit template can contribute is the element it lands in;
 * {@link mountDataTrees}, the panel's `afterRender`, is what fills it. The signature is unchanged so
 * that the row template calling it does not have to know any of that.
 *
 * @returns {import("lit-html").TemplateResult}
 */
export function renderDataTreeTemplate(
  value: unknown,
  depth: number,
  maxDepth = 5,
  path = "",
): TemplateResult {
  return html`<div
    data-jx-tree=${path}
    .jxDataTree=${{ depth, maxDepth, path, value } satisfies DataTreeRequest}
  ></div>`;
}

/**
 * Draw every value tree the last render asked for. The Data panel's `afterRender`.
 *
 * Idempotent, because `afterRender` runs on EVERY render: a host that already holds its document is
 * assigned to rather than remounted, which is what keeps the reader's place inside a long tree. The
 * sweep goes first — a row the reader collapsed took its host out of the document, and the mount
 * registry holds a host by reference, so this pass is the only moment a closed tree can be taken
 * down.
 *
 * @param {HTMLElement} host The painted panel body.
 * @param {() => void} rerender Repaint the Navigator, so that a raised limit is drawn.
 */
export function mountDataTrees(host: HTMLElement, rerender: () => void): void {
  disposeDetachedDataTrees();
  for (const element of host.querySelectorAll<DataTreeHost>("[data-jx-tree]")) {
    const request = element.jxDataTree;
    if (!request) {
      continue;
    }
    renderDataTreeSurface(
      element,
      dataTreeRows(request.value, request.depth, request.maxDepth, request.path),
      {
        showMore: (subtree, limit) => {
          if (limit === "items" || limit === "keys" || limit === "depth") {
            raiseDataLimit(subtree, limit);
          }
          rerender();
        },
      },
    );
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/** Expand (or collapse) one data row's value tree. Idempotent — expanding twice is expanding once. */
export function setDataRowExpanded(name: string, expanded: boolean): void {
  const rows = rowsUi();
  if (!rows) {
    return;
  }
  if (expanded) {
    rows[name] = true;
  } else {
    delete rows[name];
  }
}

/** Whether a data row is currently expanded. Exported for the tests and the command's idempotence. */
export function isDataRowExpanded(name: string): boolean {
  return rowsUi()?.[name] === true;
}

/** The expanded rows, in no particular order — `formula.openWorkspace` asks when it has no target. */
export function expandedDataRows(): string[] {
  return Object.keys(rowsUi() ?? {});
}

/** Drop every expansion AND every raised limit on the focused tab — a fresh document, and tests. */
export function resetDataRowExpansion(): void {
  const ui = activeTab.value?.session.ui;
  if (ui) {
    ui.dataRows = {};
    ui.dataLimits = {};
  }
}

/** The state entry names the open document defines — what a row can be named by. */
function definedDataNames(): string[] {
  return Object.keys(activeTab.value?.doc.document?.state ?? {});
}

/** What the data verb needs that this module does not own. */
export interface DataExplorerCommandDeps {
  /** Repaint the Navigator so the expanded row's tree appears — `left-panel.ts`'s `render`. */
  renderLeftPanel: () => void;
}

/**
 * The Data panel's row verb.
 *
 * `expandRow` reads as a delta but is not one: it names the state it ends in, which is why it
 * survives `__jxAutomation`'s `/\.toggle[A-Z]/` refusal and why running it twice photographs the
 * same picture. The collapse direction is `{ expanded: false }` on the same record rather than a
 * second id.
 *
 * REFUSES a name the open document does not define. The predecessor matched the row by its rendered
 * label through an XPath, so a document without that entry silently pressed nothing and the shot
 * recorded a collapsed panel as if it were the feature.
 *
 * @param {DataExplorerCommandDeps} deps
 * @returns {AnyCommand[]}
 */
export function dataExplorerCommands(deps: DataExplorerCommandDeps): AnyCommand[] {
  return [
    {
      args: {
        additionalProperties: false,
        properties: {
          expanded: {
            default: true,
            description: "True to expand the row's value tree, false to collapse it.",
            type: "boolean",
          },
          name: stringProperty("The state entry's name, as the document defines it."),
        },
        required: ["name"],
        type: "object",
      },
      category: "Document",
      id: "data.expandRow",
      level: "document",
      menus: ["palette"],
      group: "5_data",
      requires: "an open document that defines data",
      when: (ctx) => ctx.document.open,
      run: (_commandCtx, args) => {
        const name = stringArg("data.expandRow", args, "name");
        const defined = definedDataNames();
        if (!defined.includes(name)) {
          throw new RangeError(
            `command "data.expandRow" argument "name": "${name}" is not defined by this ` +
              `document — it defines: ${defined.length > 0 ? defined.join(", ") : "nothing"}`,
          );
        }
        const { expanded } = args as { expanded?: unknown };
        // `expanded` defaults to true but is never COERCED: `{ expanded: "no" }` would otherwise
        // Read as a collapse, which is the class of silent wrong answer this whole record exists
        // To stop.
        setDataRowExpanded(
          name,
          expanded === undefined || booleanArg("data.expandRow", args, "expanded"),
        );
        deps.renderLeftPanel();
      },
      title: "Expand Data Row",
    },
  ];
}

/**
 * Register the Data panel's row verb.
 *
 * @param {CommandRegistry} registry
 * @param {DataExplorerCommandDeps} deps
 */
export function registerDataExplorerCommands(
  registry: CommandRegistry,
  deps: DataExplorerCommandDeps,
): void {
  registry.registerAll(dataExplorerCommands(deps));
}

/**
 * Contribute the Data panel — the DEFINITIONS and the values they resolve to, in one place.
 *
 * `level: "document"`, because both belong to the open document.
 *
 * **This is where the State editor lives now.** Plan §11.2 always said so ("State panel + inline
 * editor → Navigator › Data"), but the two halves shipped apart: the rail button was taken away to
 * keep the DOCUMENT group at four, the merge was deferred, and the editor was left reachable only
 * by typing its name into the palette. So the one surface for declaring a state variable — or a
 * component property, which is a state entry with a default — became unfindable, which is a
 * capability lost rather than a control moved.
 *
 * Defining and watching are the same task interrupted: you add an entry, then look at what it
 * resolved to. Two panels made that two panels.
 *
 * **The value half is a Jx document now** (`surfaces/panel-data.{json,ts}`). `render` still returns
 * the definition rows as a lit template, because those are `signals-panel.ts`'s and are still drawn
 * over Spectrum; what each open row makes room for is a host, and `afterRender` is where the
 * document lands in it.
 */
export function registerDataPanel(): void {
  registerPanel({
    id: "data",
    title: "Data",
    level: "document",
    dock: "navigator",
    icon: "database",
    requiresDocument: "Open a page to give it data — values it can read, compute or fetch.",
    render: (ctx) =>
      // `ctx.doc!` — `requiresDocument` means the registry renders the empty state instead of
      // Calling this, the same assertion `head-panel.ts` makes for the same reason.
      ctx.deps.renderSignalsTemplate(ctx.doc!, {
        refreshData: ctx.deps.refreshData,
        renderLeftPanel: ctx.rerender,
      }),
    afterRender: (ctx, host) => {
      mountDataTrees(host, ctx.rerender);
    },
  });
}
