import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeRoot } from "../src/backend/roots";

const ROOT = join(tmpdir(), `jx-hub-roots-${process.pid}`);

afterAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
});

describe("normalizeRoot", () => {
  test("resolves symlinks, so a link and its target are one project", () => {
    if (process.platform === "win32") {
      return; // Symlink creation needs elevation on Windows
    }
    const real = join(ROOT, "real-project");
    const link = join(ROOT, "link-project");
    mkdirSync(real, { recursive: true });
    rmSync(link, { force: true });
    symlinkSync(real, link);
    expect(normalizeRoot(link)).toBe(normalizeRoot(real));
  });

  test("a root that does not exist yet keeps its resolved form", () => {
    const missing = join(ROOT, "not-created-yet");
    expect(normalizeRoot(`${missing}/`)).toBe(
      process.platform === "win32" ? missing.toLowerCase() : missing,
    );
  });
});
