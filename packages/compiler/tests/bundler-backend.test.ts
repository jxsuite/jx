/**
 * The two bundler backends, side by side on the same entries: `bundler-backend.bun.ts` (what
 * `#bundler-backend` resolves to under `bun test`) and `bundler-backend.node.ts` (esbuild, what a
 * Node build resolves to). Each is imported by path, so both run here; the property under test is
 * that they produce working bundles that answer the same.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as bunBackend from "../src/site/bundler-backend.bun.ts";
import * as nodeBackend from "../src/site/bundler-backend.node.ts";
import type { BackendBuild } from "../src/site/bundler-backend.ts";
import { bundleToString, resolveBareSpecifier, useNodeFallback } from "../src/site/bundler.ts";

const ROOT = mkdtempSync(join(tmpdir(), "jx-bundler-backend-"));
mkdirSync(join(ROOT, "node_modules/greet-lib"), { recursive: true });
writeFileSync(
  join(ROOT, "node_modules/greet-lib/package.json"),
  JSON.stringify({
    exports: { ".": { browser: "./browser.js", default: "./index.js" } },
    name: "greet-lib",
    type: "module",
  }),
);
writeFileSync(join(ROOT, "node_modules/greet-lib/index.js"), 'export const where = "default";\n');
writeFileSync(join(ROOT, "node_modules/greet-lib/browser.js"), 'export const where = "browser";\n');
writeFileSync(
  join(ROOT, "entry.js"),
  'import { where } from "greet-lib";\nexport const answer = `${where}:${process.env.NODE_ENV}`;\n',
);
writeFileSync(join(ROOT, "broken.js"), "export {  // unterminated\n");

afterAll(() => rmSync(ROOT, { force: true, recursive: true }));

/** What every fixture bundle exports. */
interface FixtureExports {
  answer: string;
}

/** Import a bundle's text as a module and return its exports. */
async function load(code: string, name: string): Promise<FixtureExports> {
  const file = join(ROOT, `${name}-${crypto.randomUUID()}.mjs`);
  writeFileSync(file, code);
  // SAFETY: every bundle here is built from a fixture entry above, each of which exports `answer`.
  return (await import(file)) as FixtureExports;
}

const BACKENDS = [
  ["bun", bunBackend],
  ["esbuild", nodeBackend],
] as const;

function request(entry: BackendBuild["entry"], target: BackendBuild["target"]): BackendBuild {
  return {
    define: { "process.env.NODE_ENV": '"production"' },
    entry,
    external: [],
    minify: false,
    plugins: [],
    target,
  };
}

describe("both backends bundle the same entry to the same behaviour", () => {
  for (const target of ["browser", "node", "workerd"] as const) {
    test(`a file entry, target ${target}`, async () => {
      const answers: unknown[] = [];
      for (const [name, backend] of BACKENDS) {
        const code = await backend.build(request({ path: join(ROOT, "entry.js") }, target));
        const loaded = await load(code, `${name}-${target}`);
        answers.push(loaded.answer);
      }
      expect(answers[0]).toBe(answers[1]);
      expect(answers[0]).toBe(target === "node" ? "default:production" : "browser:production");
    });
  }

  test("export conditions reach both resolvers", async () => {
    for (const [name, backend] of BACKENDS) {
      const code = await backend.build({
        ...request({ path: join(ROOT, "entry.js") }, "node"),
        conditions: ["browser"],
      });
      const loaded = await load(code, `${name}-conditions`);
      expect(loaded.answer).toBe("browser:production");
    }
  });

  test("a source entry resolves from its resolveDir and leaves no transient file behind", async () => {
    const source = 'export { where as answer } from "greet-lib";\n';
    for (const [name, backend] of BACKENDS) {
      const code = await backend.build(request({ resolveDir: ROOT, source }, "browser"));
      const loaded = await load(code, `${name}-source`);
      expect(loaded.answer).toBe("browser");
    }
    expect(readdirSync(ROOT).filter((file) => file.startsWith(".jx-entry-"))).toEqual([]);
  });

  test("a broken entry rejects under both", async () => {
    for (const [, backend] of BACKENDS) {
      const pending = backend.build(request({ path: join(ROOT, "broken.js") }, "browser"));
      // oxlint-disable-next-line typescript/await-thenable -- Bun types `.rejects.toThrow` as void, but it resolves a Promise at runtime; the await is required.
      await expect(pending).rejects.toThrow();
    }
  });

  test("both resolve a bare specifier to the same file, and both throw on a missing one", () => {
    expect(bunBackend.resolveBare("greet-lib", ROOT)).toBe(
      nodeBackend.resolveBare("greet-lib", ROOT),
    );
    expect(() => bunBackend.resolveBare("no-such-lib", ROOT)).toThrow();
    expect(() => nodeBackend.resolveBare("no-such-lib", ROOT)).toThrow();
  });
});

describe("JX_BUNDLER=esbuild under Bun", () => {
  function withEsbuild<T>(run: () => T): T {
    const { JX_BUNDLER: prev } = process.env;
    process.env.JX_BUNDLER = "esbuild";
    try {
      return run();
    } finally {
      if (prev === undefined) {
        delete process.env.JX_BUNDLER;
      } else {
        process.env.JX_BUNDLER = prev;
      }
    }
  }

  test("names esbuild as the backend and resolves through createRequire", () => {
    expect(bunBackend.backendName()).toBe("bun");
    expect(nodeBackend.backendName()).toBe("esbuild");
    expect(useNodeFallback()).toBe(false);
    withEsbuild(() => {
      expect(bunBackend.backendName()).toBe("esbuild");
      expect(useNodeFallback()).toBe(true);
      expect(bunBackend.resolveBare("greet-lib", ROOT)).toBe(
        join(ROOT, "node_modules/greet-lib/index.js"),
      );
    });
  });

  test("bundles with esbuild", async () => {
    const pending = withEsbuild(() =>
      bunBackend.build(request({ path: join(ROOT, "entry.js") }, "browser")),
    );
    // The esbuild output ends in one `export { … }` clause.
    expect(await pending).toContain("export {");
  });
});

describe("bundleToString", () => {
  test("returns the bundle's code for an entry, with the browser define applied", async () => {
    const code = await bundleToString(join(ROOT, "entry.js"), { minify: false, target: "browser" });
    const loaded = await load(code, "to-string");
    expect(loaded.answer).toBe("browser:production");
  });

  test("resolveBareSpecifier answers through the active backend", () => {
    expect(resolveBareSpecifier("greet-lib", ROOT)).toBe(bunBackend.resolveBare("greet-lib", ROOT));
  });
});
