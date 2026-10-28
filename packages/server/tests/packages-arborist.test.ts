/**
 * Package operations over npm's installer against a local fixture registry: what they write, what
 * they refuse, and that a failure leaves the manifest and the lockfile exactly as they were.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addPackage,
  installDependencies,
  removePackage,
  setPackageVersions,
} from "../src/packages.ts";
import type { PackageOpOptions } from "../src/packages.ts";
import { startRegistry } from "./_npm-registry.ts";
import type { FixtureRegistry } from "./_npm-registry.ts";

let registry: FixtureRegistry;
let scratch: string;
let options: PackageOpOptions;
let root: string;

beforeAll(async () => {
  registry = await startRegistry([
    { name: "alpha", version: "1.0.0" },
    { name: "alpha", version: "1.1.0" },
    { dependencies: { alpha: "^1.0.0" }, name: "beta", version: "2.0.0" },
    {
      name: "scripted",
      scripts: { postinstall: "node -e \"require('fs').writeFileSync('../../MARKER','x')\"" },
      version: "1.0.0",
    },
    { name: "needs-alpha-2", peerDependencies: { alpha: "^2.0.0" }, version: "1.0.0" },
    { deprecated: "use beta instead", name: "old", version: "1.0.0" },
  ]);
  scratch = mkdtempSync(join(tmpdir(), "jx-packages-"));
  options = { cache: join(scratch, "cache"), registry: registry.url };
});

afterAll(async () => {
  await registry.stop();
  rmSync(scratch, { force: true, recursive: true });
});

beforeEach(() => {
  root = mkdtempSync(join(scratch, "project-"));
});

/** Write `package.json` with these sections. */
function manifest(sections: Record<string, Record<string, string>> = {}): void {
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "site", ...sections }, null, 2));
}

/** The members of the manifest and lockfile these tests read. */
interface Written {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  lockfileVersion?: number;
}

/** Parse a JSON file under the project. */
function readJson(name: string): Written {
  // SAFETY: the files read here are the manifest and lockfile the installer just wrote.
  return JSON.parse(readFileSync(join(root, name), "utf8")) as Written;
}

/** The bytes of the guarded files, for comparing before and after a failed operation. */
function guarded(): (string | null)[] {
  return ["package.json", "package-lock.json", "bun.lock"].map((name) =>
    existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : null,
  );
}

describe("operations that succeed", () => {
  test("install writes a version-3 package-lock.json and node_modules", async () => {
    manifest({ dependencies: { beta: "^2.0.0" } });
    const result = await installDependencies(root, options);
    expect(result).toMatchObject({ ok: true });
    expect(readJson("package-lock.json").lockfileVersion).toBe(3);
    expect(existsSync(join(root, "node_modules/alpha/package.json"))).toBe(true);
  });

  test("add saves ^<resolved> to dependencies, and to devDependencies with dev", async () => {
    manifest();
    expect(await addPackage(root, "alpha", false, options)).toMatchObject({ ok: true });
    expect(await addPackage(root, "beta@2", true, options)).toMatchObject({ ok: true });
    const pkg = readJson("package.json");
    expect(pkg.dependencies).toEqual({ alpha: "^1.1.0" });
    expect(pkg.devDependencies).toEqual({ beta: "^2.0.0" });
  });

  test("remove drops the dependency from the manifest and the lockfile", async () => {
    manifest({ dependencies: { alpha: "^1.0.0", beta: "^2.0.0" } });
    await installDependencies(root, options);
    expect(await removePackage(root, "beta", options)).toMatchObject({ ok: true });
    expect(readJson("package.json").dependencies).toEqual({ alpha: "^1.0.0" });
    expect(JSON.stringify(readJson("package-lock.json"))).not.toContain("node_modules/beta");
  });

  test("an installer warning reaches the operation's log", async () => {
    manifest();
    const result = await addPackage(root, "old", false, options);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("use beta instead");
  });

  test("set versions keeps a devDependency where it is", async () => {
    manifest({ devDependencies: { alpha: "^1.0.0" } });
    expect(
      await setPackageVersions(root, [{ name: "alpha", version: "1.0.0" }], options),
    ).toMatchObject({ ok: true });
    expect(readJson("package.json").devDependencies).toEqual({ alpha: "1.0.0" });
  });

  test("set versions rewrites ranges in place and installs once", async () => {
    manifest({ dependencies: { alpha: "^1.0.0" } });
    const result = await setPackageVersions(
      root,
      [
        { name: "alpha", version: "1.0.0" },
        { dev: true, name: "beta", version: "^2.0.0" },
      ],
      options,
    );
    expect(result).toMatchObject({ ok: true });
    const pkg = readJson("package.json");
    expect(pkg.dependencies).toEqual({ alpha: "1.0.0" });
    expect(pkg.devDependencies).toEqual({ beta: "^2.0.0" });
  });

  test("the first install replaces a bun.lock with package-lock.json, and says so", async () => {
    manifest({ dependencies: { alpha: "^1.0.0" } });
    writeFileSync(join(root, "bun.lock"), "{}");
    const result = await installDependencies(root, options);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("Replaced bun.lock");
    expect(existsSync(join(root, "bun.lock"))).toBe(false);
    expect(existsSync(join(root, "package-lock.json"))).toBe(true);
  });

  test("a bun.lock beside an existing package-lock.json is left alone", async () => {
    manifest({ dependencies: { alpha: "^1.0.0" } });
    await installDependencies(root, options);
    writeFileSync(join(root, "bun.lock"), "{}");
    await addPackage(root, "beta", false, options);
    expect(existsSync(join(root, "bun.lock"))).toBe(true);
  });

  test("install scripts never run", async () => {
    manifest({ dependencies: { scripted: "1.0.0" } });
    expect(await installDependencies(root, options)).toMatchObject({ ok: true });
    expect(existsSync(join(root, "node_modules/scripted/package.json"))).toBe(true);
    expect(existsSync(join(root, "MARKER"))).toBe(false);
  });

  test("lockfile-only writes the manifest and lock, no node_modules, and fetches no tarball", async () => {
    manifest();
    const before = registry.requests.length;
    expect(await addPackage(root, "beta", false, { ...options, lockfileOnly: true })).toMatchObject(
      { ok: true },
    );
    expect(readJson("package.json").dependencies).toEqual({ beta: "^2.0.0" });
    expect(JSON.stringify(readJson("package-lock.json"))).toContain("node_modules/alpha");
    expect(existsSync(join(root, "node_modules"))).toBe(false);
    expect(registry.requests.slice(before).some((path) => path.endsWith(".tgz"))).toBe(false);
  });

  test("two operations started together run one after the other", async () => {
    manifest();
    const [first, second] = await Promise.all([
      addPackage(root, "alpha", false, options),
      addPackage(root, "beta", false, options),
    ]);
    expect([first.ok, second.ok]).toEqual([true, true]);
    // The second saw the first's manifest, so both survive.
    expect(readJson("package.json").dependencies).toEqual({ alpha: "^1.1.0", beta: "^2.0.0" });
  });
});

