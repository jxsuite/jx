/**
 * The agent instructions are read by harnesses that each fail SILENTLY at the edges.
 *
 * Codex reads the root `AGENTS.md` only up to `project_doc_max_bytes`, 32 KiB by default, and drops
 * the rest without a word: a file that grows past it keeps working for everyone else and quietly
 * loses its tail for Codex users. Claude Code reads `AGENTS.md` natively only from v2.1.277 and
 * skips it whenever a `CLAUDE.md` exists, so `CLAUDE.md` must stay a bare import of it, or the
 * shared rules stop reaching Claude at all, which is exactly what happened before they were merged.
 * And a nested `AGENTS.md` is loaded by no harness started at the root, so the root file's index is
 * the only way an agent learns one exists.
 *
 * It lives flat in `scripts/` so `bun test --isolate scripts` in the `changes` job runs it on every
 * pull request without the GLOBAL fan-out `scripts/ci/**` would cost.
 */

import { describe, expect, test } from "bun:test";

/** Codex's default `project_doc_max_bytes`. */
const CODEX_BUDGET = 32 * 1024;

const tracked = (pattern: string) =>
  new TextDecoder()
    .decode(Bun.spawnSync(["git", "ls-files", "--", pattern]).stdout)
    .split("\n")
    .filter(Boolean);

describe("agent instructions", () => {
  test("the root AGENTS.md fits inside Codex's default project-doc budget", async () => {
    const bytes = await Bun.file("AGENTS.md").bytes();
    // Over budget, move a subsystem's notes into a nested AGENTS.md and index it, rather than
    // Raising the budget: every contributor's Codex would need the same setting.
    expect(bytes.byteLength).toBeLessThan(CODEX_BUDGET);
  });

  test("every CLAUDE.md is nothing but an import of the AGENTS.md beside it", async () => {
    // The nested stubs are what make Claude Code load a nested AGENTS.md when it reads a file in
    // That directory: with a CLAUDE.md anywhere above, it skips AGENTS.md files, nested ones
    // Included, but it always lazy-loads a nested CLAUDE.md.
    const agents = tracked("*AGENTS.md");
    const claude = tracked("*CLAUDE.md");
    expect(claude.toSorted()).toEqual(
      agents.map((f) => f.replace(/AGENTS\.md$/, "CLAUDE.md")).toSorted(),
    );
    for (const file of claude) {
      expect(await Bun.file(file).text()).toBe("@AGENTS.md\n");
    }
  });

  test("every nested AGENTS.md is indexed by the root one, and every index entry exists", async () => {
    const root = await Bun.file("AGENTS.md").text();
    const nested = tracked("*AGENTS.md").filter((f) => f !== "AGENTS.md");
    expect(nested.length).toBeGreaterThan(0);
    for (const file of nested) {
      expect(root).toContain(`**\`${file}\`**`);
    }
    const indexed = [...root.matchAll(/\*\*`([^`]+\/AGENTS\.md)`\*\*/g)].map((m) => m[1]);
    expect(indexed.toSorted()).toEqual(nested.toSorted());
  });
});
