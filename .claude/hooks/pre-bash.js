// PreToolUse(Bash) guard: the push gate.
//
// A `git push` first runs `bun run verify`: lint, the type-aware lint, both typechecks, and the tests
// the branch's diff can fail (`scripts/test-affected.ts`). It used to run `bun run all-the-things`,
// which builds every bundle and runs all ~1,240 test files in every workspace whatever the diff was,
// and that is what made each push cost the full suite. CI's `test` matrix is the gate that runs
// affected workspaces whole and holds them to their coverage thresholds; this is the fast answer
// before it, scoped the same way CI scopes itself.
//
// Nothing here runs on `git commit`. `.husky/pre-commit` formats and lints staged files and runs no
// test, so a commit never needs a test run to precede it.

const input = JSON.parse(
  await new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  }),
);

const cmd = input.tool_input?.command ?? "";

if (cmd.includes("git push")) {
  const { execSync } = await import("node:child_process");
  try {
    execSync("bun run verify", { stdio: "inherit" });
  } catch {
    process.exit(1); // Block the push
  }
}
