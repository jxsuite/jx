/**
 * The assistant gate's fourth managed state (ai.md §2.1): the backend sells a plan that covers the
 * assistant, and this user is not on it. No Cloudflare round trip changes that, so the offer is the
 * plan — in the backend's own words, read off the `/models` probe — and a plan that starts re-runs
 * the probe, which is what opens the gate.
 *
 * The upgrade flow is doubled: it opens a dialog, and what the gate owes it is a call with the
 * probe's offer.
 */
import { flush, installMockPlatform, pointer } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "lit-html";
import type { UpgradePrompt } from "../src/account/upgrade-flow";

const offers: UpgradePrompt[] = [];
let upgradeResult = true;
let sellsPlan = true;
void mock.module("../src/account/upgrade-flow", () => ({
  canUpgrade: () => sellsPlan,
  promptUpgrade: async (prompt: UpgradePrompt) => {
    offers.push(prompt);
    return upgradeResult;
  },
}));

const { createManagedConnect } = await import("../src/ui/ai-managed-connect");
const { fetchAvailableModels, proxyUpgradeOffer, resetModelCache } =
  await import("../src/services/ai-models");

installMockPlatform();

const REFUSED = {
  code: "subscription_required",
  configured: false,
  detail: "The assistant on Jx Cloud needs Jx Studio Cloud.",
  managed: true,
  models: [],
  trialAvailable: true,
  upgradeUrl: "https://studio.test/checkout",
};

let probeBody: Record<string, unknown> = REFUSED;
let probes = 0;
(globalThis as Record<string, unknown>).fetch = async () => {
  probes += 1;
  return Response.json(probeBody, { status: 200 });
};

const containers: HTMLElement[] = [];

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

beforeEach(async () => {
  resetModelCache();
  offers.length = 0;
  upgradeResult = true;
  sellsPlan = true;
  probeBody = REFUSED;
  probes = 0;
  for (const node of containers.splice(0)) {
    node.remove();
  }
});

describe("the probe's plan offer", () => {
  test("is kept only from a subscription_required answer, and dropped by a reset", async () => {
    await fetchAvailableModels({ force: true });
    expect(proxyUpgradeOffer()).toEqual({
      detail: REFUSED.detail,
      trialAvailable: true,
      upgradeUrl: REFUSED.upgradeUrl,
    });
    resetModelCache();
    expect(proxyUpgradeOffer()).toBeNull();

    probeBody = { code: "subscription_required", configured: false, detail: "", models: [] };
    await fetchAvailableModels({ force: true });
    // An empty sentence and absent members are not invented.
    expect(proxyUpgradeOffer()).toEqual({});

    probeBody = { code: "cf_not_connected", configured: false, managed: true, models: [] };
    await fetchAvailableModels({ force: true });
    expect(proxyUpgradeOffer()).toBeNull();
  });
});

describe("the gate", () => {
  test("offers the plan in the backend's words, whether or not the platform brokers Cloudflare", async () => {
    await fetchAvailableModels({ force: true });
    const { container, mc } = await makeConnect();
    expect(mc.canOffer()).toBe(true);
    expect(container.querySelector('[part="intro"]')?.textContent).toBe(REFUSED.detail);
    expect(container.querySelector('[part="connect"]')?.textContent?.trim()).toBe(
      "Start free trial",
    );
  });

  test("a plan that starts re-runs the probe", async () => {
    await fetchAvailableModels({ force: true });
    const { container } = await makeConnect();
    const before = probes;
    pointer(container.querySelector('[part="connect"] [part="control"]') as HTMLElement, "click");
    await flush(6);
    expect(offers).toEqual([
      { detail: REFUSED.detail, trialAvailable: true, upgradeUrl: REFUSED.upgradeUrl },
    ]);
    expect(probes).toBe(before + 1);
  });

  test("a declined offer leaves the probe alone", async () => {
    upgradeResult = false;
    await fetchAvailableModels({ force: true });
    const { container } = await makeConnect();
    const before = probes;
    pointer(container.querySelector('[part="connect"] [part="control"]') as HTMLElement, "click");
    await flush(6);
    expect(offers).toHaveLength(1);
    expect(probes).toBe(before);
  });

  test("without a trial it says Subscribe, and without words it says what it can", async () => {
    probeBody = { code: "subscription_required", configured: false, managed: true, models: [] };
    await fetchAvailableModels({ force: true });
    const { container } = await makeConnect();
    expect(container.querySelector('[part="intro"]')?.textContent).toBe(
      "The assistant here needs a subscription.",
    );
    expect(container.querySelector('[part="connect"]')?.textContent?.trim()).toBe("Subscribe");
  });

  test("a platform that cannot sell the plan offers nothing", async () => {
    sellsPlan = false;
    await fetchAvailableModels({ force: true });
    const { mc } = await makeConnect();
    expect(mc.canOffer()).toBe(false);
  });
});
