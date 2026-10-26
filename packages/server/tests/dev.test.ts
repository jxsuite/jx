/** Tests for src/dev.ts — the `jx dev` entry: arg parsing, dist middleware, startDev boot. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createDistMiddleware,
  createServerFunctionMiddleware,
  parseDevArgs,
  startDev,
} from "../src/dev.ts";
import type { ServerEntry } from "../src/dev.ts";

describe("parseDevArgs", () => {
  test("defaults to cwd and port 3000", () => {
    expect(parseDevArgs([])).toEqual({ port: 3000, root: resolve(".") });
  });

  test("accepts --root and --port", () => {
    expect(parseDevArgs(["--root", "/tmp/site", "--port", "4000"])).toEqual({
      port: 4000,
      root: resolve("/tmp/site"),
    });
  });

  test("accepts a positional root", () => {
    expect(parseDevArgs(["/tmp/other"]).root).toBe(resolve("/tmp/other"));
  });

  test("ignores invalid ports", () => {
    expect(parseDevArgs(["--port", "nope"]).port).toBe(3000);
    expect(parseDevArgs(["--port", "-1"]).port).toBe(3000);
  });

  test("port 0 is allowed (pick a free port)", () => {
    expect(parseDevArgs(["--port", "0"]).port).toBe(0);
  });
});

describe("createDistMiddleware", () => {
  const TMP = resolve(import.meta.dir, "__test-dev-dist__");
  const middleware = createDistMiddleware(TMP);
  const get = (path: string) =>
    middleware(new Request(`http://localhost${path}`), new URL(`http://localhost${path}`));

  beforeAll(() => {
    rmSync(TMP, { force: true, recursive: true });
    mkdirSync(join(TMP, "dist/about"), { recursive: true });
    writeFileSync(join(TMP, "dist/index.html"), "<h1>Home</h1>", "utf8");
    writeFileSync(join(TMP, "dist/about/index.html"), "<h1>About</h1>", "utf8");
    writeFileSync(join(TMP, "dist/app.js"), "console.log(1)", "utf8");
  });

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  test("serves built pages with the live-reload client injected", async () => {
    const res = await get("/about/");
    expect(res?.status).toBe(200);
    const html = await res!.text();
    expect(html).toContain("<h1>About</h1>");
    expect(html).toContain("EventSource('/__reload')");
  });

  test("maps directory URLs without a trailing slash", async () => {
    const res = await get("/about");
    expect(await res!.text()).toContain("<h1>About</h1>");
  });

  test("serves non-html assets verbatim", async () => {
    const res = await get("/app.js");
    expect(await res!.text()).toBe("console.log(1)");
  });

  test("falls through for missing files, traversal, and non-GET", async () => {
    expect(await get("/nope/")).toBeNull();
    expect(await get("/../secret")).toBeNull();
    /* A relative pathname survives normalize() with its leading ".." intact. A real URL always
       normalizes its pathname to a leading "/", so the only way to reach that branch is a stand-in. */
    // SAFETY: createDistMiddleware reads nothing from the URL but `pathname`.
    const relativeUrl = { pathname: "../secret" } as URL;
    const sneaky = await middleware(new Request("http://localhost/x"), relativeUrl);
    expect(sneaky).toBeNull();
    const post = await middleware(
      new Request("http://localhost/", { method: "POST" }),
      new URL("http://localhost/"),
    );
    expect(post).toBeNull();
  });
});

