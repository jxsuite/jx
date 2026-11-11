/**
 * Document-scripts.test.ts — a document's own client and server modules in a site build (spec.md
 * §23.2, compiler.md §12).
 *
 * One fixture project, built once per bundler backend: a page, the layout wrapping it and a
 * component each carry a client script exporting `bump`, the page and the component carry server
 * scripts too, one script imports a `.ts` file beside its document and another imports a `.jxn`
 * document. What is asserted is what an author relies on: each document's module is its own file,
 * server text reaches the worker and nothing else, and a mistake is named with its file.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { EraseError } from "@jxsuite/erase";
import { isString } from "@jxsuite/schema/guards";
import { serializeJxn } from "@jxsuite/schema/jxn";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";
import { bundleEntry } from "../src/site/bundler";
import {
  CLIENT_MODULE_SUFFIX,
  SERVER_MODULE_SUFFIX,
  documentScripts,
  qualifiedDocument,
  scriptModuleOwner,
  scriptModulePath,
} from "../src/site/document-scripts";
import { buildSite } from "../src/site/site-build";
import { compileElement } from "../src/targets/compile-element";

const ROOT = resolve(import.meta.dir, "__test-document-scripts__");

/** Write a file under a fixture root: text verbatim, a `.jxn` document serialized, else JSON. */
function write(root: string, relPath: string, content: JsonValue | JxDocument): void {
  const abs = resolve(root, relPath);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  let text: string;
  if (isString(content)) {
    text = content;
  } else if (relPath.endsWith(".jxn")) {
    /* SAFETY: every `.jxn` fixture below is written as a document literal. */
    text = serializeJxn(content as JxDocument);
  } else {
    text = JSON.stringify(content, null, 2);
  }
  writeFileSync(abs, text, "utf8");
}

/** Every file under `dir`, as paths relative to it with `/` separators. */
function filesUnder(dir: string, base = dir): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path, base));
    } else {
      found.push(relative(base, path).replaceAll("\\", "/"));
    }
  }
  return found;
}

/** Run `fn` with `JX_BUNDLER` set to a backend, restoring what was there. */
async function withBackend<T>(backend: "bun" | "esbuild", fn: () => Promise<T>): Promise<T> {
  const { JX_BUNDLER: previous } = process.env;
  if (backend === "esbuild") {
    process.env.JX_BUNDLER = "esbuild";
  } else {
    delete process.env.JX_BUNDLER;
  }
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.JX_BUNDLER;
    } else {
      process.env.JX_BUNDLER = previous;
    }
  }
}

const fn = (name: string, extra: Record<string, JsonValue> = {}) => ({
  $export: name,
  $prototype: "Function",
  $src: "#client",
  ...extra,
});

