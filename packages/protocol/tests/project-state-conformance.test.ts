/**
 * The conformance suite (`specs/project-state.md` §10.4) against the in-memory reference host: once
 * with every optional hook, once as a host with no watcher, and once with a log that survives a
 * restart, as the cloud's does. Then the suite is turned on deliberately broken hosts, to prove
 * each rule it claims to check fails a host that breaks it.
 */

import { describe, expect, test } from "bun:test";
import { CONFORMANCE_FIXTURE, runProjectStateConformance } from "../src/project-state-conformance";
import type { ConformanceTestApi, ProjectStateDriver } from "../src/project-state-conformance";
import { contentHash } from "../src/project-state";
import { createReferenceHost, inScope, referenceDriver } from "./reference-host";
import type { ReferenceBug } from "./reference-host";

runProjectStateConformance(referenceDriver("reference host", { watcher: true }), {
  describe,
  expect,
  test,
});

runProjectStateConformance(
  referenceDriver("reference host without a watcher, links or move pairing", {
    pairMoves: false,
    symlinks: false,
  }),
  {
    describe,
    expect,
    test,
  },
);

runProjectStateConformance(
  referenceDriver("reference host with a persistent log", { persistentLog: true }),
  { describe, expect, test },
);

/** Every case the suite registers, by its full name, without running any. */
function collectCases(
  bugs: readonly ReferenceBug[],
  hooks: Pick<ProjectStateDriver, "graph" | "rename"> = {},
): Map<string, () => Promise<void>> {
  const cases = new Map<string, () => Promise<void>>();
  const path: string[] = [];
  const api: ConformanceTestApi = {
    describe(name, body) {
      path.push(name);
      body();
      path.pop();
    },
    expect,
    test(name, body) {
      cases.set([...path, name].join(" > "), body);
    },
  };
  runProjectStateConformance(
    { ...referenceDriver("broken", { bugs, watcher: true }), ...hooks },
    api,
  );
  return cases;
}

/** Whether the case whose name contains `fragment` fails against a host with `bug`. */
async function fails(bug: ReferenceBug, fragment: string): Promise<boolean> {
  const cases = collectCases([bug]);
  const matching = [...cases].filter(([name]) => name.includes(fragment));
  expect(matching.length).toBe(1);
  try {
    await matching[0]![1]();
    return false;
  } catch {
    return true;
  }
}

describe("the suite catches a host that breaks the contract", () => {
  test("registers every case once, with no host started", () => {
    const cases = collectCases([]);
    expect(cases.size).toBeGreaterThan(40);
    for (const section of ["§2", "§3", "§4", "§5", "§7", "§4.5"]) {
      expect([...cases.keys()].some((name) => name.includes(`${section} `))).toBe(true);
    }
  });

  test.each([
    ["echo", "a coalesced burst of writes emits one event per write"],
    ["no-precondition", "a write with a stale base is refused"],
    ["no-precondition", "two writes on the same base"],
    ["subset-replay", "a resubscribe outside the window gets a snapshot"],
    ["atomic-new-id", "inside the pairing bound keeps its id"],
    ["install-moves-readiness", "an install's own lockfile write"],
    ["revision-gap", "a resubscribe inside the window"],
    ["malformed-event", "the first streamed event follows the snapshot's revision"],
    ["ledger-never-clears", "an external change that restores an own write's bytes"],
    ["index-fill-write-origin", "a host below indexed answers a snapshot"],
    ["unindexed", "a host below indexed answers a snapshot"],
    ["unindexed", "every file and directory in the index scope is in the snapshot"],
  ] as const)("%s fails “%s”", async (bug, fragment) => {
    expect(await fails(bug, fragment)).toBe(true);
  });

  test("declaring a graph or rename hook adds a failing case instead of removing one", async () => {
    const plain = [...collectCases([]).keys()];
    for (const [hooks, removed, added] of [
      [{ graph: { complete: true } }, "emits no dependentsInvalidated", "the §8 cases"],
      [
        { rename: { failStep: () => null, rename: async () => ({ ok: true }) } },
        "emits no operationApplied",
        "the §9 cases",
      ],
    ] as const) {
      const cases = collectCases([], hooks);
      expect(cases.size).toBe(plain.length);
      expect([...cases.keys()].some((name) => name.includes(removed))).toBe(false);
      const [, run] = [...cases].find(([name]) => name.includes(added))!;
      expect(
        await run().then(
          () => "passed",
          () => "failed",
        ),
      ).toBe("failed");
    }
  });

  test("a host that declares its graph partial need only say whether a file is indexed", async () => {
    const partial = collectCases(["unindexed"], { graph: { complete: false } });
    const [, run] = [...partial].find(([name]) =>
      name.includes("every file and directory in the index scope is in the snapshot"),
    )!;
    await run();
  });

  test("a correct host passes the same cases", async () => {
    const cases = collectCases([]);
    for (const fragment of [
      "a coalesced burst of writes emits one event per write",
      "a write with a stale base is refused",
      "inside the pairing bound keeps its id",
      "an external change that restores an own write's bytes",
      "a host below indexed answers a snapshot",
    ]) {
      const [, run] = [...cases].find(([name]) => name.includes(fragment))!;
      await run();
    }
  });
});

