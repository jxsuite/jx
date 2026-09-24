/**
 * `src/json-layout.ts` — the layout-preserving JSON serializer behind every save (issue 308).
 *
 * Moved from Studio so any host can write a document the way the editor does: a Durable Object
 * applying an agent's edit, a headless tool writing a file. These are the unit cases that pin the
 * rules an edit exercises; Studio keeps the byte-identity oracle over the repository's own
 * formatted documents and the tab-level cases, since those read Studio's files.
 */
import { describe, expect, test } from "bun:test";
import {
  JSON_PRINT_WIDTH,
  deriveJsonLayout,
  displayWidth,
  parseJsonDocument,
  serializeJson,
} from "../src/json-layout.ts";
import type { JsonLayout } from "../src/json-layout.ts";

/** A layout with nothing recorded — what a brand-new document has. */
function empty(): JsonLayout {
  return { blankAfter: new Set(), escaped: new Map(), inline: new Map() };
}

/** Derive, serialize, and hand back the text — the round trip a save performs. */
function roundTrip(text: string, edit?: (doc: Record<string, unknown>) => void): string {
  const { document, layout } = parseJsonDocument(text);
  edit?.(document);
  return serializeJson(document, layout);
}

describe("deriveJsonLayout", () => {
  test("records whether each object's brace and first key share a line, by pointer", () => {
    const layout = deriveJsonLayout(
      '{\n  "a": { "b": 1 },\n  "c": {\n    "d": { "e": 2 }\n  },\n  "f": [{ "g": 3 }, {\n "h": 4 }]\n}\n',
    );
    expect(layout.inline.get("")).toBe(false);
    expect(layout.inline.get("/a")).toBe(true);
    expect(layout.inline.get("/c")).toBe(false);
    expect(layout.inline.get("/c/d")).toBe(true);
    expect(layout.inline.get("/f/0")).toBe(true);
    expect(layout.inline.get("/f/1")).toBe(false);
  });

  test("an empty object or array gets no entry, and arrays are never recorded", () => {
    const layout = deriveJsonLayout('{\n  "a": {},\n  "b": [\n    1\n  ],\n  "c": [ ]\n}\n');
    expect(layout.inline.has("/a")).toBe(false);
    expect(layout.inline.has("/b")).toBe(false);
    expect(layout.inline.has("/c")).toBe(false);
    expect([...layout.inline.keys()]).toEqual([""]);
  });

  test("a root written on one line is recorded inline", () => {
    expect(deriveJsonLayout('{"a": 1}').inline.get("")).toBe(true);
  });

  test("keys are decoded and pointer-escaped, so `/` and `~` in a key still address it", () => {
    const layout = deriveJsonLayout(
      String.raw`{ "a/b": { "x": 1 }, "c~d": { "y": 2 }, "e\u0041": {"z":3} }`,
    );
    expect(layout.inline.get("/a~1b")).toBe(true);
    expect(layout.inline.get("/c~0d")).toBe(true);
    expect(layout.inline.get("/eA")).toBe(true);
  });

  test("a blank line between members is recorded on the member before it", () => {
    const layout = deriveJsonLayout('{\n\n  "a": 1,\n\n\n  "b": [1,\n\n 2, 3],\n  "c": 3\n\n}\n');
    expect(layout.blankAfter.has("/a")).toBe(true);
    expect(layout.blankAfter.has("/b/0")).toBe(true);
    // Not before the first member, not after the last, not between the others.
    expect(layout.blankAfter.has("")).toBe(false);
    expect(layout.blankAfter.has("/b")).toBe(false);
    expect(layout.blankAfter.has("/c")).toBe(false);
    expect(layout.blankAfter.has("/b/1")).toBe(false);
  });

  test("a string's escaped non-ASCII code units are recorded; ASCII escapes are not", () => {
    const layout = deriveJsonLayout(
      // Interpolated, because Bun's transpiler re-spells a non-ASCII character inside a raw
      // Template as `\u00E9` — which is precisely the spelling this case must NOT contain.
      String.raw`{ "a": "x \u2014 y \u00e9", "b": "\n\u0041 \"q\"", "c": "${"é"}" }`,
    );
    expect(layout.escaped.get("/a")).toEqual(new Set([8212, 233]));
    expect(layout.escaped.has("/b")).toBe(false);
    expect(layout.escaped.has("/c")).toBe(false);
  });

  test("scalars of every kind are stepped over", () => {
    const layout = deriveJsonLayout(
      '{ "n": -1.5e3, "t": true, "f": false, "z": null, "s": "a,]}", "o": { "k": [true, null] } }',
    );
    expect(layout.inline.get("/o")).toBe(true);
    expect(layout.escaped.size).toBe(0);
  });

  test("text that ends inside a container is scanned to its end and not beyond", () => {
    /*
     * The scanner is only ever handed text `JSON.parse` accepted, so an unterminated container is
     * not a shape it meets in Studio; the loops still stop at the end of the text rather than read
     * past it, and what was recorded before the text ran out is kept. This is the guard, exercised.
     */
    expect(deriveJsonLayout('{"a": {"b": 1}').inline.get("/a")).toBe(true);
    expect(deriveJsonLayout("[1, [2, 3]").inline.size).toBe(0);
  });

  test("parseJsonDocument hands back the document with its layout", () => {
    const { document, layout } = parseJsonDocument(
      '{ "tagName": "div", "attributes": { "part": "x" } }',
    );
    expect(document).toEqual({ attributes: { part: "x" }, tagName: "div" });
    expect(layout.inline.get("/attributes")).toBe(true);
  });
});

