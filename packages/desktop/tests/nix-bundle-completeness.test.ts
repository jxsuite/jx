/**
 * What the Nix bundle must contain, checked against what the desktop app declares.
 *
 * `package.nix`'s installPhase copies a fixed list of workspace directories and then runs
 *
 *     find $out/lib/jx-studio/node_modules -xtype l -delete
 *
 * To clear the workspace symlinks Bun made for members it did not copy. That line deletes; it does
 * not warn. So a dependency whose directory is not on the copy list is removed from the bundle
 * silently, and nothing fails until a user hits the code path that needs it.
 *
 * It happened. `@jxsuite/parser` moved into `extensions/` with the Extension Framework, the
 * installPhase copied only `packages/`, and `node_modules/@jxsuite/parser ->
 * ../../extensions/parser` dangled and was pruned. Because `packages/schema`'s loader refuses BY
 * DESIGN to read a first-party `@jxsuite/*` schema out of the project's own `node_modules` (that
 * refusal is what stops a stale published core from shadowing the workspace one), it had nowhere
 * left to read the parser's project fragment from. Every project declaring any extension lost its
 * per-project Monaco schemas, and said so only as a stack trace in the desktop log.
 *
 * The check is static — no `nix build`, no network, milliseconds — and it is the one that would
 * have caught it: every `@jxsuite/*` dependency the desktop app declares must live under a
 * directory the installPhase copies.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");

/** The workspace directories `package.nix` copies into `$out/lib/jx-studio`. */
function copiedDirs(): string[] {
  const nix = readFileSync(resolve(REPO, "packages/desktop/package.nix"), "utf8");
  return [...nix.matchAll(/^\s*cp -r (\w+) \$out\/lib\/jx-studio/gm)].map((m) => m[1]!);
}

/** The `@jxsuite/*` packages the desktop app declares as runtime dependencies. */
function declaredJxDeps(): string[] {
  // SAFETY: the desktop package's own committed manifest, whose `dependencies` bun reads as a name -> range map.
  const pkg = JSON.parse(readFileSync(resolve(REPO, "packages/desktop/package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(pkg.dependencies ?? {}).filter((name) => name.startsWith("@jxsuite/"));
}

describe("the Nix bundle ships what the desktop app depends on", () => {
  test("the installPhase copies the packages tree, and not the extensions", () => {
    // The app ships no extension (specs/extensions.md §3), so `extensions/` has nothing to supply.
    const copied = copiedDirs();
    expect(copied).toEqual(expect.arrayContaining(["node_modules", "packages"]));
    expect(copied).not.toContain("extensions");
  });

  test("every declared @jxsuite dependency lives under a copied directory", () => {
    const copied = new Set(copiedDirs());
    const declared = declaredJxDeps();
    // Not vacuous: the app really does declare a set of them.
    expect(declared.length).toBeGreaterThan(5);

    const orphans: string[] = [];
    for (const name of declared) {
      const link = resolve(REPO, "node_modules", name);
      let target: string;
      try {
        // A workspace member is a symlink; anything else is a real install and not our problem.
        target = statSync(link).isDirectory() ? readlinkSync(link) : "";
      } catch {
        continue;
      }
      if (!target) {
        continue;
      }
      /* `../../extensions/parser` → `extensions`. Resolved against the link's own directory
         first, because the link target is only relative on POSIX: Bun makes workspace links as
         JUNCTIONS on Windows, and `readlinkSync` hands those back ABSOLUTE, so trimming `../`
         left a whole `C:\…` path and every workspace dependency was reported an orphan. */
      const [top] = relative(REPO, resolve(dirname(link), target)).split(/[/\\]/);
      if (top && !copied.has(top)) {
        orphans.push(`${name} → ${target} (installPhase never copies "${top}/")`);
      }
    }
    expect(orphans).toEqual([]);
  });
});

/**
 * The bundle is a production install of @jxsuite/desktop's graph, not the workspace's, so anything
 * the app reaches without importing it has to be DECLARED to be installed at all.
 */
describe("the runtime install is the desktop app's production graph", () => {
  const nix = readFileSync(resolve(REPO, "packages/desktop/package.nix"), "utf8");

  test("the shipped node_modules comes from a production install filtered to the desktop app", () => {
    expect(nix).toMatch(/--production \\\s+--filter '@jxsuite\/desktop'/);
  });

  test("the app declares no extension, first-party or not", () => {
    /* A project resolves every extension it enables from its own install, first-party ones
       included (specs/extensions.md §3), so the app carries none of them. Declaring one would put
       it in the production install, where nothing reads it any more, and would invite exactly
       the host resolution the contract forbids. */
    /* SAFETY: every directory under extensions/ is a bun workspace member, and the workspace
       resolver refuses a member whose package.json lacks a string `name`. */
    const extensions = readdirSync(resolve(REPO, "extensions"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map(
        (entry) =>
          (
            JSON.parse(
              readFileSync(resolve(REPO, "extensions", entry.name, "package.json"), "utf8"),
            ) as { name: string }
          ).name,
      );
    expect(extensions.length).toBeGreaterThan(3);
    const declared = new Set(declaredJxDeps());
    expect(extensions.filter((name) => declared.has(name))).toEqual([]);
  });

  test("the backend is bundled at build time and its natives resolved against the installed tree", () => {
    expect(nix).toContain("doInstallCheck = true;");
    expect(nix).toContain("scripts/bundle-backend.ts assets/backend");
    expect(nix).toContain(
      "--jx-backend=$out/lib/jx-studio/packages/desktop/assets/backend/index.js",
    );
    expect(nix).toContain("load.resolve(name)");
    expect(nix).not.toContain("--jx-bun");
  });
});

/**
 * The sharp addon and its libvips get the compiler runtime on their RPATH so they load on NixOS,
 * and which `patchelf` does that decides whether they load at all.
 *
 * Nixpkgs' `patchelf` is 0.15.2 in some revisions and 0.19.2 in others. 0.15.2's `--add-rpath`
 * corrupts `libvips-cpp.so` and the sharp addon: the pristine tarball loads on Electron 43 through
 * 45, the same files after it segfault in libvips' static initializers, and 0.18.0 or 0.19.2 leave
 * a working file. The Nix install check catches it, but only in a full `nix build` that takes
 * minutes, so this holds the line where a stray bare `patchelf` would be written.
 */
describe("sharp's rpath is added with a patchelf that does not corrupt it", () => {
  const nix = readFileSync(resolve(REPO, "packages/desktop/package.nix"), "utf8");

  test("package.nix takes patchelfUnstable and adds the rpath through it", () => {
    expect(nix).toMatch(/^\s*patchelfUnstable,$/m);
    expect(nix).toContain("${patchelfUnstable}/bin/patchelf --add-rpath");
  });

  test("no add-rpath or set-rpath goes through the stdenv's own patchelf", () => {
    // A command position is the start of a line or after `;`/`&&`/`|`, which is where a bare
    // `patchelf` would run; the comment explaining the rule names the flag and is not one.
    const bare = nix
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .filter((line) => /(^|[;&|]\s*|\s)patchelf\s+--(add|set)-rpath/.test(line))
      .filter((line) => !line.includes("${patchelfUnstable}/bin/patchelf"));
    expect(bare).toEqual([]);
  });
});
