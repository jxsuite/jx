---
status: stub
disposition: implement
claims:
  - ai.md#2
workspaces:
  - packages/studio
size: S
---

# A failed model listing is shown even when the backend gives no reason

## Context

`specs/ai.md` §2, line 20:

> **Status: Partial.** The wire, the `usage` frame, the calls deciding rather than the finish, and Stop armed before the first wait ship. A model-listing failure is not always distinguished: Studio keeps `upstreamMessage` as the only witness of `upstreamError` (`proxyModelsError` in `packages/studio/src/services/ai-models.ts`), so a listing answered with `upstreamError` set and no message, or an empty one, fills the picker with the default catalogue and says nothing (`packages/studio/src/ui/ai-credentials-form.ts`). `upstreamMessage` is optional in `AiModelsResponse` (`packages/protocol/src/types.ts`), and the dev server's own fallback for a bodiless failure is the upstream's status text, which can be empty.

The clause it falls short of: model listing "**MUST** be distinguished from an authentication failure rather than surfaced as a silent success", with `upstreamMessage` there "so a client can show it instead of a bare status code". The bare status code is the floor, not the thing to avoid.

**What exists**

- `fetchAvailableModels` in `packages/studio/src/services/ai-models.ts` sets `proxyModelsError = data.upstreamError !== undefined ? (data.upstreamMessage ?? "") : ""`, and `proxyModelsErrorMessage()` returns it. Nothing else in `packages/studio/src` reads `upstreamError`.
- `packages/studio/src/ui/ai-credentials-form.ts` shows `"<message> — type the model ID directly instead."` only `if (upstreamMessage)`, so an empty string reads as success.
- The dev server fills `upstreamMessage` from `extractUpstreamErrorMessage(errorBody, upstreamResp.statusText)` (`packages/server/src/ai-api.ts`, via `packages/ai/src/gateway/upstream-error.ts`), which returns the fallback when the body is empty; the network branch uses the thrown error's message.
- Tests: `packages/studio/tests/ai-models.test.ts` and `packages/studio/tests/ai-credentials-form.test.ts` always supply a message.

**What is missing**

- A non-empty witness whenever `upstreamError` is set: the upstream's message when there is one, and otherwise the status itself (for example `HTTP 404`, or the network case named as such), so the form says the listing failed.
- A test for a models response carrying `upstreamError` with no `upstreamMessage`, and one with an empty string, each asserting the form shows an error rather than a silent default catalogue.

**Related**

- `docs/studio/ai.md` (Fetch models, and the Cloudflare Workers AI note that it "will not list anything").
