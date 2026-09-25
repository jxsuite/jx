import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { reactive, ref } from "@vue/reactivity";
import {
  Jx,
  buildScope,
  documentStyleText,
  mount,
  preloadDocument,
  preloadModule,
  resetDocumentStyles,
  resolve,
  setRootMedia,
  setSkipAutoRequests,
  setSkipServerFunctions,
} from "../src/runtime";
import type { JxDocument } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/** A fetch that refuses: every test below must resolve its documents without the network. */
const noNetwork = () => mock(() => Promise.reject(new Error("no network")));

let host: HTMLElement;
let uid = 0;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  host.remove();
  resetDocumentStyles();
  setRootMedia({});
  setSkipServerFunctions(false);
  setSkipAutoRequests(false);
});

describe("mount — render, dispose, lifecycle", () => {
  test("renders into the target and returns the live scope", async () => {
    const m = await mount({ tagName: "p", textContent: "${state.n}", state: { n: 1 } }, host);
    expect(host.textContent).toBe("1");
    expect(m.root).toBe(host.firstElementChild as HTMLElement);
    m.scope.n = 2;
    await tick();
    expect(host.textContent).toBe("2");
  });

  test("dispose stops effects, removes the root, calls onUnmount once, and is idempotent", async () => {
    const onMount = mock((_scope: unknown) => null);
    const onUnmount = mock((_scope: unknown) => null);
    const m = await mount({ tagName: "p", textContent: "${state.n}", state: { n: 1 } }, host, {
      scope: { onMount, onUnmount },
    });
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount.mock.calls[0]![0]).toBe(m.scope);

    m.dispose();
    expect(host.childElementCount).toBe(0);
    expect(onUnmount).toHaveBeenCalledTimes(1);
    // The effects are gone: a later write does not reach the detached root.
    m.scope.n = 9;
    await tick();
    expect(m.root.textContent).toBe("1");

    m.dispose();
    expect(onUnmount).toHaveBeenCalledTimes(1);
  });

  test("the rules a mount adopted into the document are released on dispose", async () => {
    const m = await mount({ tagName: "div", style: { color: "rgb(1, 2, 3)" } }, host);
    expect(documentStyleText()).toContain("rgb(1, 2, 3)");
    m.dispose();
    expect(documentStyleText()).not.toContain("rgb(1, 2, 3)");
  });

  test("an already-aborted signal mounts nothing and never runs onMount", async () => {
    const onMount = mock(() => null);
    const onUnmount = mock(() => null);
    const controller = new AbortController();
    controller.abort();
    const m = await mount({ tagName: "p", textContent: "x" }, host, {
      scope: { onMount, onUnmount },
      signal: controller.signal,
    });
    expect(host.childElementCount).toBe(0);
    expect(onMount).not.toHaveBeenCalled();
    expect(onUnmount).not.toHaveBeenCalled();
    expect(m.root.textContent).toBe("x");
  });

  test("aborting the signal after mount disposes", async () => {
    const onUnmount = mock(() => null);
    const controller = new AbortController();
    await mount({ tagName: "p", textContent: "x" }, host, {
      scope: { onUnmount },
      signal: controller.signal,
    });
    expect(host.childElementCount).toBe(1);
    controller.abort();
    expect(host.childElementCount).toBe(0);
    expect(onUnmount).toHaveBeenCalledTimes(1);
  });

  test("elements lists every custom tag the render instantiated", async () => {
    const tag = `mount-el-${(uid += 1)}`;
    preloadDocument(`jx-test:/${tag}.json`, {
      tagName: tag,
      children: [{ tagName: "b", textContent: "inner" }],
    });
    const m = await mount(
      {
        tagName: "div",
        $elements: [{ $ref: `jx-test:/${tag}.json` }],
        children: [{ tagName: tag }, { tagName: tag, $props: { x: 1 } }],
      },
      host,
    );
    await tick();
    expect([...m.elements]).toEqual([tag]);
    expect(host.querySelectorAll(tag).length).toBe(2);
    expect(host.querySelector(tag)?.textContent).toBe("inner");
  });
});

