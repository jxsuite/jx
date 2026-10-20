import "./with-dom.ts";

import { describe, expect, test } from "bun:test";

import {
  INSPECT_CUSTOM,
  describeNode,
  identities,
  installCompactInspect,
  loadHappyDom,
  nodeId,
} from "../src/inspect-dom.ts";
import type { NodePrototype } from "../src/inspect-dom.ts";

const markerOf = (text: string) => text.match(/ #(\d+)/u)?.[1];

describe("describeNode", () => {
  test("an element is its opening tag, its child count and an identity marker", () => {
    const el = document.createElement("jx-tabs");
    el.setAttribute("part", "workspaces");
    el.append(document.createElement("jx-tab"), document.createElement("jx-tab"));
    document.body.append(el);
    expect(describeNode(el)).toBe(`<jx-tabs part="workspaces">…2 children #${nodeId(el)}`);
    el.remove();
  });

  test("one child is singular, none prints no body, and detached says so", () => {
    const el = document.createElement("div");
    expect(describeNode(el)).toBe(`<div> #${nodeId(el)} (detached)`);
    el.append("text");
    expect(describeNode(el)).toStartWith("<div>…1 child #");
  });

  test("past four attributes the rest are elided, and a long value is cut", () => {
    const el = document.createElement("span");
    for (const name of ["a", "b", "c", "d", "e"]) {
      el.setAttribute(name, name);
    }
    el.setAttribute("a", "x".repeat(60));
    expect(describeNode(el)).toStartWith(`<span a="${"x".repeat(40)}…" b="b" c="c" d="d" …>`);
  });

  test("text and comments print their data; anything else its node name", () => {
    expect(describeNode(document.createTextNode("hi"))).toStartWith('#text "hi" #');
    expect(describeNode(document.createComment("jx-array"))).toStartWith('#comment "jx-array" #');
    expect(describeNode(document)).toStartWith(`#document #${nodeId(document)}`);
    expect(describeNode({ nodeName: "#text", nodeType: 3 })).toStartWith('#text "" #');
    expect(describeNode({ nodeName: "X-Y", nodeType: 1 })).toStartWith("<x-y> #");
  });

  test("two nodes with the same markup print different markers; one node keeps its own", () => {
    const first = document.createElement("p");
    const second = document.createElement("p");
    const marker = markerOf(describeNode(first));
    expect(marker).not.toBe(markerOf(describeNode(second)));
    expect(marker).toBe(String(nodeId(first)));
  });
});

describe("identities", () => {
  test("is equal for the same nodes in the same order, and for nothing else", () => {
    const first = document.createElement("p");
    const second = document.createElement("p");
    const both = identities([first, second]);
    expect(both).toEqual(identities([first, second]));
    expect(both).not.toEqual(identities([second, first]));
    expect(identities([first])).not.toEqual(identities([second]));
    expect(identities(new Set([first, null, undefined]))).toEqual([
      describeNode(first),
      "null",
      "undefined",
    ]);
  });
});

describe("installing it", () => {
  test("defines the hook once, and a prototype that has one keeps it", () => {
    const prototype: NodePrototype = {};
    installCompactInspect(prototype);
    const installed = prototype[INSPECT_CUSTOM];
    expect(installed).toBeFunction();
    installCompactInspect(prototype);
    expect(prototype[INSPECT_CUSTOM]).toBe(installed);
  });

  test("loadHappyDom hands back the Node class the registered window's nodes are built from", async () => {
    const { Node: base } = await loadHappyDom();
    const el = document.createElement("section");
    expect(el instanceof base).toBe(true);
    expect(document.createTextNode("t") instanceof base).toBe(true);
  });

  test("the preload put it on happy-dom's Node, and installing again keeps it", async () => {
    const { Node: base } = await loadHappyDom();
    expect(Object.hasOwn(base.prototype, INSPECT_CUSTOM)).toBe(true);
    const installed = base.prototype[INSPECT_CUSTOM];
    installCompactInspect(base.prototype);
    expect(base.prototype[INSPECT_CUSTOM]).toBe(installed);
    const el = document.createElement("section");
    expect(Bun.inspect(el)).toBe(describeNode(el));
  });
});
