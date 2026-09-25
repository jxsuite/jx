/* The Electrobun init shim (src/init.ts) against the exact failure desktop 5.0.0-5.1.3 shipped: the
   Electroview constructor throws because the host bridge it writes into is missing. Before boot.ts,
   that throw went unrecorded and Studio fell back to the dev-server adapter; now it must leave a
   signal naming the launcher and the error, and no adapter.

   One import per process (a module evaluates once), so the success path is its own file:
   init-shim-success.test.ts. `electrobun/view` is ALWAYS mocked — the real vendored SDK would land
   `../../vendor` files in this package's per-file coverage. */
import { expect, mock, spyOn, test } from "bun:test";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { launcherSignal } from "@jxsuite/studio/platform";
import type { LauncherSignal } from "@jxsuite/studio/platform";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const BRIDGE_ERROR = "Cannot set properties of undefined (setting 'receiveMessageFromHost')";

void mock.module("electrobun/view", () => ({
  Electroview: class {
    static defineRPC() {
      return { request: {} };
    }
    constructor() {
      throw new TypeError(BRIDGE_ERROR);
    }
  },
}));

const hydrateGithubToken = mock((_stored: boolean) => {});
void mock.module("@jxsuite/studio/github-auth", () => ({ hydrateGithubToken }));

const g = globalThis as unknown as { __jxLauncher?: LauncherSignal; __jxPlatform?: unknown };

test("a throwing Electroview leaves a recorded failure and no adapter", async () => {
  delete g.__jxLauncher;
  delete g.__jxPlatform;
  const consoleError = spyOn(console, "error").mockImplementation(() => {});

  await import("../src/init");

  expect(g.__jxPlatform).toBeUndefined();
  expect(launcherSignal()?.launcher).toBe("electrobun");
  expect(launcherSignal()?.error?.message).toBe(BRIDGE_ERROR);
  expect(launcherSignal()?.error?.stack).toContain("TypeError");
  expect(hydrateGithubToken).not.toHaveBeenCalled();
  expect(consoleError).toHaveBeenCalledTimes(1);
  consoleError.mockRestore();
});
