/**
 * Site-build-external-class.test.ts — external classes, built end to end (compiler.md §3, §5.4,
 * §12).
 *
 * A state entry naming an external class is resolved during the build (`timing: "compiler"`, or no
 * `timing`) or delivered to the browser as a bundled module (`timing: "client"`), for a page and
 * for a component alike, whether its `.class.json` names an `$implementation` or is self-contained.
 * One project proves every row holds; a second proves an entry the build cannot resolve or deliver
 * fails it, naming the entry.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSite } from "../src/site/site-build";
import { isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";

/** A self-contained class: a `name` field defaulting to `world`, and a `value` accessor. */
function greeter(title: string): JsonValue {
  return {
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
    title,
  };
}

/** A class document naming an `$implementation`. */
function implemented(title: string, module: string, extra: Record<string, JsonValue> = {}) {
  return { $implementation: module, $prototype: "Class", title, ...extra };
}

function project(root: string) {
  const write = (path: string, content: JsonValue | string) => {
    const full = resolve(root, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, isString(content) ? content : JSON.stringify(content, null, 2), "utf8");
  };
  const read = (path: string) => readFileSync(resolve(root, "dist", path), "utf8");
  return { read, write };
}

// ── Every row holds ─────────────────────────────────────────────────────────

describe("buildSite — external classes at both timings (compiler.md §3)", () => {
  const TMP = resolve(import.meta.dir, "__test-site-external-class__");
  const { read, write } = project(TMP);
  let errors: string[] = [];

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    write("project.json", {
      build: { minify: false, outDir: "./dist" },
      extensions: ["./ext"],
      name: "classes",
    });
    write("package.json", { name: "classes", type: "module" });
    write("lib/Greeter.class.json", greeter("Greeter"));
    // Two classes over one module-level store, as a session and its actions are.
    write("lib/store.js", "export const store = { user: 'nobody' };\n");
    write("lib/Session.class.json", implemented("Session", "./session.js"));
    write(
      "lib/session.js",
      "import { store } from './store.js';\n" +
        "export class Session { resolve() { return { user: store.user }; } }\n",
    );
    write("lib/Actions.class.json", implemented("Actions", "./actions.js"));
    write(
      "lib/actions.js",
      "import { store } from './store.js';\n" +
        "export class Actions { resolve() { return { signIn: (user) => { store.user = user; } }; } }\n",
    );
    // A class with a `lower` capability, enabled through an extension's manifest.
    write("ext/jx-extension.json", { classes: { Lowered: "./Lowered.class.json" }, name: "ext" });
    write(
      "ext/Lowered.class.json",
      implemented("Lowered", "./lowered.js", {
        $defs: { methods: { lower: { identifier: "lower", role: "lower", scope: "static" } } },
      }),
    );
    write(
      "ext/lowered.js",
      "export class Lowered {\n" +
        "  static lower(def) {\n" +
        "    return { $bundle: ['./lib/store.js'], $prototype: 'Request', url: '/api/' + def.table };\n" +
        "  }\n" +
        "}\n",
    );

    write("components/x-card.json", {
      children: [
        { className: "built", tagName: "p", textContent: "${state.built}" },
        { className: "live", tagName: "p", textContent: "${state.live}" },
        { className: "rows", tagName: "p", textContent: "${state.rows}" },
      ],
      state: {
        built: {
          $prototype: "Greeter",
          $src: "../lib/Greeter.class.json",
          name: "card",
          timing: "compiler",
        },
        live: {
          $prototype: "Greeter",
          $src: "../lib/Greeter.class.json",
          name: "card live",
          timing: "client",
        },
        rows: { $prototype: "Lowered", table: "cards", timing: "client" },
      },
      tagName: "x-card",
    });
    // A component a page reaches only through another component's `$elements`.
    write("components/x-shell.json", {
      $elements: [{ $ref: "./x-card.json" }],
      children: [{ tagName: "x-card" }],
      tagName: "x-shell",
    });
    write("pages/index.json", {
      $layout: false,
      children: [
        { id: "baked", tagName: "h1", textContent: "${state.g}" },
        { id: "session", tagName: "p", textContent: "${state.session.user}" },
        { id: "live", tagName: "p", textContent: "${state.live}" },
        { tagName: "x-shell" },
      ],
      imports: { Actions: "../lib/Actions.class.json" },
      state: {
        actions: { $prototype: "Actions", timing: "client" },
        g: { $prototype: "Greeter", $src: "../lib/Greeter.class.json", timing: "compiler" },
        live: {
          $prototype: "Greeter",
          $src: "../lib/Greeter.class.json",
          name: "page",
          timing: "client",
        },
        session: { $prototype: "Session", $src: "../lib/Session.class.json", timing: "client" },
      },
      tagName: "main",
      title: "classes",
    });
    ({ errors } = await buildSite(TMP, { verbose: false }));
  });

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  test("a self-contained class at timing compiler is baked into the page", () => {
    expect(errors).toEqual([]);
    expect(read("index.html")).toContain('<h1 id="baked">Hello world</h1>');
  });

  test("a component's compiler-timed class becomes its initial state and prerender", () => {
    // The module starts from the value, and the page's prerender of the component shows it.
    expect(read("components/x-card.js")).toContain('built: "Hello card",');
    expect(read("index.html")).toContain('<p class="built">Hello card</p>');
  });

  test("a component's lower-capable client class is lowered", () => {
    const module = read("components/x-card.js");
    // Its class compiled it away into a core Request: no class module, an auto-fetch instead.
    expect(module).toContain("rows: null,");
    expect(module).toContain("/api/cards");
    expect(existsSync(resolve(TMP, "dist/assets/class-Lowered.js"))).toBe(false);
    // And the client module its lowering named is bundled, though no document imports it.
    expect(read("assets/lib-store.js")).toContain("nobody");
  });

  test("a client class with an $implementation is bundled to /assets/class-Name.js and imported by app.js", () => {
    const app = read("app.js");
    expect(app).toContain("from '/assets/class-Session.js';");
    expect(app).toContain("from '/assets/class-Actions.js';");
    expect(app).toContain("session: null,");
    const session = read("assets/class-Session.js");
    expect(session).toContain("class Session");
    expect(session).toContain("as default");
  });

  test("a self-contained client class ships its generated class", () => {
    const generated = read("assets/class-Greeter.js");
    expect(generated).toContain("class Greeter");
    expect(generated).toContain('"Hello " + this.name');
    expect(generated).not.toContain("new Function");
    expect(read("app.js")).toContain("from '/assets/class-Greeter.js';");
    // The page keeps its binding for hydration rather than baking the definition.
    expect(read("index.html")).toContain('<p id="live" data-bind :text-content=');
  });

  test("two classes sharing a module share one chunk", () => {
    const chunks = readdirSync(resolve(TMP, "dist/assets")).filter((file) =>
      file.startsWith("chunk-"),
    );
    expect(chunks).toHaveLength(1);
    expect(read(`assets/${chunks[0]}`)).toContain('user: "nobody"');
    for (const entry of ["assets/class-Session.js", "assets/class-Actions.js"]) {
      const module = read(entry);
      expect(module).toContain(`from "./${chunks[0]}"`);
      expect(module).not.toContain("nobody");
    }
  });

  test("a component's client class is delivered the same way", () => {
    const module = read("components/x-card.js");
    expect(module).toContain("import _JxClass0 from '/assets/class-Greeter.js';");
    expect(module).toContain('__jxInstantiate(_JxClass0, "Greeter", {"name":"card live"})');
    expect(module).toContain("#jxRender() {");
  });
});

