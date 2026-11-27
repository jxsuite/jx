/**
 * Section-push.test.ts — the section-owner push loop (specs/extensions.md §11.1) and the connector
 * class resolver, against the real @jxsuite/connector and a fixture section-owner extension.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildProjectExtensionRegistry } from "../src/site/format-host";
import { pushSectionOwners, resolveConnectorClasses } from "../src/site/section-push";
import type { SectionDeployOptions } from "@jxsuite/schema/format-registry";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import { isString } from "@jxsuite/schema/guards";
import type { JsonObject, ProjectConfig } from "@jxsuite/schema/types";

const TMP = resolve(import.meta.dir, "__test-section-push__");

/** What the fixture's `deploySchema` recorded about one call. */
interface Recorded {
  section: JsonObject;
  config: ProjectConfig;
  options: {
    connection?: string;
    connectors: NonNullable<SectionDeployOptions["connectors"]>;
    dryRun: boolean;
    env: Record<string, string>;
  };
}

declare global {
  /** The fixture's recorder, written by ledger.ts. */
  var __ledger: Recorded[] | undefined;
}

function writeFile(relPath: string, content: string | JsonObject) {
  const abs = resolve(TMP, relPath);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, isString(content) ? content : JSON.stringify(content, null, 2), "utf8");
}

const CONFIG: ProjectConfig = {
  connections: { main: { binding: "DB", databaseId: "uuid", provider: "d1" } },
  extensions: ["@jxsuite/connector", "./ledger-ext"],
  ledger: { note: "hi" },
  name: "Section Push",
};

let registry: ExtensionRegistry;

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  writeFile("ledger-ext/jx-extension.json", {
    classes: { Ledger: "./Ledger.class.json" },
    name: "ledger-ext",
  });
  writeFile("ledger-ext/Ledger.class.json", {
    $defs: {
      methods: {
        deploySchema: {
          identifier: "deploySchema",
          role: "deploySchema",
          scope: "static",
          timing: ["server"],
        },
      },
    },
    $implementation: "./ledger.js",
    project: { key: "ledger" },
    title: "Ledger",
  });
  writeFile(
    "ledger-ext/ledger.ts",
    `export const Ledger = {
  deploySchema(section: Record<string, unknown>, config: unknown, options: Record<string, unknown>) {
    const g = globalThis as { __ledger?: unknown[] };
    (g.__ledger ??= []).push({ section, config, options });
    if (section.fail === true) {
      throw new Error("ledger exploded");
    }
    return {
      steps: [
        { summary: "Create ledger", sql: "create table ledger (id integer)", table: "ledger" },
        { kind: "ledgerIndex", summary: "Index ledger" },
      ],
      warnings: ["ledger warning"],
    };
  },
};
`,
  );
  writeFileSync(resolve(TMP, "project.json"), JSON.stringify(CONFIG), "utf8");
  registry = await buildProjectExtensionRegistry(TMP, CONFIG);
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
  globalThis.__ledger = undefined;
});

describe("resolveConnectorClasses", () => {
  test("honours standins", async () => {
    const own = await resolveConnectorClasses(registry, { standins: false });
    const stood = await resolveConnectorClasses(registry, { standins: true });
    expect(own.d1).toHaveProperty("bindings");
    expect(own.d1).not.toBe(own.sqlite);
    // The stand-in rule: the `d1` connector declares `local: "sqlite"`.
    expect(stood.d1).toBe(stood.sqlite);
  });
});

describe("pushSectionOwners", () => {
  test("an absent or null section contributes nothing", async () => {
    globalThis.__ledger = [];
    const configs: ProjectConfig[] = [
      { ...CONFIG, ledger: undefined },
      { ...CONFIG, ledger: null },
    ];
    for (const config of configs) {
      expect(
        await pushSectionOwners(registry, config, {
          dryRun: true,
          env: {},
          standins: false,
        }),
      ).toEqual([]);
    }
    expect(globalThis.__ledger).toEqual([]);
  });

  test("steps default kind to the section key", async () => {
    const dry = await pushSectionOwners(registry, CONFIG, {
      dryRun: true,
      env: {},
      standins: false,
    });
    expect(dry).toHaveLength(1);
    expect(dry[0]!.section).toBe("ledger");
    expect(dry[0]!.steps.map((step) => step.kind)).toEqual(["ledger", "ledgerIndex"]);
    expect(dry[0]!.warnings).toEqual(["ledger warning"]);
    expect(dry[0]!.applied).toBe(false);
    const real = await pushSectionOwners(registry, CONFIG, {
      dryRun: false,
      env: {},
      standins: false,
    });
    expect(real[0]!.applied).toBe(true);
  });

  test("the owner receives the section, config, env, dryRun, and connectors", async () => {
    globalThis.__ledger = [];
    const env = { A: "1" };
    await pushSectionOwners(registry, CONFIG, { dryRun: true, env, standins: false });
    await pushSectionOwners(registry, CONFIG, {
      connection: "main",
      dryRun: false,
      env,
      standins: true,
    });
    const [first, second] = globalThis.__ledger;
    expect(first!.section).toEqual({ note: "hi" });
    expect(first!.config).toEqual(CONFIG);
    expect(first!.options.env).toEqual(env);
    expect(first!.options.dryRun).toBe(true);
    expect(first!.options).not.toHaveProperty("connection");
    expect(second!.options.connection).toBe("main");
    expect(second!.options.dryRun).toBe(false);
    expect(first!.options.connectors.d1).not.toBe(second!.options.connectors.d1);
    expect(second!.options.connectors.d1).toBe(second!.options.connectors.sqlite);
  });

  test("a throwing owner reports its error", async () => {
    const results = await pushSectionOwners(
      registry,
      { ...CONFIG, ledger: { fail: true } },
      { dryRun: false, env: {}, standins: false },
    );
    expect(results).toEqual([
      { applied: false, error: "ledger exploded", section: "ledger", steps: [], warnings: [] },
    ]);
  });
});
