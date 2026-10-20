import "./with-dom.ts";

import { describe, expect, mock, test } from "bun:test";

import {
  DOM_EQUALITY_MESSAGE,
  GUARDED_MATCHERS,
  OPERAND_MATCHERS,
  findNode,
  installDomEqualityGuard,
  instanceOf,
  propertyAt,
  recordedCalls,
  refusal,
  searchedOperands,
} from "../src/dom-equality.ts";
import type {
  Assertion,
  GuardableExpect,
  GuardedMatcher,
  GuardedMatcherName,
  Operand,
} from "../src/dom-equality.ts";
import { loadHappyDom, nodeId } from "../src/inspect-dom.ts";

const { Node: base } = await loadHappyDom();
const isNode = instanceOf(base);

/** Nests `value` `depth` levels deep in single-key records. */
function nested(value: Operand, depth: number): Operand {
  let current = value;
  for (let level = 0; level < depth; level++) {
    current = { inner: current };
  }
  return current;
}

/** The path `findNode` reports for `value` searched from `root`. */
function pathOf<Value>(value: Value, root = "r"): string | undefined {
  return findNode(value, isNode, root)?.path;
}

describe("instanceOf", () => {
  test("answers for happy-dom nodes of every kind, and for nothing else", () => {
    expect(isNode(document.createElement("div"))).toBe(true);
    expect(isNode(document.createTextNode("t"))).toBe(true);
    expect(isNode(document)).toBe(true);
    expect(isNode({ nodeName: "DIV", nodeType: 1 })).toBe(false);
    expect(isNode(null)).toBe(false);
  });
});

describe("findNode", () => {
  test("finds a node at the top, in arrays, records, maps and sets, and names the path", () => {
    const el = document.createElement("div");
    const bare: Record<string, Operand> = Object.create(null);
    bare.el = el;
    expect(pathOf(el, "received")).toBe("received");
    expect(pathOf([1, el], "received")).toBe("received[1]");
    expect(pathOf({ a: { b: el } }, "expected")).toBe("expected.a.b");
    expect(pathOf(new Map([["k", el]]))).toBe("r.get(…)");
    expect(pathOf(new Map([[el, 1]]))).toBe("r key");
    expect(pathOf(new Set([el]))).toBe("r member");
    expect(findNode(bare, isNode, "r")?.node).toBe(el);
  });

  test("finds nothing in plain data", () => {
    expect(pathOf({ a: [1, "two", null, undefined, { b: 3n }] })).toBe(undefined);
    expect(pathOf("text")).toBe(undefined);
  });

  test("stops four levels down", () => {
    const el = document.createElement("i");
    expect(pathOf(nested(el, 4))).toBe("r.inner.inner.inner.inner");
    expect(pathOf(nested(el, 5))).toBe(undefined);
  });

  test("gives up after 256 values, so a huge array is not walked to its end", () => {
    const el = document.createElement("b");
    expect(pathOf([...Array.from({ length: 200 }, () => 0), el])).toBe("r[200]");
    expect(pathOf([...Array.from({ length: 300 }, () => 0), el])).toBe(undefined);
  });

  test("opens class instances too, symbol-keyed slots included: Bun's diff prints them", () => {
    class Holder {
      readonly el = document.createElement("u");
    }
    const slot = Symbol("target");
    const record = Object.assign(Object.create(null), { [slot]: document.createElement("s") });
    const event = new Event("x");
    const target = document.createElement("em");
    target.dispatchEvent(event);
    expect(pathOf([new Holder()])).toBe("r[0].el");
    expect(pathOf(record)).toBe("r[Symbol(target)]");
    expect(pathOf({ event })).toBe("r.event[Symbol(target)]");
  });

  test("calls no accessor, lists no typed array, and survives a proxy that refuses reflection", () => {
    let called = false;
    const accessor = {
      get el() {
        called = true;
        return document.createElement("a");
      },
    };
    const proxy = new Proxy(
      { el: document.createElement("q") },
      {
        ownKeys() {
          throw new Error("not reflectable");
        },
      },
    );
    expect(pathOf(accessor)).toBe(undefined);
    expect(called).toBe(false);
    expect(pathOf(new Uint8Array(4))).toBe(undefined);
    expect(pathOf(proxy)).toBe(undefined);
  });
});

describe("refusal", () => {
  test("names the matcher, the path and the node, and is undefined when there is no node", () => {
    const el = document.createElement("p");
    const operands: [Operand, string][] = [
      [1, "received"],
      [{ el }, "expected"],
    ];
    expect(refusal("expect(received).toEqual(expected)", operands, isNode)).toBe(
      `${DOM_EQUALITY_MESSAGE}.\nexpect(received).toEqual(expected): expected.el is <p> #${nodeId(el)} (detached).`,
    );
    expect(refusal("m", [[{ a: 1 }, "received"]], isNode)).toBe(undefined);
  });
});

