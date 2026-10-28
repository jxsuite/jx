import type { SpawnOptions } from "node:child_process";

import { beforeEach, describe, expect, mock, test } from "bun:test";

/* The OS opener is a real process launch; replaced so this file never opens a browser window on the
   machine running it. */
interface SpawnCall {
  args: readonly string[];
  command: string;
  options: SpawnOptions;
}
const spawnCalls: SpawnCall[] = [];
let spawnThrows = false;
let unrefs = 0;

void mock.module("node:child_process", () => ({
  spawn: (command: string, args: readonly string[], options: SpawnOptions) => {
    if (spawnThrows) {
      throw new Error("no opener on this box");
    }
    spawnCalls.push({ args, command, options });
    return {
      unref: () => {
        unrefs += 1;
      },
    };
  },
}));

const { openExternal } = await import("../src/backend/open-external");

beforeEach(() => {
  spawnCalls.length = 0;
  spawnThrows = false;
  unrefs = 0;
});

describe("openExternal", () => {
  test.each([
    ["darwin", "open", ["https://example.com/page"]],
    ["win32", "rundll32", ["url.dll,FileProtocolHandler", "https://example.com/page"]],
    ["linux", "xdg-open", ["https://example.com/page"]],
  ] as const)("on %s it runs %s with the URL as a single argument", (platform, command, args) => {
    expect(openExternal("https://example.com/page", platform)).toBe(true);
    expect(spawnCalls).toEqual([{ args, command, options: { detached: true, stdio: "ignore" } }]);
    // Detached and unreferenced: closing Studio must not close the browser it opened.
    expect(unrefs).toBe(1);
  });

  test("uses the host's platform by default", () => {
    expect(openExternal("https://example.com")).toBe(true);
    expect(spawnCalls).toHaveLength(1);
  });

  /*
   * The opener resolves a scheme to whatever handler the desktop registered for it, and the pages
   * whose links arrive here are the project's own content. A non-web scheme is refused rather than
   * handed to a program of the page's choosing.
   */
  test("refuses a scheme that is not the web, and anything that is not a URL", () => {
    expect(openExternal("file:///etc/passwd")).toBe(false);
    // oxlint-disable-next-line no-script-url -- the point of the test is that this is refused
    expect(openExternal("javascript:alert(1)")).toBe(false);
    expect(openExternal("not a url at all")).toBe(false);
    expect(spawnCalls).toEqual([]);
  });

  test("accepts mailto, which is what a previewed page's contact link is", () => {
    expect(openExternal("mailto:hi@example.com")).toBe(true);
  });

  test("reports false when the OS has no opener, so the caller can use window.open", () => {
    spawnThrows = true;
    expect(openExternal("https://example.com")).toBe(false);
  });
});
