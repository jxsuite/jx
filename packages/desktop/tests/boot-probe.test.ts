import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOOT_PROBE_ENV,
  BOOT_SETTLE_REQUEST,
  bootProbeFromEnv,
  createBootProbe,
  judgeBootReport,
  recordBootRequests,
} from "../src/boot-probe";
import type { BootReport } from "../src/boot-probe";

const scratch = mkdtempSync(join(tmpdir(), "jx-boot-probe-test-"));
afterAll(() => rmSync(scratch, { force: true, recursive: true }));

/** A probe on a fake clock that records every write and quit. */
function fixture() {
  let clock = 1000;
  const writes: string[] = [];
  let quits = 0;
  const probe = createBootProbe({
    launcher: "electron",
    now: () => clock,
    path: join(scratch, "unused.json"),
    quit: () => {
      quits += 1;
    },
    write: (_path, text) => writes.push(text),
  });
  return {
    probe,
    quits: () => quits,
    tick: (ms: number) => {
      clock += ms;
    },
    writes,
  };
}

describe("bootProbeFromEnv / recordBootRequests", () => {
  test("inactive without JX_STUDIO_BOOT_PROBE", () => {
    expect(bootProbeFromEnv({}, "electron", () => {})).toBeNull();
    expect(bootProbeFromEnv({ [BOOT_PROBE_ENV]: "" }, "electron", () => {})).toBeNull();
    const handlers = { a: () => 1 };
    expect(recordBootRequests(null, handlers)).toBe(handlers);
  });

  test("passes arguments and results through, sync and async, and records a handler that throws before rethrowing it", async () => {
    const { probe } = fixture();
    const wrapped = recordBootRequests(probe, {
      boom: (): never => {
        throw new Error("nope");
      },
      echo: (value: number) => value + 1,
      later: (value: string) => Promise.resolve(`${value}!`),
    });
    expect(wrapped.echo(1)).toBe(2);
    expect(await wrapped.later("x")).toBe("x!");
    expect(() => wrapped.boom()).toThrow("nope");
    expect(probe.report.requests).toEqual(["echo", "later", "boom"]);
  });

  test("a probe built from the environment writes to the named path", () => {
    const path = join(scratch, "env", "report.json");
    let quit = 0;
    const probe = bootProbeFromEnv({ [BOOT_PROBE_ENV]: path }, "electron", () => {
      quit += 1;
    });
    probe?.note(BOOT_SETTLE_REQUEST);
    expect(JSON.parse(readFileSync(path, "utf8")).settled).toBe(true);
    expect(quit).toBe(1);
  });
});

describe("createBootProbe", () => {
  test("records each request name once, in first-seen order, rewriting the report as it grows", () => {
    const { probe, tick, writes } = fixture();
    probe.note("githubToken");
    tick(5);
    probe.note("recentProjects");
    probe.note("githubToken");
    expect(probe.report.requests).toEqual(["githubToken", "recentProjects"]);
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1] ?? "")).toMatchObject({
      firstRequestMs: 0,
      requests: ["githubToken", "recentProjects"],
      settled: false,
    });
  });

  test("settles on getSettings: the report says settled with both timings and quit runs once", () => {
    const { probe, quits, tick, writes } = fixture();
    probe.note("githubToken");
    tick(40);
    probe.note(BOOT_SETTLE_REQUEST);
    expect(probe.report).toMatchObject({ firstRequestMs: 0, settled: true, settledMs: 40 });
    expect(JSON.parse(writes.at(-1) ?? "").settled).toBe(true);
    expect(quits()).toBe(1);
  });

  test("requests after settling change nothing", () => {
    const { probe, quits, writes } = fixture();
    probe.note(BOOT_SETTLE_REQUEST);
    probe.note(BOOT_SETTLE_REQUEST);
    probe.note("late");
    expect(probe.report.requests).toEqual([BOOT_SETTLE_REQUEST]);
    expect(writes).toHaveLength(1);
    expect(quits()).toBe(1);
  });

  test("writes through a temp file and a rename", () => {
    const path = join(scratch, "nested", "report.json");
    const probe = createBootProbe({ launcher: "electron", path, quit: () => {} });
    probe.note("githubToken");
    expect(JSON.parse(readFileSync(path, "utf8")).requests).toEqual(["githubToken"]);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });
});

describe("judgeBootReport", () => {
  const base: BootReport = {
    firstRequestMs: null,
    launcher: "electron",
    requests: [],
    settled: false,
    settledMs: null,
  };

  test("no report: the launcher never started a probe", () => {
    const verdict = judgeBootReport(null);
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain("never started a probe");
  });

  test("no requests: the adapter never called its backend", () => {
    const verdict = judgeBootReport(base);
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain("never called its backend");
  });

  test("requests without getSettings: Studio's entry never called it", () => {
    const verdict = judgeBootReport({ ...base, requests: ["githubToken"] });
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain("(githubToken)");
    expect(verdict.summary).toContain("never called getSettings");
  });

  test("settled: passes with both timings", () => {
    const verdict = judgeBootReport({
      ...base,
      firstRequestMs: 10,
      requests: ["githubToken", "getSettings"],
      settled: true,
      settledMs: 90,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.summary).toContain("90 ms");
    expect(verdict.summary).toContain("10 ms");
  });
});
