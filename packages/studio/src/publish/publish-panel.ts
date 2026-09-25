/// <reference lib="dom" />
/**
 * Publish panel — the one-click Cloudflare Pages publish flow, driven by the PAL's cf* members.
 * States: unsupported platform → info; no credential → connect (hosted OAuth via cfConnect, or an
 * API-token form backed by cf-settings); connected without `build.deploy` → create-and-connect
 * form; connected → deployment status (publishing rides every commit).
 *
 * This module is the FLOW. The panel it draws into is `surfaces/publish.json`, a `jx-dialog`
 * mounted by `surfaces/publish.ts`: the markup, the eight bodies, the ARIA and the styling are the
 * document's, and everything below decides what is true. The template it replaced re-rendered its
 * whole body into the modal slot on every landing, which is what made a five-field form over a
 * mutable `_form` record the surface's only state; the scope holds it now, and a listing that
 * arrives late changes only what it names.
 *
 * **The token was in the DOM, on every open.** `credentialTpl` rendered `value=${getCfToken()}`
 * into an `sp-textfield` whenever a token was stored and the platform had no hosted broker — a
 * control the reader had not asked to edit, on a surface `scripts/screenshots` photographs.
 * `type="password"` masks pixels and nothing else: the value is in the attribute, in the serialized
 * HTML, in the accessibility tree and in every DOM dump. It is gone, and the document is now the
 * thing that makes it impossible rather than the thing that remembers not to — the field binds no
 * `value` at all, and the draft lives in the adapter's closure until {@link saveToken} reads it. A
 * stored token is reported as *stored*, the field is only ever drawn for a REPLACEMENT the reader
 * asked for, and revoking lives where every other credential's does — Preferences › Accounts
 * (`studio.md` §15 rule 1: a surface never prints the secret it describes).
 *
 * @docs studio/publish/cloudflare
 * @license MIT
 */

import type { DeployConfig, ProjectConfig } from "@jxsuite/schema/types";
import { activeRegistry } from "../commands/active-registry";
import { currentDeploy, noteDeployment } from "./deploy-checklist";
import { getPlatform } from "../platform";
import { getCfToken, setCfToken } from "../services/cf-settings";
import { resetModelCache } from "../services/ai-models";
import { projectState } from "../store";
import type { CfConnection } from "../types";
import { layerHost } from "../ui/layers";
import { openPublishSurface } from "../surfaces/publish";
import type { PublishForm, PublishSurfaceHandle, PublishView } from "../surfaces/publish";
import type { CfAccount, PagesDeploymentInfo } from "./pages-service";
import {
  connectDeploy,
  latestDeployment,
  listAccounts,
  platformSupportsPublish,
  writeDeployConfig,
} from "./pages-service";

let _handle: PublishSurfaceHandle | null = null;
let _connection: CfConnection | null | "loading" = "loading";
let _accounts: CfAccount[] = [];
let _deployment: PagesDeploymentInfo | null = null;
let _error = "";
let _busy = false;
/** Whether the reader has asked to replace a token that is already stored. */
let _replacing = false;
let _form: PublishForm = { accountId: "", branch: "main", owner: "", projectName: "", repo: "" };

function currentConfig(): ProjectConfig | null {
  return (projectState?.projectConfig as ProjectConfig | undefined) ?? null;
}

function deriveSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 58) || "site"
  );
}

/**
 * Prefill owner/repo from cloud root keys ("owner/repo@branch", or the older "owner/repo"); blank
 * elsewhere. The branch is part of the key the cloud adapter reports as its `projectRoot` — without
 * the optional suffix here, the whole key failed to match and the form opened empty.
 */
function prefillRepo(): { owner: string; repo: string } {
  const root = getPlatform().projectRoot;
  const match = /^([\w.-]+)\/([\w.-]+)(?:@.+)?$/.exec(root);
  return match ? { owner: match[1]!, repo: match[2]! } : { owner: "", repo: "" };
}

