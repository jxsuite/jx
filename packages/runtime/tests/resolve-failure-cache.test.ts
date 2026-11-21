import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { defineElement, forgetSource, preloadDocument, resolve } from "../src/runtime";

import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const json = (doc: JsonValue | JxDocument): Response => Response.json(doc);

/** The message a promise rejects with, or `"resolved"` when it does not reject. */
async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const realFetch = globalThis.fetch;

/** A `fetch` that answers from a queue of outcomes, one per call, and counts its calls. */
function queuedFetch(outcomes: (() => Response | Promise<Response>)[]) {
  let index = 0;
  const handler = mock(() => {
    const next = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    return Promise.resolve(next ? next() : Response.error());
  });
  globalThis.fetch = Object.assign(handler, { preconnect: realFetch.preconnect });
  return handler;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("resolve does not remember a failure", () => {
  test("a non-ok response is fetched again on the next call", async () => {
    const url = "http://localhost/rfc/not-ok.json";
    const spy = queuedFetch([
      () => new Response("", { status: 500 }),
      () => json({ tagName: "div" }),
    ]);
    expect(await failureOf(resolve(url))).toContain("failed to fetch");
    const doc = await resolve(url);
    expect(doc.tagName).toBe("div");
    expect(spy.mock.calls.length).toBe(2);
  });

  test("a network error is fetched again on the next call", async () => {
    const url = "http://localhost/rfc/network.json";
    const spy = queuedFetch([
      () => Promise.reject(new TypeError("network down")),
      () => json({ tagName: "span" }),
    ]);
    expect(await failureOf(resolve(url))).toBe("network down");
    const doc = await resolve(url);
    expect(doc.tagName).toBe("span");
    expect(spy.mock.calls.length).toBe(2);
  });

  test("a success is still served from the cache", async () => {
    const url = "http://localhost/rfc/ok.json";
    const spy = queuedFetch([() => json({ tagName: "p" })]);
    const first = await resolve(url);
    const second = await resolve(url);
    expect(second).toBe(first);
    expect(spy.mock.calls.length).toBe(1);
  });
});

describe("defineElement releases a failed claim", () => {
  test("a definition whose fetch failed is attempted again and succeeds", async () => {
    const url = "http://localhost/rfc/retry-el.json";
    const doc: JxDocument = { tagName: "rfc-retry-el", textContent: "ok" };
    const spy = queuedFetch([() => new Response("", { status: 404 }), () => json(doc)]);
    expect(await failureOf(defineElement(url))).toContain("(404)");
    expect(customElements.get("rfc-retry-el")).toBeUndefined();
    await defineElement(url);
    expect(customElements.get("rfc-retry-el")).toBeDefined();
    // And a success stays claimed: a third call neither fetches nor throws.
    await defineElement(url);
    expect(spy.mock.calls.length).toBe(2);
  });

  test("a definition that failed after resolving (bad tagName) is attempted again", async () => {
    const url = "http://localhost/rfc/bad-tag.json";
    preloadDocument(url, { tagName: "nohyphen" });
    const first = await failureOf(defineElement(url));
    // Still a failure, but a real attempt rather than a silent early return.
    const second = await failureOf(defineElement(url));
    expect([first, second].map((m) => m.includes("must contain a hyphen"))).toEqual([true, true]);
  });
});

describe("forgetSource", () => {
  test("drops a cached document under both spellings so the next resolve fetches", async () => {
    const spy = queuedFetch([() => json({ tagName: "b" }), () => json({ tagName: "i" })]);
    const url = "http://localhost/rfc/forget.json";
    const before = await resolve(url);
    forgetSource(url);
    const after = await resolve(url);
    expect([before.tagName, after.tagName]).toEqual(["b", "i"]);
    expect(spy.mock.calls.length).toBe(2);
  });

  test("drops a preloaded relative key and its absolute form", async () => {
    preloadDocument("/rfc/rel.json", { tagName: "em" });
    const spy = queuedFetch([() => json({ tagName: "strong" })]);
    forgetSource("/rfc/rel.json");
    const doc = await resolve("/rfc/rel.json");
    expect(doc.tagName).toBe("strong");
    expect(spy.mock.calls.length).toBe(1);
  });

  test("releases a defineElement claim so the URL is resolved again", async () => {
    const url = "http://localhost/rfc/forget-el.json";
    preloadDocument(url, { tagName: "rfc-forget-el" });
    await defineElement(url);
    const spy = queuedFetch([() => json({ tagName: "rfc-forget-el" })]);
    forgetSource(url);
    // The tag stays registered, but the URL is no longer short-circuited: it is fetched again.
    await defineElement(url);
    expect(spy.mock.calls.length).toBe(1);
  });

  test("accepts a key that is not a URL at all", () => {
    expect(() => forgetSource("http://[bad")).not.toThrow();
  });
});
