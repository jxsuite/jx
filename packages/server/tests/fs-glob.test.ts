import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanFiles } from "../src/fs-glob.ts";

const root = mkdtempSync(join(tmpdir(), "jx-fs-glob-"));
for (const dir of ["a/.hid", ".dot", "b/node_modules/x", "dir.json"]) {
  mkdirSync(join(root, dir), { recursive: true });
}
for (const file of ["a/x.json", "a/.hid/y.json", ".dot/z.json", ".e.json", "b/c.md", "a/q.JSON"]) {
  writeFileSync(join(root, file), "{}");
}
writeFileSync(join(root, "b/node_modules/x/p.json"), "{}");
symlinkSync("../a/x.json", join(root, "b/link.json"));
symlinkSync("a", join(root, "linkdir"));

afterAll(() => rmSync(root, { force: true, recursive: true }));

async function collect(pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const match of scanFiles(pattern, root)) {
    out.push(match);
  }
  return out.toSorted();
}

async function bunAnswer(pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const match of new Bun.Glob(pattern).scan({ cwd: root, dot: false })) {
    out.push(match);
  }
  return out.toSorted();
}

describe("scanFiles answers what Bun.Glob#scan answered", () => {
  for (const pattern of [
    "**/*.json",
    "**/*.{json,md}",
    "**/*.{json}",
    "**/x.json",
    "**/*",
    "**/project.json",
  ]) {
    test(pattern, async () => {
      expect(await collect(pattern)).toEqual(await bunAnswer(pattern));
    });
  }

  test("a root that cannot be read throws, as Bun's scan did", async () => {
    const missing = join(root, "missing");
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: missing }))).rejects.toThrow();
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(Array.fromAsync(scanFiles("**/*", missing))).rejects.toThrow();
  });

  test("directories, links and dot-prefixed names are never yielded", async () => {
    expect(await collect("**/*.json")).toEqual(["a/x.json", "b/node_modules/x/p.json"]);
  });
});