/** The fixture project: three documents each exporting `bump`, two server scripts, two imports. */
function writeProject(root: string): void {
  write(root, "project.json", {
    build: { adapter: "node", format: "directory", minify: false, outDir: "./dist" },
    defaults: { layout: "./layouts/base.json" },
    name: "Document Scripts",
  });

  write(root, "layouts/base.json", {
    $script: {
      client: `export function bump(state: { clicks: number }): void {
  state.clicks += 1;
  console.log("LAYOUT_BUMP");
}
`,
    },
    children: [
      {
        onclick: { $ref: "#/state/layoutBump" },
        tagName: "button",
        textContent: "layout ${state.clicks}",
      },
      { tagName: "slot" },
    ],
    state: { clicks: 0, layoutBump: fn("bump") },
    tagName: "base-layout",
  });

  write(root, "pages/math.ts", `export const step = (n: number): number => n + 2;\n`);
  write(root, "pages/index.json", {
    $elements: [{ $ref: "../components/my-counter.jxn" }],
    $script: {
      client: `import { step } from "./math.ts";

export function bump(state: { count: number }): void {
  state.count = step(state.count);
  console.log("PAGE_BUMP");
}
`,
      server: `export async function history(args: { limit: number }, env: Record<string, string>) {
  return { marker: "PAGE_SERVER_ONLY", limit: args.limit, env: Object.keys(env).length };
}
`,
    },
    children: [
      {
        onclick: { $ref: "#/state/bump" },
        tagName: "button",
        textContent: "page ${state.count}",
      },
      { tagName: "p", textContent: "${state.history?.marker}" },
      { tagName: "my-counter" },
    ],
    state: {
      bump: fn("bump"),
      count: 0,
      history: { $export: "history", $src: "#server", arguments: { limit: 3 }, timing: "server" },
    },
    title: "Home",
  });

  write(root, "lib/shared.jxn", {
    $script: {
      client: `export function clamp(n: number, max: number): number {
  console.log("SHARED_CLAMP");
  return Math.min(n, max);
}
`,
      server: `export const neverBundled = "SHARED_SERVER_ONLY";\n`,
    },
    tagName: "div",
  });

  write(root, "components/my-counter.jxn", {
    $script: {
      client: `import { clamp } from "../lib/shared.jxn";

export function bump(state: { count: number }): void {
  state.count = clamp(state.count + 10, 50);
  console.log("COMPONENT_BUMP");
}

export function later(state: { count: number }): void {
  state.count = 0;
  console.log("COMPONENT_LATER");
}
`,
      server: `export async function stats() {
  return { marker: "COMPONENT_SERVER_ONLY" };
}
`,
    },
    children: [
      {
        onclick: { $ref: "#/state/bump" },
        tagName: "button",
        textContent: "component ${state.count}",
      },
      {
        onclick: { $ref: "#/state/later" },
        tagName: "button",
        textContent: "reset",
      },
      { tagName: "p", textContent: "${state.stats?.marker}" },
    ],
    state: {
      bump: fn("bump"),
      count: 0,
      later: fn("later", { $lazy: true }),
      stats: { $export: "stats", $src: "#server", timing: "server" },
    },
    tagName: "my-counter",
  });
}

/** The site worker as its bundle exports it. */
interface WorkerModule {
  default: { fetch: (request: Request, env: Record<string, string>) => Promise<Response> };
}

const read = (root: string, path: string) => readFileSync(resolve(root, "dist", path), "utf8");

afterAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
});

