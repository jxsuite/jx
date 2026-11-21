/**
 * The project state contract's wire codecs (`specs/project-state.md` §3.2, §5): the three transport
 * bindings, the gap detector, and the HTTP precondition headers. Each binding is round-tripped, and
 * each decoder is fed the other traffic its socket carries and malformed frames.
 */

import { describe, expect, test } from "bun:test";
import {
  PRECONDITION_FAILED_STATUS,
  PROJECT_ENDED_METHOD,
  PROJECT_EVENTS_METHOD,
  PROJECT_EVENTS_PATH,
  PROJECT_SUBSCRIBE_METHOD,
  checkContinuity,
  conflictFromProblem,
  createSubscriptionCursor,
  decodeCloudClientMessage,
  decodeCloudHostMessage,
  decodeDesktopEnded,
  decodeDesktopPush,
  decodeDesktopRequest,
  decodeDesktopSubscribeReply,
  decodeSseMessage,
  decodeWireContents,
  deletePrecondition,
  encodeCloudEvents,
  encodeCloudSubscribe,
  encodeCloudSubscribeAnswer,
  encodeDesktopEnded,
  encodeDesktopEvents,
  encodeDesktopSubscribe,
  encodeDesktopSubscribeReply,
  encodeSseEvents,
  encodeSseSubscribe,
  encodeWireContents,
  entityTag,
  formatEventId,
  isProjectEvent,
  isSubscribeRequest,
  isSubscribeResponse,
  parseDeletePrecondition,
  parseLastEventId,
  parseSseBlock,
  parseWritePrecondition,
  preconditionFailedProblem,
  writePreconditionHeaders,
} from "../src/project-state-frames";
import type { JsonValue } from "@jxsuite/schema/types";
import type { ProjectEvent, SubscribeResponse } from "../src/project-state";
import type { HeaderReader } from "../src/project-state-frames";
import { PROBLEM_TYPES } from "../src/problems";

const H1 = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" as const;
const H2 = "sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=" as const;

const changed = (rev: number): ProjectEvent => ({
  docId: "d1",
  hash: H1,
  origin: "external",
  path: "pages/index.json",
  rev,
  type: "fileChanged",
});

const SNAPSHOT: Extract<SubscribeResponse, { kind: "snapshot" }> = {
  epoch: "e1",
  kind: "snapshot",
  rev: 3,
  snapshot: {
    components: ["my-card"],
    files: [{ docId: "d1", hash: H1, indexed: true, isDir: false, kind: "page", path: "a.json" }],
    formats: "f1",
    readiness: "ready",
  },
};

/** {@link SNAPSHOT} with `file` as its only file, which may be malformed. */
function withOneFile(file: JsonValue) {
  return { ...SNAPSHOT, snapshot: { ...SNAPSHOT.snapshot, files: [file] } };
}

const EVENTS: SubscribeResponse = { epoch: "e1", events: [changed(4)], kind: "events", rev: 4 };

/** A header reader over a plain record, case-insensitive like `Headers`. */
const headers = (record: Record<string, string>): HeaderReader => new Headers(record);

/** A value as it arrives off the wire: serialized and parsed again. */
function wire<T>(value: T): JsonValue {
  const text = JSON.stringify(value);
  /* SAFETY: parsing what JSON.stringify produced yields a JSON value, which is all JsonValue
     describes. */
  return JSON.parse(text) as JsonValue;
}

describe("wire contents", () => {
  test("text travels as itself and bytes as base64", () => {
    expect(encodeWireContents("héllo")).toBe("héllo");
    const bytes = new Uint8Array([0, 1, 0xff, 0xfe]);
    const encoded = encodeWireContents(bytes);
    expect(encoded).toEqual({ data: "AAH//g==", encoding: "base64" });
    expect(decodeWireContents(encoded)).toEqual(bytes);
    expect(decodeWireContents("text")).toBe("text");
  });

  test("a large file is encoded in chunks without overflowing", () => {
    const big = new Uint8Array(200_000).map((_, at) => at % 251);
    expect(decodeWireContents(encodeWireContents(big))).toEqual(big);
  });

  test("base64 that is not base64 is refused", () => {
    expect(() => decodeWireContents({ data: "%%%", encoding: "base64" })).toThrow(TypeError);
  });
});

