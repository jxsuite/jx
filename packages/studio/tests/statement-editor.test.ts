// oxlint-disable unicorn/no-thenable -- `then` is the JSON Schema conditional keyword (spec §20), not a promise
/**
 * Tests for the statement editor (spec §20): `src/panels/statement-editor.ts`, the flow, and
 * `src/surfaces/statements.json`, the document it mounts.
 *
 * Everything is addressed by `part`, by `data-prop`, by `data-stmt-*` and by region, because the
 * editor is a document: there is no `.statement-card`, no `sp-picker.statement-add` and no
 * `.statement-lane-header` to find any more. Every mount is awaited — `mountSurface` settles when
 * the document has rendered, and a kit element's own template is one `connectedCallback` after
 * that, so a synchronous assertion finds nothing at all.
 *
 * The tree arrives FLAT. A statement nests to any depth and a document's one repeater walks a list,
 * so the walk emits rows in reading order and each carries its own indent — which is why a lane's
 * cards are siblings of the card they belong to rather than descendants of it. The lane a card is
 * addressed at (`data-stmt-lane`) is what still says where it belongs, and that is exactly what the
 * drag adapter reads.
 */
import { flush, pointer, stubRect } from "./harness";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { extractInstruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import {
  NAVIGATOR_STATEMENTS_REGION,
  inspectorStatementsRegion,
  resolveAllRegions,
  resolveRegion,
} from "../src/ui/regions";

import type { JxStatement } from "@jxsuite/schema/types";

// ─── DnD adapter mock ────────────────────────────────────────────────────────
/**
 * RegisterStatementsDnD imports the pragmatic-drag-and-drop element adapter dynamically inside its
 * rAF callback, so mocking here — before the module under test is imported — intercepts every
 * registration. The tree-item hitbox and combine stay real.
 */

type AnyRec = Record<string, any>;

const draggables: AnyRec[] = [];
const dropTargets: AnyRec[] = [];
const previewsDisabled: AnyRec[] = [];

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: (cfg: AnyRec) => {
    draggables.push(cfg);
    return () => {};
  },
  dropTargetForElements: (cfg: AnyRec) => {
    dropTargets.push(cfg);
    return () => {};
  },
}));

// The real helper is inert under the harness (its 1x1 image is only created when `window` exists
// At npm-module evaluation time, which precedes happy-dom registration) — record calls instead.
void mock.module("@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview", () => ({
  disableNativeDragPreview: (args: AnyRec) => {
    previewsDisabled.push(args);
  },
}));

/**
 * The add-statement control opens the kit's MENU now rather than being a picker of its own — an
 * `sp-picker` that had to reset its own value inside its change handler so the placeholder came
 * back, which a document's skip-an-equal-write makes impossible. The menu is a settled surface, so
 * the assertions here are about what it is OFFERED and what a pick commits.
 */
const menus: AnyRec[] = [];
void mock.module("../src/surfaces/menu", () => ({
  openMenu: (options: AnyRec) => {
    menus.push(options);
    return { close: () => {} };
  },
}));

const { flattenStatements, laneListAt, mountStatementEditor, statementKind, withLaneList } =
  await import("../src/panels/statement-editor");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_OPTS = {
  allowEventRef: true,
  region: NAVIGATOR_STATEMENTS_REGION,
  stateDefs: ["count", "items"],
};

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) {
    host.remove();
  }
  draggables.length = 0;
  dropTargets.length = 0;
  previewsDisabled.length = 0;
  menus.length = 0;
});

interface Mounted {
  host: HTMLElement;
  changes: JxStatement[][];
  /** Re-run the flow over a new tree, the way a host's repaint does. */
  update: (next: JxStatement[]) => Promise<void>;
}

/**
 * Mount an editor into an ATTACHED host of its own.
 *
 * Attached, because the region ids are resolved out of the live document and because a mount keyed
 * by host is only swept when its host leaves the page.
 */
async function mount(
  statements: JxStatement[],
  opts: Record<string, unknown> = {},
): Promise<Mounted> {
  const changes: JxStatement[][] = [];
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const options = { ...DEFAULT_OPTS, ...opts } as never;
  const push = (next: JxStatement[]) => changes.push(next);
  mountStatementEditor(host, statements, push, options);
  await flush(6);
  return {
    changes,
    host,
    async update(next) {
      mountStatementEditor(host, next, push, options);
      await flush(4);
    },
  };
}

const cards = (host: HTMLElement) => [...host.querySelectorAll('[part="card"]')] as HTMLElement[];
const lanes = (host: HTMLElement) => [...host.querySelectorAll('[part="lane"]')] as HTMLElement[];
const adds = (host: HTMLElement) =>
  [...host.querySelectorAll('[part="add-statement"]')] as HTMLElement[];

