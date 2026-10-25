---
status: stub
disposition: implement
claims:
  - studio.md#22.8
size: M
---

# Publish sends a change for review on every host, not only one that implements createPullRequest

## Context

studio.md §22.8's second marker (split out of the workspace redesign, whose other Publish items shipped):

> **Status: Pending.** Not part of the first build: **Send for review** on a host with no `createPullRequest` (today the dev server and the desktop app), where the choice is drawn disabled with the reason rather than falling back to a branch push that opens nothing.

The section's other two follow-ups, Rollback in Deploys and the Hosting source policy, were deferred to a `Future` marker when this plan was split out, so they are not open and this plan does not own them.

What ships: `StudioPlatform.createPullRequest` is optional (`packages/studio/src/types.ts`) and only `platforms/cloud.ts` implements it. `canOpenPullRequest` in `publish/source-control.ts` asks whether the host has it, and `publish/publish-changes.ts` draws Send for review disabled with the reason ("This host cannot open a pull request yet…") when it does not.

What is missing: a `createPullRequest` on the dev server and desktop platforms. Both need a GitHub token to call the pulls API with, and the desktop's token stays in the launcher (`plan:desktop/github-token-stays-in-launcher`), so the first decision for detailing is whether the request is made by the launcher or the server on the page's behalf, and whether this plan requires that one.
