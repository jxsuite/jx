/**
 * A script that finds its own directory through `new URL(import.meta.url).pathname` works on Linux
 * and macOS and breaks on Windows. There the pathname is `/D:/a/jx/scripts/x.ts`, and `resolve` or
 * `dirname` reads the leading slash as the root of the current drive, so the result is
 * `D:\D:\a\jx\...` and the first read under it is ENOENT. CI runs on Linux, so nothing notices
 * until the Windows desktop build, which is a release job: `scripts/build-ui-dist.ts` failed
 * exactly that way on the release that first shipped it.
 *
 * This is a static check for that reason, like `check-posix-paths.ts`: it reads source text, so it
 * holds on any OS. `import.meta.dir` is the directory, already a native path. A line that strips
 * the drive's leading slash itself is left alone, and so are test files, which the Windows build
 * never runs.
 */

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** `new URL(<anything>, import.meta.url).pathname`, or the one-argument form. */
const URL_PATHNAME = /new URL\([^)]*import\.meta\.url\)\.pathname/;

/** The pathname with a Windows drive's leading slash removed on the same line. */
const DRIVE_HANDLED = /\.pathname\.replace\(\/\^\\\/\(\[A-Za-z\]:\)\//;

test("no script derives a filesystem path from import.meta.url's pathname", () => {
  const files = execFileSync("git", ["ls-files", "*.ts"], { encoding: "utf8" })
    .split("\n")
    .filter((file) => file && !/(?:^|\/)tests\/|\.test\.ts$/.test(file));
  expect(files.length).toBeGreaterThan(100);

  const offenders: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (URL_PATHNAME.test(line) && !DRIVE_HANDLED.test(line)) {
        offenders.push(`${file}:${index + 1}`);
      }
    }
  }
  // Use `import.meta.dir` (or `fileURLToPath`) instead.
  expect(offenders).toEqual([]);
});
