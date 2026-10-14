/** Platform abstraction layer (C7): register/get/has lifecycle and call counting in src/platform.ts. */
import "./with-dom.js";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  announceLauncher,
  getPlatform,
  hasPlatform,
  launcherSignal,
  platformInFlight,
  registerPlatform,
} from "../src/platform";
import type { StudioPlatform } from "../src/types";

const original = globalThis.__jxPlatform;

/** An adapter carrying only the members one test exercises. */
function fakeAdapter(members: Partial<StudioPlatform>): StudioPlatform {
  /* SAFETY: the registry stores and hands back whatever it is given, and the counting proxy's get
     trap reads only the property a caller asks for. Every test below reads only the members it put
     on its fake, so an adapter carrying just those members stands in for the whole StudioPlatform. */
  return members as StudioPlatform;
}

beforeEach(() => {
  globalThis.__jxPlatform = undefined;
});

afterAll(() => {
  globalThis.__jxPlatform = original;
});

describe("platform registry", () => {
  test("hasPlatform is false before registration", () => {
    expect(hasPlatform()).toBe(false);
  });

  test("getPlatform throws a descriptive error when nothing is registered", () => {
    expect(() => getPlatform()).toThrow(
      "No platform registered. Call registerPlatform() before starting Studio.",
    );
  });

  test("registerPlatform makes the platform available globally", () => {
    const fake = fakeAdapter({ id: "test-platform" });
    registerPlatform(fake);
    expect(hasPlatform()).toBe(true);
    // The raw adapter is what is stored; callers get the counting proxy over it, so identity is
    // Deliberately NOT preserved — every value read through it is.
    expect(globalThis.__jxPlatform).toBe(fake);
    expect(getPlatform().id).toBe("test-platform");
  });

  test("re-registering replaces the previous platform", () => {
    const first = fakeAdapter({ id: "first" });
    const second = fakeAdapter({ id: "second" });
    registerPlatform(first);
    expect(getPlatform().id).toBe("first");
    registerPlatform(second);
    expect(getPlatform().id).toBe("second");
  });

  test("the launcher signal is absent until something announces", () => {
    globalThis.__jxLauncher = undefined;
    expect(launcherSignal()).toBeUndefined();
  });

  test("announceLauncher publishes one signal and keeps what was recorded on it", () => {
    globalThis.__jxLauncher = undefined;
    const signal = announceLauncher();
    expect(signal).toEqual({});
    expect(launcherSignal()).toBe(signal);
    signal.error = { message: "boom" };
    expect(announceLauncher()).toBe(signal);
    expect(announceLauncher().error).toEqual({ message: "boom" });
    globalThis.__jxLauncher = undefined;
  });

  test("an adapter registered directly on the global is still counted", async () => {
    // Desktop pre-registers on `window.__jxPlatform` without calling the registrar, which is why
    // The proxy is applied at the READ point rather than at registration.
    globalThis.__jxPlatform = fakeAdapter({ readFile: () => Promise.resolve("x") });
    const call = getPlatform().readFile("x.json");
    expect(platformInFlight()).toEqual(["readFile"]);
    await call;
    expect(platformInFlight()).toEqual([]);
  });
});

describe("call counting", () => {
  function makePlatform() {
    const resolvers = new Map<string, (ok: boolean) => void>();
    const pending = (method: string) => () =>
      new Promise<string>((resolve, reject) => {
        resolvers.set(method, (ok) => {
          if (ok) {
            resolve("ok");
          } else {
            reject(new Error("boom"));
          }
        });
      });
    return {
      platform: fakeAdapter({
        // Synchronous members are passed through — they cannot be outstanding.
        aiChatUrl: () => "/ai/chat",
        gitDiff: pending("gitDiff"),
        projectRoot: "/tmp/project",
        readFile: pending("readFile"),
      }),
      settle: (method: string, ok: boolean) => resolvers.get(method)?.(ok),
    };
  }

  test("counts each unsettled call, one entry per call, named by its method", async () => {
    const { platform, settle } = makePlatform();
    registerPlatform(platform);
    const api = getPlatform();
    const first = api.gitDiff();
    expect(platformInFlight()).toEqual(["gitDiff"]);
    const second = api.readFile("a.json");
    expect(platformInFlight().toSorted()).toEqual(["gitDiff", "readFile"]);
    settle("gitDiff", true);
    settle("readFile", true);
    await Promise.all([first, second]);
    expect(platformInFlight()).toEqual([]);
  });

  test("a REJECTED call is a call that finished — the counter must not wedge", async () => {
    const { platform, settle } = makePlatform();
    registerPlatform(platform);
    const call = getPlatform().gitDiff();
    expect(platformInFlight()).toEqual(["gitDiff"]);
    settle("gitDiff", false);
    const failure = await call.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    expect(failure).toBe("boom");
    expect(platformInFlight()).toEqual([]);
  });

  test("two concurrent calls to one method are two reasons to wait", async () => {
    const resolvers: ((value: string) => void)[] = [];
    registerPlatform(
      fakeAdapter({
        gitDiff: () =>
          new Promise<string>((resolve) => {
            resolvers.push(resolve);
          }),
      }),
    );
    const api = getPlatform();
    const calls = [api.gitDiff(), api.gitDiff()];
    expect(platformInFlight()).toEqual(["gitDiff", "gitDiff"]);
    for (const resolve of resolvers) {
      resolve("ok");
    }
    await Promise.all(calls);
    expect(platformInFlight()).toEqual([]);
  });

  test("synchronous members and plain values pass through untouched", () => {
    const { platform } = makePlatform();
    registerPlatform(platform);
    const api = getPlatform();
    expect(api.projectRoot).toBe("/tmp/project");
    expect(api.aiChatUrl()).toBe("/ai/chat");
    expect(platformInFlight()).toEqual([]);
  });

  test("a method REPLACED on the adapter is re-wrapped, not answered by the old one", async () => {
    // Capabilities get installed lazily (a desktop shell adding `cfConnect` once its OAuth broker
    // Is up), so a wrapper memoised by name alone would keep calling the implementation that was
    // There at first read — the call would land nowhere and the counter would never see it.
    const platform = fakeAdapter({ gitDiff: () => Promise.resolve("first") });
    registerPlatform(platform);
    const api = getPlatform();
    expect(await api.gitDiff()).toBe("first");
    platform.gitDiff = () => Promise.resolve("second");
    expect(await api.gitDiff()).toBe("second");
    expect(platformInFlight()).toEqual([]);
  });

  test("a wrapper is memoised, so capability checks and cached references stay stable", () => {
    const { platform } = makePlatform();
    registerPlatform(platform);
    const api = getPlatform();
    expect(api.gitDiff).toBe(api.gitDiff);
    expect(api.gitDiff).toBeInstanceOf(Function);
    expect(api.gitClone).toBeUndefined();
    // The same read through a second getPlatform() call is the same proxy, not a fresh one.
    expect(getPlatform()).toBe(api);
  });
});
