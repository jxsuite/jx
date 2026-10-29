import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  anyNowInstalled,
  buildExtensionsPayload,
  buildInstalledExtensionRegistry,
  buildProjectExtensionRegistry,
  createNodeFormatIO,
  importImplementation,
  missingExtensionsNotice,
  probeExtension,
  unknownFormatError,
} from "../src/site/format-host";
import { installWorkspaceExtension } from "@jxsuite/test-support/install-extension";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonObject } from "@jxsuite/schema/types";

describe("unknownFormatError", () => {
  test("names the extensions-based fix", () => {
    const error = unknownFormatError("/site/pages/page.toml", ".toml");
    expect(error.message).toContain('No format class registered for ".toml"');
    expect(error.message).toContain('project.json "extensions"');
  });
});

describe("importImplementation", () => {
  test("falls back from a .js path to its .ts sibling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jx-import-impl-"));
    try {
      writeFileSync(join(dir, "mod.ts"), "export const hello = 42;\n");
      // Pass the .js path: the first candidate fails, the .ts sibling resolves.
      const mod = await importImplementation(join(dir, "mod.js"));
      expect(mod).toHaveProperty("hello", 42);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("falls back from a src/ .js path to the built module in dist/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jx-import-impl-"));
    try {
      mkdirSync(join(dir, "dist"));
      writeFileSync(join(dir, "dist", "mod.js"), "export const hello = 7;\n");
      const mod = await importImplementation(join(dir, "src", "mod.js"));
      expect(mod).toHaveProperty("hello", 7);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /*
   * A descriptor that names its TypeScript source (`"$implementation": "./feed.ts"`) used to make
   * Node look for dist/feed.ts and fail with "Cannot find module", although the build wrote
   * dist/feed.js.
   */
  test("falls back from a src/ .ts path to the built .js module in dist/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jx-import-impl-"));
    try {
      mkdirSync(join(dir, "dist"));
      writeFileSync(join(dir, "dist", "mod.js"), "export const hello = 9;\n");
      const mod = await importImplementation(join(dir, "src", "mod.ts"));
      expect(mod).toHaveProperty("hello", 9);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("a .ts path outside src/ is not guessed at as a .js file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jx-import-impl-"));
    try {
      writeFileSync(join(dir, "mod.js"), "export const hello = 1;\n");
      // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
      await expect(importImplementation(join(dir, "mod.ts"))).rejects.toThrow();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("throws the last error when no candidate resolves", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(importImplementation("/no/such/src/missing.js")).rejects.toThrow();
  });
});

