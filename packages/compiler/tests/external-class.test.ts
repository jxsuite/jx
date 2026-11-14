/**
 * External-class.test.ts — what a site build does with the class a state entry names (compiler.md
 * §3, §5.4): find its descriptor, load the class it means, take its value, and write the module a
 * `timing: "client"` class ships as.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  classEntrySource,
  instantiateAndResolve,
  loadClass,
  locateClass,
  readsBuildContext,
} from "../src/site/external-class";
import type {
  ExternalClassConfig,
  ExternalClassCtor,
  LocatedClass,
} from "../src/site/external-class";
import { buildProjectExtensionRegistry } from "../src/site/format-host";
import { isString } from "@jxsuite/schema/guards";
import type { JsonValue, JxClassDef } from "@jxsuite/schema/types";

const TMP = resolve(import.meta.dir, "__test-external-class__");

/** A self-contained class: a field with a default, and a `value` accessor that reads it. */
const GREETER: JxClassDef = {
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
  $prototype: "Class",
  title: "Greeter",
};

function write(path: string, content: JsonValue | JxClassDef | string): string {
  const full = resolve(TMP, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, isString(content) ? content : JSON.stringify(content), "utf8");
  return full;
}

/** The class a fixture names, located from the project root by `$src`. */
function located(src: string, prototype: string): LocatedClass {
  const found = locateClass({ $prototype: prototype, $src: src }, { projectRoot: TMP });
  if (found === undefined) {
    throw new Error(`Expected ${src} to be located`);
  }
  return found;
}

/** Write a class with an `$implementation`, its module being `source`, and locate it. */
function implemented(name: string, source: string): LocatedClass {
  write(`shapes/${name}.js`, source);
  write(`shapes/${name}.class.json`, {
    $implementation: `./${name}.js`,
    $prototype: "Class",
    title: name,
  });
  return located(`./shapes/${name}.class.json`, name);
}

/** The value a located class resolves to when constructed with `config`. */
async function valueOf(source: LocatedClass, config: ExternalClassConfig = {}): Promise<JsonValue> {
  const resolved = await instantiateAndResolve(await loadClass(source), config);
  return resolved.value;
}

