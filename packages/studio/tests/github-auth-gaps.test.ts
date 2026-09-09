/**
 * The GitHub device-flow waiting room — `src/surfaces/github-auth.json` and its adapter, driven
 * through the real flow that `tests/github-auth.test.ts` bypasses with a doubled surface. It also
 * covers the poll loop's cancelled and network-error branches, which that file never reaches
 * because it never lets the dialog exist.
 *
 * Everything is addressed by `part`, because the dialog is a document now: there is no
 * `.github-auth-code` to find and no `sp-dialog-wrapper` to dispatch at — the box, the header, the
 * one answer button and the backdrop all belong to `jx-dialog`, and the code, the link and the wait
 * are parts of the document inside it.
 */
import { flush } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import { REGION_ATTR } from "../src/ui/regions";
import type { NotifyCall } from "./notify-mock";

if (globalThis.localStorage === undefined) {
  const store = new Map();
  globalThis.localStorage = {
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    removeItem: (k: string) => store.delete(k),
    setItem: (k: string, v: string) => store.set(k, v),
  } as any;
}

const STORAGE_KEY = "jx_github_token";

/** The dialog layer, standing in for `#layer-dialog` without a shell to hang it off. */
const dialogLayer = document.createElement("div");
document.body.append(dialogLayer);

void mock.module("../src/ui/layers.js", () => ({
  layerHost: () => dialogLayer,
  showConfirmDialog: async () => true,
}));

const notifications: NotifyCall[] = [];
void mock.module("../src/services/notify.js", () =>
  notifyModule((call) => notifications.push(call)),
);

const { authenticateGithub, MAX_POLL_FAILURES } = await import("../src/github/github-auth.js");

// ─── Fetch stub with deferred responses ──────────────────────────────────────

type FetchImpl = (url: string, opts: any) => Promise<any>;
let fetchQueue: FetchImpl[] = [];
let fetchCalls: string[] = [];
const originalFetch = globalThis.fetch;

function installFetch() {
  fetchCalls = [];
  // @ts-expect-error -- minimal fetch mock does not implement the full fetch type
  globalThis.fetch = async (url: any, opts: any) => {
    fetchCalls.push(String(url));
    const next = fetchQueue.shift();
    if (!next) {
      throw new Error(`Unexpected fetch to ${url}`);
    }
    return next(String(url), opts);
  };
}

const jsonResp =
  (json: unknown, ok = true): FetchImpl =>
  async () => ({ json: async () => json, ok, status: ok ? 200 : 500 });

/** Device-code response with a controllable poll interval (seconds). */
const deviceResp = (interval: number) =>
  jsonResp({
    device_code: "dc_gaps",
    interval,
    user_code: "GAPS-1234",
    verification_uri: "https://github.com/login/device",
  });

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Wait until a condition holds, polling on a short interval. Robust where a fixed `sleep` is not:
 * the poll loop schedules with setTimeout(0) for a 0s device interval, and under full-suite load
 * (or Windows' ~15ms timer granularity) that fires later than a fixed 10ms sleep, racing the
 * assert.
 */
const waitFor = async (cond: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition not met before timeout");
    }
    await sleep(5);
  }
};

/** The waiting room, or null. Named by its own `part`, so nothing else can answer for it. */
function dialogElement(): HTMLElement | null {
  return dialogLayer.querySelector<HTMLElement>('jx-dialog[part="github-auth"]');
}

/**
 * Wait for the dialog to be addressable.
 *
 * Two settlings, not one: the mount resolving means the DOCUMENT rendered, and `jx-dialog` settles
 * its own template one `connectedCallback` later — so a single flush finds the element with none of
 * its parts inside it (specs/studio-ui-guidelines.md §1.1).
 */
async function openedDialog(): Promise<HTMLElement> {
  await waitFor(() => dialogElement()?.querySelector('[part="code"]') != null);
  return dialogElement()!;
}

