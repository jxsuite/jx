/**
 * The publish workflow's addon matrix builds exactly the triples the loader can ask for.
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

const publish = readFileSync(join(import.meta.dir, "../.github/workflows/publish.yml"), "utf8");
const legs = [...publish.matchAll(/\{ triple: ([\w-]+), os: ([\w.-]+), target: ([\w-]+) \}/g)].map(
  ([, triple, os, target]) => ({ os: os ?? "", target: target ?? "", triple: triple ?? "" }),
);

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

test("the publish job packages the addons before it publishes, and stops when a leg failed", () => {
  const packaged = publish.indexOf("scripts/addon-packages.ts addon-artifacts");
  const published = publish.indexOf("scripts/publish-released.ts --issue-body");
  expect(packaged).toBeGreaterThan(-1);
  expect(published).toBeGreaterThan(packaged);
  expect(publish).toContain("needs.addon.result != 'failure'");
});
