import { GlobalRegistrator } from "@happy-dom/global-registrator";
try {
  GlobalRegistrator.register();
} catch {}

import { describe, test, expect } from "bun:test";
import { isSignal } from "../src/runtime.js";

describe("sanity", () => {
  test("import works", () => {
    expect(typeof isSignal).toBe("function");
  });
});
