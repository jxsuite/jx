---
status: stub
disposition: implement
claims:
  - collab.md#5
size: M
workspaces:
  - packages/collab
  - packages/server
  - packages/studio
---

# Peers that store the shared document differently never share a room, and document-format skew has a stated answer

## Context

`specs/collab.md` §5, line 105:

> **Status: Partial.** Frame-layout skew is handled: `negotiateCollab` and `selectSubprotocol` (`packages/collab/src/negotiate.ts`) keep a peer that speaks another `jx.collab` token out of the room. Merge-granularity skew is not: the §3.1 layout is versioned by `COLLAB_SCHEMA_VERSION` (`packages/collab/src/schema.ts`), which is written to the room's `meta` at seed and never validated or negotiated, so two clients that store §3.1 differently still share a room. Document-format skew is handled nowhere, spec.md §3.2 included, and telling the author why holds only as far as §4's marker records.

The marker this census replaced read "Wire-envelope skew is handled; document-format skew is still out of scope." That overstated what ships. The section's prose says the subprotocol negotiation keeps granularity-skewed peers apart, and §2.1's bump rule makes that untrue by construction: the token moves only when a frame would be mis-parsed, and a granularity change mis-parses no frame. The prose also names spec.md §3.2 as the home of document-format skew, and §3.2 does not track it. Disposition `implement`, because the spec's intent (never merge across a layout disagreement) is the right one and the code does not enforce it.

**What exists**

- `COLLAB_SUBPROTOCOL` (`jx.collab.v1`) and its narrow bump rule in `packages/collab/src/negotiate.ts`, negotiated by the probe and echoed by `selectSubprotocol` in `packages/server/src/collab.ts`.
- `COLLAB_SCHEMA_VERSION = 2` in `packages/collab/src/schema.ts`, set by `seedStructure` into `meta.schemaVersion`; its own comment says it is "not currently validated on load" and "does not attempt to solve" §5.
- The room host in `packages/collab/src/ws-room.ts` is shared by the dev server and the platform's Durable Object, so a room-level check there covers both backends.
- The `hello` control message in `packages/collab/src/envelope.ts`, which §2.1 rules out for anything that must conclude before document state moves.

**What is missing**

- A guard that keeps a client whose `COLLAB_SCHEMA_VERSION` differs from the room's out of it, before it merges: either the layout version joins the negotiation (probe `protocols` or a second advertised field), or the client checks `meta.schemaVersion` after sync step 1 and before applying local state. The choice decides whether §2.1's bump rule gains a second trigger.
- What a newer client does with an older room: refuse, or migrate in place (the op bridge already self-heals per key).
- A stated answer for document-format skew. The prose points at spec.md §3.2, which does not track it; the detail phase either designs it or takes it to a `Future` remainder with a real home.
- The refusal reaching the author. §5's "the author is told why" rests on §4's `failed` state, which `plan:collab/attach-failure-state` builds, so this plan closes §5 only after that one has landed and the detail phase adds that `requires` edge.

**Related**

- collab.md §2.1 (the token's bump rule), collab.md §3.1 (the layout being versioned), collab.md §4 (the `failed` state).
- spec.md §3.2 (`$schema`, named by §5 as the home of document-format skew).
