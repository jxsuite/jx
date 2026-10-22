import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileGrantStore, openFolderGrants } from "../src/electron-shell/folder-grants";
import type { Grant } from "../src/electron-shell/folder-grants";

/** An in-memory store, and the bookmarks Electron was asked to start using. */
function memory(initial: Grant[] = []) {
  const written: Grant[][] = [];
  const started: string[] = [];
  return {
    started,
    store: {
      read: () => initial,
      write: (grants: Grant[]) => {
        written.push([...grants]);
      },
    },
    written,
  };
}

describe("openFolderGrants", () => {
  test("restore starts every stored grant, so the backend spawned next inherits them", () => {
    const { started, store } = memory([
      { bookmark: "A", path: "/Users/u/site" },
      { bookmark: "B", path: "/Users/u/blog" },
    ]);
    const grants = openFolderGrants(store, (bookmark) => {
      started.push(bookmark);
      return () => {};
    });
    grants.restore();
    expect(started).toEqual(["A", "B"]);
    grants.restore();
    expect(started).toEqual(["A", "B"]);
  });

  test("a granted folder covers itself and what is inside it, and nothing beside it", () => {
    const { store } = memory([{ bookmark: "A", path: "/Users/u/site" }]);
    const grants = openFolderGrants(store, () => () => {});
    expect(grants.covers("/Users/u/site")).toBe(false);
    grants.restore();
    expect(grants.covers("/Users/u/site")).toBe(true);
    expect(grants.covers("/Users/u/site/pages/index.md")).toBe(true);
    expect(grants.covers("/Users/u/site-two")).toBe(false);
    expect(grants.covers("/Users/u")).toBe(false);
  });

  test("add stores the bookmark, starts it, and replaces an older one for the same folder", () => {
    const { started, store, written } = memory();
    const grants = openFolderGrants(store, (bookmark) => {
      started.push(bookmark);
      return () => {};
    });
    grants.add("/Users/u/site", "A");
    grants.add("/Users/u/site", "A2");
    expect(started).toEqual(["A", "A2"]);
    expect(written.at(-1)).toEqual([{ bookmark: "A2", path: "/Users/u/site" }]);
    expect(grants.covers("/Users/u/site/x")).toBe(true);
  });

  test("a bookmark that cannot be used is skipped and does not cover its folder", () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const { store } = memory([{ bookmark: "stale", path: "/Users/u/gone" }]);
    const grants = openFolderGrants(store, () => {
      throw new Error("bookmark is stale");
    });
    grants.restore();
    expect(grants.covers("/Users/u/gone")).toBe(false);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe("fileGrantStore", () => {
  function scratch() {
    const dir = mkdtempSync(join(tmpdir(), "grants-"));
    return { dir, file: join(dir, "nested", "grants.json") };
  }

  test("round-trips grants, creating the directory on the first write", () => {
    const { dir, file } = scratch();
    const store = fileGrantStore(file);
    expect(store.read()).toEqual([]);
    store.write([{ bookmark: "A", path: "/p" }]);
    expect(store.read()).toEqual([{ bookmark: "A", path: "/p" }]);
    rmSync(dir, { recursive: true });
  });

  test("treats a corrupt file, or a file of the wrong shape, as no grants", () => {
    const { dir } = scratch();
    const file = join(dir, "g.json");
    writeFileSync(file, "{ not json");
    expect(fileGrantStore(file).read()).toEqual([]);
    writeFileSync(file, JSON.stringify({ path: "/p" }));
    expect(fileGrantStore(file).read()).toEqual([]);
    writeFileSync(file, JSON.stringify([{ bookmark: "A", path: "/p" }, { path: 1 }, null]));
    expect(fileGrantStore(file).read()).toEqual([{ bookmark: "A", path: "/p" }]);
    rmSync(dir, { recursive: true });
  });

  test("reports a failed write and carries on", () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const { dir } = scratch();
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "a file where a directory is needed");
    fileGrantStore(join(blocker, "g.json")).write([{ bookmark: "A", path: "/p" }]);
    expect(quiet).toHaveBeenCalled();
    expect(readFileSync(blocker, "utf8")).toContain("a file");
    quiet.mockRestore();
    rmSync(dir, { recursive: true });
  });
});
