---
spec: server.md
level: minor
---

§4.1: the co-editing registry writes a room only when a client flushes it, stopping the dev server writes nothing, and a rename resets the old path's room so no later save writes it back.
