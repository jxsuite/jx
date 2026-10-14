/** Canvas perf gaps — perfLog's debug-enabled console output and the localStorage-throws guard. */
import "./with-dom.js";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { canvasPerf, perfLog, recordEscalation, resetCanvasPerf } from "../src/canvas/canvas-perf";

afterEach(() => {
  localStorage.removeItem("jx-canvas-debug");
  resetCanvasPerf();
});

describe("perfLog", () => {
  test("logs the event with its detail when debug mode is on", () => {
    localStorage.setItem("jx-canvas-debug", "1");
    const debug = spyOn(console, "debug").mockImplementation(() => {});
    try {
      perfLog("test-event", { n: 1 });
      expect(debug).toHaveBeenCalledWith("[jx-canvas] test-event", { n: 1 });
      // Detail defaults to an empty string.
      perfLog("bare-event");
      expect(debug).toHaveBeenCalledWith("[jx-canvas] bare-event", "");
    } finally {
      debug.mockRestore();
    }
  });

  test("stays silent when debug mode is off, reading the flag on every call", () => {
    const debug = spyOn(console, "debug").mockImplementation(() => {});
    try {
      perfLog("quiet-event");
      localStorage.setItem("jx-canvas-debug", "1");
      perfLog("loud-event");
      // Only the event logged after the flag flipped reaches the console.
      expect(debug.mock.calls).toEqual([["[jx-canvas] loud-event", ""]]);
    } finally {
      debug.mockRestore();
    }
  });

  test("treats a throwing localStorage as debug-off", () => {
    const getItem = spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const debug = spyOn(console, "debug").mockImplementation(() => {});
    try {
      expect(() => recordEscalation("guarded")).not.toThrow();
      expect(debug).not.toHaveBeenCalled();
      expect(canvasPerf.lastEscalationReason).toBe("guarded");
    } finally {
      getItem.mockRestore();
      debug.mockRestore();
    }
  });
});