// ─── serializeJson: what an edit does to the layout ───────────────────────────

describe("serializeJson honours the recorded layout through an edit", () => {
  const SOURCE =
    '{\n  "tagName": "div",\n  "attributes": { "part": "bar" },\n  "style": {\n    "display": "flex"\n  },\n  "children": ["a", "b"]\n}\n';

  test("an unchanged document is the file", () => {
    expect(roundTrip(SOURCE)).toBe(SOURCE);
  });

  test("an edited value inside an inline object stays inline", () => {
    const out = roundTrip(SOURCE, (doc) => {
      (doc.attributes as Record<string, unknown>).part = "baz";
    });
    expect(out).toBe(SOURCE.replace('"part": "bar"', '"part": "baz"'));
  });

  test("an inline object grown past the width expands", () => {
    const out = roundTrip(SOURCE, (doc) => {
      (doc.attributes as Record<string, unknown>).part = "b".repeat(120);
    });
    expect(out).toContain(`"attributes": {\n    "part": "${"b".repeat(120)}"\n  },`);
  });

  test("a new scalar key in an inline object stays inline while it fits", () => {
    const out = roundTrip(SOURCE, (doc) => {
      (doc.attributes as Record<string, unknown>).title = "t";
    });
    expect(out).toContain('"attributes": { "part": "bar", "title": "t" },');
  });

  test("a new object inside an inline object takes its parent's answer and stays inline", () => {
    const out = roundTrip(SOURCE, (doc) => {
      (doc.attributes as Record<string, unknown>).disabled = { $ref: "#/state/off" };
    });
    expect(out).toContain(
      '"attributes": { "part": "bar", "disabled": { "$ref": "#/state/off" } },',
    );
  });

  test("a new object at an expanded level expands, and a new array is laid by fit", () => {
    const out = roundTrip(SOURCE, (doc) => {
      doc.state = { count: 0 };
      doc.classes = ["x", "y"];
    });
    expect(out).toContain('  "state": {\n    "count": 0\n  },\n');
    expect(out).toContain('  "classes": ["x", "y"]\n');
  });

  test("a removed key leaves its siblings' layout alone, and an emptied object is `{}`", () => {
    const out = roundTrip(SOURCE, (doc) => {
      delete (doc.style as Record<string, unknown>).display;
      delete doc.children;
    });
    expect(out).toBe(
      '{\n  "tagName": "div",\n  "attributes": { "part": "bar" },\n  "style": {}\n}\n',
    );
  });

  test("an expanded object stays expanded however short it is", () => {
    expect(roundTrip(SOURCE)).toContain('"style": {\n    "display": "flex"\n  }');
  });

  test("a document with no layout expands every object and lays every array by fit", () => {
    const out = serializeJson(
      { attributes: { part: "bar" }, children: ["a", { tagName: "b" }], tagName: "div" },
      null,
    );
    expect(out).toBe(
      '{\n  "attributes": {\n    "part": "bar"\n  },\n  "children": [\n    "a",\n    {\n      "tagName": "b"\n    }\n  ],\n  "tagName": "div"\n}\n',
    );
  });

  test("an inline root stays on one line", () => {
    expect(roundTrip('{ "a": 1, "b": [1, 2] }\n')).toBe('{ "a": 1, "b": [1, 2] }\n');
  });
});

