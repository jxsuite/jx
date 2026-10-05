/**
 * The tool-call pairing repair (specs/ai.md §3.4): every reply directly after the request that made
 * its call, a seal for a call nothing answered, and nothing else touched.
 *
 * Every case below is also held to idempotence: repairing the repaired transcript reports nothing
 * and returns the same objects. The frozen v1 corpus's sealed transcript is re-derived at the end,
 * so the seal this module writes is the one Studio wrote before it moved here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SEAL_CUT_OFF,
  SEAL_RELOADED,
  isSealContent,
  repairToolPairs,
  toChatMessages,
} from "../src/messages/index.ts";
import type { ChatMessage, LiveMessage, RepairReport } from "../src/messages/index.ts";

const OK = '{"success":true}';
const RELOADED = `{"success":false,"error":${JSON.stringify(SEAL_RELOADED)}}`;
const CUT_OFF = `{"success":false,"error":${JSON.stringify(SEAL_CUT_OFF)}}`;

function user(id: string, timestamp = 1): ChatMessage {
  return { id, role: "user", blocks: [{ type: "text", text: id }], timestamp };
}

/** An assistant message making each call, `{}` unless its arguments are given. */
function request(id: string, calls: (string | [string, string])[], timestamp = 1): ChatMessage {
  return {
    id,
    role: "assistant",
    blocks: [
      { type: "text", text: id },
      ...calls.map((call) => {
        const [callId, argumentsText] = typeof call === "string" ? [call, "{}"] : call;
        return { type: "tool_call" as const, id: callId, name: "probe", argumentsText };
      }),
    ],
    timestamp,
  };
}

function reply(id: string, callId: string, content = OK): ChatMessage {
  return {
    id,
    role: "tool",
    blocks: [{ type: "tool_result", callId, isError: false, content }],
    timestamp: 1,
  };
}

/** The seal the repair writes, as a message. */
function seal(id: string, callId: string, content: string, timestamp = 1): ChatMessage {
  return {
    id,
    role: "tool",
    blocks: [{ type: "tool_result", callId, isError: true, content }],
    timestamp,
  };
}

const ids = (report: RepairReport) => report.messages.map((message) => message.id);

/** Every transcript a test below repairs, for the idempotence property. */
const repaired: [name: string, messages: readonly ChatMessage[]][] = [];

/** Repair a transcript, and remember it for the idempotence property. */
function repair(name: string, messages: readonly ChatMessage[]): RepairReport {
  repaired.push([name, messages]);
  return repairToolPairs(messages);
}

