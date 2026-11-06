/** The compiler's own reads of a `.jxn` document: pages, layouts, components and `jx validate`. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { JxnError } from "@jxsuite/schema/jxn";
import { compileElement } from "../src/targets/compile-element.ts";
import { compile } from "../src/compiler.ts";
import { nodeLayoutLoader } from "../src/site/layout-resolver.ts";
import { discoverPages, readPageDocument } from "../src/site/pages-discovery.ts";
import { writeProjectSchemas } from "../src/site/schema-command.ts";
import { formatProjectTreeLint, validateProjectTree } from "../src/site/validate-command.ts";

const ROOT = mkdtempSync(join(import.meta.dir, ".jxn-hosts-"));

function write(path: string, text: string): string {
  const absolute = resolve(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
  return absolute;
}

afterAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
});

describe("pages", () => {
  test("a .jxn page reads with no registry at all", async () => {
    const path = write("read/a.jxn", 'main "hi"');
    expect(await readPageDocument(path)).toEqual({ tagName: "main", textContent: "hi" });
  });

  test("its error says where, in the file it names", async () => {
    const path = write("read/bad.jxn", "main\nsecond");
    let found: Error | null = null;
    try {
      await readPageDocument(path);
    } catch (error) {
      found = error instanceof Error ? error : null;
    }
    expect(found).toBeInstanceOf(JxnError);
    const message = found?.message ?? "";
    expect(message).toContain("bad.jxn");
    expect(message).toContain("line 2, column 1");
  });

  test("a .jxn page is a route", async () => {
    write("routes/index.jxn", "main");
    write("routes/blog/[slug].jxn", "main");
    write("routes/stray.txt", "main");
    const routes = await discoverPages(resolve(ROOT, "routes"));
    expect(routes.map((route) => route.urlPattern)).toEqual(["/", "/blog/:slug"]);
  });
});

describe("layouts", () => {
  test("a .jxn layout loads", () => {
    write("layouts/base.jxn", "body { slot }");
    expect(nodeLayoutLoader(ROOT)("layouts/base.jxn")).toEqual({
      children: [{ tagName: "slot" }],
      tagName: "body",
    });
  });

  test("a layout that does not read names itself", () => {
    write("layouts/bad.jxn", "a\nb");
    expect(() => nodeLayoutLoader(ROOT)("layouts/bad.jxn")).toThrow("Invalid layout at");
  });
});

describe("components", () => {
  test("a .jxn component compiles, and so does what it depends on", async () => {
    write("elements/x-child.jxn", "x-child");
    const parent = write("elements/x-parent.jxn", '$elements { - "./x-child.jxn"\n}\nx-parent');
    const { files } = await compileElement(parent);
    expect(files.map((file) => file.tagName).toSorted()).toEqual(["x-child", "x-parent"]);
    expect(files.every((file) => file.path.endsWith(".js"))).toBe(true);
    expect(files.find((file) => file.tagName === "x-parent")?.content).toContain("./x-child.js");
  });

  test("a .jxn page compiles", async () => {
    const page = write("compile/a.jxn", 'main "hi"');
    const { html } = await compile(page);
    expect(html).toContain("hi");
  });
});

describe("jx validate", () => {
  const TREE = join(ROOT, "tree");

  beforeAll(async () => {
    write("tree/project.json", JSON.stringify({ name: "Fixture" }));
    write("tree/pages/index.jxn", 'main "hi"');
    await writeProjectSchemas(TREE);
  });

  test("a good .jxn document is checked and passes", async () => {
    const result = await validateProjectTree(TREE);
    expect(result.valid).toBe(true);
    expect(result.lint).toEqual([]);
  });

  test("a .jxn error is a finding with a line and column", async () => {
    write("tree/pages/broken.jxn", "main\nsecond");
    try {
      const result = await validateProjectTree(TREE);
      expect(result.valid).toBe(false);
      const issue = result.issues.find((item) => item.file === "pages/broken.jxn");
      expect(JSON.stringify(issue?.errors)).toContain("line 2, column 1");
    } finally {
      rmSync(resolve(TREE, "pages/broken.jxn"));
    }
  });

  test("a schema error in a .jxn document is reported like a .json one's", async () => {
    write("tree/pages/wrong.jxn", '$media "not an object"\nmain');
    try {
      const result = await validateProjectTree(TREE);
      expect(result.issues.map((item) => item.file)).toContain("pages/wrong.jxn");
    } finally {
      rmSync(resolve(TREE, "pages/wrong.jxn"));
    }
  });

  test("an escape that changes code warns, with where, and does not fail the tree", async () => {
    write("tree/pages/escape.jxn", String.raw`main pattern="\s+"`);
    try {
      const result = await validateProjectTree(TREE);
      expect(result.valid).toBe(true);
      const [line] = formatProjectTreeLint(result);
      expect(line).toContain("pages/escape.jxn: warn: line 1, column 15");
      expect(line).toContain("[notation/escape]");
    } finally {
      rmSync(resolve(TREE, "pages/escape.jxn"));
    }
  });
});