// ── A site served from a path ───────────────────────────────────────────────

describe("buildSite — a class module's URL carries the deployment base", () => {
  const TMP = resolve(import.meta.dir, "__test-site-external-class-base__");
  const { read, write } = project(TMP);

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  test("the page's and the component's imports are re-rooted", async () => {
    rmSync(TMP, { force: true, recursive: true });
    write("project.json", {
      build: { outDir: "./dist" },
      name: "based",
      url: "https://example.test/docs",
    });
    write("lib/Greeter.class.json", greeter("Greeter"));
    const live = { $prototype: "Greeter", $src: "../lib/Greeter.class.json", timing: "client" };
    write("components/x-live.json", {
      state: { live },
      tagName: "x-live",
      textContent: "${state.live}",
    });
    write("pages/index.json", {
      $layout: false,
      children: [{ tagName: "p", textContent: "${state.live}" }, { tagName: "x-live" }],
      state: { live },
      tagName: "main",
    });
    const { errors } = await buildSite(TMP, { verbose: false });
    expect(errors).toEqual([]);
    expect(read("app.js")).toContain("from '/docs/assets/class-Greeter.js';");
    expect(read("components/x-live.js")).toContain("from '/docs/assets/class-Greeter.js';");
    expect(existsSync(resolve(TMP, "dist/assets/class-Greeter.js"))).toBe(true);
  });
});

// ── An entry the build cannot resolve or deliver fails it ───────────────────

