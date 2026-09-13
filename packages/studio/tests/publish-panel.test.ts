/**
 * Publish panel tests — `src/publish/publish-panel.ts` (the flow) and `src/surfaces/publish.json`
 * (the `jx-dialog` it draws into): the unsupported platform, credential collection (token form vs
 * hosted connect), the lapsed connection, the create-and-connect form with validation, the
 * connected status view with refresh/disconnect, and the Pages-GitHub-App error hint.
 *
 * Everything is addressed by `part` and by the surface's region, because the panel is a document:
 * there is no `.publish-modal` to find any more and no `.publish-error` either — the card, the
 * backdrop, Escape, focus restoration and the Close button all belong to `jx-dialog`. It still
 * lives in the MODAL layer, where the panel has always been: `overlayRegion` maps both the modal
 * and dialog layers onto the same `overlay.dialog` instance, so the region the screenshot manifest
 * names is unchanged.
 */
import { flush, installMockPlatform, resetStudioState, mountOverlayLayers } from "./harness";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { DeployConfig } from "@jxsuite/schema/types";
import type { CfConnectOutcome } from "../src/types";

/**
 * The account picker is doubled: `hostedConnect` reaches it through a lazy `import()`, so the
 * double is both the witness that it opened and what keeps two real dynamic imports from
 * overlapping (which is how Bun 1.4 loses a file's coverage record).
 */
let pickerOpens = 0;
void mock.module("../src/ui/cf-account-picker", () => ({
  openCfAccountPicker: async () => {
    pickerOpens += 1;
    return { id: "acc-picked", name: "Picked" };
  },
}));

const { openPublishPanel, seedPublishConnected } = await import("../src/publish/publish-panel");
const { initLayers } = await import("../src/ui/layers");
const { clearCfConnection, setCfToken } = await import("../src/services/cf-settings");

mountOverlayLayers(document.body);
initLayers();

const DEPLOY: DeployConfig = {
  provider: "cloudflare-pages",
  accountId: "a".repeat(32),
  projectName: "my-site",
  productionUrl: "https://my-site.pages.dev",
};

/** The panel's root — the surface's own element, in the modal layer. */
function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#layer-modal jx-dialog[part="publish"]');
}

function part<T extends Element = HTMLElement>(name: string): T | null {
  return (panel()?.querySelector(`[part="${name}"]`) ?? null) as T | null;
}

function bodyText(): string {
  return panel()?.textContent?.replaceAll(/\s+/g, " ") ?? "";
}

/** `jx-button` draws the native control, and `disabled` is what that control carries. */
function control(name: string): HTMLButtonElement | null {
  return part<HTMLButtonElement>(name)?.querySelector('[part="control"]') ?? null;
}

