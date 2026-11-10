import { describe, expect, test } from "bun:test";
import { classifyFunctionEntries, LIFECYCLE_KEYS } from "../src/function-role";
import type { JxElement } from "../types";

/** The verdict for one entry of a document. */
function roleOf(doc: JxElement, key: string): string | undefined {
  return classifyFunctionEntries(doc).get(key);
}

describe("an inline string body", () => {
  test("a string body that returns a value is computed", () => {
    const doc = { state: { total: { $prototype: "Function", body: "return state.n * 2" } } };
    expect(roleOf(doc, "total")).toBe("computed");
  });

  test("a bare return; or an ASI return leaves a string body callable", () => {
    const doc = {
      state: {
        asi: { $prototype: "Function", body: "return\nstate.n" },
        bare: { $prototype: "Function", body: "if (state.n) { return; } state.n = 1" },
      },
    };
    expect(roleOf(doc, "bare")).toBe("callable");
    expect(roleOf(doc, "asi")).toBe("callable");
  });

  test("declared parameters or arguments make a returning string body callable", () => {
    const doc = {
      state: {
        legacy: { $prototype: "Function", arguments: ["state", "e"], body: "return e" },
        modern: { $prototype: "Function", body: "return x * 2", parameters: ["x"] },
      },
    };
    expect(roleOf(doc, "modern")).toBe("callable");
    expect(roleOf(doc, "legacy")).toBe("callable");
  });

  test("a structured body is callable, with or without parameters", () => {
    const doc = {
      state: {
        plain: { $prototype: "Function", body: [{ stopPropagation: true }] },
        withParams: {
          $prototype: "Function",
          body: [{ stopPropagation: true }],
          parameters: ["x"],
        },
      },
    };
    expect(roleOf(doc, "plain")).toBe("callable");
    expect(roleOf(doc, "withParams")).toBe("callable");
  });

  test("an entry with neither body nor $src is callable", () => {
    expect(roleOf({ state: { none: { $prototype: "Function" } } }, "none")).toBe("callable");
  });

  test("an entry declaring both body and $src is classified by its body", () => {
    const doc = { state: { both: { $prototype: "Function", $src: "./x.js", body: "return 1" } } };
    expect(roleOf(doc, "both")).toBe("computed");
  });

  test("non-Function entries get no verdict", () => {
    const roles = classifyFunctionEntries({
      state: { count: 0, label: "${state.count}", list: { default: [], type: "array" } },
    });
    expect(roles.size).toBe(0);
  });
});

describe("a bodyless $src entry", () => {
  const entry = { $prototype: "Function", $src: "./rows.js" } as const;

  test("the document only reads is computed", () => {
    const doc = {
      children: [{ tagName: "p", textContent: "${state.rows}" }],
      state: { rows: entry },
    };
    expect(roleOf(doc, "rows")).toBe("computed");
  });

  test("is callable when bound to a child on*", () => {
    const doc = {
      children: [{ onclick: { $ref: "#/state/rows" }, tagName: "button" }],
      state: { rows: entry },
    };
    expect(roleOf(doc, "rows")).toBe("callable");
  });

  test("is callable when a call node targets it", () => {
    const doc = {
      children: [{ tagName: "p", textContent: "x" }],
      state: {
        rows: entry,
        total: { $expression: { operator: "call", target: { $ref: "#/state/rows" }, value: [] } },
      },
    };
    expect(roleOf(doc, "rows")).toBe("callable");
  });

  test("is callable when called as state.key( in a template, a body or a root textContent", () => {
    const inTemplate = {
      children: [{ tagName: "p", textContent: "${state.rows(1)}" }],
      state: { rows: entry },
    };
    const inBody = {
      state: { other: { $prototype: "Function", body: "state.rows (2)" }, rows: entry },
    };
    const inRoot = { state: { rows: entry }, textContent: "${state.rows(3)}" };
    expect(roleOf(inTemplate, "rows")).toBe("callable");
    expect(roleOf(inBody, "rows")).toBe("callable");
    expect(roleOf(inRoot, "rows")).toBe("callable");
  });

  test("a root-level on* $ref makes it callable", () => {
    const doc = { onkeydown: { $ref: "#/state/rows" }, state: { rows: entry }, tagName: "div" };
    expect(roleOf(doc, "rows")).toBe("callable");
  });

  test("a lifecycle hook is callable, and one whose string body returns a value is still computed", () => {
    const doc = {
      state: {
        onMount: { $prototype: "Function", $src: "./hooks.js" },
        onUnmount: { $prototype: "Function", body: "return state.n" },
      },
    };
    expect(roleOf(doc, "onMount")).toBe("callable");
    expect(roleOf(doc, "onUnmount")).toBe("computed");
    expect([...LIFECYCLE_KEYS]).toEqual(["onMount", "onUnmount", "onAdopted"]);
  });

  test("declared parameters make it callable when the document only reads it", () => {
    const doc = { state: { lookup: { ...entry, parameters: ["name"] } } };
    expect(roleOf(doc, "lookup")).toBe("callable");
  });

  test("strings and on* refs under $defs are not usage", () => {
    const doc = {
      $defs: { x: { description: "state.rows(1)", onclick: { $ref: "#/state/rows" } } },
      state: { rows: entry },
    };
    // SAFETY: `$defs` is a document-level key the element type leaves out; the walk skips it.
    expect(roleOf(doc as JxElement, "rows")).toBe("computed");
  });

  test("the walk runs once, and only when a bodyless $src entry needs it", () => {
    let reads = 0;
    const counting = (state: NonNullable<JxElement["state"]>): JxElement => {
      const doc: JxElement = { state };
      Object.defineProperty(doc, "children", {
        enumerable: true,
        get() {
          reads += 1;
          return [];
        },
      });
      return doc;
    };
    classifyFunctionEntries(counting({ a: { $prototype: "Function", body: "return 1" } }));
    expect(reads).toBe(0);
    classifyFunctionEntries(counting({ a: entry, b: { ...entry, $src: "./b.js" } }));
    expect(reads).toBe(1);
  });

  test("a document shared by cycles does not loop", () => {
    const cyclic: JxElement = { state: { rows: entry } };
    Object.assign(cyclic, { self: cyclic, list: [cyclic] });
    expect(roleOf(cyclic, "rows")).toBe("computed");
  });
});