describe("createNodeFormatIO", () => {
  test("resolvePath resolves a bare specifier from the project's own node_modules", () => {
    const root = mkdtempSync(join(tmpdir(), "jx-format-host-"));
    try {
      installWorkspaceExtension(root, "@jxsuite/parser");
      const io = createNodeFormatIO(root);
      const resolved = io.resolvePath(
        join(root, "project.json"),
        "@jxsuite/parser/Markdown.class.json",
      );
      expect(resolved.endsWith("Markdown.class.json")).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("resolvePath never falls back to the host, first-party packages included", () => {
    // The compiler's own graph resolves @jxsuite/parser; a project without it must not.
    const root = mkdtempSync(join(tmpdir(), "jx-format-host-nohost-"));
    try {
      const io = createNodeFormatIO(root);
      expect(() =>
        io.resolvePath(join(root, "project.json"), "@jxsuite/parser/Markdown.class.json"),
      ).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("resolvePath returns an OS-absolute ref unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "jx-format-host-abs-"));
    try {
      const io = createNodeFormatIO(root);
      const absPath = join(root, "somewhere", "Thing.class.json");
      const resolved = io.resolvePath(join(root, "project.json"), absPath);
      expect(resolved).toBe(absPath);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("buildProjectExtensionRegistry", () => {
  test("builds the registry from the project's installed extension", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-ext-reg-"));
    try {
      installWorkspaceExtension(root, "@jxsuite/parser");
      const registry = await buildProjectExtensionRegistry(root, {
        extensions: ["@jxsuite/parser"],
      });
      expect(registry.formats.byExtension(".md")?.name).toBe("Markdown");
      expect(registry.formats.byExtension(".csv")?.name).toBe("Csv");
      expect(registry.byProjectKey("content")?.name).toBe("Content");
      expect(registry.byPathsDiscriminator("contentType")?.name).toBe("Content");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("an empty extensions list yields an empty registry", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-ext-empty-"));
    try {
      const registry = await buildProjectExtensionRegistry(root, {});
      expect(registry.extensions).toHaveLength(0);
      expect(registry.formats.entries).toHaveLength(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("a first-party extension the project has not installed is an error, not a host answer", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-ext-uninstalled-"));
    try {
      // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
      await expect(
        buildProjectExtensionRegistry(root, { extensions: ["@jxsuite/parser"] }),
      ).rejects.toThrow('Extension "@jxsuite/parser" is not resolvable');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("an unresolvable extension is an explicit error, not a silent skip", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-ext-broken-"));
    try {
      // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
      await expect(
        buildProjectExtensionRegistry(root, { extensions: ["@jxsuite/does-not-exist"] }),
      ).rejects.toThrow("is not resolvable");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("buildExtensionsPayload", () => {
  test("pairs each project contribution with its fragment entry schema (parser)", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-ext-payload-"));
    try {
      installWorkspaceExtension(root, "@jxsuite/parser");
      const registry = await buildProjectExtensionRegistry(root, {
        extensions: ["@jxsuite/parser"],
      });
      const payload = buildExtensionsPayload(registry);
      expect(payload).toHaveLength(1);
      const [parser] = payload;
      expect(parser!.specifier).toBe("@jxsuite/parser");
      expect(parser!.name).toBe("@jxsuite/parser");
      expect(parser!.title).toBe("Content & Markdown");
      // Additive classes list: every manifest class with its resolved descriptor path.
      const collection = parser!.classes.find((cls) => cls.name === "ContentCollection");
      expect(collection?.path.endsWith("ContentCollection.class.json")).toBe(true);
      expect(parser!.classes.length).toBeGreaterThanOrEqual(6);
      expect(parser!.contributions).toHaveLength(1);
      const [content] = parser!.contributions;
      expect(content!.className).toBe("Content");
      expect(content!.project).toMatchObject({ key: "content", title: "Content Types" });
      expect(content!.studio).toMatchObject({ settings: { layout: "map", order: 50 } });
      // The entry schema is properties.content of the shipped project fragment.
      const { entrySchema } = content!;
      expect(entrySchema).toMatchObject({ type: "object" });
      const additional = isJsonObject(entrySchema) ? entrySchema.additionalProperties : null;
      const properties = isJsonObject(additional) ? additional.properties : null;
      expect(isJsonObject(properties) ? Object.keys(properties) : null).toEqual([
        // Studio draws a type's options in this order: the four every type has, then the vault options.
        "$elements",
        "format",
        "schema",
        "source",
        "exclude",
        "where",
        "idField",
        "route",
        "indexRoute",
        "links",
        "alerts",
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("degrades to a null entrySchema for unreadable or key-less fragments", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-ext-payload-degrade-"));
    try {
      mkdirSync(join(root, "local-ext"), { recursive: true });
      writeFileSync(
        join(root, "local-ext", "jx-extension.json"),
        JSON.stringify({
          classes: { Guestbook: "./Guestbook.class.json" },
          name: "local-guestbook",
          schemas: { project: "./missing.fragment.schema.json" },
        }),
        "utf8",
      );
      writeFileSync(
        join(root, "local-ext", "Guestbook.class.json"),
        JSON.stringify({
          project: { key: "guestbook" },
          title: "Guestbook",
        }),
        "utf8",
      );
      const registry = await buildProjectExtensionRegistry(root, { extensions: ["./local-ext"] });
      const payload = buildExtensionsPayload(registry);
      expect(payload).toHaveLength(1);
      expect(payload[0]!.title).toBeUndefined();
      expect(payload[0]!.contributions).toEqual([
        {
          className: "Guestbook",
          entrySchema: null,
          project: { key: "guestbook" },
          studio: null,
        },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("flags plain state classes and forwards their stateDefaults hint", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-ext-payload-state-"));
    try {
      installWorkspaceExtension(root, "@jxsuite/connector");
      const registry = await buildProjectExtensionRegistry(root, {
        extensions: ["@jxsuite/connector"],
      });
      const [connector] = buildExtensionsPayload(registry);
      const byName = new Map(connector!.classes.map((cls) => [cls.name, cls]));

      // Plain $prototype targets: state + the descriptor's stateDefaults (specs §10).
      expect(byName.get("TableQuery")).toMatchObject({
        state: true,
        stateDefaults: { timing: "client" },
      });
      // Admission-block classes are not state prototypes.
      expect(byName.get("Data")!.state).toBeUndefined();
      expect(byName.get("Sqlite")!.state).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("classes without a project block contribute nothing", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-ext-payload-formats-"));
    try {
      installWorkspaceExtension(root, "@jxsuite/parser");
      const registry = await buildProjectExtensionRegistry(root, {
        extensions: ["@jxsuite/parser"],
      });
      const [parser] = buildExtensionsPayload(registry);
      const names = parser!.contributions.map((c) => c.className);
      expect(names).not.toContain("Markdown");
      expect(names).not.toContain("Csv");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("probeExtension", () => {
  /**
   * A throwaway project with a hand-built node_modules entry. `exports` is written verbatim so a
   * test can omit the manifest subpath and prove the probe follows the exports map rather than the
   * package directory.
   */
  function fixture(pkg: { name: string; exports?: Record<string, string> } | null): string {
    const root = mkdtempSync(join(tmpdir(), "jx-probe-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "site" }));
    if (pkg) {
      const dir = join(root, "node_modules", ...pkg.name.split("/"));
      mkdirSync(dir, { recursive: true });
      const manifest: JsonObject = { name: pkg.name, version: "1.0.0" };
      if (pkg.exports) {
        manifest.exports = pkg.exports;
      }
      writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
      writeFileSync(join(dir, "jx-extension.json"), JSON.stringify({ name: pkg.name }));
    }
    return root;
  }

  test("reports a package installed in the project", () => {
    const root = fixture({
      exports: { "./jx-extension.json": "./jx-extension.json" },
      name: "@acme/jx-toml",
    });
    try {
      const found = probeExtension(root, "@acme/jx-toml");
      expect(found.project).toBe(true);
      expect(found.manifestPath?.endsWith("jx-extension.json")).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("a package the host resolves but the project has not installed is not installed", () => {
    const root = fixture(null);
    try {
      // @jxsuite/parser is a workspace package, so the compiler's own graph resolves it. The
      // Project's answer is the only one asked.
      expect(probeExtension(root, "@jxsuite/parser")).toEqual({ project: false });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("answers with the project's manifest, not the workspace one", () => {
    const root = fixture({
      exports: { "./jx-extension.json": "./jx-extension.json" },
      name: "@jxsuite/parser",
    });
    try {
      const found = probeExtension(root, "@jxsuite/parser");
      expect(found.project).toBe(true);
      expect(found.manifestPath?.startsWith(root)).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("a package whose exports map omits the manifest does not resolve", () => {
    // Present in node_modules, and its exports map has no "./jx-extension.json" entry. The registry
    // Would throw on this package, so the probe must not report it as available.
    const root = fixture({ exports: { ".": "./index.js" }, name: "@acme/jx-half" });
    try {
      const found = probeExtension(root, "@acme/jx-half");
      expect(found.project).toBe(false);
      expect(found.manifestPath).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("an unknown package does not resolve", () => {
    const root = fixture(null);
    try {
      expect(probeExtension(root, "@acme/nope")).toEqual({ project: false });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("buildInstalledExtensionRegistry", () => {
  test("skips an enabled package the project has not installed, and names it", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-installed-reg-"));
    try {
      installWorkspaceExtension(root, "@jxsuite/connector");
      mkdirSync(join(root, "local-ext"), { recursive: true });
      writeFileSync(
        join(root, "local-ext", "jx-extension.json"),
        JSON.stringify({ classes: {}, name: "local-ext" }),
      );
      const { missing, registry } = await buildInstalledExtensionRegistry(root, {
        extensions: ["@jxsuite/parser", "@jxsuite/connector", "./local-ext"],
      });
      expect(missing).toEqual(["@jxsuite/parser"]);
      // A local extension is never skipped: no install produces it.
      expect(registry.extensions.map((e) => e.specifier)).toEqual([
        "@jxsuite/connector",
        "./local-ext",
      ]);
      expect(registry.formats.byExtension(".md")).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("no config is an empty registry with nothing missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-installed-reg-empty-"));
    try {
      const { missing, registry } = await buildInstalledExtensionRegistry(root);
      expect(missing).toEqual([]);
      expect(registry.extensions).toHaveLength(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("anyNowInstalled", () => {
  test("answers whether a previously missing package resolves now", () => {
    const root = mkdtempSync(join(tmpdir(), "jx-now-installed-"));
    try {
      expect(anyNowInstalled(root, [])).toBe(false);
      installWorkspaceExtension(root, "@jxsuite/feed");
      expect(anyNowInstalled(root, ["@acme/nope", "@jxsuite/feed"])).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("missingExtensionsNotice", () => {
  test("is one sentence naming each package and the fix", () => {
    expect(missingExtensionsNotice(["@jxsuite/parser"])).toBe(
      'project.json enables "@jxsuite/parser", which this project has not installed, so it is ' +
        "not loaded. Install the project's dependencies.",
    );
    const two = missingExtensionsNotice(["a", "b"]);
    expect(two).toContain('"a", "b"');
    expect(two).toContain("they are not loaded");
  });
});
