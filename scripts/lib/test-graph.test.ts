import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  FS_ACCESS,
  buildTestGraph,
  isTypeOnly,
  preloadsOf,
  repoRoot,
  specifiersOf,
  testFilesOf,
  testsReaching,
} from "./test-graph.ts";
import { readWorkspaces } from "./workspaces.ts";
import type { Workspace } from "./workspaces.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway repository: one workspace per top-level key, files written as given. */
function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "jx-test-graph-"));
  scratch.push(root);
  const dirs = new Set<string>();
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    dirs.add(path.split("/").slice(0, 2).join("/"));
  }
  const workspaces: Workspace[] = [...dirs].toSorted().map((dir) => ({
    dir,
    name: `@fixture/${dir.split("/")[1]}`,
    flag: dir.split("/")[1]!,
    publishable: false,
    version: "0.0.0",
    deps: [],
    devDeps: [],
  }));
  return { root, workspaces };
}

describe("specifiersOf", () => {
  test("reads every import form that names a literal, and drops what TypeScript erases", () => {
    const found = specifiersOf(
      [
        'import a from "./a";',
        'import type { T } from "./erased";',
        'import data from "./data.json";',
        'export { b } from "./b";',
        'const lazy = () => import("./lazy");',
        'const cjs = require("./cjs");',
        "const computed = (p: string) => import(p);",
        "console.log(a, data, lazy, cjs, computed);",
      ].join("\n"),
      "x.ts",
    );
    expect(found.toSorted()).toEqual(["./a", "./b", "./cjs", "./data.json", "./lazy"]);
  });
});

describe("isTypeOnly", () => {
  test("a module of interfaces and aliases is erased; one export of a value is not", () => {
    expect(isTypeOnly("export interface A { x: number }\nexport type B = A;", "types.ts")).toBe(
      true,
    );
    expect(isTypeOnly("export interface A { x: number }\nexport const b = 1;", "types.ts")).toBe(
      false,
    );
    expect(isTypeOnly("", "data.json")).toBe(false);
  });
});

describe("FS_ACCESS", () => {
  test.each([
    'readFileSync("x")',
    "existsSync(path)",
    "Bun.file(path)",
    "Bun.spawn([cmd])",
    "new Bun.Glob(pattern)",
    "new Glob(pattern)",
    "await $`ls`",
    "await import(modulePath)",
    "require(computed)",
  ])("matches %s", (source) => {
    expect(FS_ACCESS.test(source)).toBe(true);
  });

  test.each(['await import("./literal")', 'require("./literal")', "import.meta.dir", "spawned()"])(
    "does not match %s",
    (source) => {
      expect(FS_ACCESS.test(source)).toBe(false);
    },
  );
});

describe("buildTestGraph", () => {
  const { root, workspaces } = repo({
    "packages/a/bunfig.toml": '[test]\npreload = ["./tests/setup.ts"]\n',
    "packages/a/src/leaf.ts": "export const leaf = 1;",
    "packages/a/src/mid.ts": 'import { leaf } from "./leaf";\nexport const mid = leaf;',
    "packages/a/src/lazy.ts": "export const lazy = 1;",
    "packages/a/src/data.json": "{}",
    "packages/a/src/alone.ts": "export const alone = 1;",
    "packages/a/src/gone-importer.ts": 'import { x } from "./deleted";\nexport const y = x;',
    "packages/a/tests/setup.ts": "export {};",
    "packages/a/tests/helper.ts":
      'import { readFileSync } from "node:fs";\nexport const read = () => readFileSync("x");',
    "packages/a/tests/mid.test.ts": 'import { mid } from "../src/mid";\nconsole.log(mid);',
    "packages/a/tests/lazy.test.ts":
      'import data from "../src/data.json";\nconsole.log(data, await import("../src/lazy"));',
    "packages/a/tests/reader.test.ts": 'import { read } from "./helper";\nconsole.log(read);',
    "packages/a/tests/broken.test.ts": 'import { y } from "../src/gone-importer";\nconsole.log(y);',
    "packages/a/node_modules/dep/index.test.ts": "export {};",
    "packages/b/tests/cross.test.ts":
      'import { leaf } from "../../a/src/leaf";\nconsole.log(leaf);',
  });
  const graph = buildTestGraph(workspaces, { root });
  const reach = (...files: string[]) => [...testsReaching(graph, files)].toSorted();

  test("collects the files bun test would, and nothing under node_modules", () => {
    expect(testFilesOf(root, "packages/a")).toEqual([
      "packages/a/tests/broken.test.ts",
      "packages/a/tests/lazy.test.ts",
      "packages/a/tests/mid.test.ts",
      "packages/a/tests/reader.test.ts",
    ]);
  });

  test("a change reaches a test through any number of imports, across workspaces", () => {
    expect(reach("packages/a/src/leaf.ts")).toEqual([
      "packages/a/tests/mid.test.ts",
      "packages/b/tests/cross.test.ts",
    ]);
    expect(reach("packages/a/src/mid.ts")).toEqual(["packages/a/tests/mid.test.ts"]);
  });

  test("a literal import() and a JSON import are edges", () => {
    expect(reach("packages/a/src/lazy.ts")).toEqual(["packages/a/tests/lazy.test.ts"]);
    expect(reach("packages/a/src/data.json")).toEqual(["packages/a/tests/lazy.test.ts"]);
  });

  test("a bunfig preload is an edge from every test in that workspace, and from no other", () => {
    expect(preloadsOf(root, "packages/a")).toEqual(["./tests/setup.ts"]);
    expect(preloadsOf(root, "packages/b")).toEqual([]);
    expect(reach("packages/a/tests/setup.ts")).toEqual(testFilesOf(root, "packages/a"));
  });

  test("a file nothing imports is not a node", () => {
    expect(graph.imports.has("packages/a/src/alone.ts")).toBe(false);
    expect(reach("packages/a/src/alone.ts")).toEqual([]);
  });

  test("a test is opaque when it or a helper outside src/ reads the filesystem", () => {
    expect([...graph.opaque]).toEqual([
      ["packages/a/tests/reader.test.ts", "imports packages/a/tests/helper.ts"],
    ]);
  });

  test("a declared reader does not make its importers opaque", () => {
    const declared = buildTestGraph(workspaces, {
      root,
      declaredReaders: { "packages/a/tests/helper.ts": "reads x" },
    });
    expect(declared.opaque.size).toBe(0);
  });

  test("a relative import that names nothing is recorded against its importer", () => {
    expect([...graph.broken]).toEqual([["packages/a/src/gone-importer.ts", ["./deleted"]]]);
  });
});

describe("the real repository", () => {
  test("every import resolves, and every node is a file on disk", async () => {
    const root = repoRoot();
    const graph = buildTestGraph(await readWorkspaces(root), { root });
    // A broken import here is a broken import in the tree: the graph is only as true as its edges.
    expect([...graph.broken]).toEqual([]);
    const missing: string[] = [];
    for (const node of graph.imports.keys()) {
      if (!(await Bun.file(join(root, node)).exists())) {
        missing.push(node);
      }
    }
    expect(missing).toEqual([]);
    expect(graph.tests.get("packages/studio")!.length).toBeGreaterThan(500);
  });
});
