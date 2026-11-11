/**
 * The Bun plugin that makes a `.jxn` document importable (spec.md §23.2): a test imports a
 * document's functions from the document, with no copy of them in a file beside it.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isString } from "@jxsuite/schema/guards";
import { serializeJxn } from "@jxsuite/schema/jxn";
import type { JxDocument } from "@jxsuite/schema/types";
import { documentModuleText, documentScriptsPlugin } from "../src/site/bun-plugin.ts";

const ROOT = resolve(import.meta.dir, "__test-bun-plugin__");

function write(path: string, content: JxDocument | string) {
  const file = resolve(ROOT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, isString(content) ? content : serializeJxn(content));
}

beforeAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
  write(
    "lib/math.ts",
    `export const clamp = (n: number, max: number): number => Math.min(n, max);\n`,
  );
  write("lib/shared.jxn", {
    $script: { client: `export const LIMIT: number = 10;\n` },
    tagName: "div",
  });
  write("components/my-counter.jxn", {
    $script: {
      client: `import { clamp } from "../lib/math.ts";
import { LIMIT } from "../lib/shared.jxn";

export function bump(state: { count: number }, by: number): void {
  state.count = clamp(state.count + by, LIMIT);
}
`,
      server: `export async function history(args: { limit: number }): Promise<string> {
  return \`last \${args.limit}\`;
}
`,
    },
    tagName: "my-counter",
  });
  write("components/plain.jxn", { tagName: "plain-el" });
});

afterAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
});

describe("importing a .jxn document under Bun", () => {
  test("the plugin is the one this file registered on import", () => {
    expect(documentScriptsPlugin.name).toBe("jx-document-scripts");
  });

  test("is importing its client module, with that module's own imports", async () => {
    const mod: { bump: (state: { count: number }, by: number) => void } = await import(
      resolve(ROOT, "components/my-counter.jxn")
    );
    const state = { count: 8 };
    mod.bump(state, 1);
    expect(state.count).toBe(9);
    mod.bump(state, 5);
    expect(state.count).toBe(10);
  });

  test("with ?server, is importing its server module", async () => {
    const mod: { history: (args: { limit: number }) => Promise<string> } = await import(
      `${resolve(ROOT, "components/my-counter.jxn")}?server`
    );
    expect(await mod.history({ limit: 3 })).toBe("last 3");
  });

  test("a document with no script for the side says so, by path", async () => {
    const plain = resolve(ROOT, "components/plain.jxn");
    expect(() => documentModuleText(plain)).toThrow(`${plain} has no client script`);
    expect(() => documentModuleText(`${plain}?server`)).toThrow(`${plain} has no server script`);
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(import(plain)).rejects.toThrow("has no client script");
  });
});
