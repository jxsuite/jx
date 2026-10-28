/**
 * `serve()` under Bun: `Bun.serve`, adapted to `serve.ts`'s shape. Selected by the `bun` condition
 * of `#serve`, so only a Bun process ever loads this file.
 *
 * @docs studio/desktop
 */
import type { Server } from "bun";
import type { ServeOptions, ServeServer } from "./serve.ts";

export type * from "./serve.ts";

/** Bun's `Server`, seen through the surface `serve.ts` declares. */
function adapt<Data>(server: Server<Data>): ServeServer<Data> {
  /* SAFETY: Bun declares `upgrade`'s options as a rest tuple conditional on `Data`, which an
     unresolved type parameter never selects; for every `Data` either branch takes this object. */
  const upgradeSocket = server.upgrade.bind(server) as (
    req: Request,
    options: { data: Data; headers?: HeadersInit },
  ) => boolean;
  return {
    get port() {
      return Number(server.url.port);
    },
    get url() {
      return server.url;
    },
    upgrade: (req, { data, headers }) =>
      upgradeSocket(req, headers === undefined ? { data } : { data, headers: { ...headers } }),
    stop: (closeActiveConnections) => server.stop(closeActiveConnections),
  };
}

/** Start a server and resolve once it is listening (which, under Bun, is already). */
export async function serve<Data = undefined>(
  options: ServeOptions<Data>,
): Promise<ServeServer<Data>> {
  const { fetch: handle, websocket, ...rest } = options;
  let adapted: ServeServer<Data> | null = null;
  const server = Bun.serve<Data>({
    ...rest,
    fetch: (req, bunServer) => handle(req, (adapted ??= adapt(bunServer))),
    websocket: {
      close: (ws, code, reason) => websocket?.close?.(ws, code, reason),
      message: (ws, message) => websocket?.message?.(ws, message),
      open: (ws) => websocket?.open?.(ws),
    },
  });
  adapted ??= adapt(server);
  return adapted;
}
