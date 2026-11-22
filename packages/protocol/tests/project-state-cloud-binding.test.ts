/**
 * The conformance suite (`specs/project-state.md` §10.4) through the cloud binding (§3.2, §10.3):
 * every subscription is the subscribe exchange on an `/events` socket, every write, delete and
 * rename one of the binding's HTTP routes, answered by `answerCloudProjectRequest` and read by
 * `createCloudProjectStateClient`. The host behind the session is the in-memory reference host,
 * shaped as the cloud's is: no watcher and no links, a log that survives a restart, and a partial
 * graph whose renames take the client's rewrites. So the binding is proven in this repository, on
 * both of its halves, before the platform's host runs it.
 */

import { describe, expect, test } from "bun:test";
import { createCloudProjectStateClient } from "../src/project-state-cloud";
import type { CloudProjectStateService } from "../src/project-state-cloud";
import { observeSubscription, runProjectStateConformance } from "../src/project-state-conformance";
import type { ProjectStateDriver, ProjectStateHost } from "../src/project-state-conformance";
import { createCloudSession } from "./cloud-session";
import { createReferenceHost } from "./reference-host";
import type { ReferenceHost, ReferenceHostOptions } from "./reference-host";

type BindingOptions = Omit<ReferenceHostOptions, "hold" | "logCapacity">;

/** A driver that reaches the reference host only through the cloud binding. */
function cloudBindingDriver(name: string, options: BindingOptions): ProjectStateDriver {
  const hosts = new WeakMap<ProjectStateHost, ReferenceHost>();
  const flushes = new WeakMap<ProjectStateHost, () => Promise<void>>();
  const clients = new WeakMap<ProjectStateHost, ReturnType<typeof createCloudProjectStateClient>>();
  const driver: ProjectStateDriver = {
    async create(files, hostOptions) {
      const host = await createReferenceHost(files, { ...options, ...hostOptions });
      const service: CloudProjectStateService = {
        delete: (request) => host.delete(request),
        rename: (operation) => host.rename(operation),
        write: (request) => host.write(request),
      };
      const session = createCloudSession({
        ...service,
        subscribe: (request) => host.subscribe(request),
      });
      const client = createCloudProjectStateClient(session.transport);
      const wired: ProjectStateHost = {
        ...host,
        async delete(request) {
          const result = await client.delete(request);
          await session.flush();
          return result;
        },
        async settle() {
          await host.settle();
          await session.flush();
        },
        async subscribe(request) {
          // One client per subscription: a client holds one, and the suite holds several.
          const sub = await observeSubscription(
            createCloudProjectStateClient(session.transport),
            request,
          );
          await session.flush();
          return sub;
        },
        async write(request) {
          const result = await client.write(request);
          await session.flush();
          return result;
        },
      };
      hosts.set(wired, host);
      flushes.set(wired, () => session.flush());
      clients.set(wired, client);
      return wired;
    },
    name,
    persistentLog: options.persistentLog === true,
  };
  if (options.graph === true) {
    driver.graph = { complete: options.partialGraph !== true };
  }
  if (options.rename === true) {
    driver.rename = {
      failStep: (host, step) => hosts.get(host)?.failStep(step),
      async rename(host, operation) {
        const result = await clients.get(host)!.rename(operation);
        await flushes.get(host)!();
        return result;
      },
    };
  }
  return driver;
}

runProjectStateConformance(
  cloudBindingDriver("cloud binding over the reference host", {
    graph: true,
    pairMoves: false,
    partialGraph: true,
    persistentLog: true,
    rename: true,
    symlinks: false,
  }),
  { describe, expect, test },
);

runProjectStateConformance(
  cloudBindingDriver("cloud binding over a host with no graph and an in-memory log", {
    symlinks: false,
  }),
  { describe, expect, test },
);
