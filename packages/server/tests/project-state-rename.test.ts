/**
 * The rename cascade (`specs/project-state.md` §9) on the project state host: the plan, the
 * dirty-referrer policies, a partial graph with and without the client's rewrites, and the outbox's
 * rollback on a failure at each step, on a referrer that changed between planning and applying, and
 * on an undo that cannot be made. Observations are delivered by a fake watcher, so nothing races
 * the assertions.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as nodeFs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { contentHash } from "@jxsuite/protocol/project-state";
import type {
  ProjectEvent,
  RenameApplied,
  RenameOperation,
  RenameOperationResult,
} from "@jxsuite/protocol/project-state";
import type { JsonValue } from "@jxsuite/schema/types";
import { FormatEntry, FormatRegistry } from "@jxsuite/schema/format-registry";
import type { FormatHostIO } from "@jxsuite/schema/format-registry";
import { createProjectStateHost } from "../src/project-state/host.ts";
import { findReferences } from "../src/refactor/find-refs.ts";
import type {
  ProjectStateFs,
  ProjectStateHostOptions,
  ProjectWatcherFactory,
} from "../src/project-state/host.ts";
import type { ProjectFormats } from "../src/project-state/host-deps.ts";

type Host = Awaited<ReturnType<typeof createProjectStateHost>>;

const json = (value: JsonValue): string => `${JSON.stringify(value, null, 2)}\n`;

const roots: string[] = [];
const hosts: Host[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.close();
  }
  for (const root of roots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

/** The project every case starts from: a media file, a component, their referrers. */
const FILES = {
  "components/my-card.json": json({ children: [{ tagName: "slot" }], tagName: "my-card" }),
  "data/items.json": json([{ id: 1 }]),
  "media/logo.png": "png",
  "pages/about.json": json({
    children: [{ tagName: "my-card" }, { src: "../media/logo.png", tagName: "img" }],
    tagName: "main",
  }),
  "pages/home.json": json({
    children: [{ src: "../media/logo.png", tagName: "img" }],
    tagName: "main",
  }),
  "pages/index.json": json({ tagName: "main", textContent: "Home" }),
  "project.json": json({ name: "Fixture" }),
} satisfies Record<string, string>;

async function project(files: Record<string, string> = FILES): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "jx-rename-"));
  roots.push(base);
  const root = join(base, "project");
  await mkdir(root, { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

/** A watcher that reports nothing: every event in a case is the host's own. */
const silentWatcher: ProjectWatcherFactory = () => ({
  close: () => Promise.resolve(),
  ready: Promise.resolve(),
});

/** No formats beyond the native ones. */
const noFormats = (): Promise<ProjectFormats> =>
  Promise.resolve({ extensions: [], mounts: [], parse: () => Promise.reject(new Error("none")) });

async function start(
  root: string,
  options: Partial<ProjectStateHostOptions> = {},
): Promise<{ host: Host; events: ProjectEvent[] }> {
  const host = await createProjectStateHost({
    extensions: noFormats,
    git: false,
    installed: () => Promise.resolve(true),
    onError: () => {},
    root,
    watcher: silentWatcher,
    ...options,
  });
  hosts.push(host);
  await host.idle(0);
  const events: ProjectEvent[] = [];
  host.subscribe({}, { events: (batch) => events.push(...batch) });
  return { events, host };
}

let serial = 0;
const operation = (overrides: Partial<RenameOperation> = {}): RenameOperation => {
  serial += 1;
  return {
    dirtyReferrers: [],
    from: "media/logo.png",
    opId: `op-${serial}`,
    policy: "rewrite-buffer",
    to: "media/brand.png",
    ...overrides,
  };
};

const text = (root: string, path: string): Promise<string> => readFile(join(root, path), "utf8");

/** Every file under `root`, by path, as text, for comparing a project before and after. */
async function tree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await nodeFs.readdir(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), path);
      } else {
        out[path] = await readFile(join(dir, entry.name), "utf8");
      }
    }
  };
  await walk(root, "");
  return out;
}

/** The result as applied, failing the case when it was refused. */
function applied(result: RenameOperationResult): RenameApplied {
  if (!result.ok) {
    throw new Error(`refused: ${result.reason}: ${result.message}`);
  }
  return result;
}