describe.each(["bun", "esbuild"] as const)("a site build under the %s backend", (backend) => {
  const root = resolve(ROOT, backend);
  let errors: string[] = [];

  beforeAll(async () => {
    rmSync(root, { force: true, recursive: true });
    writeProject(root);
    ({ errors } = await withBackend(backend, () => buildSite(root, { verbose: false })));
  });

  test("builds without errors", () => {
    expect(errors).toEqual([]);
  });

  test("each document's client module is its own bundle", () => {
    expect(read(root, "assets/pages-index.json.js")).toContain("PAGE_BUMP");
    expect(read(root, "assets/layouts-base.json.js")).toContain("LAYOUT_BUMP");
    expect(read(root, "assets/components-my-counter.jxn.js")).toContain("COMPONENT_BUMP");
    expect(read(root, "assets/pages-index.json.js")).not.toContain("LAYOUT_BUMP");
    expect(read(root, "assets/layouts-base.json.js")).not.toContain("PAGE_BUMP");
  });

  test("a page and its layout keep both modules through the merge", () => {
    const page = filesUnder(resolve(root, "dist"))
      .filter((path) => !path.startsWith("assets/") && !path.startsWith("components/"))
      .map((path) => read(root, path))
      .join("\n");
    expect(page).toContain("/assets/pages-index.json.js");
    expect(page).toContain("/assets/layouts-base.json.js");
  });

  test("an eager and a $lazy function of one script share its bundle", () => {
    const component = read(root, "components/my-counter.js");
    expect(component).toContain("from '/assets/components-my-counter.jxn.js'");
    expect(component).toContain("import('/assets/components-my-counter.jxn.js')");
    expect(read(root, "assets/components-my-counter.jxn.js")).toContain("COMPONENT_LATER");
  });

  test("a script's relative import resolves from its document's directory", () => {
    // `./math.ts` is beside `pages/index.json`, and its TypeScript is gone from the bundle.
    const bundle = read(root, "assets/pages-index.json.js");
    expect(bundle).toContain("n + 2");
    expect(bundle).not.toContain(": number");
  });

  test("a script importing a .jxn document gets that document's client module", () => {
    expect(read(root, "assets/components-my-counter.jxn.js")).toContain("SHARED_CLAMP");
  });

  test("server text is in the worker and in nothing a browser is sent", () => {
    const worker = read(root, "worker.js");
    expect(worker).toContain("PAGE_SERVER_ONLY");
    expect(worker).toContain("COMPONENT_SERVER_ONLY");
    const leaked = filesUnder(resolve(root, "dist"))
      .filter((path) => path !== "worker.js")
      .filter((path) => /_SERVER_ONLY|#server|\$script/.test(read(root, path)));
    expect(leaked).toEqual([]);
  });

  test("the worker answers a document's server function with its arguments and env", async () => {
    // Imported under a name of its own per backend, so the two builds are two modules.
    const mod: WorkerModule = await import(`${resolve(root, "dist/worker.js")}?${backend}`);
    const response = await mod.default.fetch(
      new Request("http://localhost/_jx/server/history", {
        body: JSON.stringify({ limit: 3 }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      { A: "1", B: "2" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ env: 2, limit: 3, marker: "PAGE_SERVER_ONLY" });
  });

  test("nothing is written beside the documents", () => {
    const stray = filesUnder(root).filter(
      (path) => path.endsWith(CLIENT_MODULE_SUFFIX) || path.endsWith(SERVER_MODULE_SUFFIX),
    );
    expect(stray).toEqual([]);
  });
});

/** A project of one page, for a build that is expected to report something. */
function writeSmallProject(
  root: string,
  page: JxDocument,
  project: Record<string, JsonValue> = {},
) {
  rmSync(root, { force: true, recursive: true });
  write(root, "project.json", {
    build: { adapter: "node", format: "directory", outDir: "./dist" },
    name: "Small",
    ...project,
  });
  write(root, "pages/index.json", { title: "Home", ...page });
}

describe("what a build refuses", () => {
  test("two documents exporting one server name, naming both files", async () => {
    const root = resolve(ROOT, "clash");
    const serverPage = (marker: string): JxDocument => ({
      $script: { server: `export async function history() { return "${marker}"; }\n` },
      children: [{ tagName: "p", textContent: "${state.history}" }],
      state: { history: { $export: "history", $src: "#server", timing: "server" } },
      tagName: "main",
    });
    writeSmallProject(root, serverPage("one"));
    write(root, "pages/other.json", { title: "Other", ...serverPage("two") });

    const { errors } = await buildSite(root, { verbose: false });
    const clash = errors.find((error) => error.includes('Server function "history"'));
    expect(clash).toContain("jx-script:pages/index.json#server (declared in pages/index.json)");
    expect(clash).toContain("jx-script:pages/other.json#server (declared in pages/other.json)");
  });

  test("a client function naming the server script", async () => {
    const root = resolve(ROOT, "client-names-server");
    writeSmallProject(root, {
      $script: { server: `export function secret() { return "CLIENT_NAMED_SERVER"; }\n` },
      children: [{ onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "go" }],
      state: { go: { $export: "secret", $prototype: "Function", $src: "#server" } },
      tagName: "main",
    });

    const { errors } = await buildSite(root, { verbose: false });
    expect(errors).toEqual([
      'pages/index.json: a client function names "#server". A server module is called by a ' +
        'timing: "server" entry and never imported by a page',
    ]);
    const shipped = filesUnder(resolve(root, "dist")).filter((path) => path !== "worker.js");
    expect(shipped.filter((path) => read(root, path).includes("CLIENT_NAMED_SERVER"))).toEqual([]);
  });

  test("an entry naming a script its document does not carry", async () => {
    const root = resolve(ROOT, "no-script");
    writeSmallProject(root, {
      children: [{ onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "go" }],
      state: { go: fn("go") },
      tagName: "main",
    });

    const { errors } = await buildSite(root, { verbose: false });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Error bundling sidecar "jx-script:pages/index.json#client"');
    expect(errors[0]).toContain("pages/index.json has no client script");
  });

  test("a script reference in project.json, which has no script", async () => {
    const root = resolve(ROOT, "project-state");
    writeSmallProject(
      root,
      {
        children: [
          { onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "go" },
          { tagName: "p", textContent: "${state.load}" },
        ],
        tagName: "main",
      },
      {
        state: {
          go: fn("go"),
          load: { $export: "load", $src: "#server", timing: "server" },
        },
      },
    );

    const { errors } = await buildSite(root, { verbose: false });
    expect(errors.some((error) => error.startsWith('Server function "load" in project.json'))).toBe(
      true,
    );
    expect(errors.some((error) => error.startsWith('$src "#client" names its own document'))).toBe(
      true,
    );
  });

  test("a specifier that is spelled like a qualified one and names nothing", async () => {
    const root = resolve(ROOT, "malformed");
    writeSmallProject(root, {
      children: [{ onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "go" }],
      state: { go: fn("go", { $src: "jx-script:nowhere" }) },
      tagName: "main",
    });

    const { errors } = await buildSite(root, { verbose: false });
    expect(errors).toEqual(['$src "jx-script:nowhere" is not a document script specifier']);
  });

  test("two documents whose bundles would be one file", async () => {
    const root = resolve(ROOT, "collision");
    const page = (marker: string): JxDocument => ({
      $script: { client: `export function go() { return "${marker}"; }\n` },
      children: [{ onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "go" }],
      state: { go: fn("go") },
      tagName: "main",
    });
    writeSmallProject(root, page("home"));
    write(root, "pages/a-b.json", { title: "Flat", ...page("flat") });
    write(root, "pages/a/b.json", { title: "Nested", ...page("nested") });

    const { errors } = await buildSite(root, { verbose: false });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("Script of pages/a");
    expect(errors[0]).toContain("both map to /assets/pages-a-b.json.js");
  });

  test.each(["bun", "esbuild"] as const)(
    "a client script importing a server script by its specifier (%s)",
    async (backend) => {
      const root = resolve(ROOT, `hand-import-${backend}`);
      writeSmallProject(root, {
        $script: {
          client: `import { secret } from "jx-script:pages/index.json#server";
export function go() { return secret; }
`,
          server: `export const secret = "HAND_IMPORTED_SERVER";\n`,
        },
        children: [{ onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "go" }],
        state: { go: fn("go") },
        tagName: "main",
      });

      const { errors } = await withBackend(backend, () => buildSite(root, { verbose: false }));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(
        "pages/index.json: its server script cannot be imported by code a browser runs",
      );
      expect(existsSync(resolve(root, "dist/assets/pages-index.json.js"))).toBe(false);
    },
  );

  describe.each(["bun", "esbuild"] as const)(
    "TypeScript a browser's loader could not erase (%s)",
    (backend) => {
      test("in a client script, by its document and the place", async () => {
        const root = resolve(ROOT, `compiled-client-${backend}`);
        writeSmallProject(root, {
          $script: {
            client: `export function go(): number {
  return Size.Small;
}
enum Size {
  Small,
}
`,
          },
          children: [{ onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "go" }],
          state: { go: fn("go") },
          tagName: "main",
        });

        const { errors } = await withBackend(backend, () => buildSite(root, { verbose: false }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("pages/index.json/$script/client: `enum` is TypeScript");
        expect(errors[0]).toContain("(line 4, column 1)");
        expect(existsSync(resolve(root, "dist/assets/pages-index.json.js"))).toBe(false);
      });

      test("in a server script, which is held to the same rule", async () => {
        const root = resolve(ROOT, `compiled-server-${backend}`);
        writeSmallProject(root, {
          $script: {
            server: `class Store {
  constructor(private limit: number) {}
}
export async function history() {
  return new Store(3);
}
`,
          },
          children: [{ tagName: "p", textContent: "${state.history}" }],
          state: { history: { $export: "history", $src: "#server", timing: "server" } },
          tagName: "main",
        });

        const { errors } = await withBackend(backend, () => buildSite(root, { verbose: false }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("pages/index.json/$script/server: `private` is TypeScript");
        expect(existsSync(resolve(root, "dist/worker.js"))).toBe(false);
      });

      test("in a document another script imports", async () => {
        const root = resolve(ROOT, `compiled-import-${backend}`);
        writeSmallProject(root, {
          $script: {
            client: `import { size } from "../lib/sizes.jxn";
export function go(): number {
  return size;
}
`,
          },
          children: [{ onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "go" }],
          state: { go: fn("go") },
          tagName: "main",
        });
        write(root, "lib/sizes.jxn", {
          $script: {
            client: "namespace Sizes {\n  export const small = 1;\n}\nexport const size = 1;\n",
          },
          tagName: "div",
        });

        const { errors } = await withBackend(backend, () => buildSite(root, { verbose: false }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("lib/sizes.jxn/$script/client: `namespace` is TypeScript");
      });
    },
  );
});

describe("where a document's module stands", () => {
  test("beside its document, under a suffix that reads back", () => {
    expect(scriptModulePath("/p/components/a.jxn", "client")).toBe(
      "/p/components/a.jxn.jx-client.ts",
    );
    expect(scriptModulePath("/p/components/a.jxn", "server")).toBe(
      "/p/components/a.jxn.jx-server.ts",
    );
    expect(scriptModuleOwner("/p/components/a.jxn.jx-client.ts")).toEqual({
      documentPath: "/p/components/a.jxn",
      side: "client",
    });
    expect(scriptModuleOwner("/p/components/a.jxn.jx-server.ts")).toEqual({
      documentPath: "/p/components/a.jxn",
      side: "server",
    });
    expect(scriptModuleOwner("/p/components/a.ts")).toBeNull();
  });

  test("a document is qualified by its path from the project root", () => {
    const doc: JxDocument = { state: { go: fn("go") }, tagName: "my-el" };
    const qualified = qualifiedDocument(doc, resolve(ROOT, "components/my-el.json"), ROOT);
    expect(qualified.state?.go).toEqual(
      fn("go", { $src: "jx-script:components/my-el.json#client" }),
    );
    expect(doc.state?.go).toEqual(fn("go"));
  });
});

describe("documentScripts", () => {
  const root = resolve(ROOT, "unit");

  beforeAll(() => {
    rmSync(root, { force: true, recursive: true });
    write(root, "a.json", { $script: { client: "export const a = 1;\n" }, tagName: "div" });
    write(root, "broken.json", "{ not json");
    write(root, "lib/dep.ts", `export const dep: string = "DEP";\n`);
    write(root, "lib/b.jxn", {
      $script: { client: `import { dep } from "./dep.ts";\nexport const b = dep;\n` },
      tagName: "div",
    });
  });

  test("module() returns the text and where it stands", async () => {
    const scripts = documentScripts(root);
    expect(await scripts.module("jx-script:a.json#client")).toEqual({
      contents: "export const a = 1;\n",
      path: resolve(root, "a.json.jx-client.ts"),
    });
  });

  test("module() refuses what names no script, each by name", async () => {
    const scripts = documentScripts(root);
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(scripts.module("./a.json")).rejects.toThrow('"./a.json" does not name a document');
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(scripts.module("jx-script:a.json#server")).rejects.toThrow(
      "a.json has no server script",
    );
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(scripts.module("jx-script:missing.json#client")).rejects.toThrow(
      "Cannot read missing.json for its client script",
    );
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(scripts.module("jx-script:broken.json#client")).rejects.toThrow(
      "Cannot read broken.json for its client script",
    );
  });

  test("module() refuses a script that has to be compiled, with every place it does", async () => {
    const scripts = documentScripts(root, () => ({
      $script: { client: "enum A {\n  One,\n}\nenum B {\n  Two,\n}\n" },
    }));
    const refused = await scripts.module("jx-script:lib/x.json#client").catch((error) => error);
    expect(refused).toBeInstanceOf(EraseError);
    expect(refused.site).toEqual({ path: "lib/x.json", pointer: "/$script/client" });
    expect(refused.problems).toHaveLength(2);
    expect(refused.message).toStartWith("lib/x.json/$script/client: `enum` is TypeScript");
  });

  test("a document is read once, with the reader a build passes", async () => {
    const reads: string[] = [];
    const scripts = documentScripts(root, (path) => {
      reads.push(path);
      return { $script: { client: "export {};", server: "export {};" } };
    });
    await scripts.module("jx-script:x.md#client");
    await scripts.module("jx-script:x.md#server");
    expect(reads).toEqual([resolve(root, "x.md")]);
  });

  test.each(["bun", "esbuild"] as const)(
    "a file module importing a .jxn document, by relative and absolute path (%s)",
    async (backend) => {
      const entry = resolve(root, `entry-${backend}.ts`);
      const outfile = resolve(root, `out-${backend}.js`);
      write(
        root,
        `entry-${backend}.ts`,
        `import { b } from "./lib/b.jxn";
import { b as again } from ${JSON.stringify(resolve(root, "lib/b.jxn"))};
export const both = [b, again];
`,
      );
      await withBackend(backend, () =>
        bundleEntry(
          { entryPath: entry, outfile },
          { minify: false, plugins: [documentScripts(root).clientPlugin], target: "browser" },
        ),
      );
      const mod: { both: string[] } = await import(outfile);
      expect(mod.both).toEqual(["DEP", "DEP"]);
    },
  );

  test.each(["bun", "esbuild"] as const)(
    "a bare specifier ending in .jxn is left to the bundler (%s)",
    async (backend) => {
      const entry = resolve(root, `bare-${backend}.ts`);
      write(root, `bare-${backend}.ts`, `import "some-package/x.jxn";\n`);
      const bundling = withBackend(backend, () =>
        bundleEntry(
          { entryPath: entry, outfile: resolve(root, `bare-${backend}.js`) },
          { plugins: [documentScripts(root).clientPlugin], target: "browser" },
        ),
      );
      // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
      await expect(bundling).rejects.toThrow("some-package/x.jxn");
    },
  );

  test.each(["bun", "esbuild"] as const)(
    "a jx-script: import that names no document is the bundler's to report (%s)",
    async (backend) => {
      const entry = resolve(root, `nowhere-${backend}.ts`);
      write(root, `nowhere-${backend}.ts`, `import "jx-script:nowhere";\n`);
      const bundling = withBackend(backend, () =>
        bundleEntry(
          { entryPath: entry, outfile: resolve(root, `nowhere-${backend}.js`) },
          { plugins: [documentScripts(root).clientPlugin], target: "browser" },
        ),
      );
      // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
      await expect(bundling).rejects.toThrow("jx-script:nowhere");
    },
  );

  test.each(["bun", "esbuild"] as const)(
    "a module that is not a file is bundled from its text (%s)",
    async (backend) => {
      // No file is at the entry's path; its import still resolves from that directory.
      const outfile = resolve(root, `virtual-${backend}.js`);
      await withBackend(backend, () =>
        bundleEntry(
          {
            contents: `import { dep } from "./dep.ts";\nexport const seen: string = dep;\n`,
            entryPath: resolve(root, "lib/nothing-here.ts"),
            outfile,
          },
          { minify: false, target: "browser" },
        ),
      );
      const mod: { seen: string } = await import(outfile);
      expect(mod.seen).toBe("DEP");
      expect(existsSync(resolve(root, "lib/nothing-here.ts"))).toBe(false);
    },
  );
});

describe("compileElement and a component's own script", () => {
  const root = resolve(ROOT, "element");
  const seen: string[] = [];
  const rewriteSrc = (specifier: string) => {
    seen.push(specifier);
    return specifier;
  };

  beforeAll(() => {
    rmSync(root, { force: true, recursive: true });
    write(root, "components/my-el.json", {
      $script: { client: "export function go() {}\n" },
      children: [{ onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "go" }],
      state: { go: fn("go") },
      tagName: "my-el",
    });
  });

  test("with a project root, the entry names its document", async () => {
    seen.length = 0;
    await compileElement(resolve(root, "components/my-el.json"), { projectRoot: root, rewriteSrc });
    expect(seen).toEqual(["jx-script:components/my-el.json#client"]);
  });

  test("without one, the $src is passed on as written", async () => {
    seen.length = 0;
    await compileElement(resolve(root, "components/my-el.json"), { rewriteSrc });
    expect(seen).toEqual(["#client"]);
  });
});