describe("mount — the host scope", () => {
  test("a host reactive record drives a binding", async () => {
    const model = reactive({ label: "a" });
    await mount({ tagName: "span", textContent: "${state.model.label}" }, host, {
      scope: { model },
    });
    expect(host.textContent).toBe("a");
    model.label = "b";
    await tick();
    expect(host.textContent).toBe("b");
  });

  test("a host ref is read through the scope and tracks", async () => {
    const count = ref(1);
    await mount({ tagName: "span", textContent: "${state.count}" }, host, { scope: { count } });
    expect(host.textContent).toBe("1");
    count.value = 2;
    await tick();
    expect(host.textContent).toBe("2");
  });

  test("a reactive record handed in as the scope itself stays live, field by field", async () => {
    const model = reactive({ label: "a", n: 1 });
    const m = await mount(
      { tagName: "span", textContent: "${state.label}/${state.n}", state: { n: 5 } },
      host,
      { scope: model },
    );
    // A primitive field is read through, not copied; the document's own `n` still wins.
    expect(host.textContent).toBe("a/5");
    model.label = "b";
    await tick();
    expect(host.textContent).toBe("b/5");
    // A write through the scope reaches the host's record.
    m.scope.label = "c";
    expect(model.label).toBe("c");
  });

  test("a document state entry wins a name clash with the host", async () => {
    await mount({ tagName: "span", textContent: "${state.n}", state: { n: 5 } }, host, {
      scope: { n: 1 },
    });
    expect(host.textContent).toBe("5");
  });

  test("keys that are runtime vocabulary are refused", async () => {
    const doc: JxDocument = { tagName: "span" };
    const refused = async (scope: Record<string, unknown>) => {
      try {
        await mount(doc, host, { scope });
      } catch (error) {
        return error;
      }
      return null;
    };
    expect(await refused({ $media: {} })).toBeInstanceOf(TypeError);
    expect(String(await refused({ "#secret": 1 }))).toMatch(/reserved/);
    expect(host.childElementCount).toBe(0);
  });

  test("a host function in handler position receives (scope, event)", async () => {
    const onPress = mock((_scope: unknown, _event: Event) => null);
    const m = await mount(
      { tagName: "button", textContent: "go", onclick: { $ref: "#/state/onPress" } },
      host,
      { scope: { onPress } },
    );
    (host.firstElementChild as HTMLButtonElement).click();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0]![0]).toBe(m.scope);
    expect((onPress.mock.calls[0]![1] as Event).type).toBe("click");
  });

  test("call hands a host method its arguments positionally, with its owner as this", async () => {
    const commands = {
      last: null as unknown,
      run(id: string, extra: unknown) {
        this.last = [id, extra];
      },
    };
    await mount(
      {
        tagName: "button",
        onclick: {
          $expression: {
            operator: "call",
            target: { $ref: "#/state/commands/run" },
            value: ["file.save", { mode: "preview" }],
          },
        },
      },
      host,
      { scope: { commands } },
    );
    (host.firstElementChild as HTMLButtonElement).click();
    expect(commands.last).toEqual(["file.save", { mode: "preview" }]);
  });

  test("call on a scope-level host function binds the scope as this", async () => {
    const m = await mount(
      {
        tagName: "button",
        onclick: {
          $expression: { operator: "call", target: { $ref: "#/state/run" }, value: ["x"] },
        },
      },
      host,
      {
        scope: {
          run(this: Record<string, unknown>, id: string) {
            this.seen = id;
          },
        },
      },
    );
    (host.firstElementChild as HTMLButtonElement).click();
    expect(m.scope.seen).toBe("x");
  });
});

