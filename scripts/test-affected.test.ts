import { describe, expect, test } from "bun:test";
import { commandFor, describeSelections, parseArgs } from "./test-affected.ts";
import type { Selection } from "./lib/test-selection.ts";

const some: Selection = {
  dir: "packages/studio",
  mode: "some",
  files: ["packages/studio/tests/tab.test.ts", "packages/studio/tests/harness/x.test.ts"],
  opaque: 1,
  total: 646,
  reason: "1 reached by import, 1 opaque",
};
const all: Selection = { ...some, mode: "all", reason: "bun.lock invalidates every assumption" };

describe("parseArgs", () => {
  test("defaults to the merge base, running", () => {
    expect(parseArgs([])).toEqual({
      base: undefined,
      staged: false,
      stdin: false,
      list: false,
      passthrough: [],
    });
  });

  test("reads every flag, and hands everything after -- to bun test", () => {
    expect(parseArgs(["--base", "HEAD~2", "--list", "--", "--bail", "--list"])).toEqual({
      base: "HEAD~2",
      staged: false,
      stdin: false,
      list: true,
      passthrough: ["--bail", "--list"],
    });
    expect(parseArgs(["--staged"]).staged).toBe(true);
    expect(parseArgs(["--stdin"]).stdin).toBe(true);
  });

  test("refuses what it does not know rather than ignoring it", () => {
    expect(() => parseArgs(["--coverage"])).toThrow("unknown argument: --coverage");
    expect(() => parseArgs(["--base"])).toThrow("--base needs a ref");
  });
});

describe("commandFor", () => {
  test("a narrowed run names each file as a path relative to its workspace", () => {
    // `./` matters: a bare argument is a substring filter, and `tests/tab.test.ts` would also
    // Collect `tests/grid-tab.test.ts`.
    expect(commandFor(some, ["--bail"])).toEqual([
      "test",
      "--isolate",
      "--bail",
      "./tests/tab.test.ts",
      "./tests/harness/x.test.ts",
    ]);
  });

  test("a whole run names no file, so bun collects the suite itself", () => {
    expect(commandFor(all, [])).toEqual(["test", "--isolate"]);
  });
});

describe("describeSelections", () => {
  test("says how much of each workspace runs, why, and the total", () => {
    expect(describeSelections([some, { ...all, dir: "packages/ui", total: 2 }], 1241)).toEqual([
      "  packages/studio     2/646  1 reached by import, 1 opaque",
      "  packages/ui           2/2  whole suite: bun.lock invalidates every assumption",
      "  4 of 1241 test files",
    ]);
  });
});
