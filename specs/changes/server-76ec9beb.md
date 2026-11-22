---
spec: server.md
level: minor
---

The dev server serves the project state stream at GET /__studio/project/events and conditional file writes and deletes, refuses a stream naming another project than the active one, keys a collaboration room and the preview overlay inside the active project by its document (§3.1, §4.1).
