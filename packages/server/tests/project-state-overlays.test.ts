/**
 * The live preview overlay keyed by document and client (`specs/project-state.md` §11.3): it
 * follows a rename, drops on a removal, survives its client's socket for the grace period, and an
 * anonymous subscription's overlays end with it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { ProjectEvent } from "@jxsuite/protocol/project-state";
import { createOverlayRegistry, OVERLAY_GRACE_MS } from "../src/project-state/overlays.ts";
import type { OverlayRegistry } from "../src/project-state/overlays.ts";

/** What a reader sees at each path, as the registry published it. */
function harness(graceMs?: number) {
  const shown = new Map<string, string>();
  const log: string[] = [];
  const registry = createOverlayRegistry({
    ...(graceMs !== undefined && { graceMs }),
    publish: (path, contents) => {
      shown.set(path, contents);
      log.push(`+${path}`);
    },
    unpublish: (path) => {
      shown.delete(path);
      log.push(`-${path}`);
    },
  });
  opened.push(registry);
  return { log, registry, shown };
}

const opened: OverlayRegistry[] = [];
afterEach(() => {
  for (const registry of opened.splice(0)) {
    registry.close();
  }
});

const A = { clientId: "window-a" };
const B = { clientId: "window-b" };

const renamed = (docId: string, from: string, to: string, isDir = false): ProjectEvent => ({
  docId,
  from,
  isDir,
  origin: "external",
  rev: 1,
  to,
  type: "fileRenamed",
});

const removed = (docId: string, path: string, isDir = false): ProjectEvent => ({
  docId,
  isDir,
  origin: "external",
  path,
  rev: 2,
  type: "fileRemoved",
});

describe("the overlay registry", () => {
  test("the newest overlay of a document is what a reader sees, and clearing it shows the other", () => {
    const { registry, shown } = harness();
    registry.set(A, "d1", "pages/a.json", "from a");
    registry.set(B, "d1", "pages/a.json", "from b");
    expect(shown.get("pages/a.json")).toBe("from b");
    registry.clear(B, "d1");
    expect(shown.get("pages/a.json")).toBe("from a");
    registry.clear(B, "d1");
    registry.clear(A, "missing");
    registry.clear(A, "d1");
    expect(shown.has("pages/a.json")).toBe(false);
    expect(registry.published()).toEqual([]);
  });

  test("a rename keeps the overlay at the new path, a directory move moves what is beneath it", () => {
    const { log, registry, shown } = harness();
    registry.set(A, "d1", "pages/a.json", "a");
    registry.set(A, "d2", "pages/blog/b.json", "b");
    registry.apply([renamed("d1", "pages/a.json", "pages/home.json")]);
    expect(shown.get("pages/home.json")).toBe("a");
    expect(shown.has("pages/a.json")).toBe(false);
    registry.apply([renamed("dir", "pages/blog", "pages/posts", true)]);
    expect(shown.get("pages/posts/b.json")).toBe("b");
    expect(registry.published()).toEqual([
      { docId: "d1", path: "pages/home.json" },
      { docId: "d2", path: "pages/posts/b.json" },
    ]);
    // Set again under the new path by a client that learned of the move: nothing is left behind.
    registry.set(A, "d1", "pages/index.json", "a2");
    expect([...shown.keys()].toSorted()).toEqual(["pages/index.json", "pages/posts/b.json"]);
    expect(log).toContain("-pages/home.json");
  });

  test("a removal drops the document's overlay, a directory's drops everything beneath it", () => {
    const { registry, shown } = harness();
    registry.set(A, "d1", "pages/a.json", "a");
    registry.set(A, "d2", "pages/blog/b.json", "b");
    registry.set(A, "d3", "pages/blog/c.json", "c");
    registry.apply([removed("d1", "pages/a.json")]);
    expect(shown.has("pages/a.json")).toBe(false);
    registry.apply([removed("dir", "pages/blog", true), removed("other", "x.json")]);
    expect(shown.size).toBe(0);
    expect(registry.published()).toEqual([]);
  });

  test("a removal also matches by path: an id from before the host knew it, or an earlier epoch", () => {
    const { registry, shown } = harness();
    registry.set(A, "path:pages/a.json", "pages/a.json", "a");
    registry.set(A, "old-epoch-id", "pages/b.json", "b");
    registry.apply([removed("real-id", "pages/a.json"), removed("new-epoch-id", "pages/b.json")]);
    expect(shown.size).toBe(0);
    expect(registry.published()).toEqual([]);
  });

  test("adopting hands a layer to another owner, keeping what readers see", () => {
    const { registry, shown } = harness();
    const shared = { anonymous: "unsubscribed" };
    const socket = { anonymous: "socket-1" };
    registry.set(shared, "d1", "pages/a.json", "mine");
    registry.set(B, "d1", "pages/a.json", "b's");
    registry.set(shared, "d2", "pages/b.json", "older");
    registry.set(socket, "d2", "pages/b.json", "newer");
    registry.set(socket, "d3", "pages/c.json", "socket's");
    registry.set(shared, "d3", "pages/c.json", "shared");
    registry.adopt(shared, socket, ["d1", "d2", "d3", "missing"]);
    expect([...shown]).toEqual([
      ["pages/a.json", "b's"],
      ["pages/b.json", "newer"],
      ["pages/c.json", "shared"],
    ]);
    // The shared owner holds nothing now; the socket owns each layer it adopted.
    registry.clear(shared);
    expect(shown.size).toBe(3);
    registry.clear(B, "d1");
    expect(shown.get("pages/a.json")).toBe("mine");
    registry.clear(socket);
    expect(shown.size).toBe(0);
  });

  test("a client's overlays outlive its subscription for the grace, and a return keeps them", async () => {
    const { registry, shown } = harness(20);
    registry.opened(A);
    registry.opened(A);
    registry.set(A, "d1", "pages/a.json", "a");
    registry.closed(A);
    registry.closed(A);
    registry.opened(A);
    await Bun.sleep(40);
    expect(shown.get("pages/a.json")).toBe("a");
    registry.closed(A);
    registry.closed(A);
    await Bun.sleep(40);
    expect(shown.has("pages/a.json")).toBe(false);
  });

  test("an anonymous subscription's overlays end with it", () => {
    const { registry, shown } = harness();
    const anonymous = { anonymous: "socket-1" };
    registry.opened(anonymous);
    registry.set(anonymous, "d1", "pages/a.json", "a");
    registry.set(A, "d2", "pages/b.json", "b");
    registry.closed(anonymous);
    expect(shown.has("pages/a.json")).toBe(false);
    registry.clear(A);
    expect(shown.size).toBe(0);
  });

  test("closing cancels a pending grace and keeps what is published", async () => {
    const { registry, shown } = harness(10);
    registry.opened(A);
    registry.set(A, "d1", "pages/a.json", "a");
    registry.closed(A);
    registry.close();
    // A subscription that ends after the close arms no grace either.
    registry.opened(B);
    registry.set(B, "d2", "pages/b.json", "b");
    registry.closed(B);
    await Bun.sleep(30);
    expect(shown.get("pages/a.json")).toBe("a");
    expect(shown.get("pages/b.json")).toBe("b");
  });

  test("clearAll unpublishes everything, and the default grace is thirty seconds", () => {
    const { registry, shown } = harness();
    registry.set(A, "d1", "pages/a.json", "a");
    registry.set(B, "d2", "pages/b.json", "b");
    registry.clearAll();
    expect(shown.size).toBe(0);
    expect(OVERLAY_GRACE_MS).toBe(30_000);
  });
});