describe("a rename that completes", () => {
  test("moves the file, rewrites every referrer through the graph, then says so", async () => {
    const root = await project();
    const { events, host } = await start(root);
    const logo = host.docIdAt("media/logo.png");
    const op = operation();
    const result = applied(await host.rename(op));
    expect(result.files).toEqual(["media/brand.png", "pages/about.json", "pages/home.json"]);
    expect(result.references).toEqual({
      files: [
        { count: 1, path: "pages/about.json" },
        { count: 1, path: "pages/home.json" },
      ],
      filesChanged: 2,
      refsUpdated: 2,
    });
    expect(result.isDir).toBe(false);
    expect(result.errors).toEqual([]);
    expect(await text(root, "pages/about.json")).toContain("../media/brand.png");
    expect(host.docIdAt("media/brand.png")).toBe(logo);
    expect(host.docIdAt("media/logo.png")).toBe(null);
    const renamed = events.find((event) => event.type === "fileRenamed");
    expect(renamed).toMatchObject({ from: "media/logo.png", origin: { writeId: `${op.opId}:0` } });
    const last = events.at(-1);
    expect(last).toMatchObject({ opId: op.opId, type: "operationApplied" });
    expect(last?.rev).toBe(result.rev);
    expect(
      events
        .filter((event) => event.type === "fileChanged")
        .map((event) => (event.origin === "external" ? null : event.origin.writeId)),
    ).toEqual([`${op.opId}:1`, `${op.opId}:2`]);
  });

  test("renames a component's tag with its file, everywhere it is used", async () => {
    const root = await project();
    const { host } = await start(root);
    const result = applied(
      await host.rename(
        operation({ from: "components/my-card.json", to: "components/my-badge.json" }),
      ),
    );
    expect(result.tag).toEqual({
      filesChanged: 2,
      from: "my-card",
      refsUpdated: 2,
      to: "my-badge",
    });
    expect(await text(root, "components/my-badge.json")).toContain('"my-badge"');
    expect(await text(root, "pages/about.json")).toContain('"my-badge"');
    // The moved file is also rewritten (its own tag), and is still named once, first.
    expect(result.files[0]).toBe("components/my-badge.json");
    expect(result.files.filter((path) => path === "components/my-badge.json")).toHaveLength(1);
  });

  test("leaves a component's tag when the new name is no custom element name", async () => {
    const root = await project();
    const { host } = await start(root);
    const result = applied(
      await host.rename(operation({ from: "components/my-card.json", to: "components/card.json" })),
    );
    expect(result.tagSkipped).toContain("not a valid custom-element name");
    expect(result.tag).toBeUndefined();
  });

  test("moves a directory, keeping every id beneath it", async () => {
    const root = await project();
    const { events, host } = await start(root);
    const logo = host.docIdAt("media/logo.png");
    const result = applied(await host.rename(operation({ from: "media", to: "assets/media" })));
    expect(result.isDir).toBe(true);
    expect(host.docIdAt("assets/media/logo.png")).toBe(logo);
    expect(await text(root, "pages/home.json")).toContain("../assets/media/logo.png");
    expect(events.find((event) => event.type === "fileRenamed")).toMatchObject({ isDir: true });
  });

  test("reclassifies a file the move takes to another kind's directory", async () => {
    const root = await project();
    const { events, host } = await start(root);
    applied(await host.rename(operation({ from: "data/items.json", to: "pages/items.json" })));
    expect(
      events.find((event) => event.type === "docChanged" && event.path === "pages/items.json"),
    ).toMatchObject({ kind: "page" });
  });

  test("names a document that does not parse, and one it cannot write, in the report", async () => {
    const root = await project({
      ...FILES,
      "content/post.note": "note",
      "pages/broken.json": "{ not json",
    });
    const { host } = await start(root, {
      extensions: () =>
        Promise.resolve({
          extensions: [".note"],
          mounts: [],
          parse: () => Promise.resolve({ src: "../media/logo.png", tagName: "img" }),
        }),
    });
    const result = applied(await host.rename(operation()));
    expect(result.errors.map((entry) => entry.path).toSorted()).toEqual([
      "content/post.note",
      "pages/broken.json",
    ]);
    expect(result.errors.find((entry) => entry.path === "content/post.note")?.error).toContain(
      "No serializer",
    );
  });

  test("rewrites a document in a registered format through the format's registry", async () => {
    const root = await project({
      ...FILES,
      "content/post.note": JSON.stringify({ src: "../media/logo.png", tagName: "img" }),
    });
    // A real registry whose one format parses and serializes JSON under its own extension.
    const io: FormatHostIO = {
      importModule: () =>
        Promise.resolve({
          Note: {
            // SAFETY: JSON.parse without a reviver yields a JSON value.
            parse: (raw: string): JsonValue => JSON.parse(raw) as JsonValue,
            serialize: (doc: JsonValue): string => JSON.stringify(doc),
          },
        }),
      loadJson: () => Promise.reject(new Error("no JSON")),
      resolvePath: (_base, ref) => ref,
    };
    const registry = new FormatRegistry([
      new FormatEntry(
        "Note",
        "/virtual/Note.class.json",
        {
          $defs: {
            methods: {
              parse: { identifier: "parse", role: "parse", scope: "static" },
              serialize: { identifier: "serialize", role: "serialize", scope: "static" },
            },
          },
          $implementation: "./note.js",
          format: { extensions: [".note"] },
        },
        io,
      ),
    ]);
    const { host } = await start(root, {
      extensions: () =>
        Promise.resolve({
          extensions: [".note"],
          mounts: [],
          // SAFETY: JSON.parse without a reviver yields a JSON value.
          parse: (_extension, raw) => Promise.resolve(JSON.parse(raw) as JsonValue),
          registry,
        }),
    });
    const result = applied(await host.rename(operation()));
    expect(result.files).toContain("content/post.note");
    expect(await text(root, "content/post.note")).toContain("../media/brand.png");
  });

  test("names a referrer gone from disk behind the host, and renames a document that does not parse", async () => {
    const root = await project({
      ...FILES,
      "pages/broken.json": "{ not json",
      "pages/gone.json": json({ $ref: "./broken.json" }),
    });
    const { host } = await start(root);
    // The silent watcher never reports the removal, so the index still holds it.
    await rm(join(root, "pages/gone.json"));
    const result = applied(
      await host.rename(operation({ from: "pages/broken.json", to: "pages/fixed.json" })),
    );
    // Each named where it is after the move: the broken document at its new path.
    expect(result.errors.map((entry) => entry.path).toSorted()).toEqual([
      "pages/fixed.json",
      "pages/gone.json",
    ]);
    expect(result.errors.find((entry) => entry.path === "pages/gone.json")?.error).toContain(
      "gone",
    );
  });

  test("names a document that does not parse inside a moved directory at its new path", async () => {
    const root = await project({ ...FILES, "pages/blog/bad.json": "{ not json" });
    const { host } = await start(root);
    const result = applied(await host.rename(operation({ from: "pages/blog", to: "pages/news" })));
    expect(result.errors.map((entry) => entry.path)).toEqual(["pages/news/bad.json"]);
  });

  test("changes only the case of a name on a filesystem that ignores case", async () => {
    const root = await project();
    // A case-insensitive disk: any spelling of the logo stats as the logo itself.
    const fs: ProjectStateFs = {
      ...nodeFs,
      stat: (path) =>
        nodeFs.stat(
          String(path).toLowerCase().endsWith("media/logo.png")
            ? join(root, "media/logo.png")
            : path,
        ),
    };
    const { host } = await start(root, { fs });
    const logo = host.docIdAt("media/logo.png");
    const result = applied(await host.rename(operation({ to: "media/Logo.png" })));
    expect(result.to).toBe("media/Logo.png");
    expect(host.docIdAt("media/Logo.png")).toBe(logo);
    expect(await text(root, "pages/home.json")).toContain("../media/Logo.png");
  });

  test("a case-only rename onto another file is still refused", async () => {
    const root = await project({ ...FILES, "media/Logo.png": "other" });
    const { host } = await start(root);
    const result = await host.rename(operation({ to: "media/Logo.png" }));
    expect(result).toMatchObject({ ok: false, reason: "conflict" });
  });

  test("drops the usage query's cache, so the next question sees the new name", async () => {
    const root = await project();
    const { host } = await start(root);
    const ask = () =>
      findReferences({ path: "media/brand.png", registry: new FormatRegistry([]), root });
    const before = await ask();
    expect(before.filesReferencing).toBe(0);
    applied(await host.rename(operation()));
    const after = await ask();
    expect(after.filesReferencing).toBe(2);
  });

  test("plans an unindexed file too large to read without refusing the rename", async () => {
    const big = "x".repeat(2048);
    const root = await project({ ...FILES, "assets/model.glb": big });
    const { host } = await start(root, { readLimitBytes: 1024 });
    const result = applied(await host.rename(operation()));
    expect(result.references.filesChanged).toBe(2);
  });

  test("renames in a project whose dependencies are not installed", async () => {
    const root = await project({ ...FILES, "content/post.md": "![](../media/logo.png)\n" });
    const { host } = await start(root, { installed: () => Promise.resolve(false) });
    expect(host.readiness).toBe("scaffolded");
    const result = applied(await host.rename(operation()));
    expect(result.references.filesChanged).toBe(2);
    // No format is registered, so no host could read the note: it is not a document here.
    expect(await text(root, "content/post.md")).toContain("logo.png");
  });

  test("loads the project's parsers before planning when it had not yet", async () => {
    const root = await project({ ...FILES, "content/post.md": "![](../media/logo.png)\n" });
    let installed = false;
    const { host } = await start(root, { installed: () => Promise.resolve(installed) });
    installed = true;
    const result = applied(await host.rename(operation()));
    expect(host.readiness).toBe("ready");
    expect(result.references.filesChanged).toBe(2);
  });

  test("a moved file that cannot be read is still moved, and the failure reported", async () => {
    const root = await project();
    const failures: Error[] = [];
    const fs: ProjectStateFs = {
      ...nodeFs,
      open: (path) =>
        String(path).endsWith("brand.png")
          ? Promise.reject(new Error("EACCES"))
          : nodeFs.open(path),
    };
    const { host } = await start(root, { fs, onError: (error) => failures.push(error) });
    applied(await host.rename(operation()));
    expect(failures.map((error) => error.message)).toContain("EACCES");
    expect(host.docIdAt("media/brand.png")).not.toBe(null);
  });

  test("walks every document when the graph cannot answer", async () => {
    const root = await project();
    const { host } = await start(root, { hold: true });
    const result = applied(await host.rename(operation()));
    expect(result.references.filesChanged).toBe(2);
  });
});

