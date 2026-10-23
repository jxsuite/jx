/**
 * Covers `scripts/check-release-integrity.ts` — the gate that would have caught, on the day it
 * happened, `packages/starters` being versioned to 1.3.0 in the manifest and never released.
 *
 * The release probe is injected, so the assertions below never touch GitHub: what is tested is the
 * tag arithmetic (which must track `release-please-config.json`, not a hardcoded shape), the gap
 * logic, and that the report names the cause.
 */

import { describe, expect, test } from "bun:test";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NPM_AGE_FLOOR_MS,
  UNRELEASED,
  findGaps,
  findUnpublished,
  npmCandidates,
  npmReport,
  readTargets,
  registryProbe,
  report,
  tagFor,
} from "./check-release-integrity.ts";
import type { NpmTarget, ReleaseTarget } from "./check-release-integrity.ts";
import { readWorkspaces } from "./lib/workspaces.ts";

const CONFIG = {
  "include-v-in-tag": true,
  "include-component-in-tag": true,
  packages: {
    "packages/starters": { component: "starters" },
    "extensions/feed": { component: "feed" },
    "packages/odd": { "include-v-in-tag": false, "tag-separator": "@", component: "odd" },
    "packages/solo": { "include-component-in-tag": false },
    "packages/unnamed": {},
  },
};

const target = (over: Partial<ReleaseTarget> = {}): ReleaseTarget => ({
  path: "packages/starters",
  tag: "starters-v1.5.0",
  version: "1.5.0",
  ...over,
});

/** GitHub with exactly `releases` present. */
const released =
  (...releases: string[]) =>
  (tag: string) =>
    Promise.resolve(releases.includes(tag));

describe("tagFor", () => {
  test("matches the tags release-please actually created", () => {
    expect(tagFor("packages/starters", "1.5.0", CONFIG)).toBe("starters-v1.5.0");
    expect(tagFor("extensions/feed", "0.3.1", CONFIG)).toBe("feed-v0.3.1");
  });

  test("honours per-package overrides rather than assuming the default shape", () => {
    expect(tagFor("packages/odd", "2.0.0", CONFIG)).toBe("odd@2.0.0");
    expect(tagFor("packages/solo", "2.0.0", CONFIG)).toBe("v2.0.0");
  });

  test("falls back to the directory name when no component is configured", () => {
    expect(tagFor("packages/unnamed", "1.0.0", CONFIG)).toBe("unnamed-v1.0.0");
  });
});

describe("readTargets", () => {
  test("reads this repository's real manifest and derives a tag for every entry", async () => {
    const targets = await readTargets();
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      // A component may be hyphenated (`catalog`), so this is not `[a-z]+`. What the
      // Shape has to guarantee is the `-v<semver>` suffix release-please tags with, because that
      // Is the string `gh release view` is handed.
      expect(t.tag).toMatch(/^[a-z][a-z-]*-v\d+\.\d+\.\d+/);
    }
  });

  test("every manifest entry is judged, including the ones npm never receives", async () => {
    const targets = await readTargets();
    // The desktop component ships as installers rather than to npm and still owes a release.
    // That is where the bundlers attach, and how desktop-v2.2.0 shipped with no installers.
    expect(targets.find((t) => t.path === "packages/desktop")).toBeDefined();
    expect(targets.find((t) => t.path === "packages/starters")).toBeDefined();
  });

  test("a component still at release-please's 0.0.0 sentinel claims nothing yet", async () => {
    // `@jxsuite/ui` entered the manifest at 0.0.0 and the gate demanded `ui-v0.0.0` of it — a
    // Release that release-please by its own rule never creates. The sentinel is not a claim.
    const root = mkdtempSync(join(tmpdir(), "release-integrity-"));
    writeFileSync(
      join(root, "release-please-config.json"),
      JSON.stringify({
        "include-v-in-tag": true,
        "include-component-in-tag": true,
        packages: {
          "packages/shipped": { component: "shipped" },
          "packages/fresh": { component: "fresh" },
        },
      }),
    );
    writeFileSync(
      join(root, ".release-please-manifest.json"),
      JSON.stringify({ "packages/shipped": "1.2.0", "packages/fresh": UNRELEASED }),
    );
    const targets = await readTargets(root);
    expect(targets.map((t) => t.tag)).toEqual(["shipped-v1.2.0"]);
  });
});

describe("findGaps", () => {
  test("a released component is not a gap", async () => {
    expect(await findGaps([target()], released("starters-v1.5.0"))).toEqual([]);
  });

  test("the release-please skip: manifest bumped, nothing released", async () => {
    expect(await findGaps([target()], released())).toEqual([target()]);
  });

  test("judges every target, not just the first", async () => {
    const many = ["ai", "site", "runtime"].map((c) =>
      target({ path: `packages/${c}`, tag: `${c}-v1.5.0` }),
    );
    const gaps = await findGaps(many, released("ai-v1.5.0", "runtime-v1.5.0"));
    expect(gaps.map((g) => g.path)).toEqual(["packages/site"]);
  });
});

describe("report", () => {
  test("points at the cause, and at the publish that never ran either", async () => {
    const text = report(await findGaps([target()], released()));
    expect(text).toContain("packages/starters");
    expect(text).toContain("starters-v1.5.0");
    expect(text).toContain("but not for component");
    expect(text).toContain("commitlint.config.ts");
    // The publish backfill goes through release-please.yml: npm's trusted publisher refuses a
    // Token requested by publish.yml dispatched on its own.
    expect(text).toContain("gh workflow run release-please.yml -f backfill_paths=");
    expect(text).not.toContain("gh workflow run publish.yml");
  });

  test("says nothing about npm, which this gate no longer asks and cannot answer for", async () => {
    const text = report(await findGaps([target()], released()));
    // The registry probe was 0-for-3 on real failures; see this file's counterpart header.
    expect(text).not.toContain("npm view");
    expect(text).not.toContain("not on npm");
  });
});

