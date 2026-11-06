/**
 * The content query grammar: `where` and `hold` (site-architecture.md §7.6).
 *
 * `extensions/parser/tests/content-rules.test.ts` covers the operators through the parser's
 * re-export. What is here is what those tests cannot see: the clock, and which way each filter
 * fails, because getting either wrong publishes something a project meant to keep back.
 */
import { describe, expect, test } from "bun:test";
import { compileHold, compileWhere, readField } from "../src/content-query";

const NOW = new Date("2026-11-06T12:00:00Z");
const now = () => NOW;
const NOT_YET = { label: "Scheduled", when: { publishDate: { $gt: { $now: true } } } };
const EXPIRED = { label: "Expired", when: { expiryDate: { $lte: { $now: true } } } };

describe("compileHold", () => {
  test("no rules hold nothing, whatever the entry says", () => {
    expect(compileHold()({ draft: true })).toBeUndefined();
    expect(compileHold([])({ draft: true })).toBeUndefined();
  });

  test("any rule holds, and the first to match names why", () => {
    const hold = compileHold([
      { label: "Draft", when: { draft: true } },
      { label: "Hidden", when: { hidden: true } },
    ]);
    expect(hold({ draft: true })).toBe("Draft");
    expect(hold({ hidden: true })).toBe("Hidden");
    expect(hold({ draft: true, hidden: true })).toBe("Draft");
    expect(hold({ draft: false })).toBeUndefined();
  });

  test("a rule's fields combine with AND", () => {
    const hold = compileHold([{ label: "Both", when: { a: 1, b: 2 } }]);
    expect(hold({ a: 1 })).toBeUndefined();
    expect(hold({ a: 1, b: 2 })).toBe("Both");
  });

  /* The two ways a missing field has to behave, and the reason a list of rules needs no `$or`. */
  test("a missing review holds and a missing date does not", () => {
    const hold = compileHold([
      { label: "Pending", when: { review: { $nin: ["approved", "not-needed"] } } },
      NOT_YET,
    ]);
    expect(hold({ publishDate: "2020-01-01" })).toBe("Pending");
    expect(hold({ review: "typo" })).toBe("Pending");
    expect(hold({ review: "approved" })).toBeUndefined();
  });

  test("a dotted key reads nested frontmatter", () => {
    const hold = compileHold([{ label: "Internal", when: { "meta.internal": true } }]);
    expect(hold({ meta: { internal: true } })).toBe("Internal");
  });

  describe("refuses a rule that cannot mean what it says", () => {
    test.each([
      ["not a list", { label: "x", when: { a: 1 } }, /must be an array/],
      ["no label", [{ when: { a: 1 } }], /hold\[0\].*label/],
      ["a blank label", [{ label: "  ", when: { a: 1 } }], /hold\[0\].*label/],
      ["a rule that is not an object", ["draft"], /hold\[0\].*label/],
      ["no when", [{ label: "x" }], /hold\[0\].*when/],
      ["an empty when, which would hold everything", [{ label: "x", when: {} }], /hold\[0\].*when/],
      ["a when that is not an object", [{ label: "x", when: "draft" }], /hold\[0\].*when/],
      ["a top-level operator", [{ label: "x", when: { $or: [] } }], /hold\[0\]\.when\.\$or/],
      ["an unknown operator", [{ label: "x", when: { a: { $near: 1 } } }], /hold\[0\]\.when\.a/],
    ])("%s", (_name, rules, message) => {
      expect(() => compileHold(rules)).toThrow(message);
    });

    test("a message names the rule it is about", () => {
      const rules = [
        { label: "ok", when: { a: 1 } },
        { label: "bad", when: { b: { $gt: true } } },
      ];
      expect(() => compileHold(rules)).toThrow("hold[1].when.b.$gt");
    });
  });
});

