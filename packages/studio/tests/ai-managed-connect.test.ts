/**
 * Tests for the keyless "Connect Cloudflare" (Workers AI) option every AI credentials gate embeds
 * beside the key form — `src/ui/ai-managed-connect.ts`, the flow, and
 * `src/surfaces/ai-managed-connect.json`, the document it mounts.
 *
 * The regression this guards: a gate that renders only the key form strands managed-platform users,
 * who have no key and no way to obtain one from inside Studio.
 *
 * Everything is addressed by `part`, because the offer is a document: there is no `sp-button` or
 * `.ai-managed-connect-lede` to find any more. The container is ATTACHED and every render is
 * awaited — `mountSurface` settles when the document has rendered, and the kit's own template is
 * one `connectedCallback` after that, so a detached container or a synchronous assertion finds
 * nothing at all.
 */
import { flush, installMockPlatform, pointer } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "lit-html";
import type { CfAccountSummary, CfConnectOutcome } from "../src/types";

/**
 * The account picker is doubled, for both reasons the repo policy names: `connect()` reaches it
 * through a lazy `import()`, so without a double there is no witness that it was opened — and two
 * real dynamic imports of one module can race Bun's coverage recorder into dropping the file.
 */
const pickerCalls: number[] = [];
let pickerResult: CfAccountSummary | null = { id: "acc-picked", name: "Picked" };
void mock.module("../src/ui/cf-account-picker", () => ({
  openCfAccountPicker: async () => {
    pickerCalls.push(pickerCalls.length + 1);
    return pickerResult;
  },
}));

const { createManagedConnect } = await import("../src/ui/ai-managed-connect");
const { fetchAvailableModels, resetModelCache } = await import("../src/services/ai-models");

const { platform } = installMockPlatform();

/** A connect that lands on a usable account — the ending most of these cases are not about. */
const CONNECTED: CfConnectOutcome = {
  connection: { accountId: "acc-1", connected: true },
  status: "connected",
};

let fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () =>
  Response.json({ models: [] }, { status: 200 });
const fetchCalls: string[] = [];
(globalThis as Record<string, unknown>).fetch = (url: string, init?: RequestInit) => {
  fetchCalls.push(url);
  return fetchImpl(url, init);
};

/** Every container this file has attached, so one test's DOM never outlives it. */
const containers: HTMLElement[] = [];

/**
 * A controller wired to re-render itself into a dedicated container.
 *
 * Asynchronous, and the container is in the document: the offer is a mounted document now, so the
 * first render that actually offers starts a mount that has to settle before anything can be
 * found.
 */
async function makeConnect() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const mc = createManagedConnect({
    requestRender: () => {
      render(mc.render(), container);
    },
  });
  render(mc.render(), container);
  await flush(6);
  return { container, mc };
}

/** The offer's root, or null when the controller is not offering. */
function cta(container: HTMLElement) {
  return container.querySelector('[part="managed-connect"]');
}

function part(container: HTMLElement, name: string) {
  return container.querySelector(`[part="${name}"]`);
}

/** The kit button's host — what carries `data-variant` and the label. */
function connectButton(container: HTMLElement) {
  return container.querySelector('[part="connect"]') as HTMLElement | null;
}

/** The native control inside it: what a reader presses, and what carries `disabled`. */
function connectControl(container: HTMLElement) {
  return container.querySelector('[part="connect"] [part="control"]') as HTMLElement;
}

/** Put the proxy into managed-but-unconfigured — the state that warrants the offer. */
async function probeManaged(managed: boolean, configured = false) {
  fetchImpl = async () => Response.json({ models: [], configured, managed }, { status: 200 });
  await fetchAvailableModels({ force: true });
}

beforeEach(() => {
  globalThis.localStorage.clear();
  resetModelCache();
  fetchCalls.length = 0;
  pickerCalls.length = 0;
  pickerResult = { id: "acc-picked", name: "Picked" };
  delete platform.cfConnect;
  for (const node of containers.splice(0)) {
    node.remove();
  }
});

