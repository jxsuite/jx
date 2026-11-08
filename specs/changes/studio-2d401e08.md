---
spec: studio.md
level: minor
---

§11.1: the code editor registers every Monaco feature before the first editor exists, because the lazily loaded JSON and TypeScript modes registered the rest late, and two of them threw on every editor created afterwards.
