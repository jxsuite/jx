import { describe, expect, test } from "bun:test";

import { analyze } from "./analysis.ts";
import { lookupMapped, parseMappings } from "./sources.ts";

const SOURCE_MAP = {
  sources: ["../../src/ui/example.ts"],
  mappings: ";;;CAGCS",
};

function eventOf(name: string, durMs: number, args: Record<string, unknown> = {}) {
  return { name, cat: "devtools.timeline", dur: durMs * 1000, tid: 1, ts: 100, args };
}

describe("vlq source-map lookup", () => {
  test("resolves a bundled line to its original source line", () => {
    const byLine = parseMappings(SOURCE_MAP);
    const hit = lookupMapped(byLine, SOURCE_MAP, 3, 0);
    expect(hit).not.toBeNull();
    expect(hit!.file).toBe("packages/studio/src/ui/example.ts");
    expect(hit!.line).toBe(4);
  });

  test("answers null for an unmapped line", () => {
    const byLine = parseMappings({ sources: ["../src/a.ts"], mappings: "" });
    expect(lookupMapped(byLine, { sources: ["../src/a.ts"], mappings: "" }, 40, 0)).toBeNull();
  });
});

describe("analyze", () => {
  test("buckets style and layout work on main-thread tid 1", () => {
    const events = [
      eventOf("RunTask", 40),
      eventOf("RunTask", 60),
      eventOf("UpdateLayoutTree", 30, { beginData: { totalElementCount: 200 } }),
      eventOf("Layout", 20, { beginData: { dirtyObjects: 7 } }),
      eventOf("MajorGC", 5),
    ];
    const out = analyze("t", 90, events);
    expect(out.longTasks).toEqual([60]);
    expect(out.busyMs).toBe(100);
    expect(out.styleRecalc).toEqual({ count: 1, time: 30, elements: 200 });
    expect(out.layout).toEqual({ count: 1, time: 20, invalidated: 7 });
    expect(out.gcMs).toBe(5);
  });

  test("joins a nearby style invalidation to its recalculations", () => {
    const cause = {
      name: "StyleRecalcInvalidationTracking",
      cat: "devtools.timeline.invalidationTracking",
      tid: 1,
      ts: 100,
      args: {
        data: {
          reason: " AttributeModified ",
          url: "http://127.0.0.1:3000/packages/studio/dist/studio.js",
          lineNumber: 10,
        },
      },
    };
    const recalc = {
      name: "UpdateLayoutTree",
      cat: "devtools.timeline",
      dur: 8 * 1000,
      tid: 1,
      ts: 120,
      args: { beginData: {} },
    };
    const out = analyze("t", 10, [cause, recalc]);
    expect(out.styleCauses[0]!.label).toContain("AttributeModified");
    expect(out.styleCauses[0]!.label).toContain("packages/");
  });
});
