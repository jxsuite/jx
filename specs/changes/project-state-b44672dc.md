---
spec: project-state.md
level: minor
---

§9 Implemented: the rename cascade plans the move and every reference rewrite, applies them from an in-memory outbox that rolls back on failure (the directories a move created included, and an incomplete rollback named in `unrestored`), honours the dirty-referrer policies (a dirty document's client rewrite is never written), refuses without client rewrites only while a format is not known yet, allows a rename that changes only the case of a name, and answers a RenameOperationResult; the desktop binding serves it as projectRename and the dev server as POST /__studio/project/rename, which names its project; §10.4 gains the §9 cases, identity kept across the move included