describe("event validation", () => {
  test("accepts every well-formed event type", () => {
    const events: ProjectEvent[] = [
      changed(1),
      { docId: "d", isDir: false, origin: "external", path: "p", rev: 1, type: "fileAdded" },
      {
        docId: "d",
        hash: H1,
        isDir: false,
        origin: "external",
        path: "p",
        rev: 1,
        type: "fileAdded",
      },
      {
        docId: "d",
        isDir: true,
        origin: { writeHash: null, writeId: "w" },
        path: "p",
        rev: 1,
        type: "fileRemoved",
      },
      {
        docId: "d",
        from: "a",
        isDir: false,
        origin: "external",
        rev: 1,
        to: "b",
        type: "fileRenamed",
      },
      {
        docId: "d",
        hash: H1,
        indexed: false,
        kind: "page",
        origin: "external",
        path: "p",
        rev: 1,
        type: "docChanged",
      },
      {
        cause: { docId: "d", kind: "layout-page" },
        complete: false,
        docIds: ["e"],
        origin: "external",
        rev: 1,
        tags: [],
        type: "dependentsInvalidated",
      },
      { origin: "external", rev: 1, tags: ["my-card"], type: "componentsChanged" },
      { formats: "f", origin: "external", rev: 1, type: "formatsChanged" },
      {
        hash: H2,
        origin: { writeHash: H2, writeId: "w" },
        path: "project.json",
        rev: 1,
        type: "projectConfigChanged",
      },
      {
        origin: "external",
        rev: 1,
        status: { branch: null, changed: {}, head: null },
        type: "gitChanged",
      },
      { origin: "external", rev: 1, state: "indexed", type: "readiness" },
      {
        diskHash: null,
        docId: null,
        origin: "external",
        path: "p",
        rev: 1,
        type: "conflict",
        writeId: "w",
      },
      {
        bufferRev: 3,
        diskHash: H1,
        docId: "d",
        origin: "external",
        path: "p",
        rev: 1,
        type: "conflict",
        writeId: "w",
      },
      { files: ["a"], opId: "o", origin: "external", rev: 1, type: "operationApplied" },
      { origin: "external", reason: "limit", rev: 1, type: "watcherDegraded" },
    ];
    for (const event of events) {
      expect(isProjectEvent(wire(event))).toBe(true);
    }
  });

  test("refuses unknown types, bad revisions and origins, and missing members", () => {
    const one = changed(1);
    const rejected = [
      null,
      [],
      { ...one, type: "unknown" },
      { ...one, type: "toString" },
      changed(0),
      { ...one, rev: 1.5 },
      { ...one, origin: "someone" },
      { ...one, origin: { writeHash: "x", writeId: "w" } },
      { ...one, hash: "md5-x" },
      { origin: "external", rev: 1, state: "done", type: "readiness" },
      {
        docId: "d",
        hash: H1,
        indexed: true,
        kind: "banana",
        origin: "external",
        path: "p",
        rev: 1,
        type: "docChanged",
      },
      {
        cause: { docId: "d", kind: "imports" },
        complete: true,
        docIds: [],
        origin: "external",
        rev: 1,
        tags: [],
        type: "dependentsInvalidated",
      },
      {
        origin: "external",
        rev: 1,
        status: { branch: null, changed: { a: 42 }, head: null },
        type: "gitChanged",
      },
      {
        origin: "external",
        rev: 1,
        status: { branch: null, changed: { a: "stashed" }, head: null },
        type: "gitChanged",
      },
      {
        bufferRev: -1,
        diskHash: null,
        docId: null,
        origin: "external",
        path: "p",
        rev: 1,
        type: "conflict",
        writeId: "w",
      },
    ].map((value) => wire(value));
    for (const value of rejected) {
      expect(isProjectEvent(value)).toBe(false);
    }
  });

  test("checks subscribe requests and answers", () => {
    const requests = [{}, { clientId: "c", epoch: "e", sinceRev: 0 }].map((value) => wire(value));
    for (const value of requests) {
      expect(isSubscribeRequest(value)).toBe(true);
    }
    const badRequests = [{ sinceRev: -1 }, { epoch: 1 }, { clientId: 1 }, "x"].map((value) =>
      wire(value),
    );
    for (const value of badRequests) {
      expect(isSubscribeRequest(value)).toBe(false);
    }
    const withGit = {
      ...SNAPSHOT,
      snapshot: {
        ...SNAPSHOT.snapshot,
        files: [
          ...SNAPSHOT.snapshot.files,
          { docId: "d2", indexed: false, isDir: true, kind: "other", path: "pages" },
        ],
        git: { branch: "main", changed: { "a.json": "modified" }, head: "abc" },
      },
    };
    for (const value of [wire(SNAPSHOT), wire(EVENTS), wire(withGit)]) {
      expect(isSubscribeResponse(value)).toBe(true);
    }
    const { snapshot } = SNAPSHOT;
    const badResponses = [
      { ...EVENTS, events: [{}] },
      { ...SNAPSHOT, kind: "other" },
      { ...SNAPSHOT, epoch: 1 },
      { ...SNAPSHOT, snapshot: { ...snapshot, readiness: "x" } },
      { ...SNAPSHOT, snapshot: { ...snapshot, files: [{}] } },
      ...[
        { docId: "d", isDir: false, path: "a" },
        { docId: "d", isDir: false, kind: "page", path: "a" },
        { docId: "d", indexed: "yes", isDir: false, kind: "page", path: "a" },
        { docId: "d", indexed: true, isDir: false, kind: "banana", path: "a" },
        { docId: "d", hash: "md5-x", indexed: true, isDir: false, kind: "page", path: "a" },
        { docId: "d", hash: H1, indexed: true, isDir: true, kind: "other", path: "a" },
      ].map((file) => withOneFile(file)),
      { ...SNAPSHOT, snapshot: { ...snapshot, git: { branch: null, changed: {}, head: 1 } } },
      {
        ...SNAPSHOT,
        snapshot: { ...snapshot, git: { branch: "main", changed: { a: "x" }, head: null } },
      },
    ].map((value) => wire(value));
    for (const value of badResponses) {
      expect(isSubscribeResponse(value)).toBe(false);
    }
  });
});

