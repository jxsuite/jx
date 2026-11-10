/**
 * Saving a `.jxn` file: what did not change keeps its exact text.
 *
 * The property that matters is the corpus one at the end: any single `doc-ops` operation, on any
 * tracked document, reads back to the new document and touches only the lines of what it changed.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JsonObject, JsonValue, JxDocument, JxMutableNode } from "../types.ts";
import { applyDocOpToDoc } from "../src/doc-ops.ts";
import type { JxDocOp } from "../src/doc-ops.ts";
import { isJsonObject } from "../src/guards.ts";
import { parseJxn, parseJxnWithSpans, reconcileJxn, serializeJxn } from "../src/jxn/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");

const SOURCE = `// head
$id A // about the id

/* before div */
div a=1 /* mid */ b="x" { // after brace
    // about state
    state {
        count 0 // the count
        // about label
        label ""
    }
    // about li
    li x=1 // after li

    // about p
    p "hi"; span
    // end of block
}
// end of file
`;

/** A file's document, as the JSON it is. */
function readObject(source: string): JsonObject {
  const document = parseJxn(source);
  if (!isJsonObject(document)) {
    throw new TypeError("a document was expected");
  }
  return document;
}

/** Parse, change, write back against the source. */
function edited(change: (document: JsonObject) => void, source = SOURCE): string {
  const document = readObject(source);
  change(document);
  return serializeJxn(asDoc(document), source);
}

/** A document's children, which this file's own sources always have. */
function kids(document: JsonObject): JsonValue[] {
  const { children } = document;
  if (!Array.isArray(children)) {
    throw new TypeError("children were expected");
  }
  return children;
}

/** A child element, which this file's own sources always have there. */
function kid(document: JsonObject, index: number): JsonObject {
  const child = kids(document)[index];
  if (!isJsonObject(child)) {
    throw new TypeError("a child element was expected");
  }
  return child;
}

/** A value for the writer, from a literal. */
function asDoc(value: JsonValue): JxDocument {
  // SAFETY: every JxDocument member is optional, and each test decides what it holds.
  return value as JxDocument;
}

/** The source with these lines replaced, which is what a confined change looks like. */
function withLines(replacements: Record<string, string>): string {
  let text = SOURCE;
  for (const [from, to] of Object.entries(replacements)) {
    expect(text).toContain(from);
    text = text.replace(from, to);
  }
  return text;
}

describe("nothing changed", () => {
  test("is the file, byte for byte", () => {
    expect(edited(() => {})).toBe(SOURCE);
  });

  test("however oddly it was spelled", () => {
    const odd = 'div   a = "1"\n';
    expect(edited(() => {}, odd)).toBe(odd);
  });
});

describe("one change touches its own line", () => {
  test("an attribute's value", () => {
    const out = edited((document) => {
      document.attributes = { a: 2, b: "x" };
    });
    expect(out).toBe(withLines({ "div a=1 ": "div a=2 " }));
  });

  test("an attribute added", () => {
    const out = edited((document) => {
      document.attributes = { a: 1, b: "x", c: "new" };
    });
    expect(out).toBe(withLines({ 'b="x" {': 'b="x" c=new {' }));
  });

  test("an attribute removed", () => {
    const out = edited((document) => {
      document.attributes = { a: 1 };
    });
    expect(out).toBe(withLines({ 'div a=1 /* mid */ b="x" {': "div a=1 {" }));
  });

  test("metadata", () => {
    const out = edited((document) => {
      document.$id = "B";
    });
    expect(out).toBe(withLines({ "$id A": "$id B" }));
  });

  test("a value the author kept in a block, though the writer would fold it", () => {
    const out = edited((document) => {
      document.state = { count: 5, label: "" };
    });
    expect(out).toBe(withLines({ "count 0 //": "count 5 //" }));
  });

  test("a child's text", () => {
    const out = edited((document) => {
      kid(document, 1).textContent = "bye";
    });
    expect(out).toBe(withLines({ 'p "hi"': "p bye" }));
  });
});

describe("children", () => {
  test("removing one takes its own comment, and only that", () => {
    const out = edited((document) => {
      kids(document).splice(0, 1);
    });
    expect(out).not.toContain("about li");
    expect(out).not.toContain("after li");
    expect(out).toContain("// about p");
    expect(out).toContain("// after brace");
  });

  test("removing the first of a block keeps what follows the brace", () => {
    const source = "div { // brace\n    // one\n    a\n    // two\n    b\n}\n";
    const out = edited((document) => {
      kids(document).splice(0, 1);
    }, source);
    expect(out).toBe("div { // brace\n    // two\n    b\n}\n");
  });

  test("removing the first of three leaves the other two and their comments", () => {
    const source = "ul {\n    // one\n    li a\n    // two\n    li b\n    // three\n    li c\n}\n";
    const out = edited((document) => {
      kids(document).splice(0, 1);
    }, source);
    expect(out).toBe("ul {\n    // two\n    li b\n    // three\n    li c\n}\n");
  });

  test("a new one goes on its own line at the block's depth", () => {
    const out = edited((document) => {
      kids(document).push({ children: [{ tagName: "a" }], tagName: "footer" });
    });
    expect(out).toContain("span\n    footer {\n        a\n    }\n    // end of block");
  });

  test("a moved one takes its comments with it", () => {
    const source = "ul {\n    // first\n    a\n    // second\n    b\n}\n";
    const out = edited((document) => {
      kids(document).reverse();
    }, source);
    expect(out).toBe("ul {\n    // second\n    b\n    // first\n    a\n}\n");
  });

  test("one that shared a line moves to a line of its own", () => {
    const out = edited((document) => {
      kids(document).reverse();
    });
    expect(parseJxn(out)).toMatchObject({
      children: [{ tagName: "span" }, { tagName: "p" }, { tagName: "li" }],
    });
    expect(out).toContain("// about li");
    expect(out).not.toContain("; ");
  });

  test("one gaining a block keeps what it had", () => {
    const out = edited((document) => {
      kid(document, 0).children = [{ tagName: "b" }];
    });
    expect(out).toContain("li x=1 {\n        b\n    } // after li");
  });

  test("one losing its block keeps its name", () => {
    const out = edited((document) => {
      delete document.children;
    }, "div { // gone\n    a\n}\n");
    expect(out).toBe("div\n");
  });

  test("a block on one line opens up to take a new one", () => {
    const out = edited((document) => {
      kids(document).push({ tagName: "c" });
    }, "div { a; b }\n");
    expect(parseJxn(out)).toEqual({
      children: [{ tagName: "a" }, { tagName: "b" }, { tagName: "c" }],
      tagName: "div",
    });
  });

  test("the last thing in a file with no final newline can be added after", () => {
    const out = edited((document) => {
      document.$id = "A";
    }, "div");
    expect(parseJxn(out)).toEqual({ $id: "A", tagName: "div" });
  });
});

describe("a key the author spelled as a block", () => {
  test("that becomes a plain value keeps its place and its comment", () => {
    const source =
      "div {\n    state {\n        // about rows\n        rows {\n            a 1\n        }\n    }\n}\n";
    const out = edited((document) => {
      document.state = { rows: "none" };
    }, source);
    expect(out).toBe("div {\n    state {\n        // about rows\n        rows none\n    }\n}\n");
  });
});

describe("a node out of its old place", () => {
  test("that shared a line starts one of its own, whatever it followed", () => {
    const out = edited((document) => {
      document.children = [{ tagName: "c" }, { tagName: "b" }, { tagName: "a" }];
    }, "div {\n    a; b\n    c\n}\n");
    expect(readObject(out)).toMatchObject({
      children: [{ tagName: "c" }, { tagName: "b" }, { tagName: "a" }],
    });
    expect(out.split("\n").filter((line) => line.includes(";"))).toEqual([]);
  });
});

describe("a node moved up past one sharing a line", () => {
  test("still gets a line of its own", () => {
    const out = edited((document) => {
      document.children = [{ tagName: "a" }, { tagName: "x" }, { tagName: "b" }];
    }, "div {\n    x\n    a; b\n}\n");
    expect(readObject(out)).toMatchObject({
      children: [{ tagName: "a" }, { tagName: "x" }, { tagName: "b" }],
    });
  });
});

describe("a keyed row", () => {
  test("that changes stays the same row, because its key says so", () => {
    const source = [
      "ul {",
      "    // first",
      '    $array items=(ref)"#/a" key=(ref)"$map/item/id" {',
      "        li",
      "    }",
      "    // second",
      '    $array items=(ref)"#/b" key=(ref)"$map/item/name" {',
      "        li",
      "    }",
      "}",
      "",
    ].join("\n");
    const out = edited((document) => {
      const row = kid(document, 1);
      row.map = { tagName: "dd" };
    }, source);
    expect(out).toBe(
      source.replace(
        '    // second\n    $array items=(ref)"#/b" key=(ref)"$map/item/name" {\n        li',
        '    // second\n    $array items=(ref)"#/b" key=(ref)"$map/item/name" {\n        dd',
      ),
    );
  });
});

describe("what it will not do", () => {
  test("style order is the cascade, so a reorder is never undone to keep a comment", () => {
    const source = "div {\n    style {\n        // first\n        a 1\n        b 2\n    }\n}\n";
    const out = edited((document) => {
      document.style = { b: 2, a: 1 };
    }, source);
    expect(JSON.stringify(readObject(out).style)).toBe('{"b":2,"a":1}');
  });

  test("a style value changing in place keeps the order and the comments", () => {
    const source = "div {\n    style {\n        // first\n        a 1\n        b 2\n    }\n}\n";
    const out = edited((document) => {
      document.style = { a: 3, b: 2 };
    }, source);
    expect(out).toBe("div {\n    style {\n        // first\n        a 3\n        b 2\n    }\n}\n");
  });

  test("a previous file that does not read is replaced", () => {
    const document = asDoc({ tagName: "p" });
    expect(serializeJxn(document, "a\nb")).toBe(serializeJxn(document));
  });

  test("a project file is not a document to merge into", () => {
    const document = asDoc({ tagName: "p" });
    expect(serializeJxn(document, 'project "x"')).toBe(serializeJxn(document));
  });

  test("a merge that would not read back gives the writer's text", () => {
    const next = "div a=2\n";
    const read = (text: string) => {
      if (text.includes("KEPT") && text.includes("a=2")) {
        throw new Error("this grammar refuses the merge");
      }
      const { document, spans } = parseJxnWithSpans(text);
      return { document: isJsonObject(document) ? document : null, spans };
    };
    expect(reconcileJxn("/* KEPT */ div a=1\n", next, read)).toBe(next);
  });

  test("a merge that means something else gives the writer's text", () => {
    const next = "div a=2\n";
    const read = (text: string) => {
      const { document, spans } = parseJxnWithSpans(text);
      const value = text === next ? "canonical" : "merged";
      return { document: isJsonObject(document) ? { ...document, value } : null, spans };
    };
    expect(reconcileJxn("div a=1\n", next, read)).toBe(next);
  });
});

/** A comment above each line that starts something, away from any multi-line string. */
function withComments(canonical: string): string {
  let inString = false;
  const out: string[] = [];
  for (const [index, line] of canonical.split("\n").entries()) {
    const trimmed = line.trim();
    const opensOrCloses = (line.match(/"""/gu)?.length ?? 0) % 2 === 1;
    if (!inString && trimmed !== "" && !trimmed.startsWith("}") && !trimmed.startsWith("/-")) {
      out.push(`${/^\s*/u.exec(line)?.[0] ?? ""}// c${index}`);
    }
    out.push(line);
    inString = opensOrCloses ? !inString : inString;
  }
  return out.join("\n");
}

