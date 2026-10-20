import "./with-dom.ts";

import { describe, expect, test } from "bun:test";

import {
  INSPECT_CUSTOM,
  describeNode,
  installCompactDomInspect,
  installCompactInspect,
  nodeId,
} from "../src/testing/inspect-dom.ts";
import type { NodePrototype } from "../src/testing/inspect-dom.ts";

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

describe("installing it", () => {
  test("defines the hook once, and a prototype that has one keeps it", () => {
    const prototype: NodePrototype = {};
    installCompactInspect(prototype);
    const installed = prototype[INSPECT_CUSTOM];
    expect(installed).toBeFunction();
    installCompactInspect(prototype);
    expect(prototype[INSPECT_CUSTOM]).toBe(installed);
  });

  test("the preload put it on happy-dom's Node, and installing again keeps it", async () => {
    expect(Object.hasOwn(Node.prototype, INSPECT_CUSTOM)).toBe(true);
    const installed = Object.getOwnPropertyDescriptor(Node.prototype, INSPECT_CUSTOM)?.value;
    await installCompactDomInspect();
    expect(Object.getOwnPropertyDescriptor(Node.prototype, INSPECT_CUSTOM)?.value).toBe(installed);
    const el = document.createElement("section");
    expect(Bun.inspect(el)).toBe(describeNode(el));
  });
});

describe("a failing toBe between two live kit elements", () => {
  test("prints a few lines, naming both, instead of their reactive graphs", async () => {
    /* The fixture is a real failing test; run it the way CI runs a file, from this workspace so
       its preload applies. Without the hook the same failure printed 6.6 million lines (338 MB). */
    const child = Bun.spawn(["bun", "test", "--isolate", "./tests/fixtures/inspect-flood.ts"], {
      cwd: `${import.meta.dir}/..`,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const output = `${out}${err}`;
    expect(code).toBe(1);
    expect(output).toContain("(fail) two live strips are not the same element");
    expect(output.length).toBeLessThan(4000);
    /* Distinct markers, not occurrences: under GitHub Actions the child also repeats the message
       as a one-line `::error` annotation, so the same two elements are printed more than once. */
    const markers = new Set(output.matchAll(/<jx-tabs [^\n%]*?#(\d+)/gu).map((match) => match[1]));
    expect(markers.size).toBe(2);
  }, 30_000);
});
