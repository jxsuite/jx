/**
 * The smoke test's install against this checkout: which names are swapped, how a manifest is
 * pinned, and how a workspace is packed. The end-to-end proof is the smoke test itself, which on
 * the release branch's pins failed `installDependencies` with ETARGET before this and passes
 * after.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  jxDependencies,
  packWorkspace,
  pinToTarballs,
  tarballSpec,
} from "../scripts/lib/workspace-tarballs";
import type { Manifest } from "../scripts/lib/workspace-tarballs";

const scratch: string[] = [];

/** A fresh directory, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "jx-tarballs-"));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("jxDependencies", () => {
  test("names every @jxsuite package once, from every section, and nothing else", () => {
    const manifest: Manifest = {
      dependencies: { "@jxsuite/parser": "^4.1.2", lodash: "^4" },
      devDependencies: { "@jxsuite/compiler": "^8.0.0", "@jxsuite/parser": "^4.1.2" },
      optionalDependencies: { "@jxsuite/search": "^0.4.2" },
      peerDependencies: { "@jxsuite/runtime": "^6.0.1" },
    };
    expect(jxDependencies(manifest).toSorted()).toEqual([
      "@jxsuite/compiler",
      "@jxsuite/parser",
      "@jxsuite/runtime",
      "@jxsuite/search",
    ]);
  });

  test("a manifest with no dependencies names none", () => {
    expect(jxDependencies({ name: "empty" })).toEqual([]);
  });
});

describe("tarballSpec", () => {
  test("is a file: spec with forward slashes on every OS", () => {
    expect(tarballSpec(String.raw`C:\scratch\jxsuite-parser-4.1.2.tgz`)).toBe(
      "file:C:/scratch/jxsuite-parser-4.1.2.tgz",
    );
    expect(tarballSpec("/tmp/jxsuite-parser-4.1.2.tgz")).toBe("file:/tmp/jxsuite-parser-4.1.2.tgz");
  });
});

describe("pinToTarballs", () => {
  const tarballs = new Map([
    ["@jxsuite/compiler", "/t/compiler.tgz"],
    ["@jxsuite/parser", "/t/parser.tgz"],
    ["@jxsuite/runtime", "/t/runtime.tgz"],
  ]);

  test("pins each declared package that was packed, and leaves the rest", () => {
    const pinned = pinToTarballs(
      {
        dependencies: { "@jxsuite/parser": "^4.1.2", "@jxsuite/search": "^0.4.2", ms: "^2" },
        devDependencies: { "@jxsuite/compiler": "^8.0.0" },
        name: "smoke",
      },
      tarballs,
    );
    expect(pinned.dependencies).toEqual({
      "@jxsuite/parser": "file:/t/parser.tgz",
      "@jxsuite/search": "^0.4.2",
      ms: "^2",
    });
    expect(pinned.devDependencies).toEqual({ "@jxsuite/compiler": "file:/t/compiler.tgz" });
    expect(pinned.name).toBe("smoke");
  });

  test("overrides every packed package, a transitive one included, with the same spec", () => {
    // The runtime is not declared here, but the packed compiler declares it by a version that may
    // Be the unpublished one, so only an override reaches it.
    const pinned = pinToTarballs(
      { devDependencies: { "@jxsuite/compiler": "^8.0.0" }, overrides: { semver: "7.6.0" } },
      tarballs,
    );
    expect(pinned.overrides).toEqual({
      "@jxsuite/compiler": "file:/t/compiler.tgz",
      "@jxsuite/parser": "file:/t/parser.tgz",
      "@jxsuite/runtime": "file:/t/runtime.tgz",
      semver: "7.6.0",
    });
  });

  test("leaves the manifest it was given unchanged", () => {
    const manifest: Manifest = { dependencies: { "@jxsuite/parser": "^4.1.2" } };
    pinToTarballs(manifest, tarballs);
    expect(manifest).toEqual({ dependencies: { "@jxsuite/parser": "^4.1.2" } });
  });
});

describe("packWorkspace", () => {
  test("returns the absolute path of the tarball the packer wrote", () => {
    const destination = tempDir();
    writeFileSync(join(destination, "older.tgz"), "");
    const tarball = packWorkspace("/ws/parser", destination, (_dir, into) => {
      writeFileSync(join(into, "jxsuite-parser-4.1.2.tgz"), "");
      return { exitCode: 0, output: "" };
    });
    expect(tarball).toBe(join(destination, "jxsuite-parser-4.1.2.tgz"));
    expect(isAbsolute(tarball)).toBe(true);
  });

  test("a packer that fails is an error carrying what it printed", () => {
    const destination = tempDir();
    expect(() =>
      packWorkspace("/ws/parser", destination, () => ({ exitCode: 1, output: "prepare failed\n" })),
    ).toThrow("Packing /ws/parser produced no tarball:\nprepare failed");
  });

  test("a packer that succeeds without writing a tarball is an error too", () => {
    // An older tarball already in the directory must not be taken for this one.
    const destination = tempDir();
    writeFileSync(join(destination, "older.tgz"), "");
    expect(() =>
      packWorkspace("/ws/parser", destination, () => ({ exitCode: 0, output: "" })),
    ).toThrow("produced no tarball");
  });

  test("by default it packs with bun pm pack", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ files: ["index.js"], name: "tarball-probe", version: "1.2.3" }),
    );
    writeFileSync(join(dir, "index.js"), "export {};\n");
    const destination = join(dir, "out");
    mkdirSync(destination);
    const tarball = packWorkspace(dir, destination);
    expect(tarball).toBe(join(destination, "tarball-probe-1.2.3.tgz"));
    expect(existsSync(tarball)).toBe(true);
  });
});
