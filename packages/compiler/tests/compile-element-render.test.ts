/**
 * Compile-element-render.test.ts — executes a compiled element module in a DOM.
 *
 * Every other element test asserts on emitted source text. This one loads the module for real and
 * drives it, because the four defects it covers were all of the kind that string assertions can
 * miss: an import that fails to link, a computed emitted as a raw function, a dead `$map`
 * reference, and a handler argument bound to the wrong value. Each one throws (or silently renders
 * nothing) at runtime while the emitted text still looks plausible.
 *
 * Happy-dom globals are installed before the module is imported — lit-html captures `document` at
 * import time.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isBoolean, isFunction, isNonNullObject } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, JxDocument } from "@jxsuite/schema/types";
import { Window } from "happy-dom";
import type { Element, HTMLElement } from "happy-dom";
import { compileElement } from "../src/targets/compile-element";
import { buildSite } from "../src/site/site-build";

const TMP = resolve(import.meta.dir, "__test-element-render__");

/** The default export of a bundled site worker: a Hono app, so `fetch` takes a request and env. */
interface PortableWorkerModule {
  default: { fetch: (req: Request, env: Record<string, string>) => Promise<Response> };
}

/** The element under test exercises issues #106, #107, #108 and #113 at once. */
const DOC: JxDocument = {
  children: [
    { oninput: { $ref: "#/state/onSearch" }, tagName: "input" },
    { id: "term", tagName: "p", textContent: "q=${state.term}" },
    {
      $prototype: "Array",
      items: { $ref: "#/state/rows" },
      map: {
        children: [
          { tagName: "span", textContent: '${$map?.item?.name}#${$map["index"]}' },
          { onclick: { $ref: "#/state/pick" }, tagName: "button", textContent: "pick" },
        ],
        className: "row ${$map.item.kind}",
        tagName: "li",
      },
    },
    { id: "picked", tagName: "p", textContent: "picked=${state.picked}" },
    // A positional helper a template calls, and a handler that takes (state, event) undeclared.
    { id: "pair", tagName: "p", textContent: "${state.pair(state.x, state.y)}" },
    { id: "ping", onclick: { $ref: "#/state/onPing" }, tagName: "button" },
    { id: "pinged", tagName: "p", textContent: "pinged=${state.pinged}" },
  ],
  state: {
    // #106: $export differs from the key. #107: read in `items`, so it must be a computed.
    onSearch: {
      $prototype: "Function",
      body: "state.term = event.target.value;",
      parameters: ["event"],
    },
    raw: [
      { kind: "x", name: "A", on: true },
      { kind: "y", name: "B", on: false },
    ],
    // Reads the iteration context the way examples/components/todo-app.json does.
    pick: {
      $prototype: "Function",
      body: "state.picked = state.$map.item.name + ':' + state.$map.index",
    },
    onPing: { $prototype: "Function", $src: "./lib.js" },
    pair: { $prototype: "Function", $src: "./lib.js", parameters: ["a", "b"] },
    picked: "",
    pinged: "",
    rows: { $export: "getRows", $prototype: "Function", $src: "./lib.js" },
    term: "",
    x: 1,
    y: 2,
  },
  tagName: "ls-board",
};

let host: Element;
let win: Window;

/** The element a query found, failing the suite when the compiled module rendered none. */
function rendered<E extends Element>(element: E | null, selector: string): E {
  if (!element) {
    throw new Error(`Expected the compiled element to render ${selector}`);
  }
  return element;
}

/** The compiled todo-app's reactive state, as its `state` property exposes it. */
interface TodoAppElement extends Element {
  state: { items: { done: boolean }[] };
}