describe("the fixture", () => {
  test("holds a document of each conventional kind and every excluded path", () => {
    const paths = Object.keys(CONFORMANCE_FIXTURE);
    expect(paths.filter((path) => !inScope(path, "site")).toSorted()).toEqual([
      ".cache/build.json",
      ".devenv/state",
      ".direnv/state",
      ".jx/state.json",
      "bun.lock",
      "dist/index.html",
      "node_modules/dep/index.js",
      "pages/node_modules/stray.js",
      "site/index.html",
    ]);
    expect(Object.isFrozen(CONFORMANCE_FIXTURE)).toBe(true);
  });
});

describe("the reference host", () => {
  test("pairs a watcher-observed move by hash and keeps the id", async () => {
    const host = await createReferenceHost({ "a/one.json": "{}" });
    const before = await host.subscribe({});
    const docId = (before.response.kind === "snapshot" ? before.response.snapshot.files : []).find(
      (file) => file.path === "a/one.json",
    )?.docId;
    await host.external.rename("a/one.json", "a/two.json");
    await host.settle();
    expect(before.events.filter((event) => event.type !== "gitChanged")).toEqual([
      {
        docId: docId!,
        from: "a/one.json",
        isDir: false,
        origin: "external",
        rev: before.response.rev + 1,
        to: "a/two.json",
        type: "fileRenamed",
      },
    ]);
    await host.close();
    expect(host.openSubscribers()).toBe(0);
  });

  test("an own write outside the index scope emits nothing", async () => {
    const host = await createReferenceHost({ "x.json": "{}" });
    const sub = await host.subscribe({});
    const result = await host.write({
      baseHash: null,
      contents: "built",
      path: "dist/out.html",
      writeId: "w",
    });
    await host.settle();
    expect(result).toEqual({ hash: await contentHash("built"), ok: true, rev: sub.response.rev });
    expect(sub.events).toEqual([]);
    await host.close();
  });

  test("a new file in a new directory adds the directory first", async () => {
    const host = await createReferenceHost({ "x.json": "{}" });
    const sub = await host.subscribe({});
    await host.write({ baseHash: null, contents: "{}", path: "deep/er/y.json", writeId: "w" });
    expect(sub.events.slice(0, 3).map((event) => event.type)).toEqual([
      "fileAdded",
      "fileAdded",
      "fileAdded",
    ]);
    await host.close();
  });

  test("an external removal of a committed file is reported to git as deleted", async () => {
    const host = await createReferenceHost({ "x.json": "{}", "y.json": "[]" });
    const sub = await host.subscribe({});
    await host.external.remove("y.json");
    await host.settle();
    const git = sub.events.find((event) => event.type === "gitChanged");
    expect(git?.type === "gitChanged" && git.status.changed).toEqual({ "y.json": "deleted" });
    await host.close();
  });
});
