/**
 * The Node implementation of `serve()`, driven over real sockets. Imported by path rather than
 * through `#serve`, because under `bun test` the condition picks the Bun pass-through.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { WebSocket } from "ws";
import { isString } from "@jxsuite/schema/guards";
import { requestUrl, serve } from "../src/serve.node.ts";
import type { ServeServer, ServeSocket } from "../src/serve.ts";

const running: Pick<ServeServer<unknown>, "stop">[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop(true)));
});

async function start<Data>(options: Parameters<typeof serve<Data>>[0]): Promise<ServeServer<Data>> {
  const server = await serve<Data>({ hostname: "127.0.0.1", ...options });
  running.push(server);
  return server;
}

/** Open a ws client and resolve once it is open (or with the HTTP status it was refused with). */
function openSocket(url: string, protocols?: string[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols);
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`status ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<{ data: Buffer; isBinary: boolean }> {
  return new Promise((resolve) => {
    ws.once("message", (data, isBinary) => {
      /* SAFETY: a ws client with the default `binaryType` delivers each frame as one Buffer. */
      resolve({ data: data as Buffer, isBinary });
    });
  });
}

/** GET `target` over a raw socket, exactly as written, and resolve with the response body. */
function rawGet(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      );
    });
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      received += chunk;
    });
    socket.once("error", reject);
    socket.once("end", () => {
      const body = received.slice(received.indexOf("\r\n\r\n") + 4);
      // A streamed body arrives chunked: one size line, the chunk, then the terminator.
      const chunked = /^[\da-f]+\r\n([\s\S]*?)\r\n0\r\n\r\n$/i.exec(body);
      resolve(chunked ? chunked[1]! : body);
    });
  });
}

describe("requestUrl", () => {
  test("joins an origin-form target to the origin without resolving it", () => {
    expect(requestUrl("//home/me/a.json", "http://127.0.0.1:1").href).toBe(
      "http://127.0.0.1:1//home/me/a.json",
    );
    expect(requestUrl(undefined, "http://127.0.0.1:1").href).toBe("http://127.0.0.1:1/");
  });

  test("keeps only the path and query of an absolute-form target", () => {
    expect(requestUrl("http://elsewhere/x?y=2#z", "http://127.0.0.1:1").href).toBe(
      "http://127.0.0.1:1/x?y=2",
    );
  });
});

describe("serve (node:http)", () => {
  test("answers on the bound port and reports its URL", async () => {
    const server = await start({ fetch: () => new Response("hello") });
    expect(server.port).toBeGreaterThan(0);
    expect(server.url.href).toBe(`http://127.0.0.1:${server.port}/`);
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  test("names the origin localhost for a wildcard bind and brackets an IPv6 literal", async () => {
    const wildcard = await serve({ fetch: () => new Response("") });
    running.push(wildcard);
    expect(wildcard.url.hostname).toBe("localhost");
    const v6 = await serve({ fetch: () => new Response(""), hostname: "::1" });
    running.push(v6);
    expect(v6.url.host).toBe(`[::1]:${v6.port}`);
  });

  test("passes the method, URL, headers and body through as a Request", async () => {
    const server = await start({
      fetch: async (req) =>
        Response.json({
          body: await req.text(),
          header: req.headers.get("x-test"),
          method: req.method,
          url: req.url,
        }),
    });
    const res = await fetch(new URL("/a/b?c=1", server.url), {
      body: "payload",
      headers: { "x-test": "yes" },
      method: "POST",
    });
    expect(await res.json()).toEqual({
      body: "payload",
      header: "yes",
      method: "POST",
      url: `http://127.0.0.1:${server.port}/a/b?c=1`,
    });
  });

  test("keeps a target that opens with // as the path, as Bun.serve does", async () => {
    /* The Studio asks for a file under an absolute project root as `//home/…`. A client `fetch`
       would itself read that as scheme-relative, so the request line is written by hand. */
    const server = await start({ fetch: (req) => new Response(req.url) });
    const origin = `http://127.0.0.1:${server.port}`;
    expect(await rawGet(server.port, "//home/me/site/components/a.json")).toBe(
      `${origin}//home/me/site/components/a.json`,
    );
    expect(await rawGet(server.port, "/a//b?c=1")).toBe(`${origin}/a//b?c=1`);
    expect(await rawGet(server.port, "http://elsewhere/x?y=2")).toBe(`${origin}/x?y=2`);
  });

  test("keeps every Set-Cookie header and answers HEAD without a body", async () => {
    const server = await start({
      fetch: () => {
        const headers = new Headers({ "content-type": "text/plain" });
        headers.append("set-cookie", "a=1");
        headers.append("set-cookie", "b=2");
        return new Response("body", { headers, status: 201, statusText: "Made" });
      },
    });
    const res = await fetch(server.url);
    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Made");
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    const head = await fetch(server.url, { method: "HEAD" });
    expect(await head.text()).toBe("");
  });

  test("streams a body chunk by chunk rather than buffering it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = await start({
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode("data: first\n\n"));
              await gate;
              controller.enqueue(new TextEncoder().encode("data: second\n\n"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    const res = await fetch(server.url);
    const reader = res.body!.getReader();
    const first = await reader.read();
    // The first event arrived while the producer is still parked on the gate.
    expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n");
    release();
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toBe("data: second\n\n");
  });

  test("waits for the client to drain a body larger than the socket buffer", async () => {
    const chunk = new Uint8Array(1_048_576).fill(97);
    const server = await start({
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (let i = 0; i < 16; i += 1) {
                controller.enqueue(chunk);
              }
              controller.close();
            },
          }),
        ),
    });
    const res = await fetch(server.url);
    const reader = res.body!.getReader();
    // Hold off reading so the server's writes back up and it has to wait for "drain".
    await Bun.sleep(50);
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.length;
    }
    expect(total).toBe(16 * 1_048_576);
  });

  test("ends the response when the body's producer fails", async () => {
    const server = await start({
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial"));
            },
            pull(controller) {
              controller.error(new Error("producer failed"));
            },
          }),
        ),
    });
    const res = await fetch(server.url);
    // What was sent before the failure arrives, and the response ends rather than hanging.
    expect(await res.text()).toBe("partial");
  });

  test("aborts the request's signal when the client goes away mid-stream", async () => {
    let aborted: () => void = () => {};
    const abortSeen = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const server = await start({
      fetch: (req) => {
        req.signal.addEventListener("abort", () => aborted());
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("x"));
            },
          }),
        );
      },
    });
    const controller = new AbortController();
    const res = await fetch(server.url, { signal: controller.signal });
    await res.body!.getReader().read();
    controller.abort();
    await abortSeen;
  });

  test("answers 500 when the handler throws or returns nothing", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const throwing = await start({
        fetch: () => {
          throw new Error("boom");
        },
      });
      const thrown = await fetch(throwing.url);
      expect(thrown.status).toBe(500);
      const empty = await start({ fetch: () => {} });
      const unanswered = await fetch(empty.url);
      expect(unanswered.status).toBe(500);
    } finally {
      console.error = original;
    }
  });

  test("upgrades with data and headers, and carries text and binary frames both ways", async () => {
    const events: string[] = [];
    let closed: () => void = () => {};
    const closeSeen = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const server = await start<{ who: string }>({
      fetch: (req, srv) =>
        srv.upgrade(req, {
          data: { who: new URL(req.url).searchParams.get("who") ?? "" },
          headers: { "Sec-WebSocket-Protocol": "jx.v1" },
        })
          ? undefined
          : new Response("no", { status: 400 }),
      websocket: {
        open: (ws) => events.push(`open ${ws.data.who}`),
        message: (ws: ServeSocket<{ who: string }>, message) => {
          if (isString(message)) {
            ws.send(`echo ${message} from ${ws.data.who}`);
          } else {
            ws.send(new Uint8Array([...message].map((byte) => byte + 1)));
          }
        },
        close: (_ws, code) => {
          events.push(`close ${code}`);
          closed();
        },
      },
    });
    // The 101's headers, read off a raw handshake: Bun's `ws` client shim does not expose them.
    const handshake = await new Promise<string>((resolve) => {
      const raw = connect(server.port, "127.0.0.1", () => {
        raw.write(
          [
            "GET /?who=raw HTTP/1.1",
            `Host: 127.0.0.1:${server.port}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Protocol: jx.v1, jx.v0",
            "",
            "",
          ].join("\r\n"),
        );
      });
      raw.once("data", (chunk) => {
        resolve(chunk.toString());
        raw.destroy();
      });
    });
    expect(handshake).toStartWith("HTTP/1.1 101");
    expect(handshake.toLowerCase()).toContain("sec-websocket-protocol: jx.v1");
    await closeSeen;
    closed = () => {};
    events.length = 0;
    const reclosed = new Promise<void>((resolve) => {
      closed = resolve;
    });

    const ws = await openSocket(`ws://127.0.0.1:${server.port}/?who=ann`, ["jx.v1", "jx.v0"]);
    expect(ws.protocol).toBe("jx.v1");

    const text = nextMessage(ws);
    ws.send("hi");
    const textReply = await text;
    expect(textReply.isBinary).toBe(false);
    expect(textReply.data.toString()).toBe("echo hi from ann");

    const binary = nextMessage(ws);
    ws.send(new Uint8Array([1, 2, 3]));
    const binaryReply = await binary;
    expect(binaryReply.isBinary).toBe(true);
    expect([...binaryReply.data]).toEqual([2, 3, 4]);

    ws.close(4000, "bye");
    await reclosed;
    expect(events).toEqual(["open ann", "close 4000"]);
  });

  test("a server-side close reaches the client", async () => {
    const server = await start({
      fetch: (req, srv) => (srv.upgrade(req, { data: undefined }) ? undefined : undefined),
      websocket: { open: (ws) => ws.close(4001, "go away") },
    });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/`);
    const code = await new Promise<number>((resolve) => {
      ws.once("close", (closeCode) => resolve(closeCode));
    });
    expect(code).toBe(4001);
  });

  test("answers a refused upgrade with the handler's own response", async () => {
    const server = await start({
      fetch: () =>
        new Response("forbidden", {
          headers: { "x-reason": "token" },
          status: 403,
          statusText: "Forbidden",
        }),
    });
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(openSocket(`ws://127.0.0.1:${server.port}/`)).rejects.toThrow("status 403");
  });

  test("answers 400 to an upgrade the handler neither took nor answered", async () => {
    const server = await start({ fetch: () => {} });
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(openSocket(`ws://127.0.0.1:${server.port}/`)).rejects.toThrow("status 400");
  });

  test("a second upgrade of the same request is refused", async () => {
    let second: boolean | undefined;
    const server = await start({
      fetch: (req, srv) => {
        srv.upgrade(req, { data: undefined });
        second = srv.upgrade(req, { data: undefined });
      },
    });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/`);
    expect(second).toBe(false);
    ws.terminate();
  });

  test("a request that was never an upgrade cannot be upgraded", async () => {
    const server = await start({
      fetch: (req, srv) => new Response(String(srv.upgrade(req, { data: undefined }))),
    });
    const res = await fetch(server.url);
    expect(await res.text()).toBe("false");
  });

  test("an upgrade handler that throws answers 500", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const server = await start({
        fetch: () => {
          throw new Error("boom");
        },
      });
      // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
      await expect(openSocket(`ws://127.0.0.1:${server.port}/`)).rejects.toThrow("status 500");
    } finally {
      console.error = original;
    }
  });

  test("closes a connection idle past idleTimeout", async () => {
    const server = await start({ fetch: () => new Response("ok"), idleTimeout: 0.05 });
    const socket = connect(server.port, "127.0.0.1");
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
    });
    expect(socket.destroyed).toBe(true);
  });

  test("stop(true) drops open sockets and stop() stops listening", async () => {
    const server = await serve({
      fetch: (req, srv) => (srv.upgrade(req, { data: undefined }) ? undefined : new Response("")),
      hostname: "127.0.0.1",
    });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/`);
    const closed = new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
    });
    await server.stop(true);
    await closed;
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(fetch(server.url)).rejects.toThrow();
  });

  test("rejects when the port is taken", async () => {
    const first = await start({ fetch: () => new Response("") });
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(
      serve({ fetch: () => new Response(""), hostname: "127.0.0.1", port: first.port }),
    ).rejects.toThrow();
  });
});
