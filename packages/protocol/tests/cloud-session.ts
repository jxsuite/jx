/**
 * An in-memory cloud session over a host (`specs/project-state.md` §3.2, §10.3): the `/events`
 * socket and the binding's HTTP routes, as `createCloudProjectStateClient` reaches them through a
 * {@link CloudProjectStateTransport}. Every message crosses as text and is delivered on a later
 * microtask, as a socket's would be, and the routes are answered by `answerCloudProjectRequest`
 * over real `Request` and `Response` objects.
 *
 * The host's subscriptions record their events in arrays (`ProjectStateSubscription`), so the
 * session forwards what each one has recorded whenever it is pumped: after a subscribe is answered,
 * after every request, and on {@link CloudSession.flush}. A subscription the host ended is forwarded
 * as `project-ended`. The socket's other traffic (`fs` batches) is interleaved, so a client that
 * read it as part of the exchange fails.
 */

import {
  answerCloudProjectRequest,
  CLOUD_PROJECT_FILE_PATH,
  CLOUD_PROJECT_STATE_PATH,
} from "../src/project-state-cloud";
import type {
  CloudProjectStateService,
  CloudProjectStateTransport,
  CloudSocketHandlers,
} from "../src/project-state-cloud";
import type { ProjectStateSubscription } from "../src/project-state-conformance";
import {
  decodeCloudClientMessage,
  encodeCloudEnded,
  encodeCloudEvents,
  encodeCloudSubscribeAnswer,
} from "../src/project-state-frames";
import type { SubscribeRequest } from "../src/project-state";

/** What the session serves: a host's subscribe beside the HTTP service. */
export interface SessionHost extends CloudProjectStateService {
  subscribe: (request: SubscribeRequest) => Promise<ProjectStateSubscription>;
}

/** One socket as the session holds it. */
interface HostSocket {
  handlers: CloudSocketHandlers;
  sub: ProjectStateSubscription | null;
  forwarded: number;
  endedSent: boolean;
  closed: boolean;
}

/** A running in-memory session. */
export interface CloudSession {
  transport: CloudProjectStateTransport;
  /** Forward what every subscription has recorded, then let the messages arrive. */
  flush: () => Promise<void>;
  /** Sockets the session holds open. */
  openSockets: () => number;
  /** Every route requested, in order, as `<method> <route>`. */
  readonly requests: string[];
}

/** Let every queued microtask and one macrotask run, so delivered messages reach the client. */
export async function tick(): Promise<void> {
  await new Promise((resume) => {
    setTimeout(resume, 0);
  });
}

/** Options for the session. */
export interface CloudSessionOptions {
  /** Answer the capability route with `404`, as a session that predates the binding does. */
  legacy?: boolean;
}

/** A session over `host`. */
export function createCloudSession(host: SessionHost, options: CloudSessionOptions = {}) {
  const sockets = new Set<HostSocket>();
  const requests: string[] = [];

  const deliver = (socket: HostSocket, text: string) => {
    queueMicrotask(() => {
      if (!socket.closed) {
        socket.handlers.message(text);
      }
    });
  };

  const pump = () => {
    for (const socket of sockets) {
      const { sub } = socket;
      if (sub === null) {
        continue;
      }
      const fresh = sub.events.slice(socket.forwarded);
      if (fresh.length > 0) {
        socket.forwarded = sub.events.length;
        deliver(socket, encodeCloudEvents(sub.response.epoch, fresh));
      }
      if (sub.ended && !socket.endedSent) {
        socket.endedSent = true;
        deliver(socket, encodeCloudEnded(sub.response.epoch));
      }
    }
  };

  const transport: CloudProjectStateTransport = {
    connect(handlers) {
      const socket: HostSocket = {
        closed: false,
        endedSent: false,
        forwarded: 0,
        handlers,
        sub: null,
      };
      sockets.add(socket);
      queueMicrotask(() => {
        if (!socket.closed) {
          handlers.open();
          // The socket's own traffic, which is not part of the exchange.
          deliver(socket, JSON.stringify({ events: [], kind: "fs" }));
        }
      });
      return {
        close() {
          if (socket.closed) {
            return;
          }
          socket.closed = true;
          sockets.delete(socket);
          socket.sub?.close();
          queueMicrotask(() => {
            handlers.close();
          });
        },
        send(text) {
          const request = decodeCloudClientMessage(text);
          if (request === null) {
            return;
          }
          void host.subscribe(request).then((sub) => {
            if (socket.closed) {
              sub.close();
              return;
            }
            socket.sub = sub;
            deliver(socket, encodeCloudSubscribeAnswer(sub.response));
            pump();
          });
        },
      };
    },
    async fetch(route, init) {
      requests.push(`${init.method ?? "GET"} ${route}`);
      const request = new Request(`https://session.test${route}`, init);
      const { pathname } = new URL(request.url);
      if (options.legacy === true && pathname === CLOUD_PROJECT_STATE_PATH) {
        return new Response("Not found", { status: 404 });
      }
      const answer = await answerCloudProjectRequest(request, pathname, host);
      if (pathname === CLOUD_PROJECT_FILE_PATH || pathname.startsWith("/project-state/")) {
        pump();
      }
      return answer ?? new Response("Not found", { status: 404 });
    },
  };

  return {
    async flush() {
      pump();
      await tick();
      await tick();
    },
    openSockets: () => sockets.size,
    requests,
    transport,
  } satisfies CloudSession;
}
