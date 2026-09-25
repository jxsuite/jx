/* The chromium init shim (src/chromium/init.ts) when its adapter factory throws: the failure is
   recorded against the "chromium" launcher, nothing is registered, and the launch token is stripped
   from the address bar ANYWAY — a failed boot leaves the window open on Studio's failure screen, and
   the token must not sit in that URL. */
import { expect, mock, spyOn, test } from "bun:test";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { launcherSignal } from "@jxsuite/studio/platform";
import type { LauncherSignal } from "@jxsuite/studio/platform";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

void mock.module("../src/chromium/platform", () => ({
  createDesktopPlatform: () => {
    throw new Error("boom");
  },
}));

const hydrateGithubToken = mock((_stored: boolean) => {});
void mock.module("@jxsuite/studio/github-auth", () => ({ hydrateGithubToken }));

const g = globalThis as unknown as { __jxLauncher?: LauncherSignal; __jxPlatform?: unknown };

test("a throwing chromium adapter is recorded, and the token is stripped regardless", async () => {
  delete g.__jxLauncher;
  delete g.__jxPlatform;
  (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(
    "http://127.0.0.1:4000/?token=secret&project=1",
  );
  const consoleError = spyOn(console, "error").mockImplementation(() => {});

  await import("../src/chromium/init");

  expect(g.__jxPlatform).toBeUndefined();
  expect(launcherSignal()?.launcher).toBe("chromium");
  expect(launcherSignal()?.error?.message).toBe("boom");
  expect(hydrateGithubToken).not.toHaveBeenCalled();
  expect(location.search).toBe("?project=1");
  expect(location.href).not.toContain("secret");
  consoleError.mockRestore();
});
