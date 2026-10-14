/**
 * Pages-service: Cloudflare Pages publish domain logic over the PAL cfApi passthrough — project
 * lookup/create, deployment mapping, and the build.deploy + wrangler.jsonc persistence.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { isFunction, isJsonObject } from "@jxsuite/schema/guards";
import type { DeployConfig, JsonObject, JsonValue } from "@jxsuite/schema/types";
import type { StudioPlatform } from "../src/types";

const {
  connectDeploy,
  createPagesProject,
  getPagesProject,
  latestDeployment,
  listAccounts,
  platformSupportsPublish,
  writeDeployConfig,
} = await import("../src/publish/pages-service");

const DEPLOY = {
  provider: "cloudflare-pages",
  accountId: "a".repeat(32),
  projectName: "my-site",
} satisfies DeployConfig;

/** What a `cfApi` request carries besides its path. */
interface CfInit {
  method?: string;
  body?: unknown;
}

interface CfCall {
  path: string;
  init?: CfInit;
}

/** A route's answer: the JSON `result` to resolve with, or an Error to reject with. */
type CfAnswer = JsonValue | Error;

/** Install a mock platform whose cfApi answers from a path-keyed table. */
function withCfApi(
  routes: Record<string, CfAnswer | ((init?: CfInit) => CfAnswer)>,
  overrides: Partial<StudioPlatform> = {},
) {
  const calls: CfCall[] = [];
  const cfApi = mock((path: string, init?: CfInit): Promise<JsonValue> => {
    const call: CfCall = { path };
    if (init !== undefined) {
      call.init = init;
    }
    calls.push(call);
    for (const [needle, response] of Object.entries(routes)) {
      if (path.includes(needle)) {
        const value = isFunction(response) ? response(init) : response;
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      }
    }
    return Promise.reject(new Error(`no route: ${path}`));
  });
  const { state } = installMockPlatform({ cfApi, ...overrides });
  return { calls, cfApi, state };
}

/** The body of the first POST the service sent, which is always a JSON object. */
function postBody(calls: CfCall[]): JsonObject {
  const body = calls.find((c) => c.init?.method === "POST")?.init?.body;
  if (!isJsonObject(body)) {
    throw new Error("no POST with an object body was sent");
  }
  return body;
}

/** Parse a written file as the JSON object it must be. */
function parseObject(text: string): JsonObject {
  const value: JsonValue = JSON.parse(text);
  if (!isJsonObject(value)) {
    throw new Error(`not a JSON object: ${text}`);
  }
  return value;
}

/** The `build` block of a written `project.json`. */
function buildBlock(text: string): JsonObject {
  const { build } = parseObject(text);
  if (!isJsonObject(build)) {
    throw new Error("project.json was written without a build block");
  }
  return build;
}

beforeEach(() => {
  resetStudioState({ projectConfig: { build: { adapter: "cloudflare-pages" }, name: "My Site" } });
});

describe("platformSupportsPublish", () => {
  test("mirrors the presence of cfApi", () => {
    installMockPlatform();
    expect(platformSupportsPublish()).toBe(false);
    withCfApi({});
    expect(platformSupportsPublish()).toBe(true);
  });
});