/** The connected Pages project, as the surface takes it: strings, never a config object. */
function deployView(): { projectName: string; productionUrl: string } | null {
  const deploy: DeployConfig | undefined = currentDeploy();
  return deploy
    ? { productionUrl: deploy.productionUrl ?? "", projectName: deploy.projectName }
    : null;
}

/** Everything the surface needs to know, as facts. Which body they add up to is the surface's. */
function viewOf(): PublishView {
  const supported = platformSupportsPublish();
  const connection = _connection === "loading" ? null : _connection;
  return {
    accounts: _accounts.map((account) => ({ label: account.name, value: account.id })),
    busy: _busy,
    connected: connection?.connected === true,
    deploy: deployView(),
    deployment: _deployment
      ? {
          environment: _deployment.environment,
          stage: _deployment.stage,
          status: _deployment.status,
          url: _deployment.url,
        }
      : null,
    error: _error,
    form: { ..._form },
    // Asked only of a host that answered `true` above, which is the one that is known to exist.
    hosted: supported && typeof getPlatform().cfConnect === "function",
    lapsed: connection?.connected === true && connection.needsReconnect === true,
    loading: _connection === "loading",
    replacing: _replacing,
    supported,
    tokenStored: getCfToken() !== "",
  };
}

/** Bring the panel up to date, opening it if it is not up. */
function paint(): void {
  if (_handle) {
    _handle.update(viewOf());
    return;
  }
  _handle = openPublishSurface({
    layer: layerHost("modal"),
    onClosed: close,
    onConnect: () => {
      void hostedConnect();
    },
    onDisconnect: () => {
      void disconnect();
    },
    onField: (field, value) => {
      _form = { ..._form, [field]: value };
    },
    onOpenAccounts: openAccounts,
    onRefresh: () => {
      void loadConnection();
    },
    onReplaceToken: () => {
      _replacing = true;
      _error = "";
      paint();
    },
    onSaveToken: (token) => {
      void saveToken(token);
    },
    onSubmit: () => {
      void submitConnect();
    },
    view: viewOf(),
  });
}

async function loadConnection(): Promise<void> {
  _connection = "loading";
  paint();
  try {
    _connection = (await getPlatform().cfConnection?.()) ?? null;
    /*
     * A lapsed brokered connection is `connected: true`, and asking Cloudflare anything through one
     * is a guaranteed 401. Every such call landed in the catch below, which nulled the connection —
     * so the panel showed the FIRST-TIME "Connect Cloudflare" invitation next to a raw
     * "Cloudflare API: …" string, and never the one sentence that was true: it expired.
     */
    if (_connection?.connected && !_connection.needsReconnect) {
      _accounts = await listAccounts();
      _form = { ..._form, accountId: _connection.accountId ?? _accounts[0]?.id ?? "" };
      const deploy = currentDeploy();
      if (deploy) {
        _deployment = await latestDeployment(deploy);
        // We ASKED, so the deploy checklist may stop saying "unknown" — including when the answer
        // Was "none", which is a fact and not an absence of one.
        noteDeployment(_deployment);
      }
    }
  } catch (error) {
    _connection = null;
    _error = error instanceof Error ? error.message : String(error);
  }
  paint();
}

/**
 * Take the token the reader typed straight to storage.
 *
 * It arrives as an argument and is never written back, which is the whole asymmetry: a secret may
 * pass through a field the user typed it into, and may not be painted into one they did not.
 */
async function saveToken(token: string): Promise<void> {
  const value = token.trim();
  if (!value) {
    _error = "Paste a token, or use Preferences › Accounts to forget the stored one.";
    paint();
    return;
  }
  setCfToken(value);
  _replacing = false;
  _error = "";
  await loadConnection();
}

/** Open Preferences on Accounts — the one place a credential is listed and forgotten. */
function openAccounts(): void {
  void activeRegistry()?.run("app.preferences", { section: "accounts" });
}