describe("mount — events out", () => {
  test("a parameterised body invoked through call dispatches from the mount root", async () => {
    const seen: { detail: unknown; target: EventTarget | null }[] = [];
    host.addEventListener("jx-notify", (e) => {
      seen.push({ detail: (e as CustomEvent).detail, target: e.target });
    });
    const m = await mount(
      {
        tagName: "div",
        state: {
          notify: {
            $prototype: "Function",
            parameters: ["what"],
            body: [{ dispatchEvent: "jx-notify", detail: { $ref: "$args/what" }, bubbles: true }],
          },
        },
        children: [
          {
            tagName: "button",
            onclick: {
              $expression: {
                operator: "call",
                target: { $ref: "#/state/notify" },
                value: ["saved"],
              },
            },
          },
        ],
      },
      host,
    );
    host.querySelector("button")!.click();
    await tick();
    expect(seen).toEqual([{ detail: "saved", target: m.root }]);
  });

  test("a body run from an event dispatches from that event's currentTarget, not the root", async () => {
    const targets: EventTarget[] = [];
    host.addEventListener("jx-hit", (e) => {
      targets.push(e.target as EventTarget);
    });
    await mount(
      {
        tagName: "div",
        children: [
          {
            tagName: "button",
            onclick: { $prototype: "Function", body: [{ dispatchEvent: "jx-hit", bubbles: true }] },
          },
        ],
      },
      host,
    );
    const button = host.querySelector("button")!;
    button.click();
    await tick();
    expect(targets).toEqual([button]);
  });
});