function isTodoApp(element: Element): element is TodoAppElement {
  if (!("state" in element) || !isNonNullObject(element.state) || !("items" in element.state)) {
    return false;
  }
  const { items } = element.state;
  return (
    Array.isArray(items) &&
    items.every((item) => isNonNullObject(item) && "done" in item && isBoolean(item.done))
  );
}

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  mkdirSync(TMP, { recursive: true });

  writeFileSync(
    resolve(TMP, "lib.js"),
    "export function getRows(state) { return (state.raw || []).filter((r) => r.on); }\n" +
      "export function pair(a, b) { return a + ':' + b; }\n" +
      "export function onPing(state, event) { state.pinged = event.type; }\n",
    "utf8",
  );

  const { files } = await compileElement(DOC);
  writeFileSync(resolve(TMP, "el.js"), files[0]!.content, "utf8");

  win = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    CustomEvent: win.CustomEvent,
    Element: win.Element,
    Event: win.Event,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    customElements: win.customElements,
    document: win.document,
    window: win.window,
  });

  // Links the aliased import and registers the element — this is where #106 used to die with
  // `SyntaxError: Export named 'rows' not found`, taking the whole page down with it.
  await import(resolve(TMP, "el.js"));

  win.document.body.innerHTML = "<ls-board></ls-board>";
  host = rendered(win.document.querySelector("ls-board"), "ls-board");
  await new Promise((r) => {
    setTimeout(r, 20);
  });
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("compiled element — runtime behaviour", () => {
  test("the module links its aliased $src import and defines the element", () => {
    expect(host).toBeTruthy();
    expect(host.innerHTML).not.toBe("");
  });

  test("a $src entry read as a value renders its returned array", () => {
    // A raw function here would throw `s.rows.map is not a function` and render nothing.
    const rows = [...host.querySelectorAll("li")];
    expect(rows).toHaveLength(1);
  });

  test("$map reads resolve in class and in a nested child", () => {
    const row = host.querySelector("li");
    expect(row?.getAttribute("class")).toBe("row x");
    expect(row?.querySelector("span")?.textContent).toBe("A#0");
  });

  test("a handler inside a map can read its iteration from state", () => {
    const button = rendered(host.querySelector("li button"), "li button");
    button.dispatchEvent(new win.Event("click", { bubbles: true }));

    // `state.$map` was never published by the element target, so this read was undefined and
    // Handlers like todo-app's `toggleItem` silently did nothing.
    expect(host.querySelector("#picked")?.textContent).toBe("picked=A:0");
  });

  test('a handler declaring only ["event"] receives the event and can reach state', () => {
    const input = rendered(host.querySelector("input"), "input");
    input.value = "hello";
    input.dispatchEvent(new win.Event("input", { bubbles: true }));

    // Proves both halves of #113: `event` was the event (not the state object), and the body's bare
    // `state` resolved instead of throwing ReferenceError.
    expect(host.querySelector("#term")?.textContent).toBe("q=hello");
  });
});

describe("compiled element — one calling convention (spec.md §5.3 4d)", () => {
  test("a $src helper declaring parameters gets the template's arguments", () => {
    // The element target used to rewrite a declared helper to `pair(e, e)`, so this read 2:2.
    expect(host.querySelector("#pair")?.textContent).toBe("1:2");
  });

  test("an undeclared $src handler receives the event as its second argument", () => {
    rendered(host.querySelector("#ping"), "#ping").dispatchEvent(
      new win.Event("click", { bubbles: true }),
    );

    expect(host.querySelector("#pinged")?.textContent).toBe("pinged=click");
  });
});

