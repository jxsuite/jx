import { describe, expect, it } from "bun:test";
import { formatBuildTime, resolveBuildTime } from "../src/site/build-time.ts";

const NEVER = (): Date => {
  throw new Error("the clock must not be read");
};

describe("resolveBuildTime", () => {
  it("is SOURCE_DATE_EPOCH, and never reads the clock, when it is set", () => {
    // 2025-06-02T00:00:00Z
    expect(resolveBuildTime({ SOURCE_DATE_EPOCH: "1748822400" }, NEVER)).toBe(
      "2025-06-02T00:00:00Z",
    );
  });

  it("accepts the epoch itself, which is a valid build instant", () => {
    expect(resolveBuildTime({ SOURCE_DATE_EPOCH: "0" }, NEVER)).toBe("1970-01-01T00:00:00Z");
  });

  it("is the clock, to the second, when it is unset", () => {
    const clock = () => new Date("2026-11-16T09:30:00.789Z");
    expect(resolveBuildTime({}, clock)).toBe("2026-11-16T09:30:00Z");
  });

  it("treats an empty SOURCE_DATE_EPOCH as unset", () => {
    const clock = () => new Date("2026-11-16T09:30:00Z");
    expect(resolveBuildTime({ SOURCE_DATE_EPOCH: "" }, clock)).toBe("2026-11-16T09:30:00Z");
  });

  it("reads the real clock by default", () => {
    expect(resolveBuildTime({})).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("fails on a value that is not a non-negative integer number of seconds", () => {
    for (const bad of ["yesterday", "-1", "1.5", "1e9", " 10", "99999999999999999999"]) {
      expect(() => resolveBuildTime({ SOURCE_DATE_EPOCH: bad }, NEVER)).toThrow(RangeError);
    }
  });
});

describe("formatBuildTime", () => {
  it("drops the milliseconds and keeps UTC", () => {
    expect(formatBuildTime(new Date("2026-01-02T03:04:05.678Z"))).toBe("2026-01-02T03:04:05Z");
  });
});
