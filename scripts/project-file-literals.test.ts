/**
 * Nothing spells the project file's name but the module that owns it.
 *
 * Sixty-one production lines did, and every one of them was a place a change to what a project file
 * is had to reach. Nothing stopped a sixty-second, which is what this is. A message to a person may
 * name the file: this looks for the name as a value, on its own or ending a path.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

/**
 * The files allowed the literal, each for a reason. This list only shrinks.
 *
 * - The module itself.
 * - The kit's theme imports its own project file statically at build time, and the kit stays JSON.
 */
const ALLOWED = new Set(["packages/schema/src/project-file.ts", "packages/ui/src/theme.ts"]);

/** The name as a value: alone in double quotes, or ending a path built in a template or a string. */
const LITERAL = /"(?:[^"\n]*\/)?project\.json"|`[^`\n]*\/project\.json`/u;

/** Every TypeScript file under a directory, tests aside. */
function sources(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (name === "node_modules" || name === "tests" || name === "dist") {
      continue;
    }
    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      found.push(path);
    }
  }
  return found;
}

/** The workspaces that ship code, including `packages/create`, which keeps its at its root. */
function shippedSources(): string[] {
  const found: string[] = [];
  for (const parent of ["packages", "extensions"]) {
    for (const workspace of readdirSync(join(ROOT, parent))) {
      const dir = join(ROOT, parent, workspace);
      if (!statSync(dir).isDirectory()) {
        continue;
      }
      const src = join(dir, "src");
      if (readdirSync(dir).includes("src")) {
        found.push(...sources(src));
      }
      if (workspace === "create") {
        found.push(
          ...readdirSync(dir)
            .filter((n) => n.endsWith(".ts"))
            .map((n) => join(dir, n)),
        );
      }
    }
  }
  return found;
}

/** The lines of a file that spell the name as a value, comments aside. */
function literalLines(text: string): string[] {
  return text.split("\n").filter((line) => {
    const code = line.trim();
    const isComment = code.startsWith("*") || code.startsWith("//") || code.startsWith("/*");
    return !isComment && LITERAL.test(code);
  });
}

describe("the project file's name", () => {
  test("appears as a value only where it is allowed to", () => {
    const offenders = shippedSources()
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"))
      .filter((path) => !ALLOWED.has(path))
      .flatMap((path) =>
        literalLines(readFileSync(join(ROOT, path), "utf8")).map(
          (line) => `${path}: ${line.trim()}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  test("every allowed file still needs to be", () => {
    for (const path of ALLOWED) {
      const lines = literalLines(readFileSync(join(ROOT, path), "utf8"));
      expect([path, lines.length > 0]).toEqual([path, true]);
    }
  });

  test("the pattern sees what it is for, and not a sentence about the file", () => {
    expect(literalLines('  const a = "project.json";')).toHaveLength(1);
    expect(literalLines("  const a = `${root}/project.json`;")).toHaveLength(1);
    expect(literalLines('  throw new Error("Invalid project.json: bad");')).toEqual([]);
    expect(literalLines('  * uses "project.json" in prose')).toEqual([]);
    expect(literalLines('  const a = "new-project.json";')).toEqual([]);
    expect(literalLines("  it for another file and `project.json` gets checked")).toEqual([]);
  });
});
