/**
 * Package operations, parameterized by a project root: npm's own installer (`@npmcli/arborist`) run
 * in-process. Shared by the desktop app (`createPackageOps`), the dev server's
 * `/__studio/packages*` endpoints and the cloud's lockfile service (`packages-service.ts`), so
 * every backend installs the same way and writes the same `package-lock.json` (server.md §5).
 *
 * Strict, on purpose: install scripts never run, a peer conflict fails rather than being forced, a
 * spec that is not a registry package is refused, and a failed operation leaves `package.json` and
 * the lockfile byte-identical. The public registry is the only one: a project `.npmrc` is not read,
 * so a private scope fails with an error that names the registry and the status.
 */

import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Arborist from "@npmcli/arborist";
import npa from "npm-package-arg";
import { isNumber, isString } from "@jxsuite/schema/guards";
import type { PackageInfo, PackageOpResult, PackageVersionInfo } from "@jxsuite/protocol";
import type { JsonValue } from "@jxsuite/schema/types";

/* The package rows and operation result are the Studio wire contract (`packages*` routes), declared
   once in @jxsuite/protocol; re-exported so this module's public names stay. Every
   registry-range dependency gets a `PackageVersionInfo` row, behind or not: deciding whether a row
   is an upgrade needs a semver comparison against the range's base, and the caller, which has to
   make that comparison anyway to tell an upgrade from a project deliberately pinned ahead, is where
   it belongs. A backend that filtered here could only describe an up-to-date package as an
   absence. */
export type { PackageInfo, PackageOpResult, PackageVersionInfo } from "@jxsuite/protocol";

/** The manifest members this module edits; every other member is written back unchanged. */
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: JsonValue | undefined;
}

/** Minimal fetch signature (injectable for tests; the global `fetch` satisfies it). */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Strip a semver range prefix to its base version: "^0.19.0" → "0.19.0". */
export function stripRange(range: string): string {
  const base = range.replace(/^[\^~>=<v\s]+/, "").trim();
  return base.split(/\s+/)[0] ?? "";
}

/**
 * Whether a version spec points at the npm registry (a plain semver range). Skips workspace:,
 * file:, link:, npm:, git, and URL specs, plus wildcards like "*" or "latest".
 */
