import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { reactive } from "@vue/reactivity";
import { defineElement, mount } from "../src/runtime";
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

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

function switchDoc(cases: NonNullable<JxDocument["cases"]>): JxDocument {
  return {
    tagName: "div",
    children: [{ tagName: "section", $switch: { $ref: "#/state/view" }, cases }],
  };
}

describe("$switch — each case owns its effects", () => {
  test("the previous case's effects stop when the discriminant changes", async () => {
    const state = reactive({ view: "a", label: "one" });
    await mount(
      switchDoc({
        a: { tagName: "p", textContent: "${state.label}" },
        b: { tagName: "p", textContent: "B" },
      }),
      host,
      { scope: state },
    );
    const section = host.querySelector("section")!;
    const first = section.firstElementChild!;
    expect(first.textContent).toBe("one");

    state.view = "b";
    await tick();
    expect(section.textContent).toBe("B");
    expect(first.isConnected).toBe(false);

    // The detached case no longer listens: a live effect would have rewritten its text.
    state.label = "two";
    await tick();
    expect(first.textContent).toBe("one");
  });

  test("reads a case makes while rendering do not subscribe the switch", async () => {
    const tag = "sw-item";
    if (!customElements.get(tag)) {
      await defineElement({ tagName: tag, state: { label: "" }, textContent: "${state.label}" });
    }
    const state = reactive({ view: "a", label: "one" });
    const created: string[] = [];
    await mount(
      switchDoc({ a: { tagName: tag, $props: { label: { $ref: "#/state/label" } } } }),
      host,
      {
        scope: state,
        onNodeCreated: (el) => {
          if (el instanceof Element) {
            created.push(el.tagName.toLowerCase());
          }
        },
      },
    );
    await tick();
    const section = host.querySelector("section")!;
    const item = section.firstElementChild!;
    expect(item.textContent).toBe("one");
    const renders = created.filter((t) => t === tag).length;

    state.label = "two";
    await tick();
    expect(section.firstElementChild).toBe(item);
    expect(item.textContent).toBe("two");
    expect(created.filter((t) => t === tag).length).toBe(renders);
  });

  test("a stale external load is discarded once the switch moved to an inline case", async () => {
    let release: (doc: JxDocument) => void = () => null;
    const pending = new Promise<JxDocument>((resolve) => {
      release = resolve;
    });
    const state = reactive({ view: "remote" });
    await mount(
      switchDoc({
        remote: { $ref: "./remote.json" },
        local: { tagName: "p", textContent: "local" },
      }),
      host,
      { scope: state, base: "http://localhost/app/", resolver: () => pending },
    );
    const section = host.querySelector("section")!;
    expect(section.childElementCount).toBe(0);

    state.view = "local";
    await tick();
    expect(section.textContent).toBe("local");

    release({ tagName: "p", textContent: "remote" });
    await tick();
    await tick();
    expect(section.textContent).toBe("local");
  });

  test("an external case renders in its own scope and stops with the switch", async () => {
    const state = reactive({ view: "remote" });
    const remote = reactive({ n: 1 });
    const handle = await mount(switchDoc({ remote: { $ref: "./remote.json" } }), host, {
      scope: state,
      base: "http://localhost/app/",
      resolver: (url) =>
        url === "http://localhost/app/remote.json"
          ? { tagName: "p", textContent: "${state.n}", state: { n: 7 } }
          : undefined,
    });
    await tick();
    await tick();
    const section = host.querySelector("section")!;
    expect(section.textContent).toBe("7");
    handle.dispose();
    remote.n = 2;
    await tick();
    expect(section.textContent).toBe("7");
  });

  test("no matching case leaves the container empty, and a match fills it again", async () => {
    const state = reactive({ view: "none" });
    await mount(switchDoc({ a: { tagName: "p", textContent: "A" } }), host, { scope: state });
    const section = host.querySelector("section")!;
    expect(section.childElementCount).toBe(0);
    state.view = "a";
    await tick();
    expect(section.textContent).toBe("A");
    state.view = "none";
    await tick();
    expect(section.childElementCount).toBe(0);
  });

  test("a switch without a pointer discriminant renders nothing", async () => {
    const onNode = mock(() => null);
    await mount(
      {
        tagName: "div",
        children: [{ tagName: "section", $switch: "a", cases: { a: { tagName: "p" } } }],
      },
      host,
      { onNodeCreated: onNode },
    );
    expect(host.querySelector("section")!.childElementCount).toBe(0);
  });
});

describe("$switch — an unchanged key keeps its case", () => {
  test("re-resolving to the same key leaves the rendered subtree, its effects and its state alone", async () => {
    const mountHost = document.createElement("div");
    document.body.append(mountHost);
    const scope = reactive({ items: [{ id: 1, label: "a", on: true }] });
    const handle = await mount(
      {
        tagName: "div",
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/items" },
            key: { $ref: "$map/item/id" },
            map: {
              tagName: "div",
              children: [
                {
                  tagName: "span",
                  $switch: { $ref: "$map/item/on" },
                  cases: {
                    true: { tagName: "b", textContent: "${$map.item.label}" },
                    false: { tagName: "i", textContent: "off" },
                  },
                },
              ],
            },
          },
        ],
      },
      mountHost,
      { scope },
    );
    await tick();
    const first = mountHost.querySelector("b")!;
    expect(first.textContent).toBe("a");
    first.dataset.kept = "yes";

    // The host rebuilds its projection: an equal item under the same key.
    scope.items = [{ id: 1, label: "b", on: true }];
    await tick();
    const again = mountHost.querySelector("b")!;
    expect(again === first).toBe(true);
    expect(again.dataset.kept).toBe("yes");
    // The bindings inside the case still follow the row.
    expect(again.textContent).toBe("b");

    // A different key is what empties the container.
    scope.items = [{ id: 1, label: "c", on: false }];
    await tick();
    expect(mountHost.querySelector("b")).toBeNull();
    expect(mountHost.querySelector("i")!.textContent).toBe("off");
    handle.dispose();
    mountHost.remove();
  });
});

