---
spec: compiler.md
level: patch
---

§4.4: a compiled element put back in a document keeps the tree it drew. The container is cleared, and slotted children captured and distributed, on the first connection only; a later connection restarts the effects.
