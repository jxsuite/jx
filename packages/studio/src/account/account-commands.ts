/**
 * Account-commands.ts — the palette's way to a hosted platform's plan (desktop.md §10.4).
 *
 * One verb, because the user has one question — "my plan" — and the answer depends on where they
 * stand: someone on a plan goes to where it is managed, and anyone else is offered it. Gated on
 * `capability.upgrade`, so a platform that sells nothing has no Account verbs at all.
 *
 * @docs studio/interface/preferences
 */

import { getSubscription } from "../account-status";
import { getPlatform } from "../platform";
import { promptUpgrade } from "./upgrade-flow";
import type { AnyCommand } from "../commands/registry";

/**
 * Open the plan: where it is managed for a user who holds one, the offer for everyone else.
 *
 * Reads the CACHED standing rather than asking the platform first, and that is the point: the
 * management page opens in a window, and a browser grants a window only to code still running
 * inside the activation that asked for it.
 */
export function openPlan(): void {
  const plan = getSubscription();
  if (plan?.entitled && plan.manageUrl) {
    void getPlatform().manageSubscription?.();
    return;
  }
  void promptUpgrade();
}

export function accountCommands(): AnyCommand[] {
  return [
    {
      category: "Account",
      id: "account.plan",
      level: "application",
      menus: ["palette"],
      run: () => {
        openPlan();
      },
      title: "Plan and Billing…",
      when: (ctx) => ctx.capability.upgrade,
    },
  ];
}
