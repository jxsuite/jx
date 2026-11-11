/**
 * Where a body stands in a document (`spec.md` §23.3): the `state` it reads, the row of the map it
 * is drawn in, and the event its handler is given.
 */
import { describe, expect, test } from "bun:test";
import type { JsonObject, JsonValue } from "../types";
import {
  boundEvents,
  eachSite,
  eventLines,
  eventType,
  itemType,
  membersOf,
  pointerInto,
  readsRow,
  rootSite,
  siteInto,
} from "../src/jxn/document-scopes.ts";
import type { Row, Site, StateScope } from "../src/jxn/document-scopes.ts";
import { BOTH, CURRENT, EVENT_GLOBALS, eventOn } from "./event-types.ts";

/** A scope with the given `state`, under another. */
function scope(state: JsonObject, parent: StateScope | null = null, pointer = ""): StateScope {
  return { node: { state }, parent, pointer };
}

/** A map over the given `items`, read in a scope. */
function row(items: JsonValue | undefined, within: StateScope, parent: Row | null = null): Row {
  return { items, parent, scope: within };
}

/** The site of an HTML element with no state and no map around it. */
const plain: Site = { row: null, scope: scope({}), svg: false };

/** The name a test gives each scope's interface. */
const named = (within: StateScope): string => (within.parent ? "Inner" : "Root");

/** Every site of a document, as what is there and what surrounds it. */
function sitesOf(doc: JsonObject): [string, string, boolean, boolean][] {
  const seen: [string, string, boolean, boolean][] = [];
  eachSite(doc, (_node, pointer, site) => {
    seen.push([pointer, site.scope.pointer, site.row !== null, site.svg]);
  });
  return seen;
}

describe("a pointer one step down", () => {
  test("escapes what a JSON Pointer reads as its own", () => {
    expect(pointerInto("", "state")).toBe("/state");
    expect(pointerInto("/children", 0)).toBe("/children/0");
    expect(pointerInto("/state", "a/b~c")).toBe("/state/a~1b~0c");
  });
});

describe("what surrounds a value", () => {
  test("starts at the root, which is a scope whether or not it has state", () => {
    const doc = { tagName: "div" };
    expect(rootSite(doc)).toEqual({
      row: null,
      scope: { node: doc, parent: null, pointer: "" },
      svg: false,
    });
    expect(rootSite({ tagName: "svg" }).svg).toBe(true);
  });

  test("is a new scope under an element that has state, and the same one under one that has none", () => {
    const root = rootSite({});
    const child = { state: { a: 1 }, tagName: "p" };
    const into = siteInto(root, [child], 0, child, "/children/0");
    expect(into.scope).toEqual({ node: child, parent: root.scope, pointer: "/children/0" });
    expect(siteInto(root, [], 0, { tagName: "p" }, "/children/0").scope).toBe(root.scope);
  });

  test("is a new row under the map of a mapped array, and of nothing else", () => {
    const root = rootSite({});
    const map = { tagName: "li" };
    const array = { $prototype: "Array", items: [1], map };
    const drawn = siteInto(root, array, "map", map, "/children/0/map");
    expect(drawn.row).toEqual({ items: [1], parent: null, scope: root.scope });
    // A row is under the row around it.
    expect(siteInto(drawn, array, "map", map, "/x").row?.parent).toBe(drawn.row);
    expect(siteInto(root, array, "items", [1], "/children/0/items").row).toBeNull();
    expect(siteInto(root, { map }, "map", map, "/map").row).toBeNull();
    expect(siteInto(root, [map], "map", map, "/map").row).toBeNull();
  });

  test("keeps what it has under a value that is no object", () => {
    const drawn: Site = { ...plain, row: row([], plain.scope), svg: true };
    expect(siteInto(drawn, { textContent: "a" }, "textContent", "a", "/textContent")).toEqual(
      drawn,
    );
  });

  test("is SVG under an svg element, and HTML again in a foreignObject and under it", () => {
    const into = (site: Site, tagName?: string): Site =>
      siteInto(site, [], 0, tagName === undefined ? {} : { tagName }, "/children/0");
    const svg = into(plain, "svg");
    expect(svg.svg).toBe(true);
    expect(into(svg, "circle").svg).toBe(true);
    // An object with no tag of its own is not an element, and is where its parent is.
    expect(into(svg).svg).toBe(true);
    const foreign = into(svg, "foreignObject");
    expect(foreign.svg).toBe(false);
    expect(into(foreign, "div").svg).toBe(false);
    expect(into(plain, "div").svg).toBe(false);
  });
});

