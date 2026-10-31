/**
 * The cloud's package service over HTTP, against a fixture registry: it answers what the operations
 * wrote, never builds node_modules or fetches a tarball, refuses what it does not run, and leaves
 * no scratch directory behind.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePackagesRequest, startPackagesService } from "../src/packages-service.ts";
import type { ServiceReply } from "../src/packages-service.ts";
import type { JsonValue } from "@jxsuite/schema/types";
import { startRegistry } from "./_npm-registry.ts";
import type { FixtureRegistry } from "./_npm-registry.ts";

let registry: FixtureRegistry;
let cache: string;

beforeAll(async () => {
  registry = await startRegistry([
    { name: "alpha", version: "1.0.0" },
    { dependencies: { alpha: "^1.0.0" }, name: "beta", version: "2.0.0" },
  ]);
  cache = mkdtempSync(join(tmpdir(), "jx-service-cache-"));
});

afterAll(async () => {
  await registry.stop();
  rmSync(cache, { force: true, recursive: true });
});

const MANIFEST = JSON.stringify({ dependencies: {}, name: "site" });

/** POST `body` to the handler, pointed at the fixture registry. */
async function call(body: JsonValue): Promise<Response> {
  const req = new Request("http://service/", { body: JSON.stringify(body), method: "POST" });
  return handlePackagesRequest(req, { cache, registry: registry.url });
}

/** POST `body` and read the reply of an operation the service ran. */
async function reply(body: JsonValue): Promise<ServiceReply> {
  const res = await call(body);
  // SAFETY: a 200 from this handler is a ServiceReply; the status is checked first.
  return res.status === 200
    ? ((await res.json()) as ServiceReply)
    : Promise.reject(new Error(`${res.status}`));
}

/** The scratch directories the service has left in the temp directory. */
function scratchDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("jx-packages-service-"));
}

describe("operations", () => {
  test("add answers the manifest and lockfile it wrote, and fetches no tarball", async () => {
    const before = registry.requests.length;
    const added = await reply({
      args: { spec: "beta" },
      files: { "package.json": MANIFEST },
      op: "add",
    });
    expect(added.result.ok).toBe(true);
    expect(JSON.parse(added.files["package.json"]!).dependencies).toEqual({ beta: "^2.0.0" });
    expect(added.files["package-lock.json"]).toContain("node_modules/alpha");
    expect(added.deleted).toEqual([]);
    expect(registry.requests.slice(before).some((path) => path.endsWith(".tgz"))).toBe(false);
  });

  test("the first operation on a bun.lock project reports it deleted", async () => {
    const added = await reply({
      args: { dev: true, spec: "alpha" },
      files: { "bun.lock": "{}", "package.json": MANIFEST },
      op: "add",
    });
    expect(added.deleted).toEqual(["bun.lock"]);
    expect(added.files["bun.lock"]).toBeUndefined();
    expect(JSON.parse(added.files["package.json"]!).devDependencies).toEqual({ alpha: "^1.0.0" });
  });

  test("remove and set-versions run over the files they are given", async () => {
    const added = await reply({
      args: { spec: "beta" },
      files: { "package.json": MANIFEST },
      op: "add",
    });
    const files = {
      "package-lock.json": added.files["package-lock.json"]!,
      "package.json": added.files["package.json"]!,
    };
    const set = await reply({
      args: {
        updates: [
          { name: "beta", version: "2.0.0" },
          { dev: true, name: "alpha", version: "^1.0.0" },
        ],
      },
      files,
      op: "set-versions",
    });
    const setManifest = JSON.parse(set.files["package.json"]!);
    expect(setManifest.dependencies).toEqual({ beta: "2.0.0" });
    expect(setManifest.devDependencies).toEqual({ alpha: "^1.0.0" });
    const removed = await reply({ args: { name: "beta" }, files: set.files, op: "remove" });
    expect(removed.result.ok).toBe(true);
    // The installer drops a section the removal emptied, as npm does.
    expect(JSON.parse(removed.files["package.json"]!).dependencies).toBeUndefined();
  });

  test("a failed operation answers the request's files unchanged", async () => {
    const failed = await reply({
      args: { spec: "no-such-package" },
      files: { "package.json": MANIFEST },
      op: "add",
    });
    expect(failed.result.ok).toBe(false);
    expect(failed.result.log).toContain("404");
    expect(failed.files).toEqual({ "package.json": MANIFEST });
    expect(failed.deleted).toEqual([]);
  });

  test("no scratch directory survives a request, failed or not", () => {
    expect(scratchDirs()).toEqual([]);
  });
});

describe("refusals", () => {
  test.each([
    [{ args: {}, files: { "package.json": MANIFEST }, op: "install" }, "op must be"],
    [{ args: "x", files: { "package.json": MANIFEST }, op: "add" }, "`args` must be an object"],
    [{ args: { spec: 1 }, files: { "package.json": MANIFEST }, op: "add" }, "add takes"],
    [
      { args: { spec: "a", dev: "yes" }, files: { "package.json": MANIFEST }, op: "add" },
      "add takes",
    ],
    [{ args: {}, files: { "package.json": MANIFEST }, op: "remove" }, "remove takes"],
    [
      { args: { updates: "x" }, files: { "package.json": MANIFEST }, op: "set-versions" },
      "set-versions takes",
    ],
    [
      {
        args: { updates: [{ name: "a" }] },
        files: { "package.json": MANIFEST },
        op: "set-versions",
      },
      "set-versions takes",
    ],
    [
      {
        args: { updates: [{ dev: 1, name: "a", version: "1" }] },
        files: { "package.json": MANIFEST },
        op: "set-versions",
      },
      "set-versions takes",
    ],
    [{ args: { name: "a" }, files: "x", op: "remove" }, "`files` must be an object"],
    [
      { args: { name: "a" }, files: { ".npmrc": "x", "package.json": MANIFEST }, op: "remove" },
      ".npmrc is not",
    ],
    [{ args: { name: "a" }, files: { "package.json": 1 }, op: "remove" }, "must be a string"],
    [{ args: { name: "a" }, files: {}, op: "remove" }, "package.json is required"],
    [[], "Body must be an object"],
  ])("%j", async (body, message) => {
    const before = registry.requests.length;
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const { detail } = await res.json();
    expect(detail).toContain(message);
    expect(registry.requests.length).toBe(before);
  });

  test("a body that is not JSON, a large body, an unknown route and health", async () => {
    const notJson = await handlePackagesRequest(
      new Request("http://service/", { body: "{", method: "POST" }),
    );
    expect(notJson.status).toBe(400);
    const large = await handlePackagesRequest(
      new Request("http://service/", {
        body: "{}",
        headers: { "content-length": String(64 * 1024 * 1024) },
        method: "POST",
      }),
    );
    expect(large.status).toBe(413);
    expect(large.headers.get("content-type")).toBe("application/problem+json");
    const unknown = await handlePackagesRequest(new Request("http://service/other"));
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toBe("application/problem+json");
    const health = await handlePackagesRequest(new Request("http://service/health"));
    expect(await health.json()).toEqual({ ok: true });
  });
});

test("startPackagesService serves the handler", async () => {
  const server = await startPackagesService(0, "127.0.0.1");
  try {
    const res = await fetch(new URL("/health", server.url));
    expect(res.status).toBe(200);
  } finally {
    await server.stop(true);
  }
});