/**
 * The npm half, which only the daily scheduled sweep runs (`--npm`), and only for releases older
 * than a day. The case is 2026-10-17: the publish loop died before `site@2.0.5` and
 * `runtime@5.0.0`, both of which had a GitHub release, so the release half stayed green.
 */
describe("the npm half (--npm, scheduled sweep only)", () => {
  const NOW = new Date("2026-10-18T05:00:00Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
  const WORKSPACES = [
    { dir: "packages/runtime", name: "@jxsuite/runtime", publishable: true },
    { dir: "packages/site", name: "@jxsuite/site", publishable: true },
    { dir: "packages/desktop", name: "@jxsuite/desktop", publishable: false },
  ];
  const runtime = target({ path: "packages/runtime", tag: "runtime-v5.0.0", version: "5.0.0" });
  const site = target({ path: "packages/site", tag: "site-v2.0.5", version: "2.0.5" });
  const desktop = target({ path: "packages/desktop", tag: "desktop-v3.0.0", version: "3.0.0" });

  test("the floor is an hour: far above the worst write lag ever measured (187s)", () => {
    expect(NPM_AGE_FLOOR_MS).toBe(3_600_000);
    expect(NPM_AGE_FLOOR_MS).toBeGreaterThan(187_000 * 19);
  });

  test("asks only about releases OLDER than the floor, so it can never race the registry", () => {
    const at = new Map([
      ["runtime-v5.0.0", hoursAgo(1.5)],
      ["site-v2.0.5", hoursAgo(0.9)],
    ]);
    const picked = npmCandidates([runtime, site], WORKSPACES, at, NOW);
    expect(picked.map((c) => c.name)).toEqual(["@jxsuite/runtime"]);
    // Exactly at the floor is still too young.
    const edge = new Map([["runtime-v5.0.0", hoursAgo(1)]]);
    expect(npmCandidates([runtime], WORKSPACES, edge, NOW)).toEqual([]);
  });

  test("skips what npm never receives, and what has no GitHub release (the other half's finding)", () => {
    const at = new Map([["desktop-v3.0.0", hoursAgo(48)]]);
    expect(npmCandidates([desktop, runtime], WORKSPACES, at, NOW)).toEqual([]);
    const stranger = target({ path: "packages/unknown", tag: "unknown-v1.0.0" });
    const old = new Map([["unknown-v1.0.0", hoursAgo(48)]]);
    expect(npmCandidates([stranger], WORKSPACES, old, NOW)).toEqual([]);
  });

  test("the publishable filter is the repository's own: desktop is out, runtime and site are in", async () => {
    const real = await readWorkspaces();
    const publishable = new Set(real.filter((w) => w.publishable).map((w) => w.dir));
    expect(publishable.has("packages/desktop")).toBe(false);
    expect(publishable.has("packages/runtime")).toBe(true);
    expect(publishable.has("packages/site")).toBe(true);
  });

  test("the 2026-10-17 case: both found at the next morning's sweep, each with its own recovery command", async () => {
    // Released 2026-10-17T16:12:45Z; the 05:00 sweep on 2026-10-18 sees them 12.8h old.
    const releasedOn1017 = new Date("2026-10-17T16:12:45Z");
    const at = new Map([
      ["runtime-v5.0.0", releasedOn1017],
      ["site-v2.0.5", releasedOn1017],
    ]);
    const candidates = npmCandidates([runtime, site], WORKSPACES, at, NOW);
    const { absent, unknown } = await findUnpublished(candidates, () => Promise.resolve("absent"));
    expect(unknown).toEqual([]);
    const text = npmReport(absent, NOW);
    expect(text).toContain(
      "**@jxsuite/runtime@5.0.0** has had a GitHub release (`runtime-v5.0.0`) for 12h",
    );
    expect(text).toContain(
      `gh workflow run release-please.yml -f backfill_paths='["packages/site"]' -f backfill_sha=site-v2.0.5`,
    );
  });

  test("an indefinite registry answer is reported apart and does not count as absent", async () => {
    const outage: NpmTarget = { ...runtime, name: "@jxsuite/runtime", releasedAt: hoursAgo(30) };
    const fine: NpmTarget = { ...site, name: "@jxsuite/site", releasedAt: hoursAgo(30) };
    const result = await findUnpublished([outage, fine], (name) =>
      Promise.resolve(name === outage.name ? "unknown" : "present"),
    );
    expect(result).toEqual({ absent: [], unknown: [outage] });
  });

  test("registryProbe: 200 present, 404 absent, anything else or a throw is unknown", async () => {
    const urls: string[] = [];
    const answer = (status: number) => (url: string) => {
      urls.push(url);
      return Promise.resolve({ status });
    };
    expect(await registryProbe("@jxsuite/runtime", "5.0.0", answer(200))).toBe("present");
    expect(await registryProbe("@jxsuite/runtime", "5.0.0", answer(404))).toBe("absent");
    expect(await registryProbe("@jxsuite/runtime", "5.0.0", answer(503))).toBe("unknown");
    expect(
      await registryProbe("@jxsuite/runtime", "5.0.0", () => Promise.reject(new Error("offline"))),
    ).toBe("unknown");
    expect(urls[0]).toBe("https://registry.npmjs.org/@jxsuite%2fruntime/5.0.0");
  });
});
