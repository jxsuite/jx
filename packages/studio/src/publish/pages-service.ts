/// <reference lib="dom" />
/**
 * Pages-service — Cloudflare Pages publish domain logic over the PAL's `cfApi` passthrough. Works
 * identically on every platform that provides it: the dev server / desktop (user API token via
 * cf-settings → /__studio/cf/proxy) and the cloud platform (hosted OAuth). Publish state is written
 * to project.json `build.deploy` — it travels with the repo, so any Studio can tell whether the
 * publish workflow already exists.
 *
 * @license MIT
 */

import { updateWranglerConfig } from "@jxsuite/create/scaffold";
import { isFunction } from "@jxsuite/schema/guards";
import type { DeployConfig, ProjectConfig } from "@jxsuite/schema/types";
import type { CfAccountSummary } from "../types";
import { getPlatform } from "../platform";
import { actIfRequired } from "../account/action-flow";
import { updateSiteConfig } from "../site-context";

/* A Cloudflare account the connected token can reach is the platform's `CfAccountSummary` row;
   `CfAccount` stays this module's name for it. */
export type { CfAccountSummary as CfAccount } from "../types";

export interface PagesDeploymentInfo {
  id: string;
  url: string;
  environment: string;
  /** Latest stage name/status, e.g. "deploy: success" or "build: failure". */
  stage: string;
  status: string;
  createdOn: string;
  /**
   * The branch the deployment was built from, when Cloudflare says (its trigger metadata). A
   * preview's branch is what names it in Publish › Deploys; a production deployment usually carries
   * the production branch.
   */
  branch?: string;
}

export interface ConnectOptions {
  accountId: string;
  projectName: string;
  productionBranch: string;
  owner: string;
  repo: string;
  /**
   * The folder of the repository the project lives in, when it is not the root (a cloud project
   * opened from a subfolder). Pages builds there, so `bunx jx build` finds that project's
   * `project.json` and `dist` is that project's output.
   */
  rootDir?: string;
}

/** True when the active platform can reach the Cloudflare API. */
export function platformSupportsPublish(): boolean {
  // Answers false before a platform is registered rather than throwing. This is read by ambient
  // Surfaces — the status bar's deploy item, the Activity tab's checklist — which paint during boot
  // And in tests that register no platform, and neither has any business crashing because
  // Publishing is not available yet. "Can this host publish?" has a truthful answer before the host
  // Exists, and it is no.
  try {
    return isFunction(getPlatform().cfApi);
  } catch {
    return false;
  }
}

/**
 * One Cloudflare call. A refusal that offers an action (desktop.md §10.4) is offered here, once for
 * every publish step, and still thrown: the step that asked failed, and its caller reports that in
 * its own words while the offer says how to fix it.
 */
async function cfApi<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const api = getPlatform().cfApi;
  if (!api) {
    throw new Error("This platform cannot reach the Cloudflare API");
  }
  try {
    /* SAFETY: every adapter's cfApi resolves to the Cloudflare v4 envelope's `result`, unvalidated,
       and each caller names the shape Cloudflare documents for the endpoint it calls. */
    return (await api(path, init)) as T;
  } catch (error) {
    void actIfRequired(error);
    throw error;
  }
}

export async function listAccounts(): Promise<CfAccountSummary[]> {
  return cfApi<CfAccountSummary[]>("/accounts");
}

interface PagesProjectWire {
  name: string;
  subdomain?: string;
  domains?: string[];
}

/** The Pages project, or null when it does not exist yet. */
export async function getPagesProject(
  accountId: string,
  projectName: string,
): Promise<PagesProjectWire | null> {
  try {
    return await cfApi<PagesProjectWire>(`/accounts/${accountId}/pages/projects/${projectName}`);
  } catch {
    return null;
  }
}

/**
 * Create a GitHub-connected Pages project that builds `bunx jx build` on every push. Requires the
 * Cloudflare Pages GitHub App on the repo — the characteristic failure is surfaced to the caller
 * with an install hint.
 */
