---
status: drafted
disposition: implement
claims:
  - ai.md#4
requires: []
workspaces:
  - packages/server
size: M
---

# The AI proxy refuses every spelling of a link-local or metadata address and every base URL that is not HTTP, and the site import's naming pass uses the same policy

## Context

`specs/ai.md` §4, line 183:

> **Status: Partial.** The file/RPC surfaces, the Origin/Host gate and path containment hold (`packages/server/src/net-guard.ts`). The base-URL host block that §2 names and the two IANA rows in §5 describe is narrower than both: `isBlockedHost` in `packages/server/src/ai-api.ts` refuses a hostname whose text begins `fe80:`, so the rest of `fe80::/10` (`[fe90::1]`, `[febf::1]`) is forwarded, and it tests `169.254.` against the dotted IPv4 spelling alone, so the IPv4-mapped form of the metadata address (`[::ffff:169.254.169.254]`, which the URL parser serializes as `[::ffff:a9fe:a9fe]`) is forwarded too. `packages/server/tests/ai-api.test.ts` covers only `169.254.169.254` and `[fe80::1]`.

The promises the item makes true: ai.md §2 (line 23) says the proxy "blocks cloud-metadata/link-local hosts (see `@jxsuite/server` §4.2)", and ai.md §5's two IANA rows, which bind §4, say "Only `169.254.0.0/16` is refused" and "Only `fe80::/10` is refused, matching the IPv4 rule". §4's own body says the assistant "has no independent network or filesystem access beyond the connected provider endpoint".

**What exists** (verified 2026-09-27 on Bun 1.3.11; CI pins 1.4)

- `isBlockedHost(rawUrl)` in `packages/server/src/ai-api.ts`: `new URL(rawUrl).hostname`, lower-cased, brackets stripped, then `=== "metadata.google.internal"`, `startsWith("169.254.")`, `startsWith("fe80:")`; an unparseable URL is refused. `getConfig(req)` calls it on `X-Api-Base-URL || OPENAI_BASE_URL || DEFAULT_BASE_URL` and returns `reject: { status: 403, message: "Base URL host is not permitted." }`. Both routes go through `getConfig`: `ai/chat` via `resolveUpstream` (handed to `createChatHandler` from `@jxsuite/ai/gateway`), `ai/models` via `handleModels`. The gateway's own doc says a guard on a caller-supplied base URL belongs in the host's `resolveUpstream` (`packages/ai/src/gateway/types.ts`), and the merged `plan:ai/harness-phase-1#J1.17` kept it server-local, so the fix stays in this file.
- The WHATWG URL parser canonicalises the IPv4 spellings (`http://2852039166/`, `http://0xa9fea9fe/`, `http://0251.0376.0251.0376/` and `http://169.254.169.254./` all have hostname `169.254.169.254`), lower-cases IPv6, rewrites an IPv4 tail to hex (`[::169.254.169.254]` is `[::a9fe:a9fe]`, `[64:ff9b::169.254.169.254]` is `[64:ff9b::a9fe:a9fe]`), and throws on a zone id (`[fe80::1%25eth0]`, so that one is already refused).
- `node:net`'s `BlockList` works under Bun: with `addSubnet("169.254.0.0", 16, "ipv4")` and `addSubnet("fe80::", 10, "ipv6")`, `check` is true for `fe90::1`, `febf:ffff:…:ffff`, `::ffff:a9fe:a9fe` and `::ffff:169.254.169.254` (it folds IPv4-mapped addresses into IPv4 rules, as Node documents), and false for `fe7f:ffff::1`, `fec0::1`, `::1`, `::ffff:7f00:1` and `169.255.0.1`.
- Tests: `packages/server/tests/ai-api.test.ts`, `describe("AI proxy key-provenance + SSRF hardening")`: the metadata-IP case (line 983) and the `it.each` at line 1003 (unparseable, `metadata.google.internal`, `[fe80::1]`), all on `ai/chat`. `withUpstream` swaps `globalThis.fetch`; `ai-upstream-fixtures.test.ts` does the same.

