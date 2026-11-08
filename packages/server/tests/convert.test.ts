/** `jx convert`: both directions, every refusal, and the references repaired. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { convertDocuments, parseConvertArgs, runConvert } from "../src/convert.ts";
import type { ConvertOptions } from "../src/convert.ts";

const OPTIONS: ConvertOptions = { dropComments: false, dryRun: false, to: "jxn" };

let root: string;

function write(path: string, text: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
}

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

beforeEach(() => {
  // Inside the workspace, so the project resolves what it declares the way a real one does.
  root = mkdtempSync(join(import.meta.dir, ".convert-"));
  write("project.json", JSON.stringify({ name: "Fixture" }));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("to .jxn", () => {
  test("the file moves, and what referred to it follows", async () => {
    write("components/x-card.json", JSON.stringify({ tagName: "x-card" }));
    write(
      "pages/index.json",
      JSON.stringify({ $elements: [{ $ref: "../components/x-card.json" }], tagName: "main" }),
    );
    const [row] = await convertDocuments(root, ["components/x-card.json"], OPTIONS);
    expect(row).toMatchObject({ references: 1, problem: null, to: "components/x-card.jxn" });
    expect(existsSync(resolve(root, "components/x-card.json"))).toBe(false);
    expect(read("components/x-card.jxn")).toEndWith("\nx-card\n");
    expect(read("pages/index.json")).toContain("../components/x-card.jxn");
  });

  test("a directory is every document under it", async () => {
    write("pages/a.json", JSON.stringify({ tagName: "main" }));
    write("pages/sub/b.json", JSON.stringify({ tagName: "main" }));
    write("pages/notes.txt", "x");
    write("pages/x.class.json", "{}");
    const rows = await convertDocuments(root, ["pages"], OPTIONS);
    expect(rows.map((row) => row.to).toSorted()).toEqual(["pages/a.jxn", "pages/sub/b.jxn"]);
  });

  test("a dry run changes nothing", async () => {
    write("pages/a.json", JSON.stringify({ tagName: "main" }));
    const [row] = await convertDocuments(root, ["pages/a.json"], { ...OPTIONS, dryRun: true });
    expect(row?.problem).toBeNull();
    expect(existsSync(resolve(root, "pages/a.json"))).toBe(true);
    expect(existsSync(resolve(root, "pages/a.jxn"))).toBe(false);
  });
});

describe("a reference inside a .jxn file", () => {
  test("is repaired, and the file keeps its comments", async () => {
    write("components/x-card.json", JSON.stringify({ tagName: "x-card" }));
    const source = [
      "// keep this one",
      '$elements (ref)"../components/x-card.json"',
      "",
      "main {",
      "    // and this one",
      '    x-card "hi"',
      "}",
      "",
    ].join("\n");
    write("pages/index.jxn", source);
    const [row] = await convertDocuments(root, ["components/x-card.json"], OPTIONS);
    expect(row?.references).toBe(1);
    expect(read("pages/index.jxn")).toBe(source.replace("x-card.json", "x-card.jxn"));
  });
});

describe("to .json", () => {
  const TO_JSON: ConvertOptions = { ...OPTIONS, to: "json" };

  test("it comes back as the same document", async () => {
    write("pages/a.jxn", 'main "hi"\n');
    const [row] = await convertDocuments(root, ["pages/a.jxn"], TO_JSON);
    expect(row?.problem).toBeNull();
    expect(JSON.parse(read("pages/a.json"))).toEqual({ tagName: "main", textContent: "hi" });
  });

  test("comments refuse it, and say how many", async () => {
    write("pages/a.jxn", "// one\n/* two */\nmain\n");
    const [row] = await convertDocuments(root, ["pages/a.jxn"], TO_JSON);
    expect(row?.problem).toContain("2 comment(s)");
    expect(existsSync(resolve(root, "pages/a.jxn"))).toBe(true);
  });

  test("the version marker a .jxn file opens with is not a comment", async () => {
    write("pages/a.jxn", "/- kdl-version 2\nmain\n");
    const [row] = await convertDocuments(root, ["pages/a.jxn"], TO_JSON);
    expect(row?.problem).toBeNull();
  });

  test("--drop-comments converts it anyway", async () => {
    write("pages/a.jxn", "// one\nmain\n");
    const [row] = await convertDocuments(root, ["pages/a.jxn"], { ...TO_JSON, dropComments: true });
    expect(row?.problem).toBeNull();
    expect(existsSync(resolve(root, "pages/a.json"))).toBe(true);
  });
});

