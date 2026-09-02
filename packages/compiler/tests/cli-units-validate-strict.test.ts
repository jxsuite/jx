/**
 * `jx validate` prints its lint findings beside the verdict, and `--strict` is what lets a lint
 * ERROR fail the tree (spec §8.7, §8.8). The verdict itself is the command's; the CLI only carries
 * the flag in and the lines out.
 */
import { describe, expect, it } from "bun:test";
import { runEntry, setValidateProjectTree, validateProjectTreeOptions } from "./_cli-harness.ts";

const FINDING = {
  file: "pages/index.json",
  message: "the <button> has no accessible name.",
  rule: "interactive-unnamed",
  severity: "error",
  source: "accessibility",
};

/* One run per file: the harness imports the entry once, and `main()` runs at import. */
describe("jx cli — validate --strict", () => {
  it("with --strict the command's INVALID verdict carries the finding on stderr and exits 1", async () => {
    validateProjectTreeOptions.length = 0;
    setValidateProjectTree((_root, options) =>
      Promise.resolve({
        checked: 3,
        issues: [],
        lint: [FINDING],
        valid: options?.strict !== true,
      }),
    );
    const result = await runEntry("cli", ["validate", "/tmp/jx-cli-validate-lint", "--strict"]);
    expect(validateProjectTreeOptions).toEqual([{ strict: true }]);
    expect(result.exited).toBe(true);
    expect(result.exitCode).toBe(1);
    const err = result.errors.join("\n");
    expect(err).toContain("Project is INVALID");
    expect(err).toContain("interactive-unnamed");
  });
});
