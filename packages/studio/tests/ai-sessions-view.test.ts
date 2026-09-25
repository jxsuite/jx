/**
 * Tests for src/panels/ai-chat/sessions-view.ts — the chat history's PROJECTION: relativeTime
 * formatting, and the one sentence a row says about when a chat was last touched and how big it
 * is.
 *
 * The rows themselves are `surfaces/ai-chat.json` now, and what a row DOES — open, delete, and the
 * `assistant.newChat` record its header runs — is asserted against the mounted document in
 * `tests/ai-panel.test.ts`. This file is what is left when the markup goes: two pure functions.
 */
import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import { projectSession, projectSessions, relativeTime } from "../src/panels/ai-chat/sessions-view";
import type { SessionMeta } from "../src/services/ai-session-store";

const NOW = Date.parse("2026-07-06T12:00:00Z");

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    createdAt: NOW - 60_000,
    id: "s1",
    messageCount: 3,
    title: "Build a landing page",
    updatedAt: NOW - 60_000,
    ...overrides,
  };
}

describe("relativeTime", () => {
  const MIN = 60_000;
  const cases: [number, string][] = [
    [0, "just now"],
    [30_000, "just now"],
    [MIN, "1m ago"],
    [5 * MIN, "5m ago"],
    [60 * MIN, "1h ago"],
    [23 * 60 * MIN, "23h ago"],
    [25 * 60 * MIN, "yesterday"],
    [3 * 24 * 60 * MIN, "3d ago"],
  ];
  for (const [delta, expected] of cases) {
    test(`${delta}ms ago → "${expected}"`, () => {
      expect(relativeTime(NOW - delta, NOW)).toBe(expected);
    });
  }

  test("older than a week → locale date", () => {
    const ts = NOW - 10 * 24 * 60 * MIN;
    expect(relativeTime(ts, NOW)).toBe(new Date(ts).toLocaleDateString());
  });

  test("future timestamps clamp to just now", () => {
    expect(relativeTime(NOW + 5000, NOW)).toBe("just now");
  });
});

describe("projectSession", () => {
  test("the row is its id, its title, and one sentence of metadata", () => {
    const row = projectSession(meta());
    expect(row.key).toBe("s1");
    expect(row.title).toBe("Build a landing page");
    expect(row.meta).toContain("3 messages");
  });

  test("one message is singular — a count with the wrong noun reads as a bug", () => {
    expect(projectSession(meta({ messageCount: 1 })).meta).toContain("1 message");
    expect(projectSession(meta({ messageCount: 1 })).meta).not.toContain("messages");
  });

  test("the key is the session id, so a re-listing reconciles rows rather than rebuilding them", () => {
    const rows = projectSessions([meta(), meta({ id: "s2", title: "Second chat" })]);
    expect(rows.map((r) => r.key)).toEqual(["s1", "s2"]);
  });

  test("no sessions, no rows — the surface draws its own empty state from `hasSessions`", () => {
    expect(projectSessions([])).toEqual([]);
  });
});
