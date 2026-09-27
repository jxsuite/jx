---
status: drafted
disposition: implement
claims:
  - ai.md#2
requires: []
workspaces:
  - packages/studio
  - packages/protocol
size: S
---

# Studio shows every failed model listing, with the upstream's reason or its status, and words a refused key as one

## Context

`specs/ai.md` §2, line 20:

> **Status: Partial.** The wire, the `usage` frame, the calls deciding rather than the finish, and Stop armed before the first wait ship. A model-listing failure is not always distinguished: Studio keeps `upstreamMessage` as the only witness of `upstreamError` (`proxyModelsError` in `packages/studio/src/services/ai-models.ts`), so a listing answered with `upstreamError` set and no message, or an empty one, fills the picker with the default catalogue and says nothing (`packages/studio/src/ui/ai-credentials-form.ts`). `upstreamMessage` is optional in `AiModelsResponse` (`packages/protocol/src/types.ts`), and the dev server's own fallback for a bodiless failure is the upstream's status text, which can be empty.

The clause it falls short of (line 28): the listing failure "**MUST** be distinguished from an authentication failure rather than surfaced as a silent success", with `upstreamMessage` there "so a client can show it instead of a bare status code". The bare status is the floor, not the thing to avoid.

**What exists** (verified against the tree on 2026-09-27)

- `fetchAvailableModels` in `packages/studio/src/services/ai-models.ts` throws `HTTP <status>` for a non-2xx and, on a 2xx, sets `proxyModelsError = data.upstreamError !== undefined ? (data.upstreamMessage ?? "") : ""` (line 371). `proxyModelsErrorMessage()` (line 277) returns it. The variable is module-wide and unkeyed, unlike `cache`, which `cachedModels(credentials)` reads only under the fingerprint it was listed with.
- `fetchModels()` in `packages/studio/src/ui/ai-credentials-form.ts` (line 156; the check is at line 175) sets `modelsError = "<message> — type the model ID directly instead."` only `if (upstreamMessage)`. An empty string reads as success, and the fallback catalogue fills the combobox.
- The dev server (`handleModels` in `packages/server/src/ai-api.ts`) sends `upstreamError: <status>` with `upstreamMessage: extractUpstreamErrorMessage(body, statusText)` (`packages/ai/src/gateway/upstream-error.ts`), which is `""` for an empty body and an empty status text; the network branch sends `upstreamError: "network"` with the thrown error's message. Any other backend builds its own body through `modelsResponse` (`packages/ai/src/gateway/models.ts`) and may omit the message.
- Tests: `packages/studio/tests/ai-models.test.ts` (lines 206 and 221) and `packages/studio/tests/ai-credentials-form.test.ts` (line 296) always supply a message. `chat-panel.test.ts` (line 67) and `preferences-dialog.test.ts` (line 42) double the module and stub `proxyModelsErrorMessage`.

**Found while detailing**

- **The composer's and the Import tab's picker never read the failure at all.** `view()` in `packages/studio/src/ui/ai-model-picker.ts` (line 190) sets its hint and Retry from a thrown fetch only, so even a listing that carried a message offers the proxy's fallback (`gpt-4o`) under the tooltip "Model".
- **A refused key gets the missing-route advice.** An upstream `401` arrives as `upstreamError: 401` with "Incorrect API key provided", and the form appends "type the model ID directly instead": the authentication failure §2 says to distinguish is worded as a listing gap.
- `AiModelsResponse.upstreamError`'s comment says "Set when the upstream provider was unreachable and defaults were returned"; the dev server also sets it to the upstream's HTTP status.
- `docs/studio/ai.md`'s Cloudflare note says "Fetch models will not list anything"; the form in fact lists the proxy's fallback `gpt-4o` and, with Cloudflare's body, shows "No route for that URI".

## Outcome

ai.md §2 → Implemented. Whenever a listing answers with `upstreamError`, every Studio surface that offers the catalogue says the listing failed, using the upstream's reason when there is one and the status when there is not. A `401` or `403` is worded as a refused key.

## Decisions

