/**
 * The HTTP + WebSocket server surface the backend's servers are written against.
 *
 * It is the part of `Bun.serve` they use and nothing more: a Fetch-API handler that may upgrade, a
 * bound port and URL, `stop()`, an idle timeout, and a socket's `data`, `send` and `close`. Two
 * implementations answer it, selected at resolution time by the `#serve` import's conditions
 * (Node's conditional exports): `serve.bun.ts` passes through to `Bun.serve` under Bun, and
 * `serve.node.ts` is `node:http` plus `ws` everywhere else, which is the packaged desktop backend
 * (specs/desktop.md §7.1). A bundle built for Node therefore contains no Bun code at all.
 *
 * `serve()` resolves once the server is listening, because Node binds asynchronously: a port read
 * straight after `listen()` is not there yet.
 *
 * @docs studio/desktop
 */

/** One upgraded WebSocket connection, carrying the `data` its upgrade attached. */
export interface ServeSocket<Data> {
  readonly data: Data;
  /** Send a text frame (a string) or a binary frame (bytes). A closed socket drops the frame. */
  send: (message: string | Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
}

/** Headers an upgrade may add to its 101 response. */
export interface UpgradeHeaders {
  "Sec-WebSocket-Protocol"?: string;
}

/** The running server, as a fetch handler sees it and as its owner stops it. */
export interface ServeServer<Data> {
  readonly port: number;
  /** The origin the server answers on, with a trailing `/` path. */
  readonly url: URL;
  /**
   * Accept a WebSocket upgrade for `req`, attaching `data` to the socket. True when the upgrade was
   * taken, in which case the handler returns `undefined`.
   *
   * The 101 response's only negotiable header is the subprotocol the server echoes (RFC 6455
   * §4.2.2), so that is the only one this accepts. Under Bun the `ws` package is Bun's own shim,
   * which emits no `headers` event, so a wider set could not be honoured on both runtimes.
   */
  upgrade: (req: Request, options: { data: Data; headers?: UpgradeHeaders }) => boolean;
  /** Stop listening; with `closeActiveConnections`, also drop open requests and sockets. */
  stop: (closeActiveConnections?: boolean) => Promise<void>;
}

/** Callbacks for upgraded sockets. A text frame arrives as a string, a binary one as a Buffer. */
export interface ServeWebSocketHandler<Data> {
  open?: (ws: ServeSocket<Data>) => void;
  message?: (ws: ServeSocket<Data>, message: string | Buffer) => void | Promise<void>;
  close?: (ws: ServeSocket<Data>, code: number, reason: string) => void;
}

export interface ServeOptions<Data> {
  /** Interface to bind; `0.0.0.0` when absent. */
  hostname?: string;
  /** Port to bind; `0` picks a free one. */
  port?: number;
  /** Seconds a connection may sit without traffic before it is closed. */
  idleTimeout?: number;
  fetch: (
    req: Request,
    server: ServeServer<Data>,
  ) => Response | undefined | Promise<Response | undefined>;
  websocket?: ServeWebSocketHandler<Data>;
}
