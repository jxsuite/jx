/**
 * The pure half of the project state contract (`specs/project-state.md`): the hash spelling, echo
 * attribution, readiness order, the write precondition, the unsaved-buffer derivation, the replay
 * log and the subscribe answer. Every host runs these same functions, so a host's conformance suite
 * can assume them and test only what the host adds.
 */

import { describe, expect, test } from "bun:test";
import {
  DEPENDENCY_KIND_ORDER,
  ECHO_LEDGER_DEPTH,
  EVENT_LOG_CAPACITY,
  READINESS_ORDER,
  answerSubscribe,
  bufferStatus,
  checkDeletePrecondition,
  checkWritePrecondition,
  conflictEvent,
  contentHash,
  createEchoLedger,
  createMemoryEventLog,
  isBehindDisk,
  isContentHash,
  isOwnOrigin,
  readinessAtLeast,
} from "../src/project-state";
import * as protocol from "../src/index";
import type {
  ContentHash,
  DeleteRequest,
  DeleteResult,
  ProjectEventInit,
  ProjectSnapshot,
  WriteRequest,
} from "../src/project-state";

const H1: ContentHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const H2: ContentHash = "sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const H3: ContentHash = "sha256-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=";

const changed = (path: string, hash: ContentHash = H1): ProjectEventInit => ({
  type: "fileChanged",
  path,
  docId: `doc:${path}`,
  hash,
  origin: "external",
});

const EMPTY: ProjectSnapshot = { files: [], readiness: "ready", components: [], formats: "f0" };

