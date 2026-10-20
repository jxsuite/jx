---
spec: embedding.md
level: minor
---

§2.2: dispose() removes the root before it stops the render's effects and calls onUnmount, so style release writes to detached nodes; keyed $map rows and $switch cases are taken down in the same order.
