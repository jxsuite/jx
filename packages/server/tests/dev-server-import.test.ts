/**
 * The dev server's /__studio/import-site mount: destination containment via assertAccessible and
 * the relative-root translation of the done line. The import pipeline is mocked.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { ImportProgressEvent, ImportSiteOptions } from "@jxsuite/import/run";
import type { JsonObject } from "@jxsuite/schema/types";

const importSite = mock(
  (options: ImportSiteOptions, onProgress?: (e: ImportProgressEvent) => void) => {
    const { outDir } = options;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "project.json"), JSON.stringify({ name: "Imported" }));
    onProgress?.({ phase: "emit", message: "Wrote 1 file" });
    return Promise.resolve({ outDir, pages: [], fileCount: 1, verify: null, warnings: [] });
  },
);
void mock.module("@jxsuite/import/run", () => ({ importSite }));

const { createDevServer } = await import("../src/server");

const FIXTURES = resolve(import.meta.dir, "_dev_server_import_fixtures");

/** Decodes an NDJSON import stream, failing the test on any line that is not a JSON object. */
function parseStreamLines(text: string): JsonObject[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const value: unknown = JSON.parse(line);
      if (!isJsonObject(value)) {
        throw new Error(`Expected an NDJSON object line, got ${line}`);
      }
      return value;
    });
}

/** The options the mocked importSite was last called with. */
function lastImportOptions(): ImportSiteOptions | undefined {
  return importSite.mock.calls.at(-1)?.[0];
}

let server: { port: number | undefined; stop: () => void };
let base: string;

beforeAll(async () => {
  rmSync(FIXTURES, { force: true, recursive: true });
  mkdirSync(FIXTURES, { recursive: true });
  server = await createDevServer({ port: 0, root: FIXTURES, watch: false });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop();
  rmSync(FIXTURES, { force: true, recursive: true });
});

describe("dev server import-site mount", () => {
  test("imports into a root-relative directory and reports a relative root", async () => {
    const res = await fetch(`${base}/__studio/import-site`, {
      body: JSON.stringify({ directory: "imported-site", url: "https://clone.example/" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");

    const text = await res.text();
    const done = parseStreamLines(text).at(-1);
    expect(done?.type).toBe("done");
    // The dev server reports project roots relative to its own root.
    expect(done?.root).toBe("imported-site");
    expect(done?.config).toEqual({ name: "Imported" });

    expect(lastImportOptions()?.outDir).toBe(resolve(FIXTURES, "imported-site"));
  });

  test("imports into an absolute directory chosen directly", async () => {
    // An absolute `directory` is the New Project modal's own choice of destination (as opposed to
    // The historical root-relative shape), vetted the same way a create is rather than resolved
    // Against the server root.
    const dest = resolve(FIXTURES, "abs-dest");
    const res = await fetch(`${base}/__studio/import-site`, {
      body: JSON.stringify({ directory: dest, url: "https://clone.example/" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const done = parseStreamLines(text).at(-1);
    expect(done?.type).toBe("done");
    expect(lastImportOptions()?.outDir).toBe(dest);
  });

  test("rejects a destination outside the server root", async () => {
    const res = await fetch(`${base}/__studio/import-site`, {
      body: JSON.stringify({ directory: "../escape", url: "https://clone.example/" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("outside") });
  });
});
