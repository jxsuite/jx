/**
 * The assistant gate's fourth managed state (ai.md §2.1): the backend requires something of the
 * user before the assistant runs. No Cloudflare round trip changes that, so the offer is what the
 * backend offers — in its own words, read off the `/models` probe — and an action that is done
 * re-runs the probe, which is what opens the gate.
 *
 * The action flow is doubled: it opens a dialog, and what the gate owes it is a call with the
 * probe's offer.
 */
import { flush, installMockPlatform, pointer } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "lit-html";
import type { ActionPrompt } from "../src/account/action-flow";
import type { OfferedAction } from "../src/types";

const offers: ActionPrompt[] = [];
let actionResult = true;
let performsActions = true;
void mock.module("../src/account/action-flow", () => ({
  canPerformActions: () => performsActions,
  leadingActions: (actions: OfferedAction[]) => (actions[0] ? { lead: actions[0] } : null),
  promptAction: async (prompt: ActionPrompt) => {
    offers.push(prompt);
    return actionResult;
  },
}));

const { createManagedConnect } = await import("../src/ui/ai-managed-connect");
const { fetchAvailableModels, proxyActionOffer, resetModelCache } =
  await import("../src/services/ai-models");

installMockPlatform();

const JOIN = { href: "https://studio.test/join", id: "join", label: "Join the team" };

const REFUSED = {
  actions: [JOIN, { id: "broken" }],
  code: "action_required",
  configured: false,
  detail: "The assistant here is for team members.",
  managed: true,
  models: [],
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
  actionResult = true;
  performsActions = true;
  probeBody = REFUSED;
  probes = 0;
  for (const node of containers.splice(0)) {
    node.remove();
  }
});

describe("the probe's action offer", () => {
  test("is kept only from an action_required answer, and dropped by a reset", async () => {
    await fetchAvailableModels({ force: true });
    expect(proxyActionOffer()).toEqual({ actions: [JOIN], detail: REFUSED.detail });
    resetModelCache();
    expect(proxyActionOffer()).toBeNull();

    probeBody = { code: "action_required", configured: false, detail: "", models: [] };
    await fetchAvailableModels({ force: true });
    // An empty sentence and absent actions are not invented.
    expect(proxyActionOffer()).toEqual({ actions: [] });

    probeBody = { code: "cf_not_connected", configured: false, managed: true, models: [] };
    await fetchAvailableModels({ force: true });
    expect(proxyActionOffer()).toBeNull();
  });
});

describe("the gate", () => {
  test("offers the backend's action in its words, whether or not the platform brokers Cloudflare", async () => {
    await fetchAvailableModels({ force: true });
    const { container, mc } = await makeConnect();
    expect(mc.canOffer()).toBe(true);
    expect(container.querySelector('[part="intro"]')?.textContent).toBe(REFUSED.detail);
    expect(container.querySelector('[part="connect"]')?.textContent?.trim()).toBe("Join the team");
  });

  test("an action that is done re-runs the probe", async () => {
    await fetchAvailableModels({ force: true });
    const { container } = await makeConnect();
    const before = probes;
    pointer(container.querySelector('[part="connect"] [part="control"]') as HTMLElement, "click");
    await flush(6);
    expect(offers).toEqual([{ actions: [JOIN], detail: REFUSED.detail }]);
    expect(probes).toBe(before + 1);
  });

  test("a declined offer leaves the probe alone", async () => {
    actionResult = false;
    await fetchAvailableModels({ force: true });
    const { container } = await makeConnect();
    const before = probes;
    pointer(container.querySelector('[part="connect"] [part="control"]') as HTMLElement, "click");
    await flush(6);
    expect(offers).toHaveLength(1);
    expect(probes).toBe(before);
  });

  test("without words it says what it can", async () => {
    probeBody = { actions: [JOIN], code: "action_required", configured: false, models: [] };
    await fetchAvailableModels({ force: true });
    const { container } = await makeConnect();
    expect(container.querySelector('[part="intro"]')?.textContent).toBe(
      "The assistant here needs one more step first.",
    );
  });

  test("an offer with nothing in it, or a platform that performs nothing, offers nothing", async () => {
    probeBody = { code: "action_required", configured: false, managed: true, models: [] };
    await fetchAvailableModels({ force: true });
    const empty = await makeConnect();
    expect(empty.mc.canOffer()).toBe(false);

    probeBody = REFUSED;
    performsActions = false;
    await fetchAvailableModels({ force: true });
    const { mc } = await makeConnect();
    expect(mc.canOffer()).toBe(false);
  });
});
