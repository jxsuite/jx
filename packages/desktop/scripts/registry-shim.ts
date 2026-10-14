/*
 * Offline npm-registry shim for the Nix build.
 *
 * Bun re-resolves a workspace's *directly declared* dependencies against the
 * registry on every clean install — even with `--frozen-lockfile` / `--offline`
 * and a fully populated package cache (it reports a phantom "updated N
 * dependencies" for the workspace packages and refuses to trust the lockfile
 * for them). In the Nix sandbox there is no network, so those manifest fetches
 * fail with `ConnectionRefused` and the build dies.
 *
 * Rather than fight Bun's resolver, we give it exactly what it asks for: a tiny
 * HTTP registry, served on loopback during the build, that answers manifest
 * (packument) requests with data synthesized straight from `bun.lock` and
 * serves tarballs from a Nix-store tree of the already-fetched `.tgz` files.
 * Everything is derived from the lockfile, so there is no extra hash to
 * maintain and nothing that drifts when upstream publishes new versions.
 *
 *   bun registry-shim.ts <bun.lock> <tarballTreeDir> [port]
 *
 * The tarball tree mirrors npm registry paths: <name>/-/<basename>-<ver>.tgz.
 */

import { file, serve } from "bun";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const lockPath = args.at(0);
const treeDir = args.at(1);
const portArg = args.at(2);
if (!lockPath || !treeDir) {
  throw new Error("usage: bun registry-shim.ts <bun.lock> <tarballTreeDir> [port]");
}
const port = Number(portArg ?? 48_732);

/*
 * The lockfile's values, as Bun's JSONC loader produces them. Declared here rather than imported:
 * this file runs straight out of the Nix store BEFORE `bun install`, so nothing but Bun and the
 * node builtins can be imported, and the predicates below are local for the same reason.
 */
type LockValue = string | number | boolean | null | LockValue[] | LockObject;

interface LockObject {
  [key: string]: LockValue;
}

/** What `import(…, { with: { type: "jsonc" } })` resolves to: the parsed document on `default`. */
interface JsoncModule {
  default: LockValue;
}

function isJsoncModule(value: unknown): value is JsoncModule {
  return typeof value === "object" && value !== null && "default" in value;
}

function isLockObject(value: unknown): value is LockObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Takes `undefined` too: a lockfile entry is a short tuple, and a missing slot is undefined. */
function isLockString(value: LockValue | undefined): value is string {
  return typeof value === "string";
}

interface Versioned {
  info: LockObject;
  integrity: string | undefined;
}

// Reach Bun's built-in JSONC loader, as bun2nix's catalog resolver does
// (bun.lock has trailing commas, so plain JSON.parse would choke).
const lockModule: unknown = await import(pathToFileURL(resolve(lockPath)).href, {
  with: { type: "jsonc" },
});
if (!isJsoncModule(lockModule) || !isLockObject(lockModule.default)) {
  throw new Error(`${lockPath} did not parse to a JSON object`);
}
const lock = lockModule.default;
const packages = isLockObject(lock.packages) ? lock.packages : {};

// Name -> { version -> {info, integrity} }, built from every `packages` entry
// (top-level and nested), so multi-version deps expose all their versions.
const byName = new Map<string, Map<string, Versioned>>();
for (const entry of Object.values(packages)) {
  if (!Array.isArray(entry)) {
    continue;
  }
  const [spec, , rawInfo, rawIntegrity] = entry;
  if (!isLockString(spec)) {
    continue;
  }
  const at = spec.lastIndexOf("@");
  if (at <= 0) {
    continue;
  }
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  const info = isLockObject(rawInfo) ? rawInfo : {};
  const integrity = isLockString(rawIntegrity) ? rawIntegrity : undefined;
  let versions = byName.get(name);
  if (!versions) {
    versions = new Map();
    byName.set(name, versions);
  }
  versions.set(version, { info, integrity });
}

const unscoped = (name: string): string =>
  name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
const tarballPath = (name: string, version: string): string =>
  `/${name}/-/${unscoped(name)}-${version}.tgz`;

// Crude but sufficient semver ordering for picking dist-tags.latest.
const cmpVersion = (a: string, b: string): number => {
  const pa = a.split(/[.+-]/).map((n) => Math.trunc(Number(n)) || 0);
  const pb = b.split(/[.+-]/).map((n) => Math.trunc(Number(n)) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
};

/** One version's manifest: the lockfile's info, then the identity and dist fields npm requires. */
interface PackumentVersion {
  [field: string]: LockValue | PackumentDist;
  name: string;
  version: string;
  dist: PackumentDist;
}

interface PackumentDist {
  tarball: string;
  integrity: string | undefined;
}

/** The registry document `GET /<name>` answers with. */
interface Packument {
  name: string;
  "dist-tags": { latest: string | undefined };
  versions: Record<string, PackumentVersion>;
}

function packument(name: string): Packument | null {
  const vers = byName.get(name);
  if (!vers) {
    return null;
  }
  const versions = Object.fromEntries(
    [...vers].map(([v, { info, integrity }]): [string, PackumentVersion] => [
      v,
      {
        ...info,
        name,
        version: v,
        dist: { tarball: `http://localhost:${port}${tarballPath(name, v)}`, integrity },
      },
    ]),
  );
  const latest = [...vers.keys()].toSorted(cmpVersion).at(-1);
  return { name, "dist-tags": { latest }, versions };
}

serve({
  port,
  fetch(req) {
    const { pathname } = new URL(req.url);
    const p = decodeURIComponent(pathname);
    if (/^\/.+\/-\/[^/]+\.tgz$/.test(p)) {
      const tarball = join(treeDir, p);
      if (existsSync(tarball)) {
        return new Response(file(tarball));
      }
      return new Response(`no tarball: ${p}`, { status: 404 });
    }
    const pm = packument(p.replace(/^\//, ""));
    if (pm) {
      return Response.json(pm);
    }
    return new Response(`not found: ${p}`, { status: 404 });
  },
});

console.error(`registry-shim listening on http://localhost:${port}`);
