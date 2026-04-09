import { GlobalRegistrator } from "@happy-dom/global-registrator";
try {
  GlobalRegistrator.register();
} catch {}

import { describe, test, expect, mock } from "bun:test";
import { buildScope, JSONsx, isSignal } from "../runtime.js";

const wait = () => new Promise((r) => setTimeout(r, 0));
const BASE = "http://localhost/";

describe("buildScope", () => {
  test("loads $src Function and resolves export", async () => {
    const dataUrl = "data:text/javascript,export function myFn(state) { return 42; }";
    const state = await buildScope(
      {
        state: {
          myFn: { $prototype: "Function", $src: dataUrl },
        },
      },
      {},
      BASE,
    );
    expect(typeof state.myFn).toBe("function");
  });
});

describe("JSONsx", () => {
  test("calls onMount if present in scope via $src", async () => {
    const target = document.createElement("div");
    const srcUrl = new URL("./_test_handlers.js", import.meta.url).href;
    await JSONsx(
      {
        tagName: "div",
        state: {
          onMount: { $prototype: "Function", $src: srcUrl },
        },
      },
      target,
    );
    await wait();
    expect(globalThis._testMounted).toBe(true);
    delete globalThis._testMounted;
  });

  test("fetches string source", async () => {
    const doc = { tagName: "article" };
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(doc),
      }),
    );
    const target = document.createElement("div");
    await JSONsx("http://example.com/test.json", target);
    expect(target.children[0].tagName.toLowerCase()).toBe("article");
  });
});