describe("canOffer", () => {
  test("only when the proxy is managed, unconfigured, and the platform can run the flow", async () => {
    const { mc } = await makeConnect();
    // Nothing probed yet.
    expect(mc.canOffer()).toBe(false);

    await probeManaged(true);
    // Managed, but this platform has no hosted OAuth flow (desktop/dev server).
    expect(mc.canOffer()).toBe(false);

    platform.cfConnect = async () => CONNECTED;
    expect(mc.canOffer()).toBe(true);

    // Already connected — the gate is open, so there is nothing to offer.
    await probeManaged(true, true);
    expect(mc.canOffer()).toBe(false);

    // Unmanaged backend (OSS dev server): BYOK is the only path.
    await probeManaged(false);
    expect(mc.canOffer()).toBe(false);
  });

  test("a lapsed grant keeps the CTA even when the backend says configured", async () => {
    /* The state that had no button at all. A backend can answer `configured: true` over a grant it
       cannot use — and hiding the offer there is precisely how a user ends up with a broken
       assistant and nothing on screen to press. */
    platform.cfConnect = async () => CONNECTED;
    fetchImpl = async () =>
      Response.json(
        { code: "cf_reconnect_required", configured: true, managed: true, models: [] },
        { status: 200 },
      );
    await fetchAvailableModels({ force: true });
    const { mc } = await makeConnect();
    expect(mc.canOffer()).toBe(true);
  });
});

describe("render", () => {
  test("renders nothing until the offer applies, then the CTA", async () => {
    const { container, mc } = await makeConnect();
    expect(cta(container)).toBeNull();

    await probeManaged(true);
    platform.cfConnect = async () => CONNECTED;
    render(mc.render(), container);
    await flush(6);

    expect(cta(container)).toBeTruthy();
    expect(cta(container)!.textContent).toContain("Workers AI");
    expect(connectButton(container)!.textContent).toContain("Connect Cloudflare");
    // Both paths stay on offer — the CTA introduces the key form below it.
    expect(cta(container)!.textContent).toContain("or bring your own key");
  });

  test("the standing document is updated in place, never rebuilt under the reader", async () => {
    /* The offer is drawn by a gate that repaints on every keystroke in the key form beside it, so
       the mount has to survive a re-render of the template it is interpolated into. lit inserts a
       Node it is handed rather than cloning it, and this is what says so. */
    await probeManaged(true);
    platform.cfConnect = async () => CONNECTED;
    const { container, mc } = await makeConnect();
    const first = cta(container);
    expect(first).toBeTruthy();

    render(mc.render(), container);
    await flush(2);
    expect(cta(container)).toBe(first);
  });

  test("an offer withdrawn and made again comes back as the same document", async () => {
    /* The gate takes the node out of the page when the offer no longer applies — lit `remove()`s it
       rather than emptying it — so putting it back is an insertion, not a second mount. */
    await probeManaged(true);
    platform.cfConnect = async () => CONNECTED;
    const { container, mc } = await makeConnect();
    const first = cta(container);
    expect(first).toBeTruthy();

    await probeManaged(true, true);
    render(mc.render(), container);
    await flush(2);
    expect(cta(container)).toBeNull();

    await probeManaged(true);
    render(mc.render(), container);
    await flush(2);
    expect(cta(container)).toBe(first);
    expect(connectButton(container)!.textContent).toContain("Connect Cloudflare");
  });

  test("a host the document has been taken out of is mounted into again", async () => {
    /* The other half of the idempotency rule: assignment answers a repaint, and only a host that no
       longer holds the document is mounted into a second time. Nothing in the app empties this one
       — it belongs to the surface — so the branch is asserted here rather than left to trust. */
    await probeManaged(true);
    platform.cfConnect = async () => CONNECTED;
    const { container, mc } = await makeConnect();
    const first = cta(container)!;
    first.remove();
    expect(cta(container)).toBeNull();

    render(mc.render(), container);
    await flush(6);
    const second = cta(container);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(connectButton(container)!.textContent).toContain("Connect Cloudflare");
  });
});

