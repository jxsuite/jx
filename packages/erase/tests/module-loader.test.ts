/** The browser's module loader (`spec.md` §23.2): TypeScript fetched, erased and imported. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eraseModule } from "../src/index.ts";
import { isString } from "@jxsuite/schema/guards";
import { loadModule } from "../src/browser.ts";
import type { ModuleLoadOptions } from "../src/browser.ts";
import { importsOf } from "../src/module-loader.ts";

/** What the origin under test answers, by URL: a module's text, or a whole response. */
const served = new Map<string, string | (() => Response)>();

/** Every URL fetched, in order. */
const fetches: string[] = [];

/** A directory of real files, for what the loader leaves the host to import. */
let disk = "";

/** A site of its own for each test, so nothing one test loaded is cached for the next. */
let sites = 0;
function site(): string {
  sites += 1;
  return `http://site.test/s${sites}/`;
}

/** How many times one URL was fetched. */
function fetchesOf(url: string): number {
  return fetches.filter((fetched) => fetched === url).length;
}

/** A document holding a client script, as a host serves it. */
function documentWith(client: string): string {
  return JSON.stringify({ $script: { client }, tagName: "div" });
}

/**
 * Load a module for the exports its test wrote into it.
 *
 * @param specifier What to load.
 * @param options The host's base and package resolver.
 */
async function load<Exports>(specifier: string, options?: ModuleLoadOptions): Promise<Exports> {
  /* SAFETY: each test serves the module it loads, so it knows what that module exports. */
  return (await loadModule(specifier, options)) as Exports;
}

/** The text of every module the loader has made importable, oldest first. */
const blobs: Blob[] = [];

beforeAll(() => {
  disk = mkdtempSync(join(tmpdir(), "jx-module-loader-"));
  // Written before anything is imported from here: Bun reads a directory once.
  writeFileSync(join(disk, "plain.js"), "export const plain = 7;");
  writeFileSync(join(disk, "pkg.js"), "export const version = 3;");
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL("http://page.test/app/"),
  });
  /* SAFETY: the loader calls `fetch(url)` and nothing else of it, so the one call signature this
     answers is all of `fetch` that is used; its static members are never read. */
  spyOn(globalThis, "fetch").mockImplementation(((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    fetches.push(url);
    const answer = served.get(url);
    if (answer === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(
      isString(answer)
        ? new Response(answer, { headers: { "Content-Type": "text/javascript" } })
        : answer(),
    );
  }) as typeof fetch);
  const createObjectURL = URL.createObjectURL.bind(URL);
  spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
    if (blob instanceof Blob) {
      blobs.push(blob);
    }
    return createObjectURL(blob);
  });
});

afterAll(() => {
  rmSync(disk, { force: true, recursive: true });
});

describe("eraseModule", () => {
  test("types go and imports and exports stay, in the same places", () => {
    const text = [
      'import { tax } from "./tax.ts";',
      'import type { Row } from "./row.ts";',
      "export function total(rows: Row[]): number {",
      "  return rows.reduce((sum: number, row) => sum + tax(row.price as number), 0);",
      "}",
    ].join("\n");
    const { code, problems } = eraseModule(text);
    expect(problems).toEqual([]);
    expect(code).toHaveLength(text.length);
    expect(code.split("\n")).toHaveLength(5);
    expect(code).toContain('import { tax } from "./tax.ts";');
    expect(code).not.toContain("Row");
    expect(code).toContain("export function total(rows       )         {");
  });

  test("TypeScript that has to be compiled is a problem naming a script", () => {
    const { problems } = eraseModule("export const a = 1;\nenum Colour { Red }");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ column: 1, kind: "unsupported", line: 2 });
    expect(problems[0]?.message).toContain("`enum` is TypeScript that has to be compiled");
    expect(problems[0]?.message).toContain("A script may use only types that can be removed");
  });

  test("one text is erased once", () => {
    const text = "export const n: number = 1;";
    expect(eraseModule(text)).toBe(eraseModule(text));
  });
});

