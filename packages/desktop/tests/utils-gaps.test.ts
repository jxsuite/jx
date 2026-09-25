// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { describe, expect, mock, test } from "bun:test";

// Make the electrobun import fail so init() exercises its catch path.
// The real electrobun module starts a server on import; it must never load in tests.
void mock.module("electrobun/main", () => {
  throw new Error("electrobun unavailable in test env");
});

/* The OS opener is a real process launch; mocked so this file never opens a browser window on the
   machine running it. Made to fail, because what this file tests is the no-shell path. */
void mock.module("node:child_process", () => ({
  spawn: () => {
    throw new Error("no opener on this box");
  },
}));

const { init, openFileDialog, openDirectoryDialog, openExternal } = await import("../src/utils");

describe("dialogs and openExternal before init", () => {
  test("returns null when Utils was never initialized", async () => {
    const result = await openFileDialog();
    expect(result).toBeNull();
  });

  /* `null` is the user cancelling, and nobody cancelled: there was no dialog to show. Answering
     `null` here made New Project's Browse… a button that did nothing, so it rejects with the
     sentence Studio shows under the Location field. */
  test("openDirectoryDialog rejects without a shell, saying the dialog is unavailable", async () => {
    await expect(openDirectoryDialog()).rejects.toThrow(
      "The system folder dialog is not available in this build. Type the path into Location instead.",
    );
  });

  /* With neither the electrobun shell nor an OS opener there is nothing to hand the URL to.
     Reporting false lets the caller fall back to `window.open` rather than losing the click. */
  test("openExternal reports false with no shell and no OS opener", () => {
    expect(openExternal("https://example.com")).toBe(false);
  });
});

describe("init failure handling", () => {
  test("init swallows electrobun import failure", async () => {
    await expect(init()).resolves.toBeUndefined();
  });

  test("openFileDialog still returns null after failed init", async () => {
    await init();
    const result = await openFileDialog();
    expect(result).toBeNull();
  });
});
