import { describe, expect, test } from "bun:test";

import type { JsonObject } from "@jxsuite/schema/types";

import { analyze, categoryOf, mainThreads, selfTimeBreakdown } from "./analysis.ts";
import { lookupMapped, parseMappings } from "./sources.ts";

const SOURCE_MAP = {
  sources: ["../../src/ui/example.ts"],
  mappings: ";;;CAGCS",
};

function eventOf(name: string, durMs: number, args: JsonObject = {}) {
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
      // Back to back, not overlapping: two tasks at one timestamp would be one nested in the other.
      { ...eventOf("RunTask", 40), ts: 0 },
      { ...eventOf("RunTask", 60), ts: 50_000 },
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

/** A complete (`ph: "X"`) event on a given thread, timed in milliseconds. */
function slice(name: string, tsMs: number, durMs: number, pid = 7, tid = 7) {
  return { name, ph: "X", cat: "devtools.timeline", pid, tid, ts: tsMs * 1000, dur: durMs * 1000 };
}

/** The metadata event Chrome emits to name a thread. */
function threadName(name: string, pid: number, tid: number) {
  return { name: "thread_name", ph: "M", pid, tid, args: { name } };
}

describe("mainThreads", () => {
  test("reads the renderer main thread from the thread_name metadata, whatever its tid", () => {
    const events = [threadName("CrRendererMain", 7, 7), threadName("Compositor", 7, 9)];
    expect([...mainThreads(events)]).toEqual(["7:7"]);
  });

  test("falls back to tid 1 when a trace carries no thread metadata", () => {
    expect([...mainThreads([eventOf("RunTask", 1)])]).toEqual(["0:1"]);
  });
});

describe("analyze on a current Chrome", () => {
  test("counts ThreadControllerImpl::RunTask envelopes on the main thread, outermost only", () => {
    const events = [
      threadName("CrRendererMain", 7, 7),
      slice("ThreadControllerImpl::RunTask", 0, 80),
      // A nested run loop's task inside the first is not a second task a user waited on.
      slice("ThreadControllerImpl::RunTask", 10, 60),
      slice("ThreadControllerImpl::RunTask", 100, 20),
      // Another thread's task is not main-thread work.
      slice("ThreadControllerImpl::RunTask", 0, 500, 7, 9),
    ];
    const out = analyze("t", 200, events);
    expect(out.busyMs).toBe(100);
    expect(out.longTasks).toEqual([80]);
  });

  /* Every capture opens with the CPU profiler starting, which interrupts the renderer in a task of
     its own: it set the max-task column of five scenarios whose own longest task was half of it. */
  test("a task that is the profiler starting is the tracer's, not a long task of the app", () => {
    const events = [
      threadName("CrRendererMain", 7, 7),
      slice("ThreadControllerImpl::RunTask", 0, 120),
      slice("V8.InvokeApiInterruptCallbacks", 5, 110),
      // The app's own task, with a short interrupt inside it: still the app's.
      slice("ThreadControllerImpl::RunTask", 200, 70),
      slice("V8.InvokeApiInterruptCallbacks", 210, 5),
    ];
    const out = analyze("t", 300, events);
    expect(out.longTasks).toEqual([70]);
    expect(out.busyMs).toBe(70);
  });
});

describe("selfTimeBreakdown", () => {
  test("bills each event's own time to its category and an envelope's to nobody", () => {
    const events = [
      slice("ThreadControllerImpl::RunTask", 0, 100),
      slice("FunctionCall", 10, 50),
      // A forced style recalc inside the script is rendering, not scripting.
      slice("UpdateLayoutTree", 20, 15),
      // An uncategorised V8 interrupt inside the script inherits scripting.
      slice("V8.HandleInterrupts", 40, 5),
      slice("RunMicrotasks", 70, 10),
      slice("Paint", 85, 5),
      slice("MinorGC", 92, 2),
      // Off the main thread, so ignored.
      slice("FunctionCall", 0, 300, 7, 9),
    ];
    const out = selfTimeBreakdown(events, new Set(["7:7"]));
    expect(out.scripting).toBeCloseTo(45);
    expect(out.rendering).toBeCloseTo(15);
    expect(out.painting).toBeCloseTo(5);
    expect(out.gc).toBeCloseTo(2);
    expect(out.loading).toBe(0);
  });

  test("clamps a child that overruns its parent rather than billing time twice", () => {
    const out = selfTimeBreakdown(
      [slice("FunctionCall", 0, 10), slice("Layout", 5, 20)],
      new Set(["7:7"]),
    );
    expect(out.scripting).toBeCloseTo(5);
    expect(out.rendering).toBeCloseTo(5);
  });
});

describe("analyze CPU profile self time", () => {
  test("weights samples by timeDeltas and resolves nodes a previous chunk declared", () => {
    const frame = {
      functionName: "hot",
      url: "http://h/packages/studio/dist/studio.js",
      lineNumber: 9,
    };
    const chunk = (data: JsonObject) => ({
      name: "ProfileChunk",
      ph: "P",
      id: "0x1",
      pid: 7,
      tid: 7,
      ts: 0,
      args: { data },
    });
    const events = [
      chunk({
        cpuProfile: { nodes: [{ id: 2, callFrame: frame }], samples: [2] },
        timeDeltas: [20_000],
      }),
      // The second chunk declares no nodes: its sample names node 2 from the first.
      chunk({ cpuProfile: { samples: [2, 3] }, timeDeltas: [30_000, 5000] }),
    ];
    const out = analyze("t", 1, events);
    expect(out.topFrames[0]).toEqual({
      label: "hot /packages/studio/dist/studio.js:9",
      selfMs: 50,
      totalMs: 0,
    });
  });
});

describe("categoryOf", () => {
  test("names the bucket for known events and null for envelopes", () => {
    expect(categoryOf("EventDispatch")).toBe("scripting");
    expect(categoryOf("Layout")).toBe("rendering");
    expect(categoryOf("RasterizeTile")).toBe("painting");
    expect(categoryOf("V8.GC_SCAVENGER")).toBe("gc");
    expect(categoryOf("ResourceSendRequest")).toBe("loading");
    expect(categoryOf("ThreadControllerImpl::RunTask")).toBeNull();
  });
});
