import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { reactive } from "@vue/reactivity";
import { defineElement, mount } from "../src/runtime";
import type { JxDocument, JxElement, JxMappedArray } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

interface Row {
  id: string;
  title: string;
  on?: boolean;
  kids?: { id: string; title: string }[];
}

const row = (id: string, title = id.toUpperCase()): Row => ({ id, title });

/** A keyed list document over `state.rows`; every row prints its index and title. */
function listDoc(
  overrides: Partial<JxMappedArray> = {},
  map?: JxElement,
  keyed = true,
): JxDocument {
  const array: JxMappedArray = {
    $prototype: "Array",
    items: { $ref: "#/state/rows" },
    ...(keyed ? { key: { $ref: "$map/item/id" } } : {}),
    map: map ?? { tagName: "li", textContent: "${$map.index}:${$map.item.title}" },
    ...overrides,
  };
  return { tagName: "ul", children: [array as unknown as JxElement] };
}

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

const texts = (ul: Element) => [...ul.children].map((li) => li.textContent);
const nodes = (ul: Element) => [...ul.children];
const three = (ul: Element) => nodes(ul) as [Element, Element, Element];
const two = (ul: Element) => nodes(ul) as [Element, Element];

/**
 * Identity, element by element. `toEqual` over DOM nodes walks happy-dom's whole object graph —
 * slow enough to time a test out, and structural rather than the identity the reconciler promises.
 */
function same(actual: Element[], expected: Element[]): void {
  expect(actual.length).toBe(expected.length);
  for (const [i, node] of actual.entries()) {
    expect(node).toBe(expected[i]!);
  }
}