/** The message of a rejection that must happen. */
async function rejectionOf(pending: Promise<ExternalClassCtor>): Promise<string> {
  try {
    await pending;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a rejection");
}

beforeAll(() => {
  rmSync(TMP, { force: true, recursive: true });
  write("package.json", { name: "external-class-fixture", type: "module" });
  write("lib/Greeter.class.json", GREETER);
  write("pages/blog/Local.class.json", { ...GREETER, title: "Local" });
  write("lib/Named.class.json", {
    $implementation: "./named.js",
    $prototype: "Class",
    title: "Named",
  });
  write("lib/named.js", "export class Named { resolve() { return 'named'; } }\n");
  write("lib/Bundled.class.json", {
    $implementation: "./bundled.js",
    $prototype: "Class",
    title: "Bundled",
  });
  write(
    "lib/bundled.js",
    "export default { Bundled: class { resolve() { return 'default'; } } };\n",
  );
  write("lib/Empty.class.json", {
    $implementation: "./empty.js",
    $prototype: "Class",
    title: "Empty",
  });
  write("lib/empty.js", "export const Empty = 'not a class';\n");
  write("lib/Child.class.json", {
    $prototype: "Class",
    extends: { $ref: "./Greeter.class.json" },
    title: "Child",
  });
  write("lib/Context.class.json", {
    $defs: { parameters: { type: { enum: { $ref: "#/$context/content" } } } },
    $implementation: "./named.js",
    $prototype: "Class",
    title: "Context",
  });
  write("lib/broken.class.json", "{ not json");
  // An extension whose manifest names a class, for the registry's turn in the lookup order.
  write("ext/jx-extension.json", { classes: { Manifest: "./Manifest.class.json" }, name: "ext" });
  write("ext/Manifest.class.json", { ...GREETER, title: "Manifest" });
  write("lib/Shadow.class.json", { ...GREETER, title: "Shadow" });
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("locateClass", () => {
  test("resolves a relative $src against the document's directory", () => {
    const found = locateClass(
      { $prototype: "Local", $src: "./Local.class.json" },
      { docDir: resolve(TMP, "pages/blog"), projectRoot: TMP },
    );
    expect(found?.classJsonPath).toBe(resolve(TMP, "pages/blog/Local.class.json"));
    expect(found?.exportName).toBe("Local");
    // With no document directory, the project root is where a relative path starts.
    expect(located("./lib/Greeter.class.json", "Greeter").classJsonPath).toBe(
      resolve(TMP, "lib/Greeter.class.json"),
    );
  });

  test("names the export by $export, then the descriptor's title, then the prototype", () => {
    const src = "./lib/Greeter.class.json";
    const where = { projectRoot: TMP };
    expect(locateClass({ $export: "Other", $prototype: "G", $src: src }, where)?.exportName).toBe(
      "Other",
    );
    expect(locateClass({ $prototype: "G", $src: src }, where)?.exportName).toBe("Greeter");
    write("lib/Untitled.class.json", { $prototype: "Class" });
    expect(
      locateClass({ $prototype: "G", $src: "./lib/Untitled.class.json" }, where)?.exportName,
    ).toBe("G");
  });

  test("reads imports before an enabled extension's manifest class", async () => {
    const registry = await buildProjectExtensionRegistry(TMP, {
      extensions: ["./ext"],
      name: "fixture",
    });
    const fromManifest = locateClass({ $prototype: "Manifest" }, { projectRoot: TMP, registry });
    expect(fromManifest?.classJsonPath).toBe(resolve(TMP, "ext/Manifest.class.json"));

    const shadowed = locateClass(
      { $prototype: "Manifest" },
      { imports: { Manifest: "./lib/Shadow.class.json" }, projectRoot: TMP, registry },
    );
    expect(shadowed?.classJsonPath).toBe(resolve(TMP, "lib/Shadow.class.json"));

    // And the entry's own $src before either.
    const own = locateClass(
      { $prototype: "Manifest", $src: "./lib/Greeter.class.json" },
      { imports: { Manifest: "./lib/Shadow.class.json" }, projectRoot: TMP, registry },
    );
    expect(own?.classJsonPath).toBe(resolve(TMP, "lib/Greeter.class.json"));
  });

  test("returns undefined for a name nothing maps", () => {
    expect(locateClass({ $prototype: "Nobody" }, { projectRoot: TMP })).toBeUndefined();
    expect(
      locateClass({ $prototype: "Nobody" }, { imports: {}, projectRoot: TMP }),
    ).toBeUndefined();
  });

  test("throws naming the path when the descriptor cannot be read", () => {
    expect(() =>
      locateClass({ $prototype: "Gone", $src: "./lib/Gone.class.json" }, { projectRoot: TMP }),
    ).toThrow(resolve(TMP, "lib/Gone.class.json"));
    expect(() =>
      locateClass({ $prototype: "Broken", $src: "./lib/broken.class.json" }, { projectRoot: TMP }),
    ).toThrow(resolve(TMP, "lib/broken.class.json"));
    // A package specifier resolves from the project's own node_modules, where this one is not.
    expect(() =>
      locateClass({ $prototype: "Pkg", $src: "no-such-pkg/X.class.json" }, { projectRoot: TMP }),
    ).toThrow("no-such-pkg/X.class.json");
  });
});

describe("loadClass", () => {
  test("takes the named export, then default[name]", async () => {
    expect(await valueOf(located("./lib/Named.class.json", "Named"))).toBe("named");
    expect(await valueOf(located("./lib/Bundled.class.json", "Bundled"))).toBe("default");
  });

  test("rejects a module that does not export the class", async () => {
    const empty = located("./lib/Empty.class.json", "Empty");
    expect(await rejectionOf(loadClass(empty))).toBe('Module ./empty.js does not export "Empty"');
    const absent = { $export: "Absent", $prototype: "Named", $src: "./lib/Named.class.json" };
    const missing = locateClass(absent, { projectRoot: TMP });
    expect(await rejectionOf(loadClass(missing!))).toBe(
      'Module ./named.js does not export "Absent"',
    );
  });

  test("generates a self-contained class from its schema", async () => {
    const source = located("./lib/Greeter.class.json", "Greeter");
    expect(await valueOf(source)).toBe("Hello world");
    expect(await valueOf(source, { name: "Jx" })).toBe("Hello Jx");
    // The same descriptor is the same class, however many documents name it.
    const again = located("./lib/Greeter.class.json", "Greeter");
    expect(await loadClass(again)).toBe(await loadClass(source));
  });

  test("refuses a generated class whose extends is a $ref", async () => {
    const child = located("./lib/Child.class.json", "Child");
    const message = await rejectionOf(loadClass(child));
    expect(message).toContain(resolve(TMP, "lib/Child.class.json"));
    expect(message).toContain('extends another class document ("./Greeter.class.json")');
    expect(message).toEndWith("give it an $implementation");
  });
});

describe("instantiateAndResolve", () => {
  test("prefers resolve(), then .value, then the instance", async () => {
    const resolving = implemented(
      "Resolving",
      "export class Resolving { value = 'field'; resolve() { return 'resolved'; } }\n",
    );
    expect(await valueOf(resolving)).toBe("resolved");
    const holding = implemented("Holding", "export class Holding { value = 'held'; }\n");
    expect(await valueOf(holding)).toBe("held");

    const Plain = await loadClass(
      implemented("Plain", "export class Plain { label = 'plain'; }\n"),
    );
    const plain = await instantiateAndResolve(Plain, {});
    expect(Object.is(plain.value, plain.instance)).toBe(true);
    expect(plain.instance).toBeInstanceOf(Plain);
    expect(plain.value).toMatchObject({ label: "plain" });
  });

  test("hands the class its config", async () => {
    const echo = implemented(
      "Echo",
      "export class Echo { constructor(c) { this.c = c; } resolve() { return this.c.label; } }\n",
    );
    expect(await valueOf(echo, { label: "given" })).toBe("given");
  });
});

describe("readsBuildContext", () => {
  test("is true only for a descriptor that references #/$context/", () => {
    expect(readsBuildContext(located("./lib/Context.class.json", "Context").classDef)).toBe(true);
    expect(readsBuildContext(GREETER)).toBe(false);
  });
});

describe("classEntrySource", () => {
  test("re-exports an $implementation's class as the default export, by the build's lookup", () => {
    const source = classEntrySource(located("./lib/Named.class.json", "Named"));
    expect(source).toBe(
      `import * as m from ${JSON.stringify(join(TMP, "lib/named.js"))};\n` +
        'export default m["Named"] ?? m.default?.["Named"];\n',
    );
  });

  test("is the generated class for a self-contained descriptor", () => {
    const source = classEntrySource(located("./lib/Greeter.class.json", "Greeter"));
    expect(source).toContain("class Greeter {");
    expect(source).toContain("export default Greeter;");
    expect(source).not.toContain("import ");
  });

  test("refuses a self-contained class whose extends is a $ref, and a missing module", () => {
    expect(() => classEntrySource(located("./lib/Child.class.json", "Child"))).toThrow(
      "give it an $implementation",
    );
    write("lib/Lost.class.json", {
      $implementation: "./lost.js",
      $prototype: "Class",
      title: "Lost",
    });
    expect(() => classEntrySource(located("./lib/Lost.class.json", "Lost"))).toThrow(
      `no module at ${join(TMP, "lib/lost.js")}`,
    );
  });
});
