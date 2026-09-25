/* The Electrobun init shim (src/init.ts) on the path that works: the adapter registers, the
   credential store's answer reaches Studio, and — because the shim settled the boot-error watch —
   a page error Studio raises afterwards is not mistaken for a launcher failure.

   Its own file because a module evaluates once per process; the failure path is init-shim.test.ts.
   `electrobun/view` is ALWAYS mocked — the real vendored SDK would land `../../vendor` files in this
   package's per-file coverage. */
import { expect, mock, test } from "bun:test";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { launcherSignal } from "@jxsuite/studio/platform";
import type { LauncherSignal } from "@jxsuite/studio/platform";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const request = new Proxy({} as Record<string, () => Promise<unknown>>, {
  get: (_target, method) => () =>
    Promise.resolve(method === "githubToken" ? { stored: true } : { ok: true }),
});

void mock.module("electrobun/view", () => ({
  Electroview: class {
    static defineRPC() {
      return { request };
    }
  },
}));

const hydrateGithubToken = mock((_stored: boolean) => {});
void mock.module("@jxsuite/studio/github-auth", () => ({ hydrateGithubToken }));

const g = globalThis as unknown as { __jxLauncher?: LauncherSignal; __jxPlatform?: unknown };

test("a working Electroview registers the desktop adapter and hydrates the token state", async () => {
  delete g.__jxLauncher;
  delete g.__jxPlatform;

  await import("../src/init");

  expect((g.__jxPlatform as { id?: string } | undefined)?.id).toBe("desktop");
  expect(launcherSignal()).toEqual({ launcher: "electrobun" });
  expect(hydrateGithubToken).toHaveBeenCalledWith(true);
});

test("a page error after boot is not recorded as a launcher failure", () => {
  globalThis.dispatchEvent(new ErrorEvent("error", { error: new Error("Studio's own bug") }));
  expect(launcherSignal()?.error).toBeUndefined();
});
