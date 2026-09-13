/// <reference lib="dom" />
/**
 * Cf-account-picker.ts — "which Cloudflare account?", the question nothing in Studio asked.
 *
 * A Cloudflare grant can reach several accounts, and the broker stores exactly one id per
 * connection. Until one is chosen every Cloudflare-backed call answers `cf_account_required`, so a
 * multi-account user finished the hosted OAuth flow and landed in a state that reads as connected
 * and behaves as broken: the assistant 401s, publishing 401s, and no surface says why. The broker
 * has had `/cf/accounts` and `/cf/select-account` the whole time; this is the first caller.
 *
 * ONE picker, invoked wherever a connect resolves account-less — the assistant's managed-connect
 * CTA, the publish panel, and a button on the Preferences row. A second picker per surface is how
 * three surfaces end up disagreeing about what "connected" means.
 *
 * Cloud-only by construction: the PAL members it drives are the brokered ones, so a platform
 * holding a pasted API token (desktop, dev server) keeps its own local account field and this
 * resolves null without opening anything.
 *
 * The dialog itself is `src/surfaces/cf-account-picker.json`, a `jx-dialog`; this module is the
 * flow around it. It used to be a lit template rendered through `showDialog`, with its own
 * `repaint()` re-rendering the whole body into the slot's parent whenever anything landed — the
 * surface is reactive now, so a listing that arrives late, or a refusal, changes only what it names.
 *
 * @docs studio/ai
 * @license MIT
 */

import { getPlatform, hasPlatform } from "../platform";
import { notifyCredentialsChanged } from "../settings/preferences-accounts";
import { openCfAccountPickerSurface } from "../surfaces/cf-account-picker";
import { layerHost } from "./layers";
import type { CfAccountSummary } from "../types";

/** Whether this platform brokers the connection, and so can be asked which accounts it reaches. */
function canPick(): boolean {
  if (!hasPlatform()) {
    return false;
  }
  const platform = getPlatform();
  return Boolean(platform.cfAccounts && platform.cfSelectAccount);
}

/** What a thrown thing says, for a line the reader has to act on. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Ask which Cloudflare account this connection should use, and store the answer.
 *
 * Resolves the chosen account, or null — dismissed, or a platform that does not broker connections
 * at all. A caller treats null as "still unusable" rather than as a failure: nothing was changed,
 * and the surface that opened this is the one that knows what to say about it.
 *
 * @returns {Promise<CfAccountSummary | null>}
 */
export function openCfAccountPicker(): Promise<CfAccountSummary | null> {
  if (!canPick()) {
    return Promise.resolve(null);
  }
  return new Promise<CfAccountSummary | null>((resolve) => {
    let accounts: CfAccountSummary[] = [];
    /** The id being committed. Held here as well as in the scope: it is what guards a second press. */
    let choosing = "";
    let settled = false;

    /* Resolve once, and take the dialog down with it. `close()` provokes the platform's own
       `close`, which comes back as `onClosed` — so the guard is what keeps a chosen account from
       being overwritten by the dismissal its own commit caused. */
    const finish = (account: CfAccountSummary | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      handle.close();
      resolve(account);
    };

    async function load(): Promise<void> {
      handle.update({ failure: "", loading: true });
      let failure = "";
      try {
        accounts = (await getPlatform().cfAccounts?.()) ?? [];
      } catch (error) {
        accounts = [];
        failure = reasonOf(error);
      }
      /* `done` released the slot, so a late listing landing after a dismissal would otherwise be a
         write into a disposed surface. The lit version guarded the same moment by resolving its
         host lazily and finding none. */
      if (settled) {
        return;
      }
      handle.update({ accounts, failure, loading: false });
    }

    async function choose(id: string): Promise<void> {
      const account = accounts.find((candidate) => candidate.id === id);
      if (!account || choosing !== "") {
        return;
      }
      choosing = id;
      handle.update({ choosing: id, failure: "" });
      try {
        await getPlatform().cfSelectAccount?.({ id: account.id, name: account.name });
      } catch (error) {
        choosing = "";
        if (!settled) {
          /* The list survives a refusal, and the reason sits above it: listing again is not what
             would fix an account the broker will not accept, so this state offers no retry. */
          handle.update({ choosing: "", failure: reasonOf(error) });
        }
        return;
      }
      /* The stored account is a credential like any other: the assistant's gate, the publish
         panel and the Preferences row all re-read from the same announcement. */
      notifyCredentialsChanged();
      finish(account);
    }

    const handle = openCfAccountPickerSurface({
      layer: layerHost("dialog"),
      onChoose: (id) => {
        void choose(id);
      },
      onClosed: () => {
        finish(null);
      },
      onRetry: () => {
        void load();
      },
    });
    void load();
  });
}
