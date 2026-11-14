import { describe, expect, test } from "bun:test";
import { resolvePrototypes } from "../src/site/prototype-resolver";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JxMutableNode } from "@jxsuite/schema/types";

const FIXTURES = join(import.meta.dir, "_fixtures_proto");

function setup() {
  mkdirSync(FIXTURES, { recursive: true });

  writeFileSync(
    join(FIXTURES, "Multiplier.js"),
    `export class Multiplier {
      constructor(config) { this.a = config.a ?? 1; this.b = config.b ?? 1; }
      async resolve() { return this.a * this.b; }
    }`,
  );

  writeFileSync(
    join(FIXTURES, "Multiplier.class.json"),
    JSON.stringify({
      $defs: { fields: {} },
      $implementation: "./Multiplier.js",
      title: "Multiplier",
    }),
  );

  writeFileSync(
    join(FIXTURES, "NoImpl.class.json"),
    JSON.stringify({
      $defs: {
        fields: { name: { default: "world", identifier: "name", role: "field" } },
        methods: {
          value: {
            getter: { body: "return 'Hello ' + this.name;" },
            identifier: "value",
            role: "accessor",
          },
        },
      },
      title: "NoImpl",
    }),
  );
}

/** Write a class with an `$implementation` into the fixtures, under one name for both files. */
function writeClass(name: string, source: string) {
  writeFileSync(join(FIXTURES, `${name}.js`), source);
  writeFileSync(
    join(FIXTURES, `${name}.class.json`),
    JSON.stringify({ $defs: { fields: {} }, $implementation: `./${name}.js`, title: name }),
  );
}

