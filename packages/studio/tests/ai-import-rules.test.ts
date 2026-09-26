/**
 * What Studio may import from `@jxsuite/ai`.
 *
 * Studio is a CLIENT of the assistant's wire, never a server of it. Three subpaths exist for the
 * other side: `./gateway` (the chat and models routes a backend serves), and, as they land,
 * `./providers` (the upstream provider adapters a gateway calls) and `./testing` (the conformance
 * kit and fakes a backend's tests run). Reaching any of them from `packages/studio/src` would ship
 * server code in the page bundle, or let the client grow a second copy of a normalizer the gateway
 * is supposed to own alone, so the rule is structural rather than a review note: this suite scans
 * every Studio source file for an import of them, however it is written.
 *
 * @module @jxsuite/studio/tests
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const STUDIO_DIR = resolve(import.meta.dir, "..");
const SRC = join(STUDIO_DIR, "src");

/** The `@jxsuite/ai` subpaths Studio must never import. */
const FORBIDDEN_SUBPATHS = ["gateway", "providers", "testing"] as const;

/**
 * An import of a forbidden subpath: by package specifier (`@jxsuite/ai/gateway`, or a deeper path
 * under it) or by a relative path into the package's sources (`../../ai/src/gateway/chat.ts`).
 * Every way a module is reached counts, because each one pulls the module in: `from`, a bare
 * side-effect `import`, `export ... from`, a dynamic `import()` (which is also how a JSDoc type
 * query is written) and `require()`. A MENTION in prose (this sentence, a comment naming the rule)
 * is not an import and does not match.
 */
const FORBIDDEN_IMPORT = new RegExp(
  String.raw`(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["'\`]` +
    String.raw`(?:@jxsuite/ai|[./]*(?:packages/)?ai/src)/(${FORBIDDEN_SUBPATHS.join("|")})(?:[/.][^"'\`]*)?["'\`]`,
  "g",
);

/** Every TypeScript and JavaScript source under `dir`. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sources(path));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out.toSorted();
}

/** The forbidden imports in `text`, as `<subpath>: <the specifier as written>`. */
function forbiddenImports(text: string): string[] {
  return [...text.matchAll(FORBIDDEN_IMPORT)].map((match) => `${match[1] ?? ""}: ${match[0]}`);
}

describe("Studio imports no server-side @jxsuite/ai subpath", () => {
  const files = sources(SRC);

  it("scans the whole source tree", () => {
    // Non-vacuity: the scan reaches real files, including the ones that import @jxsuite/ai today.
    expect(files.length).toBeGreaterThan(100);
    const importers = files.filter((file) => readFileSync(file, "utf8").includes("@jxsuite/ai/"));
    expect(importers.length).toBeGreaterThan(0);
  });

  it("finds none of @jxsuite/ai/{gateway,providers,testing} in packages/studio/src", () => {
    const hits: string[] = [];
    for (const file of files) {
      for (const hit of forbiddenImports(readFileSync(file, "utf8"))) {
        hits.push(`${relative(STUDIO_DIR, file)}  ${hit}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("the rule fires on every way of writing the import", () => {
  it.each<[string, string, string[]]>([
    ["a named import", `import { createChatHandler } from "@jxsuite/ai/gateway";`, ["gateway"]],
    ["a type import", `import type { Upstream } from '@jxsuite/ai/gateway';`, ["gateway"]],
    ["a side-effect import", `import "@jxsuite/ai/providers";`, ["providers"]],
    ["a re-export", `export * from "@jxsuite/ai/testing";`, ["testing"]],
    ["a dynamic import", "const m = await import(`@jxsuite/ai/gateway`);", ["gateway"]],
    ["a JSDoc type query", `/** @type {import("@jxsuite/ai/testing").Fake} */`, ["testing"]],
    ["a require", `const g = require("@jxsuite/ai/gateway");`, ["gateway"]],
    ["a deeper path", `import { x } from "@jxsuite/ai/gateway/chat.ts";`, ["gateway"]],
    [
      "a relative path into the sources",
      `import { encodeSse } from "../../../ai/src/gateway/sse.ts";`,
      ["gateway"],
    ],
    [
      "a repository-relative path into the sources",
      `import { x } from "../../../../packages/ai/src/providers/index.ts";`,
      ["providers"],
    ],
  ])("%s", (_label, source, subpaths) => {
    expect(forbiddenImports(source).map((hit) => hit.split(":")[0])).toEqual(subpaths);
  });

  it.each<[string, string]>([
    [
      "the client subpaths Studio does use",
      `import { createToolRegistry } from "@jxsuite/ai/tools";`,
    ],
    ["the streaming client", `import type { StreamEvent } from "@jxsuite/ai/streaming-client";`],
    ["a mention in prose", `// The server runs @jxsuite/ai/gateway; Studio never imports it.`],
    ["a similarly named subpath", `import { x } from "@jxsuite/ai/gateways-guide";`],
    ["another package's gateway", `import { x } from "@jxsuite/other/gateway";`],
  ])("but not %s", (_label, source) => {
    expect(forbiddenImports(source)).toEqual([]);
  });
});