describe("dirty referrers (§9.2)", () => {
  test("refuse stops the rename before any step, naming the referrer", async () => {
    const root = await project();
    const before = await tree(root);
    const { events, host } = await start(root);
    const at = events.length;
    const result = await host.rename(
      operation({ dirtyReferrers: [{ bufferRev: 3, path: "pages/about.json" }], policy: "refuse" }),
    );
    expect(result).toMatchObject({
      ok: false,
      paths: ["pages/about.json"],
      reason: "dirty-referrers",
    });
    expect(await tree(root)).toEqual(before);
    expect(events.length).toBe(at);
  });

  test("rewrite-buffer leaves the file on disk and hands the client its rewrite", async () => {
    const root = await project();
    const { host } = await start(root);
    const before = await text(root, "pages/about.json");
    const result = applied(
      await host.rename(
        operation({
          dirtyReferrers: [{ bufferRev: 3, path: "pages/about.json" }],
          from: "components/my-card.json",
          to: "components/my-badge.json",
        }),
      ),
    );
    expect(await text(root, "pages/about.json")).toBe(before);
    expect(result.buffers).toEqual([
      {
        bufferRev: 3,
        changes: [],
        path: "pages/about.json",
        tag: { from: "my-card", to: "my-badge" },
      },
    ]);
    const moved = applied(
      await host.rename(operation({ dirtyReferrers: [{ bufferRev: 5, path: "pages/home.json" }] })),
    );
    expect(moved.buffers).toEqual([
      {
        bufferRev: 5,
        changes: [{ from: "../media/logo.png", to: "../media/brand.png" }],
        path: "pages/home.json",
      },
    ]);
  });

  test("rewrite-buffer leaves a dirty document's client rewrite to the client", async () => {
    const root = await project();
    const { host } = await start(root);
    const before = await text(root, "pages/home.json");
    const baseHash = await contentHash(FILES["pages/home.json"]);
    const result = applied(
      await host.rename(
        operation({
          dirtyReferrers: [{ bufferRev: 4, path: "pages/home.json" }],
          rewrites: [
            {
              baseHash,
              contents: "{}\n",
              path: "pages/home.json",
            },
          ],
        }),
      ),
    );
    expect(await text(root, "pages/home.json")).toBe(before);
    expect(result.buffers).toEqual([{ bufferRev: 4, changes: [], path: "pages/home.json" }]);
    expect(result.files).not.toContain("pages/home.json");
  });

  test("refuse also covers a client rewrite of a dirty document", async () => {
    const root = await project();
    const { host } = await start(root);
    const result = await host.rename(
      operation({
        dirtyReferrers: [{ bufferRev: 1, path: "pages/index.json" }],
        policy: "refuse",
        rewrites: [
          {
            baseHash: await contentHash(FILES["pages/index.json"]!),
            contents: "{}",
            path: "pages/index.json",
          },
        ],
      }),
    );
    expect(result).toMatchObject({ paths: ["pages/index.json"], reason: "dirty-referrers" });
  });
});

