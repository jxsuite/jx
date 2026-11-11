/**
 * A document's own server module on a development host (`spec.md` §23.2, `server.md` §3.3): the
 * `/__jx_server__` proxy and `jx dev`'s stand-in for the site worker both run it from the text the
 * document carries, with nothing written beside the document.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isString } from "@jxsuite/schema/guards";
import { serializeJxn } from "@jxsuite/schema/jxn";
import type { JsonObject, JxDocument } from "@jxsuite/schema/types";
import { createServerFunctionMiddleware } from "../src/dev.ts";
import type { ServerEntry } from "../src/dev.ts";
import { handleServerFunction } from "../src/resolve.ts";
import { serverScriptAddress, serverScriptImporter } from "../src/server-script.ts";

const ROOT = resolve(import.meta.dir, "__test-server-script__");

/** Write a project file, a document as JSON or as `.jxn`, or text as it is. */
function write(path: string, content: JxDocument | string): void {
  const file = join(ROOT, path);
  mkdirSync(dirname(file), { recursive: true });
  const text = isString(content)
    ? content
    : path.endsWith(".jxn")
      ? serializeJxn(content)
      : JSON.stringify(content);
  writeFileSync(file, text, "utf8");
}

/** A page whose one server function answers with what it was called with. */
function page(marker: string): JxDocument {
  return {
    $script: {
      server: `import { stamp } from "./lib/stamp.ts";

interface Asked {
  limit: number;
}

export async function history(args: Asked, env: Record<string, string>) {
  return stamp({ marker: "${marker}", limit: args.limit, secret: env.JX_SCRIPT_SECRET });
}
`,
    },
    state: {
      history: { $export: "history", $src: "#server", arguments: { limit: 3 }, timing: "server" },
    },
    tagName: "main",
  };
}

/** A POST to the proxy. */
function call(body: JsonObject, root = ROOT, projectRoot = ROOT): Promise<Response> {
  const request = new Request("http://localhost/__jx_server__", {
    body: JSON.stringify(body),
    method: "POST",
  });
  return handleServerFunction(request, root, projectRoot);
}

/** The bundles this process has left in the temporary directory. */
function leftBehind(): string[] {
  return readdirSync(tmpdir()).filter((name) =>
    name.startsWith(`jx-server-script-${process.pid}-`),
  );
}

beforeAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
  write(".dev.vars", "JX_SCRIPT_SECRET=hunter2\n");
  write(
    "pages/lib/stamp.ts",
    "export const stamp = <T extends object>(value: T): T & { stamped: true } => ({ ...value, stamped: true });\n",
  );
  write("pages/index.json", page("PAGE"));
  write("pages/client-only.json", {
    $script: { client: "export const here = 1;\n" },
    tagName: "main",
  });
  write("pages/compiled.json", {
    $script: {
      server: "enum Size {\n  Small,\n}\nexport async function size() {\n  return Size.Small;\n}\n",
    },
    tagName: "main",
  });
  write("pages/broken-import.json", {
    $script: { server: 'import { gone } from "./lib/gone.ts";\nexport const go = () => gone;\n' },
    tagName: "main",
  });
  write("components/my card/card.jxn", {
    $script: { server: 'export async function card() {\n  return { marker: "CARD" };\n}\n' },
    state: { card: { $export: "card", $src: "#server", timing: "server" } },
    tagName: "my-card",
  });
});

afterAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
});

describe("what a server entry's qualified $src names", () => {
  test("a document under the project, by its path", () => {
    expect(serverScriptAddress("jx-script:pages/index.json#server")).toEqual({
      kind: "path",
      path: "pages/index.json",
    });
  });

  test("a document a browser read, by its URL", () => {
    const address = serverScriptAddress("jx-script:http://localhost:3000/pages/index.json#server");
    expect(address.kind).toBe("url");
    expect(address.kind === "url" && address.url.href).toBe(
      "http://localhost:3000/pages/index.json",
    );
    expect(serverScriptAddress("jx-script:file:///p/pages/index.json#server").kind).toBe("url");
  });

  test("nothing, each with its reason", () => {
    const reasonOf = (specifier: string) => {
      const address = serverScriptAddress(specifier);
      return address.kind === "refused" ? address.reason : address.kind;
    };
    expect(reasonOf("jx-script:nowhere")).toBe(
      '$src "jx-script:nowhere" is not a document script specifier',
    );
    expect(reasonOf("jx-script:pages/index.json#client")).toContain("names a client script");
    expect(reasonOf("jx-script:http://#server")).toContain("names a document at no readable URL");
    expect(reasonOf("jx-script:http://localhost/app/#jx-inline-2#server")).toContain(
      "handed to the page as an object",
    );
  });
});

