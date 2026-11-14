/**
 * External-class-hydration.test.ts — a `timing: "client"` external class, executed (compiler.md
 * §3).
 *
 * The emitters' own tests assert on bytes. This file loads the emitted page module and element
 * module in a DOM and drives them, because what the section promises is an ORDER: the class is
 * constructed and resolved, then the page hydrates or the element draws, and the prerendered markup
 * is what is on screen until then. Each class here waits on a gate the test opens, so "before" and
 * "after" are both observable.
 *
 * Happy-dom globals are installed before a module is imported: lit-html captures `document` at
 * import time.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isFunction } from "@jxsuite/schema/guards";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";
import { Window } from "happy-dom";
import type { Element } from "happy-dom";
import { externalClassHelperSource } from "../src/shared";
import { instantiateAndResolve } from "../src/site/external-class";
import type { ExternalClassCtor } from "../src/site/external-class";
import { compileClient } from "../src/targets/compile-client";
import { compileElement } from "../src/targets/compile-element";

const TMP = resolve(import.meta.dir, "__test-external-class-hydration__");

/** What a `Feed` resolves to, and what it pushes to a subscriber. */
interface FeedValue {
  n: number;
  label: string;
}

/** The hooks the fixture classes read off `globalThis`: a gate per name, and each subscriber. */
const gates = new Map<string, Promise<void>>();
const openers = new Map<string, () => void>();
const subscribers = new Map<string, (value: FeedValue) => void>();
/** How many `Feed`s were constructed for each gate. */
const constructed = new Map<string, number>();

/** Make a gate a class can wait on, opened by {@link open}. */
function gate(name: string): void {
  gates.set(
    name,
    new Promise<void>((done) => {
      openers.set(name, done);
    }),
  );
}

/** Open a gate and let everything that was waiting on it run. */
async function open(name: string): Promise<void> {
  openers.get(name)?.();
  await settle();
}

/** Let pending promise reactions and queued microtasks run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve();
  }
}

/** A `Feed` waits on the gate its config names, answers `{ n, label }`, and offers `subscribe`. */
const FEED = `
const hooks = globalThis.__jxClassTest;
export default class Feed {
  constructor(config) {
    this.config = config;
    hooks.constructed.set(config.gate, (hooks.constructed.get(config.gate) ?? 0) + 1);
  }
  async resolve() {
    await hooks.gates.get(this.config.gate);
    return { n: 1, label: this.config.label };
  }
  subscribe(fn) { hooks.subscribers.set(this.config.gate, fn); }
}
`;

/** A class whose `resolve()` rejects. */
const BROKEN = `
export default class Broken {
  resolve() { return Promise.reject(new Error("offline")); }
}
`;

const PAGE: JxDocument = {
  children: [
    { id: "feed", tagName: "p", textContent: "${state.feed.label}:${state.feed.n}" },
    { id: "count", tagName: "p", textContent: "count=${state.count}" },
    { id: "broken", tagName: "p", textContent: "${state.broken === null ? 'none' : 'some'}" },
    { id: "bump", onclick: { $ref: "#/state/bump" }, tagName: "button" },
  ],
  state: {
    broken: { $prototype: "Broken", timing: "client" },
    bump: { $prototype: "Function", body: "state.count++" },
    count: 5,
    feed: { $prototype: "Feed", gate: "page", label: "page", timing: "client" },
  },
  tagName: "main",
};

/** An element whose template reads its class's value, so a draw before the class resolves throws. */
function feedElement(tagName: string, gateName: string): JxDocument {
  return {
    children: [{ tagName: "p", textContent: "${state.feed.label}:${state.feed.n}" }],
    state: {
      feed: { $prototype: "Feed", gate: gateName, label: tagName, timing: "client" },
      mounted: 0,
      onMount: { $prototype: "Function", body: "state.mounted++" },
    },
    tagName,
  };
}

const resolveClass = (def: { $prototype: string }) => resolve(TMP, `${def.$prototype}.js`);

let win: Window;
/** `console.error`, silenced and recorded: a failing class is logged there, once per entry. */
const errors = spyOn(console, "error").mockImplementation(() => {});
let pageLoading: Promise<void>;
let pageHtml = "";