export async function createPagesProject(opts: ConnectOptions): Promise<PagesProjectWire> {
  const buildConfig: PagesBuildConfigWire = {
    build_command: "bunx jx build",
    destination_dir: "dist",
  };
  if (opts.rootDir) {
    buildConfig.root_dir = opts.rootDir;
  }
  return cfApi<PagesProjectWire>(`/accounts/${opts.accountId}/pages/projects`, {
    method: "POST",
    body: {
      name: opts.projectName,
      production_branch: opts.productionBranch,
      build_config: buildConfig,
      source: {
        type: "github",
        config: {
          owner: opts.owner,
          repo_name: opts.repo,
          production_branch: opts.productionBranch,
          deployments_enabled: true,
        },
      },
    },
  });
}

/** The `build_config` Cloudflare stores on a GitHub-connected Pages project. */
interface PagesBuildConfigWire {
  build_command: string;
  destination_dir: string;
  root_dir?: string;
}

interface DeploymentWire {
  id: string;
  url: string;
  environment: string;
  latest_stage?: { name?: string; status?: string };
  created_on: string;
  deployment_trigger?: { metadata?: { branch?: string } };
}

/** One wire row as the app reads it: the stage flattened, the branch kept only when it is said. */
function deploymentInfo(row: DeploymentWire): PagesDeploymentInfo {
  const info: PagesDeploymentInfo = {
    id: row.id,
    url: row.url,
    environment: row.environment,
    stage: row.latest_stage?.name ?? "unknown",
    status: row.latest_stage?.status ?? "unknown",
    createdOn: row.created_on,
  };
  const branch = row.deployment_trigger?.metadata?.branch;
  if (branch) {
    info.branch = branch;
  }
  return info;
}

/**
 * Every deployment of the connected project Cloudflare returns, newest first, as it orders them.
 *
 * All of them, not the latest alone: Publish › Deploys draws the history and the branch previews
 * from this one list (studio.md §22.8), and the latest is simply its first row.
 */
export async function listDeployments(deploy: DeployConfig): Promise<PagesDeploymentInfo[]> {
  const deployments = await cfApi<DeploymentWire[]>(
    `/accounts/${deploy.accountId}/pages/projects/${deploy.projectName}/deployments`,
  );
  return deployments.map((row) => deploymentInfo(row));
}

/** The most recent deployment of the connected project, or null when none. */
export async function latestDeployment(deploy: DeployConfig): Promise<PagesDeploymentInfo | null> {
  const [latest] = await listDeployments(deploy);
  return latest ?? null;
}

/**
 * Write (or with null, remove) the `build.deploy` block, preserving the rest of `build`. On
 * connect, wrangler.jsonc is patched so its `name` matches the connected Pages project
 * (comment-bearing JSONC is left alone).
 */
export async function writeDeployConfig(
  config: ProjectConfig,
  deploy: DeployConfig | null,
): Promise<void> {
  const build: NonNullable<ProjectConfig["build"]> = { ...config.build };
  if (deploy === null) {
    delete build.deploy;
  } else {
    build.deploy = deploy;
  }
  await updateSiteConfig({ build });

  if (deploy !== null) {
    const platform = getPlatform();
    let existing: string | null = null;
    try {
      existing = await platform.readFile("wrangler.jsonc");
    } catch {
      existing = null;
    }
    const adapter =
      build.adapter === "cloudflare-workers" ? "cloudflare-workers" : "cloudflare-pages";
    const { content, patched } = updateWranglerConfig(existing, {
      adapter,
      slug: deploy.projectName,
    });
    if (patched) {
      await platform.writeFile("wrangler.jsonc", content);
    }
  }
}

/**
 * The whole connect flow: reuse the Pages project when it already exists, create it otherwise, then
 * persist `build.deploy` (+ wrangler.jsonc sync).
 */
export async function connectDeploy(
  config: ProjectConfig,
  opts: ConnectOptions,
): Promise<DeployConfig> {
  const existing = await getPagesProject(opts.accountId, opts.projectName);
  const project = existing ?? (await createPagesProject(opts));
  const deploy: DeployConfig = {
    provider: "cloudflare-pages",
    accountId: opts.accountId,
    projectName: opts.projectName,
  };
  if (project.subdomain) {
    deploy.productionUrl = `https://${project.subdomain}`;
  }
  await writeDeployConfig(config, deploy);
  return deploy;
}
