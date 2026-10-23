import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import { identities } from "@jxsuite/test-support/inspect-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toPosixPath } from "../scripts/lib/posix-path";
import {
  elementAtPoint,
  elementsAtPoint,
  isDisplayContents,
  rectOf,
  rectOfRange,
} from "../src/utils/geometry";

describe("geometry funnel helpers", () => {
  test("rectOf returns the element's bounding rect", () => {
    const el = document.createElement("div");
    const fake = new DOMRect(1, 2, 3, 4);
    el.getBoundingClientRect = () => fake;
    expect(rectOf(el)).toBe(fake);
  });

  test("rectOf measures a display: contents element by what its contents render", () => {
    // A component host styled `display: contents` has no box, so its own rect is 0×0 at the origin
    // And the selection overlay drew nothing. Nested hosts (a CTA wrapping a section) recurse.
    const host = document.createElement("x-cta");
    host.style.display = "contents";
    const inner = document.createElement("x-section");
    inner.style.display = "contents";
    const a = document.createElement("section");
    a.getBoundingClientRect = () => new DOMRect(10, 20, 100, 50);
    const b = document.createElement("div");
    b.getBoundingClientRect = () => new DOMRect(5, 60, 40, 30);
    const empty = document.createElement("span");
    inner.append(a, empty);
    host.append(inner, b, document.createTextNode("text"), document.createComment("c"));
    document.body.append(host);
    const rect = rectOf(host);
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([5, 20, 105, 70]);
    host.remove();
  });

  test("rectOf keeps the empty rect of a contents element whose contents render nothing", () => {
    const host = document.createElement("x-empty");
    host.style.display = "contents";
    host.append(document.createElement("span"));
    document.body.append(host);
    const rect = rectOf(host);
    expect([rect.width, rect.height]).toEqual([0, 0]);
    host.remove();
  });

  test("rectOf does not look past an empty element that has a box of its own", () => {
    const el = document.createElement("div");
    const child = document.createElement("span");
    child.getBoundingClientRect = () => new DOMRect(1, 1, 9, 9);
    el.append(child);
    document.body.append(el);
    expect(rectOf(el).width).toBe(0);
    el.remove();
  });

  test("elementAtPoint delegates to the root's elementFromPoint", () => {
    const marker = document.createElement("span");
    const root = document.implementation.createHTMLDocument();
    const asked: number[][] = [];
    root.elementFromPoint = (x, y) => {
      asked.push([x, y]);
      return marker;
    };
    expect(elementAtPoint(10, 20, root)).toBe(marker);
    expect(asked).toEqual([[10, 20]]);
  });

  test("elementsAtPoint delegates to the root's elementsFromPoint", () => {
    const marker = document.createElement("span");
    const root = document.implementation.createHTMLDocument();
    const asked: number[][] = [];
    root.elementsFromPoint = (x, y) => {
      asked.push([x, y]);
      return [marker];
    };
    expect(identities(elementsAtPoint(10, 20, root))).toEqual(identities([marker]));
    expect(asked).toEqual([[10, 20]]);
  });

  test("isDisplayContents reads the computed display", () => {
    const el = document.createElement("div");
    document.body.append(el);
    expect(isDisplayContents(el)).toBe(false);
    el.style.display = "contents";
    expect(isDisplayContents(el)).toBe(true);
    el.remove();
  });

  test("rectOfRange returns a rect with the DOMRect shape", () => {
    // Happy-dom returns a zero rect for ranges, so assert the SHAPE (keys) — not non-zero values.
    const el = document.createElement("p");
    el.textContent = "hello";
    document.body.append(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rect = rectOfRange(range);
    expect(rect).toHaveProperty("x");
    expect(rect).toHaveProperty("y");
    expect(rect).toHaveProperty("width");
    expect(rect).toHaveProperty("height");
    el.remove();
  });

  test("rectOfRange delegates to the range's getBoundingClientRect", () => {
    const fake = new DOMRect(6, 7, 8, 9);
    const range = document.createRange();
    range.getBoundingClientRect = () => fake;
    expect(rectOfRange(range)).toBe(fake);
  });
});

describe("geometry funnel invariant (regression guard)", () => {
  test("no raw getBoundingClientRect/elementFromPoint/elementsFromPoint outside the funnel", () => {
    const srcDir = join(import.meta.dir, "..", "src");
    const forbidden = /\.(getBoundingClientRect|elementFromPoint|elementsFromPoint)\(/;
    const offenders: string[] = [];
    for (const rel of new Bun.Glob("**/*.ts").scanSync({ cwd: srcDir, dot: false })) {
      const posix = toPosixPath(rel);
      if (posix === "utils/geometry.ts") {
        continue; // The funnel itself is the one allowed home for these DOM reads.
      }
      const lines = readFileSync(join(srcDir, rel), "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        if (forbidden.test(line)) {
          offenders.push(`${posix}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no parent module reads getComputedStyle/contentDocument on a cross-origin iframe handle", () => {
    // Cross-origin guard: when the canvas iframe loads from a loopback origin (Phase 7), the parent
    // Cannot touch its contentDocument or call getComputedStyle on a node inside it without throwing.
    // GetComputedStyle + elementFromPoint live in iframe-BUNDLED modules (insertion-helper / the
    // Geometry funnel run INSIDE the iframe), not in the parent host. The only parent → iframe
    // ContentWindow touch is iframe-host's postMessage (a WRITE). Assert no parent canvas module
    // Reads contentDocument or calls getComputedStyle on an iframe handle.
    const srcDir = join(import.meta.dir, "..", "src");
    const forbidden = /\.(contentDocument|getComputedStyle)\b/;
    // These modules execute inside the iframe realm (their getComputedStyle reads are same-realm).
    const iframeBundled = new Set([
      "canvas/iframe-entry.ts",
      "canvas/iframe-render.ts",
      "canvas/iframe-interaction.ts",
      "canvas/iframe-inline-edit.ts",
      "canvas/iframe-subtree.ts",
      "canvas/iframe-patch.ts",
      "canvas/iframe-keys.ts",
      "canvas/iframe-overlay.ts",
      "canvas/iframe-drop.ts",
      "utils/insertion-helper.ts",
      "utils/geometry.ts",
    ]);
    const offenders: string[] = [];
    for (const rel of new Bun.Glob("canvas/**/*.ts").scanSync({ cwd: srcDir, dot: false })) {
      const posix = toPosixPath(rel);
      if (iframeBundled.has(posix)) {
        continue;
      }
      const lines = readFileSync(join(srcDir, rel), "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        if (forbidden.test(line)) {
          offenders.push(`${posix}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