describe("createServerFunctionMiddleware", () => {
  const TMP = resolve(import.meta.dir, "__test-dev-server-fns__");
  let entries: ServerEntry[] = [];
  const middleware = createServerFunctionMiddleware(TMP, () => entries);
  const post = (path: string, body = "{}") =>
    middleware(
      new Request(`http://localhost${path}`, { body, method: "POST" }),
      new URL(`http://localhost${path}`),
    );

  beforeAll(() => {
    rmSync(TMP, { force: true, recursive: true });
    mkdirSync(join(TMP, "node_modules/jx-test-pkg"), { recursive: true });
    writeFileSync(join(TMP, ".dev.vars"), "JX_TEST_SECRET=hunter2\n", "utf8");
    writeFileSync(
      join(TMP, "api.server.js"),
      [
        "export function hit(args, env) {",
        "  return { args, secret: env.JX_TEST_SECRET, root: env.JX_PROJECT_ROOT };",
        "}",
        "export function nothing() {}",
        'export function boom() { throw new Error("boom"); }',
        'export const notAFunction = "data";',
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(TMP, "broken.server.js"), "export function x( {", "utf8");
    writeFileSync(
      join(TMP, "node_modules/jx-test-pkg/package.json"),
      JSON.stringify({ main: "index.js", name: "jx-test-pkg" }),
      "utf8",
    );
    writeFileSync(
      join(TMP, "node_modules/jx-test-pkg/index.js"),
      "export function fromPkg() { return { from: 'pkg' }; }\n",
      "utf8",
    );
  });

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  test("answers a collected export with its value, env carrying a .dev.vars key", async () => {
    entries = [{ exportName: "hit", src: "./api.server.js" }];
    const res = await post("/_jx/server/hit", '{"who":"ann"}');
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ args: { who: "ann" }, root: TMP, secret: "hunter2" });
  });

  test("resolves a bare-specifier entry from the project's node_modules", async () => {
    entries = [{ exportName: "fromPkg", src: "jx-test-pkg" }];
    const res = await post("/_jx/server/fromPkg");
    expect(await res!.json()).toEqual({ from: "pkg" });
  });

  test("a function that returns nothing answers a JSON null, as the worker does", async () => {
    entries = [{ exportName: "nothing", src: "./api.server.js" }];
    const res = await post("/_jx/server/nothing");
    expect(res?.status).toBe(200);
    expect(await res!.json()).toBeNull();
  });

  test("a body that is not JSON reaches the function as an empty argument object", async () => {
    entries = [{ exportName: "hit", src: "./api.server.js" }];
    const res = await post("/_jx/server/hit", "not json");
    const answer = await res!.json();
    expect(answer.args).toEqual({});
  });

  test("404 for an export the build did not collect", async () => {
    entries = [{ exportName: "hit", src: "./api.server.js" }];
    const res = await post("/_jx/server/missing");
    expect(res?.status).toBe(404);
    expect(res!.headers.get("content-type")).toContain("application/problem+json");
  });

  test("a throw answers { ok: false, error } with status 500", async () => {
    entries = [{ exportName: "boom", src: "./api.server.js" }];
    const res = await post("/_jx/server/boom");
    expect(res?.status).toBe(500);
    expect(await res!.json()).toEqual({ error: "boom", ok: false });
  });

  test("a module that cannot load, an export that is not a function, or a specifier that does not resolve answers the same 500", async () => {
    const cases: ServerEntry[] = [
      { exportName: "x", src: "./broken.server.js" },
      { exportName: "notAFunction", src: "./api.server.js" },
      { exportName: "fromNowhere", src: "jx-no-such-package" },
    ];
    for (const entry of cases) {
      entries = [entry];
      const res = await post(`/_jx/server/${entry.exportName}`);
      expect(res?.status).toBe(500);
      const body = await res!.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBeString();
    }
  });

  test("ignores GET and paths outside /_jx/server/", async () => {
    entries = [{ exportName: "hit", src: "./api.server.js" }];
    const get = await middleware(
      new Request("http://localhost/_jx/server/hit"),
      new URL("http://localhost/_jx/server/hit"),
    );
    expect(get).toBeNull();
    expect(await post("/_jx/data/hit")).toBeNull();
    expect(await post("/other")).toBeNull();
  });
});