describe("mount — per-mount context", () => {
  test("each mount carries its own $media and neither touches the module default", async () => {
    const doc: JxDocument = { tagName: "div", style: { "@--md": { color: "red" } } };
    await mount(doc, host, { media: { "--md": "(min-width: 600px)" } });
    await mount(doc, host, { media: { "--md": "(min-width: 900px)" } });
    const css = documentStyleText();
    expect(css).toContain("(min-width: 600px)");
    expect(css).toContain("(min-width: 900px)");
    // The module default was never written: a direct scope build sees no root media.
    const plain = await buildScope({ tagName: "div" });
    expect(plain.$media).toBeUndefined();
  });

  test("skipServerFunctions is per mount and defaults to the module setting", async () => {
    const doc: JxDocument = {
      tagName: "div",
      state: { srv: { timing: "server", $src: "jx-test:/missing.js", $export: "f" } },
    };
    const skipped = await mount(doc, host, { skipServerFunctions: true });
    expect(skipped.scope.srv).toBeUndefined();

    setSkipServerFunctions(true);
    const inherited = await mount(doc, host);
    expect(inherited.scope.srv).toBeUndefined();
  });

  test("skipAutoRequests is per mount and overrides the module setting either way", async () => {
    const fetchMock = mock(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ a: 1 }) }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const doc: JxDocument = {
      tagName: "div",
      state: { data: { $prototype: "Request", url: "https://example.test/x" } },
    };
    await mount(doc, host, { skipAutoRequests: true });
    expect(fetchMock).not.toHaveBeenCalled();

    setSkipAutoRequests(true);
    await mount(doc, host, { skipAutoRequests: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a resolver serves an external $switch case with no network and no shared caching", async () => {
    const fetchMock = noNetwork();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const resolver = mock((url: string) =>
      url.endsWith("/views/home.json") ? { tagName: "p", textContent: "Home" } : undefined,
    );
    await mount(
      {
        tagName: "div",
        state: { view: "home" },
        children: [
          { $switch: { $ref: "#/state/view" }, cases: { home: { $ref: "./views/home.json" } } },
        ],
      },
      host,
      { base: "http://localhost/app/", resolver },
    );
    await tick();
    expect(host.textContent).toBe("Home");
    expect(resolver).toHaveBeenCalledWith("http://localhost/app/views/home.json");
    expect(fetchMock).not.toHaveBeenCalled();
    // The hit belonged to that mount: the shared path still has to fetch, and here cannot.
    let shared: unknown = null;
    try {
      await resolve("http://localhost/app/views/home.json");
    } catch (error) {
      shared = error;
    }
    expect(String(shared)).toContain("no network");
  });

  test("a resolver serves an $elements reference", async () => {
    const fetchMock = noNetwork();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const tag = `mount-el-${(uid += 1)}`;
    const m = await mount(
      { tagName: "div", $elements: [{ $ref: `./${tag}.json` }], children: [{ tagName: tag }] },
      host,
      {
        base: "http://localhost/app/",
        resolver: (url) =>
          url === `http://localhost/app/${tag}.json`
            ? { tagName: tag, children: [{ tagName: "i", textContent: "served" }] }
            : undefined,
      },
    );
    await tick();
    expect(customElements.get(tag)).toBeDefined();
    expect(host.querySelector(tag)?.textContent).toBe("served");
    expect(m.elements.has(tag)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("preloadDocument / preloadModule", () => {
  test("a preloaded document resolves by its URL without fetching", async () => {
    const fetchMock = noNetwork();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const doc: JxDocument = { tagName: "p", textContent: "preloaded" };
    preloadDocument("jx-test:/docs/pre.json", doc);
    expect(await resolve("jx-test:/docs/pre.json")).toBe(doc);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a key that is not a URL is still served under itself", async () => {
    const doc: JxDocument = { tagName: "p" };
    preloadDocument("not a url at all", doc);
    expect(await resolve("not a url at all")).toBe(doc);
  });

  test("a preloaded module serves a $src sidecar", async () => {
    preloadModule("jx-test:/behaviors.ts", {
      greet(state: Record<string, unknown>, event: Event) {
        state.greeted = event.type;
      },
    });
    const m = await mount(
      {
        tagName: "button",
        state: {
          greeted: "",
          greet: { $prototype: "Function", $src: "jx-test:/behaviors.ts", $export: "greet" },
        },
        onclick: { $ref: "#/state/greet" },
      },
      host,
    );
    (host.firstElementChild as HTMLButtonElement).click();
    expect(m.scope.greeted).toBe("click");
  });
});

describe("preloadModule with a loader", () => {
  const sidecar = {
    greet(state: Record<string, unknown>, event: Event) {
      state.greeted = event.type;
    },
  };
  const doc = (src: string): JxDocument => ({
    tagName: "button",
    state: {
      greeted: "",
      greet: { $prototype: "Function", $src: src, $export: "greet" },
    },
    onclick: { $ref: "#/state/greet" },
  });

  test("imports on first use, once, and concurrent resolvers share the one load", async () => {
    let loads = 0;
    preloadModule("jx-test:/lazy.ts", async () => {
      loads += 1;
      await tick();
      return sidecar;
    });
    expect(loads).toBe(0);
    const second = document.createElement("div");
    document.body.append(second);
    const [a, b] = await Promise.all([
      mount(doc("jx-test:/lazy.ts"), host),
      mount(doc("jx-test:/lazy.ts"), second),
    ]);
    expect(loads).toBe(1);
    (host.firstElementChild as HTMLButtonElement).click();
    (second.firstElementChild as HTMLButtonElement).click();
    expect(a.scope.greeted).toBe("click");
    expect(b.scope.greeted).toBe("click");
    await mount(doc("jx-test:/lazy.ts"), second);
    expect(loads).toBe(1);
    second.remove();
  });

  test("a load that fails is retried by the next document, and a namespace replaces a loader", async () => {
    let attempts = 0;
    preloadModule("jx-test:/flaky.ts", async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("chunk dropped");
      }
      return sidecar;
    });
    let refusal: unknown = null;
    try {
      await mount(doc("jx-test:/flaky.ts"), host);
    } catch (error) {
      refusal = error;
    }
    expect(String(refusal)).toContain("chunk dropped");
    const m = await mount(doc("jx-test:/flaky.ts"), host);
    expect(attempts).toBe(2);
    (host.firstElementChild as HTMLButtonElement).click();
    expect(m.scope.greeted).toBe("click");

    /* The eager form wins over a loader registered before it, and never runs it. */
    let ran = false;
    preloadModule("jx-test:/both.ts", async () => {
      ran = true;
      return sidecar;
    });
    preloadModule("jx-test:/both.ts", sidecar);
    await mount(doc("jx-test:/both.ts"), host);
    expect(ran).toBe(false);
  });

  test("a $implementation class behind a .class.json is served by its loader", async () => {
    /* The schema's $implementation is resolved against the schema URL, so the loader is keyed by
       that href — the only thing the host can know about the module before it is asked for. A
       proxy fallback would be a POST, and this fetch refuses one, so the value can only come from
       the loader. */
    const classDef = { $implementation: "./lazy-box.ts", title: "Box" };
    const fetchMock = mock((url: string, init?: { method?: string }) =>
      init?.method === undefined && url === "http://jx-test.invalid/lazy-box.class.json"
        ? Promise.resolve({ ok: true, json: () => Promise.resolve(classDef) })
        : Promise.reject(new Error("no network")),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let loads = 0;
    preloadModule("http://jx-test.invalid/lazy-box.ts", async () => {
      loads += 1;
      await tick();
      return {
        Box: class {
          value: string;
          constructor(config: { initial: string }) {
            this.value = `boxed:${config.initial}`;
          }
        },
      };
    });
    const m = await mount(
      {
        tagName: "div",
        state: {
          box: {
            $prototype: "Box",
            $src: "http://jx-test.invalid/lazy-box.class.json",
            initial: "hello",
          },
        },
      },
      host,
    );
    expect(loads).toBe(1);
    expect(m.scope.box).toBe("boxed:hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a timing: "server" function is served by its loader', async () => {
    /* A server function whose module cannot import falls back to the dev proxy, which would be a
       POST this fetch refuses — so a summed value proves the loader's namespace was awaited. */
    const fetchMock = noNetwork();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let loads = 0;
    preloadModule("jx-test:/server.ts", async () => {
      loads += 1;
      await tick();
      return { sum: async ({ a, b }: { a: number; b: number }) => a + b };
    });
    const m = await mount(
      {
        tagName: "div",
        state: {
          total: {
            timing: "server",
            $src: "jx-test:/server.ts",
            $export: "sum",
            arguments: { a: 2, b: 3 },
          },
        },
      },
      host,
    );
    expect(loads).toBe(1);
    expect(m.scope.total).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("bindings skip an equal write", () => {
  test("a re-run that resolves to the value the node already holds does not set it", async () => {
    const m = await mount(
      { tagName: "div", textContent: "${state.n > 0 ? 'pos' : 'neg'}", state: { n: 1 } },
      host,
    );
    const el = host.firstElementChild as HTMLElement;
    const setter = mock((_v: string) => null);
    let current = "pos";
    Object.defineProperty(el, "textContent", {
      configurable: true,
      get: () => current,
      set: (v: string) => {
        current = v;
        setter(v);
      },
    });
    m.scope.n = 2;
    await tick();
    expect(setter).not.toHaveBeenCalled();
    m.scope.n = -1;
    await tick();
    expect(setter).toHaveBeenCalledWith("neg");
  });
});

describe("Jx() over mount()", () => {
  test("returns the scope, honours a signal, and still seeds the module root media", async () => {
    const scope = await Jx({ tagName: "p", textContent: "${state.n}", state: { n: 7 } }, host);
    expect(host.textContent).toBe("7");
    expect(scope.n).toBe(7);

    const controller = new AbortController();
    controller.abort();
    await Jx({ tagName: "p", textContent: "never" }, host, { signal: controller.signal });
    expect(host.textContent).toBe("7");

    await Jx({ tagName: "div", $media: { "--md": "(min-width: 1px)" } }, host);
    const later = await buildScope({ tagName: "div" });
    expect(later.$media).toEqual({ "--md": "(min-width: 1px)" });
  });
});