describe("gap detection (§3.2)", () => {
  test("continuity from the last revision, one at a time", () => {
    expect(checkContinuity(3, [])).toEqual({ ok: true, rev: 3 });
    expect(checkContinuity(3, [changed(4), changed(5)])).toEqual({ ok: true, rev: 5 });
    expect(checkContinuity(3, [changed(5)])).toEqual({ expected: 4, ok: false, received: 5 });
    expect(checkContinuity(3, [changed(4), changed(6)])).toEqual({
      expected: 5,
      ok: false,
      received: 6,
    });
  });

  test("a cursor asks for a snapshot first, then resumes from what it applied", () => {
    const cursor = createSubscriptionCursor("window-1");
    expect(cursor.request()).toEqual({ clientId: "window-1" });
    expect(cursor.frame({ epoch: "e1", events: [changed(1)] })).toEqual({ kind: "gap" });
    expect(cursor.answer(SNAPSHOT)).toEqual({ kind: "snapshot", response: SNAPSHOT });
    expect([cursor.epoch, cursor.rev]).toEqual(["e1", 3]);
    expect(cursor.frame({ epoch: "e1", events: [changed(4), changed(5)] })).toEqual({
      events: [changed(4), changed(5)],
      kind: "events",
    });
    expect(cursor.request()).toEqual({ clientId: "window-1", epoch: "e1", sinceRev: 5 });
    expect(cursor.frame({ epoch: "e1", events: [changed(7)] })).toEqual({ kind: "gap" });
    expect(cursor.frame({ epoch: "e2", events: [changed(6)] })).toEqual({ kind: "gap" });
    expect(cursor.rev).toBe(5);
    expect(cursor.answer({ epoch: "e1", events: [changed(6)], kind: "events", rev: 6 })).toEqual({
      events: [changed(6)],
      kind: "events",
    });
    // An answer whose events stop short of the revision it names is a gap too.
    expect(cursor.answer({ epoch: "e1", events: [changed(7)], kind: "events", rev: 9 })).toEqual({
      kind: "gap",
    });
    expect(cursor.answer({ epoch: "e1", events: [changed(9)], kind: "events", rev: 9 })).toEqual({
      kind: "gap",
    });
  });

  test("a cursor without a client id sends none", () => {
    expect(createSubscriptionCursor().request()).toEqual({});
  });
});

