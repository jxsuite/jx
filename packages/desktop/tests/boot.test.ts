/* The launcher boot module (src/boot.ts): the announcement its import makes, the page-error watch
   that records an import-time throw in a LATER module, and `bootLauncher`'s contract that Studio
   always finds either a registered adapter or a recorded failure — never neither, which is the
   silent dev-server fallback desktop 5.0.0-5.1.3 shipped. */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { hasPlatform } from "@jxsuite/studio/platform";
import type { LauncherSignal } from "@jxsuite/studio/platform";
import type { BootablePlatform } from "../src/boot";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const g = globalThis as unknown as { __jxLauncher?: LauncherSignal; __jxPlatform?: unknown };

// Nothing may have announced before boot's own import does.
delete g.__jxLauncher;
delete g.__jxPlatform;

const boot = await import("../src/boot");

/** The exact throw desktop 5.x's Electroview constructor raised against a missing bridge. */
const BRIDGE_ERROR = "Cannot set properties of undefined (setting 'receiveMessageFromHost')";

function fakePlatform(status: () => Promise<{ stored: boolean }>): BootablePlatform {
  return { githubAuth: { status }, id: "fake" } as unknown as BootablePlatform;
}

describe("importing boot", () => {
  test("publishes the launcher signal before anything calls bootLauncher", () => {
    expect(g.__jxLauncher).toEqual({});
  });

  // Runs against the module-level watch, so it must precede every bootLauncher call in this file.
  test("records the first page error raised before bootLauncher, and only the first", () => {
    const signal = g.__jxLauncher;
    const first = new TypeError(BRIDGE_ERROR);
    globalThis.dispatchEvent(new ErrorEvent("error", { error: first, message: first.message }));
    globalThis.dispatchEvent(
      new ErrorEvent("error", { error: new Error("cascade"), message: "cascade" }),
    );
    expect(signal?.error?.message).toBe(BRIDGE_ERROR);
    expect(signal?.error?.stack).toBe(first.stack);
  });
});

describe("watchBootErrors", () => {
  test("records an ErrorEvent's message when it carries no error object", () => {
    const target = new EventTarget();
    const signal: LauncherSignal = {};
    boot.watchBootErrors(target, signal);
    target.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    expect(signal.error).toEqual({ message: "Script error." });
  });

  test("stringifies a non-Error value when the event has no message", () => {
    const target = new EventTarget();
    const signal: LauncherSignal = {};
    boot.watchBootErrors(target, signal);
    target.dispatchEvent(new ErrorEvent("error", { error: "a string was thrown" }));
    expect(signal.error).toEqual({ message: "a string was thrown" });
  });

  test("keeps an error an earlier announcer already recorded", () => {
    const target = new EventTarget();
    const signal: LauncherSignal = { error: { message: "earlier" } };
    boot.watchBootErrors(target, signal);
    target.dispatchEvent(new ErrorEvent("error", { message: "later" }));
    expect(signal.error).toEqual({ message: "earlier" });
  });

  test("records nothing once stopped", () => {
    const target = new EventTarget();
    const signal: LauncherSignal = {};
    const stop = boot.watchBootErrors(target, signal);
    stop();
    target.dispatchEvent(new ErrorEvent("error", { message: "after settle" }));
    expect(signal.error).toBeUndefined();
  });

  test("is a no-op on a target without addEventListener", () => {
    const signal: LauncherSignal = {};
    const stop = boot.watchBootErrors(undefined, signal);
    expect(() => {
      stop();
    }).not.toThrow();
    expect(signal).toEqual({});
  });
});