describe("a partial graph (§8.2, §9.1)", () => {
  /** A held host has not loaded its extensions, so a `.md` document is one it cannot parse. */
  const partial = async () => {
    const root = await project({ ...FILES, "content/post.md": "![](../media/logo.png)\n" });
    return { root, ...(await start(root, { hold: true })) };
  };

  test("refuses a rename without the client's rewrites, naming what it cannot parse", async () => {
    const { host, root } = await partial();
    const before = await tree(root);
    const result = await host.rename(operation());
    expect(result).toMatchObject({
      ok: false,
      paths: ["content/post.md"],
      reason: "rewrites-required",
    });
    expect(await tree(root)).toEqual(before);
  });

  test("applies the client's rewrites as steps of the same outbox", async () => {
    const { host, root } = await partial();
    const postHash = await contentHash("![](../media/logo.png)\n");
    const result = applied(
      await host.rename(
        operation({
          rewrites: [
            {
              baseHash: postHash,
              contents: "![](../media/brand.png)\n",
              path: "content/post.md",
            },
          ],
        }),
      ),
    );
    expect(result.files).toContain("content/post.md");
    expect(await text(root, "content/post.md")).toBe("![](../media/brand.png)\n");
    // Counted as a file it changed, though the host did not count its references.
    expect(result.references.files).toContainEqual({ count: 0, path: "content/post.md" });
    expect(result.references.filesChanged).toBe(3);
  });

  test("a client rewrite of a moved document lands at its new path", async () => {
    const root = await project({ ...FILES, "media/notes.md": "logo.png\n" });
    const { host } = await start(root, { hold: true });
    const notesHash = await contentHash("logo.png\n");
    const result = applied(
      await host.rename(
        operation({
          from: "media",
          rewrites: [
            {
              baseHash: notesHash,
              contents: "moved\n",
              path: "media/notes.md",
            },
          ],
          to: "assets",
        }),
      ),
    );
    expect(result.files).toContain("assets/notes.md");
    expect(await text(root, "assets/notes.md")).toBe("moved\n");
  });
});

