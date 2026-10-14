/**
 * Covers the usage-error path of the CLI entry: no destination argument prints usage and exits with
 * code 1. process.exit is stubbed to throw so the import-time exit becomes observable.
 */
import { describe, expect, test } from "bun:test";

const errors: string[] = [];
console.error = (...args: unknown[]) => {
  errors.push(args.join(" "));
};

process.exit = (code) => {
  throw new Error(`process.exit(${code})`);
};

process.argv = [process.argv[0] ?? "bun", "index.ts"];

describe("create-jxsuite CLI without arguments", () => {
  test("prints usage and exits with code 1", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- Bun types `.rejects.toThrow` as void, but it resolves a Promise at runtime; the await is required.
    await expect(import("../index")).rejects.toThrow("process.exit(1)");
    expect(errors.join("\n")).toContain("Usage: bun create @jxsuite <directory>");
  });
});
