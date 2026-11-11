/**
 * Where a stretch of a written module was written in the file (`spec.md` §23.3): the way back a
 * reader takes when it asks a compiler about the modules itself, as Studio's Code view does.
 */
import { describe, expect, test } from "bun:test";
import {
  generateVirtualDocument,
  writtenBefore,
  writtenRange,
} from "../src/jxn/virtual-document.ts";
import type { VirtualSpan, VirtualUnit } from "../src/jxn/virtual-document.ts";

/** A module with the spans given, whose text is never read here. */
function unitOf(...spans: VirtualSpan[]): VirtualUnit {
  return { extension: ".ts", spans, text: "" };
}

/** A span the same on both sides. */
function verbatim(virtualStart: number, originalStart: number, length: number): VirtualSpan {
  return {
    kind: "verbatim",
    originalLength: length,
    originalStart,
    virtualLength: length,
    virtualStart,
  };
}

/** A span that stands for text spelled differently in the file. */
function atom(
  virtualStart: number,
  virtualLength: number,
  originalStart: number,
  originalLength: number,
): VirtualSpan {
  return { kind: "atom", originalLength, originalStart, virtualLength, virtualStart };
}

describe("writtenRange", () => {
  // Module:  ..........[10 verbatim 20)....[30 atom 34)....[40 verbatim 50)
  // File:              [100        110)    [200    208)    [300        310)
  const unit = unitOf(verbatim(10, 100, 10), atom(30, 4, 200, 8), verbatim(40, 300, 10));

  test("a stretch inside a verbatim span is the same characters of the file", () => {
    expect(writtenRange(unit, 12, 3)).toEqual({ end: 105, start: 102 });
    expect(writtenRange(unit, 10, 10)).toEqual({ end: 110, start: 100 });
  });

  test("a stretch that starts in an atom is the whole of what the atom stands for", () => {
    expect(writtenRange(unit, 31, 1)).toEqual({ end: 208, start: 200 });
    expect(writtenRange(unit, 30, 4)).toEqual({ end: 208, start: 200 });
  });

  test("a stretch with no length is read as one character", () => {
    expect(writtenRange(unit, 12, 0)).toEqual({ end: 103, start: 102 });
  });

  test("a stretch that runs on into the module's own text ends with the span", () => {
    expect(writtenRange(unit, 18, 6)).toEqual({ end: 110, start: 108 });
  });

  test("a stretch that runs across spans ends where its last character was written", () => {
    expect(writtenRange(unit, 42, 5)).toEqual({ end: 307, start: 302 });
    expect(writtenRange(unit, 31, 12)).toEqual({ end: 303, start: 200 });
    // Its last character is the module's own, after the atom.
    expect(writtenRange(unit, 15, 22)).toEqual({ end: 208, start: 105 });
  });

  test("the place just past a span is still the author's, and is an empty stretch", () => {
    expect(writtenRange(unit, 20, 0)).toEqual({ end: 110, start: 110 });
    expect(writtenRange(unit, 34, 1)).toEqual({ end: 208, start: 200 });
  });

  test("a stretch that starts in the module's own text is nowhere in the file", () => {
    expect(writtenRange(unit, 0, 5)).toBeNull();
    expect(writtenRange(unit, 25, 2)).toBeNull();
    expect(writtenRange(unit, 60, 1)).toBeNull();
    expect(writtenRange(unitOf(), 0, 1)).toBeNull();
  });

  test("a module written out of the file's order never ends a stretch before it starts", () => {
    const shuffled = unitOf(verbatim(0, 500, 10), verbatim(20, 100, 10));
    expect(writtenRange(shuffled, 5, 20)).toEqual({ end: 510, start: 505 });
  });
});

describe("writtenBefore", () => {
  const unit = unitOf(verbatim(10, 100, 10), atom(30, 4, 200, 8));

  test("a place after a span is the end of what was written there", () => {
    expect(writtenBefore(unit, 22)).toBe(110);
    expect(writtenBefore(unit, 20)).toBe(110);
    expect(writtenBefore(unit, 99)).toBe(208);
  });

  test("a place inside a verbatim span is itself, and inside an atom is the atom's end", () => {
    expect(writtenBefore(unit, 14)).toBe(104);
    expect(writtenBefore(unit, 31)).toBe(208);
  });

  test("a place before anything the author wrote is nowhere", () => {
    expect(writtenBefore(unit, 3)).toBeNull();
    expect(writtenBefore(unitOf(), 3)).toBeNull();
  });
});

describe("in a document", () => {
  const source = [
    "/- kdl-version 2",
    "div {",
    "    state {",
    "        count 0",
    '        (fn)bump "state.nope = 1"',
    "    }",
    "}",
    "",
  ].join("\n");
  const written = generateVirtualDocument(source, { specifier: "./a.jxn" });
  const body = written.supplemental.find((unit) => unit.text.includes("state.nope"));

  test("a name in a body's module is that name in the file", () => {
    expect(body).toBeDefined();
    const at = body?.text.indexOf("nope") ?? -1;
    const range = body ? writtenRange(body, at, 4) : null;
    expect(range).toEqual({ end: source.indexOf("nope") + 4, start: source.indexOf("nope") });
  });

  test("the brace that closes a body's function is drawn at the end of the body", () => {
    const close = body?.text.lastIndexOf("}") ?? -1;
    expect(body ? writtenRange(body, close, 1) : 0).toBeNull();
    expect(body ? writtenBefore(body, close) : null).toBe(source.indexOf('"\n    }'));
  });
});