function required(selector: string): Element {
  const found = win.document.querySelector(selector);
  if (found === null) {
    throw new Error(`Expected ${selector} in the document`);
  }
  return found;
}

/** A compiled feed element, with the `template()` it draws with counted. */
interface FeedElement extends Element {
  state: { feed: FeedValue | null; mounted: number };
  template: () => object;
}

function isFeedElement(element: Element): element is FeedElement {
  return "state" in element && "template" in element && isFunction(element.template);
}

/** Create an element of a compiled tag holding prerendered markup, and count its draws. */
function create(tagName: string) {
  const el = win.document.createElement(tagName);
  if (!isFeedElement(el)) {
    throw new Error(`Expected <${tagName}> to be a compiled element`);
  }
  el.innerHTML = '<p class="prerendered">from the build</p>';
  let draws = 0;
  const { template } = el;
  el.template = () => {
    draws += 1;
    return template.call(el);
  };
  return { draws: () => draws, el };
}

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(resolve(TMP, "Feed.js"), FEED, "utf8");
  writeFileSync(resolve(TMP, "Broken.js"), BROKEN, "utf8");

  const page = compileClient(PAGE, { resolveClass });
  pageHtml = page.html.slice(page.html.indexOf("<body>") + 6, page.html.indexOf("</body>"));
  writeFileSync(resolve(TMP, "app.js"), page.files[0]!.content, "utf8");
  for (const [tagName, gateName] of [
    ["x-feed", "element"],
    ["x-moved", "moved"],
    ["x-removed", "removed"],
  ] as const) {
    const { files } = await compileElement(feedElement(tagName, gateName), {
      resolveClass: (def) => resolveClass(def),
    });
    writeFileSync(resolve(TMP, `${tagName}.js`), files[0]!.content, "utf8");
  }
  writeFileSync(
    resolve(TMP, "helper.js"),
    `${externalClassHelperSource()}\nexport default __jxInstantiate;\n`,
    "utf8",
  );

  win = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    CustomEvent: win.CustomEvent,
    Element: win.Element,
    Event: win.Event,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    __jxClassTest: { constructed, gates, subscribers },
    customElements: win.customElements,
    document: win.document,
    window: win.window,
  });
  win.document.body.innerHTML = pageHtml;
  for (const name of ["page", "element", "moved", "removed"]) {
    gate(name);
  }
  // The page module awaits its classes at top level, so its import settles only once they have.
  pageLoading = import(resolve(TMP, "app.js"));
  for (const tagName of ["x-feed", "x-moved", "x-removed"]) {
    await import(resolve(TMP, `${tagName}.js`));
  }
});

afterAll(() => {
  errors.mockRestore();
  rmSync(TMP, { force: true, recursive: true });
});

describe("a page with a client-timed external class (compiler.md §3)", () => {
  test("a page shows the resolved value once its module loads", async () => {
    // Prerender left every binding that reads a class, or state a handler writes, for hydration.
    expect(pageHtml).toContain('<p id="feed" data-bind :text-content=');
    await settle();
    // The class is constructed, and nothing has hydrated: no binding is filled, no handler bound.
    expect(constructed.get("page")).toBe(1);
    expect(required("#feed").textContent).toBe("");
    expect(required("#count").textContent).toBe("");
    required("#bump").dispatchEvent(new win.Event("click"));
    expect(required("#count").textContent).toBe("");

    await open("page");
    await pageLoading;
    expect(required("#feed").textContent).toBe("page:1");
    expect(required("#count").textContent).toBe("count=5");
    required("#bump").dispatchEvent(new win.Event("click"));
    expect(required("#count").textContent).toBe("count=6");
  });

  test("a subscribe callback updates the page binding", async () => {
    await pageLoading;
    subscribers.get("page")?.({ label: "pushed", n: 2 });
    await settle();
    expect(required("#feed").textContent).toBe("pushed:2");
  });

  test("a rejected resolve leaves the entry null and the other bindings hydrate", async () => {
    await pageLoading;
    const [message, cause] = errors.mock.calls[0] ?? [];
    expect(message).toBe('Jx: external class "broken" failed');
    expect(String(cause)).toContain("offline");
    expect(errors).toHaveBeenCalledTimes(1);
    // The entry is still null, and the page hydrated around it.
    expect(required("#broken").textContent).toBe("none");
    expect(required("#feed").textContent).not.toBe("");
  });
});