describe("a walk of a document", () => {
  test("visits every object that can hold a handler, parents first, with what surrounds it", () => {
    const doc = {
      $defs: { a: { type: "string" } },
      $script: { client: "" },
      children: [
        "text",
        {
          children: [{ $prototype: "Array", items: [], map: { tagName: "li" } }],
          state: { inner: 1 },
          tagName: "ul",
        },
        { children: [{ tagName: "circle" }], tagName: "svg" },
      ],
      state: { top: { nested: {} } },
      style: { ":hover": { color: "red" } },
      tagName: "div",
    };
    expect(sitesOf(doc)).toEqual([
      ["", "", false, false],
      ["/children/1", "/children/1", false, false],
      ["/children/1/children/0", "/children/1", false, false],
      ["/children/1/children/0/map", "/children/1", true, false],
      ["/children/2", "", false, true],
      ["/children/2/children/0", "", false, true],
    ]);
  });
});

describe("what a scope's interface declares", () => {
  test("is its own entries, each in the role the document reads it in", () => {
    const fn = { $prototype: "Function", body: "" };
    const double = { $prototype: "Function", body: "return state.count * 2;" };
    const root: StateScope = {
      node: { onclick: { $ref: "#/state/save" }, state: { count: 0, double, save: fn } },
      parent: null,
      pointer: "",
    };
    expect(membersOf(root)).toEqual({
      inherited: null,
      own: [
        { entry: 0, key: "count", role: undefined },
        { entry: double, key: "double", role: "computed" },
        { entry: fn, key: "save", role: "callable" },
      ],
    });
    expect(membersOf({ node: {}, parent: null, pointer: "" })).toEqual({
      inherited: null,
      own: [],
    });
  });

  test("extends the scope around it where it declares none of that scope's names", () => {
    const root = scope({ a: 1 });
    expect(membersOf(scope({ b: 2 }, root)).inherited).toBeNull();
  });

  test("lists by reference what it keeps of every scope around it, where it declares one of their names", () => {
    const root = scope({ a: 1, b: 2 });
    const middle = scope({ c: 3 }, root);
    expect(membersOf(scope({ a: "now a string", d: 4 }, middle)).inherited).toEqual(["c", "b"]);
  });
});