/**
 * Run the hosted OAuth flow and act on how it ended.
 *
 * The four endings are not interchangeable, and collapsing them is what left a user staring at an
 * unchanged panel: a deadline that passed and a popup the browser turned into a full-page redirect
 * both resolved null, and both were reported as "not completed" — one of them while the document
 * was already navigating away.
 */
async function hostedConnect(): Promise<void> {
  _busy = true;
  _error = "";
  paint();
  try {
    const outcome = (await getPlatform().cfConnect?.()) ?? null;
    if (outcome?.status === "timeout") {
      _error =
        "The Cloudflare window didn't finish. Sign in there, then reconnect — nothing was changed.";
    } else if (outcome?.status === "connected" && !outcome.connection.accountId) {
      /* Lazily: this module is the publish panel, and the picker drags the dialog layer with it. */
      const { openCfAccountPicker } = await import("../ui/cf-account-picker");
      await openCfAccountPicker();
    }
    /* `canceled` and `redirect` say nothing. The user closed the popup, or the page is on its way
       to Cloudflare — an apology painted over either one is noise. */
  } catch (error) {
    _error = error instanceof Error ? error.message : String(error);
  }
  _busy = false;
  // The assistant's gate reads the same grant through /models, so a reconnect it does not hear
  // About leaves it insisting the connection is dead.
  resetModelCache();
  await loadConnection();
}

async function submitConnect(): Promise<void> {
  const config = currentConfig();
  if (!config) {
    return;
  }
  if (!_form.projectName || !_form.owner || !_form.repo || !_form.accountId) {
    _error = "Account, project name, and the GitHub owner/repo are all required.";
    paint();
    return;
  }
  _busy = true;
  _error = "";
  paint();
  try {
    const deploy = await connectDeploy(config, {
      accountId: _form.accountId,
      owner: _form.owner,
      productionBranch: _form.branch || "main",
      projectName: _form.projectName,
      repo: _form.repo,
    });
    _deployment = await latestDeployment(deploy).catch(() => null);
  } catch (error) {
    _error = error instanceof Error ? error.message : String(error);
  }
  _busy = false;
  paint();
}

async function disconnect(): Promise<void> {
  const config = currentConfig();
  if (!config) {
    return;
  }
  _busy = true;
  paint();
  try {
    await writeDeployConfig(config, null);
    _deployment = null;
  } catch (error) {
    _error = error instanceof Error ? error.message : String(error);
  }
  _busy = false;
  paint();
}

/**
 * Take the panel down.
 *
 * The handle is dropped BEFORE it is closed, because closing provokes the platform's own `close`
 * event, which the document hands back as `onClosed` — which is this function. Nulling first is
 * what makes the second pass a no-op rather than a loop.
 */
function close(): void {
  const handle = _handle;
  _handle = null;
  handle?.close();
}

/**
 * Automation-only seam (scripts/screenshots): open the panel directly in its connected state with a
 * canned deployment, bypassing {@link loadConnection} so no Cloudflare request ever fires. The
 * active project's `build.deploy` block still supplies the connected project/URL line.
 */
export function seedPublishConnected(options: {
  accountId?: string;
  deployment: PagesDeploymentInfo;
}): void {
  _connection = { accountId: options.accountId ?? "demo-account", connected: true };
  _accounts = [];
  _deployment = options.deployment;
  noteDeployment(options.deployment);
  _error = "";
  _busy = false;
  _replacing = false;
  paint();
}

/** Open the publish panel for the active project. */
export function openPublishPanel(): void {
  const config = currentConfig();
  const { owner, repo } = prefillRepo();
  _connection = "loading";
  _accounts = [];
  _deployment = null;
  _error = "";
  _busy = false;
  _replacing = false;
  _form = {
    accountId: "",
    branch: "main",
    owner,
    projectName: currentDeploy()?.projectName ?? deriveSlug(config?.name ?? ""),
    repo,
  };
  paint();
  void loadConnection();
}
