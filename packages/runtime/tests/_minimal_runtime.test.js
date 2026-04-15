import { GlobalRegistrator } from "@happy-dom/global-registrator";
try {
  GlobalRegistrator.register();
} catch {}

import { describe, test, expect } from "bun:test";
import {
  resolve,
  buildScope,
  renderNode,
  applyStyle,
  resolveRef,
  resolvePrototype,
  isSignal,
  camelToKebab,
  toCSSText,
  RESERVED_KEYS,
  Jx,
} from "../runtime.js";

describe("sanity", () => {
  test("import works", () => {
    expect(typeof isSignal).toBe("function");
  });
});
