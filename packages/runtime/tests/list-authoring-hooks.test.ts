/**
 * The authoring hooks a mapped array takes from its render options (`JxRenderOptions`): `rowLimit`,
 * `emptyRow` and `onListReconciled`. All three are off unless a host names them, which is what
 * `keyed-lists.test.ts` renders with.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { reactive } from "@vue/reactivity";
import { mount, renderNode } from "../src/runtime";
import type { JxDocument, JxElement, JxMappedArray, JxPath } from "@jxsuite/schema/types";
import type { JxListReconciliation, JxScopeValue } from "../src/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/* A type alias, not an interface: `emptyRow` answers a scope value, which is an indexable record,
   and only an alias is assignable to one without an index signature of its own. */
// oxlint-disable-next-line typescript/consistent-type-definitions
type Row = {
  id: string;
  title: string;
  kids?: Row[];
};

const row = (id: string): Row => ({ id, title: id.toUpperCase() });

// A repeater nested among children is structurally a JxElement (see JxElement.children).
const array = (extra: Partial<JxMappedArray> = {}): JxElement => ({
  $prototype: "Array",
  items: { $ref: "#/state/rows" },
  key: { $ref: "$map/item/id" },
  map: { tagName: "li", textContent: "${$map.index}:${item.title}" },
  ...extra,
});

const listDoc = (extra: Partial<JxMappedArray> = {}): JxDocument => ({
  children: [{ tagName: "caption" }, array(extra)],
  tagName: "ul",
});

let host: HTMLElement;
let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  warn = spyOn(console, "warn").mockImplementation(() => null);
});

afterEach(() => {
  host.remove();
  warn.mockRestore();
});

const items = () => [...host.querySelectorAll("li")].map((li) => li.textContent);

/** A recorder for `onListReconciled`, and what it was last told. */
function recorder() {
  const calls: [JxPath, JxListReconciliation][] = [];
  return {
    calls,
    hook: (path: JxPath, result: JxListReconciliation) => {
      calls.push([[...path], { ...result }]);
    },
    last: () => calls.at(-1),
  };
}

describe("rowLimit", () => {
  test("caps the rows drawn, and the rows past it are never created", async () => {
    const rows = reactive([row("a"), row("b"), row("c"), row("d")]);
    const created = mock((_el: HTMLElement | Text) => null);
    const seen = recorder();
    await mount(listDoc(), host, {
      onListReconciled: seen.hook,
      onNodeCreated: created,
      rowLimit: 2,
      scope: { rows },
    });
    expect(items()).toEqual(["0:A", "1:B"]);
    // The <ul>, its caption and two rows.
    expect(created).toHaveBeenCalledTimes(4);
    expect(seen.calls).toEqual([[["children", 1], { count: 4, empty: false, rendered: 2 }]]);

    rows.unshift(row("z"));
    await tick();
    expect(items()).toEqual(["0:Z", "1:A"]);
    expect(seen.last()).toEqual([["children", 1], { count: 5, empty: false, rendered: 2 }]);
  });

  test("a list shorter than the limit is drawn whole", async () => {
    const seen = recorder();
    await mount(listDoc(), host, {
      onListReconciled: seen.hook,
      rowLimit: 10,
      scope: { rows: reactive([row("a")]) },
    });
    expect(items()).toEqual(["0:A"]);
    expect(seen.last()![1]).toEqual({ count: 1, empty: false, rendered: 1 });
  });

  test("a fraction is floored, and a value that is no limit is ignored", async () => {
    const rows = () => reactive([row("a"), row("b"), row("c")]);
    await mount(listDoc(), host, { rowLimit: 1.9, scope: { rows: rows() } });
    expect(items()).toEqual(["0:A"]);
    host.replaceChildren();
    await mount(listDoc(), host, { rowLimit: -1, scope: { rows: rows() } });
    expect(items()).toHaveLength(3);
    host.replaceChildren();
    await mount(listDoc(), host, { rowLimit: Number.NaN, scope: { rows: rows() } });
    expect(items()).toHaveLength(3);
  });

  test("it reaches a nested list, each list capped for itself", async () => {
    const rows = reactive([
      { ...row("a"), kids: [row("a1"), row("a2"), row("a3")] },
      { ...row("b"), kids: [row("b1"), row("b2"), row("b3")] },
      row("c"),
    ]);
    const doc: JxDocument = {
      children: [
        array({
          map: {
            children: [
              {
                $prototype: "Array",
                items: { $ref: "$map/item/kids" },
                map: { tagName: "li", textContent: "${item.title}" },
              },
            ],
            tagName: "ol",
          },
        }),
      ],
      tagName: "div",
    };
    await mount(doc, host, { rowLimit: 2, scope: { rows } });
    expect(host.querySelectorAll("ol")).toHaveLength(2);
    expect(items()).toEqual(["A1", "A2", "B1", "B2"]);
  });
});

