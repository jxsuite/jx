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
describe("jx cli — validate lint", () => {
  it("prints an advisory finding under a valid verdict, and passes strict through", async () => {
    validateProjectTreeOptions.length = 0;
    setValidateProjectTree(() =>
      Promise.resolve({ checked: 3, issues: [], lint: [FINDING], valid: true }),
    );
    const result = await runEntry("cli", ["validate", "/tmp/jx-cli-validate-lint"]);
    expect(result.exited).toBe(false);
    expect(validateProjectTreeOptions).toEqual([{ strict: false }]);
    const out = result.logs.join("\n");
    expect(out).toContain("Project is valid (3 files checked");
    expect(out).toContain(
      "pages/index.json: error: the <button> has no accessible name. [accessibility/interactive-unnamed]",
    );
  });
});