describe("startDev", () => {
  const SITE = resolve(import.meta.dir, "__test-dev-site__");
  const PLAIN = resolve(import.meta.dir, "__test-dev-plain__");
  const servers: { stop: () => void }[] = [];

  beforeAll(() => {
    for (const dir of [SITE, PLAIN]) {
      rmSync(dir, { force: true, recursive: true });
    }
    mkdirSync(join(SITE, "pages"), { recursive: true });
    writeFileSync(
      join(SITE, "project.json"),
      JSON.stringify({ build: { outDir: "./dist" }, name: "Dev Site" }),
      "utf8",
    );
    writeFileSync(
      join(SITE, "pages/index.json"),
      JSON.stringify({
        children: [{ children: ["Hello startDev"], tagName: "h1" }],
        title: "Home",
      }),
      "utf8",
    );
    mkdirSync(PLAIN, { recursive: true });
    writeFileSync(join(PLAIN, "readme.txt"), "plain root", "utf8");
  });

  afterAll(() => {
    for (const server of servers) {
      server.stop();
    }
    for (const dir of [SITE, PLAIN]) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("builds a site project and serves its pages with the reload client", async () => {
    const server = await startDev({ port: 0, root: SITE });
    servers.push(server);
    const res = await fetch(`http://localhost:${server.port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Hello startDev");
    expect(html).toContain("EventSource('/__reload')");
  });

  test("a source change rebuilds the site before broadcasting the reload", async () => {
    const server = await startDev({ port: 0, root: SITE });
    servers.push(server);

    const sse = await fetch(`http://localhost:${server.port}/__reload`);
    const reader = sse.body!.getReader();
    // Give chokidar a beat to finish its initial scan before the edit.
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 300);
    });
    writeFileSync(
      join(SITE, "pages/index.json"),
      JSON.stringify({
        children: [{ children: ["Rebuilt by watch"], tagName: "h1" }],
        title: "Home",
      }),
      "utf8",
    );

    const decoder = new TextDecoder();
    let reloaded = false;
    const deadline = Date.now() + 15_000;
    while (!reloaded && Date.now() < deadline) {
      const { value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("timeout waiting for reload")), 15_000);
        }),
      ]);
      if (value && decoder.decode(value).includes("data: reload")) {
        reloaded = true;
      }
    }
    expect(reloaded).toBe(true);
    void reader.cancel();

    // The preReload rebuild ran before the broadcast: dist now serves the new content.
    const res = await fetch(`http://localhost:${server.port}/`);
    expect(await res.text()).toContain("Rebuilt by watch");
  }, 20_000);

  test("prints build errors but still boots", async () => {
    const BROKEN = resolve(import.meta.dir, "__test-dev-broken__");
    rmSync(BROKEN, { force: true, recursive: true });
    mkdirSync(join(BROKEN, "pages"), { recursive: true });
    writeFileSync(
      join(BROKEN, "project.json"),
      JSON.stringify({ build: { outDir: "./dist" }, name: "Broken" }),
      "utf8",
    );
    writeFileSync(join(BROKEN, "pages/index.json"), "{ not json", "utf8");
    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(String(msg));
    try {
      const server = await startDev({ port: 0, root: BROKEN });
      servers.push(server);
    } finally {
      console.error = origError;
      rmSync(BROKEN, { force: true, recursive: true });
    }
    expect(errors.some((e) => e.includes("build error:"))).toBe(true);
  });

  test("an adapter site answers POST /_jx/server/<export> at the bare and the based path", async () => {
    const ADAPTED = resolve(import.meta.dir, "__test-dev-adapter__");
    rmSync(ADAPTED, { force: true, recursive: true });
    mkdirSync(join(ADAPTED, "pages"), { recursive: true });
    writeFileSync(
      join(ADAPTED, "project.json"),
      JSON.stringify({
        build: { adapter: "bun", outDir: "./dist" },
        name: "Adapter Dev",
        url: "https://x.dev/m/site/",
      }),
      "utf8",
    );
    writeFileSync(
      join(ADAPTED, "pages/index.json"),
      JSON.stringify({
        children: [{ tagName: "p", textContent: "${state.loadData?.n}" }],
        state: {
          loadData: { $export: "loadData", $src: "./api.server.js", timing: "server" },
        },
        title: "Home",
      }),
      "utf8",
    );
    writeFileSync(
      join(ADAPTED, "pages/api.server.js"),
      "export function loadData() { return { n: 1 }; }\n",
      "utf8",
    );
    try {
      const server = await startDev({ port: 0, root: ADAPTED });
      servers.push(server);
      for (const path of ["/_jx/server/loadData", "/m/site/_jx/server/loadData"]) {
        const res = await fetch(`http://localhost:${server.port}${path}`, {
          body: "{}",
          method: "POST",
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ n: 1 });
      }
      // The built page calls the based route, which is the one the deployed worker serves.
      const script = await fetch(`http://localhost:${server.port}/app.js`);
      expect(await script.text()).toContain("/m/site/_jx/server/loadData");
    } finally {
      rmSync(ADAPTED, { force: true, recursive: true });
    }
  }, 30_000);

  test("boots a non-site root without the dist middleware", async () => {
    const server = await startDev({ port: 0, root: PLAIN });
    servers.push(server);
    const res = await fetch(`http://localhost:${server.port}/readme.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("plain root");
  });
});