describe("emptyRow", () => {
  test("a list with no items draws one row from the returned item", async () => {
    const rows = reactive<Row[]>([]);
    const seen = recorder();
    const emptyRow = mock((_def: JxMappedArray, _path: JxPath): JxScopeValue => row("sample"));
    await mount(listDoc(), host, { emptyRow, onListReconciled: seen.hook, scope: { rows } });
    expect(items()).toEqual(["0:SAMPLE"]);
    expect(seen.last()).toEqual([["children", 1], { count: 0, empty: true, rendered: 1 }]);
    const [def, path] = emptyRow.mock.calls[0]!;
    expect(def.$prototype).toBe("Array");
    expect(path).toEqual(["children", 1]);
    // The placeholder is not keyed through the list's `key`, so a sample with no key says nothing.
    expect(warn).not.toHaveBeenCalled();
  });

  test("real rows replace the placeholder, and it returns when they go", async () => {
    const rows = reactive<Row[]>([]);
    const seen = recorder();
    await mount(listDoc(), host, {
      emptyRow: () => row("sample"),
      onListReconciled: seen.hook,
      scope: { rows },
    });
    const placeholder = host.querySelector("li")!;

    rows.push(row("a"), row("b"));
    await tick();
    expect(items()).toEqual(["0:A", "1:B"]);
    expect(placeholder.isConnected).toBe(false);
    expect(seen.last()![1]).toEqual({ count: 2, empty: false, rendered: 2 });

    rows.splice(0);
    await tick();
    expect(items()).toEqual(["0:SAMPLE"]);
    expect(seen.last()![1]).toEqual({ count: 0, empty: true, rendered: 1 });
  });

  test("a placeholder that survives a change keeps its node and takes the new item", async () => {
    const state = reactive<{ rows: Row[]; sample: Row }>({ rows: [], sample: row("one") });
    await mount(listDoc(), host, { emptyRow: () => state.sample, scope: state });
    const placeholder = host.querySelector("li")!;
    state.sample = row("two");
    await tick();
    expect(host.querySelector("li")).toBe(placeholder);
    expect(items()).toEqual(["0:TWO"]);
  });

  test("returning undefined draws nothing, as without the hook", async () => {
    const seen = recorder();
    // A host that has a sample for some lists and none for this one.
    const samples = new Map<string, Row>([["children/7", row("sample")]]);
    await mount(listDoc(), host, {
      emptyRow: (_def, path) => samples.get(path.join("/")),
      onListReconciled: seen.hook,
      scope: { rows: reactive<Row[]>([]) },
    });
    expect(items()).toEqual([]);
    expect(seen.last()![1]).toEqual({ count: 0, empty: true, rendered: 0 });
  });

  test("items that are not an array yet count as empty", async () => {
    const state = reactive<{ rows: Row[] | null }>({ rows: null });
    await mount(listDoc(), host, { emptyRow: () => row("sample"), scope: state });
    expect(items()).toEqual(["0:SAMPLE"]);
  });

  test("a list with no map has no row to draw, and is not asked", async () => {
    const emptyRow = mock((): JxScopeValue => row("sample"));
    const doc: JxDocument = {
      children: [{ $prototype: "Array", items: { $ref: "#/state/rows" } }],
      tagName: "ul",
    };
    await mount(doc, host, { emptyRow, scope: { rows: reactive<Row[]>([]) } });
    expect(emptyRow).not.toHaveBeenCalled();
    expect(host.querySelector("ul")!.childElementCount).toBe(0);
  });

  test("a list that has items is not asked", async () => {
    const emptyRow = mock((): JxScopeValue => row("sample"));
    await mount(listDoc(), host, { emptyRow, scope: { rows: reactive([row("a")]) } });
    expect(emptyRow).not.toHaveBeenCalled();
    expect(items()).toEqual(["0:A"]);
  });

  test("the limit applies after it, so a limit of zero draws nothing", async () => {
    const seen = recorder();
    await mount(listDoc(), host, {
      emptyRow: () => row("sample"),
      onListReconciled: seen.hook,
      rowLimit: 0,
      scope: { rows: reactive<Row[]>([]) },
    });
    expect(items()).toEqual([]);
    expect(seen.last()![1]).toEqual({ count: 0, empty: true, rendered: 0 });
  });
});

describe("onListReconciled", () => {
  test("counts what filter and sort leave, not what items holds", async () => {
    const state = reactive({
      keep: (item: Row) => item.id !== "b",
      rows: [row("a"), row("b"), row("c")],
    });
    const seen = recorder();
    await mount(listDoc({ filter: { $ref: "#/state/keep" } }), host, {
      onListReconciled: seen.hook,
      scope: state,
    });
    expect(seen.last()![1]).toEqual({ count: 2, empty: false, rendered: 2 });
  });

  test("renderNode takes the hooks directly, with no mount", () => {
    const seen = recorder();
    const ul = renderNode(listDoc(), reactive({ rows: [row("a"), row("b")] }), {
      _path: ["children", 3],
      onListReconciled: seen.hook,
      rowLimit: 1,
    });
    host.append(ul);
    expect(items()).toEqual(["0:A"]);
    expect(seen.calls).toEqual([
      [["children", 3, "children", 1], { count: 2, empty: false, rendered: 1 }],
    ]);
  });

  test("with no hooks a list renders exactly as it always has", async () => {
    await mount(listDoc(), host, { scope: { rows: reactive([row("a"), row("b")]) } });
    expect(host.innerHTML).toBe(
      "<ul><caption></caption><li>0:A</li><li>1:B</li><!--jx-array--></ul>",
    );
  });
});
