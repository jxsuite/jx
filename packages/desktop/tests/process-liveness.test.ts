/** Tests for src/process-liveness.ts. */
import { expect, spyOn, test } from "bun:test";
import { isProcessAlive } from "../src/process-liveness";

test("this process is alive", () => {
  expect(isProcessAlive(process.pid)).toBe(true);
});

test("a reaped child is not", () => {
  const { pid } = Bun.spawnSync(["true"]);
  expect(isProcessAlive(pid)).toBe(false);
});

test("EPERM counts as alive", () => {
  const spy = spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("EPERM"), { code: "EPERM" });
  });
  try {
    expect(isProcessAlive(process.pid + 1)).toBe(true);
  } finally {
    spy.mockRestore();
  }
});
