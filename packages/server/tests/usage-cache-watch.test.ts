import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevServer } from "../src/server";

/**
 * The usage cache is invalidated by the filesystem, so on a dev server it is as good as the watcher
 * that reaches the active project. Over real HTTP and a real watcher, because the defect was two
 * correct-looking pieces disagreeing: the answers were filed under the project, and dropped by the
 * watcher under the server root.
 */

const USES = '{"tagName":"img","attributes":{"src":"/public/a.png"}}';
const CLEAN = '{"tagName":"div"}';

const scratch = mkdtempSync(join(tmpdir(), "jx-usage-watch-"));
afterAll(() => {
  rmSync(scratch, { force: true, recursive: true });
});

function project(dir: string): void {
  mkdirSync(join(dir, "pages"), { recursive: true });
  mkdirSync(join(dir, "public"), { recursive: true });
  writeFileSync(join(dir, "project.json"), '{"name":"probe","url":"https://example.com"}');
  writeFileSync(join(dir, "public/a.png"), "x");
  writeFileSync(join(dir, "pages/one.json"), USES);
  writeFileSync(join(dir, "pages/two.json"), CLEAN);
}

let server: Awaited<ReturnType<typeof createDevServer>> | null = null;

afterEach(async () => {
  await server?.stop(true);
  server = null;
});

async function serve(root: string, allowedRoots: string[] = []): Promise<string> {
  server = await createDevServer({
    allowedRoots,
    builds: [],
    port: 0,
    root,
    studio: true,
    watch: {},
  });
  return `http://localhost:${server.port}`;
}

async function activate(base: string, root: string | null): Promise<void> {
  const res = await fetch(`${base}/__studio/activate`, {
    body: JSON.stringify({ root }),
    method: "POST",
  });
  expect(res.ok).toBe(true);
}

async function usedBy(base: string, file: string): Promise<string[]> {
  const res = await fetch(`${base}/__studio/references?path=${encodeURIComponent(file)}`);
  /* SAFETY: the shape of `ReferencesResult`, which this test's server just produced. A body of
     another shape throws on the next line, which fails the test as it should. */
  const body = (await res.json()) as { files: { path: string }[] };
  return body.files.map((entry) => entry.path).toSorted();
}

/** Poll, since the answer follows the filesystem event rather than the write. */
async function settlesOn(read: () => Promise<string[]>, expected: string[]): Promise<void> {
  const deadline = Date.now() + 5000;
  let last = await read();
  while (Date.now() < deadline && JSON.stringify(last) !== JSON.stringify(expected)) {
    await Bun.sleep(50);
    last = await read();
  }
  expect(last).toEqual(expected);
}

/** The `fs` events the server pushes to Studio, as the paths they name, collected as they arrive. */
async function fsEventPaths(base: string): Promise<{ paths: string[]; stop: () => void }> {
  const paths: string[] = [];
  const controller = new AbortController();
  const res = await fetch(`${base}/__reload`, { signal: controller.signal });
  const reader = res.body!.getReader();
  void (async () => {
    const decoder = new TextDecoder();
    let text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        text += decoder.decode(value, { stream: true });
        for (const [, data] of text.matchAll(/event: fs\ndata: (.*)\n/g)) {
          /* SAFETY: `fs` frames are this server's own `{ events }` batches, and a frame of another
             shape throws here, which leaves the assertion below unmet. */
          const batch = JSON.parse(data!) as { events: { path: string }[] };
          paths.push(...batch.events.map((event) => event.path));
        }
        text = text.slice(text.lastIndexOf("\n\n") + 1);
      }
    } catch {
      // The abort below ends the read.
    }
  })();
  return { paths, stop: () => controller.abort() };
}

/** Poll for a path among the collected events. */
async function sawEvent(paths: string[], path: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !paths.includes(path)) {
    await Bun.sleep(25);
  }
  expect(paths).toContain(path);
}

/** Time for chokidar to finish its opening scan, before which a write is not an event. */
const watcherSettled = () => Bun.sleep(300);