describe("$now", () => {
  const scheduled = compileHold([NOT_YET], { now });
  const expired = compileHold([EXPIRED], { now });

  test("publishing in the future holds, and in the past does not", () => {
    expect(scheduled({ publishDate: "2026-12-01" })).toBe("Scheduled");
    expect(scheduled({ publishDate: "2026-01-01" })).toBeUndefined();
  });

  test("expiring in the past holds, and in the future does not", () => {
    expect(expired({ expiryDate: "2026-01-01" })).toBe("Expired");
    expect(expired({ expiryDate: "2026-12-01" })).toBeUndefined();
  });

  test("a date range is two rules", () => {
    const window = compileHold([NOT_YET, EXPIRED], { now });
    const entry = { expiryDate: "2026-12-31", publishDate: "2026-11-01" };
    expect(window(entry)).toBeUndefined();
    expect(window({ ...entry, publishDate: "2026-11-30" })).toBe("Scheduled");
    expect(window({ ...entry, expiryDate: "2026-11-01" })).toBe("Expired");
  });

  test("a missing or empty date does not match", () => {
    expect(scheduled({})).toBeUndefined();
    expect(scheduled({ publishDate: null })).toBeUndefined();
    expect(expired({})).toBeUndefined();
  });

  /* ECMAScript answers these, so the project does not have to learn a rule of ours. */
  test("a date alone is the start of that day in UTC", () => {
    expect(scheduled({ publishDate: "2026-11-06" })).toBeUndefined();
    expect(scheduled({ publishDate: "2026-11-07" })).toBe("Scheduled");
  });

  test("a date-time compares to the instant, with its offset", () => {
    expect(scheduled({ publishDate: "2026-11-06T12:00:01Z" })).toBe("Scheduled");
    expect(scheduled({ publishDate: "2026-11-06T11:59:59Z" })).toBeUndefined();
    expect(scheduled({ publishDate: "2026-11-06T13:00:00+02:00" })).toBeUndefined();
  });

  test("a YAML date reads the same as its text", () => {
    expect(scheduled({ publishDate: new Date("2026-12-01") })).toBe("Scheduled");
    expect(scheduled({ publishDate: new Date("2026-01-01") })).toBeUndefined();
  });

  test.each([
    ["$gt", "2026-11-06T12:00:00Z", false],
    ["$gte", "2026-11-06T12:00:00Z", true],
    ["$lt", "2026-11-06T12:00:00Z", false],
    ["$lte", "2026-11-06T12:00:00Z", true],
    ["$lt", "2026-11-06T11:00:00Z", true],
  ])("%s at %s", (op, at, expected) => {
    const hold = compileHold([{ label: "x", when: { at: { [op]: { $now: true } } } }], { now });
    expect(hold({ at }) === "x").toBe(expected);
  });

  /*
   * The failure this guards is a typo publishing something early. `publishDate: next week` must not
   * read as "not in the future", so each filter fails the way that keeps the entry back: a `hold`
   * matches it, and a `where` does not.
   */
  describe("a value that is not a date fails closed", () => {
    test.each([["next week"], ["2026-13-45"], [20_261_201], [true], [["2026-12-01"]]])(
      "%j",
      (value) => {
        expect(scheduled({ publishDate: value })).toBe("Scheduled");
        const where = compileWhere({ publishDate: { $lte: { $now: true } } }, { now });
        expect(where({ publishDate: value })).toBe(false);
      },
    );

    test("so does a date that was parsed into nothing", () => {
      expect(scheduled({ publishDate: new Date("nonsense") })).toBe("Scheduled");
    });
  });

  test("`where` reads the clock too", () => {
    const where = compileWhere({ publishDate: { $lte: { $now: true } } }, { now });
    expect(where({ publishDate: "2026-01-01" })).toBe(true);
    expect(where({ publishDate: "2026-12-01" })).toBe(false);
    expect(where({})).toBe(false);
    expect(where.why({ publishDate: "2026-12-01" })).toBe("publishDate");
  });

  test("the clock is asked each time, so a long-lived host stays current", () => {
    let current = new Date("2026-01-01");
    const hold = compileHold([NOT_YET], { now: () => current });
    expect(hold({ publishDate: "2026-06-01" })).toBe("Scheduled");
    current = new Date("2026-12-01");
    expect(hold({ publishDate: "2026-06-01" })).toBeUndefined();
  });

  test("with no clock given it is the real one", () => {
    const hold = compileHold([NOT_YET]);
    expect(hold({ publishDate: "2999-01-01" })).toBe("Scheduled");
    expect(hold({ publishDate: "2000-01-01" })).toBeUndefined();
  });

  test.each([[{ $now: false }], [{ $now: true, extra: 1 }], [{}]])(
    "only { $now: true } reads the clock: %j",
    (operand) => {
      expect(() => compileHold([{ label: "x", when: { at: { $gt: operand } } }])).toThrow(
        "expected a string or number",
      );
    },
  );

  test("a literal comparison is untouched", () => {
    const hold = compileHold([{ label: "x", when: { at: { $gt: "2026-06-01" } } }]);
    expect(hold({ at: "2026-07-01" })).toBe("x");
    expect(hold({ at: "2026-05-01" })).toBeUndefined();
  });
});

