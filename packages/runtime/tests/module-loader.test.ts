/**
 * The runtime's seam for modules written in TypeScript (`spec.md` §23.2): a document's own script
 * is asked for by the document's address, a `.ts` file by its URL, and both through whatever the
 * host installed to load them.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { eraseBody } from "@jxsuite/erase/browser";
import {
  buildScope,
  defineElement,
  mount,
  resolve,
  setBodyEraser,
  setBodyEraserLoader,
  setModuleLoader,
  setNpmModuleResolver,
} from "../src/runtime.ts";
import type { ModuleLoader, ModuleLoadOptions } from "../src/runtime.ts";
import type { JxDocument } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register({ url: "https://page.test/app/" });
} catch {
  /* Already registered */
}

/** One request the loader under test received. */
interface Asked {
  specifier: string;
  options: ModuleLoadOptions;
}

/** Every request, in order. */
const asked: Asked[] = [];

/** The module each specifier was answered with. */
const answers = new Map<string, { greet: () => string }>();

/** A module loader that answers every specifier with a module of its own, and records the ask. */
const answering: ModuleLoader = (specifier, options) => {
  asked.push({ options, specifier });
  let module = answers.get(specifier);
  if (!module) {
    module = { greet: () => specifier };
    answers.set(specifier, module);
  }
  return Promise.resolve(module);
};

/** A document whose one state function is its own client script's export. */
function scripted(client = "export function greet(): string { return 'hi'; }"): JxDocument {
  return {
    $script: { client },
    state: { greet: { $prototype: "Function", $src: "#client", parameters: ["state"] } },
    tagName: "div",
  };
}

/** A document whose one state function is a module's export. */
function withSource(src: string): JxDocument {
  return {
    state: { greet: { $prototype: "Function", $src: src, parameters: ["state", "name"] } },
    tagName: "div",
  };
}

/**
 * Read a document from a URL the way a page does, answered with `doc`.
 *
 * @param url What is fetched.
 * @param doc What the host answers.
 */
async function fetched(url: string, doc: JxDocument): Promise<JxDocument> {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(doc));
  try {
    return await resolve(url);
  } finally {
    fetchSpy.mockRestore();
  }
}

/** Why building a scope failed, as text, or "" when it did not. */
async function failureOf(doc: JxDocument, base?: string): Promise<string> {
  try {
    await buildScope(doc, {}, base);
    return "";
  } catch (error) {
    return String(error);
  }
}

afterEach(() => {
  asked.length = 0;
  setModuleLoader(null);
  setBodyEraser(null);
  setBodyEraserLoader(null);
  setNpmModuleResolver(null);
});