describe("the type of a map's item", () => {
  const root = scope({ todos: [] });
  const inner = scope({}, root, "/children/0");
  const todos =
    "(NonNullable<(Root extends { todos: infer V } ? V : any)> extends readonly (infer I)[] ? I : any)";

  test("is the type of the items of a list the map holds", () => {
    expect(itemType(row([{ id: 1 }], root), named)).toBe(
      "(NonNullable<{ id: number }[]> extends readonly (infer I)[] ? I : any)",
    );
  });

  test("is read off the state the list is named in, by the name of that scope's interface", () => {
    expect(itemType(row({ $ref: "#/state/todos" }, root), named)).toBe(todos);
    expect(itemType(row({ $ref: "#/state/a~1b/c" }, inner), named)).toBe(
      '(NonNullable<(NonNullable<(Inner extends { "a/b": infer V } ? V : any)> extends { c: infer V } ? V : any)> extends readonly (infer I)[] ? I : any)',
    );
    expect(itemType(row({ $ref: "#/state" }, root), named)).toBe(
      "(NonNullable<Root> extends readonly (infer I)[] ? I : any)",
    );
  });

  test("is read off the row of the map around it, in either spelling of the reference", () => {
    const outer = row({ $ref: "#/state/todos" }, root);
    const tags = `(NonNullable<(NonNullable<${todos}> extends { tags: infer V } ? V : any)> extends readonly (infer I)[] ? I : any)`;
    expect(itemType(row({ $ref: "$map/item/tags" }, root, outer), named)).toBe(tags);
    expect(itemType(row({ $ref: "#/$map/item/tags" }, root, outer), named)).toBe(tags);
    expect(itemType(row({ $ref: "$map/item" }, root, outer), named)).toBe(
      `(NonNullable<${todos}> extends readonly (infer I)[] ? I : any)`,
    );
  });

  test("is any where the document does not say what the list is", () => {
    expect(itemType(row(undefined, root), named)).toBe("any");
    expect(itemType(row("${state.todos}", root), named)).toBe("any");
    expect(itemType(row({ $ref: "#/$defs/list" }, root), named)).toBe("any");
    expect(itemType(row({ $ref: "#/stately" }, root), named)).toBe("any");
    // A row is read, and there is no map around this one.
    expect(itemType(row({ $ref: "$map/item/tags" }, root), named)).toBe("any");
    // The map around it repeats something the document does not determine.
    const unknown = row(undefined, root);
    expect(itemType(row({ $ref: "$map/item/tags" }, root, unknown), named)).toBe("any");
  });
});

describe("whether a body is told what $map is", () => {
  test("is no once any state it reads declares a $map of its own", () => {
    const root = scope({ a: 1 });
    expect(readsRow(scope({ b: 1 }, root))).toBe(true);
    const mapped = scope({ $map: 1 });
    expect(readsRow(scope({ b: 1 }, mapped))).toBe(false);
    expect(readsRow(scope({ $map: 1 }, root))).toBe(false);
  });
});

describe("the type of an event", () => {
  test("is the platform's event for the binding, on the platform's element for the tag", () => {
    expect(eventType({ tagName: "button" }, "onclick", plain)).toBe(
      eventOn("button", "click", BOTH),
    );
    expect(eventType({ tagName: "my-el" }, "onmy-event", plain)).toBe(
      eventOn('"my-el"', '"my-event"', BOTH),
    );
  });

  test("is any on what has no tag", () => {
    expect(eventType({}, "onclick", plain)).toBe("any");
    expect(eventType({ tagName: { $ref: "#/state/tag" } }, "onclick", plain)).toBe("any");
  });

  test("names the element as its target only where nothing inside it is an element", () => {
    const click = (element: JsonObject): string => eventType(element, "onclick", plain);
    const leaf = eventOn("p", "click", BOTH);
    const holder = eventOn("p", "click", CURRENT);
    expect(click({ tagName: "p" })).toBe(leaf);
    expect(click({ children: ["a", 1], tagName: "p" })).toBe(leaf);
    expect(click({ children: "a", tagName: "p" })).toBe(leaf);
    expect(click({ children: [{ tagName: "b" }], tagName: "p" })).toBe(holder);
    expect(click({ children: { $prototype: "Array" }, tagName: "p" })).toBe(holder);
    expect(click({ innerHTML: "<b>a</b>", tagName: "p" })).toBe(holder);
  });

  test("names the element as its target for an event that does not bubble, and a select's own", () => {
    const form = { children: [{ tagName: "input" }], tagName: "form" };
    expect(eventType(form, "onscroll", plain)).toBe(eventOn("form", "scroll", BOTH));
    expect(eventType(form, "oninput", plain)).toBe(eventOn("form", "input", CURRENT));
    const select = { children: [{ tagName: "option" }], tagName: "select" };
    expect(eventType(select, "onchange", plain)).toBe(eventOn("select", "change", BOTH));
    expect(eventType(select, "oninput", plain)).toBe(eventOn("select", "input", BOTH));
    expect(eventType(select, "onclick", plain)).toBe(eventOn("select", "click", CURRENT));
  });

  test("reads an element in SVG off the SVG elements", () => {
    expect(eventType({ tagName: "circle" }, "onclick", { ...plain, svg: true })).toBe(
      eventOn("circle", "click", BOTH, "SVGElementTagNameMap"),
    );
  });
});