describe("connect", () => {
  test("runs the platform flow, then re-probes so the gate opens", async () => {
    await probeManaged(true);
    const cfConnect = mock(async () => CONNECTED);
    platform.cfConnect = cfConnect;
    const { container, mc } = await makeConnect();

    fetchCalls.length = 0;
    fetchImpl = async () =>
      Response.json(
        { models: [{ id: "@cf/meta/llama-4" }], configured: true, managed: true },
        {
          status: 200,
        },
      );
    pointer(connectControl(container), "click");
    await flush(6);

    expect(cfConnect).toHaveBeenCalledTimes(1);
    expect(fetchCalls).toHaveLength(1);
    // Configured now, so the offer withdraws and the container empties.
    expect(mc.canOffer()).toBe(false);
    expect(cta(container)).toBeNull();
  });

  /**
   * Defect 4, and the regression guard for the whole reported symptom.
   *
   * `connect()` treated any truthy result as success: it force-refetched models, got the SAME
   * `cf_reconnect_required` state back, and re-rendered a byte-identical CTA with no message. The
   * user pressed Reconnect and observably nothing happened — twice, in the production logs.
   */
  test("a connect the backend does not honour says so instead of repainting itself", async () => {
    await probeManaged(true);
    platform.cfConnect = async () => CONNECTED;
    const { container, mc } = await makeConnect();

    // The backend has not changed its mind: still lapsed, still unusable.
    fetchImpl = async () =>
      Response.json(
        { code: "cf_reconnect_required", configured: false, managed: true, models: [] },
        { status: 200 },
      );
    pointer(connectControl(container), "click");
    await flush(6);

    expect(part(container, "error")?.textContent).toContain(
      "still reports the connection as unusable",
    );
    // And the offer stays up, because reconnecting is still the only thing that could fix it.
    expect(mc.canOffer()).toBe(true);
  });

  test("a passed deadline gets its own words; a cancellation and a redirect get none", async () => {
    await probeManaged(true);
    let outcome: CfConnectOutcome | null = { status: "timeout" };
    platform.cfConnect = async () => outcome;
    const { container, mc } = await makeConnect();

    pointer(connectControl(container), "click");
    await flush(6);
    expect(part(container, "error")?.textContent).toContain("didn't finish");

    // A closed popup is not an error — the user already knows what they did.
    outcome = { status: "canceled" };
    pointer(connectControl(container), "click");
    await flush(6);
    expect(part(container, "error")).toBeNull();

    // And a blocked popup navigated the whole page: apologising to a document on its way out is
    // The bug, not the fix.
    outcome = { status: "redirect" };
    pointer(connectControl(container), "click");
    await flush(6);
    expect(part(container, "error")).toBeNull();
    expect(mc.canOffer()).toBe(true);
  });

  test("a connect with no account chosen opens the picker before re-probing", async () => {
    await probeManaged(true);
    platform.cfConnect = async () => ({
      connection: { connected: true },
      status: "connected" as const,
    });
    const { container } = await makeConnect();

    fetchImpl = async () =>
      Response.json({ configured: true, managed: true, models: [] }, { status: 200 });
    pointer(connectControl(container), "click");
    await flush(6);

    expect(pickerCalls).toHaveLength(1);
    expect(part(container, "error")).toBeNull();
  });

  test("a dismissed picker leaves the connection named as unfinished, not as working", async () => {
    await probeManaged(true);
    pickerResult = null;
    platform.cfConnect = async () => ({
      connection: { connected: true },
      status: "connected" as const,
    });
    const { container } = await makeConnect();

    fetchCalls.length = 0;
    pointer(connectControl(container), "click");
    await flush(6);

    expect(part(container, "error")?.textContent).toContain("no account is chosen yet");
    // No point re-probing: the backend answers cf_account_required until one is picked.
    expect(fetchCalls).toHaveLength(0);
  });

  test("surfaces a thrown error and re-enables the button", async () => {
    await probeManaged(true);
    platform.cfConnect = async () => {
      throw new Error("popup blocked");
    };
    const { container } = await makeConnect();

    pointer(connectControl(container), "click");
    await flush(6);

    expect(part(container, "error")?.textContent).toContain("popup blocked");
    expect(connectControl(container).hasAttribute("disabled")).toBe(false);
  });

  test("ignores a second click while a flow is in flight", async () => {
    await probeManaged(true);
    let resolveFlow: ((v: CfConnectOutcome) => void) | null = null;
    const cfConnect = mock(
      async () =>
        await new Promise<CfConnectOutcome>((resolve) => {
          resolveFlow = resolve;
        }),
    );
    platform.cfConnect = cfConnect;
    const { container } = await makeConnect();

    pointer(connectControl(container), "click");
    await flush(2);
    // Busy: the button reads "Connecting…" and its control is disabled.
    expect(connectButton(container)!.textContent).toContain("Connecting");
    expect(connectControl(container).hasAttribute("disabled")).toBe(true);
    /* Dispatched at the HOST, because the control the reader would press is now disabled: the
       second click is refused by the flow's own `busy` guard, which is what this pins. */
    pointer(connectButton(container)!, "click");
    await flush(2);
    expect(cfConnect).toHaveBeenCalledTimes(1);

    resolveFlow!(CONNECTED);
    await flush(6);
  });
});