/** One part's text, trimmed the way a reader would read it. */
function partText(dialog: HTMLElement, part: string): string {
  return dialog.querySelector(`[part="${part}"]`)?.textContent?.trim() ?? "";
}

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  dialogLayer.replaceChildren();
  fetchQueue = [];
  notifications.length = 0;
  installFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("the device-flow dialog", () => {
  test("prints the code and the page, and offers only a way out", async () => {
    // Interval of 1s: the first poll never fires before we cancel.
    fetchQueue = [deviceResp(1)];
    const promise = authenticateGithub();
    const dialog = await openedDialog();

    expect(partText(dialog, "headline")).toBe("Sign in to GitHub");
    expect(partText(dialog, "lede")).toBe("Enter this code on GitHub to authorize Jx Studio:");
    expect(partText(dialog, "code")).toBe("GAPS-1234");
    expect(partText(dialog, "waiting")).toBe("Waiting for authorization…");

    const link = dialog.querySelector<HTMLAnchorElement>('[part="link"]')!;
    expect(link.getAttribute("href")).toBe("https://github.com/login/device");
    expect(link.textContent).toContain("https://github.com/login/device");
    expect(link.getAttribute("target")).toBe("_blank");

    /*
     * No primary button at all: the answer arrives from GitHub over the poll, so a confirm would be
     * a control with nothing to do. Cancel is the only thing on screen the reader can press.
     */
    expect(dialog.querySelector('[part="confirm"]')).toBeNull();
    expect(partText(dialog, "cancel-label")).toBe("Cancel");

    // The slot the document was mounted into carries the region the camera addresses.
    expect(dialog.closest(`[${REGION_ATTR}]`)?.getAttribute(REGION_ATTR)).toBe(
      "overlay.dialog:github-auth",
    );

    dialog.dispatchEvent(new Event("cancel"));
    expect(await promise).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Cancel took the document down with it, and the pending poll timer went too.
    expect(dialogElement()).toBeNull();
    await sleep(20);
    expect(fetchCalls).toEqual(["https://github.com/login/device/code"]);
  });

  test("the platform's own close dismisses it and resolves null", async () => {
    // Escape, or a dismissal `closedby` allows: the element reports `close` and nothing else.
    fetchQueue = [deviceResp(1)];
    const promise = authenticateGithub();
    const dialog = await openedDialog();

    dialog.dispatchEvent(new Event("close"));
    expect(await promise).toBeNull();
    expect(dialogElement()).toBeNull();
    await sleep(20);
    expect(fetchCalls.length).toBe(1);
  });

  test("cancel during an in-flight poll stops the loop after the response lands", async () => {
    let resolveToken: ((value: any) => void) | undefined;
    fetchQueue = [
      deviceResp(0),
      () =>
        new Promise((resolve) => {
          resolveToken = resolve;
        }),
    ];
    const promise = authenticateGithub();
    // 0s interval: wait until the poll has fired and the token request is in flight (a fixed sleep
    // Races setTimeout(0) under load / Windows timer granularity).
    await waitFor(() => fetchCalls.length === 2);
    const dialog = await openedDialog();

    dialog.dispatchEvent(new Event("cancel"));
    expect(await promise).toBeNull();

    // The pending poll completes with authorization_pending and schedules another poll,
    // Which must early-return because the flow was cancelled.
    resolveToken!({
      json: async () => ({ error: "authorization_pending" }),
      ok: true,
      status: 200,
    });
    await sleep(20);
    expect(fetchCalls.length).toBe(2);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("network error during polling retries and then succeeds", async () => {
    fetchQueue = [
      deviceResp(0),
      () => Promise.reject(new Error("offline")),
      jsonResp({ access_token: "ghp_retry_token" }),
    ];
    const result = await authenticateGithub();
    expect(result).toBe("ghp_retry_token");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("ghp_retry_token");
    expect(fetchCalls).toEqual([
      "https://github.com/login/device/code",
      "https://github.com/login/oauth/access_token",
      "https://github.com/login/oauth/access_token",
    ]);
    // The dialog was torn down once the token arrived — including the mount that may still have
    // Been in flight when it did, which is the one case a bare `close()` cannot cover on its own.
    await flush();
    expect(dialogLayer.childElementCount).toBe(0);
  });

  test("access_denied resolves null and closes the dialog", async () => {
    fetchQueue = [deviceResp(0), jsonResp({ error: "access_denied" })];
    const result = await authenticateGithub();
    expect(result).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    await flush();
    expect(dialogLayer.childElementCount).toBe(0);
    // It rests rather than persisting: the state is CORRECT — there is no token because the user
    // Declined to grant one — and a Problems row promises something still needs fixing.
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.severity).toBe("warn");
    expect(notifications[0]!.options.detail).toBe("The authorization was declined on GitHub.");
  });

  test("expired_token says the code expired, and offers the same Retry", async () => {
    fetchQueue = [deviceResp(0), jsonResp({ error: "expired_token" })];
    expect(await authenticateGithub()).toBeNull();
    expect(notifications[0]!.options.detail).toBe("The device code expired before it was entered.");
    expect(notifications[0]!.options.action).toBe("git.signInToGithub");
  });

  test("an unrecognised error quotes back what GitHub actually said", async () => {
    fetchQueue = [deviceResp(0), jsonResp({ error: "unsupported_grant_type" })];
    expect(await authenticateGithub()).toBeNull();
    expect(notifications[0]!.options.detail).toContain("unsupported_grant_type");
  });

  test("an answer with no error field at all still reports rather than hanging", async () => {
    fetchQueue = [deviceResp(0), jsonResp({})];
    expect(await authenticateGithub()).toBeNull();
    expect(notifications[0]!.options.detail).toContain("an unrecognised response");
  });

  test("consecutive poll failures give up as a Problem instead of retrying forever", async () => {
    // The old loop's `catch {}` re-armed the timer with no budget: against a network that never
    // Answers, the dialog said "Waiting for authorization…" until the window closed.
    fetchQueue = [
      deviceResp(0),
      ...Array.from(
        { length: MAX_POLL_FAILURES },
        () => (() => Promise.reject(new TypeError("Failed to fetch"))) as FetchImpl,
      ),
    ];
    expect(await authenticateGithub()).toBeNull();
    expect(fetchCalls).toHaveLength(1 + MAX_POLL_FAILURES);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.severity).toBe("error");
    expect(notifications[0]!.message).toBe("Could not reach GitHub to sign in.");

    // And nothing was scheduled after it gave up.
    await sleep(20);
    expect(fetchCalls).toHaveLength(1 + MAX_POLL_FAILURES);
  });

  test("a failure that recovers resets the budget rather than accumulating", async () => {
    fetchQueue = [
      deviceResp(0),
      () => Promise.reject(new TypeError("Failed to fetch")),
      jsonResp({ error: "authorization_pending" }),
      () => Promise.reject(new TypeError("Failed to fetch")),
      jsonResp({ access_token: "ghp_recovered" }),
    ];
    expect(await authenticateGithub()).toBe("ghp_recovered");
    expect(notifications).toHaveLength(0);
  });

  test("a token that lands first is not overwritten by the close it provokes", async () => {
    /*
     * The defect the two-step answer exists to prevent. Closing the dialog raises `close` behind
     * it, and the old template bound one handler to both `@cancel` and `@close` that resolved the
     * promise with `null` — so "GitHub answered" and "the reader dismissed this" were the same code
     * path, and whichever ran second decided what the caller got.
     */
    fetchQueue = [deviceResp(0), jsonResp({ access_token: "ghp_not_clobbered" })];
    expect(await authenticateGithub()).toBe("ghp_not_clobbered");
    await flush();
    expect(dialogLayer.childElementCount).toBe(0);
  });
});

describe("the waiting room on its own", () => {
  test("closing before the mount lands disposes it, and a second close says nothing twice", async () => {
    /*
     * The flow reaches this on its ordinary path rather than its unusual one: with a zero-second
     * device interval GitHub can answer before the document has finished mounting, and the mount
     * that arrives afterwards must be disposed rather than left showing over an app that has moved
     * on. `onClosed` fires once, because two paths reach it and either may be first.
     */
    const { openGithubAuthSurface } = await import("../src/surfaces/github-auth");
    const layer = document.createElement("div");
    document.body.append(layer);
    let closures = 0;
    const handle = openGithubAuthSurface({
      layer,
      onCancel: () => {},
      onClosed: () => {
        closures += 1;
      },
      userCode: "EARL-Y000",
      verificationUri: "https://github.com/login/device",
    });
    expect(layer.childElementCount).toBe(1);

    handle.close();
    expect(layer.childElementCount).toBe(0);
    handle.close();
    expect(closures).toBe(1);

    const element = await handle.ready;
    await flush();
    expect(element.isConnected).toBe(false);
    layer.remove();
  });
});