describe("the /__jx_server__ proxy and a document's server script", () => {
  test("runs it with the entry's arguments and the project's env", async () => {
    const response = await call({
      $base: "http://localhost:4000/",
      $export: "history",
      $src: "jx-script:pages/index.json#server",
      arguments: { limit: 3 },
    });
    expect(response.status).toBe(200);
    // `stamped` comes from the file the script imports, beside its document.
    expect(await response.json()).toEqual({
      limit: 3,
      marker: "PAGE",
      secret: "hunter2",
      stamped: true,
    });
  });

  test("finds the document a browser read by URL, under the root it was served from", async () => {
    const response = await call({
      $export: "history",
      $src: "jx-script:http://localhost:4000/pages/index.json#server",
      arguments: { limit: 1 },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ limit: 1, marker: "PAGE" });
  });

  test("finds a .jxn document by the path a canvas or a file: URL spells", async () => {
    const file = join(ROOT, "components/my card/card.jxn");
    // A URL encodes the space in the directory's name, and the filesystem does not.
    const canvas = await call(
      { $export: "card", $src: `jx-script:${new URL(`http://127.0.0.1:1/${file}`).href}#server` },
      join(ROOT, "pages"),
      ROOT,
    );
    expect(await canvas.json()).toEqual({ marker: "CARD" });

    const fileUrl = await call({
      $export: "card",
      $src: `jx-script:${pathToFileURL(file).href}#server`,
    });
    expect(await fileUrl.json()).toEqual({ marker: "CARD" });
  });

  test("answers with what the document says now, once it is edited", async () => {
    write("pages/edited.json", page("BEFORE"));
    const ask = async (): Promise<JsonObject> => {
      const response = await call({
        $export: "history",
        $src: "jx-script:pages/edited.json#server",
        arguments: { limit: 0 },
      });
      return response.json();
    };
    expect(await ask()).toMatchObject({ marker: "BEFORE" });
    write("pages/edited.json", page("AFTER"));
    expect(await ask()).toMatchObject({ marker: "AFTER" });
  });

  test("writes nothing beside the document, and leaves nothing behind", () => {
    expect(existsSync(join(ROOT, "pages/index.json.jx-server.ts"))).toBe(false);
    expect(leftBehind()).toEqual([]);
  });

  test("refuses a document outside the root and the project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "jx-server-script-outside-"));
    try {
      writeFileSync(join(outside, "page.json"), JSON.stringify(page("OUTSIDE")), "utf8");
      const climbing = await call({ $export: "history", $src: "jx-script:../page.json#server" });
      expect(climbing.status).toBe(403);
      expect(await climbing.text()).toContain("escapes the project root");

      // An absolute path outside both roots keeps meaning a site URL, where there is no document.
      const elsewhere = await call({
        $export: "history",
        $src: `jx-script:${pathToFileURL(join(outside, "page.json")).href}#server`,
      });
      expect(elsewhere.status).toBe(500);
      expect(await elsewhere.text()).toContain("Cannot read");
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  test("refuses a specifier that names no server script a host can read", async () => {
    const client = await call({ $export: "here", $src: "jx-script:pages/client-only.json#client" });
    expect(client.status).toBe(400);
    expect(await client.text()).toContain("names a client script");

    const inline = await call({
      $export: "history",
      $src: "jx-script:http://localhost:4000/#jx-inline-1#server",
    });
    expect(inline.status).toBe(400);
    expect(await inline.text()).toContain("handed to the page as an object");
  });

  test("says why a script could not be imported", async () => {
    const failureOf = async (path: string) => {
      const response = await call({ $export: "go", $src: `jx-script:${path}#server` });
      expect(response.status).toBe(500);
      return response.text();
    };
    expect(await failureOf("pages/missing.json")).toContain(
      "Cannot read pages/missing.json for its server script",
    );
    expect(await failureOf("pages/client-only.json")).toContain(
      "pages/client-only.json has no server script",
    );
    expect(await failureOf("pages/compiled.json")).toContain(
      "pages/compiled.json/$script/server: `enum` is TypeScript that has to be compiled",
    );
    expect(await failureOf("pages/broken-import.json")).toContain("gone.ts");
    expect(leftBehind()).toEqual([]);
  });

  test("an export the script does not have is named", async () => {
    const response = await call({ $export: "absent", $src: "jx-script:pages/index.json#server" });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(
      'Export "absent" not found in "jx-script:pages/index.json#server"',
    );
  });
});

describe("serverScriptImporter", () => {
  test("imports a script once while its text stays the same, however many ask at once", async () => {
    write("once/doc.json", {
      $script: { server: "export const n = 1;\n" },
      tagName: "div",
    });
    const paths: string[] = [];
    const importScript = serverScriptImporter(async (path: string) => {
      paths.push(path);
      /* SAFETY: the bundle of the script above, whose one export is `n`. */
      return (await import(path)) as { n: number };
    });
    const document = join(ROOT, "once/doc.json");
    const [first, second] = await Promise.all([
      importScript(document, ROOT),
      importScript(document, ROOT),
    ]);
    const third = await importScript(document, ROOT);
    expect(first.n).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(paths).toHaveLength(1);

    write("once/doc.json", { $script: { server: "export const n = 2;\n" }, tagName: "div" });
    const edited = await importScript(document, ROOT);
    expect(edited.n).toBe(2);
    expect(paths).toHaveLength(2);
    expect(paths.some((path) => existsSync(path))).toBe(false);
  });

  test("tries again after a failure, since the fix may be in a file the script imports", async () => {
    write("retry/doc.json", {
      $script: { server: 'export { late } from "./late.ts";\n' },
      tagName: "div",
    });
    const importScript = serverScriptImporter(
      /* SAFETY: the bundle of the script above, which re-exports `late`. */
      async (path: string) => (await import(path)) as { late: string },
    );
    const document = join(ROOT, "retry/doc.json");
    // Present and unreadable, not absent: Bun remembers what a directory held when it first looked.
    write("retry/late.ts", "export const late: string = ;\n");
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(importScript(document, ROOT)).rejects.toThrow(/build failed/iu);
    write("retry/late.ts", 'export const late: string = "HERE";\n');
    const module = await importScript(document, ROOT);
    expect(module.late).toBe("HERE");
  });
});

describe("jx dev's stand-in for the worker and a document's server script", () => {
  let entries: ServerEntry[] = [];
  const middleware = createServerFunctionMiddleware(ROOT, () => entries);
  const post = (name: string, body = "{}") =>
    middleware(
      new Request(`http://localhost/_jx/server/${name}`, { body, method: "POST" }),
      new URL(`http://localhost/_jx/server/${name}`),
    );

  test("answers an entry the build named by its document", async () => {
    entries = [{ exportName: "history", src: "jx-script:pages/index.json#server" }];
    const response = await post("history", '{"limit":7}');
    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({
      limit: 7,
      marker: "PAGE",
      secret: "hunter2",
      stamped: true,
    });
  });

  test("a script that cannot be imported answers as the worker would", async () => {
    entries = [{ exportName: "size", src: "jx-script:pages/compiled.json#server" }];
    const response = await post("size");
    expect(response?.status).toBe(500);
    const answer = await response!.json();
    expect(answer.ok).toBe(false);
    expect(answer.error).toContain("pages/compiled.json/$script/server");
  });

  test("an entry naming no document's server script is an error, and nothing runs", async () => {
    entries = [{ exportName: "here", src: "jx-script:pages/client-only.json#client" }];
    const response = await post("here");
    expect(response?.status).toBe(500);
    expect(await response!.json()).toEqual({
      error:
        '"jx-script:pages/client-only.json#client" names no server script of a document in this project',
      ok: false,
    });
  });
});