describe("desktop binding", () => {
  test("projectSubscribe round-trips", () => {
    const text = encodeDesktopSubscribe(7, { epoch: "e1", sinceRev: 3 });
    expect(JSON.parse(text)).toEqual({
      id: 7,
      method: PROJECT_SUBSCRIBE_METHOD,
      params: { epoch: "e1", sinceRev: 3 },
    });
    expect(decodeDesktopRequest(text)).toEqual({ id: 7, request: { epoch: "e1", sinceRev: 3 } });
    expect(
      decodeDesktopRequest(JSON.stringify({ id: 1, method: PROJECT_SUBSCRIBE_METHOD })),
    ).toEqual({
      id: 1,
      request: {},
    });
    expect(decodeDesktopRequest(encodeDesktopSubscribe(2, { clientId: "w" }))).toEqual({
      id: 2,
      request: { clientId: "w" },
    });
  });

  test("other methods are not this exchange; a malformed one is refused", () => {
    expect(decodeDesktopRequest(JSON.stringify({ id: 1, method: "readFile" }))).toBeNull();
    expect(decodeDesktopRequest("[]")).toBeNull();
    expect(() => decodeDesktopRequest("{")).toThrow(TypeError);
    expect(() =>
      decodeDesktopRequest(JSON.stringify({ id: "x", method: PROJECT_SUBSCRIBE_METHOD })),
    ).toThrow(TypeError);
    expect(() =>
      decodeDesktopRequest(
        JSON.stringify({ id: 1, method: PROJECT_SUBSCRIBE_METHOD, params: { sinceRev: "x" } }),
      ),
    ).toThrow(TypeError);
  });

  test("the reply and the pushes round-trip, batched", () => {
    const reply = wire({ ...SNAPSHOT });
    expect(encodeDesktopSubscribeReply(7, SNAPSHOT)).toBe(
      JSON.stringify({ id: 7, result: SNAPSHOT }),
    );
    expect(decodeDesktopSubscribeReply(reply)).toEqual(SNAPSHOT);
    expect(() => decodeDesktopSubscribeReply({})).toThrow(TypeError);
    const push = encodeDesktopEvents("e1", [changed(4), changed(5)]);
    expect(JSON.parse(push)).toMatchObject({ method: PROJECT_EVENTS_METHOD });
    expect(decodeDesktopPush(push)).toEqual({ epoch: "e1", events: [changed(4), changed(5)] });
    expect(decodeDesktopPush(JSON.stringify({ method: "onFileEvents", params: {} }))).toBeNull();
    expect(decodeDesktopPush("1")).toBeNull();
    expect(() => decodeDesktopPush(JSON.stringify({ method: PROJECT_EVENTS_METHOD }))).toThrow(
      TypeError,
    );
    expect(() => encodeDesktopEvents("e1", [])).toThrow(RangeError);
  });

  test("the end of a subscription is a push naming its epoch", () => {
    const ended = encodeDesktopEnded("e1");
    expect(JSON.parse(ended)).toEqual({ method: PROJECT_ENDED_METHOD, params: { epoch: "e1" } });
    expect(decodeDesktopEnded(ended)).toEqual({ epoch: "e1" });
    const events = encodeDesktopEvents("e1", [changed(4)]);
    expect(decodeDesktopEnded(events)).toBeNull();
    expect(decodeDesktopEnded("1")).toBeNull();
    expect(decodeDesktopPush(ended)).toBeNull();
    expect(() => decodeDesktopEnded(JSON.stringify({ method: PROJECT_ENDED_METHOD }))).toThrow(
      TypeError,
    );
  });
});

