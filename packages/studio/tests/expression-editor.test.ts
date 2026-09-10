/**
 * Tests for the expression editor (spec §19.9): `src/ui/expression-editor.ts`, the flow, and
 * `src/surfaces/expression-editor.json`, the document it mounts.
 *
 * Everything is addressed by `part` and by `data-prop`, because the editor is a document: there is
 * no `.expression-editor`, no `sp-picker.expr-operator` and no `.switch-case-row` to find any more.
 * Every mount is awaited — `mountSurface` settles when the document has rendered, and a kit
 * element's own template is one `connectedCallback` after that, so a synchronous assertion finds
 * nothing at all.
 *
 * The tree arrives FLAT. An expression nests to any depth and a document's one repeater walks a
 * list, so the walk emits rows in reading order and each carries its own indent — which is why a
 * nested operand's rows are SIBLINGS of the operand row that owns them rather than descendants of
 * it. `data-nested` is what still says they are inside it, and `--expr-indent` is how far.
 *
 * Two kinds of assertion, on purpose. What the editor SHOWS is asserted against the mounted
 * document; what a gesture COMMITS is asserted against {@link flattenExpression}'s plans, which is
 * where the decision now lives. The second kind also reaches the two values a native `<select>`
 * cannot be made to hold — an operator the editor does not know, and a value-source rung that is
 * not one of the three — where the old `sp-picker` would take any string assigned to it.
 */
import { flush, pointer } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import {
  expressionHint,
  flattenExpression,
  flattenOperand,
  isActionExpression,
  mountExpressionEditor,
  mountOperandEditor,
} from "../src/ui/expression-editor";

import type { ExprRowView } from "../src/surfaces/expression-editor";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_OPTS = { allowEventRef: false, stateDefs: ["count", "items"] };

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

interface Mounted {
  host: HTMLElement;
  changes: unknown[];
  /** Re-run the flow over a new node, the way a panel's repaint does. */
  update: (next: unknown) => Promise<void>;
}

/**
 * Mount an editor into an ATTACHED host of its own.
 *
 * Attached, because a mount keyed by host is only swept when its host leaves the page — and the
 * sweep is what {@link mountExpressionEditor} runs first on every call.
 */