describe("compiled element — $props delivery", () => {
  let propsHost: Element;

  beforeAll(async () => {
    const { files } = await compileElement({
      children: [{ tagName: "h3", textContent: "${state.label}" }],
      state: { label: { default: "DEFAULT" } },
      tagName: "ls-prop-row",
    });
    writeFileSync(resolve(TMP, "prop-row.js"), files[0]!.content, "utf8");
    await import(resolve(TMP, "prop-row.js"));
  });

  test("a literal props.* attribute reaches state and is cleaned up", async () => {
    win.document.body.innerHTML = `<ls-prop-row props.label="FROM-ITEM"></ls-prop-row>`;
    await new Promise((r) => {
      setTimeout(r, 20);
    });
    propsHost = rendered(win.document.querySelector("ls-prop-row"), "ls-prop-row");

    // This is the shape an island map template and a JSON-authored instance both emit. The compiled
    // Element read only `data-jx-props`, so the prop was ignored and the attribute left behind.
    expect(propsHost.textContent.trim()).toBe("FROM-ITEM");
    expect(propsHost.hasAttribute("props.label")).toBe(false);
  });

  test("a property set before upgrade still wins", async () => {
    win.document.body.innerHTML = "";
    const el = win.document.createElement("ls-prop-row");
    Object.assign(el, { label: "VIA-PROPERTY" });
    win.document.body.append(el);
    await new Promise((r) => {
      setTimeout(r, 20);
    });

    // The path a lit `.label=${…}` binding takes when the definition arrives after the render.
    expect(el.textContent.trim()).toBe("VIA-PROPERTY");
  });

  test("an unknown props.* attribute is left alone", async () => {
    win.document.body.innerHTML = `<ls-prop-row props.nope="x"></ls-prop-row>`;
    await new Promise((r) => {
      setTimeout(r, 20);
    });
    const el = rendered(win.document.querySelector("ls-prop-row"), "ls-prop-row");

    expect(el.hasAttribute("props.nope")).toBe(true);
    expect(el.textContent.trim()).toBe("DEFAULT");
  });
});

// ── The property bridge (spec.md §13.2, §16.2) ───────────────────────────────

/** A compiled element's reactive state, as its `state` property exposes it. */
interface StatefulElement extends Element {
  state: Record<string, JsonValue>;
}

function hasState(element: Element): element is StatefulElement {
  return "state" in element && isNonNullObject(element.state);
}

/** An `ls-bridge` instance, read through the accessors the bridge installs. */
interface BridgedElement extends Element {
  count: JsonValue;
  title: JsonValue;
}

function isBridged(element: Element): element is BridgedElement {
  return Object.hasOwn(element, "count") && Object.hasOwn(element, "title");
}

function bridged(element: Element): BridgedElement {
  if (!isBridged(element)) {
    throw new Error(`Expected <${element.localName}> to carry the bridge's accessors`);
  }
  return element;
}

function stateOf(element: Element): Record<string, JsonValue> {
  if (!hasState(element)) {
    throw new Error(`Expected <${element.localName}> to be a compiled element with state`);
  }
  return element.state;
}

