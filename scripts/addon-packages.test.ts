import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as naming from "../packages/compiler-binding/src/triple.ts";
import {
  LOADER_PACKAGES,
  platformFields,
  platformManifest,
  prepare,
  withPlatformDependencies,
} from "./addon-packages.ts";

describe("platformFields", () => {
  test("a Linux triple names its C library, in npm's words", () => {
    expect(platformFields("linux-x64-gnu")).toEqual({
      cpu: ["x64"],
      libc: ["glibc"],
      os: ["linux"],
    });
    expect(platformFields("linux-arm64-musl")).toEqual({
      cpu: ["arm64"],
      libc: ["musl"],
      os: ["linux"],
    });
  });

  test("macOS and Windows have no libc field", () => {
    expect(platformFields("darwin-arm64")).toEqual({ cpu: ["arm64"], os: ["darwin"] });
    expect(platformFields("win32-x64-msvc")).toEqual({ cpu: ["x64"], os: ["win32"] });
  });

  test("something that is not a triple is refused", () => {
    expect(() => platformFields("linux")).toThrow("is not an <os>-<cpu>[-<abi>] triple");
  });
});

test("a platform package ships exactly its addon, with provenance", () => {
  expect(platformManifest("linux-x64-gnu", "1.2.3", naming)).toMatchObject({
    cpu: ["x64"],
    files: ["jx-compiler.linux-x64-gnu.node"],
    libc: ["glibc"],
    main: "jx-compiler.linux-x64-gnu.node",
    name: "@jxsuite/compiler-binding-linux-x64-gnu",
    os: ["linux"],
    publishConfig: { provenance: true },
    version: "1.2.3",
  });
});

test("every released triple becomes an exactly pinned optional dependency, and others are kept", () => {
  const listed = withPlatformDependencies(
    { name: "x", optionalDependencies: { fsevents: "^2" } },
    "1.2.3",
    naming,
  ).optionalDependencies;
  expect(listed).toEqual({
    fsevents: "^2",
    ...Object.fromEntries(
      naming.RELEASE_TRIPLES.map((triple) => [naming.addonPackageName(triple), "1.2.3"]),
    ),
  });
  expect(withPlatformDependencies({ name: "x" }, "1.2.3", naming).optionalDependencies).toEqual(
    Object.fromEntries(
      naming.RELEASE_TRIPLES.map((triple) => [naming.addonPackageName(triple), "1.2.3"]),
    ),
  );
});

describe("prepare", () => {
  let root = "";
  let artifacts = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "jx-addon-packages-"));
    artifacts = join(root, "artifacts");
    mkdirSync(artifacts);
    for (const loader of LOADER_PACKAGES) {
      mkdirSync(join(root, loader), { recursive: true });
      writeFileSync(
        join(root, loader, "package.json"),
        JSON.stringify({ name: loader, version: loader.endsWith("binding") ? "0.4.0" : "9.0.0" }),
      );
    }
  });
  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  test("with every addon present it writes a package per triple and lists them in both loaders", () => {
    for (const triple of naming.RELEASE_TRIPLES) {
      writeFileSync(join(artifacts, naming.addonFileName(triple)), triple);
    }
    const dirs = prepare(artifacts, root, naming);
    expect(dirs).toEqual(
      naming.RELEASE_TRIPLES.map((triple) => `packages/compiler-binding/npm/${triple}`),
    );
    const first = join(root, "packages/compiler-binding/npm/linux-x64-gnu");
    expect(readFileSync(join(first, "jx-compiler.linux-x64-gnu.node"), "utf8")).toBe(
      "linux-x64-gnu",
    );
    const written = readFileSync(join(first, "package.json"), "utf8");
    expect(JSON.parse(written)).toMatchObject({
      name: "@jxsuite/compiler-binding-linux-x64-gnu",
      version: "0.4.0",
    });
    for (const loader of LOADER_PACKAGES) {
      const manifest = JSON.parse(readFileSync(join(root, loader, "package.json"), "utf8"));
      // The binding's version, in the compiler's manifest too: that is the package that exists.
      expect(manifest.optionalDependencies["@jxsuite/compiler-binding-darwin-arm64"]).toBe("0.4.0");
      expect(Object.keys(manifest.optionalDependencies)).toHaveLength(
        naming.RELEASE_TRIPLES.length,
      );
    }
  });

  test("a missing addon stops everything and is named, before any file is written", () => {
    for (const triple of naming.RELEASE_TRIPLES.slice(2)) {
      writeFileSync(join(artifacts, naming.addonFileName(triple)), triple);
    }
    expect(() => prepare(artifacts, root, naming)).toThrow(
      "No addon was built for: linux-x64-gnu, linux-x64-musl",
    );
    expect(existsSync(join(root, "packages/compiler-binding/npm"))).toBe(false);
  });

  test("a binding manifest with no version, or that is not an object, is refused", () => {
    writeFileSync(join(root, "packages/compiler-binding/package.json"), "{}");
    expect(() => prepare(artifacts, root, naming)).toThrow("has no version");
    writeFileSync(join(root, "packages/compiler-binding/package.json"), "[]");
    expect(() => prepare(artifacts, root, naming)).toThrow("is not a JSON object");
  });
});
