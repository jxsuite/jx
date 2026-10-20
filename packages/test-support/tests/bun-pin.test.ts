import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MARKER_DIR,
  MARKER_TTL_MS,
  PIN_FILE,
  REPO_ROOT,
  bunPinWarning,
  readPinnedBunVersion,
  warnOnBunMismatch,
  writeStderr,
} from "../src/bun-pin.ts";
import type { PinCheck } from "../src/bun-pin.ts";

/** Runs `use` with a fresh temporary directory, removed afterwards. */
function inTemp(use: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "jx-bun-pin-test-"));
  try {
    use(dir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function withPin(contents: string | undefined, read: (root: string) => void): void {
  inTemp((root) => {
    if (contents !== undefined) {
      writeFileSync(join(root, PIN_FILE), contents);
    }
    read(root);
  });
}

describe("readPinnedBunVersion", () => {
  test("reads the repository's pin, an exact version", () => {
    expect(readPinnedBunVersion()).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(readPinnedBunVersion(REPO_ROOT)).toBe(readPinnedBunVersion());
  });

  test("trims the file, and refuses a range, an empty file and a missing one", () => {
    withPin("1.2.3\n", (root) => {
      expect(readPinnedBunVersion(root)).toBe("1.2.3");
    });
    withPin("1.4", (root) => {
      expect(readPinnedBunVersion(root)).toBe(undefined);
    });
    withPin("", (root) => {
      expect(readPinnedBunVersion(root)).toBe(undefined);
    });
    withPin(undefined, (root) => {
      expect(readPinnedBunVersion(root)).toBe(undefined);
    });
  });
});

describe("bunPinWarning", () => {
  test("is silent when the versions agree or there is no pin", () => {
    expect(bunPinWarning("1.4.3", "1.4.3")).toBe(undefined);
    expect(bunPinWarning("1.4.3")).toBe(undefined);
  });

  test("names both versions, the file and where to read more", () => {
    expect(bunPinWarning("1.4.2", "1.4.3")).toBe(
      "local Bun 1.4.2, CI pins 1.4.3 (.bun-version): results may differ; see AGENTS.md, Testing & Coverage Policy.",
    );
  });
});

describe("warnOnBunMismatch", () => {
  /** A mismatched check writing into `lines`, with its markers under `dir`. */
  function check(dir: string, lines: string[], overrides: Partial<PinCheck> = {}): PinCheck {
    return {
      local: "1.4.2",
      markerDir: join(dir, "markers"),
      now: Date.now(),
      pid: 4242,
      pinned: "1.4.3",
      write: (line) => {
        lines.push(line);
      },
      ...overrides,
    };
  }

  test("writes one line once per process, however many files the run isolates", () => {
    inTemp((dir) => {
      const lines: string[] = [];
      const first = warnOnBunMismatch(check(dir, lines));
      const second = warnOnBunMismatch(check(dir, lines));
      const otherRun = warnOnBunMismatch(check(dir, lines, { pid: 4343 }));
      expect([first, second, otherRun]).toEqual([true, false, true]);
      expect(lines).toEqual([
        `${bunPinWarning("1.4.2", "1.4.3")}\n`,
        `${bunPinWarning("1.4.2", "1.4.3")}\n`,
      ]);
    });
  });

  test("an expired marker is pruned, so a reused process id warns again", () => {
    inTemp((dir) => {
      const lines: string[] = [];
      warnOnBunMismatch(check(dir, lines));
      const marker = join(dir, "markers", "4242");
      const old = (Date.now() - MARKER_TTL_MS - 60_000) / 1000;
      utimesSync(marker, old, old);
      expect(warnOnBunMismatch(check(dir, lines))).toBe(true);
      expect(lines).toHaveLength(2);
      expect(existsSync(marker)).toBe(true);
    });
  });

  test("writes nothing, and leaves no marker, when the versions agree", () => {
    inTemp((dir) => {
      const lines: string[] = [];
      expect(warnOnBunMismatch(check(dir, lines, { local: "1.4.3" }))).toBe(false);
      expect(lines).toEqual([]);
      expect(existsSync(join(dir, "markers"))).toBe(false);
    });
  });

  test("an unwritable marker directory never throws: every file warns instead of once", () => {
    inTemp((dir) => {
      const lines: string[] = [];
      /* A regular file where the directory should be: mkdir fails (ENOTDIR), as it does when the
         temporary directory is missing or read-only. */
      writeFileSync(join(dir, "blocked"), "");
      const blocked = { markerDir: join(dir, "blocked", "markers") };
      const outcomes = [
        warnOnBunMismatch(check(dir, lines, blocked)),
        warnOnBunMismatch(check(dir, lines, blocked)),
      ];
      expect(outcomes).toEqual([true, true]);
      expect(lines).toHaveLength(2);
    });
  });

  test("a marker that vanishes while it is pruned is skipped", () => {
    inTemp((dir) => {
      const lines: string[] = [];
      const markers = join(dir, "markers");
      mkdirSync(markers);
      /* A dangling link: listed by readdir, and ENOENT to stat, exactly like a marker another run
         removed between the two calls. */
      symlinkSync(join(dir, "gone"), join(markers, "1"));
      expect(warnOnBunMismatch(check(dir, lines))).toBe(true);
      expect(lines).toHaveLength(1);
    });
  });

  test("the preload's markers live in the system temporary directory", () => {
    expect(MARKER_DIR).toBe(join(tmpdir(), "jx-bun-pin"));
  });

  test("the preload's writer goes to stderr", () => {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    };
    try {
      writeStderr("a line\n");
    } finally {
      process.stderr.write = original;
    }
    expect(written).toEqual(["a line\n"]);
  });
});
