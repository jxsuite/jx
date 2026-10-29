import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installWorkspaceExtension } from "../src/install-extension";

describe("installWorkspaceExtension", () => {
  test("links each package so the project resolves it from its own node_modules", () => {
    const root = mkdtempSync(join(tmpdir(), "jx-install-ext-"));
    try {
      /* No resolve BEFORE the install: Bun's resolver caches a miss for the life of the process,
         and with no node_modules at all it answers from its own install cache instead. */
      installWorkspaceExtension(root, "@jxsuite/parser", "@jxsuite/feed");

      const project = createRequire(join(root, "package.json"));
      const manifest = project.resolve("@jxsuite/parser/jx-extension.json");
      // The workspace package itself, reached through the project's own link.
      const linked = realpathSync(join(root, "node_modules/@jxsuite/parser"));
      expect(manifest).toBe(join(linked, "jx-extension.json"));
      expect(existsSync(join(root, "node_modules", "@jxsuite", "feed", "package.json"))).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("an unknown package throws rather than linking nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "jx-install-ext-"));
    try {
      expect(() => installWorkspaceExtension(root, "@jxsuite/no-such-extension")).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
