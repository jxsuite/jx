/**
 * The shared NDJSON import client: request shaping (headers/body), line parsing across chunk
 * boundaries, heartbeat tolerance, and terminal done/error handling.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { streamImport } from "../src/services/import-client";
import type { ImportProgressEvent, ImportSiteOptions } from "../src/types";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

const OPTS: ImportSiteOptions = {
  url: "https://clone.example/",
  name: "Clone",
  directory: "clone",
  depth: 1,
  maxPages: 20,
  aiComponents: true,
  apiKey: "sk-test",
  baseUrl: "http://llm.local/v1",
  model: "test-model",
};

function ndjsonResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  const fetchMock = mock(impl);
  globalThis.fetch = Object.assign(fetchMock, { preconnect: realFetch.preconnect });
  return fetchMock;
}

type FetchMock = ReturnType<typeof stubFetch>;

/** The `RequestInit` the client passed on the `index`th fetch, failing the test when it sent none. */
function sentInit(fetchMock: FetchMock, index = 0): RequestInit {
  const init = fetchMock.mock.calls[index]?.[1];
  if (!init) {
    throw new Error(`fetch call ${index} carried no RequestInit`);
  }
  return init;
}

/** The headers of the `index`th request, read through the platform's own `Headers`. */
function sentHeaders(fetchMock: FetchMock, index = 0): Headers {
  return new Headers(sentInit(fetchMock, index).headers);
}

/** The JSON object the `index`th request carried as its body. */
function sentBody(fetchMock: FetchMock, index = 0): JsonObject {
  const { body } = sentInit(fetchMock, index);
  if (!isString(body)) {
    throw new Error(`fetch call ${index} did not send a string body`);
  }
  const parsed: JsonValue = JSON.parse(body);
  if (!isJsonObject(parsed)) {
    throw new Error(`fetch call ${index} did not send a JSON object`);
  }
  return parsed;
}

