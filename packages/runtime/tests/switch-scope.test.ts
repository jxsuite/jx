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
        children: [{ tagName: "section", $switch: "a" as never, cases: { a: { tagName: "p" } } }],
      },
      host,
      { onNodeCreated: onNode },
    );
    expect(host.querySelector("section")!.childElementCount).toBe(0);
  });
});
