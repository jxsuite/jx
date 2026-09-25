/**
 * Tests for the Cloudflare account picker — `src/ui/cf-account-picker.ts` and
 * `src/surfaces/cf-account-picker.json`.
 *
 * The state this closes: a grant that reaches several accounts leaves the broker with no account id
 * stored, every Cloudflare-backed call answering `cf_account_required`, and a UI that reads as
 * connected. `/cf/accounts` and `/cf/select-account` had existed the whole time with no caller.
 *
 * Everything is addressed by `part`, because the picker is a document: there is no
 * `.cf-account-picker` to find any more, and no `.prefs-account` either — the row shape it borrowed
 * from Preferences › Accounts travels with the surface now. The box, the backdrop, Escape and the
 * Cancel button all belong to `jx-dialog`.
 */
import { flush, installMockPlatform } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";

const { openCfAccountPicker } = await import("../src/ui/cf-account-picker");
const { initLayers } = await import("../src/ui/layers");
const { onCredentialsChanged, resetCredentialListeners } =
  await import("../src/settings/preferences-accounts");

const ACCOUNTS = [
  { id: "acc-1", name: "Personal" },
  { id: "acc-2", name: "Acme Corp" },
];

function d<T extends Element = HTMLElement>(sel: string): T | null {
  return document.querySelector(`#layer-dialog ${sel}`) as T | null;
}

/** The dialog itself, which is the surface's root. */
function dialog(): HTMLElement | null {
  return d('jx-dialog[part="cf-accounts"]');
}

function row(id: string): HTMLElement | null {
  return d(`[part="row"][data-account="${id}"]`);
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/**
 * Dismiss it the way a reader would: the platform's `cancel`, which is what Escape raises on a
 * native `<dialog>` and what the kit's own Cancel button dispatches.
 */
function dismiss(): void {
  dialog()?.dispatchEvent(new Event("cancel", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = `<div id="layer-modal"></div><div id="layer-dialog"></div>`;
  initLayers();
  resetCredentialListeners();
});

describe("openCfAccountPicker", () => {
  test("lists what the grant reaches, and a pick commits it through the PAL", async () => {
    const cfSelectAccount = mock(async () => {});
    installMockPlatform({
      cfAccounts: async () => ACCOUNTS,
      cfSelectAccount,
    });
    const announced = mock(() => {});
    onCredentialsChanged(announced);

    const choice = openCfAccountPicker();
    await flush(3);
    expect(row("acc-1")?.textContent).toContain("Personal");
    // The id is shown beside the name: two accounts can share a name, and the id is what is stored.
    expect(row("acc-2")?.textContent).toContain("acc-2");

    click(row("acc-2")!.querySelector('[part="choose"]')!);
    expect(await choice).toEqual({ id: "acc-2", name: "Acme Corp" });
    expect(cfSelectAccount).toHaveBeenCalledWith({ id: "acc-2", name: "Acme Corp" });
    // A chosen account is a credential change: the assistant gate and Preferences both re-read.
    expect(announced).toHaveBeenCalledTimes(1);
    await flush(2);
    expect(dialog()).toBeNull();
  });

  test("the dialog is the kit's, headline and all — nothing here draws a box", async () => {
    installMockPlatform({ cfAccounts: async () => ACCOUNTS, cfSelectAccount: async () => {} });
    const choice = openCfAccountPicker();
    await flush(3);
    /* The headline belongs to `jx-dialog`, so it is one `connectedCallback` past the mount — and
       there is no `sp-dialog-wrapper` and no `sp-underlay`, because a native `<dialog>` opened
       modally brings its own backdrop. */
    expect(dialog()?.querySelector('[part="headline"]')?.textContent).toBe(
      "Choose a Cloudflare account",
    );
    expect(d("sp-dialog-wrapper")).toBeNull();
    expect(d("sp-underlay")).toBeNull();
    dismiss();
    expect(await choice).toBeNull();
  });

  test("dismissing resolves null — nothing was chosen and nothing was stored", async () => {
    const cfSelectAccount = mock(async () => {});
    installMockPlatform({ cfAccounts: async () => ACCOUNTS, cfSelectAccount });

    const choice = openCfAccountPicker();
    await flush(3);
    dismiss();
    expect(await choice).toBeNull();
    expect(cfSelectAccount).not.toHaveBeenCalled();
  });

  test("a failed listing says so and offers a retry that succeeds", async () => {
    let fail = true;
    installMockPlatform({
      cfAccounts: async () => {
        if (fail) {
          throw new Error("Cloudflare API: 502");
        }
        return ACCOUNTS;
      },
      cfSelectAccount: async () => {},
    });

    const choice = openCfAccountPicker();
    await flush(3);
    expect(dialog()?.textContent).toContain("Cloudflare API: 502");
    expect(row("acc-1")).toBeNull();

    fail = false;
    click(d('[part="retry"]')!);
    await flush(3);
    expect(row("acc-1")).not.toBeNull();
    // The retry belongs to the failed state alone, and that state is over.
    expect(d('[part="retry"]')).toBeNull();

    dialog()!.dispatchEvent(new Event("close", { bubbles: true }));
    expect(await choice).toBeNull();
  });

  test("a grant that reaches nothing is said out loud rather than shown as an empty list", async () => {
    installMockPlatform({ cfAccounts: async () => [], cfSelectAccount: async () => {} });
    const choice = openCfAccountPicker();
    await flush(3);
    expect(dialog()?.textContent).toContain("reaches no accounts");
    /* No retry here, and that is the whole reason "reaches nothing" and "could not be reached" are
       two states: asking again is not what would give this login an account. */
    expect(d('[part="retry"]')).toBeNull();
    dismiss();
    expect(await choice).toBeNull();
  });

  test("a refused commit keeps the dialog up with the reason", async () => {
    installMockPlatform({
      cfAccounts: async () => ACCOUNTS,
      cfSelectAccount: async () => {
        throw new Error("account is suspended");
      },
    });

    const choice = openCfAccountPicker();
    await flush(3);
    click(row("acc-1")!.querySelector('[part="choose"]')!);
    await flush(3);
    expect(d('[part="error"]')?.textContent).toContain("account is suspended");
    // The list survives: listing again is not what would fix a refused commit.
    expect(row("acc-2")).not.toBeNull();
    dismiss();
    expect(await choice).toBeNull();
  });

  test("a commit in flight says which row it is, and takes no second answer", async () => {
    let settle: () => void = () => {};
    const cfSelectAccount = mock(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    installMockPlatform({ cfAccounts: async () => ACCOUNTS, cfSelectAccount });

    const choice = openCfAccountPicker();
    await flush(3);
    click(row("acc-1")!.querySelector('[part="choose"]')!);
    await flush();
    // Its own row says so; the whole list does not go grey, but nothing else may be pressed.
    expect(row("acc-1")?.querySelector('[part="choose"]')?.textContent).toBe("Selecting…");
    expect(row("acc-2")?.querySelector('[part="choose"]')?.textContent).toBe("Use this account");
    click(row("acc-2")!.querySelector('[part="choose"]')!);
    await flush();
    expect(cfSelectAccount).toHaveBeenCalledTimes(1);

    settle();
    expect(await choice).toEqual({ id: "acc-1", name: "Personal" });
  });

  test("a platform that brokers nothing resolves null without opening anything", async () => {
    /* Desktop and the dev server hold a pasted API token and a local account field. Opening a
       picker over a PAL that cannot answer it would be a dialog with one honest state: empty. */
    installMockPlatform();
    expect(await openCfAccountPicker()).toBeNull();
    expect(dialog()).toBeNull();
  });
});
