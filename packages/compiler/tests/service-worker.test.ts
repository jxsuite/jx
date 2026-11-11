import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildServiceWorker,
  CACHE_FIRST_PREFIX,
  normalizeServiceWorker,
  registrationScript,
  SERVICE_WORKER_PATH,
  tombstoneServiceWorker,
} from "../src/site/service-worker.ts";
import type { ProjectConfig } from "@jxsuite/schema/types";

/**
 * A service worker is the only output here that is **sticky** — it survives redeploys and the
 * visitors it breaks are the ones who already came back. Most of these tests are about the ways
 * that goes wrong rather than the happy path.
 */

/** A dist with `/` and `/offline/` in it, so precache validation has something real to check. */
function distWith(urls: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "jx-sw-"));
  for (const url of urls) {
    const rel = url.replace(/^\//, "");
    const file = url.endsWith("/") || rel === "" ? join(dir, rel, "index.html") : join(dir, rel);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "<html></html>", "utf8");
  }
  return dir;
}

describe("normalizeServiceWorker", () => {
  /*
   * The distinction the whole feature turns on. Omitting the key means "never had one" and emits
   * nothing; `false` means "had one, remove it" and emits a tombstone. They cannot be collapsed.
   */
  test("absent is not the same as false", () => {
    // The build reads the key off the project config, so absence is a project that never names it.
    const neverHadOne: ProjectConfig = { name: "No Worker" };
    expect(normalizeServiceWorker(neverHadOne.serviceWorker)).toBeNull();
    expect(normalizeServiceWorker(false)).toBe(false);
  });

  test("true is the empty config", () => {
    expect(normalizeServiceWorker(true)).toEqual({});
  });

  test("enabled: false is the same instruction as false", () => {
    expect(normalizeServiceWorker({ enabled: false, precache: ["/"] })).toBe(false);
  });

  test("a config object passes through", () => {
    expect(normalizeServiceWorker({ scope: "/app/" })).toEqual({ scope: "/app/" });
  });
});