describe("operations that fail leave the manifest and lockfile untouched", () => {
  test("a registry refusal names the package, the registry and the status", async () => {
    registry.refuse("@private/thing", 401);
    manifest({ dependencies: { alpha: "^1.0.0" } });
    await installDependencies(root, options);
    const before = guarded();
    const result = await addPackage(root, "@private/thing", false, options);
    expect(result.ok).toBe(false);
    expect(result.log).toContain(registry.url);
    expect(result.log).toContain("401");
    expect(result.log).toContain("@private/thing");
    expect(guarded()).toEqual(before);
  });

  test("a package the registry does not have fails with 404", async () => {
    manifest();
    const before = guarded();
    const result = await addPackage(root, "no-such-package", false, options);
    expect(result).toMatchObject({ ok: false });
    expect(result.log).toContain("404");
    expect(guarded()).toEqual(before);
  });

  test("a peer conflict fails as ERESOLVE and installs nothing", async () => {
    manifest({ dependencies: { alpha: "^1.0.0" } });
    await installDependencies(root, options);
    const before = guarded();
    const result = await addPackage(root, "needs-alpha-2", false, options);
    expect(result.ok).toBe(false);
    expect(result.log).toContain("ERESOLVE");
    expect(guarded()).toEqual(before);
    expect(existsSync(join(root, "node_modules/needs-alpha-2"))).toBe(false);
  });

  test("set versions that cannot install restore the old package.json", async () => {
    manifest({ dependencies: { alpha: "^1.0.0" } });
    await installDependencies(root, options);
    const before = guarded();
    const result = await setPackageVersions(root, [{ name: "alpha", version: "^9.0.0" }], options);
    expect(result.ok).toBe(false);
    expect(guarded()).toEqual(before);
  });

  test("a failed first install keeps the bun.lock", async () => {
    manifest({ dependencies: { "no-such-package": "^1.0.0" } });
    writeFileSync(join(root, "bun.lock"), "{}");
    const before = guarded();
    const result = await installDependencies(root, options);
    expect(result.ok).toBe(false);
    expect(guarded()).toEqual(before);
  });

  test("a workspace: dependency already in the manifest fails by name", async () => {
    manifest({ dependencies: { local: "workspace:^" } });
    const result = await installDependencies(root, options);
    expect(result.ok).toBe(false);
    expect(result.log).toContain("workspace:");
  });
});

describe("add refuses what is not a registry package, before installing anything", () => {
  test.each([
    "github:user/repo",
    "file:../somewhere",
    "https://example.com/pkg.tgz",
    "local@workspace:^",
    "alias@npm:alpha",
    "",
  ])("%p", async (spec) => {
    manifest();
    const before = registry.requests.length;
    const result = await addPackage(root, spec, false, options);
    expect(result.ok).toBe(false);
    expect(result.log).toContain("registry");
    expect(registry.requests.length).toBe(before);
  });
});
