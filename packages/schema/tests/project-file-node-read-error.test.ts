/**
 * A project file that opens and then fails to read.
 *
 * Permissions cannot stage this, because they fail the open itself, so `fstatSync` is doubled to
 * throw the way a failing disk or a vanished network share does.
 */
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const { NODE_PROJECT_WALK_IO, findEnclosingProjectOnDisk } =
  await import("../src/project-file-node.ts");

let scratch: string;

beforeAll(() => {
  const made = fs.mkdtempSync(join(tmpdir(), "jx-project-file-eio-"));
  scratch = fs.realpathSync(made);
  fs.mkdirSync(join(scratch, "outer/inner/pages"), { recursive: true });
  fs.writeFileSync(join(scratch, "outer/project.json"), '{ "name": "Outer" }');
  fs.writeFileSync(join(scratch, "outer/inner/project.json"), '{ "name": "Inner" }');
});

afterAll(() => {
  failing = false;
  fs.rmSync(scratch, { force: true, recursive: true });
});

test("a file that opens and then fails to read is there and unreadable, not absent", () => {
  failing = true;
  try {
    expect(NODE_PROJECT_WALK_IO.readText(join(scratch, "outer/inner/project.json"))).toBe("");
    // So the walk stops at it rather than opening the project above.
    expect(findEnclosingProjectOnDisk(join(scratch, "outer/inner/pages"))?.root).toBe(
      join(scratch, "outer/inner"),
    );
  } finally {
    failing = false;
  }
});
