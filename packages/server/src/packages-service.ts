/**
 * The cloud's package service: the operations of `packages.ts`, run lockfile-only over files a
 * request carries, so a host with no filesystem of its own (the cloud's working tree lives in a
 * Durable Object) gets the same `package.json` and `package-lock.json` a desktop install writes.
 *
 * Stateless. Each request's files are written into a fresh temporary directory, the operation runs
 * there with `lockfileOnly` (no `node_modules`, no tarball downloaded, no install script), the two
 * files are read back, and the directory is removed whatever happened. The reply says which of the
 * request's files the operation deleted (`bun.lock`, on the first install), so the caller can apply
 * the whole result to its own tree as one change, or nothing when `result.ok` is false.
 *
 * The request is refused (400) for any operation but add, remove and set-versions, and any file but
 * the three below, before anything is written. It is meant to be reachable only from the host that
 * owns the working tree (a container binding, not a public route), and it reads nothing but the
 * public registry.
 *
 * @docs studio/projects/dependencies
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBoolean, isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import type { PackageInfo, PackageOpResult } from "@jxsuite/protocol";
import { addPackage, removePackage, setPackageVersions } from "./packages.ts";
import type { PackageOpOptions } from "./packages.ts";
import { problem } from "./problem.ts";
import { serve } from "#serve";
import type { ServeServer } from "./serve.ts";

/** The files a request may carry, and the only ones a reply returns or reports deleted. */
export const SERVICE_FILES = ["package.json", "package-lock.json", "bun.lock"] as const;

const SERVICE_FILE_NAMES = new Set<string>(SERVICE_FILES);

/** One of {@link SERVICE_FILES}. */
export type ServiceFile = (typeof SERVICE_FILES)[number];

/** A validated request. */
export type ServiceOp =
  | { op: "add"; spec: string; dev: boolean }
  | { op: "remove"; name: string }
  | { op: "set-versions"; updates: PackageInfo[] };

/** What the service answers for an operation it ran. */
export interface ServiceReply {
  result: PackageOpResult;
  /** The files as the operation left them; on failure, the request's files unchanged. */
  files: Partial<Record<ServiceFile, string>>;
  /** Request files the operation removed. */
  deleted: ServiceFile[];
}

/** The largest request body accepted, in bytes: a lockfile is large, but not this large. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** True when `name` is one of {@link SERVICE_FILES}. */
function isServiceFile(name: string): name is ServiceFile {
  return SERVICE_FILE_NAMES.has(name);
}

/** A version update read off the request, or null when one member has the wrong shape. */
function parseUpdate(value: JsonValue): PackageInfo | null {
  if (!isJsonObject(value) || !isString(value.name) || !isString(value.version)) {
    return null;
  }
  const update: PackageInfo = { name: value.name, version: value.version };
  if (value.dev !== undefined) {
    if (!isBoolean(value.dev)) {
      return null;
    }
    update.dev = value.dev;
  }
  return update;
}

/** The operation a request names, or the reason it is refused. */
export function parseOp(body: JsonObject): ServiceOp | { error: string } {
  const { args } = body;
  if (!isJsonObject(args)) {
    return { error: "`args` must be an object" };
  }
  switch (body.op) {
    case "add": {
      if (!isString(args.spec) || (args.dev !== undefined && !isBoolean(args.dev))) {
        return { error: "add takes { spec: string, dev?: boolean }" };
      }
      return { dev: args.dev === true, op: "add", spec: args.spec };
    }
    case "remove": {
      return isString(args.name)
        ? { name: args.name, op: "remove" }
        : { error: "remove takes { name: string }" };
    }
    case "set-versions": {
      const updates = Array.isArray(args.updates) ? args.updates.map(parseUpdate) : null;
      if (!updates || updates.includes(null)) {
        return { error: "set-versions takes { updates: { name, version, dev? }[] }" };
      }
      return { op: "set-versions", updates: updates.filter((update) => update !== null) };
    }
    default: {
      return { error: "op must be add, remove or set-versions" };
    }
  }
}

/** The request's files, or the reason they are refused. */
export function parseFiles(
  value: JsonValue | undefined,
): Map<ServiceFile, string> | { error: string } {
  if (!isJsonObject(value)) {
    return { error: "`files` must be an object" };
  }
  const files = new Map<ServiceFile, string>();
  for (const [name, contents] of Object.entries(value)) {
    if (!isServiceFile(name)) {
      return { error: `${name} is not a file this service reads` };
    }
    if (!isString(contents)) {
      return { error: `${name} must be a string` };
    }
    files.set(name, contents);
  }
  if (!files.has("package.json")) {
    return { error: "package.json is required" };
  }
  return files;
}

/** Run `op` over `files` in a scratch directory and report what it left. */
export async function runServiceOp(
  op: ServiceOp,
  files: Map<ServiceFile, string>,
  options: Omit<PackageOpOptions, "lockfileOnly"> = {},
): Promise<ServiceReply> {
  const dir = await mkdtemp(join(tmpdir(), "jx-packages-service-"));
  try {
    for (const [name, contents] of files) {
      await writeFile(join(dir, name), contents, "utf8");
    }
    const opOptions: PackageOpOptions = { ...options, lockfileOnly: true };
    let result: PackageOpResult;
    if (op.op === "add") {
      result = await addPackage(dir, op.spec, op.dev, opOptions);
    } else if (op.op === "remove") {
      result = await removePackage(dir, op.name, opOptions);
    } else {
      result = await setPackageVersions(dir, op.updates, opOptions);
    }
    const out: ServiceReply["files"] = {};
    const deleted: ServiceFile[] = [];
    for (const name of SERVICE_FILES) {
      const contents = await readFile(join(dir, name), "utf8").catch(() => null);
      if (contents !== null) {
        out[name] = contents;
      } else if (files.has(name)) {
        deleted.push(name);
      }
    }
    return { deleted, files: out, result };
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

/**
 * The service's fetch handler: `POST /` with `{ op, args, files }`, answered with a
 * {@link ServiceReply}, or 400 for a request it refuses. `GET /health` answers 200.
 */
export async function handlePackagesRequest(
  req: Request,
  options: Omit<PackageOpOptions, "lockfileOnly"> = {},
): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (req.method === "GET" && pathname === "/health") {
    return Response.json({ ok: true });
  }
  if (req.method !== "POST" || pathname !== "/") {
    return problem("notFound");
  }
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    return problem("payloadTooLarge");
  }
  let body: JsonValue;
  try {
    // SAFETY: JSON.parse yields a JSON value; its shape is checked member by member below.
    body = JSON.parse(await req.text()) as JsonValue;
  } catch {
    return problem("invalidRequest", "Body must be JSON");
  }
  if (!isJsonObject(body)) {
    return problem("invalidRequest", "Body must be an object");
  }
  const op = parseOp(body);
  if ("error" in op) {
    return problem("invalidRequest", op.error);
  }
  const files = parseFiles(body.files);
  if ("error" in files) {
    return problem("invalidRequest", files.error);
  }
  return Response.json(await runServiceOp(op, files, options));
}

/** Start the service on `port` (all interfaces: it runs inside a container). */
export function startPackagesService(
  port: number,
  hostname = "0.0.0.0",
): Promise<ServeServer<undefined>> {
  return serve({ fetch: (req) => handlePackagesRequest(req), hostname, port });
}
