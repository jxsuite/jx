import { describe, expect, test } from "bun:test";
import { loadBodyEraser } from "../src/canvas/body-eraser";

describe("loadBodyEraser", () => {
  test("gives the browser eraser, which erases a typed body", async () => {
    const { eraseBody } = await loadBodyEraser();
    expect(eraseBody("return 1 as number;").code).toBe("return 1          ;");
  });
});
