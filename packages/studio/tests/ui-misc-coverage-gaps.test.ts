/**
 * Coverage-gap tests for scattered UI/support modules:
 *
 * - Jxsuite-update: the non-semver dev-build bailout and the missing-capability bailout.
 * - Page-params: the dev-proxy fetch fallback for ContentCollection resolution, extensions without
 *   the class, and the state-less resolveParamBoundState guard.
 */
import { installMockPlatform } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { applyJxsuiteUpdate, checkJxsuiteUpdate } from "../src/packages/jxsuite-update";
import { invalidateParamValues, loadParamValues, resolveParamBoundState } from "../src/page-params";
import { refreshFormats, setExtensions } from "../src/format/format-host";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

const realFetch = globalThis.fetch;

/** Answer every `fetch` from `answer`, keeping Bun's `preconnect` so the stub is a whole `fetch`. */
function stubFetch(answer: (resource: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = Object.assign(answer, { preconnect: realFetch.preconnect });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ─── Jxsuite update bailouts ─────────────────────────────────────────────────

describe("jxsuite-update bailouts", () => {
  test("a dev build still checks — the target is the registry, not this build's version", async () => {
    /*
     * This USED to bail: the target was `VERSION`, and a dev build's "dev" is not a semver, so no
     * project ever got an update prompt from a dev build. The target is each package's own newest
     * publish now, which a dev build can ask for exactly like a released one. The test build's
     * VERSION is still "dev"; the check no longer cares.
     */
    installMockPlatform({
      packageVersions: async () => [
        { current: "^0.1.0", latest: "0.4.0", name: "@jxsuite/runtime" },
      ],
    });
    expect(await checkJxsuiteUpdate()).toEqual([
      { current: "^0.1.0", dev: false, latest: "0.4.0", name: "@jxsuite/runtime" },
    ]);
  });

  test("applyJxsuiteUpdate without setPackageVersions is a silent no-op", async () => {
    installMockPlatform();
    await applyJxsuiteUpdate([
      { current: "^0.1.0", dev: false, latest: "0.4.0", name: "@jxsuite/runtime" },
    ]);
    expect(document.querySelector(".progress-modal")).toBeNull();
  });
});

// ─── Page params ─────────────────────────────────────────────────────────────

describe("page-params gaps", () => {
  beforeEach(() => {
    invalidateParamValues();
    refreshFormats();
  });

  afterEach(() => {
    refreshFormats();
  });

  test("platforms without resolveClass fall back to the dev proxy", async () => {
    installMockPlatform();
    const calls: { body: string; url: string }[] = [];
    // `page-params` posts to a string url, so `String(resource)` is that url unchanged.
    stubFetch((resource, init) => {
      calls.push({ body: String(init?.body), url: String(resource) });
      return Promise.resolve(Response.json([{ id: "a1" }, { data: { sku: "S-2" }, id: "a2" }]));
    });

    const values = await loadParamValues("proxy-ok", {
      contentType: "product",
      field: "sku",
      param: "sku",
    });
    expect(values).toEqual({ sku: ["a1", "S-2"] });
    expect(calls[0]!.url).toBe("/__jx_resolve__");
    const body: JsonValue = JSON.parse(calls[0]!.body);
    expect(body).toMatchObject({ $prototype: "ContentCollection", contentType: "product" });
  });

  test("a failing dev-proxy resolution degrades to no values", async () => {
    installMockPlatform();
    stubFetch(() => Promise.resolve(new Response("boom", { status: 500 })));
    expect(await loadParamValues("proxy-fail", { contentType: "product" })).toEqual({});
  });

  test("extensions without a ContentCollection class are skipped in $src resolution", async () => {
    const bodies: JsonObject[] = [];
    installMockPlatform({
      resolveClass: async (body) => {
        bodies.push(body);
        return [{ id: "x1" }];
      },
    });
    setExtensions([
      {
        classes: [{ name: "Markdown", path: "/deps/markdown.class.json" }],
        contributions: [],
        name: "markdown",
        specifier: "@ext/markdown",
      },
      {
        classes: [{ name: "ContentCollection", path: "/deps/cc.class.json" }],
        contributions: [],
        name: "cc",
        specifier: "@ext/cc",
      },
    ]);
    const values = await loadParamValues("ext-mixed", { contentType: "product" });
    expect(values).toEqual({ slug: ["x1"] });
    expect(bodies[0]!.$src).toBe("/deps/cc.class.json");
  });

  test("resolveParamBoundState without doc state is a guarded no-op", async () => {
    let resolved = 0;
    installMockPlatform({
      resolveClass: async () => {
        resolved += 1;
        return {};
      },
    });
    await resolveParamBoundState({ tagName: "div" }, ["product"]);
    expect(resolved).toBe(0);
  });
});