describe("streamImport", () => {
  test("posts the request with credential headers and resolves the done line", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        ndjsonResponse([
          '{"type":"progress","phase":"capture","message":"Capturing...","current":1,"total":5}\n',
          '{"type":"heartbeat"}\n',
          '{"type":"done","root":"/projects/clone","config":{"name":"Clone"}}\n',
        ]),
      ),
    );

    const events: ImportProgressEvent[] = [];
    const result = await streamImport("/__studio/import-site", OPTS, (e) => events.push(e));

    expect(result).toEqual({ root: "/projects/clone", config: { name: "Clone" } });
    // Heartbeats are swallowed; progress is forwarded with counts.
    expect(events).toEqual([{ phase: "capture", message: "Capturing...", current: 1, total: 5 }]);

    const [endpoint] = fetchMock.mock.calls[0]!;
    expect(endpoint).toBe("/__studio/import-site");
    const headers = sentHeaders(fetchMock);
    expect(headers.get("X-Api-Key")).toBe("sk-test");
    expect(headers.get("X-Api-Base-URL")).toBe("http://llm.local/v1");
    expect(sentBody(fetchMock)).toEqual({
      url: "https://clone.example/",
      directory: "clone",
      depth: 1,
      maxPages: 20,
      aiComponents: true,
      aiModel: "test-model",
    });
  });

  test("omits credential headers when no key is set", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(ndjsonResponse(['{"type":"done","root":"/p","config":{}}\n'])),
    );
    const bare: ImportSiteOptions = {
      url: "https://x.example",
      name: "X",
      directory: "x",
      depth: 0,
      maxPages: 1,
      aiComponents: false,
    };
    await streamImport("/e", bare, () => {});
    const headers = sentHeaders(fetchMock);
    expect(headers.has("X-Api-Key")).toBe(false);
    expect(headers.has("X-Api-Base-URL")).toBe(false);
  });

  test("reassembles lines split across chunks", async () => {
    stubFetch(() =>
      Promise.resolve(
        ndjsonResponse([
          '{"type":"progress","phase":"sty',
          'les","message":"Diffing..."}\n{"type":"done","ro',
          'ot":"/p","config":{"name":"Split"}}\n',
        ]),
      ),
    );
    const events: ImportProgressEvent[] = [];
    const result = await streamImport("/e", OPTS, (e) => events.push(e));
    expect(events).toEqual([{ phase: "styles", message: "Diffing..." }]);
    expect(result.config).toEqual<JsonObject>({ name: "Split" });
  });

  /*
   * Tolerating a garbled line is right; hiding it is not. Before the counter, an import that
   * dropped half its progress lines finished looking clean and the user never learned which pages
   * were skipped.
   */
  test("counts unreadable lines and reports them once at the end", async () => {
    stubFetch(() =>
      Promise.resolve(
        ndjsonResponse([
          '{"type":"progress","phase":"crawl","message":"Fetching..."}\n',
          "{not json at all\n",
          "}{\n",
          '{"type":"done","root":"/p","config":{"name":"Partial"}}\n',
        ]),
      ),
    );
    const events: ImportProgressEvent[] = [];
    await streamImport("/e", OPTS, (e) => events.push(e));
    expect(events).toEqual([
      { phase: "crawl", message: "Fetching..." },
      {
        phase: "warning",
        message:
          "2 progress lines could not be read and were skipped — the import may be missing steps.",
      },
    ]);
  });

  test("a clean stream reports no warning", async () => {
    stubFetch(() =>
      Promise.resolve(
        ndjsonResponse([
          '{"type":"heartbeat"}\n',
          '{"type":"done","root":"/p","config":{"name":"Clean"}}\n',
        ]),
      ),
    );
    const events: ImportProgressEvent[] = [];
    await streamImport("/e", OPTS, (e) => events.push(e));
    expect(events).toEqual([]);
  });

  test("one unreadable line is reported in the singular", async () => {
    stubFetch(() =>
      Promise.resolve(
        ndjsonResponse(["oops\n", '{"type":"done","root":"/p","config":{"name":"One"}}\n']),
      ),
    );
    const events: ImportProgressEvent[] = [];
    await streamImport("/e", OPTS, (e) => events.push(e));
    expect(events[0]?.message).toBe(
      "1 progress line could not be read and was skipped — the import may be missing steps.",
    );
  });

  test("rejects on a terminal error line", async () => {
    stubFetch(() =>
      Promise.resolve(
        ndjsonResponse([
          '{"type":"progress","phase":"launch","message":"Launching browser..."}\n',
          '{"type":"error","error":"Chrome not found"}\n',
        ]),
      ),
    );
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(streamImport("/e", OPTS, () => {})).rejects.toThrow("Chrome not found");
  });

  test("rejects on a non-OK response with the JSON error body", async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ error: "url and directory are required" }, { status: 400 })),
    );
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(streamImport("/e", OPTS, () => {})).rejects.toThrow(
      "url and directory are required",
    );
  });

  test("rejects when the stream ends without a done line", async () => {
    stubFetch(() =>
      Promise.resolve(
        ndjsonResponse(['{"type":"progress","phase":"capture","message":"Capturing..."}\n']),
      ),
    );
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(streamImport("/e", OPTS, () => {})).rejects.toThrow(
      "Import stream ended without a result",
    );
  });

  test("forwards the abort signal to fetch", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(ndjsonResponse(['{"type":"done","root":"/p","config":{}}\n'])),
    );
    const controller = new AbortController();
    await streamImport("/e", OPTS, () => {}, controller.signal);
    expect(sentInit(fetchMock).signal).toBe(controller.signal);
  });
});

