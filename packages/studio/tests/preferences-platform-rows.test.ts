/**
 * Preferences › Accounts: the rows a platform adds (desktop.md §10.4).
 *
 * They exist only where the platform sends some, after Studio's own three, in the platform's words.
 * Their verbs are the actions the platform offers with them, and a row's id is namespaced so a
 * platform cannot shadow one of Studio's own.
 *
 * The action flow is doubled: it opens a window, and what this row owes it is a call.
 */
import "./with-dom.js";
import { installMockPlatform } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AccountEntry, OfferedAction } from "../src/types";

const ran: OfferedAction[] = [];
void mock.module("../src/account/action-flow", () => ({
  runOfferedAction: async (action: OfferedAction) => {
    ran.push(action);
    return true;
  },
}));

const { hydrateAccountStatus, resetAccountStatus } = await import("../src/account-status");
const { listAccounts, revokeAccount } = await import("../src/settings/preferences-accounts");

const JOIN: OfferedAction = {
  href: "https://example.test/join",
  id: "join",
  label: "Join",
  primary: true,
};
const LEAVE: OfferedAction = { href: "https://example.test/leave", id: "leave", label: "Leave" };

async function withEntries(entries?: AccountEntry[]): Promise<void> {
  installMockPlatform({
    getAccountStatus: async () => ({ installations: [], ...(entries ? { entries } : {}) }),
  });
  await hydrateAccountStatus();
}

beforeEach(() => {
  resetAccountStatus();
  ran.length = 0;
});

describe("the platform's rows", () => {
  test("are absent where the platform sends none", async () => {
    await withEntries();
    expect(listAccounts().map((account) => account.id)).toEqual(["github", "ai", "cloudflare"]);
  });

  test("follow Studio's own, namespaced, in the platform's words", async () => {
    await withEntries([
      {
        actions: [JOIN, LEAVE],
        connected: true,
        detail: "Member since spring.",
        id: "team",
        label: "Team",
      },
      { detail: "Read-only.", id: "github", label: "Role" },
    ]);
    const rows = listAccounts();
    expect(rows.map((account) => account.id)).toEqual([
      "github",
      "ai",
      "cloudflare",
      "platform:team",
      "platform:github",
    ]);
    const team = rows[3]!;
    expect(team).toMatchObject({ connected: true, detail: "Member since spring.", label: "Team" });
    expect(team.actions?.map((action) => [action.id, action.label, action.variant])).toEqual([
      ["join", "Join", "accent"],
      ["leave", "Leave", undefined],
    ]);
    // Not connected unless the platform says so, and no verbs it did not offer.
    expect(rows[4]).toMatchObject({ actions: [], connected: false });
  });

  test("a row's verb runs the offered action; revoking it forgets nothing", async () => {
    await withEntries([{ actions: [LEAVE], detail: "Member.", id: "team", label: "Team" }]);
    const team = listAccounts().find((account) => account.id === "platform:team")!;
    await team.actions?.[0]?.run();
    expect(ran).toEqual([LEAVE]);
    expect(revokeAccount("platform:team")).toBe(true);
    expect(listAccounts().some((account) => account.id === "platform:team")).toBe(true);
  });
});
