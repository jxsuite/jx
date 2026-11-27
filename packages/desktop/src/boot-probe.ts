/**
 * The boot probe: a launcher's report of what its window's adapter asked of the backend.
 *
 * `specs/desktop.md` §3.3 asks that a packaged window be observed registering the desktop adapter.
 * CI cannot read a shipped Electron window's page, so the Bun side records the requests the page
 * sends. A launcher started with `JX_STUDIO_BOOT_PROBE` set to a path writes there every distinct
 * request name, in first-seen order, and quits once Studio's entry asks for `getSettings`, which it
 * does unconditionally after passing its platform gate and mounting its shell. Any request proves
 * the adapter was constructed and answers; `getSettings` proves Studio runs on it.
 *
 * Imports only `node:fs` and `node:path`, so the backend loads it.
 *
 * @docs extending/contributing/monorepo
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The environment variable that switches the probe on, holding the report's path. */
export const BOOT_PROBE_ENV = "JX_STUDIO_BOOT_PROBE";
/** The request that settles a boot: Studio's last unconditional boot hydration. */
export const BOOT_SETTLE_REQUEST = "getSettings";

/** What a probe saw. */
export interface BootReport {
  firstRequestMs: number | null;
  launcher: "electron";
  /** Distinct request names in first-seen order. */
  requests: string[];
  settled: boolean;
  settledMs: number | null;
}

/** A running probe. */
export interface BootProbe {
  /** Record that the adapter sent `name`. */
  note: (name: string) => void;
  readonly report: BootReport;
}

/** What a probe is built from. */
export interface BootProbeOptions {
  launcher: BootReport["launcher"];
  now?: () => number;
  /** Called once, when the boot settles. */
  quit: () => void;
  /** Where the report is written. */
  path: string;
  /** How a file is written; a parameter so a test can watch the temp file and the rename. */
  write?: (path: string, text: string) => void;
}

/** Write through a temp file and a rename, so a reader never sees a torn report. */
function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

/**
 * Create a probe.
 *
 * @param options Its report path, clock and exit.
 */
export function createBootProbe(options: BootProbeOptions): BootProbe {
  const { launcher, path, quit } = options;
  const now = options.now ?? Date.now;
  const write = options.write ?? writeAtomically;
  const started = now();
  const report: BootReport = {
    firstRequestMs: null,
    launcher,
    requests: [],
    settled: false,
    settledMs: null,
  };
  return {
    note(name) {
      if (report.settled || report.requests.includes(name)) {
        return;
      }
      const elapsed = now() - started;
      report.requests.push(name);
      report.firstRequestMs ??= elapsed;
      const settles = name === BOOT_SETTLE_REQUEST;
      if (settles) {
        report.settled = true;
        report.settledMs = elapsed;
      }
      write(path, JSON.stringify(report, null, 2));
      if (settles) {
        quit();
      }
    },
    report,
  };
}

/**
 * The probe the environment asks for.
 *
 * @param env The process environment.
 * @param launcher Which entry is asking.
 * @param quit How this entry ends.
 * @returns Null when the variable is unset or empty.
 */
export function bootProbeFromEnv(
  env: NodeJS.ProcessEnv,
  launcher: BootReport["launcher"],
  quit: () => void,
): BootProbe | null {
  const path = env[BOOT_PROBE_ENV];
  return path ? createBootProbe({ launcher, path, quit }) : null;
}

/** What a handler answers: JSON, or nothing. */
type Answer = object | string | number | boolean | null | undefined;
/** A handler of any parameters, sync or async. */
type RecordedHandler = (...args: never[]) => Answer | Promise<Answer> | Promise<void>;

/**
 * Wrap a handler map so each call is noted first.
 *
 * @param probe The probe, or null for none.
 * @param handlers The RPC map.
 * @returns `handlers` itself when there is no probe.
 */
export function recordBootRequests<H extends Record<string, RecordedHandler>>(
  probe: BootProbe | null,
  handlers: H,
): H {
  if (!probe) {
    return handlers;
  }
  const wrapped: Record<string, RecordedHandler> = {};
  for (const [name, handler] of Object.entries(handlers)) {
    wrapped[name] = (...args) => {
      probe.note(name);
      return handler(...args);
    };
  }
  /* SAFETY: same keys, each a function with its original signature. */
  return wrapped as H;
}

/** The verdict on a report. */
export interface BootVerdict {
  ok: boolean;
  summary: string;
}

/**
 * Judge a report.
 *
 * @param report What the probe wrote, or null when nothing was written.
 */
export function judgeBootReport(report: BootReport | null): BootVerdict {
  if (!report) {
    return {
      ok: false,
      summary: `The launcher never started a probe; is ${BOOT_PROBE_ENV} reaching it?`,
    };
  }
  if (report.requests.length === 0) {
    return {
      ok: false,
      summary:
        "The window's adapter never called its backend: the init bundle threw or never constructed the adapter; the boot-failure screen names the error.",
    };
  }
  if (!report.settled) {
    return {
      ok: false,
      summary: `The adapter answered (${report.requests.join(", ")}) but Studio's entry never called ${BOOT_SETTLE_REQUEST}.`,
    };
  }
  return {
    ok: true,
    summary: `Studio ran on the registered adapter: ${BOOT_SETTLE_REQUEST} arrived ${report.settledMs} ms after launch (first request at ${report.firstRequestMs} ms).`,
  };
}
