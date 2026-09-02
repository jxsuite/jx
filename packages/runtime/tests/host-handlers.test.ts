// oxlint-disable unicorn/no-thenable -- `then` is the JSON Schema conditional keyword in a structured body (spec §20), not a promise
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, expect, test } from "bun:test";
import { defineElement, mount } from "../src/runtime";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

describe("a definition's root-level event handlers", () => {
  test("listen on the host, with the definition's scope as state and the host as currentTarget", async () => {
    const tag = "hh-row";
    const seen: { current: EventTarget | null; value: unknown }[] = [];
    await defineElement({
      tagName: tag,
      state: {
        value: "copy",
        disabled: false,
        onKeydown: {
          $prototype: "Function",
          body: "seen.push({ current: event.currentTarget, value: state.value })".replace(
            "seen.push",
            "globalThis.__hhSeen.push",
          ),
          parameters: ["event"],
        },
        onClick: {
          $prototype: "Function",
          body: [
            { stopPropagation: true },
            {
              if: { operator: "!", target: { $ref: "#/state/disabled" } },
              then: [{ dispatchEvent: "select", detail: { $ref: "#/state/value" }, bubbles: true }],
            },
          ],
        },
      },
      onclick: { $ref: "#/state/onClick" },
      onkeydown: { $ref: "#/state/onKeydown" },
      children: [{ tagName: "span", textContent: "Copy" }],
    });
    (globalThis as { __hhSeen?: unknown[] }).__hhSeen = seen;
    const outer = document.createElement("div");
    const el = document.createElement(tag) as HTMLElement & { disabled: boolean };
    outer.append(el);
    document.body.append(outer);
    await tick();

    const selected: unknown[] = [];
    outer.addEventListener("select", (e) => {
      selected.push((e as CustomEvent).detail);
    });
    let outerClicks = 0;
    outer.addEventListener("click", () => {
      outerClicks += 1;
    });

    // A click on the rendered child reaches the host's handler and stops there.
    el.querySelector("span")!.click();
    await tick();
    expect(selected).toEqual(["copy"]);
    expect(outerClicks).toBe(0);

    // A disabled row selects nothing; the property write reaches the same scope the handler reads.
    el.disabled = true;
    el.click();
    await tick();
    expect(selected).toEqual(["copy"]);

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.current).toBe(el);
    expect(seen[0]!.value).toBe("copy");
    outer.remove();
  });

  test("a root-level key that is not a handler is not written onto the host", async () => {
    const tag = "hh-plain";
    await defineElement({
      tagName: tag,
      observedAttributes: ["label"],
      state: { label: "x" },
      emits: [{ name: "select" }],
      description: "A row",
      textContent: "${state.label}",
    } as Parameters<typeof defineElement>[0]);
    const el = document.createElement(tag) as HTMLElement & Record<string, unknown>;
    document.body.append(el);
    await tick();
    expect(el.textContent).toBe("x");
    expect("emits" in el).toBe(false);
    expect("observedAttributes" in el).toBe(false);
    el.remove();
  });

  test("a custom element's usage site gets its ordinary properties and handlers", async () => {
    const tag = "hh-usage";
    await defineElement({
      tagName: tag,
      state: {
        value: "",
        onClick: {
          $prototype: "Function",
          body: [{ dispatchEvent: "select", detail: { $ref: "#/state/value" }, bubbles: true }],
        },
      },
      onclick: { $ref: "#/state/onClick" },
      children: [{ tagName: "slot" }],
    });
    const host = document.createElement("div");
    document.body.append(host);
    const picked: unknown[] = [];
    const scope = {
      hide: false,
      pick: (_scope: unknown, event: Event) => {
        picked.push((event as CustomEvent).detail);
      },
    };
    const handle = await mount(
      {
        tagName: "div",
        children: [
          {
            tagName: tag,
            id: "row-1",
            hidden: { $ref: "#/state/hide" },
            $props: { value: "copy" },
            onselect: { $ref: "#/state/pick" },
            children: [{ tagName: "span", textContent: "Copy" }],
          },
        ],
      } as unknown as Parameters<typeof mount>[0],
      host,
      { scope },
    );
    await tick();
    const el = host.querySelector(`#row-1`) as HTMLElement;
    expect(el.localName).toBe(tag);
    expect(el.hidden).toBe(false);
    el.click();
    expect(picked).toEqual(["copy"]);
    handle.dispose();
    host.remove();
  });

  test("a mapped array at a custom element's usage site renders its rows, slotted", async () => {
    const tag = "hh-list";
    await defineElement({
      tagName: tag,
      state: { label: "List" },
      attributes: { role: "menu", "aria-label": "${state.label}" },
      children: [{ tagName: "slot", attributes: { part: "items" } }],
    });
    const host = document.createElement("div");
    document.body.append(host);
    const scope = {
      rows: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    };
    const handle = await mount(
      {
        tagName: "div",
        children: [
          {
            tagName: tag,
            children: [
              {
                $prototype: "Array",
                items: { $ref: "#/state/rows" },
                key: { $ref: "$map/item/id" },
                map: {
                  tagName: "div",
                  attributes: { role: "none", "data-id": "${$map.item.id}" },
                  children: [{ tagName: "span", textContent: "${$map.item.title}" }],
                },
              },
            ],
          },
        ],
      } as Parameters<typeof mount>[0],
      host,
      { scope },
    );
    await tick();
    const rows = [...host.querySelectorAll<HTMLElement>(`${tag} slot > [role="none"]`)];
    expect(rows.map((row) => row.dataset.id)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.textContent)).toEqual(["A", "B"]);
    handle.dispose();
    host.remove();
  });
});