describe("compiled element — the property bridge", () => {
  const CHILD: JxDocument = {
    children: [
      { className: "count", tagName: "p", textContent: "${state.count}" },
      { className: "title", tagName: "p", textContent: "${state.title}" },
      { className: "label", tagName: "p", textContent: "${state.label}" },
    ],
    state: { "#secret": "s", count: 0, label: { type: "string" }, title: "DEFAULT TITLE" },
    tagName: "ls-bridge",
  };

  const text = (el: Element, name: string) => el.querySelector(`p.${name}`)?.textContent;

  function connect(setup?: (el: HTMLElement) => void): HTMLElement {
    const el = win.document.createElement("ls-bridge");
    setup?.(el);
    win.document.body.append(el);
    return el;
  }

  beforeAll(async () => {
    const child = await compileElement(CHILD);
    writeFileSync(resolve(TMP, "bridge.js"), child.files[0]!.content, "utf8");
    await import(resolve(TMP, "bridge.js"));

    const parent = await compileElement({
      children: [
        {
          $props: { count: { $ref: "#/state/n" }, title: { $ref: "#/state/heading" } },
          id: "bound",
          tagName: "ls-bridge",
        },
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: { $props: { count: "${$map.item.n}" }, className: "row", tagName: "ls-bridge" },
        },
      ],
      state: { heading: "H1", n: 1, rows: [{ n: 1 }, { n: 2 }] },
      tagName: "ls-bridge-host",
    });
    writeFileSync(resolve(TMP, "bridge-host.js"), parent.files[0]!.content, "utf8");
    await import(resolve(TMP, "bridge-host.js"));
  });

  beforeEach(() => {
    win.document.body.innerHTML = "";
  });

  test("a property written after connection re-renders", () => {
    const el = connect();
    expect(text(el, "count")).toBe("0");
    Object.assign(el, { count: 3 });

    expect(text(el, "count")).toBe("3");
    expect(bridged(el).count).toBe(3);
  });

  test("a pure type definition accepts a prop from a property, data-jx-props and props.*", () => {
    const byProperty = connect((el) => {
      Object.assign(el, { label: "P" });
    });
    const byPayload = connect((el) => {
      el.dataset.jxProps = JSON.stringify({ label: "D" });
    });
    const byAttribute = connect((el) => {
      el.setAttribute("props.label", "A");
    });

    expect(text(byProperty, "label")).toBe("P");
    expect(text(byPayload, "label")).toBe("D");
    expect(text(byAttribute, "label")).toBe("A");
    // And it is part of the property interface afterwards, though state held nothing for it.
    Object.assign(byAttribute, { label: "LATER" });
    expect(text(byAttribute, "label")).toBe("LATER");
  });

  test("a reflected name set before connection renders", () => {
    // `title` goes through the platform's accessor and creates no own property.
    const el = connect((instance) => {
      Object.assign(instance, { title: "T" });
    });
    expect(Object.hasOwn(el, "title")).toBe(true);
    expect(text(el, "title")).toBe("T");
  });

  test("a reflected name nobody set keeps the declared default", () => {
    expect(text(connect(), "title")).toBe("DEFAULT TITLE");
  });

  test("an empty reflected value is honoured", () => {
    const el = connect((instance) => {
      Object.assign(instance, { title: "" });
    });
    expect(text(el, "title")).toBe("");
  });

  test("a reflected name written after connection reaches state and still reflects", () => {
    const el = connect();
    Object.assign(el, { title: "LATER" });

    expect(text(el, "title")).toBe("LATER");
    expect(el.getAttribute("title")).toBe("LATER");
    expect(bridged(el).title).toBe("LATER");
  });

  test("a private key gets no accessor and takes no prop", () => {
    const el = connect((instance) => {
      Object.assign(instance, { "#secret": "early" });
      instance.dataset.jxProps = JSON.stringify({ "#secret": "payload" });
      instance.setAttribute("props.#secret", "attribute");
    });
    expect(Object.getOwnPropertyDescriptor(el, "#secret")?.get).toBeUndefined();
    Object.assign(el, { "#secret": "late" });

    expect(stateOf(el)["#secret"]).toBe("s");
  });

  test("a compiled parent's bindings reach the child, at connection and after", () => {
    const parent = win.document.createElement("ls-bridge-host");
    win.document.body.append(parent);
    const child = rendered(parent.querySelector("#bound"), "#bound");

    // The title is the reflected-name case: `.title=` creates no own property.
    expect(text(child, "count")).toBe("1");
    expect(text(child, "title")).toBe("H1");

    stateOf(parent).n = 2;
    stateOf(parent).heading = "H2";
    expect(text(child, "count")).toBe("2");
    expect(text(child, "title")).toBe("H2");
    expect(child.getAttribute("title")).toBe("H2");
  });

  test("a reused $map row re-renders with its new item's props", () => {
    const parent = win.document.createElement("ls-bridge-host");
    win.document.body.append(parent);
    const counts = () => [...parent.querySelectorAll(".row")].map((row) => text(row, "count"));
    expect(counts()).toEqual(["1", "2"]);

    stateOf(parent).rows = [{ n: 2 }, { n: 1 }];
    expect(counts()).toEqual(["2", "1"]);
  });

  test("re-insertion neither re-merges nor loses the accessors", () => {
    const el = connect();
    el.remove();
    Object.assign(el, { count: 9 });
    win.document.body.append(el);
    expect(text(el, "count")).toBe("9");

    Object.assign(el, { count: 10 });
    expect(text(el, "count")).toBe("10");
  });

  test("a property set before the definition loads is absorbed, then forwards", async () => {
    const el = win.document.createElement("ls-bridge-late");
    Object.assign(el, { count: 7 });
    win.document.body.append(el);

    const late = await compileElement({ ...CHILD, tagName: "ls-bridge-late" });
    writeFileSync(resolve(TMP, "bridge-late.js"), late.files[0]!.content, "utf8");
    await import(resolve(TMP, "bridge-late.js"));

    expect(text(el, "count")).toBe("7");
    Object.assign(el, { count: 8 });
    expect(text(el, "count")).toBe("8");
  });

  test("a key naming a member of the element class is a prop by attribute only", async () => {
    const result = await compileElement({
      children: [{ tagName: "p", textContent: "${state.template}" }],
      state: { template: "t" },
      tagName: "ls-bridge-member",
    });
    writeFileSync(resolve(TMP, "bridge-member.js"), result.files[0]!.content, "utf8");
    await import(resolve(TMP, "bridge-member.js"));

    const el = win.document.createElement("ls-bridge-member");
    el.setAttribute("props.template", "from attribute");
    win.document.body.append(el);
    expect(el.textContent.trim()).toBe("from attribute");
    // The member the element renders with is still the class's own.
    expect(Object.hasOwn(el, "template")).toBe(false);
  });
});

