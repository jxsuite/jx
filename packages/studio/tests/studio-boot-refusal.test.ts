/**
 * The customer's desktop window, end to end: the studio entry booting inside Electrobun's
 * `views://` shell after the launcher's init bundle threw on import.
 *
 * That is exactly desktop 5.0.0-5.1.3. The bundle's first import published the launcher signal, the
 * next one (`electrobun/view`, resolved to a module whose whole body throws) took the rest of the
 * bundle down before any adapter registered, and `studio.js` then booted with nothing on
 * `__jxPlatform`. It registered the dev-server adapter, drew the whole frame, and every action
 * failed against an origin with no server behind it — "Failed to fetch" on Create Project, a Browse
 * button that did nothing. Nobody saw an error, because nothing had one.
 *
 * This file reproduces that boot and pins the other outcome: the import REJECTS with
 * `PlatformUnavailableError`, the boot-failure screen is the only thing in the shell root and it
 * prints the recorded error, no adapter is registered, and not one request was attempted. The last
 * assertion is the regression pin — a single `fetch` or `EventSource` here means some future change
 * put the dev-server adapter (or something like it) back in front of the refusal.
 *
 * `studio-shell-boot-gaps.test.ts` is the other half: an http page with no launcher still falls
 * back to the dev-server adapter.
 */
import "./with-dom.js";
import { expect, mock, test } from "bun:test";
import { hasPlatform } from "../src/platform";
import type { LauncherSignal } from "../src/platform";
import { PlatformUnavailableError } from "../src/platforms/default-platform";
import { flush } from "./harness";

const HUTCH =
  "Electrobun 2.x APIs come from the Hutch devkit, not node_modules. Run `hutch dev` or `hutch build`.";

(globalThis as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(
  "views://studio/index.html",
);

// The document `stageStudioAssets` writes for a launcher: it declared a boot module.
const meta = document.createElement("meta");
meta.name = "jx-boot";
meta.content = "launcher";
document.head.append(meta);

/* What the boot module had recorded by the time `studio.js` evaluated. `launcher` is absent on
   purpose: the import that threw came BEFORE the shim's body, so the body that names the launcher
   never ran — only the signal's first import and its page-error watch did. */
(globalThis as unknown as { __jxLauncher?: LauncherSignal }).__jxLauncher = {
  error: { message: HUTCH, stack: `Error: ${HUTCH}\n    at views://studio/dist/init.js:36:11` },
};

// Every way the dev-server adapter talks to its origin, counted.
let fetches = 0;
globalThis.fetch = mock(async () => {
  fetches += 1;
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;
let eventSources = 0;
(globalThis as Record<string, unknown>).EventSource = class {
  constructor() {
    eventSources += 1;
  }
};
let sockets = 0;
(globalThis as Record<string, unknown>).WebSocket = class {
  constructor() {
    sockets += 1;
  }
};

void mock.module("../src/services/monaco-setup.js", () => ({}));

test("a launcher that registered no adapter gets the boot-failure screen, not the dev server", async () => {
  let caught: unknown;
  try {
    await import("../src/studio");
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PlatformUnavailableError);
  expect((caught as PlatformUnavailableError).refusal).toEqual({
    kind: "launcher",
    launcher: undefined,
  });
  await flush();

  const alert = document.querySelector<HTMLElement>('#shell-root [role="alert"]');
  expect(alert).not.toBeNull();
  expect(alert!.textContent).toContain("Jx Studio couldn't connect to its backend");
  // The recorded error, verbatim — the sentence that names the actual defect.
  expect(alert!.querySelector('[part="detail"]')?.textContent).toContain("Hutch devkit");
  expect(alert!.querySelector('[part="facts"]')?.textContent).toContain(
    "views://studio/index.html",
  );

  // The frame was never drawn, and nothing stands in for the missing adapter.
  expect(document.querySelector("#app")).toBeNull();
  expect(document.querySelector("#toolbar")).toBeNull();
  expect(hasPlatform()).toBe(false);

  // The regression pin: not one request against an origin with nothing behind it.
  expect(fetches).toBe(0);
  expect(eventSources).toBe(0);
  expect(sockets).toBe(0);
});