describe("how a body's event is written", () => {
  const globals = `${EVENT_GLOBALS.join("\n")}\n`;

  test("is declared as any, with nothing for it to read, where its type is any", () => {
    expect(eventLines("any", ["state", "e"])).toEqual({
      head: "declare const event: any;\n",
      parameter: "any",
    });
  });

  test("is declared once and read by the parameter that receives it", () => {
    expect(eventLines("T", ["state", "e"])).toEqual({
      head: `${globals}declare const event: T;\n`,
      parameter: "typeof event",
    });
    expect(eventLines("T", ["state"]).head).toBe(`${globals}declare const event: T;\n`);
  });

  test("is written on a parameter called event, which hides a declared one", () => {
    expect(eventLines("T", ["state", "event"])).toEqual({ head: globals, parameter: "T" });
  });
});

describe("the event a state function is given", () => {
  const fn = { $prototype: "Function", body: "" };
  const click = eventOn("button", "click", BOTH);
  const keydown = eventOn("input", "keydown", BOTH);
  const button = (name: string): JsonObject => ({
    onclick: { $ref: `#/state/${name}` },
    tagName: "button",
  });

  test("is the event of the binding that names it", () => {
    const doc = { children: [button("save")], state: { save: fn } };
    expect([...boundEvents(doc)]).toEqual([["/state/save", click]]);
  });

  test("is any of the events of every binding that names it, each said once", () => {
    const doc = {
      children: [
        button("save"),
        button("save"),
        { onkeydown: { $ref: "#/state/save" }, tagName: "input" },
      ],
      state: { save: fn },
    };
    expect([...boundEvents(doc)]).toEqual([["/state/save", `${click} | ${keydown}`]]);
  });

  test("is the function of the nearest scope that declares the name", () => {
    const doc = {
      children: [{ children: [button("save")], state: { save: fn }, tagName: "section" }],
      state: { save: fn },
    };
    expect([...boundEvents(doc)]).toEqual([["/children/0/state/save", click]]);
  });

  test("is not said of what is no function, of a name nothing declares, or of a deeper path", () => {
    const doc = {
      children: [
        button("count"),
        button("missing"),
        button("box/save"),
        { onclick: fn, tagName: "button" },
        { once: { $ref: "#/state/save" }, title: { $ref: "#/state/save" } },
      ],
      state: { box: { save: fn }, count: 0 },
    };
    expect([...boundEvents(doc)]).toEqual([]);
    expect([...boundEvents({ tagName: "div" })]).toEqual([]);
  });

  test("is not said of a function the document names anywhere else", () => {
    const other = (body: string): JsonObject => ({ $prototype: "Function", body });
    /** The functions given an event in a document that also holds `extra`. */
    const given = (extra: JsonObject): string[] => {
      const doc = {
        children: [button("save"), button("save$"), extra],
        state: { save: fn, save$: fn },
      };
      return [...boundEvents(doc).keys()];
    };
    expect(given({})).toEqual(["/state/save", "/state/save$"]);
    // A call from another body: whatever it passes is not an event.
    expect(given({ onclick: other("state.save(1)") })).toEqual(["/state/save$"]);
    expect(given({ textContent: "${state.save$()}" })).toEqual(["/state/save"]);
    // A longer name that holds this one is another name.
    expect(given({ children: ["unsaved", "save_all"] })).toEqual(["/state/save", "/state/save$"]);
  });
});