/** Sorted keys, because only `style`'s order means anything. */
function sortKeys(value: JsonValue | undefined): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  if (!isJsonObject(value)) {
    return value ?? null;
  }
  const keys = Object.keys(value).toSorted();
  return Object.fromEntries(keys.map((key) => [key, sortKeys(value[key])]));
}

/** Every path in a document to an element. */
function elementPaths(node: JsonObject, path: (string | number)[] = []): (string | number)[][] {
  const { children } = node;
  const below = (Array.isArray(children) ? children : []).flatMap((child, index) =>
    isJsonObject(child) && child.tagName !== undefined
      ? elementPaths(child, [...path, "children", index])
      : [],
  );
  return [path, ...below];
}

/** What is at a path. */
function valueAt(node: JsonObject, path: readonly (string | number)[]): JsonValue | undefined {
  let current: JsonValue | undefined = node;
  for (const part of path) {
    if (Array.isArray(current)) {
      current = current[Number(part)];
    } else {
      current = isJsonObject(current) ? current[String(part)] : undefined;
    }
  }
  return current;
}

describe("the corpus", () => {
  const files = execFileSync("git", ["ls-files", "*.json", "*.jxn"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => /(?:^|\/)(?:pages|layouts|components)\//u.test(file))
    .filter((file) => !/\.(?:class|schema)\.(?:json|jxn)$/u.test(file));

  test("any single operation reads back, and leaves the rest of the file alone", () => {
    let random = 20_261_106;
    const next = (limit: number) => {
      random = (random * 1_103_515_245 + 12_345) % 2_147_483_648;
      return random % limit;
    };
    let checked = 0;
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), "utf8");
      const parsed = file.endsWith(".jxn") ? parseJxn(text) : JSON.parse(text);
      if (!isJsonObject(parsed)) {
        continue;
      }
      const source = withComments(serializeJxn(asDoc(parsed)));
      const before = new Set(source.split("\n"));
      const base = readObject(source);
      const paths = elementPaths(base);
      const path = paths[next(paths.length)] ?? [];
      const target = valueAt(base, path);
      const children = isJsonObject(target) ? target.children : null;
      const count = Array.isArray(children) ? children.length : 0;
      const ops: JxDocOp[] = [
        { key: "title", op: "set-key", path, value: `v${checked}` },
        { index: next(count + 1), node: { tagName: "em" }, op: "insert-child", parentPath: path },
      ];
      if (count > 0) {
        ops.push({ index: next(count), op: "remove-child", parentPath: path });
      }
      if (count > 1) {
        ops.push({
          fromIndex: next(count),
          fromParentPath: path,
          op: "move-child",
          toIndex: next(count),
          toParentPath: path,
        });
      }
      for (const op of ops) {
        const changed = structuredClone(base);
        // SAFETY: a document this suite read, and each operation names a path found in it.
        applyDocOpToDoc(changed as JxMutableNode, op);
        const out = serializeJxn(asDoc(changed), source);
        expect(sortKeys(readObject(out))).toEqual(sortKeys(changed));
        const added = out.split("\n").filter((line) => !before.has(line));
        // The line the change is on. A node gaining a block adds the new line and the closing one.
        expect(added.length).toBeLessThanOrEqual(3);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(500);
  }, 120_000);
});
