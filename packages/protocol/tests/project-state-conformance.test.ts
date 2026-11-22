/**
 * The conformance suite (`specs/project-state.md` §10.4) against the in-memory reference host: once
 * with every optional hook, once as a host with no watcher, and once with a log that survives a
 * restart and no dependency graph, as the cloud's does. Then the suite is turned on deliberately
 * broken hosts, to prove each rule it claims to check fails a host that breaks it.
 */

import { describe, expect, test } from "bun:test";
import { CONFORMANCE_FIXTURE, runProjectStateConformance } from "../src/project-state-conformance";
import type { ConformanceTestApi, ProjectStateDriver } from "../src/project-state-conformance";
import { contentHash } from "../src/project-state";
import { createReferenceHost, inScope, referenceDriver } from "./reference-host";
import type { ReferenceBug } from "./reference-host";

runProjectStateConformance(
  referenceDriver("reference host", { graph: true, rename: true, watcher: true }),
  { describe, expect, test },
);

runProjectStateConformance(
  referenceDriver("reference host without a watcher, links or move pairing", {
    graph: true,
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

runProjectStateConformance(
  referenceDriver("reference host with a partial graph that renames", {
    graph: true,
    partialGraph: true,
    rename: true,
  }),
  { describe, expect, test },
);

/** Every case the suite registers, by its full name, without running any. */
function collectCases(
  bugs: readonly ReferenceBug[],
  hooks: Pick<ProjectStateDriver, "graph" | "rename"> = {},
  graph = false,
  rename = false,
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
    { ...referenceDriver("broken", { bugs, graph, rename, watcher: true }), ...hooks },
    api,
  );
  return cases;
}

/** Whether the case whose name contains `fragment` fails against a host with `bug`. */
async function fails(
  bug: ReferenceBug,
  fragment: string,
  graph = false,
  rename = false,
): Promise<boolean> {
  const cases = collectCases([bug], {}, graph, rename);
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
    ["classifies-early", "a document in an extension's format is other until extensions-resolved"],
  ] as const)("%s fails “%s”", async (bug, fragment) => {
    expect(await fails(bug, fragment)).toBe(true);
  });

  /** The three §8 cases, by a fragment of each name. */
  const COMPONENT = "deleting a component invalidates its instances";
  const MEDIA = "renaming a media file outside Studio";
  const LAYOUT = "editing the default layout";

  test.each([
    ["graph-lists-cause", COMPONENT],
    ["graph-lists-cause", MEDIA],
    ["graph-lists-cause", LAYOUT],
    ["graph-duplicate-dependent", COMPONENT],
    ["graph-duplicate-dependent", MEDIA],
    ["graph-duplicate-dependent", LAYOUT],
    ["graph-incomplete", COMPONENT],
    ["graph-incomplete", MEDIA],
    ["graph-incomplete", LAYOUT],
    ["graph-split-kind", COMPONENT],
    ["graph-split-kind", MEDIA],
    ["graph-split-kind", LAYOUT],
    ["graph-over-invalidate", COMPONENT],
    ["graph-over-invalidate", MEDIA],
    ["graph-over-invalidate", LAYOUT],
    ["graph-early", MEDIA],
    ["graph-early", LAYOUT],
  ] as const)("%s fails “%s”", async (bug, fragment) => {
    expect(await fails(bug, fragment, true)).toBe(true);
  });

  test("a correct graph passes the same §8 cases", async () => {
    const cases = [...collectCases([], {}, true)].filter(([name]) => name.includes("§8 "));
    expect(cases.length).toBe(3);
    for (const [, run] of cases) {
      await run();
    }
  });

  /** The §9 cases, by a fragment of each name. */
  const RENAME_DONE = "a rename moves the file, rewrites its referrers";
  const ROLLBACK = "a rename either completes or leaves every file as it was (a failure at step 2)";
  const REFUSE = "a dirty referrer under refuse";
  const BUFFER = "a dirty referrer under rewrite-buffer";
  const CLIENT = "a dirty referrer's own client rewrite";

  test.each([
    ["rename-no-rollback", ROLLBACK],
    ["rename-ignores-dirty", REFUSE],
    ["rename-ignores-dirty", BUFFER],
    ["rename-ignores-dirty", CLIENT],
    ["rename-new-id", RENAME_DONE],
  ] as const)("%s fails “%s”", async (bug, fragment) => {
    expect(await fails(bug, fragment, false, true)).toBe(true);
  });

  test("a correct rename passes the same §9 cases", async () => {
    const cases = [...collectCases([], {}, false, true)].filter(([name]) => name.includes("§9 "));
    expect(cases.length).toBe(6);
    for (const [, run] of cases) {
      await run();
    }
  });

  test("declaring the rename hook replaces the negative case with every §9 case", async () => {
    const plain = [...collectCases([]).keys()];
    const cases = collectCases([], {
      rename: { failStep: () => null, rename: async () => ({ ok: true }) },
    });
    expect([...cases.keys()].some((name) => name.includes("emits no operationApplied"))).toBe(
      false,
    );
    const renameCases = [...cases].filter(([name]) => name.includes("§9 rename cascade"));
    expect(renameCases.length).toBe(6);
    expect(cases.size).toBe(plain.length - 1 + renameCases.length);
    const [, run] = renameCases.find(([name]) => name.includes(RENAME_DONE))!;
    expect(
      await run().then(
        () => "passed",
        () => "failed",
      ),
    ).toBe("failed");
  });

  test("the reference host refuses a rename onto a taken path, or one it was not built for", async () => {
    const host = await createReferenceHost(CONFORMANCE_FIXTURE, { rename: true });
    const taken = await host.rename({
      dirtyReferrers: [],
      from: "media/logo.png",
      opId: "op",
      policy: "refuse",
      to: "pages/index.json",
    });
    expect(taken).toMatchObject({ ok: false, paths: ["pages/index.json"], reason: "conflict" });
    await host.close();
    const plain = await createReferenceHost(CONFORMANCE_FIXTURE);
    const refusal = await plain
      .rename({ dirtyReferrers: [], from: "a", opId: "op", policy: "refuse", to: "b" })
      .then(
        () => null,
        (error: Error) => error.message,
      );
    expect(refusal).toContain("rename cascade");
    await plain.close();
  });

  test("a reference host with a partial graph needs the client's rewrites, and applies them", async () => {
    const host = await createReferenceHost(CONFORMANCE_FIXTURE, {
      graph: true,
      partialGraph: true,
      rename: true,
    });
    const base = {
      dirtyReferrers: [],
      from: "media/logo.png",
      opId: "op",
      policy: "refuse" as const,
      to: "media/brand.png",
    };
    expect(await host.rename(base)).toMatchObject({ ok: false, reason: "rewrites-required" });
    const note = await host.read("content/posts/hello.md");
    const applied = await host.rename({
      ...base,
      rewrites: [
        {
          baseHash: await contentHash(note!),
          contents: "# Hello ![](../../media/brand.png)\n",
          path: "content/posts/hello.md",
        },
      ],
    });
    expect(applied.ok).toBe(true);
    expect(new TextDecoder().decode((await host.read("content/posts/hello.md"))!)).toContain(
      "brand.png",
    );
    await host.close();
  });

  test("a stale client rewrite rolls the rename back", async () => {
    const host = await createReferenceHost(CONFORMANCE_FIXTURE, { rename: true });
    const result = await host.rename({
      dirtyReferrers: [],
      from: "media/logo.png",
      opId: "op",
      policy: "refuse",
      rewrites: [{ baseHash: await contentHash("stale"), contents: "x", path: "styles/site.css" }],
      to: "media/brand.png",
    });
    expect(result).toMatchObject({ ok: false, reason: "conflict" });
    expect(await host.read("media/logo.png")).not.toBe(null);
    expect(await host.read("media/brand.png")).toBe(null);
    await host.close();
  });

  test("declaring the graph hook on a host with no graph fails every §8 case", async () => {
    const plain = [...collectCases([]).keys()];
    const cases = collectCases([], { graph: { complete: true } });
    expect([...cases.keys()].some((name) => name.includes("emits no dependentsInvalidated"))).toBe(
      false,
    );
    const graphCases = [...cases].filter(([name]) => name.includes("§8 dependency graph"));
    expect(graphCases.length).toBe(3);
    expect(cases.size).toBe(plain.length - 1 + graphCases.length);
    for (const [, run] of graphCases) {
      expect(
        await run().then(
          () => "passed",
          () => "failed",
        ),
      ).toBe("failed");
    }
  });

  test("a host whose graph is partial may report an incomplete invalidation", async () => {
    const driver = referenceDriver("partial", { graph: true, partialGraph: true });
    expect(driver.graph).toEqual({ complete: false });
    const graphCases: (() => Promise<void>)[] = [];
    let inGraph = false;
    runProjectStateConformance(driver, {
      describe: (name, body) => {
        const outer = inGraph;
        inGraph ||= name === "§8 dependency graph";
        body();
        inGraph = outer;
      },
      expect,
      test: (_name, body) => {
        if (inGraph) {
          graphCases.push(body);
        }
      },
    });
    expect(graphCases.length).toBe(3);
    for (const run of graphCases) {
      await run();
    }
    // The cases above passed on events that really are incomplete.
    const host = await createReferenceHost(CONFORMANCE_FIXTURE, {
      graph: true,
      partialGraph: true,
    });
    await host.settle();
    const sub = await host.subscribe({});
    await host.external.write("layouts/base.json", "{}\n");
    await host.settle();
    const found = sub.events.filter((event) => event.type === "dependentsInvalidated");
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((event) => event.complete)).toEqual(found.map(() => false));
    sub.close();
    await host.close();
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