describe("$switch — an external case is a component boundary", () => {
  const BASE = "http://localhost/app/";
  const hooks = { mount: 0, unmount: 0 };
  const counts = () => ({ ...hooks });
  const hookDoc = (extra: Partial<JxDocument> = {}): JxDocument => ({
    tagName: "p",
    textContent: "case",
    state: {
      onMount: {
        $prototype: "Function",
        body: "window.__caseHooks.mount += 1;",
      },
      onUnmount: {
        $prototype: "Function",
        body: "window.__caseHooks.unmount += 1;",
      },
    },
    ...extra,
  });

  beforeEach(() => {
    hooks.mount = 0;
    hooks.unmount = 0;
    Object.assign(window, { __caseHooks: hooks });
  });

  test("an external case registers its own $elements before it renders", async () => {
    const tag = "sw-case-widget";
    const state = reactive({ view: "remote" });
    await mount(switchDoc({ remote: { $ref: "./remote.json" } }), host, {
      scope: state,
      base: BASE,
      resolver: (url) => {
        if (url === `${BASE}remote.json`) {
          return {
            tagName: "div",
            $elements: [{ $ref: "./widget.json" }],
            children: [{ tagName: tag }],
          };
        }
        return url === `${BASE}widget.json`
          ? { tagName: tag, textContent: "WIDGET-CONTENT" }
          : undefined;
      },
    });
    await tick();
    await tick();
    await tick();
    expect(customElements.get(tag)).toBeDefined();
    expect(host.querySelector("section")!.textContent).toBe("WIDGET-CONTENT");
  });

  test("an external case runs onMount once rendered and onUnmount when the key moves on", async () => {
    const state = reactive({ view: "remote" });
    await mount(
      switchDoc({ remote: { $ref: "./remote.json" }, local: { tagName: "p", textContent: "L" } }),
      host,
      {
        scope: state,
        base: BASE,
        resolver: (url) => (url === `${BASE}remote.json` ? hookDoc() : undefined),
      },
    );
    await tick();
    await tick();
    expect(counts()).toEqual({ mount: 1, unmount: 0 });

    state.view = "local";
    await tick();
    expect(counts()).toEqual({ mount: 1, unmount: 1 });
  });

  test("dispose runs the live case's onUnmount", async () => {
    const state = reactive({ view: "remote" });
    const handle = await mount(switchDoc({ remote: { $ref: "./remote.json" } }), host, {
      scope: state,
      base: BASE,
      resolver: (url) => (url === `${BASE}remote.json` ? hookDoc() : undefined),
    });
    await tick();
    await tick();
    expect(counts()).toEqual({ mount: 1, unmount: 0 });

    handle.dispose();
    expect(counts()).toEqual({ mount: 1, unmount: 1 });
  });

  test("a stale external load registers nothing and runs no onMount", async () => {
    const tag = "sw-case-stale";
    let release: (doc: JxDocument) => void = () => null;
    const pending = new Promise<JxDocument>((resolve) => {
      release = resolve;
    });
    const state = reactive({ view: "remote" });
    await mount(
      switchDoc({ remote: { $ref: "./remote.json" }, local: { tagName: "p", textContent: "L" } }),
      host,
      { scope: state, base: BASE, resolver: () => pending },
    );
    state.view = "local";
    await tick();

    release(hookDoc({ $elements: [{ $ref: "./stale.json" }], children: [{ tagName: tag }] }));
    await tick();
    await tick();
    await tick();
    expect(customElements.get(tag)).toBeUndefined();
    expect(counts()).toEqual({ mount: 0, unmount: 0 });
    expect(host.querySelector("section")!.textContent).toBe("L");
  });

  test("a case whose key moves on while its $elements register renders and mounts nothing", async () => {
    const tag = "sw-case-slow-register";
    let release: (doc: JxDocument) => void = () => null;
    const widget = new Promise<JxDocument>((resolve) => {
      release = resolve;
    });
    const state = reactive({ view: "remote" });
    await mount(
      switchDoc({ remote: { $ref: "./remote.json" }, local: { tagName: "p", textContent: "L" } }),
      host,
      {
        scope: state,
        base: BASE,
        resolver: (url) => {
          if (url === `${BASE}remote.json`) {
            return hookDoc({
              $elements: [{ $ref: "./widget.json" }],
              children: [{ tagName: tag }],
            });
          }
          return url === `${BASE}widget.json` ? widget : undefined;
        },
      },
    );
    await tick();
    // The case document has loaded and is waiting on its element; the key moves on now.
    state.view = "local";
    await tick();
    release({ tagName: tag, textContent: "WIDGET-CONTENT" });
    await tick();
    await tick();
    await tick();
    expect(host.querySelector("section")!.textContent).toBe("L");
    expect(counts()).toEqual({ mount: 0, unmount: 0 });
  });
});
