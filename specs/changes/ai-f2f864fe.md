---
spec: ai.md
level: minor
---

§2.4 one gateway implementation: @jxsuite/ai/gateway serves the chat and models routes for every backend (the server's normalizer moved verbatim, a fixed order of admission checks, problem refusals, SSE framing), and key provenance and the base-URL guard stay the host's policy; §1 names ./gateway Worker-safe.
