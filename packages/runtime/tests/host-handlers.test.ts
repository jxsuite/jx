// oxlint-disable unicorn/no-thenable -- `then` is the JSON Schema conditional keyword in a structured body (spec §20), not a promise
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, expect, test } from "bun:test";
import { defineElement, mount } from "../src/runtime";

import type { JxDocument, JxElement, JxRef } from "@jxsuite/schema/types";
import type { JxEventHandler } from "../src/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/**
 * A usage site that binds `hidden` to state. The runtime binds any element property, but
 * {@link JxElement} types `hidden` as a literal boolean, so the binding needs its own view.
 */
interface BoundUsage extends Omit<JxElement, "hidden"> {
  hidden?: JxRef | boolean;
}

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
    Object.assign(globalThis, { __hhSeen: seen });
    const outer = document.createElement("div");
    const el = document.createElement(tag);
    outer.append(el);
    document.body.append(outer);
    await tick();

    const selected: unknown[] = [];
    outer.addEventListener("select", (e) => {
      if (e instanceof CustomEvent) {
        selected.push(e.detail);
      }
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
    // Assigned through [[Set]] exactly as `el.disabled = true` would, so the host's accessor runs.
    Object.assign(el, { disabled: true });
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
    });
    const el = document.createElement(tag);
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
    const pick: JxEventHandler = (_scope, event) => {
      if (event instanceof CustomEvent) {
        picked.push(event.detail);
      }
    };
    const scope = { hide: false, pick };
    const usage: BoundUsage = {
      tagName: tag,
      id: "row-1",
      hidden: { $ref: "#/state/hide" },
      $props: { value: "copy" },
      onselect: { $ref: "#/state/pick" },
      children: [{ tagName: "span", textContent: "Copy" }],
    };
    /* SAFETY: `usage` differs from a JxElement only in binding `hidden` to state, which the runtime
       resolves like any other bound property; the `el.hidden` assertion below checks that it did. */
    const doc = { tagName: "div", children: [usage] } as JxDocument;
    const handle = await mount(doc, host, { scope });
    await tick();
    const el = host.querySelector(`#row-1`);
    if (!(el instanceof HTMLElement)) {
      throw new TypeError("the usage site did not render #row-1");
    }
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
      },
      host,
      { scope },
    );
    await tick();
    // The slot unwrapped, so the rows are direct children of the host element rather than of a
    // Surviving `<slot>` — which is what lets a definition address them with `& > …`.
    expect(host.querySelector("slot")).toBeNull();
    const rows = [...host.querySelectorAll<HTMLElement>(`${tag} > [role="none"]`)];
    expect(rows.map((row) => row.dataset.id)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.textContent)).toEqual(["A", "B"]);
    handle.dispose();
    host.remove();
  });
});