describe("searchedOperands", () => {
  test("toHaveProperty searches the value at the path and the expected value, and nothing else", () => {
    const el = document.createElement("dd");
    const received = { a: { b: [el] } };
    const [[atIndex, indexPath] = []] = propertyAt(received, "a.b[0]");
    const [[atKeys, keysPath] = []] = propertyAt(received, ["a", "b"]);
    expect(atIndex).toBe(el);
    expect(indexPath).toBe("received.a.b.0");
    expect(atKeys).toBe(received.a.b);
    expect(keysPath).toBe("received.a.b");
    expect(propertyAt(received, "a.missing")).toEqual([]);
    expect(propertyAt(received, "a.b[0].c.d")).toEqual([]);
    expect(propertyAt(received, 7)).toEqual([]);
    expect(searchedOperands("toHaveProperty", received, ["a"])).toEqual([]);
    expect(searchedOperands("toHaveProperty", received, ["z", 1])).toEqual([[1, "expected"]]);
  });

  test("the mock-call matchers search the expected arguments and the calls their failure prints", () => {
    const fn = mock((..._args: Operand[]) => 0);
    fn(1);
    fn(2, 3);
    expect(recordedCalls(fn)).toEqual([[1], [2, 3]]);
    expect(recordedCalls(() => 0)).toBe(undefined);
    expect(recordedCalls({ mock: 1 })).toBe(undefined);
    expect(searchedOperands("toHaveBeenCalledWith", fn, ["x"])).toEqual([
      ["x", "expected[0]"],
      [[[1], [2, 3]], "received.mock.calls"],
    ]);
    expect(searchedOperands("lastCalledWith", fn, [])).toEqual([
      [[2, 3], "received.mock.calls[1]"],
    ]);
    expect(searchedOperands("nthCalledWith", fn, [1, "y"])).toEqual([
      ["y", "expected[0]"],
      [[1], "received.mock.calls[0]"],
    ]);
    expect(searchedOperands("toHaveBeenNthCalledWith", 5, ["first"])).toEqual([
      [undefined, "received.mock.calls[-1]"],
    ]);
  });
});

describe("the preload's guard", () => {
  test("refuses every guarded matcher on a node, whichever side holds it, .not included", () => {
    const el = document.createElement("section");
    for (const name of OPERAND_MATCHERS) {
      expect(() => {
        expect(el)[name](el);
      }).toThrow(DOM_EQUALITY_MESSAGE);
      expect(() => {
        expect({ list: [1] }).not[name]({ list: [el] });
      }).toThrow(`expect(received).not.${name}(expected): expected.list[0] is <section>`);
    }
  });

  test("refuses toHaveProperty only when the compared value holds a node", () => {
    const el = document.createElement("dt");
    expect(() => {
      expect({ k: el }).toHaveProperty("k", 1);
    }).toThrow("toHaveProperty(expected): received.k is <dt>");
    expect(() => {
      expect({ k: 1 }).toHaveProperty("k", el);
    }).toThrow("toHaveProperty(expected): expected is <dt>");
    expect(el).toHaveProperty("tagName", "DT");
    expect({ k: el }).toHaveProperty("k");
    expect(() => {
      expect(el).toHaveProperty("tagName", "X");
    }).toThrow('Received: "DT"');
  });

  test("refuses the mock-call matchers when a printed call or an argument holds a node", () => {
    const el = document.createElement("dl");
    const fn = mock((..._args: Operand[]) => 0);
    fn(el);
    fn("plain");
    for (const name of ["toHaveBeenCalledWith", "toBeCalledWith"] as const) {
      expect(() => {
        expect(fn)[name]("plain");
      }).toThrow(`${name}(expected): received.mock.calls[0][0] is <dl>`);
    }
    expect(() => {
      expect(fn).toHaveBeenNthCalledWith(1, "plain");
    }).toThrow("received.mock.calls[0][0] is <dl>");
    expect(() => {
      expect(fn).lastCalledWith(el);
    }).toThrow("expected[0] is <dl>");
    expect(fn).toHaveBeenLastCalledWith("plain");
    expect(fn).nthCalledWith(2, "plain");
    expect(fn.mock.calls[0]?.[0]).toBe(el);
    const clean = mock((..._args: Operand[]) => 0);
    clean(1);
    expect(clean).toHaveBeenCalledWith(1);
    expect(() => {
      expect(clean).toHaveBeenCalledWith(2);
    }).toThrow("toHaveBeenCalledWith");
  });

  test("refuses inside the asymmetric containers, where they are built", () => {
    const el = document.createElement("li");
    expect(() => expect.objectContaining({ el })).toThrow("expect.objectContaining(sample)");
    expect(() => expect.arrayContaining([el])).toThrow("sample[0] is <li>");
  });

  test("refuses a resolved value that is a node", async () => {
    const el = document.createElement("form");
    const settled = await Promise.allSettled([
      Promise.resolve().then(() =>
        expect(Promise.resolve(el)).resolves.toEqual(document.createElement("form")),
      ),
    ]);
    const [outcome] = settled;
    expect(outcome.status === "rejected" ? String(outcome.reason) : "").toContain(
      DOM_EQUALITY_MESSAGE,
    );
  });

  test("leaves plain-object equality to Bun: passes pass, failures carry Bun's own diff", () => {
    expect({ a: [1, { b: 2 }] }).toEqual({ a: [1, { b: 2 }] });
    expect({ a: 1 }).toStrictEqual({ a: 1 });
    expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
    expect([{ a: 1 }]).toContainEqual({ a: 1 });
    expect({ a: 1 }).not.toEqual({ a: 2 });
    expect({ a: 1, b: 2 }).toEqual(expect.objectContaining({ a: 1 }));
    expect([1, 2, 3]).toEqual(expect.arrayContaining([2]));
    expect(() => {
      expect({ a: 1 }).toEqual({ a: 2 });
    }).toThrow("- Expected  - 1");
    expect(() => {
      expect({ a: 1 }).not.toEqual({ a: 1 });
    }).toThrow("expect(received).not.toEqual(expected)");
  });

  test("leaves resolves and rejects to Bun too", async () => {
    const plain = Promise.resolve({ a: 1 });
    const failed = Promise.reject(new Error("boom"));
    await Promise.all([
      Promise.resolve().then(() => expect(plain).resolves.toEqual({ a: 1 })),
      Promise.resolve().then(() => expect(failed).rejects.toEqual(new Error("boom"))),
    ]);
    expect(await plain).toEqual({ a: 1 });
  });
});

