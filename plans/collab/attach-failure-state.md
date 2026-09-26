---
status: stub
disposition: implement
claims:
  - collab.md#4
size: M
workspaces:
  - packages/collab
  - packages/studio
---

# An attach that could not open shows as Not connected with its reason, and §4 writes down the state machine it runs

## Context

`specs/collab.md` §4, line 77:

> **Status: Partial.** The four states, the freeze and read-only indicators, clearing the awareness `selection` on unbind, the undo-scope sentence and the `project.json` exclusion ship (`packages/studio/src/collab/collab-state.ts`, `collab-session.ts`, `presence-chips.ts`, `monaco-binding.ts`). An attach that could not open never reaches `failed`: `openDoc` (`packages/collab/src/ws-client.ts`) resolves `null` when the open times out (a relay that is down, a handshake `selectSubprotocol` refused) or the server refuses before `opened`; both adapters (`packages/studio/src/platforms/devserver.ts`, `cloud.ts`) return `null` after logging `negotiateCollab`'s `refused` reason with `console.warn`; and the dev server adapter caches an unanswered probe as `null` for the life of the page. `attachSession` shows every null handle as Solo (`detached`), the collapse the table exists to prevent. The state machine this section promises is not written.

`failed` exists for the relay that is down (`attachSession`'s own comment says so), and today that is the case that lands in Solo. Only a thrown error reaches `failed`, and after the socket is up nothing throws.

**What exists**

- `attachSession` in `packages/studio/src/collab/collab-session.ts`: no `collab` member or no path is `unavailable`; a null handle is `detached` ("this document is simply not shared"); a throw, including `SYNC_TIMEOUT_MS` expiring on `whenSynced`, is `failed` with `attachError` and one keyed `notify.warn`.
- `openDoc` in `packages/collab/src/ws-client.ts` resolves `null` on the `openTimeoutMs` timer (default 10 s), which is also what a gateway that is down or a 400 from `selectSubprotocol` produces, and on an `error` control message before `opened` (codes `binary-file`, `too-large`, `content-not-loaded` after hydration fails). Some of those mean "not shared" and some mean "could not open"; the `null` does not say which.
- The adapters: `collab()` in `packages/studio/src/platforms/devserver.ts` caches `_collabProbe`, maps a non-OK or failed probe to `null` and returns `null` for good (`devserver-platform.test.ts`: "a server without the endpoint degrades to solo, probing once"); `collab()` in `cloud.ts` maps a failed probe to an empty offer and connects anyway, as §2.1 requires. Both log `negotiateCollab`'s `refused` sentence and return `null`.
- The lifecycle that §4's "a full state machine will be documented here as it settles" would describe: `ensureCollab` and `attachSession`; `CollabTabStatus` in `collab-state.ts`, whose `connecting`, `synced` and `offline` refine §4's `attached`; re-attach only from `handle.onReset` (a `doc-reset`); re-open on reconnect in `ws-client.ts`'s `onopen`, which re-sends `open` for every doc; the seeding handshake (the server seeds `source`, clients derive `structure`, `seedStructure` in `packages/collab/src/schema.ts`).
- The PAL member is `collab?: (docPath) => Promise<CollabHandle | null>` in `packages/studio/src/types.ts`.

**What is missing**

- `openDoc` and the adapters distinguishing "not shared" from "could not open", with a reason: throwing from `collab()` reuses `attachSession`'s existing `failed` path; a richer return type changes the PAL contract in desktop.md §3.
- A decision for each null source: the dev server's unanswered probe (`unavailable` for a server without the endpoint, `failed` for a network error, and whether a failed probe may be retried instead of cached for the page), `{collab: false}` (§4's first paragraph says a disabled backend runs single-player, which fits `unavailable` better than `detached`), and the per-document refusal codes.
- Tests in `packages/studio/tests/collab-session.test.ts` (or `collab-session-gaps.test.ts`) and `packages/collab/tests/ws-wire.test.ts` for the open-timeout path, a pre-`opened` refusal and both adapters' negotiation refusals, asserting `status`, `attachError` and one notification.
- The state machine written into §4 once the states above are settled, covering enablement, attach, re-open on reconnect, reset and the seeding handshake.

**Related**

- collab.md §2.1 (the refusal row: "here the reason can be reported"; an unanswered probe is not a refusal on the gateway), collab.md §5 ("the author is told why" is closed by this change, not by a second channel).
- desktop.md §3 (the `collab?` PAL member), desktop.md §10.3.
- `plan:collab/epoch-continuity` changes what re-open on reconnect does; whichever lands second writes the state machine to match.