describe("dev-server binding (Server-Sent Events)", () => {
  test("serves a dedicated stream", () => {
    expect(PROJECT_EVENTS_PATH).toBe("/__studio/project/events");
  });

  test("the id is <epoch>:<rev>, and Last-Event-ID reads back as the request", () => {
    expect(formatEventId("e1", 12)).toBe("e1:12");
    expect(parseLastEventId("e1:12")).toEqual({ epoch: "e1", sinceRev: 12 });
    expect(parseLastEventId(formatEventId("a:b", 0))).toEqual({ epoch: "a:b", sinceRev: 0 });
    for (const bad of [
      null,
      undefined,
      "",
      "12",
      ":12",
      "e1:",
      "e1:x",
      "e1:-1",
      "e1:1.5",
      "e:99999999999999999999",
    ]) {
      expect(parseLastEventId(bad)).toEqual({});
    }
    expect(() => formatEventId("", 1)).toThrow(RangeError);
    expect(() => formatEventId("a\nb", 1)).toThrow(RangeError);
    expect(() => formatEventId("e", -1)).toThrow(RangeError);
  });

  test("the first frame is the answer and later frames carry the last revision", () => {
    const first = parseSseBlock(encodeSseSubscribe(SNAPSHOT));
    expect(first).toEqual({ data: JSON.stringify(SNAPSHOT), event: "subscribe", id: "e1:3" });
    expect(decodeSseMessage(first.event, first.data)).toEqual({
      kind: "subscribe",
      response: SNAPSHOT,
    });
    const later = parseSseBlock(encodeSseEvents("e1", [changed(4), changed(5)]));
    expect(later.id).toBe("e1:5");
    expect(later.event).toBe("project");
    expect(decodeSseMessage(later.event, later.data)).toEqual({
      epoch: "e1",
      events: [changed(4), changed(5)],
      kind: "events",
    });
    expect(() => encodeSseEvents("e1", [])).toThrow(RangeError);
  });

  test("a text with a line break stays on one data line", () => {
    const event: ProjectEvent = {
      origin: "external",
      reason: "a\nb",
      rev: 1,
      type: "watcherDegraded",
    };
    const frame = encodeSseEvents("e1", [event]);
    expect(frame.split("\n").filter((line) => line.startsWith("data:"))).toHaveLength(1);
    const block = parseSseBlock(frame);
    expect(decodeSseMessage(block.event, block.data)).toMatchObject({ events: [event] });
  });

  test("parses blocks as the event-stream format does", () => {
    expect(parseSseBlock(": comment\r\ndata: one\rdata:two\ndata\nretry: 5\nid: x\0y")).toEqual({
      data: "one\ntwo\n",
      event: "message",
    });
    expect(parseSseBlock("event:custom\nid:7")).toEqual({ data: "", event: "custom", id: "7" });
  });

  test("other event names are not this exchange; malformed data is refused", () => {
    expect(decodeSseMessage("reload", "{}")).toBeNull();
    expect(() => decodeSseMessage("subscribe", "{}")).toThrow(TypeError);
    expect(() => decodeSseMessage("project", "[]")).toThrow(TypeError);
    expect(() => decodeSseMessage("project", "not json")).toThrow(TypeError);
  });
});

describe("cloud binding", () => {
  test("the subscribe message round-trips and other messages are passed by", () => {
    const text = encodeCloudSubscribe({ clientId: "w", epoch: "e1", sinceRev: 2 });
    expect(JSON.parse(text)).toEqual({
      clientId: "w",
      epoch: "e1",
      kind: "subscribe",
      sinceRev: 2,
    });
    expect(decodeCloudClientMessage(text)).toEqual({ clientId: "w", epoch: "e1", sinceRev: 2 });
    expect(decodeCloudClientMessage(encodeCloudSubscribe({}))).toEqual({});
    expect(decodeCloudClientMessage(JSON.stringify({ kind: "ping" }))).toBeNull();
    expect(decodeCloudClientMessage("null")).toBeNull();
    expect(() => decodeCloudClientMessage(JSON.stringify({ epoch: 3, kind: "subscribe" }))).toThrow(
      TypeError,
    );
  });

  test("the answer is nested, because it has a kind of its own", () => {
    const text = encodeCloudSubscribeAnswer(EVENTS);
    expect(JSON.parse(text)).toEqual({ kind: "project-subscribe", response: EVENTS });
    expect(decodeCloudHostMessage(text)).toEqual({ kind: "subscribe", response: EVENTS });
    expect(() =>
      decodeCloudHostMessage(JSON.stringify({ kind: "project-subscribe", response: {} })),
    ).toThrow(TypeError);
  });

  test("later events round-trip, and the socket's other traffic is passed by", () => {
    const text = encodeCloudEvents("e1", [changed(4)]);
    expect(decodeCloudHostMessage(text)).toEqual({
      epoch: "e1",
      events: [changed(4)],
      kind: "events",
    });
    expect(decodeCloudHostMessage(JSON.stringify({ events: [], kind: "fs" }))).toBeNull();
    const malformed = JSON.stringify({ epoch: "e1", events: [{ rev: 1 }], kind: "project" });
    expect(() => decodeCloudHostMessage(malformed)).toThrow(TypeError);
    expect(decodeCloudHostMessage("[]")).toBeNull();
    expect(() => decodeCloudHostMessage(JSON.stringify({ epoch: "e1", kind: "project" }))).toThrow(
      TypeError,
    );
    expect(() => encodeCloudEvents("e1", [])).toThrow(RangeError);
  });
});