describe("an element with a client-timed external class (compiler.md §3)", () => {
  test("an element renders after its class resolves", async () => {
    const { draws, el } = create("x-feed");
    win.document.body.append(el);
    await settle();
    // Constructed on connection; the prerendered markup stays until the class has a value.
    expect(constructed.get("element")).toBe(1);
    expect(draws()).toBe(0);
    expect(el.querySelector(".prerendered")?.textContent).toBe("from the build");

    await open("element");
    expect(draws()).toBe(1);
    expect(el.querySelector(".prerendered")).toBeNull();
    expect(el.querySelector("p")?.textContent).toBe("x-feed:1");
    expect(el.state.mounted).toBe(1);

    // It follows `subscribe`, and a later connection draws again without a second construction.
    subscribers.get("element")?.({ label: "pushed", n: 3 });
    await settle();
    expect(el.querySelector("p")?.textContent).toBe("pushed:3");
    el.remove();
    win.document.body.append(el);
    await settle();
    expect(constructed.get("element")).toBe(1);
    expect(el.querySelector("p")?.textContent).toBe("pushed:3");
    expect(el.state.mounted).toBe(1);
  });

  test("a re-connection before resolve settles renders once", async () => {
    const { draws, el } = create("x-moved");
    win.document.body.append(el);
    el.remove();
    win.document.body.append(el);
    await settle();
    expect(draws()).toBe(0);

    await open("moved");
    // Two connections asked for a draw; only the one the element still has got it.
    expect(constructed.get("moved")).toBe(1);
    expect(draws()).toBe(1);
    expect(el.querySelector(".prerendered")).toBeNull();
    expect(el.querySelector("p")?.textContent).toBe("x-moved:1");
    expect(el.state.mounted).toBe(1);
  });

  test("an element removed before its class resolves does not draw", async () => {
    const { draws, el } = create("x-removed");
    win.document.body.append(el);
    el.remove();
    await open("removed");
    expect(draws()).toBe(0);
    expect(el.state.feed).toEqual({ label: "x-removed", n: 1 });
    expect(el.querySelector(".prerendered")?.textContent).toBe("from the build");
  });
});

/** The helper a generated module inlines, as loaded from its own source. */
type InlinedHelper = (
  Ctor: ExternalClassCtor | string,
  name: string,
  config: Record<string, JsonValue>,
) => Promise<[JsonValue, object]>;

describe("the inlined helper agrees with instantiateAndResolve", () => {
  test("over resolve, a value getter, a value field, and neither", async () => {
    /* SAFETY: `helper.js` is `externalClassHelperSource()` plus a default export of the one
       function it declares, whose three parameters and `[value, instance]` answer are this type. */
    const { default: inlined } = (await import(resolve(TMP, "helper.js"))) as {
      default: InlinedHelper;
    };
    writeFileSync(
      resolve(TMP, "classes.js"),
      [
        "export class Resolving { value = 'field'; async resolve() { return { via: 'resolve' }; } }",
        "export class Getter { get value() { return 'getter'; } }",
        "export class Field { constructor(c) { this.value = c.seed; } }",
        "export class Neither { constructor(c) { this.seed = c.seed; } }",
        "",
      ].join("\n"),
      "utf8",
    );
    /* SAFETY: the module written above, whose four exports are classes taking one config object. */
    const classes = (await import(resolve(TMP, "classes.js"))) as Record<string, ExternalClassCtor>;
    const config = { seed: "s" };
    for (const [name, Candidate] of Object.entries(classes)) {
      const atBuild = await instantiateAndResolve(Candidate, config);
      const [value, instance] = await inlined(Candidate, name, config);
      expect(instance).toBeInstanceOf(Candidate);
      // `Neither` answers with its instance, a different one each time: compare what it holds.
      expect(JSON.stringify(value)).toBe(JSON.stringify(atBuild.value));
    }
    expect(Object.keys(classes)).toHaveLength(4);

    let message = "";
    try {
      await inlined("not a class", "Weather", config);
    } catch (error) {
      message = error instanceof TypeError ? error.message : "";
    }
    expect(message).toBe('Jx: "Weather" is not a class');
  });
});
