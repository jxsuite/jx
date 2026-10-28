/**
 * `serve()` on `node:http` and `ws`: the default of `#serve` (`serve.ts`), so every runtime that is
 * not Bun gets it, and the packaged desktop backend runs on it (specs/desktop.md §7.1).
 *
 * The work is the conversion at both edges. A request becomes a Fetch `Request` whose `signal`
 * aborts when the client goes away (the AI and import routes cancel upstream work on it), and a
 * `Response` body is streamed chunk by chunk with backpressure, never buffered, because SSE and AI
 * streams are open-ended. An upgrade request reaches the same `fetch` handler, which accepts it
 * with `server.upgrade()` as it would under Bun, or answers it with an ordinary `Response`.
 *
 * `tests/serve-node.test.ts` imports this file directly, so it runs under `bun test` as well.
 *
 * @docs studio/desktop
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import type { ServeOptions, ServeServer, ServeSocket } from "./serve.ts";

export type * from "./serve.ts";

/** What an upgrade request carries until the handler accepts or answers it. */
interface PendingUpgrade {
  nodeReq: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  taken: boolean;
}

/** The `Sec-WebSocket-Protocol` an accepted upgrade echoes, read by `handleProtocols`. */
const echoedProtocol = new WeakMap<IncomingMessage, string>();

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

/**
 * The request body as `node:http` delivers it.
 *
 * @yields {Uint8Array} Each chunk of the body, in order
 */
async function* chunksOf(nodeReq: IncomingMessage): AsyncGenerator<Uint8Array> {
  /* SAFETY: an `IncomingMessage` with no encoding set yields its body as Buffers; anything else is
     skipped by the check below. */
  for await (const chunk of nodeReq as AsyncIterable<unknown>) {
    if (chunk instanceof Uint8Array) {
      yield chunk;
    }
  }
}

/** The `Request` for a Node request, with a signal that aborts when the client disconnects. */
function toRequest(nodeReq: IncomingMessage, origin: string, signal?: AbortSignal): Request {
  const headers = new Headers();
  for (let i = 0; i < nodeReq.rawHeaders.length; i += 2) {
    headers.append(nodeReq.rawHeaders[i]!, nodeReq.rawHeaders[i + 1]!);
  }
  const { host } = nodeReq.headers;
  const url = new URL(nodeReq.url ?? "/", host ? `http://${host}` : origin);
  const method = nodeReq.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { headers, method };
  if (signal) {
    init.signal = signal;
  }
  if (!BODYLESS_METHODS.has(method)) {
    const source = chunksOf(nodeReq);
    init.body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await source.next();
        if (next.done === true) {
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      },
    });
    init.duplex = "half";
  }
  return new Request(url, init);
}

/** Resolve when `res` can take more, or has closed and never will. */
function drained(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.on("drain", done);
    res.on("close", done);
  });
}

/** Write `response` to `res`, streaming its body and stopping when the client goes away. */
async function writeResponse(
  response: Response,
  res: ServerResponse,
  method: string,
): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of response.headers) {
    if (key !== "set-cookie") {
      headers[key] = value;
    }
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) {
    headers["set-cookie"] = cookies;
  }
  res.writeHead(response.status, response.statusText, headers);
  if (!response.body || method === "HEAD") {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  const cancel = (): void => {
    void reader.cancel().catch(() => {});
  };
  res.once("close", cancel);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) {
        break;
      }
      // `flushHeaders` is implied by the first write; each chunk goes out as it arrives.
      if (!res.write(value)) {
        await drained(res);
      }
    }
  } catch {
    // The body's producer failed or was cancelled; what was sent is all the client gets.
  } finally {
    res.off("close", cancel);
    res.end();
  }
}

/** Answer an upgrade request the handler refused (or never accepted) with a plain HTTP response. */
async function rejectUpgrade(socket: Duplex, response: Response): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  const lines = [`HTTP/1.1 ${response.status} ${response.statusText || "Error"}`];
  for (const [key, value] of response.headers) {
    lines.push(`${key}: ${value}`);
  }
  lines.push(`content-length: ${body.length}`, "connection: close", "", "");
  const head = Buffer.from(lines.join("\r\n"));
  socket.end(Buffer.concat([head, body]));
}