// ── Lifecycle hooks and observed attributes (spec.md §16.4, §16.5) ───────────

describe("compiled element — lifecycle and observed attributes", () => {
  const CARD: JxDocument = {
    children: [
      { className: "username", tagName: "p", textContent: "${state.username}" },
      { className: "count", tagName: "p", textContent: "${JSON.stringify(state.count)}" },
      { className: "active", tagName: "p", textContent: "${JSON.stringify(state.active)}" },
      { className: "meta", tagName: "p", textContent: "${JSON.stringify(state.meta)}" },
      { className: "amount", tagName: "p", textContent: "${JSON.stringify(state.amount)}" },
      { className: "shout", tagName: "p", textContent: "${state.shout}" },
    ],
    observedAttributes: ["username", "count", "active", "meta", "amount", "shout"],
    state: {
      active: false,
      adopted: 0,
      amount: { type: "number" },
      count: { default: 1, type: "number" },
      meta: { kind: "none" },
      mounts: 0,
      onAdopted: { $prototype: "Function", body: "state.adopted += 1" },
      onMount: {
        $prototype: "Function",
        body: "state.mounts += 1; host.dataset.mounted = String(host === this);",
        parameters: ["state", "host"],
      },
      onUnmount: { $prototype: "Function", body: "state.unmounts += 1" },
      shout: "${state.username}!",
      unmounts: 0,
      username: "Guest",
    },
    tagName: "ls-observed",
  };

  const text = (el: Element, name: string) => el.querySelector(`p.${name}`)?.textContent;
  const microtask = () => Promise.resolve();

  function connect(attributes: Record<string, string> = {}): HTMLElement {
    const el = win.document.createElement("ls-observed");
    for (const [name, value] of Object.entries(attributes)) {
      el.setAttribute(name, value);
    }
    win.document.body.append(el);
    return el;
  }

  beforeAll(async () => {
    const { files } = await compileElement(CARD);
    writeFileSync(resolve(TMP, "observed.js"), files[0]!.content, "utf8");
    await import(resolve(TMP, "observed.js"));
  });

  beforeEach(() => {
    win.document.body.innerHTML = "";
  });

  test("onMount receives the element as its second argument and as its receiver", async () => {
    const el = connect();
    await microtask();
    expect(stateOf(el).mounts).toBe(1);
    expect(el.dataset.mounted).toBe("true");
  });

  test("onMount runs on the first connection only, and onUnmount on every removal", async () => {
    const el = connect();
    await microtask();
    el.remove();
    win.document.body.append(el);
    await microtask();
    el.remove();

    expect(stateOf(el).mounts).toBe(1);
    expect(stateOf(el).unmounts).toBe(2);
  });

  test("onAdopted runs from adoptedCallback", () => {
    const el = connect();
    // Happy-dom implements no adoption reaction, so the callback is called as the platform would.
    if (!("adoptedCallback" in el) || !isFunction(el.adoptedCallback)) {
      throw new Error("Expected the compiled element to define adoptedCallback");
    }
    el.adoptedCallback();
    expect(stateOf(el).adopted).toBe(1);
  });

  test("an observed attribute present at insertion renders, coerced", () => {
    const el = connect({ active: "", count: "3", username: "Ada" });
    expect(text(el, "username")).toBe("Ada");
    expect(text(el, "count")).toBe("3");
    expect(text(el, "active")).toBe("true");
  });

  test("an element upgraded after insertion reads its attributes", async () => {
    win.document.body.innerHTML = '<ls-observed-late username="Ada" count="4"></ls-observed-late>';
    const { files } = await compileElement({ ...CARD, tagName: "ls-observed-late" });
    writeFileSync(resolve(TMP, "observed-late.js"), files[0]!.content, "utf8");
    await import(resolve(TMP, "observed-late.js"));

    const el = rendered(win.document.querySelector("ls-observed-late"), "ls-observed-late");
    expect(text(el, "username")).toBe("Ada");
    expect(text(el, "count")).toBe("4");
  });

  test("a later change coerces", () => {
    const el = connect({ active: "" });
    el.setAttribute("count", "4");
    el.setAttribute("active", "false");
    el.setAttribute("username", "Grace");

    expect(stateOf(el).count).toBe(4);
    expect(stateOf(el).active).toBe(false);
    expect(text(el, "username")).toBe("Grace");
  });

  test("a change made before connection is heard too", () => {
    const el = win.document.createElement("ls-observed");
    el.setAttribute("username", "Early");
    expect(stateOf(el).username).toBe("Early");
  });

  test("a removal restores the declared default", () => {
    const el = connect({ count: "7", username: "Ada" });
    el.removeAttribute("count");
    el.removeAttribute("username");

    expect(stateOf(el).count).toBe(1);
    expect(text(el, "username")).toBe("Guest");
  });

  test("a pure type definition takes the text as written, and a removal clears it", () => {
    const el = connect({ amount: "3" });
    expect(text(el, "amount")).toBe('"3"');
    el.removeAttribute("amount");
    expect(text(el, "amount")).toBe('""');
  });

  test("an object default comes back as a fresh copy", () => {
    const first = connect({ meta: "custom" });
    first.removeAttribute("meta");
    expect(text(first, "meta")).toBe('{"kind":"none"}');
    const restored = stateOf(first).meta;
    if (!isNonNullObject(restored) || Array.isArray(restored)) {
      throw new Error("Expected the restored default to be an object");
    }
    restored.kind = "mutated";

    const second = connect({ meta: "custom" });
    second.removeAttribute("meta");
    expect(text(second, "meta")).toBe('{"kind":"none"}');
  });

  test("an observed attribute never writes a computed entry", () => {
    const el = connect({ shout: "text", username: "Ada" });
    expect(text(el, "shout")).toBe("Ada!");
    el.setAttribute("shout", "other");
    el.removeAttribute("shout");
    expect(text(el, "shout")).toBe("Ada!");
  });

  test("a property set before connection beats the attribute", () => {
    const el = win.document.createElement("ls-observed");
    el.setAttribute("username", "from attribute");
    Object.assign(el, { username: "from property" });
    win.document.body.append(el);
    expect(text(el, "username")).toBe("from property");
  });

  test("data-jx-props beats the attribute", () => {
    const el = win.document.createElement("ls-observed");
    el.setAttribute("username", "from attribute");
    el.dataset.jxProps = JSON.stringify({ username: "from props" });
    win.document.body.append(el);
    expect(text(el, "username")).toBe("from props");
  });

  test("re-insertion does not re-read an attribute over a state change", () => {
    const el = connect({ username: "Ada" });
    stateOf(el).username = "Changed";
    el.remove();
    win.document.body.append(el);
    expect(text(el, "username")).toBe("Changed");
  });
});

