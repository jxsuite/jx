import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import { stripEventHandlers } from "../src/utils/strip-events";

describe("stripEventHandlers", () => {
  test("strips on* $ref handlers", () => {
    const node = {
      onclick: { $ref: "#/state/handleClick" },
      tagName: "button",
      textContent: "Click me",
    };
    expect(stripEventHandlers(node)).toEqual({ tagName: "button", textContent: "Click me" });
  });

  test("strips on* Function $prototype handlers", () => {
    const node = {
      onchange: {
        $prototype: "Function",
        body: "state.value = event.target.value",
      },
      tagName: "input",
      type: "text",
    };
    expect(stripEventHandlers(node)).toEqual({ tagName: "input", type: "text" });
  });

  test("preserves non-event on* properties", () => {
    const node = {
      style: { color: "red" },
      tagName: "div",
      textContent: "hello",
    };
    expect(stripEventHandlers(node)).toEqual(node);
  });

  test("recurses into children", () => {
    const node = {
      children: [
        {
          onclick: { $ref: "#/state/fn" },
          tagName: "button",
          textContent: "Click",
        },
      ],
      tagName: "div",
    };
    expect(stripEventHandlers(node)).toEqual({
      children: [{ tagName: "button", textContent: "Click" }],
      tagName: "div",
    });
  });

  test("recurses into cases", () => {
    const node = {
      cases: {
        a: { onclick: { $ref: "#/state/fn" }, tagName: "span" },
        b: { tagName: "p", textContent: "hello" },
      },
      tagName: "div",
    };
    expect(stripEventHandlers(node)).toEqual({
      cases: { a: { tagName: "span" }, b: { tagName: "p", textContent: "hello" } },
      tagName: "div",
    });
  });

  test("handles arrays", () => {
    const nodes = [
      { onclick: { $ref: "#/state/nav" }, tagName: "a" },
      { tagName: "span", textContent: "hi" },
    ];
    expect(stripEventHandlers(nodes)).toEqual([
      { tagName: "a" },
      { tagName: "span", textContent: "hi" },
    ]);
  });

  test("returns primitives unchanged", () => {
    expect(stripEventHandlers(null)).toBe(null);
    expect(stripEventHandlers("string")).toBe("string");
    expect(stripEventHandlers(42)).toBe(42);
  });

  test("drops server-timed state but preserves state, style, attributes, $media", () => {
    const node = {
      $media: { "--md": "(min-width: 768px)" },
      attributes: { "data-x": "1" },
      state: { count: 0, fetchUser: { timing: "server" } },
      style: { color: "red" },
      tagName: "div",
    };
    expect(stripEventHandlers(node)).toEqual({
      $media: { "--md": "(min-width: 768px)" },
      attributes: { "data-x": "1" },
      state: { count: 0 }, // Server-timed entry dropped.
      style: { color: "red" },
      tagName: "div",
    });
  });
});