function click(name: string): void {
  const button = part(name);
  expect(button).toBeTruthy();
  button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** Type into a field the way a reader does: the native control inside the kit element. */
function type(name: string, value: string): void {
  const input = part<HTMLInputElement>(name)?.querySelector<HTMLInputElement>('[part="input"]');
  expect(input).toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Pick an account from the native `<select>` the kit draws, which is what a reader moves. */
function pickAccount(value: string): void {
  const select = part<HTMLSelectElement>("account")?.querySelector<HTMLSelectElement>("select");
  expect(select).toBeTruthy();
  select!.value = value;
  select!.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Dismiss it the way a reader would: the platform's `cancel`, which is what Escape raises on a
 * native `<dialog>` and what the kit's own Close button dispatches. A no-op with nothing up.
 */
function closePanel(): void {
  panel()?.dispatchEvent(new Event("cancel", { bubbles: true }));
}

/** Marker for routes that should reject (keeps the Error-throw lint rules happy). */
interface ErrorRoute {
  __error: string;
}

function isErrorRoute(value: unknown): value is ErrorRoute {
  return typeof value === "object" && value !== null && "__error" in value;
}

/** CfApi answering from a path-keyed table; ErrorRoute values are rejected. */
function cfApiMock(routes: Record<string, unknown>) {
  // Longest needle wins: "/deployments" paths also contain "/accounts".
  const entries = Object.entries(routes).toSorted((a, b) => b[0].length - a[0].length);
  return mock(async (path: string) => {
    for (const [needle, response] of entries) {
      if (path.includes(needle)) {
        if (isErrorRoute(response)) {
          throw new Error(response.__error);
        }
        return response;
      }
    }
    throw new Error(`no route: ${path}`);
  });
}

afterEach(() => {
  closePanel();
  // Blank no longer clears — forgetting the connection is its own verb.
  clearCfConnection();
});

describe("openPublishPanel — platform capability states", () => {
  test("explains the git-push path when the platform lacks cfApi", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    installMockPlatform();
    openPublishPanel();
    await flush();
    expect(bodyText()).toContain("cannot reach the Cloudflare API");
  });

  /* The region the screenshot manifest names, on the one element here that HAS a box: `jx-dialog`
     is `display: contents` and the slot wraps a `<dialog>` the top layer takes out of flow, so a
     stamp on either would measure 0×0 and the capture would be refused. */
  test("carries the publish region on the platform's own dialog box", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    installMockPlatform();
    openPublishPanel();
    await flush();
    const stamped = document.querySelector('[data-jx-region="overlay.dialog:publish"]');
    expect(stamped).toBeTruthy();
    expect(stamped!.tagName.toLowerCase()).toBe("dialog");
    expect(stamped!.getAttribute("part")).toBe("dialog");
  });

  test("shows the token form when no credential is stored", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    installMockPlatform({
      cfApi: cfApiMock({}),
      cfConnection: () => Promise.resolve(null),
    });
    openPublishPanel();
    await flush();
    expect(bodyText()).toContain("Paste a Cloudflare API token");
    expect(part("token")).toBeTruthy();
  });

  test("offers hosted connect and re-checks the connection after it", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    let connected = false;
    installMockPlatform({
      cfApi: cfApiMock({ "/accounts": [{ id: "a".repeat(32), name: "Acme" }] }),
      cfConnect: () => {
        connected = true;
        return Promise.resolve({
          connection: { accountId: "a".repeat(32), connected: true },
          status: "connected" as const,
        });
      },
      cfConnection: () =>
        Promise.resolve(connected ? { accountId: "a".repeat(32), connected: true } : null),
    });
    openPublishPanel();
    await flush();
    expect(part("connect")).toBeTruthy();
    click("connect");
    await flush();
    expect(connected).toBe(true);
    expect(bodyText()).toContain("Create a Cloudflare Pages project");
  });

  test("verifies a pasted token and advances to the connect form", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    const { getCfToken } = await import("../src/services/cf-settings");
    installMockPlatform({
      cfApi: cfApiMock({ "/accounts": [{ id: "a".repeat(32), name: "Acme" }] }),
      cfConnection: () =>
        Promise.resolve(getCfToken() ? { accountId: "a".repeat(32), connected: true } : null),
    });
    openPublishPanel();
    await flush();
    type("token", "cf_pasted");
    click("verify");
    await flush();
    expect(getCfToken()).toBe("cf_pasted");
    expect(bodyText()).toContain("Create a Cloudflare Pages project");
  });
});

/**
 * A lapsed brokered connection, which the panel had no branch for at all.
 *
 * It arrives as `connected: true`, so `loadConnection` called straight through to `/accounts`, the
 * proxy 401'd, the catch nulled the connection — and the reader got the FIRST-TIME "Connect your
 * Cloudflare account to publish this site" invitation next to a raw `Cloudflare API: …` string. Two
 * wrong sentences where one true one belonged.
 */