// ── The shipped todo-app example, end to end ─────────────────────────────────

describe("compiled element — examples/components/todo-app.json", () => {
  let app: Element;

  beforeAll(async () => {
    const { files } = await compileElement(
      resolve(import.meta.dir, "../../../examples/components/todo-app.json"),
    );
    writeFileSync(resolve(TMP, "todo-app.js"), files.at(-1)!.content, "utf8");
    await import(resolve(TMP, "todo-app.js"));

    win.document.body.innerHTML = "<todo-app></todo-app>";
    await new Promise((r) => {
      setTimeout(r, 30);
    });
    app = rendered(win.document.querySelector("todo-app"), "todo-app");
  });

  test("renders its seeded items", () => {
    expect(app.querySelectorAll("li")).toHaveLength(2);
  });

  test("its checkbox toggles the row that was clicked", () => {
    if (!isTodoApp(app)) {
      throw new Error("Expected <todo-app> to expose its state.items");
    }
    const { state } = app;
    expect(state.items.map((i) => i.done)).toEqual([false, false]);

    const boxes = [...app.querySelectorAll("li input[type=checkbox]")];
    boxes[1]!.dispatchEvent(new win.Event("click", { bubbles: true }));

    // Two defects met on this one handler: `toggleItem` was classified a computed because its guard
    // Clause contains a bare `return`, and `state.$map` was never published for map handlers. Either
    // One alone left the checkbox doing nothing at all, with nothing thrown.
    expect(state.items.map((i) => i.done)).toEqual([false, true]);
  });
});