- **Decided:** Studio derives the witness from `upstreamError`, and the server is not changed, because the rule has to hold for any backend (the message is optional and the platform writes its own body) and `upstreamMessage` should stay the upstream's own words rather than a status the proxy made up.
- **Decided:** the witness is `upstreamMessage` trimmed when non-empty; otherwise `HTTP <n>` for a numeric status (the words the thrown path already uses), `Provider unreachable` for `"network"`, the code itself for any other non-empty string, and `Model listing failed` for an empty one. An absent or `null` `upstreamError` is no failure, because the type admits `number | string` and JSON can carry `null`.
- **Decided:** the failure is stored with the catalogue and read by credentials (`proxyListingFailure(credentials)`), replacing the unkeyed `proxyModelsErrorMessage()`, because the form lists under drafts and the probe under stored credentials into the same slot: the reason `cachedModels` is keyed.
- **Decided:** in the form, a status of `401` or `403` gets "check the key and endpoint" in place of "type the model ID directly instead", because that is the authentication failure §2 distinguishes the listing failure from, and typing a model id cannot fix a refused key.
- **Decided:** the fallback catalogue is still offered beside the failure, because server.md §4.3 names the catalogue "degraded success: the catalogue is still delivered, from defaults". The docs are corrected instead.
- **Decided:** correct the two `AiModelsResponse` doc comments in `packages/protocol/src/types.ts` (comment only), because that type is what a second backend implements against, and today it misstates when `upstreamError` is set.
- **Open:** does the composer's and Import tab's model picker show the failure too, or does §2 bind only the credentials form? Recommendation: show it in the picker's hint (`Couldn't load models: <reason>`) with no Retry button. The composer is where authors switch models per conversation, so a silent `gpt-4o` there is the silent success §2 forbids. The hint is where the picker already reports a thrown listing, the compact row has no room for a line of text, and Retry cannot fix a route the provider does not serve. If declined, drop step 3 and its picker tests, drop `ai-model-picker.ts` from the new marker, the `chat.md` sentence and the by-hand hover check, and §2's new sentence says "the credentials form" rather than "every surface that offers the catalogue".

## Implementation

1. `packages/studio/src/services/ai-models.ts`
   - Export `interface ListingFailure { reason: string; status: number | string }`.
   - Replace `let proxyModelsError = ""` with `let cacheFailure: ListingFailure | null = null`. `fetchAvailableModels` writes it beside `cache` and `cacheKey`, and `resetModelCache` clears it. A thrown fetch leaves all three as they were, as it does today.
   - Add a private `listingFailure(data: Partial<AiModelsResponse>): ListingFailure | null` implementing the witness rule. It guards `typeof data.upstreamMessage === "string"` because the body is unchecked JSON.
   - Replace `proxyModelsErrorMessage()` with `proxyListingFailure(credentials: AiCredentials = aiConnection()): ListingFailure | null`, which returns `cacheKey === fingerprint(credentials) ? cacheFailure : null`. Rewrite its docblock to say that `reason` is never empty and that `null` means the listing under those credentials succeeded or never ran.
2. `packages/studio/src/ui/ai-credentials-form.ts`, `fetchModels()`
   - Build `const credentials: AiCredentials = { apiKey: keyDraft || getOpenAiKey(), baseUrl: baseUrlDraft || getBaseUrl() }` once, and pass it to both `fetchAvailableModels` and `proxyListingFailure`.
   - When a failure comes back, set `modelsError` to `` `${reason} — check the key and endpoint.` `` for `status` `401` or `403`, and to `` `${reason} — type the model ID directly instead.` `` for anything else. Use a local `isKeyRefusal(status)` for the test.
   - Update the comment above the check: the failure is `upstreamError`, and the message is only its wording. A spec citation in a Studio comment is qualified (`ai.md` §2): a bare `§` in `packages/studio` means `studio.md`, and `docs:section-refs` checks it.
3. `packages/studio/src/ui/ai-model-picker.ts`, `view()` (subject to the Open decision)
   - Import `proxyListingFailure`, and compute `const listed = failure ? "" : (proxyListingFailure(aiConnection())?.reason ?? "")`.
   - Set `hint` to ``failure || listed ? `Couldn't load models: ${failure || listed}` : "Model"``.
   - Leave `failure` as the thrown error only, so no Retry is drawn for a listing failure. `error()`'s docblock should say it reports a failed request, not a failed listing.
