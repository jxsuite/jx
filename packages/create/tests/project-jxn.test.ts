/**
 * New projects are provisioned with `project.jxn` (`site-architecture.md` §2.4): what a scaffold
 * writes, and the version floor that keeps a starter able to build its own project file.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NEW_PROJECT_FILE_NAME, serializeProjectFile } from "@jxsuite/schema/project-file";
import { readProject } from "./_project";

const { generateProject } = await import("../generate");

let dir = "";

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("a new project", () => {
  test("is declared by project.jxn, with a comment saying what extensions are for", async () => {
    dir = mkdtempSync(join(tmpdir(), "jx-create-jxn-"));
    await generateProject(dir, { name: "Bistro" });
    expect(NEW_PROJECT_FILE_NAME).toBe("project.jxn");
    expect(existsSync(join(dir, "project.json"))).toBe(false);
    const text = readFileSync(join(dir, "project.jxn"), "utf8");
    expect(text).toContain("// Extensions add what Jx does not do on its own.");
    expect(text).toMatch(/project Bistro\n/u);
    expect(readProject(dir)).toMatchObject({ extensions: ["@jxsuite/parser"], name: "Bistro" });
  });

  test("keeps that comment through a settings change, as Studio makes one", async () => {
    dir = mkdtempSync(join(tmpdir(), "jx-create-jxn-"));
    await generateProject(dir, { name: "Bistro" });
    const path = join(dir, "project.jxn");
    const text = readFileSync(path, "utf8");
    const saved = serializeProjectFile({ ...readProject(dir), name: "Trattoria" }, text, path);
    expect(saved).toContain("// Extensions add what Jx does not do on its own.");
    expect(saved).toBe(text.replace("project Bistro", "project Trattoria"));
  });

  test("tells GitHub and VS Code that .jxn is KDL, from the first commit", async () => {
    dir = mkdtempSync(join(tmpdir(), "jx-create-jxn-"));
    await generateProject(dir, { name: "Bistro" });
    const read = (path: string): string => readFileSync(join(dir, path), "utf8");
    expect(read(".gitattributes")).toContain("*.jxn linguist-language=KDL");
    expect(JSON.parse(read(".vscode/settings.json"))).toEqual({
      "files.associations": { "*.jxn": "kdl" },
    });
    expect(JSON.parse(read(".vscode/extensions.json"))).toEqual({
      recommendations: ["kdl-org.kdl"],
    });
  });
});

/** The first release of each package that reads a `project.jxn`. */
const READS_PROJECT_JXN = { compiler: "8.4.0", server: "8.5.0" } as const;

/** The lowest version a caret or tilde range admits. */
function floor(range: string): number[] {
  return range
    .replace(/^[\^~]/u, "")
    .split(".")
    .map((part) => Math.trunc(Number(part)));
}

/** Whether version `a` is at least `b`. */
function atLeast(a: number[], b: number[]): boolean {
  for (const [index, part] of b.entries()) {
    const mine = a[index] ?? 0;
    if (mine !== part) {
      return mine > part;
    }
  }
  return true;
}

describe("the version floor", () => {
  const root = resolve(import.meta.dir, "..");
  const sites = resolve(root, "../starters/sites");

  test("the scaffold pins packages that read the project.jxn it writes", () => {
    const pinned: Record<string, string> = JSON.parse(
      readFileSync(join(root, "template-versions.json"), "utf8"),
    );
    for (const [name, first] of Object.entries(READS_PROJECT_JXN)) {
      const range = pinned[name] ?? "0.0.0";
      expect([name, range, atLeast(floor(range), floor(first))]).toEqual([name, range, true]);
    }
  });

  test("a starter declared by project.jxn pins a compiler that reads it", () => {
    const starters = readdirSync(sites).filter((name) =>
      existsSync(join(sites, name, "project.jxn")),
    );
    expect(starters.length).toBeGreaterThan(0);
    for (const name of starters) {
      const manifest = JSON.parse(readFileSync(join(sites, name, "package.json"), "utf8"));
      const range: string =
        manifest.devDependencies?.["@jxsuite/compiler"] ??
        manifest.dependencies?.["@jxsuite/compiler"];
      expect([name, range, atLeast(floor(range), floor(READS_PROJECT_JXN.compiler))]).toEqual([
        name,
        range,
        true,
      ]);
    }
  });

  test("the comparison is a version comparison", () => {
    expect(atLeast(floor("^8.4.0"), floor("8.4.0"))).toBe(true);
    expect(atLeast(floor("^8.10.0"), floor("8.4.0"))).toBe(true);
    expect(atLeast(floor("^8.3.9"), floor("8.4.0"))).toBe(false);
    expect(atLeast(floor("^9.0.0"), floor("8.4.0"))).toBe(true);
  });
});