describe("contentHash", () => {
  test("is SHA-256 in the sha256-<base64> spelling", async () => {
    // The SHA-256 of the empty input, as `openssl dgst -sha256 -binary | base64` prints it.
    expect(await contentHash("")).toBe("sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
  });

  test("hashes a string as its UTF-8 bytes", async () => {
    const text = "héllo\n";
    expect(await contentHash(text)).toBe(await contentHash(new TextEncoder().encode(text)));
  });

  test("hashes a WriteRequest's contents and a Node Buffer as they are, without a cast", async () => {
    const request: WriteRequest = {
      path: "a.json",
      contents: new TextEncoder().encode("{}"),
      baseHash: null,
      writeId: "w1",
    };
    expect(await contentHash(request.contents)).toBe(await contentHash("{}"));
    expect(await contentHash(Buffer.from("{}"))).toBe(await contentHash("{}"));
    const shared = new Uint8Array(new SharedArrayBuffer(2));
    shared.set([123, 125]);
    expect(await contentHash(shared)).toBe(await contentHash("{}"));
  });

  test("different bytes give different hashes, and every one is well formed", async () => {
    const a = await contentHash("a");
    const b = await contentHash("b");
    expect(a).not.toBe(b);
    expect(isContentHash(a)).toBe(true);
    expect(isContentHash(b)).toBe(true);
  });
});

describe("isContentHash", () => {
  test("refuses anything that is not the exact spelling", () => {
    expect(isContentHash(H1)).toBe(true);
    expect(isContentHash("sha256-short=")).toBe(false);
    expect(isContentHash("sha384-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=")).toBe(false);
    expect(isContentHash("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=")).toBe(false);
    expect(isContentHash(42)).toBe(false);
    expect(isContentHash(null)).toBe(false);
  });
});

describe("isOwnOrigin", () => {
  test("matches a write this client issued, never an external change", () => {
    const mine = new Set(["w1"]);
    expect(isOwnOrigin({ writeId: "w1", writeHash: H1 }, mine)).toBe(true);
    expect(isOwnOrigin({ writeId: "w2", writeHash: H1 }, mine)).toBe(false);
    expect(isOwnOrigin("external", mine)).toBe(false);
  });
});

describe("createEchoLedger", () => {
  test("attributes an observed hash to the write that produced it, once", () => {
    const ledger = createEchoLedger();
    ledger.note("a.json", H1, "w1");
    expect(ledger.attribute("a.json", H1)).toEqual({ writeId: "w1", writeHash: H1 });
    expect(ledger.pending()).toEqual([]);
    // The same bytes arriving again (an editor saving the identical file) are not ours.
    expect(ledger.attribute("a.json", H1)).toBe("external");
  });

  test("an unknown hash is external and clears the path's pending writes", () => {
    const ledger = createEchoLedger();
    ledger.note("a.json", H1, "w1");
    expect(ledger.attribute("a.json", H2)).toBe("external");
    expect(ledger.pending()).toEqual([]);
    // A later external change that restores w1's bytes (a `git checkout`) is not w1's echo.
    expect(ledger.attribute("a.json", H1)).toBe("external");
  });

  test("a coalesced event that shows only the last write consumes the older ones", () => {
    const ledger = createEchoLedger();
    ledger.note("a.json", H1, "w1");
    ledger.note("a.json", H2, "w2");
    ledger.note("a.json", H3, "w3");
    expect(ledger.attribute("a.json", H2)).toEqual({ writeId: "w2", writeHash: H2 });
    expect(ledger.pending()).toEqual(["a.json"]);
    expect(ledger.attribute("a.json", H3)).toEqual({ writeId: "w3", writeHash: H3 });
    expect(ledger.pending()).toEqual([]);
  });

  test("a later write of the same bytes is the one attributed", () => {
    const ledger = createEchoLedger();
    ledger.note("a.json", H1, "w1");
    ledger.note("a.json", H1, "w2");
    expect(ledger.attribute("a.json", H1)).toEqual({ writeId: "w2", writeHash: H1 });
    expect(ledger.pending()).toEqual([]);
  });

  test("paths are independent, and a removal is never an echo", () => {
    const ledger = createEchoLedger();
    ledger.note("a.json", H1, "w1");
    expect(ledger.attribute("b.json", H1)).toBe("external");
    expect(ledger.pending()).toEqual(["a.json"]);
    expect(ledger.attribute("a.json", null)).toBe("external");
    expect(ledger.pending()).toEqual([]);
  });

  test("forget drops a path's pending writes", () => {
    const ledger = createEchoLedger();
    ledger.note("a.json", H1, "w1");
    ledger.forget("a.json");
    expect(ledger.attribute("a.json", H1)).toBe("external");
  });

  test("keeps at most `depth` pending writes per path, dropping the oldest", () => {
    const ledger = createEchoLedger(2);
    ledger.note("a.json", H1, "w1");
    ledger.note("a.json", H2, "w2");
    ledger.note("a.json", H3, "w3");
    expect(ledger.attribute("a.json", H2)).toEqual({ writeId: "w2", writeHash: H2 });
    ledger.note("b.json", H1, "w4");
    ledger.note("b.json", H2, "w5");
    ledger.note("b.json", H3, "w6");
    // The oldest entry, w4, fell out of the window, so its bytes are not recognised.
    expect(ledger.attribute("b.json", H1)).toBe("external");
    expect(ECHO_LEDGER_DEPTH).toBeGreaterThan(1);
  });
});

describe("readiness", () => {
  test("the order is the documented one", () => {
    expect([...READINESS_ORDER]).toEqual([
      "scaffolded",
      "installed",
      "extensions-resolved",
      "indexed",
      "ready",
    ]);
  });

  test("readinessAtLeast compares by that order", () => {
    expect(readinessAtLeast("ready", "indexed")).toBe(true);
    expect(readinessAtLeast("indexed", "indexed")).toBe(true);
    expect(readinessAtLeast("installed", "extensions-resolved")).toBe(false);
  });
});

describe("checkWritePrecondition", () => {
  test("passes when the base is what is on disk", () => {
    expect(
      checkWritePrecondition({ path: "a.json", baseHash: H1 }, { hash: H1, docId: "d1" }),
    ).toBeNull();
    expect(
      checkWritePrecondition({ path: "new.json", baseHash: null }, { hash: null, docId: null }),
    ).toBeNull();
  });

  test("refuses a stale base, a create over an existing file, and a write to a removed one", () => {
    expect(
      checkWritePrecondition({ path: "a.json", baseHash: H1 }, { hash: H2, docId: "d1" }),
    ).toEqual({ ok: false, conflict: { path: "a.json", docId: "d1", diskHash: H2 } });
    expect(
      checkWritePrecondition({ path: "a.json", baseHash: null }, { hash: H1, docId: "d1" }),
    ).toEqual({ ok: false, conflict: { path: "a.json", docId: "d1", diskHash: H1 } });
    // Nothing is at the path any more, so there is no document to name.
    expect(
      checkWritePrecondition({ path: "a.json", baseHash: H1 }, { hash: null, docId: null }),
    ).toEqual({ ok: false, conflict: { path: "a.json", docId: null, diskHash: null } });
  });
});

describe("checkDeletePrecondition", () => {
  const file: DeleteRequest = { path: "a.json", base: { hash: H1 }, writeId: "w1" };
  const dir: DeleteRequest = {
    path: "media",
    base: { files: { "a.png": H1, "b.png": H2 } },
    writeId: "w2",
  };

  test("passes when a file's or a directory's base is what is on disk", () => {
    expect(checkDeletePrecondition(file, { hash: H1 }, "d1")).toBeNull();
    expect(checkDeletePrecondition(dir, { files: { "b.png": H2, "a.png": H1 } }, "d2")).toBeNull();
  });

  test("refuses a changed file, a missing one, and a directory whose contents moved", () => {
    expect(checkDeletePrecondition(file, { hash: H2 }, "d1")).toEqual({
      ok: false,
      conflict: { path: "a.json", docId: "d1", diskHash: H2 },
    });
    expect(checkDeletePrecondition(file, null, null)).toEqual({
      ok: false,
      conflict: { path: "a.json", docId: null, diskHash: null },
    });
    const refused: DeleteResult = {
      ok: false,
      conflict: { path: "media", docId: "d2", diskHash: null },
    };
    expect(checkDeletePrecondition(dir, { files: { "a.png": H1 } }, "d2")).toEqual(refused);
    expect(checkDeletePrecondition(dir, { files: { "a.png": H1, "b.png": H3 } }, "d2")).toEqual(
      refused,
    );
    expect(
      checkDeletePrecondition(dir, { files: { "a.png": H1, "b.png": H2, "c.png": H3 } }, "d2"),
    ).toEqual(refused);
  });

  test("a file where a directory was expected, or the reverse, is a conflict", () => {
    expect(checkDeletePrecondition(dir, { hash: H1 }, "d2")).toEqual({
      ok: false,
      conflict: { path: "media", docId: "d2", diskHash: H1 },
    });
    expect(checkDeletePrecondition(file, { files: {} }, "d1")).toEqual({
      ok: false,
      conflict: { path: "a.json", docId: "d1", diskHash: null },
    });
  });
});

describe("conflictEvent", () => {
  test("is built from the refused request and its conflict, so the shapes agree", () => {
    const request: WriteRequest = {
      path: "a.json",
      contents: "{}",
      baseHash: H1,
      writeId: "w1",
      bufferRev: 7,
    };
    const refusal = checkWritePrecondition(request, { hash: H2, docId: "d1" });
    if (refusal === null || refusal.ok) {
      throw new Error("expected a refusal");
    }
    expect(conflictEvent(request, refusal.conflict)).toEqual({
      type: "conflict",
      origin: "external",
      path: "a.json",
      docId: "d1",
      diskHash: H2,
      writeId: "w1",
      bufferRev: 7,
    });
    const log = createMemoryEventLog({ epoch: "e1" });
    expect(log.append(conflictEvent(request, refusal.conflict)).rev).toBe(1);
  });

  test("omits bufferRev when the request carried none", () => {
    const event = conflictEvent(
      { writeId: "w2" },
      { path: "gone.json", docId: null, diskHash: null },
    );
    expect("bufferRev" in event).toBe(false);
    expect(event.docId).toBeNull();
  });
});

describe("bufferStatus", () => {
  test("an unedited buffer is clean, even when the disk moved under it", () => {
    const state = { diskHash: H1, baseHash: H1, bufferRev: 3, savedRev: 3 };
    expect(bufferStatus(state)).toBe("clean");
    expect(isBehindDisk(state)).toBe(false);
    const moved = { ...state, diskHash: H2 };
    expect(bufferStatus(moved)).toBe("clean");
    expect(isBehindDisk(moved)).toBe(true);
  });

  test("an edited buffer over its own base is dirty", () => {
    const state = { diskHash: H1, baseHash: H1, bufferRev: 4, savedRev: 3 };
    expect(bufferStatus(state)).toBe("dirty");
    expect(isBehindDisk(state)).toBe(false);
  });

  test("an edited buffer whose base left the disk is conflicted", () => {
    expect(bufferStatus({ diskHash: H2, baseHash: H1, bufferRev: 4, savedRev: 3 })).toBe(
      "conflicted",
    );
    expect(bufferStatus({ diskHash: null, baseHash: H1, bufferRev: 4, savedRev: 3 })).toBe(
      "conflicted",
    );
    expect(isBehindDisk({ diskHash: H2, baseHash: H1, bufferRev: 4, savedRev: 3 })).toBe(false);
  });

  test("a new, unsaved file is dirty until something appears at its path", () => {
    expect(bufferStatus({ diskHash: null, baseHash: null, bufferRev: 1, savedRev: 0 })).toBe(
      "dirty",
    );
    expect(bufferStatus({ diskHash: H1, baseHash: null, bufferRev: 1, savedRev: 0 })).toBe(
      "conflicted",
    );
  });
});

describe("createMemoryEventLog", () => {
  test("assigns strictly increasing revisions from 1", () => {
    const log = createMemoryEventLog({ epoch: "e1" });
    expect(log.rev).toBe(0);
    expect(log.epoch).toBe("e1");
    const first = log.append(changed("a.json"));
    const second = log.append(changed("b.json"));
    expect(first.rev).toBe(1);
    expect(second.rev).toBe(2);
    expect(log.rev).toBe(2);
    expect(first).toMatchObject({ type: "fileChanged", path: "a.json" });
  });

  test("replays the events after a revision, oldest first", () => {
    const log = createMemoryEventLog({ epoch: "e1" });
    for (const path of ["a", "b", "c"]) {
      log.append(changed(path));
    }
    expect(log.since(0)?.map((e) => e.rev)).toEqual([1, 2, 3]);
    expect(log.since(1)?.map((e) => e.rev)).toEqual([2, 3]);
    expect(log.since(3)).toEqual([]);
  });

  test("answers null for a revision it cannot vouch for", () => {
    const log = createMemoryEventLog({ epoch: "e1" });
    log.append(changed("a"));
    expect(log.since(2)).toBeNull();
    expect(log.since(-1)).toBeNull();
    expect(log.since(0.5)).toBeNull();
  });

  test("forgets events past its capacity, and says so rather than replaying a gap", () => {
    const log = createMemoryEventLog({ epoch: "e1", capacity: 3 });
    for (const path of ["a", "b", "c", "d", "e"]) {
      log.append(changed(path));
    }
    expect(log.since(1)).toBeNull();
    expect(log.since(2)?.map((e) => e.rev)).toEqual([3, 4, 5]);
    expect(log.since(4)?.map((e) => (e.type === "fileChanged" ? e.path : ""))).toEqual(["e"]);
  });

  test("defaults its capacity and refuses a capacity that cannot hold an event", () => {
    const log = createMemoryEventLog({ epoch: "e1" });
    for (let i = 0; i <= EVENT_LOG_CAPACITY; i += 1) {
      log.append(changed(String(i)));
    }
    expect(log.since(0)).toBeNull();
    expect(log.since(1)?.length).toBe(EVENT_LOG_CAPACITY);
    expect(() => createMemoryEventLog({ epoch: "e1", capacity: 0 })).toThrow(RangeError);
    expect(() => createMemoryEventLog({ epoch: "e1", capacity: 1.5 })).toThrow(RangeError);
  });
});

describe("answerSubscribe", () => {
  const log = createMemoryEventLog({ epoch: "e1", capacity: 2 });
  for (const path of ["a", "b", "c"]) {
    log.append(changed(path));
  }
  let snapshots = 0;
  const snapshot = () => {
    snapshots += 1;
    return EMPTY;
  };

  test("a first connect gets a snapshot at the current revision", () => {
    expect(answerSubscribe(log, {}, snapshot)).toEqual({
      kind: "snapshot",
      epoch: "e1",
      rev: 3,
      snapshot: EMPTY,
    });
  });

  test("a reconnect within the window gets exactly the missed events", () => {
    const before = snapshots;
    const answer = answerSubscribe(log, { epoch: "e1", sinceRev: 2 }, snapshot);
    expect(answer.kind).toBe("events");
    expect(answer.rev).toBe(3);
    expect(answer.kind === "events" ? answer.events.map((e) => e.rev) : []).toEqual([3]);
    expect(snapshots).toBe(before);
  });

  test("an up-to-date client gets no events and no snapshot", () => {
    const answer = answerSubscribe(log, { epoch: "e1", sinceRev: 3 }, snapshot);
    expect(answer).toEqual({ kind: "events", epoch: "e1", rev: 3, events: [] });
  });

  test("a revision outside the window, another epoch, or no revision gets a snapshot", () => {
    expect(answerSubscribe(log, { epoch: "e1", sinceRev: 0 }, snapshot).kind).toBe("snapshot");
    expect(answerSubscribe(log, { epoch: "e0", sinceRev: 2 }, snapshot).kind).toBe("snapshot");
    expect(answerSubscribe(log, { epoch: "e1" }, snapshot).kind).toBe("snapshot");
    expect(answerSubscribe(log, { epoch: "e1", sinceRev: 9 }, snapshot).kind).toBe("snapshot");
  });
});

describe("package index", () => {
  test("re-exports the contract's runtime values", () => {
    expect(protocol.answerSubscribe).toBe(answerSubscribe);
    expect(protocol.createEchoLedger).toBe(createEchoLedger);
    expect(protocol.READINESS_ORDER).toBe(READINESS_ORDER);
    expect(protocol.DEPENDENCY_KIND_ORDER).toBe(DEPENDENCY_KIND_ORDER);
  });

  test("lists every dependency kind once, in §8.1's order", () => {
    expect([...DEPENDENCY_KIND_ORDER]).toEqual([
      "component-instance",
      "layout-page",
      "content-collection",
      "media-referrer",
      "data-consumer",
      "project-config",
    ]);
    expect(Object.isFrozen(DEPENDENCY_KIND_ORDER)).toBe(true);
  });
});
