/**
 * A local npm registry for the package-operation tests, so nothing reaches npm.
 *
 * Serves each fixture package's packument at `/<name>` and its tarball at
 * `/<name>/-/<base>-<version>.tgz`, the two URLs an installer asks for, and records every request
 * so a test can prove a lockfile-only operation never asked for a tarball. A name can be made to
 * answer a fixed status, which is how a private scope looks to an installer with no credentials.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { serve } from "../src/serve.node.ts";

/** One published version of a fixture package. */
export interface FixturePackage {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  /** The registry's deprecation notice for this version, which installers log as a warning. */
  deprecated?: string;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  /** Extra files in the tarball, by path relative to the package root. */
  files?: Record<string, string>;
}

export interface FixtureRegistry {
  /** The registry URL, with a trailing slash. */
  url: string;
  /** Every request path, in order. */
  requests: string[];
  /** True when any tarball was requested. */
  tarballRequested: () => boolean;
  /** Make `name` answer `status` (e.g. 401) instead of its packument. */
  refuse: (name: string, status: number) => void;
  stop: () => Promise<void>;
}

/** A version as the packument describes it; `path` is the tarball's, without the leading slash. */
interface VersionMeta {
  dependencies: Record<string, string>;
  deprecated: string | undefined;
  integrity: string;
  name: string;
  path: string;
  peerDependencies: Record<string, string>;
  scripts: Record<string, string>;
  shasum: string;
  version: string;
}

/** The tarball's file name: a scoped name drops its scope, as the registry does. */
function tarballName(name: string, version: string): string {
  return `${name.split("/").pop()}-${version}.tgz`;
}

/** Pack one fixture version into a gzipped tarball with everything under `package/`. */
async function pack(pkg: FixturePackage, scratch: string): Promise<Buffer> {
  const dir = mkdtempSync(join(scratch, "pkg-"));
  const root = join(dir, "package");
  mkdirSync(root, { recursive: true });
  const manifest = {
    dependencies: pkg.dependencies ?? {},
    name: pkg.name,
    peerDependencies: pkg.peerDependencies ?? {},
    scripts: pkg.scripts ?? {},
    version: pkg.version,
  };
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  for (const [path, contents] of Object.entries(pkg.files ?? {})) {
    writeFileSync(join(root, path), contents);
  }
  const file = join(dir, "out.tgz");
  await create({ cwd: dir, file, gzip: true, portable: true }, ["package"]);
  return readFileSync(file);
}

/** Start a registry serving `packages`; versions of one name are grouped into one packument. */
export async function startRegistry(packages: FixturePackage[]): Promise<FixtureRegistry> {
  const scratch = mkdtempSync(join(tmpdir(), "jx-npm-registry-"));
  const tarballs = new Map<string, Buffer>();
  const packuments = new Map<string, { versions: Map<string, VersionMeta>; latest: string }>();
  const refused = new Map<string, number>();
  const requests: string[] = [];
  let base = "";

  for (const pkg of packages) {
    const bytes = await pack(pkg, scratch);
    const path = `/${pkg.name}/-/${tarballName(pkg.name, pkg.version)}`;
    tarballs.set(path, bytes);
    const entry = packuments.get(pkg.name) ?? { latest: pkg.version, versions: new Map() };
    entry.latest = pkg.version;
    entry.versions.set(pkg.version, {
      dependencies: pkg.dependencies ?? {},
      deprecated: pkg.deprecated,
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      name: pkg.name,
      path: path.slice(1),
      peerDependencies: pkg.peerDependencies ?? {},
      scripts: pkg.scripts ?? {},
      shasum: createHash("sha1").update(bytes).digest("hex"),
      version: pkg.version,
    });
    packuments.set(pkg.name, entry);
  }

  const server = await serve({
    fetch: (req) => {
      const path = decodeURIComponent(new URL(req.url).pathname);
      requests.push(path);
      const tarball = tarballs.get(path);
      if (tarball) {
        return new Response(new Uint8Array(tarball), {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      const name = path.slice(1);
      const status = refused.get(name);
      if (status !== undefined) {
        return Response.json({ error: "refused" }, { status });
      }
      const packument = packuments.get(name);
      if (!packument) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const versions = Object.fromEntries(
        [...packument.versions].map(([version, meta]) => [
          version,
          {
            dependencies: meta.dependencies,
            // `Response.json` drops an undefined member, so a package that is not deprecated says nothing.
            deprecated: meta.deprecated,
            dist: {
              integrity: meta.integrity,
              shasum: meta.shasum,
              tarball: `${base}${meta.path}`,
            },
            name: meta.name,
            peerDependencies: meta.peerDependencies,
            scripts: meta.scripts,
            version: meta.version,
          },
        ]),
      );
      return Response.json({ "dist-tags": { latest: packument.latest }, name, versions });
    },
    hostname: "127.0.0.1",
  });
  base = server.url.href;

  return {
    refuse: (name, status) => {
      refused.set(name, status);
    },
    requests,
    stop: async () => {
      await server.stop(true);
      rmSync(scratch, { force: true, recursive: true });
    },
    tarballRequested: () => requests.some((path) => path.endsWith(".tgz")),
    url: base,
  };
}