/** A frame as the handler receives it: text as a string, binary as one Buffer. */
function frameOf(data: RawData, isBinary: boolean): string | Buffer {
  const bytes = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.isBuffer(data)
      ? data
      : Buffer.from(data);
  return isBinary ? bytes : bytes.toString("utf8");
}

/** Start a server and resolve once it is listening. */
export async function serve<Data = undefined>(
  options: ServeOptions<Data>,
): Promise<ServeServer<Data>> {
  const hostname = options.hostname ?? "0.0.0.0";
  const handler = options.websocket;
  const pending = new WeakMap<Request, PendingUpgrade>();
  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({
    handleProtocols: (_protocols, nodeReq) => echoedProtocol.get(nodeReq) ?? false,
    noServer: true,
  });

  const http = createServer();
  if (options.idleTimeout !== undefined) {
    http.setTimeout(options.idleTimeout * 1000, (socket) => socket.destroy());
  }

  let origin = "";
  let url = new URL("http://localhost/");

  const server: ServeServer<Data> = {
    get port() {
      return Number(url.port);
    },
    get url() {
      return url;
    },
    upgrade(req, { data, headers }) {
      const upgrade = pending.get(req);
      if (!upgrade || upgrade.taken) {
        return false;
      }
      upgrade.taken = true;
      const protocol = headers?.["Sec-WebSocket-Protocol"];
      if (protocol !== undefined) {
        echoedProtocol.set(upgrade.nodeReq, protocol);
      }
      wss.handleUpgrade(upgrade.nodeReq, upgrade.socket, upgrade.head, (ws) => {
        sockets.add(ws);
        const socket: ServeSocket<Data> = {
          data,
          send: (message) => ws.send(message),
          close: (code, reason) => ws.close(code, reason),
        };
        ws.on("message", (raw, isBinary) => {
          void handler?.message?.(socket, frameOf(raw, isBinary));
        });
        ws.on("close", (code, reason) => {
          sockets.delete(ws);
          handler?.close?.(socket, code, reason.toString("utf8"));
        });
        handler?.open?.(socket);
      });
      return true;
    },
    stop(closeActiveConnections) {
      return new Promise<void>((resolve) => {
        http.close(() => resolve());
        if (closeActiveConnections) {
          http.closeAllConnections();
          for (const ws of sockets) {
            ws.terminate();
          }
        }
      });
    },
  };

  http.on("request", (nodeReq, res) => {
    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableFinished) {
        controller.abort();
      }
    });
    const method = nodeReq.method ?? "GET";
    void (async () => {
      let response: Response | undefined;
      try {
        response = await options.fetch(toRequest(nodeReq, origin, controller.signal), server);
      } catch (error) {
        console.error("[serve]", error);
        response = new Response("Internal Server Error", { status: 500 });
      }
      await writeResponse(
        response ?? new Response("Internal Server Error", { status: 500 }),
        res,
        method,
      );
    })();
  });

  http.on("upgrade", (nodeReq, socket, head) => {
    const req = toRequest(nodeReq, origin);
    const upgrade: PendingUpgrade = { head, nodeReq, socket, taken: false };
    pending.set(req, upgrade);
    void (async () => {
      let response: Response | undefined;
      try {
        response = await options.fetch(req, server);
      } catch (error) {
        console.error("[serve]", error);
        response = new Response("Internal Server Error", { status: 500 });
      }
      if (!upgrade.taken) {
        await rejectUpgrade(socket, response ?? new Response("Upgrade failed", { status: 400 }));
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? 0, hostname, () => {
      http.off("error", reject);
      resolve();
    });
  });
  const address = http.address();
  /* SAFETY: a TCP listener's `address()` is an `AddressInfo`; it is a string only for a pipe or a
     Unix socket, which this function never binds. */
  const { port } = address as { port: number };
  const host =
    hostname === "0.0.0.0" || hostname === "::"
      ? "localhost"
      : hostname.includes(":")
        ? `[${hostname}]`
        : hostname;
  origin = `http://${host}:${port}`;
  url = new URL(`${origin}/`);
  return server;
}