describe("ensureProbe", () => {
  test("fires the shared capability probe and repaints when it settles", async () => {
    fetchImpl = async () =>
      Response.json({ models: [], configured: false, managed: true }, { status: 200 });
    platform.cfConnect = async () => CONNECTED;
    const { container, mc } = await makeConnect();
    expect(cta(container)).toBeNull();

    mc.ensureProbe();
    await flush(6);

    // The repaint is the point: the offer must appear without any further user action.
    expect(fetchCalls).toHaveLength(1);
    expect(cta(container)).toBeTruthy();
  });
});

/**
 * The Cloudflare option is the RECOMMENDATION on a managed platform, and it has two moods.
 *
 * Both matter to the same outage. studio.jxsuite.com showed the BYOK key form alone, because
 * /ai/models answered 500, the probe threw, and `managed` stayed false — so the block below never
 * rendered at all. With the backend answering 200 and a reason, the block renders, and a lapsed
 * grant has to say so: "Connect Cloudflare" is an invitation, and this user already accepted it.
 */
describe("the recommendation, and its two moods", () => {
  /** Answer the probe exactly as the backend now does for a given state. */
  function probeAnswers(body: Record<string, unknown>) {
    fetchImpl = async () => Response.json(body, { status: 200 });
  }

  async function renderFresh() {
    /* The PAL half of canOffer(): a host that cannot run the hosted OAuth flow must not be offered
       it. Set in every case here, including the two that expect the block to stay hidden, so those
       prove the PROBE hid it rather than a missing platform method. */
    platform.cfConnect = async () => CONNECTED;
    resetModelCache();
    const { container, mc } = await makeConnect();
    mc.ensureProbe();
    await flush(6);
    return { container, mc };
  }

  test("a never-connected user is invited, with the Cloudflare button as the accent action", async () => {
    probeAnswers({ code: "cf_not_connected", configured: false, managed: true, models: [] });
    const { container, mc } = await renderFresh();
    expect(mc.canOffer()).toBe(true);
    const button = connectButton(container);
    expect(button?.textContent?.trim()).toBe("Connect Cloudflare");
    /* Accent is what makes it read as the recommendation rather than one of two equal choices. The
       kit reflects the variant it was given as `data-variant`, which is also what its own style
       block is keyed on — so this is the attribute that decides how the button paints. */
    expect(button?.dataset.variant).toBe("accent");
    expect(part(container, "intro")?.textContent).toContain("Recommended");
    // BYOK stays reachable — prioritised is not the same as exclusive.
    expect(part(container, "divider")?.textContent).toContain("bring your own key");
  });

  test("a lapsed grant is asked to RECONNECT, and told why", async () => {
    probeAnswers({ code: "cf_reconnect_required", configured: false, managed: true, models: [] });
    const { container } = await renderFresh();
    expect(connectButton(container)?.textContent?.trim()).toBe("Reconnect Cloudflare");
    expect(part(container, "intro")?.textContent).toContain("expired");
  });

  test("a transient upstream error does NOT send the user round the OAuth flow", async () => {
    /* `cf_upstream_error` arrives with configured:true precisely so this block stays hidden —
       reconnecting fixes nothing when the fault is Cloudflare's, and offering it would teach the
       user that the button does not work. */
    probeAnswers({ code: "cf_upstream_error", configured: true, managed: true, models: [] });
    const { container, mc } = await renderFresh();
    expect(mc.canOffer()).toBe(false);
    expect(cta(container)).toBeNull();
  });

  test("a backend that sends no code still renders the plain invitation", async () => {
    // Older backends, and the dev server. No reason given is not an error state.
    probeAnswers({ configured: false, managed: true, models: [] });
    const { container } = await renderFresh();
    expect(connectButton(container)?.textContent?.trim()).toBe("Connect Cloudflare");
  });

  test("a probe that fails outright leaves the option hidden — the shape of the outage", async () => {
    /* Pinned as the CONTRAST to the cases above: this is what the product actually did, and the
       reason the fix had to be a 200 with a code rather than a tidier error status. */
    fetchImpl = async () => Response.json({ error: "boom" }, { status: 500 });
    const { container, mc } = await renderFresh();
    expect(mc.canOffer()).toBe(false);
    expect(cta(container)).toBeNull();
  });
});