describe("refusals before any step", () => {
  test.each([
    [{ from: "media", to: "media/inner" }, "failed"],
    [{ from: "project.json", to: "other.json" }, "failed"],
    [{ from: "pages/about.json", to: "package.json" }, "failed"],
    [{ from: "media/gone.png", to: "media/x.png" }, "conflict"],
    [{ from: "media/logo.png", to: "pages/index.json" }, "conflict"],
  ] as const)("%o is refused as %s", async (paths, reason) => {
    const root = await project();
    const before = await tree(root);
    const { host } = await start(root);
    const result = await host.rename(operation(paths));
    expect(result).toMatchObject({ ok: false, reason });
    expect(await tree(root)).toEqual(before);
  });
});

describe("the outbox rolls back (§9.1)", () => {
  test.each([0, 1, 2])("a failure at step %i leaves every file as it was", async (step) => {
    const root = await project();
    const before = await tree(root);
    const { events, host } = await start(root, {
      onRenameStep: (at) => {
        if (at === step) {
          throw new Error("injected");
        }
      },
    });
    const logo = host.docIdAt("media/logo.png");
    const op = operation();
    const result = await host.rename(op);
    expect(result).toMatchObject({
      ok: false,
      paths: [step === 0 ? "media/brand.png" : expect.any(String)],
      reason: "failed",
    });
    expect(result.ok ? "" : result.message).toContain("Nothing was changed");
    expect(await tree(root)).toEqual(before);
    expect(host.docIdAt("media/logo.png")).toBe(logo);
    expect(events.some((event) => event.type === "operationApplied")).toBe(false);
    if (step > 0) {
      expect(
        events.some(
          (event) =>
            event.origin !== "external" && event.origin.writeId === `${op.opId}:rollback:0`,
        ),
      ).toBe(true);
    }
  });

  test("a referrer changed between planning and applying fails its step and rolls back", async () => {
    const root = await project();
    const { host } = await start(root, {
      onRenameStep: async (at) => {
        if (at === 2) {
          await writeFile(join(root, "pages/home.json"), json({ tagName: "main" }));
        }
      },
    });
    const result = await host.rename(operation());
    expect(result).toMatchObject({ ok: false, paths: ["pages/home.json"], reason: "conflict" });
    expect(await text(root, "pages/about.json")).toContain("../media/logo.png");
    expect(await text(root, "media/logo.png")).toBe("png");
  });

  test("an undo that cannot be made is named in the refusal", async () => {
    const root = await project();
    const { host } = await start(root, {
      onRenameStep: async (at) => {
        if (at === 2) {
          // The first rewrite is changed again behind the host, so restoring it is refused.
          await writeFile(join(root, "pages/about.json"), "{}\n");
          throw new Error("injected");
        }
      },
    });
    const result = await host.rename(operation());
    expect(result.ok ? "" : result.message).toContain("could not be undone");
    expect(result.ok ? "" : result.message).toContain("pages/about.json");
    expect(result).toMatchObject({ ok: false, unrestored: ["pages/about.json"] });
  });

  test("a move whose undo fails names its destination as unrestored", async () => {
    const root = await project();
    const fs: ProjectStateFs = {
      ...nodeFs,
      rename: (from, to) =>
        from.endsWith("brand.png") ? Promise.reject(new Error("EBUSY")) : nodeFs.rename(from, to),
    };
    const { host } = await start(root, {
      fs,
      onRenameStep: (at) => {
        if (at === 1) {
          throw new Error("injected");
        }
      },
    });
    const result = await host.rename(operation());
    expect(result).toMatchObject({ ok: false, unrestored: ["media/brand.png"] });
    expect(await text(root, "media/brand.png")).toBe("png");
  });

  test("a rollback removes the directories the move created", async () => {
    const root = await project();
    const before = await tree(root);
    const { host } = await start(root, {
      onRenameStep: (at) => {
        if (at === 1) {
          throw new Error("injected");
        }
      },
    });
    const result = await host.rename(operation({ to: "new/deep/brand.png" }));
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(result.ok ? "" : result.message).toContain("Nothing was changed");
    expect(result).not.toHaveProperty("unrestored");
    expect(await tree(root)).toEqual(before);
    expect(await nodeFs.stat(join(root, "new")).catch(() => null)).toBe(null);
    expect(host.docIdAt("new")).toBe(null);
    expect(host.docIdAt("new/deep")).toBe(null);
  });

  test("a rollback keeps a created directory something else has filled since", async () => {
    const root = await project();
    const { host } = await start(root, {
      onRenameStep: async (at) => {
        if (at === 1) {
          await writeFile(join(root, "new/other.txt"), "kept");
          throw new Error("injected");
        }
      },
    });
    const result = await host.rename(operation({ to: "new/deep/brand.png" }));
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(await text(root, "new/other.txt")).toBe("kept");
    expect(await nodeFs.stat(join(root, "new/deep")).catch(() => null)).toBe(null);
  });

  test("a move the filesystem refuses fails the operation with nothing changed", async () => {
    const root = await project();
    const before = await tree(root);
    const fs: ProjectStateFs = {
      ...nodeFs,
      rename: (from, to) =>
        from.endsWith("logo.png") ? Promise.reject(new Error("EBUSY")) : nodeFs.rename(from, to),
    };
    const { host } = await start(root, { fs });
    const result = await host.rename(operation());
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(result.ok ? "" : result.message).toContain("EBUSY");
    expect(await tree(root)).toEqual(before);
  });

  test("a destination taken after planning fails the move", async () => {
    const root = await project();
    const { host } = await start(root, {
      onRenameStep: async (at) => {
        if (at === 0) {
          await writeFile(join(root, "media/brand.png"), "taken");
        }
      },
    });
    const result = await host.rename(operation());
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(await text(root, "media/brand.png")).toBe("taken");
    expect(await text(root, "media/logo.png")).toBe("png");
  });
});