describe("openPublishPanel — an expired connection", () => {
  function installLapsed(onConnect?: () => Promise<CfConnectOutcome>) {
    let lapsed = true;
    // Exactly what the proxy does through a lapsed grant, and what it does once it is renewed.
    const cfApi = mock(async () => {
      if (lapsed) {
        throw new Error("Cloudflare API: 401 Unauthorized");
      }
      return [{ id: "a".repeat(32), name: "Acme" }];
    });
    installMockPlatform({
      cfApi,
      cfConnect: onConnect
        ? async () => onConnect()
        : async () => {
            lapsed = false;
            return {
              connection: { accountId: "a".repeat(32), connected: true },
              status: "connected" as const,
            };
          },
      cfConnection: () =>
        Promise.resolve(
          lapsed
            ? { code: "cf_reconnect_required" as const, connected: true, needsReconnect: true }
            : { accountId: "a".repeat(32), accountName: "Acme", connected: true },
        ),
    });
    return cfApi;
  }

  test("says the connection expired, and does not ask Cloudflare anything through it", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    const cfApi = installLapsed();
    openPublishPanel();
    await flush();
    expect(bodyText()).toContain("connection has expired");
    expect(bodyText()).not.toContain("Connect your Cloudflare account");
    // The 401 that produced the raw error string is not even attempted.
    expect(cfApi).not.toHaveBeenCalled();
    expect(bodyText()).not.toContain("Cloudflare API:");
    expect(part("reconnect")?.textContent).toContain("Reconnect Cloudflare");
  });

  test("Reconnect runs the hosted flow and the panel moves on", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    installLapsed();
    openPublishPanel();
    await flush();
    click("reconnect");
    await flush();
    expect(bodyText()).toContain("Create a Cloudflare Pages project");
  });

  test("a deadline that passed is reported; a cancellation is not", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    let outcome: CfConnectOutcome = { status: "timeout" };
    installLapsed(async () => outcome);
    openPublishPanel();
    await flush();
    click("reconnect");
    await flush();
    expect(bodyText()).toContain("didn't finish");

    // A closed popup says nothing — and clears the deadline message, which no longer applies.
    outcome = { status: "canceled" };
    click("reconnect");
    await flush();
    expect(bodyText()).not.toContain("didn't finish");
    expect(part("failure")).toBeNull();
  });

  test("a connect with no account chosen opens the picker before the form", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    pickerOpens = 0;
    let chosen = false;
    installMockPlatform({
      cfApi: cfApiMock({ "/accounts": [{ id: "a".repeat(32), name: "Acme" }] }),
      cfConnect: async () => {
        chosen = true;
        return { connection: { connected: true }, status: "connected" as const };
      },
      cfConnection: () =>
        Promise.resolve(
          chosen ? { accountId: "a".repeat(32), accountName: "Acme", connected: true } : null,
        ),
    });
    openPublishPanel();
    await flush();
    click("connect");
    await flush();
    expect(pickerOpens).toBe(1);
    expect(bodyText()).toContain("Create a Cloudflare Pages project");
  });
});

describe("openPublishPanel — connect form", () => {
  function installConnected(routes: Record<string, unknown> = {}) {
    installMockPlatform({
      cfApi: cfApiMock({
        "/accounts": [{ id: DEPLOY.accountId, name: "Acme" }],
        ...routes,
      }),
      cfConnection: () =>
        Promise.resolve({ accountId: DEPLOY.accountId, accountName: "Acme", connected: true }),
    });
  }

  /** What a field is showing, from the control the reader would read it off. */
  function fieldValue(name: string): string {
    return (
      part<HTMLInputElement>(name)?.querySelector<HTMLInputElement>('[part="input"]')?.value ?? ""
    );
  }

  test("prefills the project name slug and validates required fields", async () => {
    resetStudioState({ projectConfig: { build: {}, name: "My Site" } });
    installConnected();
    openPublishPanel();
    await flush();
    expect(fieldValue("project-name")).toBe("my-site");
    // Owner/repo are blank on non-cloud roots → validation error on submit.
    click("submit");
    await flush();
    expect(bodyText()).toContain("owner/repo are all required");
    expect(part("failure")).toBeTruthy();
  });

  /* The cloud adapter's projectRoot is the root key "owner/repo@branch". A prefill that only
     matched the branchless form left both fields empty on the one host that can fill them. */
  test("prefills owner and repo from a cloud root key", async () => {
    resetStudioState({ projectConfig: { build: {}, name: "My Site" } });
    installMockPlatform({
      cfApi: cfApiMock({ "/accounts": [{ id: DEPLOY.accountId, name: "Acme" }] }),
      cfConnection: () =>
        Promise.resolve({ accountId: DEPLOY.accountId, accountName: "Acme", connected: true }),
      projectRoot: "octocat/site@main",
    });
    openPublishPanel();
    await flush();
    expect(fieldValue("owner")).toBe("octocat");
    expect(fieldValue("repo")).toBe("site");
  });

  test("every row is a named field, so a control is reachable by what it collects", async () => {
    resetStudioState({ projectConfig: { build: {}, name: "My Site" } });
    installConnected();
    openPublishPanel();
    await flush();
    const fields = [...(panel()?.querySelectorAll<HTMLElement>('[part="row"]') ?? [])].map(
      (row) => row.dataset["field"],
    );
    expect(fields).toEqual(["account", "projectName", "owner", "repo", "branch"]);
  });

  test("connects end-to-end and lands on the status view", async () => {
    resetStudioState({ projectConfig: { build: {}, name: "My Site" } });
    installMockPlatform({
      cfApi: cfApiMock({
        "/accounts": [{ id: DEPLOY.accountId, name: "Acme" }],
        "/pages/projects/my-site": { name: "my-site", subdomain: "my-site.pages.dev" },
        "/deployments": [],
      }),
      cfConnection: () =>
        Promise.resolve({ accountId: DEPLOY.accountId, accountName: "Acme", connected: true }),
    });
    openPublishPanel();
    await flush();
    // Drive every field handler (owner/repo empty on non-cloud roots).
    type("project-name", "my-site");
    type("owner", "octocat");
    type("repo", "site");
    type("branch", "main");
    pickAccount("a".repeat(32));
    click("submit");
    await flush();
    expect(bodyText()).toContain("Connected to Pages project");
    expect(part("project-name")?.textContent).toBe("my-site");
  });

  test("suggests installing the Pages GitHub App on the characteristic failure", async () => {
    resetStudioState({ projectConfig: { build: {}, name: "My Site" } });
    installMockPlatform({
      cfApi: cfApiMock({
        "/accounts": [{ id: DEPLOY.accountId, name: "Acme" }],
        "/pages/projects": { __error: "GitHub app is not installed on this repo source" },
      }),
      cfConnection: () =>
        Promise.resolve({ accountId: DEPLOY.accountId, accountName: "Acme", connected: true }),
      projectRoot: "octocat/site",
    });
    openPublishPanel();
    await flush();
    click("submit");
    await flush();
    expect(bodyText()).toContain("GitHub app is not installed");
    expect(part<HTMLAnchorElement>("install-link")?.href).toContain(
      "cloudflare-pages/installations",
    );
  });
});