describe("the project file", () => {
  const TO_JSON: ConvertOptions = { ...OPTIONS, to: "json" };

  test("becomes project.jxn in place, in canonical form", async () => {
    write(
      "project.json",
      JSON.stringify({ $schema: "./project.schema.json", name: "Fixture", redirects: ["/a"] }),
    );
    const [row] = await convertDocuments(root, ["project.json"], OPTIONS);
    expect(row).toEqual({ from: "project.json", problem: null, references: 0, to: "project.jxn" });
    expect(existsSync(resolve(root, "project.json"))).toBe(false);
    expect(read("project.jxn")).toBe(
      '/- kdl-version 2\n$schema "./project.schema.json"\nproject Fixture\n\nredirects {\n    - "/a"\n}\n',
    );
  });

  test("comes back as the same configuration", async () => {
    write("project.json", JSON.stringify({ defaults: { lang: "en" }, name: "Fixture" }));
    await convertDocuments(root, ["project.json"], OPTIONS);
    const [row] = await convertDocuments(root, ["project.jxn"], TO_JSON);
    expect(row?.problem).toBeNull();
    expect(JSON.parse(read("project.json"))).toEqual({ defaults: { lang: "en" }, name: "Fixture" });
    expect(existsSync(resolve(root, "project.jxn"))).toBe(false);
  });

  test("is found under the root, as the documents are", async () => {
    write("pages/a.json", JSON.stringify({ tagName: "main" }));
    const rows = await convertDocuments(root, ["."], OPTIONS);
    expect(rows.find((row) => row.from === "project.json")?.problem).toBeNull();
    expect(existsSync(resolve(root, "project.jxn"))).toBe(true);
    expect(existsSync(resolve(root, "pages/a.jxn"))).toBe(true);
  });

  test("with comments stays .jxn, unless they may go", async () => {
    rmSync(resolve(root, "project.json"));
    write("project.jxn", "/- kdl-version 2\n// why\nproject Fixture\n");
    const [kept] = await convertDocuments(root, ["project.jxn"], TO_JSON);
    expect(kept?.problem).toContain("1 comment(s)");
    const [dropped] = await convertDocuments(root, ["project.jxn"], {
      ...TO_JSON,
      dropComments: true,
    });
    expect(dropped?.problem).toBeNull();
    expect(JSON.parse(read("project.json"))).toEqual({ name: "Fixture" });
  });

  test("is refused while the folder holds both, naming both, and nothing moves", async () => {
    write("project.jxn", "project Other\n");
    const lines: string[] = [];
    expect(
      await runConvert(["project.json", "--to", "jxn", "--root", root], (line) => lines.push(line)),
    ).toBe(1);
    expect(lines).toEqual([expect.stringContaining("project.jxn and project.json")]);
    expect(read("project.json")).toBe(JSON.stringify({ name: "Fixture" }));
  });

  test("already in the format asked for is left alone", async () => {
    const [row] = await convertDocuments(root, ["project.json"], TO_JSON);
    expect(row?.problem).toBe("already .json");
  });

  test("a file named like one below the root is a document's name, not the project's", async () => {
    write("pages/project.json", JSON.stringify({ tagName: "main" }));
    const [row] = await convertDocuments(root, ["pages/project.json"], OPTIONS);
    expect(row?.problem).toBeNull();
    expect(read("pages/project.jxn")).toEndWith("\nmain\n");
    expect(existsSync(resolve(root, "project.json"))).toBe(true);
  });
});

