/** A `.jxn` `$ref` in the runtime: the seam a host supplies, and the refusal without one. */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { resolve, setDocumentParser } from "../src/runtime.ts";

const realFetch = globalThis.fetch;

/** The next fetch answers with this body and type. */
function answer(body: string, type: string): void {
  const handler = () => Promise.resolve(new Response(body, { headers: { "Content-Type": type } }));
  globalThis.fetch = Object.assign(handler, { preconnect: realFetch.preconnect });
}

let next = 0;
/** A URL this run has not cached. */
function url(ext: string): string {
  next += 1;
  return `https://x.test/doc-${next}${ext}`;
}

beforeEach(() => {
  setDocumentParser(null);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setDocumentParser(null);
});

describe("a .jxn document", () => {
  test("answered as JSON needs no parser, which is what a site origin does", async () => {
    answer(JSON.stringify({ tagName: "main" }), "application/json");
    expect(await resolve(url(".jxn"))).toEqual({ tagName: "main" });
  });

  test("answered as text goes to the parser the host supplied", async () => {
    answer("main", "text/plain;charset=utf-8");
    const parser = mock(() => ({ tagName: "parsed" }));
    setDocumentParser(parser);
    const source = url(".jxn");
    expect(await resolve(source)).toEqual({ tagName: "parsed" });
    expect(parser).toHaveBeenCalledWith("main", source);
  });

  test("with a query string is still one", async () => {
    answer("main", "text/plain");
    setDocumentParser(() => ({ tagName: "parsed" }));
    expect(await resolve(`${url(".jxn")}?v=1`)).toEqual({ tagName: "parsed" });
  });

  test("with no parser is refused, naming the import that fixes it", async () => {
    answer("main", "text/plain");
    let message = "";
    try {
      await resolve(url(".jxn"));
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("@jxsuite/schema/jxn");
  });
});

describe("the core", () => {
  test("a .json document never reaches the parser", async () => {
    answer(JSON.stringify({ tagName: "main" }), "text/plain");
    const parser = mock(() => ({ tagName: "parsed" }));
    setDocumentParser(parser);
    expect(await resolve(url(".json"))).toEqual({ tagName: "main" });
    expect(parser).not.toHaveBeenCalled();
  });

  test("it does not import the parser", () => {
    const source = readFileSync(resolvePath(import.meta.dir, "../src/runtime.ts"), "utf8");
    expect(source).not.toContain("@bgotink/kdl");
    expect(source).not.toMatch(/from "@jxsuite\/schema\/jxn"/u);
  });
});