describe("keyed $map — identity", () => {
  test("rows keep their nodes across reverse, shuffle, insert in the middle and removal", async () => {
    const rows = reactive([row("a"), row("b"), row("c")]);
    await mount(listDoc(), host, { scope: { rows } });
    const ul = host.firstElementChild!;
    const [a, b, c] = three(ul);
    expect(texts(ul)).toEqual(["0:A", "1:B", "2:C"]);

    rows.reverse();
    await tick();
    same(nodes(ul), [c, b, a]);
    expect(texts(ul)).toEqual(["0:C", "1:B", "2:A"]);

    rows.splice(1, 0, row("d"));
    await tick();
    const d = nodes(ul)[1]!;
    same(nodes(ul), [c, d, b, a]);
    expect(texts(ul)).toEqual(["0:C", "1:D", "2:B", "3:A"]);

    rows.shift();
    await tick();
    same(nodes(ul), [d, b, a]);
    expect(texts(ul)).toEqual(["0:D", "1:B", "2:A"]);
    expect(c.isConnected).toBe(false);

    // A shuffle that leaves one row in place moves only the others.
    rows.splice(0, 3, rows[2]!, rows[1]!, rows[0]!);
    await tick();
    same(nodes(ul), [a, b, d]);
    expect(texts(ul)).toEqual(["0:A", "1:B", "2:D"]);
  });

  test("a same-key replacement updates the row's bindings without rebuilding it", async () => {
    const rows = reactive([row("a"), row("b")]);
    await mount(listDoc(), host, { scope: { rows } });
    const ul = host.firstElementChild!;
    const [a] = two(ul);
    rows[0] = row("a", "A2");
    await tick();
    expect(nodes(ul)[0]).toBe(a);
    expect(texts(ul)).toEqual(["0:A2", "1:B"]);
  });

  test("a removed row's effects are stopped", async () => {
    const rows = reactive([row("a"), row("b")]);
    await mount(listDoc(), host, { scope: { rows } });
    const ul = host.firstElementChild!;
    const [, b] = two(ul);
    const gone = rows[1]!;
    rows.pop();
    await tick();
    expect(b.isConnected).toBe(false);
    gone.title = "changed";
    await tick();
    expect(b.textContent).toBe("1:B");
  });

  test("$map/item keys by identity", async () => {
    const first = row("x");
    const second = row("x");
    const rows = reactive([first, second]);
    await mount(listDoc({ key: { $ref: "$map/item" } }), host, { scope: { rows } });
    const ul = host.firstElementChild!;
    const [n1, n2] = two(ul);
    rows.reverse();
    await tick();
    same(nodes(ul), [n2, n1]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("an unkeyed list keeps identity by position", async () => {
    const rows = reactive([row("a"), row("b"), row("c")]);
    await mount(listDoc({}, undefined, false), host, { scope: { rows } });
    const ul = host.firstElementChild!;
    const before = nodes(ul);
    rows.push(row("d"));
    await tick();
    same(nodes(ul).slice(0, 3), before);
    rows.shift();
    await tick();
    // Position 0 is the same node, now showing what moved into it.
    expect(nodes(ul)[0]).toBe(before[0]!);
    expect(texts(ul)).toEqual(["0:B", "1:C", "2:D"]);
  });
});

describe("keyed $map — keys that cannot identify", () => {
  test("a duplicate key warns once and every row still renders", async () => {
    const rows = reactive([row("x", "one"), row("x", "two"), row("y")]);
    await mount(listDoc(), host, { scope: { rows } });
    const ul = host.firstElementChild!;
    expect(texts(ul)).toEqual(["0:one", "1:two", "2:Y"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("duplicate key");
    rows.push(row("x", "three"));
    await tick();
    expect(texts(ul)).toEqual(["0:one", "1:two", "2:Y", "3:three"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("an empty key falls back to the index with one warning", async () => {
    const rows = reactive([{ title: "no id" }, { title: "none either" }]);
    await mount(listDoc(), host, { scope: { rows } });
    expect(texts(host.firstElementChild!)).toEqual(["0:no id", "1:none either"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("is empty");
  });

  test("a pointer that is not $map/item falls back to the index with one warning", async () => {
    const rows = reactive([row("a"), row("b")]);
    await mount(listDoc({ key: { $ref: "$map/index" } }), host, { scope: { rows } });
    expect(texts(host.firstElementChild!)).toEqual(["0:A", "1:B"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("not a $map/item pointer");
  });
});

describe("keyed $map — tracking and teardown", () => {
  test("a row's own reads do not subscribe the list effect", async () => {
    const tag = "kl-item";
    if (!customElements.get(tag)) {
      await defineElement({ tagName: tag, state: { label: "" }, textContent: "${state.label}" });
    }
    const rows = reactive([
      { ...row("a"), on: true },
      { ...row("b"), on: true },
    ]);
    const visible = mock((r: Row) => r.on === true);
    await mount(
      listDoc(
        { filter: { $ref: "#/state/visible" } },
        { tagName: tag, $props: { label: { $ref: "$map/item/title" } } },
      ),
      host,
      { scope: { rows, visible } },
    );
    await tick();
    const ul = host.firstElementChild!;
    expect(texts(ul)).toEqual(["A", "B"]);
    const listRuns = visible.mock.calls.length;

    // A `$props` source is read outside any inner effect when the row is built; before, that read
    // Subscribed the list, and this write rebuilt every row.
    rows[0]!.title = "A!";
    await tick();
    expect(texts(ul)).toEqual(["A!", "B"]);
    expect(visible.mock.calls.length).toBe(listRuns);

    // A field the filter reads still reconciles the list.
    rows[1]!.on = false;
    await tick();
    expect(texts(ul)).toEqual(["A!"]);
    expect(visible.mock.calls.length).toBeGreaterThan(listRuns);
  });

  test("nested keyed arrays reconcile independently", async () => {
    const rows = reactive<Row[]>([
      { id: "p", title: "P", kids: [row("p1"), row("p2")] },
      { id: "q", title: "Q", kids: [row("q1")] },
    ]);
    await mount(
      listDoc(
        {},
        {
          tagName: "li",
          children: [
            { tagName: "span", textContent: "${$map.item.title}" },
            {
              tagName: "ul",
              children: [
                {
                  $prototype: "Array",
                  items: { $ref: "$map/item/kids" },
                  key: { $ref: "$map/item/id" },
                  map: { tagName: "li", textContent: "${$map.item.title}" },
                },
              ],
            },
          ],
        },
      ),
      host,
      { scope: { rows } },
    );
    const outer = host.firstElementChild!;
    const [p] = two(outer);
    const inner = p.querySelector("ul")!;
    const [p1, p2] = two(inner);
    rows[0]!.kids!.reverse();
    await tick();
    same(nodes(inner), [p2, p1]);
    expect(nodes(outer)[0]).toBe(p);
    rows.reverse();
    await tick();
    expect(nodes(outer)[1]).toBe(p);
    same(nodes(p.querySelector("ul")!), [p2, p1]);
  });

  test("onNodeMoved reports a reused row's new path", async () => {
    const rows = reactive([row("a"), row("b"), row("c")]);
    const moved = mock((_node: unknown, _path: unknown) => null);
    await mount(listDoc(), host, { scope: { rows }, onNodeMoved: moved });
    const ul = host.firstElementChild!;
    const [a, , c] = three(ul);
    rows.reverse();
    await tick();
    const name = (node: unknown) => (node === a ? "a" : node === c ? "c" : "?");
    const reported = moved.mock.calls.map(([node, path]) => [name(node), path]);
    expect(reported).toContainEqual(["c", ["children", 0, "map", 0]]);
    expect(reported).toContainEqual(["a", ["children", 0, "map", 2]]);
    expect(reported.length).toBe(2);
  });

  test("items that are not an array, or a missing map, render no rows and keep siblings", async () => {
    const state = reactive({ rows: "nope" as unknown });
    await mount(
      {
        tagName: "ul",
        children: [
          { tagName: "li", textContent: "before" },
          { $prototype: "Array", items: { $ref: "#/state/rows" }, map: { tagName: "li" } },
          { tagName: "li", textContent: "after" },
        ],
      },
      host,
      { scope: { state } },
    );
    const ul = host.firstElementChild!;
    expect(texts(ul)).toEqual(["before", "after"]);
    await mount(
      {
        tagName: "ol",
        children: [{ $prototype: "Array", items: [1, 2] } as unknown as JxElement],
      },
      host,
    );
    expect(host.lastElementChild!.childElementCount).toBe(0);
  });

  test("disposing the mount tears every row down", async () => {
    const rows = reactive([row("a"), row("b")]);
    const handle = await mount(listDoc(), host, { scope: { rows } });
    const ul = host.firstElementChild!;
    const kept = nodes(ul);
    handle.dispose();
    expect(kept.every((n) => !n.isConnected)).toBe(true);
    rows.push(row("c"));
    await tick();
    expect(ul.childElementCount).toBe(0);
  });
});
