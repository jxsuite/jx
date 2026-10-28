/**
 * Studio-api-mocked-gaps.test.ts — error-path coverage for handleStudioApi routes whose failures
 * cannot be provoked through the filesystem: the starter listing, the package-operation helpers,
 * and the post-rename refactor pass. Package add/remove are mocked rather than run, because a real
 * operation would reach the registry; the operations themselves are tested in
 * packages-arborist.test.ts against a fixture registry. Each dependency is mocked to throw; the
 * routes must translate the failure into their documented error responses.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JsonValue } from "@jxsuite/schema/types";
import type { PackageOpResult } from "@jxsuite/protocol";

void mock.module("@jxsuite/starters", () => ({
  listStarters: () => {
    throw new Error("starter registry exploded");
  },
}));

/** What the mocked add/remove answer, and the calls they received. */
let opResult: PackageOpResult = { ok: true };
const opCalls: (string | boolean)[][] = [];

void mock.module("../src/packages.ts", () => ({
  addPackage: (dir: string, name: string, dev: boolean) => {
    opCalls.push(["add", dir, name, dev]);
    return Promise.resolve(opResult);
  },
  dependenciesNeedInstall: () => false,
  removePackage: (dir: string, name: string) => {
    opCalls.push(["remove", dir, name]);
    return Promise.resolve(opResult);
  },
  installDependencies: () => Promise.reject(new Error("install exploded")),
  packageVersions: () => Promise.reject(new Error("versions exploded")),
  setPackageVersions: () => Promise.reject(new Error("set-versions exploded")),
}));

void mock.module("../src/refactor/apply.ts", () => ({
  applyRename: () => Promise.reject(new Error("refactor exploded")),
}));

const { handleStudioApi } = await import("../src/studio-api.ts");

const ROOT = resolve(import.meta.dir, "_studio_mocked_gaps_fixtures");

async function callApi(req: Request, url: URL) {
  const res = await handleStudioApi(req, url, ROOT, null);
  if (!res) {
    throw new Error("handleStudioApi returned null");
  }
  return res;
}

function getReq(pathAndQuery: string) {
  const url = new URL(`http://localhost${pathAndQuery}`);
  return { req: new Request(url, { method: "GET" }), url };
}

function jsonReq(path: string, method: string, body: JsonValue) {
  const url = new URL(`http://localhost${path}`);
  return { req: new Request(url, { body: JSON.stringify(body), method }), url };
}

beforeAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(ROOT, "widget.json"), JSON.stringify({ tagName: "my-widget" }));
});

afterAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
});

describe("starters — listing failure", () => {
  test("returns 500 when the starter registry throws", async () => {
    const { req, url } = getReq("/__studio/starters");
    const res = await callApi(req, url);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("starter registry exploded"),
    });
  });
});

describe("package operations — helper failures", () => {
  test("install tolerates a missing body and returns 500 when the helper rejects", async () => {
    // No JSON body at all: the route's json().catch fallback kicks in before the helper rejects.
    const url = new URL("http://localhost/__studio/packages/install");
    const res = await callApi(new Request(url, { method: "POST" }), url);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("install exploded") });
  });

  test("versions returns 500 when packageVersions rejects", async () => {
    const { req, url } = getReq("/__studio/packages/versions");
    const res = await callApi(req, url);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("versions exploded") });
  });

  test("set-versions returns 500 when setPackageVersions rejects", async () => {
    const { req, url } = jsonReq("/__studio/packages/set-versions", "POST", {
      updates: [{ name: "x", version: "1.0.0" }],
    });
    const res = await callApi(req, url);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("set-versions exploded"),
    });
  });
});

describe("rename — refactor pass failure", () => {
  test("a failed refactor pass is reported but never fails the completed move", async () => {
    const { req, url } = jsonReq("/__studio/file/rename", "POST", {
      from: "widget.json",
      to: "gadget.json",
    });
    const res = await callApi(req, url);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("refactor exploded"),
      from: "widget.json",
      ok: true,
      to: "gadget.json",
    });
  });
});

describe("packages add/remove run the shared operations", () => {
  test("add passes the project, the spec and the dev flag, and answers ok", async () => {
    opResult = { ok: true };
    const { req, url } = jsonReq("/__studio/packages/add", "POST", {
      dev: true,
      dir: "sub",
      name: "alpha@^1",
    });
    const res = await callApi(req, url);
    expect(res.status).toBe(200);
    expect(opCalls.at(-1)).toEqual(["add", join(ROOT, "sub"), "alpha@^1", true]);
  });

  test("add answers 500 with the operation's log when it fails", async () => {
    opResult = { log: "The registry answered 404", ok: false };
    const { req, url } = jsonReq("/__studio/packages/add", "POST", { name: "nope" });
    const res = await callApi(req, url);
    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error).toBe("The registry answered 404");
  });

  test("a failure with no log still says what failed", async () => {
    opResult = { ok: false };
    const add = jsonReq("/__studio/packages/add", "POST", { name: "nope" });
    const addRes = await callApi(add.req, add.url);
    const addBody = await addRes.json();
    expect(addBody.error).toBe("Adding the package failed");
    const remove = jsonReq("/__studio/packages/remove", "POST", { name: "nope" });
    const removeRes = await callApi(remove.req, remove.url);
    const removeBody = await removeRes.json();
    expect(removeBody.error).toBe("Removing the package failed");
  });

  test("remove passes the project and the name, and reports a failure's log", async () => {
    opResult = { ok: true };
    const ok = jsonReq("/__studio/packages/remove", "POST", { dir: ROOT, name: "alpha" });
    const okRes = await callApi(ok.req, ok.url);
    expect(okRes.status).toBe(200);
    expect(opCalls.at(-1)).toEqual(["remove", ROOT, "alpha"]);
    opResult = { log: "ENOENT", ok: false };
    const failed = jsonReq("/__studio/packages/remove", "POST", { name: "alpha" });
    const res = await callApi(failed.req, failed.url);
    expect(res.status).toBe(500);
  });
});