describe("the usage cache follows the disk", () => {
  test("for a project in a folder below the server root", async () => {
    const root = join(scratch, "below");
    const dir = join(root, "sites/probe");
    project(dir);
    const base = await serve(root);
    await watcherSettled();
    await activate(base, dir);
    const read = () => usedBy(base, "sites/probe/public/a.png");
    expect(await read()).toEqual(["pages/one.json"]);

    writeFileSync(join(dir, "pages/two.json"), USES);
    await settlesOn(read, ["pages/one.json", "pages/two.json"]);

    writeFileSync(join(dir, "pages/one.json"), CLEAN);
    writeFileSync(join(dir, "pages/two.json"), CLEAN);
    await settlesOn(read, []);
  });

  test("for a project outside the server root, which only activation can watch", async () => {
    const root = join(scratch, "elsewhere-root");
    const dir = join(scratch, "elsewhere-project");
    mkdirSync(root, { recursive: true });
    project(dir);
    const base = await serve(root, [dir]);
    await activate(base, dir);
    await watcherSettled();
    const read = () => usedBy(base, join(dir, "public/a.png"));
    expect(await read()).toEqual(["pages/one.json"]);

    writeFileSync(join(dir, "pages/two.json"), USES);
    await settlesOn(read, ["pages/one.json", "pages/two.json"]);
  });

  test("across a project changing while another was active", async () => {
    const root = join(scratch, "switching-root");
    const first = join(scratch, "switching-first");
    const second = join(scratch, "switching-second");
    mkdirSync(root, { recursive: true });
    project(first);
    project(second);
    const base = await serve(root, [first, second]);
    await activate(base, first);
    const read = () => usedBy(base, join(first, "public/a.png"));
    expect(await read()).toEqual(["pages/one.json"]);

    await activate(base, second);
    writeFileSync(join(first, "pages/two.json"), USES);
    await activate(base, first);

    expect(await read()).toEqual(["pages/one.json", "pages/two.json"]);
    // Re-activating what is already active, and deactivating, are both quiet.
    await activate(base, first);
    await activate(base, null);
  });

  test("for a project in a folder the server's own watcher ignores", async () => {
    const root = join(scratch, "ignored-root");
    const dir = join(root, ".cache/probe");
    project(dir);
    const base = await serve(root);
    await activate(base, dir);
    await watcherSettled();
    const read = () => usedBy(base, ".cache/probe/public/a.png");
    expect(await read()).toEqual(["pages/one.json"]);

    writeFileSync(join(dir, "pages/two.json"), USES);
    await settlesOn(read, ["pages/one.json", "pages/two.json"]);
  });
});

describe("Studio hears about a project the server's own watcher cannot see", () => {
  test("outside the server root, under the spelling Studio activated it by", async () => {
    const root = join(scratch, "live-outside-root");
    const dir = join(scratch, "live-outside-project");
    mkdirSync(root, { recursive: true });
    project(dir);
    const base = await serve(root, [dir]);
    const { paths, stop } = await fsEventPaths(base);
    await activate(base, `${dir}/`);
    await watcherSettled();

    writeFileSync(join(dir, "pages/new.json"), CLEAN);

    await sawEvent(paths, `${dir}/pages/new.json`);
    stop();
  });

  test("in a folder the server's watcher ignores, under a relative spelling", async () => {
    const root = join(scratch, "live-ignored-root");
    const dir = join(root, "dist/probe");
    project(dir);
    const base = await serve(root);
    const { paths, stop } = await fsEventPaths(base);
    await activate(base, "dist/probe");
    await watcherSettled();

    writeFileSync(join(dir, "pages/new.json"), CLEAN);

    await sawEvent(paths, "dist/probe/pages/new.json");
    stop();
  });

  test("a project the server's watcher can see is reported once, by that watcher", async () => {
    const root = join(scratch, "live-below-root");
    const dir = join(root, "sites/probe");
    project(dir);
    const base = await serve(root);
    await watcherSettled();
    const { paths, stop } = await fsEventPaths(base);
    await activate(base, "sites/probe");

    writeFileSync(join(dir, "pages/new.json"), CLEAN);

    await sawEvent(paths, "sites/probe/pages/new.json");
    await Bun.sleep(150);
    expect(paths.filter((path) => path === "sites/probe/pages/new.json")).toHaveLength(1);
    stop();
  });

  test("a project below the root activated by its absolute path hears it under that path", async () => {
    const root = join(scratch, "live-absolute-root");
    const dir = join(root, "sites/probe");
    project(dir);
    mkdirSync(join(root, "other"), { recursive: true });
    const base = await serve(root);
    await watcherSettled();
    const { paths, stop } = await fsEventPaths(base);
    await activate(base, dir);

    writeFileSync(join(dir, "pages/new.json"), CLEAN);
    await sawEvent(paths, `${dir}/pages/new.json`);

    // Anything else under the root keeps its root-relative name, for a Studio holding that project.
    writeFileSync(join(root, "other/note.json"), CLEAN);
    await sawEvent(paths, "other/note.json");
    stop();
  });
});