describe("HTTP preconditions (§5)", () => {
  test("a base is a strong entity tag, or If-None-Match: * for a create", () => {
    expect(entityTag(H1)).toBe(`"${H1}"`);
    expect(writePreconditionHeaders(H1)).toEqual({ "If-Match": `"${H1}"` });
    expect(writePreconditionHeaders(null)).toEqual({ "If-None-Match": "*" });
    const ifMatch = headers(writePreconditionHeaders(H1));
    expect(parseWritePrecondition(ifMatch)).toEqual({
      baseHash: H1,
      ok: true,
    });
    expect(parseWritePrecondition(headers({ "if-none-match": " * " }))).toEqual({
      baseHash: null,
      ok: true,
    });
  });

  test("a write without a base, or with one the contract does not accept, is refused", () => {
    expect(parseWritePrecondition(headers({}))).toEqual({ ok: false, reason: "missing" });
    for (const record of [
      { "If-Match": "*" },
      { "If-Match": `W/"${H1}"` },
      { "If-Match": `"${H1}", "${H2}"` },
      { "If-Match": `"not-a-hash"` },
      { "If-Match": `"` },
      { "If-None-Match": `"${H1}"` },
      { "If-Match": `"${H1}"`, "If-None-Match": "*" },
    ]) {
      expect(parseWritePrecondition(headers(record))).toEqual({ ok: false, reason: "malformed" });
    }
  });

  test("a file delete carries If-Match, a directory delete its files in the body", () => {
    const file = deletePrecondition({ hash: H1 });
    expect(file).toEqual({ headers: { "If-Match": `"${H1}"` } });
    expect(parseDeletePrecondition(headers(file.headers), null)).toEqual({
      base: { hash: H1 },
      ok: true,
    });
    const dir = deletePrecondition({ files: { "a.json": H1 } });
    expect(dir.headers).toEqual({ "Content-Type": "application/json" });
    expect(parseDeletePrecondition(headers(dir.headers), dir.body!)).toEqual({
      base: { files: { "a.json": H1 } },
      ok: true,
    });
    expect(parseDeletePrecondition(headers({}), null)).toEqual({ ok: false, reason: "missing" });
    for (const [record, body] of [
      [{ "If-Match": "*" }, null],
      [{ "If-Match": `"${H1}"` }, "{}"],
      [{}, "not json"],
      [{}, "[]"],
      [{}, JSON.stringify({ files: { a: "x" } })],
      // A delete has no create form: If-None-Match is refused alone and beside If-Match.
      [{ "If-Match": `"${H1}"`, "If-None-Match": "*" }, null],
      [{ "If-None-Match": "*" }, null],
      [{ "If-None-Match": "*" }, JSON.stringify({ files: { "a.json": H1 } })],
    ] as const) {
      expect(parseDeletePrecondition(headers(record), body)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  test("a refusal is a 412 problem naming what is at the path", () => {
    expect(PRECONDITION_FAILED_STATUS).toBe(412);
    const conflict = { diskHash: H2, docId: "d1", path: "pages/index.json" };
    const problem = preconditionFailedProblem(conflict);
    expect(problem).toMatchObject({
      ...conflict,
      status: 412,
      type: PROBLEM_TYPES.preconditionFailed.type,
    });
    expect(conflictFromProblem(wire(problem))).toEqual(conflict);
    const nothing = { diskHash: null, docId: null, path: "gone.json" };
    const refusedNothing = wire(preconditionFailedProblem(nothing));
    expect(conflictFromProblem(refusedNothing)).toEqual(nothing);
    expect(conflictFromProblem(wire({ ...problem, type: PROBLEM_TYPES.conflict.type }))).toBeNull();
    expect(conflictFromProblem(wire({ ...problem, path: 1 }))).toBeNull();
    expect(conflictFromProblem(wire({ ...problem, docId: 1 }))).toBeNull();
    expect(conflictFromProblem(wire({ ...problem, diskHash: "x" }))).toBeNull();
    expect(conflictFromProblem(null)).toBeNull();
  });
});