describe("Cloudflare API wrappers", () => {
  test("listAccounts passes through", async () => {
    withCfApi({ "/accounts": [{ id: "a1", name: "Acme" }] });
    expect(await listAccounts()).toEqual([{ id: "a1", name: "Acme" }]);
  });

  /* An `action-required` refusal is offered (on a platform that can perform its actions) and still
     thrown: the publish step that asked failed, and it says so in its own words. */
  test("a refused call still fails the step that made it", async () => {
    const refusal = Object.assign(new Error("Publishing needs one more step."), {
      actions: [{ href: "https://example.test/go", id: "go", label: "Go" }],
      code: "action_required",
    });
    withCfApi({ "/accounts": refusal });
    expect(listAccounts()).rejects.toBe(refusal);
  });

  test("getPagesProject returns null when the project does not exist", async () => {
    withCfApi({ "/pages/projects/missing": new Error("404") });
    expect(await getPagesProject(DEPLOY.accountId, "missing")).toBeNull();
  });

  test("createPagesProject sends the GitHub-connected jx build config", async () => {
    const { calls } = withCfApi({
      "/pages/projects": { name: "my-site", subdomain: "my-site.pages.dev" },
    });
    await createPagesProject({
      accountId: DEPLOY.accountId,
      owner: "octocat",
      productionBranch: "main",
      projectName: "my-site",
      repo: "site",
    });
    const body = postBody(calls);
    expect(body.build_config).toEqual({ build_command: "bunx jx build", destination_dir: "dist" });
    expect(body.source).toMatchObject({
      config: { owner: "octocat", repo_name: "site" },
      type: "github",
    });
  });

  test("a project in a subfolder builds in that folder", async () => {
    const { calls } = withCfApi({
      "/pages/projects": { name: "blog", subdomain: "blog.pages.dev" },
    });
    await createPagesProject({
      accountId: DEPLOY.accountId,
      owner: "octocat",
      productionBranch: "main",
      projectName: "blog",
      repo: "mono",
      rootDir: "sites/blog",
    });
    expect(postBody(calls).build_config).toEqual({
      build_command: "bunx jx build",
      destination_dir: "dist",
      root_dir: "sites/blog",
    });
  });

  test("latestDeployment maps the newest deployment and handles none", async () => {
    withCfApi({
      "/deployments": [
        {
          id: "d1",
          url: "https://abc.my-site.pages.dev",
          environment: "production",
          latest_stage: { name: "deploy", status: "success" },
          created_on: "2026-07-06T00:00:00Z",
        },
      ],
    });
    expect(await latestDeployment(DEPLOY)).toEqual({
      id: "d1",
      url: "https://abc.my-site.pages.dev",
      environment: "production",
      stage: "deploy",
      status: "success",
      createdOn: "2026-07-06T00:00:00Z",
    });
    withCfApi({ "/deployments": [] });
    expect(await latestDeployment(DEPLOY)).toBeNull();
  });
});

describe("writeDeployConfig", () => {
  test("writes build.deploy into project.json and syncs wrangler.jsonc", async () => {
    const { state } = withCfApi({});
    await writeDeployConfig({ build: { adapter: "cloudflare-pages" }, name: "My Site" }, DEPLOY);
    const writes = state.calls.filter((c) => c[0] === "writeFile");
    const project = writes.find((c) => c[1] === "project.json");
    const wrangler = writes.find((c) => c[1] === "wrangler.jsonc");
    const build = buildBlock(String(project?.[2]));
    expect(build.deploy).toEqual(DEPLOY);
    expect(build.adapter).toBe("cloudflare-pages");
    const wranglerConfig = parseObject(String(wrangler?.[2]));
    expect(wranglerConfig.name).toBe("my-site");
    expect(wranglerConfig.pages_build_output_dir).toBe("./dist");
  });

  test("disconnecting removes the block and leaves wrangler.jsonc alone", async () => {
    const { state } = withCfApi({});
    await writeDeployConfig(
      { build: { adapter: "cloudflare-pages", deploy: DEPLOY }, name: "My Site" },
      null,
    );
    const writes = state.calls.filter((c) => c[0] === "writeFile");
    expect(writes.some((c) => c[1] === "wrangler.jsonc")).toBe(false);
    const build = buildBlock(String(writes[0]?.[2]));
    expect(build.deploy).toBeUndefined();
    expect(build.adapter).toBe("cloudflare-pages");
  });
});

describe("connectDeploy", () => {
  const OPTS = {
    accountId: DEPLOY.accountId,
    owner: "octocat",
    productionBranch: "main",
    projectName: "my-site",
    repo: "site",
  };

  test("reuses an existing Pages project without creating", async () => {
    const { calls } = withCfApi({
      "/pages/projects/my-site": { name: "my-site", subdomain: "my-site.pages.dev" },
    });
    const deploy = await connectDeploy({ build: {}, name: "My Site" }, OPTS);
    expect(deploy.productionUrl).toBe("https://my-site.pages.dev");
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });

  test("creates the project when missing", async () => {
    const { calls } = withCfApi({
      "/pages/projects/my-site": new Error("404"),
      "/pages/projects": (init?: { method?: string }) =>
        init?.method === "POST" ? { name: "my-site" } : new Error("404"),
    });
    const deploy = await connectDeploy({ build: {}, name: "My Site" }, OPTS);
    expect(deploy).toEqual({
      provider: "cloudflare-pages",
      accountId: DEPLOY.accountId,
      projectName: "my-site",
    });
    expect(calls.some((c) => c.init?.method === "POST")).toBe(true);
  });
});