describe("importsOf", () => {
  /** The specifiers found in some code. */
  const specifiers = (code: string): string[] => importsOf(code).map((found) => found.specifier);

  test("every static form is found, in order", () => {
    const code = [
      'import "./effect.ts";',
      'import one from "./one.ts";',
      "import two, { a as b } from './two.ts';",
      'import three, * as all from "./three.ts";',
      'import * as four from "./four.ts";',
      "import {",
      "  five,",
      '} from "./five.ts";',
      'export { six } from "./six.ts";',
      'export * from "./seven.ts";',
      'export * as eight from "./eight.ts";',
      'export * as "nine" from "./nine.ts"; import ten from "./ten.ts"',
    ].join("\n");
    expect(specifiers(code)).toEqual([
      "./effect.ts",
      "./one.ts",
      "./two.ts",
      "./three.ts",
      "./four.ts",
      "./five.ts",
      "./six.ts",
      "./seven.ts",
      "./eight.ts",
      "./nine.ts",
      "./ten.ts",
    ]);
  });

  test("an import() of one string literal is found, and a computed one is left alone", () => {
    const code = [
      'const a = await import("./a.ts");',
      "const b = import( './b.ts' , { with: {} });",
      'const c = import("./c-" + name + ".ts");',
      "const d = import(name);",
      "const e = import(`./e.ts`);",
    ].join("\n");
    expect(specifiers(code)).toEqual(["./a.ts", "./b.ts"]);
  });

  test("each import is where its string literal is", () => {
    const code = 'import a from "./a.ts";';
    const [found] = importsOf(code);
    expect(code.slice(found?.start, found?.end)).toBe('"./a.ts"');
  });

  test("what only looks like an import is not one", () => {
    const code = [
      '// import a from "./comment.ts"',
      "/* import b from './block.ts' */",
      "const text = \"import c from './string.ts'\";",
      'const other = `import("./template.ts")`;',
      'loader.import("./method.ts");',
      'const $import = (name) => name; $import("./identifier.ts");',
      "export const important = 1;",
    ].join("\n");
    expect(specifiers(code)).toEqual([]);
  });

  test("a string that never closes ends the search without an import", () => {
    expect(specifiers('import a from "./never.ts')).toEqual([]);
  });
});