describe("bootLauncher", () => {
  let consoleError: ReturnType<typeof spyOn>;

  beforeEach(() => {
    delete g.__jxLauncher;
    delete g.__jxPlatform;
    consoleError = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    delete g.__jxLauncher;
    delete g.__jxPlatform;
  });

  test("registers synchronously, before its first await", async () => {
    const platform = fakePlatform(() => Promise.resolve({ stored: false }));
    const hydrate = mock((_stored: boolean) => {});
    const pending = boot.bootLauncher({
      create: () => platform,
      hydrateGithubToken: hydrate,
      launcher: "electrobun",
    });
    // Studio's module script may run the moment this shim yields: the adapter must already be there.
    expect(hasPlatform()).toBe(true);
    expect(g.__jxPlatform).toBe(platform);
    expect(g.__jxLauncher).toEqual({ launcher: "electrobun" });
    expect(await pending).toBe(platform);
  });

  test("hydrates the GitHub token state from the credential store", async () => {
    const hydrate = mock((_stored: boolean) => {});
    await boot.bootLauncher({
      create: () => fakePlatform(() => Promise.resolve({ stored: true })),
      hydrateGithubToken: hydrate,
      launcher: "chromium",
    });
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledWith(true);
  });

  test("swallows an unreachable credential store and still returns the adapter", async () => {
    const platform = fakePlatform(() => Promise.reject(new Error("store offline")));
    const hydrate = mock((_stored: boolean) => {});
    const result = await boot.bootLauncher({
      create: () => platform,
      hydrateGithubToken: hydrate,
      launcher: "electrobun",
    });
    expect(result).toBe(platform);
    expect(hydrate).not.toHaveBeenCalled();
    expect(g.__jxLauncher?.error).toBeUndefined();
  });

  test("records a factory throw instead of registering, and says so once", async () => {
    const thrown = new TypeError(BRIDGE_ERROR);
    const hydrate = mock((_stored: boolean) => {});
    const result = await boot.bootLauncher({
      create: () => {
        throw thrown;
      },
      hydrateGithubToken: hydrate,
      launcher: "electrobun",
    });
    expect(result).toBeNull();
    expect(hasPlatform()).toBe(false);
    expect(hydrate).not.toHaveBeenCalled();
    expect(g.__jxLauncher?.launcher).toBe("electrobun");
    expect(g.__jxLauncher?.error?.message).toBe(BRIDGE_ERROR);
    expect(g.__jxLauncher?.error?.stack).toBeString();
    expect(g.__jxLauncher?.error?.stack).not.toBe("");
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]?.[0]).toContain("[electrobun]");
    expect(consoleError.mock.calls[0]?.[1]).toBe(thrown);
  });

  test("stringifies a thrown non-Error", async () => {
    const result = await boot.bootLauncher({
      create: () => {
        // oxlint-disable-next-line no-throw-literal -- the case under test: a non-Error throw.
        throw 42;
      },
      hydrateGithubToken: () => {},
      launcher: "chromium",
    });
    expect(result).toBeNull();
    expect(g.__jxLauncher?.error).toEqual({ message: "42" });
  });
});

describe("stripLaunchToken", () => {
  const { happyDOM } = window as unknown as { happyDOM: { setURL: (url: string) => void } };

  test("removes ?token and keeps the rest of the URL", () => {
    happyDOM.setURL("http://127.0.0.1:4000/s?token=abc&x=1#h");
    const replaceState = spyOn(history, "replaceState");
    boot.stripLaunchToken();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0]?.[2]).toBe("/s?x=1#h");
    expect(location.pathname + location.search + location.hash).toBe("/s?x=1#h");
    replaceState.mockRestore();
  });

  test("leaves a URL without a token alone", () => {
    happyDOM.setURL("http://127.0.0.1:4000/s?x=1");
    const replaceState = spyOn(history, "replaceState");
    boot.stripLaunchToken();
    expect(replaceState).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });

  test("swallows a history API that refuses", () => {
    happyDOM.setURL("http://127.0.0.1:4000/s?token=abc");
    const replaceState = spyOn(history, "replaceState").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => {
      boot.stripLaunchToken();
    }).not.toThrow();
    replaceState.mockRestore();
  });
});