describe("installing it", () => {
  /** A stand-in `expect` that records what the guard hands it. */
  function fakeExpect() {
    const extensions: Record<GuardedMatcherName, GuardedMatcher>[] = [];
    const calls: string[] = [];
    /* Like a native matcher, each one reads its subject from `this`, which is how `.not` differs. */
    const record = (name: string) =>
      function recorded<Expected>(this: Assertion, ...expected: Expected[]): void {
        calls.push(`${this === negation ? "not." : ""}${name}(${expected.join(",")})`);
      };
    /* SAFETY: built from GUARDED_MATCHERS, so it holds exactly one method per guarded name. */
    const methods = Object.fromEntries(
      GUARDED_MATCHERS.map((name) => [name, record(name)]),
    ) as Record<GuardedMatcherName, Assertion["toEqual"]>;
    const negation: Assertion = {
      ...methods,
      get not() {
        return assertion;
      },
    };
    const assertion: Assertion = { ...methods, not: negation };
    const fake: GuardableExpect = Object.assign(() => assertion, {
      arrayContaining: <Item>(sample: readonly Item[]) => sample,
      extend: (matchers: Record<GuardedMatcherName, GuardedMatcher>) => {
        extensions.push(matchers);
      },
      objectContaining: <Sample extends object>(sample: Sample) => sample,
    });
    return { calls, extensions, fake };
  }

  test("delegates to the native matcher, negated when the context says so", () => {
    const { calls, extensions, fake } = fakeExpect();
    installDomEqualityGuard(fake, isNode);
    const [matchers] = extensions;
    const passed = matchers?.toEqual.call({ isNot: false }, 1, 2);
    const negated = matchers?.toEqual.call({ isNot: true }, 1, 3);
    expect(calls).toEqual(["toEqual(2)", "not.toEqual(3)"]);
    expect(passed?.pass).toBe(true);
    expect(negated?.pass).toBe(false);
    expect(passed?.message()).toBe("toEqual passed");
  });

  test("is idempotent: a second install on the same expect changes nothing", () => {
    const { extensions, fake } = fakeExpect();
    installDomEqualityGuard(fake, isNode);
    const { objectContaining } = fake;
    installDomEqualityGuard(fake, isNode);
    expect(extensions).toHaveLength(1);
    expect(fake.objectContaining).toBe(objectContaining);
    expect(fake.objectContaining({ a: 1 })).toEqual({ a: 1 });
  });
});
