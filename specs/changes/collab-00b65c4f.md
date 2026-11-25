---
spec: collab.md
level: minor
---

The room host, persistence, frames, control messages, awareness state and source-canonical lock are specified in new sections 1.1, 1.2, 2.2, 2.3, 2.4 and 3.2: a flush answers once, in order, and a failed or unconfirmed save says so, a read-only or unopened flush is refused, a save under the source lock flushes the text as it is, the dev server writes only on a flush, the structure mirror is elected among the room's writers, presence lists the rooms a client holds, and presence per document is Future.
