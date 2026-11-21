---
status: drafted
disposition: implement
claims:
  - project-state.md#10.2
requires:
  - project-state/desktop-service
workspaces:
  - packages/server
  - packages/studio
size: M
---

# The dev server serves the project state over a replaying event stream

## Context

`specs/project-state.md` §10.2 is `Pending`: the dev server forwards watcher events as named `fs` frames on `/__reload` (`packages/server/src/watch.ts`, `packages/server/src/sse.ts`), and a reconnect is pushed one reload and no history, deliberately (`server.md` §3.1). The DevServer adapter reports `"open"` and `"reconnect"` resyncs (`packages/studio/src/platforms/devserver.ts`).

## Outcome

§10.2 → Implemented: `GET /__studio/project/events` serves the host of `plan:project-state/desktop-service` under Bun with the SSE binding, writes take `If-Match`, and the conformance suite passes against it.

## Decisions

- **Decided:** a separate stream, not new frames on `/__reload`, because the reload stream's non-replay is correct for what it carries and is shared with the live preview origin (`server.md` §3.4).
- **Decided:** activating another project closes every subscription and starts a new epoch.

## Implementation

Route in `packages/server/src/studio-api.ts` and `STUDIO_ROUTES` (`packages/protocol/src/routes.ts`), the SSE framing from the protocol codecs, and `If-Match` on `fileWrite`. The DevServer adapter subscribes when the route answers.

**Integration contract.** The route exists with the `degradation` field naming the resync fallback, so an adapter against an older server keeps §9.2's behaviour.

## Tests

The conformance suite through a Bun driver, `packages/server/tests/project-events.test.ts` for reconnect with `Last-Event-ID`, and the adapter's subscription in `packages/studio/tests/`. Coverage in both workspaces.

## Specs & docs

§10.2 → Implemented; `server.md` §3.1 and §4.1 name the route. Fragments for `project-state.md` and `server.md` (minor). The generated protocol routes page picks the route up from `STUDIO_ROUTES`.

## Acceptance

`bun test --isolate packages/server/tests/project-events.test.ts`, `bun run plans:check`, `bun run docs:check`.
