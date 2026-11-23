---
spec: project-state.md
level: minor
---

Every adapter subscribes, and the resync reasons are retired: a reconnect is a subscribe with sinceRev, every cache is keyed by the store (a new epoch's snapshot of the same bytes re-keys rather than drops, and a `docChanged` of bytes already accounted for is no other writer's change), and a host that does not serve the subscription leaves Studio with no live account of other writers.
