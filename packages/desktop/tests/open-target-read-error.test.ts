/**
 * A candidate project file that opens but then cannot be read (specs/desktop.md §4.6).
 *
 * An I/O error after the open cannot be staged with permissions, which fail the open itself, so
 * `fstatSync` is doubled to throw the way a failing disk or a vanished network share does.
 */
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

let failing = false;
const realFstat = fs.fstatSync;
void mock.module("node:fs", () => ({
  ...fs,
  fstatSync: (descriptor: number) => {
    if (failing) {
      throw Object.assign(new Error("EIO: i/o error, fstat"), { code: "EIO" });
    }
    return realFstat(descriptor);
  },
}));

const { resolveOpenTarget } = await import("../src/backend/project-session");

let scratch: string;

function write(path: string, text: string): string {
  const absolute = join(scratch, path);
  fs.mkdirSync(dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text);
  return absolute;
}

beforeAll(() => {
  const made = fs.mkdtempSync(join(tmpdir(), "jx-open-target-eio-"));
  scratch = fs.realpathSync(made);
  write("outer/project.json", '{ "name": "Outer" }');
  write("outer/inner/project.json", '{ "name": "Inner" }');
  write("outer/inner/pages/a.json", "{}");
});

afterAll(() => {
  failing = false;
  fs.rmSync(scratch, { force: true, recursive: true });
});

test("a project file that fails to read stops the walk and says so", () => {
  failing = true;
  try {
    const target = resolveOpenTarget(join(scratch, "outer/inner/pages/a.json"));
    // Not the folder above: an unreadable candidate is still the nearest project.
    expect(target).toMatchObject({ kind: "project", root: join(scratch, "outer/inner") });
    expect(target.kind === "project" ? target.problem : null).toContain("can't read");
  } finally {
    failing = false;
  }
});
