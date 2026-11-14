/**
 * The addon workflow's matrix builds exactly the triples the loader can ask for.
 *
 * `RELEASE_TRIPLES` is what `@jxsuite/compiler-binding` resolves a host to, and what
 * `scripts/addon-packages.ts` refuses to publish without. A triple added to one and not built by
 * the other is a release that fails at the packaging step, on the release itself, which is the one
 * place this lane ever runs.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_TRIPLES } from "../packages/compiler-binding/src/triple.ts";

const workflow = (name: string) =>
  readFileSync(join(import.meta.dir, "../.github/workflows", name), "utf8");
const publish = workflow("publish.yml");
const addon = workflow("addon.yml");
const legs = [
  ...addon.matchAll(/triple: ([\w-]+),\s+os: ([\w.-]+),\s+target: ([\w-]+),\s+probe: (\w+)/g),
].map(([, triple, os, target, probe]) => ({
  os: os ?? "",
  probe: probe ?? "",
  target: target ?? "",
  triple: triple ?? "",
}));

test("the matrix has one leg per released triple, and no other", () => {
  expect(legs.map((leg) => leg.triple).toSorted()).toEqual([...RELEASE_TRIPLES].toSorted());
});

test("each leg's Rust target is the triple's own platform, CPU and C library", () => {
  for (const { target, triple } of legs) {
    const [os, cpu, abi] = triple.split("-");
    expect(target).toContain(cpu === "x64" ? "x86_64" : "aarch64");
    expect(target).toContain(
      { darwin: "apple-darwin", linux: "linux", win32: "windows" }[os ?? ""] ?? "?",
    );
    if (abi) {
      expect(target.endsWith(abi)).toBe(true);
    }
  }
});

test("a leg is probed where a runner can run it, and a musl leg is linked by zig", () => {
  const unprobed = legs.flatMap((leg) => (leg.probe === "none" ? [leg.triple] : []));
  expect(unprobed.toSorted()).toEqual(["darwin-x64", "win32-arm64-msvc"]);
  for (const { probe, triple } of legs) {
    expect(probe === "alpine").toBe(triple.endsWith("-musl"));
  }
  expect(addon).toContain("endsWith(matrix.triple, '-musl') && '--zig'");
});

test("the release and a pull request build through the one workflow", () => {
  expect(publish).toContain("uses: ./.github/workflows/addon.yml");
  expect(workflow("test.yml")).toContain("uses: ./.github/workflows/addon.yml");
});

test("the publish job packages the addons before it publishes, and stops when a leg failed", () => {
  const packaged = publish.indexOf("scripts/addon-packages.ts addon-artifacts");
  const published = publish.indexOf("scripts/publish-released.ts --issue-body");
  expect(packaged).toBeGreaterThan(-1);
  expect(published).toBeGreaterThan(packaged);
  expect(publish).toContain("needs.addon.result != 'failure'");
});