async function mount(node: unknown, opts: Record<string, unknown> = {}): Promise<Mounted> {
  const changes: unknown[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const options = { ...DEFAULT_OPTS, ...opts } as never;
  const push = (n: unknown) => changes.push(n);
  mountExpressionEditor(host, node, push, options);
  await flush(6);
  return {
    changes,
    host,
    async update(next) {
      mountExpressionEditor(host, next, push, options);
      await flush(4);
    },
  };
}

/** The projection alone: rows and plans, with no document and no DOM. */
function project(node: unknown, opts: Record<string, unknown> = {}) {
  const changes: unknown[] = [];
  const projection = flattenExpression(node, (n) => changes.push(n), {
    ...DEFAULT_OPTS,
    ...opts,
  } as never);
  return { ...projection, changes };
}

const rowsOf = (host: HTMLElement) => [...host.querySelectorAll('[part="row"]')] as HTMLElement[];

function row(host: HTMLElement, prop: string): HTMLElement {
  const el = host.querySelector(`[data-prop="${prop}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

const part = (el: Element, name: string) => el.querySelector(`[part="${name}"]`);
const parts = (el: Element, name: string) => [...el.querySelectorAll(`[part="${name}"]`)];

/** What a kit select currently holds, read off its own control. */
function selectValue(el: Element | null): string {
  return (el!.querySelector('[part="control"]') as HTMLSelectElement).value;
}

/** What one row's own picker holds — `row` then `part` then `value`, said once. */
function pickerIn(host: HTMLElement, prop: string, name: string): string {
  return selectValue(part(row(host, prop), name));
}

/** Every value a kit select offers, in order — the stand-in row included. */
function optionValues(el: Element | null): string[] {
  return [...el!.querySelectorAll("option")].map((o) => o.value);
}

/** Pick a row in a kit select the way a reader does. */
function pick(el: Element | null, value: string): void {
  const control = el!.querySelector('[part="control"]') as HTMLSelectElement;
  control.value = value;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Type into a kit text control: it reports, and the event bubbles to the handler's element. */
function type(el: Element | null, value: string): void {
  const input = el!.querySelector('[part="input"]') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Commit a kit control: the value is set and `change` fires, as a blur or a pick does. */
function commit(el: Element | null, value: string): void {
  const input = el!.querySelector('[part="input"]') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Toggle a kit checkbox the way a reader does. */
function check(el: Element | null, next: boolean): void {
  const input = el!.querySelector('[part="input"]') as HTMLInputElement;
  input.checked = next;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Press a kit button: the click lands on the control inside it. */
function press(el: Element | null): void {
  pointer(el!.querySelector('[part="control"]') ?? el!, "click");
}

/** What a screen reader would call an icon-only kit button — the name on its own control. */
function buttonName(el: Element | null): string | null {
  return el!.querySelector('[part="control"]')!.getAttribute("aria-label");
}

// ─── expressionHint ──────────────────────────────────────────────────────────

describe("expressionHint", () => {
  test("non-object or missing operator falls back to $expression", () => {
    expect(expressionHint(null)).toBe("$expression");
    expect(expressionHint("=")).toBe("$expression");
    expect(expressionHint({})).toBe("$expression");
    expect(expressionHint({ operator: 5 })).toBe("$expression");
  });

  test("assignment ops show op + ref label without #/state/ prefix", () => {
    expect(expressionHint({ operator: "=", target: { $ref: "#/state/count" } })).toBe("= count");
    expect(expressionHint({ operator: "+=", target: { $ref: "#/state/total" } })).toBe("+= total");
  });

  test("one-arg array ops show op + target", () => {
    expect(expressionHint({ operator: "push", target: { $ref: "#/state/items" } })).toBe(
      "push items",
    );
  });

  test("no-arg array ops render as a call", () => {
    expect(expressionHint({ operator: "pop", target: { $ref: "#/state/items" } })).toBe(
      "pop(items)",
    );
    expect(expressionHint({ operator: "shift", target: { $ref: "#/state/items" } })).toBe(
      "shift(items)",
    );
  });

  test("splice renders as splice(target)", () => {
    expect(expressionHint({ operator: "splice", target: { $ref: "#/state/items" } })).toBe(
      "splice(items)",
    );
  });

  test("aggregate ops render as op(target)", () => {
    expect(expressionHint({ operator: "reduce", target: { $ref: "#/state/items" } })).toBe(
      "reduce(items)",
    );
    expect(expressionHint({ operator: "map", target: { $ref: "#/state/items" } })).toBe(
      "map(items)",
    );
    expect(expressionHint({ operator: "filter", target: { $ref: "#/state/items" } })).toBe(
      "filter(items)",
    );
  });

  test("unary ops prefix the target", () => {
    expect(expressionHint({ operator: "!", target: { $ref: "#/state/flag" } })).toBe("!flag");
  });

  test("binary ops render target op ellipsis", () => {
    expect(expressionHint({ operator: "+", target: 5 })).toBe("5 + …");
  });

  test("nested expression target renders as (op…)", () => {
    expect(expressionHint({ operator: "=", target: { operator: "+", target: 1 } })).toBe("= (+…)");
  });

  test("null/undefined target renders as ?", () => {
    expect(expressionHint({ operator: "<", target: null })).toBe("? < …");
    expect(expressionHint({ operator: "<" })).toBe("? < …");
  });

  test("unknown operator falls through to binary-style hint", () => {
    expect(expressionHint({ operator: "frobnicate", target: "x" })).toBe("x frobnicate …");
  });

  test("call renders as callee(…) with pointer prefixes stripped", () => {
    expect(expressionHint({ operator: "call", target: { $ref: "#/state/lineTotal" } })).toBe(
      "lineTotal(…)",
    );
    expect(expressionHint({ operator: "call", target: { $ref: "window#/Math/max" } })).toBe(
      "Math.max(…)",
    );
  });

  test("conditional renders as test ? … : … and switch as switch(target)", () => {
    expect(expressionHint({ operator: "?:", target: { $ref: "#/state/flag" } })).toBe(
      "flag ? … : …",
    );
    expect(expressionHint({ operator: "switch", target: { $ref: "#/state/kind" } })).toBe(
      "switch(kind)",
    );
  });
});

describe("isActionExpression", () => {
  test("an assignment DOES something; everything else computes something", () => {
    expect(isActionExpression({ operator: "=", target: null })).toBe(true);
    expect(isActionExpression({ operator: "+=", target: null })).toBe(true);
    expect(isActionExpression({ operator: "+", target: null })).toBe(false);
    expect(isActionExpression(null)).toBe(false);
    expect(isActionExpression("=")).toBe(false);
  });
});

// ─── Structure per operator category ─────────────────────────────────────────

describe("the flattened shape", () => {
  test("null node defaults to assignment with ref target and value row", async () => {
    const m = await mount(null);
    expect(pickerIn(m.host, "operator", "operator")).toBe("=");
    // An assignment target must be a ref → the ref picker alone, with no rung picker beside it.
    expect(part(row(m.host, "target"), "source")).toBeNull();
    expect(part(row(m.host, "target"), "ref")).not.toBeNull();
    expect(m.host.querySelector('[data-prop="value"]')).toBeTruthy();
  });

  test("non-object node string also falls back to assignment defaults", async () => {
    const m = await mount("garbage");
    expect(pickerIn(m.host, "operator", "operator")).toBe("=");
  });

  test("a nested expression's rows are siblings, marked nested and indented one step", async () => {
    const m = await mount({ operator: "+", target: { operator: "-", target: 4 }, value: 1 });
    const all = rowsOf(m.host);
    // Root operator, root target (the operand that HOLDS the nested node), then the nested node's
    // Own operator and target, then the root's value row.
    expect(all.map((r) => r.dataset["nested"])).toEqual([
      "false",
      "false",
      "true",
      "true",
      "false",
    ]);
    expect(all[2]!.style.getPropertyValue("--expr-indent")).toBe("4px");
    expect(all[0]!.style.getPropertyValue("--expr-indent")).toBe("0px");
  });

  test("an editor that STARTS nested marks its own root rows nested too", async () => {
    const m = await mount({ operator: "!", target: null }, { depth: 2 });
    expect(rowsOf(m.host)[0]!.dataset["nested"]).toBe("true");
    expect(rowsOf(m.host)[0]!.style.getPropertyValue("--expr-indent")).toBe("8px");
  });

  test("unary operator renders no value row", async () => {
    const m = await mount({ operator: "!", target: null });
    expect(m.host.querySelector('[data-prop="value"]')).toBeNull();
  });

  test("binary operator renders the rung picker for target and a value row", async () => {
    const m = await mount({ operator: "+", target: 1, value: 2 });
    const target = row(m.host, "target");
    expect(selectValue(part(target, "source"))).toBe("literal");
    expect(selectValue(part(target, "literal-type"))).toBe("number");
    expect(m.host.querySelector('[data-prop="value"]')).toBeTruthy();
  });

  test("pop renders ref-only target and no value row", async () => {
    const m = await mount({ operator: "pop", target: { $ref: "#/state/items" } });
    expect(part(row(m.host, "target"), "source")).toBeNull();
    expect(m.host.querySelector('[data-prop="value"]')).toBeNull();
  });

  test("splice renders an Args section and one operand row per argument", async () => {
    const m = await mount({
      operator: "splice",
      target: { $ref: "#/state/items" },
      value: [null, 1, "a", "b"],
    });
    expect(part(m.host, "section")!.textContent).toBe("Args");
    expect(parts(m.host, "lead").map((l) => l.textContent)).toEqual([
      "start",
      "del",
      "item",
      "item",
    ]);
    expect(part(m.host, "action")!.textContent).toContain("+ Add arg");
  });

  test("reduce renders a per-item section, the nested editor and an initial row", async () => {
    const m = await mount({
      initial: 0,
      operator: "reduce",
      target: { $ref: "#/state/items" },
      value: { operator: "+", target: { $ref: "#/state/acc" }, value: 1 },
    });
    expect(part(m.host, "section")!.textContent).toBe("Per-item");
    // Two operator rows: the reduce, and the per-item node one indent deeper.
    const operators = parts(m.host, "operator").map((o) => selectValue(o));
    expect(operators).toEqual(["reduce", "+"]);
    expect(m.host.querySelector('[data-prop="initial"]')).toBeTruthy();
  });

  test("map without a value node shows the default ! nested editor and no initial", async () => {
    const m = await mount({ operator: "map", target: { $ref: "#/state/items" } });
    expect(parts(m.host, "operator").map((o) => selectValue(o))).toEqual(["map", "!"]);
    expect(m.host.querySelector('[data-prop="initial"]')).toBeNull();
  });

  test("zero-arg pure methods render no value row; argument-taking ones do", async () => {
    const zero = await mount({ operator: "toUpperCase", target: { $ref: "#/state/name" } });
    expect(zero.host.querySelector('[data-prop="value"]')).toBeNull();

    const one = await mount({ operator: "split", target: { $ref: "#/state/name" }, value: "," });
    expect(one.host.querySelector('[data-prop="value"]')).toBeTruthy();
    // The receiver is any operand, not ref-only → the rung picker is offered.
    expect(part(row(one.host, "target"), "source")).not.toBeNull();
  });

  test("depth-0 preview error is a named line above the form", async () => {
    const m = await mount(
      { operator: "+", target: 1, value: 2 },
      { preview: { error: "boom: bad operand", mutating: false, values: new Map() } },
    );
    expect(part(m.host, "preview-error")!.textContent).toBe("boom: bad operand");
    expect(part(m.host, "preview-error")!.getAttribute("role")).toBe("alert");
  });

  test("the operator picker offers every group, delimited, with call under Function", async () => {
    const m = await mount(null);
    const picker = part(row(m.host, "operator"), "operator")!;
    expect(optionValues(picker)).toContain("call");
    const headings = [...picker.querySelectorAll("optgroup")].map((g) => g.getAttribute("label"));
    expect(headings).toContain("Function");
    expect(headings).toContain("Assignment");
  });
});

// ─── Call operator ───────────────────────────────────────────────────────────

describe("call operator", () => {
  const STATE_ENTRIES = {
    lineTotal: {
      $expression: {
        operator: "*",
        target: { $ref: "$args/price" },
        value: { $ref: "$args/qty" },
      },
      parameters: [{ name: "price" }, { default: 1, name: "qty" }],
    },
  };

  test("renders a Callee ref-only row and the positional args", async () => {
    const m = await mount(
      { operator: "call", target: { $ref: "#/state/lineTotal" }, value: [2, 3] },
      { stateEntries: STATE_ENTRIES },
    );
    const target = row(m.host, "target");
    expect(target.textContent).toContain("Callee");
    // A callee must be a ref → no rung picker beside it.
    expect(part(target, "source")).toBeNull();
    // Arg labels come from the named formula's catalog entry.
    expect(parts(m.host, "lead").map((l) => l.textContent)).toEqual(["price", "qty"]);
  });

  test("unresolvable callee falls back to the generic arg label", async () => {
    const m = await mount({
      operator: "call",
      target: { $ref: "#/state/missing" },
      value: [1],
    });
    expect(parts(m.host, "lead").map((l) => l.textContent)).toEqual(["arg"]);
  });

  test("editing an arg replaces only that index", async () => {
    const m = await mount(
      { operator: "call", target: { $ref: "#/state/lineTotal" }, value: [2, 3] },
      { stateEntries: STATE_ENTRIES },
    );
    const args = rowsOf(m.host).filter((r) => part(r, "lead"));
    commit(part(args[1]!, "literal-number"), "9");
    expect(m.changes[0]).toEqual({
      operator: "call",
      target: { $ref: "#/state/lineTotal" },
      value: [2, 9],
    });
  });

  test("switching operator to call seeds a ref target and empty args array", () => {
    const p = project({ operator: "+", target: 1, value: 2 });
    p.plans.get("::operator")!.setOperator!("call");
    expect(p.changes[0]).toEqual({ operator: "call", target: { $ref: "" }, value: [] });
  });

  test("switching to call keeps an existing args array and ref target", () => {
    const p = project({
      operator: "call",
      target: { $ref: "#/state/lineTotal" },
      value: [1],
    });
    p.plans.get("::operator")!.setOperator!("call");
    expect(p.changes[0]).toEqual({
      operator: "call",
      target: { $ref: "#/state/lineTotal" },
      value: [1],
    });
  });
});

// ─── Chips strip (depth 0) ───────────────────────────────────────────────────

describe("chips strip", () => {
  test("renders once at depth 0 above the form, not in nested editors", async () => {
    const m = await mount({ operator: "+", target: { operator: "-", target: 4 }, value: 1 });
    expect(parts(m.host, "chips").length).toBe(1);
    expect(part(m.host, "chips")!.compareDocumentPosition(rowsOf(m.host)[0]!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  test("does not render when the editor starts at a nested depth", async () => {
    const m = await mount({ operator: "!", target: null }, { depth: 1 });
    expect(part(m.host, "chips")).toBeNull();
  });

  test("a group chip is marked as a branch rather than a link of the chain", async () => {
    const m = await mount({ operator: "+", target: 1, value: { operator: "!", target: 2 } });
    const groups = parts(m.host, "chip").map((c) => (c as HTMLElement).dataset["group"]);
    expect(groups).toContain("true");
    expect(groups).toContain("false");
  });

  test("clicking a chip invokes the onChipSelect hook with the node path", async () => {
    const picks: unknown[] = [];
    const m = await mount(
      { operator: "!", target: { $ref: "#/state/count" } },
      { onChipSelect: (p: unknown) => picks.push(p) },
    );
    press(part(m.host, "chip"));
    expect(picks).toEqual([["target"]]);
    expect(m.changes.length).toBe(0);
  });

  test("chip clicks are a no-op without the hook", async () => {
    const m = await mount({ operator: "!", target: null });
    press(part(m.host, "chip"));
    expect(m.changes.length).toBe(0);
  });

  test("a chip key the strip does not hold reports nothing", () => {
    const picks: unknown[] = [];
    const p = project(
      { operator: "!", target: null },
      { onChipSelect: (x: unknown) => picks.push(x) },
    );
    expect(p.chipPaths.has("nope")).toBe(false);
    expect(picks).toEqual([]);
  });
});

// ─── Browse catalog affordance ───────────────────────────────────────────────

describe("browse catalog", () => {
  /** The palette's own popover slot — a Jx document mounted a turn after the click. */
  const paletteSlot = () =>
    document.querySelector('[data-jx-region="overlay.menu:formula-palette"]');
  const overlay = () => paletteSlot()?.querySelector('[part="overlay"]') ?? null;
  const names = () =>
    [...(paletteSlot()?.querySelectorAll('[part="option"] [part="label"]') ?? [])].map(
      (n) => n.textContent,
    );

  test("the button beside the operator picker opens the palette; picking inserts the entry", async () => {
    const m = await mount({ operator: "+", target: 1, value: 2 });
    const btn = part(row(m.host, "operator"), "catalog");
    expect(btn).not.toBeNull();
    press(btn);
    await flush(4);
    expect(overlay()).not.toBeNull();

    const item = [...paletteSlot()!.querySelectorAll('[part="option"]')].find(
      (i) => i.querySelector('[part="label"]')?.textContent === "?:",
    )!;
    pointer(item, "click");
    await flush(4);
    expect(m.changes[0]).toEqual({ initial: null, operator: "?:", target: null, value: null });
    expect(overlay()).toBeNull();
  });

  test("the palette includes named formulas when stateEntries are provided", async () => {
    const m = await mount(
      { operator: "+", target: 1, value: 2 },
      {
        stateEntries: {
          lineTotal: {
            $expression: { operator: "*", target: { $ref: "$args/a" }, value: 2 },
            parameters: ["a"],
          },
        },
      },
    );
    press(part(row(m.host, "operator"), "catalog"));
    await flush(4);
    expect(names()).toContain("lineTotal");
    overlay()!.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    await flush(4);
    expect(overlay()).toBeNull();
  });

  test("a nested editor offers the catalog on its own operator row too", async () => {
    const m = await mount({ operator: "+", target: { operator: "-", target: 4 }, value: 1 });
    expect(parts(m.host, "catalog").length).toBe(2);
  });
});

// ─── Ref picker ──────────────────────────────────────────────────────────────

describe("ref picker", () => {
  test("lists state refs with the prefix stripped from labels", async () => {
    const m = await mount({ operator: "=", target: { $ref: "#/state/count" } });
    const picker = part(row(m.host, "target"), "ref")!;
    expect(optionValues(picker)).toEqual(["#/state/count", "#/state/items"]);
    expect([...picker.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "count",
      "items",
    ]);
  });

  test("nothing to bind to → the shared empty state replaces the picker entirely", async () => {
    const m = await mount({ operator: "=", target: { $ref: "" } }, { stateDefs: [] });
    const target = row(m.host, "target");
    // A picker whose only entry was a disabled "No state defined" was a dead end; the region now
    // Says what a binding IS, in the same voice as every other empty region in the shell.
    expect(part(target, "ref")).toBeNull();
    expect(part(target, "empty-message")!.textContent).toBe(
      "A binding points at a value this page holds.",
    );
    expect(part(target, "empty-detail")!.textContent).toBe(
      "Add one in the State panel and it shows up here.",
    );
  });

  test("no state but event refs available → the picker still renders, with no dead entry", async () => {
    const m = await mount(
      { operator: "=", target: { $ref: "" } },
      { allowEventRef: true, stateDefs: [] },
    );
    const target = row(m.host, "target");
    expect(part(target, "empty")).toBeNull();
    expect(optionValues(part(target, "ref"))).toEqual(["event#/detail", "event#/target/value"]);
  });

  test("an existing ref keeps the picker even with no state defined", async () => {
    const m = await mount({ operator: "=", target: { $ref: "#/state/gone" } }, { stateDefs: [] });
    const target = row(m.host, "target");
    expect(part(target, "empty")).toBeNull();
    expect(part(target, "ref")).not.toBeNull();
  });

  test("allowEventRef adds the event refs as their own named group", async () => {
    const m = await mount({ operator: "=", target: { $ref: "" } }, { allowEventRef: true });
    const picker = part(row(m.host, "target"), "ref")!;
    expect([...picker.querySelectorAll("optgroup")].map((g) => g.getAttribute("label"))).toEqual([
      "Event",
    ]);
    expect(optionValues(picker)).toContain("event#/detail");
    expect(optionValues(picker)).toContain("event#/target/value");
  });

  test("a ref no group holds keeps its own stand-in row rather than falling to the first", async () => {
    const m = await mount({ operator: "=", target: { $ref: "#/weird/path" } });
    const picker = part(row(m.host, "target"), "ref")!;
    // The `__custom__` sentinel is gone: the kit's select synthesises the row, so the control shows
    // What the document actually holds instead of a placeholder its own handler had to ignore.
    expect(picker.querySelector('[part="unlisted"]')?.getAttribute("value")).toBe("#/weird/path");
    expect(selectValue(picker)).toBe("#/weird/path");
    expect(m.changes.length).toBe(0);
  });

  test("selecting a ref emits an updated target", async () => {
    const m = await mount({
      operator: "=",
      target: { $ref: "#/state/count" },
      value: null,
    });
    pick(part(row(m.host, "target"), "ref"), "#/state/items");
    expect(m.changes[0]).toEqual({
      operator: "=",
      target: { $ref: "#/state/items" },
      value: null,
    });
  });
});

// ─── Operator change handler ─────────────────────────────────────────────────

describe("operator change", () => {
  /** Every case is the same shape: pick an operator, read what the node became. */
  function reoperated(node: unknown, op: string): unknown {
    const p = project(node);
    p.plans.get("::operator")!.setOperator!(op);
    return p.changes[0];
  }

  test("a pick on the real control commits through the same plan", async () => {
    const m = await mount({ operator: "=", target: { $ref: "#/state/count" }, value: 5 });
    pick(part(row(m.host, "operator"), "operator"), "+=");
    expect(m.changes[0]).toEqual({
      operator: "+=",
      target: { $ref: "#/state/count" },
      value: 5,
    });
  });

  test("switching to push coerces a non-ref target to an empty ref and adds value", () => {
    expect(reoperated({ operator: "=", target: null }, "push")).toEqual({
      operator: "push",
      target: { $ref: "" },
      value: null,
    });
  });

  test("switching to splice seeds value with [null] when not an array", () => {
    expect(
      reoperated({ operator: "=", target: { $ref: "#/state/items" }, value: "x" }, "splice"),
    ).toEqual({
      operator: "splice",
      target: { $ref: "#/state/items" },
      value: [null],
    });
  });

  test("switching to splice keeps an existing array value", () => {
    expect(
      reoperated(
        { operator: "splice", target: { $ref: "#/state/items" }, value: [0, 1] },
        "splice",
      ),
    ).toEqual({ operator: "splice", target: { $ref: "#/state/items" }, value: [0, 1] });
  });

  test("switching to reduce seeds a node value and initial", () => {
    expect(
      reoperated({ operator: "=", target: { $ref: "#/state/items" }, value: 3 }, "reduce"),
    ).toEqual({
      initial: 0,
      operator: "reduce",
      target: { $ref: "#/state/items" },
      value: { operator: "!", target: null },
    });
  });

  test("switching to reduce keeps an existing node value and initial", () => {
    expect(
      reoperated(
        {
          initial: 7,
          operator: "map",
          target: { $ref: "#/state/items" },
          value: { operator: "+", target: 1, value: 2 },
        },
        "reduce",
      ),
    ).toEqual({
      initial: 7,
      operator: "reduce",
      target: { $ref: "#/state/items" },
      value: { operator: "+", target: 1, value: 2 },
    });
  });

  test("switching to ?: seeds a null else rather than a zero one", () => {
    expect(reoperated({ operator: "+", target: 1, value: 2 }, "?:")).toEqual({
      initial: null,
      operator: "?:",
      target: 1,
      value: 2,
    });
  });

  test("switching to a unary op drops value and initial", () => {
    expect(
      reoperated(
        {
          initial: 7,
          operator: "reduce",
          target: { $ref: "#/state/items" },
          value: { operator: "!", target: null },
        },
        "!",
      ),
    ).toEqual({ operator: "!", target: { $ref: "#/state/items" } });
  });

  test("an operator the editor does not know produces a bare operator/target node", () => {
    // Unreachable from the control — a native select holds only rows the document listed — and
    // Still a contract: `operatorInfo` falls through to the defaults for anything unrecognised.
    expect(reoperated({ operator: "+", target: 1, value: 2 }, "mystery")).toEqual({
      operator: "mystery",
      target: 1,
    });
  });

  test("switching to switch seeds empty cases and drops value", () => {
    expect(reoperated({ operator: "+", target: 1, value: 2 }, "switch")).toEqual({
      cases: {},
      operator: "switch",
      target: 1,
    });
  });

  test("switching to switch keeps existing cases and default", () => {
    expect(
      reoperated(
        {
          cases: { one: "a" },
          default: "d",
          operator: "switch",
          target: { $ref: "#/state/count" },
        },
        "switch",
      ),
    ).toEqual({
      cases: { one: "a" },
      default: "d",
      operator: "switch",
      target: { $ref: "#/state/count" },
    });
  });
});

// ─── Operand rung picker ─────────────────────────────────────────────────────

describe("operand rung switching", () => {
  test("switching target to a pointer emits an empty ref", async () => {
    const m = await mount({ operator: "+", target: 1, value: 2 });
    pick(part(row(m.host, "target"), "source"), "ref");
    expect(m.changes[0]).toEqual({ operator: "+", target: { $ref: "" }, value: 2 });
  });

  test("switching value to a formula emits a default expression node", async () => {
    const m = await mount({ operator: "+", target: 1, value: 2 });
    pick(part(row(m.host, "value"), "source"), "expression");
    expect(m.changes[0]).toEqual({
      operator: "+",
      target: 1,
      value: { operator: "!", target: null },
    });
  });

  test("switching to a fixed value — or to a rung that is not one of the three — emits null", () => {
    const p = project({ operator: "+", target: { $ref: "#/state/count" }, value: 2 });
    p.plans.get("::target")!.setSource!("literal");
    p.plans.get("::target")!.setSource!("bogus-rung");
    expect(p.changes).toEqual([
      { operator: "+", target: null, value: 2 },
      { operator: "+", target: null, value: 2 },
    ]);
  });

  test("a formula-mode operand shows the rung it holds and the nested rows commit through it", async () => {
    const m = await mount({
      operator: "+",
      target: { operator: "-", target: 4 },
      value: 1,
    });
    expect(pickerIn(m.host, "target", "source")).toBe("expression");
    // The nested node's operator row is the SECOND one: a sibling, one indent in.
    pick(parts(m.host, "operator")[1]!, "!");
    expect(m.changes[0]).toEqual({
      operator: "+",
      target: { operator: "!", target: 4 },
      value: 1,
    });
  });

  test("a ref-mode operand with nothing to bind to still offers the rung picker", async () => {
    const m = await mount({ operator: "+", target: { $ref: "" }, value: 1 }, { stateDefs: [] });
    const target = row(m.host, "target");
    expect(part(target, "source")).not.toBeNull();
    expect(part(target, "empty-message")).not.toBeNull();
  });
});

// ─── Literal editor ──────────────────────────────────────────────────────────

describe("literal editor", () => {
  test("string literal renders a text field and commits typed input", async () => {
    const m = await mount({ operator: "+", target: "hello", value: null });
    const field = part(row(m.host, "target"), "literal-text")!;
    expect((field.querySelector('[part="input"]') as HTMLInputElement).value).toBe("hello");
    type(field, "world");
    expect(m.changes[0]).toEqual({ operator: "+", target: "world", value: null });
  });

  test("number literal renders a number field and commits a number", async () => {
    const m = await mount({ operator: "+", target: 5, value: null });
    const field = part(row(m.host, "target"), "literal-number")!;
    expect((field.querySelector('[part="input"]') as HTMLInputElement).value).toBe("5");
    commit(field, "7");
    expect(m.changes[0]).toEqual({ operator: "+", target: 7, value: null });
  });

  test("boolean literal renders a checkbox and commits checked state", async () => {
    const m = await mount({ operator: "+", target: true, value: null });
    const box = part(row(m.host, "target"), "literal-bool")!;
    expect((box.querySelector('[part="input"]') as HTMLInputElement).checked).toBe(true);
    check(box, false);
    expect(m.changes[0]).toEqual({ operator: "+", target: false, value: null });
  });

  test("object operand without $ref or operator falls back to the literal editor", async () => {
    const m = await mount({ operator: "+", target: {}, value: 1 });
    const target = row(m.host, "target");
    expect(selectValue(part(target, "source"))).toBe("literal");
    // A plain object has no dedicated widget — it stringifies into the string editor.
    expect(part(target, "literal-text")).not.toBeNull();
  });

  test("null literal renders the inert null label and no control", async () => {
    const m = await mount({ operator: "+", target: null, value: 1 });
    const target = row(m.host, "target");
    expect(part(target, "literal-text")).toBeNull();
    expect(part(target, "literal-null")!.textContent).toBe("null");
    expect(selectValue(part(target, "literal-type"))).toBe("null");
  });

  test("the type picker emits each type's default", async () => {
    const m = await mount({ operator: "+", target: "x", value: null });
    const picker = part(row(m.host, "target"), "literal-type")!;
    expect(selectValue(picker)).toBe("string");
    for (const type_ of ["number", "boolean", "null", "string"]) {
      pick(picker, type_);
    }
    expect(m.changes.map((c) => (c as { target: unknown }).target)).toEqual([0, false, null, ""]);
  });
});

// ─── Positional args ─────────────────────────────────────────────────────────

describe("positional args", () => {
  async function mountSplice(value: unknown) {
    return mount({ operator: "splice", target: { $ref: "#/state/items" }, value });
  }

  const argRows = (host: HTMLElement) => rowsOf(host).filter((r) => part(r, "lead"));

  test("editing an arg replaces only that index", async () => {
    const m = await mountSplice([null, 1]);
    commit(part(argRows(m.host)[1]!, "literal-number"), "5");
    expect((m.changes[0] as { value: unknown[] }).value).toEqual([null, 5]);
  });

  test("the remove button takes away exactly that arg, and is named", async () => {
    const m = await mountSplice([0, 1, "a"]);
    const remove = part(argRows(m.host)[0]!, "remove")!;
    expect(buttonName(remove)).toBe("Remove start");
    press(remove);
    expect((m.changes[0] as { value: unknown[] }).value).toEqual([1, "a"]);
  });

  test("removing the last arg resets to [null]", async () => {
    const m = await mountSplice(["only"]);
    press(part(argRows(m.host)[0]!, "remove"));
    expect((m.changes[0] as { value: unknown[] }).value).toEqual([null]);
  });

  test("the add row appends a null arg", async () => {
    const m = await mountSplice([0]);
    press(part(m.host, "action"));
    expect((m.changes[0] as { value: unknown[] }).value).toEqual([0, null]);
  });

  test("a non-array value renders zero arg rows but still offers add", async () => {
    const m = await mountSplice("not-an-array");
    expect(argRows(m.host).length).toBe(0);
    press(part(m.host, "action"));
    expect((m.changes[0] as { value: unknown[] }).value).toEqual([null]);
  });

  test("an arg's own path is its own, so a formula inside one keys to that index", () => {
    const p = project({
      operator: "splice",
      target: { $ref: "#/state/items" },
      value: [{ operator: "!", target: 1 }],
    });
    // The nested node's rows sit under the arg's path, not under the parent's — which is what
    // Makes two args holding formulas two distinct rows rather than one key written twice.
    expect(p.rows.map((r: ExprRowView) => r.key)).toContain("value/0::operator");
  });
});

// ─── Per-item / initial editing for aggregates ───────────────────────────────

describe("aggregate value and initial editing", () => {
  test("editing the per-item expression propagates through value", async () => {
    const m = await mount({
      initial: 0,
      operator: "reduce",
      target: { $ref: "#/state/items" },
      value: { operator: "!", target: null },
    });
    pick(parts(m.host, "operator")[1]!, "pop");
    expect(m.changes[0]).toEqual({
      initial: 0,
      operator: "reduce",
      target: { $ref: "#/state/items" },
      value: { operator: "pop", target: { $ref: "" } },
    });
  });

  test("editing initial via its number field propagates", async () => {
    const m = await mount({
      initial: 0,
      operator: "reduce",
      target: { $ref: "#/state/items" },
      value: { operator: "!", target: null },
    });
    commit(part(row(m.host, "initial"), "literal-number"), "42");
    expect((m.changes[0] as { initial: number }).initial).toBe(42);
  });

  test("a conditional labels its three slots If / Then / Else", async () => {
    const m = await mount({
      initial: 2,
      operator: "?:",
      target: { $ref: "#/state/count" },
      value: 1,
    });
    expect(row(m.host, "target").textContent).toContain("If");
    expect(row(m.host, "value").textContent).toContain("Then");
    expect(row(m.host, "initial").textContent).toContain("Else");
  });
});

// ─── Switch cases ────────────────────────────────────────────────────────────

describe("switch cases", () => {
  async function mountSwitch(cases: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return mount({
      cases,
      default: null,
      operator: "switch",
      target: { $ref: "#/state/count" },
      ...extra,
    });
  }

  const caseKeys = (host: HTMLElement) =>
    parts(host, "case-key").map(
      (f) => (f.querySelector('[part="input"]') as HTMLInputElement).value,
    );

  test("renders a key field per case, the default row, and the add row", async () => {
    const m = await mountSwitch({ a: { $ref: "#/state/count" }, b: null });
    expect(caseKeys(m.host)).toEqual(["a", "b"]);
    expect(part(m.host, "lead")!.textContent).toBe("default");
    expect(part(m.host, "action")!.textContent).toContain("+ Add case");
  });

  test("a case rename preserves order and operands; a same-key rename is a no-op", async () => {
    const m = await mountSwitch({ a: { $ref: "#/state/count" }, b: null });
    const key = part(m.host, "case-key");
    commit(key, "a");
    expect(m.changes.length).toBe(0);
    commit(key, "z");
    const { cases } = m.changes[0] as { cases: Record<string, unknown> };
    expect(cases).toEqual({ b: null, z: { $ref: "#/state/count" } });
    expect(Object.keys(cases)).toEqual(["z", "b"]);
  });

  test("editing a case operand writes through that key only", async () => {
    const m = await mountSwitch({ a: 1, b: 2 });
    const caseRow = rowsOf(m.host).find((r) => part(r, "case-key"))!;
    commit(part(caseRow, "literal-number"), "9");
    expect((m.changes[0] as { cases: unknown }).cases).toEqual({ a: 9, b: 2 });
  });

  test("the remove button takes away exactly that case, and is named", async () => {
    const m = await mountSwitch({ a: 1, b: 2 });
    const caseRow = rowsOf(m.host).find((r) => part(r, "case-key"))!;
    expect(buttonName(part(caseRow, "remove"))).toBe("Remove case a");
    press(part(caseRow, "remove"));
    expect((m.changes[0] as { cases: unknown }).cases).toEqual({ b: 2 });
  });

  test("editing the default operand writes the default key", async () => {
    const m = await mountSwitch({}, { default: 5 });
    const defaultRow = rowsOf(m.host).find((r) => part(r, "lead"))!;
    commit(part(defaultRow, "literal-number"), "7");
    expect((m.changes[0] as { default: number }).default).toBe(7);
  });

  test("add case generates a fresh key past collisions, seeded null", async () => {
    const m = await mountSwitch({ "case 2": null });
    press(part(m.host, "action"));
    // One existing entry → tries "case 2" (taken) → lands on "case 3".
    expect((m.changes[0] as { cases: unknown }).cases).toEqual({
      "case 2": null,
      "case 3": null,
    });
  });

  test("a node whose cases are not an object is read as having none", () => {
    const p = project({ cases: "nope", operator: "switch", target: null });
    p.plans.get("::add-case")!.act!();
    expect((p.changes[0] as { cases: unknown }).cases).toEqual({ "case 1": null });
  });
});

// ─── Live value badges ───────────────────────────────────────────────────────

describe("live value badges", () => {
  const preview = {
    error: null,
    mutating: false,
    values: new Map([
      ["", "6"],
      ["target", "2 × 3 = 6 — a value long enough to need the ellipsis"],
    ]),
  };

  test("a pure root shows its result on the operator row and its operand on the target row", async () => {
    const m = await mount({ operator: "+", target: 2, value: 3 }, { preview });
    const badge = (r: HTMLElement) => part(r, "badge");
    expect(badge(row(m.host, "operator"))!.textContent).toBe("6");
    expect(badge(row(m.host, "target"))!.textContent).toBe(preview.values.get("target")!);
    // The title is the untruncated text: the ellipsis is CSS, so the value stays readable.
    expect(badge(row(m.host, "target"))!.getAttribute("title")).toBe(
      badge(row(m.host, "target"))!.textContent,
    );
    expect(badge(row(m.host, "value"))).toBeNull();
  });

  test("a mutating root shows no result of its own — its effect is on the operands", async () => {
    const m = await mount(
      { operator: "=", target: { $ref: "#/state/count" }, value: 3 },
      { preview: { ...preview, mutating: true } },
    );
    expect(part(row(m.host, "operator"), "badge")).toBeNull();
  });

  test("an empty string is a value, and draws a badge", async () => {
    const m = await mount(
      { operator: "+", target: 1, value: 2 },
      { preview: { error: null, mutating: false, values: new Map([["target", ""]]) } },
    );
    expect(part(row(m.host, "target"), "badge")!.textContent).toBe("");
    expect(part(row(m.host, "target"), "badge")).not.toBeNull();
  });
});

// ─── The mount seam ──────────────────────────────────────────────────────────

describe("the mount seam", () => {
  test("a second call into a standing host ASSIGNS rather than remounting", async () => {
    const m = await mount({ operator: "+", target: 1, value: 2 });
    const first = rowsOf(m.host)[0]!;
    await m.update({ operator: "-", target: 1, value: 2 });
    expect(pickerIn(m.host, "operator", "operator")).toBe("-");
    // The same node: a keyed repeater keeps the row, which is what keeps a reader's caret in it.
    expect(rowsOf(m.host)[0]).toBe(first);
  });

  test("a gesture after an update commits the NEW node, not the one the mount was built with", async () => {
    const m = await mount({ operator: "+", target: 1, value: 2 });
    await m.update({ operator: "*", target: 5, value: 2 });
    pick(part(row(m.host, "operator"), "operator"), "/");
    /* The document's scope is read ONCE — an assignment repaint never rebuilds it — so an action
       that closed over the projection beside it would go on rewriting the tree that projection was
       walked from. Here that would commit `target: 1`, the value two projections ago. */
    expect(m.changes[0]).toEqual({ operator: "/", target: 5, value: 2 });
  });

  test("a host that has left the page is taken down on the next mount anywhere", async () => {
    const gone = await mount({ operator: "!", target: null });
    gone.host.remove();
    const live = await mount({ operator: "!", target: null });
    expect(live.host.querySelector('[part="expression"]')).not.toBeNull();
    // The detached one was disposed rather than left standing with nothing to draw into.
    expect(gone.host.isConnected).toBe(false);
  });

  test("a host given up while its mount is in flight takes itself down when it settles", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    mountExpressionEditor(host, { operator: "!", target: null }, () => {}, DEFAULT_OPTS as never);
    /* Detached and swept BEFORE the mount settles — a slot the reader unbinds does exactly this.
       The record is marked given-up, so the handle that arrives afterwards disposes itself rather
       than leaving a live document standing in a node nothing can reach. */
    host.remove();
    await mount({ operator: "!", target: null });
    expect(host.querySelector('[part="expression"]')).toBeNull();
    expect(host.childNodes.length).toBe(0);
  });

  test("one operand slot mounts with no operator row above it", async () => {
    const changes: unknown[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    mountOperandEditor(host, { $ref: "#/state/count" }, (v) => changes.push(v), {
      ...DEFAULT_OPTS,
      label: "If",
      prop: "if",
    } as never);
    await flush(6);
    expect(part(host, "operator")).toBeNull();
    expect(row(host, "if").textContent).toContain("If");
    pick(part(host, "ref"), "#/state/items");
    expect(changes[0]).toEqual({ $ref: "#/state/items" });
  });

  test("an operand slot with no name of its own falls back to Value", () => {
    const { rows } = flattenOperand(null, () => {}, { ...DEFAULT_OPTS } as never);
    expect(rows[0]!.label).toBe("Value");
    expect(rows[0]!.prop).toBe("operand");
  });
});

// ─── The document emits no class ─────────────────────────────────────────────

describe("the surface is styled through part, never through a class", () => {
  test("no element the editor draws carries a class or an inline style attribute", async () => {
    const m = await mount(
      { cases: { a: 1 }, default: null, operator: "switch", target: { $ref: "#/state/count" } },
      {
        preview: {
          error: "boom",
          mutating: false,
          values: new Map([["target", "2"]]),
        },
      },
    );
    const classed = [...m.host.querySelectorAll("[class]")].map((e) => e.tagName.toLowerCase());
    expect(classed).toEqual([]);
    /* The one `style` attribute a row may carry is `--expr-indent`, which IS the row's own data.
       A kit element's own internals are its business — this asks about what the DOCUMENT drew. */
    const styled = [...m.host.querySelectorAll("[style]")].filter(
      (e) =>
        (e as HTMLElement).style.getPropertyValue("--expr-indent") === "" &&
        e.closest(
          "jx-icon, jx-select, jx-textfield, jx-number-field, jx-checkbox, jx-action-button",
        ) === null,
    );
    expect(styled.map((e) => e.getAttribute("part"))).toEqual([]);
  });
});
