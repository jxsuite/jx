/**
 * Host conformance: every host that serves a project's documents answers a `.jxn` document URL with
 * the JSON it parses to, and a `.jxn` that does not parse with a 422 naming the reason.
 *
 * The runtime reads a fetched `$ref` as JSON on every origin (`spec.md` §23.2), so a host that
 * streams the KDL source breaks every component written in KDL wherever no parser was installed.
 * The desktop loopback (`createProjectServer`) did exactly that while the dev server converted.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseJxn } from "@jxsuite/schema/jxn";
import { serveSite, siteContext } from "@jxsuite/site/serve";
import type { AssetIO } from "@jxsuite/site/serve";
import type { SiteIO } from "@jxsuite/site/compose";
import { createDevServer } from "../src/server.ts";
import { createProjectServer } from "../src/project-server.ts";
import type { ProjectServerHandle } from "../src/project-server.ts";
import { projectFileResponse } from "../src/jxn-response.ts";

const ROOT = join(import.meta.dir, "_jxn_host_fixtures");
const PROJECT = join(ROOT, "project");
const STUDIO = join(ROOT, "_studio");

const CARD = '/- kdl-version 2\n\nx-card {\n    p "Hello"\n}\n';
const BROKEN = "x-broken {\n";
const FILES = {
  "components/x-broken.jxn": BROKEN,
  "components/x-card.jxn": CARD,
  "project.json": JSON.stringify({ name: "jxn-hosts" }),
  "public/x-public.jxn": CARD,
} satisfies Record<string, string>;
const EXPECTED = parseJxn(CARD, "components/x-card.jxn");

let devServer: Awaited<ReturnType<typeof createDevServer>>;
let projectServer: ProjectServerHandle;

beforeAll(async () => {
  rmSync(ROOT, { force: true, recursive: true });
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(join(PROJECT, path, ".."), { recursive: true });
    writeFileSync(join(PROJECT, path), text);
  }
  mkdirSync(STUDIO, { recursive: true });
  writeFileSync(join(STUDIO, "index.html"), "<html></html>");
  devServer = await createDevServer({ builds: [], port: 0, root: PROJECT, watch: false });
  /* The dev server's public/ and absolute-path lanes follow the project Studio activated. */
  await fetch(`http://localhost:${devServer.port}/__studio/activate`, {
    body: JSON.stringify({ root: "." }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  projectServer = await createProjectServer({
    resolveSession: () => ({ handlers: {}, projectRoot: PROJECT }),
    studioDir: STUDIO,
  });
});

afterAll(() => {
  projectServer.stop();
  void devServer.stop(true);
  rmSync(ROOT, { force: true, recursive: true });
});

/** The site origin, over the same tree, with the reads a host hands it. */
async function siteFetch(pathname: string): Promise<Response> {
  const read = (path: string) => {
    try {
      return readFileSync(join(PROJECT, path));
    } catch {
      return null;
    }
  };
  const io: SiteIO = {
    paths: () => Object.keys(FILES),
    read: async (path) => read(path)?.toString("utf8") ?? null,
  };
  const assets: AssetIO = {
    bytes: async (path) => {
      const buffer = read(path);
      return buffer ? new Uint8Array(buffer) : null;
    },
  };
  return serveSite(pathname, io, assets, await siteContext(io), {
    shell: { base: "/", runtimeUrl: "/runtime.js" },
  });
}

const HOSTS = {
  "desktop loopback (createProjectServer)": (path) => fetch(`${projectServer.url}${path}`),
  "dev server (createDevServer)": (path) => fetch(`http://localhost:${devServer.port}${path}`),
  "site origin (serveSite)": siteFetch,
} satisfies Record<string, (path: string) => Promise<Response>>;

const HOST_NAMES = [
  "desktop loopback (createProjectServer)",
  "dev server (createDevServer)",
  "site origin (serveSite)",
] as const satisfies readonly (keyof typeof HOSTS)[];

describe.each(HOST_NAMES)("%s", (host) => {
  const get = (path: string) => HOSTS[host](path);

  test("answers a .jxn document URL with its JSON", async () => {
    const res = await get("/components/x-card.jxn");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual(EXPECTED);
  });

  test("answers a .jxn that does not parse with 422 and the reason", async () => {
    const res = await get("/components/x-broken.jxn");
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const reason = await res.text();
    expect(reason.length).toBeGreaterThan(0);
  });
});

describe.each(["desktop loopback (createProjectServer)", "dev server (createDevServer)"] as const)(
  "%s, the project tree's own URL spaces",
  (host) => {
    const get = (path: string) => HOSTS[host](path);

    test("answers a .jxn under public/ with its JSON", async () => {
      const res = await get("/x-public.jxn");
      expect(await res.json()).toEqual(EXPECTED);
    });

    test("answers a .jxn addressed by its absolute path with its JSON", async () => {
      /* POSIX `/abs/path` arrives as `//abs/path`; Windows `C:\\dir` as `/C:/dir`. */
      const abs = join(PROJECT, "components", "x-card.jxn").replaceAll("\\", "/");
      const res = await get(`/${abs}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(EXPECTED);
    });
  },
);

describe("projectFileResponse", () => {
  test("streams anything that is not .jxn as it is", async () => {
    const res = await projectFileResponse(join(PROJECT, "project.json"));
    expect(await res!.text()).toBe(FILES["project.json"]);
  });

  test("is null for a .jxn that is not a regular file", async () => {
    expect(await projectFileResponse(join(PROJECT, "components", "missing.jxn"))).toBeNull();
    expect(await projectFileResponse(join(PROJECT, "components"))).toBeNull();
  });

  test("uses the headers a host asks for", async () => {
    const res = await projectFileResponse(join(PROJECT, "components", "x-card.jxn"), (type) => ({
      "Cache-Control": "no-cache",
      "Content-Type": type,
    }));
    expect(res!.headers.get("cache-control")).toBe("no-cache");
    expect(await res!.json()).toEqual(EXPECTED);
  });
});