describe("a document read from a URL", () => {
  test("has its script asked for by its own URL, with the text it was read with", async () => {
    setModuleLoader(answering);
    const resolveNpm = (specifier: string): string => `/_npm/${specifier}`;
    setNpmModuleResolver(resolveNpm);
    const url = "https://site.test/pages/one.json";
    const client = "export function greet(): string { return 'one'; }";
    const scope = await buildScope(await fetched(url, scripted(client)), {}, url);
    expect(asked).toEqual([
      {
        options: { base: url, resolveNpm, text: client },
        specifier: `jx-script:${url}#client`,
      },
    ]);
    expect(scope.greet).toBe(answers.get(`jx-script:${url}#client`)?.greet);
  });

  test("is one module of its own, however another document names its exports", async () => {
    setModuleLoader(answering);
    const a = "https://site.test/pages/a.json";
    const b = "https://site.test/pages/b.json";
    const first = await buildScope(await fetched(a, scripted()), {}, a);
    const second = await buildScope(await fetched(b, scripted()), {}, b);
    expect(asked.map(({ specifier }) => specifier)).toEqual([
      `jx-script:${a}#client`,
      `jx-script:${b}#client`,
    ]);
    expect(first.greet).not.toBe(second.greet);
  });

  test("is named by where it is, however the reference to it was spelled", async () => {
    setModuleLoader(answering);
    const doc = await fetched("../pages/relative.json", scripted());
    await buildScope(doc, {}, "https://page.test/pages/relative.json");
    expect(asked[0]?.specifier).toBe("jx-script:https://page.test/pages/relative.json#client");
  });

  test("is not addressed a second time when it is mounted", async () => {
    setModuleLoader(answering);
    const url = "https://site.test/pages/mounted.json";
    const doc = await fetched(url, scripted());
    const mounted = await mount(doc, document.body, { base: url });
    mounted.dispose();
    expect(asked.map(({ specifier }) => specifier)).toEqual([`jx-script:${url}#client`]);
  });

  test("served under a key that is no URL, is named by the key as it is", async () => {
    setModuleLoader(answering);
    const key = "https://not a host/keyed.json";
    const doc = await resolve(key, {
      base: "https://page.test/app/",
      media: null,
      resolver: () => scripted(),
      root: null,
    });
    await buildScope(doc, {}, "https://page.test/app/");
    expect(asked[0]?.specifier).toBe(`jx-script:${key}#client`);
  });

  test("read again with its script edited, runs what it now says", async () => {
    setModuleLoader(answering);
    const url = "https://page.test/app/components/edited.json";
    let client = "export function greet(): string { return 'before'; }";
    const context = {
      base: "https://page.test/app/",
      media: null,
      resolver: () => scripted(client),
      root: null,
    };
    await buildScope(await resolve("components/edited.json", context), {}, url);
    // Unchanged, it is the module already loaded.
    await buildScope(await resolve("components/edited.json", context), {}, url);
    client = "export function greet(): string { return 'after'; }";
    await buildScope(await resolve("components/edited.json", context), {}, url);
    expect(asked.map(({ options }) => options.text)).toEqual([
      "export function greet(): string { return 'before'; }",
      client,
    ]);
  });

  test("served by a mount's resolver, is named by the key it was served under", async () => {
    setModuleLoader(answering);
    const client = "export function greet(): string { return 'served'; }";
    const doc = await resolve("components/served.json", {
      base: "https://page.test/app/",
      media: null,
      resolver: (key) => (key === "components/served.json" ? scripted(client) : undefined),
      root: null,
    });
    await buildScope(doc, {}, "https://page.test/app/components/served.json");
    expect(asked[0]?.specifier).toBe(
      "jx-script:https://page.test/app/components/served.json#client",
    );
    expect(asked[0]?.options.text).toBe(client);
  });
});

/** A specifier for a document that was never at a URL, at this page. */
const INLINE = /^jx-script:https:\/\/page\.test\/app\/#jx-inline-\d+#client$/u;

describe("a document handed over as an object", () => {
  test("stands at its base under a name of its own, with its text", async () => {
    setModuleLoader(answering);
    const client = "export function greet(): string { return 'inline'; }";
    const mounted = await mount(scripted(client), document.body);
    mounted.dispose();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.specifier).toMatch(INLINE);
    expect(asked[0]?.options.text).toBe(client);
  });

  test("is one module when it is mounted twice, and two objects are two", async () => {
    setModuleLoader(answering);
    const doc = scripted();
    const first = await mount(doc, document.body);
    const again = await mount(doc, document.body);
    const other = await mount(scripted(), document.body);
    for (const mounted of [first, again, other]) {
      mounted.dispose();
    }
    // The second mount of one object asked for nothing: it is the module the first one loaded.
    const [one, two] = asked.map(({ specifier }) => specifier);
    expect(asked).toHaveLength(2);
    expect(one).toMatch(INLINE);
    expect(two).toMatch(INLINE);
    expect(two).not.toBe(one);
    expect(again.scope.greet).toBe(first.scope.greet);
  });

  test("is addressed when a scope is built from it directly", async () => {
    setModuleLoader(answering);
    await buildScope(scripted(), {}, "https://site.test/direct/");
    expect(asked[0]?.specifier).toMatch(
      /^jx-script:https:\/\/site\.test\/direct\/#jx-inline-\d+#client$/u,
    );
  });

  test("is addressed when it defines an element", async () => {
    setModuleLoader(answering);
    await defineElement({ ...scripted(), tagName: "scripted-element" });
    const element = document.createElement("scripted-element");
    document.body.append(element);
    for (let turn = 0; turn < 20 && asked.length === 0; turn += 1) {
      await new Promise((done) => {
        setTimeout(done, 0);
      });
    }
    element.remove();
    expect(asked[0]?.specifier).toMatch(INLINE);
  });

  test("leaves a document with no script exactly as it was", async () => {
    const doc: JxDocument = { state: { n: 1 }, tagName: "div" };
    const scope = await buildScope(doc, {}, "https://site.test/plain/");
    expect(scope.n).toBe(1);
  });
});