describe("repairToolPairs", () => {
  test("a well-formed transcript comes back untouched: the same objects, and nothing reported", () => {
    const messages = [
      { ...user("u1"), meta: { origin: "user" as const } },
      request("a1", ["c1", "c2"]),
      reply("r1", "c1"),
      reply("r2", "c2"),
      request("a2", []),
      { id: "s1", role: "system" as const, blocks: [], timestamp: 1 },
    ];
    const report = repair("well-formed", messages);
    expect(report).toEqual({ messages, sealed: [], dropped: [], moved: [] });
    expect(report.messages).not.toBe(messages);
    for (const [index, message] of report.messages.entries()) {
      expect(message).toBe(messages[index]!);
    }
  });

  test("a reply a later message separated from its request is moved back beside it", () => {
    const messages = [user("u1"), request("a1", ["c1"]), user("u2"), reply("r1", "c1")];
    const report = repair("moved", messages);
    expect(ids(report)).toEqual(["u1", "a1", "r1", "u2"]);
    expect(report).toMatchObject({ sealed: [], dropped: [], moved: ["r1"] });
    expect(report.messages[2]).toBe(messages[3]!);
  });

  test("a reply in a later request's run that answers an earlier request is moved to it", () => {
    const messages = [
      request("a1", ["x"]),
      user("u1"),
      request("a2", ["y"]),
      reply("ry", "y"),
      reply("rx", "x"),
    ];
    const report = repair("moved out of a run", messages);
    expect(ids(report)).toEqual(["a1", "rx", "u1", "a2", "ry"]);
    expect(report.moved).toEqual(["rx"]);
  });

  test("a call id reused in a later round pairs per request: round two's unanswered one is sealed", () => {
    const messages = [
      user("u1"),
      request("a1", ["call_0"], 10),
      reply("r1", "call_0"),
      user("u2"),
      request("a2", ["call_0"], 20),
    ];
    const report = repair("reused id, round two open", messages);
    expect(ids(report)).toEqual(["u1", "a1", "r1", "u2", "a2", "sealed_call_0_0"]);
    expect(report.messages[5]).toEqual(seal("sealed_call_0_0", "call_0", RELOADED, 20));
    expect(report).toMatchObject({ sealed: ["call_0"], dropped: [], moved: [] });
  });

  test("a reply answers the closest request of its id, so the earlier open one is sealed", () => {
    const messages = [request("a1", ["call_0"], 10), user("u1"), request("a2", ["call_0"], 20)];
    const report = repair("reused id, round one open", [...messages, reply("r2", "call_0")]);
    expect(ids(report)).toEqual(["a1", "sealed_call_0_0", "u1", "a2", "r2"]);
    expect(report.messages[1]).toEqual(seal("sealed_call_0_0", "call_0", RELOADED, 10));
    expect(report).toMatchObject({ sealed: ["call_0"], dropped: [], moved: [] });
  });

  test("a call whose arguments do not parse was cut off, and its seal says so", () => {
    const messages = [
      request("a1", [
        ["cut", '{"path":"/a.json","con'],
        ["none", ""],
        ["number", "42"],
      ]),
    ];
    const report = repair("cut off", messages);
    expect(report.messages.slice(1)).toEqual([
      seal("sealed_cut_0", "cut", CUT_OFF),
      seal("sealed_none_1", "none", RELOADED),
      seal("sealed_number_2", "number", RELOADED),
    ]);
    expect(report.sealed).toEqual(["cut", "none", "number"]);
  });

  test("an orphan, an id-less and a duplicate reply are dropped, in transcript order", () => {
    const noResult: ChatMessage = {
      id: "r_text",
      role: "tool",
      blocks: [{ type: "text", text: "not a result" }],
      timestamp: 1,
    };
    const messages = [
      reply("r_orphan", "gone"),
      request("a1", ["c1"]),
      reply("r1", "c1"),
      reply("r_dup", "c1"),
      reply("r_empty", ""),
      noResult,
      reply("r_unknown", "c9"),
    ];
    const report = repair("dropped", messages);
    expect(ids(report)).toEqual(["a1", "r1"]);
    expect(report).toMatchObject({
      sealed: [],
      dropped: ["r_orphan", "r_dup", "r_empty", "r_text", "r_unknown"],
      moved: [],
    });
  });

  test("a tool message answers the call of its first result only", () => {
    const two: ChatMessage = {
      id: "r_two",
      role: "tool",
      blocks: [
        { type: "text", text: "lead" },
        { type: "tool_result", callId: "c2", isError: false, content: OK },
        { type: "tool_result", callId: "c1", isError: false, content: OK },
      ],
      timestamp: 1,
    };
    const report = repair("first result", [request("a1", ["c1", "c2"]), two]);
    expect(ids(report)).toEqual(["a1", "sealed_c1_0", "r_two"]);
    expect(report.sealed).toEqual(["c1"]);
  });

  test("seals come first, in call order, then the replies the request owns in their order", () => {
    const messages = [
      request("a1", ["c1", "c2", "c3", "c4"]),
      reply("r4", "c4"),
      reply("r2", "c2"),
    ];
    const report = repair("seal order", messages);
    expect(ids(report)).toEqual(["a1", "sealed_c1_0", "sealed_c3_1", "r4", "r2"]);
    expect(report).toMatchObject({ sealed: ["c1", "c3"], dropped: [], moved: [] });
  });

  test("a call id made twice in one message is answered by one reply, and sealed once", () => {
    const open = repair("twice, open", [request("a1", ["c1", "c1"])]);
    expect(ids(open)).toEqual(["a1", "sealed_c1_0"]);
    const answered = repair("twice, answered", [
      request("a1", ["c1", "c1"]),
      reply("r1", "c1"),
      reply("r2", "c1"),
    ]);
    expect(ids(answered)).toEqual(["a1", "r1"]);
    expect(answered).toMatchObject({ sealed: [], dropped: ["r2"], moved: [] });
  });

  test("a call with no id cannot be answered, so nothing seals it", () => {
    const messages = [request("a1", [""])];
    const report = repair("no call id", messages);
    expect(report).toEqual({ messages, sealed: [], dropped: [], moved: [] });
  });

  test("seal ids are sealed_<id>_<n>, and stay unique when that id is taken", () => {
    const messages = [
      user("sealed_c_0"),
      user("sealed_c_0_2"),
      request("a1", ["c"]),
      request("a2", ["c"]),
      request("a3", ["c"]),
    ];
    const report = repair("seal ids", messages);
    expect(ids(report)).toEqual([
      "sealed_c_0",
      "sealed_c_0_2",
      "a1",
      "sealed_c_0_1",
      "a2",
      "sealed_c_0_3",
      "a3",
      "sealed_c_0_4",
    ]);
    expect(new Set(ids(report)).size).toBe(ids(report).length);
  });

  test("a seal is stamped with its request's time and carries no meta", () => {
    const report = repair("seal shape", [request("a1", ["c1"], 1234)]);
    const [, sealMessage] = report.messages;
    expect(sealMessage).toEqual(seal("sealed_c1_0", "c1", RELOADED, 1234));
    expect(sealMessage).not.toHaveProperty("meta");
  });

  test("repairing twice is repairing once, for every transcript above", () => {
    expect(repaired.length).toBeGreaterThan(10);
    for (const [name, messages] of repaired) {
      const once = repairToolPairs(messages);
      const twice = repairToolPairs(once.messages);
      expect({ name, sealed: twice.sealed, dropped: twice.dropped, moved: twice.moved }).toEqual({
        name,
        sealed: [],
        dropped: [],
        moved: [],
      });
      expect(twice.messages).toHaveLength(once.messages.length);
      for (const [index, message] of twice.messages.entries()) {
        expect(message).toBe(once.messages[index]!);
      }
    }
  });

  test("re-derives the v1 corpus's sealed transcript from the transcript without its seal", () => {
    const file = join(import.meta.dir, "fixtures", "v1", "transcripts", "sealed-orphan.json");
    const fixture = JSON.parse(readFileSync(file, "utf8")) as { messages: LiveMessage[] };
    const expected = toChatMessages(fixture.messages);
    const unsealed = expected.filter((message) => !message.id.startsWith("sealed_"));
    const report = repairToolPairs(unsealed);
    expect(report.messages).toEqual(expected);
    expect(report.sealed).toEqual(["call_add"]);
  });
});

describe("isSealContent", () => {
  test("is true exactly for the two seals", () => {
    expect(isSealContent(RELOADED)).toBe(true);
    expect(isSealContent(CUT_OFF)).toBe(true);
    expect(isSealContent(JSON.stringify({ error: SEAL_RELOADED, success: false }))).toBe(false);
    expect(isSealContent(JSON.stringify({ success: false, error: "The tool threw." }))).toBe(false);
    expect(isSealContent(OK)).toBe(false);
    expect(isSealContent(SEAL_RELOADED)).toBe(false);
    expect(isSealContent("")).toBe(false);
  });
});