describe("loadModule", () => {
  test("a .ts module runs with its types erased and its relative .ts imports loaded", async () => {
    const root = site();
    served.set(
      `${root}lib/cart.ts`,
      [
        'import { withTax } from "./tax.ts";',
        "export function total(prices: number[]): number {",
        "  return prices.reduce((sum: number, price) => sum + withTax(price), 0);",
        "}",
      ].join("\n"),
    );
    served.set(`${root}lib/tax.ts`, "export const withTax = (price: number): number => price * 2;");
    const cart = await load<{
      total: (prices: number[]) => number;
    }>(`${root}lib/cart.ts`);
    expect(cart.total([1, 2])).toBe(6);
  });

  test("a module imported from two places is fetched once and is one module", async () => {
    const root = site();
    served.set(
      `${root}entry.ts`,
      [
        'import { bump as left } from "./left.ts";',
        'import { bump as right } from "./right.ts";',
        'export { count } from "./shared.ts";',
        "export const run = (): void => { left(); right(); };",
      ].join("\n"),
    );
    served.set(`${root}left.ts`, 'export { bump } from "./shared.ts";');
    served.set(`${root}right.ts`, 'export { bump } from "./shared.ts";');
    served.set(
      `${root}shared.ts`,
      "let n: number = 0;\nexport const bump = (): void => { n += 1; };\nexport const count = (): number => n;",
    );
    const entry = await load<{
      count: () => number;
      run: () => void;
    }>("./entry.ts", { base: root });
    entry.run();
    expect(entry.count()).toBe(2);
    expect(fetchesOf(`${root}shared.ts`)).toBe(1);

    // Loaded again, by another document, it is the same module and nothing is fetched.
    const before = fetches.length;
    expect(await loadModule(`${root}entry.ts`)).toBe(entry);
    const shared = await load<{ count: () => number }>(`${root}shared.ts`);
    expect(shared.count()).toBe(2);
    expect(fetches).toHaveLength(before);
  });

  test("two loads at once share every module", async () => {
    const root = site();
    served.set(`${root}a.ts`, 'export { token } from "./both.ts";');
    served.set(`${root}b.ts`, 'export { token } from "./both.ts";');
    served.set(`${root}both.ts`, "export const token: object = {};");
    const [a, b] = await Promise.all([
      load<{ token: object }>(`${root}a.ts`),
      load<{ token: object }>(`${root}b.ts`),
    ]);
    expect(a.token).toBe(b.token);
    expect(fetchesOf(`${root}both.ts`)).toBe(1);
  });

  test("a module is named for the debugger by where it was authored", async () => {
    const root = site();
    served.set(`${root}named.ts`, "export const one: number = 1;");
    await loadModule(`${root}named.ts`);
    const text = await blobs.at(-1)?.text();
    expect(text).toBe(`export const one         = 1;\n//# sourceURL=${root}named.ts`);
  });

  test("a document's client script is read from the document a specifier names", async () => {
    const root = site();
    served.set(
      `${root}components/counter.json`,
      documentWith(
        'import { step } from "./step.ts";\nexport const bump = (n: number): number => n + step;',
      ),
    );
    served.set(`${root}components/step.ts`, "export const step: number = 5;");
    const counter = await load<{ bump: (n: number) => number }>(
      "jx-script:components/counter.json#client",
      {
        base: root,
      },
    );
    // Its relative import resolved from the document's directory.
    expect(counter.bump(1)).toBe(6);
    expect(await blobs.at(-1)?.text()).toEndWith(
      `//# sourceURL=${root}components/counter.json.jx-client.ts`,
    );
  });

  test("each document's script is its own module, however its exports are named", async () => {
    const root = site();
    served.set(`${root}a.json`, documentWith('export const name: string = "a";'));
    served.set(`${root}b.json`, documentWith('export const name: string = "b";'));
    const a = await load<{ name: string }>("jx-script:a.json#client", { base: root });
    const b = await load<{ name: string }>("jx-script:b.json#client", { base: root });
    expect([a.name, b.name]).toEqual(["a", "b"]);
  });

  test("a project path and a URL naming one document are one module", async () => {
    const root = site();
    served.set(`${root}pages/index.json`, documentWith("export const token: object = {};"));
    const byPath = await loadModule("jx-script:pages/index.json#client", { base: root });
    const byUrl = await loadModule(`jx-script:${root}pages/index.json#client`);
    expect(byUrl).toBe(byPath);
    expect(fetchesOf(`${root}pages/index.json`)).toBe(1);
  });

  test("a .jxn import is that document's client script", async () => {
    const root = site();
    served.set(`${root}entry.ts`, 'export { greeting } from "./hello.jxn";');
    served.set(`${root}hello.jxn`, documentWith('export const greeting: string = "hi";'));
    const entry = await load<{ greeting: string }>(`${root}entry.ts`);
    expect(entry.greeting).toBe("hi");
  });

  test("an import of anything else is left to the browser, at the URL it meant", async () => {
    const root = pathToFileURL(`${disk}/`).href;
    served.set(
      `${root}lib/entry.ts`,
      'import { plain } from "../plain.js";\nexport const doubled: number = plain * 2;',
    );
    const entry = await load<{ doubled: number }>(`${root}lib/entry.ts`);
    expect(entry.doubled).toBe(14);
    expect(await blobs.at(-1)?.text()).toStartWith(`import { plain } from "${root}plain.js";`);

    // And a specifier that is no TypeScript at all is imported as it is.
    const plain = await load<{ plain: number }>("./plain.js", { base: root });
    expect(plain.plain).toBe(7);
  });

  test("a package import goes where the host serves packages", async () => {
    const root = site();
    const asked: string[] = [];
    const resolveNpm = (name: string): string => {
      asked.push(name);
      return pathToFileURL(join(disk, "pkg.js")).href;
    };
    served.set(
      `${root}uses.ts`,
      'import { version } from "some-pkg/sub";\nexport const seen: number = version;',
    );
    const uses = await load<{ seen: number }>(`${root}uses.ts`, { resolveNpm });
    expect(uses.seen).toBe(3);

    // The scheme a $src spells a package with is not part of its name.
    const direct = await load<{ version: number }>("npm:some-pkg", { resolveNpm });
    expect(direct.version).toBe(3);
    expect(asked).toEqual(["some-pkg/sub", "some-pkg/sub", "some-pkg"]);
  });

  test("a package import with no host to serve it says what would", async () => {
    const root = site();
    served.set(`${root}needs.ts`, 'import { z } from "zod";\nexport const schema = z;');
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule(`${root}needs.ts`)).rejects.toThrow(
      `${root}needs.ts imports "zod", a package, and this page has nothing that serves one`,
    );
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule(`${root}needs.ts`, { resolveNpm: null })).rejects.toThrow(
      "setNpmModuleResolver",
    );
  });

  test("modules that import each other are refused by name", async () => {
    const root = site();
    served.set(`${root}entry.ts`, 'export { a } from "./a.ts";');
    served.set(`${root}a.ts`, 'import { b } from "./b.ts";\nexport const a = (): number => b();');
    served.set(`${root}b.ts`, 'import { a } from "./a.ts";\nexport const b = (): number => a();');
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule(`${root}entry.ts`)).rejects.toThrow(
      `import each other in a cycle, which a page that interprets a document cannot load: ` +
        `${root}a.ts → ${root}b.ts → ${root}a.ts`,
    );
    // A module that imports itself is the shortest one.
    served.set(`${root}self.ts`, 'import * as self from "./self.ts";\nexport const me = self;');
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule(`${root}self.ts`)).rejects.toThrow(`${root}self.ts → ${root}self.ts`);
  });

  test("a server script is never loaded", async () => {
    const root = site();
    served.set(
      `${root}page.json`,
      documentWith('export { secret } from "jx-script:page.json#server";'),
    );
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule("jx-script:page.json#server", { base: root })).rejects.toThrow(
      "page.json: its server script cannot be imported by code a browser runs",
    );
    expect(fetches).not.toContain(`${root}page.json`);
    // Nor by a client script that asks for it.
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule("jx-script:page.json#client", { base: root })).rejects.toThrow(
      "its server script cannot be imported",
    );
  });

  test("a specifier that names no script says so", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule("jx-script:page.json")).rejects.toThrow(
      '"jx-script:page.json" does not name a document\'s script',
    );
  });

  test("TypeScript that cannot be erased names the module and the place", async () => {
    const root = site();
    served.set(`${root}colours.ts`, "export const a = 1;\n  enum Colour { Red }");
    const failure = loadModule(`${root}colours.ts`);
    // oxlint-disable-next-line typescript/await-thenable -- rejects resolves a Promise at runtime.
    await expect(failure).rejects.toBeInstanceOf(SyntaxError);
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(failure).rejects.toThrow(
      `Jx: ${root}colours.ts cannot run: \`enum\` is TypeScript that has to be compiled rather ` +
        `than erased. A script may use only types that can be removed: no enum, value namespace ` +
        `or parameter property (line 2, column 3)`,
    );
  });

  test("a module that is not served fails by name, and is asked for again next time", async () => {
    const root = site();
    served.set(`${root}entry.ts`, 'export { late } from "./late.ts";');
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule(`${root}entry.ts`)).rejects.toThrow(
      `failed to fetch the module ${root}late.ts (404)`,
    );
    served.set(`${root}late.ts`, "export const late: boolean = true;");
    const entry = await load<{ late: boolean }>(`${root}entry.ts`);
    expect(entry.late).toBe(true);
    expect(fetchesOf(`${root}late.ts`)).toBe(2);
    expect(fetchesOf(`${root}entry.ts`)).toBe(1);
  });

  test("a host that answers a missing path with its page is not read as a module", async () => {
    const root = site();
    served.set(
      `${root}spa.ts`,
      () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }),
    );
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule(`${root}spa.ts`)).rejects.toThrow(
      `${root}spa.ts returned HTML, not a module`,
    );
  });

  test("a document that cannot give a client script says why", async () => {
    const root = site();
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule("jx-script:gone.json#client", { base: root })).rejects.toThrow(
      `failed to fetch the document ${root}gone.json (404)`,
    );
    served.set(`${root}raw.jxn`, "div\n  script\n    export const a = 1");
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule("jx-script:raw.jxn#client", { base: root })).rejects.toThrow(
      `${root}raw.jxn did not answer with JSON`,
    );
    for (const [name, text] of [
      ["none.json", JSON.stringify({ tagName: "div" })],
      ["server-only.json", JSON.stringify({ $script: { server: "export {}" } })],
      ["list.json", "[]"],
    ] as const) {
      served.set(`${root}${name}`, text);
      // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
      await expect(loadModule(`jx-script:${name}#client`, { base: root })).rejects.toThrow(
        `${root}${name} has no client script`,
      );
    }
  });

  test("text the host holds is used, and nothing is fetched for it", async () => {
    const root = site();
    served.set(`${root}lib/step.ts`, "export const step: number = 2;");
    // A document that was never at a URL: an address of the host's own making.
    const specifier = `jx-script:${root}lib/#jx-inline-1#client`;
    const inline = await load<{ twice: number }>(specifier, {
      text: 'import { step } from "./step.ts";\nexport const twice: number = step * 2;',
    });
    expect(inline.twice).toBe(4);
    expect(fetches.filter((url) => url.startsWith(root))).toEqual([`${root}lib/step.ts`]);
    expect(await blobs.at(-1)?.text()).toEndWith(
      `//# sourceURL=${root}lib/#jx-inline-1.jx-client.ts`,
    );
  });

  test("the same text again is the same module, and different text replaces it", async () => {
    const root = site();
    const specifier = `jx-script:${root}page.json#client`;
    const first = await loadModule(specifier, { text: "export const made: object = {};" });
    expect(await loadModule(specifier, { text: "export const made: object = {};" })).toBe(first);
    // Without text the module already made is what answers: nothing is fetched to check it.
    expect(await loadModule(specifier)).toBe(first);
    const edited = await load<{ made: number }>(specifier, {
      text: "export const made: number = 2;",
    });
    expect(edited.made).toBe(2);
    expect(fetchesOf(`${root}page.json`)).toBe(0);
  });

  test("handed text that cannot be erased fails, and what replaces it runs", async () => {
    const root = site();
    const specifier = `jx-script:${root}broken.json#client`;
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(loadModule(specifier, { text: "enum Size { Small }" })).rejects.toThrow(
      `${root}broken.json.jx-client.ts cannot run`,
    );
    const mended = await load<{ size: string }>(specifier, {
      text: 'export const size: string = "small";',
    });
    expect(mended.size).toBe("small");
  });

  test("with no base, a path is relative to the page", async () => {
    served.set("http://page.test/app/local.ts", "export const here: boolean = true;");
    const local = await load<{ here: boolean }>("./local.ts");
    expect(local.here).toBe(true);
  });
});
