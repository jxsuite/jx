/**
 * A stand-in for `createProjectStateHost` (`specs/project-state.md` §10): every subscription it
 * answered, the writes and deletes it was asked for, and calls that make it emit events or end
 * every subscription, so the services that run a host can be driven one turn at a time.
 */

import type {
  DeleteRequest,
  DeleteResult,
  ProjectEvent,
  SubscribeRequest,
  SubscribeResponse,
  WriteRequest,
  WriteResult,
} from "@jxsuite/protocol/project-state";
import type { ProjectStateHost, ProjectStateSink } from "../src/project-state/host.ts";

export interface FakeHost extends ProjectStateHost {
  sinks: { request: SubscribeRequest; sink: ProjectStateSink; open: boolean }[];
  emit: (events: ProjectEvent[]) => void;
  end: () => void;
  closed: boolean;
  writes: WriteRequest[];
  deletes: DeleteRequest[];
  writeAnswer: WriteResult;
  deleteAnswer: DeleteResult;
  graph: boolean;
  settles: boolean;
  /** The document id at each path, which `docIdAt` answers. */
  docs: Map<string, string>;
}

export function fakeHost(root: string): FakeHost {
  let rev = 0;
  const host: FakeHost = {
    close: () => {
      host.closed = true;
      host.end();
      return Promise.resolve();
    },
    closed: false,
    createDirectory: () => Promise.resolve({ rev }),
    delete: (request) => {
      host.deletes.push(request);
      return Promise.resolve(host.deleteAnswer);
    },
    deleteAnswer: { ok: true, rev: 4 },
    deletes: [],
    docIdAt: (path) => host.docs.get(path) ?? null,
    docs: new Map(),
    emit: (events) => {
      rev = events.at(-1)?.rev ?? rev;
      for (const entry of host.sinks) {
        if (entry.open) {
          entry.sink.events(events);
        }
      }
    },
    end: () => {
      const ending = host.sinks.filter((entry) => entry.open);
      for (const entry of ending) {
        entry.open = false;
      }
      for (const entry of ending) {
        entry.sink.end?.();
      }
    },
    epoch: "e1",
    graph: true,
    idle: () => (host.settles ? Promise.resolve() : new Promise<void>(() => {})),
    install: () => Promise.resolve(),
    readiness: "ready",
    references: () => (host.graph ? { documents: [], extensions: [], mounts: [] } : null),
    release: () => Promise.resolve(),
    rename: () => Promise.reject(new Error("no")),
    restart: () => Promise.resolve(),
    get rev() {
      return rev;
    },
    root,
    settles: true,
    sinks: [],
    snapshot: () => ({ components: [], files: [], formats: "", readiness: "ready" }),
    subscribe: (request, sink) => {
      const entry = { open: !host.closed, request, sink };
      host.sinks.push(entry);
      const response: SubscribeResponse = {
        epoch: "e1",
        kind: "snapshot",
        rev,
        snapshot: host.snapshot(),
      };
      return {
        close: () => {
          entry.open = false;
        },
        response,
      };
    },
    write: (request) => {
      host.writes.push(request);
      return Promise.resolve(host.writeAnswer);
    },
    writeAnswer: { hash: "sha256-new", ok: true, rev: 3 },
    writes: [],
  };
  return host;
}