describe("buildServiceWorker", () => {
  test("serves from the one path a worker can claim the root from", () => {
    expect(buildServiceWorker({}).path).toBe(SERVICE_WORKER_PATH);
  });

  /*
   * The rule that keeps a bad deploy recoverable. A cache-first worker serves a stale page
   * indefinitely and the author's next deploy cannot reach the visitor to fix it.
   */
  test("HTML is network-first; only content-addressed images are cache-first", () => {
    const { source } = buildServiceWorker({});
    expect(source).toContain(`const CACHE_FIRST = ${JSON.stringify(CACHE_FIRST_PREFIX)}`);
    expect(CACHE_FIRST_PREFIX).toBe("/images/_optimized/");
    // The network branch comes first for everything else, with the cache as the failure path.
    expect(source).toContain("const res = await fetch(request);");
    expect(source).toContain("const hit = await caches.match(request);");
  });

  test("leaves non-GET and cross-origin requests alone", () => {
    const { source } = buildServiceWorker({});
    expect(source).toContain('if (request.method !== "GET") return;');
    expect(source).toContain("if (url.origin !== self.location.origin) return;");
  });

  /*
   * `cache.addAll()` rejects the whole install if any one request fails, so the worker would never
   * activate — with no error anywhere the author looks. Found by running the first build against a
   * browser, where a single unreachable precache URL made the worker silently do nothing.
   */
  test("precaches one URL at a time rather than all-or-nothing", () => {
    const { source } = buildServiceWorker({ precache: ["/"] });
    expect(source).toContain("Promise.allSettled");
    // The call, not the comment above it that explains why the call is not there.
    expect(source).not.toContain("c.addAll");
  });

  test("a precache URL this build did not produce is an error", () => {
    const dir = distWith(["/"]);
    try {
      const { errors } = buildServiceWorker({ precache: ["/", "/nope/"] }, dir);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("/nope/");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("a precache URL that is not site-absolute is an error", () => {
    const dir = distWith(["/"]);
    try {
      expect(buildServiceWorker({ precache: ["offline.html"] }, dir).errors[0]).toContain(
        "site-absolute",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("URLs the build did produce pass, including directory URLs", () => {
    const dir = distWith(["/", "/offline/", "/style.css"]);
    try {
      const { errors } = buildServiceWorker({ precache: ["/", "/offline/", "/style.css"] }, dir);
      expect(errors).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  // A fallback that was never cached cannot be served when the network is gone — the only moment
  // It exists for.
  test("the offline fallback joins precache, and says so", () => {
    const { source, warnings } = buildServiceWorker({
      offlineFallback: "/offline/",
      precache: ["/"],
    });
    expect(source).toContain('const PRECACHE = ["/","/offline/"]');
    expect(warnings[0]).toContain("/offline/");
  });

  test("a fallback already in precache is not added twice and warns nothing", () => {
    const { source, warnings } = buildServiceWorker({
      offlineFallback: "/offline/",
      precache: ["/offline/"],
    });
    expect(source).toContain('const PRECACHE = ["/offline/"]');
    expect(warnings).toEqual([]);
  });

  /*
   * The cache name rotates on a CONFIG change and not on every build: HTML is network-first and
   * images are content-addressed, so a content-only deploy needs no rotation — and rotating anyway
   * would throw away a warm cache on every deploy for nothing.
   */
  test("the cache name is stable across builds and changes with the config", () => {
    const nameOf = (source: string) => /const CACHE = "([^"]+)"/.exec(source)?.[1];
    const a = nameOf(buildServiceWorker({ precache: ["/"] }).source);
    const b = nameOf(buildServiceWorker({ precache: ["/"] }).source);
    const c = nameOf(buildServiceWorker({ precache: ["/", "/about/"] }).source);

    expect(a).toBe(b!);
    expect(a).not.toBe(c!);
    expect(a?.startsWith("jx-")).toBe(true);
  });

  test("precache order does not rotate the cache", () => {
    const nameOf = (source: string) => /const CACHE = "([^"]+)"/.exec(source)?.[1];
    expect(nameOf(buildServiceWorker({ precache: ["/a/", "/b/"] }).source)).toBe(
      nameOf(buildServiceWorker({ precache: ["/b/", "/a/"] }).source)!,
    );
  });

  test("drops caches from a previous config on activate", () => {
    expect(buildServiceWorker({}).source).toContain('name.startsWith("jx-") && name !== CACHE');
  });
});

describe("tombstoneServiceWorker", () => {
  /*
   * The whole reason `false` is a value rather than an absence. Deleting the file leaves every
   * previous visitor running the old worker forever: a 404 at that URL is not an instruction to
   * stop, so the instruction has to be served from the same URL.
   */
  test("is served from the same URL as the worker it replaces", () => {
    expect(tombstoneServiceWorker().path).toBe(buildServiceWorker({}).path);
  });

  test("unregisters itself, clears the caches, and reloads its clients", () => {
    const { source } = tombstoneServiceWorker();
    expect(source).toContain("self.registration.unregister()");
    expect(source).toContain('name.startsWith("jx-")');
    expect(source).toContain("client.navigate(client.url)");
    expect(source).toContain("self.skipWaiting()");
  });

  test("caches nothing and intercepts nothing", () => {
    const { source } = tombstoneServiceWorker();
    expect(source).not.toContain('addEventListener("fetch"');
    expect(source).not.toContain("caches.open");
  });
});

describe("registrationScript", () => {
  // Byte-identical on every page, so a strict `script-src` needs exactly one hash for it.
  test("is the same string for the same scope", () => {
    expect(registrationScript("/")).toBe(registrationScript("/"));
    expect(registrationScript("/app/")).not.toBe(registrationScript("/"));
  });

  // Registering during load competes with the page's own resources on the visit that matters most.
  test("waits for load and swallows a failed registration", () => {
    const script = registrationScript("/");
    expect(script).toContain("addEventListener('load'");
    expect(script).toContain("'serviceWorker' in navigator");
    expect(script).toContain(".catch(");
  });
});

/*
 * The emitted worker, run. Its `fetch` listener is handed requests against a fake network and a
 * fake Cache, because "is this response written anywhere" is not a question source text answers.
 */
describe("what the worker keeps", () => {
  interface FetchEventLike {
    request: Request;
    respondWith: (answer: Promise<Response>) => void;
  }

  /** Load the worker against a network that answers `respond(url)`, and report what was cached. */
  function run(base: string, respond: (url: URL) => Response) {
    const listeners = new Map<string, (event: FetchEventLike) => void>();
    const stored: string[] = [];
    const cache = {
      put: (request: Request) => {
        stored.push(new URL(request.url).pathname);
        return Promise.resolve();
      },
    };
    const scope = {
      addEventListener: (type: string, fn: (event: FetchEventLike) => void) => {
        listeners.set(type, fn);
      },
      location: { origin: "https://site.test" },
    };
    const caches = { match: () => Promise.resolve(), open: () => Promise.resolve(cache) };
    const network = (request: Request) => Promise.resolve(respond(new URL(request.url)));
    const { source } = buildServiceWorker({}, undefined, base);
    // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- running the build's own output is the test.
    new Function("self", "caches", "fetch", source)(scope, caches, network);

    /** Dispatch one GET; `handled` says whether the worker answered it at all. */
    async function get(path: string): Promise<boolean> {
      let answer: Promise<Response> | undefined;
      listeners.get("fetch")?.({
        request: new Request(`https://site.test${path}`),
        respondWith: (value) => {
          answer = value;
        },
      });
      await answer;
      await Promise.resolve();
      await Promise.resolve();
      return answer !== undefined;
    }
    return { get, stored };
  }

  test("a page is answered network-first and cached for the next failure", async () => {
    const sw = run("", () => new Response("<p>hi</p>"));
    expect(await sw.get("/about/")).toBe(true);
    expect(sw.stored).toEqual(["/about/"]);
  });

  test("sessions and application data are not handled at all", async () => {
    const sw = run("", () => Response.json({ user: "u1" }));
    expect(await sw.get("/_jx/auth/get-session")).toBe(false);
    expect(await sw.get("/_jx/data/orders")).toBe(false);
    expect(sw.stored).toEqual([]);
    // A page that merely starts with the same letters is still a page.
    expect(await sw.get("/_jxtra/")).toBe(true);
  });

  test("the exclusion moves with the deployment base", async () => {
    const sw = run("/m/site", () => Response.json([]));
    expect(await sw.get("/m/site/_jx/data/orders")).toBe(false);
    expect(await sw.get("/m/site/about/")).toBe(true);
  });

  test("a response its server marked no-store or private is served and not kept", async () => {
    const sw = run("", (url) =>
      url.pathname === "/account/"
        ? new Response("mine", { headers: { "Cache-Control": "private, max-age=0" } })
        : new Response("never", { headers: { "Cache-Control": "no-store" } }),
    );
    expect(await sw.get("/account/")).toBe(true);
    expect(await sw.get("/receipt/")).toBe(true);
    expect(sw.stored).toEqual([]);
  });
});
