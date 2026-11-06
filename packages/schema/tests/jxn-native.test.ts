/** `.jxn` as a native format: the built-in registry entry, and the one read every host shares. */
import { describe, expect, test } from "bun:test";
import { FormatEntry, FormatRegistry, JXN_IO } from "../src/format-registry.ts";
import type { FormatHostIO } from "../src/format-registry.ts";
import {
  JxnError,
  countJxnComments,
  isJxnPath,
  isNativeDocumentPath,
  parseJxn,
  parseNativeDocument,
} from "../src/jxn/index.ts";

const IO: FormatHostIO = {
  importModule: () => Promise.resolve({}),
  loadJson: () => Promise.resolve({}),
  resolvePath: (_base, ref) => ref,
};

/** A format class claiming an extension. */
function claiming(extension: string): FormatEntry {
  const classDef = { format: { documentKinds: ["page" as const], extensions: [extension] } };
  return new FormatEntry("X", "x.class.json", classDef, IO);
}

describe("the built-in entry", () => {
  test("every registry answers for .jxn, and lists it among document extensions", () => {
    const registry = new FormatRegistry([]);
    expect(registry.has(".jxn")).toBe(true);
    expect(registry.byExtension("jxn", "parse")?.name).toBe("jxn");
    expect(registry.documentExtensions("page")).toEqual([".jxn"]);
    expect(registry.documentExtensions("component")).toEqual([".jxn"]);
    expect(registry.documentExtensions("content")).toEqual([]);
  });

  test("it is not one of the classes a project chose", () => {
    expect(new FormatRegistry([]).entries).toEqual([]);
  });

  test("no class can claim it", () => {
    expect(() => new FormatRegistry([claiming(".jxn")])).toThrow(`claims ".jxn"`);
  });

  test("it parses and serializes through the paths a format class uses", async () => {
    const entry = new FormatRegistry([]).byExtension(".jxn", "parse");
    if (!entry) {
      throw new Error("no entry");
    }
    expect(await entry.parseDocument('p "hi"')).toEqual({ tagName: "p", textContent: "hi" });
    expect(await entry.call("serialize", { tagName: "p" })).toEndWith("\np\n");
  });

  test("it has no file of its own to read", async () => {
    let message = "";
    try {
      await JXN_IO.loadJson("x");
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("reads no file");
  });
});

describe("native document paths", () => {
  test.each([
    ["a.json", true, false],
    ["a.jxn", true, true],
    ["A.JXN", true, true],
    ["a.md", false, false],
    ["a.jxn.bak", false, false],
    ["jxn", false, false],
  ])("%s", (path, native, notation) => {
    expect(isNativeDocumentPath(path)).toBe(native);
    expect(isJxnPath(path)).toBe(notation);
  });

  test("each spelling reads to the same document", () => {
    const fromJson = parseNativeDocument('{"tagName":"p","textContent":"hi"}', "a.json");
    expect(parseNativeDocument('p "hi"', "a.jxn")).toEqual(fromJson);
  });

  test("an error names the file, the line and the column", () => {
    let caught: unknown;
    try {
      parseNativeDocument('div\nspan\n"x" {', "pages/a.jxn");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JxnError);
    if (caught instanceof JxnError) {
      expect(caught.message).toStartWith("pages/a.jxn: ");
      expect(caught.line).not.toBeNull();
      expect(caught.column).not.toBeNull();
    }
  });

  test("an error with no place keeps having none", () => {
    expect(new JxnError("wrong").inFile("a.jxn").message).toBe("a.jxn: wrong");
    expect(new JxnError("wrong").inFile("a.jxn").line).toBeNull();
  });

  test("something other than a JxnError is left as it is", () => {
    expect(() => parseJxn("div", "a.jxn")).not.toThrow();
  });
});

describe("countJxnComments", () => {
  test.each([
    ["none", 'p "hi"', 0],
    ["a line comment", "// a\np", 1],
    ["a block comment", "/* a */ p", 1],
    ["a slashdash", "/- a\np", 1],
    ["one in a string is not one", 'p "// a /* b */ /- c"', 0],
    ["one in a raw string is not one", 'p #"// a"#', 0],
    ["several", "// a\n/* b */ p /- c=1", 3],
  ])("%s", (_label, text, count) => {
    expect(countJxnComments(text)).toBe(count);
  });
});
