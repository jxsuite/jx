/**
 * Monaco-setup font remeasure test, isolated from monaco-setup.test.ts so this file gets its own
 * module registry: monaco-setup.ts wires the fonts.ready remeasure on import, and happy-dom has no
 * document.fonts by default, so document.fonts must be stubbed before the module is imported here.
 */
import { flush } from "./harness";
import { describe, expect, mock, test } from "bun:test";
import { installMonacoSetupMocks } from "./monaco-setup-mocks";

const remeasureFonts = mock(() => {});

installMonacoSetupMocks({ editorApi: { editor: { remeasureFonts } } });

if (typeof self === "undefined") {
  Object.assign(globalThis, { self: globalThis });
}

let resolveReady!: () => void;
// Plain assignment semantics, as `document.fonts = …` would be: happy-dom ships no font set.
Object.assign(document, {
  fonts: {
    ready: new Promise<void>((resolve) => {
      resolveReady = resolve;
    }),
  },
});

await import("../src/services/monaco-setup");

describe("monaco-setup — font remeasure on fonts.ready", () => {
  test("remeasures Monaco glyph widths once vendored webfonts finish loading", async () => {
    // Nothing is remeasured while the webfonts are still loading.
    expect(remeasureFonts.mock.calls).toEqual([]);
    resolveReady();
    await flush();
    // Exactly one remeasure, with no arguments, once `fonts.ready` settles.
    expect(remeasureFonts.mock.calls).toEqual([[]]);
  });
});