**Found while detailing** (none is in the marker; each bears on "blocks cloud-metadata/link-local hosts" or on §4's "no filesystem access")

- **A `file:` base URL reads the disk.** Bun's `fetch` serves `file:` URLs, and a trailing `?` swallows the suffix the proxy appends: `fetch("file:///…/x.json?/models")` answers `200` with the file. `handleModels` then maps a JSON array's `id`s into `models`, so `ai/models` with `X-Api-Key: x` and `X-Api-Base-URL: file:///path/x.json?` returns a local file's contents. The hostname is `""`, so the guard passes it.
- **A trailing-dot name passes**: `metadata.google.internal.` is the same host, and the `===` test misses it.
- **Redirects are followed.** Neither `exchange` in `packages/ai/src/gateway/chat.ts` nor `handleModels` sets `redirect`, so an allowed upstream answering `307 Location: http://169.254.169.254/…` has the proxy contact the metadata service after the guard said yes.
- **The site import's AI pass has neither rule.** `getAiConfig` in `packages/server/src/import-api.ts` reads the same `X-Api-Key` / `X-Api-Base-URL` / `OPENAI_*` inputs (its header says "matches ai-api.ts") but falls back to `OPENAI_API_KEY` for a caller-chosen base URL and never calls the guard. Studio sends both headers to `POST /__studio/import-site` (`packages/studio/src/services/import-client.ts`), and `packages/import/src/ai-componentize.ts` posts the key to `${baseUrl}/chat/completions`. So the key-exfiltration defence and the host guard both have a bypass one route over.
- **Metadata endpoints outside both ranges**: EC2's IPv6 instance metadata is `fd00:ec2::254` (inside `fc00::/7`), Alibaba Cloud's is `100.100.100.200` (inside `100.64.0.0/10`). Both are forwarded, as §5 currently permits.
- **Names are never resolved**: `169.254.169.254.nip.io` passes. No text claims otherwise, but §2's "blocks cloud-metadata … hosts" reads as if it might.

**Outside ai.md.** `specs/server.md` §4.1's AI-proxy bullet (line 186) names "the link-local base-URL guard of §4.2", but server.md §4.2 specifies only the inbound gate; the guard's contract is ai.md §4. `docs/extending/embedding/backend-protocol.md` line 96 says the dev server "refuses link-local hosts", which overstates today's guard; its `code:` lists the gateway files but not `ai-api.ts`, which carries no `@docs` tag, so `bun run docs:sync` will not name it.

## Outcome

- ai.md §4 → Implemented: one base-URL policy (scheme, the two link-local ranges in every spelling, the named metadata endpoints) judged before either AI proxy route or the import's naming pass contacts anything; the proxy follows no redirect; what the guard does not judge is written down.
- ai.md §2's pointer and §5's two IANA row notes describe that guard. ai.md does not graduate: the whole-spec marker, §2, §2.2 and §3 stay open under their own plans.

## Decisions

- **Decided:** the guard judges the parsed address with `node:net` (`isIP`, and one module-level `BlockList` holding the refused ranges), because it is the runtime's own subnet matcher, it already folds IPv4-mapped IPv6 into the IPv4 rule, and a range table reads as the contract; the test rows pin that behaviour on the CI Bun. A hand-rolled hextet parser would be more code to cover for no gain.
- **Decided:** a base URL whose scheme is not `http:` or `https:` is refused, because Bun's `fetch` reads `file:` URLs from disk (above) and §2's provider is an HTTP endpoint. An unparseable URL keeps being refused.
- **Decided:** a name is compared after dropping one trailing dot. The URL parser already lower-cases and IDNA-maps an `http(s)` host, so nothing else needs normalising.
- **Decided:** every refusal stays `403` `forbidden`, answered before any upstream is contacted, as today; the message names the rule (`Base URL must be an http or https URL.` for scheme and parse failures, the existing `Base URL host is not permitted.` for a host).
- **Open:** which IPv6 spellings of a `169.254.0.0/16` address are refused besides the mapped one. Recommendation: also the NAT64 well-known prefix (`64:ff9b::/96`, an IANA IPv6 registry row) and the deprecated IPv4-compatible form (`::/96`), as two `/112` subnets, `64:ff9b::a9fe:0` and `::a9fe:0`; not 6to4 (`2002::/16`) or Teredo (`2001::/32`), whose embedded IPv4 names a relay rather than the destination, and not the obsolete SIIT `::ffff:0:0:0/96`. Because each is one table row that refuses nothing a model server listens on, `::/96` excludes `::` and `::1` by construction (their low 32 bits are not in `169.254/16`), and "every spelling that carries a 169.254 address in its low 32 bits" is a rule a reader can check without a routing argument.
- **Open:** what the guard refuses beyond the two ranges, and whether names are resolved. Recommendation: exact matches for the documented cloud metadata endpoints outside both ranges, `metadata.google.internal` (as today), `fd00:ec2::254` and `100.100.100.200`, and no DNS resolution, with §4 saying so. Because §2 promises "cloud-metadata hosts" and each is one address no self-hosted model uses, while a resolve-then-fetch check is undone by an answer that changes before the connection opens and Bun's `fetch` has no hook to pin the connection to the checked address; the proxy also sits behind the loopback gate and, on desktop, the token (server.md §4.2), so the guard is defence in depth for a widened `--host`, not the perimeter. If declined: drop the two addresses, and §4 still states that names are not resolved.
- **Open:** does the proxy follow an upstream redirect? Recommendation: no. Both upstream requests use `redirect: "manual"` (chat through the gateway's existing `fetch` option, models directly), so a `3xx` reaches the client through the existing non-2xx path: an `error` frame whose `code` is the status on `ai/chat`, `upstreamError: <status>` on `ai/models`. Because a redirect is the one way an allowed host can make the proxy contact a refused one, and the cost is small: a `301`/`302` already breaks chat (the method becomes `GET`), so only a base URL that works through a `307`/`308`, typically `http://` in front of a server that upgrades to `https://`, stops working, and it now says so with a status. If declined, §4 states that a redirect is followed and not judged.
- **Open:** does `POST /__studio/import-site`'s component-naming pass apply the same policy (host guard and key provenance)? Recommendation: yes, by calling the proxy's config function, with a refusal skipping the naming pass behind a progress line that gives the reason, as a missing key does today. Because it reads the same headers to reach the same provider with the same key, its own header claims to match, and without it both of this guard's promises have a bypass one route over. The redirect rule is not extended there: that request is made inside `packages/import`, which the `jx-import` CLI runs with no server policy, and its answer only becomes component names.

## Implementation

1. **`packages/server/src/ai-api.ts`**
   - `import { BlockList, isIP } from "node:net";`
   - Module-level `REFUSED_ADDRESSES = new BlockList()`, filled from a commented table: `169.254.0.0/16` ipv4 (link-local, and through `BlockList`'s mapped folding `::ffff:169.254.0.0/112`), `fe80::/10` ipv6, and per the Opens `::a9fe:0/112` and `64:ff9b::a9fe:0/112` ipv6, `fd00:ec2::254` ipv6 and `100.100.100.200` ipv4 via `addAddress`. `REFUSED_NAMES = new Set(["metadata.google.internal"])`.
   - Replace `isBlockedHost` with `baseUrlRefusal(rawUrl: string): string | null`: parse (throw → the scheme message); `protocol` not `http:`/`https:` → the scheme message; strip the brackets from `hostname`; `isIP(host)` is `0` → refuse when `REFUSED_NAMES` has the host minus one trailing dot; otherwise refuse when `REFUSED_ADDRESSES.check(host, family === 6 ? "ipv6" : "ipv4")`. Its doc comment cites ai.md §4 and lists what it does not judge.
   - `getConfig` becomes `export function resolveAiConfig(req: Request): AiConfig` (and `export interface AiConfig`), unchanged in order: guard first (`reject: { status: 403, message }`), then key provenance, then the env key. `resolveUpstream` and `handleModels` call it.
   - `const upstreamFetch = ((input, init) => fetch(input, { ...init, redirect: "manual" })) as typeof fetch;`, referencing the global `fetch` at call time so the suites that swap `globalThis.fetch` keep working; `createChatHandler({ fetch: upstreamFetch, resolveUpstream })`, and `handleModels` calls `upstreamFetch(upstreamUrl, …)`.
   - File header: rewrite the "Base URL flow" line to the policy (cite ai.md §4, not a plan), and add `@docs extending/embedding/backend-protocol`.
2. **`packages/server/src/import-api.ts`**: delete `getAiConfig`; `handleImportSite` calls `resolveAiConfig(req)` from `./ai-api.ts`. When `body.aiComponents` is set: a `reject` writes `{ type: "progress", phase: "ai", message: "⚠ AI component naming skipped: <reject.message> Continuing with heuristic names." }` and leaves `ai` false; otherwise an `apiKey` sets `ai = { apiKey, baseUrl, model: body.aiModel }`; otherwise the existing no-key line. The header's "LLM key flow (matches ai-api.ts)" paragraph says it runs the proxy's policy (ai.md §4).

Nothing changes in `packages/ai`: the gateway already takes `fetch`, and a `3xx` already maps to a problem type (`problemTypeForStatus`, covered for every non-2xx status by `ai-api-gateway.test.ts`).

`plan:ai/harness-phase-1#J1.18` and `#J1.19` also edit `ai-api.ts` and line 96 of `backend-protocol.md`. Neither depends on this guard; whichever lands second rebases.

**Integration contract.** `@jxsuite/server/ai-api` exports `resolveAiConfig(req)` and `AiConfig`; any server route that forwards a provider key upstream calls it and honours `reject`. A refused base URL on either AI route is a `403` problem with no upstream contact. An upstream redirect on `ai/models` is `200` with `upstreamError` set to the `3xx` status and `upstreamMessage` from the body or status text (relevant to `plan:ai/model-listing-failure-shown`, which reads that pair). ai.md §4 is the one home of the base-URL contract, and server.md and the docs point at it.

## Tests

`bun test --isolate --coverage` from `packages/server`.

- **`packages/server/tests/ai-api.test.ts`**, in `describe("AI proxy key-provenance + SSRF hardening")`:
  - `blocks %s on %s (403)` replaces the line-1003 `it.each`: every row runs on both `ai/chat` and `ai/models` with `X-Api-Key`, under `withUpstream` with a recording fake, and asserts `403`, `application/problem+json`, and zero upstream calls. Rows: the three existing; `http://metadata.google.internal./v1`; `http://[fe90::1]/v1`, `http://[febf:ffff::1]/v1`; `http://169.254.0.1/v1`, `http://2852039166/v1`, `http://0xa9fea9fe/v1`; `http://[::ffff:169.254.169.254]/v1`, `http://[::ffff:a9fe:a9fe]/v1`; `http://[::169.254.169.254]/v1`, `http://[64:ff9b::169.254.169.254]/v1` (embeddings Open); `http://[fd00:ec2::254]/v1`, `http://100.100.100.200/v1`, `http://[::ffff:100.100.100.200]/v1` (named-endpoint Open); `file:///etc/hosts?`, `ftp://llm.example/v1`, `data:,x`.
  - `forwards %s`: `ai/models` with `X-Api-Key` and a fake answering `{ data: [] }`; asserts `200` and that the fake saw `<base>/models`. Rows: `http://169.253.255.255/v1`, `http://169.255.0.1/v1`, `http://[fe7f:ffff::1]/v1`, `http://[fec0::1]/v1`, `http://[fd00::1]/v1`, `http://[::1]:11434/v1`, `http://[::ffff:127.0.0.1]:11434/v1`, `http://127.0.0.2:1234/v1`, `http://192.168.1.10:1234/v1`, `http://metadata.google.internal.example/v1`.
  - `judges the environment base URL too`: `OPENAI_API_KEY` and `OPENAI_BASE_URL=http://[fe90::1]/v1`, no headers: `ai/chat` answers `403`.
  - `names the scheme rule`: a `file:` base URL's problem `detail` is `Base URL must be an http or https URL.`
  - New `describe("upstream redirects")` (redirect Open), against a real `Bun.serve({ hostname: "127.0.0.1", port: 0 })` stopped in `afterAll`: `/v1/models` and `/v1/chat/completions` answer `307` with `Location: /landed`, and `/landed` counts hits. `models reports a redirect as the upstream status without following it`: `upstreamError` is `307`, hits `0`. `chat reports a redirect as an error frame without following it`: one `error` frame with `code: "307"`, hits `0`.
- **`packages/server/tests/import-api.test.ts`** (import Open): `skips AI naming when the base URL is refused` (`X-Api-Key` plus `X-Api-Base-URL: http://[fe90::1]/v1`: `options.ai` is `false`, a progress line contains `not permitted`, the last line is `done`); `never sends the env key to a caller-chosen base URL` (`OPENAI_API_KEY` set, only `X-Api-Base-URL: https://attacker.example/v1`: `options.ai` is `false`, a line contains `explicit API key`). The existing header, Bearer, env-fallback and no-key cases pass unchanged.
- Must stay green unchanged: `ai-upstream-fixtures.test.ts`, `ai-api-gateway.test.ts`, `dev-server-import.test.ts`, `project-server-import.test.ts`.

Coverage: `packages/server/bunfig.toml` gates every file at lines 0.96, functions 0.95; no source file is added, so the manifest check is unaffected, and every new branch has a row. Raise the threshold only if the workspace's worst-file minimum rises.

## Specs & docs

**ai.md**, in place:

- §4: the line-183 marker becomes `> **Status: Implemented.**` followed by its evidence: `packages/server/src/net-guard.ts` for the surfaces, gate and containment, and `baseUrlRefusal` in `packages/server/src/ai-api.ts` with `packages/server/tests/ai-api.test.ts` for the guard. The existing paragraph stays; two paragraphs follow it (drop or rewrite each clause an Open decision declines):

  ```markdown
  **The provider endpoint is judged before it is contacted.** Every request that carries a provider key upstream (both AI proxy routes, and the site import's component-naming pass, §3.5) resolves its base URL (`X-Api-Base-URL`, else `OPENAI_BASE_URL`, else OpenAI's) and answers `403`, contacting nothing, when the URL does not parse or its scheme is not `http:` or `https:`; when its host is an address in `169.254.0.0/16` or `fe80::/10`, the link-local ranges the cloud metadata services listen in, in any spelling the URL parser accepts; when its host is an IPv6 address carrying a `169.254.0.0/16` address in its low 32 bits (IPv4-mapped `::ffff:0:0/96`, NAT64 `64:ff9b::/96`, or the deprecated IPv4-compatible `::/96`); or when its host is one of the cloud metadata endpoints outside both ranges, matched exactly: `metadata.google.internal`, `fd00:ec2::254` and `100.100.100.200`. Loopback and private-use addresses are deliberately permitted, because self-hosted models run there (§5).

  **It judges the URL, not the network.** A name is never resolved, so a DNS name that resolves into a refused range is forwarded: a check made before the request is undone by an answer that changes before the connection opens, and the request cannot be pinned to the address that was checked. An AI proxy route contacts only the host it judged. It follows no redirect; a redirect reaches the client as the upstream's own non-2xx status (§2).
  ```

- §2, line 23: "(see `@jxsuite/server` §4.2)" becomes "(§4)". Only the parenthetical: §2's marker belongs to `plan:ai/model-listing-failure-shown`, so the two can conflict textually at most.
- §5: the IPv4 row's note becomes "Only `169.254.0.0/16` is refused (the link-local range that contains the cloud metadata address), in every spelling and inside an IPv6 address (§4). Loopback, private-use and shared address space are deliberately permitted, because self-hosted models run there; the one address refused outside the range is Alibaba Cloud's metadata endpoint, `100.100.100.200`." The IPv6 row's note becomes "`fe80::/10` is refused, matching the IPv4 rule, and an address carrying an IPv4 address in its low 32 bits (`::ffff:0:0/96`, `64:ff9b::/96`, and the deprecated IPv4-compatible `::/96`) is judged by that address. `fc00::/7` is permitted with the private-use ranges, except EC2's metadata endpoint `fd00:ec2::254`." Both rows' Evidence gain `packages/server/tests/ai-api.test.ts`; both stay `**Subset**` on §4. Re-pad the table with `bun run format`.
- Fragment: `bun run spec:change ai.md minor -m "§4: the provider base URL is judged before any request that carries the key, AI proxy and import naming alike: non-HTTP schemes, all of 169.254.0.0/16 and fe80::/10 in every spelling including IPv4 embedded in IPv6, and the named metadata endpoints are refused, and the proxy follows no upstream redirect; §2 points at §4."` (trim the clauses a declined decision removes).

**server.md** §4.1, line 186: "(key provenance, the environment-key fallback, the link-local base-URL guard of §4.2)" becomes "(key provenance, the environment-key fallback, and the base-URL guard of ai.md §4, which the site import's naming pass applies too)". server.md is `Implemented` and outside the census: no marker change. Fragment: `bun run spec:change server.md patch -m "§4.1: the AI proxy's base-URL guard is specified in ai.md §4, and the site import's naming pass applies it too."`

**Docs** (no em dashes):

- `docs/extending/embedding/backend-protocol.md`: add `ai.md#4` to `spec:` and `packages/server/src/ai-api.ts` to `code:`. Line 96's parenthetical becomes "(the dev server never sends its own environment key to a URL the caller chose, refuses a base URL that is not `http` or `https` or whose host is link-local in either address family or a cloud metadata endpoint, and follows no redirect from the provider)".
- `docs/studio/ai.md`: add `packages/server/src/ai-api.ts` to `code:`. Step 2 of "Bring your own key" gains: "The desktop app and `jx dev` refuse an endpoint on a link-local address (`169.254.x.x` or `fe80::`) or a cloud metadata address, and do not follow a redirect, so enter the address that answers (`https://` where the provider redirects there)."
- `docs/studio/projects/create.md`: add `packages/server/src/import-api.ts` to `code:`. Item 4 (AI component naming) gains: "It uses the key and endpoint you connected for the assistant, under the same rules: when the assistant would refuse that endpoint, the import says why in its log and numbers the components instead."
- No other page cites `ai.md#4` or `#5`; the standards and spec-changelog pages are generated.

On landing, delete this file and rewrite `plans/ai/README.md`'s §4 line under Verified to cite the whole section with `packages/server/src/ai-api.ts` and its test.

## Acceptance

- `bun test --isolate --coverage` passes in `packages/server`.
- Against a running `jx dev` (port `P`): `curl -s -H 'X-Api-Key: x' -H 'X-Api-Base-URL: http://[fe90::1]/v1' http://127.0.0.1:P/__studio/ai/models` and the same with `http://[::ffff:169.254.169.254]/v1` and with `file:///etc/hosts?` each answer `403` `application/problem+json`; `http://127.0.0.1:1234/v1` (an LM Studio, or nothing listening) answers `200`.
- `grep -n 'startsWith("fe80:")\|startsWith("169.254.")' packages/server/src/ai-api.ts` and `grep -n getAiConfig packages/server/src/import-api.ts` find nothing.
- `bun run docs:status`, `bun run docs:standards`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:spec-release` and `bun run plans:check` are green; `bun run plans:status --spec ai` no longer lists `ai.md#4`.