// ─── serializeJson: the formatter's own rules ─────────────────────────────────

describe("serializeJson lays out like the formatter", () => {
  test("the output ends with exactly one newline", () => {
    expect(serializeJson({}, null)).toBe("{}\n");
    expect(serializeJson([], null)).toBe("[]\n");
    expect(serializeJson({ a: 1 }, null).endsWith("}\n")).toBe(true);
    expect(serializeJson({ a: 1 }, null).endsWith("\n\n")).toBe(false);
  });

  test("a container fits at the print width and breaks one column past it, comma included", () => {
    // `  "k": { "v": "…" },` — the comma is part of the line the formatter measures.
    const width = (n: number) => "v".repeat(n - '  "k": { "v": "" },'.length);
    const layout = empty();
    layout.inline.set("/k", true);
    const at = (n: number) => serializeJson({ k: { v: width(n) }, z: 1 }, layout);
    expect(at(JSON_PRINT_WIDTH)).toContain(`  "k": { "v": "${width(JSON_PRINT_WIDTH)}" },\n`);
    expect(at(JSON_PRINT_WIDTH + 1)).toContain(
      `  "k": {\n    "v": "${width(JSON_PRINT_WIDTH + 1)}"\n  },\n`,
    );
    // Without a following comma the same content has one more column to spend.
    const last = serializeJson({ z: 1, k: { v: `${width(JSON_PRINT_WIDTH + 1)}` } }, layout);
    expect(last).toContain(`  "k": { "v": "${width(JSON_PRINT_WIDTH + 1)}" }\n`);
  });

  /*
   * THE WIDTH IS DISPLAY WIDTH. Every case here was run through oxfmt 0.67 first; the serializer is
   * held to what it did. `"漢"` is one UTF-16 unit and two columns, so measured by length a line of
   * CJK sat "inline" at 62 units and 106 columns and the formatter broke it open on its next run.
   */
  test("the width is counted in columns, not UTF-16 units", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("漢")).toBe(2); // CJK
    expect(displayWidth("Ａ")).toBe(2); // Fullwidth Latin
    expect(displayWidth("가")).toBe(2); // Hangul
    expect(displayWidth("😀")).toBe(2); // An astral emoji: two units, two columns
    expect(displayWidth("⌚")).toBe(2); // A BMP emoji with emoji presentation
    expect(displayWidth("☺")).toBe(1); // Text presentation
    expect(displayWidth("±")).toBe(1); // East Asian Ambiguous is narrow
    expect(displayWidth("e\u0301")).toBe(1); // A combining mark takes no column
    expect(displayWidth("a\u200Db")).toBe(2); // Nor does a zero-width joiner
    expect(displayWidth("\u{1D400}")).toBe(1); // An astral letter is one column
  });

  test("a container of wide characters fits at the print width in columns, and breaks past it", () => {
    const layout = empty();
    layout.inline.set("/k", true);
    // `  "k": { "v": "" }` is 18 columns; 41 CJK characters are 82 more — 100 exactly.
    const at = (s: string) => serializeJson({ k: { v: s } }, layout);
    expect(at("漢".repeat(41))).toBe(`{\n  "k": { "v": "${"漢".repeat(41)}" }\n}\n`);
    expect(at(`${"漢".repeat(41)}a`)).toBe(`{\n  "k": {\n    "v": "${"漢".repeat(41)}a"\n  }\n}\n`);
    // 44 CJK is 62 units and 106 columns — the reviewer's probe, which oxfmt expands.
    expect(at("漢".repeat(44))).toContain('"k": {\n');
    // A key is measured the same way: 41 CJK in the key with `{ "v": "x" }` after it is 100.
    const key = (k: string) =>
      serializeJson({ [k]: { v: "x" } }, { ...empty(), inline: new Map([[`/${k}`, true]]) });
    expect(key("漢".repeat(41))).toBe(`{\n  "${"漢".repeat(41)}": { "v": "x" }\n}\n`);
    expect(key("漢".repeat(42))).toContain(`": {\n    "v": "x"\n  }\n`);
    // Combining marks cost nothing: 83 of `e\u0301` is 166 units and 83 columns.
    expect(at("e\u0301".repeat(82))).toContain(`"k": { "v": "${"e\u0301".repeat(82)}" }\n`);
    expect(at("e\u0301".repeat(83))).toContain('"k": {\n');
  });

  test("a scalar never breaks, however long", () => {
    const long = "s".repeat(300);
    expect(serializeJson({ s: long }, null)).toBe(`{\n  "s": "${long}"\n}\n`);
    expect(serializeJson([long], null)).toBe(`[\n  "${long}"\n]\n`);
  });

  test("an array of two or more objects with more than one key each always expands", () => {
    expect(
      serializeJson(
        {
          a: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
        null,
      ),
    ).toBe(
      '{\n  "a": [\n    {\n      "x": 1,\n      "y": 2\n    },\n    {\n      "x": 3,\n      "y": 4\n    }\n  ]\n}\n',
    );
    // With their objects recorded inline, one object per line.
    const layout = empty();
    layout.inline.set("/a/0", true).set("/a/1", true);
    expect(
      serializeJson(
        {
          a: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
        layout,
      ),
    ).toBe('{\n  "a": [\n    { "x": 1, "y": 2 },\n    { "x": 3, "y": 4 }\n  ]\n}\n');
  });

  test("an array of arrays with more than one element each always expands", () => {
    expect(
      serializeJson(
        [
          [1, 2],
          [3, 4],
        ],
        null,
      ),
    ).toBe("[\n  [1, 2],\n  [3, 4]\n]\n");
  });

  test("the forced-open rule needs every element to qualify", () => {
    const layout = empty();
    for (const p of ["/a/0", "/a/1", "/b/0", "/b/1", "/c/0"]) {
      layout.inline.set(p, true);
    }
    // Single-key objects, a mixture of kinds, a one-element inner array, one element: all inline.
    expect(serializeJson({ a: [{ x: 1 }, { y: 2 }] }, layout)).toContain(
      '"a": [{ "x": 1 }, { "y": 2 }]',
    );
    expect(serializeJson({ b: [{ x: 1, z: 3 }, [1, 2]] }, layout)).toContain(
      '"b": [{ "x": 1, "z": 3 }, [1, 2]]',
    );
    expect(serializeJson({ c: [[1], [3, 4]] }, layout)).toContain('"c": [[1], [3, 4]]');
    expect(
      serializeJson({ d: [{ x: 1, z: 3 }] }, { ...layout, inline: new Map([["/d/0", true]]) }),
    ).toContain('"d": [{ "x": 1, "z": 3 }]');
    expect(serializeJson({ e: [1, "a"] }, layout)).toContain('"e": [1, "a"]');
  });

  test("an array of numbers fills its lines rather than stacking them", () => {
    const numbers = Array.from({ length: 50 }, (_, i) => i + 1);
    expect(serializeJson({ k: numbers }, null)).toBe(
      '{\n  "k": [\n    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,\n    27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50\n  ]\n}\n',
    );
    // Short enough to fit stays on one line; a lone number is not a run.
    expect(serializeJson({ n: [1, -2, 3.5] }, null)).toBe('{\n  "n": [1, -2, 3.5]\n}\n');
    expect(serializeJson({ n: ["x".repeat(120), 1] }, null)).toContain('[\n    "');
  });

  test("a blank line inside a run of numbers ends the filled line and stays", () => {
    const text = '{\n  "b": [\n    1,\n\n    2, 3\n  ]\n}\n';
    expect(roundTrip(text)).toBe(text);
  });

  test("a blank line between members is kept, one at most, and never against a bracket", () => {
    const text = '{\n  "a": 1,\n\n  "b": [\n    1,\n\n    2\n  ],\n  "c": 3\n}\n';
    expect(roundTrip(text)).toBe(text);
    const messy = '{\n\n  "a": 1,\n\n\n\n  "b": 2\n\n}\n';
    expect(roundTrip(messy)).toBe('{\n  "a": 1,\n\n  "b": 2\n}\n');
  });

  test("a blank line forces its container open, and the break propagates outward", () => {
    // `c` was written inline; the blank line inside it is a break the formatter keeps.
    const out = roundTrip('{ "c": { "d": 1,\n\n "e": 2 } }\n');
    expect(out).toBe('{\n  "c": {\n    "d": 1,\n\n    "e": 2\n  }\n}\n');
  });

  test("an expanded object inside an inline one breaks the inline one too", () => {
    const out = roundTrip(
      '{ "outer": { "inner": {\n "x": 1 }, "y": 2 }, "z": [{ "a": {\n "b": 1 } }] }\n',
    );
    expect(out).toBe(
      '{\n  "outer": {\n    "inner": {\n      "x": 1\n    },\n    "y": 2\n  },\n  "z": [\n    {\n      "a": {\n        "b": 1\n      }\n    }\n  ]\n}\n',
    );
  });

  test("a string re-escapes exactly the code units its source escaped, and no others", () => {
    const text = '{\n  "a": "x \\u2014 y",\n  "b": "\\u2014 Julio Cortázar",\n  "c": "é"\n}\n';
    expect(roundTrip(text)).toBe(text);
    // A changed value at the same pointer keeps the spelling; a fresh string is literal.
    const out = roundTrip(text, (doc) => {
      doc.a = "z — w";
      doc.d = "—";
    });
    expect(out).toContain(String.raw`"a": "z \u2014 w"`);
    expect(out).toContain('"d": "—"');
  });

  test("keys and strings are `JSON.stringify`'s: quotes and control characters escaped", () => {
    expect(serializeJson({ 'q"k': 'a"b\n' }, null)).toBe('{\n  "q\\"k": "a\\"b\\n"\n}\n');
  });

  test("what `JSON.stringify` drops is dropped: undefined and functions", () => {
    const out = serializeJson({ a: undefined, b: () => 1, c: [undefined, 1], d: 1 }, null);
    expect(out).toBe('{\n  "c": [null, 1],\n  "d": 1\n}\n');
  });

  test("the print width is a parameter, so a narrower target breaks sooner", () => {
    const layout = empty();
    layout.inline.set("/a", true);
    expect(serializeJson({ a: { b: "12345678" } }, layout, 30)).toBe(
      '{\n  "a": { "b": "12345678" }\n}\n',
    );
    expect(serializeJson({ a: { b: "12345678" } }, layout, 20)).toBe(
      '{\n  "a": {\n    "b": "12345678"\n  }\n}\n',
    );
  });
});
