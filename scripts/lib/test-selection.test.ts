/**
 * Pinned against the REAL graph, like `ci/affected.test.ts` and for the same reason: a fixture
 * would let a rule drift away from the tree it is meant to describe. Counts are asserted as bounds,
 * not figures, so adding a test file does not move these.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decide } from "../ci/affected.ts";
import { FS_ACCESS, buildTestGraph, repoRoot } from "./test-graph.ts";
import { DECLARED_READERS, selectTests } from "./test-selection.ts";
import type { Selection } from "./test-selection.ts";
import { readWorkspaces } from "./workspaces.ts";

const root = repoRoot();
process.chdir(root);
const workspaces = await readWorkspaces();
const graph = buildTestGraph(workspaces, { root, declaredReaders: DECLARED_READERS });

function select(...changed: string[]): Map<string, Selection> {
  return new Map(selectTests(changed, workspaces, graph, root).map((s) => [s.dir, s]));
}

describe("narrowing", () => {
  test("a leaf source file selects the tests that import it, not the workspace", () => {
    const studio = select("packages/studio/src/files/gitignore.ts").get("packages/studio")!;
    expect(studio.mode).toBe("some");
    expect(studio.files).toContain("packages/studio/tests/gitignore.test.ts");
    expect(studio.files.length).toBeLessThan(studio.total);
  });

  test("an upstream file selects, in each dependent, only the tests that load it", () => {
    const picked = select("packages/markup/src/md-html.ts");
    const markup = picked.get("packages/markup")!;
    expect(markup.mode).toBe("some");
    expect(markup.files.length).toBeGreaterThan(0);
    // Studio depends on markup, so the workspace gate runs all of it; most of it never loads this.
    const studio = picked.get("packages/studio")!;
    expect(studio.mode).toBe("some");
    expect(studio.files.length).toBeLessThan(studio.total);
  });

  test("a changed test file selects itself", () => {
    const studio = select("packages/studio/tests/gitignore.test.ts").get("packages/studio")!;
    expect(studio.files).toContain("packages/studio/tests/gitignore.test.ts");
    expect(studio.mode).toBe("some");
  });

  test("a changed test file reaches no workspace downstream of its own", () => {
    // The workspace gate retests every dependent of markup; none of them can load its test file.
    const picked = select("packages/markup/tests/md-html.test.ts");
    expect([...picked.keys()]).toEqual(["packages/markup"]);
  });

  test("every opaque test in a reached workspace is selected, whatever was changed", () => {
    const studio = select("packages/studio/src/files/gitignore.ts").get("packages/studio")!;
    const opaque = graph.tests.get("packages/studio")!.filter((t) => graph.opaque.has(t));
    expect(opaque.length).toBeGreaterThan(0);
    for (const file of opaque) {
      expect(studio.files).toContain(file);
    }
  });

  test("never selects a workspace the workspace gate did not", () => {
    const changed = ["packages/markup/src/md-html.ts", "packages/studio/src/files/gitignore.ts"];
    const allowed = new Set(decide(changed, workspaces).testDirs);
    for (const dir of select(...changed).keys()) {
      expect(allowed.has(dir)).toBe(true);
    }
  });

  test("a type-only module selects nothing", () => {
    expect(select("packages/studio/src/types.ts").size).toBe(0);
  });

  test("a path the workspace gate ignores selects nothing", () => {
    expect(select("docs/start/install.md", "specs/studio.md").size).toBe(0);
  });
});

describe("refusing to narrow", () => {
  const whole = (selection: Selection | undefined): string => {
    expect(selection?.mode).toBe("all");
    expect(selection!.files.length).toBe(selection!.total);
    return selection!.reason;
  };

  test("a GLOBAL path runs every workspace whole", () => {
    const picked = select("bun.lock");
    expect(picked.size).toBe(workspaces.length);
    expect(whole(picked.get("packages/studio"))).toContain("bun.lock");
  });

  test("a workspace's own config runs it, and its dependents, whole", () => {
    const picked = select("packages/markup/package.json");
    expect(whole(picked.get("packages/markup"))).toContain("configures the whole workspace");
    expect(whole(picked.get("packages/studio"))).toContain("configures the whole workspace");
  });

  test("a data file no module imports runs its workspace whole", () => {
    const picked = select("packages/studio/bundle-budget.json");
    expect(whole(picked.get("packages/studio"))).toContain("readers are unknown");
  });

  test("a deleted file runs its workspace whole", () => {
    const picked = select("packages/markup/src/no-such-module.ts");
    expect(whole(picked.get("packages/markup"))).toContain("was deleted");
  });

  test("a declared edge runs the seeded workspace whole, even for an imported code file", () => {
    // `packages/site/src/site-style.ts` → packages/ui is an INVERTED edge in EXTRA_EDGES.
    const picked = select("packages/site/src/site-style.ts");
    expect(whole(picked.get("packages/ui"))).toContain("declared edge");
    expect(picked.get("packages/site")!.mode).toBe("some");
  });
});

describe("DECLARED_READERS", () => {
  test.each(Object.keys(DECLARED_READERS))("%s exists and still reads the filesystem", (path) => {
    const file = join(root, path);
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(FS_ACCESS.test(source)).toBe(true);
  });

  test("the data file format-fixture reads runs studio whole when it changes", () => {
    const picked = select("extensions/parser/src/Markdown.class.json");
    expect(picked.get("packages/studio")?.mode).toBe("all");
  });
});
