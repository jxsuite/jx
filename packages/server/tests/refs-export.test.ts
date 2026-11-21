/**
 * The `@jxsuite/server/refactor/refs` subpath (project-state.md §12) must stay I/O-free: a Durable
 * Object, a browser and the desktop backend's Node bundle all bundle the same reference walk, and
 * Bun imports it as source. This bundles the published entry for the browser and fails on any
 * `node:` specifier, bare Node builtin or `chokidar` anywhere in its module graph, and on any use
 * of the ambient `process` or `Bun` globals in the bundled code, which no specifier reveals. The
 * `./refactor` index and a scratch module reading `process.env` are the controls: each detector is
 * proven to see what it is looking for. The dependency graph (project-state.md §8) is held to the
 * same rule through its own subpath, because every host builds its graph from the same walk.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json";
import * as refs from "../src/refactor/refs.ts";

/** What bundling an entry saw: every specifier its graph imports, and the bundled code. */
interface BundleProbe {
  code: string;
  specifiers: string[];
}

/** Bundle `entry`, recording every specifier its module graph imports, as written in source. */
async function probeBundle(
  entry: string,
  target: "browser" | "bun" = "browser",
): Promise<BundleProbe> {
  const seen: string[] = [];
  const result = await Bun.build({
    entrypoints: [entry],
    plugins: [
      {
        name: "record-imports",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind !== "entry-point-build") {
              seen.push(args.path);
            }
          });
        },
      },
    ],
    target,
    throw: false,
  });
  expect(result.success).toBe(true);
  return { code: await result.outputs[0]!.text(), specifiers: seen };
}

function ioImports(specifiers: string[]): string[] {
  return specifiers.filter(
    (s) => s.startsWith("node:") || isBuiltin(s) || s === "chokidar" || s.startsWith("chokidar/"),
  );
}

/**
 * Each use of a host-only global in bundled code: `process` or `Bun` followed by `.`, `?.` or `[`,
 * bare or off `globalThis`.
 */
function ambientIo(code: string): string[] {
  return code.match(/\b(?:globalThis\.)?(?:process|Bun)\s*(?:\??\.|\[)/g) ?? [];
}

const scratch = mkdtempSync(join(tmpdir(), "jx-refs-export-"));
afterAll(() => rmSync(scratch, { force: true, recursive: true }));

describe("@jxsuite/server/refactor/refs", () => {
  test("is a published subpath export inside the tarball's files", () => {
    const target = pkg.exports["./refactor/refs"];
    expect(target).toBe("./src/refactor/refs.ts");
    expect(pkg.files.some((dir) => target.startsWith(`./${dir}`))).toBe(true);
  });

  test("resolves through the exports map and exposes the pure walk", async () => {
    const mod = await import("@jxsuite/server/refactor/refs");
    expect(mod.walkDocRefs).toBe(refs.walkDocRefs);
    expect(mod.countTagUses).toBe(refs.countTagUses);
    expect(mod.rewriteDocRefs).toBe(refs.rewriteDocRefs);
    expect(mod.countTagUses({ children: [{ tagName: "x-a" }, { tagName: "x-a" }] }, "x-a")).toBe(2);
  });

  test("its module graph has no node:, builtin or chokidar import", async () => {
    const entry = fileURLToPath(import.meta.resolve("@jxsuite/server/refactor/refs"));
    const { specifiers } = await probeBundle(entry, "browser");
    expect(specifiers.length).toBeGreaterThan(0);
    expect(ioImports(specifiers)).toEqual([]);
  });

  test("its bundled code touches no process or Bun global", async () => {
    const entry = fileURLToPath(import.meta.resolve("@jxsuite/server/refactor/refs"));
    const { code } = await probeBundle(entry, "browser");
    expect(code).toContain("walkDocRefs");
    expect(ambientIo(code)).toEqual([]);
  });

  test("the dependency graph is a published subpath with the same pure module graph", async () => {
    expect(pkg.exports["./project-state/graph"]).toBe("./src/project-state/graph.ts");
    const entry = fileURLToPath(import.meta.resolve("@jxsuite/server/project-state/graph"));
    const { code, specifiers } = await probeBundle(entry, "browser");
    expect(specifiers).toContain("../refactor/refs.ts");
    expect(specifiers.some((s) => s.includes("refactor/index") || s === "./index.ts")).toBe(false);
    expect(ioImports(specifiers)).toEqual([]);
    expect(code).toContain("createDependencyGraph");
    expect(ambientIo(code)).toEqual([]);
  });

  test("the global detector sees process, Bun and globalThis.process with no import", async () => {
    const entry = join(scratch, "ambient.ts");
    writeFileSync(
      entry,
      [
        "export const a = process.env.HOME;",
        "export const b = () => Bun.file('x');",
        "export const c = globalThis.process?.cwd();",
      ].join("\n"),
    );
    const { code, specifiers } = await probeBundle(entry, "browser");
    expect(ioImports(specifiers)).toEqual([]);
    expect(ambientIo(code).length).toBe(3);
  });

  test("the detector sees the watcher behind the ./refactor index", async () => {
    // The index cannot bundle for the browser at all, which is the point; bundle it for Bun.
    const entry = fileURLToPath(import.meta.resolve("@jxsuite/server/refactor"));
    const { specifiers } = await probeBundle(entry, "bun");
    expect(ioImports(specifiers)).toContain("chokidar");
  });
});
