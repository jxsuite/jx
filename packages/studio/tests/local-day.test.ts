import { describe, expect, test } from "bun:test";
import { localDay } from "../src/utils/local-day";
import { formatModified } from "../src/browse/library-layouts";

describe("localDay", () => {
  test("names the local calendar day, not the UTC one", () => {
    // Late evening local time: the UTC day has already rolled over west of Greenwich.
    const evening = new Date(2026, 9, 17, 23, 30);
    expect(localDay(evening)).toBe("2026-10-17");
    expect(formatModified(evening.toISOString())).toBe("2026-10-17");
    // Just after local midnight: the UTC day lags east of Greenwich.
    expect(localDay(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });

  test("an invalid date is the empty string", () => {
    expect(localDay(new Date("nonsense"))).toBe("");
  });
});
