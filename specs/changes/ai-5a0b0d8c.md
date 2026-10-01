---
spec: ai.md
level: minor
---

§2.5 prompt caching: the proxy client sends the conversation id as X-Jx-Ai-Session, a backend forwards only affinityKey(scope, id) as the upstream's sessionAffinity, and each provider gets only its own hint (prompt_cache_key to OpenAI, x-session-affinity to Workers AI and AI Gateway, nothing to any other host). §2.4: the gateway's runtime imports outside itself now include ../cache-hints.ts.
