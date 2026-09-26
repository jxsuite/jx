/**
 * Tests for resolveDefaultPlatform (src/platforms/default-platform.ts): it picks the cloud adapter
 * when the cloud shell published a `window.__jxCloud` signal, else the dev-server adapter. This is
 * what keeps the cloud adapter — and its collab client's single yjs — inside the studio bundle.
 *
 * And, since desktop 5.0.0-5.1.3 shipped a window that ran the dev-server adapter against a
 * `views://` origin, it is also what REFUSES that fallback when a launcher was supposed to register
 * an adapter and did not. `bootRefusal` is exercised with explicit environments for every branch;
 * `bootEnvironment` is exercised against the real globals, the real meta and the real URL.
 */
import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import {
  bootEnvironment,
  bootRefusal,
  PlatformUnavailableError,
  resolveDefaultPlatform,
} from "../src/platforms/default-platform";
import type { BootEnvironment } from "../src/platforms/default-platform";
import type { CloudProject } from "../src/platforms/cloud";
import type { LauncherSignal } from "../src/platform";

const { happyDOM } = globalThis as unknown as { happyDOM: { setURL: (url: string) => void } };
/* The URL the repo dev server really serves Studio from. happy-dom's default is `about:blank`,
   which the scheme rule deliberately leaves alone, but stating the dev-server origin is what makes
   the fallback tests below say what they mean. */
happyDOM.setURL("http://localhost:3000/");

const g = globalThis as unknown as {
  __jxCloud?: { project: CloudProject | null };
  __jxLauncher?: LauncherSignal;
};

function addBootMeta(): void {
  const meta = document.createElement("meta");
  meta.name = "jx-boot";
  meta.content = "launcher";
  document.head.append(meta);
}

afterEach(() => {
  delete g.__jxCloud;
  delete g.__jxLauncher;
  for (const meta of document.querySelectorAll('meta[name="jx-boot"]')) {
    meta.remove();
  }
  happyDOM.setURL("http://localhost:3000/");
});

describe("resolveDefaultPlatform", () => {
  test("returns the dev-server adapter when no cloud signal is present", () => {
    delete g.__jxCloud;
    expect(resolveDefaultPlatform().id).toBe("devserver");
  });

  test("returns the cloud adapter bound to the signalled project", () => {
    g.__jxCloud = { project: { owner: "acme", repo: "site", branch: "main" } };
    const platform = resolveDefaultPlatform();
    expect(platform.id).toBe("cloud");
    // The root key, branch included — the identity Recent and the catalogue both address a project by.
    expect(platform.projectRoot).toBe("acme/site@main");
  });

  test("returns the cloud adapter for the project-less hub (null project)", () => {
    g.__jxCloud = { project: null };
    const platform = resolveDefaultPlatform();
    expect(platform.id).toBe("cloud");
    expect(platform.projectRoot).toBe("");
  });

  test("the cloud shell's own boot meta does not refuse the cloud adapter", () => {
    addBootMeta();
    g.__jxCloud = { project: null };
    expect(resolveDefaultPlatform().id).toBe("cloud");
  });

  test("throws PlatformUnavailableError, carrying the refusal, when a launcher announced and failed", () => {
    g.__jxLauncher = { launcher: "electrobun", error: { message: "boom" } };
    let caught: unknown;
    try {
      resolveDefaultPlatform();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PlatformUnavailableError);
    const error = caught as PlatformUnavailableError;
    expect(error.name).toBe("PlatformUnavailableError");
    expect(error.refusal).toEqual({ kind: "launcher", launcher: "electrobun" });
    expect(error.message).toContain("(electrobun)");
  });

  test("names an unnamed launcher as such", () => {
    g.__jxLauncher = {};
    expect(() => resolveDefaultPlatform()).toThrow(/launcher \(unnamed\) announced itself/);
  });

  test("throws for a page that declared a boot module nobody ran", () => {
    addBootMeta();
    expect(() => resolveDefaultPlatform()).toThrow(/declares a boot module/);
  });

  test("throws for a views:// page with no signal and no meta", () => {
    happyDOM.setURL("views://studio/index.html");
    let caught: unknown;
    try {
      resolveDefaultPlatform();
    } catch (error) {
      caught = error;
    }
    expect((caught as PlatformUnavailableError).refusal).toEqual({
      kind: "scheme",
      protocol: "views:",
    });
    expect((caught as Error).message).toContain("views: URL");
  });
});

