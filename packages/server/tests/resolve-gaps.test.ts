import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { handleResolve, handleServerFunction } from "../src/resolve";
import { join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const FIXTURES = resolve(import.meta.dir, "_resolve_gaps_fixtures");

/** Build a POST request for handleResolve. */
function resolveReq(body: unknown) {
  return new Request("http://localhost/__jx_resolve__", {
    body: JSON.stringify(body),
    method: "POST",
  });
}

// Self-contained class exercising field initializer/default/null branches,
// Constructor body (array form), and method parameter mapping variants.
const ctxClass = {
  $defs: {
    constructor: {
      $prototype: "Function",
      body: ["this.ctorRan = true;"],
      role: "constructor",
    },
    fields: {
      _project: {
        access: "public",
        identifier: "_project",
        role: "field",
        scope: "instance",
      },
      a: {
        access: "public",
        identifier: "a",
        initializer: 5,
        role: "field",
        scope: "instance",
      },
      b: {
        access: "public",
        default: { x: 1 },
        identifier: "b",
        role: "field",
        scope: "instance",
      },
      c: {
        access: "public",
        identifier: "c",
        role: "field",
        scope: "instance",
      },
    },
    methods: {
      combine: {
        body: "return x + y + z + (arg ?? 0);",
        identifier: "combine",
        parameters: [{ $ref: "#/$defs/parameters/x" }, { identifier: "y" }, { name: "z" }, {}],
        role: "method",
      },
      resolve: {
        body: "return { a: this.a, b: this.b, c: this.c, combined: this.combine(1, 2, 3, 4), ctorRan: this.ctorRan === true, hasProject: Boolean(this._project) };",
        identifier: "resolve",
        role: "method",
      },
    },
    parameters: {
      x: { identifier: "x", type: { type: "number" } },
    },
  },
  $prototype: "Class",
  title: "Ctx",
};

/**
 * A server function module that says which fixture it is, and which project its env came from, so a
 * test can tell which file the proxy imported without comparing paths a symlinked temp directory
 * would spell two ways.
 */
function pageFn(marker: string) {
  return `export function where(args, env) { return { at: ${JSON.stringify(marker)}, root: env.JX_PROJECT_ROOT }; }`;
}

/**
 * The `$base` Studio's canvas sends for a document: the canvas origin, then the document's absolute
 * path (`documentBase` in packages/studio), so a POSIX path arrives as `//abs/...`. Built through
 * `URL`, as the canvas builds it, so a space arrives percent-encoded.
 */
function canvasBase(absDocPath: string) {
  return new URL(`http://127.0.0.1:1/${absDocPath}`).href;
}

function setup() {
  rmSync(FIXTURES, { force: true, recursive: true });

  // Project with a valid project.json (no contentTypes)
  mkdirSync(join(FIXTURES, "proj-valid"), { recursive: true });
  writeFileSync(join(FIXTURES, "proj-valid", "project.json"), JSON.stringify({ name: "p1" }));
  writeFileSync(join(FIXTURES, "proj-valid", "Ctx.class.json"), JSON.stringify(ctxClass));

  // Project with a broken project.json
  mkdirSync(join(FIXTURES, "proj-broken"), { recursive: true });
  writeFileSync(join(FIXTURES, "proj-broken", "project.json"), "{broken json!");
  writeFileSync(join(FIXTURES, "proj-broken", "Ctx.class.json"), JSON.stringify(ctxClass));

  // Project whose server function reads its env, beside a second project with its own .dev.vars
  mkdirSync(join(FIXTURES, "proj-env"), { recursive: true });
  writeFileSync(join(FIXTURES, "proj-env", ".dev.vars"), "JX_TEST_VAR=1\n");
  writeFileSync(
    join(FIXTURES, "proj-env", "env-fn.js"),
    "export function readEnv(args, env) { return { root: env.JX_PROJECT_ROOT, value: env.JX_TEST_VAR }; }",
  );
  mkdirSync(join(FIXTURES, "proj-env-other"), { recursive: true });
  writeFileSync(join(FIXTURES, "proj-env-other", ".dev.vars"), "JX_TEST_VAR=2\n");

  // A project whose directory name a URL percent-encodes, with a page-relative server function
  mkdirSync(join(FIXTURES, "canvas proj", "pages"), { recursive: true });
  writeFileSync(join(FIXTURES, "canvas proj", "pages", "page-fn.js"), pageFn("canvas-pages"));
}

/** Build a POST request for handleServerFunction. */
function serverReq(body: unknown) {
  return new Request("http://localhost/__jx_server__", {
    body: JSON.stringify(body),
    method: "POST",
  });
}

describe("handleResolve — gaps", () => {
  beforeAll(() => setup());
  afterAll(() => {
    rmSync(FIXTURES, { force: true, recursive: true });
  });

  test("injects _project context when project.json exists", async () => {
    const root = join(FIXTURES, "proj-valid");
    const res = await handleResolve(
      resolveReq({ $prototype: "Ctx", $src: "./Ctx.class.json" }),
      root,
    );
    expect(res.status).toBe(200);
    const value = await res.json();
    expect(value.hasProject).toBe(true);
  });

  test("constructs fields from initializer, default, and null fallback", async () => {
    const root = join(FIXTURES, "proj-valid");
    const res = await handleResolve(
      resolveReq({ $prototype: "Ctx", $src: "./Ctx.class.json" }),
      root,
    );
    const value = await res.json();
    expect(value.a).toBe(5);
    expect(value.b).toEqual({ x: 1 });
    expect(value.c).toBeNull();
  });

  test("runs constructor body given as an array of lines", async () => {
    const root = join(FIXTURES, "proj-valid");
    const res = await handleResolve(
      resolveReq({ $prototype: "Ctx", $src: "./Ctx.class.json" }),
      root,
    );
    const value = await res.json();
    expect(value.ctorRan).toBe(true);
  });

  test("maps method parameters from $ref, identifier, name, and fallback", async () => {
    const root = join(FIXTURES, "proj-valid");
    const res = await handleResolve(
      resolveReq({ $prototype: "Ctx", $src: "./Ctx.class.json" }),
      root,
    );
    const value = await res.json();
    expect(value.combined).toBe(10);
  });

  test("skips project context when project.json is invalid", async () => {
    const root = join(FIXTURES, "proj-broken");
    const res = await handleResolve(
      resolveReq({ $prototype: "Ctx", $src: "./Ctx.class.json" }),
      root,
    );
    expect(res.status).toBe(200);
    const value = await res.json();
    expect(value.hasProject).toBe(false);
  });

  test("config overrides field defaults", async () => {
    const root = join(FIXTURES, "proj-valid");
    const res = await handleResolve(
      resolveReq({ $prototype: "Ctx", $src: "./Ctx.class.json", a: 99 }),
      root,
    );
    const value = await res.json();
    expect(value.a).toBe(99);
  });

  test("resolves bare specifier via server require fallback", async () => {
    // Root outside the repo: project-level require fails, server-level resolves
    const tmpRoot = mkdtempSync(join(tmpdir(), "jx-resolve-gap-"));
    try {
      const res = await handleResolve(
        resolveReq({ $prototype: "Thing", $src: "@jxsuite/schema" }),
        tmpRoot,
      );
      // Resolved module is not a .class.json, so the handler rejects it
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("requires a .class.json");
    } finally {
      rmSync(tmpRoot, { force: true, recursive: true });
    }
  });

  test("resolves bare specifier via project require when available", async () => {
    // Repo-relative root: project require resolves workspace deps directly
    const res = await handleResolve(
      resolveReq({ $prototype: "Thing", $src: "@jxsuite/schema" }),
      resolve(import.meta.dir, ".."),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("requires a .class.json");
  });

  test("returns 400 for unresolvable bare specifier", async () => {
    const res = await handleResolve(
      resolveReq({ $prototype: "Thing", $src: "completely-bogus-pkg-xyz-404" }),
      FIXTURES,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Cannot resolve");
  });

  test("imports a $src under the active project root but outside the server root", async () => {
    // The active project lives OUTSIDE the server root: isImportable must accept it via the
    // ActiveProjectRoot containment branch.
    const external = mkdtempSync(join(tmpdir(), "jx-resolve-active-"));
    try {
      writeFileSync(join(external, "Ctx.class.json"), JSON.stringify(ctxClass));
      const res = await handleResolve(
        resolveReq({ $prototype: "Ctx", $src: "./Ctx.class.json" }),
        join(FIXTURES, "proj-valid"),
        external,
      );
      expect(res.status).toBe(200);
      const value = (await res.json()) as { a: number };
      expect(value.a).toBe(5);
    } finally {
      rmSync(external, { force: true, recursive: true });
    }
  });

  test("server-function proxy rejects a $src that escapes the project root", async () => {
    const req = new Request("http://localhost/__jx_server__", {
      body: JSON.stringify({ $export: "run", $src: "../outside.js", arguments: {} }),
      method: "POST",
    });
    const res = await handleServerFunction(req, join(FIXTURES, "proj-valid"));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("escapes the project root");
  });

  test("the proxy's env carries the project's .dev.vars", async () => {
    // The same env the extension mounts get: process.env under .dev.vars, plus JX_PROJECT_ROOT.
    const root = join(FIXTURES, "proj-env");
    const res = await handleServerFunction(
      serverReq({ $export: "readEnv", $src: "./env-fn.js" }),
      root,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ root, value: "1" });
  });

  test("the proxy's env comes from projectRoot when the host passes one", async () => {
    // The dev server resolves $src against its own root and reads the ACTIVE project's .dev.vars.
    const projectRoot = join(FIXTURES, "proj-env-other");
    const res = await handleServerFunction(
      serverReq({ $export: "readEnv", $src: "./env-fn.js" }),
      join(FIXTURES, "proj-env"),
      projectRoot,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ root: projectRoot, value: "2" });
  });

  test("the proxy resolves $src against the absolute-path base Studio's canvas sends", async () => {
    /* The desktop's loopback server and RPC bridge pass the project as root. The base's path is
       the document's absolute path, percent-encoded: read as a site URL under root, it named
       `<root>/<root>/pages/` and the import failed. */
    const root = join(FIXTURES, "canvas proj");
    const $base = canvasBase(join(root, "pages", "page.json"));
    expect($base).toContain("canvas%20proj");
    const res = await handleServerFunction(
      serverReq({ $base, $export: "where", $src: "./page-fn.js" }),
      root,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ at: "canvas-pages", root });
  });

  test("a percent-encoded site-URL base names the decoded directory under root", async () => {
    const res = await handleServerFunction(
      serverReq({
        $base: "http://localhost:3000/canvas%20proj/pages/page.json",
        $export: "where",
        $src: "./page-fn.js",
      }),
      FIXTURES,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ at: "canvas-pages", root: FIXTURES });
  });

  test.skipIf(process.platform === "win32")(
    "a single-slash base is a site URL even when its path is also an absolute path under root",
    async () => {
      /* Only `//abs/...`, `/C:/...` and a file: URL spell a filesystem path. A container root
         `/app` holding a site directory `app/` serves `/app/pages/page.json` from
         `<root>/app/pages/`, and the proxy must import the module beside that file, not the one
         at `/app/pages/`. Here the root's own absolute path plays `/app`. */
      const root = join(FIXTURES, "url-root");
      const siteDir = join(root, `.${root}`, "pages");
      mkdirSync(join(root, "pages"), { recursive: true });
      mkdirSync(siteDir, { recursive: true });
      writeFileSync(join(root, "pages", "page-fn.js"), pageFn("absolute-path"));
      writeFileSync(join(siteDir, "page-fn.js"), pageFn("site-url"));

      const siteUrl = await handleServerFunction(
        serverReq({
          $base: new URL(`http://localhost:3000${root}/pages/page.json`).href,
          $export: "where",
          $src: "./page-fn.js",
        }),
        root,
      );
      expect(siteUrl.status).toBe(200);
      expect(await siteUrl.json()).toEqual({ at: "site-url", root });

      // A file: URL's path is a filesystem path, so the same path names the absolute directory.
      const fileBase = pathToFileURL(join(root, "pages", "page.json")).href;
      const fileUrl = await handleServerFunction(
        serverReq({ $base: fileBase, $export: "where", $src: "./page-fn.js" }),
        root,
      );
      expect(fileUrl.status).toBe(200);
      expect(await fileUrl.json()).toEqual({ at: "absolute-path", root });
    },
  );

  test("an absolute-path base outside root and the project keeps meaning a site URL", async () => {
    // The module exists at the absolute path, but only a path under root or the project reads as
    // One, so this names <root>/<that path>/ and nothing outside the roots is imported.
    const outside = mkdtempSync(join(tmpdir(), "jx-server-fn-outside-"));
    try {
      writeFileSync(join(outside, "page-fn.js"), pageFn("outside"));
      const $base = canvasBase(join(outside, "page.json"));
      const res = await handleServerFunction(
        serverReq({ $base, $export: "where", $src: "./page-fn.js" }),
        join(FIXTURES, "proj-env"),
      );
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("Failed to import");
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  test("imports a module under the active project root but outside the server root", async () => {
    // As handleResolve does: the dev server's active project may sit outside its root, and the
    // Canvas addresses that project's documents by absolute path.
    const external = mkdtempSync(join(tmpdir(), "jx-server-fn-active-"));
    try {
      mkdirSync(join(external, "pages"), { recursive: true });
      writeFileSync(join(external, "pages", "page-fn.js"), pageFn("active-pages"));
      const $base = canvasBase(join(external, "pages", "page.json"));
      const res = await handleServerFunction(
        serverReq({ $base, $export: "where", $src: "./page-fn.js" }),
        join(FIXTURES, "proj-env"),
        external,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ at: "active-pages", root: external });

      // Containment still binds: a $src that climbs out of the project is refused.
      const escape = await handleServerFunction(
        serverReq({ $base, $export: "where", $src: "../../escape.js" }),
        join(FIXTURES, "proj-env"),
        external,
      );
      expect(escape.status).toBe(403);
    } finally {
      rmSync(external, { force: true, recursive: true });
    }
  });

  test("rejects a .class.json whose $implementation escapes the project root", async () => {
    const root = join(FIXTURES, "impl-escape");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "Esc.class.json"),
      JSON.stringify({
        $implementation: "../outside-impl.js",
        $prototype: "Class",
        title: "Esc",
      }),
    );
    writeFileSync(join(FIXTURES, "outside-impl.js"), "export class Esc {}");
    const res = await handleResolve(
      resolveReq({ $prototype: "Esc", $src: "./Esc.class.json" }),
      root,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("$implementation escapes the project root");
  });

  test("trusts a bare-specifier class whose $implementation sits outside the project root", async () => {
    // An installed package (bare specifier) is resolved through Node's module resolution, so its
    // Class file — and the sibling $implementation it names, even one above the class dir — is as
    // Trusted as the package's own code. The root-escape guard must not fire here.
    const pkgRoot = mkdtempSync(join(tmpdir(), "jx-resolve-trusted-"));
    const projRoot = mkdtempSync(join(tmpdir(), "jx-resolve-proj-"));
    try {
      const pkgDir = join(pkgRoot, "node_modules", "trusted-ext");
      mkdirSync(join(pkgDir, "src"), { recursive: true });
      mkdirSync(join(pkgDir, "dist"), { recursive: true });
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "trusted-ext" }));
      writeFileSync(
        join(pkgDir, "src", "Ext.class.json"),
        JSON.stringify({ $implementation: "../dist/ext.js", $prototype: "Ext", title: "Ext" }),
      );
      writeFileSync(
        join(pkgDir, "dist", "ext.js"),
        "export class Ext { resolve() { return { ok: true }; } }",
      );
      // The project require walks up from projRoot; symlink the package into its node_modules so a
      // Bare specifier resolves without a real install.
      mkdirSync(join(projRoot, "node_modules"), { recursive: true });
      writeFileSync(join(projRoot, "package.json"), JSON.stringify({ name: "proj" }));
      symlinkSync(pkgDir, join(projRoot, "node_modules", "trusted-ext"));

      const res = await handleResolve(
        resolveReq({ $prototype: "Ext", $src: "trusted-ext/src/Ext.class.json" }),
        projRoot,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      rmSync(pkgRoot, { force: true, recursive: true });
      rmSync(projRoot, { force: true, recursive: true });
    }
  });
});
