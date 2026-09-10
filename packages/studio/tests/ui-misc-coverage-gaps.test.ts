/**
 * Coverage-gap tests for scattered UI/support modules:
 *
 * - Value-selector: the textfield click-containment arrow.
 * - Jxsuite-update: the non-semver dev-build bailout and the missing-capability bailout.
 * - Page-params: the dev-proxy fetch fallback for ContentCollection resolution, extensions without
 *   the class, and the state-less resolveParamBoundState guard.
 */
import { installMockPlatform } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { JxValueSelector } from "../src/ui/value-selector";
import { applyJxsuiteUpdate, checkJxsuiteUpdate } from "../src/packages/jxsuite-update";
import { invalidateParamValues, loadParamValues, resolveParamBoundState } from "../src/page-params";
import { refreshFormats, setExtensions } from "../src/format/format-host";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ─── Value selector ──────────────────────────────────────────────────────────

describe("value-selector textfield click containment", () => {
  if (!customElements.get("jx-value-selector")) {
    customElements.define("jx-value-selector", JxValueSelector);
  }

  test("clicks inside the textfield stop propagating (the overlay trigger must not fire)", async () => {
    const el = document.createElement("jx-value-selector") as JxValueSelector;
    el.options = [{ label: "Italic", value: "italic" }] as JxValueSelector["options"];
    document.body.append(el);
    await el.updateComplete;
    const tf = el.querySelector("sp-textfield")!;
    let escaped = 0;
    el.addEventListener("click", () => {
      escaped += 1;
    });
    tf.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(escaped).toBe(0);
    el.remove();
  });
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
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ body: String(init?.body), url });
      return Promise.resolve(Response.json([{ id: "a1" }, { data: { sku: "S-2" }, id: "a2" }]));
    }) as unknown as typeof fetch;

    const values = await loadParamValues("proxy-ok", {
      contentType: "product",
      field: "sku",
      param: "sku",
    });
    expect(values).toEqual({ sku: ["a1", "S-2"] });
    expect(calls[0]!.url).toBe("/__jx_resolve__");
    const body = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(body.$prototype).toBe("ContentCollection");
    expect(body.contentType).toBe("product");
  });

  test("a failing dev-proxy resolution degrades to no values", async () => {
    installMockPlatform();
    globalThis.fetch = (() =>
      Promise.resolve(new Response("boom", { status: 500 }))) as unknown as typeof fetch;
    expect(await loadParamValues("proxy-fail", { contentType: "product" })).toEqual({});
  });

  test("extensions without a ContentCollection class are skipped in $src resolution", async () => {
    const bodies: Record<string, unknown>[] = [];
    installMockPlatform({
      resolveClass: async (body: Record<string, unknown>) => {
        bodies.push(body);
        return [{ id: "x1" }];
      },
    } as never);
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
    } as never);
    await resolveParamBoundState({ tagName: "div" } as never, ["product"]);
    expect(resolved).toBe(0);
  });
});