/** Press a kit control the way a reader does: the click lands on the button inside it. */
function press(el: Element | null): void {
  pointer(el!.querySelector('[part="control"]') ?? el!, "click");
}

/** Type into a control: it reports, and the event bubbles to the element that owns the handler. */
function type(el: Element | null, value: string): void {
  const input = el!.querySelector('[part="input"]') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Commit a control: the value is set and `change` fires, as a blur or a pick does. */
function commit(el: Element | null, value: string): void {
  const input = el!.querySelector('[part="input"], [part="control"]') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Toggle a checkbox the way a reader does. */
function check(el: Element | null, next: boolean): void {
  const input = el!.querySelector('[part="input"]') as HTMLInputElement;
  input.checked = next;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Open a lane's add menu and pick one of its rows. */
function addStatement(m: Mounted, laneIndex: number, kind: string): void {
  press(adds(m.host)[laneIndex]!);
  menus.at(-1)!.run(kind);
}

// ─── statementKind ───────────────────────────────────────────────────────────

describe("statementKind", () => {
  test("discriminates the four kinds in runtime order", () => {
    expect(statementKind({ operator: "=", target: null })).toBe("expression");
    expect(statementKind({ if: null, then: [] })).toBe("if");
    expect(statementKind({ $switch: null, cases: {} })).toBe("switch");
    expect(statementKind({ dispatchEvent: "x" })).toBe("dispatch");
  });

  test("operator wins when a node also carries branch-like keys", () => {
    expect(statementKind({ if: 1, operator: "=", target: null })).toBe("expression");
  });

  test("non-objects and unknown shapes fall back to expression", () => {
    expect(statementKind(null)).toBe("expression");
    expect(statementKind("x")).toBe("expression");
    expect(statementKind({})).toBe("expression");
  });
});

// ─── laneListAt / withLaneList ───────────────────────────────────────────────

describe("lane addressing", () => {
  const tree: JxStatement[] = [
    { operator: "=", target: { $ref: "#/state/count" }, value: 1 },
    {
      else: [{ dispatchEvent: "no" }],
      if: { $ref: "#/state/count" },
      then: [{ dispatchEvent: "yes" }],
    },
    {
      $switch: { $ref: "#/state/count" },
      cases: { a: [{ dispatchEvent: "a" }] },
      default: [{ dispatchEvent: "d" }],
    },
  ];

  test("empty path resolves the root list", () => {
    expect(laneListAt(tree, [])).toBe(tree);
  });

  test("resolves then/else/cases/default lanes", () => {
    expect(laneListAt(tree, [1, "then"])).toEqual([{ dispatchEvent: "yes" }]);
    expect(laneListAt(tree, [1, "else"])).toEqual([{ dispatchEvent: "no" }]);
    expect(laneListAt(tree, [2, "cases", "a"])).toEqual([{ dispatchEvent: "a" }]);
    expect(laneListAt(tree, [2, "default"])).toEqual([{ dispatchEvent: "d" }]);
  });

  test("stale or invalid paths resolve to null", () => {
    expect(laneListAt(tree, [9, "then"])).toBeNull();
    expect(laneListAt(tree, [0, "then"])).toBeNull();
    expect(laneListAt(tree, [1, "bogus"])).toBeNull();
    expect(laneListAt(tree, [2, "cases", "missing"])).toBeNull();
    expect(laneListAt(tree, ["then", 1])).toBeNull();
  });

  test("withLaneList replaces a nested lane immutably", () => {
    const before = structuredClone(tree);
    const next = withLaneList(tree, [1, "then"], []);
    expect(tree).toEqual(before);
    expect(next).not.toBe(tree);
    expect((next[1] as { then: JxStatement[] }).then).toEqual([]);
    // Untouched siblings keep their identity
    expect(next[0]).toBe(tree[0]);
    expect(next[2]).toBe(tree[2]);
  });

  test("withLaneList replaces a case lane without disturbing other keys", () => {
    const next = withLaneList(tree, [2, "cases", "a"], [{ dispatchEvent: "z" }]);
    const sw = next[2] as { cases: Record<string, JxStatement[]>; default: JxStatement[] };
    expect(sw.cases.a).toEqual([{ dispatchEvent: "z" }]);
    expect(sw.default).toEqual([{ dispatchEvent: "d" }]);
  });

  test("withLaneList with the empty path returns the replacement list", () => {
    expect(withLaneList(tree, [], [])).toEqual([]);
  });
});

// ─── The walk is the editor ──────────────────────────────────────────────────

describe("flattenStatements", () => {
  /*
   * Recursion is a property of the WALK, not of the markup: the document has one repeater over a
   * list, so the order these rows come out in and the keys they carry are the contract. A card's
   * lanes follow it as SIBLINGS at one more indent, which is what makes a tree of any depth cost
   * one `$map`.
   */
  test("emits a card, its lanes, and one add row per lane, in reading order", () => {
    const { rows } = flattenStatements(
      [{ else: [], if: { $ref: "#/state/count" }, then: [{ dispatchEvent: "x" }] }],
      () => {},
      DEFAULT_OPTS as never,
    );
    expect(rows.map((r) => `${r.kind}:${r.label}`)).toEqual([
      "card:If / Else",
      "lane:Then",
      "card:Dispatch event",
      "add:Add statement",
      "lane:Else",
      "add:Add statement",
      "add:Add statement",
    ]);
  });

  test("indent is a property of the row, and the root lane has none", () => {
    const { rows } = flattenStatements(
      [{ if: { $ref: "#/state/count" }, then: [{ dispatchEvent: "x" }] }],
      () => {},
      DEFAULT_OPTS as never,
    );
    expect(rows[0]!.indent).toBe("0");
    expect(rows[1]!.indent).toBe("calc(var(--jx-space-3) * 1)");
    expect(rows[2]!.indent).toBe("calc(var(--jx-space-3) * 1)");
  });

  test("a card's key names its lane and its index, so two cards never collide", () => {
    const { rows } = flattenStatements(
      [{ if: { $ref: "#/state/count" }, then: [{ dispatchEvent: "x" }, { dispatchEvent: "y" }] }],
      () => {},
      DEFAULT_OPTS as never,
    );
    const keys = rows.filter((r) => r.kind === "card").map((r) => r.key);
    expect(keys).toEqual(["[]#0", '[0,"then"]#0', '[0,"then"]#1']);
  });

  test("a switch emits a lane per case, a Default lane, and an Add case action", () => {
    const { rows } = flattenStatements(
      [{ $switch: { $ref: "#/state/count" }, cases: { a: [], b: [] } }],
      () => {},
      DEFAULT_OPTS as never,
    );
    expect(rows.filter((r) => r.kind === "lane").map((r) => r.label)).toEqual([
      "a",
      "b",
      "Default",
    ]);
    expect(rows.filter((r) => r.kind === "action").map((r) => r.label)).toEqual(["Add case"]);
    // A case lane is named by its own value, so its header is editable and removable.
    const caseLane = rows.find((r) => r.kind === "lane")!;
    expect(caseLane.editable).toBe(true);
    expect(caseLane.removable).toBe(true);
  });

  test("a Then lane is neither editable nor removable; an Else lane is removable", () => {
    const { rows } = flattenStatements(
      [{ else: [], if: null, then: [] }],
      () => {},
      DEFAULT_OPTS as never,
    );
    const [then, otherwise] = rows.filter((r) => r.kind === "lane");
    expect(then).toMatchObject({ editable: false, label: "Then", removable: false });
    expect(otherwise).toMatchObject({ editable: false, label: "Else", removable: true });
  });
});

// ─── Rendering each statement kind ───────────────────────────────────────────

describe("the document draws the four kinds", () => {
  test("one card per statement, with its kind label and its lane address", async () => {
    const m = await mount([
      { operator: "=", target: { $ref: "#/state/count" }, value: 1 },
      { operator: "call", target: { $ref: "#/state/save" }, value: [] },
      { operator: "push", target: { $ref: "#/state/items" }, value: 1 },
      { if: { $ref: "#/state/count" }, then: [] },
      { $switch: { $ref: "#/state/count" }, cases: {} },
      { dispatchEvent: "saved" },
    ]);
    const rows = cards(m.host);
    expect(rows.map((c) => c.querySelector('[part="kind"]')!.textContent!.trim())).toEqual([
      "Set state",
      "Call",
      "Expression",
      "If / Else",
      "Switch",
      "Dispatch event",
    ]);
    expect(rows.map((c) => c.dataset.stmtKind)).toEqual([
      "expression",
      "expression",
      "expression",
      "if",
      "switch",
      "dispatch",
    ]);
    expect(rows[0]!.dataset.stmtLane).toBe("[]");
    expect(rows[5]!.dataset.stmtIndex).toBe("5");
  });

  test("every card has a drag handle and a delete button", async () => {
    const m = await mount([{ dispatchEvent: "x" }]);
    const card = cards(m.host)[0]!;
    expect(card.querySelector('[part="drag"]')).toBeTruthy();
    expect(card.querySelector('[part="delete"]')).toBeTruthy();
  });

  test("an expression card's operand is an ISLAND filled with the expression editor", async () => {
    const m = await mount([{ operator: "=", target: { $ref: "#/state/count" }, value: 1 }]);
    const host = cards(m.host)[0]!.querySelector('[part="control-host"]') as HTMLElement;
    expect(host).toBeTruthy();
    // The document renders the host node and NOTHING inside it; the flow fills it (§9.4).
    expect(host.dataset.field).toBe("[]#0::expression");
    expect(host.querySelector(".expression-editor")).toBeTruthy();
  });

  test("if card renders the test operand, a Then lane, and an Add else action", async () => {
    const m = await mount([{ if: { $ref: "#/state/count" }, then: [] }]);
    expect(m.host.querySelector('[data-prop="if"] [part="control-host"]')).toBeTruthy();
    expect(lanes(m.host).map((l) => l.textContent!.trim())).toContain("Then");
    expect(m.host.querySelector('[data-action="act:[]#0:else"]')).toBeTruthy();
  });

  test("if card with an else renders that lane with a remove button instead", async () => {
    const m = await mount([{ else: [], if: { $ref: "#/state/count" }, then: [] }]);
    expect(lanes(m.host).map((l) => l.textContent!.trim())).toContain("Else");
    expect(m.host.querySelector('[data-action="act:[]#0:else"]')).toBeNull();
    expect(m.host.querySelector('[part="lane-remove"]')).toBeTruthy();
  });

  test("switch card renders discriminant, case lanes, default lane and Add case", async () => {
    const m = await mount([
      { $switch: { $ref: "#/state/count" }, cases: { a: [{ dispatchEvent: "x" }] } },
    ]);
    expect(m.host.querySelector('[data-prop="$switch"] [part="control-host"]')).toBeTruthy();
    const key = m.host.querySelector('[part="lane-key"] [part="input"]') as HTMLInputElement;
    expect(key.value).toBe("a");
    expect(lanes(m.host).map((l) => l.textContent!.trim())).toContain("Default");
    expect(m.host.querySelector('[data-action="act:[]#0:case"]')).toBeTruthy();
    // The case's nested statement is a sibling card, addressed at its own lane.
    expect(cards(m.host)[1]!.dataset.stmtLane).toBe('[0,"cases","a"]');
  });

  test("dispatch card renders a name field, a detail operand and the two init flags", async () => {
    const m = await mount([{ dispatchEvent: "saved" }]);
    const name = m.host.querySelector('[data-prop="dispatchEvent"] [part="text"]') as HTMLElement;
    expect(name.tagName.toLowerCase()).toBe("jx-textfield");
    expect((name.querySelector('[part="input"]') as HTMLInputElement).value).toBe("saved");
    expect(m.host.querySelector('[data-prop="detail"] [part="control-host"]')).toBeTruthy();
    const flags = [...m.host.querySelectorAll('[part="flag"]')] as HTMLElement[];
    expect(flags.map((f) => f.dataset.flag)).toEqual([
      "[]#0::eventInit::bubbles",
      "[]#0::eventInit::composed",
    ]);
  });

  test("every field row is a labelled kit field carrying its own data-prop", async () => {
    const m = await mount([{ dispatchEvent: "x" }]);
    const row = m.host.querySelector('[data-prop="dispatchEvent"]') as HTMLElement;
    expect(row.tagName.toLowerCase()).toBe("jx-field");
    expect(row.querySelector('[part="label"]')!.textContent).toBe("Event");
  });

  test("the whole surface emits no class at all — structure and style are the document's", async () => {
    const m = await mount([
      { operator: "=", target: { $ref: "#/state/count" }, value: 1 },
      { else: [], if: { $ref: "#/state/count" }, then: [{ dispatchEvent: "x" }] },
      { $switch: { $ref: "#/state/count" }, cases: { a: [] }, default: [] },
    ]);
    /* Rule 1 of the conversion: a converted surface emits ZERO CSS classes. The exception is the
       expression editor's island, which is still a lit surface over Spectrum and another
       conversion's to move — so classes are counted OUTSIDE it. */
    for (const island of m.host.querySelectorAll('[part="control-host"]')) {
      island.replaceChildren();
    }
    expect([...m.host.querySelectorAll("[class]")].map((el) => el.className)).toEqual([]);
  });
});

// ─── Add statement ───────────────────────────────────────────────────────────

describe("add statement", () => {
  test("offers the five kinds with ECMA/WHATWG labels, through the kit menu", async () => {
    const m = await mount([]);
    press(adds(m.host)[0]!);
    expect(menus).toHaveLength(1);
    expect(menus[0]!.label).toBe("Add statement");
    expect(menus[0]!.rows.map((r: AnyRec) => r.id)).toEqual([
      "set",
      "call",
      "if",
      "switch",
      "dispatch",
    ]);
    expect(menus[0]!.rows.map((r: AnyRec) => r.title)).toEqual([
      "Set state",
      "Call function",
      "If / Else",
      "Switch",
      "Dispatch event",
    ]);
  });

  test.each([
    ["set", { operator: "=", target: { $ref: "" }, value: null }],
    ["call", { operator: "call", target: { $ref: "" }, value: [] }],
    ["if", { if: { operator: "===", target: { $ref: "" }, value: null }, then: [] }],
    ["switch", { $switch: { $ref: "" }, cases: {} }],
    ["dispatch", { dispatchEvent: "" }],
  ])("appends the %s seed (spec §20 shape)", async (kind, seed) => {
    const existing: JxStatement[] = [{ dispatchEvent: "first" }];
    const m = await mount(existing);
    addStatement(m, 0, kind as string);
    expect(m.changes[0]).toEqual([{ dispatchEvent: "first" }, seed as JxStatement]);
    // Immutable: the input list was not appended to
    expect(existing.length).toBe(1);
  });

  test("an unknown row id is a no-op", async () => {
    const m = await mount([]);
    addStatement(m, 0, "bogus");
    expect(m.changes).toHaveLength(0);
  });

  test("adding inside a Then lane writes through the branch statement", async () => {
    const stmt: JxStatement = { if: { $ref: "#/state/count" }, then: [] };
    const m = await mount([stmt]);
    // The lane's add row comes before the root lane's, because the walk is depth-first.
    addStatement(m, 0, "dispatch");
    expect(m.changes[0]).toEqual([
      { if: { $ref: "#/state/count" }, then: [{ dispatchEvent: "" }] },
    ]);
    expect((stmt as { then: JxStatement[] }).then.length).toBe(0);
  });
});

// ─── Editing writes through immutably ────────────────────────────────────────

describe("statement editing", () => {
  test("add else seeds an empty lane; remove else drops the key", async () => {
    const m = await mount([{ if: { $ref: "#/state/count" }, then: [] }]);
    press(m.host.querySelector('[data-action="act:[]#0:else"]'));
    expect(m.changes[0]).toEqual([{ else: [], if: { $ref: "#/state/count" }, then: [] }]);

    const withElse = await mount([{ else: [], if: { $ref: "#/state/count" }, then: [] }]);
    press(withElse.host.querySelector('[part="lane-remove"]'));
    expect(withElse.changes[0]).toEqual([{ if: { $ref: "#/state/count" }, then: [] }]);
  });

  test("editing a nested statement inside a Then lane writes through", async () => {
    const m = await mount([{ if: { $ref: "#/state/count" }, then: [{ dispatchEvent: "old" }] }]);
    type(cards(m.host)[1]!.querySelector('[part="text"]'), "new");
    expect(m.changes[0]).toEqual([
      { if: { $ref: "#/state/count" }, then: [{ dispatchEvent: "new" }] },
    ]);
  });

  test("case rename preserves order and lane contents; a same-key rename is a no-op", async () => {
    const m = await mount([
      { $switch: { $ref: "#/state/count" }, cases: { a: [{ dispatchEvent: "x" }], b: [] } },
    ]);
    const key = m.host.querySelector('[part="lane-key"]');
    commit(key, "a");
    expect(m.changes).toHaveLength(0);
    commit(key, "z");
    expect(m.changes[0]).toEqual([
      { $switch: { $ref: "#/state/count" }, cases: { b: [], z: [{ dispatchEvent: "x" }] } },
    ]);
    expect(Object.keys((m.changes[0]![0] as { cases: object }).cases)).toEqual(["z", "b"]);
  });

  test("add case generates a fresh key; case remove deletes it", async () => {
    const m = await mount([{ $switch: { $ref: "#/state/count" }, cases: { "case 2": [] } }]);
    press(m.host.querySelector('[data-action="act:[]#0:case"]'));
    expect(m.changes[0]).toEqual([
      { $switch: { $ref: "#/state/count" }, cases: { "case 2": [], "case 3": [] } },
    ]);

    press(m.host.querySelector('[part="lane-remove"]'));
    expect(m.changes[1]).toEqual([{ $switch: { $ref: "#/state/count" }, cases: {} }]);
  });

  test("adding to the Default lane creates the key; emptying it removes the key", async () => {
    const m = await mount([{ $switch: { $ref: "#/state/count" }, cases: {} }]);
    // Lanes come out Default-last for a switch with no cases, so its add row is the first one.
    addStatement(m, 0, "dispatch");
    expect(m.changes[0]).toEqual([
      { $switch: { $ref: "#/state/count" }, cases: {}, default: [{ dispatchEvent: "" }] },
    ]);

    const withDefault = await mount([
      { $switch: { $ref: "#/state/count" }, cases: {}, default: [{ dispatchEvent: "d" }] },
    ]);
    press(cards(withDefault.host)[1]!.querySelector('[part="delete"]'));
    expect(withDefault.changes[0]).toEqual([{ $switch: { $ref: "#/state/count" }, cases: {} }]);
  });

  test("the delete button removes exactly that top-level statement", async () => {
    const m = await mount([
      { dispatchEvent: "one" },
      { dispatchEvent: "two" },
      { dispatchEvent: "three" },
    ]);
    press(cards(m.host)[1]!.querySelector('[part="delete"]'));
    expect(m.changes[0]).toEqual([{ dispatchEvent: "one" }, { dispatchEvent: "three" }]);
  });
});

// ─── Dispatch statement specifics ────────────────────────────────────────────

describe("dispatch statement", () => {
  test("offers declared emits names as a select, and a bare field when there are none", async () => {
    const withEmits = await mount([{ dispatchEvent: "" }], {
      emits: [{ name: "cart-changed" }, { name: "saved" }, { name: "" }],
    });
    const select = withEmits.host.querySelector('[data-prop="dispatchEvent"] [part="select"]')!;
    expect(select.tagName.toLowerCase()).toBe("jx-select");
    expect(
      [...select.querySelectorAll('[part="option"]')].map((o) => o.getAttribute("value")),
    ).toEqual(["cart-changed", "saved"]);

    const bare = await mount([{ dispatchEvent: "" }]);
    expect(bare.host.querySelector('[data-prop="dispatchEvent"] [part="select"]')).toBeNull();
    expect(bare.host.querySelector('[data-prop="dispatchEvent"] [part="text"]')).toBeTruthy();
  });

  test("picking a declared name commits it", async () => {
    const m = await mount([{ dispatchEvent: "" }], { emits: [{ name: "saved" }] });
    commit(m.host.querySelector('[data-prop="dispatchEvent"] [part="select"]'), "saved");
    expect(m.changes[0]).toEqual([{ dispatchEvent: "saved" }]);
  });

  test("the plain field commits typed names when no emits are declared", async () => {
    const m = await mount([{ dispatchEvent: "" }]);
    type(m.host.querySelector('[data-prop="dispatchEvent"] [part="text"]'), "custom-event");
    expect(m.changes[0]).toEqual([{ dispatchEvent: "custom-event" }]);
  });

  test("bubbles/composed check on sets true; uncheck removes the key (WHATWG defaults)", async () => {
    const m = await mount([{ dispatchEvent: "x" }]);
    check(m.host.querySelector('[data-flag="[]#0::eventInit::bubbles"]'), true);
    expect(m.changes[0]).toEqual([{ bubbles: true, dispatchEvent: "x" }]);

    const on = await mount([{ bubbles: true, composed: true, dispatchEvent: "x" }]);
    check(on.host.querySelector('[data-flag="[]#0::eventInit::composed"]'), false);
    expect(on.changes[0]).toEqual([{ bubbles: true, dispatchEvent: "x" }]);
  });
});

// ─── Drag-reorder (registerStatementsDnD) ────────────────────────────────────

describe("drag reorder", () => {
  const raf = () =>
    new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });

  /** Mount and wait for the rAF-deferred DnD registration to land. */
  async function mountDnD(statements: JxStatement[]) {
    const mounted = await mount(statements);
    await raf();
    await flush(2);
    return mounted;
  }

  const dragFor = (el: Element) => draggables.findLast((d) => d.element === el)!;
  const dropFor = (el: Element) => dropTargets.findLast((d) => d.element === el)!;

  /** Real tree-item hitbox data for a drag hovering the row at `clientY` (row rect 0–32px). */
  function dropDataFor(row: HTMLElement, clientY: number): AnyRec {
    stubRect(row, { height: 32, top: 0 });
    return dropFor(row).getData({ element: row, input: { clientX: 10, clientY } });
  }

  const three: JxStatement[] = [
    { dispatchEvent: "a" },
    { dispatchEvent: "b" },
    { dispatchEvent: "c" },
  ];

  test("registers per-row draggables carrying index/lane data, handle and a hidden preview", async () => {
    const m = await mountDnD(three);
    const rows = cards(m.host);
    expect(dragFor(rows[1]!).getInitialData()).toEqual({ index: 1, lane: "[]", type: "statement" });
    expect(dragFor(rows[0]!).dragHandle).toBe(rows[0]!.querySelector('[part="drag"]')!);

    // Generating a preview routes the native setter through disableNativeDragPreview.
    const before = previewsDisabled.length;
    const setter = () => {};
    dragFor(rows[0]!).onGenerateDragPreview({ nativeSetDragImage: setter });
    expect(previewsDisabled.length).toBe(before + 1);
    expect(previewsDisabled.at(-1)).toEqual({ nativeSetDragImage: setter });
  });

  test("dragging marks the row as data, which is what finally paints it", async () => {
    /* `dragging`, `drop-above` and `drop-below` were class toggles with NO RULE in any stylesheet
       in the package, so a card being dragged looked exactly like one that was not. They are data
       now, and `statements.json`'s style block paints them. */
    const m = await mountDnD(three);
    const row = cards(m.host)[0]!;
    dragFor(row).onDragStart();
    expect(row.dataset.dragging).toBe("");
    dragFor(row).onDrop();
    expect(row.dataset.dragging).toBeUndefined();
  });

  test("canDrop accepts only statements from the same lane", async () => {
    const m = await mountDnD([{ if: { $ref: "#/state/count" }, then: [{ dispatchEvent: "x" }] }]);
    const rows = cards(m.host);
    expect(rows[1]!.dataset.stmtLane).toBe('[0,"then"]');
    const topDrop = dropFor(rows[0]!);
    expect(topDrop.canDrop({ source: { data: { lane: "[]", type: "statement" } } })).toBe(true);
    expect(topDrop.canDrop({ source: { data: { lane: '[0,"then"]', type: "statement" } } })).toBe(
      false,
    );
    expect(topDrop.canDrop({ source: { data: { lane: "[]", type: "block" } } })).toBe(false);
  });

  test("getData attaches the tree-item hitbox instruction with make-child blocked", async () => {
    const m = await mountDnD(three);
    const row = cards(m.host)[1]!;
    const above = dropDataFor(row, 4);
    expect(above.index).toBe(1);
    expect(extractInstruction(above)?.type).toBe("reorder-above");
    expect(extractInstruction(dropDataFor(row, 30))?.type).toBe("reorder-below");
    // The middle zone would be make-child — blocked for statement rows.
    expect(extractInstruction(dropDataFor(row, 16))?.type).toBe("instruction-blocked");
  });

  test("onDrag shows the reorder edge; onDragLeave and onDrop clear it", async () => {
    const m = await mountDnD(three);
    const row = cards(m.host)[1]!;
    const drop = dropFor(row);
    drop.onDrag({ self: { data: dropDataFor(row, 4) } });
    expect(row.dataset.drop).toBe("above");
    drop.onDrag({ self: { data: dropDataFor(row, 30) } });
    expect(row.dataset.drop).toBe("below");
    drop.onDragLeave();
    expect(row.dataset.drop).toBeUndefined();
    // A drop without an instruction still clears the edge marker, then bails.
    drop.onDrag({ self: { data: dropDataFor(row, 4) } });
    drop.onDrop({ self: { data: {} }, source: { data: { index: 0, lane: "[]" } } });
    expect(row.dataset.drop).toBeUndefined();
    expect(m.changes).toHaveLength(0);
  });

  test("dropping above/below reorders the top-level lane immutably", async () => {
    const m = await mountDnD(three);
    const rows = cards(m.host);
    // C dropped above a → [c, a, b]
    dropFor(rows[0]!).onDrop({
      self: { data: dropDataFor(rows[0]!, 4) },
      source: { data: { index: 2, lane: "[]", type: "statement" } },
    });
    expect(m.changes[0]).toEqual([
      { dispatchEvent: "c" },
      { dispatchEvent: "a" },
      { dispatchEvent: "b" },
    ]);
    // A dropped below c → [b, c, a]
    dropFor(rows[2]!).onDrop({
      self: { data: dropDataFor(rows[2]!, 30) },
      source: { data: { index: 0, lane: "[]", type: "statement" } },
    });
    expect(m.changes[1]).toEqual([
      { dispatchEvent: "b" },
      { dispatchEvent: "c" },
      { dispatchEvent: "a" },
    ]);
    // The mounted list itself was never mutated.
    expect(three.map((s) => (s as { dispatchEvent: string }).dispatchEvent)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("no-op drops: blocked instruction, same row, and a same-position reorder", async () => {
    const m = await mountDnD(three);
    const rows = cards(m.host);
    dropFor(rows[1]!).onDrop({
      self: { data: dropDataFor(rows[1]!, 16) },
      source: { data: { index: 0, lane: "[]", type: "statement" } },
    });
    dropFor(rows[1]!).onDrop({
      self: { data: dropDataFor(rows[1]!, 4) },
      source: { data: { index: 1, lane: "[]", type: "statement" } },
    });
    dropFor(rows[0]!).onDrop({
      self: { data: dropDataFor(rows[0]!, 30) },
      source: { data: { index: 1, lane: "[]", type: "statement" } },
    });
    expect(m.changes).toHaveLength(0);
  });

  test("reorder inside a branch lane writes through the statement tree", async () => {
    const stmt: JxStatement = {
      if: { $ref: "#/state/count" },
      then: [{ dispatchEvent: "x" }, { dispatchEvent: "y" }],
    };
    const m = await mountDnD([stmt]);
    const nested = cards(m.host).filter((c) => c.dataset.stmtLane === '[0,"then"]');
    expect(nested).toHaveLength(2);
    dropFor(nested[0]!).onDrop({
      self: { data: dropDataFor(nested[0]!, 4) },
      source: { data: { index: 1, lane: '[0,"then"]', type: "statement" } },
    });
    expect(m.changes[0]).toEqual([
      { if: { $ref: "#/state/count" }, then: [{ dispatchEvent: "y" }, { dispatchEvent: "x" }] },
    ]);
    expect((stmt as { then: JxStatement[] }).then).toEqual([
      { dispatchEvent: "x" },
      { dispatchEvent: "y" },
    ]);
  });
});

// ─── The editor has two hosts, so it may not name one ─────────────────────────

describe("the region id names the HOST, not the control", () => {
  /*
   * The editor hard-stamped `data-jx-region="navigator/statements"` on itself, and it has two hosts
   * that can be open at the same time: the Navigator's State panel (`panels/signals-panel.ts`) and
   * the INSPECTOR's Logic tab (`panels/events-panel.ts`). `resolveRegion` takes the LAST match in
   * document order and `#right-panel` follows `#left-panel`, so the id resolved to the Inspector's
   * editor while saying Navigator — and the `statement-editor` shot cropped a control in the wrong
   * dock.
   *
   * The verdict is the one `ui/regions.ts`'s `DERIVED_RESOLVERS` already records for the media
   * picker's Browse button: an id claiming a surface the element is not in is not a pane-scoping
   * problem, it is a wrong id. It survives the conversion unchanged, because the id is stamped on
   * the HOST the caller supplies rather than anywhere in the document.
   */
  async function mountIn(parent: Element, region: string): Promise<HTMLElement> {
    const host = document.createElement("div");
    parent.append(host);
    hosts.push(host);
    mountStatementEditor(
      host,
      [{ operator: "=", target: { $ref: "#/state/count" }, value: 1 }],
      () => {},
      { ...DEFAULT_OPTS, region } as never,
    );
    await flush(6);
    return host;
  }

  test("with both editors open, each id resolves to exactly one, in its own dock", async () => {
    document.body.innerHTML = `<div id="app"><div id="left-panel"></div><div id="right-panel"></div></div>`;
    await mountIn(document.querySelector("#left-panel")!, NAVIGATOR_STATEMENTS_REGION);
    await mountIn(document.querySelector("#right-panel")!, inspectorStatementsRegion("onClick"));

    const navigator = resolveAllRegions(NAVIGATOR_STATEMENTS_REGION);
    const inspector = resolveAllRegions(inspectorStatementsRegion("onClick"));
    console.log(
      `[statement-editor] both docks open: navigator/statements → ${navigator.length} element(s), ` +
        `inspector/statements:onClick → ${inspector.length}`,
    );
    expect(navigator).toHaveLength(1);
    expect(inspector).toHaveLength(1);
    // The shot's id crops the NAVIGATOR's editor — the one the docs page is about.
    expect(resolveRegion(NAVIGATOR_STATEMENTS_REGION)!.closest("#left-panel")).not.toBeNull();
    expect(
      resolveRegion(inspectorStatementsRegion("onClick"))!.closest("#right-panel"),
    ).not.toBeNull();
  });

  /*
   * The Inspector's Logic tab draws ONE of these per structured handler on the selected node, so a
   * constant `inspector/statements` was unique only while a node had a single handler. Two handlers
   * made two elements answer to it and `resolveRegion` took the second.
   */
  test("two handlers on one node are two ids, each resolving to its own editor", async () => {
    document.body.innerHTML = `<div id="app"><div id="right-panel"></div></div>`;
    const panel = document.querySelector("#right-panel")!;
    for (const evKey of ["onClick", "onInput"]) {
      await mountIn(panel, inspectorStatementsRegion(evKey));
    }
    const clickEditors = resolveAllRegions(inspectorStatementsRegion("onClick"));
    const inputEditors = resolveAllRegions(inspectorStatementsRegion("onInput"));
    console.log(
      `[statement-editor] two handlers: inspector/statements:onClick → ${clickEditors.length}, ` +
        `inspector/statements:onInput → ${inputEditors.length}`,
    );
    expect(clickEditors).toHaveLength(1);
    expect(inputEditors).toHaveLength(1);
    expect(clickEditors[0]).not.toBe(inputEditors[0]);
  });

  test("a third host cannot appear without naming itself", async () => {
    // `region` is required on `StatementEditorOpts`, so the stamp is whatever the host said and
    // Nothing else. There is no default to fall back to being wrong about.
    document.body.innerHTML = `<div id="app"></div>`;
    const host = await mountIn(document.querySelector("#app")!, "dock.bottom/statements");
    expect(host.dataset.jxRegion).toBe("dock.bottom/statements");
  });
});
