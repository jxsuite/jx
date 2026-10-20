/**
 * The local half of the Bun pin. CI installs exactly the version in the repository's `.bun-version`
 * (`.github/actions/setup-bun` reads it, and `scripts/bun-pin.test.ts` refuses a workflow that sets
 * its own), and coverage figures, matcher output and even whether a failure fails at all have moved
 * between Bun patch releases. So a run on a different Bun says so, once, on stderr. It never fails
 * the run: a newer local Bun is a reasonable thing to be trying, and nothing it touches on disk is
 * allowed to throw. Where the marker directory cannot be written (a missing or read-only temporary
 * directory, as some sandboxes have), the line is printed by every file instead of once.
 *
 * @docs extending/contributing/monorepo
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The file that holds the pin, at the repository root. */
export const PIN_FILE = ".bun-version";

/** Where the pin's rationale is written down. */
const SEE = "AGENTS.md, Testing & Coverage Policy";

/** The repository root, three levels above this file (`packages/test-support/src`). */
export const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** Where the once-per-run markers live: one empty file per `bun test` process that has warned. */
export const MARKER_DIR = join(tmpdir(), "jx-bun-pin");

/**
 * How long a marker counts. Longer than any test run, and short enough that a process id the kernel
 * hands out again later is not mistaken for the run that warned.
 */
export const MARKER_TTL_MS = 12 * 60 * 60 * 1000;

/** The pinned version, or undefined when the file is absent or does not hold an exact version. */
export function readPinnedBunVersion(root: string = REPO_ROOT): string | undefined {
  let text: string;
  try {
    text = readFileSync(join(root, PIN_FILE), "utf8");
  } catch {
    return undefined;
  }
  const version = text.trim();
  return /^\d+\.\d+\.\d+$/u.test(version) ? version : undefined;
}

/** The one-line warning for `local` against `pinned`, or undefined when they agree. */
export function bunPinWarning(local: string, pinned?: string): string | undefined {
  if (pinned === undefined || local === pinned) {
    return undefined;
  }
  return `local Bun ${local}, CI pins ${pinned} (${PIN_FILE}): results may differ; see ${SEE}.`;
}

/** The preload's writer: stderr, so the line never mixes into a test's own stdout. */
export function writeStderr(line: string): void {
  process.stderr.write(line);
}

/** What {@link warnOnBunMismatch} reads and writes, injectable for its own tests. */
export interface PinCheck {
  local: string;
  pinned: string | undefined;
  /** The `bun test` process, the one thing every isolated file in a run shares. */
  pid: number;
  markerDir: string;
  now: number;
  write: (line: string) => void;
}

/**
 * Removes markers older than {@link MARKER_TTL_MS}, so the directory stays a handful of files. A
 * marker another run removes first is skipped, and an unreadable directory prunes nothing.
 */
function pruneMarkers(dir: string, now: number): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (now - statSync(path).mtimeMs > MARKER_TTL_MS) {
        rmSync(path, { force: true });
      }
    } catch {
      // Gone already, or not ours to remove: either way it is not this run's marker.
    }
  }
}

/**
 * Leaves this run's marker, and answers whether this file is the first of the run to warn. A marker
 * that is already there means an earlier file warned; any other failure to write one means there is
 * no record to keep, so every file warns rather than none.
 */
function claimMarker(dir: string, pid: number): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, String(pid)), "", { flag: "wx" });
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "EEXIST");
  }
}

/**
 * Prints {@link bunPinWarning} at most once per `bun test` run, and returns whether it printed.
 *
 * Once per run needs state that outlives a file, and `--isolate` gives every file a fresh realm:
 * globals, `process.env` and `Bun.env` writes are all gone by the next file (measured). The process
 * id is what they share, so the first file to warn leaves a marker named for it.
 */
export function warnOnBunMismatch(check: PinCheck): boolean {
  const warning = bunPinWarning(check.local, check.pinned);
  if (warning === undefined) {
    return false;
  }
  pruneMarkers(check.markerDir, check.now);
  if (!claimMarker(check.markerDir, check.pid)) {
    return false;
  }
  check.write(`${warning}\n`);
  return true;
}
