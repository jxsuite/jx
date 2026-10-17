// Stop hook — the type-aware lint (`bun run lint:typecheck`, CI's `checks` job) over the
// TypeScript files this session changed.
//
// `.claude/hooks/validate-edit.js` already runs the same rules per edit, but ONLY on an
// Edit/Write/MultiEdit tool call. A file rewritten through Bash (a script, `sed`, a heredoc) never
// reaches it, and that is exactly how two unsafe-`any` assignments and an unnecessary `??` reached
// a pull request: they were written by scripted edits, and the plain `oxlint` that the commit gate
// ran then did not know about types. A Stop hook asks about the WORKING TREE, so the editing route
// stops mattering. `.husky/pre-commit` runs the same check on staged files, as the hard gate.
//
// Scoped to changed files rather than the whole tree: a full run takes most of a minute, and
// reporting a pre-existing finding as though this session caused it would train it to be ignored.
// Type-aware rules still read the whole program, so a file is judged against its real imports.
//
// Exit 2 feeds the report back once per stop chain (`stop_hook_active` lets the next stop through),
// so a finding that cannot be fixed here never wedges the session; the commit gate still refuses it.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const raw = await new Promise((resolve) => {
  let data = "";
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => resolve(data));
});

let input = {};
try {
  input = JSON.parse(raw);
} catch {
  // No/invalid payload — treat as a fresh stop.
}

if (input.stop_hook_active) {
  process.exit(0);
}

/** TypeScript files this session touched (modified, added or untracked), still on disk. */
function changedTypeScript() {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    // NUL-delimited, as in doc-sync.js: a rename's second field is a path too, and filtering on the
    // suffix and on existence is enough without modelling the status codes.
    return out
      .split("\0")
      .map((entry) => (entry.length > 3 && entry[2] === " " ? entry.slice(3) : entry))
      .filter((path) => /\.(ts|tsx)$/.test(path) && existsSync(path));
  } catch {
    return [];
  }
}

const files = changedTypeScript();
if (files.length === 0) {
  process.exit(0);
}

let report = "";
try {
  execFileSync(
    `${process.cwd()}/node_modules/.bin/oxlint`,
    ["--type-aware", "-c", ".oxlintrc.typecheck.json", ...files],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (error) {
  report = `${error.stdout?.toString() ?? ""}${error.stderr?.toString() ?? ""}`.trim();
}

if (report) {
  console.error(
    `Type-aware lint (\`bun run lint:typecheck\`, CI's checks job) failed on this session's ` +
      `changed files:\n\n${report}\n\nFix these before finishing; the pre-commit hook refuses them too.`,
  );
  process.exit(2);
}
process.exit(0);
