---
status: stub
disposition: implement
claims:
  - ai.md#4
workspaces:
  - packages/server
size: S
---

# The AI proxy refuses all of fe80::/10 and the mapped metadata address

## Context

`specs/ai.md` §4, line 183:

> **Status: Partial.** The file/RPC surfaces, the Origin/Host gate and path containment hold (`packages/server/src/net-guard.ts`). The base-URL host block that §2 names and the two IANA rows in §5 describe is narrower than both: `isBlockedHost` in `packages/server/src/ai-api.ts` refuses a hostname whose text begins `fe80:`, so the rest of `fe80::/10` (`[fe90::1]`, `[febf::1]`) is forwarded, and it tests `169.254.` against the dotted IPv4 spelling alone, so the IPv4-mapped form of the metadata address (`[::ffff:169.254.169.254]`, which the URL parser serializes as `[::ffff:a9fe:a9fe]`) is forwarded too. `packages/server/tests/ai-api.test.ts` covers only `169.254.169.254` and `[fe80::1]`.

The promises this item makes true: §2's "blocks cloud-metadata/link-local hosts", and the §5 rows that bind §4, "Only `169.254.0.0/16` is refused" (IPv4) and "Only `fe80::/10` is refused, matching the IPv4 rule" (IPv6).

**What exists**

- `isBlockedHost(rawUrl)` in `packages/server/src/ai-api.ts`: parses with `new URL`, lower-cases, strips the IPv6 brackets, then refuses `metadata.google.internal`, a host starting `169.254.` and a host starting `fe80:`. An unparseable URL is refused. It runs in `getConfig`, so both `ai/chat` (through `resolveUpstream`) and `ai/models` are covered by one fix.
- The WHATWG URL parser already canonicalises the IPv4 spellings that matter (`http://2852039166/` and `http://0xa9fea9fe/` both serialize as `169.254.169.254`) and lower-cases IPv6, so the two gaps are the IPv6 prefix test and the mapped form.
- Tests: `packages/server/tests/ai-api.test.ts`, the metadata-host case (line 987) and the `["an IPv6 link-local host", "http://[fe80::1]/v1"]` row (line 1006).
- `plan:ai/harness-phase-1` slice J1.17 moves `ai-api.ts` onto the shared gateway but keeps SSRF as a server-local function in the resolver, so the guard stays in this file.

**What is missing**

- The IPv6 test widened to the whole `/10`: the first hextet in `fe80` to `febf` (top ten bits `1111111010`), not the literal text `fe80:`.
- IPv4-mapped IPv6 (`::ffff:a.b.c.d`, serialized as `::ffff:XXXX:XXXX`) unwrapped to its IPv4 address before the `169.254.0.0/16` test. Whether the other embeddings (the deprecated IPv4-compatible `::a.b.c.d`, NAT64 `64:ff9b::/96`) are refused too is for the detail phase.
- Test rows for `[fe90::1]`, `[febf::1]` and `[::ffff:169.254.169.254]`, plus a boundary row (`[fec0::1]` is outside the `/10` and stays permitted, matching "loopback and private-use ranges are deliberately permitted").
- The Specs & docs step also corrects two statements about the guard that live outside ai.md:
  - **server.md.** `specs/server.md` §4, in the §4.1 route list (line 186), has the AI-proxy bullet: "`ai-api.ts` supplies this server's policy to it (key provenance, the environment-key fallback, the link-local base-URL guard of §4.2)". §4.2 (lines 197 to 248) does not describe that guard. It specifies the inbound gate (Origin/Host, Fetch Metadata and the loopback server's token) and names the AI proxy only as a gated surface. The outbound base-URL guard is specified in ai.md §4, with its two IANA rows in ai.md §5. The default correction points the bullet at `ai.md` §4 and adds no contract. server.md is `Implemented` and outside the census, so the edit carries no marker change and is released as a `patch` fragment (`bun run spec:change specs/server.md patch -m "…"`).
  - **The docs page.** `docs/extending/embedding/backend-protocol.md` (line 96) says the dev server "refuses link-local hosts". Today that overstates the guard, because `[fe90::1]`, `[febf::1]` and `[::ffff:169.254.169.254]` are forwarded. It also leaves out the one host refused by name, `metadata.google.internal`. Once the code matches, the sentence names what is refused: link-local addresses in both families (`169.254.0.0/16` and `fe80::/10`, IPv4-mapped spellings included) and the metadata host name. `bun run docs:sync` will not name this page. Its `code:` frontmatter lists the `packages/ai` gateway files but not `packages/server/src/ai-api.ts`, and `ai-api.ts` carries no `@docs` tag. So the step edits the page by name and adds `packages/server/src/ai-api.ts` to its `code:` list, which lets the next change to the guard flag the page.
- The same dangling pointer is inside ai.md: §2 (line 23) says the proxy "blocks cloud-metadata/link-local hosts (see `@jxsuite/server` §4.2)". It is re-pointed at §4 in this plan's own `ai.md` fragment. §2's marker belongs to `plan:ai/model-listing-failure-shown`. Only the parenthetical changes here, so the two plans conflict textually at most.

**Related**

- `specs/server.md` §4.1 and §4.2, `docs/extending/embedding/backend-protocol.md` (the two corrections above); `specs/ai.md` §2 (the promise and its pointer) and §5 (the IANA rows bound to §4).
