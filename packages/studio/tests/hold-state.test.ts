/**
 * The hold axis (site-architecture.md §7.6): Studio reading a project's own rules. No field means
 * anything here until a rule says so, which is the whole difference from a built-in `draft`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  NOT_HELD,
  applyHoldFilter,
  hasHold,
  holdFields,
  holdMeaning,
  holdOf,
  holdStatus,
  holdSwitch,
  holdView,
  includingHeld,
  setIncludeHeld,
} from "../src/content/hold-state";

const DRAFT = { label: "Draft", when: { draft: true } };
const REVIEW = { label: "Pending client review", when: { review: { $nin: ["approved"] } } };
const SCHEDULED = { label: "Scheduled", when: { publishDate: { $gt: { $now: true } } } };

afterEach(() => {
  holdView.includeHeld = false;
});

describe("a collection with no rules", () => {
  test("has no state, whatever its entries say", () => {
    for (const def of [null, undefined, {}, { hold: [] }]) {
      expect(hasHold(def)).toBe(false);
      expect(holdOf(def, { draft: true })).toBeNull();
      expect(holdStatus(def, { draft: true })).toBe("");
      expect(holdSwitch(def)).toBeNull();
      expect(holdFields(def)).toEqual([]);
    }
  });

  test("a value that is not a list is no rules", () => {
    expect(hasHold({ hold: "draft" })).toBe(false);
    expect(holdFields({ hold: { draft: true } })).toEqual([]);
  });
});

describe("holdOf", () => {
  const def = { hold: [DRAFT, REVIEW, SCHEDULED] };

  test("the first matching rule names why", () => {
    expect(holdOf(def, { draft: true, review: "pending" })).toBe("Draft");
    expect(holdOf(def, { review: "pending" })).toBe("Pending client review");
    expect(holdOf(def, { publishDate: "2999-01-01", review: "approved" })).toBe("Scheduled");
    expect(holdOf(def, { review: "approved" })).toBeNull();
  });

  test("only what the rule says counts", () => {
    const flag = { hold: [DRAFT] };
    expect(holdOf(flag, { draft: "true" })).toBeNull();
    expect(holdOf(flag, { draft: 1 })).toBeNull();
    expect(holdOf(flag, { draft: false })).toBeNull();
    expect(holdOf(flag, {})).toBeNull();
    expect(holdOf(flag, null)).toBeNull();
  });

  test("a project may call its field anything", () => {
    const def2 = { hold: [{ label: "Embargoed", when: { embargoed: true } }] };
    expect(holdOf(def2, { embargoed: true })).toBe("Embargoed");
    expect(holdOf(def2, { draft: true })).toBeNull();
  });

  test("the same rules list is compiled once and answers the clock each time", () => {
    const stable = { hold: [SCHEDULED] };
    expect(holdOf(stable, { publishDate: "2999-01-01" })).toBe("Scheduled");
    expect(holdOf(stable, { publishDate: "2000-01-01" })).toBeNull();
  });

  /* The build is who reports a malformed rule. An editor that threw here could not open the file. */
  test("rules that cannot compile hold nothing rather than break the editor", () => {
    const broken = { hold: [{ label: "x", when: {} }] };
    expect(hasHold(broken)).toBe(true);
    expect(holdOf(broken, { a: 1 })).toBeNull();
    expect(holdOf(broken, { a: 2 })).toBeNull();
  });
});

describe("holdStatus", () => {
  test("is the rule's label, or Published where there are rules", () => {
    const def = { hold: [DRAFT] };
    expect(holdStatus(def, { draft: true })).toBe("Draft");
    expect(holdStatus(def, {})).toBe(NOT_HELD);
  });
});

describe("holdSwitch", () => {
  test("is the first rule on one field equal to true", () => {
    expect(holdSwitch({ hold: [REVIEW, DRAFT] })).toEqual({ field: "draft", label: "Draft" });
  });

  test("a date or a list of values has no one other state to flip to", () => {
    expect(holdSwitch({ hold: [REVIEW, SCHEDULED] })).toBeNull();
  });

  test.each([
    ["two fields", { label: "x", when: { a: true, b: true } }],
    ["a value other than true", { label: "x", when: { a: false } }],
    ["no label", { when: { a: true } }],
    ["no when", { label: "x" }],
    ["not an object", "draft"],
  ])("%s is no switch", (_name, rule) => {
    expect(holdSwitch({ hold: [rule] })).toBeNull();
  });
});

describe("holdFields", () => {
  test("names what a surface must repaint on", () => {
    expect(holdFields({ hold: [DRAFT, SCHEDULED, "junk", { label: "x" }] })).toEqual([
      "draft",
      "publishDate",
    ]);
  });
});

describe("holdMeaning", () => {
  test("says what being held does, because the build now does it", () => {
    const meaning = holdMeaning("Draft");
    expect(meaning).toContain("Held: Draft");
    expect(meaning).toContain("production build leaves it out");
    expect(holdMeaning(null)).toContain("publishes it");
  });
});

describe("the perspective", () => {
  test("defaults to hiding held entries, and is set rather than toggled", () => {
    expect(includingHeld()).toBe(false);
    setIncludeHeld(true);
    setIncludeHeld(true);
    expect(includingHeld()).toBe(true);
    setIncludeHeld(false);
    expect(includingHeld()).toBe(false);
  });

  const items = [{ draft: true, id: "a" }, { id: "b" }];
  const def = { hold: [DRAFT] };

  test("hides what a rule holds", () => {
    expect(applyHoldFilter(items, def, (item) => item, false).map((i) => i.id)).toEqual(["b"]);
  });

  test("including them, or having no rules, returns the very list it was given", () => {
    expect(applyHoldFilter(items, def, (item) => item, true)).toBe(items);
    expect(applyHoldFilter(items, {}, (item) => item, false)).toBe(items);
    expect(applyHoldFilter(items, null, (item) => item, false)).toBe(items);
  });
});