describe("the query grammar, from its own package", () => {
  test("compileWhere with no query keeps everything and names nothing", () => {
    const where = compileWhere();
    expect(where({})).toBe(true);
    expect(where.why({})).toBeUndefined();
  });

  test("readField reads a literal key before a dotted path", () => {
    expect(readField({ "a.b": 1, a: { b: 2 } }, "a.b")).toBe(1);
    expect(readField({ a: { b: 2 } }, "a.b")).toBe(2);
    expect(readField({ a: 1 }, "a.b")).toBeUndefined();
  });

  test.each([
    [{ a: 1 }, { a: 1 }, true],
    [{ a: { $eq: 1 } }, { a: 1 }, true],
    [{ a: { $ne: 1 } }, {}, true],
    [{ a: { $in: [1, 2] } }, { a: 2 }, true],
    [{ a: { $nin: [1, 2] } }, { a: 2 }, false],
    [{ a: { $exists: true } }, { a: null }, false],
    [{ a: { $exists: false } }, {}, true],
    [{ a: { $gt: 1 } }, { a: 2 }, true],
    [{ a: { $gte: 2 } }, { a: 2 }, true],
    [{ a: { $lt: 1 } }, { a: 2 }, false],
    [{ a: { $lte: 2 } }, { a: 2 }, true],
    [{ a: { $gt: 1 } }, { a: "text" }, false],
    [{ a: "b" }, { a: ["a", "b"] }, true],
    [{ a: ["x"] }, { a: ["x"] }, true],
    [{ a: ["x"] }, { a: ["x", "y"] }, false],
    [{ a: { b: 1 } }, { a: { b: 1 } }, true],
    [{ a: { b: 1 } }, { a: { b: 2 } }, false],
    [{ a: { b: 1 } }, { a: { c: 1 } }, false],
    [{ a: "2026-01-01" }, { a: new Date("2026-01-01") }, true],
    [{ a: "2026-01-01T09:00:00Z" }, { a: new Date("2026-01-01T09:00:00Z") }, true],
    [{ a: "x" }, { a: new Date("nonsense") }, false],
  ])("%j over %j", (where, data, expected) => {
    expect(compileWhere(where)(data)).toBe(expected);
  });

  test.each([
    [[], /must be an object/],
    [{ $or: [] }, /where\.\$or/],
    [{ a: { $near: 1 } }, /unknown operator/],
    [{ a: { $eq: 1, b: 2 } }, /cannot mix/],
    [{ a: { $in: 1 } }, /expected an array/],
    [{ a: { $exists: 1 } }, /expected true or false/],
    [{ a: { $gt: true } }, /expected a string or number/],
  ])("refuses %j", (where, message) => {
    expect(() => compileWhere(where)).toThrow(message);
  });
});