// ── timing: "server" entries, called through a stubbed fetch ─────────────────

describe("compiled element — timing server entries", () => {
  /** One request the element made, held open until the test answers it. */
  interface ServerCall {
    url: string;
    body: JsonObject;
    respond: (status: number, json: JsonValue) => void;
  }

  /** The compiled element's reactive state, as its `state` property exposes it. */
  interface ServerCardElement extends Element {
    state: { who: string; hit: JsonValue };
  }

  function isServerCard(element: Element): element is ServerCardElement {
    return (
      "state" in element &&
      isNonNullObject(element.state) &&
      "who" in element.state &&
      "hit" in element.state
    );
  }

  const realFetch = globalThis.fetch;
  const realConsoleError = console.error;
  let calls: ServerCall[] = [];
  let logged: string[] = [];

  /** Mount a fresh `<ls-server-card>` and wait for its first render. */
  async function mount(attributes = ""): Promise<ServerCardElement> {
    win.document.body.innerHTML = `<ls-server-card ${attributes}></ls-server-card>`;
    await tick();
    const card = rendered(win.document.querySelector("ls-server-card"), "ls-server-card");
    if (!isServerCard(card)) {
      throw new Error("Expected <ls-server-card> to expose its state");
    }
    return card;
  }

  const tick = () =>
    new Promise((r) => {
      setTimeout(r, 15);
    });

  /** What the card currently shows. */
  const shown = () => win.document.querySelector("#out")?.textContent;

  beforeAll(async () => {
    const { files } = await compileElement({
      children: [{ id: "out", tagName: "span", textContent: "${state.hit?.n ?? 'none'}" }],
      state: {
        hit: {
          $export: "hit",
          $src: "./card.server.js",
          arguments: { who: { $ref: "#/state/who" } },
          timing: "server",
        },
        who: "ann",
      },
      tagName: "ls-server-card",
    });
    writeFileSync(resolve(TMP, "server-card.js"), files[0]!.content, "utf8");
    await import(resolve(TMP, "server-card.js"));
  });

  beforeEach(() => {
    calls = [];
    logged = [];
    // A request is parsed back out of its own body, then held open until the test answers it.
    const stub = async (input: string | URL | Request, init?: RequestInit) => {
      const body: JsonObject = await new Response(init?.body).json();
      return await new Promise<Response>((resolveResponse) => {
        calls.push({
          body,
          respond: (status, json) => {
            resolveResponse(Response.json(json, { status }));
          },
          url: String(input),
        });
      });
    };
    globalThis.fetch = Object.assign(stub, { preconnect: realFetch.preconnect });
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    console.error = realConsoleError;
  });

  test("posts the arguments and renders the answer", async () => {
    await mount('props.who="bea"');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/_jx/server/hit");
    // A prop the parent delivered is merged before the call, so it is the one sent.
    expect(calls[0]!.body).toEqual({ who: "bea" });
    expect(shown()).toBe("none");

    calls[0]!.respond(200, { n: 7 });
    await tick();
    expect(shown()).toBe("7");
  });

  test("a 500 with { ok: false, error } keeps the rendered value and calls console.error", async () => {
    const card = await mount();
    calls[0]!.respond(200, { n: 7 });
    await tick();
    expect(shown()).toBe("7");

    card.state.who = "cy";
    await tick();
    expect(calls).toHaveLength(2);
    calls[1]!.respond(500, { error: "boom", ok: false });
    await tick();

    // A failed answer is never stored, so the last good value stays on the page.
    expect(shown()).toBe("7");
    const output = logged.join("\n");
    expect(output).toContain("Jx server function hit:");
    expect(output).toContain("boom");
  });

  test("a changed $ref prop re-posts, and a late answer to the first call is dropped", async () => {
    const card = await mount();
    card.state.who = "dee";
    await tick();
    expect(calls.map((c) => c.body)).toEqual([{ who: "ann" }, { who: "dee" }]);

    // The second call answers first. The first, answering late, must not overwrite it.
    calls[1]!.respond(200, { n: 2 });
    await tick();
    expect(shown()).toBe("2");
    calls[0]!.respond(200, { n: 1 });
    await tick();
    expect(shown()).toBe("2");
  });

  test("disconnect stops the effect", async () => {
    const card = await mount();
    expect(calls).toHaveLength(1);

    card.remove();
    card.state.who = "eli";
    await tick();
    expect(calls).toHaveLength(1);
  });
});