describe("seedPublishConnected — automation seam", () => {
  test("opens the connected status view without touching the Cloudflare API", async () => {
    resetStudioState({
      projectConfig: { build: { adapter: "cloudflare-pages", deploy: DEPLOY }, name: "My Site" },
    });
    const cfConnection = mock(() => Promise.resolve(null));
    const cfApi = cfApiMock({});
    installMockPlatform({ cfApi, cfConnection });
    seedPublishConnected({
      deployment: {
        createdOn: "2026-07-06T00:00:00Z",
        environment: "production",
        id: "d1",
        stage: "deploy",
        status: "success",
        url: "https://main.my-site.pages.dev",
      },
    });
    await flush();
    expect(bodyText()).toContain("Connected to Pages project");
    expect(part("project-name")?.textContent).toBe("my-site");
    expect(part("deployment-state")?.textContent).toBe("deploy: success");
    // The seam bypasses loadConnection entirely — no Cloudflare traffic.
    expect(cfConnection).not.toHaveBeenCalled();
    expect(cfApi).not.toHaveBeenCalled();
  });
});

describe("openPublishPanel — the token is not in the DOM", () => {
  /** Everything the rendered panel could be carrying the secret in. */
  function serializedPanel(): string {
    const host = document.querySelector("#layer-modal");
    const attributes = [...(host?.querySelectorAll("*") ?? [])].flatMap((el) =>
      [...el.attributes].map((attr) => attr.value),
    );
    const values = [...(host?.querySelectorAll("input") ?? [])].map(
      (el) => (el as HTMLInputElement).value ?? "",
    );
    return [host?.innerHTML ?? "", ...attributes, ...values].join("\n");
  }

  function installRejecting() {
    installMockPlatform({
      cfApi: cfApiMock({}),
      // A stored token that Cloudflare does not accept — the exact state in which the old panel
      // Rendered `value=${getCfToken()}` back at the reader.
      cfConnection: () => Promise.resolve(null),
    });
  }

  test("a stored token is reported as stored and never painted", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    setCfToken("cf_super_secret_value");
    installRejecting();
    openPublishPanel();
    await flush();
    expect(serializedPanel()).not.toContain("cf_super_secret_value");
    expect(bodyText()).toContain("A Cloudflare API token is stored on this machine");
    // And there is no field at all until one is asked for.
    expect(part("token")).toBeNull();
    expect(part("replace")).toBeTruthy();
  });

  test("Replace token opens an EMPTY field, and saving it stores what was typed", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    setCfToken("cf_old_secret");
    const { getCfToken } = await import("../src/services/cf-settings");
    installRejecting();
    openPublishPanel();
    await flush();
    click("replace");
    await flush();
    const field = part<HTMLInputElement>("token");
    expect(field).toBeTruthy();
    expect(field!.getAttribute("value")).toBeNull();
    expect(field!.querySelector<HTMLInputElement>('[part="input"]')?.value).toBe("");
    expect(serializedPanel()).not.toContain("cf_old_secret");

    type("token", "cf_new_secret");
    click("verify");
    await flush();
    expect(getCfToken()).toBe("cf_new_secret");
    // Read out of the live control on its way to storage, and the field is gone afterwards.
    expect(serializedPanel()).not.toContain("cf_new_secret");
  });

  test("an empty submission refuses instead of silently forgetting the stored token", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    setCfToken("cf_keep_me");
    const { getCfToken } = await import("../src/services/cf-settings");
    installRejecting();
    openPublishPanel();
    await flush();
    click("replace");
    await flush();
    click("verify");
    await flush();
    expect(getCfToken()).toBe("cf_keep_me");
    expect(bodyText()).toContain("Preferences › Accounts to forget the stored one");
  });

  test("revoking is a link to Preferences › Accounts, not a button here", async () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    setCfToken("cf_stored");
    installRejecting();
    const { createCommandRegistry } = await import("../src/commands/registry");
    const { emptyContext } = await import("../src/commands/context");
    const { setActiveRegistry } = await import("../src/commands/active-registry");
    const runs: { id: string; args: unknown }[] = [];
    const registry = createCommandRegistry({ getContext: emptyContext });
    registry.register({
      category: "View",
      id: "app.preferences",
      level: "application",
      run: (_ctx, args) => {
        runs.push({ args, id: "app.preferences" });
      },
      title: "Preferences…",
    });
    setActiveRegistry(registry);
    openPublishPanel();
    await flush();
    click("accounts");
    await flush();
    expect(runs).toEqual([{ args: { section: "accounts" }, id: "app.preferences" }]);
    setActiveRegistry(null);
  });
});