describe("a $src naming a .ts file", () => {
  test("at a URL a page can fetch goes through the loader, which fetches it", async () => {
    setModuleLoader(answering);
    await buildScope(withSource("./lib/greeter.ts"), {}, "https://site.test/pages/index.json");
    expect(asked).toEqual([
      {
        options: {
          base: "https://site.test/pages/index.json",
          resolveNpm: null,
          text: undefined,
        },
        specifier: "https://site.test/pages/lib/greeter.ts",
      },
    ]);
  });

  test("is imported as written on a page with no loader", async () => {
    // Nothing answers this URL here, so the import fails as the import it always was.
    const failure = await failureOf(
      withSource("./lib/unloaded.ts"),
      "https://site.test/pages/index.json",
    );
    expect(failure).not.toBe("");
    expect(failure).not.toContain("module loader");
  });

  test("the runner can import itself never reaches the loader", async () => {
    setModuleLoader(answering);
    const fixture = new URL("_npm_module.ts", import.meta.url).href;
    const scope = await buildScope(withSource(fixture), {}, fixture);
    const module = await import(fixture);
    expect(asked).toEqual([]);
    expect(scope.greet).toBe(module.greet);
  });

  test("that is not a URL at all is left to the import to refuse", async () => {
    setModuleLoader(answering);
    expect(await failureOf(withSource("https://not a host/greeter.ts"))).not.toBe("");
    expect(asked).toEqual([]);
  });
});

describe("a page with no module loader", () => {
  test("says what a document's script needs, by the document's name", async () => {
    const url = "https://site.test/pages/unloaded.json";
    const failure = await failureOf(await fetched(url, scripted()), url);
    expect(failure).toContain(`Jx: ${url} has a script, and this page has nothing that can load`);
    expect(failure).toContain("setModuleLoader(loadModule)");
  });

  test("refuses #client in a document that has no $script, by name", async () => {
    setModuleLoader(answering);
    const failure = await failureOf(withSource("#client"), "https://site.test/pages/bare.json");
    expect(failure).toContain(
      '$src "#client" names the script of the document it is written in, and that document has ' +
        "no $script",
    );
    expect(asked).toEqual([]);
  });
});

describe("the file a host loads on demand", () => {
  test("brings the module loader with the eraser, and is fetched once", async () => {
    let loads = 0;
    setBodyEraserLoader(() => {
      loads += 1;
      return Promise.resolve({ eraseBody, loadModule: answering });
    });
    await buildScope(scripted(), {}, "https://site.test/lazy/");
    await buildScope(withSource("./lazy.ts"), {}, "https://site.test/lazy/");
    expect(asked).toHaveLength(2);
    expect(loads).toBe(1);
  });

  test("does not replace a loader the host installed itself", async () => {
    const installed: string[] = [];
    setModuleLoader((specifier) => {
      installed.push(specifier);
      return Promise.resolve({ greet: () => "installed" });
    });
    setBodyEraserLoader(() => Promise.resolve({ eraseBody, loadModule: answering }));
    // A typed body makes the page fetch the file; its loader is not the one that answers after.
    const typed = await resolve({
      state: { n: 1, next: { $prototype: "Function", body: "return (state.n as number) + 1;" } },
      tagName: "div",
    });
    const scope = await buildScope(typed, {}, "https://site.test/kept/");
    expect(scope.next).toBe(2);
    await buildScope(scripted(), {}, "https://site.test/kept/");
    expect(installed).toHaveLength(1);
    expect(asked).toEqual([]);
  });

  test("built before module loading existed still erases, and says what a script needs", async () => {
    setBodyEraserLoader(() => Promise.resolve({ eraseBody }));
    const failure = await failureOf(scripted(), "https://site.test/old/");
    expect(failure).toContain("has a script, and this page has nothing that can load one");
    // A .ts file is imported as written, as it was before.
    const typed = await failureOf(withSource("./old.ts"), "https://site.test/old/");
    expect(typed).not.toBe("");
    expect(typed).not.toContain("module loader");
  });
});