describe("bootRefusal", () => {
  const env = (patch: Partial<BootEnvironment> = {}): BootEnvironment => ({
    cloud: false,
    declared: false,
    launcher: undefined,
    protocol: "http:",
    ...patch,
  });

  test("the dev server — http or https, nothing declared — may fall back", () => {
    expect(bootRefusal(env())).toBeNull();
    expect(bootRefusal(env({ protocol: "https:" }))).toBeNull();
  });

  test("the cloud shell may fall back, with or without its boot meta", () => {
    expect(bootRefusal(env({ cloud: true }))).toBeNull();
    expect(bootRefusal(env({ cloud: true, declared: true }))).toBeNull();
  });

  test("a launcher signal refuses, named or not, and beats the cloud signal", () => {
    expect(bootRefusal(env({ launcher: { launcher: "chromium" } }))).toEqual({
      kind: "launcher",
      launcher: "chromium",
    });
    expect(bootRefusal(env({ launcher: {} }))).toEqual({ kind: "launcher", launcher: undefined });
    expect(
      bootRefusal(env({ cloud: true, declared: true, launcher: { launcher: "electrobun" } })),
    ).toEqual({ kind: "launcher", launcher: "electrobun" });
  });

  test("the refusal does not copy the recorded error — the screen reads it lazily", () => {
    const refusal = bootRefusal(env({ launcher: { error: { message: "late" } } }));
    expect(refusal).toEqual({ kind: "launcher", launcher: undefined });
    expect(refusal).not.toHaveProperty("error");
  });

  test("a declared boot module with no signal refuses as declared", () => {
    expect(bootRefusal(env({ declared: true }))).toEqual({ kind: "declared" });
    // Declared beats the scheme: it is the more specific account of what went wrong.
    expect(bootRefusal(env({ declared: true, protocol: "views:" }))).toEqual({ kind: "declared" });
  });

  test("views: and file: refuse on the scheme alone", () => {
    expect(bootRefusal(env({ protocol: "views:" }))).toEqual({
      kind: "scheme",
      protocol: "views:",
    });
    expect(bootRefusal(env({ protocol: "file:" }))).toEqual({ kind: "scheme", protocol: "file:" });
  });

  /* Only views: and file:. A third-party host may serve the HTTP protocol through a custom scheme
     (tauri://localhost proxies to a real server), and happy-dom's about: must keep a test that
     imports the entry without a URL on the dev-server path. */
  test("about:, tauri: and other custom schemes are not refused", () => {
    expect(bootRefusal(env({ protocol: "about:" }))).toBeNull();
    expect(bootRefusal(env({ protocol: "tauri:" }))).toBeNull();
    expect(bootRefusal(env({ protocol: "" }))).toBeNull();
  });
});

describe("bootEnvironment", () => {
  test("reads nothing on a bare dev-server page", () => {
    expect(bootEnvironment()).toEqual({
      cloud: false,
      declared: false,
      launcher: undefined,
      protocol: "http:",
    });
  });

  test("reads the launcher signal, the cloud signal, the meta and the protocol", () => {
    const signal: LauncherSignal = { launcher: "electrobun" };
    g.__jxLauncher = signal;
    g.__jxCloud = { project: null };
    addBootMeta();
    happyDOM.setURL("file:///Applications/JxStudio.app/index.html");
    const read = bootEnvironment();
    expect(read.launcher).toBe(signal);
    expect(read.cloud).toBe(true);
    expect(read.declared).toBe(true);
    expect(read.protocol).toBe("file:");
  });

  test("a jx-boot meta with some other content is not the declaration", () => {
    const meta = document.createElement("meta");
    meta.name = "jx-boot";
    meta.content = "something-else";
    document.head.append(meta);
    expect(bootEnvironment().declared).toBe(false);
  });

  test("the default argument is the live environment", () => {
    addBootMeta();
    expect(bootRefusal()).toEqual({ kind: "declared" });
  });
});