describe("openPublishPanel — connected status view", () => {
  test("shows the latest deployment and disconnect removes build.deploy", async () => {
    resetStudioState({
      projectConfig: { build: { adapter: "cloudflare-pages", deploy: DEPLOY }, name: "My Site" },
    });
    const { state } = installMockPlatform({
      cfApi: cfApiMock({
        "/accounts": [{ id: DEPLOY.accountId, name: "Acme" }],
        "/deployments": [
          {
            id: "d1",
            url: "https://abc.my-site.pages.dev",
            environment: "production",
            latest_stage: { name: "deploy", status: "success" },
            created_on: "2026-07-06T00:00:00Z",
          },
        ],
      }),
      cfConnection: () =>
        Promise.resolve({ accountId: DEPLOY.accountId, accountName: "Acme", connected: true }),
    });
    openPublishPanel();
    await flush();
    expect(part("deployment-state")?.textContent).toBe("deploy: success");
    expect(part("hint")?.textContent).toContain("Publishing happens automatically on every commit");
    expect(part<HTMLAnchorElement>("link")?.href).toBe("https://my-site.pages.dev/");

    click("disconnect");
    await flush();
    const writes = state.calls.filter((c) => c[0] === "writeFile" && c[1] === "project.json");
    const config = JSON.parse(String(writes.at(-1)?.[2])) as { build: Record<string, unknown> };
    expect(config.build["deploy"]).toBeUndefined();
  });

  test("a connected project with nothing shipped says so, and the buttons refuse while busy", async () => {
    resetStudioState({
      projectConfig: { build: { adapter: "cloudflare-pages", deploy: DEPLOY }, name: "My Site" },
    });
    installMockPlatform({
      cfApi: cfApiMock({
        "/accounts": [{ id: DEPLOY.accountId, name: "Acme" }],
        "/deployments": [],
      }),
      cfConnection: () =>
        Promise.resolve({ accountId: DEPLOY.accountId, accountName: "Acme", connected: true }),
    });
    openPublishPanel();
    await flush();
    expect(part("deployment")?.textContent).toContain("No deployments yet");
    expect(control("refresh")?.disabled).toBe(false);
    expect(control("disconnect")?.disabled).toBe(false);
  });
});