describe("refusals", () => {
  test.each([
    ["outside the document roots", "data/a.json", "{}", "hold documents"],
    ["not a native format", "pages/a.md", "# hi", "not a native document format"],
    ["a class descriptor", "pages/a.class.json", "{}", "stays JSON"],
    ["already there", "pages/a.jxn", "main", "already .jxn"],
    ["with no extension", "pages/a", "main", "this file is not a native"],
  ])("%s", async (_label, path, text, reason) => {
    write(path, text);
    const [row] = await convertDocuments(root, [path], OPTIONS);
    expect(row?.problem).toContain(reason);
  });

  test("a path that is not there", async () => {
    const [row] = await convertDocuments(root, ["pages/nope.json"], OPTIONS);
    expect(row?.problem).toBe("there is no such file");
  });

  test("a file already at the target", async () => {
    write("pages/a.json", JSON.stringify({ tagName: "main" }));
    write("pages/a.jxn", "main");
    const [row] = await convertDocuments(root, ["pages/a.json"], OPTIONS);
    expect(row?.problem).toContain("a.jxn already exists");
    expect(read("pages/a.json")).toContain("main");
  });

  test.each([
    ["a source", "./pages/blog/"],
    ["a locale source", "./pages/blog/{locale}/"],
    ["a glob", "./pages/blog/*.json"],
  ])("a content collection's file, by %s", async (_label, source) => {
    write(
      "project.json",
      JSON.stringify({ content: { blog: { source }, broken: null, none: {} }, name: "Fixture" }),
    );
    write("pages/blog/a.json", JSON.stringify({ tagName: "main" }));
    const [row] = await convertDocuments(root, ["pages/blog/a.json"], OPTIONS);
    expect(row?.problem).toContain("content collection");
  });

  test("a file that does not read stays where it is, and says why", async () => {
    write("pages/a.json", "{ not json");
    const [row] = await convertDocuments(root, ["pages/a.json"], OPTIONS);
    expect(row?.problem).toContain("a.json");
    expect(read("pages/a.json")).toBe("{ not json");
  });

  test("a file the repair could not read is named, because it may still hold the old path", async () => {
    write("pages/a.json", JSON.stringify({ tagName: "main" }));
    write("pages/b.json", "{ broken");
    const [row] = await convertDocuments(root, ["pages/a.json"], OPTIONS);
    expect(row?.problem).toContain("pages/b.json could not be read");
    expect(existsSync(resolve(root, "pages/a.jxn"))).toBe(true);
  });
});

describe("the command", () => {
  test("it reads its arguments", () => {
    expect(
      parseConvertArgs(["a", "b", "--to", "jxn", "--dry-run", "--drop-comments", "--root", "/x"]),
    ).toEqual({ dropComments: true, dryRun: true, paths: ["a", "b"], root: "/x", to: "jxn" });
  });

  test.each([
    ["no format", ["a"]],
    ["an unknown format", ["a", "--to", "yaml"]],
    ["no paths", ["--to", "jxn"]],
  ])("%s is not enough", (_label, argv) => {
    expect(parseConvertArgs(argv)).toBeNull();
  });

  test("it exits 2 and shows how", async () => {
    const lines: string[] = [];
    expect(await runConvert([], (line) => lines.push(line))).toBe(2);
    expect(lines[0]).toContain("jx convert");
  });

  test("it reports each file, and exits 1 when one was left", async () => {
    write("pages/a.json", JSON.stringify({ tagName: "main" }));
    write("pages/b.jxn", "main");
    const lines: string[] = [];
    const code = await runConvert(["pages", "--to", "jxn", "--root", root], (line) =>
      lines.push(line),
    );
    expect(code).toBe(1);
    expect(lines).toContain("pages/a.json → pages/a.jxn (0 file(s) repaired)");
    expect(lines).toContain("pages/b.jxn: already .jxn");
  });

  test("a dry run says what would happen, and exits 0", async () => {
    write("pages/a.json", JSON.stringify({ tagName: "main" }));
    const lines: string[] = [];
    const code = await runConvert(["pages", "--to", "jxn", "--dry-run", "--root", root], (line) =>
      lines.push(line),
    );
    expect(code).toBe(0);
    expect(lines).toEqual(["pages/a.json would become pages/a.jxn"]);
  });
});
