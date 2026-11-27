/**
 * Times the TypeScript project state host (`specs/project-state.md` §10.1, §10.2) on a large
 * project: how long it takes to index 10,000 files, and how long it takes to take in a burst of
 * 1,000 events. The numbers are the evidence §13.2 asks for before a native core is considered.
 *
 * The desktop backend (Node) and the dev server (Bun) run the same `createProjectStateHost`, so the
 * two hosts are this one script run under each runtime (`jiti` lets Node load the workspace
 * sources):
 *
 *     bun bench/project-state/run.ts
 *     node node_modules/.bin/jiti bench/project-state/run.ts
 *
 * It is not a `*.bench.ts` file: CodSpeed counts instructions, and what this measures is disk and
 * watcher time, which only wall-clock time shows. Run it before and after on the same machine; the
 * numbers mean nothing across machines.
 *
 * @module
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { contentHash } from "@jxsuite/protocol/project-state";
import type { ProjectEvent } from "@jxsuite/protocol/project-state";
import { createProjectStateHost } from "../../packages/server/src/project-state/host.ts";
import { NO_FORMATS } from "../../packages/server/src/project-state/host-deps.ts";

const FILES = 10_000;
const BURST = 1000;
const DIRS = 100;

/** The runtime this run measures. */
const runtime = typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`;

/** One JSON document of the project: a component or a page that references earlier components. */
function documentFor(index: number, revision: number): string {
  const ref = (n: number) => ({ $ref: `../components/c${n}.json` });
  return JSON.stringify({
    children: [
      { tagName: "h2", textContent: `Item ${index} rev ${revision}` },
      ...(index > 0 ? [ref(index - 1)] : []),
      ...(index > 9 ? [ref(Math.floor(index / 2))] : []),
    ],
    style: { padding: "1rem" },
    tagName: "section",
  });
}

const ms = (from: number): number => Math.round((performance.now() - from) * 10) / 10;

/** Build a project of `FILES` files: 80% components, 10% pages, 10% data and styles. */
async function buildProject(root: string): Promise<void> {
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "bench", private: true }));
  for (const dir of ["components", "pages", "data", "styles"]) {
    for (let d = 0; d < DIRS; d++) {
      await mkdir(join(root, dir, `d${d}`), { recursive: true });
    }
  }
  const writes: Promise<void>[] = [];
  for (let i = 0; i < FILES; i++) {
    const bucket = i % 10;
    const group = `d${i % DIRS}`;
    if (bucket < 8) {
      writes.push(writeFile(join(root, "components", `c${i}.json`), documentFor(i, 0)));
    } else if (bucket === 8) {
      writes.push(writeFile(join(root, "pages", group, `p${i}.json`), documentFor(i, 0)));
    } else {
      writes.push(writeFile(join(root, "styles", group, `s${i}.css`), `.a${i}{color:red}`));
    }
    if (writes.length >= 200) {
      await Promise.all(writes.splice(0));
    }
  }
  await Promise.all(writes);
}

const root = await mkdtemp(join(tmpdir(), "jx-project-state-bench-"));
const results = new Map<string, number | string>([
  ["runtime", runtime],
  ["files", FILES],
  ["burst", BURST],
]);
try {
  await buildProject(root);

  const startedAt = performance.now();
  const host = await createProjectStateHost({
    extensions: () => Promise.resolve(NO_FORMATS),
    git: false,
    installed: () => Promise.resolve(true),
    onError: (error) => console.error(error.message),
    root,
  });
  results.set("indexMs (host created, watcher armed, files scanned)", ms(startedAt));
  const readyAt = performance.now();
  await host.idle(50);
  results.set("settleMs (graph built, readiness reached)", ms(startedAt));
  results.set("afterIndexIdleMs", ms(readyAt));
  results.set("readiness", host.readiness);
  results.set("indexedEntries (files and directories)", host.snapshot().files.length);
  const snapshotAt = performance.now();
  host.snapshot();
  results.set("snapshotMs", ms(snapshotAt));

  // A burst of 1,000 conditional writes through the host (the Studio's saves).
  const received: ProjectEvent[] = [];
  const subscription = host.subscribe({}, { events: (events) => received.push(...events) });
  const hashes = new Map(host.snapshot().files.map((file) => [file.path, file.hash]));
  const targets = [...hashes.keys()]
    .filter((path) => path.startsWith("components/"))
    .slice(0, BURST);
  const writeAt = performance.now();
  for (const [n, path] of targets.entries()) {
    const index = Number(path.slice("components/c".length, -".json".length));
    const base = hashes.get(path) ?? null;
    const result = await host.write({
      baseHash: base,
      contents: documentFor(index, 1),
      path,
      writeId: `bench-${n}`,
    });
    if (!result.ok) {
      throw new Error(`write refused: ${path}`);
    }
  }
  results.set("writeBurstMs (1000 conditional writes, awaited in turn)", ms(writeAt));
  results.set("writeBurstEvents", received.length);

  // A burst of 1,000 external changes the watcher has to find and attribute.
  received.length = 0;
  const external = targets.slice(0, BURST);
  const watchAt = performance.now();
  const indexOf = (path: string): number =>
    Number(path.slice("components/c".length, -".json".length));
  const rewrite = (path: string): Promise<void> =>
    writeFile(join(root, path), documentFor(indexOf(path), 2));
  for (let i = 0; i < external.length; i += 100) {
    await Promise.all(external.slice(i, i + 100).map((path) => rewrite(path)));
  }
  const wrote = ms(watchAt);
  await host.idle(200);
  results.set("externalBurstDiskMs", wrote);
  results.set("externalBurstMs (writes until the host is idle)", ms(watchAt));
  results.set("externalBurstEvents", received.length);
  const text = "x".repeat(10_240);
  const hashAt = performance.now();
  for (let i = 0; i < 1000; i++) {
    await contentHash(text);
  }
  results.set("hashOf10KiBMs", ms(hashAt) / 1000);
  subscription.close();
  await host.close();
} finally {
  await rm(root, { force: true, recursive: true });
}
console.log(JSON.stringify(Object.fromEntries(results), null, 2));