// ── A built site: the component's call reaches the site's own worker ─────────

describe("compiled element — a built site's server call", () => {
  const SITE = resolve(TMP, "site");
  const realFetch = globalThis.fetch;
  let portableDir = "";
  let worker: PortableWorkerModule;

  beforeAll(async () => {
    const writeP = (p: string, c: string) => {
      mkdirSync(resolve(SITE, ...p.split("/").slice(0, -1)), { recursive: true });
      writeFileSync(resolve(SITE, p), c, "utf8");
    };
    const writeJ = (p: string, obj: JsonValue) => {
      writeP(p, JSON.stringify(obj, null, 2));
    };

    writeJ("project.json", {
      build: { adapter: "bun", outDir: "./dist" },
      name: "Built Call Site",
      url: "https://x.dev/m/site/",
    });
    writeJ("pages/index.json", { children: [{ tagName: "h1", textContent: "Hi" }], title: "Home" });
    writeJ("components/ls-site-card.json", {
      children: [{ id: "out", tagName: "span", textContent: "${state.hit?.n ?? 'none'}" }],
      state: { hit: { $export: "hit", $src: "./card.server.js", timing: "server" } },
      tagName: "ls-site-card",
    });
    writeP("components/card.server.js", "export function hit() { return { n: 42 }; }\n");

    const { errors } = await buildSite(SITE, { verbose: false });
    expect(errors).toEqual([]);

    // The worker is copied out of the workspace, as the portability case does, so Bun does not
    // Instrument the bundled hono it carries.
    portableDir = mkdtempSync(join(tmpdir(), "jx-worker-portability-"));
    const portable = join(portableDir, "worker.mjs");
    copyFileSync(resolve(SITE, "dist/worker.js"), portable);
    worker = await import(portable);
    await import(resolve(SITE, "dist/components/ls-site-card.js"));
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    rmSync(portableDir, { force: true, recursive: true });
  });

  test("renders the value the worker answers at the based route", async () => {
    // The page's own `fetch` is routed straight into the built worker, whose routes sit under the
    // Deployment base the component was compiled with.
    const seen: string[] = [];
    const routed = (input: string | URL | Request, init?: RequestInit) => {
      seen.push(String(input));
      const url = new URL(String(input), "http://localhost");
      return worker.default.fetch(new Request(url, init), {});
    };
    globalThis.fetch = Object.assign(routed, { preconnect: realFetch.preconnect });

    win.document.body.innerHTML = "<ls-site-card></ls-site-card>";
    await new Promise((r) => {
      setTimeout(r, 50);
    });

    expect(seen).toEqual(["/m/site/_jx/server/hit"]);
    expect(win.document.querySelector("#out")?.textContent).toBe("42");
  });
});
