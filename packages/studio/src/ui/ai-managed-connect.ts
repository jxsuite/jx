/// <reference lib="dom" />
/**
 * Ai-managed-connect.ts — the keyless "Connect Cloudflare" (Workers AI) option for credentials
 * gates.
 *
 * Companion to ai-credentials-form.ts: managed platforms broker Workers AI on the user's OWN
 * Cloudflare account, so a gate that renders only the key form strands them — they have no key, and
 * nothing on screen offers the hosted OAuth flow that would give them working AI. Both hosts that
 * gate on credentials (the assistant sidebar and the New Project modal's Import/Agent tabs) embed
 * this alongside the form so both real paths are always on offer.
 *
 * This module is the FLOW; `surfaces/ai-managed-connect.json` is what it draws. It decides whether
 * the offer applies, what a finished OAuth round trip meant, and the words a fresh grant and a
 * lapsed one get; the surface renders those words and reports the click. `render()` hands back the
 * surface's own host element rather than a template, because every gate is still a lit template
 * that interpolates the offer beside the key form — see `surfaces/ai-managed-connect.ts` for why
 * that element is the mount point and why re-rendering the gate cannot disturb it.
 *
 * State is per-instance (closure-scoped) like the credentials form; the capability probe behind
 * `ensureProbe` is shared module-wide by services/ai-models.ts.
 *
 * @docs studio/ai
 * @license MIT
 */

import { getPlatform, hasPlatform } from "../platform";
import {
  ensureProxyProbe,
  fetchAvailableModels,
  isManagedProxy,
  isProxyConfigured,
  proxyStateCode,
  resetModelCache,
} from "../services/ai-models";
import { createManagedConnectSurface } from "../surfaces/ai-managed-connect";
import type { ManagedConnectSurface, ManagedConnectView } from "../surfaces/ai-managed-connect";
import type { CfConnectOutcome } from "../types";

export interface ManagedConnectOptions {
  /** Host re-render scheduler — called on connect start/finish and when the probe settles. */
  requestRender: () => void;
}

export interface ManagedConnect {
  /** Whether the keyless path is available and worth offering right now. */
  canOffer: () => boolean;
  /** Fire the shared capability probe, repainting the host when it settles. */
  ensureProbe: () => void;
  /**
   * The CTA block's host element, or `null` when the platform cannot broker AI.
   *
   * A gate interpolates it into its own lit template, which inserts a Node it is handed as-is;
   * `null` clears that position exactly as `nothing` did.
   */
  render: () => HTMLElement | null;
}

/**
 * A lede that says which path is recommended, and one that explains why the button is back.
 *
 * A lapsed grant and a fresh one get different words. The backend distinguishes them because
 * "connect" is an invitation and "reconnect" is an explanation — and on a managed platform the
 * lapsed case is the common one: a Cloudflare access token lives an hour.
 */
const LEDE_FRESH =
  "Recommended — run the assistant on Workers AI in your own Cloudflare account. No API key to create, copy or rotate.";
const LEDE_LAPSED =
  "Your Cloudflare connection has expired. Reconnect to keep using the assistant.";

/**
 * Create a managed-connect controller bound to a host's render scheduler.
 *
 * @param {ManagedConnectOptions} opts
 * @returns {ManagedConnect}
 */
export function createManagedConnect(opts: ManagedConnectOptions): ManagedConnect {
  let busy = false;
  let connectError = "";
  /** Made on the first render that offers, and kept for the life of the controller. */
  let surface: ManagedConnectSurface | null = null;

  /*
   * Offer the keyless path when the proxy is managed and the platform can run the hosted OAuth flow
   * (the PAL seam — desktop shells can implement cfConnect later). Guarded on hasPlatform() because
   * gates can render from modules that load before registration.
   *
   * `configured` alone does NOT withdraw the offer any more. A backend can answer `configured: true`
   * over a grant it cannot actually use, and hiding the CTA there left the user with a broken
   * assistant and no button at all — the one state in which reconnecting is the whole fix. So the
   * lapsed code overrides `configured`, while `cf_upstream_error` (also `configured: true`, and
   * carrying no reconnect code) still hides it: an unreachable Cloudflare is not fixed by an OAuth
   * round trip.
   */
  function canOffer(): boolean {
    if (!isManagedProxy() || !hasPlatform() || !getPlatform().cfConnect) {
      return false;
    }
    return !isProxyConfigured() || proxyStateCode() === "cf_reconnect_required";
  }

  function ensureProbe() {
    ensureProxyProbe(opts.requestRender);
  }

  /**
   * Act on how the flow ended.
   *
   * Every branch here exists because the old code had ONE: any truthy result was success, so a
   * connect that landed on the same lapsed row re-probed, got the same `cf_reconnect_required`
   * back, and re-rendered a byte-identical CTA. The user clicked Reconnect and observably nothing
   * happened — which is the half of the outage that made the other half impossible to diagnose.
   *
   * @param {CfConnectOutcome | null} outcome - Null where the platform had no DOM to open a popup
   *   in.
   */
  async function settle(outcome: CfConnectOutcome | null): Promise<void> {
    /* A blocked popup turns into a full-page redirect, and null is a host with nowhere to open one:
       in both the document is on its way out, so an apology would be the last thing painted before
       it goes. Cancellation is silent for the opposite reason — the user already knows. */
    if (!outcome || outcome.status === "redirect" || outcome.status === "canceled") {
      return;
    }
    if (outcome.status === "timeout") {
      connectError =
        "The Cloudflare window didn't finish. Sign in there, then reconnect — nothing was changed.";
      return;
    }
    if (!outcome.connection.accountId) {
      /* Lazily, because the picker pulls the dialog layer in and this module is imported by every
         credentials gate — including ones that render before layers are bound. */
      const { openCfAccountPicker } = await import("./cf-account-picker");
      if (!(await openCfAccountPicker())) {
        connectError =
          "Cloudflare is connected, but no account is chosen yet — pick one to finish setting up the assistant.";
        return;
      }
    }
    // Re-probe: /models flips to configured once the connection lands, opening the gate.
    resetModelCache();
    await fetchAvailableModels({ force: true });
    /* And then CHECK, because a connect the backend does not honour must not look like one that
       worked. This is the only place that can tell the difference. */
    if (!isProxyConfigured() || proxyStateCode() === "cf_reconnect_required") {
      connectError =
        "Cloudflare connected, but the assistant backend still reports the connection as unusable. " +
        "Try reconnecting, or use your own API key below.";
    }
  }

  async function connect() {
    if (busy) {
      return;
    }
    busy = true;
    connectError = "";
    opts.requestRender();
    try {
      await settle((await getPlatform().cfConnect?.()) ?? null);
    } catch (error) {
      connectError = error instanceof Error ? error.message : String(error);
    }
    busy = false;
    opts.requestRender();
  }

  /** What the offer says right now — the whole of what the surface is told. */
  function view(): ManagedConnectView {
    const lapsed = proxyStateCode() === "cf_reconnect_required";
    const idleLabel = lapsed ? "Reconnect Cloudflare" : "Connect Cloudflare";
    return {
      buttonLabel: busy ? (lapsed ? "Reconnecting…" : "Connecting…") : idleLabel,
      busy,
      error: connectError,
      intro: lapsed ? LEDE_LAPSED : LEDE_FRESH,
    };
  }

  function render(): HTMLElement | null {
    if (!canOffer()) {
      return null;
    }
    if (surface) {
      surface.update(view());
    } else {
      surface = createManagedConnectSurface(view(), {
        connect: () => {
          void connect();
        },
      });
    }
    return surface.host;
  }

  return { canOffer, ensureProbe, render };
}