/** The rejection of a promise that must reject, as an `Error`. */
async function rejection(pending: Promise<object>): Promise<Error> {
  try {
    await pending;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error("expected a rejection");
}

function cleanup() {
  rmSync(FIXTURES, { force: true, recursive: true });
}

// ─── resolvePrototypes ─────────────────────────────────────────────────────

describe("resolvePrototypes", () => {
  test("skips doc without state", async () => {
    const doc: JxMutableNode = { children: [] };
    await resolvePrototypes(doc, {}, "/tmp");
    expect(doc.state).toBeUndefined();
  });

  test("skips builtin prototypes (Function, Array, etc.)", async () => {
    const doc = {
      state: {
        fn: { $prototype: "Function", body: "state.x++" },
        items: { $prototype: "Array", items: [] },
        storage: { $prototype: "LocalStorage", key: "data" },
      },
    };
    await resolvePrototypes(doc, {}, "/tmp");
    expect(doc.state.fn.$prototype).toBe("Function");
    expect(doc.state.items.$prototype).toBe("Array");
    expect(doc.state.storage.$prototype).toBe("LocalStorage");
  });

  test("skips entries without $prototype", async () => {
    const doc = { state: { count: 0, name: "test" } };
    await resolvePrototypes(doc, {}, "/tmp");
    expect(doc.state.count).toBe(0);
    expect(doc.state.name).toBe("test");
  });

  test("skips entries with timing != compiler", async () => {
    const doc = {
      state: {
        clientFn: {
          $prototype: "MyClass",
          $src: "./x.class.json",
          timing: "client",
        },
        serverFn: {
          $prototype: "MyClass",
          $src: "./x.class.json",
          timing: "server",
        },
      },
    };
    await resolvePrototypes(doc, {}, "/tmp");
    expect(doc.state.serverFn.$prototype).toBe("MyClass");
    expect(doc.state.clientFn.$prototype).toBe("MyClass");
  });

  test("skips entries with no $src and no matching import", async () => {
    const doc = {
      imports: {},
      state: { data: { $prototype: "CSVLoader" } },
    };
    await resolvePrototypes(doc, {}, "/tmp");
    expect(doc.state.data.$prototype).toBe("CSVLoader");
  });

  test("resolves $prototype with $src pointing to .class.json", async () => {
    setup();
    try {
      const doc: JxMutableNode = {
        state: {
          result: {
            $prototype: "Multiplier",
            $src: "./Multiplier.class.json",
            a: 6,
            b: 7,
          },
        },
      };
      await resolvePrototypes(doc, { sourcePath: join(FIXTURES, "page.json") }, FIXTURES);
      expect(doc.state?.result).toBe(42);
    } finally {
      cleanup();
    }
  });

  test("resolves $prototype via imports map", async () => {
    setup();
    try {
      const doc: JxMutableNode = {
        imports: { Multiplier: "./Multiplier.class.json" },
        state: {
          result: { $prototype: "Multiplier", a: 3, b: 5 },
        },
      };
      await resolvePrototypes(doc, { sourcePath: join(FIXTURES, "page.json") }, FIXTURES);
      expect(doc.state?.result).toBe(15);
    } finally {
      cleanup();
    }
  });

  test("resolves a self-contained class at build time", async () => {
    setup();
    try {
      const doc: JxMutableNode = {
        state: {
          greeting: { $prototype: "NoImpl", $src: "./NoImpl.class.json" },
          named: { $prototype: "NoImpl", $src: "./NoImpl.class.json", name: "Jx" },
        },
      };
      await resolvePrototypes(doc, { sourcePath: join(FIXTURES, "page.json") }, FIXTURES);
      // Generated from the schema (compiler.md §5.4): the field default, then the config's value.
      expect(doc.state?.greeting).toBe("Hello world");
      expect(doc.state?.named).toBe("Hello Jx");
    } finally {
      cleanup();
    }
  });

  test("resolves from project root when no sourcePath", async () => {
    setup();
    try {
      const doc: JxMutableNode = {
        state: {
          result: {
            $prototype: "Multiplier",
            $src: "./Multiplier.class.json",
            a: 2,
            b: 8,
          },
        },
      };
      await resolvePrototypes(doc, {}, FIXTURES);
      expect(doc.state?.result).toBe(16);
    } finally {
      cleanup();
    }
  });

  test("strips reserved keys from config passed to class", async () => {
    setup();
    try {
      writeFileSync(
        join(FIXTURES, "Echo.js"),
        `export class Echo {
          constructor(config) { this.config = config; }
          async resolve() { return this.config; }
        }`,
      );
      writeFileSync(
        join(FIXTURES, "Echo.class.json"),
        JSON.stringify({
          $defs: { fields: {} },
          $implementation: "./Echo.js",
          title: "Echo",
        }),
      );

      const doc = {
        state: {
          result: {
            $prototype: "Echo",
            $src: "./Echo.class.json",
            customArg: "kept",
            default: "ignored",
            description: "test",
            timing: "compiler",
          },
        },
      };
      await resolvePrototypes(doc, { sourcePath: join(FIXTURES, "page.json") }, FIXTURES);
      expect(doc.state.result.customArg).toBe("kept");
      expect(doc.state.result.$prototype).toBeUndefined();
      expect(doc.state.result.description).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("resolves Markdown via explicit imports", async () => {
    const mdFixtures = join(import.meta.dir, "_fixtures_builtin_md");
    mkdirSync(mdFixtures, { recursive: true });
    writeFileSync(join(mdFixtures, "test.md"), "---\ntitle: Test Page\n---\n\nHello world\n");
    try {
      const doc: JxMutableNode = {
        imports: {
          Markdown: "@jxsuite/parser/Markdown.class.json",
        },
        state: {
          page: {
            $prototype: "Markdown",
            src: "./test.md",
            timing: "compiler",
          },
        },
      };
      await resolvePrototypes(doc, { sourcePath: join(mdFixtures, "page.json") }, mdFixtures);
      const page = doc.state?.page;
      expect(page).toMatchObject({ frontmatter: { title: "Test Page" }, slug: "test" });
      // A non-empty array: the parsed body produced at least one child node.
      expect(page).toHaveProperty("$children", expect.arrayContaining([expect.anything()]));
    } finally {
      rmSync(mdFixtures, { force: true, recursive: true });
    }
  });

  test("resolves MarkdownCollection via explicit imports", async () => {
    const mdFixtures = join(import.meta.dir, "_fixtures_builtin_mdc");
    mkdirSync(mdFixtures, { recursive: true });
    writeFileSync(
      join(mdFixtures, "a.md"),
      "---\ntitle: First\ndate: 2025-01-01\n---\n\nFirst post\n",
    );
    writeFileSync(
      join(mdFixtures, "b.md"),
      "---\ntitle: Second\ndate: 2025-02-01\n---\n\nSecond post\n",
    );
    try {
      const doc: JxMutableNode = {
        imports: {
          MarkdownCollection: "@jxsuite/parser/MarkdownCollection.class.json",
        },
        state: {
          posts: {
            $prototype: "MarkdownCollection",
            src: "./*.md",
            timing: "compiler",
          },
        },
      };
      await resolvePrototypes(doc, { sourcePath: join(mdFixtures, "page.json") }, mdFixtures);
      const posts = doc.state?.posts;
      expect(posts).toBeArray();
      expect(posts).toHaveLength(2);
      const titled = (title: string) =>
        expect.objectContaining({ frontmatter: expect.objectContaining({ title }) });
      expect(posts).toEqual(expect.arrayContaining([titled("First"), titled("Second")]));
    } finally {
      rmSync(mdFixtures, { force: true, recursive: true });
    }
  });

  test("explicit imports override built-in prototype mappings", async () => {
    setup();
    try {
      const doc: JxMutableNode = {
        imports: { MarkdownFile: "./Multiplier.class.json" },
        state: {
          result: { $prototype: "MarkdownFile", a: 4, b: 9 },
        },
      };
      await resolvePrototypes(doc, { sourcePath: join(FIXTURES, "page.json") }, FIXTURES);
      expect(doc.state?.result).toBe(36);
    } finally {
      cleanup();
    }
  });

  test("fails naming the entry when the module does not export the class", async () => {
    setup();
    try {
      writeFileSync(
        join(FIXTURES, "WrongExport.js"),
        `export class DifferentName { constructor() {} }`,
      );
      writeFileSync(
        join(FIXTURES, "WrongExport.class.json"),
        JSON.stringify({
          $defs: { fields: {} },
          $implementation: "./WrongExport.js",
          title: "WrongExport",
        }),
      );

      const doc = {
        state: {
          result: {
            $prototype: "WrongExport",
            $src: "./WrongExport.class.json",
            timing: "compiler",
          },
        },
      };
      const error = await rejection(
        resolvePrototypes(doc, { sourcePath: join(FIXTURES, "page.json") }, FIXTURES),
      );
      expect(error.message).toBe(
        'state entry "result" ($prototype "WrongExport"): Module ./WrongExport.js does not export "WrongExport"',
      );
      // The entry is left as authored: nothing was resolved into it.
      expect(doc.state.result.$prototype).toBe("WrongExport");
    } finally {
      cleanup();
    }
  });

  test("reads .value when the class has no resolve()", async () => {
    setup();
    try {
      writeClass(
        "Simple",
        `export class Simple {
          constructor(config) { this.value = config.value ?? "default"; }
        }`,
      );
      const doc: JxMutableNode = {
        state: { result: { $prototype: "Simple", $src: "./Simple.class.json", value: "hello" } },
      };
      await resolvePrototypes(doc, { sourcePath: join(FIXTURES, "page.json") }, FIXTURES);
      expect(doc.state?.result).toBe("hello");
    } finally {
      cleanup();
    }
  });

  test("returns the instance when it has neither resolve() nor value", async () => {
    setup();
    try {
      writeClass(
        "Plain",
        `export class Plain {
          constructor(config) { this.label = config.label; this.count = 2; }
        }`,
      );
      const doc: JxMutableNode = {
        state: {
          result: {
            $prototype: "Plain",
            $src: "./Plain.class.json",
            label: "x",
            timing: "compiler",
          },
        },
      };
      await resolvePrototypes(doc, { sourcePath: join(FIXTURES, "page.json") }, FIXTURES);
      // The instance's own fields are the value, marked so the page strips it once it is baked.
      expect(doc.state?.result).toMatchObject({ count: 2, label: "x", timing: "compiler" });
    } finally {
      cleanup();
    }
  });

  test("one error lists every failing entry", async () => {
    setup();
    try {
      writeClass("Thrower", `export class Thrower { resolve() { throw new Error("no data"); } }`);
      const doc: JxMutableNode = {
        state: {
          fine: { $prototype: "Multiplier", $src: "./Multiplier.class.json", a: 2, b: 3 },
          first: { $prototype: "Thrower", $src: "./Thrower.class.json", timing: "compiler" },
          second: { $prototype: "Ghost", $src: "./Ghost.class.json", timing: "compiler" },
        },
      };
      const error = await rejection(
        resolvePrototypes(doc, { sourcePath: join(FIXTURES, "page.json") }, FIXTURES),
      );
      expect(error.message).toStartWith("2 state entries could not be resolved: ");
      expect(error.message).toContain('"first" ($prototype "Thrower"): no data');
      expect(error.message).toContain('"second" ($prototype "Ghost"): ');
      // The entry that could be resolved was, before the error was thrown.
      expect(doc.state?.fine).toBe(6);
    } finally {
      cleanup();
    }
  });

  test("a compiler-timed entry naming no class fails, a compiler-timed built-in does not", async () => {
    const doc: JxMutableNode = {
      state: {
        feed: { $prototype: "Request", timing: "compiler", url: "/api" },
        g: { $prototype: "Greter", timing: "compiler" },
      },
    };
    const error = await rejection(resolvePrototypes(doc, {}, "/tmp"));
    expect(error.message).toBe(
      'state entry "g" ($prototype "Greter") names no class: give it a $src or an imports ' +
        'entry, or enable the extension that provides "Greter"',
    );
  });

  test("an unset-timing failure suggests timing client", async () => {
    setup();
    try {
      writeClass("Browserly", `export class Browserly { resolve() { return window.name; } }`);
      const doc: JxMutableNode = {
        state: { result: { $prototype: "Browserly", $src: "./Browserly.class.json" } },
      };
      const error = await rejection(
        resolvePrototypes(doc, { sourcePath: join(FIXTURES, "page.json") }, FIXTURES),
      );
      expect(error.message).toStartWith('state entry "result" ($prototype "Browserly"): ');
      expect(error.message).toEndWith(' (set "timing": "client" if it must run in the browser)');
    } finally {
      cleanup();
    }
  });

  test("asInitialValues writes each value as the entry's default", async () => {
    setup();
    try {
      writeClass("Nothing", `export class Nothing { resolve() { return undefined; } }`);
      const doc: JxMutableNode = {
        state: {
          empty: { $prototype: "Nothing", $src: "./Nothing.class.json", timing: "compiler" },
          result: { $prototype: "Multiplier", $src: "./Multiplier.class.json", a: 6, b: 7 },
        },
      };
      await resolvePrototypes(doc, { sourcePath: join(FIXTURES, "c.json") }, FIXTURES, {
        asInitialValues: true,
      });
      // A component starts from the value, so it stays a state entry; no value starts at null.
      expect(doc.state).toEqual({ empty: { default: null }, result: { default: 42 } });
    } finally {
      cleanup();
    }
  });

  test("returns the entries it replaced", async () => {
    setup();
    try {
      const doc: JxMutableNode = {
        state: {
          count: 0,
          kept: { $prototype: "Unmapped" },
          result: { $prototype: "Multiplier", $src: "./Multiplier.class.json", a: 2, b: 2 },
        },
      };
      const replaced = await resolvePrototypes(
        doc,
        { sourcePath: join(FIXTURES, "page.json") },
        FIXTURES,
      );
      expect(replaced).toEqual({ result: 4 });
      expect(await resolvePrototypes({ children: [] }, {}, FIXTURES)).toEqual({});
    } finally {
      cleanup();
    }
  });
});

process.on("exit", () => {
  try {
    cleanup();
  } catch {}
});