export function isRegistryRange(spec: string): boolean {
  if (spec.includes(":")) {
    return false;
  }
  return /^\d/.test(stripRange(spec));
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  const pkgPath = resolve(root, "package.json");
  if (!existsSync(pkgPath)) {
    return null;
  }
  try {
    /* SAFETY: package.json is the npm manifest `bun install` reads, an object whose
       `dependencies`/`devDependencies` map package names to version-spec strings; text that is
       not JSON throws into the catch below. */
    return JSON.parse(await readFile(pkgPath, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

/** List the project's dependencies and devDependencies (devDeps tagged with `dev: true`). */
export async function listPackages(root: string): Promise<PackageInfo[]> {
  const pkg = await readPackageJson(root);
  if (!pkg) {
    return [];
  }
  const out: PackageInfo[] = [];
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    out.push({ name, version });
  }
  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    out.push({ dev: true, name, version });
  }
  return out;
}

/** Whether the project has a package.json but no installed node_modules. */
export function dependenciesNeedInstall(root: string): boolean {
  if (!existsSync(resolve(root, "package.json"))) {
    return false;
  }
  return !existsSync(resolve(root, "node_modules"));
}

/** The registry every operation resolves against; a project `.npmrc` is not read (see below). */
export const NPM_REGISTRY = "https://registry.npmjs.org/";

/**
 * How an operation runs. `lockfileOnly` resolves and writes `package.json` and `package-lock.json`
 * without building `node_modules` or downloading a tarball: what the cloud service runs, where no
 * `node_modules` exists and no package code may arrive. `registry` and `cache` exist for the tests'
 * fixture registry and scratch cache; production callers leave them alone, which means the public
 * registry and npm's own cache directory (`~/.npm/_cacache`, inside the sandbox container on the
 * Mac App Store build).
 */
export interface PackageOpOptions {
  cache?: string;
  lockfileOnly?: boolean;
  registry?: string;
}

/** The files an operation may rewrite, restored byte-for-byte when it fails. */
const GUARDED_FILES = ["package.json", "package-lock.json", "bun.lock"] as const;

/** One project's operations, run one after another: two reifies in one tree race on its files. */
const queues = new Map<string, Promise<PackageOpResult>>();

/**
 * Run `task` after every operation already queued for `root`, whether that one succeeded or not.
 * `reify` turns every failure it can into a result, but a restore that itself fails still rejects,
 * and the next operation must run regardless.
 */
function enqueue(root: string, task: () => Promise<PackageOpResult>): Promise<PackageOpResult> {
  const previous = queues.get(root) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(root, next);
  const forget = (): void => {
    if (queues.get(root) === next) {
      queues.delete(root);
    }
  };
  void next.then(forget, forget);
  return next;
}

/** The guarded files' current bytes (null for an absent file). */
async function snapshot(root: string): Promise<Map<string, Buffer | null>> {
  const saved = new Map<string, Buffer | null>();
  for (const name of GUARDED_FILES) {
    const path = resolve(root, name);
    saved.set(name, existsSync(path) ? await readFile(path) : null);
  }
  return saved;
}

/** Put the guarded files back exactly as {@link snapshot} found them. */
async function restore(root: string, saved: Map<string, Buffer | null>): Promise<void> {
  for (const [name, bytes] of saved) {
    const path = resolve(root, name);
    await (bytes === null ? rm(path, { force: true }) : writeFile(path, bytes));
  }
}

/** An error as npm's fetch and resolver raise them: a code, and for HTTP a status and a URL. */
interface NpmError {
  code?: string;
  statusCode?: number;
  uri?: string;
  pkgid?: string;
  message: string;
}

/** Read the fields {@link describeFailure} reports off whatever an operation threw. */
function asNpmError(error: Error): NpmError {
  const out: NpmError = { message: error.message };
  if ("code" in error && isString(error.code)) {
    out.code = error.code;
  }
  if ("statusCode" in error && isNumber(error.statusCode)) {
    out.statusCode = error.statusCode;
  }
  if ("uri" in error && isString(error.uri)) {
    out.uri = error.uri;
  }
  if ("pkgid" in error && isString(error.pkgid)) {
    out.pkgid = error.pkgid;
  }
  return out;
}

/**
 * The first line of a failed operation's log: what failed, in the terms the user can act on.
 *
 * A registry refusal names the package, the registry and the status, because the usual cause is a
 * private scope or a mirror this installer does not read (`.npmrc` is not consulted). A peer
 * conflict is reported as one, never forced through.
 */
function describeFailure(error: NpmError, registry: string): string {
  if (error.statusCode !== undefined) {
    const what = error.pkgid ?? error.uri ?? "a package";
    return `The registry ${registry} answered ${error.statusCode} for ${what}. Private registries and .npmrc settings are not supported; install it from a terminal.`;
  }
  if (error.code === "ERESOLVE") {
    return `The dependencies conflict (ERESOLVE): ${error.message}`;
  }
  if (error.code === "EUNSUPPORTEDPROTOCOL") {
    return `A dependency uses a specifier this installer does not support: ${error.message}`;
  }
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

/**
 * Run one Arborist reify for `root` under the queue, the snapshot and the `bun.lock` switch.
 *
 * Strict by construction: no `force`, no `legacyPeerDeps`, scripts never run, and nothing is left
 * half-done. On failure the manifest and lockfiles are restored byte-for-byte (Arborist rolls
 * `node_modules` back itself). On success a project that had only a `bun.lock` loses it, because
 * `package-lock.json` is now the lockfile and two lockfiles drift.
 */
function reify(
  root: string,
  options: PackageOpOptions,
  prepare: () => Promise<Partial<ReifyOptions>>,
): Promise<PackageOpResult> {
  return enqueue(root, async () => {
    const registry = options.registry ?? NPM_REGISTRY;
    const hadBunLockOnly =
      existsSync(resolve(root, "bun.lock")) && !existsSync(resolve(root, "package-lock.json"));
    let saved: Map<string, Buffer | null> | null = null;
    const lines: string[] = [];
    const onLog = (level: string, ...args: unknown[]): void => {
      if (level === "warn" || level === "error" || level === "notice") {
        lines.push(args.map(String).join(" "));
      }
    };
    process.on("log", onLog);
    try {
      saved = await snapshot(root);
      const extra = await prepare();
      const arboristOptions: ConstructorParameters<typeof Arborist>[0] = {
        audit: false,
        fund: false,
        ignoreScripts: true,
        lockfileVersion: 3,
        packageLockOnly: options.lockfileOnly === true,
        path: root,
        registry,
        save: true,
      };
      if (options.cache !== undefined) {
        arboristOptions.cache = options.cache;
      }
      const arborist = new Arborist(arboristOptions);
      await arborist.reify({ ...extra, save: true });
      if (hadBunLockOnly) {
        await rm(resolve(root, "bun.lock"), { force: true });
        lines.push("Replaced bun.lock with package-lock.json, which Studio installs from.");
      }
      const result: PackageOpResult = { ok: true };
      if (lines.length > 0) {
        result.log = lines.join("\n");
      }
      return result;
    } catch (error) {
      if (saved) {
        await restore(root, saved);
      }
      const npmError = asNpmError(error instanceof Error ? error : new Error(String(error)));
      return { log: [describeFailure(npmError, registry), ...lines].join("\n"), ok: false };
    } finally {
      process.off("log", onLog);
    }
  });
}

/** What `reify` accepts beyond the constructor's options. */
type ReifyOptions = NonNullable<Parameters<Arborist["reify"]>[0]>;

/** Install the dependencies `package.json` declares, writing `package-lock.json`. */
export function installDependencies(
  root: string,
  options: PackageOpOptions = {},
): Promise<PackageOpResult> {
  return reify(root, options, async () => ({}));
}

/**
 * A registry spec (`name`, `name@1.2.3`, `name@^1`, `name@latest`), or the reason it is refused.
 * Git, file, URL, alias and `workspace:` specs are refused before Arborist sees them.
 */
function registrySpec(spec: string): { ok: true; name: string } | { ok: false; reason: string } {
  let parsed: ReturnType<typeof npa>;
  try {
    parsed = npa(spec);
  } catch (error) {
    return { ok: false, reason: `"${spec}" is not a registry package: ${String(error)}` };
  }
  if (!REGISTRY_SPEC_TYPES.has(parsed.type) || !parsed.name) {
    return {
      ok: false,
      reason: `"${spec}" is a ${parsed.type} specifier; only packages from the registry can be added.`,
    };
  }
  return { name: parsed.name, ok: true };
}

/** The `npm-package-arg` types that name a package on the registry. */
const REGISTRY_SPEC_TYPES = new Set(["version", "range", "tag"]);

/** Add a dependency (a devDependency when `dev`), saving `^<resolved>` as npm does. */
export async function addPackage(
  root: string,
  spec: string,
  dev = false,
  options: PackageOpOptions = {},
): Promise<PackageOpResult> {
  const checked = registrySpec(spec);
  if (!checked.ok) {
    return { log: checked.reason, ok: false };
  }
  return reify(root, options, async () => ({ add: [spec], saveType: dev ? "dev" : "prod" }));
}

/** Remove a dependency from whichever section holds it. */
export async function removePackage(
  root: string,
  name: string,
  options: PackageOpOptions = {},
): Promise<PackageOpResult> {
  return reify(root, options, async () => ({ rm: [name] }));
}

/**
 * Fetch the newest published version for a package from the npm registry, or null on any failure.
 *
 * **`application/json`, not the abbreviated `install-v1` format.** That format is defined for the
 * PACKUMENT endpoint (`/<name>`), and asking for it on the version endpoint (`/<name>/latest`)
 * returns an EMPTY BODY for most packages — verified against `@jxsuite/schema`, `@jxsuite/parser`
 * and `lit`, while `wrangler` happens to answer normally. An empty body fails `res.json()`, the
 * catch below turns that into `null`, and a null reads as "nothing newer" — so this silently
 * under-reported outdated dependencies for everything it was asked about, and looked like a quiet
 * registry rather than a broken request. The injected-fetch tests could not see it: they return a
 * body regardless of the header.
 */
export async function fetchLatestVersion(
  name: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${name}/latest`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return null;
    }
    /* SAFETY: the registry's version endpoint answers that version's manifest, whose `version`
       is a string; a body that is not JSON (or is `null`) throws into the catch, giving null. */
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * The newest published version of every dependency, asked of the registry package by package.
 *
 * Lookups run concurrently; non-registry specs (workspace:, file:, …) and lookup failures are
 * skipped, because there is no honest answer for either and a guess is worse than a blank.
 *
 * This used to be `outdatedPackages`, which dropped any package whose latest matched its pinned
 * base. Two assumptions were folded into that filter and both have since gone: that the only caller
 * wanted a to-do list, and that `latest !== base` is the same question as "is there an upgrade" (it
 * is not — a project pinned ahead of the registry, on a prerelease or a range bumped before the
 * publish landed, differs from latest in the other direction). Reporting the registry's answer for
 * every package leaves both judgements to the caller and lets the Packages table show a Latest
 * column for rows that are already current.
 */
export async function packageVersions(
  root: string,
  fetchImpl: FetchLike = fetch,
): Promise<PackageVersionInfo[]> {
  const pkgs = await listPackages(root);
  const checks = await Promise.all(
    pkgs.map(async (p): Promise<PackageVersionInfo | null> => {
      if (!isRegistryRange(p.version)) {
        return null;
      }
      const latest = await fetchLatestVersion(p.name, fetchImpl);
      if (!latest) {
        return null;
      }
      const entry: PackageVersionInfo = { current: p.version, latest, name: p.name };
      if (p.dev) {
        entry.dev = true;
      }
      return entry;
    }),
  );
  return checks.filter((entry): entry is PackageVersionInfo => entry !== null);
}

/**
 * Rewrite the version range of each named package in whichever section it already occupies
 * (preserving dependencies/devDependencies placement; new names default to the caller's `dev`
 * flag), then install once. A failed install leaves `package.json` as it was.
 */
export async function setPackageVersions(
  root: string,
  updates: { name: string; version: string; dev?: boolean }[],
  options: PackageOpOptions = {},
): Promise<PackageOpResult> {
  if (updates.length === 0) {
    return { ok: true };
  }
  const pkgPath = resolve(root, "package.json");
  if (!existsSync(pkgPath)) {
    return { log: "No package.json in project root", ok: false };
  }
  let pkg: PackageJson;
  try {
    // SAFETY: same npm manifest contract as readPackageJson; unparseable text is caught below.
    pkg = JSON.parse(await readFile(pkgPath, "utf8")) as PackageJson;
  } catch (error) {
    return { log: `Unparseable package.json: ${String(error)}`, ok: false };
  }
  for (const update of updates) {
    if (pkg.devDependencies && update.name in pkg.devDependencies) {
      pkg.devDependencies[update.name] = update.version;
    } else if (pkg.dependencies && update.name in pkg.dependencies) {
      pkg.dependencies[update.name] = update.version;
    } else {
      const bucket = update.dev ? "devDependencies" : "dependencies";
      pkg[bucket] = { ...pkg[bucket], [update.name]: update.version };
    }
  }
  // Written inside the operation, so the snapshot it restores on failure is the manifest before.
  return reify(root, options, async () => {
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    return {};
  });
}
