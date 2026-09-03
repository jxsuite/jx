import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, expect, test } from "bun:test";
import { defineElement, Jx, renderNode } from "../src/runtime";
import { elementCSS } from "./style-text.ts";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

let n = 0;
const uniqueTag = () => `seam-${(n += 1)}`;

/**
 * The four runtime facts the schema-contained styling rule rests on.
 *
 * Each was a live defect rather than a missing capability, and each is the reason a kit element
 * could not do what a CSS class did. They are tested together because they are one seam: a document
 * styles an element instance (R1), a definition can address what a consumer slotted into it (R2),
 * the default display is the weakest thing in the cascade rather than the strongest (R3), and a
 * pointer spelled the way the rest of the schema spells it resolves (R4).
 */
describe("the runtime seam", () => {
  test("R1: a usage site's style survives connection and beats the definition", async () => {
    const tag = uniqueTag();
    await defineElement({
      state: {},
      style: { color: "red", padding: "4px", ":hover": { color: "green", outline: "none" } },
      tagName: tag,
    } as never);
    const host = document.createElement("div");
    document.body.append(host);
    await Jx(
      {
        children: [{ style: { color: "blue", ":hover": { color: "teal" } }, tagName: tag }],
        tagName: "div",
      } as never,
      host,
    );
    await tick();
    const css = elementCSS(host.querySelector(tag) as HTMLElement);
    // The definition's own declarations survive…
    expect(css).toContain("padding: 4px");
    expect(css).toContain("outline: none");
    // …and the call site wins where the two collide, in the base block and in a nested one.
    expect(css).toContain("color: blue");
    expect(css).not.toContain("color: red");
    expect(css).toContain("color: teal");
    expect(css).not.toContain("color: green");
    host.remove();
  });

  test("R2: a slot leaves no node, so a definition's child selector still matches", async () => {
    const tag = uniqueTag();
    await defineElement({
      children: [{ attributes: { part: "body" }, children: [{ tagName: "slot" }], tagName: "div" }],
      state: {},
      style: { '& > [part="body"] > b': { fontWeight: "700" } },
      tagName: tag,
    } as never);
    const el = document.createElement(tag);
    const slotted = document.createElement("b");
    slotted.textContent = "B";
    el.append(slotted);
    document.body.append(el);
    await tick();

    expect(el.querySelector("slot")).toBeNull();
    const body = el.querySelector('[part="body"]') as HTMLElement;
    // A CHILD of the part the definition put the slot in, not a grandchild behind a surviving slot.
    expect(slotted.parentElement).toBe(body);
    expect(el.textContent).toBe("B");
    el.remove();
  });

  test("R2: an unmatched slot unwraps to its own fallback", async () => {
    const tag = uniqueTag();
    await defineElement({
      children: [{ attributes: { name: "aside" }, children: ["none yet"], tagName: "slot" }],
      state: {},
      tagName: tag,
    } as never);
    const el = document.createElement(tag);
    el.append(document.createTextNode("body"));
    document.body.append(el);
    await tick();
    expect(el.querySelector("slot")).toBeNull();
    expect(el.textContent).toContain("none yet");
    el.remove();
  });

  test("R3: the display default is a rule a consumer can beat without !important", async () => {
    const tag = uniqueTag();
    await defineElement({ state: {}, style: { color: "red" }, tagName: tag } as never);
    const el = document.createElement(tag);
    document.body.append(el);
    await tick();
    // Not an inline write, which only `!important` could beat.
    expect(el.style.display).toBe("");
    expect(elementCSS(el)).toBe(`[data-jx="${el.dataset.jx}"] { display: block; color: red }`);
    el.remove();
  });

  test("R3: a display only under a state no longer leaves the element inline at rest", async () => {
    const tag = uniqueTag();
    await defineElement({
      state: {},
      style: { ":hover": { display: "grid" } },
      tagName: tag,
    } as never);
    const el = document.createElement(tag);
    document.body.append(el);
    await tick();
    const css = elementCSS(el);
    expect(css).toContain(`[data-jx="${el.dataset.jx}"] { display: block }`);
    expect(css).toContain("display: grid");
    el.remove();
  });

  test("R3: display revert is the author's opt-out and is respected", async () => {
    const tag = uniqueTag();
    await defineElement({ state: {}, style: { display: "revert" }, tagName: tag } as never);
    const el = document.createElement(tag);
    document.body.append(el);
    await tick();
    expect(elementCSS(el)).toBe(`[data-jx="${el.dataset.jx}"] { display: revert }`);
    el.remove();
  });

  test("R4: a $map pointer spelled #/$map/… resolves", () => {
    const scope = { $map: { item: { rows: ["x", "y"] } } } as never;
    const el = renderNode(
      {
        children: {
          $prototype: "Array",
          items: { $ref: "#/$map/item/rows" },
          map: { tagName: "li", textContent: "${$map.item}" },
        },
        tagName: "ul",
      } as never,
      scope,
    ) as HTMLElement;
    // The bare `$map/…` spelling already worked; `#/` is how every other pointer is written, and
    // A `$map` over it rendered zero rows with no warning.
    expect([...el.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["x", "y"]);
  });

  test("S5: onMount receives the host as well as the scope", async () => {
    /* A sidecar that must reach the element it belongs to had no way to: the runtime handed it
       the scope alone, so elements dispatched an event at themselves purely so a root handler
       could read `currentTarget`. That round trip stood in for a missing parameter. */
    const seen: unknown[] = [];
    const { preloadModule } = await import("../src/runtime");
    preloadModule("seam:/probe.ts", {
      record: (state: unknown, host: unknown) => {
        seen.push({ hasScope: typeof state === "object", host });
      },
    });
    const tag = uniqueTag();
    await defineElement({
      state: { onMount: { $export: "record", $prototype: "Function", $src: "seam:/probe.ts" } },
      tagName: tag,
    } as never);
    const el = document.createElement(tag);
    document.body.append(el);
    await tick();
    expect(seen).toEqual([{ hasScope: true, host: el }]);
    el.remove();
  });
});
