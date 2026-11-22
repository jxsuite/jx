---
spec: project-state.md
level: minor
---

11.2 is Implemented: one preview realm, canvas.html?realm=preview, draws every out-of-canvas preview from documents the content store hands it by DocId, answers markup snapshots the shell shows in each card's shadow root, and is replaced when a definition its registry holds changes, including one a request in flight defined; the realm's own failures are marked lost, definitions are made one at a time, the settle wait is bounded, and the shell makes each snapshot inert before mounting it.