describe("buildSite — an external class the build cannot resolve or deliver", () => {
  const TMP = resolve(import.meta.dir, "__test-site-external-class-errors__");
  const { write } = project(TMP);
  let errors: string[] = [];

  /** A page whose one state entry is `entry`, under the key `g`. */
  function page(name: string, entry: JsonValue, imports: Record<string, string> = {}) {
    write(`pages/${name}.json`, {
      $layout: false,
      children: [{ tagName: "p", textContent: "${state.g}" }],
      imports,
      state: { g: entry },
      tagName: "main",
    });
  }

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    write("project.json", { build: { outDir: "./dist" }, name: "errors" });
    write("package.json", { name: "errors", type: "module" });
    write("lib/Greeter.class.json", greeter("Greeter"));
    write("other/Greeter.class.json", greeter("Greeter"));
    write(
      "lib/Context.class.json",
      implemented("Context", "./context.js", {
        $defs: { parameters: { type: { enum: { $ref: "#/$context/content" } } } },
      }),
    );
    write("lib/context.js", "export class Context { resolve() { return 1; } }\n");
    write("lib/Thrower.class.json", implemented("Thrower", "./thrower.js"));
    write(
      "lib/thrower.js",
      "export class Thrower { resolve() { throw new Error('no window here'); } }\n",
    );

    page("ghost-compiler", { $prototype: "Greter", timing: "compiler" });
    page("ghost-client", { $prototype: "Greter", timing: "client" });
    page("context-client", {
      $prototype: "Context",
      $src: "../lib/Context.class.json",
      timing: "client",
    });
    page("unset-throws", { $prototype: "Thrower", $src: "../lib/Thrower.class.json" });
    // Two different documents whose classes share a name, and so an asset path.
    page("first", { $prototype: "Greeter", $src: "../lib/Greeter.class.json", timing: "client" });
    page("second", {
      $prototype: "Greeter",
      $src: "../other/Greeter.class.json",
      timing: "client",
    });
    write("components/x-ghost.json", {
      state: { g: { $prototype: "Greter", timing: "compiler" } },
      tagName: "x-ghost",
      textContent: "${state.g}",
    });
    ({ errors } = await buildSite(TMP, { verbose: false }));
  });

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  /** The one error reported for a route or a component file. */
  function errorFor(where: string): string {
    const found = errors.filter((error) => error.includes(where));
    expect(found).toHaveLength(1);
    return found[0] ?? "";
  }

  test("an unresolvable compiler entry fails the route, naming the entry", () => {
    expect(errorFor("/ghost-compiler")).toBe(
      'Error compiling /ghost-compiler: state entry "g" ($prototype "Greter") names no class: ' +
        'give it a $src or an imports entry, or enable the extension that provides "Greter"',
    );
    expect(errorFor("x-ghost.json")).toStartWith(
      'Error compiling component components/x-ghost.json: state entry "g" ($prototype "Greter") ' +
        "names no class",
    );
  });

  test("a client class naming no class fails the build", () => {
    expect(errorFor("/ghost-client")).toBe(
      'Error compiling /ghost-client: external class "Greter" names no class: give it a $src ' +
        'or an imports entry, or enable the extension that provides "Greter"',
    );
  });

  test("a client class reading #/$context/ fails the build", () => {
    expect(errorFor("/context-client")).toBe(
      'Error compiling /context-client: external class "Context" reads the build\'s context ' +
        '(#/$context/) and cannot run in a browser: use "timing": "compiler"',
    );
  });

  test("an unset-timing class that throws during the build fails it, suggesting timing client", () => {
    expect(errorFor("/unset-throws")).toBe(
      'Error compiling /unset-throws: state entry "g" ($prototype "Thrower"): no window here ' +
        '(set "timing": "client" if it must run in the browser)',
    );
  });

  test("two classes with one name fail the build", () => {
    // The first document to name the class claims its asset path; the second is refused.
    expect(errors.filter((error) => error.includes("/first"))).toEqual([]);
    expect(errorFor("/second")).toBe(
      'Error compiling /second: "Greeter" and "Greeter" both map to /assets/class-Greeter.js ' +
        "— rename one",
    );
    expect(errors).toHaveLength(6);
  });
});

// ── A class module that cannot be bundled ───────────────────────────────────

describe("buildSite — a class module that does not bundle", () => {
  const TMP = resolve(import.meta.dir, "__test-site-external-class-bundle__");
  const { write } = project(TMP);

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  test("the bundler's failure is reported, and the page is still written", async () => {
    rmSync(TMP, { force: true, recursive: true });
    write("project.json", { build: { outDir: "./dist" }, name: "unbundled" });
    write("lib/Needy.class.json", implemented("Needy", "./needy.js"));
    write(
      "lib/needy.js",
      "import 'definitely-not-a-real-pkg-xyz';\nexport class Needy { resolve() { return 1; } }\n",
    );
    write("pages/index.json", {
      $layout: false,
      children: [{ tagName: "p", textContent: "${state.n}" }],
      state: { n: { $prototype: "Needy", $src: "../lib/Needy.class.json", timing: "client" } },
      tagName: "main",
    });
    const { errors } = await buildSite(TMP, { verbose: false });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("Error bundling external classes: ");
    expect(errors[0]).toContain("definitely-not-a-real-pkg-xyz");
    expect(existsSync(resolve(TMP, "dist/index.html"))).toBe(true);
  });
});
