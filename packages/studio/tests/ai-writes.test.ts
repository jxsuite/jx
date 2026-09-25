/**
 * Tests for src/services/ai-writes.ts — the per-turn record of what the assistant changed (§7.4).
 *
 * The two facts under test are the two the panel could not previously state: WHICH files a turn
 * changed, and which of those changes undo can reach. The second is the load-bearing one — document
 * tools go through `transactDoc`, `write_file` goes straight to disk, and the caveat used to be
 * appended to the MODEL-facing tool summary rather than shown to the person holding ⌘Z.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_TURNS,
  fileTurn,
  openTurnLedger,
  resetAiWrites,
  summarizeWrites,
  turnAnchor,
  writesForTurn,
} from "../src/services/ai-writes";

const doc = (path: string) => ({ disk: false, ok: true, path, tool: "update_style" });
const disk = (path: string) => ({ disk: true, ok: true, path, tool: "write_file" });

beforeEach(() => {
  resetAiWrites();
});

describe("recording", () => {
  test("a turn files its writes under the message id it ends on", () => {
    const ledger = openTurnLedger("t1");
    ledger.record(doc("pages/index.json"));
    ledger.record(disk("layouts/base.json"));
    expect(fileTurn("msg_7", ledger.writes)).toHaveLength(2);
    expect(writesForTurn("msg_7").map((w) => w.path)).toEqual([
      "pages/index.json",
      "layouts/base.json",
    ]);
  });

  /* The slot this replaced was one ledger for the window: a tool run outside the loop recorded
     into whichever turn happened to be open, and two turns could not each keep their own. */
  test("each turn keeps its own ledger", () => {
    const first = openTurnLedger("t1");
    const second = openTurnLedger("t2");
    first.record(doc("a.json"));
    second.record(doc("b.json"));
    expect(first.writes.map((w) => w.path)).toEqual(["a.json"]);
    expect(second.writes.map((w) => w.path)).toEqual(["b.json"]);
  });

  test("a ledger names the turn it records", () => {
    expect(openTurnLedger("turn:2").turnId).toBe("turn:2");
  });

  test("a turn that changed nothing files nothing — the panel renders no summary at all", () => {
    expect(fileTurn("msg_1", openTurnLedger("t1").writes)).toEqual([]);
    expect(writesForTurn("msg_1")).toEqual([]);
  });

  test("the ledger is bounded — old turns drop, the messages stay", () => {
    for (let i = 0; i <= MAX_TURNS; i++) {
      const ledger = openTurnLedger(`t${i}`);
      ledger.record(doc(`p${i}.json`));
      fileTurn(`msg_${i}`, ledger.writes);
    }
    expect(writesForTurn("msg_0")).toEqual([]);
    expect(writesForTurn(`msg_${MAX_TURNS}`)).toHaveLength(1);
  });
});

describe("summarizeWrites", () => {
  test("counts DISTINCT files, not writes", () => {
    /* Six edits to one document changed one file. "Changed 6 files" would be the same dishonesty
       in the other direction. */
    const writes = Array.from({ length: 6 }, () => doc("pages/index.json"));
    expect(summarizeWrites(writes)).toBe("Changed 1 file");
  });

  test("calls out the disk writes undo cannot reach", () => {
    expect(summarizeWrites([doc("a.json"), disk("b.json")])).toBe(
      "Changed 2 files · 1 written to disk — undo cannot reach it",
    );
  });

  test("pluralises the caveat when more than one write went to disk", () => {
    expect(summarizeWrites([disk("a.json"), disk("b.json")])).toBe(
      "Changed 2 files · 2 written to disk — undo cannot reach them",
    );
  });

  test("failures are counted separately from what landed", () => {
    const failed = { disk: true, error: "EROFS", ok: false, path: "c.json", tool: "write_file" };
    expect(summarizeWrites([doc("a.json"), failed])).toBe("Changed 1 file · 1 failed");
  });

  test("a turn where everything failed says so and claims no files", () => {
    const failed = { disk: true, error: "EROFS", ok: false, path: "c.json", tool: "write_file" };
    expect(summarizeWrites([failed, failed])).toBe("2 changes failed");
  });

  test('nothing recorded summarises to nothing, never to "Changed 0 files"', () => {
    expect(summarizeWrites([])).toBe("");
  });
});

/* The panel draws a turn's summary under the message its writes are filed under, and it draws only
   an assistant message carrying text or tool calls (panels/ai-chat/chat-view.ts). */
describe("turnAnchor", () => {
  test("stops at the message the turn answers", () => {
    const m = (id: string, role: string, content = "", toolCalls?: unknown[]) =>
      ({ content, id, role, timestamp: 0, ...(toolCalls ? { toolCalls } : {}) }) as never;
    const earlier = [m("a0", "assistant", "An earlier turn's answer."), m("u1", "user", "hi")];
    // The turn drew nothing: an empty placeholder and a tool reply are not drawn.
    expect(turnAnchor([...earlier, m("p", "assistant"), m("t", "tool", "{}")], "u1")).toBeNull();
    expect(
      turnAnchor([...earlier, m("r", "assistant", "", [{}]), m("t", "tool", "{}")], "u1"),
    ).toBe("r");
    // With no user message to stop at, the whole transcript is the turn.
    expect(turnAnchor([m("a0", "assistant", "text")])).toBe("a0");
  });

  /* Another chat opened from Chat History while the turn waited on a tool: the transcript was
     replaced, and the stopped call's reply landed in it. Nothing drawn there is this turn's. */
  test("a transcript that no longer holds the turn's user message has no anchor", () => {
    const m = (id: string, role: string, content = "") =>
      ({ content, id, role, timestamp: 0 }) as never;
    const replaced = [
      m("old_u", "user", "B"),
      m("old_a", "assistant", "B's answer"),
      m("t", "tool"),
    ];
    expect(turnAnchor(replaced, "u1")).toBeNull();
  });
});