describe("streamImport — the run summary", () => {
  test("sends verify and its threshold only when they were asked for", async () => {
    const fetchMock = stubFetch(async () =>
      ndjsonResponse(['{"type":"done","root":"/p","config":{}}\n']),
    );
    await streamImport("/__studio/import-site", OPTS, () => {});
    const plain = sentBody(fetchMock);
    expect(plain).not.toHaveProperty("verify");
    expect(plain).not.toHaveProperty("verifyThreshold");
    expect(plain).not.toHaveProperty("verifyMinFidelity");

    await streamImport(
      "/__studio/import-site",
      { ...OPTS, verify: true, verifyMinFidelity: 60, verifyThreshold: 0.2 },
      () => {},
    );
    const asked = sentBody(fetchMock, 1);
    /* Two numbers, not one: `verifyThreshold` is pixelmatch's per-pixel colour tolerance and only
       moves the score, `verifyMinFidelity` is the bar the run is judged against. */
    expect(asked).toMatchObject({ verify: true, verifyMinFidelity: 60, verifyThreshold: 0.2 });
  });

  // 0 is a real answer — "report the score, judge nothing" — so it must survive the wire.
  test("sends a zero fidelity minimum rather than dropping it", async () => {
    const fetchMock = stubFetch(async () =>
      ndjsonResponse(['{"type":"done","root":"/p","config":{}}\n']),
    );
    await streamImport(
      "/__studio/import-site",
      { ...OPTS, verify: true, verifyMinFidelity: 0 },
      () => {},
    );
    expect(sentBody(fetchMock)["verifyMinFidelity"]).toBe(0);
  });

  test("returns what the run found", async () => {
    /* The pipeline computed all of this and the HTTP layer used to discard it: the caller learned
       only that an import had happened, never what it found — so it could neither report it nor
       ask about it. */
    stubFetch(async () =>
      ndjsonResponse([
        `${JSON.stringify({
          type: "done",
          root: "/p",
          config: { name: "Clone" },
          result: {
            pages: [{ route: "pages/index.json", title: "Home", nodeCount: 120 }],
            fileCount: 14,
            warnings: ["3 assets failed to download"],
            verify: {
              averageFidelity: 84,
              reportDir: "/p/verify",
              pages: [{ route: "pages/pricing.json", fidelity: 61 }],
            },
          },
        })}\n`,
      ]),
    );

    const out = await streamImport("/__studio/import-site", OPTS, () => {});
    expect(out.root).toBe("/p");
    expect(out.result).toMatchObject({
      fileCount: 14,
      warnings: ["3 assets failed to download"],
    });
    expect(out.result!.verify!.pages).toEqual([{ fidelity: 61, route: "pages/pricing.json" }]);
  });

  test("a done line with no result is a complete run, not a broken one", async () => {
    // A backend that does not send one is not broken, and an older one never will.
    stubFetch(async () =>
      ndjsonResponse(['{"type":"done","root":"/p","config":{"name":"Clone"}}\n']),
    );
    const out = await streamImport("/__studio/import-site", OPTS, () => {});
    expect(out.root).toBe("/p");
    expect(out.result).toBeUndefined();
  });
});

describe("the ready line", () => {
  test("names the root as soon as the destination is a project, long before done", async () => {
    stubFetch(async () =>
      ndjsonResponse([
        '{"type":"ready","root":"/home/dev/Sites/clone"}\n',
        '{"type":"progress","phase":"seed","message":"Created it"}\n',
        '{"type":"done","root":"/home/dev/Sites/clone","config":{"name":"Clone"}}\n',
      ]),
    );
    const seen: string[] = [];
    const events: ImportProgressEvent[] = [];
    await streamImport(
      "/e",
      OPTS,
      (e) => events.push(e),
      undefined,
      ({ root }) => {
        seen.push(root);
      },
    );
    expect(seen).toEqual(["/home/dev/Sites/clone"]);
    // And the progress line still arrives — the `ready` line adds a fact, it does not replace one.
    expect(events.map((e) => e.phase)).toContain("seed");
  });

  test("a caller with no interest in it is not required to have one", async () => {
    stubFetch(async () =>
      ndjsonResponse([
        '{"type":"ready","root":"/home/dev/Sites/clone"}\n',
        '{"type":"done","root":"/home/dev/Sites/clone","config":{}}\n',
      ]),
    );
    const result = await streamImport("/e", OPTS, () => {});
    expect(result.root).toBe("/home/dev/Sites/clone");
  });

  test("a ready line with no root is not a ready line", async () => {
    stubFetch(async () =>
      ndjsonResponse([
        '{"type":"ready"}\n',
        '{"type":"done","root":"/home/dev/Sites/clone","config":{}}\n',
      ]),
    );
    const seen: string[] = [];
    await streamImport(
      "/e",
      OPTS,
      () => {},
      undefined,
      ({ root }) => seen.push(root),
    );
    expect(seen).toEqual([]);
  });
});

describe("the breakpoint policy", () => {
  test("rides the request body when the caller has one", async () => {
    const fetchMock = stubFetch(async () =>
      ndjsonResponse(['{"type":"done","root":"r","config":{}}\n']),
    );
    await streamImport(
      "/e",
      { ...OPTS, breakpoints: { count: 3, mode: "limit", rounding: "nearest" } },
      () => {},
    );
    expect(sentBody(fetchMock)["breakpoints"]).toEqual({
      count: 3,
      mode: "limit",
      rounding: "nearest",
    });
  });

  test("is omitted entirely when the caller has none", async () => {
    const fetchMock = stubFetch(async () =>
      ndjsonResponse(['{"type":"done","root":"r","config":{}}\n']),
    );
    await streamImport("/e", OPTS, () => {});
    expect("breakpoints" in sentBody(fetchMock)).toBe(false);
  });
});