4. `packages/protocol/src/types.ts`, `AiModelsResponse`
   - `upstreamError`: "Set when the upstream listing failed: its HTTP status, or `"network"` when it could not be reached. Defaults were returned. This, not `upstreamMessage`, is what marks the failure."
   - `upstreamMessage`: add "May be absent or empty; a client then shows the status."
5. Test doubles: in `packages/studio/tests/chat-panel.test.ts` (line 67) and `packages/studio/tests/preferences-dialog.test.ts` (line 42), replace `proxyModelsErrorMessage: () => ""` with `proxyListingFailure: () => null`. Their own comment explains why: a partial `mock.module()` is a link-time SyntaxError for a named import it lacks.

**Integration contract.** `packages/studio/src/services/ai-models.ts` exports `ListingFailure` and `proxyListingFailure(credentials?)`. It is non-null exactly when the last successful listing under those credentials carried `upstreamError`, and its `reason` is never empty. `proxyModelsErrorMessage` no longer exists. ai.md §2 states the client rule, so a later change to the probe (for example a slice of `plan:ai/harness-phase-1` that reads more fields from `/models`) must keep the failure recorded with the catalogue. No plan requires this one.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`. Protocol changes only a comment, so its suite runs unchanged in the affected matrix.

- `packages/studio/tests/ai-models.test.ts`, `describe("proxy state flags")` (where the two existing upstream tests are):
  - Rewrite those two against `proxyListingFailure()`: `{ reason: "No route for that URI", status: 404 }`, then `null` after a clean fetch.
  - New `test.each` "witnesses a listing answered with %s", one row per rule: no message (`HTTP 404`), `""` (`HTTP 404`), `"  "` (`HTTP 502`), a padded message (trimmed), `"network"` with no message (`Provider unreachable`), `"timeout"` (`timeout`), `""` as the code (`Model listing failed`), and `null` (no failure).
  - New "a listing failure is reported only for the credentials it was listed under": fail under `{ apiKey: "sk-a" }`. `proxyListingFailure` is `null` for `sk-b` and `{ reason: "HTTP 404", status: 404 }` for `sk-a`, and it is `null` again after `resetModelCache()`.
- `packages/studio/tests/ai-credentials-form.test.ts`, `describe("ai-credentials-form")`:
  - New `test.each` "fetchModels says the listing failed when the upstream gave %s": no reason, and an empty one. `[part="models-error"]` contains `HTTP 404` and `type the model ID directly`.
  - New "a refused key is worded as a key problem, not a missing listing": `upstreamError: 401` with "Incorrect API key provided". The error line contains the message and `check the key`, and does not contain `type the model ID directly`.
  - New "the failure shown is the one listed under the drafts": the stored key is `sk-old` and the drafted key is `sk-new`. `fetchImpl` answers `upstreamError: 404` only when the `X-Api-Key` header is `sk-new`, and the error line shows `HTTP 404`.
- `packages/studio/tests/ai-model-picker.test.ts`:
  - New "a listing the upstream could not serve is named in the hint, without Retry" under `describe("ai-model-picker — failure")`: a 200 with `upstreamError: 404`. The select host's `title` is `Couldn't load models: HTTP 404`, there is no `[part="retry"]`, `picker.error()` is `""`, and `gpt-4o` is still a row.
  - Extend "a credential change makes the catalogue unavailable rather than stale": the first listing carries `upstreamError`. After `saveAiProvider` and a clean listing, the `title` is `Model`.

Coverage: the per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) hold. The table covers every branch of `listingFailure`, and no touched file is the workspace floor, so there is no ratchet. There is no new source file, so the manifest check needs nothing.

## Specs & docs

- **ai.md §2 marker** (line 20) is replaced by:

  > **Status: Implemented.** The wire, the `usage` frame, the calls deciding rather than the finish, Stop armed before the first wait, and a failed model listing shown whatever the backend said about it (`proxyListingFailure` in `packages/studio/src/services/ai-models.ts`, read by `packages/studio/src/ui/ai-credentials-form.ts` and `packages/studio/src/ui/ai-model-picker.ts`).

- **ai.md §2, the listing bullet** (line 28) keeps its text. Its closing clause, "and chat itself is unaffected: …", becomes a sentence of its own ("Chat itself is unaffected: …"), and these two sentences go in front of it:

  > `upstreamError` is the witness, not `upstreamMessage`: the message is optional and a backend's fallback for a bodiless failure can be empty, so a client **MUST** treat any `upstreamError` as a failed listing on every surface that offers the catalogue, and show the status itself (`HTTP 404`, or an unreachable provider for `network`) when the message is absent or blank. A `401` or `403` is the authentication failure this is distinguished from, and is worded as a refused key rather than as advice to type a model id; the default catalogue is still offered beside either (`@jxsuite/server` §4.3).

- **Fragment:** `bun run spec:change ai.md minor -m "§2 a failed model listing is always shown, with the upstream's reason when it gives one and its status when it does not, and a refused key is worded as an authentication failure."`
- **`docs/studio/ai.md`** (its `code:` lists `ai-models.ts` and `ai-credentials-form.ts`, and the picker carries `@docs studio/ai`):
  - Step 3 of "Bring your own key" gains: "If the provider cannot list its models, the form says why under the field: the provider's own reason, or the status it answered with (for example HTTP 404) when it gives none. If the provider refused the key, the form says to check the key and endpoint."
  - The Cloudflare note's "**Fetch models will not list anything**: …" becomes "**Fetch models cannot list your models**: Cloudflare's OpenAI-compatible surface has no models-listing route, only chat completions and embeddings, so the form shows Cloudflare's reason and the list holds only a default ID that Workers AI does not serve."
  - The page's last two lines are `code:` entries stranded below the Next list (`packages/studio/src/surfaces/ai-credentials-form.ts`, `packages/studio/src/surfaces/ai-model-picker.ts`), rendered today as a stray nested bullet: move them into the frontmatter `code:` list. `plan:ai/link-local-guard` also adds a `code:` line here, so the two conflict textually at most.
  - Keep all of it free of em dashes.
- **`docs/studio/ai/chat.md`**, the **model picker** bullet (line 36), which is where the composer's picker is documented: add "If the provider could not list its models, hovering the picker says why, and the list still offers a default model."
- **`docs/extending/embedding/backend-protocol.md`** (its `code:` lists `packages/protocol/src/types.ts`): the `ai/models` sentence on line 95 that ends "…unable to tell a missing route from a bad key." is followed by "Set `upstreamError` to the upstream's HTTP status, or `"network"` when it could not be reached. Studio shows `upstreamMessage` when it is non-empty and that status when it is not, and words a `401` or `403` as a refused key."
- No page's `spec:` cites `ai.md#2`.
- The spec does not graduate: `plan:ai/harness-phase-1` owns its whole-spec marker and §2.2. The landing pull request deletes this file.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` is green with the new cases, and no file is below its threshold. `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run typecheck`, `bun run lint` and `bun run docs:section-refs` are clean. `grep -rn proxyModelsErrorMessage packages --include=*.ts` finds nothing (`packages/studio/CHANGELOG.md` keeps its release-please entry).
- `bun run plans:status --spec ai` no longer lists §2. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` pass. `bun run docs:sync` names `docs/studio/ai.md` and `backend-protocol.md`, and both are in the diff, with `docs/studio/ai/chat.md`.
- By hand: run Studio against the dev server, open Preferences › Assistant, and use a Cloudflare API token with the endpoint `https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1`. Fetch models shows "No route for that URI — type the model ID directly instead". Save, and hovering the composer's picker shows "Couldn't load models: No route for that URI" (the picker lists under the stored credentials, not the drafts). A refused key: the endpoint `https://api.openai.com/v1` with the key `sk-invalid` shows "Incorrect API key provided … — check the key and endpoint". The bodiless case is proved by the unit tests, because a live upstream always sends a body.
